from __future__ import annotations
import json
from pathlib import Path
from pydantic import BaseModel, Field


class Baseline(BaseModel):
    hr: int
    spo2: int
    sys: int
    dia: int
    temp: float


class Routine(BaseModel):
    wake: str
    sleep: str
    meals: list[str]


class Profile(BaseModel):
    id: str = Field(pattern=r"^R\d{3}$")
    name: str
    age: int = Field(ge=0, le=120)
    room: str
    mobility: str
    pathologies: list[str]
    baseline: Baseline
    routine: Routine


def load_profiles(path: str | Path) -> list[Profile]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Profile.model_validate(p) for p in raw]
