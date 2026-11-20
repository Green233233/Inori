"""一对一配对：绑定码、公钥交换、SAS 校验标记、解绑。"""

from __future__ import annotations

import datetime as _dt
import sqlite3

from . import security
from .errors import bad_request, conflict, forbidden, not_found
from .store import Database

PENDING_PREFIX = "pending:"


def _pair_row(db: Database, pair_id: str) -> sqlite3.Row:
    row = db.conn.execute("SELECT * FROM pairs WHERE id=?", (pair_id,)).fetchone()
    if row is None:
        raise not_found("pair_not_found", "绑定不存在")
    return row


def _active_pair_for_device(db: Database, device_id: str) -> sqlite3.Row | None:
    return db.conn.execute(
        "SELECT * FROM pairs WHERE unpaired_at IS NULL\n"
        "   AND (master_device=? OR puppy_device=?)",
        (device_id, device_id),
    ).fetchone()


def _last_seen(db: Database, device_id: str) -> str | None:
    session = db.conn.execute(
        "SELECT last_seen FROM sessions WHERE device_id=? ORDER BY last_seen DESC LIMIT 1",
        (device_id,),
    ).fetchone()
    presence = db.conn.execute(
        "SELECT at FROM presence WHERE device_id=?", (device_id,)
    ).fetchone()
    stamps = [value for value in (
        session["last_seen"] if session else None,
        presence["at"] if presence else None,
    ) if value]
    return max(stamps) if stamps else None


def _online(seen: str | None) -> bool:
    if not seen:
        return False
    threshold = security.iso(
        security.now() - _dt.timedelta(seconds=300)
    )
    return seen >= threshold


def summary(db: Database, pair_row: sqlite3.Row, my_device: str) -> dict:
    master = pair_row["master_device"]
    puppy = pair_row["puppy_device"]
    is_master = master == my_device
    peer_id = puppy if is_master else master
    pending = str(peer_id).startswith(PENDING_PREFIX)
    peer_device = None if pending else db.conn.execute(
        "SELECT * FROM devices WHERE id=?", (peer_id,)
    ).fetchone()
    battery = None
    tier = None
    if peer_device is not None:
        presence = db.conn.execute(
            "SELECT battery, charging FROM presence WHERE device_id=?", (peer_id,)
        ).fetchone()
        if presence is not None:
            battery = presence["battery"]
    return {
        "pairId": pair_row["id"],
        "myRole": "MASTER" if is_master else "PUPPY",
        "ownerName": pair_row["owner_name"],
        "puppyName": pair_row["puppy_name"],
        "myDeviceId": my_device,
        "peerDeviceId": None if pending else peer_id,
        "peerPubkey": peer_device["pubkey"] if peer_device is not None else None,
        "peerPlatform": peer_device["platform"] if peer_device is not None else None,
        # 对方账号还在、但设备记录已经不在了（换机后旧设备注销 / 服务器数据被清理）：
        # 客户端据此提示「对方设备已注销，绑定已失效」，避免一直显示「等待对方确认」。
        "peerDeviceMissing": (not pending) and peer_device is None,
        "verified": bool(pair_row["verified_at"]),
        "createdAt": pair_row["created_at"],
        "unpairedAt": pair_row["unpaired_at"],
        "peerOnline": _online(_last_seen(db, peer_id)) if not pending else False,
        "peerLastSeen": _last_seen(db, peer_id) if not pending else None,
        "peerBattery": battery,
        "peerPowerTier": tier,
    }


def current(db: Database, ctx: dict) -> dict:
    row = _active_pair_for_device(db, ctx["deviceId"])
    return {"ok": True, "pair": summary(db, row, ctx["deviceId"]) if row else None}


