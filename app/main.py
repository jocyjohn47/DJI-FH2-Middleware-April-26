from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI, Request, Header
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles
import re
from redis.asyncio import Redis

from app.config import settings
from app.redis_repo import RedisRepo
from app.queue_bus import RedisStreamBus

app = FastAPI(title="Universal Webhook Middleware (POC)")

# Optional tiny GUI (static). API endpoints stay POST-only.
# Access: GET /ui/
app.mount("/ui", StaticFiles(directory="app/static", html=True), name="ui")

_TOKEN_PATTERNS = {
    "X-User-Token": [
        re.compile(r"(?im)^\s*X-User-Token\s*:\s*([^\r\n]+)\s*$"),
        re.compile(r"(?i)\"X-User-Token\"\s*:\s*\"([^\"]+)\""),
        re.compile(r"(?i)\bX-User-Token\b\s*=\s*([^\s;]+)"),
    ],
    "x-project-uuid": [
        re.compile(r"(?im)^\s*x-project-uuid\s*:\s*([^\r\n]+)\s*$"),
        re.compile(r"(?i)\"x-project-uuid\"\s*:\s*\"([^\"]+)\""),
        re.compile(r"(?i)\bx-project-uuid\b\s*=\s*([^\s;]+)"),
    ],
    "workflow_uuid": [
        re.compile(r"(?i)\"workflow_uuid\"\s*:\s*\"([^\"]+)\""),
        re.compile(r"(?i)\bworkflow_uuid\b\s*=\s*([^\s;]+)"),
    ],
}


def _extract_tokens(raw: str) -> dict:
    out: dict[str, str] = {}
    if not raw:
        return out
    for k, pats in _TOKEN_PATTERNS.items():
        for p in pats:
            m = p.search(raw)
            if m:
                out[k] = m.group(1).strip().strip('"')
                break
    return out

redis: Redis | None = None
repo: RedisRepo | None = None
bus: RedisStreamBus | None = None


def _require_admin(x_admin_token: str | None):
    if settings.ADMIN_TOKEN and x_admin_token != settings.ADMIN_TOKEN:
        raise PermissionError("admin token invalid")


@app.on_event("startup")
async def on_startup():
    global redis, repo, bus
    redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    repo = RedisRepo(redis)
    bus = RedisStreamBus(redis, settings.STREAM_KEY_RAW)


@app.on_event("shutdown")
async def on_shutdown():
    global redis
    if redis:
        await redis.aclose()


def _require_source_auth(source: str, request: Request, srcauth: dict):
    """Inbound auth: only authenticated requests can enter queue.

    Current POC supports: mode=static_token.
    """
    if not isinstance(srcauth, dict) or not srcauth:
        raise HTTPException(status_code=401, detail=f"source_not_registered_or_auth_missing: {source}")

    enabled = bool(srcauth.get("enabled", True))
    if not enabled:
        raise HTTPException(status_code=403, detail=f"source_disabled: {source}")

    mode = (srcauth.get("mode") or "static_token").lower()
    if mode != "static_token":
        raise HTTPException(status_code=400, detail=f"unsupported_auth_mode: {mode}")

    header_name = srcauth.get("header_name") or "X-MW-Token"
    expected = str(srcauth.get("token") or "")
    got = request.headers.get(header_name) or ""

    if not expected or got != expected:
        raise HTTPException(status_code=401, detail="auth_failed")


@app.post("/webhook")
async def webhook_ingest(payload: dict[str, Any], request: Request):
    """POST only. Body: {source, webhook_event}. Requires per-source inbound auth."""
    global bus, repo
    assert bus is not None
    assert repo is not None

    source = payload.get("source") or settings.DEFAULT_SOURCE
    webhook_event = payload.get("webhook_event")
    if webhook_event is None:
        return {"status": "error", "message": "missing webhook_event"}

    # inbound auth gate (pass -> enqueue)
    srcauth = await repo.get_source_auth(source)
    _require_source_auth(source, request, srcauth)

    received_at = int(time.time())

    # store some request meta for debugging/audit
    hdr = {}
    for k in ("content-type", "user-agent", "x-forwarded-for"):
        if k in request.headers:
            hdr[k] = request.headers.get(k)

    msg = {
        "source": source,
        "received_at": received_at,
        "request": {"path": str(request.url.path), "method": "POST", "headers": hdr},
        "webhook_event": webhook_event,
    }

    await bus.produce(msg)
    return {"status": "accepted", "queue": "redis_stream", "stream": settings.STREAM_KEY_RAW}


