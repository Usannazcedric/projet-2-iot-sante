from __future__ import annotations
import json
from typing import Any
import redis.asyncio as aioredis


STATE_TTL_SECONDS = 60
RESIDENT_KEY = "state:resident:{id}"
RESIDENT_PATTERN = "state:resident:*"
ML_WINDOW_KEY = "ml:window:{id}"
ML_WINDOW_MAX = 900  # 15 min @ 1 Hz


class RedisCache:
    def __init__(self, client: aioredis.Redis) -> None:
        self.client = client

    @classmethod
    async def from_url(cls, url: str) -> "RedisCache":
        client = aioredis.from_url(url, decode_responses=True)
        await client.ping()
        return cls(client=client)

    async def set_resident_state(self, resident_id: str, state: dict[str, Any]) -> None:
        await self.client.set(
            RESIDENT_KEY.format(id=resident_id),
            json.dumps(state),
            ex=STATE_TTL_SECONDS,
        )

    async def get_resident_state(self, resident_id: str) -> dict[str, Any] | None:
        raw = await self.client.get(RESIDENT_KEY.format(id=resident_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def list_residents(self) -> list[str]:
        ids: list[str] = []
        async for key in self.client.scan_iter(match=RESIDENT_PATTERN, count=100):
            ids.append(key.split(":", 2)[-1])
        return ids

    async def merge_resident_state(self, resident_id: str, partial: dict[str, Any]) -> dict[str, Any]:
        current = await self.get_resident_state(resident_id) or {}
        current.update(partial)
        await self.set_resident_state(resident_id, current)
        return current

    async def push_ml_window(self, resident_id: str, sample: dict[str, Any]) -> None:
        key = ML_WINDOW_KEY.format(id=resident_id)
        pipe = self.client.pipeline()
        pipe.lpush(key, json.dumps(sample))
        pipe.ltrim(key, 0, ML_WINDOW_MAX - 1)
        await pipe.execute()

    async def get_ml_window(self, resident_id: str, limit: int = ML_WINDOW_MAX) -> list[dict[str, Any]]:
        key = ML_WINDOW_KEY.format(id=resident_id)
        raw = await self.client.lrange(key, 0, max(0, limit - 1))
        return [json.loads(r) for r in raw]

    async def close(self) -> None:
        await self.client.aclose()
