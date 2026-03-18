# Universal Webhook Middleware — POC

## 项目概述

> 针对 **DJI FlightHub2** 场景设计的通用 Webhook 中间件 PoC。支持多输入源先经过**中间件入站鉴权**（static token），通过后才进入 Redis Streams 队列，由 Worker 读取、字段映射后转发至 FlightHub2 工作流触发接口。

| 组件 | 技术 |
|------|------|
| API 层 | FastAPI + Uvicorn |
| 消息队列 | Redis Streams（Kafka 沙盒替代）|
| Worker | Python asyncio + httpx |
| 配置存储 | Redis（热更新，无需重启）|
| 管理界面 | 内置 Web 控制台 `/ui/` |

---

## 架构说明

```
外部系统 (webhook)
    │  HTTP POST /webhook
    │  Header: X-MW-Token (入站鉴权)
    ▼
FastAPI API  ──────────────────────────────────────────
  ① 入站鉴权验证（per source, Redis 热读取）
  ② 验证通过 → 入队 Redis Stream (uw:webhook:raw)
─────────────────────────────────────────────────────
           ▼ Redis Stream Consumer Group
Worker × 2
  ③ 读取 mapping config（JSONPath → 统一字段）
  ④ 读取 FlightHub2 三件套（token/uuid/workflow_uuid）
  ⑤ 渲染 template body
  ⑥ HTTP POST → FlightHub2 API（指数退避重试）
─────────────────────────────────────────────────────
    配置全部存储于 Redis，支持 GUI 或 API 热更新
```

---

## 快速启动

### 1. 安装依赖

```bash
sudo apt-get install -y redis-server redis-tools
pip install fastapi "uvicorn[standard]" redis httpx jsonpath-ng pydantic-settings
```

### 2. 启动 Redis

```bash
redis-server --daemonize yes
```

### 3. 初始化 Redis 默认配置

```bash
export PYTHONPATH=$(pwd)
python3 scripts/bootstrap_redis.py

# 设置入站鉴权 token（替换为你的 token）
redis-cli set "uw:srcauth:flighthub2" \
  '{"enabled":true,"mode":"static_token","header_name":"X-MW-Token","token":"your-token-here"}'
```

### 4. 启动服务（PM2）

```bash
pm2 start ecosystem.config.cjs
pm2 list
```

### 5. 验证

```bash
# 正确 token，期望 HTTP 200
curl -X POST http://127.0.0.1:8000/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-MW-Token: your-token-here' \
  -d '{
    "source": "flighthub2",
    "webhook_event": {
      "timestamp": "2026-03-18T10:00:00Z",
      "creator_id": "user1",
      "latitude": 22.543096,
      "longitude": 114.057865,
      "level": "warning",
      "description": "Test event"
    }
  }'
```

---

## 功能入口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/webhook` | POST | 入站 webhook（需带 X-MW-Token）|
| `/ui/` | GET | Web 管理控制台 |
| `/docs` | GET | FastAPI Swagger 文档 |
| `/admin/source/list` | POST | 列出所有 source |
| `/admin/source/init` | POST | 初始化新 source 配置 |
| `/admin/source/auth/get` | POST | 读取入站鉴权配置 |
| `/admin/source/auth/set` | POST | 设置入站鉴权配置 |
| `/admin/mapping/get` | POST | 读取字段映射配置 |
| `/admin/mapping/set` | POST | 设置字段映射配置 |
| `/admin/flighthub/get` | POST | 读取 FlightHub2 三件套配置 |
| `/admin/flighthub/set` | POST | 设置 FlightHub2 三件套配置 |
| `/admin/token/extract` | POST | 提取粘贴文本中的 Token 字段 |

> Admin 接口均为 POST-only。若设置了 `ADMIN_TOKEN` 环境变量，需在请求头携带 `X-Admin-Token`。

---

## 数据模型

### source 配置键（Redis）

| 键名 | 内容 |
|------|------|
| `uw:srcauth:{source}` | 入站鉴权配置（mode/header_name/token/enabled）|
| `uw:map:{source}` | 字段映射规则（JSONPath → 统一字段）|
| `uw:fhcfg:{source}` | FlightHub2 endpoint/headers/template_body/retry_policy |

### webhook_event 标准字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `timestamp` | string | 事件时间戳 |
| `creator_id` | string | 创建者 ID |
| `latitude` | float | 纬度 |
| `longitude` | float | 经度 |
| `level` | string | 告警级别 |
| `description` | string | 事件描述 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis 连接地址 |
| `STREAM_KEY_RAW` | `uw:webhook:raw` | Redis Stream 键名 |
| `STREAM_GROUP` | `uw-worker-group` | Consumer Group 名 |
| `STREAM_CONSUMER` | `worker-1` | 消费者名称 |
| `ADMIN_TOKEN` | _(空，不鉴权)_ | Admin 接口保护 Token |
| `DEFAULT_SOURCE` | `flighthub2` | 默认 source 名称 |

---

## 项目结构

```
webapp/
├── app/
│   ├── main.py          # FastAPI 应用入口
│   ├── config.py        # 环境变量配置
│   ├── redis_repo.py    # Redis 数据访问层
│   ├── queue_bus.py     # Redis Stream 生产者
│   ├── mapping_engine.py# JSONPath 字段映射
│   ├── template_engine.py # Mustache-style 模板渲染
│   └── static/
│       └── index.html   # Web 管理控制台
├── worker/
│   └── worker.py        # 消费者 Worker
├── scripts/
│   ├── bootstrap_redis.py # 初始化 Redis 默认配置
│   ├── run_api.sh
│   ├── run_worker.sh
│   └── sandbox_test.sh  # E2E 测试脚本
├── ecosystem.config.cjs # PM2 配置
├── requirements.txt     # Python 依赖
└── README.md
```

---

## 部署状态

- **运行环境**: Sandbox (PM2 托管)
- **API 地址**: `http://127.0.0.1:8000`
- **管理控制台**: `http://127.0.0.1:8000/ui/`
- **Swagger 文档**: `http://127.0.0.1:8000/docs`
- **最后更新**: 2026-03-18
