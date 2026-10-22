# 六弦工坊 · AI 吉他练习室

一个吉他练习网页工具：**调音器、节拍器、和弦闯关、音阶练习、和弦库、练耳、指板、录音棚**。
音频处理在浏览器本地完成，麦克风声音**不会上传、不会保存**。

支持三种用法：

1. **本地/局域网**：Windows 双击即用，无需安装任何东西。
2. **手机 HTTPS**：直接用 GitHub Pages 地址，手机浏览器开麦克风。
3. **外网 IPv6 部署**（本项目自带）：用 **Nginx + 一个零依赖 Node 服务**把网页发布到公网，并带一个**后台控制面板**，像 ddns-go 一样把你的**动态 IPv6 自动更新到域名（AAAA 记录）**。Windows、CentOS 都能一键部署，端口可自由调配。

## 功能一览

| 模块 | 说明 | 是否需要麦克风 |
| --- | --- | --- |
| 调音器 | 自相关（autocorrelation）基频检测，吉他六弦 / 半音阶双模式，±50 音分表盘，A4 基准 432–446 Hz 可调 | 是 |
| 节拍器 | 音频硬件时钟调度，不跑拍；40–240 BPM、TAP 测速、2/4·3/4·4/4·6/8 拍号、四分/八分/三连音/十六分细分，摆锤与强弱拍可视化 | 否 |
| 和弦闯关 | 随机出和弦，对着麦克风逐弦拨弦，实时听音判定；4 个难度、10 题一轮、倒计时、连击加分 | 是 |
| 音阶练习 | 大/小调、五声、布鲁斯、多利亚等 12 种常用音阶与把位，指板高亮根音与音阶音，跟听示范自动播放，开麦克风逐音跟弹、连击计分 | 是（跟弹时） |
| 和弦库 | 22 个常用开放/横按/七/挂留和弦，SVG 指法图，合成扫弦/分解试听，左手琴镜像，6 条经典和弦进行循环伴奏 | 否 |
| 练耳训练 | 单音、音程、三和弦、七和弦四级听辨，选择题作答、正确率统计 | 否 |
| 指板训练 | 0–12 品指板音名图，点击发声；“找音游戏”训练指板记忆 | 否 |
| 录音棚 | 麦克风录音、回听、下载 WebM/MP4 音频 | 是 |
| 后台面板 `/admin` | 公网 IPv6 状态、DDNS 配置、端口配置、运行日志 | 否 |

---

## 方式一：本地 / 局域网（Windows 双击）

1. 把整个文件夹放到任意位置（如 `D:\guitar-studio`）。
2. **双击 `启动吉他工具.bat`**，会用 Win10 自带 PowerShell 启动本地服务（`http://localhost:8765`）并打开 Edge。
3. 需要同一 WiFi 手机访问时，按提示输入 `Y` 并在 UAC 弹窗点“是”。
4. 关闭黑色命令行窗口即停止。

> 浏览器安全策略要求麦克风只能在 `https://` 或 `localhost` 下使用，所以不能直接双击 HTML。

## 方式二：手机用 GitHub Pages（HTTPS）

1. 仓库 **Settings → Pages**，Source 选 `main` 分支、根目录 `(root)`，保存。
2. 访问 `https://<用户名>.github.io/<仓库名>/guitar-studio.html`。
3. iPhone 用 Safari 打开，首次允许麦克风；**无声请关闭机身左侧静音键**。可“添加到主屏幕”获得接近 App 的全屏体验。

---

## 方式三：外网 IPv6 部署（Nginx + DDNS 后台）

### 架构

```
公网手机/电脑
   │  http(s)://[你的动态IPv6]:端口
   ▼
 Nginx（IPv4 + IPv6 双栈，托管静态网页）
   ├── /              → 吉他网页（根路径只返回这个页面）
   ├── /admin         → 后台控制面板（密码登录）
   └── /api/*         → 反代到本机 Node 服务
                         └─ 探测公网 IPv6 → 定时更新域名 AAAA（Cloudflare / DNSPod / 阿里云）
```

- 网页静态文件由 Nginx 直接托管（**外网只暴露这个吉他站点，后端源码/配置/脚本全部禁止访问**）。
- 一个零依赖 Node 服务（仅用 Node 内置模块，不用 npm install）提供后台 API 与 DDNS。
- 没有 Nginx 也能跑：Node 自身可直接双栈对外（功能一致，适合 Windows 快速体验）。

### 你需要准备的东西

1. **一条公网 IPv6**：宽带已分配 IPv6（本项目会自动探测；可在后台看到网卡候选地址）。
2. **一个域名**，并把域名的 DNS 托管在 Cloudflare、腾讯云 DNSPod 或阿里云（三选一）。
3. **路由器/光猫放行 IPv6 入站端口**（IPv6 没有 NAT，是放行防火墙，不是端口映射）。
4. 外网用手机麦克风**必须 HTTPS**：推荐把域名接入 Cloudflare 橙云（自动 HTTPS），或用 certbot 给 Nginx 申请证书。

