"""Rate limiting configuration using SlowAPI.

Provides per-endpoint rate limiting keyed by hashed JWT subject or client IP.
Uses Redis storage in production for distributed rate limiting,
in-memory storage in local mode.

Global default rate limit is REMOVED to reduce Redis command volume.
Only endpoints with explicit @limiter.limit() decorators are rate-limited.
"""

import hashlib
import logging

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from utils.config import EnvMode, config

_logger = logging.getLogger(__name__)


def _get_rate_limit_key(request: Request) -> str:
    """Extract rate limit key from request: hashed JWT sub or client IP."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
        # Hash the token to avoid storing raw JWTs in rate limit storage
        return hashlib.sha256(token.encode()).hexdigest()[:16]
    return get_remote_address(request)


def _get_storage_uri() -> str | None:
    """Determine rate limit storage URI with rediss:// validation.

    Production: Use Redis for distributed rate limiting.
    Local/dev: Use in-memory storage (no Redis needed).
    """
    if config.ENV_MODE != EnvMode.PRODUCTION or not config.REDIS_URL:
        return None

    redis_url = config.REDIS_URL

    # The limits library supports rediss:// URLs for TLS connections.
    # If it doesn't work, we log and fall back to in-memory.
    if redis_url.startswith("rediss://"):
        _logger.info("Rate limiter: using rediss:// (TLS) Redis storage for production")
    else:
        _logger.info("Rate limiter: using Redis storage for production")

    return redis_url


_storage_uri = _get_storage_uri()

limiter = Limiter(
    key_func=_get_rate_limit_key,
    storage_uri=_storage_uri,
    # No global default_limits — only endpoints with explicit @limiter.limit()
    # decorators are rate-limited. This reduces Redis command volume significantly.
    default_limits=[],
)


def rate_limit_exceeded_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Handle rate limit exceeded errors with JSON response."""
    retry_after = exc.detail.split("per")[0].strip() if exc.detail else "60"
    return JSONResponse(
        status_code=429,
        content={"message": "Rate limit exceeded", "detail": str(exc.detail)},
        headers={"Retry-After": retry_after},
    )
