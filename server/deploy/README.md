# 祈（Inorinal）服务端部署

自建 Python 服务端（标准库 + `cryptography`）的一键部署资产。后端只监听
`127.0.0.1:8095`，公网入口由反向代理 + TLS 承担。

## 拓扑

```
App (HTTPS + leaf 证书 SHA-256 pin)
        │  443（或 8443，见下）
        ▼
反向代理（Caddy 或 nginx）
        │  127.0.0.1:8095
        ▼
inorinal.service ──► /opt/inorinal/venv/bin/python run.py
        │
        ├── /var/lib/inorinal/qi.sqlite3      SQLite（WAL）
        ├── /var/lib/inorinal/keys/           服务端 Ed25519 私钥（0600）
        └── /var/lib/inorinal/media/          媒体分块
```

| 项 | 值 |
| --- | --- |
| 公网域名 | `124-221-102-236.sslip.io`（sslip.io 解析回 `124.221.102.236`） |
| 公网端口 | 本机：**8443**（原因见「备案拦截」）；干净主机：80 / 443 |
| 后端监听 | `127.0.0.1:8095`（不对外） |
| 代码 | `/opt/inorinal/app`（root 所有，服务用户只读） |
| venv | `/opt/inorinal/venv` |
| 数据 | `/var/lib/inorinal`（`inorinal:inorinal`，0750） |
| 日志 | journald：`journalctl -u inorinal` |
| unit | `/etc/systemd/system/inorinal.service` |
| 反代 | Caddy：`/etc/caddy/Caddyfile` 内的受管块；nginx：`/etc/nginx/sites-available/inorinal` |
| 证书（本机） | `/etc/caddy/certs/inorinal-fullchain.pem` / `inorinal-key.pem`（10 年自签） |

## 首次部署

把整个 `server/` 目录同步到服务器（例如 `/opt/inorinal/src`），然后：

```bash
# 干净主机（80/443 空闲）：nginx + certbot，自动申请 Let's Encrypt
sudo INORINAL_DOMAIN=124-221-102-236.sslip.io /opt/inorinal/src/deploy/install.sh

# 本机现状（80/443 被 Caddy 上的既有站点占用，且域名被备案拦截）：
# 在 Caddy 上新增 8443 站点，使用固定的 10 年自签证书 + App pin。
sudo INORINAL_CADDY_PORT=8443 INORINAL_CADDY_TLS=internal \
     INORINAL_DOMAIN=124-221-102-236.sslip.io /opt/inorinal/src/deploy/install.sh
```

脚本幂等：重复执行只覆盖代码与配置，保留 `/var/lib/inorinal` 里的数据。

### 反代为什么有两种模式

`install.sh` 会检测 80/443 的占用者：

* **空闲 / 已是 nginx** → 安装 `nginx certbot python3-certbot-nginx`，写站点配置，
  再用 `certbot --nginx` 申请 Let's Encrypt 证书。
* **已被 caddy 占用** → 不改动 Caddy 已有的任何站点，只在 `/etc/caddy/Caddyfile`
  里维护一个带标记的受管块（`# >>> inorinal (managed by ...) >>>`）。
  Caddy 全局配置是 `admin off`，所以用 `systemctl restart caddy` 生效
  （同机其他站点会中断约 1 秒）。

> 本机 124.221.102.236 的 80/443 已由 Caddy 承载 DSH Remote 与 hexie-coupon
> 两个既有站点，因此实际走 Caddy 模式；`nginx-inorinal.conf` 保留给干净主机。

### 本机为什么用 8443 + 自签证书

这台腾讯云主机上，未备案域名在 80/443 被上游拦截，实测证据：

* HTTP-01：腾讯云返回备案拦截页 —
  `Invalid response from https://dnspod.qcloud.com/static/webblock.html?d=124-221-102-236.sslip.io: 566`
* TLS-ALPN-01：Le 视角的 443 连接被重置 —
  `124.221.102.236: Connection reset by peer`
* 从公网探测：TCP 80/443/8443 都能建连，但 443 带该域名的 SNI 会
  `ConnectionResetError`；换成裸 IP 的 SNI 则握手正常（证书是 Caddy 内网 CA）。
  即：**不是安全组封端口，也不是本机防火墙，而是未备案域名的 SNI 过滤 / WebBlock**。

