"""在线状态：搭车心跳（不单独高频轮询）。"""

from __future__ import annotations

import datetime as _dt

from . import pairing, security
from .errors import bad_request, not_found
from .store import Database


def put(db: Database, ctx: dict, body: dict) -> dict:
    battery = body.get("battery")
    charging = body.get("charging")
    payload = body.get("payload")
    if payload is not None and not isinstance(payload, str):
        raise bad_request("invalid_payload", "状态内容不合法")
    if payload is not None and len(payload) > 8192:
        raise bad_request("payload_too_large", "状态内容过大")
    if battery is not None:
        try:
            battery = max(0, min(100, int(battery)))
        except (TypeError, ValueError):
            raise bad_request("invalid_battery", "电量不合法")
    db.conn.execute(
        "INSERT INTO presence(device_id, user_id, at, battery, charging, payload)\n"
        " VALUES(?,?,?,?,?,?)\n"
        " ON CONFLICT(device_id) DO UPDATE SET at=excluded.at,\n"
        "   battery=excluded.battery, charging=excluded.charging,\n"
        "   payload=excluded.payload",
        (ctx["deviceId"], ctx["userId"], security.iso(), battery,
         1 if charging else 0, payload),
    )
    return {"ok": True}


def get(db: Database, ctx: dict, device_id: str) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    members = {pair["master_device"], pair["puppy_device"]}
    if device_id not in members:
        raise not_found("not_member", "不在同一绑定关系里")
    row = db.conn.execute(
        "SELECT * FROM presence WHERE device_id=?", (device_id,)
    ).fetchone()
    if row is None:
        return {"ok": True, "presence": None}
    threshold = security.iso(security.now() - _dt.timedelta(seconds=300))
    return {
        "ok": True,
        "presence": {
            "deviceId": row["device_id"],
            "at": row["at"],
            "atDisplay": security.display(row["at"]),
            "online": row["at"] >= threshold,
            "battery": row["battery"],
            "charging": bool(row["charging"]),
            "payload": row["payload"],
        },
    }
