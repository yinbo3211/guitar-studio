# 弹唱曲库 · 第三轮测试报告（V4.2.2 → V4.2.3）

# 弹唱曲库 · 第三轮测试报告（V4.2.2 → V4.2.3）
面向代码修复方（workBuddy）。所有结论附可复现命令 + 实测输出，未修改任何业务源码。
本轮只做三件事：验证上一轮修复效果、定位本轮新报的 3 个问题、给出谱面精确性提升的量化方案。
## 0. 元信息
### 上一轮 11 项缺陷的修复情况
结论：上一轮报告的问题已系统性修复，工程质量提升明显。本轮 3 个问题属于修复过程中新引入的回归 + 未覆盖的 DOM 生命周期缺陷。
## 1. 本轮缺陷总表
## 2. BUG-17（P0）反复进入演奏界面叠加多个画面
### 2.1 复现步骤
1. 曲库 → 任意曲目 → 点「开始弹唱」
2. 点「← Songs」返回曲库
3. 再选另一首 → 点「开始弹唱」
4. 观察：出现 2 个演奏画面（画布/HUD/控制条重复）
5. 重复第 2-3 步 → 3 个、4 个……线性叠加
### 2.2 根因（两处缺陷叠加）
**缺陷点 1：teardown 从不移除 DOM**
文件：assets/js/gp/play.js L669-674
// javascript
// cleanup
return () => {
  playing = false; ro.disconnect(); player.stop(); band.stop(); Audio.stopMic();
  window.removeEventListener("keydown", onKey);
  document.getElementById("health-mini")?.classList.add("hidden");
};
它只清理定时器 / ResizeObserver / 音频 / 键盘监听，完全没有移除自己 append 到 root 的 DOM。
而视图是在 L175 挂载的：
// javascript
shell.append(el("div.play-stage", {}, [canvas, overlay]), controls);
root.appendChild(shell);        // ← 只 append，无人回收
**缺陷点 2：enter() 不清空 root**
文件：assets/js/modules/song-play.js L58-82
// javascript
enter() {
  const root = document.getElementById('gpPlayRoot');
  if (!root) return;
  this.leave();                    // ← 只调 teardown（见缺陷点 1，不清 DOM）
  root.className = 'gp-scope';     // ← 只设 class，没有 root.innerHTML = ''
  ...
}
**缺陷点 3（竞态放大）：teardown 赋值晚于用户操作**
// javascript
this.busy = true;
Promise.resolve(playView(ctx))
  .then((fn) => { self.teardown = typeof fn === 'function' ? fn : null; })
teardown 要等 playView() 的 Promise resolve 后才赋值。用户若在视图初始化完成前就返回，
leave() 读到 teardown === null，连定时器和音频都不会清理（泄漏），DOM 更不会清。
### 2.3 证据（机器可验证）
新增测试 test/songplay-reentry.test.js，运行：
// bash
node --test test/songplay-reentry.test.js
实测输出：
not ok 1 - RE-1 teardown 必须移除演奏视图 DOM（否则返回曲库后残留）
    teardown 后 DOM 仍残留 1 个节点（应全部移除）

not ok 2 - RE-2 同一 root 重复挂载不得叠加画面
    重复进入后画面叠加：首次 1 个节点，第二次 2 个节点（应相等）

