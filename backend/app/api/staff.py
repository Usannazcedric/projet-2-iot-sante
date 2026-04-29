from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_state: dict[str, object] = {}

_STAFF = [
    {"id": "S001", "name": "Sophie Martin",    "role": "Infirmière",           "wing": "A", "shift": "matin"},
    {"id": "S002", "name": "Pierre Dubois",     "role": "Aide-soignant",        "wing": "A", "shift": "matin"},
    {"id": "S003", "name": "Nathalie Bernard",  "role": "Aide-soignante",       "wing": "A", "shift": "après-midi"},
    {"id": "S004", "name": "Thomas Leroy",      "role": "Infirmier",            "wing": "A", "shift": "nuit"},
    {"id": "S005", "name": "Marie Lambert",     "role": "Infirmière",           "wing": "B", "shift": "matin"},
    {"id": "S006", "name": "François Moreau",   "role": "Aide-soignant",        "wing": "B", "shift": "matin"},
    {"id": "S007", "name": "Claire Fontaine",   "role": "Aide-soignante",       "wing": "B", "shift": "après-midi"},
    {"id": "S008", "name": "Laurent Girard",    "role": "Infirmier",            "wing": "B", "shift": "nuit"},
    {"id": "S009", "name": "Dr. Isabelle Dupont", "role": "Médecin coordinateur", "wing": "toutes", "shift": "matin"},
    {"id": "S010", "name": "Élise Rousseau",    "role": "Cadre de santé",       "wing": "toutes", "shift": "matin"},
]

_GUARD_KEY = "staff:guard:{wing}"
_DEFAULT_GUARDS: dict[str, str] = {"A": "Sophie Martin", "B": "Marie Lambert"}


def init(cache) -> None:
    _state["cache"] = cache


def _current_shift() -> str:
    h = datetime.now(timezone.utc).hour
    if 5 <= h < 13:
        return "matin"
    if 13 <= h < 21:
        return "après-midi"
    return "nuit"


@router.get("")
async def list_staff():
    current = _current_shift()
    guards = await _get_guards()
    on_guard = set(guards.values())
    return [
        {
            **s,
            "on_duty": s["shift"] == current or s["wing"] == "toutes",
            "is_guard": s["name"] in on_guard,
            "guard_wing": next((w for w, n in guards.items() if n == s["name"]), None),
        }
        for s in _STAFF
    ]


async def _get_guards() -> dict[str, str]:
    cache = _state.get("cache")
    result: dict[str, str] = {}
    for wing in ("A", "B"):
        val = None
        if cache:
            val = await cache.client.get(_GUARD_KEY.format(wing=wing))
        if val:
            result[wing] = val.decode() if isinstance(val, bytes) else str(val)
        else:
            result[wing] = _DEFAULT_GUARDS[wing]
    return result


@router.get("/guard")
async def get_guard():
    return await _get_guards()


class SetGuardBody(BaseModel):
    name: str


@router.post("/guard/{wing}")
async def set_guard(wing: str, body: SetGuardBody):
    if wing not in ("A", "B"):
        raise HTTPException(400, "wing doit être A ou B")
    cache = _state.get("cache")
    if cache:
        await cache.client.set(_GUARD_KEY.format(wing=wing), body.name)
    return {"wing": wing, "guard": body.name}
