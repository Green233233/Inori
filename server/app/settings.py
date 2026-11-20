"""运行期可修改的服务器设置。

设置优先从数据库读取，读不到时回退到环境变量。这样管理员可以在后台
直接切换（例如开放注册），而老部署里只写了 environment 的机器行为不变。
"""

from __future__ import annotations

import os

from .store import Database

OPEN_REGISTRATION = "open_registration"
ENV_OPEN_REGISTRATION = "INORINAL_OPEN_REGISTRATION"


def get(db: Database, key: str, default: str | None = None) -> str | None:
    row = db.conn.execute(
        "SELECT value FROM admin_settings WHERE key=?", (key,)
    ).fetchone()
    return row["value"] if row is not None else default


def put(db: Database, key: str, value: str) -> None:
    db.conn.execute(
        "INSERT INTO admin_settings(key, value) VALUES(?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )


def open_registration(db: Database) -> bool:
    """是否允许陌生人自助注册。

    数据库里有明确取值就以数据库为准；否则沿用环境变量，保证用
    systemd drop-in 配置开放注册的既有部署升级后行为一致。
    """
    raw = get(db, OPEN_REGISTRATION)
    if raw is not None:
        return raw == "1"
    return os.environ.get(ENV_OPEN_REGISTRATION, "").strip() == "1"


def seed_from_env(db: Database) -> None:
    """首次启动时把环境变量落成显式设置，后台界面才能显示真实状态。"""
    if get(db, OPEN_REGISTRATION) is None:
        enabled = os.environ.get(ENV_OPEN_REGISTRATION, "").strip() == "1"
        put(db, OPEN_REGISTRATION, "1" if enabled else "0")