# tests 2
# pass 0
# fail 2
这 2 项是本轮新增的回归门禁，当前故意为红；修好 BUG-17 后应变绿。
在修好之前，npm test 会是 300 pass / 2 fail。
### 2.4 修复方案（三步，缺一不可）
**Step 1：play.js 的 teardown 负责回收自己的 DOM**
// javascript
// assets/js/gp/play.js  L669
return () => {
  playing = false; ro.disconnect(); player.stop(); band.stop(); Audio.stopMic();
  window.removeEventListener("keydown", onKey);
  document.getElementById("health-mini")?.classList.add("hidden");
  /* 新增：把自己挂上去的 DOM 摘掉，避免重复进入时叠加 */
  if (shell.parentNode) shell.parentNode.removeChild(shell);
};
**Step 2：song-play.js 的 enter() 强制清空 root（兜底）**
// javascript
// assets/js/modules/song-play.js  L58
enter() {
  const root = document.getElementById('gpPlayRoot');
  if (!root) return;
  this.leave();                    // 先停掉上一个实例的定时器/音频
  root.innerHTML = '';             // 新增：清掉任何残留 DOM（含 teardown 为 null 的场景）
  root.className = 'gp-scope';
  ...
}
Step 3：用会话令牌消除异步竞态
// javascript
// assets/js/modules/song-play.js
const SongPlay = {
  ...
  _gen: 0,                          // 新增：会话代次

  enter() {
    const root = document.getElementById('gpPlayRoot');
    if (!root) return;
    this.leave();
    root.innerHTML = '';
    root.className = 'gp-scope';
    const id = this.pendingId || this.hashId() || '';
    this.pendingId = '';
    this.songId = id;
    const def = defById(id);
    if (!def) { this.renderNotFound(root); return; }

    const self = this;
    const gen = ++this._gen;        // 本次会话编号
    const ctx = { el: root, params: [id],
      navigate: (hash) => { self.leave(); goRoute(NAV[hash] || 'songbook'); } };

    this.busy = true;
    Promise.resolve(playView(ctx))
      .then((fn) => {
        if (gen !== self._gen) {    // 期间已离开/重进 → 本实例过期，立即销毁
          if (typeof fn === 'function') { try { fn(); } catch (e) {} }
          return;
        }
        self.teardown = typeof fn === 'function' ? fn : null;
      })
      .catch((err) => {
        if (gen !== self._gen) return;
        console.warn('[song-play] 演奏视图初始化失败：', err);
        self.renderError(root);
      })
      .finally(() => { if (gen === self._gen) self.busy = false; });
  },

  leave() {
    this._gen++;                    // 让在途 Promise 的 then 判定为过期
    if (typeof this.teardown === 'function') {
      try { this.teardown(); } catch (e) { console.warn('[song-play] teardown 异常：', e); }
    }
    this.teardown = null;
    const root = document.getElementById('gpPlayRoot');
    if (root) root.innerHTML = '';
  },
};
Step 1 与 Step 2 是双保险：Step 1 让 teardown 自洽，Step 2 兜住 teardown 为 null 的竞态窗口。
Step 3 保证「快速连点」时不会遗留正在跑的定时器/麦克风（内存与资源泄漏）。
### 2.5 验收标准
// bash
node --test test/songplay-reentry.test.js     # 2 项必须全绿
npm test                                      # 300+ pass / 0 fail
人工验证：连续「进入 → 返回」5 次，DOM 中 .play-shell 数量恒为 1；且返回后无音频残留（麦灯熄灭、无背景音）。
## 3. BUG-18（P1）左侧曲名/调号 HUD 遮挡和弦提示
### 3.1 现象
演奏界面左上角显示「曲名 / 歌手 · key C · 76 BPM / 谱面来源徽章 / 提示语 / 原版谱外链 / 你的声部」，
该 HUD 块（.hud-box）带有半透明黑底 + 背景模糊，覆盖在画布左上角，
导致该区域内下落的音符块及其和弦名标签看不清；矮屏/移动端还会压住画布左下角的 Now: / Next: 和弦指板提示。
### 3.2 根因
根因 A：V4.2 修复 BUG-02 时 HUD 内容膨胀
文件：assets/js/gp/play.js L92-100（songBox 构造）+ chartBadge() L683-700
// javascript
const songBox = el("div.hud-box", {}, [
  el("div", {}, [el("b", { text: displayTitle(song) })]),          // 行1 曲名·歌手
  el("div.muted", { ... text: metaBits.join(" · ") }),             // 行2 歌手·调号·BPM
  chartBadge(song.id, chartKind),                                  // 行3-5 徽章+提示+外链
  parts.length > 1 ? el("div.muted", { ... text: ... }) : null,    // 行6 你的声部
]);
chartBadge() 在 chartKind === 'generated-chords'（221/231 首）时会额外插入：
• 谱面来源徽章（1 行）
• play.singalongNotice 跟唱提示（1 行）
• 原版谱外链（1 行）
HUD 高度从约 60px 膨胀到约 110–140px。
根因 B：HUD 有不透明背景且层级在画布之上
文件：assets/css/gp.css L446-453
// css
.gp-scope .play-hud {
 position: absolute; top: 14px; left: 14px; right: 14px; display: flex;
  justify-content: space-between; align-items: flex-start; pointer-events: none;
}
.gp-scope .hud-box {
 background: rgba(0,0,0,.42); backdrop-filter: blur(4px); border: 1px solid var(--line);
  border-radius: var(--radius-sm); padding: 8px 12px; pointer-events: auto;
}
backdrop-filter: blur(4px) 会把 HUD 下方的画布内容模糊掉，视觉上就是「和弦提示被糊住」。
根因 C：画布绘制未为 HUD 预留安全区
和弦指板提示绘制在 x0 = 22（画布左侧），y0 = H - fbH - 44：
文件：assets/js/gp/play.js L485-491
// javascript
const fbW = Math.min(340, W * 0.42), fbH = 6 + nStr * 13;
const x0 = 22, y0 = H - fbH - 44;
...
c.fillText((now ? T("play.now") : T("play.next")) + describeMidiSet(cur.midi) + ..., x0, y0 - 8);
画布高度 H 较小时（移动端横屏/矮窗口），y0 - 8 会进入 HUD 的 110–140px 范围 → 重叠。
### 3.3 修复方案（按推荐顺序）
方案 1（推荐）：把次要信息移出 HUD
将 chartBadge() 中的「跟唱提示」与「原版谱外链」从 songBox 移到控制栏
（.play-controls）或首次进入的 banner 里，HUD 只保留：
曲名 · 歌手
歌手 · key C · 76 BPM · 谱面来源徽章(单行)
改动点：assets/js/gp/play.js L92-100（songBox 构造）与 L683-700（chartBadge）。
HUD 高度回落到约 60–70px。
方案 2：给 HUD 加尺寸上限 + 折叠
// css
.gp-scope .hud-box {
  max-width: min(46vw, 320px);
  max-height: 84px;
  overflow: auto;          /* 或 overflow: hidden + 点击展开 */
}
方案 3：画布为 HUD 预留顶部安全区
在 render() 的音符出生点计算中加入 HUD 高度偏移，使音符不会在 HUD 覆盖区内可见：
// javascript
const HUD_SAFE_TOP = 96;   // px，随 HUD 实际高度调整
// 音符 y 坐标计算时减去安全区，或在 canvas 顶部绘制透明占位
方案 4：降低 HUD 遮挡强度（辅助）
// css
.gp-scope .hud-box {
  background: rgba(0,0,0,.28);       /* .42 → .28 */
  backdrop-filter: blur(2px);        /* 4px → 2px */
}
### 3.4 验收标准
• 桌面（1440×900）与移动（390×844 竖屏 + 844×390 横屏）三种视口下，
  画布上所有音符块及其和弦名标签不被 HUD 遮挡；
