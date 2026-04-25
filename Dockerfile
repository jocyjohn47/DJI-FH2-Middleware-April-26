# ═══════════════════════════════════════════════════════════════════
# Stage 1 — Python dependencies
# ═══════════════════════════════════════════════════════════════════
FROM python:3.12-slim AS py-builder

WORKDIR /build

COPY requirements.txt .

RUN pip install --upgrade pip --quiet && \
    pip install --prefix=/install -r requirements.txt --quiet

# ═══════════════════════════════════════════════════════════════════
# Stage 2 — React frontend build
# ═══════════════════════════════════════════════════════════════════
FROM node:20-slim AS fe-builder

WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./

RUN npm install --prefer-offline 2>/dev/null || npm install

COPY frontend/ ./

# Clean old build output first
RUN rm -rf /workspace/app/static/console && npm run build

# Verify the expected files exist and the new logs UI is in the bundle
RUN test -f /workspace/app/static/console/assets/app.js && \
    test -f /workspace/app/static/console/assets/app.css && \
    grep -R "/admin/events/recent" /workspace/app/static/console/assets || (echo "ERROR: built bundle missing /admin/events/recent" && exit 1) && \
    grep -R "Recent Logs" /workspace/app/static/console/assets || (echo "ERROR: built bundle missing Recent Logs UI" && exit 1)

# ═══════════════════════════════════════════════════════════════════
# Stage 3 — Final runtime image
# ═══════════════════════════════════════════════════════════════════
FROM python:3.12-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=py-builder /install /usr/local

RUN mkdir -p /var/log/supervisor /app/logs

WORKDIR /app

COPY app/     ./app/
COPY worker/  ./worker/
COPY scripts/ ./scripts/
COPY deploy/  ./deploy/

COPY --from=fe-builder /workspace/app/static/console/ ./app/static/console/
COPY deploy/console-index.html ./app/static/console/index.html

RUN echo "=== runtime console files ===" && \
    ls -la /app/app/static/console/ && \
    ls -la /app/app/static/console/assets/

RUN chmod +x /app/deploy/entrypoint.sh

EXPOSE 8000

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PORT=8000 \
    REDIS_URL=redis://127.0.0.1:6379/0

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
