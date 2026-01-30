from __future__ import annotations

import redis

from app.core.config import settings


def get_redis() -> redis.Redis:
    # decode_responses=True so we get str instead of bytes
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

