"""祈 · 账户管理后台（v0.2.0）。

纯标准库实现：管理员认证、账户管理、服务统计、Excel 导出。与 App 的
普通账号/令牌完全分离——管理员会话只存在 admin_sessions，密码用同一套
scrypt 哈希。所有接口都挂在 `/admin/api/*` 下，静态页面由 `admin_web/`
提供。

安全要点：
* 默认 admin / 12345678，首次登录强制改密，改密前只有 me/change-password/
  logout 可用；
* 同一 IP 一小时内输错 10 次密码 → 锁定 1 小时（429 + retryAfter）；
* 令牌走 Authorization: Bearer，不写 Cookie，天然免疫 CSRF；
* 服务端只监听 127.0.0.1，真实 IP 取 Caddy 写入的 X-Forwarded-For。
"""

from __future__ import annotations

import base64
import datetime as _dt
import io
import json
import os
import re
import sqlite3
import threading
import time
import urllib.request
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from . import VERSION, broadcast, security, settings, staging
from .errors import ApiError, bad_request, conflict, forbidden, not_found, too_many, unauthorized
from .store import Database

ADMIN_VERSION = "0.2.0"
API_PREFIX = "/admin/api"

DEFAULT_ADMIN = "admin"
DEFAULT_PASSWORD = "12345678"
ADMIN_SESSION_HOURS = 12

MAX_FAILS = 10
FAIL_WINDOW_SECONDS = 3600
LOCK_SECONDS = 3600
PASSWORD_FAIL_LIMIT = 5
PASSWORD_FAIL_WINDOW_SECONDS = 900
_MAX_USERNAME = 64
_MAX_PASSWORD = 256
_DUMMY_HASH = security.hash_password("qi-admin-dummy-password")

BAN_DURATIONS = {
    "10m": (600, "10 分钟"),
    "1h": (3600, "1 小时"),
    "24h": (86400, "24 小时"),
    "7d": (604800, "一周"),
    "permanent": (None, "永久"),
}

_ONLINE_SECONDS = 300

_BOOTED_AT = time.time()
_ASSET_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "admin_web")
_ASSET_TYPES = {
    "index.html": "text/html; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "application/javascript; charset=utf-8",
    "favicon.svg": "image/svg+xml",
}

_BING_IMAGE_API = (
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN"
)
_BG_MAX_BYTES = 8 * 1024 * 1024
_BG_FAIL_SECONDS = 300
_bg_lock = threading.Lock()
_bg_fail_until = 0.0

THEME_MODES = {"dark", "light", "system"}
THEME_BACKGROUNDS = {"solid", "bing", "upload"}
THEME_MAX_BLUR = 30
MAX_BACKGROUND_BYTES = 4 * 1024 * 1024
MAX_BACKGROUND_BODY = 6 * 1024 * 1024
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_ADMIN_USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")


# ---------------------------------------------------------------------------
# 返回类型
# ---------------------------------------------------------------------------
@dataclass
class FileResponse:
    body: bytes
    content_type: str
    headers: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# 静态资源
# ---------------------------------------------------------------------------
def read_asset(name: str) -> tuple[bytes, str] | None:
    """只允许固定白名单文件，杜绝路径穿越。"""
    if name not in _ASSET_TYPES:
        return None
    path = os.path.join(_ASSET_ROOT, name)
    try:
        with open(path, "rb") as handle:
            return handle.read(), _ASSET_TYPES[name]
    except OSError:
        return None


