from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter

router = APIRouter()

_STAFF = [
    {"id": "S001", "name": "Sophie Martin", "role": "Infirmière", "wing": "A", "shift": "matin"},
    {"id": "S002", "name": "Pierre Dubois", "role": "Aide-soignant", "wing": "A", "shift": "matin"},
    {"id": "S003", "name": "Nathalie Bernard", "role": "Aide-soignante", "wing": "A", "shift": "après-midi"},
    {"id": "S004", "name": "Thomas Leroy", "role": "Infirmier", "wing": "A", "shift": "nuit"},
    {"id": "S005", "name": "Marie Lambert", "role": "Infirmière", "wing": "B", "shift": "matin"},
    {"id": "S006", "name": "François Moreau", "role": "Aide-soignant", "wing": "B", "shift": "matin"},
    {"id": "S007", "name": "Claire Fontaine", "role": "Aide-soignante", "wing": "B", "shift": "après-midi"},
    {"id": "S008", "name": "Laurent Girard", "role": "Infirmier", "wing": "B", "shift": "nuit"},
    {"id": "S009", "name": "Dr. Isabelle Dupont", "role": "Médecin coordinateur", "wing": "toutes", "shift": "matin"},
    {"id": "S010", "name": "Élise Rousseau", "role": "Cadre de santé", "wing": "toutes", "shift": "matin"},
]


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
    return [
        {**s, "on_duty": s["shift"] == current or s["wing"] == "toutes"}
        for s in _STAFF
    ]
