from __future__ import annotations
import asyncio
import pytest
from unittest.mock import AsyncMock
from app.alerts.escalation import EscalationManager, escalation_delays


def test_demo_mode_compresses_delays():
    prod = escalation_delays(demo_mode=False)
    demo = escalation_delays(demo_mode=True)
    assert prod[2] == 600
    assert prod[3] == 300
    assert prod[4] == 180
    assert demo[2] == 60
    assert demo[3] == 30
    assert demo[4] == 18


async def test_schedule_fires_after_delay_demo_mode_short():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    # Override delay map for fast test
    manager._delays = {2: 0.05, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 2, callback)
    await asyncio.sleep(0.15)
    callback.assert_awaited_once()
    args = callback.await_args
    assert args.args[0] == "alert-1"
    assert args.args[1] == 3  # escalated to L3


async def test_cancel_prevents_callback():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.1, 3: 0.1, 4: 0.1}
    manager.schedule("alert-1", 2, callback)
    manager.cancel("alert-1")
    await asyncio.sleep(0.2)
    callback.assert_not_awaited()


async def test_no_schedule_for_max_level():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.05, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 5, callback)
    await asyncio.sleep(0.1)
    callback.assert_not_awaited()


async def test_schedule_replaces_existing_timer():
    callback = AsyncMock()
    manager = EscalationManager(demo_mode=True)
    manager._delays = {2: 0.2, 3: 0.05, 4: 0.05}
    manager.schedule("alert-1", 2, callback)
    # Replace with L3 timer (faster)
    manager.schedule("alert-1", 3, callback)
    await asyncio.sleep(0.1)
    callback.assert_awaited_once()
    args = callback.await_args
    assert args.args[1] == 4  # L3 -> L4
