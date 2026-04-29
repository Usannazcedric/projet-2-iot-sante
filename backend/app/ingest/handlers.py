from __future__ import annotations
import json
from typing import Any
from ..models import VitalsPayload, MotionPayload
from ..storage.redis import RedisCache
from ..logging import get_logger

log = get_logger("backend.ingest")


async def handle(family: str, key: str, raw: str | bytes, cache: RedisCache, influx: Any) -> None:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("invalid_json", family=family, key=key)
        return
    try:
        if family == "vitals":
            await _handle_vitals(data, cache, influx)
        elif family == "motion":
            await _handle_motion(data, cache, influx)
        # ambient/door deliberately ignored at this stage
    except Exception as exc:  # noqa: BLE001 -- log and recover; ingest must never crash
        log.error("handler_failed", family=family, key=key, err=str(exc))


async def _handle_vitals(data: dict[str, Any], cache: RedisCache, influx: Any) -> None:
    payload = VitalsPayload.model_validate(data)
    await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "vitals": payload.values.model_dump(),
    })
    await influx.write_vitals(payload.resident_id, payload.timestamp, payload.values.model_dump())


async def _handle_motion(data: dict[str, Any], cache: RedisCache, influx: Any) -> None:
    payload = MotionPayload.model_validate(data)
    await cache.merge_resident_state(payload.resident_id, {
        "last_seen": payload.timestamp,
        "motion": payload.values.model_dump(),
    })
    await influx.write_motion(payload.resident_id, payload.timestamp, payload.values.model_dump())
