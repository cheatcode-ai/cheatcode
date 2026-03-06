"""Configuration management.

This module provides a centralized way to access configuration settings and
environment variables across the application. It supports different environment
modes (development, staging, production) and provides validation for required
values.

Usage:
    from utils.config import config

    # Access configuration values
    api_key = config.OPENAI_API_KEY
    env_mode = config.ENV_MODE
"""

import logging
import os
import types
from enum import Enum
from typing import Any, Union, get_type_hints

from dotenv import load_dotenv

logger = logging.getLogger(__name__)


class EnvMode(Enum):
    """Environment mode enumeration."""

    LOCAL = "local"
    PRODUCTION = "production"


class Configuration:
    """Centralized configuration for AgentPress backend.

    This class loads environment variables and provides type checking and validation.
    Default values can be specified for optional configuration items.
    """

    # Environment mode
    ENV_MODE: EnvMode = EnvMode.LOCAL

    # LLM API keys
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    RELACE_API_KEY: str | None = None
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_API_BASE: str | None = "https://openrouter.ai/api/v1"
    OR_SITE_URL: str | None = "https://trycheatcode.com"
    OR_APP_NAME: str | None = "Cheatcode AI"

    # Model configuration
    # Default model: claude-sonnet-4.5 (will be resolved by models registry)
    # Users can select from available models via the UI
    MODEL_TO_USE: str | None = "claude-sonnet-4.5"

    # Supabase configuration
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # Redis configuration
    REDIS_URL: str

    # Daytona sandbox configuration
    DAYTONA_API_KEY: str
    DAYTONA_SERVER_URL: str
    DAYTONA_TARGET: str

    # Search and other API keys
    TAVILY_API_KEY: str
    FIRECRAWL_API_KEY: str
    FIRECRAWL_URL: str | None = "https://api.firecrawl.dev"

    # Vercel deployment (fast, non-blocking deployments)
    VERCEL_BEARER_TOKEN: str | None = None
    VERCEL_TEAM_ID: str | None = None  # Optional, for team deployments

    # API base URL for webhooks (e.g., https://api.trycheatcode.com)
    API_BASE_URL: str | None = None

    # Clerk configuration
    CLERK_SECRET_KEY: str | None = None
    CLERK_JWT_KEY: str | None = None  # PEM key for networkless JWT verification

    # Admin API key for server-side operations
    ADMIN_API_KEY: str | None = None

    # Composio integration
    COMPOSIO_API_KEY: str | None = None

    # Preview proxy URL - removes Daytona warning page
    PREVIEW_PROXY_URL: str | None = "https://preview.trycheatcode.com"

    # Email service (Mailtrap)
    MAILTRAP_API_TOKEN: str | None = None

    # Google API (for various integrations)
    GOOGLE_API_KEY: str | None = None

    # Sentry configuration
    SENTRY_DSN: str | None = None

    # Encryption key for MCP credentials
    MCP_CREDENTIAL_ENCRYPTION_KEY: str | None = None

    # Polar.sh configuration
    POLAR_ACCESS_TOKEN: str | None = None
    POLAR_WEBHOOK_SECRET: str | None = None
    POLAR_ORGANIZATION_ID: str | None = None
    POLAR_PRODUCT_ID_PRO: str | None = None
    POLAR_PRODUCT_ID_PREMIUM: str | None = None
    POLAR_PRODUCT_ID_BYOK: str | None = None

    # Sandbox configuration
    SANDBOX_SNAPSHOT_NAME = "cheatcode-one-snapshot"
    MOBILE_SANDBOX_SNAPSHOT_NAME = "cheatcode-mobile-snapshot"

    # LangFuse configuration
    LANGFUSE_PUBLIC_KEY: str | None = None
    LANGFUSE_SECRET_KEY: str | None = None
    LANGFUSE_HOST: str = "https://cloud.langfuse.com"

    # Inngest configuration
    INNGEST_EVENT_KEY: str | None = None
    INNGEST_SIGNING_KEY: str | None = None
    INNGEST_DEV: str | None = None  # Set to "1" for local dev
    # Feature flag system control
    FEATURE_FLAGS_ENABLED: bool = False

    # HMAC secret for hashing user IDs sent to OpenRouter (abuse tracking)
    # If not set, user param is not sent to OpenRouter
    OPENROUTER_USER_HASH_SECRET: str | None = None

    # Agent run timeout (seconds) — hard limit to prevent runaway agents
    MAX_AGENT_RUN_DURATION: int = 1200  # 20 minutes

    def __init__(self):
        """Initialize configuration by loading from environment variables."""
        # Load environment variables from .env file if it exists
        load_dotenv()

        # Set environment mode first
        env_mode_str = os.getenv("ENV_MODE", EnvMode.LOCAL.value)
        try:
            self.ENV_MODE = EnvMode(env_mode_str.lower())
        except ValueError:
            logger.warning(f"Invalid ENV_MODE: {env_mode_str}, defaulting to LOCAL")
            self.ENV_MODE = EnvMode.LOCAL

        logger.info(f"Environment mode: {self.ENV_MODE.value}")

        # Load configuration from environment variables
        self._load_from_env()

        # Perform validation
        self._validate()

    def _load_from_env(self):
        """Load configuration values from environment variables."""
        for key, expected_type in get_type_hints(self.__class__).items():
            env_val = os.getenv(key)

            if env_val is not None and key != "MODEL_TO_USE":
                # Convert environment variable to the expected type
                if expected_type is bool:
                    # Handle boolean conversion
                    setattr(self, key, env_val.lower() in ("true", "t", "yes", "y", "1"))
                elif expected_type is int:
                    # Handle integer conversion
                    try:
                        setattr(self, key, int(env_val))
                    except ValueError:
                        logger.warning(f"Invalid value for {key}: {env_val}, using default")
                elif expected_type == EnvMode:
                    # Already handled for ENV_MODE
                    pass
                else:
                    # String or other type
                    setattr(self, key, env_val)

    def _validate(self):
        """Validate configuration based on type hints."""
        # Get all configuration fields and their type hints
        type_hints = get_type_hints(self.__class__)

        # Find missing required fields
        missing_fields = []
        for field, field_type in type_hints.items():
            # Check if the field is Optional (supports both typing.Union and PEP 604 str | None)
            is_optional = (
                hasattr(field_type, "__origin__")
                and field_type.__origin__ is Union
                and type(None) in field_type.__args__
            ) or (isinstance(field_type, types.UnionType) and type(None) in field_type.__args__)

            # If not optional and value is None, add to missing fields
            if not is_optional and getattr(self, field) is None:
                missing_fields.append(field)

        if missing_fields:
            error_msg = f"Missing required configuration fields: {', '.join(missing_fields)}"
            logger.error(error_msg)
            raise ValueError(error_msg)

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value with an optional default."""
        return getattr(self, key, default)

    def as_dict(self) -> dict[str, Any]:
        """Return configuration as a dictionary."""
        return {key: getattr(self, key) for key in get_type_hints(self.__class__) if not key.startswith("_")}


# Create a singleton instance
config = Configuration()
