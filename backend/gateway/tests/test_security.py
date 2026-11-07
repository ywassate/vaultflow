"""Tests des jetons d'accès et de la limitation des tentatives de connexion."""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from security import LoginRateLimiter, TokenService  # noqa: E402


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_jeton_valide_puis_revoque():
    service = TokenService("secret")
    token = service.create("alice@example.com")
    assert service.decode(token)["sub"] == "alice@example.com"
    assert service.revoke(token) is True
    assert service.decode(token) is None


def test_jeton_expire_refuse():
    service = TokenService("secret")
    token = service.create("alice@example.com", expires_delta=timedelta(seconds=-1))
    assert service.decode(token) is None


def test_jeton_signe_avec_un_autre_secret_refuse():
    token = TokenService("autre-secret").create("alice@example.com")
    assert TokenService("secret").decode(token) is None


def test_revoquer_un_jeton_invalide_echoue():
    assert TokenService("secret").revoke("pas-un-jeton") is False


def test_deux_jetons_ont_des_identifiants_differents():
    service = TokenService("secret")
    first, second = service.create("a@example.com"), service.create("a@example.com")
    service.revoke(first)
    assert service.decode(second) is not None


def test_blocage_apres_trop_d_echecs():
    limiter = LoginRateLimiter(max_failures=3, window_seconds=60, clock=FakeClock())
    for _ in range(2):
        limiter.record_failure("ip:1.2.3.4")
    assert limiter.is_blocked("ip:1.2.3.4") is False
    limiter.record_failure("ip:1.2.3.4")
    assert limiter.is_blocked("ip:1.2.3.4") is True
    assert limiter.is_blocked("ip:5.6.7.8") is False


def test_deblocage_apres_la_fenetre():
    clock = FakeClock()
    limiter = LoginRateLimiter(max_failures=2, window_seconds=60, clock=clock)
    limiter.record_failure("compte:a@example.com")
    limiter.record_failure("compte:a@example.com")
    assert limiter.is_blocked("compte:a@example.com") is True
    clock.now += 61
    assert limiter.is_blocked("compte:a@example.com") is False


def test_reussite_remet_le_compteur_a_zero():
    limiter = LoginRateLimiter(max_failures=2, window_seconds=60, clock=FakeClock())
    limiter.record_failure("compte:a@example.com")
    limiter.reset("compte:a@example.com")
    limiter.record_failure("compte:a@example.com")
    assert limiter.is_blocked("compte:a@example.com") is False
