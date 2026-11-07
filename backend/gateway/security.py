# backend/gateway/security.py
"""Jetons d'accès et limitation des tentatives de connexion."""
import os
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Deque, Dict, Optional

from jose import JWTError, jwt

ALGORITHM = "HS256"


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value else default


ACCESS_TOKEN_EXPIRE_MINUTES = _int_env("ACCESS_TOKEN_EXPIRE_MINUTES", 60)
LOGIN_MAX_FAILURES = _int_env("LOGIN_MAX_FAILURES", 5)
LOGIN_WINDOW_SECONDS = _int_env("LOGIN_WINDOW_SECONDS", 15 * 60)


class TokenService:
    """Crée et vérifie les JWT ; garde la liste des jetons révoqués jusqu'à leur expiration."""

    def __init__(self, secret_key: str, expire_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES):
        self._secret_key = secret_key
        self._expire_minutes = expire_minutes
        self._revoked: Dict[str, float] = {}
        self._lock = threading.Lock()

    def create(self, subject: str, expires_delta: Optional[timedelta] = None) -> str:
        expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=self._expire_minutes))
        claims = {"sub": subject, "exp": expire, "jti": uuid.uuid4().hex}
        return jwt.encode(claims, self._secret_key, algorithm=ALGORITHM)

    def decode(self, token: str) -> Optional[dict]:
        """Retourne les claims d'un jeton valide et non révoqué, sinon None."""
        try:
            claims = jwt.decode(token, self._secret_key, algorithms=[ALGORITHM])
        except JWTError:
            return None
        jti = claims.get("jti")
        with self._lock:
            self._purge()
            if jti and jti in self._revoked:
                return None
        return claims

    def revoke(self, token: str) -> bool:
        """Révoque un jeton valide jusqu'à son expiration. Retourne False si le jeton est invalide."""
        claims = self.decode(token)
        if not claims or not claims.get("jti"):
            return False
        with self._lock:
            self._revoked[claims["jti"]] = float(claims["exp"])
        return True

    def _purge(self) -> None:
        now = time.time()
        for jti in [j for j, exp in self._revoked.items() if exp < now]:
            del self._revoked[jti]


class LoginRateLimiter:
    """Bloque une clé (adresse IP ou compte) après trop d'échecs dans une fenêtre glissante."""

    def __init__(self, max_failures: int = LOGIN_MAX_FAILURES, window_seconds: int = LOGIN_WINDOW_SECONDS, clock=time.monotonic):
        self._max_failures = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._recent(key)) >= self._max_failures

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._recent(key).append(self._clock())

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def _recent(self, key: str) -> Deque[float]:
        attempts = self._failures.setdefault(key, deque())
        limit = self._clock() - self._window
        while attempts and attempts[0] <= limit:
            attempts.popleft()
        return attempts
