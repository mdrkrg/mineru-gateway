#!/bin/sh
set -e

# Apply database migrations, then start the gateway (single worker).
alembic upgrade head

exec uvicorn mineru_gateway.main:create_app --factory \
    --host 0.0.0.0 --port 8000 --workers 1
