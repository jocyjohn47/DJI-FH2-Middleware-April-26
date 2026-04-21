from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os as _os
import secrets
import time
from typing import Any

import re
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse as _FileResponse
from fastapi.responses import HTMLResponse
from redis.asyncio import Redis
from starlette.staticfiles import StaticFiles

from app.config import settings
from app.queue_bus import RedisStreamBus
from app.redis_repo import RedisRepo

app = FastAPI(title="Universal Webhook Middleware (POC)")

# ── Legacy minimal GUI (kept for backward compat) ──────────────────────────────
# Access: GET /ui/
app.mount("/ui", StaticFiles(directory="app/static", html=True), name="ui")

# ── New React Admin Console ────────────────────────────────────────────────────
# Built output: app/static/console/  →  served at /console/
# SPA catch-all: any /console/* path → index.html (client-side routing)
_CONSOLE_DIR = _os.path.join(_os.path.dirname(__file__), "static", "console")

if _os.path.isdir(_CONSOLE_DIR):
    app.mount(
        "/console/assets",
        StaticFiles(directory=_os.path.join(_CONSOLE_DIR, "assets")),
        name="console-assets",
    )

    @app.get("/console/{full_path:path}", include_in_schema=False)
    async def serve_console(full_path: str):  # noqa: ARG001
        index = _os.path.join(_CONSOLE_DIR, "index.html")
        return _FileResponse(index)

    @app.get("/console", include_in_schema=False)
    async def serve_console_root():
        index = _os.path.join(_CONSOLE_DIR, "index.html")
        return _FileResponse(index)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Suppress browser 404 noise for favicon requests."""
    from fastapi.responses import Response
    return Response(status_code=204)


_TOKEN_PATTERNS = {
    "X-User-Token": [
        re.compile(r"(?im)^\s*X-User-Token\s*:\s*([^\r\n]+)\s*$"),
        re.compile(r'(?i)"X-User-Token"\s*:\s*"([^"]+)"'),
        re.compile(r"(?i)\bX-User-Token\b\s*=\s*([^\s;]+)"),
    ],
    "x-project-uuid": [
        re.compile(r"(?im)^\s*x-project-uuid\s*:\s*([^\r\n]+)\s*$"),
        re.compile(r'(?i)"x-project-uuid"\s*:\s*"([^"]+)"'),
        re.compile(r"(?i)\bx-project-uuid\b\s*=\s*([^\s;]+)"),
    ],
    "workflow_uuid": [
        re.compile(r'(?i)"workflow_uuid"\s*:\s*"([^"]+)"'),
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


def _cfg(name: str, default: Any = None) -> Any:
    value = getattr(settings, name, None)
    if value not in (None, ""):
        return value
    env_value = _os.getenv(name)
    if env_value not in (None, ""):
        return env_value
    return default


def _admin_signing_secret() -> str:
    return str(
        _cfg("ADMIN_SESSION_SECRET")
        or _cfg("ADMIN_TOKEN")
        or _cfg("ADMIN_PASSWORD")
        or "change-me-admin-session-secret"
    )


def _admin_session_ttl_seconds() -> int:
    try:
        return int(_cfg("ADMIN_SESSION_TTL_SECONDS", 43200))
    except Exception:
        return 43200


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _mint_admin_session(username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": username,
        "role": "admin",
        "iat": now,
        "exp": now + _admin_session_ttl_seconds(),
        "jti": secrets.token_urlsafe(12),
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    sig = hmac.new(_admin_signing_secret().encode(), payload_b64.encode(), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(sig)}"


def _verify_admin_session(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(_admin_signing_secret().encode(), payload_b64.encode(), hashlib.sha256).digest()
        actual_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(actual_sig, expected_sig):
            return None
        payload = json.loads(_b64url_decode(payload_b64).decode())
        if payload.get("role") != "admin":
            return None
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _require_admin(x_admin_token: str | None):
    legacy_token = str(_cfg("ADMIN_TOKEN") or "")
    if legacy_token and x_admin_token == legacy_token:
        return {"sub": "legacy-admin", "role": "admin"}

    session = _verify_admin_session(x_admin_token)
    if session:
        return session

    raise HTTPException(status_code=401, detail="admin authentication required")


def _normalize_vms_type(value: Any) -> str:
    s = str(value or "custom").strip().lower()
    aliases = {
        "hik": "hikvision",
        "hikcentral": "hikvision",
        "hcp": "hikvision",
        "custom": "custom",
        "generic": "custom",
    }
    return aliases.get(s, s)


def _default_source_auth_for_vms(vms_type: str) -> dict[str, Any]:
    vt = _normalize_vms_type(vms_type)
    if vt == "hikvision":
        return {
            "enabled": True,
            "mode": "none",
            "header_name": "",
            "token": "",
        }
    return {
        "enabled": True,
        "mode": "static_token",
        "header_name": "X-MW-Token",
        "token": "",
    }


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


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return default


def _normalize_source_auth_config(
    cfg: dict | None,
    existing: dict | None = None,
) -> dict[str, Any]:
    """
    Normalize UI/admin auth payloads into backend-safe source auth config.

    Supported meanings:
    - enabled=false in UI auth screen  -> auth disabled, but source still enabled
    - mode=none/off/disabled/no_auth   -> auth disabled, but source still enabled
    - header_name='no auth'            -> auth disabled, but source still enabled
    - static token mode                -> require exact header/token match

    Reserved explicit source-disable mode:
    - mode=source_disabled
    """
    existing = existing or {}
    cfg = dict(cfg or {})

    raw_mode = str(cfg.get("mode") or existing.get("mode") or "").strip().lower()
    raw_header = str(
        cfg.get("header_name")
        or cfg.get("header")
        or existing.get("header_name")
        or ""
    ).strip()
    raw_token = str(cfg.get("token") or "")
    enabled_flag = _as_bool(cfg.get("enabled", True), default=True)

    no_auth_aliases = {"none", "no_auth", "no-auth", "off", "disabled", "no auth"}
    disabled_aliases = {"source_disabled", "disabled_source", "blocked", "block"}

    if raw_mode in disabled_aliases:
        return {
            "enabled": False,
            "mode": "source_disabled",
            "header_name": "",
            "token": "",
        }

    wants_no_auth = (
        (cfg.get("enabled") is not None and enabled_flag is False)
        or raw_mode in no_auth_aliases
        or raw_header.lower() in no_auth_aliases
    )

    if wants_no_auth:
        return {
            "enabled": True,
            "mode": "none",
            "header_name": "",
            "token": "",
        }

    header_name = raw_header or str(existing.get("header_name") or "X-MW-Token").strip() or "X-MW-Token"
    token = raw_token or str(existing.get("token") or "")

    return {
        "enabled": True,
        "mode": "static_token",
        "header_name": header_name,
        "token": token,
    }


def _require_source_auth(source: str, request: Request, srcauth: dict):
    """
    Inbound auth rules:
    - enabled=false + mode=source_disabled -> source disabled completely
    - mode=none/off/disabled/no_auth       -> allow request without auth header
    - header_name='no auth'                -> treated as no-auth (legacy/UI compatibility)
    - mode=static_token                    -> require exact header/token match
    """
    if not isinstance(srcauth, dict) or not srcauth:
        raise HTTPException(
            status_code=401,
            detail=f"source_not_registered_or_auth_missing: {source}",
        )

    enabled = _as_bool(srcauth.get("enabled", True), default=True)
    mode = str(srcauth.get("mode") or "static_token").strip().lower()
    header_name = str(srcauth.get("header_name") or "X-MW-Token").strip()

    no_auth_aliases = {"none", "no_auth", "no-auth", "off", "disabled", "no auth"}
    disabled_aliases = {"source_disabled", "disabled_source", "blocked", "block"}

    if not enabled or mode in disabled_aliases:
        raise HTTPException(
            status_code=403,
            detail=f"source_disabled: {source}",
        )

    if mode in no_auth_aliases:
        return

    if header_name.lower() in no_auth_aliases:
        return

    if mode != "static_token":
        raise HTTPException(
            status_code=400,
            detail=f"unsupported_auth_mode: {mode}",
        )

    expected = str(srcauth.get("token") or "")
    got = request.headers.get(header_name) or ""

    if not expected or got != expected:
        raise HTTPException(status_code=401, detail="auth_failed")


def _event_preview(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        return {"summary": str(obj)[:200]}

    coordinates = obj.get("coordinates")
    if not isinstance(coordinates, dict):
        coordinates = {}

    return {
        "alert": obj.get("alertLabel") or obj.get("description") or obj.get("desc") or "",
        "camera": obj.get("camera") or obj.get("creator_id") or obj.get("creator") or "",
        "latitude": obj.get("latitude") or coordinates.get("lat") or "",
        "longitude": obj.get("longitude") or coordinates.get("lng") or "",
    }


def _resolve_source(
    request: Request,
    payload: dict[str, Any],
    source_query: str | None = None,
    source_path: str | None = None,
) -> str:
    return (
        source_path
        or source_query
        or payload.get("source")
        or request.headers.get("x-source")
        or request.headers.get("x-vms-source")
        or settings.DEFAULT_SOURCE
    )


def _extract_webhook_event(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    if isinstance(payload.get("webhook_event"), dict):
        return payload["webhook_event"]

    if isinstance(payload.get("event"), dict):
        return payload["event"]

    if isinstance(payload.get("payload"), dict):
        return payload["payload"]

    if isinstance(payload.get("raw"), dict):
        return payload["raw"]

    return payload


def _auth_failed_status(exc: HTTPException) -> str:
    if exc.status_code in (401, 403):
        return "auth_failed"
    return "rejected"


async def _handle_webhook_ingest(
    payload: dict[str, Any],
    request: Request,
    source_query: str | None = None,
    source_path: str | None = None,
):
    global bus, repo
    assert bus is not None
    assert repo is not None

    src = _resolve_source(
        request=request,
        payload=payload,
        source_query=source_query,
        source_path=source_path,
    )

    webhook_event = _extract_webhook_event(payload)

    received_at = int(time.time())
    preview = _event_preview(webhook_event)

    hdr = {}
    for k in (
        "content-type",
        "user-agent",
        "x-forwarded-for",
        "authorization",
        "x-source",
        "x-vms-source",
    ):
        if k in request.headers:
            hdr[k] = request.headers.get(k)

    try:
        srcauth = await repo.get_source_auth(src)
        _require_source_auth(src, request, srcauth)
    except HTTPException as exc:
        await repo.log_recent_event({
            "ts": received_at,
            "source": src,
            "direction": "receive",
            "stage": "ingress",
            "status": _auth_failed_status(exc),
            "http_status": exc.status_code,
            "preview": preview,
            "request_headers": hdr,
            "error": str(exc.detail),
        })
        raise

    msg = {
        "source": src,
        "received_at": received_at,
        "request": {
            "path": str(request.url.path),
            "method": "POST",
            "headers": hdr,
        },
        "webhook_event": webhook_event,
    }

    await bus.produce(msg)

    await repo.log_recent_event({
        "ts": received_at,
        "source": src,
        "direction": "receive",
        "stage": "ingress",
        "status": "accepted",
        "http_status": 200,
        "preview": preview,
        "request_headers": hdr,
    })

    return {
        "status": "accepted",
        "queue": "redis_stream",
        "stream": settings.STREAM_KEY_RAW,
        "source": src,
    }


@app.post("/webhook")
async def webhook_ingest(
    payload: dict[str, Any],
    request: Request,
    source: str | None = Query(default=None),
):
    """
    Generic webhook endpoint.

    Supports:
    1) Query style:
       POST /webhook?source=scylla

    2) Body style:
       {
         "source": "scylla",
         "webhook_event": {...}
       }

    3) Raw vendor body:
       POST /webhook?source=scylla
       { ...vendor JSON... }

    4) Source header style:
       X-Source: scylla
       or
       X-VMS-Source: scylla
    """
    return await _handle_webhook_ingest(
        payload=payload,
        request=request,
        source_query=source,
    )


@app.post("/webhook/{source_name}")
async def webhook_ingest_by_path(
    source_name: str,
    payload: dict[str, Any],
    request: Request,
):
    """
    Path-based webhook endpoint for vendor/VMS compatibility.

    Example:
      POST /webhook/scylla
    """
    return await _handle_webhook_ingest(
        payload=payload,
        request=request,
        source_path=source_name,
    )


def _default_mapping() -> dict:
    return {
        "mappings": [
            {"src": "$.timestamp", "dst": "timestamp", "type": "string", "default": "", "required": False},
            {"src": "$.creator_id", "dst": "creator_id", "type": "string", "default": "system", "required": True},
            {"src": "$.latitude", "dst": "latitude", "type": "float", "default": 0, "required": True},
            {"src": "$.longitude", "dst": "longitude", "type": "float", "default": 0, "required": True},
            {"src": "$.level", "dst": "level", "type": "int", "default": 3, "required": True},
            {"src": "$.description", "dst": "description", "type": "string", "default": "", "required": False},
            {"src": "$.name", "dst": "name", "type": "string", "default": "", "required": False},
            {"src": "$.params.creator", "dst": "params.creator", "type": "string", "default": "", "required": False},
            {"src": "$.params.latitude", "dst": "params.latitude", "type": "float", "default": 0, "required": False},
            {"src": "$.params.longitude", "dst": "params.longitude", "type": "float", "default": 0, "required": False},
            {"src": "$.params.level", "dst": "params.level", "type": "int", "default": 3, "required": False},
            {"src": "$.params.desc", "dst": "params.desc", "type": "string", "default": "", "required": False},
        ]
    }


def _default_mapping_for_vms(vms_type: str) -> dict:
    _ = _normalize_vms_type(vms_type)
    return _default_mapping()


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
            "name": "{{creator_id}} | {{timestamp}}",
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


def _default_fhcfg_for_vms(vms_type: str) -> dict:
    _ = _normalize_vms_type(vms_type)
    return _default_fhcfg()


def _is_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        s = value.strip()
        if s == "" or s == "****":
            return False
    return True


def _looks_masked(value: Any) -> bool:
    return isinstance(value, str) and "****" in value


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) < 8:
        return "****"
    return value[:4] + "****" + value[-4:]


def _merge_fhcfg(existing: dict | None, incoming: dict | None) -> dict:
    merged: dict[str, Any] = _default_fhcfg()

    def merge_into(dst: dict[str, Any], src_cfg: dict[str, Any] | None):
        if not isinstance(src_cfg, dict):
            return

        if _is_meaningful_value(src_cfg.get("endpoint")):
            dst["endpoint"] = src_cfg["endpoint"]

        src_headers = src_cfg.get("headers")
        if isinstance(src_headers, dict):
            dst_headers = dict(dst.get("headers") or {})
            for hk, hv in src_headers.items():
                if not _is_meaningful_value(hv):
                    continue
                if _looks_masked(hv):
                    continue
                dst_headers[hk] = hv
            dst["headers"] = dst_headers

        src_template = src_cfg.get("template_body")
        if isinstance(src_template, dict):
            dst_template = dict(dst.get("template_body") or {})
            for tk, tv in src_template.items():
                if tk == "params" and isinstance(tv, dict):
                    dst_params = dict(dst_template.get("params") or {})
                    for pk, pv in tv.items():
                        if not _is_meaningful_value(pv):
                            continue
                        if _looks_masked(pv):
                            continue
                        dst_params[pk] = pv
                    dst_template["params"] = dst_params
                else:
                    if not _is_meaningful_value(tv):
                        continue
                    if _looks_masked(tv):
                        continue
                    dst_template[tk] = tv
            dst["template_body"] = dst_template

        src_retry = src_cfg.get("retry_policy")
        if isinstance(src_retry, dict):
            dst_retry = dict(dst.get("retry_policy") or {})
            for rk, rv in src_retry.items():
                if _is_meaningful_value(rv):
                    dst_retry[rk] = rv
            dst["retry_policy"] = dst_retry

        src_autofill = src_cfg.get("autofill")
        if isinstance(src_autofill, dict):
            dst_autofill = dict(dst.get("autofill") or {})
            for ak, av in src_autofill.items():
                if _is_meaningful_value(av):
                    dst_autofill[ak] = av
            if dst_autofill:
                dst["autofill"] = dst_autofill

    merge_into(merged, existing if isinstance(existing, dict) else None)
    merge_into(merged, incoming if isinstance(incoming, dict) else None)
    return merged


def _sanitize_fhcfg_for_ui(cfg: dict | None) -> dict:
    merged = _merge_fhcfg(None, cfg if isinstance(cfg, dict) else {})
    headers = dict(merged.get("headers") or {})
    token = str(headers.get("X-User-Token") or "")
    headers["X-User-Token"] = _mask_secret(token) if token else ""
    merged["headers"] = headers
    merged["token_already_set"] = bool(token)
    merged["project_uuid_already_set"] = bool(headers.get("x-project-uuid"))
    template_body = merged.get("template_body") if isinstance(merged.get("template_body"), dict) else {}
    merged["workflow_uuid_already_set"] = bool(template_body.get("workflow_uuid"))
    return merged


def _get_nested_value(obj: Any, dotted_key: str) -> Any:
    cur = obj
    for part in str(dotted_key).split('.'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _pick_first(obj: Any, keys: list[str]) -> Any:
    for key in keys:
        val = _get_nested_value(obj, key)
        if val is None:
            continue
        if isinstance(val, str) and not val.strip():
            continue
        return val
    return None


def _to_float_safe(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except Exception:
        return default


def _fh2_level(value: Any, default: int = 3) -> int:
    if value in (None, ""):
        return default
    try:
        iv = int(value)
        return max(1, min(5, iv))
    except Exception:
        pass

    s = str(value).strip().lower()
    mapping = {
        "critical": 5,
        "emergency": 5,
        "error": 4,
        "high": 4,
        "warning": 3,
        "warn": 3,
        "medium": 3,
        "info": 2,
        "low": 1,
        "debug": 1,
    }
    return mapping.get(s, default)


def _inject_hikvision_transform(normalized: dict[str, Any] | None, raw: dict[str, Any] | None, received_at: int) -> dict[str, Any]:
    out = dict(normalized or {})
    raw = raw if isinstance(raw, dict) else {}

    camera = _pick_first(out, [
        "alarm_source_name", "camera_name", "camera", "device_name", "deviceName",
        "source_name", "src_name", "channel_name", "cameraName"
    ]) or _pick_first(raw, [
        "alarm_source_name", "camera_name", "camera", "device_name", "deviceName",
        "source_name", "src_name", "channel_name", "cameraName"
    ]) or "Hikvision"

    event_name = _pick_first(out, [
        "event_type_name", "event_name", "eventTypeName", "event_type", "alarm_type",
        "alarm_name", "rule_name", "ruleName", "event"
    ]) or _pick_first(raw, [
        "event_type_name", "event_name", "eventTypeName", "event_type", "alarm_type",
        "alarm_name", "rule_name", "ruleName", "event"
    ]) or "Alarm"

    timestamp_value = _pick_first(out, [
        "timestamp", "event_time", "eventTime", "alarm_time", "alarmTime",
        "start_time", "occur_time", "occurTime", "time"
    ]) or _pick_first(raw, [
        "timestamp", "event_time", "eventTime", "alarm_time", "alarmTime",
        "start_time", "occur_time", "occurTime", "time"
    ])
    if timestamp_value in (None, ""):
        timestamp_value = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(received_at))
    timestamp = str(timestamp_value)

    latitude = _to_float_safe(
        _pick_first(out, ["latitude", "lat", "gps.lat", "coordinates.lat"])
        or _pick_first(raw, ["latitude", "lat", "gps.lat", "coordinates.lat"]),
        0.0,
    )
    longitude = _to_float_safe(
        _pick_first(out, ["longitude", "lng", "lon", "gps.lng", "gps.lon", "coordinates.lng", "coordinates.lon"])
        or _pick_first(raw, ["longitude", "lng", "lon", "gps.lng", "gps.lon", "coordinates.lng", "coordinates.lon"]),
        0.0,
    )
    level = _fh2_level(
        _pick_first(out, ["level", "severity", "event_level", "alarm_level"])
        or _pick_first(raw, ["level", "severity", "event_level", "alarm_level"]),
        3,
    )

    description = str(
        _pick_first(out, ["description", "desc", "message", "alertLabel"])
        or _pick_first(raw, ["description", "desc", "message", "alertLabel"])
        or f"Camera: {camera} | Event: {event_name} | Time: {timestamp}"
    )

    out["creator_id"] = str(camera)
    out["timestamp"] = timestamp
    out["latitude"] = latitude
    out["longitude"] = longitude
    out["level"] = level
    out["description"] = description
    out["name"] = f"{camera} | {timestamp}"
    out["params.creator"] = str(camera)
    out["params.latitude"] = latitude
    out["params.longitude"] = longitude
    out["params.level"] = level
    out["params.desc"] = description
    return out


@app.post("/admin/login")
async def admin_login(payload: dict[str, Any]):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")

    admin_username = str(_cfg("ADMIN_USERNAME", "admin") or "admin")
    admin_password = str(_cfg("ADMIN_PASSWORD", "") or "")

    if not admin_password:
        raise HTTPException(status_code=500, detail="admin username/password not configured")
    if username != admin_username or password != admin_password:
        raise HTTPException(status_code=401, detail="invalid username or password")

    token = _mint_admin_session(username)
    return {
        "status": "ok",
        "token": token,
        "user": {"username": username, "role": "admin"},
        "expires_in": _admin_session_ttl_seconds(),
    }


@app.get("/admin/me")
async def admin_me(x_admin_token: str | None = Header(default=None)):
    session = _require_admin(x_admin_token)
    return {
        "status": "ok",
        "user": {
            "username": session.get("sub", "admin"),
            "role": session.get("role", "admin"),
        },
    }


@app.post("/admin/logout")
async def admin_logout(x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    return {"status": "ok", "message": "delete token client-side to logout"}


@app.post("/admin/source/list")
async def source_list(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    sources = await repo.list_sources()
    return {"status": "ok", "sources": sources}


@app.post("/admin/events/recent")
async def events_recent(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    try:
        limit = int(payload.get("limit", 100))
    except Exception:
        limit = 100

    limit = max(1, min(limit, 100))
    source = str(payload.get("source") or "").strip()

    events = await repo.list_recent_events(limit=limit, source=source)
    return {"status": "ok", "events": events}


@app.post("/admin/source/init")
async def source_init(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Create Redis keys for a new source (mapping + flighthub config + inbound auth) if absent."""
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = str(payload.get("source") or "").strip()
    if not source:
        return {"status": "error", "message": "missing source"}

    vms_type = _normalize_vms_type(payload.get("source_type") or payload.get("vms_type") or source)
    force = bool(payload.get("force", False))

    existing_map = await repo.get_mapping(source)
    existing_cfg = await repo.get_fhcfg(source)

    if (existing_map.get("mappings") or existing_cfg) and not force:
        return {"status": "ok", "message": "already exists", "source": source, "source_type": vms_type}

    await repo.set_mapping(source, _default_mapping_for_vms(vms_type))
    await repo.set_fhcfg(source, _default_fhcfg_for_vms(vms_type))
    await repo.set_source_auth(source, _default_source_auth_for_vms(vms_type))

    return {"status": "ok", "message": "initialized", "source": source, "source_type": vms_type}


