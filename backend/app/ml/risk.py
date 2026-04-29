from __future__ import annotations
import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from . import anomaly as anomaly_mod
from . import trend as trend_mod
from ..logging import get_logger


log = get_logger("backend.ml.risk")


def compute(resident_id: str, window: list[dict[str, Any]], models_dir: str) -> dict[str, float]:
    a = anomaly_mod.score(resident_id, window, models_dir)
    t = trend_mod.score(window)
    combined = 0.6 * a + 0.4 * t
    return {"anomaly": a, "trend": t, "combined": combined}


class RiskPublisher:
    def __init__(self, cache: Any, mqtt: Any, influx: Any, models_dir: str, interval: float = 30.0) -> None:
        self.cache = cache
        self.mqtt = mqtt
        self.influx = influx
        self.models_dir = models_dir
        self.interval = interval
        self._running = False

    async def tick(self) -> None:
        try:
            ids = await self.cache.list_residents()
        except Exception as exc:  # noqa: BLE001
            log.warning("risk_list_failed", err=str(exc))
            return
        for rid in ids:
            try:
                window = await self.cache.get_ml_window(rid)
                if not window:
                    continue
                scores = compute(rid, window, self.models_dir)
                await self.cache.merge_resident_state(rid, {"risk": scores["combined"]})
                ts = datetime.now(timezone.utc).isoformat()
                payload = json.dumps({
                    "resident_id": rid,
                    "anomaly": scores["anomaly"],
                    "trend": scores["trend"],
                    "combined": scores["combined"],
                    "risk": scores["combined"],
                    "timestamp": ts,
                })
                self.mqtt.publish(f"ehpad/risk/resident/{rid}", payload, qos=0)
                try:
                    await self.influx.write_risk(rid, ts, scores["anomaly"], scores["trend"], scores["combined"])
                except Exception as exc:  # noqa: BLE001
                    log.warning("risk_influx_failed", resident_id=rid, err=str(exc))
            except Exception as exc:  # noqa: BLE001
                log.warning("risk_tick_failed", resident_id=rid, err=str(exc))

    async def loop(self) -> None:
        self._running = True
        log.info("risk_loop_start", interval=self.interval)
        try:
            while self._running:
                await self.tick()
                await asyncio.sleep(self.interval)
        except asyncio.CancelledError:
            pass
        finally:
            log.info("risk_loop_stop")

    def stop(self) -> None:
        self._running = False
