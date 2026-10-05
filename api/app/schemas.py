from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    language_pref: str
    xp: int
    level: int
    streak_count: int
    last_active_at: datetime | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: str
    is_active: bool
    profile: ProfileOut | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


# --- Admin / learner API schemas ---

class ContentSourceOut(BaseModel):
    id: int
    type: str
    title: str
    status: str
    error: str | None = None
    created_at: datetime
    journey_count: int = 0


class JourneySummaryOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    created_at: datetime
    published_at: datetime | None = None
    concept_count: int
    activity_count: int
    needs_review_count: int
    source_title: str
    source_type: str


class ConceptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    order: int


class ActivityAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    concept_id: int | None = None
    type: str
    difficulty: int
    xp: int
    order: int
    payload: dict


class ActivityLearnerOut(BaseModel):
    id: int
    concept_id: int | None = None
    type: str
    difficulty: int
    xp: int
    order: int
    data: dict


class JourneyDetailOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    created_at: datetime
    published_at: datetime | None = None
    objectives: list[str] = []
    glossary: list[dict] = []
    concepts: list[ConceptOut] = []
    activities: list[ActivityAdminOut] = []


class JourneyLearnerOut(BaseModel):
    id: int
    title: str
    description: str
    objectives: list[str] = []
    glossary: list[dict] = []
    concepts: list[ConceptOut] = []
    activities: list[ActivityLearnerOut] = []


class AdminUserOut(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    created_at: datetime
    xp: int = 0
    level: int = 1


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: str = Field(default="learner", pattern="^(admin|learner)$")
    language_pref: str = Field(default="en", pattern="^(en|ur)$")


class AdminUserUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(admin|learner)$")
    is_active: bool | None = None


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=72)


class SettingOut(BaseModel):
    key: str
    value: dict
    updated_at: datetime


class SettingUpdate(BaseModel):
    value: dict


class StatsOut(BaseModel):
    users_total: int
    learners_total: int
    journeys_published: int
    journeys_draft: int
    interactions_total: int
    avg_mastery: float
