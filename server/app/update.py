"""应用更新（App 内「检查更新」）的版本元数据。

发新版时只改这一个文件：``versionCode`` 加一、写 ``notes``、换 ``downloadUrl``。
``version`` 不在这里写，统一读 :mod:`app` 的 ``VERSION``，避免两处版本号打架。
"""

from __future__ import annotations

from . import VERSION

# 升级包地址：网盘分享链接或仓库 Release 页都行，客户端只负责用系统浏览器打开。
# 换成新的网盘链接时只改这一行。
DOWNLOAD_URL = "https://github.com/Green233233/Inorinal/releases/latest"

# 本次可升级版本的描述。``force`` 为 True 时客户端不给「以后再说」。
APP_UPDATE = {
    "versionCode": 17,
    "downloadUrl": DOWNLOAD_URL,
    "force": False,
    "notes": "\n".join(
        [
            "### 本次更新",
            "",
            "- 新增「检查更新」：每次启动自动查一次新版本，有更新会弹窗告诉你",
            "- 关于页的「检查更新」按钮现在真的会查了，没有新版本会提示已是最新",
            "- 升级日志与下载地址由服务端下发，复制链接去网盘下载安装包就行",
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
