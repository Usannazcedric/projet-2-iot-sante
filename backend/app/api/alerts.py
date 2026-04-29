from __future__ import annotations
from fastapi import APIRouter, HTTPException
from ..alerts.store import AlertStore


router = APIRouter()
_state: dict[str, object] = {}


def init(store: AlertStore, escalation, publisher) -> None:
    _state["store"] = store
    _state["escalation"] = escalation
    _state["publisher"] = publisher


@router.get("")
async def list_alerts():
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    alerts = await store.list_active()
    return [a.model_dump() for a in alerts]


@router.post("/{alert_id}/ack")
async def ack_alert(alert_id: str):
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    escalation = _state["escalation"]
    publisher = _state["publisher"]
    a = await store.set_status(alert_id, "acknowledged")
    if a is None:
        raise HTTPException(404, f"alert not found: {alert_id}")
    escalation.cancel(alert_id)
    await publisher.publish_update(a)
    return a.model_dump()


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    store: AlertStore = _state["store"]  # type: ignore[assignment]
    escalation = _state["escalation"]
    publisher = _state["publisher"]
    a = await store.set_status(alert_id, "resolved")
    if a is None:
        raise HTTPException(404, f"alert not found: {alert_id}")
    escalation.cancel(alert_id)
    await publisher.publish_update(a)
    return a.model_dump()
