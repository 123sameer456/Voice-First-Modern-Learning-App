from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models import (
    Activity,
    Concept,
    Interaction,
    Journey,
    LearnerProfile,
    Mastery,
    Nudge,
    User,
    utcnow,
)
from app.routers.admin_content import _journey_summary
from app.schemas import (
    ConceptOut,
    DueReinforcementOut,
    JourneyLearnerOut,
    JourneySummaryOut,
    MasteryOut,
    MasteryRowOut,
    NextActivityOut,
    NudgeOut,
    ProfileStatsOut,
    ProgressOut,
    SubmitRequest,
    SubmitResponse,
)
from app.services import adaptive, gamification
from app.services.settings_store import get_group

router = APIRouter(prefix="/learner", tags=["learner"])


# ---------------------------------------------------------------------------
# Grading (see docs/activity-payloads.md for payload shapes)
# ---------------------------------------------------------------------------

def _norm(value: object) -> str:
    return str(value).strip().lower()


def _grade_scenario(answer: dict, answers: object) -> tuple[bool, int]:
    """Returns (passed, error_count)."""
    correct = _norm(answer.get("correct_option_id", ""))
    if isinstance(answers, dict):
        given = answers.get("option_id", answers.get("id"))
    else:
        given = answers
    passed = correct != "" and _norm(given) == correct
    return passed, 0 if passed else 1


def _grade_puzzle(answer: dict, answers: object) -> tuple[bool, int]:
    solutions = answer.get("solutions") or {}
    given = answers.get("solutions", answers) if isinstance(answers, dict) else answers
    if not isinstance(given, dict):
        return False, len(solutions)
    errors = sum(
        1
        for item_id, expected in solutions.items()
        if _norm(given.get(item_id)) != _norm(expected)
    )
    return errors == 0 and len(solutions) > 0, errors


def _grade_simulation(answer: dict, answers: object) -> tuple[bool, int]:
    correct_ids = [str(c) for c in answer.get("correct_option_ids") or []]
    if isinstance(answers, dict):
        given = answers.get("option_ids", answers.get("choices"))
    else:
        given = answers
    if not isinstance(given, list):
        return False, len(correct_ids)
    given_ids = [str(g) for g in given]
    errors = sum(
        1
        for i, correct in enumerate(correct_ids)
        if i >= len(given_ids) or _norm(given_ids[i]) != _norm(correct)
    )
    errors += max(0, len(given_ids) - len(correct_ids))
    return errors == 0 and len(correct_ids) > 0, errors


def _grade_mission(answer: dict, body: SubmitRequest) -> tuple[bool, int]:
    try:
        min_tasks = int(answer.get("min_tasks", 0))
    except (TypeError, ValueError):
        min_tasks = 0
    tasks = body.tasks_completed
    if tasks is None and isinstance(body.answers, dict):
        tasks = body.answers.get("tasks_completed")
    try:
        tasks = int(tasks or 0)
    except (TypeError, ValueError):
        tasks = 0
    return min_tasks > 0 and tasks >= min_tasks, 0


def _grade(activity: Activity, body: SubmitRequest) -> tuple[bool, int]:
    """Grade a submission. Returns (passed, error_count derived from grading)."""
    answer = activity.payload.get("answer") or {}
    if activity.type == "scenario":
        return _grade_scenario(answer, body.answers)
    if activity.type == "puzzle":
        return _grade_puzzle(answer, body.answers)
    if activity.type == "simulation":
        return _grade_simulation(answer, body.answers)
    if activity.type == "mission":
        return _grade_mission(answer, body)
    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown activity type '{activity.type}'")


# ---------------------------------------------------------------------------
# Existing journey endpoints
# ---------------------------------------------------------------------------

