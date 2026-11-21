"""状态暂存箱（v0.7.0）。

状态类数据不再走「要一次、回一次」的直连请求，而是由发送端按固定频率
加密上传，服务端只暂存密文与路由信息，接收端直接按游标拉取。这样双方
不需要同时在线。

服务端能看到的东西只有：谁发给谁、什么 kind、密文多长、什么时候上传。
正文一律是端到端密文，本模块不解析、不记录。

保留策略（每对绑定可单独配置）：
- 暂存时长默认 72 小时，关闭时间门禁后不再按时间过期；
- 暂存容量默认 150MB，关闭容量门禁后不按容量淘汰；
- 另有一条 2000 条的硬上限，超出按 rev 从最早未确认的开始丢；
- 到达配置容量的 90% 时返回 pressure，客户端可以据此把新的状态改走直连兜底。
"""

from __future__ import annotations

import threading
import time

from . import pairing, security
from .errors import ApiError, bad_request, forbidden
from .store import Database

MAX_ITEM_BYTES = 512 * 1024
MAX_ITEMS_PER_PAIR = 2000
PAIR_BUDGET_BYTES = 150 * 1024 * 1024
MAX_TTL_HOURS = 24 * 30
MAX_BUDGET_BYTES = 2 * 1024 * 1024 * 1024
MIN_BUDGET_BYTES = 1024 * 1024
GATE_OFF_TTL_HOURS = 24 * 365 * 100
PRESSURE_RATIO = 0.9
TTL_HOURS = 72
POLL_LIMIT = 50
DEFAULT_WAIT_SECONDS = 25
MAX_WAIT_SECONDS = 25
SAMPLE_SECONDS = 3600

ALLOWED_KINDS = frozenset({
    "status", "usage", "location", "permissions", "applimit",
    "trail", "rules", "notifications", "profile",
})

_conditions: dict[str, threading.Condition] = {}
_conditions_lock = threading.Lock()
_write_lock = threading.Lock()


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


def _member(db: Database, ctx: dict):
    pair = pairing.require_member(db, ctx["deviceId"])
    peer = (pair["puppy_device"] if pair["master_device"] == ctx["deviceId"]
            else pair["master_device"])
    if str(peer).startswith(pairing.PENDING_PREFIX):
        raise forbidden("peer_missing", "对方还未加入绑定")
    return pair, peer


def pair_limits(pair) -> dict:
    """读取某一对绑定的暂存区门禁配置，缺列时回退默认值。"""
    keys = pair.keys()

    def _int(name, default):
        try:
            value = int(pair[name]) if name in keys else default
        except (TypeError, ValueError):
            return default
        return value

    ttl = max(1, min(_int("staging_ttl_hours", TTL_HOURS), MAX_TTL_HOURS))
    budget = max(
        MIN_BUDGET_BYTES, min(_int("staging_budget_bytes", PAIR_BUDGET_BYTES),
                              MAX_BUDGET_BYTES)
    )
    return {
        "ttlHours": ttl,
        "budgetBytes": budget,
        "timeGate": bool(_int("staging_time_gate", 1)),
        "sizeGate": bool(_int("staging_size_gate", 1)),
    }


def _now() -> str:
    return security.iso()


def _used(db: Database, pair_id: str) -> tuple[int, int]:
    row = db.conn.execute(
        "SELECT COALESCE(SUM(byte_len), 0) AS bytes, COUNT(*) AS items\n"
        "  FROM staged_items WHERE pair_id=? AND acked_at IS NULL\n"
        "   AND expires_at > ?",
        (pair_id, _now()),
    ).fetchone()
    return int(row["bytes"]), int(row["items"])


def _trim(db: Database, pair, room: int) -> None:
    """按该配对的配置腾出至少 room 字节；close gate 时不按时间/容量淘汰。"""
    pair_id = pair["id"]
    limits = pair_limits(pair)
    now = _now()
    if limits["timeGate"]:
        db.conn.execute(
            "DELETE FROM staged_items WHERE pair_id=? AND expires_at <= ?",
            (pair_id, now),
        )
    used, count = _used(db, pair_id)
    while (limits["sizeGate"] and used + room > limits["budgetBytes"]) or count >= MAX_ITEMS_PER_PAIR:
        row = db.conn.execute(
            "SELECT id, byte_len FROM staged_items\n"
            " WHERE pair_id=? AND acked_at IS NULL ORDER BY rev LIMIT 1",
            (pair_id,),
        ).fetchone()
        if row is None:
            break
        db.conn.execute("DELETE FROM staged_items WHERE id=?", (row["id"],))
        used -= int(row["byte_len"])
        count -= 1
    db.conn.execute(
        "DELETE FROM staged_items WHERE pair_id=? AND acked_at IS NOT NULL",
        (pair_id,),
    )


