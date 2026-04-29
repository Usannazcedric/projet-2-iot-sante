from __future__ import annotations
import asyncio
import json
import paho.mqtt.client as mqtt
from typing import Any


class Publisher:
    def __init__(self, host: str, port: int, client_id: str = "ehpad-simulator") -> None:
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=client_id)
        self.host = host
        self.port = port
        self.connected = asyncio.Event()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            asyncio.get_event_loop().call_soon_threadsafe(self.connected.set)

    def _on_disconnect(self, client, userdata, *args, **kwargs):
        asyncio.get_event_loop().call_soon_threadsafe(self.connected.clear)

    async def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()
        await asyncio.wait_for(self.connected.wait(), timeout=15)

    async def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()

    def publish(self, topic: str, payload: dict[str, Any], qos: int = 0) -> None:
        self.client.publish(topic, json.dumps(payload), qos=qos)
