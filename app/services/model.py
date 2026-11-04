import logging
from collections import Counter

import joblib
import numpy as np

from app.config import LABELS, MODEL_PATH
from app.preprocessing import clean

logger = logging.getLogger("api.model")


class SentimentModel:
    def __init__(self) -> None:
        self.pipeline = None

    def load(self) -> None:
        try:
            self.pipeline = joblib.load(MODEL_PATH)
            logger.info("Modèle chargé depuis %s", MODEL_PATH)
        except Exception:
            self.pipeline = None
            logger.exception("Impossible de charger le modèle depuis %s", MODEL_PATH)

    @property
    def loaded(self) -> bool:
        return self.pipeline is not None

    @property
    def model_type(self) -> str | None:
        return type(self.pipeline.named_steps["clf"]).__name__ if self.loaded else None

    def _scores(self, texts: list[str]) -> np.ndarray:
        """Probabilités (predict_proba) ou, à défaut, softmax des marges (decision_function, ex. LinearSVC)."""
        clf = self.pipeline.named_steps["clf"]
        if hasattr(clf, "predict_proba"):
            return self.pipeline.predict_proba(texts)
        d = self.pipeline.decision_function(texts)
        e = np.exp(d - d.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)

    def predict(self, comments: list[str]) -> list[tuple[int, float]]:
        """Retourne (label, confiance) par commentaire."""
        cleaned = [clean(c) for c in comments]
        # Un commentaire sans texte exploitable après nettoyage (emojis, URL seule...) est classé neutre
        # avec une confiance nulle.
        to_predict = [t for t in cleaned if t]
        results = iter(())
        if to_predict:
            scores = self._scores(to_predict)
            classes = self.pipeline.classes_
            results = iter([(int(classes[i]), float(scores[k, i])) for k, i in enumerate(scores.argmax(axis=1))])
        return [next(results) if t else (0, 0.0) for t in cleaned]


def compute_statistics(labels: list[int]) -> dict:
    total = len(labels)
    c = Counter(labels)
    counts = {name: c.get(k, 0) for k, name in LABELS.items()}
    return {
        "total": total,
        "counts": counts,
        "percentages": {n: round(100 * v / total, 1) for n, v in counts.items()},
        "dominant_sentiment": max(counts, key=counts.get),
        "average_score": round(sum(labels) / total, 3),
    }


model = SentimentModel()
