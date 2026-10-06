from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# Plain file-based SQLite needs the thread flag; the libsql HTTP dialect
# (sqlite+libsql://…) must not receive sqlite3-specific connect args.
_is_local_sqlite = settings.DATABASE_URL.startswith("sqlite:///")

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if _is_local_sqlite else {},
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
