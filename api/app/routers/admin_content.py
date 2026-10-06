from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_db, require_admin
from app.models import (
    Activity,
    AuditLog,
    Concept,
    ContentSource,
    Interaction,
    Journey,
    User,
    utcnow,
)
from app.schemas import (
    ActivityAdminOut,
    ConceptOut,
    ContentSourceOut,
    GenerationConfigRequest,
    JourneyDetailOut,
    JourneySummaryOut,
    SettingUpdate,
)
from app.services import journey_generator
from app.services.settings_store import PER_COURSE_GROUPS, SETTINGS_GROUPS, journey_overrides
from app.services.ingestion import (
    IngestionError,
    extract_text_from_upload,
    extract_text_from_url,
)

router = APIRouter(prefix="/admin", tags=["admin"])

SOURCE_TYPES = ("topic", "document", "url")


def _journey_counts(journey: Journey) -> dict:
    activities = journey.activities
    return {
        "concept_count": len(journey.concepts),
        "activity_count": len(activities),
        "needs_review_count": sum(
            1 for a in activities if a.payload.get("meta", {}).get("needs_review")
        ),
    }


def _journey_summary(journey: Journey) -> JourneySummaryOut:
    return JourneySummaryOut(
        id=journey.id,
        source_id=journey.content_source_id,
        title=journey.title,
        description=journey.description,
        status=journey.status,
        created_at=journey.created_at,
        published_at=journey.published_at,
        source_title=journey.content_source.title,
        source_type=journey.content_source.type,
        **_journey_counts(journey),
    )


def _journey_detail(journey: Journey) -> JourneyDetailOut:
    return JourneyDetailOut(
        id=journey.id,
        title=journey.title,
        description=journey.description,
        status=journey.status,
        created_at=journey.created_at,
        published_at=journey.published_at,
        objectives=journey.config_snapshot.get("objectives", []),
        glossary=journey.config_snapshot.get("glossary", []),
        concepts=[ConceptOut.model_validate(c) for c in journey.concepts],
        activities=[ActivityAdminOut.model_validate(a) for a in journey.activities],
    )


def _delete_journey_rows(db: Session, journey: Journey) -> None:
    activity_ids = db.scalars(
        select(Activity.id).where(Activity.journey_id == journey.id)
    ).all()
    if activity_ids:
        db.query(Interaction).filter(Interaction.activity_id.in_(activity_ids)).delete(
            synchronize_session=False
        )
    db.query(Activity).filter(Activity.journey_id == journey.id).delete(
        synchronize_session=False
    )
    db.query(Concept).filter(Concept.journey_id == journey.id).delete(
        synchronize_session=False
    )
    db.delete(journey)


@router.post("/content", response_model=ContentSourceOut, status_code=201)
async def create_content(
    type: str = Form(...),
    title: str = Form(""),
    text: str | None = Form(default=None),
    url: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ContentSourceOut:
    raw_text = ""
    try:
        if type == "topic":
            if not text or len(text.strip()) < 50:
                raise IngestionError("Topic text must be at least 50 characters.")
            raw_text = text.strip()
        elif type == "document":
            if not file:
                raise IngestionError("A file upload is required for document sources.")
            data = await file.read()
            if len(data) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
                raise IngestionError(
                    f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB} MB upload limit."
                )
            raw_text = extract_text_from_upload(file.filename or "", data)
            title = title or (file.filename or "document")
        elif type == "url":
            if not url:
                raise IngestionError("A URL is required for url sources.")
            extracted_title, raw_text = extract_text_from_url(url)
            title = title or extracted_title
        else:
            raise IngestionError("Type must be one of: topic, document, url.")
    except IngestionError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    source = ContentSource(
        type=type,
        title=(title or "Untitled").strip()[:255],
        raw_text=raw_text,
        status="processed",
        created_by=admin.id,
    )
    db.add(source)
    db.add(
        AuditLog(user_id=admin.id, action="content_created", detail={"type": type})
    )
    db.commit()
    db.refresh(source)
    return ContentSourceOut(
        id=source.id,
        type=source.type,
        title=source.title,
        status=source.status,
        error=source.error,
        created_at=source.created_at,
        journey_count=0,
    )


