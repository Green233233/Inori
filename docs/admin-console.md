# 祈 · 账户管理后台（admin v0.1.0）

面向服务器主人的网页管理台，直接读写 `inorinal` 服务端同一份 SQLite（`/var/lib/inorinal/qi.sqlite3`），
不另跑进程、不占额外端口：所有页面与接口都挂在现有服务的 `/admin` 下。

## 打开方式

- 生产（IP 直达，推荐）：<http://124.221.102.236/admin/>
  （Caddy 把该 IP 的 `/admin*` 原样反代到 `127.0.0.1:8095`，根路径仍属于既有站点）
- 备用（HTTPS，自签证书）：<https://124.221.102.236/admin/> 或 <https://124-221-102-236.sslip.io:8443/admin/>
  （浏览器首次会提示「不安全」，选择继续访问即可）
- 本机调试：<http://127.0.0.1:8095/admin/>

## 登录与密码

| 项目 | 说明 |
| --- | --- |
| 默认管理员 | `admin` / `12345678` |
| 首次登录 | 必须修改密码，改密前除「当前账号 / 改密 / 退出」外的接口一律 403 |
| 密码规则 | ≥8 位，含字母，且含数字或符号，无空格；不能与旧密码或默认密码相同 |
| 登录保护 | 同一 IP 1 小时内输错 10 次 → 该 IP 锁定 1 小时，锁定期间即使密码正确也拒绝 |
| 会话 | Bearer token，12 小时；存在 `sessionStorage`，关闭标签页即失效 |

管理员表与会话表：`admins`、`admin_sessions`；失败记录与封禁：`admin_login_attempts`、`admin_ip_bans`。

### 忘记密码 / 重置为出厂状态

在服务器上执行（会清空管理员会话，并把密码恢复为 `12345678`、重新要求改密）：

```bash
sudo -n -u inorinal /opt/inorinal/venv/bin/python - <<'PY'
import sqlite3, sys
sys.path.insert(0, "/opt/inorinal/app")
from app import security
db = sqlite3.connect("/var/lib/inorinal/qi.sqlite3")
db.execute(
    "UPDATE admins SET password_hash=?, must_change_password=1, password_changed_at=NULL "
    "WHERE username='admin'",
    (security.hash_password("12345678"),),
)
db.execute("DELETE FROM admin_sessions")
db.commit()
print("admin password reset")
PY
```

## 功能

- **概览**：账户 / 封禁 / 在线设备 / 今日请求数 / 入站与出站字节 / 运行时长 / 数据库大小；
  14 天请求量柱状图（北京时间切日）；热门接口 Top；最近审计。
- **账户**：分页、搜索（用户名或 ID）、按状态筛选；展示创建时间、设备、平台、
  绑定状态（已绑定 / 待确认 / 未绑定）、绑定对象、角色、在线状态与最近在线。
- **创建账户**：用户名 `^[a-z0-9_]{3,32}$`，密码规则同上；新账户不占设备，首次登录时再绑设备。
- **封禁 / 解封**：`10 分钟`、`1 小时`、`24 小时`、`一周`、`永久`。
  定时封禁写 `users.ban_until`；永久封禁写 `users.disabled=1`。两者都会立即删除该用户全部会话，
  并在 app 登录 / 已登录请求上返回 403 `account_banned`（带截止时间）或 `account_disabled`。
- **删除账户**：先解除该账户的活跃配对（保留 `pairs` 历史），再删除 `presence / sessions / devices / users`；
  端到端加密的日记与券数据保留，避免误删对方数据。
- **注册开关**：写入 `admin_settings.open_registration`（DB 优先于环境变量 `INORINAL_OPEN_REGISTRATION`），
  关闭后新账户只能由后台创建或使用邀请码。
- **导出 Excel**：真正的 `.xlsx`（标准库 `zipfile` 生成），13 列，含冻结首行与筛选；文件名
  `qi-accounts-YYYYMMDD-HHMM.xlsx`。
- **审计**：所有管理动作写 `audit`：`admin_login`、`admin_locked`、`admin_password_changed`、
  `admin_create_account`、`admin_ban_account`、`admin_unban_account`、`admin_delete_account`、
  `admin_registration`。

## 统计口径

- `server_stats(day, requests, bytes_in, bytes_out, errors)` 按**北京时间**切日，进程内累加，
  每 5 秒 UPSERT 一次；保留 14 天。
- 请求数包含 `/admin` 自身；字节数是 HTTP body 字节，不含 TCP/TLS 头。
- 带宽卡片另外读取 `/proc/net/dev`，汇总非 `lo` 网卡的累计收/发与瞬时速率。
- 在线设备 = `presence` 在 300 秒内的心跳；数据库大小 = 主库 + `-wal` + `-shm`。

## 安全边界

- 管理接口全部要求 `Authorization: Bearer <token>`，不使用 Cookie，因此不存在 CSRF。
- 页面响应带 CSP（`script-src 'self'`）、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。
- 静态资源白名单仅 `index.html / style.css / app.js / favicon.svg`，拒绝路径穿越。
- 反代只信任来自 `127.0.0.1` 的 `X-Forwarded-For`，并校验其为 IP 字面量。
- 管理台与 app 共用服务进程；`/admin` 无独立监听端口，不额外暴露攻击面。
- IP 直达入口是 **HTTP**，登录密码与令牌在传输中不加密；在不可信网络下请改用
  `https://124.221.102.236/admin/`（自签证书）或 `https://124-221-102-236.sslip.io:8443/admin/`。

## 文件

```
server/app/admin.py          管理接口、统计、xlsx 导出
server/app/settings.py       DB 设置读写（open_registration）
server/app/admin_web/        前端静态文件（白名单）
server/app/store.py          admins / admin_sessions / admin_login_attempts /
                             admin_ip_bans / server_stats / admin_settings + users.ban_*
server/app/auth.py           account_problem()：封禁 / 停用拦截
server/app/server.py         /admin、/admin/assets/*、/admin/api/* 与字节统计埋点
```

## 部署 / 更新

沿用 `server/deploy/install.sh` 或仓库内 `.tmp-dev/deploy-server.py`（paramiko + tar 同步到
`/opt/inorinal/app`，然后 `systemctl restart inorinal`）。服务启动时自动建表、补列并种下默认管理员，
不需要手工迁移。

IP 直达依赖 Caddy 的两个 IP 站点块（`/etc/caddy/Caddyfile`）内的路径路由：

```caddyfile
handle /admin* {
    reverse_proxy 127.0.0.1:8095
}
handle {
    reverse_proxy 127.0.0.1:8090
}
```

`handle` 不能改成 `handle_path`，否则 `/admin` 前缀会被剥掉。改完 Caddyfile 后先
`caddy validate`，再 `systemctl restart caddy`（该机 `admin off`，`caddy reload` 走不通）。

本地验证：

```bash
python -m py_compile server/app/admin.py server/app/server.py server/app/auth.py \
  server/app/store.py server/app/settings.py
python server/tests/test_api.py
python .tmp-dev/admin_e2e.py   # 53 项管理后台端到端断言
```
