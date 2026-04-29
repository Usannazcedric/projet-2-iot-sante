from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    redis_url: str
    influx_url: str
    influx_token: str
    influx_org: str
    influx_bucket: str
    api_port: int
    log_level: str
    demo_mode: bool

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
            influx_url=os.getenv("INFLUX_URL", "http://influxdb:8086"),
            influx_token=os.getenv("INFLUX_TOKEN", "ehpad-token-dev"),
            influx_org=os.getenv("INFLUX_ORG", "ehpad"),
            influx_bucket=os.getenv("INFLUX_BUCKET", "ehpad_vitals"),
            api_port=int(os.getenv("API_PORT", "8000")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            demo_mode=os.getenv("DEMO_MODE", "false").lower() in ("1", "true", "yes"),
        )
