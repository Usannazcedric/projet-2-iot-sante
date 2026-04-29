from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .config import Settings
from .logging import configure_logging, get_logger
from .storage.redis import RedisCache
from .storage.influx import InfluxWriter
from .ingest.client import MqttClient
from .ingest import handlers as h
from .api import health as health_api
from .api import residents as residents_api
from .api import alerts as alerts_api
from .alerts.store import AlertStore
from .alerts.engine import AlertEngine
from .alerts.escalation import EscalationManager
from .alerts.publisher import AlertPublisher


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("backend")

if settings.demo_mode:
    log.warning("DEMO_MODE active — do not run in production")

_cache: RedisCache | None = None
_influx: InfluxWriter | None = None
_mqtt: MqttClient | None = None
_engine: AlertEngine | None = None
_engine_task: asyncio.Task | None = None
_escalation: EscalationManager | None = None


async def _dispatch(family: str, key: str, payload: bytes) -> None:
    assert _cache is not None and _influx is not None
    await h.handle(family, key, payload, _cache, _influx)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache, _influx, _mqtt, _engine, _engine_task, _escalation
    _cache = await RedisCache.from_url(settings.redis_url)
    _influx = InfluxWriter(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
        bucket=settings.influx_bucket,
    )
    _mqtt = MqttClient(settings.mqtt_host, settings.mqtt_port, _dispatch)
    await _mqtt.start()

    store = AlertStore(_cache.client, _influx)
    publisher = AlertPublisher(_mqtt)
    _escalation = EscalationManager(demo_mode=settings.demo_mode)
    _engine = AlertEngine(store=store, publisher=publisher, escalation=_escalation)
    _engine_task = asyncio.create_task(_engine.loop(_cache, interval=1.0))

    health_api.init(_cache, _mqtt.connected, _influx)
    residents_api.init(_cache, _influx)
    alerts_api.init(store, _escalation, publisher)
    log.info("backend_ready",
             redis=settings.redis_url, influx=settings.influx_url, mqtt=settings.mqtt_host,
             demo_mode=settings.demo_mode)
    try:
        yield
    finally:
        if _engine is not None:
            _engine.stop()
        if _engine_task is not None:
            _engine_task.cancel()
            try:
                await _engine_task
            except (asyncio.CancelledError, Exception):
                pass
        if _escalation is not None:
            _escalation.cancel_all()
        if _mqtt is not None:
            await _mqtt.stop()
        if _influx is not None:
            _influx.close()
        if _cache is not None:
            await _cache.close()


app = FastAPI(title="EHPAD Backend", lifespan=lifespan)
app.include_router(health_api.router)
app.include_router(residents_api.router, prefix="/residents")
app.include_router(alerts_api.router, prefix="/alerts")
