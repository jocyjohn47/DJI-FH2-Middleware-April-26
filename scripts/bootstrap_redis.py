import asyncio
import os
import sys

# Ensure project root is importable when running as a script
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from redis.asyncio import Redis
from app.config import settings
from app.redis_repo import RedisRepo

DEFAULT_SOURCE = settings.DEFAULT_SOURCE or "flighthub2"

DEFAULT_MAPPING = {
  "mappings": [
    {"src":"$.timestamp","dst":"timestamp","type":"string","default":"","required":False},
    {"src":"$.creator_id","dst":"creator_id","type":"string","default":"system","required":True},
    {"src":"$.latitude","dst":"latitude","type":"float","default":0,"required":True},
    {"src":"$.longitude","dst":"longitude","type":"float","default":0,"required":True},
    {"src":"$.level","dst":"level","type":"string","default":"info","required":True},
    {"src":"$.description","dst":"description","type":"string","default":"","required":False}
  ]
}

DEFAULT_FHCFG = {
  "endpoint": settings.DEFAULT_FLIGHTHUB_ENDPOINT,
  "headers": {
    "Content-Type": "application/json",
    "X-User-Token": "",
    "x-project-uuid": ""
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
      "desc": "{{description}}"
    }
  },
  "retry_policy": {"max_retries": 3, "backoff": "exponential"}
}


async def main():
    r = Redis.from_url(settings.REDIS_URL, decode_responses=False)
    repo = RedisRepo(r)

    existing_mapping = await repo.get_mapping(DEFAULT_SOURCE)
    if not existing_mapping or not existing_mapping.get("mappings"):
        await repo.set_mapping(DEFAULT_SOURCE, DEFAULT_MAPPING)
        print(f"bootstrapped mapping for source={DEFAULT_SOURCE}")
    else:
        print(f"mapping already exists for source={DEFAULT_SOURCE}; keeping existing value")

    existing_fhcfg = await repo.get_fhcfg(DEFAULT_SOURCE)
    if not existing_fhcfg:
        await repo.set_fhcfg(DEFAULT_SOURCE, DEFAULT_FHCFG)
        print(f"bootstrapped flighthub config for source={DEFAULT_SOURCE}")
    else:
        print(f"flighthub config already exists for source={DEFAULT_SOURCE}; keeping existing value")

    await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())
