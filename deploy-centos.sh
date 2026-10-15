#!/bin/bash
# ============================================================
# 六弦工坊 · CentOS 7 / Stream 8 / 9 一键部署（Nginx + Node + IPv6 DDNS）
# 用法：
#   sudo bash deploy-centos.sh [对外端口] [Node内部端口]
# 示例：
#   sudo bash deploy-centos.sh            # 默认对外 8080，内部 3000
#   sudo bash deploy-centos.sh 9000 3000  # 对外 9000
# 说明：
#   - 自动安装/检测 Node.js(18+) 与 nginx
#   - 静态网页由 nginx 托管（IPv4+IPv6），/api 反代本机 Node
#   - 自动注册 systemd 开机自启、放行防火墙、处理 SELinux
# ============================================================
set -e

PORT="${1:-8080}"
APIPORT="${2:-3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="guitar-studio"
NGINX_CONF="/etc/nginx/conf.d/guitar-studio.conf"
UNIT_FILE="/etc/systemd/system/${SERVICE}.service"

c_g(){ echo -e "\033[32m$*\033[0m"; }
c_y(){ echo -e "\033[33m$*\033[0m"; }
c_r(){ echo -e "\033[31m$*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then
  c_r "请用 root 运行：sudo bash deploy-centos.sh $PORT $APIPORT"
  exit 1
fi

# 选择包管理器
if command -v dnf >/dev/null 2>&1; then PM="dnf"; else PM="yum"; fi
c_g ">> 系统包管理器：$PM，项目目录：$ROOT"

# ---------- 1. 安装 Node.js（需要 18+，脚本仅用内置模块，无需 npm 依赖）----------
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$MAJOR" -ge 18 ]; then
    NODE_BIN="$(command -v node)"; c_g ">> 已安装 Node $(node -v)：$NODE_BIN"
  fi
fi
if [ -z "$NODE_BIN" ]; then
  c_y ">> 未检测到 Node.js 18+，开始通过 NodeSource 安装 ..."
  $PM install -y curl ca-certificates >/dev/null 2>&1 || true
  curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
  $PM install -y nodejs
  NODE_BIN="$(command -v node)"
  c_g ">> Node 安装完成：$($NODE_BIN -v)"
fi

# ---------- 2. 安装 nginx ----------
if ! command -v nginx >/dev/null 2>&1; then
  c_y ">> 未检测到 nginx，开始安装（含 EPEL）..."
  $PM install -y epel-release >/dev/null 2>&1 || true
  $PM install -y nginx
fi
c_g ">> nginx：$(nginx -v 2>&1)"

# ---------- 3. 写 config.json（Node 仅本机回环监听，端口交由 nginx 对外）----------
"$NODE_BIN" - "$ROOT" "$APIPORT" <<'NODE'
const fs=require('fs'), path=require('path');
const root=process.argv[2], apiPort=Number(process.argv[3]);
const p=path.join(root,'config.json');
let c;
if(fs.existsSync(p)){ c=JSON.parse(fs.readFileSync(p,'utf8')); }
else { c=JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8')); }
c.webPort=apiPort; c.bindHost='127.0.0.1';
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log('>> config.json 已就绪：Node 监听 127.0.0.1:'+apiPort);
NODE

# ---------- 4. 生成 systemd 单元 ----------
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Guitar Studio - static site + IPv6 DDNS backend
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=$NODE_BIN $ROOT/server.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
c_g ">> systemd 单元已写入：$UNIT_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# ---------- 5. 生成 nginx 配置 ----------
sed -e "s|__WEBROOT__|$ROOT|g" \
    -e "s|__PORT__|$PORT|g" \
    -e "s|__APIPORT__|$APIPORT|g" \
    "$ROOT/nginx/guitar-studio.conf.template" > "$NGINX_CONF"
c_g ">> nginx 站点配置已写入：$NGINX_CONF"

# 处理 SELinux（允许 nginx 反代、读取站点目录）
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  c_y ">> 检测到 SELinux 开启，放行相关权限 ..."
  setsebool -P httpd_can_network_connect 1 || true
  chcon -Rt httpd_sys_content_t "$ROOT" || true
fi

nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx

# ---------- 6. 防火墙放行 ----------
if systemctl is-active --quiet firewalld; then
  c_y ">> firewalld 放行端口 $PORT/tcp（IPv4+IPv6）..."
  firewall-cmd --add-port=${PORT}/tcp --permanent >/dev/null
  firewall-cmd --reload >/dev/null
fi

# ---------- 7. 结果输出 ----------
V6=$(ip -6 addr show scope global 2>/dev/null | grep -oP '(?<=inet6\s)[0-9a-f:]+' | grep -v '^fe80' | head -n1 || true)
V4=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
c_g "================ 部署完成 ================"
echo "  吉他网页（本机）： http://localhost:${PORT}/guitar-studio.html"
[ -n "$V4" ] && echo "  局域网 IPv4：     http://${V4}:${PORT}/guitar-studio.html"
[ -n "$V6" ] && echo "  外网 IPv6：       http://[${V6}]:${PORT}/guitar-studio.html"
echo "  后台控制面板：     /admin    （默认密码 admin123，请尽快修改）"
echo
c_y "  还需在路由器/光猫放行 IPv6 入站端口 ${PORT}（TCP）。"
c_y "  外网手机使用麦克风需要 HTTPS：把域名接入 Cloudflare 橙云，或用 certbot 申请证书。"
echo "  常用命令："
echo "    systemctl status ${SERVICE}      # 查看 Node 后端"
echo "    systemctl restart ${SERVICE}     # 重启后端"
echo "    systemctl restart nginx          # 重启 nginx"
echo "    journalctl -u ${SERVICE} -f      # 查看实时日志"
c_g "=========================================="
