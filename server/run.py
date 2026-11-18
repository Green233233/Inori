#!/usr/bin/env python3
"""祈（Qi）服务器入口。

    python3 run.py --host 127.0.0.1 --port 8095 --data-dir data/dev
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.server import serve  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="祈 self-hosted server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8095)
    parser.add_argument("--data-dir", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "data", "dev"))
    args = parser.parse_args()
    return serve(args.host, args.port, args.data_dir)


if __name__ == "__main__":
    raise SystemExit(main())
