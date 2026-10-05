import re

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.models import Activity, Concept, ContentSource, Journey, Setting, utcnow
from app.services import gemini
from app.services.ingestion import _normalize

ACTIVITY_TYPES = ("scenario", "puzzle", "simulation", "mission")
MAX_CONTEXT_CHARS = 30_000
MIN_CONFIDENCE = 0.6


class GenerationError(Exception):
    """Raised when a journey cannot be generated from a content source."""


class GlossaryEntry(BaseModel):
    term: str
    definition: str


class ConceptPlan(BaseModel):
    title: str
    description: str
    key_points: list[str]


class OutlinePlan(BaseModel):
    title: str
    description: str
    objectives: list[str] = Field(min_length=2, max_length=6)
    glossary: list[GlossaryEntry] = Field(default_factory=list, max_length=10)
    concepts: list[ConceptPlan] = Field(min_length=3, max_length=6)


class ActivityPlan(BaseModel):
    concept_index: int
    type: str
    difficulty: int
    source_refs: list[str] = Field(default_factory=list, max_length=5)
    confidence: float
    payload: dict


class ActivityPlanList(BaseModel):
    activities: list[ActivityPlan] = Field(min_length=4, max_length=12)


OUTLINE_PROMPT = """You are an instructional designer building a gamified, voice-first learning journey.

SOURCE MATERIAL (ground every item in this; do not invent facts):
\"\"\"
{context}
\"\"\"

Audience level: {audience}. Tone: {tone}. {language_instruction}

Produce a learning journey outline:
- title, description (2-3 sentences)
- 2-6 learning objectives
- optional glossary of up to 10 terms from the source
- 3-6 core concepts, each with a short description and key_points (3-5 bullets)

Be concise and faithful to the source. If the source is thin, prefer fewer concepts."""


ACTIVITIES_PROMPT = """You are a learning-game designer. Design gamified activities for the concepts below.

SOURCE MATERIAL (activities must be answerable from this only):
\"\"\"
{context}
\"\"\"

Concepts:
{concepts_block}

Rules:
- Create 6-10 activities. Each has: concept_index (0-based), type (lowercase, one of
  scenario|puzzle|simulation|mission), difficulty (1-5, within {difficulty_min}-
  {difficulty_max}), source_refs (up to 5 SHORT verbatim quotes from the source that
  justify the activity), confidence (0-1 that it is well-grounded), and a payload with
  exactly two keys: "data" (learner-visible) and "answer" (grading key).
- MANDATORY mix: include at least 2 scenario, 2 puzzle, 1 simulation and 1 mission.
- {language_instruction}

Payload shapes per type — follow EXACTLY:

SCENARIO (decision-making with a best choice):
"data": {{"prompt": "<situation>", "options": [{{"id": "a", "text": "..."}}, {{"id": "b", "text": "..."}}, {{"id": "c", "text": "..."}}, {{"id": "d", "text": "..."}}]}}
"answer": {{"correct_option_id": "b", "rationale": "<why, referencing the source>"}}

PUZZLE (classification or ordering):
"data": {{"instruction": "<task>", "mode": "match"|"order", "buckets": ["<name>", ...] (match mode only), "items": [{{"id": "i1", "text": "..."}}, ...]}}
"answer": {{"solutions": {{"i1": "<bucket name>" for match | 1-based position for order, ...}}}}

SIMULATION (multi-step role play, 3 steps):
"data": {{"scenario": "<role + setting>", "steps": [{{"prompt": "<decision point>", "options": [{{"id": "a", "text": "..."}}, ...]}}, ...]}}
"answer": {{"correct_option_ids": ["<id>", "<id>", "<id>"]}}

MISSION (apply knowledge to a real task, self-reported completion):
"data": {{"briefing": "<mission>", "tasks": ["<checkable task>", ...], "success_criteria": "<how a mentor would judge success>"}}
"answer": {{"min_tasks": 2}}

All option ids must be lowercase letters ("a", "b", ...). Item ids are "i1", "i2", ..."""


def _clamp_difficulty(value: int, lo: int, hi: int) -> int:
    return max(1, min(5, int(value)))


def _grounding_issues(
    plan: ActivityPlan, normalized_source: str, difficulty_range: list[int]
) -> tuple[list[str], str]:
    ptype = plan.type.strip().lower()
    issues: list[str] = []
    if ptype not in ACTIVITY_TYPES:
        issues.append(f"unknown activity type '{plan.type}'")
    lo, hi = (difficulty_range + [1, 3])[:2] if len(difficulty_range) == 2 else (1, 3)
    if not lo <= plan.difficulty <= hi:
        issues.append(f"difficulty {plan.difficulty} outside configured range")
    if plan.confidence < MIN_CONFIDENCE:
        issues.append(f"low model confidence ({plan.confidence:.2f})")
    if not isinstance(plan.payload.get("data"), dict) or not plan.payload.get("data"):
        issues.append("payload missing learner-visible 'data'")
    if not isinstance(plan.payload.get("answer"), dict):
        issues.append("payload missing 'answer' key")
    for ref in plan.source_refs:
        if _normalize(ref) not in normalized_source:
            issues.append("source_ref not found in source text")
            break
    return issues, ptype


