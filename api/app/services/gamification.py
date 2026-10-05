"""Gamification: XP awards, levels, streaks and badge checks.

XP is `Activity.xp` scaled by submission quality:
- first-attempt pass with no hints/errors = 100%
- pass with hints/errors = scaled down (floor 40%)
- fail = small participation award (25%)
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import (
    Activity,
    Badge,
    Interaction,
    LearnerProfile,
    UserBadge,
    utcnow,
)

FAIL_PARTICIPATION_RATIO = 0.25
QUALITY_FLOOR = 0.4
HINT_XP_PENALTY = 0.15   # fraction of XP lost per hint used on a pass
ERROR_XP_PENALTY = 0.10  # fraction of XP lost per error on a pass


def level_for_xp(xp: int, level_curve: int) -> int:
    if level_curve <= 0:
        return 1
    return (xp // level_curve) + 1


def compute_xp(
    activity: Activity,
    *,
    passed: bool,
    hints_used: int,
    error_count: int,
    tasks_completed: int | None = None,
) -> int:
    """Quality-scaled XP for one graded submission."""
    if not passed:
        return max(1, round(activity.xp * FAIL_PARTICIPATION_RATIO))

    if activity.type == "mission" and tasks_completed is not None:
        # Missions: proportional credit for the tasks the learner reports done.
        min_tasks = _min_tasks(activity)
        ratio = 1.0 if min_tasks <= 0 else min(1.0, tasks_completed / min_tasks)
        return max(1, round(activity.xp * ratio))

    quality = 1.0 - HINT_XP_PENALTY * hints_used - ERROR_XP_PENALTY * error_count
    quality = max(QUALITY_FLOOR, min(1.0, quality))
    return max(1, round(activity.xp * quality))


def _min_tasks(activity: Activity) -> int:
    answer = activity.payload.get("answer") or {}
    try:
        return int(answer.get("min_tasks", 0))
    except (TypeError, ValueError):
        return 0


def update_streak(profile: LearnerProfile, *, now: datetime | None = None) -> tuple[int, int]:
    """Update the daily streak from `last_active_at`.

    Returns (previous_days_gap, new_streak). A consecutive-day activity
    increments the streak, a same-day activity leaves it unchanged, and a gap
    of more than one day resets it to 1. When streaks are disabled (checked by
    the caller via the `gamification` settings group) the caller skips this
    and only bumps last_active_at.
    """
    now = now or utcnow()
    previous_gap_days = -1
    if profile.last_active_at is None:
        profile.streak_count = max(profile.streak_count, 1)
    else:
        gap_days = (now.date() - profile.last_active_at.date()).days
        previous_gap_days = gap_days
        if gap_days == 0:
            pass  # same-day activity: streak unchanged
        elif gap_days == 1:
            profile.streak_count += 1
        else:
            profile.streak_count = 1
    profile.last_active_at = now
    return previous_gap_days, profile.streak_count


def _count_activities(db: Session, user_id: int) -> int:
    return db.query(Interaction).filter(Interaction.user_id == user_id).count()


def _has_perfect_run(db: Session, user_id: int) -> bool:
    row = (
        db.query(Interaction)
        .filter(Interaction.user_id == user_id)
        .order_by(Interaction.created_at.desc())
        .all()
    )
    for interaction in row:
        signals = interaction.signals or {}
        if (
            signals.get("passed")
            and not signals.get("hints_used")
            and not signals.get("error_count")
        ):
            return True
    return False


def _has_urdu_activity(db: Session, user_id: int) -> bool:
    rows = (
        db.query(Interaction)
        .filter(Interaction.user_id == user_id)
        .order_by(Interaction.created_at.desc())
        .all()
    )
    return any((interaction.signals or {}).get("language") == "ur" for interaction in rows)


def check_badges(
    db: Session,
    user_id: int,
    profile: LearnerProfile,
    *,
    level_curve: int,
    return_gap_days: int | None = None,
) -> list[Badge]:
    """Award any newly-earned badges; returns the list of NEW UserBadge badges."""
    badges = db.query(Badge).all()
    owned = {
        ub.badge_id
        for ub in db.query(UserBadge).filter(UserBadge.user_id == user_id).all()
    }
    activities_completed = _count_activities(db, user_id)

    newly: list[Badge] = []
    for badge in badges:
        if badge.id in owned:
            continue
        criteria = badge.criteria or {}
        kind = criteria.get("type")
        value = criteria.get("value", 1)
        earned = False
        if kind == "activities_completed":
            earned = activities_completed >= value
        elif kind == "streak":
            earned = profile.streak_count >= value
        elif kind == "perfect_activity":
            earned = _has_perfect_run(db, user_id)
        elif kind == "level":
            earned = level_for_xp(profile.xp, level_curve) >= value
        elif kind == "urdu_activity":
            earned = _has_urdu_activity(db, user_id)
        elif kind == "return_after_days":
            earned = return_gap_days is not None and return_gap_days >= value

        if earned:
            db.add(UserBadge(user_id=user_id, badge_id=badge.id))
            newly.append(badge)
    db.flush()
    return newly
