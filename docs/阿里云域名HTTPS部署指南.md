# 阿里云域名 HTTPS 部署指南（六弦工坊）

> 目标：让手机在外网通过 `https://你的域名` 访问练习室，麦克风（调音器/录音）正常授权。
> 原理：浏览器只允许 **HTTPS 或 localhost** 使用麦克风，所以外网必须上 HTTPS。

本方案使用你已有的**阿里云域名**，DNS 不需要迁移到 Cloudflare，全程两条命令搞定。

---

## 一、前置准备（阿里云控制台，约 5 分钟）

### 1. 创建 RAM 子账号（只给 DNS 权限，安全起见）

1. 阿里云控制台 → **RAM 访问控制** → 用户 → **创建用户**，勾选「OpenAPI 调用访问」，创建后保存好 **AccessKeyId / AccessKeySecret**（Secret 只显示一次）
2. 给该用户授权：搜索并绑定系统策略 **`AliyunDNSFullOnly`**（仅云解析权限，泄露了也动不了你其他资源）

### 2. 确认域名 DNS 托管在阿里云

控制台 → **云解析 DNS** → 能看到你的域名即可。添加一条测试记录：
- 记录类型 `AAAA`（有公网 IPv4 就加 `A`），主机记录 `guitar`，记录值先随便填 `::1`（后面 DDNS 会自动更新）

---

## 二、CentOS 服务器（一条命令）

前提：已按 `deploy-centos.sh` 完成基础部署。

```bash
chmod +x deploy-https-aliyun.sh
sudo ./deploy-https-aliyun.sh \
  -d guitar.example.com \
  -k <AccessKeyId> -s <AccessKeySecret>
```

脚本自动完成：acme.sh 安装 → 阿里云 DNS API 验证签发 Let's Encrypt 证书 → 证书装入 `/etc/nginx/ssl/` → nginx 443 SSL + 80 跳转 → 防火墙放行 → **注册自动续期**（acme.sh cron，续期后自动 reload）。

> DNS 验证方式不需要 80/443 在公网可达，纯 IPv6 家庭宽带也能签。

## 三、Windows 主机（PowerShell，无需 Git Bash）

前提：已运行 `start-hosting.bat`（便携 nginx 就位）。

```powershell
# 管理员 PowerShell
.\enable-https-aliyun.ps1 -Domain guitar.example.com `
    -AliKeyId <AccessKeyId> -AliSecret <AccessKeySecret>
```

脚本自动完成：安装 Posh-ACME 模块 → 阿里云 DNS 验证签发 → 改写 nginx 配置启用 443 → 防火墙放行 → 探测 HTTPS 是否生效。

> 证书 90 天有效，到期前（Posh-ACME 会有提示）**重跑一次本脚本**即可更新。

## 四、开启 DDNS（域名指向你家的 IP）

编辑项目根目录 `config.json`：

```json
"ddns": {
  "enabled": true,
  "provider": "aliyun",
  "domain": "example.com",
  "sub": "guitar",
  "aliId": "<AccessKeyId>",
  "aliSecret": "<AccessKeySecret>",
  "intervalMin": 5
}
```

重启 Node 后端（Windows：结束 node.exe 后重跑 `start-hosting.bat`；CentOS：`systemctl restart guitar-studio`）。后端会每 5 分钟把当前公网 IPv6/IPv4 更新到阿里云解析。

## 五、验证清单

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | `curl -I https://你的域名/guitar-studio.html` | `HTTP/2 200`，`Content-Type: text/html; charset=utf-8` |
| 2 | `curl -I http://你的域名/` | `301` 且 Location 为 `https://...` |
| 3 | 浏览器打开站点 | 地址栏有锁标志，中文无乱码 |
| 4 | 控制台执行 `window.isSecureContext` | `true` |
| 5 | 手机流量（关 WiFi）打开调音器 → 开始 | 弹出麦克风授权框，允许后指针摆动 |
| 6 | `https://你的域名/admin` | 登录页不再显示默认密码，可正常进入 |

## 六、常见问题

| 现象 | 原因与处理 |
|---|---|
| 签发失败 aliyun api error | AccessKey 错误或未授权 `AliyunDNSFullOnly`；确认域名 DNS 服务器是阿里云的 |
| 签发失败 no valid record | DNS 传播慢，等 2 分钟重试；确认域名没开 DNSSEC 拦截 |
| 手机打不开，电脑能打开 | 手机流量网络 IPv6 可达性差：确认解析里有 `A` 记录且家里有公网 IPv4；否则考虑 Cloudflare Tunnel 中转 |
| 能打开但麦克风仍报错 | 确认地址栏是 `https://` 而非 `http://`；控制台看 `window.isSecureContext` |
| 续期失败 | CentOS 看 `~/.acme.sh/` 日志；Windows 重跑 `enable-https-aliyun.ps1` |
| 443 被占用 | Windows：`netstat -ano | findstr :443`；CentOS：`ss -tlnp | grep 443` |

## 七、安全提示

- AccessKey 已按最小权限原则只授予 DNS 权限（`AliyunDNSFullOnly`）
- `config.json` 含密钥，**不要提交到公开仓库**（仓库不含该文件），nginx 黑名单已挡住外部读取
