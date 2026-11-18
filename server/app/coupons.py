"""和好券：Ed25519 签名卡密、原子一次性核销、审计。

与 friend_passcard 的契约保持一致：
* 卡密展示格式 ``ABCDEFG·1234567``（7 位大写字母 + 7 位数字）；
* 签名原文是 canonical JSON ``{"code","created_at","serial","type","v":1}``；
* 核销在 ``BEGIN IMMEDIATE`` 中执行 ``UPDATE ... WHERE used_at IS NULL``。
私钥只存在于服务器 ``keys/ed25519_private.pem``（0600），私钥可导入旧项目。
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import sqlite3
import string

from . import pairing, security
from .errors import bad_request, conflict, forbidden, not_found
from .store import Database

COUPON_TYPES = {"hehao": "和好券", "exam": "考试免罚券", "reward": "奖励券"}
# 奖励券反向派发：小狗签发、主人核销；其余券主人签发、小狗核销。
REWARD_TYPE = "reward"
MAX_NOTE_BYTES = 8192
MAX_BATCH = 50
CODE_LETTERS = string.ascii_uppercase
CODE_DIGITS = string.digits


class Keyring:
    """Ed25519 私钥：按需生成、加载与验签。"""

    def __init__(self, data_dir: str):
        self.path = os.path.join(os.path.abspath(data_dir), "keys",
                                 "ed25519_private.pem")
        self._private = None
        self._public_pem: str | None = None

    def _load(self):
        if self._private is not None:
            return self._private
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        if os.path.exists(self.path):
            with open(self.path, "rb") as handle:
                self._private = serialization.load_pem_private_key(
                    handle.read(), password=None
                )
        else:
            os.makedirs(os.path.dirname(self.path), mode=0o700, exist_ok=True)
            self._private = Ed25519PrivateKey.generate()
            pem = self._private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            with open(self.path, "wb") as handle:
                handle.write(pem)
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        return self._private

    def public_pem(self) -> str:
        if self._public_pem is None:
            from cryptography.hazmat.primitives import serialization

            self._public_pem = self._load().public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode("ascii")
        return self._public_pem

    def fingerprint(self) -> str:
        from cryptography.hazmat.primitives import serialization

        der = self._load().public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        digest = hashlib.sha256(der).hexdigest().upper()
        return "SHA256:" + ":".join(digest[i:i + 2] for i in range(0, len(digest), 2))

    def sign(self, payload: bytes) -> str:
        return base64.b64encode(self._load().sign(payload)).decode("ascii")

    def verify(self, payload: bytes, signature_b64: str) -> bool:
        try:
            from cryptography.exceptions import InvalidSignature

            self._load().public_key().verify(
                base64.b64decode(signature_b64), payload
            )
            return True
        except (InvalidSignature, ValueError, TypeError):
            return False


def signature_payload(code: str, coupon_type: str, created_at: str,
                      serial: str) -> bytes:
    return security.canonical_json({
        "v": 1,
        "code": code,
        "type": coupon_type,
        "created_at": created_at,
        "serial": serial,
    }).encode("utf-8")


def normalize_code(raw: str) -> str:
    value = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())
    return value[:14]


def display_code(normalized: str) -> str:
    return normalized[:7] + "·" + normalized[7:]


def _valid_code(code: str) -> bool:
    if len(code) != 14:
        return False
    if not all(ch in CODE_LETTERS for ch in code[:7]):
        return False
    return all(ch in CODE_DIGITS for ch in code[7:])


def _new_normalized() -> str:
    letters = "".join(secrets.choice(CODE_LETTERS) for _ in range(7))
    digits = "".join(secrets.choice(CODE_DIGITS) for _ in range(7))
    return letters + digits


def _item(row: sqlite3.Row, *, include_signature: bool = False) -> dict:
    item = {
        "id": int(row["id"]),
        "code": display_code(row["normalized_code"]),
        "normalizedCode": row["normalized_code"],
        "type": row["type"],
        "typeLabel": COUPON_TYPES.get(row["type"], row["type"]),
        "createdAt": row["created_at"],
        "createdAtDisplay": security.display(row["created_at"]),
        "serial": row["serial"],
        "signatureShort": hashlib.sha256(row["signature"].encode()).hexdigest()[:8],
        "status": row["status"],
        "usedAt": row["used_at"],
        "usedAtDisplay": security.display(row["used_at"]),
        "usedByDevice": row["used_by_device"],
        "noteCipher": row["note_cipher"],
        "usedNoteCipher": row["used_note_cipher"],
    }
    if include_signature:
        item["signature"] = row["signature"]
    return item


def generate(db: Database, ctx: dict, keyring: Keyring, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    coupon_type = str(body.get("type") or "")
    if coupon_type not in COUPON_TYPES:
        raise bad_request("invalid_type", "券类型不合法")
    is_master = pairing.is_master(pair, ctx["deviceId"])
    if coupon_type == REWARD_TYPE:
        if is_master:
            raise forbidden("puppy_only", "奖励券只能由小狗端派发")
    elif not is_master:
        raise forbidden("master_only", "只有主人端可以签发这种券")
    try:
        count = int(body.get("count") or 1)
    except (TypeError, ValueError):
        raise bad_request("invalid_count", "数量不合法")
    if not (1 <= count <= MAX_BATCH):
        raise bad_request("invalid_count", "一次可生成 1–50 张")
    note_cipher = body.get("noteCipher")
    if note_cipher is not None and (
        not isinstance(note_cipher, str) or len(note_cipher) > MAX_NOTE_BYTES
    ):
        raise bad_request("invalid_note", "备注不合法")

    created_at = security.iso()
    coupons: list[dict] = []
    db.conn.execute("BEGIN IMMEDIATE")
    try:
        for _ in range(count):
            for _attempt in range(8):
                normalized = _new_normalized()
                serial = secrets.token_hex(16)
                signature = keyring.sign(
                    signature_payload(normalized, coupon_type, created_at, serial)
                )
                try:
                    cursor = db.conn.execute(
                        "INSERT INTO coupons(pair_id, code, normalized_code, type,\n"
                        "                     note_cipher, created_at, serial, signature)\n"
                        " VALUES(?,?,?,?,?,?,?,?)",
                        (pair["id"], display_code(normalized), normalized,
                         coupon_type, note_cipher, created_at, serial, signature),
                    )
                except sqlite3.IntegrityError:
                    continue
                row = db.conn.execute(
                    "SELECT * FROM coupons WHERE id=?", (int(cursor.lastrowid),)
                ).fetchone()
                coupons.append(_item(row, include_signature=True))
                break
        db.conn.execute("COMMIT")
    except Exception:
        db.conn.execute("ROLLBACK")
        raise
    db.audit("coupon_generate", actor_device=ctx["deviceId"],
             detail=f"{coupon_type} x{len(coupons)}")
    return {"ok": True, "coupons": coupons}


def list_coupons(db: Database, ctx: dict, query) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    status = (query.get("status") or "all").lower()
    coupon_type = (query.get("type") or "all").lower()
    search = (query.get("q") or "").strip().upper()
    try:
        limit = max(1, min(100, int(query.get("limit") or 20)))
        offset = max(0, int(query.get("offset") or 0))
    except (TypeError, ValueError):
        raise bad_request("invalid_paging", "分页参数不合法")

    clauses = ["pair_id=?"]
    params: list = [pair["id"]]
    if status in ("unused", "used"):
        clauses.append("status=?")
        params.append(status)
    if coupon_type in COUPON_TYPES:
        clauses.append("type=?")
        params.append(coupon_type)
    if search:
        clauses.append("(normalized_code LIKE ? OR note_cipher LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    where = " AND ".join(clauses)
    total = db.conn.execute(
        f"SELECT COUNT(*) AS n FROM coupons WHERE {where}", params
    ).fetchone()["n"]
    rows = db.conn.execute(
        f"SELECT * FROM coupons WHERE {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    return {
        "ok": True,
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "items": [_item(row) for row in rows],
    }


def verify(db: Database, ctx: dict, keyring: Keyring, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    normalized = normalize_code(body.get("code") or "")
    if not _valid_code(normalized):
        raise bad_request("invalid_format", "卡密格式不正确")
    row = db.conn.execute(
        "SELECT * FROM coupons WHERE pair_id=? AND normalized_code=?",
        (pair["id"], normalized),
    ).fetchone()
    if row is None:
        return {"ok": True, "exists": False, "signatureValid": False,
                "status": None, "coupon": None,
                "message": "卡密不存在，疑似伪造"}
    payload = signature_payload(row["normalized_code"], row["type"],
                               row["created_at"], row["serial"])
    valid = keyring.verify(payload, row["signature"])
    return {
        "ok": True,
        "exists": True,
        "signatureValid": valid,
        "status": row["status"],
        "coupon": _item(row, include_signature=True),
        "message": ("卡密真实有效，尚未使用" if valid and row["status"] == "unused"
                    else ("卡密签名校验失败，疑似伪造" if not valid
                          else "该卡密已被使用")),
    }


def redeem(db: Database, ctx: dict, keyring: Keyring, body: dict) -> dict:
    pair = pairing.require_member(db, ctx["deviceId"])
    normalized = normalize_code(body.get("code") or "")
    if not _valid_code(normalized):
        raise bad_request("invalid_format", "卡密格式不正确")
    used_note = body.get("noteCipher")
    if used_note is not None and (
        not isinstance(used_note, str) or len(used_note) > MAX_NOTE_BYTES
    ):
        raise bad_request("invalid_note", "备注不合法")

    db.conn.execute("BEGIN IMMEDIATE")
    try:
        row = db.conn.execute(
            "SELECT * FROM coupons WHERE pair_id=? AND normalized_code=?",
            (pair["id"], normalized),
        ).fetchone()
        if row is None:
            db.conn.execute("ROLLBACK")
            db.audit("coupon_redeem_denied", actor_device=ctx["deviceId"],
                     detail=normalized)
            raise not_found("not_found", "卡密不存在，请注意可能是伪造")
        payload = signature_payload(row["normalized_code"], row["type"],
                                   row["created_at"], row["serial"])
        if not keyring.verify(payload, row["signature"]):
            db.conn.execute("ROLLBACK")
            db.audit("coupon_redeem_denied", actor_device=ctx["deviceId"],
                     detail=normalized)
            raise conflict("signature_invalid", "卡密签名校验失败，疑似伪造",
                           coupon=_item(row))
        is_master = pairing.is_master(pair, ctx["deviceId"])
        # 线下核销：签发方在现实里已经兑现（当面给过 / 已履行），可自行标记为已用。
        # 只有签发设备本身能这样做，且必须显式声明 offline，避免被当成普通核销绕过角色限制。
        offline = bool(body.get("offline"))
        if offline:
            # 表里不记签发设备，签发方由券种反推：奖励券由小狗签发、其余由主人签发。
            issuer_is_master = row["type"] != REWARD_TYPE
            if issuer_is_master != is_master:
                db.conn.execute("ROLLBACK")
                raise forbidden("issuer_only", "只有签发这张券的一方可以标记线下已核销")
        elif row["type"] == REWARD_TYPE:
            if not is_master:
                db.conn.execute("ROLLBACK")
                raise forbidden("master_only", "奖励券由主人核销领取")
        elif is_master:
            db.conn.execute("ROLLBACK")
            raise forbidden("puppy_only", "核销在小狗端完成")
        if row["status"] == "used":
            db.conn.execute("ROLLBACK")
            raise conflict(
                "already_used",
                f"该卡密已于 {security.display(row['used_at']) or '此前'} 核销",
                coupon=_item(row),
            )
        now = security.iso()
        cursor = db.conn.execute(
            "UPDATE coupons SET status='used', used_at=?, used_by_device=?,\n"
            "                   used_note_cipher=?\n"
            " WHERE id=? AND used_at IS NULL",
            (now, ctx["deviceId"], used_note, row["id"]),
        )
        if cursor.rowcount != 1:
            db.conn.execute("ROLLBACK")
            raise conflict("already_used", "该卡密刚刚被核销",
                           coupon=_item(row))
        db.conn.execute("COMMIT")
    except Exception:
        if db.conn.in_transaction:
            db.conn.execute("ROLLBACK")
        raise

    fresh = db.conn.execute("SELECT * FROM coupons WHERE id=?", (row["id"],)).fetchone()
    db.audit("coupon_redeem", actor_device=ctx["deviceId"],
             detail=display_code(normalized))
    return {"ok": True, "message": "核销成功", "coupon": _item(fresh)}


def keyinfo(db: Database, ctx: dict, keyring: Keyring) -> dict:
    pairing.require_member(db, ctx["deviceId"])
    return {
        "ok": True,
        "algorithm": "Ed25519",
        "publicKeyPem": keyring.public_pem(),
        "fingerprint": keyring.fingerprint(),
        "version": "0.6.0",
    }


def audit(db: Database, ctx: dict, limit: int) -> dict:
    pairing.require_member(db, ctx["deviceId"])
    limit = max(1, min(100, int(limit or 20)))
    rows = db.conn.execute(
        "SELECT * FROM audit WHERE action LIKE 'coupon%' ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return {
        "ok": True,
        "items": [
            {
                "at": row["at"],
                "atDisplay": security.display(row["at"]),
                "actor": row["actor_device"],
                "action": row["action"],
                "detail": row["detail"],
            }
            for row in rows
        ],
    }
