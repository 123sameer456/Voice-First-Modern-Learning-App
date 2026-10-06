import json
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app import models  # noqa: F401  (register all models with Base.metadata)
from app.models import (
    Activity,
    Badge,
    Concept,
    ContentSource,
    Journey,
    LearnerProfile,
    Nudge,
    Setting,
    User,
    utcnow,
)

SEED_DATA_DIR = Path(__file__).resolve().parent / "seed_data" / "journeys"

DEFAULT_SETTINGS = {
    "content": {
        "default_language": "en",  # en | ur
        "audience_level": "beginner",
        "tone": "friendly",
        "difficulty_range": [1, 3],
    },
    "gamification": {
        "xp_per_activity_base": 10,
        "level_curve": 100,  # xp needed per level
        "streaks_enabled": True,
        "hint_cost_xp": 2,
    },
    "adaptive": {
        "mastery_pass_percent": 70,
        "hint_penalty": 0.1,
        "reinforcement_interval_days": 3,
        "max_difficulty": 5,
    },
    "engagement": {
        "nudges_enabled": True,
        "nudge_frequency_days": 2,
        "quiet_hours": "22:00-08:00",
    },
    "voice": {
        "provider": "elevenlabs",
        "enabled": True,
        "tts_model": "eleven_flash_v2_5",  # cheapest multilingual tier
        "voice_id": settings.ELEVENLABS_VOICE_ID,
        "stability": 0.5,
        "similarity_boost": 0.75,
        "style": 0.0,
        "language": "en",
        "stt_provider": "browser_first",  # browser_first | elevenlabs
        "cache_tts": True,
    },
}

DEFAULT_BADGES = [
    {
        "name": "First Steps",
        "icon": "footprints",
        "description": "Completed your first activity",
        "criteria": {"type": "activities_completed", "value": 1},
    },
    {
        "name": "On Fire",
        "icon": "flame",
        "description": "7-day learning streak",
        "criteria": {"type": "streak", "value": 7},
    },
    {
        "name": "Perfect Run",
        "icon": "target",
        "description": "Cleared an activity with no errors and no hints",
        "criteria": {"type": "perfect_activity", "value": 1},
    },
    {
        "name": "Scholar",
        "icon": "graduation-cap",
        "description": "Reached level 5",
        "criteria": {"type": "level", "value": 5},
    },
    {
        "name": "Polyglot",
        "icon": "languages",
        "description": "Completed an activity in Urdu",
        "criteria": {"type": "urdu_activity", "value": 1},
    },
    {
        "name": "Comeback",
        "icon": "repeat",
        "description": "Returned after 3+ days away",
        "criteria": {"type": "return_after_days", "value": 3},
    },
]


def _ensure_user(db: Session, email: str, password: str, role: str) -> User:
    user = db.query(User).filter_by(email=email.lower()).first()
    if user:
        return user
    user = User(email=email.lower(), password_hash=hash_password(password), role=role)
    db.add(user)
    db.flush()
    db.add(LearnerProfile(user_id=user.id))
    return user


def _load_journey_fixtures(db: Session) -> None:
    """Rebuild demo journeys from committed fixtures (used on fresh DBs, e.g.
    Vercel cold starts where the SQLite file starts empty)."""
    if db.query(Journey).first():
        return
    if not SEED_DATA_DIR.is_dir():
        return

    admin = db.query(User).filter_by(role="admin").first()
    for fixture_path in sorted(SEED_DATA_DIR.glob("*.json")):
        try:
            data = json.loads(fixture_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        source_data = data.get("source", {})
        source = ContentSource(
            type=source_data.get("type", "topic"),
            title=source_data.get("title", "Demo"),
            raw_text=source_data.get("raw_text", ""),
            status="processed",
            created_by=admin.id if admin else 1,
        )
        db.add(source)
        db.flush()

        journey_data = data.get("journey", {})
        published_raw = journey_data.get("published_at")
        try:
            published_at = (
                datetime.fromisoformat(published_raw) if isinstance(published_raw, str) else published_raw
            )
        except ValueError:
            published_at = None
        journey = Journey(
            content_source_id=source.id,
            title=journey_data.get("title", "Demo journey"),
            description=journey_data.get("description", ""),
            config_snapshot=journey_data.get("config_snapshot", {}),
            status="published",
            published_at=published_at,
        )
        db.add(journey)
        db.flush()

        for concept_data in data.get("concepts", []):
            db.add(
                Concept(
                    journey_id=journey.id,
                    title=concept_data.get("title", ""),
                    description=concept_data.get("description", ""),
                    order=concept_data.get("order", 0),
                )
            )
        db.flush()
        concept_rows = (
            db.query(Concept).filter(Concept.journey_id == journey.id).order_by(Concept.order).all()
        )

        for activity_data in data.get("activities", []):
            concept_index = activity_data.get("concept_index")
            db.add(
                Activity(
                    journey_id=journey.id,
                    concept_id=(
                        concept_rows[concept_index].id
                        if isinstance(concept_index, int) and 0 <= concept_index < len(concept_rows)
                        else None
                    ),
                    type=activity_data.get("type", "scenario"),
                    difficulty=activity_data.get("difficulty", 1),
                    payload=activity_data.get("payload", {}),
                    order=activity_data.get("order", 0),
                    xp=activity_data.get("xp", 10),
                )
            )


DEMO_NUDGES = [
    {
        "type": "streak",
        "message": "🔥 3-day streak! Complete one activity today to keep it alive.",
        "status": "sent",
        "days_ago": 0,
    },
    {
        "type": "reinforcement",
        "message": "🔁 Time to refresh what you learned — your mastery fades without practice.",
        "status": "sent",
        "days_ago": 1,
    },
    {
        "type": "reminder",
        "message": "⏰ Your learning journey is waiting — pick up where you left off.",
        "status": "sent",
        "days_ago": 2,
    },
    {
        "type": "achievement",
        "message": "🏅 Badge unlocked: First Steps — you completed your first activity!",
        "status": "read",
        "days_ago": 4,
    },
]


def _seed_demo_nudges(db: Session) -> None:
    """Give the demo learner a populated Nudges inbox (only when empty)."""
    learner = db.query(User).filter_by(email=settings.DEMO_LEARNER_EMAIL.lower()).first()
    if not learner or db.query(Nudge).filter(Nudge.user_id == learner.id).first():
        return
    now = utcnow()
    journey = db.query(Journey).order_by(Journey.id).first()
    for item in DEMO_NUDGES:
        message = item["message"]
        if item["type"] == "reminder" and journey:
            message = f"⏰ '{journey.title}' is waiting — pick up where you left off."
        when = now - timedelta(days=item["days_ago"])
        db.add(
            Nudge(
                user_id=learner.id,
                type=item["type"],
                message=message,
                scheduled_at=when,
                sent_at=when,
                status=item["status"],
            )
        )


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        if not db.query(User).filter_by(role="admin").first():
            _ensure_user(
                db,
                settings.INITIAL_ADMIN_EMAIL,
                settings.INITIAL_ADMIN_PASSWORD,
                role="admin",
            )

        for key, value in DEFAULT_SETTINGS.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=value))

        if not db.query(Badge).first():
            for badge in DEFAULT_BADGES:
                db.add(Badge(**badge))

        # Demo learner for the panel (created only if missing)
        _ensure_user(db, settings.DEMO_LEARNER_EMAIL, settings.DEMO_LEARNER_PASSWORD, role="learner")

        _load_journey_fixtures(db)
        _seed_demo_nudges(db)

        db.commit()
    finally:
        db.close()
