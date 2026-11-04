from fastapi import APIRouter

from app import __version__
from app.schemas import HealthResponse
from app.services.model import model

router = APIRouter(tags=["monitoring"])


@router.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok" if model.loaded else "degraded",
        model_loaded=model.loaded,
        model_type=model.model_type,
        version=__version__,
    )
