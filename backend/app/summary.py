from __future__ import annotations
import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any
import httpx
from .logging import get_logger
from .profiles import PROFILES, name_of
from .storage.influx import InfluxWriter

log = get_logger("backend.summary")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "120"))

LEVEL_LABELS = {
    1: "Information",
    2: "Attention",
    3: "Alerte",
    4: "Urgence",
    5: "Danger vital",
}

PATHO_LABELS = {
    "hypertension": "hypertension",
    "diabetes": "diabète",
    "alzheimer": "maladie d'Alzheimer",
    "dementia": "démence",
    "copd": "BPCO",
    "heart_failure": "insuffisance cardiaque",
    "parkinson": "Parkinson",
    "arthritis": "arthrose",
    "osteoporosis": "ostéoporose",
}


def _fmt_pathologies(items: list[str]) -> str:
    return ", ".join(PATHO_LABELS.get(p, p) for p in items) or "aucune connue"


async def _aggregate_vitals(influx: InfluxWriter, rid: str, hours: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    rows = await influx.query_history(
        rid, "vitals",
        (now - timedelta(hours=hours)).isoformat(),
        now.isoformat(),
    )
    by_field: dict[str, list[float]] = {}
    for r in rows:
        f = r.get("field")
        v = r.get("value")
        if isinstance(v, (int, float)) and isinstance(f, str):
            by_field.setdefault(f, []).append(float(v))

    def stats(values: list[float]) -> dict[str, float] | None:
        if not values:
            return None
        return {
            "count": len(values),
            "avg": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
        }

    return {f: stats(v) for f, v in by_field.items()}


async def _aggregate_activity(influx: InfluxWriter, rid: str, hours: int) -> dict[str, int]:
    pattern = await influx.query_activity_pattern(rid, hours)
    totals: dict[str, int] = {}
    for slot in pattern:
        for k, v in slot.items():
            if k == "hour":
                continue
            if isinstance(v, (int, float)):
                totals[k] = totals.get(k, 0) + int(v)
    return totals


async def _aggregate_alerts(influx: InfluxWriter, rid: str, hours: int) -> dict[str, Any]:
    qa = influx._client.query_api()
    flux = (
        f'from(bucket:"{influx.bucket}") '
        f'|> range(start: -{hours}h) '
        f'|> filter(fn: (r) => r._measurement == "alerts" '
        f'    and r["resident_id"] == "{rid}" '
        f'    and r._field == "level") '
    )
    tables = await asyncio.to_thread(qa.query, flux, org=influx.org)
    by_level: dict[int, int] = {}
    seen_ids: set[str] = set()
    for table in tables:
        for record in table.records:
            aid = str(record.values.get("alert_id", ""))
            if aid in seen_ids:
                continue
            seen_ids.add(aid)
            try:
                lvl = int(record.get_value() or 0)
            except (TypeError, ValueError):
                continue
            by_level[lvl] = by_level.get(lvl, 0) + 1
    return {"by_level": by_level, "total": sum(by_level.values())}


def _template_summary(rid: str, profile: dict, vitals: dict, activity: dict, alerts: dict, hours: int) -> str:
    name = profile.get("name", rid)
    age = profile.get("age", "—")
    paths = _fmt_pathologies(profile.get("pathologies", []))
    lines = [
        f"# Rapport quotidien — {name} ({rid}, {age} ans)",
        "",
        f"Période : dernières {hours} h. Antécédents : {paths}.",
        "",
        "## Constantes",
    ]
    hr = vitals.get("hr")
    spo2 = vitals.get("spo2")
    temp = vitals.get("temp")
    if hr:
        lines.append(f"- Rythme cardiaque : moyen {hr['avg']:.0f} bpm (min {hr['min']:.0f}, max {hr['max']:.0f}).")
    if spo2:
        lines.append(f"- SpO2 : moyenne {spo2['avg']:.0f} % (min {spo2['min']:.0f}).")
    if temp:
        lines.append(f"- Température : moyenne {temp['avg']:.1f} °C (max {temp['max']:.1f}).")
    if not (hr or spo2 or temp):
        lines.append("- Aucune mesure exploitable sur la période.")
    lines.append("")
    lines.append("## Activité")
    if activity:
        ordered = sorted(activity.items(), key=lambda kv: -kv[1])
        for act, count in ordered:
            lines.append(f"- {act} : {count} mesures.")
    else:
        lines.append("- Pas d'activité enregistrée.")
    lines.append("")
    lines.append("## Alertes")
    by_lvl = alerts.get("by_level", {})
    total = alerts.get("total", 0)
    if total:
        lines.append(f"- Total : {total} alerte(s) déclenchée(s).")
        for lvl in sorted(by_lvl):
            lines.append(f"  - Niveau {lvl} ({LEVEL_LABELS.get(lvl, '—')}) : {by_lvl[lvl]}.")
    else:
        lines.append("- Aucune alerte sur la période.")
    lines.append("")
    lines.append("_Repli sans LLM (Ollama indisponible)._")
    return "\n".join(lines)


async def _ollama_summary(prompt: str) -> str:
    body = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1024},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Tu es l'assistant médical d'un EHPAD. Tu rédiges un rapport quotidien "
                    "en français, concis, factuel, en markdown avec les sections : Synthèse, "
                    "Constantes, Activité, Alertes, Recommandations. N'invente rien en dehors "
                    "des données fournies."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        r = await client.post(f"{OLLAMA_URL}/api/chat", json=body)
        r.raise_for_status()
        data = r.json()
        msg = data.get("message") or {}
        return str(msg.get("content", "")).strip()


async def generate_summary(rid: str, influx: InfluxWriter, hours: int = 24) -> dict[str, Any]:
    if rid not in PROFILES:
        raise ValueError(f"unknown resident {rid}")
    profile = PROFILES[rid]
    vitals = await _aggregate_vitals(influx, rid, hours)
    activity = await _aggregate_activity(influx, rid, hours)
    alerts = await _aggregate_alerts(influx, rid, hours)

    prompt = (
        f"Résident : {name_of(rid)} (id {rid}, chambre {profile.get('room')}, "
        f"{profile.get('age', '?')} ans). "
        f"Antécédents : {_fmt_pathologies(profile.get('pathologies', []))}. "
        f"Période analysée : {hours} heures.\n\n"
        f"Constantes agrégées : {vitals}.\n"
        f"Activité (compte de mesures par type) : {activity}.\n"
        f"Alertes par niveau : {alerts.get('by_level', {})} (total {alerts.get('total', 0)}).\n\n"
        f"Rédige le rapport quotidien."
    )
    try:
        text = await _ollama_summary(prompt)
        if text:
            return {"resident_id": rid, "hours": hours, "summary": text, "source": "ollama"}
        log.warning("ollama_empty_response", resident_id=rid)
    except Exception as exc:  # noqa: BLE001
        log.warning("ollama_summary_failed", resident_id=rid, err=str(exc))

    text = _template_summary(rid, profile, vitals, activity, alerts, hours)
    return {"resident_id": rid, "hours": hours, "summary": text, "source": "template"}
