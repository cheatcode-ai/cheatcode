"""
Configuration management.

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

import os
from enum import Enum
from typing import Dict, Any, Optional, get_type_hints, Union
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)

class EnvMode(Enum):
    """Environment mode enumeration."""
    LOCAL = "local"
    PRODUCTION = "production"

class Configuration:
    """
    Centralized configuration for AgentPress backend.
    
    This class loads environment variables and provides type checking and validation.
    Default values can be specified for optional configuration items.
    """
    
    # Environment mode
    ENV_MODE: EnvMode = EnvMode.LOCAL
    

    
    # LLM API keys
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    MORPH_API_KEY: Optional[str] = None
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_API_BASE: Optional[str] = "https://openrouter.ai/api/v1"
    OR_SITE_URL: Optional[str] = "https://trycheatcode.com"
    OR_APP_NAME: Optional[str] = "Cheatcode AI"
    
    # Model configuration
    # Primary model: openrouter/anthropic/claude-sonnet-4 (Claude Sonnet 4 - state-of-the-art with 72.7% SWE-bench)
    # Using OpenRouter for Claude Sonnet 4 access
    MODEL_TO_USE: Optional[str] = "openrouter/anthropic/claude-sonnet-4"
    
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
    FIRECRAWL_URL: Optional[str] = "https://api.firecrawl.dev"
    
    # Freestyle deployment
    FREESTYLE_API_KEY: Optional[str] = None
    

    

    
    # Clerk configuration
    CLERK_SECRET_KEY: Optional[str] = None
    
    # Polar.sh configuration
    POLAR_ACCESS_TOKEN: Optional[str] = None
    POLAR_WEBHOOK_SECRET: Optional[str] = None
    POLAR_ORGANIZATION_ID: Optional[str] = None
    POLAR_PRODUCT_ID_PRO: Optional[str] = None
    POLAR_PRODUCT_ID_PREMIUM: Optional[str] = None
    POLAR_PRODUCT_ID_BYOK: Optional[str] = None
    

    
    # Sandbox configuration
    SANDBOX_SNAPSHOT_NAME = "cheatcode-one-snapshot"
    MOBILE_SANDBOX_SNAPSHOT_NAME = "cheatcode-mobile-snapshot"

    SANDBOX_ENTRYPOINT = "/usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf"  # Legacy - not used for snapshots

    # LangFuse configuration
    LANGFUSE_PUBLIC_KEY: Optional[str] = None
    LANGFUSE_SECRET_KEY: Optional[str] = None
    LANGFUSE_HOST: str = "https://cloud.langfuse.com"

    # Feature flag system control
    FEATURE_FLAGS_ENABLED: bool = False
    

    
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
            
            if env_val is not None and key != 'MODEL_TO_USE':
                # Convert environment variable to the expected type
                if expected_type == bool:
                    # Handle boolean conversion
                    setattr(self, key, env_val.lower() in ('true', 't', 'yes', 'y', '1'))
                elif expected_type == int:
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
            # Check if the field is Optional
            is_optional = hasattr(field_type, "__origin__") and field_type.__origin__ is Union and type(None) in field_type.__args__
            
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
    
    def as_dict(self) -> Dict[str, Any]:
        """Return configuration as a dictionary."""
        return {
            key: getattr(self, key) 
            for key in get_type_hints(self.__class__).keys()
            if not key.startswith('_')
        }

# Create a singleton instance
config = Configuration() 