### 第 1 步：申请 DNS API 凭证

**Cloudflare（推荐，免费且自带 HTTPS）**
1. 域名 NS 改为 Cloudflare 分配的 NS（在 CF 添加站点后按提示操作）。
2. 右上头像 → **My Profile → API Tokens → Create Token**，选模板 **Edit zone DNS**，Zone 选你的域名。
3. 复制生成的 Token，后台“Cloudflare API Token”粘贴即可（**Zone ID 无需手填，程序自动查询**）。

**腾讯云 DNSPod（dnspod.cn）**
1. 域名在 DNSPod 解析。
2. 控制台 → **账号中心 → API 密钥 / DNSPod Token**，创建得到 **ID** 和 **Token**。
3. 后台分别填入“DNSPod Token ID / Token”。

**阿里云（万网域名 · 云解析 DNS）**
1. 域名已在阿里云控制台「云解析 DNS」里正常解析（确认主域名出现在解析列表）。
2. 强烈建议创建 **RAM 子账号专用 AccessKey**（不要用主账号 AK）：控制台 → **访问控制 RAM → 用户 → 创建用户**，勾选“OpenAPI 调用访问”，创建后保存 **AccessKey ID / Secret**。
3. 给该 RAM 用户授权系统策略 **AliyunDNSFullAccess**（仅授予改 DNS 所需权限）。
4. 后台服务商选“阿里云”，分别填入 **AccessKey ID / Secret**。

> 注意：阿里云 DNS 本身不提供 HTTPS，外网手机麦克风仍需给 Nginx 配证书（certbot），或在前面套一层 Cloudflare。

### 第 2 步：Windows 10/11 部署

1. 安装 Node.js LTS（若没有，脚本会尝试用 winget 自动装；也可手动到 https://nodejs.org 安装）。
2. **右键 `start-hosting.bat` → 以管理员身份运行**（首次会自动申请管理员权限）。
   - 默认对外端口 **8080**，内部 Node 端口 3000。
   - 脚本会自动下载便携版 Nginx 到 `nginx-bin\`（若下载失败则自动改为 Node 直连，功能不受影响）。
   - 自动放行 Windows 防火墙入站端口。
3. **需要 HTTPS（外网手机麦克风必须）且有阿里云域名**：见 `docs/阿里云域名HTTPS部署指南.md`，CentOS 用 `deploy-https-aliyun.sh`、Windows 用 `enable-https-aliyun.ps1` 一条命令完成证书签发与 443 托管（含自动续期）。
4. 也可在管理员 PowerShell 里自定义端口：
   ```powershell
   .\deploy-windows.ps1 -Port 9000
   .\deploy-windows.ps1 -NoNginx        # 不使用 Nginx，Node 直接双栈对外
   ```

### 第 2 步：CentOS 7 / Stream 8 / 9 部署

```bash
# 克隆/上传整个项目后，在项目目录执行（默认对外 8080）
sudo bash deploy-centos.sh

# 自定义对外端口（第二个参数是本机 Node 端口，一般不用改）
sudo bash deploy-centos.sh 9000 3000
```

脚本会自动：安装 Node 18+ 与 Nginx、生成 Nginx 配置、注册 **systemd 开机自启**、处理 SELinux、放行 firewalld 端口。

常用运维命令：

```bash
systemctl status guitar-studio     # 后端状态
systemctl restart guitar-studio    # 重启后端
systemctl restart nginx            # 重启 Nginx
journalctl -u guitar-studio -f     # 实时日志
```

### 第 3 步：在后台配置 DDNS

1. 打开 `http://[你的IPv6]:8080/admin`（或 Nginx 域名 `/admin`），默认密码 **`admin123`**。
2. 顶部确认“当前公网 IPv6”已正确识别（多地址时可在“IPv6 来源”里手动指定）。
3. 在“DDNS 动态域名”选择服务商，填主域名（如 `example.com`）与主机记录（如 `guitar`，根域名填 `@`），粘贴 API 凭证，设置检测间隔。
4. 打开“自动 DDNS”开关会立即同步一次并进入定时更新；也可点“立即同步域名”。
5. 在“服务与端口”里**修改管理员密码**并保存。
6. 域名同步成功后，用 `http://你的域名:8080/` 即可从外网访问吉他网页。

### 端口与 HTTPS

- 改端口：Windows 用 `deploy-windows.ps1 -Port xxxx`；CentOS 用 `sudo bash deploy-centos.sh xxxx`；或在后台改“Web 服务端口”后重启服务。
- 80/443 端口在 Linux 上 Nginx 可直接使用（systemd 以 root 运行）；Windows 建议用 8080 等高位端口。
- **HTTPS（外网手机麦克风必须）**：
  - 最简单：域名接入 Cloudflare 并在后台打开“Cloudflare 橙云代理”，自动获得 HTTPS。
  - 自建：用 certbot 申请证书，Nginx 增加 443 server（`nginx/guitar-studio.conf.template` 末尾有示例）。

---

## 文件结构

前端（必须放在同一文件夹，缺一不可）：

