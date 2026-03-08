#!/usr/bin/env bash
# =============================================================================
# Cheatcode Setup Script
# Checks prerequisites and initializes environment files.
#
# Usage:
#   ./scripts/setup.sh          # Full setup (check prereqs + copy env files)
#   ./scripts/setup.sh --check  # Only check prerequisites
# =============================================================================

set -euo pipefail

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; }

# Find project root (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Prerequisite Checks ─────────────────────────────────────────────────────

check_prereqs() {
  local all_ok=true

  echo ""
  info "Checking prerequisites..."
  echo ""

  # Docker
  if command -v docker &>/dev/null; then
    local docker_version
    docker_version=$(docker --version | grep -oE '[0-9]+\.[0-9]+' | head -1)
    ok "Docker $docker_version"
  else
    fail "Docker not found. Install from https://docs.docker.com/get-docker/"
    all_ok=false
  fi

  # Docker Compose
  if docker compose version &>/dev/null 2>&1; then
    local compose_version
    compose_version=$(docker compose version --short 2>/dev/null || echo "unknown")
    ok "Docker Compose $compose_version"
  else
    fail "Docker Compose not found. Install Docker Desktop or the compose plugin."
    all_ok=false
  fi

  # Node.js
  if command -v node &>/dev/null; then
    local node_version
    node_version=$(node --version)
    ok "Node.js $node_version"
  else
    fail "Node.js not found. Install from https://nodejs.org/ (v20+ required)"
    all_ok=false
  fi

  # Python
  if command -v python3 &>/dev/null; then
    local python_version
    python_version=$(python3 --version | awk '{print $2}')
    ok "Python $python_version"
  else
    fail "Python 3 not found. Install from https://www.python.org/ (3.11+ required)"
    all_ok=false
  fi

  # uv
  if command -v uv &>/dev/null; then
    local uv_version
    uv_version=$(uv --version 2>/dev/null | awk '{print $2}' || echo "unknown")
    ok "uv $uv_version"
  else
    warn "uv not found. Install from https://github.com/astral-sh/uv (needed for local dev)"
  fi

  # Git
  if command -v git &>/dev/null; then
    local git_version
    git_version=$(git --version | awk '{print $3}')
    ok "Git $git_version"
  else
    fail "Git not found. Install from https://git-scm.com/"
    all_ok=false
  fi

  echo ""
  if [ "$all_ok" = true ]; then
    ok "All required prerequisites are installed."
  else
    fail "Some prerequisites are missing. Please install them and try again."
    return 1
  fi
}

# ── Environment File Setup ──────────────────────────────────────────────────

setup_env_files() {
  echo ""
  info "Setting up environment files..."
  echo ""

  # Backend
  if [ -f "$PROJECT_ROOT/backend/.env" ]; then
    warn "backend/.env already exists, skipping. Delete it and re-run to reset."
  elif [ -f "$PROJECT_ROOT/backend/.env.example" ]; then
    cp "$PROJECT_ROOT/backend/.env.example" "$PROJECT_ROOT/backend/.env"
    ok "Created backend/.env from .env.example"
  else
    fail "backend/.env.example not found!"
  fi

  # Frontend
  if [ -f "$PROJECT_ROOT/frontend/.env" ]; then
    warn "frontend/.env already exists, skipping. Delete it and re-run to reset."
  elif [ -f "$PROJECT_ROOT/frontend/.env.example" ]; then
    cp "$PROJECT_ROOT/frontend/.env.example" "$PROJECT_ROOT/frontend/.env"
    ok "Created frontend/.env from .env.example"
  else
    fail "frontend/.env.example not found!"
  fi

  echo ""
  info "Next steps:"
  echo ""
  echo "  1. Fill in your API keys in:"
  echo "     - backend/.env"
  echo "     - frontend/.env"
  echo ""
  echo "  2. Start the development environment:"
  echo "     docker compose -f docker-compose.dev.yml up --build"
  echo ""
  echo "  3. Open the app at http://localhost:3000"
  echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "========================================="
  echo "  Cheatcode Setup"
  echo "========================================="

  check_prereqs || exit 1

  if [ "${1:-}" = "--check" ]; then
    exit 0
  fi

  setup_env_files
}

main "$@"
