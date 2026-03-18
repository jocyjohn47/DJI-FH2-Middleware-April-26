# ─────────────────────────────────────────────────────────────────
# Universal Webhook Middleware POC
# 多阶段构建：精简最终镜像体积
# ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# 安装构建依赖
RUN pip install --upgrade pip && \
    pip install --prefix=/install \
        fastapi \
        "uvicorn[standard]" \
        redis \
        httpx \
        jsonpath-ng \
        pydantic-settings \
        supervisor

# ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim

# 安装 redis-cli（用于 entrypoint 健康检查）
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends redis-tools && \
    rm -rf /var/lib/apt/lists/*

# 从 builder 复制已安装的 Python 包
COPY --from=builder /install /usr/local

# 创建日志目录
RUN mkdir -p /var/log/supervisor /app/logs

WORKDIR /app

# 复制项目源码
COPY app/       ./app/
COPY worker/    ./worker/
COPY scripts/   ./scripts/
COPY deploy/    ./deploy/

# entrypoint 可执行权限
RUN chmod +x /app/deploy/entrypoint.sh

# 暴露 API 端口（Railway 会注入 $PORT 环境变量）
EXPOSE 8000

# 默认环境变量（可在平台层覆盖）
ENV PORT=8000 \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

ENTRYPOINT ["/app/deploy/entrypoint.sh"]
