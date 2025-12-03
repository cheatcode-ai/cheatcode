"""
QR Code URL Extraction Utility for Expo Development Server
"""
import re
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Strip ANSI escape codes from terminal output
ANSI_ESCAPE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_ESCAPE.sub('', text)

def extract_expo_url(logs: str) -> Optional[str]:
    """
    Extract Expo development URL from terminal logs.

    Args:
        logs: Raw terminal output from expo start command

    Returns:
        The exp:// URL if found, None otherwise
    """
    if not logs:
        logger.debug("No logs provided to extract_expo_url")
        return None

    # Strip ANSI codes first - terminal output often has color codes
    clean_logs = strip_ansi(logs)

    logger.debug(f"Extracting Expo URL from {len(clean_logs)} chars of logs")

    # Patterns to match Expo URLs from terminal output (ordered by specificity)
    patterns = [
        # Expo's .exp.direct tunnel domain (most common with --tunnel flag)
        # Format: exp://xxxxx-anonymous-8082.exp.direct
        r'(exp://[a-zA-Z0-9-]+\.exp\.direct)',
        # Modern Expo with ngrok tunnel - "› Tunnel ready at exp://..."
        r'Tunnel ready(?:\s+at)?\s+(exp://[^\s\x00-\x1f]+)',
        # Metro bundler output - "Metro waiting on exp://..."
        r'Metro waiting on\s+(exp://[^\s\x00-\x1f]+)',
        # Expo Go URL format - typically ends with ngrok domain
        r'(exp://[a-zA-Z0-9\-]+\.ngrok[a-zA-Z0-9\-\.]*[^\s\x00-\x1f]*)',
        # Generic exp:// URL pattern (more permissive)
        r'(exp://[a-zA-Z0-9\-\.]+(?::[0-9]+)?(?:/[^\s\x00-\x1f]*)?)',
        # Fallback: any exp:// followed by non-whitespace
        r'(exp://[^\s\x00-\x1f]+)',
    ]

    for i, pattern in enumerate(patterns):
        try:
            match = re.search(pattern, clean_logs, re.IGNORECASE | re.MULTILINE)
            if match:
                url = match.group(1) if match.groups() else match.group(0)
                # Clean up the URL - remove trailing punctuation
                url = url.rstrip('.,;:!?\'\")')
                logger.info(f"Found Expo URL with pattern {i+1}: {url}")
                return url.strip()
        except Exception as e:
            logger.warning(f"Pattern {i+1} failed: {e}")
            continue

    # Log a sample of the logs for debugging if no URL found
    sample = clean_logs[:300] if len(clean_logs) > 300 else clean_logs
    logger.debug(f"No Expo URL found in logs. Sample: {sample}")
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