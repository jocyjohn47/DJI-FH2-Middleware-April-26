import json
from typing import Any
from redis.asyncio import Redis


class RedisRepo:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def list_sources(self) -> list[str]:
        """List sources that have mapping and/or flighthub config."""
        sources: set[str] = set()

        cursor = 0
        for prefix in ("uw:map:", "uw:fhcfg:"):
            cursor = 0
            while True:
                cursor, keys = await self.redis.scan(cursor=cursor, match=f"{prefix}*", count=200)
                for k in keys:
                    if isinstance(k, bytes):
                        k = k.decode("utf-8", errors="ignore")
                    if isinstance(k, str) and k.startswith(prefix):
                        sources.add(k[len(prefix):])
                if cursor == 0:
                    break

        return sorted(sources)

    @staticmethod
    def _k_map(source: str) -> str:
        return f"uw:map:{source}"

    @staticmethod
    def _k_fhcfg(source: str) -> str:
        return f"uw:fhcfg:{source}"

    @staticmethod
    def _k_srcauth(source: str) -> str:
        return f"uw:srcauth:{source}"

    @staticmethod
    def _k_adapter(source: str) -> str:
        return f"uw:adapter:{source}"

    @staticmethod
    def _k_device(device_id: str) -> str:
        return f"uw:device:{device_id}"

    @staticmethod
    def _k_device_id_field(source: str) -> str:
        return f"uw:deviceidfield:{source}"

    @staticmethod
    def _k_recent_events() -> str:
        return "uw:events:recent"

    async def get_mapping(self, source: str) -> dict:
        raw = await self.redis.get(self._k_map(source))
        if not raw:
            return {"mappings": []}
        return json.loads(raw)

    async def set_mapping(self, source: str, mapping: dict) -> None:
        await self.redis.set(self._k_map(source), json.dumps(mapping, ensure_ascii=False))

    async def get_fhcfg(self, source: str) -> dict:
        raw = await self.redis.get(self._k_fhcfg(source))
        if not raw:
            return {}
        return json.loads(raw)

    async def set_fhcfg(self, source: str, cfg: dict) -> None:
        await self.redis.set(self._k_fhcfg(source), json.dumps(cfg, ensure_ascii=False))

    async def get_source_auth(self, source: str) -> dict:
        raw = await self.redis.get(self._k_srcauth(source))
        if not raw:
            return {}
        return json.loads(raw)

    async def set_source_auth(self, source: str, cfg: dict) -> None:
        await self.redis.set(self._k_srcauth(source), json.dumps(cfg, ensure_ascii=False))

    async def get_adapter(self, source: str) -> dict:
        raw = await self.redis.get(self._k_adapter(source))
        if not raw:
            return {}
        return json.loads(raw)

    async def set_adapter(self, source: str, cfg: dict) -> None:
        await self.redis.set(self._k_adapter(source), json.dumps(cfg, ensure_ascii=False))

    async def get_device(self, device_id: str) -> dict:
        raw = await self.redis.get(self._k_device(device_id))
        if not raw:
            return {}
        return json.loads(raw)

    async def set_device(self, device_id: str, info: dict) -> None:
        await self.redis.set(self._k_device(device_id), json.dumps(info, ensure_ascii=False))

    async def get_device_id_field(self, source: str) -> str:
        raw = await self.redis.get(self._k_device_id_field(source))
        if not raw:
            return ""
        val = json.loads(raw)
        return str(val) if val else ""

    async def set_device_id_field(self, source: str, field: str) -> None:
        await self.redis.set(self._k_device_id_field(source), json.dumps(field, ensure_ascii=False))

    async def log_recent_event(self, event: dict[str, Any], max_items: int = 100) -> None:
        key = self._k_recent_events()
        raw = json.dumps(event, ensure_ascii=False)
        await self.redis.lpush(key, raw)
        await self.redis.ltrim(key, 0, max_items - 1)

    async def list_recent_events(self, limit: int = 100, source: str = "") -> list[dict[str, Any]]:
        key = self._k_recent_events()
        rows = await self.redis.lrange(key, 0, max(0, limit - 1))
        out: list[dict[str, Any]] = []

        for row in rows:
            try:
                item = json.loads(row)
            except Exception:
                continue

            if source and item.get("source") != source:
                continue

            out.append(item)

        return out
