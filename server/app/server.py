"""HTTP 路由与进程入口（标准库，无第三方 Web 框架）。"""

from __future__ import annotations

import json
import logging
import os
import re
import signal
import threading
import time
import traceback
import urllib.parse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import VERSION, admin, auth, coupons, pairing, presence, relay, security, sync
from .errors import ApiError, bad_request, too_many, unauthorized
from .store import Database

MAX_BODY_BYTES = 1024 * 1024
POLL_CONCURRENCY = 200
LOG = logging.getLogger("qi.server")


class Limiter:
    """简单的固定窗口限流（进程内，足够单人/双人自建场景）。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, limit: int, window: float) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 4096:
                self._hits = {
                    name: stamps
                    for name, stamps in self._hits.items()
                    if stamps and now - stamps[-1] < window
                }
            stamps = [stamp for stamp in self._hits.get(key, []) if now - stamp < window]
            if len(stamps) >= limit:
                self._hits[key] = stamps
                retry = max(1, int(window - (now - stamps[0])) + 1)
                return False, retry
            stamps.append(now)
            self._hits[key] = stamps
            return True, 0


@dataclass
class Request:
    db: Database
    method: str
    path: str
    query: dict
    body: dict
    ip: str
    token: str | None
    keyring: coupons.Keyring
    ctx: dict | None = None
    params: dict = field(default_factory=dict)

    @property
    def device(self) -> str:
        return (self.ctx or {}).get("deviceId", "")


@dataclass
class Route:
    method: str
    pattern: re.Pattern
    handler: object
    auth_required: bool = True


def _route(method: str, path: str, handler, auth_required: bool = True) -> Route:
    return Route(method, re.compile("^" + path + "$"), handler, auth_required)


def _me(req: Request) -> dict:
    pair_row = pairing.current(req.db, req.ctx or {}).get("pair")
    return auth.me(req.db, req.ctx or {}, pair_row)


def _register(req: Request) -> dict:
    return auth.register(req.db, req.body, req.ip)


def _login(req: Request) -> dict:
    return auth.login(req.db, req.body, req.ip)


def _logout(req: Request) -> dict:
    return auth.logout(req.db, req.token or "")


def _devices(req: Request) -> dict:
    return auth.list_devices(req.db, (req.ctx or {})["userId"])


def _revoke_device(req: Request) -> dict:
    return auth.revoke_device(req.db, (req.ctx or {})["userId"],
                              req.params["device_id"])


def _pair_current(req: Request) -> dict:
    return pairing.current(req.db, req.ctx or {})


def _pair_create(req: Request) -> dict:
    return pairing.create(req.db, req.ctx or {}, req.body)


def _pair_join(req: Request) -> dict:
    return pairing.join(req.db, req.ctx or {}, req.body)


def _pair_verify(req: Request) -> dict:
    return pairing.verify(req.db, req.ctx or {}, req.body)


def _pair_patch(req: Request) -> dict:
    return pairing.update(req.db, req.ctx or {}, req.body)


def _pair_delete(req: Request) -> dict:
    return pairing.unpair(req.db, req.ctx or {}, req.body)


def _relay_send(req: Request) -> dict:
    return relay.send(req.db, req.ctx or {}, req.body)


def _relay_poll(req: Request) -> dict:
    try:
        cursor = int(req.query.get("cursor") or 0)
        wait = int(req.query.get("wait") or relay.DEFAULT_WAIT_SECONDS)
    except (TypeError, ValueError):
        raise bad_request("invalid_cursor", "游标不合法")
    return relay.poll(req.db, req.ctx or {}, cursor, wait)


def _relay_ack(req: Request) -> dict:
    return relay.ack(req.db, req.ctx or {}, req.body)


def _sync_put(req: Request) -> dict:
    return sync.put_record(req.db, req.ctx or {}, req.params["record_id"], req.body)


def _sync_get(req: Request) -> dict:
    try:
        since_seq = int(req.query.get("sinceSeq") or 0)
        limit = int(req.query.get("limit") or 100)
    except (TypeError, ValueError):
        raise bad_request("invalid_cursor", "游标不合法")
    return sync.since(req.db, req.ctx or {}, since_seq, limit)


def _media_put(req: Request) -> dict:
    return sync.put_media_chunk(req.db, req.ctx or {}, req.params["media_id"],
                                int(req.params["index"]), req.body)


def _media_get(req: Request) -> dict:
    return sync.get_media_chunk(req.db, req.ctx or {}, req.params["media_id"],
                                int(req.params["index"]))


def _coupon_generate(req: Request) -> dict:
    return coupons.generate(req.db, req.ctx or {}, req.keyring, req.body)


def _coupon_list(req: Request) -> dict:
    return coupons.list_coupons(req.db, req.ctx or {}, req.query)


def _coupon_verify(req: Request) -> dict:
    return coupons.verify(req.db, req.ctx or {}, req.keyring, req.body)


def _coupon_redeem(req: Request) -> dict:
    return coupons.redeem(req.db, req.ctx or {}, req.keyring, req.body)


def _coupon_detail(req: Request) -> dict:
    return coupons.verify(req.db, req.ctx or {}, req.keyring,
                          {"code": req.params["code"]})


def _coupon_keyinfo(req: Request) -> dict:
    return coupons.keyinfo(req.db, req.ctx or {}, req.keyring)


def _coupon_audit(req: Request) -> dict:
    try:
        limit = int(req.query.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    return coupons.audit(req.db, req.ctx or {}, limit)


def _presence_put(req: Request) -> dict:
    return presence.put(req.db, req.ctx or {}, req.body)


def _presence_get(req: Request) -> dict:
    return presence.get(req.db, req.ctx or {}, req.params["device_id"])


ROUTES: list[Route] = [
    _route("POST", r"/api/v1/auth/register", _register, False),
    _route("POST", r"/api/v1/auth/login", _login, False),
    _route("POST", r"/api/v1/auth/logout", _logout),
    _route("GET", r"/api/v1/auth/me", _me),
    _route("GET", r"/api/v1/devices", _devices),
    _route("DELETE", r"/api/v1/devices/(?P<device_id>[A-Za-z0-9_-]+)", _revoke_device),
    _route("GET", r"/api/v1/pairs/current", _pair_current),
    _route("POST", r"/api/v1/pairs", _pair_create),
    _route("POST", r"/api/v1/pairs/join", _pair_join),
    _route("POST", r"/api/v1/pairs/verify", _pair_verify),
    _route("PATCH", r"/api/v1/pairs", _pair_patch),
    _route("DELETE", r"/api/v1/pairs", _pair_delete),
    _route("POST", r"/api/v1/relay/send", _relay_send),
    _route("GET", r"/api/v1/relay/poll", _relay_poll),
    _route("POST", r"/api/v1/relay/ack", _relay_ack),
    _route("PUT", r"/api/v1/sync/records/(?P<record_id>[A-Za-z0-9_-]+)", _sync_put),
    _route("GET", r"/api/v1/sync/records", _sync_get),
    _route("PUT", r"/api/v1/sync/media/(?P<media_id>[A-Za-z0-9_-]+)/(?P<index>\d+)",
           _media_put),
    _route("GET", r"/api/v1/sync/media/(?P<media_id>[A-Za-z0-9_-]+)/(?P<index>\d+)",
           _media_get),
    _route("POST", r"/api/v1/coupons", _coupon_generate),
    _route("GET", r"/api/v1/coupons", _coupon_list),
    _route("GET", r"/api/v1/coupons/keyinfo", _coupon_keyinfo),
    _route("GET", r"/api/v1/coupons/audit", _coupon_audit),
    _route("GET", r"/api/v1/coupons/(?P<code>[^/]+)", _coupon_detail),
    _route("POST", r"/api/v1/coupons/verify", _coupon_verify),
    _route("POST", r"/api/v1/coupons/redeem", _coupon_redeem),
    _route("POST", r"/api/v1/presence", _presence_put),
    _route("GET", r"/api/v1/presence/(?P<device_id>[A-Za-z0-9_-]+)", _presence_get),
]


class QiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "qi/" + VERSION
    timeout = 360
    limiter: Limiter = Limiter()
    poll_slots = threading.BoundedSemaphore(POLL_CONCURRENCY)
    db: Database
    keyring: coupons.Keyring

    # -- plumbing -------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        LOG.debug("%s - %s", self.address_string(), fmt % args)

    def _read_body(self) -> dict:
        # 服务端只接受定长 JSON；分块传输会让 BaseHTTPRequestHandler 的
        # Content-Length 解析产生请求走私歧义，直接拒绝。
        if self.headers.get("Transfer-Encoding"):
            raise bad_request("invalid_transfer_encoding", "不支持分块传输")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise bad_request("invalid_length", "Content-Length 不合法")
        if length > MAX_BODY_BYTES:
            raise ApiError(413, "payload_too_large", "请求体过大")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        admin.stats.add_bytes_in(len(raw))
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise bad_request("invalid_json", "请求体不是合法的 JSON")
        if not isinstance(parsed, dict):
            raise bad_request("invalid_json", "请求体必须是 JSON 对象")
        return parsed

    def _send_json(self, status: int, payload: dict,
                   headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        admin.stats.add_bytes_out(len(body))
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_bytes(self, status: int, body: bytes, content_type: str,
                    headers: dict | None = None) -> None:
        admin.stats.add_bytes_out(len(body))
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _client_ip(self) -> str:
        """Caddy 在前面时真实的访客 IP 在 X-Forwarded-For 里。

        服务只监听 127.0.0.1，能连进来的都是本机反代，所以只在 peer 是
        回环地址时才信任这个头；否则用 socket 对端地址，避免伪造。
        """
        peer = self.client_address[0]
        if peer in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            header = self.headers.get("X-Forwarded-For") or ""
            # 取最后一跳：即使客户端自己塞了 X-Forwarded-For，也只会
            # 落在前面；最后一跳才是 Caddy 写入的真实对端。
            last = header.split(",")[-1].strip()
            if last and re.fullmatch(r"[0-9A-Fa-f:.]+", last):
                return last
        return peer

    def _token(self) -> str | None:
        header = self.headers.get("Authorization") or ""
        if header.lower().startswith("bearer "):
            return header[7:].strip() or None
        return None

    def _query(self) -> dict:
        parsed = urllib.parse.urlsplit(self.path)
        raw = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        return {key: values[0] for key, values in raw.items()}

    def _limited(self, key: str, limit: int, window: float, code: str) -> None:
        if os.environ.get("QI_RATE_LIMIT_DISABLED") == "1":
            return
        allowed, retry = self.limiter.allow(key, limit, window)
        if not allowed:
            raise too_many(code, "操作太频繁，请稍后再试", retryAfter=retry)

    def _dispatch(self, method: str) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        raw_path = parsed.path
        path = raw_path.rstrip("/") or "/"
        admin.stats.record_request(method, path)
        try:
            if path == "/admin" or path.startswith("/admin/"):
                self._dispatch_admin(method, raw_path, path)
                return
            if method == "GET" and path == "/health":
                self._send_json(200, {"ok": True, "version": VERSION,
                                      "time": security.iso()})
                return
            body = self._read_body() if method in ("POST", "PUT", "PATCH", "DELETE") else {}
            token = self._token()
            for route in ROUTES:
                if route.method != method:
                    continue
                matched = route.pattern.match(path)
                if not matched:
                    continue
                request = Request(
                    db=self.db,
                    method=method,
                    path=path,
                    query=self._query(),
                    body=body,
                    ip=self._client_ip(),
                    token=token,
                    keyring=self.keyring,
                    params=matched.groupdict(),
                )
                if route.auth_required:
                    request.ctx = auth.authenticate(self.db, token)
                if path.endswith("/relay/poll"):
                    if not self.poll_slots.acquire(blocking=False):
                        raise too_many("too_many_polls", "长轮询连接过多")
                    try:
                        result = route.handler(request)
                    finally:
                        self.poll_slots.release()
                elif path.endswith("/auth/login"):
                    self._limited(f"login:{request.ip}", 8, 600, "rate_limited")
                    result = route.handler(request)
                elif path.endswith("/auth/register"):
                    self._limited(f"register:{request.ip}", 10, 3600, "rate_limited")
                    result = route.handler(request)
                else:
                    self._apply_limits(request, path)
                    result = route.handler(request)
                self._send_json(200, result)
                return
            self._send_json(404, {"ok": False, "error": {
                "code": "no_route", "message": "接口不存在"}})
        except ApiError as error:
            if error.status >= 500:
                admin.stats.record_error()
            headers = self._admin_headers() if self.path.startswith("/admin") else None
            self._send_json(error.status, error.body(), headers)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:  # pragma: no cover - defensive
            admin.stats.record_error()
            LOG.error("unhandled error on %s %s\n%s", method, self.path,
                      traceback.format_exc())
            headers = self._admin_headers() if self.path.startswith("/admin") else None
            self._send_json(500, {"ok": False, "error": {
                "code": "internal_error", "message": "服务器内部错误"}}, headers)

    # -- admin ----------------------------------------------------------
    _ADMIN_CSP = (
        "default-src 'self'; base-uri 'none'; form-action 'self';"
        " frame-ancestors 'none'; img-src 'self' data:;"
        " style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
    )

    def _admin_headers(self) -> dict:
        return {
            "Content-Security-Policy": self._ADMIN_CSP,
            "Strict-Transport-Security": "max-age=31536000",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Cross-Origin-Resource-Policy": "same-origin",
        }

    def _admin_static_headers(self) -> dict:
        headers = self._admin_headers()
        headers["Cache-Control"] = "no-cache"
        return headers

    def _dispatch_admin(self, method: str, raw_path: str, path: str) -> None:
        if method == "GET" and raw_path == "/admin":
            self.send_response(302)
            self.send_header("Location", "/admin/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if method == "GET" and raw_path == "/admin/":
            asset = admin.read_asset("index.html")
            if asset is None:
                raise ApiError(404, "admin_not_installed", "管理后台尚未安装")
            body, content_type = asset
            self._send_bytes(200, body, content_type, self._admin_static_headers())
            return
        asset_prefix = "/admin/assets/"
        if method == "GET" and path.startswith(asset_prefix):
            name = path[len(asset_prefix):]
            asset = admin.read_asset(name)
            if asset is None:
                raise ApiError(404, "admin_asset_not_found", "资源不存在")
            body, content_type = asset
            self._send_bytes(200, body, content_type, self._admin_static_headers())
            return
        if path.startswith(admin.API_PREFIX):
            body = (self._read_body()
                    if method in ("POST", "PUT", "PATCH", "DELETE") else {})
            result = admin.dispatch(
                self.db, method, path, self._query(), body,
                self._token(), self._client_ip(),
            )
            if isinstance(result, admin.FileResponse):
                headers = self._admin_headers()
                headers.update(result.headers)
                self._send_bytes(200, result.body, result.content_type, headers)
            else:
                self._send_json(200, result, self._admin_headers())
            return
        raise ApiError(404, "admin_not_found", "页面不存在")

    def _apply_limits(self, request: Request, path: str) -> None:
        device = request.device
        if not device:
            return
        if path.endswith("/relay/send"):
            self._limited(f"relay:{device}", 120, 60, "rate_limited")
        elif path.endswith("/sync/records") and request.method == "PUT":
            self._limited(f"sync:{device}", 240, 60, "rate_limited")
        elif path.endswith("/coupons") and request.method == "POST":
            self._limited(f"coupon-gen:{device}", 100, 86400, "rate_limited")
        elif path.endswith("/coupons/verify"):
            self._limited(f"coupon-verify:{device}", 30, 60, "rate_limited")
        elif path.endswith("/coupons/redeem"):
            self._limited(f"coupon-redeem:{device}", 20, 60, "rate_limited")
        elif path == "/api/v1/pairs" and request.method in ("POST", "DELETE"):
            self._limited(f"pair:{device}", 20, 3600, "rate_limited")

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch("PUT")

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")


class QiServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _cleanup_loop(db: Database, stop: threading.Event) -> None:
    while not stop.wait(600):
        try:
            removed = relay.cleanup(db)
            if removed:
                LOG.info("relay cleanup removed %s rows", removed)
        except Exception:  # pragma: no cover
            LOG.warning("relay cleanup failed\n%s", traceback.format_exc())


def serve(host: str, port: int, data_dir: str) -> int:
    logging.basicConfig(
        level=os.environ.get("QI_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    os.makedirs(data_dir, exist_ok=True)
    db = Database(os.path.join(data_dir, "qi.sqlite3"))
    keyring = coupons.Keyring(data_dir)
    keyring.public_pem()  # 启动即确保密钥存在（缺失时生成）

    QiHandler.db = db
    QiHandler.keyring = keyring

    admin.ensure_seed(db)
    stats_thread = admin.start_background(db)

    stop = threading.Event()
    cleaner = threading.Thread(target=_cleanup_loop, args=(db, stop), daemon=True)
    cleaner.start()

    httpd = QiServer((host, port), QiHandler)
    LOG.info("祈服务器已启动 http://%s:%s （数据目录 %s，版本 %s）",
             host, port, os.path.abspath(data_dir), VERSION)

    def _shutdown(signum, frame):
        LOG.info("收到信号 %s，正在关闭", signum)
        stop.set()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _shutdown)
        except ValueError:
            pass

    try:
        httpd.serve_forever(poll_interval=0.4)
    finally:
        stop.set()
        admin.stop_background(stats_thread)
        admin.stats.flush(db)
        httpd.server_close()
        db.close()
        LOG.info("祈服务器已停止")
    return 0
