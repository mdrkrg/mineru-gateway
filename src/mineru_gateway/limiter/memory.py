"""In-process token bucket rate limiter (single-instance, single-worker only)."""

from __future__ import annotations

import asyncio
import time


class MemoryTokenBucket:
    """Process-local token bucket. Only valid under single instance / worker."""

    def __init__(self, rate: int = 10, burst: int = 30, idle_ttl: float = 3600) -> None:
        self.rate = rate
        self.burst = burst
        self.idle_ttl = idle_ttl
        self._state: dict[str, tuple[float, float]] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, key: str) -> bool:
        async with self._lock:
            now = time.monotonic()
            tokens, last = self._state.get(key, (float(self.burst), now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens >= 1:
                self._state[key] = (tokens - 1, now)
                return True
            self._state[key] = (tokens, now)
            return False

    def prune(self) -> None:
        """Reclaim long-idle keys to bound _state growth."""
        now = time.monotonic()
        stale = [
            k for k, (_, last) in self._state.items() if now - last > self.idle_ttl
        ]
        for k in stale:
            del self._state[k]
