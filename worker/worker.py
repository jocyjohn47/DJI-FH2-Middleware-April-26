from __future__ import annotations

import asyncio
import json
import time

import httpx
from redis.asyncio import Redis

from app.config import settings
from app.redis_repo import RedisRepo
from app.mapping_engine import apply_mappings
from app.template_engine import render_obj
# ── Pipeline stages ──────────────────────────────────────────────────────────
from app.flatten import flatten_json
from app.adapter_engine import apply_adapter
from app.enrichment import enrich
from app.canonical import build_event


def _now_ts() -> int:
    return int(time.time())


async def push_flighthub(endpoint: str, headers: dict, body: dict, retry_policy: dict | None):
    max_retries = int((retry_policy or {}).get("max_retries", 3))
    backoff = (retry_policy or {}).get("backoff", "exponential")

    async with httpx.AsyncClient(timeout=20.0) as client:
        for attempt in range(0, max_retries + 1):
            try:
                r = await client.post(endpoint, headers=headers, json=body)
                return r.status_code, r.text
            except Exception as e:
                if attempt >= max_retries:
                    return 0, f"EXCEPTION: {repr(e)}"
                sleep_s = (2 ** attempt) if backoff == "exponential" else 1
                await asyncio.sleep(sleep_s)


async def ensure_group(redis: Redis):
    try:
        await redis.xgroup_create(name=settings.STREAM_KEY_RAW, groupname=settings.STREAM_GROUP, id="0-0", mkstream=True)
    except Exception as e:
        # BUSYGROUP means already exists
        if "BUSYGROUP" not in str(e):
            raise


async def run():
    redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    repo = RedisRepo(redis)

    await ensure_group(redis)

    print(f"[worker] consuming redis stream={settings.STREAM_KEY_RAW} group={settings.STREAM_GROUP} consumer={settings.STREAM_CONSUMER}")

    while True:
        # Read one message at a time, block up to 5s
        resp = await redis.xreadgroup(
            groupname=settings.STREAM_GROUP,
            consumername=settings.STREAM_CONSUMER,
            streams={settings.STREAM_KEY_RAW: ">"},
            count=1,
            block=5000,
        )

        if not resp:
            continue

        for stream_name, messages in resp:
            for msg_id, fields in messages:
                data = fields.get("data")
                try:
                    msg = json.loads(data) if data else {}
                except Exception:
                    msg = {}

                source = msg.get("source") or settings.DEFAULT_SOURCE
                received_at = int(msg.get("received_at") or _now_ts())
                webhook_event = msg.get("webhook_event") or {}

                mapping_conf = await repo.get_mapping(source)
                fhcfg = await repo.get_fhcfg(source)

                endpoint = (fhcfg.get("endpoint") if isinstance(fhcfg, dict) else None) or settings.DEFAULT_FLIGHTHUB_ENDPOINT
                headers = (fhcfg.get("headers") if isinstance(fhcfg, dict) else None) or {}
                template_body = (fhcfg.get("template_body") if isinstance(fhcfg, dict) else None) or {}
                retry_policy = (fhcfg.get("retry_policy") if isinstance(fhcfg, dict) else None) or {"max_retries": 3, "backoff": "exponential"}

                headers = dict(headers)
                headers.setdefault("Content-Type", "application/json")

                # ── NEW: flatten → adapter → mapping → enrich ─────────────
                # Each step is a pure function; failure is caught per-stage.
                # Falls back gracefully: adapter/enrich are no-ops when no
                # config exists in Redis.

                # 1. Flatten nested event into dot-notation dict
                flat = flatten_json(webhook_event)

                # 2. Adapter: normalize field names (no-op if not configured)
                adapter_conf = await repo.get_adapter(source)
                flat = apply_adapter(flat, adapter_conf)

                # 3. Mapping (unchanged call-site; pass flat as extra arg)
                try:
                    unified = apply_mappings(
                        webhook_event, source, mapping_conf, received_at,
                        flat_event=flat,
                    )
                except Exception as e:
                    print(f"[worker] mapping error source={source}: {e}")
                    await redis.xack(settings.STREAM_KEY_RAW, settings.STREAM_GROUP, msg_id)
                    continue

                # 4. Canonical envelope
                event = build_event(unified, webhook_event, source)

                # 5. Enrichment: inject device metadata (no-op if key absent)
                event = await enrich(event, repo)

                ctx = dict(event)
                if isinstance(template_body, dict) and "workflow_uuid" in template_body:
                    ctx["workflow_uuid"] = template_body.get("workflow_uuid")

                body = render_obj(template_body, ctx)

                status, text = await push_flighthub(endpoint, headers, body, retry_policy)
                print(f"[worker] pushed msg_id={msg_id} source={source} http_status={status} name={body.get('name') if isinstance(body, dict) else 'n/a'}")
                if status and status >= 400:
                    print(f"[worker] response: {text[:300]}")

                await redis.xack(settings.STREAM_KEY_RAW, settings.STREAM_GROUP, msg_id)


if __name__ == "__main__":
    asyncio.run(run())
