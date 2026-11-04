"""Point d'entrée de production (Docker / GitHub Codespaces).

    python app_api.py                       # écoute sur 0.0.0.0:$PORT (7860 par défaut)
    uvicorn app_api:app --host 0.0.0.0      # équivalent
"""
import os

import uvicorn

from app.main import app  # noqa: F401  (exposé pour `uvicorn app_api:app`)

if __name__ == "__main__":
    uvicorn.run(
        "app_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 7860)),
        workers=1,                # modèle léger : un seul worker suffit, et il n'est chargé qu'une fois
        proxy_headers=True,       # derrière le proxy de Codespaces / HF : bonnes IP et schéma https
        forwarded_allow_ips="*",
        access_log=False,         # les logs applicatifs (api.predict) suffisent
        log_level="info",
    )
