"""Inngest client singleton for the Cheatcode backend.

Environment variables (read automatically by the SDK):
    INNGEST_EVENT_KEY: Required in production for sending events
    INNGEST_SIGNING_KEY: Required in production for webhook verification
    INNGEST_DEV: Set to "1" for local development (skips auth)
"""

import inngest
from inngest.experimental.sentry_middleware import SentryMiddleware

from utils.logger import logger

inngest_client = inngest.Inngest(
    app_id="cheatcode-backend",
    logger=logger,
    middleware=[SentryMiddleware],
)
