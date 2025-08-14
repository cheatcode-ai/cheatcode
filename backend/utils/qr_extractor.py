"""
QR Code URL Extraction Utility for Expo Development Server
"""
import re
from typing import Optional
import logging

logger = logging.getLogger(__name__)

def extract_expo_url(logs: str) -> Optional[str]:
    """
    Extract Expo development URL from terminal logs.
    
    Args:
        logs: Raw terminal output from expo start command
        
    Returns:
        The exp:// URL if found, None otherwise
    """
    if not logs:
        return None
    
    # Patterns to match Expo URLs from terminal output
    patterns = [
        # Primary pattern: "Metro waiting on exp://..."
        r'Metro waiting on (exp://[^\s]+)',
        # Backup pattern: any exp:// URL
        r'(exp://[^\s]+)',
        # Alternative pattern for tunnel URLs
        r'Tunnel ready\.\s*.*?(exp://[^\s]+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, logs, re.IGNORECASE | re.MULTILINE)
        if match:
            url = match.group(1) if match.groups() else match.group(0)
            logger.info(f"Found Expo URL: {url}")
            return url.strip()
    
    logger.debug("No Expo URL found in logs")
    return None

def validate_expo_url(url: str) -> bool:
    """
    Validate that the extracted URL is a valid Expo development URL.
    
    Args:
        url: The URL to validate
        
    Returns:
        True if valid, False otherwise
    """
    if not url:
        return False
    
    # Basic validation for Expo development URLs
    expo_url_pattern = r'^exp://[a-zA-Z0-9\-\.]+\.(exp\.direct|ngrok\.io|localtunnel\.me)'
    return bool(re.match(expo_url_pattern, url))

def extract_and_validate_expo_url(logs: str) -> Optional[str]:
    """
    Extract and validate Expo URL from logs in one step.
    
    Args:
        logs: Raw terminal output from expo start command
        
    Returns:
        Valid exp:// URL if found and valid, None otherwise
    """
    url = extract_expo_url(logs)
    if url and validate_expo_url(url):
        return url
    return None