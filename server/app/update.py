"""应用更新（App 内「检查更新」）的版本元数据。

发新版时只改这一个文件：``versionCode`` 加一、写 ``notes``、换 ``downloadUrl``。
``version`` 不在这里写，统一读 :mod:`app` 的 ``VERSION``，避免两处版本号打架。
"""

from __future__ import annotations

import os

from . import VERSION

# 升级包地址：网盘分享链接或仓库 Release 页都行，客户端只负责用系统浏览器打开。
# 两种换法：改这一行；或部署时设环境变量 INORINAL_APP_DOWNLOAD_URL（优先，免改码）。
DEFAULT_DOWNLOAD_URL = "https://github.com/Green233233/Inorinal/releases/latest"


def _download_url() -> str:
    """优先读 ``INORINAL_APP_DOWNLOAD_URL``；只接受 http(s)，否则退回默认地址。"""
    raw = (os.environ.get("INORINAL_APP_DOWNLOAD_URL") or "").strip()
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    return DEFAULT_DOWNLOAD_URL


DOWNLOAD_URL = _download_url()

# 本次可升级版本的描述。``force`` 为 True 时客户端不给「以后再说」。
APP_UPDATE = {
    "versionCode": 19,
    "downloadUrl": DOWNLOAD_URL,
    "force": False,
    "notes": "\n".join(
        [
            "### 本次更新",
            "",
            "- 状态信息改为「定时加密上传 → 服务器暂存 → 对方上线后拉取」，不再要求两边同时在线",
            "- 日记支持云同步：共享日记双方可见，私密日记只上传密文，每对绑定默认 1GB 云空间",
            "- 管理后台 v0.2.0：存储用量图表、账号暂存与云空间清理、公告与深浅色修复",
        ]
    ),
}


def payload() -> dict:
    """``GET /api/v1/app/update`` 的响应体。"""
    return {
        "ok": True,
        "version": VERSION,
        "versionCode": APP_UPDATE["versionCode"],
        "notes": APP_UPDATE["notes"],
        "downloadUrl": APP_UPDATE["downloadUrl"],
        "force": APP_UPDATE["force"],
    }