def _default_mapping() -> dict:
    return {
        "mappings": [
            {"src": "$.timestamp", "dst": "timestamp", "type": "string", "default": "", "required": False},
            {"src": "$.creator_id", "dst": "creator_id", "type": "string", "default": "system", "required": True},
            {"src": "$.latitude", "dst": "latitude", "type": "float", "default": 0, "required": True},
            {"src": "$.longitude", "dst": "longitude", "type": "float", "default": 0, "required": True},
            {"src": "$.level", "dst": "level", "type": "string", "default": "info", "required": True},
            {"src": "$.description", "dst": "description", "type": "string", "default": "", "required": False},
        ]
    }


def _default_fhcfg() -> dict:
    return {
        "endpoint": settings.DEFAULT_FLIGHTHUB_ENDPOINT,
        "headers": {
            "Content-Type": "application/json",
            "X-User-Token": "",
            "x-project-uuid": "",
        },
        "template_body": {
            "workflow_uuid": "",
            "trigger_type": 0,
            "name": "Alert-{{timestamp}}",
            "params": {
                "creator": "{{creator_id}}",
                "latitude": "{{latitude}}",
                "longitude": "{{longitude}}",
                "level": "{{level}}",
                "desc": "{{description}}",
            },
        },
        "retry_policy": {"max_retries": 3, "backoff": "exponential"},
    }


@app.post("/admin/source/list")
async def source_list(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    sources = await repo.list_sources()
    return {"status": "ok", "sources": sources}


@app.post("/admin/source/init")
async def source_init(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Create Redis keys for a new source (mapping + flighthub config + inbound auth) if absent."""
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    if not source:
        return {"status": "error", "message": "missing source"}

    # If already exists, keep as-is unless force=true
    force = bool(payload.get("force", False))

    existing_map = await repo.get_mapping(source)
    existing_cfg = await repo.get_fhcfg(source)

    if (existing_map.get("mappings") or existing_cfg) and not force:
        return {"status": "ok", "message": "already exists", "source": source}

    await repo.set_mapping(source, _default_mapping())
    await repo.set_fhcfg(source, _default_fhcfg())

    # default inbound auth: disabled until token set
    await repo.set_source_auth(source, {
        "enabled": True,
        "mode": "static_token",
        "header_name": "X-MW-Token",
        "token": "",
    })

    return {"status": "ok", "message": "initialized", "source": source}


@app.post("/admin/token/extract")
async def token_extract(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Helper endpoint for GUI: paste raw headers / curl / JSON, extract token fields.

    Note: this is for FlightHub2 auth trio extraction, not middleware inbound auth.
    """
    _require_admin(x_admin_token)
    raw = str(payload.get("raw") or "")
    extracted = _extract_tokens(raw)
    return {"status": "ok", "extracted": extracted}


@app.post("/admin/source/auth/get")
async def source_auth_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    if not source:
        return {"status": "error", "message": "missing source"}

    cfg = await repo.get_source_auth(source)

    # mask token on read
    def mask(v: str):
        if not v or len(v) < 8:
            return "****"
        return v[:3] + "****" + v[-3:]

    if isinstance(cfg, dict) and "token" in cfg:
        cfg = dict(cfg)
        cfg["token"] = mask(str(cfg.get("token") or ""))

    return {"status": "ok", "source": source, "auth": cfg}


@app.post("/admin/source/auth/set")
async def source_auth_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    cfg = payload.get("auth")
    if not source or cfg is None:
        return {"status": "error", "message": "missing source or auth"}

    await repo.set_source_auth(source, cfg)
    return {"status": "ok"}


@app.post("/admin/mapping/get")
async def mapping_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    if not source:
        return {"status": "error", "message": "missing source"}

    mapping = await repo.get_mapping(source)
    return {"status": "ok", "source": source, "mapping": mapping}


@app.post("/admin/mapping/set")
async def mapping_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    mapping = payload.get("mapping")
    if not source or mapping is None:
        return {"status": "error", "message": "missing source or mapping"}

    await repo.set_mapping(source, mapping)
    return {"status": "ok"}


@app.post("/admin/flighthub/get")
async def flighthub_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    if not source:
        return {"status": "error", "message": "missing source"}

    cfg = await repo.get_fhcfg(source)

    # mask secrets on read
    def mask(v: str):
        if not v or len(v) < 8:
            return "****"
        return v[:4] + "****" + v[-4:]

    if isinstance(cfg, dict):
        headers = cfg.get("headers")
        if isinstance(headers, dict):
            if "X-User-Token" in headers:
                headers = dict(headers)
                headers["X-User-Token"] = mask(str(headers["X-User-Token"]))
                cfg = dict(cfg)
                cfg["headers"] = headers

    return {"status": "ok", "source": source, "config": cfg}


@app.post("/admin/flighthub/set")
async def flighthub_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    cfg = payload.get("config")
    if not source or cfg is None:
        return {"status": "error", "message": "missing source or config"}

    await repo.set_fhcfg(source, cfg)
    return {"status": "ok"}
