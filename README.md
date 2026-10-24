# 六弦工坊 · AI 吉他练习室

一个吉他练习网页工具：**调音器、节拍器、节奏型练习、和弦闯关、音阶练习、和弦库、练耳、指板、录音棚**。
音频处理在浏览器本地完成，麦克风声音**不会上传、不会保存**。


## V3.0 新特性（Tone.js 内核 · 目录重构 · 7 套主题 · 四语）

> 按《六弦工坊 V3.0 产品需求手册》交付，目录结构见 `docs/DIRECTORY_MIGRATION.md`。

- **Tone.js 音频内核**：节拍器 / 进度伴奏 / 节奏型三处共用同一条 Transport 时间轴；
  本地 vendor（`assets/vendor/tone.esm.js`）优先，CDN 双回退，加载失败自动降级原生 Web Audio。
- **节拍器升级**：BPM 30–300、6 种音色（Tone 合成器）、渐快训练（N 小节线性 ramp）、Swing 摇摆。
- **7 套主题**：霓虹暗夜（默认）/ 晨曦浅色 / 复古木吉他 / 赛博紫 / 森野绿 / 玫瑰金 / 极简灰，
  侧栏 ✦ 按钮切换，支持**跟随系统**（深色→霓虹、浅色→晨曦，实时监听），首屏防闪。
- **中英日韩四语**：侧栏 🌐 按钮切换，导航/首页/通用操作词条已覆盖；
  各模块深水区文案按 `assets/js/i18n/*.js` 的词条结构持续接入。
- **目录重构 + ESM**：单一模块入口 `assets/js/main.js`，`package.json` 提供
  `npm test`（88 项单测）/ `npm start` / `npm run lint`。

> ⚠️ ESM 限制：V3 起必须通过 HTTP 访问（`npm start` 或 启动吉他工具.bat），
> 直接双击 html（file://）不再可用。

支持三种用法：

1. **本地/局域网**：Windows 双击即用，无需安装任何东西。
2. **手机 HTTPS**：直接用 GitHub Pages 地址，手机浏览器开麦克风。
3. **外网 IPv6 部署**（本项目自带）：用 **Nginx + 一个零依赖 Node 服务**把网页发布到公网，并带一个**后台控制面板**，像 ddns-go 一样把你的**动态 IPv6 自动更新到域名（AAAA 记录）**。Windows、CentOS 都能一键部署，端口可自由调配。

## V3.1 新特性（安全加固 · 练习统计与计划 · 乐理拼写 · 和弦转换）

> 按《六弦工坊 V3.1 产品需求文档（PRD）》交付，编号与 PRD 一致。

- **S0 部署后台安全加固（P0）**
  - S0.1 首次启动强制初始化：口令仍为默认值/为空时，除 `/api/init-status`、`/api/init` 外所有 `/api/*` 返回 409；默认口令不再作为代码兜底
  - S0.2 安全响应头：`X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy` / CSP 全站注入
  - S0.3 登录限流：按 **IP + 账号** 双维度计数，锁定时间递增（10min → 30min → 2h → 24h），日志固定记录来源
  - S0.4 XSS 边界规范：新增 `esc()` 转义工具，`scripts/lint.mjs` 自动抽查插值面
