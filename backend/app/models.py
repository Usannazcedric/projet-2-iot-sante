from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field


class VitalsValues(BaseModel):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


class MotionValues(BaseModel):
    ax: float
    ay: float
    az: float
    activity: str


class VitalsPayload(BaseModel):
    timestamp: str
    resident_id: str = Field(pattern=r"^R\d{3}$")
    values: VitalsValues
    seq: int


class MotionPayload(BaseModel):
    timestamp: str
    resident_id: str = Field(pattern=r"^R\d{3}$")
    values: MotionValues
    seq: int


class AmbientPayload(BaseModel):
    timestamp: str
    room_id: str | None = None
    resident_id: str | None = None
    values: dict[str, Any]
    seq: int = 0


class ResidentSnapshot(BaseModel):
    resident_id: str
    last_seen: str | None = None
    vitals: VitalsValues | None = None
    motion: MotionValues | None = None
    scenario: str | None = None
