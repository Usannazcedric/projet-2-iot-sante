from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from fastapi import FastAPI
from .config import Settings
from .logging import configure_logging, get_logger
from .profiles import load_profiles
from .resident import Resident
from .publisher import Publisher
from . import api


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("simulator")

app = FastAPI(title="EHPAD Simulator")
app.include_router(api.router)

_publisher: Publisher | None = None
_residents: dict[str, Resident] = {}
_tasks: list[asyncio.Task] = []


async def vitals_loop(resident: Resident) -> None:
    while True:
        now = datetime.now(timezone.utc)
        sc = getattr(resident, "_active_scenario", None)
        if sc is not None:
            try:
                sc.apply(resident, now)
                if sc.is_done(now):
                    resident._active_scenario = None  # type: ignore[attr-defined]
                    resident.scenario = "normal"
            except Exception as exc:
                log.error("scenario_apply_failed", resident_id=resident.profile.id, err=str(exc))
        reading = resident.tick(now)
        if _publisher is not None:
            _publisher.publish(f"ehpad/vitals/resident/{resident.profile.id}", reading, qos=0)
        await asyncio.sleep(1.0)


async def motion_loop(resident: Resident) -> None:
    while True:
        now = datetime.now(timezone.utc)
        reading = resident.tick_motion(now)
        if _publisher is not None:
            _publisher.publish(f"ehpad/motion/resident/{resident.profile.id}", reading, qos=0)
        await asyncio.sleep(0.2)


@app.on_event("startup")
async def on_startup() -> None:
    global _publisher
    profiles = load_profiles(settings.profiles_path)[: settings.resident_count]
    for p in profiles:
        _residents[p.id] = Resident.from_profile(p, seed=hash(p.id) & 0xFFFFFFFF)
    api.init(_residents, settings.demo_mode)
    _publisher = Publisher(settings.mqtt_host, settings.mqtt_port)
    await _publisher.start()
    log.info("publisher_connected", host=settings.mqtt_host, port=settings.mqtt_port)
    for r in _residents.values():
        _tasks.append(asyncio.create_task(vitals_loop(r)))
        _tasks.append(asyncio.create_task(motion_loop(r)))
    log.info("simulator_ready", residents=len(_residents), demo_mode=settings.demo_mode)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for t in _tasks:
        t.cancel()
    if _publisher is not None:
        await _publisher.stop()