- **F1 练习统计中心（P0）**：统一 `PracticeSession` 数据模型（模块/时长/正确率/**目标速度与实测速度分字段**），
  今日·本周·累计卡片、7/30/90 天进步曲线、模块正确率对比、月度打卡日历、JSON/CSV 导出与再导入、旧数据自动迁移
- **F2 每日练习计划（P1）**：3 步生成（阶段 → 时长 → 关注点），任务完成度与各模块可测指标联动，一键跳转练习
- **F3 练耳升级（P1）**：随机八度音高池、入门/进阶/大师三级难度、**旋律模仿模式**（2–4 音短句 + 回听 + 音名复现）、反应时间统计
- **F4 和弦转换训练（P1）**：节拍引导版，当前/下一个和弦指法同屏，记录目标速度与切换次数并计入 F1
- **F8 乐理拼写引擎（P1）**：`assets/js/core/music-spelling.js` 纯函数模块——12 调大小调拼写、调号、和弦构成音、移调与罗马数字级数、指板音名查询、6/8 拍分组
- **F10 音频设备切换与恢复引导（P2）**：输入设备选择器（热插拔自动刷新）、AudioContext suspended 恢复横幅、后台返回行为可预期
- **F9 四语补齐**：新增界面词条已补齐 zh-CN/en/ja/ko 四语，lint 增加硬编码中文扫描（告警）
- **C3 缓存版本自动化**：Service Worker 缓存名由 `package.json` 版本号自动派生，不再手工递增
- **F11 框架演进预研**：见 `docs/V3.1_FRAMEWORK_EVALUATION.md`（仅文档，不引入任何运行时依赖）

测试：`npm test`（88 项单测）/ `npm run lint`（语法 + S0.4 插值面 + F9 中文扫描 + C7 文档路径一致性）。

> 说明：`npm test` 在 Node 18+ 使用 `node --test test/*.test.js`；如使用旧版 shell 通配，请确保展开到具体测试文件。
>
> V3.1 全量验证结果：单测 88/88、lint 0 告警、前端 E2E 36/36、V3.0 回归 E2E 19/19、后台安全 E2E 11/11。
> 其中后台 E2E 覆盖 S0.1 强制初始化状态机（弱口令/默认口令/两次不一致均被拒）与 S0.3 限流锁定，
> 需另起服务后用 Playwright 访问 `/admin` 复现。

## V3.2 物理机实测修复（麦克风链路 · 节拍器发声 · 自定义音色 · 和弦图可读性）

> 针对真机（Windows/手机）实测反馈的 4 类问题修复，全部在本地 Chromium + 虚拟音频设备下客观复测通过。

### 1. 调音器 / 和弦闯关麦克风无响应

- **根因**：`Mic.start()` 已接受设备参数，但内部 `_startInner()` 引用了未声明的变量，
  每次启动都抛 `ReferenceError: deviceId is not defined`，麦克风从未真正打开。
- **修复**：
  - 设备 id 正确透传，启动流程拆为 `idle → requesting → running` 三态，失败时回落 `idle` 并记录诊断
  - `getUserMedia` 加 10 秒超时竞态，避免系统弹窗挂起导致界面假死
  - 采集约束与录音棚保持一致（关闭回声消除/降噪、保留自动增益），解决"采集到了但电平过低"
  - 麦克风 `AudioContext` 若为 `suspended` 自动 `resume()`，手机切后台回来不再哑火
  - 失败时在界面给出**可执行的排查提示**（权限被拒 / 无设备 / 设备被占用 / 非 HTTPS 局域网）

### 2. 节拍器没有声音

- **根因**：调度时钟与播放时钟用了两个不同的 `AudioContext`，算出的发声时刻落在"过去"，
  振荡器 `start/stop` 被浏览器直接忽略 → 完全静音；同时 Tone.js 版本号写成了不存在的 15.8.6，CDN 全部 404。
- **修复**：统一到同一个 `AudioContext`；发声时刻做 `Math.max(0, …)` 钳制；Tone 版本修正为 **15.1.22**。
  实测 master 总线峰值 **0.238**（此前为 0）。

### 3. 节拍器自定义音色（真实采样）

节拍器新增「自定义」音色，**本地文件导入**与**音频直链**两种方式：

- 本地文件：任意 `wav/mp3/ogg` 均可，完全离线、无鉴权与跨域问题（推荐）
- 音频直链：填写可直链下载且允许 CORS 的 URL。已在本项目 CSP 中放行以下音效站点：
  [freesound.org](https://freesound.org) · [zapsplat.com](https://www.zapsplat.com) · [creazilla.com](https://creazilla.com)
- 未导入自定义音色时，节拍器仍使用内置合成音（已修复发声），不会出现"点了没声"
- 节拍器卡片上的「🔊 试音」会输出诊断信息（音频后端 / 音色 / 总线 / 采样状态 / 上下文状态），便于定位

### 4. 和弦转换与和弦图可读性

- 指板品位数字与品位圆点**统一接入主题变量**（`--diag-*` / `--dot-*`），7 套主题均已定义
- 数字下方增加**圆形背景**，浅色主题（dawn）圆点底色压深，全部主题实测对比度：
  指板数字 ≥ **5.8:1**、品位圆点 ≥ **6.8:1**（WCAG AA 标准 4.5:1）
- 新增「**清空已选**」按钮，一键清除已选和弦
- 已选和弦**少于两个**时点击开始：弹出提示框（`role="alertdialog"`）并**不启动练习**；
  只有 ≥2 个和弦才真正开始

### 5. V3.1 缺陷报告修复（BUG-01 ~ BUG-10）

同步修复《六弦工坊 V3.1 缺陷测试报告》中的 10 项缺陷，并新增 `test/v31-defects.test.js` 回归用例：

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| BUG-01 | 8 个空格可绕过初始化口令，导致系统自锁 | 统一 `validatePassword()`：trim 后校验长度 + 字母数字组合 |
| BUG-02 | 调音/跟弹练习时长未记录 | 补 `tuneStartedAt` / `followStartedAt` 并在完成时上报 |
| BUG-03 | 练耳一轮结束后统计未清零 | `report()` 上报后重置计数与反应时间 |
| BUG-04 | 计划页完成度单位错（次数按条数算） | `flow` 按切换次数、`ear` 按题目数，缺省回落条数 |
| BUG-05 | 导入数据未校验 | 正确率钳制 0–1、时间字段校验、上限 5000 条 |
| BUG-06 | SW 缓存版本派生失效（`/package.json` 被拒） | 新增公开 `/api/v1/version`，SW 依次尝试该接口与 package.json |
| BUG-07 | 非 ASCII 路径下测试失败 | `ROOT` 改用 `fileURLToPath(import.meta.url)` |
| BUG-08 | 跨账号暴力破解（仅按账号计数） | 增加 IP 维度计数（15 次触发递增锁定） |
| BUG-09 | `Authorization: Bearer` 被判 401 | `normalizeToken()` 兼容标准 Bearer（大小写不敏感）与裸 token |
| BUG-10 | 增三和弦 `+` 识别失败 | 正则修正为 `/^aug$|^\+/`，`C+` / `C+7` 正确识别为 aug |

## 功能一览

| 模块 | 说明 | 是否需要麦克风 |
| --- | --- | --- |
| 调音器 | 自相关（autocorrelation）基频检测，吉他六弦 / 半音阶双模式，±50 音分表盘，A4 基准 432–446 Hz 可调 | 是 |
| 节拍器 | 音频硬件时钟调度，不跑拍；30–300 BPM、TAP 测速、2/4·3/4·4/4·6/8 拍号、四分/八分/三连音/十六分细分、6 种音色、渐快训练与 Swing，统一 Transport 时间轴驱动 | 否 |
| 节奏型练习 | 扫弦 8 种 + 分解 6 种预设节奏型可视化跟练：D/U 箭头与弦序数字网格、当前格高亮、示范试听＋节拍器双音量、预备拍、1–∞ 循环计数、根音随和弦映射、暂停续播与练习统计 | 否 |
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
2. 访问 `https://<用户名>.github.io/<仓库名>/`（根地址会自动跳转到 `app.html`）。
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

- `app.html`：页面结构与样式，应用唯一入口
- `assets/js/`：原生 ES Module 源码（`core/` 通用核心、`modules/` 功能模块、`data/` 数据、`i18n/` 语言包）
- `assets/js/main.js`：统一模块入口，静态 import 全部核心与功能模块（调音器 / 节拍器 / 和弦库 / 和弦闯关 / 音阶 / 练耳 / 指板 / 录音 / 节奏，V3.1 起新增练习计划、练习统计、和弦转换）
- `index.html`：GitHub Pages 根地址自动跳转到 `app.html`

本地/局域网：

- `server.ps1`、`启动吉他工具.bat`：Windows 本地服务（8765 端口）

外网托管 / DDNS：

- `server/server.js`：零依赖 Node 后端（静态托管 + 后台 API + IPv6 探测 + DDNS）
- `server/admin.html`：后台控制面板（登录后配置 DDNS / 端口 / 查看日志；V3.1 起首次进入强制初始化管理员口令）
- `server/config.example.json`：配置模板（运行后生成的 `config.json` 含密码与凭证，**不会入库**）
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
- **调音器点了没反应**：① 地址必须是 `https://` 或 `http://localhost/127.0.0.1`，局域网 `http://192.168.x.x` 会被浏览器禁用麦克风；
  ② 浏览器地址栏的权限图标需为"允许"；③ 若提示设备被占用，关闭其他正在录音的程序；④ 可点节拍器的「🔊 试音」看诊断输出确认音频链路。
- **节拍器没有声音**：先看系统音量与浏览器标签页是否被静音；若用了自定义音色但未导入成功，会回落到内置合成音（不会完全静音）。

## 技术说明

- 前端：纯原生 HTML / CSS / JavaScript，无构建、无前端框架；`app.html` 通过 `<script type="module">` 加载 `assets/js/main.js`，各功能以 ES Module 组织。
- 音频：Web Audio API（OscillatorNode 合成、AnalyserNode 时域采样）；音高检测为自相关算法；录音为 MediaRecorder API。
- 后端：仅用 Node.js 内置模块（`http/https/os/fs/crypto`），Node 10+ 即可运行，无需 npm install。
- IPv6 探测：网卡枚举全局单播地址（2000::/3）+ 多个外部回显服务（`6.ipw.cn`、`api-ipv6.ip.sb`、`v6.ident.me`、`api6.ipify.org`），后台异步探测、状态接口秒回。
- DDNS：Cloudflare（自动查 Zone、AAAA 记录不存在则新建）、DNSPod（dnsapi.cn Record.List/Create/Modify）、阿里云（alidns RPC + HMAC-SHA1 签名，DescribeDomainRecords/Add/UpdateDomainRecord）。
- 界面：深色霓虹风格，移动端（iPhone 16 Pro 逻辑宽度）与桌面端（Edge）响应式适配。

## V2.0 升级 · M1 工程化改造（已交付）

按《产品需求文档与升级方案 v2.0》以**渐进式迁移**推进，V1 的两条产品底线（本地隐私、零依赖部署）保持不变：

- **音频算法库化**：自相关测频（含 MPM 抗低八度误锁）、中位数平滑、音名换算、节拍调度、闯关/跟弹判定统一抽取到 `assets/js/core/audio-core.js` 纯函数模块（浏览器全局 `AudioCore`，Node 直接 `require`）。
- **单元测试**：`test/audio-core.test.js` 与 `test/rhythm-data.test.js` 基于 Node 内置 test runner，**零依赖**，运行 `node --test` 即可（31 个用例，覆盖六弦标准音全范围识别、抗泛音、八度量化、TAP 测速，以及节奏型预设校验、根音映射、步进时值等）。
- **PWA 离线**：新增 `manifest.webmanifest` + `sw.js` + 品牌图标，核心静态资源缓存优先、`/api/*` 永不缓存；HTTPS 环境可安装到桌面，离线也能练习。
- **健康检查**：`GET /api/v1/health`（无需登录），供监控探针与负载均衡使用，返回服务名、版本、运行时长。
- **Bug 修复**：修复纯音下自相关算法低八度误锁（220Hz 判为 110Hz）；修复 C7 和弦 `Bb` 音名解析错误导致弹对音被误判；修复闯关匹配 `!hit` 将弦索引 0 误判为空的隐患。