def _sample(db: Database, pair_id: str) -> None:
    bucket = _now()[:13]
    used, items = _used(db, pair_id)
    cloud = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes\n"
        "  FROM sync_records WHERE pair_id=? AND deleted=0",
        (pair_id,),
    ).fetchone()["bytes"]
    media = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM media WHERE pair_id=?",
        (pair_id,),
    ).fetchone()["bytes"]
    db.conn.execute(
        "INSERT INTO storage_samples(pair_id, bucket, staged_bytes,\n"
        "                            staged_items, cloud_bytes)\n"
        " VALUES(?,?,?,?,?)\n"
        " ON CONFLICT(pair_id, bucket) DO UPDATE SET\n"
        "   staged_bytes=excluded.staged_bytes,\n"
        "   staged_items=excluded.staged_items,\n"
        "   cloud_bytes=excluded.cloud_bytes",
        (pair_id, bucket, used, items, int(cloud) + int(media)),
    )


def _state(db: Database, pair: dict) -> dict:
    used, items = _used(db, pair["id"])
    limits = pair_limits(pair)
    budget = limits["budgetBytes"]
    return {
        "usedBytes": used,
        "itemCount": items,
        "budgetBytes": budget,
        "ratio": round(used / budget, 4) if budget else 0.0,
        "pressure": limits["sizeGate"] and used >= int(budget * PRESSURE_RATIO),
        "ttlHours": limits["ttlHours"],
        "timeGate": limits["timeGate"],
        "sizeGate": limits["sizeGate"],
    }


def send(db: Database, ctx: dict, body: dict) -> dict:
    pair, peer = _member(db, ctx)
    kind = str(body.get("kind") or "")
    if kind not in ALLOWED_KINDS:
        raise bad_request("invalid_kind", "不支持的状态类型")
    ciphertext = body.get("ciphertext")
    if not isinstance(ciphertext, str) or not ciphertext:
        raise bad_request("invalid_payload", "缺少状态内容")
    byte_len = len(ciphertext.encode("utf-8"))
    if byte_len > MAX_ITEM_BYTES:
        raise bad_request("payload_too_large", "状态内容过大")
    dedupe_key = body.get("dedupeKey")
    if dedupe_key is not None:
        dedupe_key = str(dedupe_key)[:128]
    now = _now()
    limits = pair_limits(pair)
    expires = security.iso_after(
        hours=limits["ttlHours"] if limits["timeGate"] else GATE_OFF_TTL_HOURS
    )

    with _write_lock:
        _trim(db, pair, byte_len)
        used, _ = _used(db, pair["id"])
        if limits["sizeGate"] and used + byte_len > limits["budgetBytes"]:
            _sample(db, pair["id"])
            raise ApiError(507, "staging_full", "暂存空间已满，请稍后再试")

        existing = None
        if dedupe_key:
            existing = db.conn.execute(
                "SELECT id FROM staged_items\n"
                " WHERE pair_id=? AND from_device=? AND to_device=?\n"
                "   AND kind=? AND dedupe_key=? AND acked_at IS NULL",
                (pair["id"], ctx["deviceId"], peer, kind, dedupe_key),
            ).fetchone()

        rev = db.next_seq()
        if existing is not None:
            db.conn.execute(
                "UPDATE staged_items SET rev=?, ciphertext=?, byte_len=?,\n"
                "       created_at=?, expires_at=?, delivered_at=NULL\n"
                " WHERE id=?",
                (rev, ciphertext, byte_len, now, expires, existing["id"]),
            )
        else:
            db.conn.execute(
                "INSERT INTO staged_items(rev, pair_id, from_device, to_device,\n"
                "                         kind, dedupe_key, ciphertext, byte_len,\n"
                "                         created_at, expires_at)\n"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                (rev, pair["id"], ctx["deviceId"], peer, kind, dedupe_key,
                 ciphertext, byte_len, now, expires),
            )
        _sample(db, pair["id"])
        state = _state(db, pair)

    notify(pair["id"])
    return {"ok": True, "rev": rev, **state}


def _fetch(db: Database, pair_id: str, device_id: str, cursor: int) -> list:
    return db.conn.execute(
        "SELECT * FROM staged_items WHERE pair_id=? AND to_device=?\n"
        "   AND rev>? AND acked_at IS NULL AND expires_at>?\n"
        " ORDER BY rev LIMIT ?",
        (pair_id, device_id, cursor, _now(), POLL_LIMIT),
    ).fetchall()


