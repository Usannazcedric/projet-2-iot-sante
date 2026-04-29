from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
import redis.asyncio as aioredis
from ..models import Alert, AlertLevel
from ..logging import get_logger

log = get_logger("backend.alerts.store")

ACTIVE_SET = "alerts:active"
DETAIL_KEY = "alerts:detail:{id}"
RESIDENT_INDEX = "alerts:by_resident:{resident_id}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AlertStore:
    def __init__(self, redis: aioredis.Redis, influx: Any) -> None:
        self.redis = redis
        self.influx = influx

    async def create(self, resident_id: str, level: AlertLevel, reason: str) -> Alert:
        alert_id = uuid.uuid4().hex
        now = _now_iso()
        alert = Alert(
            id=alert_id,
            resident_id=resident_id,
            level=int(level),
            reason=reason,
            status="active",
            created_at=now,
            updated_at=now,
            last_seen=now,
        )
        await self.redis.set(DETAIL_KEY.format(id=alert_id), alert.model_dump_json())
        await self.redis.sadd(ACTIVE_SET, alert_id)
        await self.redis.set(RESIDENT_INDEX.format(resident_id=resident_id), alert_id)
        await self.influx.write_alert(alert_id, resident_id, int(level), "active", reason, now)
        return alert

    async def get(self, alert_id: str) -> Optional[Alert]:
        raw = await self.redis.get(DETAIL_KEY.format(id=alert_id))
        if raw is None:
            return None
        return Alert.model_validate_json(raw)

    async def list_active(self) -> list[Alert]:
        ids = list(await self.redis.smembers(ACTIVE_SET))
        out: list[Alert] = []
        for aid in ids:
            a = await self.get(aid)
            if a is not None:
                out.append(a)
        return out

    async def get_active_for_resident(self, resident_id: str) -> Optional[Alert]:
        aid = await self.redis.get(RESIDENT_INDEX.format(resident_id=resident_id))
        if aid is None:
            return None
        a = await self.get(aid)
        if a is None or a.status == "resolved":
            return None
        return a

    async def update_level(self, alert_id: str, level: AlertLevel, reason: str) -> Optional[Alert]:
        a = await self.get(alert_id)
        if a is None:
            return None
        a.level = int(level)
        a.reason = reason
        a.updated_at = _now_iso()
        a.last_seen = a.updated_at
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())
        await self.influx.write_alert(a.id, a.resident_id, a.level, a.status, a.reason, a.updated_at)
        return a

    async def refresh(self, alert_id: str) -> None:
        a = await self.get(alert_id)
        if a is None:
            return
        a.last_seen = _now_iso()
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())

    async def set_status(self, alert_id: str, status: str, *, by: str | None = None) -> Optional[Alert]:
        if status not in ("active", "acknowledged", "resolved"):
            raise ValueError(f"invalid status: {status}")
        a = await self.get(alert_id)
        if a is None:
            return None
        a.status = status
        a.updated_at = _now_iso()
        if by:
            a.acknowledged_by = by
        await self.redis.set(DETAIL_KEY.format(id=alert_id), a.model_dump_json())
        if status == "resolved":
            await self.redis.srem(ACTIVE_SET, alert_id)
            await self.redis.delete(RESIDENT_INDEX.format(resident_id=a.resident_id))
        await self.influx.write_alert(a.id, a.resident_id, a.level, a.status, a.reason, a.updated_at)
        return a
