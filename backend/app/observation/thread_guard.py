"""Process-local ownership guard for live work on each chat thread."""

from __future__ import annotations

from threading import Lock
from uuid import UUID


class ThreadBusyError(RuntimeError):
    """Raised when a different live operation owns the thread."""


class ThreadGuard:
    def __init__(self) -> None:
        self._owners: dict[str, str] = {}
        self._lock = Lock()

    @staticmethod
    def _key(thread_id: UUID | str) -> str:
        return str(thread_id)

    def acquire(self, *, thread_id: UUID | str, token: str) -> bool:
        if not token:
            raise ValueError("token must not be empty")
        key = self._key(thread_id)
        with self._lock:
            owner = self._owners.get(key)
            if owner is not None:
                return owner == token
            self._owners[key] = token
            return True

    def release(self, *, thread_id: UUID | str, token: str) -> bool:
        key = self._key(thread_id)
        with self._lock:
            if self._owners.get(key) != token:
                return False
            del self._owners[key]
            return True

    def assert_available(
        self, *, thread_id: UUID | str, token: str | None = None
    ) -> None:
        key = self._key(thread_id)
        with self._lock:
            owner = self._owners.get(key)
            if owner is not None and owner != token:
                raise ThreadBusyError("another operation is active on this thread")


thread_guard = ThreadGuard()
