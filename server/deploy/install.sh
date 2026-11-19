#!/usr/bin/env bash
# 祈（Inorinal）自建服务端一键部署。
#
#   sudo INORINAL_DOMAIN=124-221-102-236.sslip.io ./install.sh
#
# 幂等：重复执行只更新代码、unit 与反代配置，不会清空数据目录。
# 反代自动二选一：
#   * 80/443 空闲（或已是 nginx）→ nginx + certbot --nginx
#   * 80/443 已被 caddy 占用     → 在 /etc/caddy/Caddyfile 里维护一个受管块，
#                                 由 Caddy 自动申请 Let's Encrypt 证书
# 这样在已经跑着别的站点的机器上也能部署，且不碰别人的站点配置。
set -euo pipefail

APP_USER="${INORINAL_USER:-inorinal}"
APP_ROOT="${INORINAL_ROOT:-/opt/inorinal}"
APP_DIR="$APP_ROOT/app"
VENV="$APP_ROOT/venv"
DATA_DIR="${INORINAL_DATA_DIR:-/var/lib/inorinal}"
PORT="${INORINAL_PORT:-8095}"
DOMAIN="${INORINAL_DOMAIN:-124-221-102-236.sslip.io}"
EMAIL="${INORINAL_EMAIL:-qi@inorinal.local}"
# Caddy 模式的两个开关（nginx 模式忽略）：
#   INORINAL_CADDY_PORT  对外 HTTPS 端口，默认 443
#   INORINAL_CADDY_TLS   auto=让 Caddy 自动申请公共证书；internal=用 Caddy 内置 CA
# 绝大多数主机用默认值。只有 80/443 被云厂商按“未备案域名”拦截（HTTP 返回
# webblock、443 按 SNI 重置）时，才改用 8443 + internal，见 README。
CADDY_PORT="${INORINAL_CADDY_PORT:-443}"
CADDY_TLS="${INORINAL_CADDY_TLS:-auto}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERE="$SRC_DIR/deploy"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo $0"

# ---------- 基础依赖 ----------
apt_install() {
  local missing=() p
  for p in "$@"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    log "apt-get install ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  fi
}

# ---------- 用户与目录 ----------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "创建系统用户 $APP_USER"
  useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin --user-group "$APP_USER"
fi
install -d -o root -g root -m 0755 "$APP_ROOT" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"

# ---------- 代码 ----------
log "安装代码到 $APP_DIR"
rm -rf "$APP_DIR/app" "$APP_DIR/tools" "$APP_DIR/run.py"
cp -a "$SRC_DIR/app" "$APP_DIR/app"
cp -a "$SRC_DIR/tools" "$APP_DIR/tools"
cp -a "$SRC_DIR/run.py" "$APP_DIR/run.py"
# 代码归 root 所有、对服务用户只读；服务运行在 ProtectSystem=strict 下。
chown -R root:root "$APP_DIR"
chmod -R a+rX,go-w "$APP_DIR"

# ---------- venv ----------
apt_install python3-venv
if [ ! -x "$VENV/bin/python" ]; then
  log "创建 venv $VENV"
  python3 -m venv "$VENV"
fi
log "安装 Python 依赖（cryptography）"
"$VENV/bin/pip" install --disable-pip-version-check --no-input --quiet cryptography

# ---------- systemd ----------
log "安装 systemd unit"
install -m 0644 "$HERE/inorinal.service" /etc/systemd/system/inorinal.service
systemctl daemon-reload
systemctl enable inorinal >/dev/null
systemctl restart inorinal

# 等本地 health 起来（最多 30s）
local_ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then local_ok=1; break; fi
  sleep 1
done
if [ "$local_ok" -ne 1 ]; then
  journalctl -u inorinal -n 40 --no-pager >&2 || true
  die "服务未在 30s 内通过本地 /health"
fi
log "本地 health OK：$(curl -fsS "http://127.0.0.1:$PORT/health")"