所以公共 CA 无法给这个域名签发。绕开方式：Caddy 在 `:8443` 上服务该域名
（8443 不经过备案拦截），用一张 **10 年自签证书**（`tls <cert> <key>`），
App 侧用 pin 固定该证书。不要用 `tls internal`：Caddy 内置 CA 的 leaf 只有 12h，
会自动轮换，pin 会每隔几小时失效。

## 升级

```bash
# 在仓库里
git pull
# 重新同步 server/ 到 /opt/inorinal/src 后（参数与本机部署时保持一致）
sudo INORINAL_CADDY_PORT=8443 INORINAL_CADDY_TLS=internal \
     /opt/inorinal/src/deploy/install.sh
```

升级只替换代码并 `systemctl restart inorinal`，数据目录与证书不动。

## 回滚

```bash
# 代码：把上一版 server/ 重新同步到 /opt/inorinal/src，再跑 install.sh
# 反代（Caddy）：install.sh 每次都会先备份，恢复后重启
sudo cp /etc/caddy/Caddyfile.bak.<时间戳> /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

数据备份：停服务后整体拷走 `/var/lib/inorinal`（SQLite 是 WAL 模式，热备请用
`sqlite3 qi.sqlite3 ".backup"`）。

## 看日志

```bash
systemctl status inorinal --no-pager
journalctl -u inorinal -n 100 --no-pager
journalctl -u inorinal -f
journalctl -u caddy -n 50 --no-pager   # 反代 / 证书问题
```

## 发邀请码

注册必须用一次性邀请码（8 位，`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`）：

```bash
sudo -u inorinal /opt/inorinal/venv/bin/python \
  /opt/inorinal/app/tools/issue_invite.py --data-dir /var/lib/inorinal
# 一次发 3 个：加 --count 3
```

## HTTPS / 证书

* 健康检查：`https://124-221-102-236.sslip.io:8443/health` →
  `{"ok": true, "version": "0.6.0", ...}`（本机自签，`curl` 需 `-k`）。
* 证书：`CN=124-221-102-236.sslip.io`，`SAN=DNS:124-221-102-236.sslip.io`，
  有效期 10 年。
* App pin 值 = **leaf 证书 DER 的 SHA-256，十六进制小写**：

```bash
openssl s_client -connect 124.221.102.236:8443 \
  -servername 124-221-102-236.sslip.io </dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
# 当前：DD:59:1F:20:...:45:F5（去掉冒号、转小写即为 App 的 pin）
```

* **换证会换 pin**。重新生成自签证书（10 年）并让 Caddy 重载：

```bash
sudo rm -f /etc/caddy/certs/inorinal-{fullchain,key}.pem
sudo INORINAL_CADDY_PORT=8443 INORINAL_CADDY_TLS=internal \
     /opt/inorinal/src/deploy/install.sh
# 然后按上面的命令取新指纹，更新 App 配置
```

* 若将来域名完成备案或换成已备案域名：不带 `INORINAL_CADDY_PORT/TLS` 重跑
  `install.sh` 即可回到 443 + 公共证书（此时应同时在 App 侧更新或移除 pin）。

## 冒烟验证

```bash
curl -sS -k https://124-221-102-236.sslip.io:8443/health
curl -sS -k -X POST https://124-221-102-236.sslip.io:8443/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"smoke_1","password":"smoke-pass1","invite":"<邀请码>",
       "deviceId":"smoke-device-1","deviceName":"smoke","platform":"test",
       "pubkey":"0123456789abcdef0123456789abcdef"}'
```

## App 侧接入值

| 项 | 值 |
| --- | --- |
| `DEFAULT_SERVER_URL` | `https://124-221-102-236.sslip.io:8443` |
| 证书 pin（sha256 hex） | `dd591f20bc8539f6d00c87f5484a86805cd610b0a8e096865ecd82546b6945f5` |
| `network_security_config` | 无需额外改动；pin 由 App 的 TrustManager 校验，pin 非空时跳过主机名校验 |
