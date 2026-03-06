.PHONY: lint format fix check knip

# ── Full check (CI-friendly, no modifications) ──
check: lint-backend lint-frontend format-check-backend format-check-frontend knip
	@echo "All checks passed."

# ── Linting ──
lint: lint-backend lint-frontend
lint-backend:
	cd backend && uv run ruff check .
lint-frontend:
	cd frontend && npx eslint src/ --max-warnings=0

# ── Formatting ──
format: format-backend format-frontend
format-backend:
	cd backend && uv run ruff format .
format-frontend:
	cd frontend && npx prettier --write "src/**/*.{ts,tsx,css,json}"

# ── Format check (no modifications) ──
format-check-backend:
	cd backend && uv run ruff format . --check
format-check-frontend:
	cd frontend && npx prettier --check "src/**/*.{ts,tsx,css,json}"

# ── Auto-fix (applies safe fixes) ──
fix: fix-backend fix-frontend
fix-backend:
	cd backend && uv run ruff check . --fix && uv run ruff format .
fix-frontend:
	cd frontend && npx eslint src/ --fix --max-warnings=0 && npx prettier --write "src/**/*.{ts,tsx,css,json}"

# ── Knip (unused files, deps, exports) ──
knip:
	cd frontend && npx knip
knip-fix:
	cd frontend && npx knip --fix
