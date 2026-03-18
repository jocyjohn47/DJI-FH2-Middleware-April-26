# Universal Webhook Middleware — POC

> 针对 **DJI FlightHub2** 场景设计的通用 Webhook 中间件 PoC。支持多输入源先经过**中间件入站鉴权**（static token），通过后才进入 Redis Streams 队列，由 Worker 读取、字段映射后转发至 FlightHub2 工作流触发接口。

| 组件 | 技术 |
|------|------|
| API 层 | FastAPI + Uvicorn |
| 消息队列 | Redis Streams（Kafka 沙盒替代）|
| Worker | Python asyncio + httpx |
| 配置存储 | Redis（热更新，无需重启）|
| 管理界面 | 内置 Web 控制台 `/ui/` |
| 容器化 | Docker + supervisor（API + Worker 同镜像）|

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

## 部署方式

### 方式一：Railway（推荐，免费额度）

Railway 是最适合本项目的托管平台，原生支持 Docker + Redis。

#### 步骤

1. **注册 Railway**：访问 [railway.app](https://railway.app)，用 GitHub 账号登录

2. **新建项目**：
   - 点击 `New Project` → `Deploy from GitHub repo`
   - 选择 `Flighthub2-API-layer-coding` 仓库
   - Railway 自动识别 `railway.toml` 和 `Dockerfile`

3. **添加 Redis 插件**：
   - 在项目界面点击 `+ New` → `Database` → `Add Redis`
   - Railway 自动注入 `REDIS_URL` 环境变量

4. **配置环境变量**（Variables 面板）：

   | 变量 | 说明 |
   |------|------|
   | `REDIS_URL` | Railway Redis 自动注入，无需手动填写 |
   | `ADMIN_TOKEN` | Admin 接口保护 Token（建议设置）|

5. **部署完成后**，在 Settings → Networking 中生成公网域名

6. **初始化入站 Token**（部署后执行一次）：
   ```bash
   # 通过 Admin API 设置入站鉴权 token
   curl -X POST https://your-app.railway.app/admin/source/auth/set \
     -H 'Content-Type: application/json' \
     -H 'X-Admin-Token: your-admin-token' \
     -d '{
       "source": "flighthub2",
       "auth": {
         "enabled": true,
         "mode": "static_token",
         "header_name": "X-MW-Token",
         "token": "your-strong-inbound-token"
       }
     }'
   ```

---

### 方式二：Docker Compose（本地 / 自托管服务器）

```bash
# 克隆项目
git clone https://github.com/steven771806612-sys/Flighthub2-API-layer-coding.git
cd Flighthub2-API-layer-coding

# 启动完整环境（Redis + API + Worker）
docker compose up -d --build

# 查看日志
docker compose logs -f app

# 初始化入站 Token
redis-cli set "uw:srcauth:flighthub2" \
  '{"enabled":true,"mode":"static_token","header_name":"X-MW-Token","token":"your-token"}'
```

访问：
- 控制台：http://localhost:8000/ui/
- Swagger：http://localhost:8000/docs

---

### 方式三：沙盒直接运行（开发调试）

```bash
# 安装依赖
sudo apt-get install -y redis-server redis-tools
pip install -r requirements.txt

# 启动 Redis
redis-server --daemonize yes

# 初始化配置
export PYTHONPATH=$(pwd)
python3 scripts/bootstrap_redis.py
redis-cli set "uw:srcauth:flighthub2" \
  '{"enabled":true,"mode":"static_token","header_name":"X-MW-Token","token":"demo-in-token"}'

# 用 PM2 启动所有进程
pm2 start ecosystem.config.cjs
```

---

## 功能入口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/webhook` | POST | 入站 webhook（需带 `X-MW-Token`）|
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

> Admin 接口若设置了 `ADMIN_TOKEN` 环境变量，需在请求头携带 `X-Admin-Token`。

---

## 快速测试

```bash
# 无 Token（期望 401）
curl -X POST https://your-app.railway.app/webhook \
  -H 'Content-Type: application/json' \
  -d '{"source":"flighthub2","webhook_event":{}}'

# 正确 Token + 完整事件（期望 200）
curl -X POST https://your-app.railway.app/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-MW-Token: your-inbound-token' \
  -d '{
    "source": "flighthub2",
    "webhook_event": {
      "timestamp": "2026-03-18T10:00:00Z",
      "creator_id": "pilot01",
      "latitude": 22.543096,
      "longitude": 114.057865,
      "level": "warning",
      "description": "obstacle detected"
    }
  }'
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis 连接地址 |
| `PORT` | `8000` | API 监听端口（Railway 自动注入）|
| `STREAM_KEY_RAW` | `uw:webhook:raw` | Redis Stream 键名 |
| `STREAM_GROUP` | `uw-worker-group` | Consumer Group 名 |
| `ADMIN_TOKEN` | _(空，不鉴权)_ | Admin 接口保护 Token |
| `DEFAULT_SOURCE` | `flighthub2` | 默认 source 名称 |

---

## 数据模型（Redis 键）

| 键名 | 内容 |
|------|------|
| `uw:srcauth:{source}` | 入站鉴权配置 |
| `uw:map:{source}` | JSONPath 字段映射规则 |
| `uw:fhcfg:{source}` | FlightHub2 endpoint / headers / template_body |

---

## 项目结构

```
.
├── app/
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py            # 环境变量配置
│   ├── redis_repo.py        # Redis 数据访问层
│   ├── queue_bus.py         # Redis Stream 生产者
│   ├── mapping_engine.py    # JSONPath 字段映射
│   ├── template_engine.py   # Mustache 模板渲染
│   └── static/index.html    # Web 管理控制台
├── worker/worker.py         # Redis Stream 消费者
├── scripts/
│   ├── bootstrap_redis.py   # Redis 默认配置初始化
│   └── sandbox_test.sh      # E2E 测试脚本
├── deploy/
│   ├── supervisord.conf     # supervisor 进程管理配置
│   └── entrypoint.sh        # Docker 启动入口脚本
├── Dockerfile               # 多阶段构建镜像
├── docker-compose.yml       # 本地完整环境
├── railway.toml             # Railway 平台部署配置
├── ecosystem.config.cjs     # PM2 配置（沙盒/本机调试用）
└── requirements.txt         # Python 依赖
```

---

## 部署状态

- **GitHub**: https://github.com/steven771806612-sys/Flighthub2-API-layer-coding
- **推荐托管平台**: Railway（Docker + Redis 原生支持）
- **最后更新**: 2026-03-18
