# 第三方代码与数据来源说明

## 移植的第三方代码：GuitarPicker（MIT）

本项目的「弹唱演奏」功能（note-highway 演奏视图）移植自开源项目 **GuitarPicker**：

- 项目地址：https://github.com/adervec/GuitarPicker
- 在线体验：https://adervec.github.io/GuitarPicker/
- 许可证：**MIT License**（Copyright (c) GuitarPicker contributors）
- 移植范围（位于 `assets/js/gp/`）：

| 文件 | 来源 |
|---|---|
| `notes.js` | `src/music/notes.js` |
| `song-format.js` | `src/music/song-format.js` |
| `theory.js` | `src/music/theory.js` |
| `accompany.js` | `src/music/accompany.js` |
| `pitch.js` | `src/audio/pitch.js` |
| `voices.js` | `src/audio/voices.js` |
| `band.js` | `src/audio/band.js` |
| `engine.js` / `player.js` / `synth.js` | `src/audio/*` |
| `backgrounds.js` | `src/ui/backgrounds.js` |
| `components.js` | `src/ui/components.js` |
| `karaoke-timeline.js` / `karaoke-render.js` / `grader.js` | `src/karaoke/*` |
| `parts.js` / `avatars.js` / `avatar.js` | `src/cosmetics/*` |
| `play.js` | `src/views/play.js` |
| `assets/css/gp.css` | `styles/main.css` + `styles/themes.css`（已收敛到 `.gp-scope` 作用域） |

移植时所做的宿主适配（不影响原算法与视觉呈现）：

1. 存储：原 `src/state.js` 替换为 `assets/js/gp/state.js`，改接宿主的
   `gsStore`（`localStorage` 的 `gp` 子对象）与 `PracticeStore`；
2. 主题变量：GuitarPicker 的 CSS 变量全部收敛进 `.gp-scope`，避免与宿主
   `--bg` / `--accent` 等设计令牌冲突；
3. 提示与取色：`components.js` 的 `toast()` / `getVar()` 改接宿主实现。
4. 未移植：Locker 装扮商店、云端同步、编辑器、训练课程等（与演奏视图无关）。
   演奏 HUD 的头像徽标使用默认装扮渲染。

## 曲库数据来源

见 `assets/js/gp/songs.js` 顶部的 `GP_PROVENANCE`，以及生成脚本
`tools/fetch_gp_songs.py` / `tools/build_gp_songs.py`：

- **曲名 / 演唱者 / 时长 / 课程单元 / 难度层级**：《六弦工坊 V4.0 需求手册》附录 A。
- **歌词与逐行毫秒时间戳**：QQ 音乐公开歌词接口实时抓取（230/231 首命中）。
- **和弦进行**：通用和声模板（不可版权化的和声进行），非具体作品的编配复刻。
- **旋律曲目**（`pd-*`）：公有领域 / 传统曲目，人工记谱。
- **BPM**：QQ 音乐未提供公开 BPM 接口，按难度层级估计。

> 歌词与曲目的著作权归各自权利人所有；本项目仅作本地学习与练习用途，
> 不分发任何音频资源。如需公开发布，请自行替换为公有领域或已授权内容。
