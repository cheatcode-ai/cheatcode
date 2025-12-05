"""
Retry utilities for handling transient failures.

This module provides a centralized, single source of truth for retry logic
across the application. Use these functions instead of implementing
custom retry logic in individual files.

Usage:
    from utils.retry import retry, retry_with_backoff

    # Simple retry with fixed delay
    result = await retry(my_async_function, max_attempts=3, delay_seconds=1)

    # Retry with exponential backoff
    result = await retry_with_backoff(
        my_async_function,
        max_attempts=5,
        base_delay=0.1,
        max_delay=60,
        jitter=True
    )
"""

import asyncio
import random
from typing import TypeVar, Callable, Awaitable, Optional, Type, Tuple, Union
from utils.logger import logger

T = TypeVar("T")


async def retry(
    fn: Callable[[], Awaitable[T]],
    max_attempts: int = 3,
    delay_seconds: float = 1,
) -> T:
    """
    Retry an async function with fixed delay between attempts.

    Args:
        fn: The async function to retry (takes no arguments)
        max_attempts: Maximum number of attempts (must be > 0)
        delay_seconds: Delay between attempts in seconds

    Returns:
        The result of the function call

    Raises:
        The last exception if all attempts fail
        ValueError: If max_attempts <= 0

    Example:
        async def fetch_data():
            return await api_call()

        try:
            result = await retry(fetch_data, max_attempts=3, delay_seconds=2)
            print(f"Success: {result}")
        except Exception as e:
            print(f"Failed after all retries: {e}")
    """
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")

    last_error: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except Exception as error:
            last_error = error

            if attempt == max_attempts:
                break

            await asyncio.sleep(delay_seconds)

    if last_error:
        raise last_error

    raise RuntimeError("Unexpected: last_error is None")


async def retry_with_backoff(
    fn: Callable[[], Awaitable[T]],
    max_attempts: int = 5,
    base_delay: float = 0.1,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    retryable_exceptions: Optional[Tuple[Type[Exception], ...]] = None,
    on_retry: Optional[Callable[[Exception, int, float], None]] = None,
) -> T:
    """
    Retry an async function with exponential backoff.

    This is the recommended retry function for most use cases as it
    implements best practices for handling transient failures:
    - Exponential backoff to avoid overwhelming services
    - Optional jitter to prevent thundering herd
    - Configurable max delay cap
    - Optional retry callback for logging/monitoring

    Args:
        fn: The async function to retry (takes no arguments)
        max_attempts: Maximum number of attempts (must be > 0)
        base_delay: Initial delay between attempts in seconds
        max_delay: Maximum delay between attempts (caps exponential growth)
        exponential_base: Base for exponential backoff (default 2.0)
        jitter: If True, add random jitter to delays
        retryable_exceptions: Tuple of exception types to retry on.
                             If None, retries on all exceptions.
        on_retry: Optional callback called on each retry with
                 (exception, attempt_number, delay) arguments

    Returns:
        The result of the function call

    Raises:
        The last exception if all attempts fail
        ValueError: If max_attempts <= 0

    Example:
        async def call_external_api():
            return await http_client.get("/endpoint")

        def log_retry(error, attempt, delay):
            logger.warning(f"Retry {attempt}: {error}, waiting {delay}s")

        result = await retry_with_backoff(
            call_external_api,
            max_attempts=5,
            base_delay=0.5,
            max_delay=30,
            jitter=True,
            on_retry=log_retry
        )
    """
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")

    last_error: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except Exception as error:
            # Check if this exception type should be retried
            if retryable_exceptions is not None:
                if not isinstance(error, retryable_exceptions):
                    raise

            last_error = error

            if attempt == max_attempts:
                break

            # Calculate delay with exponential backoff
            delay = min(base_delay * (exponential_base ** (attempt - 1)), max_delay)

            # Add jitter if enabled (random value between 0 and delay)
            if jitter:
                delay = delay * (0.5 + random.random())

            # Call retry callback if provided
            if on_retry:
                try:
                    on_retry(error, attempt, delay)
                except Exception:
                    pass  # Don't let callback errors break the retry loop

            await asyncio.sleep(delay)

    if last_error:
        raise last_error

    raise RuntimeError("Unexpected: last_error is None")


async def retry_operation(
    operation_name: str,
    fn: Callable[[], Awaitable[T]],
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    log_retries: bool = True,
) -> T:
    """
    Convenience wrapper that includes logging for retry attempts.

    This is a simpler interface for common retry scenarios where you
    want automatic logging without setting up callbacks.

    Args:
        operation_name: Human-readable name for the operation (for logging)
        fn: The async function to retry
        max_attempts: Maximum number of attempts
        base_delay: Initial delay between attempts
        max_delay: Maximum delay between attempts
        log_retries: If True, log each retry attempt

    Returns:
        The result of the function call

    Example:
        result = await retry_operation(
            "fetch user profile",
            lambda: api.get_user(user_id),
            max_attempts=3
        )
    """
    def on_retry(error: Exception, attempt: int, delay: float):
        if log_retries:
            logger.warning(
                f"Retrying '{operation_name}' (attempt {attempt}/{max_attempts}): "
                f"{type(error).__name__}: {error}. Waiting {delay:.2f}s"
            )

    try:
        return await retry_with_backoff(
            fn,
            max_attempts=max_attempts,
            base_delay=base_delay,
            max_delay=max_delay,
            jitter=True,
            on_retry=on_retry if log_retries else None,
        )
    except Exception as e:
        if log_retries:
            logger.error(
                f"Operation '{operation_name}' failed after {max_attempts} attempts: "
                f"{type(e).__name__}: {e}"
            )
        raise


# =============================================================================
# Synchronous retry utilities (for non-async contexts)
# =============================================================================

def retry_sync(
    fn: Callable[[], T],
    max_attempts: int = 3,
    delay_seconds: float = 1,
) -> T:
    """
    Retry a synchronous function with fixed delay between attempts.

    Args:
        fn: The function to retry (takes no arguments)
        max_attempts: Maximum number of attempts
        delay_seconds: Delay between attempts in seconds

    Returns:
        The result of the function call

    Raises:
        The last exception if all attempts fail
    """
    import time

    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")

    last_error: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as error:
            last_error = error

            if attempt == max_attempts:
                break

            time.sleep(delay_seconds)

    if last_error:
        raise last_error

    raise RuntimeError("Unexpected: last_error is None")