def _item(row) -> dict:
    return {
        "rev": int(row["rev"]),
        "id": int(row["id"]),
        "fromDevice": row["from_device"],
        "kind": row["kind"],
        "ciphertext": row["ciphertext"],
        "createdAt": row["created_at"],
        "createdAtDisplay": security.display(row["created_at"]),
    }


def poll(db: Database, ctx: dict, cursor: int, wait: int) -> dict:
    pair, _ = _member(db, ctx)
    wait = max(0, min(int(wait if wait is not None else DEFAULT_WAIT_SECONDS),
                      MAX_WAIT_SECONDS))
    deadline = time.monotonic() + wait
    condition = _condition(pair["id"])
    rows: list = []
    while True:
        rows = _fetch(db, pair["id"], ctx["deviceId"], cursor)
        if rows:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        with condition:
            condition.wait(min(remaining, 2.0))
    out_cursor = cursor
    if rows:
        ids = [int(row["id"]) for row in rows]
        out_cursor = max(int(row["rev"]) for row in rows)
        db.conn.execute(
            "UPDATE staged_items SET delivered_at=COALESCE(delivered_at, ?)\n"
            " WHERE pair_id=? AND to_device=? AND id IN (%s)"
            % ",".join("?" for _ in ids),
            (security.iso(), pair["id"], ctx["deviceId"], *ids),
        )
    state = _state(db, pair)
    return {
        "ok": True,
        "items": [_item(row) for row in rows],
        "cursor": out_cursor,
        "waited": wait,
        **state,
    }


def ack(db: Database, ctx: dict, body: dict) -> dict:
    pair, _ = _member(db, ctx)
    ids = body.get("ids")
    if ids is None:
        ids = body.get("revs") or []
    if not isinstance(ids, list) or len(ids) > 200:
        raise bad_request("invalid_ids", "确认列表不合法")
    values = []
    for value in ids:
        try:
            values.append(int(value))
        except (TypeError, ValueError):
            continue
    deleted = 0
    if values:
        placeholders = ",".join("?" for _ in values)
        cursor = db.conn.execute(
            "DELETE FROM staged_items WHERE pair_id=? AND to_device=?\n"
            "   AND id IN (%s)" % placeholders,
            (pair["id"], ctx["deviceId"], *values),
        )
        deleted = cursor.rowcount
    _sample(db, pair["id"])
    return {"ok": True, "deleted": deleted, **_state(db, pair)}


def quota(db: Database, ctx: dict) -> dict:
    pair, _ = _member(db, ctx)
    cloud = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes\n"
        "  FROM sync_records WHERE pair_id=? AND deleted=0",
        (pair["id"],),
    ).fetchone()["bytes"]
    media = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM media WHERE pair_id=?",
        (pair["id"],),
    ).fetchone()["bytes"]
    quota_bytes = int(pair["cloud_quota_bytes"] or 0)
    return {
        "ok": True,
        "quotaBytes": quota_bytes,
        "cloudUsedBytes": int(cloud) + int(media),
        **_state(db, pair),
    }


def cleanup(db: Database) -> int:
    cursor = db.conn.execute(
        "DELETE FROM staged_items WHERE expires_at < ? OR acked_at IS NOT NULL",
        (_now(),),
    )
    return cursor.rowcount


def storage_series(db: Database, days: int = 14) -> list:
    days = max(1, min(int(days), 90))
    rows = db.conn.execute(
        "SELECT day, SUM(staged) AS staged, SUM(cloud) AS cloud FROM (\n"
        "  SELECT pair_id, substr(bucket, 1, 10) AS day,\n"
        "         MAX(staged_bytes) AS staged, MAX(cloud_bytes) AS cloud\n"
        "    FROM storage_samples GROUP BY pair_id, substr(bucket, 1, 10)\n"
        "  ) GROUP BY day ORDER BY day DESC LIMIT ?",
        (days,),
    ).fetchall()
    return [
        {"day": row["day"], "stagedBytes": int(row["staged"] or 0),
         "cloudBytes": int(row["cloud"] or 0)}
        for row in reversed(rows)
    ]


def pair_storage(db: Database, pair_id: str) -> dict:
    used, items = _used(db, pair_id)
    cloud = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes\n"
        "  FROM sync_records WHERE pair_id=? AND deleted=0",
        (pair_id,),
    ).fetchone()["bytes"]
    media = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM media WHERE pair_id=?",
        (pair_id,),
    ).fetchone()["bytes"]
    return {"stagedBytes": used, "stagedItems": items,
            "cloudBytes": int(cloud) + int(media)}
