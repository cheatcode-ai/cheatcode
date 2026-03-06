from pathlib import PurePath

# Files to exclude from operations
EXCLUDED_FILES = {
    ".DS_Store",
    ".gitignore",
    "package-lock.json",
    "postcss.config.js",
    "postcss.config.mjs",
    "jsconfig.json",
    "components.json",
    "tsconfig.tsbuildinfo",
    "tsconfig.json",
}

# Directories to exclude from operations
EXCLUDED_DIRS = {"node_modules", ".next", "dist", "build", ".git"}

# File extensions to exclude from operations
EXCLUDED_EXT = {
    ".ico",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".tiff",
    ".webp",
    ".db",
    ".sql",
    ".csv",
    ".tsv",
    ".pdf",
    ".html",
    ".htm",
}


def should_exclude_file(rel_path: str) -> bool:
    """Check if a file should be excluded based on path, name, or extension.

    Args:
        rel_path: Relative path of the file to check

    Returns:
        True if the file should be excluded, False otherwise

    """
    # Check filename
    path = PurePath(rel_path)
    filename = path.name
    if filename in EXCLUDED_FILES:
        return True

    # Check directory
    dir_path = str(path.parent)
    if any(excluded in dir_path for excluded in EXCLUDED_DIRS):
        return True

    # Check extension
    ext = path.suffix
    return ext.lower() in EXCLUDED_EXT


def clean_path(path: str, workspace_path: str) -> str:
    """Clean and normalize a path to be relative to the workspace.

    Args:
        path: The path to clean
        workspace_path: The base workspace path to remove (REQUIRED - must be explicitly provided)

    Returns:
        The cleaned path, relative to the workspace

    Note:
        workspace_path is required to prevent silent bugs from incorrect workspace assumptions.
        For web projects: use "/workspace/cheatcode-app"
        For mobile projects: use "/workspace/cheatcode-mobile"

    """
    # Remove any leading slash
    path = path.lstrip("/")

    # Remove workspace prefix if present
    path = path.removeprefix(workspace_path.lstrip("/"))

    # Remove workspace/ prefix if present
    if path.startswith("workspace/"):
        path = path[9:]

    # Remove any remaining leading slash
    return path.lstrip("/")
