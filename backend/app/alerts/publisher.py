from __future__ import annotations
from typing import Any
from ..models import Alert
from ..logging import get_logger

log = get_logger("backend.alerts.publisher")


class AlertPublisher:
    """Wraps the existing MQTT client to publish alert events."""

    def __init__(self, mqtt_client: Any) -> None:
        self._mqtt = mqtt_client

    async def publish_new(self, alert: Alert) -> None:
        try:
            self._mqtt.publish("ehpad/alerts/new", alert.model_dump_json(), qos=1)
        except Exception as exc:  # noqa: BLE001
            log.error("publish_new_failed", alert_id=alert.id, err=str(exc))

    async def publish_update(self, alert: Alert) -> None:
        try:
            self._mqtt.publish(f"ehpad/alerts/update/{alert.id}", alert.model_dump_json(), qos=1)
        except Exception as exc:  # noqa: BLE001
            log.error("publish_update_failed", alert_id=alert.id, err=str(exc))
