from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from fastapi import FastAPI, Request, Header, Query
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles
import re
from redis.asyncio import Redis

from app.config import settings
from app.redis_repo import RedisRepo
from app.queue_bus import RedisStreamBus

app = FastAPI(title="Universal Webhook Middleware (POC)")

# ── Legacy minimal GUI (kept for backward compat) ──────────────────────────────
# Access: GET /ui/
app.mount("/ui", StaticFiles(directory="app/static", html=True), name="ui")

# ── New React Admin Console ────────────────────────────────────────────────────
# Built output: app/static/console/  →  served at /console/
# SPA catch-all: any /console/* path → index.html (client-side routing)
import os as _os
from fastapi.responses import FileResponse as _FileResponse

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


def _admin_signing_secret() -> str:
    return (
        settings.ADMIN_SESSION_SECRET
        or settings.ADMIN_TOKEN
        or settings.ADMIN_PASSWORD
        or "change-me-admin-session-secret"
    )


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
        "exp": now + int(settings.ADMIN_SESSION_TTL_SECONDS),
        "jti": secrets.token_urlsafe(12),
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    payload_b64 = _b64url_encode(payload_json)
    sig = hmac.new(
        _admin_signing_secret().encode(),
        payload_b64.encode(),
        hashlib.sha256,
    ).digest()
    sig_b64 = _b64url_encode(sig)
    return f"{payload_b64}.{sig_b64}"


def _verify_admin_session(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(
            _admin_signing_secret().encode(),
            payload_b64.encode(),
            hashlib.sha256,
        ).digest()
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
    if settings.ADMIN_TOKEN and x_admin_token == settings.ADMIN_TOKEN:
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


@app.post("/admin/login")
async def admin_login(payload: dict[str, Any]):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")

    if not settings.ADMIN_USERNAME or not settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=500, detail="admin username/password not configured")
    if username != settings.ADMIN_USERNAME or password != settings.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="invalid username or password")

    token = _mint_admin_session(username)
    return {
        "status": "ok",
        "token": token,
        "user": {"username": username, "role": "admin"},
        "expires_in": int(settings.ADMIN_SESSION_TTL_SECONDS),
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
        if _normalize_vms_type(source) == "hikvision":
            normalized = _inject_hikvision_transform(normalized, raw, received_at)
            stages["normalized_transformed"] = normalized
        stages["normalized"] = normalized
        stages["normalized_fields"] = sorted(k for k, v in normalized.items() if v is not None)

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
