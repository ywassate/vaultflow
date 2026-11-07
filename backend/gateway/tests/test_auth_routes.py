"""Tests des routes d'authentification, sans base de données réelle."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
for name, value in {
    "DATABASE_URL": "postgresql+psycopg://test:test@localhost:5432/test",
    "JWT_SECRET_KEY": "secret-de-test",
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test",
}.items():
    os.environ.setdefault(name, value)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from security import LoginRateLimiter, TokenService  # noqa: E402


class FakeUser:
    email = "alice@example.com"

    def check_password(self, password):
        return password == "bon-mot-de-passe"

    def to_dict(self):
        return {"email": self.email}


class FakeQuery:
    def __init__(self, user):
        self._user = user

    def filter(self, *_):
        return self

    def first(self):
        return self._user


class FakeSession:
    def query(self, _model):
        return FakeQuery(FakeUser())


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "login_limiter", LoginRateLimiter(max_failures=3, window_seconds=60))
    monkeypatch.setattr(main, "token_service", TokenService("secret-de-test"))
    main.app.dependency_overrides[main.get_db] = lambda: FakeSession()
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


def login(client, password):
    return client.post("/api/auth/login", json={"email": "alice@example.com", "password": password})


def test_connexion_reussie(client):
    response = login(client, "bon-mot-de-passe")
    assert response.status_code == 200
    assert response.json()["token"]


def test_blocage_apres_trois_echecs(client):
    for _ in range(3):
        assert login(client, "mauvais").status_code == 401
    assert login(client, "bon-mot-de-passe").status_code == 429


def test_jeton_refuse_apres_deconnexion(client):
    token = login(client, "bon-mot-de-passe").json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
