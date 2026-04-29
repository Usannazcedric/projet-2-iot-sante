from __future__ import annotations
import asyncio
from typing import Awaitable, Callable, Dict
from ..logging import get_logger

log = get_logger("backend.alerts.escalation")


PROD_DELAYS: Dict[int, float] = {2: 600.0, 3: 300.0, 4: 180.0}
DEMO_DELAYS: Dict[int, float] = {2: 300.0, 3: 180.0, 4: 120.0}


def escalation_delays(demo_mode: bool) -> Dict[int, float]:
    if demo_mode:
        return dict(DEMO_DELAYS)
    return dict(PROD_DELAYS)


EscalateCallback = Callable[[str, int, str], Awaitable[None]]


class EscalationManager:
    def __init__(self, demo_mode: bool = False) -> None:
        self.demo_mode = demo_mode
        self._delays = escalation_delays(demo_mode)
        self._tasks: Dict[str, asyncio.Task] = {}

    def schedule(self, alert_id: str, current_level: int, callback: EscalateCallback) -> None:
        if current_level >= 5:
            return
        delay = self._delays.get(int(current_level))
        if delay is None:
            return
        # Replace any existing timer for this alert
        self.cancel(alert_id)
        next_level = int(current_level) + 1

        async def _runner() -> None:
            try:
                await asyncio.sleep(delay)
                reason = f"auto-escalated L{current_level}->L{next_level} (unacked)"
                await callback(alert_id, next_level, reason)
            except asyncio.CancelledError:
                return
            except Exception as exc:  # noqa: BLE001
                log.error("escalation_callback_failed", alert_id=alert_id, err=str(exc))
            finally:
                self._tasks.pop(alert_id, None)

        task = asyncio.create_task(_runner())
        self._tasks[alert_id] = task

    def cancel(self, alert_id: str) -> None:
        task = self._tasks.pop(alert_id, None)
        if task is not None and not task.done():
            task.cancel()

    def cancel_all(self) -> None:
        for aid in list(self._tasks.keys()):
            self.cancel(aid)