• Now: / Next: 指板提示完整可见；
• HUD 高度 ≤ 90px（方案 1 或 2 生效后）。
## 4. BUG-19（P1）歌词上方「蒙版」、歌词模糊
### 4.1 现象
歌词行（.lyric-line）看起来发虚、像被一层半透明膜盖住；当前正在唱的那个词最明显。
### 4.2 根因（三重叠加）
根因 A：底部渐变遮罩压住歌词，且 DOM 顺序在后
文件：assets/js/gp/play.js L116
// javascript
overlay.append(hud, killfeed, lyric, el("div.play-bottom-fade"), banner);
//                                 ↑ 歌词在前        ↑ 遮罩在后 → 遮罩盖住歌词
文件：assets/css/gp.css L491-497
// css
.gp-scope .play-bottom-fade {
 position:absolute; left:0; right:0; bottom:0; height:90px; pointer-events:none;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.25));
}
.gp-scope .lyric-line {
 position:absolute; left:0; right:0; bottom:18px; text-align:center; font-size:22px;
  font-weight:700; text-shadow: 0 2px 10px rgba(0,0,0,.8); pointer-events:none; --kw-future: var(--muted);
}
• 遮罩高 90px，从 bottom:0 向上覆盖 0–90px；
• 歌词在 bottom:18px，完全落在遮罩区域内；
• 两者都是 position:absolute 且**都没有 z-index** → 按 DOM 顺序，遮罩（后）压在歌词（前）之上。
这就是用户看到的「歌词上方有一个蒙版」。
**根因 B：text-shadow 模糊半径过大**
text-shadow: 0 2px 10px rgba(0,0,0,.8) —— 10px 模糊半径配 22px 字号，
文字边缘被大幅柔化，本身就发虚。叠加 A 的暗色遮罩后，视觉上就是「糊」。
**根因 C：background-clip: text 与 text-shadow 冲突**
文件：assets/css/gp.css L505-507
// css
.gp-scope .lyric-line .kw.cur {
 -webkit-background-clip: text; background-clip: text; color: transparent;
}
配合 assets/js/gp/karaoke-render.js L21 的内联渐变：
// javascript
`<span class="kw cur" style="background:linear-gradient(90deg,var(--accent) ${p}%,var(--kw-future) ${p}%)">`
当 color: transparent + background-clip: text 时，text-shadow 仍按字形轮廓绘制黑色阴影，
但文字填充是渐变背景 → 阴影与填充错位，当前词呈现「重影/发糊」。
同样的问题也存在于 .kara-cur（assets/css/gp.css L555-556，卡拉OK 视图）。
### 4.3 修复方案
Step 1：修正层级（消除「蒙版」感）
// css
/* assets/css/gp.css */
.gp-scope .play-bottom-fade { z-index: 1; }
.gp-scope .lyric-line       { z-index: 2; }
.gp-scope .banner           { z-index: 3; }   /* 结算面板始终最上层 */
或更彻底：把 play-bottom-fade 在 DOM 中的位置移到 lyric 之前（play.js L116 调整 append 顺序）。
Step 2：减小阴影模糊，改用 1px 描边提升可读性
// css
.gp-scope .lyric-line {
  text-shadow:
    0 1px 2px rgba(0,0,0,.85),      /* 10px → 2px */
    0 0 1px rgba(0,0,0,.9);         /* 极细描边保底可读 */
}
**Step 3：background-clip:text 状态下禁用 text-shadow，改用 drop-shadow**
// css
.gp-scope .lyric-line .kw.cur,
.gp-scope .kara-cur .kw.cur {
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: none;                              /* 关键：避免与 clip-text 冲突 */
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.8));  /* 用滤镜替代阴影 */
}
filter: drop-shadow 作用于渲染后的像素（含渐变填充），不会产生错位重影。
Step 4（可选，进一步提质）：给歌词加半透明底板
// css
.gp-scope .lyric-line {
  padding: 6px 12px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.35));
  border-radius: 10px;
}
### 4.4 验收标准
• 歌词任何状态下（未唱/已唱/当前词）均清晰锐利，无重影、无发虚；
• 当前词（.kw.cur）的渐变填充从左到右推进可见，且不与阴影错位；
• 歌词不被 play-bottom-fade 压暗（可通过计算样式 z-index 断言，或用截图对比）；
• 卡拉OK 视图（.kara-cur）同步修复，表现一致。
## 5. 谱面精确性专项（用户要求「加强谱子精确性」）
### 5.1 现状量化
// bash
node tools/diagnose-songbook.mjs
# BUG-01: 真实谱 10/231（4.3%），占位显式标记 221/221
真实谱的 10 首名单：
gp-song-007 理想三旬、011 简单爱、013 甜甜的、019 我会等、088 娃娃脸、
109 断桥残雪、118 有何不可、175 修炼爱情、182 天龙八部之宿敌、230 花海
### 5.2 关键发现：19 首高质量 OMR 数据被 `loopRatio` 误杀
文件：assets/js/gp/catalog.js L27-33
// javascript
const OMR_MIN_NOTES = 24;          // 最少音符数
const OMR_MIN_DENSITY = 1.2;       // 最少密度（音符/小节）
const OMR_MIN_PITCH_KINDS = 4;     // 最少音高种类
const OMR_LOOP_RATIO_MIN = 0.9;    // 循环比下限
const OMR_LOOP_RATIO_MAX = 1.1;    // 循环比上限
usable = notes >= 24 && density >= 1.2 && pitchKinds >= 4 && loopOk
实测 56 首带 OMR 数据的曲目降级归因：
进一步交叉分析：
被误杀的 19 首中，包含大量高质量数据：
gp-song-014 稻香        299 音符  loop=0.61
gp-song-015 夜曲        290 音符  loop=0.77
gp-song-018 你的酒馆对我打了烊  311 音符  loop=0.73
gp-song-035 Way Back Home    305 音符  loop=0.70
gp-song-199 (371 音符)  loop=0.59
gp-song-140 (306 音符)  loop=0.80
gp-song-001 送别         60 音符  loop=3.47
gp-song-093 (41 音符)   loop=9.53
...
loopRatio 分布：<0.9（片段比整曲长）15 首，0.9~1.1（整曲）13 首，>1.1（片段比整曲短）28 首。
### 5.3 根因链：BPM 是假的 → loopRatio 算错 → 高质量谱面被误降级
loopRatio 的计算依赖单遍时长：
// javascript
const spb = 60 / (def.bpm || 80);     // ← 依赖 bpm
passSec = omr.span * spb;
loops = isFullSong ? 1 : Math.max(1, Math.ceil(want / passSec));
而 BPM 仍按难度档硬编码（BUG-08 未解）：76 / 88 / 96 三个值，与 tier 分布一一对应。
→ 单遍时长估算失真 → loopRatio 判定失真 → 本可用的谱面被判为不可用。
这是一条完整的因果链，也是「谱子不精确」的结构性原因。
### 5.4 提升方案（按收益/成本排序）
#### 方案 A（低成本、立即可做）：放宽 `loopRatio` 门禁 → 真实谱 10 → 29 首
当前 [0.9, 1.1] 要求「OMR 片段必须几乎正好等于整曲时长」，过于苛刻。
建议改为分级策略，而不是一刀切降级：
// javascript
// assets/js/gp/catalog.js
const OMR_LOOP_RATIO_MIN = 0.55;   // 允许片段比整曲长（截断使用）
const OMR_LOOP_RATIO_MAX = 4.0;    // 允许短片段循环 4 遍以内
并在 expandOmr() 中：
• loopRatio < 1（片段过长）→ 截断到 want，正常使用；
• loopRatio > 1（片段过短）→ 循环填充，并在谱面元数据上标记 looped: true；
• 仅当 loopRatio > 4（同一小段重复 4 次以上）才降级为 generated-chords。
预期收益：真实谱 10 → 29 首（4.3% → 12.6%），且被恢复的包含稻香、夜曲、你的酒馆对我打了烊等 299–371 音符的高质量数据。
#### 方案 B（中成本）：用 OMR 数据反推真实 BPM
既然 omr.span 是「整曲总拍数」，且 def.durationSec 是真实时长，则：
// javascript
bpm_real ≈ omr.span / (durationSec / 60)
对 13 首 loopRatio ∈ [0.9,1.1] 的曲目，该公式反推的 BPM 已经可信（因为 loopRatio≈1 说明 span * 60/bpm ≈ durationSec）。
对其它曲目可作为BPM 校验值，与硬编码值比对，偏差 > 15% 的标记为可疑。
预期收益：修复 BUG-08 的一部分（数据依赖），并让 loopRatio 计算回归正确。
#### 方案 C（高成本、治本）：补全 202 首缺失的 OMR 数据
231 首中 202 首完全没有 OMR 数据，只能走模板和弦。这部分无法离线解决，需回源真实曲谱。
建议流程：
1. 优先补 tier 1（159 首，入门曲目，用户使用率最高）；
2. 每补一首，跑 node tools/diagnose-songbook.mjs 确认 chartKind 变为 omr；
3. 同步更新 GP_PROVENANCE 的统计与来源说明。
#### 方案 D（体验层）：占位谱的「可预期性」优化
对 generated-chords 的 221 首：
• 曲库卡片上已用角标提示（✅ 已做）；
• 建议再增加筛选器：「只看有真实谱面的曲目（29 首）」，让用户能快速找到可真实演奏的曲目；
• 演奏页的 play.singalongNotice 已提示，建议再加一个「为什么」的说明入口。
### 5.5 收益汇总
## 6. 全量测试结果与覆盖盲区
### 6.1 当前测试基线
// bash
npm test
# tests 301 / pass 300 / fail 0 / skipped 1 / duration 202s
新增本轮回归门禁后：
// bash
npm test
# tests 303 / pass 300 / fail 2 / skipped 1
# 2 个 fail 即 test/songplay-reentry.test.js 的 RE-1、RE-2（BUG-17 未修）
### 6.2 为什么 301 个测试没抓到 BUG-17
### 6.3 建议补充的测试
**已在 test/songplay-reentry.test.js 提供**（RE-1、RE-2）。
建议再补（CSS 契约测试，无需浏览器）：
// javascript
// test/gp-css-contract.test.js
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'assets/css/gp.css'), 'utf8');

