# 目录迁移指南（V2 → V3.0 M3）

V3.0 按《六弦工坊 V3.0 产品需求手册》§5 完成目录重构与 ESM 改造。
本文记录新旧路径映射与迁移注意事项。

## 路径映射

| V2 旧路径 | V3 新路径 | 说明 |
|---|---|---|
| `guitar-studio.html` | `app.html` | 应用唯一入口（Q-01 决策） |
| `index.html` | `index.html` | 保留，跳转目标改为 app.html |
| （新增） | `404.html` | GitHub Pages 自定义 404 JS 兜底（Q-04，不保留旧文件跳转副本） |
| `app-1.js` | `assets/js/core/ui.js` + `core/router.js` + `core/audio-engine.js` + `modules/tuner.js` | 按对象拆分 |
| `app-2.js` | `assets/js/modules/metronome.js` + `modules/chord-lib.js` + `data/chords.js` | 按对象拆分 |
| `app-3.js` | `assets/js/modules/{chord-game,ear-training,fretboard,scale,recorder}.js` + `data/scales.js` | 按对象拆分 |
| `app-rhythm.js` | `assets/js/modules/rhythm.js` | 整体迁移 |
| `lib/audio-core.js` | `assets/js/core/audio-core.js` | UMD → ESM 具名导出，保留 `window.AudioCore` 兼容 |
| `lib/rhythm-data.js` | `assets/js/data/rhythm-data.js` | 同上，`window.RhythmData` 兼容 |
| `icons/` | `assets/icons/` | |
| （新增） | `assets/css/tokens.css` | 仅 `:root` 设计令牌，M4 主题唯一覆盖面 |
| （新增） | `assets/css/base.css` | 重置/排版/布局/侧栏/顶栏/标签栏 |
| （新增） | `assets/css/components.css` | 复用组件样式 |
| （新增） | `assets/css/ui-kit.css` | 响应式与无障碍 |
| `admin.html` | `server/admin.html` | 后台属于服务端面 |
| `server.js` | `server/server.js` | CJS → ESM（`type: module`） |
| `server.ps1` | `server/server.ps1` | 静态根取仓库根 |
| `config.example.json` | `server/config.example.json` | 运行时 config.json 仍在仓库根（gitignore） |
| `deploy-centos.sh` 等部署脚本 | `deploy/` | |
| `nginx/` | `deploy/nginx/` | 模板内路径已同步 |
| `RHYTHM_PRACTICE_TEST_REPORT.md` | `docs/` | |

## 特意保留在根目录的文件

`sw.js` 与 `manifest.webmanifest` 留在根目录：Service Worker 的默认作用域
由文件路径决定，放在根目录才能控制全站（GitHub Pages 无法配置
`Service-Worker-Allowed` 头）。根目录实际条目：`index.html`、`app.html`、
`404.html`、`sw.js`、`manifest.webmanifest`、`package.json`、`README.md`、
`config.json`（gitignore 运行时生成）、`启动吉他工具.bat` +
`assets/`、`server/`、`deploy/`、`docs/`、`test/`、`LICENSE` 等目录。

## ESM 改造要点（R-ESM-01～06）

1. `package.json` 声明 `"type": "module"`；`scripts.test = node --test test/`。
2. `assets/js/main.js` 是唯一脚本入口，按 V2 的 `<script>` 加载顺序 import
   全部模块后执行首次 `applyRoute()`。
3. 模块间跨引用沿用 V2 全局对象习惯：各模块在文件尾部把主对象挂到
   `window`（如 `window.Tuner = Tuner`），其余模块的裸标识符经全局解析。
   这是有意保留的兼容层，新代码建议走显式 import。
4. `audio-core.js` / `rhythm-data.js` 具名导出全部 API，同时导出聚合对象
   与默认导出，Node 测试直接 `import * as`。
5. `file://` 协议无法运行 ESM，必须经 HTTP 访问（`npm start` 或
   `server/server.ps1`）；SW 注册在非 http(s) 协议下自动跳过。

## 本地服务路径变化

- 健康检查等 API 不变；后台入口 `/admin` 现映射到 `server/admin.html`。
- 静态白名单（`ALLOWED_FILES`）已更新为新模块文件名，`config.json`
  与服务端源码依旧不可下载。
