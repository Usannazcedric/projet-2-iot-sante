from __future__ import annotations

# Static profile registry mirrored from simulator/profiles.json.
# Used for context-aware detection (e.g. fugue) and human-readable summaries.

PROFILES: dict[str, dict] = {
    "R001": {"name": "Marie D.",      "age": 84, "room": "101", "pathologies": ["hypertension"]},
    "R002": {"name": "Jean P.",       "age": 79, "room": "102", "pathologies": []},
    "R003": {"name": "Suzanne L.",    "age": 88, "room": "103", "pathologies": ["alzheimer", "copd"]},
    "R004": {"name": "Pierre M.",     "age": 81, "room": "104", "pathologies": ["diabetes"]},
    "R005": {"name": "Yvette R.",     "age": 91, "room": "105", "pathologies": ["heart_failure"]},
    "R006": {"name": "Michel B.",     "age": 77, "room": "106", "pathologies": []},
    "R007": {"name": "Anne T.",       "age": 85, "room": "107", "pathologies": ["hypertension", "diabetes"]},
    "R008": {"name": "Henri S.",      "age": 83, "room": "108", "pathologies": ["copd", "heart_failure"]},
    "R009": {"name": "Lucienne G.",   "age": 87, "room": "109", "pathologies": ["alzheimer", "hypertension"]},
    "R010": {"name": "Robert F.",     "age": 80, "room": "110", "pathologies": []},
    "R011": {"name": "Denise K.",     "age": 86, "room": "111", "pathologies": ["arthritis"]},
    "R012": {"name": "Georges V.",    "age": 82, "room": "112", "pathologies": ["parkinson"]},
    "R013": {"name": "Paulette H.",   "age": 89, "room": "113", "pathologies": ["dementia"]},
    "R014": {"name": "Bernard A.",    "age": 78, "room": "114", "pathologies": ["diabetes"]},
    "R015": {"name": "Christiane O.", "age": 85, "room": "115", "pathologies": ["osteoporosis"]},
    "R016": {"name": "Andre N.",      "age": 84, "room": "116", "pathologies": ["hypertension"]},
    "R017": {"name": "Madeleine C.",  "age": 90, "room": "117", "pathologies": ["heart_failure", "diabetes"]},
    "R018": {"name": "Roger W.",      "age": 76, "room": "118", "pathologies": []},
    "R019": {"name": "Simone E.",     "age": 88, "room": "119", "pathologies": ["alzheimer"]},
    "R020": {"name": "Claude J.",     "age": 81, "room": "120", "pathologies": ["hypertension"]},
}

DISORIENTING = {"alzheimer", "dementia"}


def is_disoriented(resident_id: str) -> bool:
    p = PROFILES.get(resident_id)
    if p is None:
        return False
    return any(path in DISORIENTING for path in p.get("pathologies", []))


def room_of(resident_id: str) -> str | None:
    p = PROFILES.get(resident_id)
    return p["room"] if p else None


def name_of(resident_id: str) -> str:
    p = PROFILES.get(resident_id)
    return p["name"] if p else resident_id
