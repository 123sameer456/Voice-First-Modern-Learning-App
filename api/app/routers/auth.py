import hashlib
from datetime import timedelta

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models import AuditLog, LearnerProfile, RefreshToken, User, utcnow
from app.schemas import LoginRequest, LogoutRequest, RefreshRequest, TokenPair, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

limiter = Limiter(key_func=get_remote_address)


def _refresh_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _issue_tokens(db: Session, user: User) -> TokenPair:
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=_refresh_hash(refresh),
            expires_at=utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    db.commit()
    return TokenPair(
        access_token=access, refresh_token=refresh, user=UserOut.model_validate(user)
    )


@router.post("/login", response_model=TokenPair)
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)) -> TokenPair:
    ip = request.client.host if request.client else None
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        db.add(
            AuditLog(action="login_failed", detail={"email": body.email}, ip=ip)
        )
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    if not user.profile:
        user.profile = LearnerProfile(user_id=user.id)
        db.flush()

    db.add(AuditLog(user_id=user.id, action="login", ip=ip))
    return _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token)
    except pyjwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

    row = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == _refresh_hash(body.refresh_token),
            RefreshToken.revoked.is_(False),
        )
        .first()
    )
    if not row or row.expires_at < utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired or revoked")

    user = db.get(User, int(payload.get("sub", "0")))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    row.revoked = True  # rotation: single use
    return _issue_tokens(db, user)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/logout")
def logout(
    body: LogoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    row = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == _refresh_hash(body.refresh_token),
            RefreshToken.user_id == user.id,
            RefreshToken.revoked.is_(False),
        )
        .first()
    )
    if row:
        row.revoked = True
        db.commit()
    return {"detail": "logged out"}