@router.get("/content", response_model=list[ContentSourceOut])
def list_content(
    admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[ContentSourceOut]:
    sources = db.query(ContentSource).order_by(ContentSource.created_at.desc()).all()
    return [
        ContentSourceOut(
            id=s.id,
            type=s.type,
            title=s.title,
            status=s.status,
            error=s.error,
            created_at=s.created_at,
            journey_count=len(s.journeys),
        )
        for s in sources
    ]


@router.post("/content/{source_id}/generate", response_model=JourneyDetailOut)
def generate_journey_for_source(
    source_id: int,
    config: GenerationConfigRequest | None = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> JourneyDetailOut:
    source = db.get(ContentSource, source_id)
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content source not found")
    if config:
        total = sum(config.activity_mix.model_dump().values())
        if total < 4 or total > 12:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "The generation mix must total between 4 and 12 activities.",
            )
    try:
        journey = journey_generator.generate_journey(
            db,
            source,
            activity_mix=config.activity_mix.model_dump() if config else None,
        )
    except journey_generator.GenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    db.add(
        AuditLog(
            user_id=admin.id,
            action="journey_generated",
            detail={"journey_id": journey.id, "source_id": source.id},
        )
    )
    db.commit()
    return _journey_detail(journey)


@router.get("/journeys", response_model=list[JourneySummaryOut])
def list_journeys(
    admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[JourneySummaryOut]:
    journeys = db.query(Journey).order_by(Journey.created_at.desc()).all()
    return [_journey_summary(j) for j in journeys]


@router.get("/journeys/{journey_id}", response_model=JourneyDetailOut)
def get_journey(
    journey_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> JourneyDetailOut:
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    return _journey_detail(journey)


@router.get("/journeys/{journey_id}/settings")
def get_journey_settings(
    journey_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Per-course settings overrides (empty groups use the global value)."""
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    return {"overrides": journey_overrides(journey), "per_course_groups": list(PER_COURSE_GROUPS)}


@router.put("/journeys/{journey_id}/settings/{group}")
def set_journey_settings(
    journey_id: int,
    group: str,
    body: SettingUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Save per-course overrides for one settings group.

    An empty value object resets the group to the global settings. Only the
    gamification and adaptive groups are consumed per-course at runtime.
    """
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    if group not in SETTINGS_GROUPS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown settings group '{group}'")
    if group not in PER_COURSE_GROUPS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Group '{group}' is global-only in this version",
        )
    if not isinstance(body.value, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "value must be an object")

    snapshot = dict(journey.config_snapshot or {})
    overrides = dict(snapshot.get("settings_overrides") or {})
    overrides[group] = body.value  # {} resets the group to global
    snapshot["settings_overrides"] = overrides
    journey.config_snapshot = snapshot
    db.add(
        AuditLog(
            user_id=admin.id,
            action="journey_settings_updated",
            detail={"journey_id": journey.id, "group": group, "keys": sorted(body.value.keys())},
        )
    )
    db.commit()
    return {"overrides": overrides}


@router.post("/journeys/{journey_id}/publish", response_model=JourneySummaryOut)
def publish_journey(
    journey_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> JourneySummaryOut:
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    journey.status = "published"
    journey.published_at = utcnow()
    db.add(
        AuditLog(user_id=admin.id, action="journey_published", detail={"journey_id": journey.id})
    )
    db.commit()
    db.refresh(journey)
    return _journey_summary(journey)


@router.post("/journeys/{journey_id}/unpublish", response_model=JourneySummaryOut)
def unpublish_journey(
    journey_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> JourneySummaryOut:
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    journey.status = "draft"
    journey.published_at = None
    db.add(
        AuditLog(user_id=admin.id, action="journey_unpublished", detail={"journey_id": journey.id})
    )
    db.commit()
    db.refresh(journey)
    return _journey_summary(journey)


@router.delete("/journeys/{journey_id}")
def delete_journey(
    journey_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    journey = db.get(Journey, journey_id)
    if not journey:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Journey not found")
    _delete_journey_rows(db, journey)
    db.add(
        AuditLog(user_id=admin.id, action="journey_deleted", detail={"journey_id": journey_id})
    )
    db.commit()
    return {"detail": "journey deleted"}


@router.delete("/content/{source_id}")
def delete_content(
    source_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    source = db.get(ContentSource, source_id)
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Content source not found")
    for journey in list(source.journeys):
        _delete_journey_rows(db, journey)
    db.delete(source)
    db.add(
        AuditLog(user_id=admin.id, action="content_deleted", detail={"source_id": source_id})
    )
    db.commit()
    return {"detail": "content source deleted"}
