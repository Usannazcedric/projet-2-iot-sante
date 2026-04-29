from __future__ import annotations
from enum import IntEnum
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


class AlertLevel(IntEnum):
    INFORMATION = 1
    ATTENTION = 2
    ALERTE = 3
    URGENCE = 4
    DANGER_VITAL = 5


class Alert(BaseModel):
    id: str
    resident_id: str
    level: int  # 1..5
    reason: str
    status: str = "active"  # active | acknowledged | resolved
    created_at: str
    updated_at: str
    last_seen: str
