"""
File utility functions for the backend.
"""
import mimetypes
from fastapi import UploadFile


def is_image_file(file: UploadFile) -> bool:
    """Check if the uploaded file is an image based on MIME type and filename."""
    # Check MIME type first (most reliable)
    if file.content_type and file.content_type.startswith('image/'):
        return True

    # Check file extension as fallback
    if file.filename:
        filename_lower = file.filename.lower()
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif']
        if any(filename_lower.endswith(ext) for ext in image_extensions):
            return True

        # Also check using mimetypes module
        mime_type, _ = mimetypes.guess_type(file.filename)
        if mime_type and mime_type.startswith('image/'):
            return True

    return False
