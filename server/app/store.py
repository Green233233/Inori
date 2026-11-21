"""SQLite 持久层：连接管理、schema、序列号与审计。

每个线程一条连接（ThreadingHTTPServer 下必需）；WAL + busy_timeout 保证
长轮询与写入并发不互相阻塞。业务 SQL 留在各自模块里，方便就近阅读。
"""

from __future__ import annotations

import os
import sqlite3
import threading

from . import security

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  ban_until TEXT,
  ban_reason TEXT,
  ban_at TEXT,
  ban_by TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_sha256 TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS pairs (
  id TEXT PRIMARY KEY,
  master_device TEXT NOT NULL,
  puppy_device TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  puppy_name TEXT NOT NULL DEFAULT '',
  code_hash TEXT,
  code_expires_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  unpaired_at TEXT,
  cloud_quota_bytes INTEGER NOT NULL DEFAULT 1073741824,
  staging_ttl_hours INTEGER NOT NULL DEFAULT 72,
  staging_budget_bytes INTEGER NOT NULL DEFAULT 157286400,
  staging_time_gate INTEGER NOT NULL DEFAULT 1,
  staging_size_gate INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairs_master ON pairs(master_device) WHERE unpaired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairs_puppy ON pairs(puppy_device) WHERE unpaired_at IS NULL;

CREATE TABLE IF NOT EXISTS relay (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL,
  from_device TEXT NOT NULL,
  to_device TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  acked_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_relay_target ON relay(pair_id, to_device, seq);

CREATE TABLE IF NOT EXISTS sync_records (
  pair_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  author_device TEXT NOT NULL,
  seq INTEGER NOT NULL,
  audience TEXT NOT NULL DEFAULT 'pair',
  PRIMARY KEY (pair_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_seq ON sync_records(pair_id, seq);

CREATE TABLE IF NOT EXISTS media (
  pair_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (pair_id, media_id, idx)
);

-- v0.7.0 状态暂存箱。状态类数据不再请求/响应，而是发送端定时加密上传，
-- 接收端直接按游标拉取；服务端只看到 kind、大小与路由信息。
CREATE TABLE IF NOT EXISTS staged_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rev INTEGER NOT NULL,
  pair_id TEXT NOT NULL,
  from_device TEXT NOT NULL,
  to_device TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT,
  ciphertext TEXT NOT NULL,
  byte_len INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  delivered_at TEXT,
  acked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_staged_fetch ON staged_items(pair_id, to_device, rev);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_dedupe
  ON staged_items(pair_id, from_device, to_device, kind, dedupe_key)
  WHERE acked_at IS NULL AND dedupe_key IS NOT NULL;

-- 每小时按配对采样一次存储占用，后台用它画 14 天趋势。
CREATE TABLE IF NOT EXISTS storage_samples (
  pair_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  staged_bytes INTEGER NOT NULL DEFAULT 0,
  staged_items INTEGER NOT NULL DEFAULT 0,
  cloud_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pair_id, bucket)
);
CREATE INDEX IF NOT EXISTS idx_storage_bucket ON storage_samples(bucket);

CREATE TABLE IF NOT EXISTS presence (
  device_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  battery INTEGER,
  charging INTEGER,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL,
  code TEXT NOT NULL,
  normalized_code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  note_cipher TEXT,
  created_at TEXT NOT NULL,
  serial TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  used_at TEXT,
  used_by_device TEXT,
  used_note_cipher TEXT
);
CREATE INDEX IF NOT EXISTS idx_coupons_pair ON coupons(pair_id, status);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_device TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);

-- 账户管理后台（v0.1.0）。管理员与 App 账号完全分离，令牌只存 SHA-256。
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  password_changed_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_sha256 TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  username TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_attempts_ip ON admin_login_attempts(ip, at);

CREATE TABLE IF NOT EXISTS admin_ip_bans (
  ip TEXT PRIMARY KEY,
  blocked_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_stats (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 后台外观偏好按管理员保存；自定义背景文件落在数据目录，库里只记文件名。
CREATE TABLE IF NOT EXISTS admin_preferences (
  admin_id INTEGER PRIMARY KEY,
  theme_mode TEXT NOT NULL DEFAULT 'dark',
  background TEXT NOT NULL DEFAULT 'bing',
  solid_color TEXT NOT NULL DEFAULT '#121212',
  blur INTEGER NOT NULL DEFAULT 6,
  custom_file TEXT,
  updated_at TEXT
);
"""


class Database:
    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._local = threading.local()
        self._seq_lock = threading.Lock()
        self._init_schema()

    # -- connections ----------------------------------------------------
    @property
    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=10.0, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA busy_timeout=8000")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    def _init_schema(self) -> None:
        conn = self.conn
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        # 兼容 v0.6.0 早期构建：当时列名是 dog_device / dog_name。
        pairs_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pairs'"
        ).fetchone()
        if pairs_exists:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(pairs)")}
            if "dog_device" in cols:
                conn.execute("ALTER TABLE pairs RENAME COLUMN dog_device TO puppy_device")
            if "dog_name" in cols:
                conn.execute("ALTER TABLE pairs RENAME COLUMN dog_name TO puppy_name")
            conn.execute("DROP INDEX IF EXISTS idx_pairs_dog")
        conn.executescript(SCHEMA)
        # 老库升级：users 在 v0.6.6 之前没有封禁字段，CREATE TABLE IF NOT EXISTS
        # 不会补列，必须在启动时幂等 ALTER。
        user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        for column, decl in (
            ("ban_until", "TEXT"),
            ("ban_reason", "TEXT"),
            ("ban_at", "TEXT"),
            ("ban_by", "TEXT"),
        ):
            if column not in user_columns:
                conn.execute(f"ALTER TABLE users ADD COLUMN {column} {decl}")
        # v0.7.0：每对绑定的云空间配额与 sync_records 的可见范围。
        pair_columns = {row[1] for row in conn.execute("PRAGMA table_info(pairs)")}
        if "cloud_quota_bytes" not in pair_columns:
            conn.execute(
                "ALTER TABLE pairs ADD COLUMN cloud_quota_bytes"
                " INTEGER NOT NULL DEFAULT 1073741824"
            )
        for column, decl in (
            ("staging_ttl_hours", "INTEGER NOT NULL DEFAULT 72"),
            ("staging_budget_bytes", "INTEGER NOT NULL DEFAULT 157286400"),
            ("staging_time_gate", "INTEGER NOT NULL DEFAULT 1"),
            ("staging_size_gate", "INTEGER NOT NULL DEFAULT 1"),
        ):
            if column not in pair_columns:
                conn.execute(f"ALTER TABLE pairs ADD COLUMN {column} {decl}")
        sync_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(sync_records)")
        }
        if "audience" not in sync_columns:
            conn.execute(
                "ALTER TABLE sync_records ADD COLUMN audience"
                " TEXT NOT NULL DEFAULT 'pair'"
            )
        # Older databases created unconditional unique indexes on the pair
        # device columns, which blocked re-pairing after an unpair (the row is
        # kept for history). Recreate them as partial indexes.
        for index_name, column in (
            ("idx_pairs_master", "master_device"),
            ("idx_pairs_puppy", "puppy_device"),
        ):
            existing = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name=?",
                (index_name,),
            ).fetchone()
            if existing and existing[0] and "WHERE" not in existing[0].upper():
                conn.execute(f"DROP INDEX {index_name}")
            conn.execute(
                f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name}"
                f" ON pairs({column}) WHERE unpaired_at IS NULL"
            )
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES('seq', '0')"
        )

    # -- helpers --------------------------------------------------------
    def next_seq(self) -> int:
        with self._seq_lock:
            conn = self.conn
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute("SELECT value FROM meta WHERE key='seq'").fetchone()
                seq = int(row["value"]) + 1
                conn.execute("UPDATE meta SET value=? WHERE key='seq'", (str(seq),))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            return seq

    def audit(self, action: str, *, actor_device: str | None = None,
              detail: str | None = None, ip: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO audit(at, actor_device, action, detail, ip)"
            " VALUES(?,?,?,?,?)",
            (security.iso(), actor_device, action, detail, ip),
        )

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None