# ---------------------------------------------------------------------------
# 登录页每日壁纸（Bing HPImageArchive，服务端缓存）
# ---------------------------------------------------------------------------
def _image_type(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _bg_folder(db: Database) -> str:
    return os.path.join(os.path.dirname(db.path), "admin-cache")


def _bg_path(db: Database, day: str) -> str:
    return os.path.join(_bg_folder(db), f"login-bg-{day}.img")


def _read_bytes(path: str) -> bytes | None:
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        return None


def _latest_cached_background(db: Database) -> bytes | None:
    try:
        names = [
            name for name in os.listdir(_bg_folder(db))
            if name.startswith("login-bg-") and name.endswith(".img")
        ]
    except OSError:
        return None
    if not names:
        return None
    names.sort(reverse=True)
    return _read_bytes(os.path.join(_bg_folder(db), names[0]))


def _fetch_bing_background() -> bytes:
    """只访问固定的 Bing 域名，拒绝相对路径与超大响应。"""
    request = urllib.request.Request(
        _BING_IMAGE_API,
        headers={"User-Agent": "InoriAdmin/0.2.0 (+https://124.221.102.236)"},
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise OSError("bing api status")
        payload = json.loads(response.read(512 * 1024).decode("utf-8"))
    images = payload.get("images") or []
    if not images:
        raise ValueError("bing api returned no image")
    relative = str(images[0].get("url") or "")
    if not relative.startswith("/") or relative[1:].startswith("/"):
        raise ValueError("unexpected bing image path")
    image_request = urllib.request.Request(
        "https://www.bing.com" + relative,
        headers={"User-Agent": "InoriAdmin/0.2.0 (+https://124.221.102.236)"},
    )
    with urllib.request.urlopen(image_request, timeout=12) as response:
        if response.status != 200:
            raise OSError("bing image status")
        if not (response.headers.get("Content-Type") or "").lower().startswith("image/"):
            raise ValueError("bing image content type")
        data = response.read(_BG_MAX_BYTES + 1)
    if len(data) > _BG_MAX_BYTES or _image_type(data) is None:
        raise ValueError("bing image too large or unsupported")
    return data


def login_background(db: Database) -> FileResponse:
    """当天的登录页壁纸；拉取失败时回退到最近一张缓存。"""
    global _bg_fail_until
    day = _cst_day()
    path = _bg_path(db, day)
    data = _read_bytes(path)
    if data:
        return FileResponse(
            data, _image_type(data) or "application/octet-stream",
            {"Cache-Control": "public, max-age=3600"},
        )

    with _bg_lock:
        data = _read_bytes(path)
        if data:
            return FileResponse(
                data, _image_type(data) or "application/octet-stream",
                {"Cache-Control": "public, max-age=3600"},
            )
        if time.time() < _bg_fail_until:
            cached = _latest_cached_background(db)
            if cached:
                return FileResponse(
                    cached, _image_type(cached) or "application/octet-stream",
                    {"Cache-Control": "public, max-age=600"},
                )
            raise ApiError(503, "login_background_unavailable", "壁纸暂时不可用")

        try:
            data = _fetch_bing_background()
        except Exception:
            _bg_fail_until = time.time() + _BG_FAIL_SECONDS
            cached = _latest_cached_background(db)
            if cached:
                return FileResponse(
                    cached, _image_type(cached) or "application/octet-stream",
                    {"Cache-Control": "public, max-age=600"},
                )
            raise ApiError(503, "login_background_unavailable", "壁纸暂时不可用")

        folder = _bg_folder(db)
        try:
            os.makedirs(folder, exist_ok=True)
            temporary = path + ".tmp"
            with open(temporary, "wb") as handle:
                handle.write(data)
            os.replace(temporary, path)
        except OSError:
            pass
        return FileResponse(
            data, _image_type(data) or "application/octet-stream",
            {"Cache-Control": "public, max-age=3600"},
        )


# ---------------------------------------------------------------------------
# 管理员外观偏好
# ---------------------------------------------------------------------------
def _theme_folder(db: Database) -> str:
    return os.path.join(_bg_folder(db), "themes")


def _theme_row(db: Database, admin_id: int) -> sqlite3.Row:
    row = db.conn.execute(
        "SELECT * FROM admin_preferences WHERE admin_id=?", (admin_id,)
    ).fetchone()
    if row is None:
        db.conn.execute(
            "INSERT OR IGNORE INTO admin_preferences(admin_id, updated_at)"
            " VALUES(?,?)",
            (admin_id, security.iso()),
        )
        row = db.conn.execute(
            "SELECT * FROM admin_preferences WHERE admin_id=?", (admin_id,)
        ).fetchone()
    return row


def _theme_payload(row: sqlite3.Row) -> dict:
    return {
        "mode": row["theme_mode"],
        "background": row["background"],
        "solidColor": row["solid_color"],
        "blur": int(row["blur"] or 0),
        "hasCustomBackground": bool(row["custom_file"]),
    }


def get_theme(db: Database, session: sqlite3.Row) -> dict:
    row = _theme_row(db, int(session["admin_id"]))
    return {"ok": True, "theme": _theme_payload(row)}


def update_theme(db: Database, session: sqlite3.Row, body: dict, ip: str) -> dict:
    admin_id = int(session["admin_id"])
    current = _theme_row(db, admin_id)
    mode = str(body.get("mode") or current["theme_mode"])
    background = str(body.get("background") or current["background"])
    solid = str(body.get("solidColor") or current["solid_color"])
    raw_blur = body.get("blur", current["blur"])
    if mode not in THEME_MODES:
        raise bad_request("invalid_theme_mode", "主题模式不合法")
    if background not in THEME_BACKGROUNDS:
        raise bad_request("invalid_background", "背景类型不合法")
    if not _HEX_COLOR_RE.match(solid):
        raise bad_request("invalid_solid_color", "纯色背景必须是 #RRGGBB")
    if isinstance(raw_blur, bool):
        raise bad_request("invalid_blur", "模糊程度不合法")
    try:
        blur = int(raw_blur)
    except (TypeError, ValueError):
        raise bad_request("invalid_blur", "模糊程度不合法")
    if blur < 0 or blur > THEME_MAX_BLUR:
        raise bad_request("invalid_blur", "模糊程度需在 0–30 之间")
    if background == "upload" and not current["custom_file"]:
        raise bad_request("background_missing", "请先上传一张背景图片")
    db.conn.execute(
        "UPDATE admin_preferences SET theme_mode=?, background=?,"
        " solid_color=?, blur=?, updated_at=? WHERE admin_id=?",
        (mode, background, solid.lower(), blur, security.iso(), admin_id),
    )
    db.audit("admin_theme_updated", detail=f"{mode}/{background}", ip=ip)
    return {"ok": True, "theme": _theme_payload(_theme_row(db, admin_id))}


def upload_theme_background(db: Database, session: sqlite3.Row, body: dict,
                            ip: str) -> dict:
    admin_id = int(session["admin_id"])
    raw = body.get("data")
    if not isinstance(raw, str) or not raw.strip():
        raise bad_request("missing_image", "请选择一张图片")
    payload = raw.strip()
    if payload.startswith("data:"):
        comma = payload.find(",")
        if comma < 0:
            raise bad_request("invalid_image", "图片数据不合法")
        payload = payload[comma + 1:]
    try:
        data = base64.b64decode(payload, validate=True)
    except Exception:
        raise bad_request("invalid_image", "图片数据不合法")
    if len(data) > MAX_BACKGROUND_BYTES:
        raise ApiError(413, "background_too_large", "背景图片不能超过 4MB")
    mime = _image_type(data)
    if mime is None:
        raise bad_request("invalid_image", "仅支持 JPEG、PNG 或 WebP 图片")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
    folder = _theme_folder(db)
    filename = f"admin-{admin_id}.{ext}"
    path = os.path.join(folder, filename)
    try:
        os.makedirs(folder, exist_ok=True)
        temporary = path + ".tmp"
        with open(temporary, "wb") as handle:
            handle.write(data)
        os.replace(temporary, path)
        for other in ("jpg", "png", "webp"):
            stale = os.path.join(folder, f"admin-{admin_id}.{other}")
            if other != ext and os.path.exists(stale):
                try:
                    os.remove(stale)
                except OSError:
                    pass
    except OSError:
        raise ApiError(500, "background_store_failed", "背景图片保存失败")
    db.conn.execute(
        "UPDATE admin_preferences SET background='upload', custom_file=?,"
        " updated_at=? WHERE admin_id=?",
        (filename, security.iso(), admin_id),
    )
    db.audit("admin_background_upload", ip=ip)
    return {"ok": True, "theme": _theme_payload(_theme_row(db, admin_id))}


def theme_background(db: Database, session: sqlite3.Row) -> FileResponse:
    row = _theme_row(db, int(session["admin_id"]))
    filename = row["custom_file"]
    if not filename or os.path.basename(filename) != filename:
        raise not_found("background_not_found", "尚未上传背景图片")
    path = os.path.join(_theme_folder(db), filename)
    data = _read_bytes(path)
    if not data:
        raise not_found("background_not_found", "背景图片不存在")
    return FileResponse(
        data, _image_type(data) or "application/octet-stream",
        {"Cache-Control": "private, no-store"},
    )


def delete_theme_background(db: Database, session: sqlite3.Row, ip: str) -> dict:
    admin_id = int(session["admin_id"])
    row = _theme_row(db, admin_id)
    filename = row["custom_file"]
    if filename:
        path = os.path.join(_theme_folder(db), filename)
        try:
            os.remove(path)
        except OSError:
            pass
    db.conn.execute(
        "UPDATE admin_preferences SET custom_file=NULL, background='bing',"
        " updated_at=? WHERE admin_id=?",
        (security.iso(), admin_id),
    )
    db.audit("admin_background_deleted", ip=ip)
    return {"ok": True, "theme": _theme_payload(_theme_row(db, admin_id))}


# ---------------------------------------------------------------------------
# 时间小工具
# ---------------------------------------------------------------------------
def _cst_day(moment: _dt.datetime | None = None) -> str:
    moment = (moment or security.now()).astimezone(security.CST)
    return moment.strftime("%Y-%m-%d")


def _start_of_today() -> str:
    now = security.now().astimezone(security.CST)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return security.iso(start)


def _seconds_until(moment_iso: str) -> int:
    try:
        moment = _dt.datetime.strptime(moment_iso, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=_dt.timezone.utc)
    except (TypeError, ValueError):
        return LOCK_SECONDS
    return max(1, int((moment - security.now()).total_seconds()) + 1)


def _local(iso_text: str | None) -> str | None:
    return security.display(iso_text)


# ---------------------------------------------------------------------------
# 管理员账号与会话
# ---------------------------------------------------------------------------
def ensure_seed(db: Database) -> None:
    """第一次启动时创建默认管理员，并把手上的环境变量固化成设置。"""
    row = db.conn.execute("SELECT COUNT(*) AS n FROM admins").fetchone()
    if int(row["n"]) == 0:
        db.conn.execute(
            "INSERT INTO admins(username, password_hash, created_at,"
            " must_change_password) VALUES(?,?,?,1)",
            (DEFAULT_ADMIN, security.hash_password(DEFAULT_PASSWORD), security.iso()),
        )
    settings.seed_from_env(db)
    now = security.iso()
    db.conn.execute("DELETE FROM admin_sessions WHERE expires_at<=?", (now,))
    db.conn.execute("DELETE FROM admin_ip_bans WHERE blocked_until<=?", (now,))


def list_admins(db: Database, session: sqlite3.Row) -> dict:
    rows = db.conn.execute(
        "SELECT a.id, a.username, a.created_at, a.password_changed_at,"
        " a.must_change_password,"
        " (SELECT MAX(at) FROM audit WHERE action='admin_login'"
        "   AND detail=a.username) AS last_login"
        " FROM admins a ORDER BY a.id"
    ).fetchall()
    current = int(session["admin_id"])
    return {
        "ok": True,
        "items": [
            {
                "id": int(row["id"]),
                "username": row["username"],
                "createdAt": row["created_at"],
                "createdAtLocal": _local(row["created_at"]),
                "passwordChangedAt": row["password_changed_at"],
                "mustChangePassword": bool(row["must_change_password"]),
                "lastLogin": row["last_login"],
                "lastLoginLocal": _local(row["last_login"]),
                "isSelf": int(row["id"]) == current,
            }
            for row in rows
        ],
    }


def create_admin(db: Database, body: dict, ip: str) -> dict:
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")
    if not _ADMIN_USERNAME_RE.match(username):
        raise bad_request(
            "invalid_username", "管理员账号需为 3–32 位小写字母、数字或下划线"
        )
    if len(password) > _MAX_PASSWORD:
        raise bad_request("invalid_password", "密码长度不合法")
    problem = security.password_problem(password)
    if problem:
        raise bad_request("weak_password", problem)
    if password == DEFAULT_PASSWORD:
        raise bad_request("weak_password", "不能使用默认密码")
    try:
        with db.conn:
            db.conn.execute(
                "INSERT INTO admins(username, password_hash, created_at,"
                " must_change_password) VALUES(?,?,?,1)",
                (username, security.hash_password(password), security.iso()),
            )
            db.audit("admin_create_admin", detail=username, ip=ip)
    except sqlite3.IntegrityError:
        raise conflict("admin_username_taken", "该管理员账号已存在")
    row = db.conn.execute(
        "SELECT id, username, created_at, password_changed_at,"
        " must_change_password FROM admins WHERE username=?",
        (username,),
    ).fetchone()
    return {
        "ok": True,
        "item": {
            "id": int(row["id"]),
            "username": row["username"],
            "createdAt": row["created_at"],
            "createdAtLocal": _local(row["created_at"]),
            "passwordChangedAt": row["password_changed_at"],
            "mustChangePassword": bool(row["must_change_password"]),
            "lastLogin": None,
            "lastLoginLocal": None,
            "isSelf": False,
        },
    }


def _active_lock(db: Database, ip: str) -> str | None:
    row = db.conn.execute(
        "SELECT blocked_until FROM admin_ip_bans WHERE ip=?", (ip,)
    ).fetchone()
    if row is None:
        return None
    if row["blocked_until"] > security.iso():
        return row["blocked_until"]
    db.conn.execute("DELETE FROM admin_ip_bans WHERE ip=?", (ip,))
    return None


def _record_failure(db: Database, ip: str, username: str) -> int:
    now = security.now()
    cutoff = security.iso(now - _dt.timedelta(seconds=FAIL_WINDOW_SECONDS))
    db.conn.execute(
        "INSERT INTO admin_login_attempts(ip, username, at) VALUES(?,?,?)",
        (ip, username[:32], security.iso(now)),
    )
    db.conn.execute("DELETE FROM admin_login_attempts WHERE at<?", (cutoff,))
    row = db.conn.execute(
        "SELECT COUNT(*) AS n FROM admin_login_attempts WHERE ip=? AND at>=?",
        (ip, cutoff),
    ).fetchone()
    return int(row["n"])


def _lock_ip(db: Database, ip: str) -> str:
    until = security.iso_after(seconds=LOCK_SECONDS)
    db.conn.execute(
        "INSERT INTO admin_ip_bans(ip, blocked_until, created_at) VALUES(?,?,?)"
        " ON CONFLICT(ip) DO UPDATE SET blocked_until=excluded.blocked_until",
        (ip, until, security.iso()),
    )
    db.conn.execute("DELETE FROM admin_login_attempts WHERE ip=?", (ip,))
    db.audit("admin_locked", detail=f"ip={ip}", ip=ip)
    return until


def login(db: Database, body: dict, ip: str) -> dict:
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")

    locked_until = _active_lock(db, ip)
    if locked_until:
        raise too_many(
            "admin_locked",
            "密码错误次数过多，该 IP 已被锁定，请稍后再试",
            retryAfter=_seconds_until(locked_until),
            lockedUntil=locked_until,
        )

    # 超长凭据直接拒绝，避免把 1MB 输入送进 scrypt/数据库。
    if (not username or len(username) > _MAX_USERNAME
            or len(password) > _MAX_PASSWORD):
        failures = _record_failure(db, ip, username)
        db.audit("admin_login_failed", detail=username[:32], ip=ip)
        raise ApiError(
            401, "invalid_admin_credentials", "管理员账号或密码错误",
            attemptsLeft=max(0, MAX_FAILS - failures),
        )

    row = db.conn.execute(
        "SELECT * FROM admins WHERE username=?", (username,)
    ).fetchone()
    if row is None:
        # 用户不存在时也做一次等价哈希，避免用响应时间枚举管理员账号。
        security.verify_password(password, _DUMMY_HASH)
        matched = False
    else:
        matched = security.verify_password(password, row["password_hash"])
    if not matched:
        failures = _record_failure(db, ip, username)
        if failures >= MAX_FAILS:
            until = _lock_ip(db, ip)
            raise too_many(
                "admin_locked",
                "密码错误次数过多，该 IP 已被锁定 1 小时",
                retryAfter=_seconds_until(until),
                lockedUntil=until,
            )
        db.audit("admin_login_failed", detail=username[:32], ip=ip)
        raise ApiError(
            401, "invalid_admin_credentials", "管理员账号或密码错误",
            attemptsLeft=max(0, MAX_FAILS - failures),
        )

    db.conn.execute("DELETE FROM admin_login_attempts WHERE ip=?", (ip,))
    token, digest = security.new_session_token()
    expires = security.iso_after(hours=ADMIN_SESSION_HOURS)
    db.conn.execute(
        "INSERT INTO admin_sessions(token_sha256, admin_id, created_at,"
        " expires_at, last_seen, ip) VALUES(?,?,?,?,?,?)",
        (digest, int(row["id"]), security.iso(), expires, security.iso(), ip),
    )
    db.audit("admin_login", detail=username, ip=ip)
    return {
        "ok": True,
        "token": token,
        "id": int(row["id"]),
        "username": row["username"],
        "mustChangePassword": bool(row["must_change_password"]),
        "expiresAt": expires,
        "adminVersion": ADMIN_VERSION,
        "theme": _theme_payload(_theme_row(db, int(row["id"]))),
    }


def check_session(db: Database, token: str | None) -> sqlite3.Row:
    """给其它模块复用的管理员鉴权（失败抛 unauthorized）。"""
    return _session(db, token)


def _session(db: Database, token: str | None) -> sqlite3.Row:
    if not token:
        raise unauthorized("admin_unauthorized", "请先登录管理员账户")
    digest = security.hash_token(token)
    row = db.conn.execute(
        "SELECT s.admin_id, s.expires_at, a.username, a.must_change_password\n"
        "  FROM admin_sessions s JOIN admins a ON a.id=s.admin_id\n"
        " WHERE s.token_sha256=?",
        (digest,),
    ).fetchone()
    if row is None:
        raise unauthorized("admin_unauthorized", "请先登录管理员账户")
    if row["expires_at"] <= security.iso():
        db.conn.execute("DELETE FROM admin_sessions WHERE token_sha256=?", (digest,))
        raise unauthorized("admin_session_expired", "登录已过期，请重新登录")
    db.conn.execute(
        "UPDATE admin_sessions SET last_seen=? WHERE token_sha256=?",
        (security.iso(), digest),
    )
    return row


def _password_failures(db: Database, username: str) -> int:
    cutoff = security.iso(
        security.now() - _dt.timedelta(seconds=PASSWORD_FAIL_WINDOW_SECONDS)
    )
    row = db.conn.execute(
        "SELECT COUNT(*) AS n FROM audit WHERE action='admin_password_failed'"
        " AND detail=? AND at>=?",
        (username, cutoff),
    ).fetchone()
    return int(row["n"] or 0)


def change_password(db: Database, token: str, body: dict, ip: str) -> dict:
    session = _session(db, token)
    old = str(body.get("oldPassword") or "")
    new = str(body.get("newPassword") or "")
    if len(old) > _MAX_PASSWORD or len(new) > _MAX_PASSWORD:
        raise bad_request("invalid_password", "密码长度不合法")
    row = db.conn.execute(
        "SELECT * FROM admins WHERE id=?", (int(session["admin_id"]),)
    ).fetchone()
    if row is None:
        raise unauthorized("admin_unauthorized", "管理员不存在")
    failures = _password_failures(db, row["username"])
    if failures >= PASSWORD_FAIL_LIMIT:
        raise too_many(
            "admin_password_locked",
            "当前密码错误次数过多，请 15 分钟后再试",
            retryAfter=PASSWORD_FAIL_WINDOW_SECONDS,
        )
    if not security.verify_password(old, row["password_hash"]):
        db.audit("admin_password_failed", detail=row["username"], ip=ip)
        raise bad_request("invalid_old_password", "当前密码不正确")
    problem = security.password_problem(new)
    if problem:
        raise bad_request("weak_password", problem)
    if new == old:
        raise bad_request("same_password", "新密码不能与当前密码相同")
    if new == DEFAULT_PASSWORD:
        raise bad_request("weak_password", "不能继续使用默认密码")
    db.conn.execute(
        "UPDATE admins SET password_hash=?, password_changed_at=?,"
        " must_change_password=0 WHERE id=?",
        (security.hash_password(new), security.iso(), int(row["id"])),
    )
    # 其它设备上的管理员会话立即失效，当前会话保留。
    db.conn.execute(
        "DELETE FROM admin_sessions WHERE admin_id=? AND token_sha256<>?",
        (int(row["id"]), security.hash_token(token)),
    )
    db.audit("admin_password_changed", detail=row["username"], ip=ip)
    return {"ok": True, "mustChangePassword": False}


def logout(db: Database, token: str) -> dict:
    db.conn.execute(
        "DELETE FROM admin_sessions WHERE token_sha256=?",
        (security.hash_token(token),),
    )
    return {"ok": True}


def _me(db: Database, session: sqlite3.Row) -> dict:
    return {
        "ok": True,
        "id": int(session["admin_id"]),
        "username": session["username"],
        "mustChangePassword": bool(session["must_change_password"]),
        "adminVersion": ADMIN_VERSION,
        "serverVersion": VERSION,
        "loginProtection": {
            "maxFails": MAX_FAILS,
            "windowMinutes": FAIL_WINDOW_SECONDS // 60,
            "lockMinutes": LOCK_SECONDS // 60,
        },
        "theme": _theme_payload(_theme_row(db, int(session["admin_id"]))),
    }


# ---------------------------------------------------------------------------
# 请求/带宽统计
# ---------------------------------------------------------------------------
class Stats:
    """进程内按日累加，定期落库。

    落库使用绝对值 UPSERT 而不是增量，重启后先 load 当天数据，所以不会
    重复计数，也不会在重启时丢掉已经写下的历史。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, dict] = {}
        self._paths: dict[str, Counter] = {}
        self._dirty: set[str] = set()

    def load(self, db: Database) -> None:
        day = _cst_day()
        row = db.conn.execute(
            "SELECT * FROM server_stats WHERE day=?", (day,)
        ).fetchone()
        if row is None:
            return
        with self._lock:
            self._counters[day] = {
                "requests": int(row["requests"]),
                "bytesIn": int(row["bytes_in"]),
                "bytesOut": int(row["bytes_out"]),
                "errors": int(row["errors"]),
            }

    def _bucket(self, day: str) -> dict:
        bucket = self._counters.get(day)
        if bucket is None:
            bucket = {"requests": 0, "bytesIn": 0, "bytesOut": 0, "errors": 0}
            self._counters[day] = bucket
        return bucket

    def record_request(self, method: str, path: str) -> None:
        day = _cst_day()
        with self._lock:
            self._bucket(day)["requests"] += 1
            counter = self._paths.setdefault(day, Counter())
            key = f"{method} {path}"
            counter[key] += 1
            if len(counter) > 400:
                # 只在异常流量下触发：保留最常见的一部分，避免内存膨胀。
                self._paths[day] = Counter(dict(counter.most_common(200)))
            self._dirty.add(day)

    def add_bytes_in(self, count: int) -> None:
        if count <= 0:
            return
        day = _cst_day()
        with self._lock:
            self._bucket(day)["bytesIn"] += int(count)
            self._dirty.add(day)

    def add_bytes_out(self, count: int) -> None:
        if count <= 0:
            return
        day = _cst_day()
        with self._lock:
            self._bucket(day)["bytesOut"] += int(count)
            self._dirty.add(day)

    def record_error(self) -> None:
        day = _cst_day()
        with self._lock:
            self._bucket(day)["errors"] += 1
            self._dirty.add(day)

    def today(self) -> dict:
        day = _cst_day()
        with self._lock:
            bucket = dict(self._bucket(day))
        bucket["day"] = day
        return bucket

    def top_paths(self, limit: int = 8) -> list[dict]:
        day = _cst_day()
        with self._lock:
            counter = self._paths.get(day, Counter())
            items = counter.most_common(limit)
            total = sum(counter.values()) or 1
        return [
            {"path": name, "count": count, "share": round(count * 100 / total, 1)}
            for name, count in items
        ]

    def flush(self, db: Database) -> None:
        with self._lock:
            days = list(self._dirty)
            self._dirty.clear()
            snapshot = {
                day: dict(self._counters.get(day, {}))
                for day in days
            }
        for day, bucket in snapshot.items():
            if not day or not bucket:
                continue
            try:
                db.conn.execute(
                    "INSERT INTO server_stats(day, requests, bytes_in, bytes_out, errors)"
                    " VALUES(?,?,?,?,?)"
                    " ON CONFLICT(day) DO UPDATE SET"
                    " requests=excluded.requests, bytes_in=excluded.bytes_in,"
                    " bytes_out=excluded.bytes_out, errors=excluded.errors",
                    (
                        day,
                        int(bucket.get("requests", 0)),
                        int(bucket.get("bytesIn", 0)),
                        int(bucket.get("bytesOut", 0)),
                        int(bucket.get("errors", 0)),
                    ),
                )
            except sqlite3.Error:
                # 统计失败绝不能影响主服务。
                pass

    def history(self, db: Database, days: int = 14) -> list[dict]:
        days = max(1, min(int(days), 60))
        today = security.now().astimezone(security.CST)
        keys = [
            (today - _dt.timedelta(days=offset)).strftime("%Y-%m-%d")
            for offset in range(days - 1, -1, -1)
        ]
        rows = {
            row["day"]: row
            for row in db.conn.execute(
                "SELECT * FROM server_stats WHERE day>=?", (keys[0],)
            )
        }
        with self._lock:
            live = {
                day: dict(bucket) for day, bucket in self._counters.items()
            }
        result = []
        for day in keys:
            base = {
                "requests": 0, "bytesIn": 0, "bytesOut": 0, "errors": 0,
            }
            row = rows.get(day)
            if row is not None:
                base = {
                    "requests": int(row["requests"]),
                    "bytesIn": int(row["bytes_in"]),
                    "bytesOut": int(row["bytes_out"]),
                    "errors": int(row["errors"]),
                }
            if day in live:
                base = dict(live[day])
            base["day"] = day
            result.append(base)
        return result


stats = Stats()
_stats_stop = threading.Event()


def start_background(db: Database) -> threading.Thread:
    stats.load(db)

    def loop() -> None:
        while not _stats_stop.wait(5):
            stats.flush(db)

    thread = threading.Thread(target=loop, name="qi-admin-stats", daemon=True)
    thread.start()
    return thread


def stop_background(thread: threading.Thread) -> None:
    _stats_stop.set()
    try:
        thread.join(timeout=3)
    except RuntimeError:
        pass


# ---------------------------------------------------------------------------
# 主机网络流量（/proc/net/dev）
# ---------------------------------------------------------------------------
_net_lock = threading.Lock()
_net_prev: tuple[float, int, int] | None = None


def _host_net() -> dict:
    global _net_prev
    rx_total = 0
    tx_total = 0
    available = False
    try:
        with open("/proc/net/dev", "r", encoding="utf-8") as handle:
            lines = handle.readlines()[2:]
        for line in lines:
            if ":" not in line:
                continue
            name, data = line.split(":", 1)
            if name.strip() == "lo":
                continue
            fields = data.split()
            if len(fields) < 9:
                continue
            rx_total += int(fields[0])
            tx_total += int(fields[8])
        available = True
    except (OSError, ValueError):
        pass

    now = time.monotonic()
    rx_rate = tx_rate = 0.0
    with _net_lock:
        if available and _net_prev is not None:
            previous_at, previous_rx, previous_tx = _net_prev
            elapsed = now - previous_at
            if elapsed > 0:
                rx_rate = max(0.0, (rx_total - previous_rx) / elapsed)
                tx_rate = max(0.0, (tx_total - previous_tx) / elapsed)
        if available:
            _net_prev = (now, rx_total, tx_total)
    return {
        "available": available,
        "rxBytes": rx_total,
        "txBytes": tx_total,
        "rxRate": round(rx_rate),
        "txRate": round(tx_rate),
    }


# ---------------------------------------------------------------------------
# 账户读取
# ---------------------------------------------------------------------------
def _devices_by_user(db: Database) -> dict[int, list[sqlite3.Row]]:
    result: dict[int, list[sqlite3.Row]] = {}
    for row in db.conn.execute(
        "SELECT * FROM devices ORDER BY created_at DESC"
    ):
        result.setdefault(int(row["user_id"]), []).append(row)
    return result


def _active_pairs(db: Database) -> dict[str, sqlite3.Row]:
    index: dict[str, sqlite3.Row] = {}
    for row in db.conn.execute(
        "SELECT * FROM pairs WHERE unpaired_at IS NULL"
    ):
        index[row["master_device"]] = row
        index[row["puppy_device"]] = row
    return index


def _presence_by_device(db: Database) -> dict[str, sqlite3.Row]:
    return {
        row["device_id"]: row
        for row in db.conn.execute("SELECT * FROM presence")
    }


def _last_seen_by_user(db: Database) -> dict[int, str]:
    return {
        int(row["user_id"]): row["last_seen"]
        for row in db.conn.execute(
            "SELECT user_id, MAX(last_seen) AS last_seen FROM sessions"
            " GROUP BY user_id"
        )
    }


def _collect_accounts(db: Database) -> list[dict]:
    users = db.conn.execute(
        "SELECT id, username, created_at, disabled, ban_until, ban_reason,"
        " ban_at, ban_by FROM users ORDER BY id DESC"
    ).fetchall()
    devices = _devices_by_user(db)
    pairs = _active_pairs(db)
    presence = _presence_by_device(db)
    last_seen = _last_seen_by_user(db)
    now = security.iso()
    online_threshold = security.iso(
        security.now() - _dt.timedelta(seconds=_ONLINE_SECONDS)
    )

    accounts = []
    for user in users:
        own_devices = devices.get(int(user["id"]), [])
        active_devices = [d for d in own_devices if not d["revoked_at"]]
        primary = active_devices[0] if active_devices else None
        pair = None
        for device in own_devices:
            candidate = pairs.get(device["id"])
            if candidate is not None:
                pair = candidate
                break

        if user["disabled"]:
            state, state_label = "disabled", "永久封禁"
        elif user["ban_until"] and user["ban_until"] > now:
            state, state_label = "banned", "封禁中"
        else:
            state, state_label = "active", "正常"

        pair_state = "none"
        peer_name = None
        role = None
        pair_id = None
        if pair is not None:
            own_ids = {device["id"] for device in own_devices}
            role = "MASTER" if pair["master_device"] in own_ids else "PUPPY"
            peer_name = pair["puppy_name"] if role == "MASTER" else pair["owner_name"]
            pair_id = pair["id"]
            pair_state = "paired" if pair["verified_at"] else "pending"

        online = any(
            presence.get(device["id"]) is not None
            and presence[device["id"]]["at"] >= online_threshold
            for device in own_devices
        )
        accounts.append({
            "id": int(user["id"]),
            "username": user["username"],
            "createdAt": user["created_at"],
            "createdAtLocal": _local(user["created_at"]),
            "status": state,
            "statusLabel": state_label,
            "banUntil": user["ban_until"],
            "banUntilLocal": _local(user["ban_until"]),
            "banReason": user["ban_reason"],
            "banAt": user["ban_at"],
            "banBy": user["ban_by"],
            "disabled": bool(user["disabled"]),
            "deviceCount": len(active_devices),
            "deviceName": primary["name"] if primary else None,
            "platform": primary["platform"] if primary else None,
            "deviceCreatedAt": primary["created_at"] if primary else None,
            "pairState": pair_state,
            "pairStateLabel": {
                "paired": "已绑定", "pending": "待确认", "none": "未绑定",
            }[pair_state],
            "pairId": pair_id,
            "role": role,
            "peerName": peer_name,
            "online": online,
            "lastSeen": last_seen.get(int(user["id"])),
            "lastSeenLocal": _local(last_seen.get(int(user["id"]))),
        })
    return accounts


def _filter_accounts(accounts: list[dict], query: str, status: str) -> list[dict]:
    needle = (query or "").strip().lower()
    if needle:
        accounts = [
            item for item in accounts
            if needle in item["username"].lower()
            or needle in str(item["id"])
        ]
    if status and status != "all":
        accounts = [item for item in accounts if item["status"] == status]
    return accounts


def list_accounts(db: Database, query: dict) -> dict:
    try:
        page = max(1, int(query.get("page") or 1))
        page_size = max(1, min(100, int(query.get("pageSize") or 20)))
    except (TypeError, ValueError):
        raise bad_request("invalid_page", "分页参数不合法")
    accounts = _collect_accounts(db)
    filtered = _filter_accounts(
        accounts, str(query.get("q") or ""), str(query.get("status") or "all")
    )
    total = len(filtered)
    start = (page - 1) * page_size
    return {
        "ok": True,
        "items": filtered[start:start + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


# ---------------------------------------------------------------------------
# 账户写操作
# ---------------------------------------------------------------------------
def _user_row(db: Database, user_id: int) -> sqlite3.Row:
    row = db.conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        raise not_found("account_not_found", "账号不存在")
    return row


def create_account(db: Database, body: dict, ip: str) -> dict:
    username = str(body.get("username") or "").strip().lower()
    password = str(body.get("password") or "")
    if not security.USERNAME_RE.match(username):
        raise bad_request("invalid_username", "账号需为 3–32 位小写字母/数字/下划线")
    if len(password) > _MAX_PASSWORD:
        raise bad_request("invalid_password", "密码长度不合法")
    problem = security.password_problem(password)
    if problem:
        raise bad_request("weak_password", problem)
    try:
        cursor = db.conn.execute(
            "INSERT INTO users(username, password_hash, created_at) VALUES(?,?,?)",
            (username, security.hash_password(password), security.iso()),
        )
    except sqlite3.IntegrityError:
        raise conflict("username_taken", "这个账号已经存在")
    db.audit("admin_create_account", detail=username, ip=ip)
    return {"ok": True, "id": int(cursor.lastrowid), "username": username}


def ban_account(db: Database, user_id: int, body: dict, ip: str) -> dict:
    row = _user_row(db, user_id)
    duration = str(body.get("duration") or "").strip()
    if duration not in BAN_DURATIONS:
        raise bad_request("invalid_duration", "封禁期限不合法")
    reason = str(body.get("reason") or "").strip()[:200]
    seconds, label = BAN_DURATIONS[duration]
    now = security.iso()
    detail = f"{row['username']}:{duration}"
    if reason:
        detail += f":{reason}"
    with db.conn:
        if seconds is None:
            db.conn.execute(
                "UPDATE users SET disabled=1, ban_until=NULL, ban_reason=?,"
                " ban_at=?, ban_by=? WHERE id=?",
                (reason or None, now, DEFAULT_ADMIN, user_id),
            )
            until = None
        else:
            until = security.iso(security.now() + _dt.timedelta(seconds=seconds))
            db.conn.execute(
                "UPDATE users SET disabled=0, ban_until=?, ban_reason=?,"
                " ban_at=?, ban_by=? WHERE id=?",
                (until, reason or None, now, DEFAULT_ADMIN, user_id),
            )
        # 踢掉现有登录，封禁立即生效。
        db.conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        db.audit("admin_ban_account", detail=detail, ip=ip)
    return {
        "ok": True,
        "id": user_id,
        "duration": duration,
        "durationLabel": label,
        "banUntil": until,
    }


def unban_account(db: Database, user_id: int, ip: str) -> dict:
    row = _user_row(db, user_id)
    with db.conn:
        db.conn.execute(
            "UPDATE users SET disabled=0, ban_until=NULL, ban_reason=NULL,"
            " ban_at=NULL, ban_by=NULL WHERE id=?",
            (user_id,),
        )
        db.audit("admin_unban_account", detail=row["username"], ip=ip)
    return {"ok": True, "id": user_id}


def delete_account(db: Database, user_id: int, ip: str) -> dict:
    row = _user_row(db, user_id)
    devices = [
        item["id"] for item in db.conn.execute(
            "SELECT id FROM devices WHERE user_id=?", (user_id,)
        )
    ]
    pairs = db.conn.execute(
        "SELECT * FROM pairs WHERE id IN (%s)"
        % ",".join("?" for _ in devices or [""]),
        tuple(devices or [""]),
    ).fetchall()
    now = security.iso()
    with db.conn:
        for pair in pairs:
            # 暂存消息只服务于这台设备/这对绑定，删号时直接清掉，节省空间。
            _clear_staging_pair(db, pair["id"])
            peer_device = (pair["puppy_device"]
                           if pair["master_device"] in devices
                           else pair["master_device"])
            peer_user = db.conn.execute(
                "SELECT user_id FROM devices WHERE id=?", (peer_device,)
            ).fetchone()
            # 另一端账号还在时保留共同日记；两端都没了才清云空间。
            if peer_user is None or int(peer_user["user_id"]) == user_id:
                _clear_cloud_pair(db, pair["id"])
        for device_id in devices:
            db.conn.execute(
                "UPDATE pairs SET unpaired_at=? WHERE unpaired_at IS NULL"
                " AND (master_device=? OR puppy_device=?)",
                (now, device_id, device_id),
            )
        db.conn.execute("DELETE FROM presence WHERE user_id=?", (user_id,))
        db.conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        db.conn.execute("DELETE FROM devices WHERE user_id=?", (user_id,))
        db.conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        # 券是端到端密文，属于配对双方；单边删号时保留，避免把共同
        # 记忆从另一方那里一并抹掉。设备与会话已全部清除。
        db.audit("admin_delete_account", detail=row["username"], ip=ip)
    return {"ok": True, "id": user_id, "username": row["username"]}


# ---------------------------------------------------------------------------
# v0.7.0：公告 / 存储 / 配对云空间
# ---------------------------------------------------------------------------
def _user_pair_ids(db: Database, user_id: int) -> list[str]:
    rows = db.conn.execute(
        "SELECT p.id FROM pairs p JOIN devices d\n"
        "  ON d.id=p.master_device OR d.id=p.puppy_device\n"
        " WHERE d.user_id=? GROUP BY p.id",
        (user_id,),
    ).fetchall()
    return [str(row["id"]) for row in rows]


def _pair_row(db: Database, pair_id: str) -> sqlite3.Row:
    row = db.conn.execute("SELECT * FROM pairs WHERE id=?", (pair_id,)).fetchone()
    if row is None:
        raise not_found("pair_not_found", "绑定不存在")
    return row


def _clear_staging_pair(db: Database, pair_id: str) -> int:
    cursor = db.conn.execute("DELETE FROM staged_items WHERE pair_id=?", (pair_id,))
    db.conn.execute("DELETE FROM storage_samples WHERE pair_id=?", (pair_id,))
    return cursor.rowcount


def _clear_cloud_pair(db: Database, pair_id: str) -> int:
    records = db.conn.execute(
        "DELETE FROM sync_records WHERE pair_id=?", (pair_id,)
    ).rowcount
    media = db.conn.execute("DELETE FROM media WHERE pair_id=?", (pair_id,)).rowcount
    db.conn.execute("DELETE FROM storage_samples WHERE pair_id=?", (pair_id,))
    return records + media


def _pair_storage_entry(db: Database, pair: sqlite3.Row) -> dict:
    storage = staging.pair_storage(db, pair["id"])
    return {
        "pairId": pair["id"],
        "ownerName": pair["owner_name"],
        "puppyName": pair["puppy_name"],
        "verified": bool(pair["verified_at"]),
        "unpaired": bool(pair["unpaired_at"]),
        "quotaBytes": int(pair["cloud_quota_bytes"] or 0),
        "stagingLimits": staging.pair_limits(pair),
        **storage,
    }


def account_storage(db: Database, user_id: int) -> dict:
    row = _user_row(db, user_id)
    pairs = db.conn.execute(
        "SELECT * FROM pairs WHERE id IN (%s) ORDER BY created_at DESC"
        % ",".join("?" for _ in _user_pair_ids(db, user_id) or [""]),
        tuple(_user_pair_ids(db, user_id) or [""]),
    ).fetchall()
    items = [_pair_storage_entry(db, pair) for pair in pairs]
    return {
        "ok": True,
        "userId": user_id,
        "username": row["username"],
        "pairs": items,
        "stagedBytes": sum(item["stagedBytes"] for item in items),
        "cloudBytes": sum(item["cloudBytes"] for item in items),
    }


def clear_account_staging(db: Database, user_id: int, ip: str) -> dict:
    row = _user_row(db, user_id)
    removed = 0
    for pair_id in _user_pair_ids(db, user_id):
        removed += _clear_staging_pair(db, pair_id)
    db.audit("admin_clear_staging", detail=row["username"], ip=ip)
    return {"ok": True, "removed": removed}


def clear_account_cloud(db: Database, user_id: int, ip: str) -> dict:
    row = _user_row(db, user_id)
    removed = 0
    for pair_id in _user_pair_ids(db, user_id):
        removed += _clear_cloud_pair(db, pair_id)
    db.audit("admin_clear_cloud", detail=row["username"], ip=ip)
    return {"ok": True, "removed": removed}


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def set_pair_limits(db: Database, pair_id: str, body: dict, ip: str) -> dict:
    """同时调整云配额与暂存区门禁；只传部分字段时保留其余配置。"""
    row = _pair_row(db, pair_id)
    fields: list[str] = []
    values: list = []
    if "quotaBytes" in body:
        try:
            quota = int(body.get("quotaBytes"))
        except (TypeError, ValueError):
            raise bad_request("invalid_quota", "配额必须是整数")
        if quota < 0 or quota > 100 * 1024 ** 3:
            raise bad_request("invalid_quota", "配额需在 0–100GB 之间（0 表示不限）")
        fields.append("cloud_quota_bytes=?")
        values.append(quota)
    if "ttlHours" in body:
        try:
            ttl = int(body.get("ttlHours"))
        except (TypeError, ValueError):
            raise bad_request("invalid_ttl", "暂存时长必须是整数")
        if ttl < 1 or ttl > staging.MAX_TTL_HOURS:
            raise bad_request("invalid_ttl", "暂存时长需在 1–720 小时之间")
        fields.append("staging_ttl_hours=?")
        values.append(ttl)
    if "budgetBytes" in body:
        try:
            budget = int(body.get("budgetBytes"))
        except (TypeError, ValueError):
            raise bad_request("invalid_budget", "暂存容量必须是整数")
        if budget < staging.MIN_BUDGET_BYTES or budget > staging.MAX_BUDGET_BYTES:
            raise bad_request("invalid_budget", "暂存容量需在 1MB–2GB 之间")
        fields.append("staging_budget_bytes=?")
        values.append(budget)
    for key, column in (("timeGate", "staging_time_gate"),
                        ("sizeGate", "staging_size_gate")):
        if key in body:
            fields.append(f"{column}=?")
            values.append(1 if _as_bool(body.get(key)) else 0)
    if not fields:
        raise bad_request("nothing_to_update", "没有需要更新的设置")
    db.conn.execute(
        f"UPDATE pairs SET {', '.join(fields)} WHERE id=?",
        (*values, pair_id),
    )
    updated = _pair_row(db, pair_id)
    limits = staging.pair_limits(updated)
    # 门禁切换或 TTL 变化后，重设未确认条目的过期时间，避免关闭时间门禁后旧条目立刻过期。
    if "ttlHours" in body or "timeGate" in body:
        hours = limits["ttlHours"] if limits["timeGate"] else staging.GATE_OFF_TTL_HOURS
        db.conn.execute(
            "UPDATE staged_items SET expires_at=? WHERE pair_id=? AND acked_at IS NULL",
            (security.iso_after(hours=hours), pair_id),
        )
    db.audit(
        "admin_pair_limits",
        detail=json.dumps(
            {"pair": pair_id, "quotaBytes": int(updated["cloud_quota_bytes"] or 0),
             **limits},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        ip=ip,
    )
    return {"ok": True, **_pair_storage_entry(db, _pair_row(db, pair_id))}


def set_pair_quota(db: Database, pair_id: str, body: dict, ip: str) -> dict:
    return set_pair_limits(db, pair_id, {"quotaBytes": body.get("quotaBytes")}, ip)


def clear_pair_cloud(db: Database, pair_id: str, ip: str) -> dict:
    row = _pair_row(db, pair_id)
    removed = _clear_cloud_pair(db, pair_id)
    db.audit("admin_pair_clear_cloud", detail=row["id"], ip=ip)
    return {"ok": True, "removed": removed, **_pair_storage_entry(db, row)}


def storage_overview(db: Database, days: int = 14) -> dict:
    now = security.iso()
    staged = db.conn.execute(
        "SELECT pair_id, COALESCE(SUM(byte_len), 0) AS bytes, COUNT(*) AS items\n"
        "  FROM staged_items WHERE acked_at IS NULL AND expires_at>?\n"
        " GROUP BY pair_id",
        (now,),
    ).fetchall()
    records = db.conn.execute(
        "SELECT pair_id, COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes\n"
        "  FROM sync_records WHERE deleted=0 GROUP BY pair_id"
    ).fetchall()
    media = db.conn.execute(
        "SELECT pair_id, COALESCE(SUM(LENGTH(data)), 0) AS bytes\n"
        "  FROM media GROUP BY pair_id"
    ).fetchall()
    merged: dict[str, dict] = {}
    for row in staged:
        merged.setdefault(row["pair_id"], {"stagedBytes": 0, "itemCount": 0, "cloudBytes": 0})
        merged[row["pair_id"]]["stagedBytes"] = int(row["bytes"])
        merged[row["pair_id"]]["itemCount"] = int(row["items"])
    for row in records:
        merged.setdefault(row["pair_id"], {"stagedBytes": 0, "itemCount": 0, "cloudBytes": 0})
        merged[row["pair_id"]]["cloudBytes"] += int(row["bytes"])
    for row in media:
        merged.setdefault(row["pair_id"], {"stagedBytes": 0, "itemCount": 0, "cloudBytes": 0})
        merged[row["pair_id"]]["cloudBytes"] += int(row["bytes"])

    pairs = {
        row["id"]: row for row in db.conn.execute(
            "SELECT id, owner_name, puppy_name, verified_at, unpaired_at,\n"
            "       cloud_quota_bytes FROM pairs"
        )
    }
    top = []
    for pair_id, values in sorted(
        merged.items(), key=lambda item: item[1]["stagedBytes"] + item[1]["cloudBytes"],
        reverse=True,
    )[:8]:
        pair = pairs.get(pair_id)
        top.append({
            "pairId": pair_id,
            "ownerName": pair["owner_name"] if pair else "",
            "puppyName": pair["puppy_name"] if pair else "",
            "verified": bool(pair["verified_at"]) if pair else False,
            "quotaBytes": int(pair["cloud_quota_bytes"] or 0) if pair else 0,
            **values,
        })
    active_quota = db.conn.execute(
        "SELECT COALESCE(SUM(cloud_quota_bytes), 0) AS bytes\n"
        "  FROM pairs WHERE unpaired_at IS NULL"
    ).fetchone()["bytes"]
    return {
        "ok": True,
        "series": staging.storage_series(db, days),
        "totals": {
            "stagedBytes": sum(item["stagedBytes"] for item in merged.values()),
            "stagedItems": sum(item["itemCount"] for item in merged.values()),
            "cloudBytes": sum(item["cloudBytes"] for item in merged.values()),
            "quotaBytes": int(active_quota or 0),
        },
        "pairs": top,
    }


def publish_broadcast(db: Database, body: dict, ip: str) -> dict:
    try:
        result = broadcast.publish(db, body)
    except ValueError as error:
        raise bad_request("invalid_broadcast", str(error)) from error
    db.audit("admin_broadcast", detail=str(result.get("text"))[:80], ip=ip)
    return result


def clear_broadcast(db: Database, ip: str) -> dict:
    result = broadcast.clear(db)
    db.audit("admin_broadcast_clear", ip=ip)
    return result


# ---------------------------------------------------------------------------
# 概览 / 审计 / 设置
# ---------------------------------------------------------------------------
def _audit_rows(db: Database, limit: int = 12) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    rows = db.conn.execute(
        "SELECT id, at, actor_device, action, detail, ip FROM audit"
        " ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "at": row["at"],
            "atLocal": _local(row["at"]),
            "actor": row["actor_device"],
            "action": row["action"],
            "detail": row["detail"],
            "ip": row["ip"],
        }
        for row in rows
    ]


def overview(db: Database) -> dict:
    now = security.iso()
    online_threshold = security.iso(
        security.now() - _dt.timedelta(seconds=_ONLINE_SECONDS)
    )
    one = lambda sql, args=(): int(db.conn.execute(sql, args).fetchone()[0] or 0)
    counts = {
        "accounts": one("SELECT COUNT(*) FROM users"),
        "banned": one(
            "SELECT COUNT(*) FROM users WHERE disabled=1"
            " OR (ban_until IS NOT NULL AND ban_until>?)", (now,)
        ),
        "createdToday": one(
            "SELECT COUNT(*) FROM users WHERE created_at>=?", (_start_of_today(),)
        ),
        "devices": one("SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL"),
        "onlineDevices": one(
            "SELECT COUNT(*) FROM presence WHERE at>=?", (online_threshold,)
        ),
        "pairs": one("SELECT COUNT(*) FROM pairs WHERE unpaired_at IS NULL"),
        "sessions": one(
            "SELECT COUNT(*) FROM sessions WHERE expires_at>?", (now,)
        ),
    }
    db_bytes = 0
    for suffix in ("", "-wal"):
        try:
            db_bytes += os.path.getsize(db.path + suffix)
        except OSError:
            pass
    return {
        "ok": True,
        "counts": counts,
        "today": stats.today(),
        "history": stats.history(db, 14),
        "topPaths": stats.top_paths(8),
        "network": _host_net(),
        "server": {
            "version": VERSION,
            "adminVersion": ADMIN_VERSION,
            "uptimeSeconds": int(time.time() - _BOOTED_AT),
            "dbBytes": db_bytes,
            "startedAt": _dt.datetime.fromtimestamp(
                _BOOTED_AT, _dt.timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "registration": settings.open_registration(db),
        "recentAudit": _audit_rows(db, 8),
    }


def settings_payload(db: Database) -> dict:
    return {
        "ok": True,
        "registration": settings.open_registration(db),
        "loginProtection": {
            "maxFails": MAX_FAILS,
            "windowMinutes": FAIL_WINDOW_SECONDS // 60,
            "lockMinutes": LOCK_SECONDS // 60,
        },
        "adminVersion": ADMIN_VERSION,
        "serverVersion": VERSION,
    }


def set_registration(db: Database, body: dict, ip: str) -> dict:
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        raise bad_request("invalid_setting", "enabled 必须是布尔值")
    settings.put(db, settings.OPEN_REGISTRATION, "1" if enabled else "0")
    db.audit("admin_registration", detail="open" if enabled else "closed", ip=ip)
    return {"ok": True, "registration": enabled}


# ---------------------------------------------------------------------------
# Excel（xlsx）导出：标准库 zipfile + SpreadsheetML
# ---------------------------------------------------------------------------
def _xml_text(value) -> str:
    text = "" if value is None else str(value)
    # 孤立代理项无法编码进 XML；替换掉，避免导出整份表格失败。
    text = text.encode("utf-8", "replace").decode("utf-8")
    text = "".join(
        ch for ch in text
        if ch in "\t\n\r" or (ord(ch) >= 0x20 and ord(ch) not in (0xFFFE, 0xFFFF))
    )
    return escape(text)


def _col_name(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _cell(value, col: int, row: int, style: int = 2) -> str:
    ref = f"{_col_name(col)}{row}"
    if isinstance(value, bool):
        value = "是" if value else "否"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    if value is None or value == "":
        return f'<c r="{ref}" s="{style}"/>'
    return (
        f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">'
        f"{_xml_text(value)}</t></is></c>"
    )


_XLSX_HEADERS = [
    ("ID", 8),
    ("用户名", 18),
    ("创建时间", 20),
    ("状态", 12),
    ("封禁截止", 20),
    ("封禁原因", 28),
    ("设备数", 9),
    ("设备名称", 16),
    ("平台", 10),
    ("绑定状态", 10),
    ("最近在线", 20),
]


def build_accounts_xlsx(accounts: list[dict]) -> bytes:
    rows_xml = []
    header_cells = "".join(
        _cell(title, index, 1, 1) for index, (title, _width) in enumerate(_XLSX_HEADERS)
    )
    rows_xml.append(f'<row r="1" ht="26" customHeight="1">{header_cells}</row>')
    for offset, item in enumerate(accounts, start=2):
        values = [
            item["id"],
            item["username"],
            item["createdAtLocal"] or item["createdAt"],
            item["statusLabel"],
            item["banUntilLocal"] or "",
            item["banReason"] or "",
            item["deviceCount"],
            item["deviceName"] or "",
            item["platform"] or "",
            item["pairStateLabel"],
            item["lastSeenLocal"] or "从未登录",
        ]
        cells = "".join(
            _cell(value, index, offset, 2) for index, value in enumerate(values)
        )
        rows_xml.append(f'<row r="{offset}">{cells}</row>')
    last_row = len(accounts) + 1
    cols = "".join(
        f'<col min="{index + 1}" max="{index + 1}" width="{width}" customWidth="1"/>'
        for index, (_title, width) in enumerate(_XLSX_HEADERS)
    )
    dimension = f"A1:{_col_name(len(_XLSX_HEADERS) - 1)}{last_row}"

    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="{dimension}"/>'
        '<sheetViews><sheetView tabSelected="1" workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
        "</sheetView></sheetViews>"
        '<sheetFormatPr defaultRowHeight="20"/>'
        f"<cols>{cols}</cols>"
        f"<sheetData>{''.join(rows_xml)}</sheetData>"
        f'<autoFilter ref="{dimension}"/>'
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6"'
        ' header="0.3" footer="0.3"/>'
        "</worksheet>"
    )

    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="3">'
        '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        '<font><sz val="11"/><color rgb="FF222229"/><name val="Calibri"/></font>'
        "</fonts>"
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1B1B20"/>'
        '<bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
        '<borders count="2"><border/>'
        '<border><left style="thin"><color rgb="FFD9D9E0"/></left>'
        '<right style="thin"><color rgb="FFD9D9E0"/></right>'
        '<top style="thin"><color rgb="FFD9D9E0"/></top>'
        '<bottom style="thin"><color rgb="FFD9D9E0"/></bottom>'
        '<diagonal style="thin"><color rgb="FFD9D9E0"/></diagonal></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
        "</cellStyleXfs>"
        '<cellXfs count="3">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"'
        ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
        '<alignment horizontal="center" vertical="center"/></xf>'
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0"'
        ' applyFont="1" applyBorder="1" applyAlignment="1">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        "</cellXfs>"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/>'
        "</cellStyles>"
        "</styleSheet>"
    )

    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="账户列表" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
        ' Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
        ' Target="styles.xml"/>'
        "</Relationships>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
        ' Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels"'
        ' ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", styles)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return buffer.getvalue()


def export_accounts(db: Database, query: dict) -> FileResponse:
    accounts = _filter_accounts(
        _collect_accounts(db),
        str(query.get("q") or ""),
        str(query.get("status") or "all"),
    )
    body = build_accounts_xlsx(accounts)
    stamp = security.now().astimezone(security.CST).strftime("%Y%m%d-%H%M")
    return FileResponse(
        body=body,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="qi-accounts-{stamp}.xlsx"',
        },
    )


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
_ALLOWED_WHEN_LOCKED = {"/me", "/change-password", "/logout"}


def dispatch(db: Database, method: str, path: str, query: dict, body: dict,
             token: str | None, ip: str):
    route = path[len(API_PREFIX):] if path.startswith(API_PREFIX) else path

    if route == "/login":
        if method != "POST":
            raise ApiError(405, "method_not_allowed", "方法不允许")
        return login(db, body, ip)

    if route == "/login-background":
        if method != "GET":
            raise ApiError(405, "method_not_allowed", "方法不允许")
        return login_background(db)

    session = _session(db, token)
    if session["must_change_password"] and route not in _ALLOWED_WHEN_LOCKED:
        raise forbidden(
            "password_change_required", "首次登录必须修改管理员密码"
        )

    if route == "/me" and method == "GET":
        return _me(db, session)
    if route == "/change-password" and method == "POST":
        return change_password(db, token or "", body, ip)
    if route == "/logout" and method == "POST":
        return logout(db, token or "")
    if route == "/admins" and method == "GET":
        return list_admins(db, session)
    if route == "/admins" and method == "POST":
        return create_admin(db, body, ip)
    if route == "/theme" and method == "GET":
        return get_theme(db, session)
    if route == "/theme" and method == "PUT":
        return update_theme(db, session, body, ip)
    if route == "/theme/background" and method == "POST":
        return upload_theme_background(db, session, body, ip)
    if route == "/theme/background" and method == "GET":
        return theme_background(db, session)
    if route == "/theme/background" and method == "DELETE":
        return delete_theme_background(db, session, ip)
    if route == "/broadcast":
        if method == "GET":
            return broadcast.current(db)
        if method == "POST":
            return publish_broadcast(db, body, ip)
        if method == "DELETE":
            return clear_broadcast(db, ip)
        raise ApiError(405, "method_not_allowed", "方法不允许")
    if route == "/storage" and method == "GET":
        try:
            days = int(query.get("days") or 14)
        except (TypeError, ValueError):
            days = 14
        return storage_overview(db, days)
    if route == "/overview" and method == "GET":
        return overview(db)
    if route == "/accounts" and method == "GET":
        return list_accounts(db, query)
    if route == "/accounts" and method == "POST":
        return create_account(db, body, ip)
    if route == "/accounts/export" and method == "GET":
        return export_accounts(db, query)
    if route == "/settings" and method == "GET":
        return settings_payload(db)
    if route == "/settings/registration" and method == "POST":
        return set_registration(db, body, ip)
    if route == "/audit" and method == "GET":
        try:
            limit = int(query.get("limit") or 100)
        except (TypeError, ValueError):
            limit = 100
        return {"ok": True, "items": _audit_rows(db, limit)}

    matched = re.fullmatch(r"/accounts/(\d+)", route)
    if matched and method == "DELETE":
        return delete_account(db, int(matched.group(1)), ip)
    matched = re.fullmatch(r"/accounts/(\d+)/ban", route)
    if matched and method == "POST":
        return ban_account(db, int(matched.group(1)), body, ip)
    matched = re.fullmatch(r"/accounts/(\d+)/unban", route)
    if matched and method == "POST":
        return unban_account(db, int(matched.group(1)), ip)
    matched = re.fullmatch(r"/accounts/(\d+)/storage", route)
    if matched and method == "GET":
        return account_storage(db, int(matched.group(1)))
    matched = re.fullmatch(r"/accounts/(\d+)/clear-staging", route)
    if matched and method == "POST":
        return clear_account_staging(db, int(matched.group(1)), ip)
    matched = re.fullmatch(r"/accounts/(\d+)/clear-cloud", route)
    if matched and method == "POST":
        return clear_account_cloud(db, int(matched.group(1)), ip)
    matched = re.fullmatch(r"/pairs/([A-Za-z0-9_-]+)/limits", route)
    if matched and method == "GET":
        return {"ok": True, **_pair_storage_entry(db, _pair_row(db, matched.group(1)))}
    if matched and method in ("PATCH", "PUT"):
        return set_pair_limits(db, matched.group(1), body, ip)
    matched = re.fullmatch(r"/pairs/([A-Za-z0-9_-]+)/quota", route)
    if matched and method in ("PATCH", "PUT"):
        return set_pair_quota(db, matched.group(1), body, ip)
    matched = re.fullmatch(r"/pairs/([A-Za-z0-9_-]+)/cloud", route)
    if matched and method == "DELETE":
        return clear_pair_cloud(db, matched.group(1), ip)

    if route in {"/me", "/change-password", "/logout", "/overview", "/accounts",
                 "/accounts/export", "/settings", "/settings/registration", "/audit",
                 "/admins", "/theme", "/theme/background", "/broadcast", "/storage"}:
        raise ApiError(405, "method_not_allowed", "方法不允许")
    if re.fullmatch(r"/accounts/\d+", route) or re.fullmatch(
            r"/accounts/\d+/(ban|unban|storage|clear-staging|clear-cloud)", route):
        raise ApiError(405, "method_not_allowed", "方法不允许")
    if re.fullmatch(r"/pairs/[A-Za-z0-9_-]+/(quota|limits|cloud)", route):
        raise ApiError(405, "method_not_allowed", "方法不允许")

    raise ApiError(404, "admin_route_not_found", "接口不存在")
