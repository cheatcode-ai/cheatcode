"""Langfuse integration service using v2 SDK.

Provides v3-style method aliases (start_span, start_generation) on top of
the v2 API so callers can use either naming convention.
"""

from langfuse import Langfuse

from utils.config import config
from utils.logger import logger

# Configuration
public_key = config.LANGFUSE_PUBLIC_KEY
secret_key = config.LANGFUSE_SECRET_KEY
host = config.LANGFUSE_HOST

enabled = bool(public_key and secret_key)


class MockObservation:
    """Mock observation for when Langfuse is disabled."""

    def update(self, **_kwargs) -> "MockObservation":
        return self

    def end(self, **kwargs) -> None:
        pass

    def span(self, name: str = "", **_kwargs) -> "MockObservation":
        return MockObservation()

    def start_span(self, name: str = "", **_kwargs) -> "MockObservation":
        return MockObservation()

    def generation(self, name: str = "", **_kwargs) -> "MockObservation":
        return MockObservation()

    def start_generation(self, name: str = "", **_kwargs) -> "MockObservation":
        return MockObservation()

    def event(self, name: str = "", **kwargs) -> None:
        """Log an event (no-op for mock)."""


class TraceWrapper:
    """Wraps a v2 StatefulTraceClient to add v3-style aliases."""

    def __init__(self, trace):
        self._trace = trace

    def span(self, name: str = "", **kwargs):
        return self._trace.span(name=name, **kwargs)

    def start_span(self, name: str = "", **kwargs):
        """v3-style alias for span()."""
        return self._trace.span(name=name, **kwargs)

    def generation(self, name: str = "", **kwargs):
        return self._trace.generation(name=name, **kwargs)

    def start_generation(self, name: str = "", **kwargs):
        """v3-style alias for generation()."""
        return self._trace.generation(name=name, **kwargs)

    def update(self, **kwargs):
        return self._trace.update(**kwargs)

    def end(self, **kwargs):
        if hasattr(self._trace, "end"):
            return self._trace.end(**kwargs)

    def event(self, name: str = "", **kwargs):
        if hasattr(self._trace, "event"):
            return self._trace.event(name=name, **kwargs)

    def __getattr__(self, name):
        return getattr(self._trace, name)


# Initialize Langfuse client
langfuse: Langfuse | None = None

try:
    if enabled:
        langfuse = Langfuse(public_key=public_key, secret_key=secret_key, host=host)
        logger.info("Langfuse initialized successfully (enabled=True)")
    else:
        logger.info("Langfuse disabled (no credentials)")
except Exception as e:
    logger.warning(f"Failed to initialize Langfuse: {e!s}")
    langfuse = None


def log_event(trace, name: str, **kwargs) -> None:
    """Log an event to a trace as a short-lived span.

    Creates a span that is immediately ended.
    """
    if trace is None:
        return
    try:
        span = trace.span(name=name)
        update_kwargs = {}
        if "level" in kwargs:
            update_kwargs["level"] = kwargs["level"]
        if "status_message" in kwargs:
            update_kwargs["status_message"] = kwargs["status_message"]
        if "metadata" in kwargs:
            update_kwargs["metadata"] = kwargs["metadata"]
        if "input" in kwargs:
            update_kwargs["input"] = kwargs["input"]
        if "output" in kwargs:
            update_kwargs["output"] = kwargs["output"]
        if update_kwargs:
            span.update(**update_kwargs)
        span.end()
    except Exception as e:
        logger.debug(f"Failed to log event '{name}': {e!s}")


def safe_trace(name: str, **kwargs):
    """Create a Langfuse trace with error handling.

    Returns a TraceWrapper that supports both v2 and v3 method names:
    - .span() / .start_span() -> child span
    - .generation() / .start_generation() -> generation
    - .update(**kwargs) -> update observation
    - .end(**kwargs) -> end observation
    """
    try:
        if langfuse and enabled:
            trace_kwargs = {"name": name}

            if "session_id" in kwargs:
                trace_kwargs["session_id"] = kwargs["session_id"]
            if "user_id" in kwargs:
                trace_kwargs["user_id"] = kwargs["user_id"]
            if "metadata" in kwargs:
                trace_kwargs["metadata"] = kwargs["metadata"]
            if "input" in kwargs:
                trace_kwargs["input"] = kwargs["input"]
            if "tags" in kwargs:
                trace_kwargs["tags"] = kwargs["tags"]

            return TraceWrapper(langfuse.trace(**trace_kwargs))
        return MockObservation()
    except Exception as e:
        logger.warning(f"Failed to create Langfuse trace '{name}': {e!s}")
        return MockObservation()
