from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from .resident import Resident
from .scenarios import build


router = APIRouter()
_residents: dict[str, Resident] = {}
_demo_mode: bool = False


def init(residents: dict[str, Resident], demo_mode: bool) -> None:
    global _residents, _demo_mode
    _residents = residents
    _demo_mode = demo_mode


class ScenarioBody(BaseModel):
    name: str


@router.get("/health")
def health():
    return {"status": "ok", "residents": len(_residents)}


@router.get("/residents")
def list_residents():
    return [r.profile.model_dump() for r in _residents.values()]


@router.post("/scenario/{resident_id}")
def inject_scenario(resident_id: str, body: ScenarioBody):
    if resident_id not in _residents:
        raise HTTPException(404, f"unknown resident {resident_id}")
    try:
        scenario = build(body.name, demo_mode=_demo_mode)
    except KeyError:
        raise HTTPException(400, f"unknown scenario {body.name}")
    r = _residents[resident_id]
    from datetime import datetime, timezone
    scenario.apply(r, datetime.now(timezone.utc))
    r._active_scenario = scenario  # type: ignore[attr-defined]
    return {"resident_id": resident_id, "scenario": body.name}
