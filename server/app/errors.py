"""统一错误类型与错误响应体。"""

from __future__ import annotations


class ApiError(Exception):
    """An error that maps to a JSON error response."""

    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def body(self) -> dict:
        payload = {"ok": False, "error": {"code": self.code, "message": self.message}}
        payload["error"].update(self.extra)
        return payload


def bad_request(code: str, message: str, **extra) -> ApiError:
    return ApiError(400, code, message, **extra)


def unauthorized(code: str = "unauthorized", message: str = "请先登录", **extra) -> ApiError:
    return ApiError(401, code, message, **extra)


def forbidden(code: str = "forbidden", message: str = "没有权限", **extra) -> ApiError:
    return ApiError(403, code, message, **extra)


def not_found(code: str = "not_found", message: str = "不存在", **extra) -> ApiError:
    return ApiError(404, code, message, **extra)


def conflict(code: str, message: str, **extra) -> ApiError:
    return ApiError(409, code, message, **extra)


def too_many(code: str = "rate_limited", message: str = "请求过于频繁", **extra) -> ApiError:
    return ApiError(429, code, message, **extra)
