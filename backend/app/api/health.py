from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from ..storage.redis import RedisCache


router = APIRouter()
_state: dict[str, object] = {}


def init(cache: RedisCache, mqtt_event, influx) -> None:
    _state["cache"] = cache
    _state["mqtt_event"] = mqtt_event
    _state["influx"] = influx


@router.get("/health")
async def health():
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    mqtt_event = _state["mqtt_event"]
    influx = _state["influx"]
    try:
        await cache.client.ping()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"redis: {exc}")
    if not mqtt_event.is_set():
        raise HTTPException(503, "mqtt: not connected")
    try:
        ok = influx.ping()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"influx: {exc}")
    if not ok:
        raise HTTPException(503, "influx: ping=false")
    return {"status": "ok"}
