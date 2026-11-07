"""Tests de la lecture de configuration : un secret absent doit bloquer le démarrage."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import require_env  # noqa: E402


def test_retourne_la_valeur_presente(monkeypatch):
    monkeypatch.setenv("VAULTFLOW_TEST_VAR", "valeur")
    assert require_env("VAULTFLOW_TEST_VAR") == "valeur"


@pytest.mark.parametrize("valeur", [None, ""])
def test_leve_une_erreur_si_absente_ou_vide(monkeypatch, valeur):
    if valeur is None:
        monkeypatch.delenv("VAULTFLOW_TEST_VAR", raising=False)
    else:
        monkeypatch.setenv("VAULTFLOW_TEST_VAR", valeur)
    with pytest.raises(RuntimeError, match="VAULTFLOW_TEST_VAR"):
        require_env("VAULTFLOW_TEST_VAR")
