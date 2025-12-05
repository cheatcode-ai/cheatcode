"""
Langfuse integration service using v3 SDK.
Clean implementation without backwards compatibility wrappers.
"""
from langfuse import Langfuse
from typing import Optional, Any
from utils.logger import logger
from utils.config import config

# Configuration
public_key = config.LANGFUSE_PUBLIC_KEY
secret_key = config.LANGFUSE_SECRET_KEY
host = config.LANGFUSE_HOST

enabled = bool(public_key and secret_key)


class MockObservation:
    """Mock observation for when Langfuse is disabled."""

    def update(self, **kwargs) -> "MockObservation":
        return self

    def end(self, **kwargs) -> None:
        pass

    def start_span(self, name: str, **kwargs) -> "MockObservation":
        return MockObservation()

    def start_generation(self, name: str, **kwargs) -> "MockObservation":
        return MockObservation()

    def event(self, name: str, **kwargs) -> None:
        """Log an event (no-op for mock)."""
        pass


# Initialize Langfuse client
langfuse: Optional[Langfuse] = None

try:
    if enabled:
        langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host
        )
        logger.info("Langfuse v3 initialized successfully (enabled=True)")
    else:
        logger.info("Langfuse v3 disabled (no credentials)")
except Exception as e:
    logger.warning(f"Failed to initialize Langfuse: {str(e)}")
    langfuse = None


def log_event(trace, name: str, **kwargs) -> None:
    """
    Log an event to a trace as a short-lived span (v3 pattern).

    In Langfuse v3, events are represented as spans that are immediately ended.
    """
    if trace is None:
        return
    try:
        span = trace.start_span(name=name)
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
        logger.debug(f"Failed to log event '{name}': {str(e)}")


def safe_trace(name: str, **kwargs):
    """
    Create a Langfuse trace/span with error handling.

    Returns the root span observation object that supports:
    - .start_span(name, **kwargs) -> child span
    - .start_generation(name, model, **kwargs) -> generation
    - .update(**kwargs) -> update observation
    - .end(**kwargs) -> end observation
    """
    try:
        if langfuse and enabled:
            # Create root span
            span_kwargs = {"name": name}

            # Map common trace parameters
            if "session_id" in kwargs:
                span_kwargs["session_id"] = kwargs["session_id"]
            if "user_id" in kwargs:
                span_kwargs["user_id"] = kwargs["user_id"]
            if "metadata" in kwargs:
                span_kwargs["metadata"] = kwargs["metadata"]
            if "input" in kwargs:
                span_kwargs["input"] = kwargs["input"]
            if "tags" in kwargs:
                span_kwargs["tags"] = kwargs["tags"]

            return langfuse.start_span(**span_kwargs)
        else:
            return MockObservation()
    except Exception as e:
        logger.warning(f"Failed to create Langfuse trace '{name}': {str(e)}")
        return MockObservation()
