from __future__ import annotations
import asyncio
from typing import Any
from .rules import evaluate
from .store import AlertStore
from ..logging import get_logger

log = get_logger("backend.alerts.engine")


class AlertEngine:
    def __init__(self, store: AlertStore, publisher: Any, escalation: Any) -> None:
        self.store = store
        self.publisher = publisher
        self.escalation = escalation
        self._running = False

    async def evaluate_resident(self, resident_id: str, state: dict) -> None:
        result = evaluate(state)
        existing = await self.store.get_active_for_resident(resident_id)

        if result is None:
            if existing is not None:
                await self.store.refresh(existing.id)
            return

        new_level, reason = result

        if existing is None:
            alert = await self.store.create(resident_id, new_level, reason)
            await self.publisher.publish_new(alert)
            try:
                self.escalation.schedule(alert.id, alert.level, self._on_escalate)
            except Exception as exc:  # noqa: BLE001
                log.error("schedule_failed", alert_id=alert.id, err=str(exc))
            return

        if int(new_level) > existing.level:
            updated = await self.store.update_level(existing.id, new_level, reason)
            if updated is not None:
                await self.publisher.publish_update(updated)
                try:
                    self.escalation.cancel(existing.id)
                    self.escalation.schedule(updated.id, updated.level, self._on_escalate)
                except Exception as exc:  # noqa: BLE001
                    log.error("reschedule_failed", alert_id=existing.id, err=str(exc))
            return

        # equal or lower → sticky; refresh last_seen
        await self.store.refresh(existing.id)

    async def _on_escalate(self, alert_id: str, new_level: int, reason: str) -> None:
        updated = await self.store.update_level(alert_id, new_level, reason)
        if updated is not None:
            await self.publisher.publish_update(updated)
            # Re-schedule for the next level if still active (chain: L2→L3→L4→L5)
            if updated.status == "active":
                try:
                    self.escalation.schedule(updated.id, updated.level, self._on_escalate)
                except Exception as exc:  # noqa: BLE001
                    log.error("reschedule_after_escalation_failed", alert_id=alert_id, err=str(exc))

    async def loop(self, cache, interval: float = 1.0) -> None:
        self._running = True
        while self._running:
            try:
                ids = await cache.list_residents()
                for rid in ids:
                    state = await cache.get_resident_state(rid)
                    if state:
                        await self.evaluate_resident(rid, state)
            except Exception as exc:  # noqa: BLE001
                log.error("loop_iteration_failed", err=str(exc))
            await asyncio.sleep(interval)

    def stop(self) -> None:
        self._running = False
