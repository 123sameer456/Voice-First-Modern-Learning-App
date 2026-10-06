import json
import re

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
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
- Create exactly {total_activities} activities. Each has: concept_index (0-based),
  type (lowercase, one of scenario|puzzle|simulation|mission), difficulty (1-5,
  within {difficulty_min}-{difficulty_max}), source_refs (up to 5 SHORT verbatim
  quotes from the source that justify the activity), confidence (0-1 that it is
  well-grounded), and a payload with exactly two keys: "data" (learner-visible)
  and "answer" (grading key).
- "answer" is REQUIRED on every activity: always a JSON object following the shapes
  below. Never omit it, never return a string, number or null.
- Copy source_refs VERBATIM from the source material (exact characters, exact words
  in the same order). Never paraphrase, merge sentences from different places, or
  invent quotes. If no verbatim quote justifies the activity, use an empty list.
- EXACT activity mix: {mix_instruction}. Never exceed, skip or substitute any type count.
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

REPAIR_PROMPT = """You are fixing AI-generated learning activities that a validator flagged.

SOURCE MATERIAL (the only allowed content source):
\"\"\"
{context}
\"\"\"

Flagged activities (JSON array; each entry has its original index, the issues found,
and the activity to fix):
{broken_json}

Fix every listed issue for each activity:
- "payload missing 'answer' key": add an "answer" OBJECT matching the shape for that
  activity type (scenario -> {{"correct_option_id": "...", "rationale": "..."}},
  puzzle -> {{"solutions": {{...}}}}, simulation -> {{"correct_option_ids": [...]}},
  mission -> {{"min_tasks": 2}}). The answer must be consistent with the activity's
  "data" and answerable from the source material.
- "source_ref not found in source text": replace each bad quote with a SHORT quote
  copied VERBATIM from the source material (exact characters, ignoring line breaks).
  Never paraphrase. Use an empty list if no verbatim quote justifies the activity.
- Keep everything else in each activity exactly as provided.

Return JSON: {{"activities": [{{"index": <original index>, "activity": <fixed activity>}}]}}"""


def _clamp_difficulty(value: int, lo: int, hi: int) -> int:
    return max(1, min(5, int(value)))


def _canonical(text: str) -> str:
    """Canonical form for verbatim-quote checks.

    Unifies formatting-only variations (curly quotes, ellipsis character,
    backticks, non-breaking spaces, dashes) so genuine quotes are not flagged
    over punctuation, while any change of wording still fails the match.
    """
    replacements = {
        "`": "",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
        "\u00a0": " ",
        "\u2013": "-",
        "\u2014": "-",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return _normalize(text)


def _canonical_ref(text: str) -> str:
    """Canonical form for a quoted ref: also drop wrapping quote characters
    (Gemini often wraps verbatim quotes in quotation marks)."""
    return _canonical(text).strip("\"' \t")


def _grounding_issues(
    plan: ActivityPlan, canonical_source: str, difficulty_range: list[int]
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
        if _canonical_ref(ref) not in canonical_source:
            issues.append("source_ref not found in source text")
            break
    return issues, ptype


def _repair_plans(
    plans: list[ActivityPlan], context: str, canonical_source: str, difficulty_range: list[int]
) -> list[ActivityPlan]:
    """One cheap Gemini pass to fix flagged activities before saving.

    Only runs when some activities have grounding issues. Uses the lite model
    to keep costs down; if the call or any individual fix fails, the original
    (flagged for review) activity is kept untouched.
    """
    broken = []
    for index, plan in enumerate(plans):
        issues, _ = _grounding_issues(plan, canonical_source, difficulty_range)
        if issues:
            broken.append({"index": index, "issues": issues, "activity": plan.model_dump()})
    if not broken:
        return plans

    try:
        raw = gemini.generate_json_raw(
            REPAIR_PROMPT.format(
                context=context,
                broken_json=json.dumps(broken, ensure_ascii=False, indent=2),
            ),
            model=settings.GEMINI_LITE_MODEL,
            temperature=0.2,
        )
    except gemini.GeminiError:
        return plans  # graceful degradation: keep flagged originals
    items = raw.get("activities") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return plans

    fixed = list(plans)
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index", -1))
        except (TypeError, ValueError):
            continue
        candidate_data = item.get("activity") if isinstance(item.get("activity"), dict) else item
        if not isinstance(candidate_data, dict) or not (0 <= index < len(fixed)):
            continue
        try:
            candidate = ActivityPlan.model_validate(candidate_data)
        except ValidationError:
            continue
        issues, _ = _grounding_issues(candidate, canonical_source, difficulty_range)
        if not issues:  # accept only fully-repaired activities
            fixed[index] = candidate
    return fixed


DEFAULT_ACTIVITY_MIX = {"scenario": 2, "puzzle": 2, "simulation": 1, "mission": 1}


def generate_journey(
    db: Session, source: ContentSource, activity_mix: dict | None = None
) -> Journey:
    """Generate a journey; `activity_mix` (type → count) lets the admin decide
    how many activities of each type the AI must produce."""
    mix_counts = dict(DEFAULT_ACTIVITY_MIX)
    for key in mix_counts:
        try:
            mix_counts[key] = max(0, min(6, int((activity_mix or {}).get(key, mix_counts[key]))))
        except (TypeError, ValueError):
            pass
    total_activities = sum(mix_counts.values())
    if total_activities < 4:
        raise GenerationError("Configure at least 4 activities in the generation mix.")
    if total_activities > 12:
        raise GenerationError("Configure at most 12 activities in the generation mix.")
    mix_instruction = ", ".join(f"{n} {t}" for t, n in mix_counts.items() if n > 0)

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
    canonical_source = _canonical(source.raw_text)

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
                total_activities=total_activities,
                mix_instruction=mix_instruction,
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
        activity_plans = _repair_plans(
            activity_plans, context, canonical_source, difficulty_range
        )
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

    xp_base = int(gamification_cfg.get("xp_per_activity_base", 10))
    saved = 0
    for order, plan in enumerate(plans.activities):
        issues, activity_type = _grounding_issues(plan, canonical_source, difficulty_range)
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
