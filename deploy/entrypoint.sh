#!/bin/bash
set -e

# ─── 等待 Redis 就绪 ───────────────────────────────────────────
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
echo "[entrypoint] waiting for Redis at ${REDIS_HOST}:${REDIS_PORT} ..."

for i in $(seq 1 30); do
  if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" ping 2>/dev/null | grep -q PONG; then
    echo "[entrypoint] Redis ready."
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "[entrypoint] ERROR: Redis not ready after 30s" >&2
    exit 1
  fi
done

# ─── 引导 Redis 默认配置（幂等，已存在则跳过）──────────────────
echo "[entrypoint] bootstrapping Redis default config ..."
python3 scripts/bootstrap_redis.py || echo "[entrypoint] bootstrap skipped (already exists or error)"

# ─── 启动 supervisord ─────────────────────────────────────────
PORT="${PORT:-8000}"
echo "[entrypoint] starting supervisord (API port=${PORT}) ..."
exec supervisord -c /app/deploy/supervisord.conf
