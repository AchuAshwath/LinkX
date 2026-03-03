"""Redis client for OAuth session and token storage."""

import redis

from app.core.config import settings


def get_redis() -> "redis.Redis":
    """Get a Redis client instance.

    Returns:
        Redis client connected to the configured Redis URL.

    Raises:
        redis.ConnectionError: If unable to connect to Redis.
    """
    return redis.from_url(  # type: ignore[no-any-return,no-untyped-call]
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        health_check_interval=30,
    )
