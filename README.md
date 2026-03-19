# FlightHub Webhook Transformer

> DJI FlightHub2 Webhook 中间件 — 接收第三方告警 Webhook，经标准化管道处理后转发至 FlightHub2 工作流 API。

**版本:** v6 · **最后更新:** 2026-03-19  
**GitHub:** https://github.com/steven771806612-sys/Flighthub2-API-layer-coding

---

## 系统架构

```
外部系统
   │
   │  POST /webhook  (X-MW-Token 认证)
   ▼
┌─────────────────────────────────────────────┐
│  FastAPI (Uvicorn · port 8000)              │
│  ├─ /webhook         inbound handler        │
│  ├─ /console         React 管理后台 (SPA)   │
│  ├─ /ui              HTML 轻量 UI (legacy)  │
│  ├─ /docs            Swagger API 文档       │
│  └─ /admin/*         管理 API (18 端点)     │
└────────────────┬────────────────────────────┘
                 │ XADD
                 ▼
         Redis Stream (uw:webhook:raw)
                 │
        ┌────────┴────────┐
        │  Consumer Group  │
        │  uw-worker-group │
        └────────┬────────┘
                 │ XREADGROUP (×2 workers)
                 ▼
┌────────────────────────────────────────────────────────────┐
│  Worker Pipeline (×2 并行)                                 │
│                                                             │
│  1. flatten     nested JSON → dot-notation dict            │
│  2. normalize   应用 adapter 配置统一字段名                 │
│  3. mapping     JSONPath/DSL 映射 → unified dict           │
│  4. enrich      注入 device 元数据 (Redis lookup)          │
│  5. autofill    补全 FH2 必填字段 + 构建最终 body           │
│  6. HTTP POST   带重试逻辑推送至 FlightHub2 API             │
└────────────────────────────────────────────────────────────┘
                 │
                 ▼
        DJI FlightHub2 API
   POST /openapi/v0.1/workflow
```

---

## 已实现功能

### 后端核心
| 模块 | 说明 |
|------|------|
| `app/main.py` | FastAPI 主入口，18 个 Admin API 端点 |
| `app/flatten.py` | 嵌套 JSON → dot-notation（支持列表索引） |
| `app/normalize.py` | 应用 adapter 配置，返回统一字段列表 |
| `app/adapter_engine.py` | 字段候选路径映射（多路径回退） |
| `app/mapping_engine.py` | JSONPath (legacy) + DSL (from/default/cases/transform) |
| `app/enrichment.py` | 从 `uw:device:{id}` 注入设备元数据 |
| `app/autofill.py` | 补全 FH2 必填字段，输出标准 body 结构 |
| `app/redis_repo.py` | Redis CRUD（mapping/fhcfg/auth/adapter/device） |
| `worker/worker.py` | 异步消费者，完整 6 步管道 |

### Worker 管道（v6 简化版）
```
raw → flatten_json → normalize → apply_mappings → enrich → autofill → build_fh2_body → HTTP POST
```
> ✅ 移除了 `template_engine` 和 `canonical` 层，由 `autofill.build_fh2_body()` 直接输出标准 FH2 请求体。

### Redis Key 一览
| Key | 用途 |
|-----|------|
| `uw:webhook:raw` | Redis Stream（消息队列） |
| `uw:srcauth:{source}` | Ingress token 认证配置 |
| `uw:map:{source}` | 字段映射配置（legacy list 或 DSL dict） |
| `uw:fhcfg:{source}` | FlightHub2 出口配置（endpoint/headers/retry） |
| `uw:adapter:{source}` | 字段归一化 adapter 配置 |
| `uw:device:{device_id}` | 设备元数据（GPS/site/model） |

---

## 管理后台

**React SPA** 访问路径：`/console`

| 页面 | 路由 | 功能 |
|------|------|------|
| Dashboard | `/console` | 系统概览，源状态 |
| Sources | `/console/sources` | 创建/管理 webhook 源 |
| Visual Mapper | `/console/mapping` | **核心** — 三栏可视化字段映射 |
| Egress | `/console/egress` | FlightHub2 出口配置 |
| Devices | `/console/device` | 设备元数据 CRUD |
| New Integration | `/console/wizard` | 向导式新建集成 |

### Visual Mapper 工作流
1. 选择 source → 粘贴 Sample Payload
2. 点击 **Load Fields & Preview** → 调用 `/admin/debug/run` → 左栏填充字段列表
3. 中栏下拉选择目标 FH2 字段（支持 Auto-Suggest）
4. 右栏实时预览 FH2 输出 body + Missing 字段面板
5. 点击 **Save Mapping** → 保存至 Redis

---

## API 端点

### Webhook 入口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/webhook` | 接收 webhook（X-MW-Token 认证） |

