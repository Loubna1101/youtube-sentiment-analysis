import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.model import model

EXT = "chrome-extension://" + "a" * 32


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["model_loaded"] is True and r.json()["status"] == "ok"


def test_predict_batch(client):
    comments = ["I love this video, amazing!", "This is terrible and boring.", "The video is about cars."]
    r = client.post("/predict_batch", json={"comments": comments})
    assert r.status_code == 200
    body = r.json()
    assert [p["index"] for p in body["predictions"]] == [0, 1, 2]
    assert body["predictions"][0]["sentiment"] == "positive"
    assert body["predictions"][1]["sentiment"] == "negative"
    assert all(0 < p["confidence"] <= 1 for p in body["predictions"])
    s = body["statistics"]
    assert s["total"] == 3 and sum(s["counts"].values()) == 3


def test_text_empty_after_cleaning_is_neutral(client):
    r = client.post("/predict_batch", json={"comments": ["https://example.com", "great video"]})
    assert r.status_code == 200
    assert r.json()["predictions"][0]["sentiment"] == "neutral"
    assert r.json()["predictions"][0]["confidence"] == 0


@pytest.mark.parametrize("payload", [{}, {"comments": []}, {"comments": ["ok", "   "]}, {"comments": "texte"},
                                     {"comments": [1, 2]}, {"comments": ["x" * 6000]}, {"comments": ["a"] * 501}])
def test_validation_errors(client, payload):
    r = client.post("/predict_batch", json=payload)
    assert r.status_code == 422
    assert r.json()["detail"] == "Données invalides"


def test_invalid_json(client):
    r = client.post("/predict_batch", content="pas du json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_model_unavailable(client):
    pipeline, model.pipeline = model.pipeline, None
    try:
        assert client.get("/health").json()["status"] == "degraded"
        assert client.post("/predict_batch", json={"comments": ["hi"]}).status_code == 503
    finally:
        model.pipeline = pipeline


def test_cors_extension_allowed(client):
    r = client.options("/predict_batch", headers={"Origin": EXT, "Access-Control-Request-Method": "POST",
                                                  "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == EXT


def test_cors_other_origin_rejected(client):
    r = client.options("/predict_batch", headers={"Origin": "https://evil.com", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers


def test_batch_50_under_100ms(client):
    comments = ["I really enjoyed this video, great content"] * 50
    client.post("/predict_batch", json={"comments": comments})  # warm-up
    t0 = time.perf_counter()
    r = client.post("/predict_batch", json={"comments": comments})
    assert r.status_code == 200 and (time.perf_counter() - t0) * 1000 < 100
