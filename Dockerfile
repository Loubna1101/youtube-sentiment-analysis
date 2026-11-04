# python:3.11-slim (et non 3.10) : scikit-learn 1.9.1, utilisé pour entraîner le modèle, exige Python >= 3.11
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

WORKDIR /code

# 1) Dépendances d'abord : cette couche reste en cache tant que requirements.txt ne change pas
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2) Uniquement le nécessaire à l'exécution (voir .dockerignore)
COPY app_api.py .
COPY app ./app
COPY models/sentiment_pipeline.joblib ./models/sentiment_pipeline.joblib

# Utilisateur non-root
RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','7860'), timeout=4)"

CMD ["python", "app_api.py"]
