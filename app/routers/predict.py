import logging
import time

from fastapi import APIRouter, HTTPException

from app.config import LABELS
from app.schemas import PredictBatchRequest, PredictBatchResponse
from app.services.model import compute_statistics, model

logger = logging.getLogger("api.predict")
router = APIRouter(tags=["prediction"])


@router.post("/predict_batch", response_model=PredictBatchResponse)
def predict_batch(req: PredictBatchRequest):
    if not model.loaded:
        raise HTTPException(status_code=503, detail="Modèle non disponible")
    start = time.perf_counter()
    results = model.predict(req.comments)
    labels = [lab for lab, _ in results]
    predictions = [
        {"index": i, "comment": c, "sentiment": LABELS[lab], "label": lab, "confidence": round(conf, 4)}
        for i, (c, (lab, conf)) in enumerate(zip(req.comments, results))
    ]
    elapsed = (time.perf_counter() - start) * 1000
    logger.info("predict_batch: %d commentaires en %.1f ms", len(labels), elapsed)
    return {"predictions": predictions, "statistics": compute_statistics(labels),
            "processing_time_ms": round(elapsed, 2)}
