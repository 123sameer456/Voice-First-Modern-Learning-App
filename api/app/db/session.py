"""Demo-mode database: in-memory SQLite shared across the whole process.

The demo runs with zero external services and zero credentials. On every cold
start the app creates a fresh schema and re-seeds the demo content (see
app.seed.init_db); data lives as long as the serverless instance is warm.

StaticPool keeps ONE connection for the whole process so every session sees
the same in-memory database (each pooled connection would otherwise get its
own empty :memory: database).
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass
