from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Protocol
from .resident import Resident


class Scenario(Protocol):
    def apply(self, resident: Resident, now: datetime) -> None: ...
    def is_done(self, now: datetime) -> bool: ...


_REGISTRY: dict[str, Callable[[bool], Scenario]] = {}


def register(name: str):
    def deco(factory: Callable[[bool], Scenario]):
        _REGISTRY[name] = factory
        return factory
    return deco


def build(name: str, demo_mode: bool) -> Scenario:
    if name not in _REGISTRY:
        raise KeyError(f"unknown scenario: {name}")
    return _REGISTRY[name](demo_mode)


@dataclass
class Normal:
    deadline: datetime | None = None
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "normal"
    def is_done(self, now: datetime) -> bool:
        return True


@dataclass
class Fall:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=5)
    def apply(self, r: Resident, now: datetime) -> None:
        if self.started is None:
            self.started = now
            r.activity = "falling"
            r.scenario = "fall"
        elif (now - self.started).total_seconds() > 1.0:
            r.activity = "lying"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Cardiac:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=5)
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "cardiac"
        # Cardiac modifies vitals via the sensor pipeline reading r.scenario.
        # Vitals module checks scenario in a follow-up step.
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Wandering:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=10)
    def apply(self, r: Resident, now: datetime) -> None:
        r.scenario = "wandering"
        r.activity = "walking"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@dataclass
class Degradation:
    started: datetime | None = None
    duration: timedelta = timedelta(minutes=30)  # compressed in demo
    def apply(self, r: Resident, now: datetime) -> None:
        if self.started is None:
            self.started = now
        r.scenario = "degradation"
    def is_done(self, now: datetime) -> bool:
        return self.started is not None and (now - self.started) >= self.duration


@register("normal")
def _normal(demo: bool) -> Scenario:
    return Normal()


@register("fall")
def _fall(demo: bool) -> Scenario:
    return Fall(duration=timedelta(seconds=30) if demo else timedelta(minutes=5))


@register("cardiac")
def _cardiac(demo: bool) -> Scenario:
    return Cardiac(duration=timedelta(seconds=30) if demo else timedelta(minutes=5))


@register("wandering")
def _wandering(demo: bool) -> Scenario:
    return Wandering(duration=timedelta(minutes=1) if demo else timedelta(minutes=10))


@register("degradation")
def _degradation(demo: bool) -> Scenario:
    return Degradation(duration=timedelta(minutes=3) if demo else timedelta(minutes=30))