def generate_journey(db: Session, source: ContentSource) -> Journey:
    settings_map = {s.key: s.value for s in db.query(Setting).all()}
    content_cfg = settings_map.get("content", {})
    language = content_cfg.get("default_language", "en")
    audience = content_cfg.get("audience_level", "beginner")
    tone = content_cfg.get("tone", "friendly")
    difficulty_range = content_cfg.get("difficulty_range", [1, 3])
    gamification_cfg = settings_map.get("gamification", {})

    language_instruction = (
        "Write ALL learner-facing text in Urdu (Urdu script), keeping key technical "
        "terms in English where natural (code-switching)."
        if language == "ur"
        else "Write ALL learner-facing text in English."
    )

    context = source.raw_text[:MAX_CONTEXT_CHARS]
    if len(context.strip()) < 50:
        raise GenerationError("Source text is too short to generate a journey.")

    try:
        outline = gemini.generate_json(
            OutlinePlan,
            OUTLINE_PROMPT.format(
                context=context,
                audience=audience,
                tone=tone,
                language_instruction=language_instruction,
            ),
            temperature=0.5,
        )
        concepts_block = "\n".join(
            f"{i}. {c.title}: {c.description}" for i, c in enumerate(outline.concepts)
        )
        # Loose JSON mode (validated below): the Developer API rejects
        # response schemas containing untyped dict fields (additionalProperties).
        raw = gemini.generate_json_raw(
            ACTIVITIES_PROMPT.format(
                context=context,
                concepts_block=concepts_block,
                difficulty_min=difficulty_range[0] if difficulty_range else 1,
                difficulty_max=difficulty_range[1] if len(difficulty_range) > 1 else 3,
                language_instruction=language_instruction,
            ),
            temperature=0.7,
        )
        if isinstance(raw, list):
            raw = {"activities": raw}  # tolerate bare-array responses
        activity_plans: list[ActivityPlan] = []
        items = raw.get("activities") if isinstance(raw, dict) else None
        for item in (items if isinstance(items, list) else []):
            try:
                activity_plans.append(ActivityPlan.model_validate(item))
            except ValidationError:
                continue  # salvage the valid items, skip malformed ones
        if not activity_plans:
            raise gemini.GeminiError("No valid activities in Gemini response")
        plans = ActivityPlanList(activities=activity_plans)
    except gemini.GeminiError as exc:
        source.status = "failed"
        source.error = str(exc)[:1000]
        db.commit()
        raise GenerationError(str(exc)) from exc

    journey = Journey(
        content_source_id=source.id,
        title=outline.title[:255],
        description=outline.description,
        config_snapshot={
            "objectives": outline.objectives,
            "glossary": [g.model_dump() for g in outline.glossary],
            "content_settings": content_cfg,
        },
        status="draft",
    )
    db.add(journey)
    db.flush()

    concept_rows: list[Concept] = []
    for index, concept in enumerate(outline.concepts):
        row = Concept(
            journey_id=journey.id,
            title=concept.title[:255],
            description=concept.description,
            order=index,
        )
        db.add(row)
        concept_rows.append(row)
    db.flush()

    normalized_source = _normalize(source.raw_text)
    xp_base = int(gamification_cfg.get("xp_per_activity_base", 10))
    saved = 0
    for order, plan in enumerate(plans.activities):
        issues, activity_type = _grounding_issues(plan, normalized_source, difficulty_range)
        if activity_type not in ACTIVITY_TYPES:
            activity_type = "scenario"
        concept_id = (
            concept_rows[plan.concept_index].id
            if 0 <= plan.concept_index < len(concept_rows)
            else None
        )
        db.add(
            Activity(
                journey_id=journey.id,
                concept_id=concept_id,
                type=activity_type,
                difficulty=_clamp_difficulty(plan.difficulty, 1, 5),
                payload={
                    "data": plan.payload.get("data", {}),
                    "answer": plan.payload.get("answer", {}),
                    "meta": {
                        "needs_review": bool(issues),
                        "issues": issues,
                        "source_refs": plan.source_refs,
                        "model_confidence": plan.confidence,
                    },
                },
                order=order,
                xp=xp_base * _clamp_difficulty(plan.difficulty, 1, 5),
            )
        )
        saved += 1

    if saved == 0:
        db.rollback()
        source.status = "failed"
        source.error = "No activities were generated"
        db.commit()
        raise GenerationError("Gemini returned no usable activities.")

    source.status = "processed"
    source.error = None
    db.commit()
    db.refresh(journey)
    return journey