@app.post("/admin/source/preset")
async def source_preset(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    _require_admin(x_admin_token)
    vms_type = _normalize_vms_type(payload.get("source_type") or payload.get("vms_type") or payload.get("source") or "custom")
    return {
        "status": "ok",
        "source_type": vms_type,
        "mapping": _default_mapping_for_vms(vms_type),
        "auth": _default_source_auth_for_vms(vms_type),
        "config": _default_fhcfg_for_vms(vms_type),
    }


@app.post("/admin/source/delete")
async def source_delete(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Delete all Redis keys associated with a source (map, fhcfg, srcauth, adapter)."""
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source", "").strip()
    if not source:
        return {"status": "error", "message": "missing source"}

    keys_to_delete = [
        f"uw:map:{source}",
        f"uw:fhcfg:{source}",
        f"uw:srcauth:{source}",
        f"uw:adapter:{source}",
    ]
    deleted = 0
    for key in keys_to_delete:
        n = await repo.redis.delete(key)
        deleted += n

    return {"status": "ok", "source": source, "keys_deleted": deleted}


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
    cfg = _normalize_source_auth_config(cfg, existing=cfg if isinstance(cfg, dict) else None)

    def mask(v: str):
        if not v:
            return ""
        if len(v) < 8:
            return "****"
        return v[:3] + "****" + v[-3:]

    ui_cfg = dict(cfg)

    if ui_cfg.get("mode") == "none":
        ui_cfg["enabled"] = False
        ui_cfg["header_name"] = "no auth"
        ui_cfg["token"] = ""
    elif ui_cfg.get("mode") == "source_disabled":
        ui_cfg["enabled"] = False
        ui_cfg["header_name"] = "disabled"
        ui_cfg["token"] = ""
    else:
        ui_cfg["token"] = mask(str(ui_cfg.get("token") or ""))

    return {"status": "ok", "source": source, "auth": ui_cfg}


@app.post("/admin/source/auth/set")
async def source_auth_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    cfg = payload.get("auth")

    if not source or cfg is None:
        return {"status": "error", "message": "missing source or auth"}

    existing = await repo.get_source_auth(source)
    normalized = _normalize_source_auth_config(
        cfg,
        existing=existing if isinstance(existing, dict) else None,
    )

    await repo.set_source_auth(source, normalized)

    return {
        "status": "ok",
        "source": source,
        "auth": {
            "enabled": normalized.get("enabled", True),
            "mode": normalized.get("mode", "static_token"),
            "header_name": normalized.get("header_name", ""),
        },
    }


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
    return {"status": "ok", "source": source, "config": _sanitize_fhcfg_for_ui(cfg)}


@app.post("/admin/flighthub/set")
async def flighthub_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    cfg = payload.get("config")
    if not source or cfg is None:
        return {"status": "error", "message": "missing source or config"}

    existing = await repo.get_fhcfg(source)
    merged = _merge_fhcfg(existing, cfg)
    await repo.set_fhcfg(source, merged)
    return {"status": "ok", "source": source}


# ════════════════════════════════════════════════════════════════════════════
# ADAPTER  (uw:adapter:{source})
# ════════════════════════════════════════════════════════════════════════════

@app.post("/admin/adapter/get")
async def adapter_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    if not source:
        return {"status": "error", "message": "missing source"}

    cfg = await repo.get_adapter(source)
    return {"status": "ok", "source": source, "adapter": cfg}


@app.post("/admin/adapter/set")
async def adapter_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    source = payload.get("source")
    cfg = payload.get("adapter")
    if not source or cfg is None:
        return {"status": "error", "message": "missing source or adapter"}

    await repo.set_adapter(source, cfg)
    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════════════════
# DEVICE  (uw:device:{device_id})
# ════════════════════════════════════════════════════════════════════════════

@app.post("/admin/device/get")
async def device_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    device_id = payload.get("device_id")
    if not device_id:
        return {"status": "error", "message": "missing device_id"}

    info = await repo.get_device(device_id)
    return {"status": "ok", "device_id": device_id, "device": info}


@app.post("/admin/device/set")
async def device_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    device_id = payload.get("device_id")
    info = payload.get("device")
    if not device_id or info is None:
        return {"status": "error", "message": "missing device_id or device"}

    await repo.set_device(device_id, info)
    return {"status": "ok"}


@app.post("/admin/device/delete")
async def device_delete(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    device_id = payload.get("device_id")
    if not device_id:
        return {"status": "error", "message": "missing device_id"}

    await repo.redis.delete(repo._k_device(device_id))
    return {"status": "ok"}


@app.post("/admin/device/list")
async def device_list(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    device_ids: list[str] = []
    cursor = 0
    while True:
        cursor, keys = await repo.redis.scan(cursor=cursor, match="uw:device:*", count=200)
        for k in keys:
            if isinstance(k, bytes):
                k = k.decode("utf-8", errors="ignore")
            device_ids.append(k[len("uw:device:"):])
        if cursor == 0:
            break

    return {"status": "ok", "devices": sorted(device_ids)}


# ── Device ID Field (per-source) ─────────────────────────────────────────────

@app.post("/admin/deviceidfield/get")
async def device_id_field_get(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Get the payload field used as device lookup key for a source.
    Returns: {"device_id_field": "fieldName"}  (empty string means default 'device_id')
    """
    global repo
    assert repo is not None
    _require_admin(x_admin_token)
    source = payload.get("source", "").strip()
    if not source:
        return {"status": "error", "message": "missing source"}
    field = await repo.get_device_id_field(source)
    return {"status": "ok", "device_id_field": field}


@app.post("/admin/deviceidfield/set")
async def device_id_field_set(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Set the payload field used as device lookup key for a source."""
    global repo
    assert repo is not None
    _require_admin(x_admin_token)
    source = payload.get("source", "").strip()
    field = payload.get("device_id_field", "")
    if not source:
        return {"status": "error", "message": "missing source"}
    await repo.set_device_id_field(source, str(field))
    return {"status": "ok", "source": source}


# ════════════════════════════════════════════════════════════════════════════
# DEBUG  — run full pipeline on a sample payload, return each stage output
# ════════════════════════════════════════════════════════════════════════════

@app.post("/admin/debug/run")
async def debug_run(payload: dict[str, Any], x_admin_token: str | None = Header(default=None)):
    """Dry-run the full processing pipeline without writing to Redis Stream.

    Input:  { source, sample_payload, mapping_override? }
    Output: { raw, flat, normalized, mapped, event, final_body, missing, normalized_fields }

    mapping_override: optional MappingConfig dict — when provided, overrides the Redis-stored
    mapping so the frontend can preview unsaved visual mappings in real-time.
    """
    global repo
    assert repo is not None
    _require_admin(x_admin_token)

    import time as _time
    from app.flatten import flatten_json
    from app.normalize import normalize, get_normalized_fields
    from app.mapping_engine import apply_mappings
    from app.canonical import build_event
    from app.enrichment import enrich
    from app.autofill import autofill, build_fh2_body

    source = payload.get("source") or settings.DEFAULT_SOURCE
    raw: dict = (
        payload.get("sample_payload")
        or payload.get("sample")
        or payload.get("webhook_event")
        or payload.get("event")
        or payload.get("payload")
        or payload.get("raw")
        or {}
    )
    mapping_override: dict | None = payload.get("mapping_override") or None

    stages: dict[str, Any] = {"source": source, "raw": raw}

    try:
        # Stage 1 — flatten
        flat = flatten_json(raw)
        stages["flat"] = flat

        # Stage 2 — normalize (adapter)
        adapter_conf = await repo.get_adapter(source)
        normalized = normalize(flat, adapter_conf)
        received_at = int(_time.time())
        stages["normalized_fields"] = get_normalized_fields(flat, adapter_conf)

        if _normalize_vms_type(source) == "hikvision":
            normalized = _inject_hikvision_transform(normalized, raw, received_at)
            stages["normalized_transformed"] = normalized

        stages["normalized"] = normalized

        # Stage 3 — mapping
        mapping_conf = mapping_override if mapping_override else await repo.get_mapping(source)
        mapped = apply_mappings(raw, source, mapping_conf, received_at, flat_event=normalized)
        stages["mapped"] = mapped

        # Stage 4 — canonical
        event = build_event(mapped, raw, source)

        # Stage 5 — enrichment (read-only)
        event = await enrich(event, repo)
        stages["event"] = event

        # Stage 6 — autofill → final FH2 body
        fhcfg = await repo.get_fhcfg(source)
        device_id = event.get("device_id") or event.get("device", {}).get("id") or ""
        device_info = (await repo.get_device(str(device_id))) if device_id else {}
        autofill_conf = fhcfg.get("autofill", {}) if isinstance(fhcfg, dict) else {}
        workflow_uuid = ""
        if isinstance(fhcfg, dict):
            tb = fhcfg.get("template_body", {})
            if isinstance(tb, dict):
                workflow_uuid = str(tb.get("workflow_uuid", ""))

        # Resolve device_id using per-source field config if standard key not found
        device_id_field = await repo.get_device_id_field(source)
        if not device_id and device_id_field:
            device_id = str(event.get(device_id_field) or flat.get(device_id_field) or "")
            if device_id:
                device_info = await repo.get_device(device_id)

        filled, missing = autofill(event, device_info, autofill_conf)
        final_body = build_fh2_body(filled, workflow_uuid=workflow_uuid)
        stages["final_body"] = final_body
        stages["missing"] = missing
        stages["device_id_field"] = device_id_field

        return {"status": "ok", **stages}

    except Exception as exc:
        return {"status": "error", "message": str(exc), **stages}
