"""账号、设备与会话。

设备在登录/注册时绑定公钥；令牌只保存 SHA-256 摘要，30 天滑动过期。
"""

from __future__ import annotations

import os
import sqlite3

from . import security
from .errors import bad_request, conflict, forbidden, unauthorized
from .store import Database


def _device_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "platform": row["platform"],
        "pubkey": row["pubkey"],
        "createdAt": row["created_at"],
    }


def _validate_device(device_id: str, name: str, platform: str, pubkey: str) -> None:
    if not security.DEVICE_ID_RE.match(device_id or ""):
        raise bad_request("invalid_device", "设备标识不合法")
    if not isinstance(pubkey, str) or not (32 <= len(pubkey) <= 512):
        raise bad_request("invalid_pubkey", "设备公钥不合法")
    if len(name or "") > 40:
        raise bad_request("invalid_device_name", "设备名过长")
    if platform not in ("android", "test"):
        raise bad_request("invalid_platform", "平台不合法")


def _upsert_device(db: Database, user_id: int, device_id: str, name: str,
                   platform: str, pubkey: str) -> None:
    conn = db.conn
    row = conn.execute("SELECT * FROM devices WHERE id=?", (device_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO devices(id, user_id, name, platform, pubkey, created_at)\n"
            " VALUES(?,?,?,?,?,?)",
            (device_id, user_id, name, platform, pubkey, security.iso()),
        )
        return
    if row["revoked_at"]:
        raise forbidden("device_revoked", "该设备已被注销")
    if row["user_id"] != user_id:
        raise conflict("device_taken", "该设备已绑定其他账号")
    conn.execute(
        "UPDATE devices SET name=?, platform=?, pubkey=? WHERE id=?",
        (name, platform, pubkey, device_id),
    )


def _issue_session(db: Database, user_id: int, device_id: str) -> str:
    token, digest = security.new_session_token()
    db.conn.execute(
        "INSERT INTO sessions(token_sha256, user_id, device_id, created_at, expires_at, last_seen)\n"
        " VALUES(?,?,?,?,?,?)",
        (digest, user_id, device_id, security.iso(),
         security.iso_after(days=security.SESSION_DAYS), security.iso()),
    )
    return token


def _open_registration() -> bool:
    """允许任何人注册（自建服务器常用：主人自己填地址即可加入）。

    默认关闭；`INORINAL_OPEN_REGISTRATION=1` 时打开。配对仍然需要对方的
    绑定码，所以开放注册只影响「能不能创建身份」，不影响数据隔离。
    """
    return os.environ.get("INORINAL_OPEN_REGISTRATION", "").strip() == "1"


def register(db: Database, body: dict, ip: str) -> dict:
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")
    invite = str(body.get("invite") or "").strip().upper()
    device_id = str(body.get("deviceId") or "")
    device_name = str(body.get("deviceName") or "Android")
    platform = str(body.get("platform") or "android")
    pubkey = str(body.get("pubkey") or "")

    if not security.USERNAME_RE.match(username):
        raise bad_request("invalid_username", "账号需为 3–32 位小写字母/数字/下划线")
    problem = security.password_problem(password)
    if problem:
        raise bad_request("weak_password", problem)
    _validate_device(device_id, device_name, platform, pubkey)

    conn = db.conn
    conn.execute("BEGIN IMMEDIATE")
    try:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise conflict("username_taken", "账号已存在")

        used = conn.execute(
            "SELECT * FROM invites WHERE code=?", (invite,)
        ).fetchone() if invite else None
        first_user = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0
        if first_user or _open_registration():
            # 服务器刚部署时的第一个账号不需要邀请码；开放注册模式下都放行。
            pass
        elif used is None:
            raise forbidden(
                "invite_required",
                "这台服务器需要邀请码。请让服务器主人在服务器上生成一个"
                "（tools/issue_invite.py），或让主人在服务器开启开放注册",
            )
        elif used["used_at"]:
            raise forbidden("invite_used", "邀请码已被使用，请向服务器主人再要一个")

        cursor = conn.execute(
            "INSERT INTO users(username, password_hash, created_at) VALUES(?,?,?)",
            (username, security.hash_password(password), security.iso()),
        )
        user_id = int(cursor.lastrowid)
        if used is not None and not used["used_at"]:
            conn.execute(
                "UPDATE invites SET used_at=?, used_by=? WHERE code=?",
                (security.iso(), user_id, invite),
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    _upsert_device(db, user_id, device_id, device_name, platform, pubkey)
    token = _issue_session(db, user_id, device_id)
    db.audit("register", actor_device=device_id, detail=username, ip=ip)
    return {"ok": True, "token": token, "username": username,
            "deviceId": device_id}


def login(db: Database, body: dict, ip: str) -> dict:
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")
    device_id = str(body.get("deviceId") or "")
    device_name = str(body.get("deviceName") or "Android")
    platform = str(body.get("platform") or "android")
    pubkey = str(body.get("pubkey") or "")

    _validate_device(device_id, device_name, platform, pubkey)
    row = db.conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if row is None or row["disabled"] or not security.verify_password(
        password, row["password_hash"]
    ):
        db.audit("login_failed", actor_device=device_id, detail=username, ip=ip)
        raise unauthorized("invalid_credentials", "账号或密码错误")

    _upsert_device(db, int(row["id"]), device_id, device_name, platform, pubkey)
    token = _issue_session(db, int(row["id"]), device_id)
    db.audit("login", actor_device=device_id, detail=username, ip=ip)
    return {"ok": True, "token": token, "username": row["username"],
            "userId": int(row["id"]), "deviceId": device_id}


def logout(db: Database, token: str) -> dict:
    db.conn.execute("DELETE FROM sessions WHERE token_sha256=?",
                    (security.hash_token(token),))
    return {"ok": True}


def authenticate(db: Database, token: str | None) -> dict:
    if not token:
        raise unauthorized()
    digest = security.hash_token(token)
    row = db.conn.execute(
        "SELECT s.user_id, s.device_id, s.expires_at, u.username, u.disabled,\n"
        "       d.pubkey, d.revoked_at\n"
        "  FROM sessions s JOIN users u ON u.id = s.user_id\n"
        "  JOIN devices d ON d.id = s.device_id\n"
        " WHERE s.token_sha256=?",
        (digest,),
    ).fetchone()
    if row is None:
        raise unauthorized()
    if row["revoked_at"]:
        raise forbidden("device_revoked", "该设备已被注销")
    if row["disabled"]:
        raise forbidden("account_disabled", "账号已停用")
    if row["expires_at"] < security.iso():
        db.conn.execute("DELETE FROM sessions WHERE token_sha256=?", (digest,))
        raise unauthorized("session_expired", "登录已过期，请重新登录")
    db.conn.execute("UPDATE sessions SET last_seen=? WHERE token_sha256=?",
                    (security.iso(), digest))
    return {
        "userId": int(row["user_id"]),
        "deviceId": row["device_id"],
        "username": row["username"],
        "pubkey": row["pubkey"],
    }


def current_pair_id(db: Database, device_id: str) -> str | None:
    row = db.conn.execute(
        "SELECT id FROM pairs WHERE unpaired_at IS NULL\n"
        "   AND (master_device=? OR puppy_device=?)",
        (device_id, device_id),
    ).fetchone()
    return row["id"] if row else None


def me(db: Database, ctx: dict, pair_summary: dict | None) -> dict:
    return {
        "ok": True,
        "username": ctx["username"],
        "userId": ctx["userId"],
        "deviceId": ctx["deviceId"],
        "pair": pair_summary,
    }


def list_devices(db: Database, user_id: int) -> dict:
    rows = db.conn.execute(
        "SELECT * FROM devices WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at",
        (user_id,),
    ).fetchall()
    return {"ok": True, "items": [_device_row(row) for row in rows]}


def revoke_device(db: Database, user_id: int, device_id: str) -> dict:
    db.conn.execute(
        "UPDATE devices SET revoked_at=? WHERE id=? AND user_id=?",
        (security.iso(), device_id, user_id),
    )
    db.conn.execute("DELETE FROM sessions WHERE device_id=?", (device_id,))
    return {"ok": True}
