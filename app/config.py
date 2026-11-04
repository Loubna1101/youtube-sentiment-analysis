import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT / "models" / "sentiment_pipeline.joblib"))

# Limites de validation
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", 500))
MAX_COMMENT_LENGTH = int(os.getenv("MAX_COMMENT_LENGTH", 5000))

# CORS : extensions Chrome + développement local.
# Origines supplémentaires possibles via CORS_ORIGINS="https://a.com,https://b.com"
CORS_ORIGIN_REGEX = r"^(chrome-extension://[a-p]{32}|https?://(localhost|127\.0\.0\.1)(:\d+)?)$"
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

# Labels du modèle -> noms de sentiment
LABELS = {-1: "negative", 0: "neutral", 1: "positive"}
