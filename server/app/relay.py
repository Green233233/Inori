"""端到端密文信箱：长轮询、投递确认、过期清理。

服务端只保存 kind + 密文 + 路由元数据，永不解析正文。
"""

from __future__ import annotations

import logging
import threading
import time

from . import pairing, security
from .errors import bad_request, forbidden
from .store import Database

MAX_CIPHERTEXT = 64 * 1024
MAX_WAIT_SECONDS = 300
DEFAULT_WAIT_SECONDS = 25
POLL_LIMIT = 50
RELAY_TTL_HOURS = 7 * 24

LOG = logging.getLogger("qi.relay")

ALLOWED_KINDS = frozenset({
    "app.limit", "app.limit.ack", "guard.lock",
    "permission.state", "power.tier", "task.create", "task.submit", "task.verdict",
    "command.send", "command.reply", "report.status", "reward.grant", "panic",
    "screenshot.request", "screenshot.consent", "screenshot.frame",
    "fullscreen.message", "album.request", "album.share", "shared.note",
    "shared.photo", "shared.milestone", "presence.update", "pair.unpaired",
    "journal.entry", "test.ping",
})

_conditions: dict[str, threading.Condition] = {}
_conditions_lock = threading.Lock()


def _condition(pair_id: str) -> threading.Condition:
    with _conditions_lock:
        condition = _conditions.get(pair_id)
        if condition is None:
            condition = threading.Condition()
            _conditions[pair_id] = condition
        return condition


def notify(pair_id: str) -> None:
    condition = _condition(pair_id)
    with condition:
        condition.notify_all()


def _row_to_item(row) -> dict:
    return {
        "seq": row["seq"],
        "fromDevice": row["from_device"],
        "toDevice": row["to_device"],
        "kind": row["kind"],
        "ciphertext": row["ciphertext"],
        "createdAt": row["created_at"],
        "createdAtDisplay": security.display(row["created_at"]),
    }


def send(db: Database, ctx: dict, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    kind = str(body.get("kind") or "")
    if kind not in ALLOWED_KINDS:
        raise bad_request("invalid_kind", "不支持的消息类型")
    ciphertext = body.get("ciphertext")
    if not isinstance(ciphertext, str) or not ciphertext:
        raise bad_request("invalid_payload", "缺少消息内容")
    if len(ciphertext) > MAX_CIPHERTEXT:
        raise bad_request("payload_too_large", "消息过大")
    peer = (pair["puppy_device"] if pair["master_device"] == ctx["deviceId"]
            else pair["master_device"])
    if str(peer).startswith(pairing.PENDING_PREFIX):
        raise forbidden("peer_missing", "对方还未加入绑定")
    cursor = db.conn.execute(
        "INSERT INTO relay(pair_id, from_device, to_device, kind, ciphertext,\n"
        "                   created_at, expires_at)\n"
        " VALUES(?,?,?,?,?,?,?)",
        (pair["id"], ctx["deviceId"], peer, kind, ciphertext, security.iso(),
         security.iso_after(hours=RELAY_TTL_HOURS)),
    )
    notify(pair["id"])
    return {"ok": True, "seq": int(cursor.lastrowid)}


def _fetch(db: Database, pair_id: str, device_id: str, cursor: int) -> list:
    return db.conn.execute(
        "SELECT * FROM relay WHERE pair_id=? AND to_device=? AND seq>?\n"
        "   AND acked_at IS NULL ORDER BY seq LIMIT ?",
        (pair_id, device_id, cursor, POLL_LIMIT),
    ).fetchall()


def _touch_presence(db: Database, ctx: dict) -> None:
    """长轮询本身就是心跳，顺手把在线时间写进 presence。

    以前 presence 表没有任何调用方，pairing 里的 `_online` 恒为 false，
    界面上对方永远显示「离线」、电量也一直是空。
    """
    try:
        db.conn.execute(
            "INSERT INTO presence(device_id, user_id, at, battery, charging, payload)\n"
            " VALUES(?,?,?,NULL,0,NULL)\n"
            " ON CONFLICT(device_id) DO UPDATE SET at=excluded.at",
            (ctx["deviceId"], ctx["userId"], security.iso()),
        )
    except Exception:  # pragma: no cover - 心跳失败不能影响长轮询
        LOG.debug("presence touch failed", exc_info=True)


def poll(db: Database, ctx: dict, cursor: int, wait: int) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    _touch_presence(db, ctx)
    wait = max(0, min(int(wait or DEFAULT_WAIT_SECONDS), MAX_WAIT_SECONDS))
    deadline = time.monotonic() + wait
    rows: list = []
    condition = _condition(pair["id"])
    while True:
        rows = _fetch(db, pair["id"], ctx["deviceId"], cursor)
        if rows:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        with condition:
            condition.wait(min(remaining, 2.0))
    seq_out = cursor
    if rows:
        seq_out = max(max(int(item["seq"]) for item in rows), cursor)
        db.conn.execute(
            "UPDATE relay SET delivered_at=COALESCE(delivered_at, ?)\n"
            " WHERE pair_id=? AND to_device=? AND seq<=? AND seq>?",
            (security.iso(), pair["id"], ctx["deviceId"], seq_out, cursor),
        )
    return {
        "ok": True,
        "items": [_row_to_item(row) for row in rows],
        "cursor": seq_out,
        "waited": wait,
    }


def ack(db: Database, ctx: dict, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    seqs = body.get("seqs") or []
    if not isinstance(seqs, list) or len(seqs) > 200:
        raise bad_request("invalid_seqs", "确认列表不合法")
    now = security.iso()
    for seq in seqs:
        try:
            value = int(seq)
        except (TypeError, ValueError):
            continue
        db.conn.execute(
            "UPDATE relay SET acked_at=? WHERE pair_id=? AND to_device=? AND seq=?",
            (now, pair["id"], ctx["deviceId"], value),
        )
    return {"ok": True}


def cleanup(db: Database) -> int:
    cursor = db.conn.execute(
        "DELETE FROM relay WHERE expires_at < ? OR acked_at IS NOT NULL",
        (security.iso(),),
    )
    return cursor.rowcount
