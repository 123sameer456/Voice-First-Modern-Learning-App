from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.core.security import hash_password
from app.models import (
    AuditLog,
    Interaction,
    Journey,
    LearnerProfile,
    Mastery,
    RefreshToken,
    Setting,
    User,
)
from app.schemas import (
    AdminPasswordReset,
    AdminUserCreate,
    AdminUserOut,
    AdminUserUpdate,
    SettingOut,
    SettingUpdate,
    StatsOut,
)

router = APIRouter(prefix="/admin", tags=["admin"])

EDITABLE_SETTINGS = ("content", "gamification", "adaptive", "engagement", "voice")


def _user_out(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        xp=user.profile.xp if user.profile else 0,
        level=user.profile.level if user.profile else 1,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[AdminUserOut]:
    users = db.query(User).order_by(User.created_at).all()
    return [_user_out(u) for u in users]


@router.post("/users", response_model=AdminUserOut, status_code=201)
def create_user(
    body: AdminUserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    email = body.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(email=email, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    db.flush()
    db.add(LearnerProfile(user_id=user.id, language_pref=body.language_pref))
    db.add(
        AuditLog(
            user_id=admin.id,
            action="user_created",
            detail={"new_user_id": user.id, "role": body.role},
        )
    )
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: int,
    body: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserOut:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        if user.id == admin.id and body.is_active is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account")
        user.is_active = body.is_active
        if not body.is_active:
            db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update(
                {"revoked": True}, synchronize_session=False
            )
    db.add(
        AuditLog(
            user_id=admin.id,
            action="user_updated",
            detail={"target_user_id": user_id, "role": body.role, "is_active": body.is_active},
        )
    )
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    body: AdminPasswordReset,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.password_hash = hash_password(body.new_password)
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update(
        {"revoked": True}, synchronize_session=False
    )
    db.add(
        AuditLog(user_id=admin.id, action="password_reset", detail={"target_user_id": user_id})
    )
    db.commit()
    return {"detail": "password updated"}


@router.get("/settings", response_model=list[SettingOut])
def list_settings(
    admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[SettingOut]:
    rows = db.query(Setting).order_by(Setting.key).all()
    return [SettingOut(key=r.key, value=r.value, updated_at=r.updated_at) for r in rows]


@router.put("/settings/{key}", response_model=SettingOut)
def update_setting(
    key: str,
    body: SettingUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SettingOut:
    if key not in EDITABLE_SETTINGS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown settings group '{key}'")
    if not isinstance(body.value, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Setting value must be an object")
    row = db.get(Setting, key)
    if not row:
        row = Setting(key=key, value={})
        db.add(row)
    merged = {**(row.value or {}), **body.value}
    row.value = merged
    db.add(AuditLog(user_id=admin.id, action="settings_updated", detail={"key": key}))
    db.commit()
    db.refresh(row)
    return SettingOut(key=row.key, value=row.value, updated_at=row.updated_at)


@router.get("/stats", response_model=StatsOut)
def get_stats(
    admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> StatsOut:
    users_total = db.query(User).count()
    learners_total = db.query(User).filter(User.role == "learner").count()
    journeys_published = db.query(Journey).filter(Journey.status == "published").count()
    journeys_draft = db.query(Journey).filter(Journey.status == "draft").count()
    interactions_total = db.query(Interaction).count()
    avg_mastery = float(db.query(func.avg(Mastery.score)).scalar() or 0.0)
    return StatsOut(
        users_total=users_total,
        learners_total=learners_total,
        journeys_published=journeys_published,
        journeys_draft=journeys_draft,
        interactions_total=interactions_total,
        avg_mastery=round(avg_mastery, 1),
    )
