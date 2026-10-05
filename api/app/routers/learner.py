from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models import Journey, User
from app.routers.admin_content import _journey_summary
from app.schemas import ConceptOut, JourneyLearnerOut, JourneySummaryOut

router = APIRouter(prefix="/learner", tags=["learner"])


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