test('CSS-1 歌词层级必须高于底部渐变遮罩', () => {
  assert.match(css, /\.lyric-line\s*\{[^}]*z-index:\s*2/, 'lyric-line 需 z-index:2');
  assert.match(css, /\.play-bottom-fade\s*\{[^}]*z-index:\s*1/, 'play-bottom-fade 需 z-index:1');
});

test('CSS-2 歌词阴影模糊半径不得大于 4px', () => {
  const m = /\.lyric-line\s*\{[^}]*text-shadow:\s*0\s+(\d+)px\s+(\d+)px/.exec(css);
  if (m) assert.ok(Number(m[2]) <= 4, `阴影模糊半径 ${m[2]}px 过大，会导致文字发虚`);
});

test('CSS-3 clip-text 当前词必须禁用 text-shadow', () => {
  const m = /\.kw\.cur\s*\{[^}]*\}/.exec(css);
  assert.ok(m, '应存在 .kw.cur 规则');
  assert.match(m[0], /text-shadow:\s*none/, '.kw.cur 必须 text-shadow:none，否则与 background-clip 冲突');
});
## 7. 修复优先级与工作量估计
## 8. 附录：本轮新增/使用的验证资产
### 复现命令速查
// bash
# 全量测试
npm test

# 缺陷诊断
node tools/diagnose-songbook.mjs

