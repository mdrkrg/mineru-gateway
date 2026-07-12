# syntax=docker/dockerfile:1
FROM python:3.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install dependencies first (layer cache) using the lockfile.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Copy the project and install it.
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./
COPY docker-entrypoint.sh ./
RUN uv sync --frozen --no-dev && chmod +x docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Migrations run on start, then a single uvicorn worker (memory rate limiter +
# background loops are process-scoped).
CMD ["./docker-entrypoint.sh"]
