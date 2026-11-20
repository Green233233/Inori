"""祈 · 账户管理后台（v0.1.1）。

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

from . import VERSION, security, settings
from .errors import ApiError, bad_request, conflict, forbidden, not_found, too_many, unauthorized
from .store import Database

ADMIN_VERSION = "0.1.1"
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
        headers={"User-Agent": "InoriAdmin/0.1.1 (+https://124.221.102.236)"},
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
        headers={"User-Agent": "InoriAdmin/0.1.1 (+https://124.221.102.236)"},
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
        "username": row["username"],
        "mustChangePassword": bool(row["must_change_password"]),
        "expiresAt": expires,
        "adminVersion": ADMIN_VERSION,
    }


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
        "username": session["username"],
        "mustChangePassword": bool(session["must_change_password"]),
        "adminVersion": ADMIN_VERSION,
        "serverVersion": VERSION,
        "loginProtection": {
            "maxFails": MAX_FAILS,
            "windowMinutes": FAIL_WINDOW_SECONDS // 60,
            "lockMinutes": LOCK_SECONDS // 60,
        },
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
    now = security.iso()
    with db.conn:
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
        # 日记/券是端到端密文，属于配对双方；删除单边账号时保留，
        # 避免把共同记忆从另一方那里一并抹掉。设备与会话已全部清除。
        db.audit("admin_delete_account", detail=row["username"], ip=ip)
    return {"ok": True, "id": user_id, "username": row["username"]}


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

    if route in {"/me", "/change-password", "/logout", "/overview", "/accounts",
                 "/accounts/export", "/settings", "/settings/registration", "/audit"}:
        raise ApiError(405, "method_not_allowed", "方法不允许")
    if re.fullmatch(r"/accounts/\d+", route) or re.fullmatch(
            r"/accounts/\d+/(ban|unban)", route):
        raise ApiError(405, "method_not_allowed", "方法不允许")

    raise ApiError(404, "admin_route_not_found", "接口不存在")