### 管理端点（需 X-Admin-Token）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/source/list` | 列出所有 source |
| POST | `/admin/source/init` | 初始化 source 默认配置 |
| POST | `/admin/source/auth/get` | 获取 ingress 认证配置 |
| POST | `/admin/source/auth/set` | 设置 ingress 认证配置 |
| POST | `/admin/mapping/get` | 获取字段映射配置 |
| POST | `/admin/mapping/set` | 保存字段映射配置 |
| POST | `/admin/flighthub/get` | 获取 FH2 出口配置 |
| POST | `/admin/flighthub/set` | 保存 FH2 出口配置 |
| POST | `/admin/token/extract` | 从 curl/header 文本提取 token |
| POST | `/admin/adapter/get` | 获取字段归一化 adapter |
| POST | `/admin/adapter/set` | 保存字段归一化 adapter |
| POST | `/admin/device/list` | 列出所有设备 |
| POST | `/admin/device/get` | 获取设备元数据 |
| POST | `/admin/device/set` | 保存设备元数据 |
| POST | `/admin/device/delete` | 删除设备 |
| POST | `/admin/debug/run` | 管道干运行（调试用） |

---

## FH2 请求体结构

```json
{
  "workflow_uuid": "uuid-from-config",
  "trigger_type": 0,
  "name": "Alert-{event_name}",
  "params": {
    "creator": "pilot01",
    "latitude": 22.543096,
    "longitude": 114.057865,
    "level": 3,
    "desc": "obstacle detected"
  }
}
```

### Autofill 优先级（params 字段）
1. mapped dict 中已存在的值
2. `uw:device:{device_id}` 的 location（lat/lng）
3. FH2 配置中的 `autofill` 覆盖值
4. 硬编码默认值（creator="system", level=3, desc=""）
5. 标记为 `missing[]`

---

## 部署

### Railway（推荐）
```bash
# 1. 创建 Railway 项目，添加 Redis 插件
# 2. Railway 自动注入 REDIS_URL
# 3. 部署后初始化 source
curl -X POST https://your-app.railway.app/admin/source/init \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: your-token" \
  -d '{"source": "flighthub2", "force": true}'
```

### 环境变量
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis 连接（Railway 自动注入） |
| `PORT` | `8000` | 服务端口 |
| `ADMIN_TOKEN` | 空（不鉴权） | 管理接口保护 token |
| `DEFAULT_SOURCE` | `flighthub2` | 默认 source slug |
| `STREAM_KEY_RAW` | `uw:webhook:raw` | Redis Stream key |
| `STREAM_GROUP` | `uw-worker-group` | Consumer group 名 |

### 本地开发（Sandbox / Docker Compose）
```bash
# Docker Compose
docker compose up -d --build

# 或使用 PM2（sandbox）
pm2 restart all

# 访问
# http://localhost:8000/console  →  管理后台
# http://localhost:8000/docs     →  Swagger
```

---

## 项目结构

```
webapp/
├── app/
│   ├── main.py              FastAPI 入口 + 所有 API 路由
│   ├── config.py            Settings（pydantic）
│   ├── redis_repo.py        Redis CRUD 封装
│   ├── flatten.py           nested JSON → dot-notation
│   ├── normalize.py         adapter 归一化封装
│   ├── adapter_engine.py    字段候选路径映射
│   ├── mapping_engine.py    JSONPath + DSL 映射引擎
│   ├── enrichment.py        设备元数据注入
│   ├── autofill.py          FH2 字段自动填充 + body 构建
│   └── static/console/      React SPA 构建产物
├── worker/
│   └── worker.py            Redis Stream 消费者（6 步管道）
├── frontend/                React + Vite + TypeScript 源码
│   └── src/
│       ├── modules/
│       │   ├── mapping/     MappingBoard（三栏可视化）
│       │   ├── device/      DevicePage
│       │   ├── egress/      EgressConfigPanel
│       │   ├── source/      SourcesPage
│       │   └── wizard/      IntegrationWizard
│       ├── store/           Zustand stores
│       ├── services/        API 服务层（18 端点）
│       └── types/           TypeScript 类型定义
├── deploy/
│   ├── supervisord.conf     进程守护配置
│   └── entrypoint.sh        Docker 启动脚本
├── Dockerfile
├── docker-compose.yml
└── railway.toml
```

---

## 已完成 ✅
- FastAPI + Redis Stream 完整消息队列
- 6 步 Worker 管道（flatten → normalize → mapping → enrich → autofill → HTTP）
- DSL 映射引擎（from/default/cases/transform）
- 设备元数据注册与 GPS 自动注入
- React 三栏可视化字段映射器（带实时预览）
- Debug 管道干运行（`/admin/debug/run`）
- Auto-suggest 字段映射
- Railway + Docker Compose 部署支持

## 待完成 / 可扩展
- [ ] Mapping DSL 可视化编辑器（RuleBuilder）重新接入
- [ ] 前端 Adapter 配置页面（当前隐藏，后端已支持）
- [ ] 多租户 / 多 source 批量管理
- [ ] Webhook 历史记录查询（Redis Stream 回放）
- [ ] FlightHub2 API 响应解析与错误告警
