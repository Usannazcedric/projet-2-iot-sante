from __future__ import annotations
from fastapi import APIRouter, HTTPException
from ..storage.redis import RedisCache

router = APIRouter()
_state: dict[str, object] = {}


def init(cache: RedisCache) -> None:
    _state["cache"] = cache


@router.get("")
async def list_rooms():
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    ids = await cache.list_rooms()
    out = []
    for room_id in sorted(ids):
        s = await cache.get_room_state(room_id)
        if s:
            out.append(s)
    return out


@router.get("/{room_id}")
async def get_room(room_id: str):
    cache: RedisCache = _state["cache"]  # type: ignore[assignment]
    state = await cache.get_room_state(room_id)
    if state is None:
        raise HTTPException(404, f"room not found: {room_id}")
    return state
