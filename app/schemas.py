from pydantic import BaseModel, Field, field_validator

from app.config import MAX_BATCH_SIZE, MAX_COMMENT_LENGTH


class PredictBatchRequest(BaseModel):
    comments: list[str] = Field(..., min_length=1, max_length=MAX_BATCH_SIZE,
                                description="Liste de commentaires à analyser")

    @field_validator("comments")
    @classmethod
    def check_comments(cls, comments: list[str]) -> list[str]:
        for i, c in enumerate(comments):
            if not c.strip():
                raise ValueError(f"Le commentaire à l'index {i} est vide")
            if len(c) > MAX_COMMENT_LENGTH:
                raise ValueError(f"Le commentaire à l'index {i} dépasse {MAX_COMMENT_LENGTH} caractères")
        return comments

    model_config = {"json_schema_extra": {"example": {"comments": ["I love this video!", "Terrible, waste of time."]}}}


class Prediction(BaseModel):
    index: int
    comment: str
    sentiment: str = Field(..., description="negative | neutral | positive")
    label: int = Field(..., description="-1, 0 ou 1")
    confidence: float = Field(..., ge=0, le=1, description="Score relatif de la classe prédite (0 à 1)")


class Statistics(BaseModel):
    total: int
    counts: dict[str, int]
    percentages: dict[str, float]
    dominant_sentiment: str
    average_score: float = Field(..., description="Moyenne des labels (-1 à 1)")


class PredictBatchResponse(BaseModel):
    predictions: list[Prediction]
    statistics: Statistics
    processing_time_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_type: str | None = None
    version: str
