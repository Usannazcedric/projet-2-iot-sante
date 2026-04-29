from __future__ import annotations
import asyncio
from typing import Awaitable, Callable
import paho.mqtt.client as mqtt
from .topics import SUBSCRIBE_PATTERNS, parse


Dispatch = Callable[[str, str, bytes], Awaitable[None]]


class MqttClient:
    def __init__(self, host: str, port: int, dispatch: Dispatch, client_id: str = "ehpad-backend") -> None:
        self.host = host
        self.port = port
        self.dispatch = dispatch
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=client_id)
        self.connected = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            for p in SUBSCRIBE_PATTERNS:
                client.subscribe(p, qos=0)
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self.connected.set)

    def _on_disconnect(self, client, userdata, *args, **kwargs):
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self.connected.clear)

    def _on_message(self, client, userdata, msg):
        if self._loop is None:
            return
        family, key = parse(msg.topic)
        if key is None:
            return
        asyncio.run_coroutine_threadsafe(
            self.dispatch(family, key, msg.payload),
            self._loop,
        )

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()
        await asyncio.wait_for(self.connected.wait(), timeout=15)

    async def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()
