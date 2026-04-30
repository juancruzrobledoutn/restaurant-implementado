# WebSocket Gateway — Production Dockerfile
#
# Build context: repo root (one level above ws_gateway/)
#   docker build -f ws_gateway/Dockerfile -t integrador-ws-gateway .
#
# Startup order: Redis must be healthy before this service starts.
# The service exposes port 8001 for WebSocket connections.

FROM python:3.12-slim

# Security: run as non-root
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

# System dependencies for hiredis (C extension for faster Redis)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better Docker layer caching
COPY ws_gateway/requirements.txt ./ws_gateway/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r ws_gateway/requirements.txt

# Copy application source
COPY backend/shared ./backend/shared
COPY ws_gateway ./ws_gateway

# Add backend to Python path so ws_gateway can import from shared/
ENV PYTHONPATH=/app/backend

# Non-root user
USER appuser

# Port 8001 for WebSocket Gateway
EXPOSE 8001

# Healthcheck — fast check, no external deps
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

CMD ["python", "-m", "uvicorn", "ws_gateway.main:app", "--host", "0.0.0.0", "--port", "8001"]
