import json
from redis.asyncio import Redis

class RedisRepo:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def list_sources(self) -> list[str]:
        """List sources that have mapping and/or flighthub config."""
        sources: set[str] = set()

        # Prefer SCAN over KEYS (still fine for POC size)
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
