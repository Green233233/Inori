"""账号、设备与会话。

设备在登录/注册时绑定公钥；令牌只保存 SHA-256 摘要，30 天滑动过期。
"""

from __future__ import annotations

import sqlite3

from . import security, settings
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
        # 同一台手机换账号是正常操作（退出登录后用自己的账号登录）。
        # 判断依据是设备公钥：它由保存在的 Keystore 身份生成，只有同一个
        # 安装才会有同一把公钥。公钥不同则视为另一台设备占用，仍然拒绝，
        # 避免有人拿着猜到的 deviceId 抢走别人的设备记录。
        if row["pubkey"] != pubkey:
            raise conflict(
                "device_taken",
                "这台设备已被另一个账号占用。请在原账号里退出登录，"
                "或清除应用数据后重新登录",
            )
        conn.execute(
            "UPDATE devices SET user_id=?, name=?, platform=? WHERE id=?",
            (user_id, name, platform, device_id),
        )
        db.audit(
            "device_rebind",
            actor_device=device_id,
            detail=f"{row['user_id']}->{user_id}",
            ip=None,
        )
        return
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


def _open_registration(db: Database) -> bool:
    """允许任何人注册（自建服务器常用：主人自己填地址即可加入）。

    后台「注册开关」写数据库，优先于环境变量；老部署只配了
    `INORINAL_OPEN_REGISTRATION=1` 的仍然按环境变量生效。配对仍然需要
    对方的绑定码，所以开放注册只影响「能不能创建身份」，不影响数据隔离。
    """
    return settings.open_registration(db)


def account_problem(db: Database, row: sqlite3.Row):
    """账号是否可登录。返回 ApiError 或 None。

    定时封禁到期后自动清除；永久封禁用 disabled=1 表示。
    """
    if row["disabled"]:
        message = "账号已被永久封禁" if row["ban_by"] else "账号已停用"
        return forbidden("account_disabled", message)
    until = row["ban_until"] if "ban_until" in row.keys() else None
    if until:
        if until > security.iso():
            display = security.display(until) or until
            return forbidden(
                "account_banned",
                f"账号已被封禁，解封时间：{display}（北京时间）",
                banUntil=until,
            )
        # 到期即解封，避免依赖后台定时任务。
        db.conn.execute(
            "UPDATE users SET ban_until=NULL, ban_reason=NULL, ban_at=NULL,"
            " ban_by=NULL WHERE id=?",
            (row["id"],),
        )
    return None


def _is_active_pair_code(conn, code: str) -> bool:
    """这个码是不是某条还在等对方加入的绑定码。

    绑定码和邀请码用同一套 8 位字母表（`security.random_pair_code()`），
    光看格式分不出来。用户把绑定码填进注册页的邀请码框是最常见的困惑，
    所以 invite 查不到时再回查一次 pairs，好给出「这是绑定码」的定向提示，
    而不是「这台服务器需要邀请码」这种答非所问的话。
    """
    if not code:
        return False
    row = conn.execute(
        "SELECT 1 FROM pairs WHERE code_hash=? AND unpaired_at IS NULL"
        " AND code_expires_at > ?",
        (security.hash_pair_code(code), security.iso()),
    ).fetchone()
    return row is not None


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
            raise conflict(
                "username_taken",
                "这个账号已经存在。请切到「登录」用密码登录，不用再填邀请码",
            )

        used = conn.execute(
            "SELECT * FROM invites WHERE code=?", (invite,)
        ).fetchone() if invite else None
        first_user = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0
        if first_user or _open_registration(db):
            # 服务器刚部署时的第一个账号不需要邀请码；开放注册模式下都放行。
            pass
        elif used is None:
            if _is_active_pair_code(conn, invite):
                raise bad_request(
                    "invite_is_pair_code",
                    "这是绑定码，不是邀请码：请先用账号登录，再在「绑定」页填写。"
                    "邀请码只用于创建新账号，绑定码用于把两台手机连起来",
                )
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
        # 设备绑定与会话必须在同一个事务里：否则一旦设备被别的账号占用，
        # 用户行已经提交，就会留下一个「注册失败但用户名被占」的孤儿账号。
        _upsert_device(db, user_id, device_id, device_name, platform, pubkey)
        token = _issue_session(db, user_id, device_id)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

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
    if row is None or not security.verify_password(password, row["password_hash"]):
        db.audit("login_failed", actor_device=device_id, detail=username, ip=ip)
        raise unauthorized("invalid_credentials", "账号或密码错误")
    problem = account_problem(db, row)
    if problem is not None:
        db.audit("login_blocked", actor_device=device_id,
                 detail=f"{username}:{problem.code}", ip=ip)
        raise problem

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
        "SELECT s.user_id, s.device_id, s.expires_at, u.id, u.username, u.disabled,\n"
        "       u.ban_until, u.ban_reason, u.ban_at, u.ban_by,\n"
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
    problem = account_problem(db, row)
    if problem is not None:
        raise problem
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