# BUG-17 回归门禁（当前应为红）
node --test test/songplay-reentry.test.js

# 谱面覆盖率与门禁归因
node -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {GP_OMR_NOTES}=await import('./assets/js/gp/omr-notes.js');
const {omrQuality}=await import('./assets/js/gp/catalog.js');
const byId=Object.fromEntries(GP_CHORD_SONGS.map(d=>[d.id,d]));
let base=0,all=0;
for(const g of Object.keys(GP_OMR_NOTES)){const d=byId[g];if(!d)continue;const q=omrQuality(GP_OMR_NOTES[g],d);
 if(q.notes>=24&&q.density>=1.2&&q.pitchKinds>=4)base++;
 if(q.usable)all++;}
console.log('三项达标(不含loop)=',base,' 当前可用=',all);
" --input-type=module
本内容由 Coze AI 生成，请遵循相关法律法规及《人工智能生成合成内容标识办法》使用与传播。

## 表格（10 个）

### 表 0

| 项 | 值 |
|---|---|
| 项目 | guitar-studio（六弦工坊） |
| 被测版本 | V4.2.2（commit 75ebdeb） |
| 上一轮基线 | V3.0.1（commit 06f5639） |
| 全量测试 | npm test |
| 全量测试结果 | 301 tests / 300 pass / 0 fail / 1 skipped（耗时 202s） |
| 缺陷诊断脚本 | node tools/diagnose-songbook.mjs |
| 诊断结果 | 9 PASS / 0 FAIL / 2 数据依赖（退出码 0） |
| 新增回归测试 | test/songplay-reentry.test.js（2 项，当前故意为红，见 §2） |