def _already_paired_message(db: Database, pair_row: sqlite3.Row, device_id: str) -> str:
    """告诉用户「和谁、卡在哪一步、接下来点哪里」，而不是一句死路。

    这次线上反馈的现象是：第一次加入其实已经成功，但响应被中间层压成了 gzip、
    客户端解析失败，用户以为没成功又点了一次，于是只看到「你已经在一个绑定关系里」，
    无处可去。所以这里必须把对方的名字和下一步动作写清楚。
    """
    row = pair_row
    mine_is_master = row["master_device"] == device_id
    owner = (row["owner_name"] or "对方").strip() or "对方"
    puppy = (row["puppy_name"] or "对方").strip() or "对方"
    partner = puppy if mine_is_master else owner
    if row["verified_at"]:
        return f"你已经和「{partner}」绑定好了。要换人请先在「我的 → 我的身份与联结」里解除绑定"
    if str(row["puppy_device"]).startswith(PENDING_PREFIX):
        return f"你正在等「{puppy}」用绑定码加入。不需要再点一次，可以到「我的 → 我的身份与联结」查看进度"
    return (
        f"你已经和「{partner}」绑定过了，只是还没做安全校验。"
        "请到「我的 → 我的身份与联结」继续校验，或者先解除绑定再重新加入"
    )


def create(db: Database, ctx: dict, body: dict) -> dict:
    existing = _active_pair_for_device(db, ctx["deviceId"])
    owner_name = str(body.get("ownerName") or "").strip()[:24]
    puppy_name = str(body.get("puppyName") or "").strip()[:24]
    if not owner_name:
        raise bad_request("invalid_name", "请填写主人的名字")

    # already pending: regenerate a fresh code for the same pair instead of
    # failing with a UNIQUE constraint (the client's “取消” is local-only).
    if existing is not None and not existing["verified_at"]:
        if not str(existing["puppy_device"]).startswith(PENDING_PREFIX):
            raise conflict("pending_confirmation", "对方已加入，请完成校验或先解除绑定")
        code = security.random_pair_code()
        db.conn.execute(
            "UPDATE pairs SET owner_name=?, puppy_name=?, code_hash=?,\n"
            "                 code_expires_at=?, created_at=?\n"
            " WHERE id=?",
            (owner_name, puppy_name, security.hash_pair_code(code),
             security.iso_after(minutes=security.PAIR_CODE_TTL_MINUTES),
             security.iso(), existing["id"]),
        )
        db.audit("pair_code_refresh", actor_device=ctx["deviceId"], detail=existing["id"])
        row = _pair_row(db, existing["id"])
        return {
            "ok": True,
            "pair": summary(db, row, ctx["deviceId"]),
            "bindingCode": code,
            "codeExpiresAt": row["code_expires_at"],
        }
    if existing is not None:
        raise conflict(
            "already_paired",
            _already_paired_message(db, existing, ctx["deviceId"]),
        )

    code = security.random_pair_code()
    pair_id = security.random_id("pair_")
    db.conn.execute(
        "INSERT INTO pairs(id, master_device, puppy_device, owner_name, puppy_name,\n"
        "                   code_hash, code_expires_at, created_at)\n"
        " VALUES(?,?,?,?,?,?,?,?)",
        (pair_id, ctx["deviceId"], PENDING_PREFIX + pair_id, owner_name, puppy_name,
         security.hash_pair_code(code),
         security.iso_after(minutes=security.PAIR_CODE_TTL_MINUTES),
         security.iso()),
    )
    db.audit("pair_create", actor_device=ctx["deviceId"], detail=pair_id)
    row = _pair_row(db, pair_id)
    return {
        "ok": True,
        "pair": summary(db, row, ctx["deviceId"]),
        "bindingCode": code,
        "codeExpiresAt": row["code_expires_at"],
    }


def join(db: Database, ctx: dict, body: dict) -> dict:
    existing = _active_pair_for_device(db, ctx["deviceId"])
    if existing is not None:
        raise conflict(
            "already_paired",
            _already_paired_message(db, existing, ctx["deviceId"]),
        )
    code = security.normalize_pair_code(body.get("code") or "")
    if len(code) != 8:
        raise bad_request("invalid_code", "绑定码是 8 位字符")
    puppy_name = str(body.get("puppyName") or "").strip()[:24]
    code_hash = security.hash_pair_code(code)

    db.conn.execute("BEGIN IMMEDIATE")
    try:
        row = db.conn.execute(
            "SELECT * FROM pairs WHERE code_hash=? AND unpaired_at IS NULL\n"
            "   AND code_expires_at > ? AND puppy_device LIKE 'pending:%'",
            (code_hash, security.iso()),
        ).fetchone()
        if row is None:
            raise not_found("invalid_code", "绑定码无效或已过期")
        if row["master_device"] == ctx["deviceId"]:
            raise bad_request("same_device", "不能与自己绑定")
        puppy_name = puppy_name or row["puppy_name"] or "小狗"
        db.conn.execute(
            "UPDATE pairs SET puppy_device=?, puppy_name=?, code_hash=NULL"
            " WHERE id=?",
            (ctx["deviceId"], puppy_name, row["id"]),
        )
        db.conn.execute("COMMIT")
    except Exception:
        db.conn.execute("ROLLBACK")
        raise

    db.audit("pair_join", actor_device=ctx["deviceId"], detail=row["id"])
    fresh = _pair_row(db, row["id"])
    return {"ok": True, "pair": summary(db, fresh, ctx["deviceId"])}