@router.get("/journeys", response_model=list[JourneySummaryOut])
def list_published_journeys(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[JourneySummaryOut]:
    journeys = (
        db.query(Journey)
        .filter(Journey.status == "published")
        .order_by(Journey.published_at.desc())
        .all()
    )
    return [_journey_summary(j) for j in journeys]


@router.get("/journeys/{journey_id}", response_model=JourneyLearnerOut)
def get_published_journey(
    journey_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JourneyLearnerOut:
    journey = db.get(Journey, journey_id)
    if not journey or journey.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    return JourneyLearnerOut(
        id=journey.id,
        title=journey.title,
        description=journey.description,
        objectives=journey.config_snapshot.get("objectives", []),
        glossary=journey.config_snapshot.get("glossary", []),
        concepts=[ConceptOut.model_validate(c) for c in journey.concepts],
        activities=[
            {
                "id": a.id,
                "concept_id": a.concept_id,
                "type": a.type,
                "difficulty": a.difficulty,
                "xp": a.xp,
                "order": a.order,
                "data": a.payload.get("data", {}),  # answers stripped server-side
            }
            for a in journey.activities
        ],
    )


# ---------------------------------------------------------------------------
# Activity submission (grading + adaptive + gamification)
# ---------------------------------------------------------------------------

@router.post("/activities/{activity_id}/submit", response_model=SubmitResponse)
def submit_activity(
    activity_id: int,
    body: SubmitRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmitResponse:
    activity = db.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    journey = db.get(Journey, activity.journey_id)
    if not journey or journey.status != "published":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not available")

    passed, error_count = _grade(activity, body)
    hints_used = body.hints_used
    # Server-side derivation: a pass with no errors and no hints counts as a
    # first-attempt success (the server is the source of truth for errors).
    first_attempt_success = passed and error_count == 0 and hints_used == 0

    gam_settings = get_group(db, "gamification")
    adaptive_settings = get_group(db, "adaptive")

    signals = {
        "passed": passed,
        "first_attempt_success": first_attempt_success,
        "error_count": error_count,
        "hints_used": hints_used,
        "self_corrections": body.self_corrections,
        "duration_s": body.duration_s,
        "confidence": body.confidence,
        "language": user.profile.language_pref if user.profile else "en",
        "difficulty": activity.difficulty,
    }

    xp_earned = gamification.compute_xp(
        activity,
        passed=passed,
        hints_used=hints_used,
        error_count=error_count,
        tasks_completed=body.tasks_completed,
    )

    db.add(
        Interaction(
            user_id=user.id,
            activity_id=activity.id,
            signals=signals,
            xp_earned=xp_earned,
        )
    )

    # Adaptive mastery update
    mastery_out: MasteryOut | None = None
    if activity.concept_id:
        mastery = adaptive.update_mastery(
            db,
            user.id,
            activity.concept_id,
            signals,
            hint_penalty=float(adaptive_settings.get("hint_penalty", 0.1)),
        )
        mastery_out = MasteryOut(
            concept_id=activity.concept_id,
            score=round(mastery.score, 1),
            confidence=round(mastery.confidence, 3),
            explanation=list(mastery.signal_breakdown.get("explanation", [])),
        )

    # Gamification: profile XP, level, streak, badges
    profile = db.query(LearnerProfile).filter(LearnerProfile.user_id == user.id).first()
    if profile is None:
        profile = LearnerProfile(user_id=user.id)
        db.add(profile)
        db.flush()

    if not gam_settings.get("streaks_enabled", True):
        profile.last_active_at = utcnow()
        return_gap_days = None
    else:
        return_gap_days, _ = gamification.update_streak(profile)

    profile.xp += xp_earned
    profile.level = gamification.level_for_xp(
        profile.xp, int(gam_settings.get("level_curve", 100))
    )

    new_badges = gamification.check_badges(
        db,
        user.id,
        profile,
        level_curve=int(gam_settings.get("level_curve", 100)),
        return_gap_days=return_gap_days,
    )

    db.commit()

    return SubmitResponse(
        passed=passed,
        xp_earned=xp_earned,
        new_badges=[
            {
                "id": b.id,
                "name": b.name,
                "icon": b.icon,
                "description": b.description,
            }
            for b in new_badges
        ],
        mastery=mastery_out,
    )


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

def _first_passed_interaction(db: Session, user_id: int, activity_id: int) -> Interaction | None:
    interactions = (
        db.query(Interaction)
        .filter(Interaction.user_id == user_id, Interaction.activity_id == activity_id)
        .all()
    )
    for interaction in interactions:
        if (interaction.signals or {}).get("passed"):
            return interaction
    return None


def _next_best_activity(db: Session, user_id: int, max_difficulty: int) -> NextActivityOut | None:
    """First not-yet-passed activity, walking published journeys oldest-first.

    Prefers activities within the difficulty cap from adaptive settings; falls
    back to the easiest not-passed activity if everything left is above the cap
    (so the learner always has a next step).
    """
    journeys = (
        db.query(Journey)
        .filter(Journey.status == "published")
        .order_by(Journey.published_at.asc().nullsfirst(), Journey.created_at.asc())
        .all()
    )
    for journey in journeys:
        not_passed = [
            a
            for a in journey.activities
            if _first_passed_interaction(db, user_id, a.id) is None
        ]
        in_range = [a for a in not_passed if a.difficulty <= max_difficulty]
        pick = in_range[0] if in_range else (not_passed[0] if not_passed else None)
        if pick:
            return NextActivityOut(
                id=pick.id,
                journey_id=pick.journey_id,
                concept_id=pick.concept_id,
                type=pick.type,
                difficulty=pick.difficulty,
                xp=pick.xp,
                order=pick.order,
            )
    return None
    return NextActivityOut(
        id=pick.id,
        journey_id=pick.journey_id,
        concept_id=pick.concept_id,
        type=pick.type,
        difficulty=pick.difficulty,
        xp=pick.xp,
        order=pick.order,
    )


def _last_practiced_at(db: Session, user_id: int, concept: Concept) -> datetime | None:
    last_practiced: datetime | None = None
    for activity in concept.activities:
        interactions = (
            db.query(Interaction)
            .filter(
                Interaction.user_id == user_id,
                Interaction.activity_id == activity.id,
            )
            .all()
        )
        for interaction in interactions:
            if last_practiced is None or interaction.created_at > last_practiced:
                last_practiced = interaction.created_at
    return last_practiced


def _due_reinforcement(
    db: Session, user_id: int, adaptive_settings: dict
) -> list[DueReinforcementOut]:
    pass_percent = float(adaptive_settings.get("mastery_pass_percent", 70))
    interval_days = float(adaptive_settings.get("reinforcement_interval_days", 3))
    now = utcnow()

    masteries = (
        db.query(Mastery, Concept)
        .join(Concept, Mastery.concept_id == Concept.id)
        .filter(Mastery.user_id == user_id, Mastery.score >= pass_percent)
        .all()
    )

    due: list[DueReinforcementOut] = []
    for mastery, concept in masteries:
        last_practiced = _last_practiced_at(db, user_id, concept)
        if last_practiced is None:
            continue
        days_since = (now - last_practiced).total_seconds() / 86400.0
        if days_since < interval_days:
            continue

        recommended = None
        if concept.activities:
            activity = concept.activities[0]
            recommended = NextActivityOut(
                id=activity.id,
                journey_id=activity.journey_id,
                concept_id=activity.concept_id,
                type=activity.type,
                difficulty=activity.difficulty,
                xp=activity.xp,
                order=activity.order,
            )
        decayed, _, _ = adaptive.decayed_score(mastery, now=now)
        due.append(
            DueReinforcementOut(
                concept_id=concept.id,
                concept_title=concept.title,
                mastery_score=round(decayed, 1),
                last_practiced_at=last_practiced,
                recommended_activity=recommended,
            )
        )
    return due


@router.get("/progress", response_model=ProgressOut)
def get_progress(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProgressOut:
    adaptive_settings = get_group(db, "adaptive")
    gam_settings = get_group(db, "gamification")
    max_difficulty = int(adaptive_settings.get("max_difficulty", 5))

    profile = db.query(LearnerProfile).filter(LearnerProfile.user_id == user.id).first()
    if profile is None:
        profile = LearnerProfile(user_id=user.id)
        db.add(profile)
        db.flush()

    mastery_rows: list[MasteryRowOut] = []
    for mastery, concept in (
        db.query(Mastery, Concept)
        .join(Concept, Mastery.concept_id == Concept.id)
        .filter(Mastery.user_id == user.id)
        .all()
    ):
        decayed, _, days = adaptive.decayed_score(mastery)
        mastery_rows.append(
            MasteryRowOut(
                concept_id=concept.id,
                concept_title=concept.title,
                journey_id=concept.journey_id,
                score=round(decayed, 1),
                stored_score=round(mastery.score, 1),
                confidence=round(mastery.confidence, 3),
                last_activity_at=mastery.updated_at,
                days_since_activity=days,
                signal_breakdown=mastery.signal_breakdown or {},
            )
        )

    _maybe_generate_nudges(db, user, adaptive_settings, gam_settings)
    db.commit()

    return ProgressOut(
        profile=ProfileStatsOut(
            xp=profile.xp,
            level=profile.level,
            streak_count=profile.streak_count,
            last_active_at=profile.last_active_at,
            language_pref=profile.language_pref,
        ),
        mastery=sorted(mastery_rows, key=lambda m: (m.journey_id, m.concept_id)),
        next_best_activity=_next_best_activity(db, user.id, max_difficulty),
        due_reinforcement=_due_reinforcement(db, user.id, adaptive_settings),
    )


# ---------------------------------------------------------------------------
# Nudges
# ---------------------------------------------------------------------------

def _within_quiet_hours(now_hour: int, quiet_hours: str) -> bool:
    """quiet_hours format '22:00-08:00' (may wrap midnight)."""
    try:
        start_s, end_s = quiet_hours.split("-")
        start = int(start_s.split(":")[0])
        end = int(end_s.split(":")[0])
    except (ValueError, AttributeError):
        return False
    if start == end:
        return False
    if start < end:
        return start <= now_hour < end
    return now_hour >= start or now_hour < end  # wraps midnight


def _maybe_generate_nudges(
    db: Session, user: User, adaptive_settings: dict, gam_settings: dict
) -> None:
    engagement = get_group(db, "engagement")
    if not engagement.get("nudges_enabled", True):
        return
    frequency_days = float(engagement.get("nudge_frequency_days", 2))
    quiet_hours = str(engagement.get("quiet_hours", ""))
    now = utcnow()

    candidates: list[tuple[str, str]] = []

    # Reinforcement nudges for due concepts
    for due in _due_reinforcement(db, user.id, adaptive_settings):
        candidates.append(
            (
                "reinforcement",
                f"Time to refresh '{due.concept_title}' — your mastery fades without practice.",
            )
        )

    # Re-engagement nudge after inactivity
    if user.profile and user.profile.last_active_at:
        days_inactive = (now - user.profile.last_active_at).total_seconds() / 86400.0
        if days_inactive >= frequency_days:
            candidates.append(
                (
                    "re_engagement",
                    "Your streak is waiting — jump back into your learning journey!",
                )
            )

    if not candidates:
        return

    recent = (
        db.query(Nudge)
        .filter(
            Nudge.user_id == user.id,
            Nudge.created_at >= now - timedelta(days=frequency_days),
        )
        .all()
    )
    recent_types = {n.type for n in recent}

    scheduled_at = now
    if _within_quiet_hours(now.hour, quiet_hours):
        # Schedule for the end of quiet hours instead of now
        try:
            end_hour = int(quiet_hours.split("-")[1].split(":")[0])
            scheduled = scheduled_at.replace(hour=end_hour, minute=0, second=0, microsecond=0)
            if scheduled <= scheduled_at:
                scheduled += timedelta(days=1)
            scheduled_at = scheduled
        except (ValueError, IndexError):
            pass

    for nudge_type, message in candidates:
        if nudge_type in recent_types:
            continue
        db.add(
            Nudge(
                user_id=user.id,
                type=nudge_type,
                message=message,
                scheduled_at=scheduled_at,
                sent_at=now,
                status="sent",
            )
        )
    db.flush()


@router.get("/nudges", response_model=list[NudgeOut])
def list_nudges(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[NudgeOut]:
    adaptive_settings = get_group(db, "adaptive")
    gam_settings = get_group(db, "gamification")
    _maybe_generate_nudges(db, user, adaptive_settings, gam_settings)
    db.commit()
    nudges = (
        db.query(Nudge)
        .filter(Nudge.user_id == user.id, Nudge.status != "read")
        .order_by(Nudge.scheduled_at.desc())
        .all()
    )
    return [
        NudgeOut(
            id=n.id,
            type=n.type,
            message=n.message,
            scheduled_at=n.scheduled_at,
            status=n.status,
        )
        for n in nudges
    ]


@router.post("/nudges/{nudge_id}/read", response_model=NudgeOut)
def mark_nudge_read(
    nudge_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NudgeOut:
    nudge = db.get(Nudge, nudge_id)
    if not nudge or nudge.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nudge not found")
    nudge.status = "read"
    db.commit()
    db.refresh(nudge)
    return NudgeOut(
        id=nudge.id,
        type=nudge.type,
        message=nudge.message,
        scheduled_at=nudge.scheduled_at,
        status=nudge.status,
    )
