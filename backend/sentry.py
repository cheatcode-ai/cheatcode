import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

from utils.config import config

_SENSITIVE_HEADERS = {"authorization", "cookie", "x-api-key", "x-clerk-auth-token"}


def _before_send(event, hint):
    """Scrub sensitive data before sending to Sentry."""
    if "request" in event:
        req = event["request"]
        if "data" in req:
            req["data"] = "[Filtered]"
        if "headers" in req:
            req["headers"] = {
                k: "[Filtered]" if k.lower() in _SENSITIVE_HEADERS else v for k, v in req["headers"].items()
            }
        if "query_string" in req:
            req["query_string"] = "[Filtered]"
    return event


sentry_dsn = config.SENTRY_DSN
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        traces_sample_rate=0.1,
        send_default_pii=False,
        before_send=_before_send,
        integrations=[FastApiIntegration()],
        _experiments={
            "enable_logs": True,
        },
    )

sentry = sentry_sdk
