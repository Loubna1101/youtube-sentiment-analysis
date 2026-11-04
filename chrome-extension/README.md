# Extension Chrome : YouTube Sentiment Analyzer

## Installation
1. Démarrer l'API depuis la racine du projet : `venv\Scripts\python.exe -m uvicorn app.main:app`
2. Chrome → `chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → choisir ce dossier `chrome-extension/`.
3. Ouvrir une vidéo YouTube, descendre jusqu'aux commentaires, cliquer sur l'icône de l'extension.

L'URL de l'API se règle dans ⚙️ (par défaut `http://localhost:8000`). Pour une autre URL que localhost, ajouter son domaine dans `host_permissions` du `manifest.json`.

## Structure
| Fichier | Rôle |
|---|---|
| `manifest.json` | Manifest V3. Permissions : `activeTab`, `scripting` (injection si l'onglet était ouvert avant l'installation), `storage` (thème, réglages, cache). Hôtes : YouTube et l'API locale. |
| `content/content.js` | Extrait les commentaires du DOM, défile pour en charger, déplie les réponses. |
| `popup/` | Interface (HTML/CSS/JS) : stats, donut, filtres, tri, recherche, export, thème. |

## Fonctionnalités
- Extraction + analyse automatiques à l'ouverture du popup (commentaires déjà chargés), bouton **Charger plus** pour défiler.
- Statistiques globales : répartition en % (donut + barres), score moyen (-1 à +1), sentiment dominant, confiance moyenne.
- Liste avec sentiment et confiance, filtres positif/neutre/négatif, recherche, tri.
- Mode sombre/clair (mémorisé), copie dans le presse-papiers, export CSV et JSON (selon le filtre actif).
- États de chargement (spinner, barre de progression) et d'erreur (API éteinte, délai dépassé, modèle absent, mauvaise page, aucun commentaire).

La « confiance » est le score relatif de la classe prédite (softmax des marges du LinearSVC) : elle sert à comparer des commentaires entre eux, ce n'est pas une probabilité calibrée.

## Questions de réflexion

**Comment gérer les commentaires avec des réponses (threads) ?**
Dans le DOM, chaque `ytd-comment-thread-renderer` contient le commentaire principal et un `ytd-comment-replies-renderer` pour les réponses, qui ne sont chargées qu'au clic sur « N réponses ». L'extension extrait par défaut les commentaires de premier niveau et marque chaque élément `isReply`. L'option « Inclure les réponses » clique sur les boutons de dépliage (limités à 60 pour ne pas figer la page) avant l'extraction. Les réponses restent identifiées dans la liste et dans les exports, pour pouvoir les analyser séparément.

**Quelle stratégie pour extraire les commentaires dynamiques ?**
YouTube est une SPA et charge les commentaires paresseusement au défilement. Le content script reste injecté pendant les navigations et n'extrait qu'**à la demande** (message du popup) : il lit toujours le DOM courant, sans état périmé après un changement de vidéo. « Charger plus » défile par paliers jusqu'à l'objectif ou jusqu'à stagnation du nombre de fils (4 paliers sans nouveauté). Alternative à envisager : un `MutationObserver` sur `ytd-comments` pour analyser au fil de l'eau. Il n'a pas été retenu, car il consomme en arrière-plan même si l'utilisateur n'ouvre jamais le popup.

**Comment optimiser les performances avec de nombreux commentaires ?**
- Envoi à l'API par lots de 100, 3 requêtes en parallèle ; l'API traite 50 commentaires en quelques ms.
- Cache par vidéo (`storage.session`) : relancer l'analyse après « Charger plus » n'envoie que les commentaires nouveaux ; les doublons sont dédupliqués avant envoi.
- Liste paginée (50 éléments rendus, « Afficher plus ») au lieu d'injecter des milliers de nœuds ; recherche avec debounce de 200 ms.
- Défilement et dépliage plafonnés, délai de requête de 20 s.
- Pistes non implémentées : virtualisation complète de la liste, déplacement des appels réseau dans un service worker pour survivre à la fermeture du popup.

## Limites connues
- Les sélecteurs YouTube (`ytd-comments`, `ytd-comment-thread-renderer`, `#content-text`…) peuvent changer : c'est le point de maintenance principal. Ils sont regroupés en tête de `content.js`.
- Le modèle est entraîné sur des commentaires Reddit en anglais : la qualité est moindre sur d'autres langues.
- Le popup se ferme quand on clique ailleurs : une analyse en cours est alors interrompue (le cache conserve ce qui est déjà fait).
