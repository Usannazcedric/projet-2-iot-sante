from __future__ import annotations
from typing import Tuple


VITALS_PREFIX = "ehpad/vitals/resident/"
MOTION_PREFIX = "ehpad/motion/resident/"
AMBIENT_PREFIX = "ehpad/ambient/room/"
DOOR_PREFIX = "ehpad/door/room/"

SUBSCRIBE_PATTERNS: list[str] = [
    "ehpad/vitals/resident/+",
    "ehpad/motion/resident/+",
    "ehpad/ambient/room/+",
    "ehpad/door/room/+",
]


def parse(topic: str) -> Tuple[str, str | None]:
    """Return (family, identifier) for a known topic, or ("other", None)."""
    for prefix, fam in (
        (VITALS_PREFIX, "vitals"),
        (MOTION_PREFIX, "motion"),
        (AMBIENT_PREFIX, "ambient"),
        (DOOR_PREFIX, "door"),
    ):
        if topic.startswith(prefix):
            return fam, topic[len(prefix):]
    return "other", None
