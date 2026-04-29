from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta, timezone
from ..storage.redis import RedisCache


router = APIRouter()
_state: dict[str, object] = {}


def init(cache: RedisCache, influx) -> None:
    _state["cache"] = cache
    _state["influx"] = influx


@router.get("")
async def list_residents():
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    ids = await cache.list_residents()
    out = []
    for rid in sorted(ids):
        s = await cache.get_resident_state(rid)
        if s:
            out.append({"resident_id": rid, **s})
    return out


@router.get("/{resident_id}")
async def get_resident(resident_id: str):
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    state = await cache.get_resident_state(resident_id)
    if state is None:
        raise HTTPException(404, f"resident not found: {resident_id}")
    return {"resident_id": resident_id, **state}


@router.get("/{resident_id}/history")
async def get_history(
    resident_id: str,
    metric: str = Query("vitals"),
    minutes: int = Query(15, ge=1, le=1440),
):
    influx = _state["influx"]
    now = datetime.now(timezone.utc)
    from_iso = (now - timedelta(minutes=minutes)).isoformat()
    to_iso = now.isoformat()
    rows = await influx.query_history(resident_id, metric, from_iso, to_iso)
    return {"resident_id": resident_id, "metric": metric, "rows": rows}


@router.get("/{resident_id}/activity-pattern")
async def get_activity_pattern(
    resident_id: str,
    hours: int = Query(24, ge=1, le=168),
):
    influx = _state["influx"]
    data = await influx.query_activity_pattern(resident_id, hours)
    return {"resident_id": resident_id, "hours": hours, "data": data}
