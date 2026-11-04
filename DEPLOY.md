# Déploiement avec Docker et GitHub Codespaces

L'API tourne dans un conteneur Docker (port **7860**). GitHub Codespaces l'héberge et expose le port avec une URL publique `https://<nom-du-codespace>-7860.app.github.dev`.

> Un Codespace s'éteint après une période d'inactivité (30 min par défaut) et le quota gratuit mensuel est limité. L'URL reste la même, mais l'API est injoignable tant que le Codespace est arrêté. `.devcontainer/devcontainer.json` relance l'API automatiquement à son redémarrage. C'est adapté à une démo ou à un projet de cours, pas à une production permanente.

## Fichiers
| Fichier | Rôle |
|---|---|
| `app_api.py` | Point d'entrée de production (écoute `0.0.0.0:$PORT`, 7860 par défaut, 1 worker, en-têtes de proxy). |
| `Dockerfile`, `.dockerignore` | Image `python:3.11-slim`, utilisateur non-root, healthcheck, uniquement `app/`, `app_api.py` et le modèle. |
| `requirements.txt` | Dépendances **de production** uniquement, versions épinglées. |
| `requirements-dev.txt` | Production + notebooks + tests. |
| `.devcontainer/devcontainer.json` | Configuration du Codespace (Python 3.11, Docker, port 7860, démarrage automatique de l'API). |

`python:3.10-slim` du sujet n'est pas utilisable : scikit-learn 1.9.1, qui a entraîné le modèle, exige Python 3.11 ou plus. Garder la même version de scikit-learn en production évite les incompatibilités de pickle.

## 1. Pousser le code sur GitHub
Le dépôt local n'a encore aucun commit. Le `.gitignore` exclut `venv/`, `data/` et les modèles redondants. Seul `models/sentiment_pipeline.joblib` (1,1 Mo) est versionné.
```bash
git add .
git commit -m "API de sentiment, extension Chrome et déploiement Docker"
git branch -M main
git remote add origin https://github.com/<utilisateur>/<depot>.git
git push -u origin main
```

## 2. Créer le Codespace
Sur GitHub : **Code → Codespaces → Create codespace on main**. À la création, les dépendances sont installées et l'API démarre toute seule (log : `/tmp/api.log`).

## 3. Rendre le port public
Un port transféré est **privé** par défaut. L'extension Chrome ne peut pas s'authentifier auprès de GitHub, il doit donc être public :
- onglet **Ports** → clic droit sur 7860 → **Port Visibility → Public**, ou
- `gh codespace ports visibility 7860:public -c <nom-du-codespace>`

L'URL publique est affichée dans l'onglet Ports (colonne *Forwarded Address*). La visibilité redevient privée si le Codespace est recréé, alors vérifie-la.

## 4. Tester l'API
```bash
curl https://<nom-du-codespace>-7860.app.github.dev/health
curl -X POST https://<nom-du-codespace>-7860.app.github.dev/predict_batch \
     -H "Content-Type: application/json" -d '{"comments":["I love this video!","Terrible."]}'
```

## 5. Docker seul (local ou dans le Codespace)
```bash
docker build -t yt-sentiment-api .
docker run -p 7860:7860 yt-sentiment-api
```

## 6. Brancher l'extension Chrome
Dans le popup → ⚙️ → **URL de l'API** → coller `https://<nom-du-codespace>-7860.app.github.dev` → OK. Le point de statut passe au vert si l'API et le modèle sont joignables. Le domaine `*.app.github.dev` est déjà autorisé dans le manifest. Après avoir modifié le manifest, recharge l'extension dans `chrome://extensions`.

## Questions de réflexion

**Pourquoi séparer les requirements dev et prod ?**
L'image de production ne doit contenir que ce que l'API exécute. Pandas, matplotlib, ipykernel, nbconvert et pytest n'y servent à rien et coûteraient des centaines de Mo. Moins de paquets signifie aussi une image plus rapide à construire et à démarrer, et une surface d'attaque plus petite. Les versions épinglées garantissent que le conteneur exécute exactement ce qui a été testé, en particulier la même version de scikit-learn que celle qui a produit le modèle.

**Comment réduire la taille de l'image Docker ?**
Ce qui est déjà fait :
- base `slim`
- `--no-cache-dir`
- uniquement les dépendances de production
- `.dockerignore` en liste blanche, qui exclut données, venv, notebooks et modèles inutiles

L'image fait environ 584 Mo, dont 307 Mo de dépendances Python (numpy, scipy, scikit-learn). Pistes supplémentaires :
- build multi-étapes avec des wheels
- base `alpine` (déconseillée : les wheels scientifiques y sont compilées, ce qui est lent et fragile)
- remplacer scikit-learn à l'inférence par un export ONNX, qui évite scipy et réduit fortement l'image mais ajoute une étape de conversion

**Quelle stratégie pour les mises à jour du modèle ?**
- **Versionner :** nommer les artefacts (`sentiment_pipeline_v2.joblib`) et garder la version dans `/health`.
- **Pipeline CI :** réentraîner, évaluer sur le jeu de test, ne déployer que si les seuils (accuracy ≥ 80 %, F1 par classe > 0,75) sont tenus, puis reconstruire l'image et la taguer. Un `git revert` suffit pour revenir en arrière.
- **Chemin configurable :** `MODEL_PATH` permet de charger un autre modèle sans modifier le code.
- **Dépôt ou stockage externe :** pour un modèle de 1 Mo, le dépôt Git suffit. Au-delà, utiliser Git LFS ou un stockage d'artefacts téléchargé au démarrage.
- **Montée de version scikit-learn :** réentraîner et redéployer ensemble, car un pickle n'est pas garanti compatible entre versions.
