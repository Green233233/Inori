"""密码哈希、会话令牌、时间与规范化 JSON 工具。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta, timezone

SCRYPT_N = 1 << 14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 64 * 1024 * 1024
CST = timezone(timedelta(hours=8))

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
SESSION_DAYS = 30
PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PAIR_CODE_TTL_MINUTES = 10


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=32,
        maxmem=SCRYPT_MAXMEM,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(digest)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_unb64(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=SCRYPT_MAXMEM,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def password_problem(password: str) -> str | None:
    if len(password) < 8:
        return "密码至少 8 位"
    if not any(ch.isalpha() for ch in password):
        return "密码需要包含字母"
    if not any(ch.isdigit() or not ch.isalnum() for ch in password):
        return "密码需要包含数字或符号"
    if any(ch.isspace() for ch in password):
        return "密码不能包含空格"
    return None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def random_id(prefix: str = "") -> str:
    return prefix + secrets.token_hex(16)


def random_pair_code() -> str:
    return "".join(secrets.choice(PAIR_CODE_ALPHABET) for _ in range(8))


def normalize_pair_code(raw: str) -> str:
    return "".join(ch for ch in str(raw or "").strip().upper() if ch.isalnum())[:8]


def hash_pair_code(code: str) -> str:
    return hashlib.sha256(f"qi/pair/{code}".encode("utf-8")).hexdigest()


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime | None = None) -> str:
    value = moment or now()
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_after(**delta) -> str:
    return iso(now() + timedelta(**delta))


def display(moment_iso: str | None) -> str | None:
    if not moment_iso:
        return None
    try:
        moment = datetime.strptime(moment_iso, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None
    return moment.astimezone(CST).strftime("%Y-%m-%d %H:%M")


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
