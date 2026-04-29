from __future__ import annotations
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


settings = Settings.from_env()
configure_logging(settings.log_level)
log = get_logger("backend")

_cache: RedisCache | None = None
_influx: InfluxWriter | None = None
_mqtt: MqttClient | None = None


async def _dispatch(family: str, key: str, payload: bytes) -> None:
    assert _cache is not None and _influx is not None
    await h.handle(family, key, payload, _cache, _influx)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache, _influx, _mqtt
    _cache = await RedisCache.from_url(settings.redis_url)
    _influx = InfluxWriter(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
        bucket=settings.influx_bucket,
    )
    _mqtt = MqttClient(settings.mqtt_host, settings.mqtt_port, _dispatch)
    await _mqtt.start()
    health_api.init(_cache, _mqtt.connected, _influx)
    residents_api.init(_cache, _influx)
    log.info("backend_ready", redis=settings.redis_url, influx=settings.influx_url, mqtt=settings.mqtt_host)
    try:
        yield
    finally:
        if _mqtt is not None:
            await _mqtt.stop()
        if _influx is not None:
            _influx.close()
        if _cache is not None:
            await _cache.close()


app = FastAPI(title="EHPAD Backend", lifespan=lifespan)
app.include_router(health_api.router)
app.include_router(residents_api.router, prefix="/residents")
