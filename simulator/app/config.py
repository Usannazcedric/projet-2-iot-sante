from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mqtt_host: str
    mqtt_port: int
    api_port: int
    resident_count: int
    demo_mode: bool
    log_level: str
    profiles_path: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            mqtt_host=os.getenv("MQTT_HOST", "mosquitto"),
            mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
            api_port=int(os.getenv("API_PORT", "9100")),
            resident_count=int(os.getenv("RESIDENT_COUNT", "20")),
            demo_mode=os.getenv("DEMO_MODE", "false").lower() == "true",
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            profiles_path=os.getenv("PROFILES_PATH", "/app/profiles.json"),
        )
