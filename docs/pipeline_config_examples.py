"""
示例配置文件 — 存入 Redis 的 JSON 结构说明
==========================================
每个 source 可独立配置以下 key：

    uw:adapter:{source}    适配器配置（字段别名归一化）
    uw:map:{source}        字段映射配置（legacy 或 DSL 格式）
    uw:fhcfg:{source}      FlightHub2 推送配置
    uw:srcauth:{source}    入站鉴权配置
    uw:device:{device_id}  设备元数据（enrichment 用）

写入方法（在 Python 脚本或 redis-cli 中执行）：
    redis-cli SET uw:adapter:milestone '<JSON>'

─────────────────────────────────────────────────────────────────────
1. uw:adapter:{source}
─────────────────────────────────────────────────────────────────────
适用场景：上游系统字段名不统一，需要统一归一化后再 mapping。

ADAPTER_EXAMPLE = {
    "fields": {
        # normalized key      : [ candidate1, candidate2, ... ]  (按序取第一个非空)
        "event.name"          : ["Event.Name",      "eventType",  "type"],
        "device.id"           : ["Event.Source.Id", "deviceId",   "device_id"],
        "alert.level"         : ["Event.Level",     "severity",   "level"],
        "creator.id"          : ["Event.Operator",  "creatorId",  "creator_id"],
        "location.lat"        : ["Event.Lat",       "latitude",   "lat"],
        "location.lng"        : ["Event.Lng",       "longitude",  "lng"]
    }
}

─────────────────────────────────────────────────────────────────────
2a. uw:map:{source}  —  Legacy list format（兼容旧格式）
─────────────────────────────────────────────────────────────────────
MAPPING_LEGACY = {
    "mappings": [
        {"src": "$.creator_id", "dst": "creator_id", "type": "string",
         "default": "system",   "required": True},
        {"src": "$.latitude",   "dst": "latitude",   "type": "float",   "default": 0},
        {"src": "$.longitude",  "dst": "longitude",  "type": "float",   "default": 0},
        {"src": "$.level",      "dst": "level",       "type": "string",  "default": "info"},
        {"src": "$.description","dst": "description", "type": "string",  "default": ""}
    ]
}

─────────────────────────────────────────────────────────────────────
2b. uw:map:{source}  —  New DSL format（推荐用于新 source）
─────────────────────────────────────────────────────────────────────
MAPPING_DSL = {
    "dsl": {
        "creator_id": {
            "from":      ["creator.id", "creator_id", "operator_id"],
            "type":      "string",
            "default":   "unknown",
            "required":  True
        },
        "latitude": {
            "from":      ["location.lat", "latitude", "lat"],
            "type":      "float",
            "default":   0.0
        },
        "longitude": {
            "from":      ["location.lng", "longitude", "lng"],
            "type":      "float",
            "default":   0.0
        },
        "level": {
            "from":      ["alert.level", "severity", "level"],
            "type":      "string",
            "default":   "info",
            "transform": "lower"
        },
        "priority": {
            "from":      ["alert.level", "level"],
            "default":   1,
            "cases": [
                {"if": "$.level == 'critical'", "then": 3},
                {"if": "$.level == 'warning'",  "then": 2},
                {"if": "$.level == 'info'",      "then": 1}
            ]
        },
        "description": {
            "from":      ["event.name", "description", "desc"],
            "default":   ""
        }
    }
}

─────────────────────────────────────────────────────────────────────
2c. uw:map:{source}  —  混合格式（DSL + Legacy 共存）
─────────────────────────────────────────────────────────────────────
MAPPING_MIXED = {
    "dsl": {
        "level": {
            "from": ["alert.level", "level"],
            "transform": "lower"
        }
    },
    "mappings": [
        {"src": "$.creator_id", "dst": "creator_id", "type": "string", "default": "system"}
    ]
}

─────────────────────────────────────────────────────────────────────
3. uw:device:{device_id}  —  设备元数据（enrichment 模块读取）
─────────────────────────────────────────────────────────────────────
DEVICE_EXAMPLE = {
    "device_id": "DJI-001",
    "model":     "Matrice 300 RTK",
    "site":      "SZ-HQ",
    "location": {
        "lat": 22.5413,
        "lng": 114.0526,
        "alt": 120
    }
}

─────────────────────────────────────────────────────────────────────
Worker 处理流程（升级后）
─────────────────────────────────────────────────────────────────────

  raw webhook_event (nested JSON)
      │
      ▼  flatten_json()
  flat dict {"Event.Name": "alert", "Event.Source.Id": "DJI-001", ...}
      │
      ▼  apply_adapter(flat, uw:adapter:{source})
  normalized flat {"event.name": "alert", "device.id": "DJI-001", ...}
      │                       ↑ 字段别名归一化，原 key 保留
      ▼  apply_mappings(event, source, uw:map:{source}, ts, flat_event=flat)
  unified {"creator_id": "...", "latitude": 22.54, "level": "warning", ...}
      │
      ▼  enrich(unified, repo)             ← 读 uw:device:{device_id}
  unified + {"_device": {...}, "location": {...}}
      │
      ▼  render_obj(template_body, ctx)    ← 读 uw:fhcfg:{source}
  rendered request body
      │
      ▼  httpx.post(endpoint, headers, body)
  FlightHub2 API

"""
