# 六弦工坊 · Guitar Studio V3.1

> 零依赖、纯原生 HTML/CSS/JS 的吉他练习室，含调音、练耳、音阶、节拍器、和弦进行与练习计划。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| 🎸 调音器 | 实时麦克风拾音 + 频谱可视化，6 弦自动识别 |
| 👂 练耳 | 单音 / 音程 / 和弦 / 旋律四级难度 |
| 🎼 音阶 | 跟弹练习，多种调式可选 |
| 🥁 节拍器 | 可调 BPM + 音色，支持变拍子 |
| 🎵 和弦进行 | I–IV–V–vi 等常见进行可视化练习 |
| 📅 练习计划 | L1–L4 分级任务，进度追踪 |
| 📊 统计 | 练习时长、正确率、连击数、反应时 |
| 📴 PWA | 离线可用，Service Worker 缓存 |
| 🔐 管理后台 | IPv6 DDNS 管理，口令强制初始化（BUG-01） |

## 🛠 技术栈

- **前端**：HTML5 + CSS3 + ES Modules（零框架、零构建）
- **音频**：Web Audio API + AudioWorklet
- **存储**：localStorage（练习记录）
- **后端**：Node.js 原生 ESM，零依赖（http/fs/path/child_process/crypto）
- **PWA**：Service Worker（version.json 派生缓存名，BUG-06）

## 📦 目录结构

```
guitar-studio/
├── index.html              # 入口
├── app.html                # 主应用
├── manifest.webmanifest    # PWA 清单
├── sw.js                   # Service Worker V3.1
├── version.json            # BUG-06 静态白名单
├── assets/
│   ├── css/                # 样式
│   ├── js/
│   │   ├── core/           # 核心库
│   │   │   ├── practice-store.js   # 练习存储（BUG-05 归一化）
│   │   │   ├── music-spelling.js   # 音名理论（BUG-10 aug/+）
│   │   │   ├── audio-devices.js
│   │   │   ├── chord-flow.js
│   │   │   └── stats.js
│   │   └── modules/        # 功能模块
│   │       ├── tuner.js    # 调音器（BUG-02 上报）
│   │       ├── ear-training.js  # 练耳（BUG-03 复位）
│   │       ├── scale.js    # 音阶（BUG-02 上报）
│   │       ├── metronome.js
│   │       ├── progression.js
│   │       └── plan.js     # 计划（BUG-04 计数）
│   └── audio/              # 节拍器音频
├── server/
│   ├── server.js           # Node 后端（BUG-01/06/08/09）
│   └── admin.html          # 管理后台
└── test/                   # 单测（117 项）
    ├── server-security.test.js   # BUG-01/06/08/09
    ├── practice-store.test.js    # BUG-05
    ├── music-spelling.test.js    # BUG-10
    └── regression-fixes.test.js  # BUG-02/03/04
```

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/yinbo3211/guitar-studio.git
cd guitar-studio

# 启动服务（默认 8080）
node server/server.js

# 自定义端口
node server/server.js --port=3000

# 指定配置
GS_CONFIG=./config.json node server/server.js
```

访问 http://localhost:8080/app.html 进入练习室，/server/admin.html 进入管理后台。

## 🧪 测试

```bash
npm test
```

**117 项单测全部通过**，覆盖：
- S0.1 初始化状态机
- BUG-01 空白口令 / 默认口令拦截
- BUG-05 导入归一化 / 幂等 / 5000 上限
- BUG-06 version.json 白名单 / package.json 拦截
- BUG-07 中文路径 fileURLToPath
- BUG-08 IP+账号双维度限流
- BUG-09 Bearer / 裸 token 兼容
- BUG-10 aug / + / +7 后缀

## 📋 更新日志 V3.1

| BUG | 描述 | 修复 |
|-----|------|------|
| BUG-01 | 纯空白口令绕过校验 | `/api/init` 先 trim 再校验长度，禁止默认口令 |
| BUG-02 | 调音器/音阶完成时不上报练习数据 | tuner/scale 完成时调用 `PracticeStore.addSession` |
| BUG-03 | 练耳每轮上报后不复位 | `report()` 复位 n/ok/反应时，保留跨轮 streak |
| BUG-04 | 计划完成度计数错误 | flow 按 `meta.switches`、ear 按 `meta.questions` |
| BUG-05 | 导入数据未逐条归一化 | 逐条 normalizeSession、幂等、5000 上限保护 |
| BUG-06 | SW 缓存名硬编码 | 新增 `version.json` 静态白名单供 SW 派生缓存名 |
| BUG-07 | 中文路径测试失败 | 子进程启动改 `fileURLToPath` |
| BUG-08 | 跨账号撞库 | IP+账号双维度限流 |
| BUG-09 | 鉴权不兼容裸 token | 兼容标准 `Bearer` 头与历史裸 token |
| BUG-10 | 增三和弦后缀识别错误 | 正则修复 `^aug$\|^\+` |

## 📜 License

MIT
