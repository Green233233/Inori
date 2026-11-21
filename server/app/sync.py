"""日记/共享数据的条目级密文同步（服务端只做存储与排序）。"""

from __future__ import annotations

import re

from . import pairing, security
from .errors import ApiError, bad_request, forbidden
from .store import Database

RECORD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# 没有单条大小上限：带涂鸦/贴纸/照片的日记会把附件内联成 data URI，
# 任何按条设的阈值都会让某类日记整篇同步失败（曾因 96KB / 512KB 两次踩坑）。
# 现在只由每对绑定关系的整体云空间配额（pairs.cloud_quota_bytes）约束，
# 超出配额时由 put_record() 返回 507 cloud_full。
MAX_PAGE = 200
MAX_MEDIA_BYTES = 8 * 1024 * 1024
MAX_MEDIA_CHUNKS = 4096
MAX_CHUNK_BYTES = 256 * 1024


def _cloud_used(db: Database, pair_id: str) -> int:
    """云空间已用字节：条目密文 + 媒体原始字节。"""
    records = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes\n"
        "  FROM sync_records WHERE pair_id=?",
        (pair_id,),
    ).fetchone()["bytes"]
    media = db.conn.execute(
        "SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM media WHERE pair_id=?",
        (pair_id,),
    ).fetchone()["bytes"]
    return int(records) + int(media)


def _quota(pair) -> int:
    keys = pair.keys()
    return int(pair["cloud_quota_bytes"]) if "cloud_quota_bytes" in keys else 0


def _row_to_record(row) -> dict:
    return {
        "recordId": row["record_id"],
        "kind": row["kind"],
        "ciphertext": row["ciphertext"],
        "revision": int(row["revision"]),
        "updatedAt": int(row["updated_at"]),
        "deleted": bool(row["deleted"]),
        "authorDevice": row["author_device"],
        "audience": row["audience"] if "audience" in row.keys() else "pair",
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
    try:
        revision = max(1, int(body.get("revision") or 1))
        updated_at = int(body.get("updatedAt") or 0)
    except (TypeError, ValueError):
        raise bad_request("invalid_meta", "版本信息不合法")
    deleted = 1 if body.get("deleted") else 0
    audience = str(body.get("audience") or "pair")
    if audience not in ("pair", "self"):
        raise bad_request("invalid_audience", "可见范围不合法")

    existing = db.conn.execute(
        "SELECT * FROM sync_records WHERE pair_id=? AND record_id=?",
        (pair["id"], record_id),
    ).fetchone()
    # 日记条目只能由作者设备改写：同一配对内的另一方不能覆盖或删除对方的
    # 记录（否则知道 recordId 就能把对方日记从云端抹掉）。
    if (existing is not None and kind == "journal"
            and existing["author_device"] != ctx["deviceId"]):
        raise forbidden("not_record_author", "只能改写自己上传的日记")
    if existing is not None and updated_at < int(existing["updated_at"]):
        # 旧版本的数据不覆盖新版本（客户端仍会收到服务端当前版本）。
        return {"ok": True, "record": _row_to_record(existing), "stale": True}

    # 云空间按实际存储字节计（含媒体）。替换旧条目时只算增量。
    old_bytes = len(existing["ciphertext"]) if existing is not None else 0
    delta = len(ciphertext.encode("utf-8")) - old_bytes
    quota = _quota(pair)
    if quota and delta > 0 and _cloud_used(db, pair["id"]) + delta > quota:
        raise ApiError(507, "cloud_full", "云空间满了，清理一些旧日记再试")

    seq = db.next_seq()
    db.conn.execute(
        "INSERT INTO sync_records(pair_id, record_id, kind, ciphertext, revision,\n"
        "                         updated_at, deleted, author_device, seq, audience)\n"
        " VALUES(?,?,?,?,?,?,?,?,?,?)\n"
        " ON CONFLICT(pair_id, record_id) DO UPDATE SET\n"
        "   kind=excluded.kind, ciphertext=excluded.ciphertext,\n"
        "   revision=excluded.revision, updated_at=excluded.updated_at,\n"
        "   deleted=excluded.deleted, author_device=excluded.author_device,\n"
        "   seq=excluded.seq, audience=excluded.audience",
        (pair["id"], record_id, kind, ciphertext, revision, updated_at, deleted,
         ctx["deviceId"], seq, audience),
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
        "SELECT * FROM sync_records WHERE pair_id=? AND seq>?\n"
        "   AND (audience='pair' OR (audience='self' AND author_device=?))\n"
        " ORDER BY seq LIMIT ?",
        (pair["id"], since_seq, ctx["deviceId"], limit),
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
    old_chunk = db.conn.execute(
        "SELECT LENGTH(data) AS bytes FROM media\n"
        " WHERE pair_id=? AND media_id=? AND idx=?",
        (pair["id"], media_id, index),
    ).fetchone()
    delta = len(raw) - (int(old_chunk["bytes"]) if old_chunk is not None else 0)
    quota = _quota(pair)
    if quota and delta > 0 and _cloud_used(db, pair["id"]) + delta > quota:
        raise ApiError(507, "cloud_full", "云空间满了，清理一些旧日记再试")
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