### 表 1

| 上轮 ID | 状态 | 说明 |
|---|---|---|
| BUG-01 谱面覆盖率 | ✅ 已修 | 改为「诚实降级」：真实谱 10 首，221 首标记 chartKind='generated-chords' 并在曲库角标/演奏徽章/跟唱提示三处明示 |
| BUG-02 模板和弦 | ✅ 已修 | 同上，占位谱不再伪装真实谱 |
| BUG-03 演奏视图 i18n | ✅ 已修 | components.js/play.js/song-play.js/songbook.js 已接入 |
| BUG-04 语言切换 | ✅ 已修 | 宿主壳监听 gs:lang 并重建视图 |
| BUG-05 兜底页英文 | ✅ 已修 | 改 textContent + i18n 键 |
| BUG-06 中文硬编码 | ✅ 已修 | 改走 songbook.tier.* / songbook.source.* |
| BUG-07 统计口径 | ✅ 已修 | 写入端统一 songbook，读取端兼容 songplay |
| BUG-08 BPM 硬编码 | ⚠️ 数据依赖 | 仍为 76/88/96，但已通过 chartKind 显式降级不再伪装 |
| BUG-09 片段循环 | ✅ 已修 | tempo 不再压缩；44 首经 omrQuality 门禁降级 |
| BUG-11 歌词截断 | ✅ 已修 | 时长口径改为 max(谱面末音, 歌词末行) |
| BUG-14 同名曲 | ✅ 已修 | 展示层「曲名 · 歌手」消歧 |
| BUG-15 缺歌词 | ⚠️ 数据依赖 | gp-song-227 仍缺 |

