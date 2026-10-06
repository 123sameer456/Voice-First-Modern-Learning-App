"""Read a settings group from the DB, merged over the seeded defaults.

Supports per-course (journey) overrides: an admin can save group overrides on a
journey's config_snapshot; consumers that know the journey get the merged view
(global value, overridden per key).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Journey, Setting
from app.seed import DEFAULT_SETTINGS

SETTINGS_GROUPS = ("content", "gamification", "adaptive", "engagement", "voice")

# Groups consumed per-course at runtime. The rest are global-only for now
# (content = generation defaults, engagement = account-level nudge cadence).
PER_COURSE_GROUPS = ("gamification", "adaptive")


def journey_overrides(journey: Journey | None, key: str | None = None) -> dict:
    """The overrides stored on a journey (optionally just one group)."""
    if journey is None:
        return {}
    overrides = (journey.config_snapshot or {}).get("settings_overrides") or {}
    if key is not None:
        group = overrides.get(key)
        return group if isinstance(group, dict) else {}
    return overrides if isinstance(overrides, dict) else {}


def get_group(db: Session, key: str, journey: Journey | None = None) -> dict:
    """Settings group `key` merged over defaults, then over journey overrides."""
    defaults = DEFAULT_SETTINGS.get(key, {})
    row = db.get(Setting, key)
    merged = {**defaults, **(row.value if row and isinstance(row.value, dict) else {})}
    group_overrides = journey_overrides(journey, key)
    if group_overrides:
        merged = {**merged, **group_overrides}
    return merged
