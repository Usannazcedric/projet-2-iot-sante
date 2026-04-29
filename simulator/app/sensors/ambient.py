from __future__ import annotations
from typing import TypedDict
import numpy as np


class PIR(TypedDict):
    type: str
    value: int


class DoorEvent(TypedDict):
    type: str
    value: int


def pir(motion: bool, rng: np.random.Generator) -> PIR:
    return PIR(type="pir", value=1 if motion else 0)


def door(opened: bool) -> DoorEvent:
    return DoorEvent(type="door", value=1 if opened else 0)