# ---------- 反向代理 ----------
port_owner() { ss -H -ltnp "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
OWNER_80="$(port_owner 80 || true)"
OWNER_443="$(port_owner 443 || true)"
log "80/443 当前占用：${OWNER_80:-<空>} / ${OWNER_443:-<空>}"

caddy_mode() {
  local file=/etc/caddy/Caddyfile block addr tls_line
  [ -f "$file" ] || die "Caddy 在运行但 $file 不存在"
  addr="https://$DOMAIN"
  [ "$CADDY_PORT" = "443" ] || addr="https://$DOMAIN:$CADDY_PORT"
  tls_line=""
  if [ "$CADDY_TLS" = "internal" ]; then
    # 不走公共 CA（例如云厂商按备案拦截 80/443）。这里固定用一张 10 年自签证书：
    # Caddy 内置 CA 的 leaf 只有 12h，会自动轮换，导致 App 的 pin 每隔几小时失效。
    local certdir=/etc/caddy/certs
    install -d -o root -g caddy -m 0750 "$certdir"
    if [ ! -s "$certdir/inorinal-fullchain.pem" ] || [ ! -s "$certdir/inorinal-key.pem" ]; then
      command -v openssl >/dev/null || die "缺少 openssl，无法生成自签证书"
      log "生成 10 年自签证书（CN=$DOMAIN）"
      openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -keyout "$certdir/inorinal-key.pem" -out "$certdir/inorinal-fullchain.pem" \
        -days 3650 -nodes -subj "/CN=$DOMAIN" \
        -addext "subjectAltName=DNS:$DOMAIN" >/dev/null 2>&1 \
        || die "openssl 生成自签证书失败"
    else
      log "复用已有自签证书 $certdir"
    fi
    chown root:caddy "$certdir/inorinal-key.pem" "$certdir/inorinal-fullchain.pem" 2>/dev/null || true
    chmod 0640 "$certdir/inorinal-key.pem"
    chmod 0644 "$certdir/inorinal-fullchain.pem"
    tls_line=$'\ttls /etc/caddy/certs/inorinal-fullchain.pem /etc/caddy/certs/inorinal-key.pem\n'
    CURL_INSECURE="--insecure"
    log "警告：使用 10 年自签证书，客户端必须 pin 证书（sha256）"
  fi
  block="$(mktemp)"
  cat >"$block" <<EOF
# >>> inorinal (managed by server/deploy/install.sh) >>>
#
# 祈（Inorinal）服务端；证书策略：$CADDY_TLS（端口 $CADDY_PORT）。
# 本块由 install.sh 整块替换，不要手工改中间内容。
$addr {
${tls_line}	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT {
		# 长轮询最长 300s：关闭响应缓冲，等到响应就立刻下发。
		flush_interval -1
	}
}
# <<< inorinal (managed by server/deploy/install.sh) <<<
EOF

  cp -a "$file" "$file.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$file" "$block" <<'PY'
import sys, pathlib
conf = pathlib.Path(sys.argv[1])
block = pathlib.Path(sys.argv[2]).read_text().strip() + "\n"
start = "# >>> inorinal (managed by server/deploy/install.sh) >>>"
end = "# <<< inorinal (managed by server/deploy/install.sh) <<<"
text = conf.read_text() if conf.exists() else ""
if start in text and end in text:
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    text = head + block + tail.lstrip("\n")
else:
    text = text.rstrip() + "\n\n" + block
conf.write_text(text)
PY
  caddy validate --adapter caddyfile --config "$file"
  # 该机 Caddyfile 设置了 admin off，`caddy reload` 不可用，只能重启；
  # 同一 Caddy 上的其他站点会中断约 1s。
  systemctl restart caddy
  systemctl is-active --quiet caddy || die "caddy 重启失败"
  log "Caddy 已加载 $addr（TLS: $CADDY_TLS）"
}

nginx_mode() {
  apt_install nginx certbot python3-certbot-nginx
  install -m 0644 "$HERE/nginx-inorinal.conf" /etc/nginx/sites-available/inorinal
  ln -sfn /etc/nginx/sites-available/inorinal /etc/nginx/sites-enabled/inorinal
  nginx -t
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    log "certbot 申请证书 $DOMAIN"
    # 80/443 必须从公网可达；云安全组未放行时 HTTP-01 会失败。
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
      die "certbot 申请证书失败：请确认云安全组已放行 80/443，然后重跑本脚本"
    }
  else
    log "证书已存在，跳过申请"
  fi
  nginx -t && systemctl reload nginx
}

if [ "${OWNER_443:-}" = "caddy" ]; then
  [ "${OWNER_80:-}" = "caddy" ] || [ -z "${OWNER_80:-}" ] || die "80 被 ${OWNER_80} 占用而 443 是 caddy，拒绝改动"
  caddy_mode
elif [ -z "${OWNER_443:-}" ] || [ "${OWNER_443:-}" = "nginx" ]; then
  [ -z "${OWNER_80:-}" ] || [ "${OWNER_80:-}" = "nginx" ] || die "80 被 ${OWNER_80} 占用，拒绝改动"
  nginx_mode
else
  die "443 被未知进程占用（${OWNER_443}），拒绝改动；请先确认该进程归属"
fi

# ---------- 对外验收 ----------
CURL_INSECURE="${CURL_INSECURE:-}"
if [ "${CADDY_PORT:-443}" = "443" ]; then
  HEALTH_URL="https://$DOMAIN/health"
else
  HEALTH_URL="https://$DOMAIN:$CADDY_PORT/health"
fi
PORT_FOR_CURL="${CADDY_PORT:-443}"
log "等待 $HEALTH_URL（本机回环验收）"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS $CURL_INSECURE --resolve "$DOMAIN:$PORT_FOR_CURL:127.0.0.1" "$HEALTH_URL" >/tmp/inorinal-health.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" -eq 1 ]; then
  log "HTTPS health OK：$(cat /tmp/inorinal-health.json)"
else
  warn "HTTPS health 未通过（证书可能仍在申请）。查看：journalctl -u caddy -n 50 --no-pager"
fi

log "完成。常用命令："
cat <<EOF
  systemctl status inorinal --no-pager
  journalctl -u inorinal -f
  sudo -u $APP_USER $VENV/bin/python $APP_DIR/tools/issue_invite.py --data-dir $DATA_DIR
EOF
