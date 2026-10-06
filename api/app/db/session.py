from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# Plain file-based SQLite needs the thread flag; the libsql HTTP dialect
# (sqlite+libsql://…) must not receive sqlite3-specific connect args.
_is_local_sqlite = settings.DATABASE_URL.startswith("sqlite:///")

try:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False} if _is_local_sqlite else {},
    )
except Exception:
    # A malformed remote URL must not take the whole app down at import:
    # fall back to a file DB and surface it via /api/health ("db": "sqlite").
    import sys
    import traceback

    traceback.print_exc()
    fallback = (
        "sqlite:////tmp/app.db"
        if settings.ENVIRONMENT == "prod"
        else f"sqlite:///{(Path(__file__).resolve().parents[2] / 'app.db').as_posix()}"
    )
    print(f"WARNING: falling back to the file DB at {fallback}", file=sys.stderr)
    settings.DATABASE_URL = fallback  # keeps /api/health truthful
    engine = create_engine(fallback, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
