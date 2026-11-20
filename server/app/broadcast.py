"""全局公告：管理后台写一条，所有客户端在主页标题下面静默看到。

设计上刻意极简：
- 只保留最近 ``MAX_KEPT`` 条，超出自动删除；
- 客户端只读「当前这一条」，没有已读回执、没有推送、不弹窗；
- 公告正文由管理员手写，服务端只做长度和类型校验，不解析任何标记。
"""
from __future__ import annotations

from . import security
from .store import Database

MAX_KEPT = 20
MAX_TEXT = 200
DEFAULT_HOURS = 72
MAX_HOURS = 24 * 30

_SCHEMA = """
CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
)
"""


def ensure_schema(db: Database) -> None:
    db.conn.execute(_SCHEMA)


def publish(db: Database, body: dict) -> dict:
    text = str(body.get("text") or "").strip()
    if not text:
        raise ValueError("公告内容不能为空")
    if len(text) > MAX_TEXT:
        raise ValueError(f"公告最多 {MAX_TEXT} 个字")
    try:
        hours = int(body.get("hours") or DEFAULT_HOURS)
    except (TypeError, ValueError):
        hours = DEFAULT_HOURS
    hours = max(1, min(MAX_HOURS, hours))
    ensure_schema(db)
    conn = db.conn
    now = security.iso()
    expires = security.iso_after(hours=hours)
    cur = conn.execute(
        "INSERT INTO broadcasts(text, created_at, expires_at) VALUES (?,?,?)",
        (text, now, expires),
    )
    row_id = int(cur.lastrowid or 0)
    conn.execute(
        "DELETE FROM broadcasts WHERE id NOT IN "
        "(SELECT id FROM broadcasts ORDER BY id DESC LIMIT ?)",
        (MAX_KEPT,),
    )
    return {
        "ok": True,
        "id": row_id,
        "text": text,
        "at": now,
        "expiresAt": expires,
    }


def current(db: Database) -> dict:
    """返回最新一条未过期公告；没有就返回 ``{"broadcast": None}``。"""
    ensure_schema(db)
    row = db.conn.execute(
        "SELECT id, text, created_at, expires_at FROM broadcasts "
        "WHERE expires_at > ? ORDER BY id DESC LIMIT 1",
        (security.iso(),),
    ).fetchone()
    if row is None:
        return {"ok": True, "broadcast": None}
    return {
        "ok": True,
        "broadcast": {
            "id": int(row[0]),
            "text": str(row[1]),
            "at": str(row[2]),
            "expiresAt": str(row[3]),
        },
    }


def clear(db: Database) -> dict:
    ensure_schema(db)
    db.conn.execute("DELETE FROM broadcasts")
    return {"ok": True}
