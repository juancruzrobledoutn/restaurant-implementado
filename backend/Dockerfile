# Backend — Development Dockerfile
#
# Build context: ./backend  (set in compose.yaml)
# Hot-reload: el source se monta como volumen, los cambios se detectan automáticamente.
#
# Startup automático:
#   1. alembic upgrade head    — aplica migraciones pendientes (idempotente)
#   2. seeds.runner            — crea datos demo si no existen (idempotente)
#   3. uvicorn --reload        — arranca el servidor con hot-reload

FROM python:3.12-slim

WORKDIR /app

# curl es necesario para el HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias primero (mejor cache de Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copiar el source (sobreescrito por el volumen en dev)
COPY . .

ENV PYTHONPATH=/app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Migrate → Seed → Serve (los tres son idempotentes)
CMD ["sh", "-c", "alembic upgrade head && python -m rest_api.seeds.runner && uvicorn rest_api.main:app --host 0.0.0.0 --port 8000 --reload"]
