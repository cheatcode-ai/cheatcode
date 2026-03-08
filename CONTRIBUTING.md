# Contributing to Cheatcode

Thank you for your interest in contributing to Cheatcode! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Security Vulnerabilities](#security-vulnerabilities)

## Code of Conduct

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold it. Please report unacceptable behavior to [founders@trycheatcode.com](mailto:founders@trycheatcode.com).

## How Can I Contribute?

### Good First Issues

If you're new to the project, look for issues labeled `good first issue`. These are scoped, well-defined tasks that don't require deep knowledge of the codebase.

### Areas Where We Need Help

- **Bug fixes** -- Reproduce, investigate, and fix reported bugs
- **New agent tools** -- Extend the agent's capabilities (see `backend/agent/tools/`)
- **Test coverage** -- Add unit and integration tests (backend uses `pytest`)
- **Documentation** -- Improve README, inline docs, or add guides
- **Performance** -- Optimize streaming, database queries, or tool execution
- **New integrations** -- Add LLM providers, deployment targets, or third-party services
- **Frontend improvements** -- UI/UX enhancements, accessibility, responsive design

## Development Setup

### Prerequisites

- Docker 24.0+ with Docker Compose 2.0+
- Node.js 20+
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- Git

### Step 1: Fork and Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/cheatcode.git
cd cheatcode
git remote add upstream https://github.com/cheatcode-ai/cheatcode.git
```

### Step 2: Set Up Environment Files

```bash
# Copy environment templates
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit both files with your API keys (see README.md for required accounts)
```

> You can also run `./scripts/setup.sh` to check prerequisites and copy env files automatically.

### Step 3: Backend Setup

```bash
cd backend

# Install Python dependencies
uv sync

# Start the API server
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Step 4: Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

### Step 5: Verify

- Backend health: http://localhost:8000/api/health
- Frontend: http://localhost:3000

### Alternative: Docker Compose

If you prefer Docker for the full stack:

```bash
docker compose -f docker-compose.dev.yml up
```

This gives you hot-reload on both backend and frontend.

## Project Structure

Understanding where things live will help you contribute effectively:

```
backend/
├── agent/              # Agent runtime -- start here for agent changes
│   ├── run.py          # Main agent loop
│   ├── api.py          # Agent REST endpoints
│   └── tools/          # Individual tool implementations
├── agentpress/         # Framework layer (thread mgmt, tool registry, response parsing)
├── services/           # External service integrations (LLM, Redis, DB, billing, etc.)
├── utils/              # Shared utilities (config, auth, logging)
└── tests/              # pytest tests

frontend/
├── src/app/            # Next.js App Router pages
├── src/components/     # React components (thread UI, sidebar, billing, etc.)
├── src/hooks/          # Custom hooks (streaming, state machine, queries)
├── src/lib/api/        # API client functions
└── src/contexts/       # React contexts
```

### Key Conventions

- **Redis:** Import from `services.redis`, not `utils.redis`. Access via `await redis_service.get_client()`.
- **Auth:** Use `get_current_user_id_from_jwt()` for REST, `get_user_id_from_stream_auth()` for SSE.
- **Package managers:** `uv` for backend, `npm` for frontend.
- **Feature flags:** `useFeatureFlag()` returns `{ data: boolean }`, not a bare boolean.
- **Deployment API:** Lives at `deployments/api.py`, not `api/deployments.py`.

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feat/my-feature    # for features
git checkout -b fix/bug-name       # for bug fixes
git checkout -b docs/update-readme # for documentation
```

### 2. Write Your Code

- Keep changes focused -- one feature or fix per PR
- Follow the existing code patterns and conventions
- Add or update tests for your changes
- Don't modify unrelated code (no drive-by refactors)

### 3. Test Your Changes

```bash
# Backend
cd backend
uv run pytest                          # Run all tests
uv run ruff check .                    # Lint
uv run ruff format . --check           # Format check

# Frontend
cd frontend
npx eslint src/ --max-warnings=0       # Lint
npx prettier --check "src/**/*.{ts,tsx,css,json}"   # Format check
npx knip                               # Unused code detection

# Or run everything at once from the repo root:
make check
```

### 4. Commit

Write clear commit messages:

```
feat: add semantic search to grep tool

Add embedding-based search alongside full-text grep.
Uses OpenAI embeddings with cosine similarity scoring.
```

**Commit prefixes:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `style:`

## Pull Request Process

### Before Opening a PR

- [ ] Your branch is up to date with `main`: `git pull upstream main`
- [ ] All tests pass locally
- [ ] Linting passes (`make check`)
- [ ] You've tested your changes manually
- [ ] You've added tests for new functionality

### Writing the PR Description

Use the [PR template](/.github/PULL_REQUEST_TEMPLATE.md) that auto-fills when you create a PR:

- **Summary** -- Brief description of what and why
- **Changes** -- Bullet list of specific changes
- **Testing** -- How you tested (steps to reproduce if relevant)
- **Screenshots** -- Before/after for UI changes

### After Opening a PR

- A maintainer will review your PR, usually within a few days
- Address review feedback by pushing new commits (don't force-push during review)
- Once approved, a maintainer will merge your PR

### PR Size Guidelines

- **Small PRs are reviewed faster.** Aim for under 400 lines of diff
- If a feature is large, break it into multiple PRs
- Each PR should be independently mergeable and not break anything

## Style Guide

### Backend (Python)

- **Formatter/Linter:** [Ruff](https://docs.astral.sh/ruff/) handles both
- **Type hints:** Use them for function signatures
- **Async:** Use `async/await` for I/O-bound operations
- **Imports:** Group as stdlib, third-party, local. Ruff enforces this
- **Naming:** `snake_case` for functions and variables, `PascalCase` for classes

### Frontend (TypeScript)

- **Linter:** ESLint with strict mode (`--max-warnings=0`)
- **Formatter:** Prettier
- **Components:** Functional components with hooks
- **State:** Zustand for client state, TanStack Query for server state
- **Styling:** Tailwind CSS utility classes
- **Naming:** `camelCase` for variables/functions, `PascalCase` for components

### General

- Don't add comments that restate the code -- comment *why*, not *what*
- Don't add TODO comments without an associated issue
- Keep functions focused and reasonably short
- Prefer explicit over clever

## Reporting Bugs

Open an [issue](https://github.com/cheatcode-ai/cheatcode/issues/new?template=bug_report.md) with:

1. **What happened** -- Clear description of the bug
2. **What you expected** -- What should have happened instead
3. **Steps to reproduce** -- Minimal steps to trigger the bug
4. **Environment** -- OS, browser, Docker version, Node/Python version
5. **Logs** -- Relevant error messages or stack traces

## Requesting Features

Open an [issue](https://github.com/cheatcode-ai/cheatcode/issues/new?template=feature_request.md) with:

1. **Problem** -- What problem does this feature solve?
2. **Proposed solution** -- How do you think it should work?
3. **Alternatives** -- Other approaches you considered
4. **Context** -- Any additional context or screenshots

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.**

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities, our response timeline, and safe harbor policy.

---

Thank you for contributing to Cheatcode! Every improvement, no matter how small, makes a difference.
