#!/usr/bin/env python3
"""签发邀请码（自建服务器的注册入口）。

    python3 tools/issue_invite.py --data-dir /var/lib/qi [--count 1]

邀请码一次性使用；注册后即失效。
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import security  # noqa: E402
from app.store import Database  # noqa: E402


def issue_invites(data_dir: str, count: int = 1) -> list[str]:
    db = Database(os.path.join(os.path.abspath(data_dir), "qi.sqlite3"))
    codes: list[str] = []
    try:
        for _ in range(max(1, count)):
            code = security.random_pair_code()
            db.conn.execute(
                "INSERT INTO invites(code, created_at) VALUES(?, ?)",
                (code, security.iso()),
            )
            codes.append(code)
    finally:
        db.close()
    return codes


def main() -> int:
    parser = argparse.ArgumentParser(description="签发祈邀请码")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--count", type=int, default=1)
    args = parser.parse_args()
    for code in issue_invites(args.data_dir, args.count):
        print(code)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
