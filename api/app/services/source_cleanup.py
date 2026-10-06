"""AI cleanup of raw extracted source text (web pages / documents).

Extraction pulls in page furniture — site headers, nav menus, footers, page
numbers, cookie banners — that reads badly in the study pane and confuses
text-to-speech. Gemini rewrites the raw text once per source into clean,
structured sections (heading + paragraphs); the result is cached in the
source_clean_texts table so the AI cost is paid exactly once. Every failure
path degrades gracefully to the raw text.
"""

from sqlalchemy.orm import Session

from app.models import ContentSource, SourceCleanText
from app.services import gemini

MAX_CLEANUP_CHARS = 50_000  # input cap (ingestion caps raw_text at 60k)
MAX_SECTIONS = 12

CLEANUP_PROMPT = """You are a content editor preparing raw extracted text so it can be shown to learners and read aloud by a text-to-speech voice.

RAW EXTRACTED TEXT (may contain website navigation, headers, footers, page numbers, cookie notices and other non-content junk):
\"\"\"
{context}
\"\"\"

Clean it up:
- Remove every non-content artifact: site headers/menus/footers, "skip to content" and cookie banners, subscribe/share prompts, related-article lists, author-byline clutter, page numbers, running heads, repeated boilerplate.
- Never invent facts or add content that is not in the source — only reorganize what is present and lightly rewrite for flow.
- Keep the original language of the material.
- Organize the actual material into 2-8 logical sections, each with a short descriptive heading and 1-6 plain paragraphs of flowing prose.
- Fix broken sentences and stray line wraps. No markdown, no bullet points, no URLs.

Return JSON only: {{"sections": [{{"heading": "...", "paragraphs": ["...", "..."]}}]}}"""


def cached_sections(db: Session, source: ContentSource | None) -> list[dict]:
    """Previously cleaned sections for a source ([] when none cached)."""
    if source is None:
        return []
    cached = db.get(SourceCleanText, source.id)
    if cached is None:
        return []
    data = cached.sections if isinstance(cached.sections, dict) else {}
    items = data.get("sections")
    return items if isinstance(items, list) else []


def get_clean_sections(db: Session, source: ContentSource | None) -> list[dict]:
    """AI-cleaned sections for a source — cached after the first call.

    Returns [] when the source has no usable text or the AI call fails;
    callers fall back to the raw text in that case.
    """
    if source is None:
        return []
    cached = cached_sections(db, source)
    if cached:
        return cached

    raw = (source.raw_text or "").strip()
    if len(raw) < 50:
        return []

    try:
        data = gemini.generate_json_raw(
            CLEANUP_PROMPT.format(context=raw[:MAX_CLEANUP_CHARS]),
            temperature=0.2,
        )
    except gemini.GeminiError:
        return []

    sections = _validated_sections(data)
    if not sections:
        return []
    db.add(SourceCleanText(source_id=source.id, sections={"sections": sections}))
    db.commit()
    return sections


def clean_plain_text(sections: list[dict]) -> str:
    """Flatten cleaned sections to plain text (for TTS chunks and AI prompts)."""
    blocks: list[str] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        heading = str(sec.get("heading", "")).strip()
        if heading:
            blocks.append(heading)
        paragraphs = sec.get("paragraphs")
        if isinstance(paragraphs, list):
            blocks.extend(str(p).strip() for p in paragraphs if str(p or "").strip())
    return "\n\n".join(blocks)


def _validated_sections(data: object) -> list[dict]:
    """Shape-check the model output; [] when unusable."""
    if not isinstance(data, dict):
        return []
    items = data.get("sections")
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        heading = str(item.get("heading", "")).strip()[:200]
        raw_paragraphs = item.get("paragraphs")
        paragraphs = [
            str(p).strip()[:4000]
            for p in (raw_paragraphs if isinstance(raw_paragraphs, list) else [])
            if str(p or "").strip()
        ]
        if not paragraphs:
            continue
        out.append({"heading": heading, "paragraphs": paragraphs})
        if len(out) >= MAX_SECTIONS:
            break
    total_chars = sum(len(p) for s in out for p in s["paragraphs"])
    return out if total_chars >= 50 else []