- `guitar-studio.html`：页面结构与样式，入口文件
- `app-1.js`：通用工具 / 路由 / 调音器
- `app-2.js`：节拍器 / 和弦库
- `app-3.js`：和弦闯关 / 音阶练习 / 练耳 / 指板 / 录音
- `index.html`：GitHub Pages 根地址自动跳转到 `guitar-studio.html`

本地/局域网：

- `server.ps1`、`启动吉他工具.bat`：Windows 本地服务（8765 端口）

外网托管 / DDNS：

- `server.js`：零依赖 Node 后端（静态托管 + 后台 API + IPv6 探测 + DDNS）
- `admin.html`：后台控制面板（登录后配置 DDNS / 端口 / 查看日志）
- `config.example.json`：配置模板（运行后生成的 `config.json` 含密码与凭证，**不会入库**）
- `nginx/guitar-studio.conf.template`：Nginx 站点配置模板（IPv4+IPv6、安全拦截）
- `deploy-centos.sh`：CentOS 一键部署（含 systemd / firewalld / SELinux）
- `deploy-windows.ps1`、`start-hosting.bat`：Windows 一键部署（含便携 Nginx / 防火墙）

> 转发时请把**整个文件夹**一起复制；`config.json`、`node_modules`、`nginx-bin` 已在 `.gitignore` 忽略。

## 常见问题

- **外网打不开网页**：依次检查 ① 后台顶部是否识别到公网 IPv6；② 路由器/光猫 IPv6 防火墙是否放行入站 TCP 端口；③ Windows/CentOS 防火墙是否放行（部署脚本已自动处理）；④ 服务是否在运行（`systemctl status guitar-studio` / 任务管理器）。
- **域名访问不到**：确认 DNS 已托管到对应服务商、API 凭证权限正确、后台“运行日志”显示“已更新/已新建 AAAA”；域名生效需要一点时间。
- **电脑能开网页但手机麦克风没反应**：手机端要求 HTTPS，纯 IPv6 + HTTP 下 Safari/Edge 会禁用麦克风，请接 Cloudflare 橙云或配置证书。
- **后台识别不到 IPv6**：点“重新检测 IPv6”；确认宽带有 IPv6（`ip -6 addr` 或网卡详情里有 2xxx 开头地址）；多网卡可在“IPv6 来源”里手动填地址。
- **本地端口 8765 被占用**：改 `server.ps1` 顶部 `$Port`；外网端口被占用则按上面的方式自定义端口。
- **iPhone 没有声音**：关闭机身左侧静音键。

## 技术说明

- 前端：纯原生 HTML / CSS / JavaScript，无构建、无前端框架；`<script src>` 拆分为 3 个 JS 引用。
- 音频：Web Audio API（OscillatorNode 合成、AnalyserNode 时域采样）；音高检测为自相关算法；录音为 MediaRecorder API。
- 后端：仅用 Node.js 内置模块（`http/https/os/fs/crypto`），Node 10+ 即可运行，无需 npm install。
- IPv6 探测：网卡枚举全局单播地址（2000::/3）+ 多个外部回显服务（`6.ipw.cn`、`api-ipv6.ip.sb`、`v6.ident.me`、`api6.ipify.org`），后台异步探测、状态接口秒回。
- DDNS：Cloudflare（自动查 Zone、AAAA 记录不存在则新建）、DNSPod（dnsapi.cn Record.List/Create/Modify）、阿里云（alidns RPC + HMAC-SHA1 签名，DescribeDomainRecords/Add/UpdateDomainRecord）。
- 界面：深色霓虹风格，移动端（iPhone 16 Pro 逻辑宽度）与桌面端（Edge）响应式适配。

## V2.0 升级 · M1 工程化改造（已交付）

按《产品需求文档与升级方案 v2.0》以**渐进式迁移**推进，V1 的两条产品底线（本地隐私、零依赖部署）保持不变：

- **音频算法库化**：自相关测频（含 MPM 抗低八度误锁）、中位数平滑、音名换算、节拍调度、闯关/跟弹判定统一抽取到 `lib/audio-core.js` 纯函数模块（浏览器全局 `AudioCore`，Node 直接 `require`）。
- **单元测试**：`test/audio-core.test.js` 基于 Node 内置 test runner，**零依赖**，运行 `node --test` 即可（17 个用例，覆盖六弦标准音全范围识别、抗泛音、八度量化、TAP 测速等）。
- **PWA 离线**：新增 `manifest.webmanifest` + `sw.js` + 品牌图标，核心静态资源缓存优先、`/api/*` 永不缓存；HTTPS 环境可安装到桌面，离线也能练习。
- **健康检查**：`GET /api/v1/health`（无需登录），供监控探针与负载均衡使用，返回服务名、版本、运行时长。
- **Bug 修复**：修复纯音下自相关算法低八度误锁（220Hz 判为 110Hz）；修复 C7 和弦 `Bb` 音名解析错误导致弹对音被误判；修复闯关匹配 `!hit` 将弦索引 0 误判为空的隐患。
