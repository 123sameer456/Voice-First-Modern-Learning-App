"""Read a settings group from the DB, merged over the seeded defaults."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Setting
from app.seed import DEFAULT_SETTINGS


def get_group(db: Session, key: str) -> dict:
    """Return the settings group `key` merged over DEFAULT_SETTINGS[key]."""
    defaults = DEFAULT_SETTINGS.get(key, {})
    row = db.get(Setting, key)
    if not row or not isinstance(row.value, dict):
        return dict(defaults)
    return {**defaults, **row.value}
