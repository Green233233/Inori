"""日记/共享数据的条目级密文同步（服务端只做存储与排序）。"""

from __future__ import annotations

import re

from . import pairing, security
from .errors import bad_request
from .store import Database

RECORD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# 单条密文上限：带涂鸦/贴纸/照片的日记会把附件内联成 data URI，
# 96KB 会让这类日记整篇同步失败（用户反馈「涂鸦贴纸同步不过去」）。
MAX_RECORD_BYTES = 512 * 1024
MAX_PAGE = 200
MAX_MEDIA_BYTES = 8 * 1024 * 1024
MAX_MEDIA_CHUNKS = 4096
MAX_CHUNK_BYTES = 256 * 1024


def _row_to_record(row) -> dict:
    return {
        "recordId": row["record_id"],
        "kind": row["kind"],
        "ciphertext": row["ciphertext"],
        "revision": int(row["revision"]),
        "updatedAt": int(row["updated_at"]),
        "deleted": bool(row["deleted"]),
        "authorDevice": row["author_device"],
        "seq": int(row["seq"]),
    }


def put_record(db: Database, ctx: dict, record_id: str, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    if not RECORD_ID_RE.match(record_id or ""):
        raise bad_request("invalid_record_id", "记录标识不合法")
    kind = str(body.get("kind") or "")
    if kind not in ("journal", "shared.note", "shared.photo", "shared.milestone", "task", "reminder"):
        raise bad_request("invalid_kind", "不支持的记录类型")
    ciphertext = body.get("ciphertext")
    if not isinstance(ciphertext, str) or not ciphertext:
        raise bad_request("invalid_payload", "缺少内容")
    if len(ciphertext) > MAX_RECORD_BYTES:
        raise bad_request("payload_too_large", "记录过大")
    try:
        revision = max(1, int(body.get("revision") or 1))
        updated_at = int(body.get("updatedAt") or 0)
    except (TypeError, ValueError):
        raise bad_request("invalid_meta", "版本信息不合法")
    deleted = 1 if body.get("deleted") else 0

    existing = db.conn.execute(
        "SELECT * FROM sync_records WHERE pair_id=? AND record_id=?",
        (pair["id"], record_id),
    ).fetchone()
    if existing is not None and updated_at < int(existing["updated_at"]):
        # 旧版本的数据不覆盖新版本（客户端仍会收到服务端当前版本）。
        return {"ok": True, "record": _row_to_record(existing), "stale": True}

    seq = db.next_seq()
    db.conn.execute(
        "INSERT INTO sync_records(pair_id, record_id, kind, ciphertext, revision,\n"
        "                         updated_at, deleted, author_device, seq)\n"
        " VALUES(?,?,?,?,?,?,?,?,?)\n"
        " ON CONFLICT(pair_id, record_id) DO UPDATE SET\n"
        "   kind=excluded.kind, ciphertext=excluded.ciphertext,\n"
        "   revision=excluded.revision, updated_at=excluded.updated_at,\n"
        "   deleted=excluded.deleted, author_device=excluded.author_device,\n"
        "   seq=excluded.seq",
        (pair["id"], record_id, kind, ciphertext, revision, updated_at, deleted,
         ctx["deviceId"], seq),
    )
    row = db.conn.execute(
        "SELECT * FROM sync_records WHERE pair_id=? AND record_id=?",
        (pair["id"], record_id),
    ).fetchone()
    return {"ok": True, "record": _row_to_record(row), "stale": False}


def since(db: Database, ctx: dict, since_seq: int, limit: int) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    limit = max(1, min(int(limit or 100), MAX_PAGE))
    rows = db.conn.execute(
        "SELECT * FROM sync_records WHERE pair_id=? AND seq>? ORDER BY seq LIMIT ?",
        (pair["id"], since_seq, limit),
    ).fetchall()
    items = [_row_to_record(row) for row in rows]
    cursor = items[-1]["seq"] if items else since_seq
    return {"ok": True, "items": items, "cursor": cursor,
            "hasMore": len(items) == limit}


def put_media_chunk(db: Database, ctx: dict, media_id: str, index: int,
                    body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    if not RECORD_ID_RE.match(media_id or ""):
        raise bad_request("invalid_media_id", "媒体标识不合法")
    if not (0 <= index < MAX_MEDIA_CHUNKS):
        raise bad_request("invalid_chunk", "分块序号不合法")
    data = body.get("data")
    if not isinstance(data, str) or not data:
        raise bad_request("invalid_payload", "缺少分块内容")
    import base64
    try:
        raw = base64.b64decode(data.encode("ascii"), validate=True)
    except Exception:
        raise bad_request("invalid_payload", "分块不是合法 Base64")
    if len(raw) > MAX_CHUNK_BYTES:
        raise bad_request("chunk_too_large", "分块超过 256 KiB")
    total = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) AS total FROM media\n"
        " WHERE pair_id=? AND media_id=?",
        (pair["id"], media_id),
    ).fetchone()["total"]
    if total + len(raw) > MAX_MEDIA_BYTES:
        raise bad_request("media_too_large", "媒体超过 8 MiB")
    db.conn.execute(
        "INSERT INTO media(pair_id, media_id, idx, data) VALUES(?,?,?,?)\n"
        " ON CONFLICT(pair_id, media_id, idx) DO UPDATE SET data=excluded.data",
        (pair["id"], media_id, index, raw),
    )
    return {"ok": True, "mediaId": media_id, "index": index,
            "bytes": len(raw)}


def get_media_chunk(db: Database, ctx: dict, media_id: str, index: int) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    row = db.conn.execute(
        "SELECT data FROM media WHERE pair_id=? AND media_id=? AND idx=?",
        (pair["id"], media_id, index),
    ).fetchone()
    import base64
    if row is None:
        return {"ok": True, "data": None}
    return {"ok": True, "data": base64.b64encode(row["data"]).decode("ascii")}
