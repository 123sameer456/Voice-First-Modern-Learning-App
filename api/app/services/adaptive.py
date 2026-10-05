"""Adaptive mastery engine.

Per-concept mastery on a 0-100 Elo-style scale. Each graded activity produces a
performance observation (0-100) from the learner signals; the stored score is
pulled toward that observation with a K-factor that shrinks as evidence
accumulates (diminishing confidence weight). Retention decay is applied on
read so stale concepts read lower until the learner practises them again.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Mastery, utcnow

# --- Tunables ---------------------------------------------------------------

BASE_K = 40.0          # Elo K-factor at full confidence
EVIDENCE_DECAY = 0.5   # K shrinks by this factor per prior interaction
HALF_LIFE_DAYS = 14.0  # retention decay half-life

WEIGHTS = {
    "passed_base": 70.0,          # observed floor when the activity is passed
    "failed_base": 25.0,          # observed floor when failed
    "first_attempt_bonus": 15.0,
    "error_penalty": 5.0,         # per error
    "hint_penalty": 8.0,          # per hint (also scaled by adaptive.hint_penalty)
    "self_correction_bonus": 3.0, # per self-correction, capped
    "self_correction_cap": 9.0,
    "confidence_span": 4.0,       # per point away from neutral (3) on the 1-5 scale
}


def observed_performance(signals: dict, *, hint_penalty_multiplier: float = 1.0) -> float:
    """Fold learner signals into a single 0-100 performance observation."""
    passed = bool(signals.get("passed"))
    value = WEIGHTS["passed_base"] if passed else WEIGHTS["failed_base"]
    if signals.get("first_attempt_success"):
        value += WEIGHTS["first_attempt_bonus"]
    value -= min(WEIGHTS["error_penalty"] * _as_int(signals.get("error_count")), 15.0)
    value -= min(
        WEIGHTS["hint_penalty"] * hint_penalty_multiplier * _as_int(signals.get("hints_used")),
        16.0,
    )
    value += min(
        WEIGHTS["self_correction_bonus"] * _as_int(signals.get("self_corrections")),
        WEIGHTS["self_correction_cap"],
    )
    value += WEIGHTS["confidence_span"] * (_as_int(signals.get("confidence")) - 3)
    return max(0.0, min(100.0, value))


def _as_int(value: object) -> int:
    try:
        return max(0, int(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _clamp_score(score: float) -> float:
    return max(0.0, min(100.0, score))


def retention_factor(days_since_last: float) -> float:
    """Exponential retention decay; 1.0 for the first day, halves every half-life."""
    if days_since_last <= 1.0:
        return 1.0
    return 0.5 ** ((days_since_last - 1.0) / HALF_LIFE_DAYS)


def decayed_score(mastery: Mastery, *, now: datetime | None = None) -> tuple[float, float, float]:
    """Return (decayed_score, decay_factor, days_since_last) for a Mastery row."""
    now = now or utcnow()
    days = max(0.0, (now - mastery.updated_at).total_seconds() / 86400.0)
    factor = retention_factor(days)
    return _clamp_score(mastery.score * factor), factor, round(days, 2)


def update_mastery(
    db: Session,
    user_id: int,
    concept_id: int,
    signals: dict,
    *,
    hint_penalty: float = 0.1,
) -> Mastery:
    """Create or update the learner's mastery row for one concept.

    Returns the persisted Mastery. The per-signal contributions are stored in
    `Mastery.signal_breakdown` so the UI can explain "why this level".
    """
    mastery = (
        db.query(Mastery)
        .filter(Mastery.user_id == user_id, Mastery.concept_id == concept_id)
        .first()
    )
    prior_interactions = int((mastery.signal_breakdown or {}).get("interactions", 0)) if mastery else 0

    observed = observed_performance(signals, hint_penalty_multiplier=hint_penalty)
    expected = mastery.score if mastery else 50.0

    # Diminishing confidence weight: early evidence moves the score a lot,
    # later evidence less so.
    k = BASE_K * (EVIDENCE_DECAY ** prior_interactions)
    delta = k * (observed - expected) / 100.0
    new_score = _clamp_score(expected + delta)

    explanation = _explain(signals, observed, delta, new_score)

    if mastery is None:
        mastery = Mastery(
            user_id=user_id,
            concept_id=concept_id,
            score=0.0,
            confidence=0.0,
            signal_breakdown={},
        )
        db.add(mastery)

    mastery.score = new_score
    mastery.confidence = 1.0 - (EVIDENCE_DECAY ** (prior_interactions + 1))
    mastery.signal_breakdown = {
        **(mastery.signal_breakdown or {}),
        "interactions": prior_interactions + 1,
        "last_observed": round(observed, 1),
        "last_elo_delta": round(delta, 2),
        "k_factor": round(k, 2),
        "contributions": {
            "passed": signals.get("passed", False),
            "first_attempt_success": signals.get("first_attempt_success", False),
            "error_count": _as_int(signals.get("error_count")),
            "hints_used": _as_int(signals.get("hints_used")),
            "self_corrections": _as_int(signals.get("self_corrections")),
            "confidence": _as_int(signals.get("confidence")),
        },
        "explanation": explanation,
    }
    mastery.updated_at = utcnow()
    db.flush()
    return mastery


def _explain(signals: dict, observed: float, delta: float, new_score: float) -> list[str]:
    """Human-readable per-signal lines for the "why this level" UI."""
    lines: list[str] = []
    if signals.get("passed"):
        lines.append(
            "Passed on the first attempt: strong signal" if signals.get("first_attempt_success")
            else "Passed: positive signal"
        )
    else:
        lines.append("Did not pass this time: score held back")

    errors = _as_int(signals.get("error_count"))
    if errors:
        lines.append(f"{errors} error(s) reduced the observation")
    hints = _as_int(signals.get("hints_used"))
    if hints:
        lines.append(f"{hints} hint(s) used reduced the observation")
    corrections = _as_int(signals.get("self_corrections"))
    if corrections:
        lines.append(f"{corrections} self-correction(s) added a small recovery bonus")

    confidence = _as_int(signals.get("confidence"))
    if confidence:
        if confidence >= 4:
            lines.append("High self-rated confidence boosted the observation")
        elif confidence <= 2:
            lines.append("Low self-rated confidence lowered the observation")

    direction = "up" if delta >= 0 else "down"
    lines.append(
        f"Mastery moved {direction} by {abs(delta):.1f} to {new_score:.0f}/100 "
        f"(observation {observed:.0f}/100)"
    )
    return lines