def verify(db: Database, ctx: dict, body: dict) -> dict:
    row = _active_pair_for_device(db, ctx["deviceId"])
    if row is None:
        raise not_found("pair_not_found", "尚未绑定")
    fingerprint = str(body.get("sasFingerprint") or "")
    if len(fingerprint) < 16:
        raise bad_request("invalid_fingerprint", "缺少 SAS 指纹")
    db.conn.execute(
        "UPDATE pairs SET verified_at=COALESCE(verified_at, ?) WHERE id=?",
        (security.iso(), row["id"]),
    )
    db.audit("pair_verify", actor_device=ctx["deviceId"], detail=row["id"])
    return {"ok": True, "pair": summary(db, _pair_row(db, row["id"]), ctx["deviceId"])}


def update(db: Database, ctx: dict, body: dict) -> dict:
    row = _active_pair_for_device(db, ctx["deviceId"])
    if row is None:
        raise not_found("pair_not_found", "尚未绑定")
    fields = []
    params: list = []
    for key, column in (("ownerName", "owner_name"), ("puppyName", "puppy_name")):
        if key in body:
            value = str(body.get(key) or "").strip()[:24]
            if not value:
                raise bad_request("invalid_name", "名字不能为空")
            fields.append(f"{column}=?")
            params.append(value)
    if fields:
        params.append(row["id"])
        db.conn.execute(f"UPDATE pairs SET {', '.join(fields)} WHERE id=?", params)
    return {"ok": True, "pair": summary(db, _pair_row(db, row["id"]), ctx["deviceId"])}


def unpair(db: Database, ctx: dict, body: dict) -> dict:
    row = _active_pair_for_device(db, ctx["deviceId"])
    if row is None:
        # 对方已经先解开、或者本机其实早就解开了：这不是错误，客户端应当
        # 当成「现在确实没有绑定」处理。返回 200 而不是 404，避免界面上
        # 弹一个「解除失败」但其实已经解开了。
        return {"ok": True, "alreadyUnpaired": True, "unpairedAt": None}
    peer = (row["puppy_device"] if row["master_device"] == ctx["deviceId"]
            else row["master_device"])
    now = security.iso()
    db.conn.execute("UPDATE pairs SET unpaired_at=? WHERE id=?", (now, row["id"]))
    if not str(peer).startswith(PENDING_PREFIX):
        db.conn.execute(
            "INSERT INTO relay(pair_id, from_device, to_device, kind, ciphertext,\n"
            "                   created_at, expires_at)\n"
            " VALUES(?,?,?,?,?,?,?)",
            (row["id"], ctx["deviceId"], peer, "pair.unpaired",
             str(body.get("payload") or ""), now,
             security.iso_after(hours=24)),
        )
    # 密文数据在解绑后立即删除；仅保留 24 小时的解绑通知。
    db.conn.execute("DELETE FROM sync_records WHERE pair_id=?", (row["id"],))
    db.conn.execute("DELETE FROM media WHERE pair_id=?", (row["id"],))
    db.conn.execute(
        "DELETE FROM relay WHERE pair_id=? AND kind<>'pair.unpaired'", (row["id"],)
    )
    db.conn.execute("DELETE FROM coupons WHERE pair_id=?", (row["id"],))
    db.audit("pair_unpair", actor_device=ctx["deviceId"], detail=row["id"])
    return {"ok": True, "unpairedAt": now}


def require_member(db: Database, device_id: str) -> sqlite3.Row:
    row = _active_pair_for_device(db, device_id)
    if row is None:
        raise forbidden("no_pair", "尚未绑定，请先完成配对")
    return row


def is_master(row: sqlite3.Row, device_id: str) -> bool:
    return row["master_device"] == device_id
