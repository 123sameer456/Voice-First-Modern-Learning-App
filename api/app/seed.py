from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app import models  # noqa: F401  (register all models with Base.metadata)
from app.models import Badge, LearnerProfile, Setting, User

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


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        if not db.query(User).filter_by(role="admin").first():
            admin = User(
                email=settings.INITIAL_ADMIN_EMAIL.lower(),
                password_hash=hash_password(settings.INITIAL_ADMIN_PASSWORD),
                role="admin",
            )
            db.add(admin)
            db.flush()
            db.add(LearnerProfile(user_id=admin.id))

        for key, value in DEFAULT_SETTINGS.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=value))

        if not db.query(Badge).first():
            for badge in DEFAULT_BADGES:
                db.add(Badge(**badge))

        db.commit()
    finally:
        db.close()
