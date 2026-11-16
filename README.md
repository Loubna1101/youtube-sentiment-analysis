# YouTube Sentiment Analysis

Analyse du sentiment des commentaires YouTube (négatif, neutre, positif) avec un modèle de machine learning, servi par une API FastAPI et consommé par une extension Chrome.

```
Données Reddit ──► Prétraitement ──► TF-IDF + LinearSVC ──► API FastAPI ──► Extension Chrome
   (notebook)        (notebook)        (notebook)           (Docker / Codespaces)   (popup)
```

## Résultats du modèle

Évaluation sur un jeu de test de 7 290 commentaires (20 %, split stratifié, `random_state=42`).

| Modèle | Accuracy | F1 macro |
|---|---|---|
| **LinearSVC (retenu)** | **0,875** | **0,866** |
| Logistic Regression | 0,863 | 0,853 |
| Random Forest | 0,789 | 0,765 |

| Classe | Précision | Rappel | F1 |
|---|---|---|---|
| négatif (-1) | 0,833 | 0,783 | 0,808 |
| neutre (0) | 0,852 | 0,970 | 0,908 |
| positif (1) | 0,921 | 0,848 | 0,883 |

Critères visés : accuracy ≥ 80 %, F1 par classe > 0,75, inférence < 100 ms pour 50 commentaires. Tous sont atteints (environ 3 à 6 ms mesurées pour 50 commentaires).

## Structure du projet

```
.
├── src/
│   ├── notebook.ipynb         # nettoyage, analyse exploratoire, rééquilibrage, split train/test
│   └── model_training.ipynb   # TF-IDF, comparaison des modèles, optimisation, sauvegarde
├── app/                       # API FastAPI (config, schémas, routeurs, service du modèle)
├── app_api.py                 # point d'entrée de production
├── models/
│   └── sentiment_pipeline.joblib   # pipeline TF-IDF + classifieur
├── chrome-extension/          # extension Chrome (Manifest V3), voir son README
├── tests/test_api.py          # tests de l'API
├── Dockerfile, .dockerignore
├── .devcontainer/             # configuration GitHub Codespaces
├── requirements.txt           # dépendances de production
├── requirements-dev.txt       # production + notebooks + tests
└── DEPLOY.md                  # déploiement et réponses aux questions de réflexion
```

## Données et méthode

- **Données :** `data/raw/reddit.csv` (colonnes `clean_comment` et `category`). Le dossier `data/` n'est pas versionné.
- **Prétraitement :** passage en minuscules, suppression des URLs, des mentions (`@`, `u/`, `r/`) et des caractères spéciaux (les apostrophes sont conservées pour garder les négations), puis suppression des doublons et des textes ayant des labels contradictoires. Il reste 36 450 commentaires.
- **Déséquilibre :** 43,1 % positifs, 34,3 % neutres, 22,6 % négatifs. Le jeu d'entraînement est suréchantillonné après le split, et le jeu de test garde la distribution réelle. Pour la validation croisée, les doublons du suréchantillonnage sont retirés et le déséquilibre est géré avec `class_weight="balanced"`.
- **Modèle :** `TfidfVectorizer` (`sublinear_tf`) et classifieur, avec hyperparamètres optimisés par `RandomizedSearchCV` (validation croisée à 3 plis, score F1 macro).

## Installation locale

Python 3.11 ou plus est requis (scikit-learn 1.9.1).

```bash
python -m venv venv
venv\Scripts\activate                 # Windows ; sous Linux/macOS : source venv/bin/activate
pip install -r requirements-dev.txt
```

Pour réentraîner le modèle, exécuter dans l'ordre `src/notebook.ipynb` puis `src/model_training.ipynb`. Les données sont écrites dans `data/processed/` et les modèles dans `models/`.

## Lancer l'API

```bash
python app_api.py
# ou : uvicorn app.main:app --reload
```

L'API écoute sur `http://localhost:7860` avec `app_api.py`, ou sur le port 8000 avec la commande `uvicorn` par défaut. La documentation interactive est sur `/docs`.

| Endpoint | Méthode | Description |
|---|---|---|
| `/health` | GET | État de l'API et du modèle |
| `/predict_batch` | POST | Analyse une liste de commentaires |

Exemple :
```bash
curl -X POST http://localhost:7860/predict_batch \
     -H "Content-Type: application/json" \
     -d '{"comments": ["I love this video!", "Terrible, waste of time."]}'
```
La réponse contient, pour chaque commentaire, le sentiment, le label (-1, 0, 1) et un score de confiance, ainsi que des statistiques globales (comptes, pourcentages, sentiment dominant, score moyen) et le temps de traitement. Un lot accepte de 1 à 500 commentaires de 5 000 caractères maximum.

La confiance est le score relatif de la classe prédite (softmax des marges du LinearSVC) : elle sert à comparer des commentaires entre eux, ce n'est pas une probabilité calibrée.

Tests :
```bash
python -m pytest tests
```

## Docker

```bash
docker build -t yt-sentiment-api .
docker run -p 7860:7860 yt-sentiment-api
```

## Déploiement (GitHub Codespaces)

L'API est hébergée dans un Codespace, avec le port 7860 en visibilité publique. Les étapes complètes, les limites de cette solution et les réponses aux questions de réflexion sont dans [DEPLOY.md](DEPLOY.md).

## Extension Chrome

1. Ouvrir `chrome://extensions`, activer le mode développeur.
2. **Charger l'extension non empaquetée** et choisir le dossier `chrome-extension/`.
3. Dans le popup, ⚙️ → **URL de l'API** : saisir l'adresse de l'API (`http://localhost:8000` par défaut, ou l'URL publique du Codespace).
4. Ouvrir une vidéo YouTube, descendre jusqu'aux commentaires et cliquer sur l'icône de l'extension.

Fonctionnalités : extraction automatique des commentaires visibles, statistiques et graphique de répartition, liste avec sentiment et confiance, filtres, recherche, mode sombre, copie et export CSV/JSON. Détails dans [chrome-extension/README.md](chrome-extension/README.md).

## Limites

- Le modèle est entraîné sur des commentaires Reddit en anglais : la qualité est moindre sur d'autres langues et sur le langage propre à YouTube.
- Les sélecteurs HTML de YouTube utilisés par l'extension peuvent changer et nécessiter une mise à jour.
- Un Codespace s'éteint après inactivité : l'API n'est alors plus joignable tant qu'il n'est pas redémarré.
- Le démarrage automatique de l'API dans le Codespace n'est pas encore fiable : il faut parfois la relancer avec `python app_api.py`.
