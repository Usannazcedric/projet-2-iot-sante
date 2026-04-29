from __future__ import annotations
import asyncio
import random
from datetime import datetime, timezone
from fastapi import FastAPI
from .config import Settings
from .logging import configure_logging, get_logger
from .profiles import load_profiles, Profile
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


_MOBILITY_PROBS = {
    "autonomous":  {"day": 0.55, "night": 0.05},
    "assisted":    {"day": 0.35, "night": 0.03},
    "wheelchair":  {"day": 0.25, "night": 0.02},
    "bedridden":   {"day": 0.06, "night": 0.01},
}


async def ambient_loop(resident: Resident) -> None:
    """Publish PIR and door events — randomised by time-of-day and mobility, independent of scenarios."""
    door_open = False
    door_timer = 0.0
    try:
        wake_h = int(resident.profile.routine.wake.split(":")[0])
        sleep_h = int(resident.profile.routine.sleep.split(":")[0])
    except Exception:
        wake_h, sleep_h = 7, 22
    probs = _MOBILITY_PROBS.get(resident.profile.mobility, _MOBILITY_PROBS["autonomous"])

    while True:
        now = datetime.now(timezone.utc)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        hour = now.hour + now.minute / 60.0

        # Purely random — NOT linked to resident.activity / scenario buttons
        is_awake = wake_h <= hour < sleep_h
        move_prob = probs["day"] if is_awake else probs["night"]
        pir_value = 1 if random.random() < move_prob else 0

        _publisher and _publisher.publish(
            f"ehpad/ambient/room/{resident.profile.room}",
            {"timestamp": ts, "room_id": resident.profile.room,
             "resident_id": resident.profile.id,
             "values": {"type": "pir", "value": pir_value}, "seq": 0},
            qos=0,
        )

        # Door: random open/close events, independent of scenarios
        door_timer -= 5.0
        if door_open and door_timer <= 0:
            door_open = False
        elif not door_open and door_timer <= 0 and random.random() < 0.04:
            door_open = True
            door_timer = random.uniform(4.0, 12.0)

        _publisher and _publisher.publish(
            f"ehpad/door/room/{resident.profile.room}",
            {"timestamp": ts, "room_id": resident.profile.room,
             "resident_id": resident.profile.id,
             "values": {"type": "door", "value": 1 if door_open else 0}, "seq": 0},
            qos=0,
        )

        await asyncio.sleep(5.0)


async def common_areas_loop() -> None:
    """Publish PIR for shared zones: salle commune and corridor."""
    while True:
        now = datetime.now(timezone.utc)
        ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        h = now.hour + now.minute / 60.0

        # Salle commune: busy at meals (8-9, 12-13, 19-20) and activities (10-11, 15-16)
        meal = (8 <= h < 9) or (12 <= h < 13) or (19 <= h < 20)
        activity_time = (10 <= h < 11) or (15 <= h < 16)
        salle_prob = 0.85 if meal else (0.65 if activity_time else (0.3 if 8 <= h < 21 else 0.02))
        pir_salle = 1 if random.random() < salle_prob else 0

        # Couloir: moderately busy during day, quiet at night
        couloir_prob = 0.5 if 7 <= h < 22 else 0.08
        pir_couloir = 1 if random.random() < couloir_prob else 0

        for room_id, pir_val in [("salle_commune", pir_salle), ("couloir", pir_couloir)]:
            _publisher and _publisher.publish(
                f"ehpad/ambient/room/{room_id}",
                {"timestamp": ts, "room_id": room_id, "resident_id": None,
                 "values": {"type": "pir", "value": pir_val}, "seq": 0},
                qos=0,
            )
            _publisher and _publisher.publish(
                f"ehpad/door/room/{room_id}",
                {"timestamp": ts, "room_id": room_id, "resident_id": None,
                 "values": {"type": "door", "value": 0}, "seq": 0},
                qos=0,
            )

        await asyncio.sleep(5.0)


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
        _tasks.append(asyncio.create_task(ambient_loop(r)))
    _tasks.append(asyncio.create_task(common_areas_loop()))
    log.info("simulator_ready", residents=len(_residents), demo_mode=settings.demo_mode)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for t in _tasks:
        t.cancel()
    if _publisher is not None:
        await _publisher.stop()
