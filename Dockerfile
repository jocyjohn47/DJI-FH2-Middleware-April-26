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
#   WORKDIR = /workspace/frontend
#   vite outDir = ../app/static/console → /workspace/app/static/console
# ═══════════════════════════════════════════════════════════════════
FROM node:20-slim AS fe-builder

WORKDIR /workspace/frontend

# Copy package files first for better layer caching
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm install --prefer-offline 2>/dev/null || npm install

# Copy full frontend source
COPY frontend/ ./

# Clean old frontend output completely, then build fresh
RUN rm -rf /workspace/app/static/console && npm run build

# Verify built artifacts
RUN echo "=== fe-builder: built assets ===" && ls -la /workspace/app/static/console/

# ═══════════════════════════════════════════════════════════════════
# Stage 3 — Final runtime image
# ═══════════════════════════════════════════════════════════════════
FROM python:3.12-slim

# Minimal system packages
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=py-builder /install /usr/local

# Runtime folders
RUN mkdir -p /var/log/supervisor /app/logs

WORKDIR /app

# Copy backend source
COPY app/     ./app/
COPY worker/  ./worker/
COPY scripts/ ./scripts/
COPY deploy/  ./deploy/

# Copy generated frontend build output
COPY --from=fe-builder /workspace/app/static/console/ ./app/static/console/

# Override Vite-generated index.html with custom login-wrapper page
COPY deploy/console-index.html ./app/static/console/index.html

# Inject actual bundle names into wrapper and verify recent logs UI exists
RUN css=$(find /app/app/static/console/assets -maxdepth 1 -type f -name 'index-*.css' | head -n 1 | sed 's#^/app/app/static/console##') && \
    js=$(find /app/app/static/console/assets -maxdepth 1 -type f -name 'index-*.js' | head -n 1 | sed 's#^/app/app/static/console##') && \
    echo "Using CSS asset: $css" && \
    echo "Using JS asset: $js" && \
    test -n "$css" && test -n "$js" && \
    sed -i "s#__CSS_BUNDLE__#$css#g" /app/app/static/console/index.html && \
    sed -i "s#__JS_BUNDLE__#$js#g" /app/app/static/console/index.html && \
    echo "=== verify built frontend contains recent logs UI ===" && \
    grep -R "/admin/events/recent" /app/app/static/console/assets || (echo "ERROR: built bundle missing /admin/events/recent" && exit 1) && \
    grep -R "Recent Logs" /app/app/static/console/assets || (echo "ERROR: built bundle missing Recent Logs UI" && exit 1) && \
    echo "=== runtime: console assets ===" && ls -la /app/app/static/console/ && \
    echo "=== runtime: console index preview ===" && sed -n '1,80p' /app/app/static/console/index.html

# Entrypoint permission
RUN chmod +x /app/deploy/entrypoint.sh

EXPOSE 8000

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PORT=8000 \
    REDIS_URL=redis://127.0.0.1:6379/0

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
