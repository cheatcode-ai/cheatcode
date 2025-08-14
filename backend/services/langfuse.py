import os
from langfuse import Langfuse
from typing import Optional
from utils.logger import logger
from utils.config import config

# Use config system instead of direct os.getenv for proper .env loading
public_key = config.LANGFUSE_PUBLIC_KEY
secret_key = config.LANGFUSE_SECRET_KEY  
host = config.LANGFUSE_HOST

enabled = public_key and secret_key

try:
    if enabled:
        # Create Langfuse client with credentials
        langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host
        )
        logger.info(f"Langfuse initialized successfully with credentials (enabled=True)")
    else:
        # Create a disabled instance by not providing credentials
        langfuse = Langfuse()
        logger.info(f"Langfuse initialized in disabled mode (enabled=False)")
except Exception as e:
    logger.warning(f"Failed to initialize Langfuse: {str(e)}. Creating disabled instance.")
    try:
        langfuse = Langfuse()
    except Exception as e2:
        logger.error(f"Failed to create disabled Langfuse instance: {str(e2)}. Using mock.")
        langfuse = None

def safe_trace(name: str, **kwargs):
    """Safely create a Langfuse trace with error handling."""
    try:
        if langfuse and enabled:
            return langfuse.trace(name=name, **kwargs)
        else:
            # Return a mock trace object when disabled
            return MockTrace()
    except Exception as e:
        logger.warning(f"Failed to create Langfuse trace '{name}': {str(e)}")
        return MockTrace()

class MockTrace:
    """Mock trace object that provides the same interface but does nothing."""
    
    def span(self, name: str, **kwargs):
        return MockSpan()
    
    def generation(self, name: str, **kwargs):
        return MockGeneration()
    
    def event(self, name: str, **kwargs):
        pass
    
    # Note: Real Langfuse traces don't have an end() method - they auto-complete

class MockSpan:
    """Mock span object that provides the same interface but does nothing."""
    
    def end(self, **kwargs):
        pass
    
    def event(self, name: str, **kwargs):
        pass

class MockGeneration:
    """Mock generation object that provides the same interface but does nothing."""
    
    def update(self, **kwargs):
        pass
    
    def end(self, **kwargs):
        pass
