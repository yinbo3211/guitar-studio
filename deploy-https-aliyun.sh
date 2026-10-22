#!/usr/bin/env bash
# ============================================================
# 六弦工坊 · CentOS 阿里云域名 HTTPS 一键部署
# 前置条件：
#   1) 已按 deploy-centos.sh 完成基础部署（nginx + node 已就绪）
#   2) 已有阿里云域名，且该域名的 DNS 托管在阿里云云解析
#   3) 已创建阿里云 RAM 子账号 AccessKey（仅需 AliyunDNSFullOnly 权限）
# 用法（root）：
#   chmod +x deploy-https-aliyun.sh
#   ./deploy-https-aliyun.sh -d guitar.example.com -k <AccessKeyId> -s <AccessKeySecret>
#   可选参数：-p 443（HTTPS 端口） -a 3000（本机 Node API 端口）
# 效果：
#   · acme.sh 通过阿里云 DNS API 验证签发 Let's Encrypt 证书（无需 80 端口可达）
#   · nginx 启用 443 SSL，80 端口自动 301 跳转
#   · 证书自动续期（acme.sh cron，续期后自动 reload nginx）
# ============================================================
set -euo pipefail

DOMAIN=""; ALI_KEY=""; ALI_SECRET=""
HTTP_PORT=80; APIPORT=3000; ACME_HOME="$HOME/.acme.sh"

c_g(){ echo -e "\033[32m$*\033[0m"; }
c_y(){ echo -e "\033[33m$*\033[0m"; }
c_r(){ echo -e "\033[31m$*\033[0m"; }

while getopts "d:k:s:p:a:" opt; do
  case "$opt" in
    d) DOMAIN="$OPTARG" ;;
    k) ALI_KEY="$OPTARG" ;;
    s) ALI_SECRET="$OPTARG" ;;
    p) HTTP_PORT="$OPTARG" ;;
    a) APIPORT="$OPTARG" ;;
    *) c_r "用法: $0 -d 域名 -k AccessKeyId -s AccessKeySecret [-p HTTP端口] [-a API端口]"; exit 1 ;;
  esac
done
[ -z "$DOMAIN" ] || [ -z "$ALI_KEY" ] || [ -z "$ALI_SECRET" ] && { c_r "缺少参数：-d / -k / -s 必填"; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
SSL_DIR="/etc/nginx/ssl/$DOMAIN"
CONF="/etc/nginx/conf.d/guitar-studio.conf"
[ -f "$CONF" ] || CONF="/etc/nginx/conf.d/guitar-studio-https.conf"

c_g "================ 阿里云 HTTPS 部署开始 ================"
c_g ">> 域名：$DOMAIN（HTTP $HTTP_PORT → HTTPS 443）"

# ---------- 1. 安装 acme.sh ----------
if [ ! -f "$ACME_HOME/acme.sh" ]; then
  c_y ">> 安装 acme.sh ..."
  curl -s https://get.acme.sh | sh -s email=admin@$DOMAIN
fi
ACME="$ACME_HOME/acme.sh"

# ---------- 2. DNS 验证签发证书（阿里云 API，支持泛域名/无公网v4） ----------
export Ali_Key="$ALI_KEY"
export Ali_Secret="$ALI_SECRET"
c_y ">> 通过阿里云 DNS 验证并签发证书（约 1-2 分钟）..."
if [ -f "$SSL_DIR/fullchain.pem" ]; then
  c_g ">> 证书已存在，跳过签发（续期由 acme.sh cron 自动处理）"
else
  "$ACME" --issue --dns dns_ali -d "$DOMAIN" --server letsencrypt \
    || { c_r ">> 证书签发失败：请核对 AccessKey 与域名 DNS 是否托管在阿里云"; exit 1; }
  mkdir -p "$SSL_DIR"
  "$ACME" --install-cert -d "$DOMAIN" \
    --fullchain-file "$SSL_DIR/fullchain.pem" \
    --key-file       "$SSL_DIR/privkey.pem" \
    --reloadcmd      "nginx -s reload || systemctl reload nginx" \
    || { c_r ">> 证书安装失败"; exit 1; }
fi
unset Ali_Key Ali_Secret   # 不把密钥留在环境变量里

# ---------- 3. 生成 nginx HTTPS 配置 ----------
c_y ">> 生成 nginx HTTPS 站点配置 ..."
sed -e "s|__WEBROOT__|$ROOT|g" \
    -e "s|__HTTPPORT__|$HTTP_PORT|g" \
    -e "s|__APIPORT__|$APIPORT|g" \
    -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__SSL_CERT__|$SSL_DIR/fullchain.pem|g" \
    -e "s|__SSL_KEY__|$SSL_DIR/privkey.pem|g" \
    "$ROOT/nginx/guitar-studio-https.conf.template" > "$CONF"

# 无全局 IPv6 时移除 [::] 监听（与 P1-07 同源问题）
if ! ip -6 addr show scope global 2>/dev/null | grep -q 'inet6'; then
  sed -i '/listen \[::\]/d' "$CONF"
  c_y ">> 未检测到可用 IPv6，已移除 [::] 监听"
fi

# ---------- 4. 校验并重载 nginx ----------
if ! nginx -t; then
  c_r ">> nginx 配置校验失败，部署中止。请检查 $CONF"
  exit 1
fi
systemctl reload nginx || systemctl restart nginx
c_g ">> nginx 已启用 HTTPS（443），HTTP $HTTP_PORT 自动 301 跳转"

# ---------- 5. 防火墙放行 443 ----------
if systemctl is-active --quiet firewalld; then
  firewall-cmd --add-port=443/tcp --permanent >/dev/null
  [ "$HTTP_PORT" != "80" ] && firewall-cmd --add-port=${HTTP_PORT}/tcp --permanent >/dev/null
  firewall-cmd --reload >/dev/null
  c_g ">> firewalld 已放行 443/tcp 与 ${HTTP_PORT}/tcp"
fi

# ---------- 6. 提示 DDNS 配置 ----------
c_g "================ 部署完成 ================"
echo "  访问地址： https://$DOMAIN/guitar-studio.html"
echo "  后台面板： https://$DOMAIN/admin"
echo ""
echo "  别忘了 DDNS（域名指向你家的 IPv6）：编辑 $ROOT/config.json："
echo '    ddns.enabled = true'
echo '    ddns.provider = "aliyun"'
echo '    ddns.domain  = "'${DOMAIN#*.}'"   # 主域名（去掉主机记录部分）'
echo '    ddns.sub     = "'${DOMAIN%%.*}'"  # 主机记录（guitar 等）'
echo '    ddns.aliId / aliSecret 填上面同一个 AccessKey'
echo "  然后重启后端： systemctl restart guitar-studio（服务名以 deploy-centos.sh 输出为准）"
echo ""
c_y "  手机外网访问 https://$DOMAIN 后，麦克风即可正常授权。"
c_g "=========================================="
