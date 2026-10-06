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
    source_id: int
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


class ActivityMixRequest(BaseModel):
    """Admin-configured activity mix for AI journey generation."""

    scenario: int = Field(default=2, ge=0, le=6)
    puzzle: int = Field(default=2, ge=0, le=6)
    simulation: int = Field(default=1, ge=0, le=6)
    mission: int = Field(default=1, ge=0, le=6)


class GenerationConfigRequest(BaseModel):
    activity_mix: ActivityMixRequest = Field(default_factory=ActivityMixRequest)


class SettingOut(BaseModel):
    key: str
    value: dict
    updated_at: datetime


class SettingUpdate(BaseModel):
    value: dict


class DayCountOut(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class JourneyKpiOut(BaseModel):
    journey_id: int
    title: str
    status: str
    activity_count: int
    needs_review_count: int
    learners: int
    avg_mastery: float  # 0 when no graded data yet


class StatsOut(BaseModel):
    users_total: int
    learners_total: int
    journeys_published: int
    journeys_draft: int
    interactions_total: int
    avg_mastery: float
    pass_rate: float = 0.0  # % of graded attempts that passed
    active_learners_7d: int = 0
    streak_learners: int = 0
    interactions_daily: list[DayCountOut] = []  # last 14 days
    journey_kpis: list[JourneyKpiOut] = []


# --- Phase 3: adaptive engine / gamification ---

class SubmitRequest(BaseModel):
    """Learner submission for one activity.

    `answers` shape depends on the activity type (see docs/activity-payloads.md):
    - scenario: {"option_id": "b"} (a bare string option id is also accepted)
    - puzzle:   {"solutions": {"i1": "Safe", "i2": 2}}  (bucket name or 1-based position)
    - simulation: {"option_ids": ["a", "b"]} (a bare list is also accepted)
    - mission:  {"tasks_completed": 2} (top-level `tasks_completed` also accepted)
    """

    answers: object = None
    duration_s: float | None = None
    hints_used: int = Field(default=0, ge=0)
    self_corrections: int = Field(default=0, ge=0)
    confidence: int = Field(default=3, ge=1, le=5)
    tasks_completed: int | None = Field(default=None, ge=0)


class BadgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    icon: str
    description: str


# --- Study mode: learn from source material, then voice Q&A tutoring ---

class SourceSectionOut(BaseModel):
    """One AI-cleaned section of the study material."""

    heading: str = ""
    paragraphs: list[str] = []


class JourneySourceOut(BaseModel):
    """The actual learning material behind a published journey.

    `sections` carries the AI-cleaned structure (junk removed, proper headings
    and paragraphs). Empty when AI cleanup is unavailable — clients then fall
    back to rendering `text` (the raw extracted text).
    """

    id: int
    type: str
    title: str
    text: str
    sections: list[SourceSectionOut] = []


class StudyQuestionsRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=5)
    language: str = Field(default="en", pattern="^(en|ur)$")
    # Questions already asked (recent sessions) so the AI avoids repeats.
    avoid: list[str] = Field(default_factory=list, max_length=50)


class StudyQuestionOut(BaseModel):
    index: int
    question: str


class StudyQuestionsResponse(BaseModel):
    questions: list[StudyQuestionOut]


class StudyEvaluateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="en", pattern="^(en|ur)$")


class StudyEvaluateResponse(BaseModel):
    correct: bool
    feedback: str


class StudyChatTurn(BaseModel):
    """One turn of the two-way voice tutoring conversation."""

    role: str = Field(pattern="^(user|tutor)$")
    text: str = Field(min_length=1, max_length=4000)


class StudyChatRequest(BaseModel):
    """Stateless chat: the client sends the recent conversation each turn."""

    messages: list[StudyChatTurn] = Field(default_factory=list, max_length=20)
    language: str = Field(default="en", pattern="^(en|ur)$")


class StudyChatResponse(BaseModel):
    reply: str


class MasteryOut(BaseModel):
    concept_id: int
    score: float
    confidence: float
    explanation: list[str] = []


class SubmitResponse(BaseModel):
    passed: bool
    xp_earned: int
    new_badges: list[BadgeOut] = []
    mastery: MasteryOut | None = None


class ProfileStatsOut(BaseModel):
    xp: int
    level: int
    streak_count: int
    last_active_at: datetime | None = None
    language_pref: str


class MasteryRowOut(BaseModel):
    concept_id: int
    concept_title: str
    journey_id: int
    score: float  # retention-decayed
    stored_score: float
    confidence: float
    last_activity_at: datetime | None = None
    days_since_activity: float | None = None
    signal_breakdown: dict = {}


class NextActivityOut(BaseModel):
    id: int
    journey_id: int
    concept_id: int | None = None
    type: str
    difficulty: int
    xp: int
    order: int


class DueReinforcementOut(BaseModel):
    concept_id: int
    concept_title: str
    mastery_score: float
    last_practiced_at: datetime | None = None
    recommended_activity: NextActivityOut | None = None


class BadgeProgressOut(BaseModel):
    code: str
    title: str
    icon: str = "award"
    description: str = ""
    earned: bool


class ProgressOut(BaseModel):
    profile: ProfileStatsOut
    mastery: list[MasteryRowOut] = []
    next_best_activity: NextActivityOut | None = None
    due_reinforcement: list[DueReinforcementOut] = []
    badges: list[BadgeProgressOut] = []
    completed_activity_ids: list[int] = []


class NudgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    message: str
    scheduled_at: datetime
    status: str


class VoiceConfigOut(BaseModel):
    enabled: bool
    stt_provider: str
    language: str