### 表 2

| ID | 级别 | 用户可见现象 | 根因文件 |
|---|---|---|---|
| BUG-17 | P0 | 反复进入演奏界面会叠加多个画面（进 3 次 → 3 个画面） | assets/js/gp/play.js:669-674、assets/js/modules/song-play.js:58-89 |
| BUG-18 | P1 | 左侧曲名/调号 HUD 遮挡画布上的和弦提示 | assets/js/gp/play.js:92-100、assets/css/gp.css:446-453 |
| BUG-19 | P1 | 歌词上方有「蒙版」，歌词发虚模糊 | assets/css/gp.css:491-507、assets/js/gp/play.js:116 |
| BUG-20 | P2 | 真实谱面仅 10/231，精确性不足（用户明确要求加强） | assets/js/gp/catalog.js:20-33,44-68 |
| BUG-21 | P2 | loopRatio 门禁误杀 19 首高质量 OMR 数据 | assets/js/gp/catalog.js:27-33 |

### 表 3

| 谱面类型 | 数量 | 占比 | 说明 |
|---|---|---|---|
| 真实 OMR 谱面 | 10 | 4.3% | 可用作真实演奏判定 |
| 自动生成简易伴奏（generated-chords） | 221 | 95.7% | 模板和弦，已诚实标注 |

### 表 4

| 降级原因 | 数量 |
|---|---|
| loopRatio 不达标 | 43 |
| density 不达标 | 8 |
| pitchKinds 不达标 | 1 |
| notes 不达标 | 0 |

### 表 5

| 指标 | 数量 |
|---|---|
| 音符/密度/音高三项全部达标 | 29 首 |
| 三项达标 且 loop 也达标（当前可用） | 10 首 |
| 仅因 loop 门禁被降级 | 19 首 |

### 表 6

| 措施 | 真实谱数量 | 占比 | 工作量 |
|---|---|---|---|
| 当前（V4.2.2） | 10 | 4.3% | — |
| + 方案 A（放宽 loop 门禁） | 29 | 12.6% | 小（改 2 个常量 + expandOmr 分支） |
| + 方案 B（反推 BPM） | 29（质量提升） | 12.6% | 中 |
| + 方案 C（补数据） | 最多 231 | 100% | 大（数据依赖） |

### 表 7

| 盲区 | 说明 |
|---|---|
| 只测单次挂载 | test/gp-play.test.js 的 GP-4 只验证「挂载一次 → 有内容 → teardown 不抛错」，不验证 teardown 后 DOM 是否清空，更不验证「重复挂载」。 |
| 不测 DOM 数量 | 没有任何断言检查 root.children.length。 |
| 不测 HUD 布局 | 无头 DOM shim 没有真实布局引擎，CSS 遮挡类问题天然测不到（需浏览器/截图测试）。 |
| 不测歌词可读性 | 同上，属视觉属性。 |

### 表 8

| 顺序 | ID | 级别 | 改动量 | 影响 |
|---|---|---|---|---|
| 1 | BUG-17 | P0 | play.js 3 行 + song-play.js 约 15 行 | 消除重复画面 + 修复资源泄漏 |
| 2 | BUG-19 | P1 | gp.css 约 10 行 | 歌词可读性，用户感知强 |
| 3 | BUG-18 | P1 | play.js HUD 结构约 20 行 / gp.css 5 行 | 和弦提示可见性 |
| 4 | BUG-21 + BUG-20 方案 A | P2 | catalog.js 2 个常量 + expandOmr 分支约 20 行 | 真实谱 10 → 29 首 |
| 5 | BUG-20 方案 B | P2 | 新增 BPM 反推逻辑约 30 行 | 提升 loopRatio 判定准确性 |
| 6 | BUG-20 方案 D | P3 | 曲库筛选器约 40 行 | 体验优化 |
| 7 | 补 gp-css-contract.test.js | P3 | 新增 1 个测试文件 | 防 CSS 回归 |

### 表 9

| 文件 | 说明 |
|---|---|
| test/songplay-reentry.test.js | 本轮新增。BUG-17 的回归门禁（RE-1 / RE-2），当前为红 |
| tools/diagnose-songbook.mjs | 上一轮交付，你已提交；当前 9 PASS / 2 数据依赖 |
| npm test | 全量测试，301 项（新增测试后 303 项） |
