import re


def clean(text: str) -> str:
    """Même nettoyage que celui appliqué à l'entraînement (src/notebook.ipynb)."""
    text = str(text).lower()
    text = re.sub(r"https?://\S+|www\.\S+", " ", text)   # URLs
    text = re.sub(r"@\w+|\bu/\w+|\br/\w+", " ", text)    # mentions, u/, r/
    text = re.sub(r"[^a-z\s']", " ", text)               # caractères spéciaux (garde l'apostrophe)
    return re.sub(r"\s+", " ", text).strip()
