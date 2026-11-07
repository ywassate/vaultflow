# backend/gateway/config.py
"""Lecture de la configuration : un secret absent arrête le démarrage."""
import os


def require_env(name: str) -> str:
    """Retourne la variable d'environnement `name`, ou lève une erreur explicite si elle manque."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Variable d'environnement {name} manquante : copier .env.example en .env et la renseigner."
        )
    return value
