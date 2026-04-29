from __future__ import annotations
import asyncio
from typing import Any
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import ASYNCHRONOUS


class InfluxWriter:
    def __init__(self, url: str, token: str, org: str, bucket: str) -> None:
        self._client = InfluxDBClient(url=url, token=token, org=org)
        self._write = self._client.write_api(write_options=ASYNCHRONOUS)
        self.bucket = bucket
        self.org = org

    def ping(self) -> bool:
        return self._client.ping()

    def close(self) -> None:
        self._write.close()
        self._client.close()

    async def write_vitals(self, resident_id: str, ts: str, values: dict[str, Any]) -> None:
        p = (
            Point("vitals")
            .tag("resident_id", resident_id)
            .field("hr", int(values["hr"]))
            .field("spo2", int(values["spo2"]))
            .field("sys", int(values["sys"]))
            .field("dia", int(values["dia"]))
            .field("temp", float(values["temp"]))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def write_motion(self, resident_id: str, ts: str, values: dict[str, Any]) -> None:
        p = (
            Point("motion")
            .tag("resident_id", resident_id)
            .tag("activity", str(values.get("activity", "unknown")))
            .field("ax", float(values["ax"]))
            .field("ay", float(values["ay"]))
            .field("az", float(values["az"]))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def write_risk(self, resident_id: str, ts: str, anomaly: float, trend: float, combined: float) -> None:
        p = (
            Point("risk")
            .tag("resident_id", resident_id)
            .field("anomaly", float(anomaly))
            .field("trend", float(trend))
            .field("combined", float(combined))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def write_alert(self, alert_id: str, resident_id: str, level: int, status: str, reason: str, ts: str) -> None:
        p = (
            Point("alerts")
            .tag("resident_id", resident_id)
            .tag("alert_id", alert_id)
            .tag("status", status)
            .field("level", int(level))
            .field("reason", str(reason))
            .time(ts)
        )
        await asyncio.to_thread(self._write.write, bucket=self.bucket, org=self.org, record=p)

    async def query_activity_pattern(self, resident_id: str, hours: int = 24) -> list[dict[str, Any]]:
        qa = self._client.query_api()
        flux = (
            f'from(bucket:"{self.bucket}") '
            f'|> range(start: -{hours}h) '
            f'|> filter(fn: (r) => r._measurement == "motion" '
            f'    and r["resident_id"] == "{resident_id}" '
            f'    and r._field == "ax") '
            f'|> group(columns: ["resident_id", "activity"]) '
            f'|> aggregateWindow(every: 30m, fn: count, createEmpty: false) '
            f'|> group() '
            f'|> sort(columns: ["_time"]) '
        )
        tables = await asyncio.to_thread(qa.query, flux, org=self.org)
        from collections import defaultdict
        slots: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for table in tables:
            for record in table.records:
                t = record.get_time()
                if t is None:
                    continue
                minute = (t.minute // 30) * 30
                slot = t.replace(minute=minute, second=0, microsecond=0).isoformat()
                activity = str(record.values.get("activity", "unknown"))
                count = int(record.get_value() or 0)
                slots[slot][activity] += count
        return [{"hour": h, **dict(acts)} for h, acts in sorted(slots.items())]

    async def query_history(self, resident_id: str, metric: str, from_iso: str, to_iso: str) -> list[dict[str, Any]]:
        qa = self._client.query_api()
        flux = (
            f'from(bucket:"{self.bucket}") '
            f'|> range(start: {from_iso}, stop: {to_iso}) '
            f'|> filter(fn: (r) => r._measurement == "{metric}") '
            f'|> filter(fn: (r) => r["resident_id"] == "{resident_id}") '
        )
        tables = await asyncio.to_thread(qa.query, flux, org=self.org)
        rows: list[dict[str, Any]] = []
        for table in tables:
            for record in table.records:
                rows.append({
                    "time": record.get_time().isoformat() if record.get_time() else None,
                    "field": record.get_field(),
                    "value": record.get_value(),
                    "resident_id": record.values.get("resident_id"),
                })
        return rows
