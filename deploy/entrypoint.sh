#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# entrypoint.sh
# 从 REDIS_URL 解析连接信息（Railway 注入完整 URL）
# 格式：redis://:password@host:port  或  redis://host:port
# ─────────────────────────────────────────────────────────────────

REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"

# 用 Python 解析 REDIS_URL，避免 bash 正则处理带密码的复杂 URL
read REDIS_HOST REDIS_PORT REDIS_PASS <<< $(python3 - <<'PYEOF'
import os, urllib.parse, sys
url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
p = urllib.parse.urlparse(url)
host = p.hostname or "127.0.0.1"
port = p.port or 6379
password = p.password or ""
print(host, port, password)
PYEOF
)

echo "[entrypoint] REDIS_URL=${REDIS_URL}"
echo "[entrypoint] parsed → host=${REDIS_HOST} port=${REDIS_PORT} auth=$([ -n "${REDIS_PASS}" ] && echo 'yes' || echo 'no')"
echo "[entrypoint] waiting for Redis ..."

# 构造 redis-cli 参数（带密码时加 -a）
REDIS_CLI_ARGS="-h ${REDIS_HOST} -p ${REDIS_PORT}"
if [ -n "${REDIS_PASS}" ]; then
  REDIS_CLI_ARGS="${REDIS_CLI_ARGS} -a ${REDIS_PASS} --no-auth-warning"
fi

for i in $(seq 1 60); do
  if redis-cli ${REDIS_CLI_ARGS} ping 2>/dev/null | grep -q PONG; then
    echo "[entrypoint] Redis ready (attempt ${i})."
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint] ERROR: Redis not ready after 60s" >&2
    echo "[entrypoint] last redis-cli attempt:" >&2
    redis-cli ${REDIS_CLI_ARGS} ping 2>&1 || true
    exit 1
  fi
done

# ─── 引导 Redis 默认配置（幂等）────────────────────────────────
echo "[entrypoint] bootstrapping Redis default config ..."
python3 scripts/bootstrap_redis.py && echo "[entrypoint] bootstrap OK" \
  || echo "[entrypoint] bootstrap skipped (already exists or non-fatal error)"

# ─── 启动 supervisord ──────────────────────────────────────────
PORT="${PORT:-8000}"
echo "[entrypoint] starting supervisord (API port=${PORT}) ..."
exec supervisord -c /app/deploy/supervisord.conf
