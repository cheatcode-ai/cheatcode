FROM ghcr.io/astral-sh/uv:python3.11-alpine

ENV ENV_MODE=production
WORKDIR /app

RUN apk add --no-cache curl git

# Create non-root runtime user early
RUN addgroup -g 1001 app && adduser -D -G app -u 1001 app

# Install Python dependencies
COPY pyproject.toml ./
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv uv lock
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --quiet

# Fix ownership of the entire /app directory including .venv
RUN chown -R app:app /app

# Copy application code with correct ownership
COPY --chown=app:app . .

USER app

ENV PYTHONPATH=/app
EXPOSE 8000

# Container health-check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD curl -f http://localhost:8000/api/health || exit 1

# Gunicorn – compute optimal workers (2×CPU+1) at runtime
CMD ["sh", "-c", "CPU=$(getconf _NPROCESSORS_ONLN); WORKERS=$((2*CPU+1)); exec \
uv run gunicorn main:app \
  --workers ${WORKERS} \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 1800 \
  --graceful-timeout 600 \
  --keep-alive 1800 \
  --worker-connections 2000 \
  --preload \
  --log-level info \
  --access-logfile - \
  --error-logfile -"]
