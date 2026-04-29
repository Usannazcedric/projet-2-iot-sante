from __future__ import annotations
from typing import Optional, Tuple
from ..models import AlertLevel
from ..profiles import is_disoriented, name_of


def evaluate_fugue(
    resident_id: str,
    state: dict,
    room_state: Optional[dict],
) -> Optional[Tuple[AlertLevel, str]]:
    """Detect potential fugue (escape).

    Two trigger paths (require room door open):
      1. simulator scenario "fugue" is active (explicit demo trigger).
      2. resident is cognitively impaired (alzheimer/dementia) AND
         currently walking out of their room (organic detection).
    Returns L4 URGENCE alert when triggered, else None.
    """
    if room_state is None or int(room_state.get("door", 0)) != 1:
        return None

    scenario = state.get("scenario")
    if scenario == "fugue":
        return (
            AlertLevel.URGENCE,
            f"fugue détectée — {name_of(resident_id)} sortie de chambre sans surveillance",
        )

    if not is_disoriented(resident_id):
        return None
    motion = state.get("motion") or {}
    if motion.get("activity") != "walking":
        return None
    return (
        AlertLevel.URGENCE,
        f"fugue suspectée — {name_of(resident_id)} (désorienté) sortie de chambre sans surveillance",
    )
