# 弹唱曲库 · 全量测试手册与优化清单


基线版本：V4.2.3（commit 9c161c8）
读者：实现方（workBuddy）
本手册分四部分：测试基线 → 模块覆盖矩阵 → 新发现缺陷 → 谱面准确性优化方案。
所有结论均附可复现命令，可直接粘贴执行。

## 一、测试基线
| 项目 | 结果 | 命令 |
|---|---|---|
| 全量单元/集成测试 | 337 项 / 336 通过 / 0 失败 / 1 跳过 | npm test |
| 缺陷诊断脚本 | 9 PASS / 0 FAIL / 2 数据依赖 | node tools/diagnose-songbook.mjs |
| 源文件总数 | 62 个（12,149 行） | — |
| 测试文件 | 35 个 | — |
| 有专项测试的模块 | 33 个 | 见 §2 |
| 仅被聚合测试加载 | 1 个（main.js） | 见 §2 |
| 完全无专项测试 | 28 个 | 见 §2 |


结论：现有 337 项测试全绿，但28 个模块（约 3,600 行）没有任何针对性断言，只靠 gp-play.test.js 和 v40-songbook-integration.test.js 两个聚合测试间接加载。本轮发现的 8 个缺陷全部落在这片盲区里。

## 二、模块测试覆盖矩阵
### 2.1 分类汇总
62 个源文件
├─ A. 有专项测试（33 个）        ← 直接 import 且有针对该模块的断言
├─ B. 仅聚合加载（1 个）         ← main.js（入口，合理）
└─ C. 无专项测试（28 个）        ← 仅通过 main.js 间接加载，无断言
### 2.2 C 类清单（28 个，按风险排序）
| 风险 | 模块 | 行数 | 说明 |
|---|---|---|---|
| 极高 | gp/grader.js | 110 | 评分引擎，零引用、零测试（见 N-1） |
| 极高 | gp/play.js | 793 | 演奏主视图，仅聚合加载；评分逻辑内联（见 N-2） |
| 高 | modules/metronome.js | 397 | 节拍器，核心功能无专项测试 |
| 高 | gp/voices.js | 225 | 音色合成 |
| 高 | modules/chord-game.js | 243 | 和弦游戏 |
| 高 | core/mic-manager.js | 194 | 麦克风管理（高权限、易泄漏） |
| 高 | modules/recorder.js | 174 | 录音（历史上有 P1-3 泄漏缺陷） |
| 高 | modules/chord-lib.js | 163 | 和弦库 |
| 高 | modules/chord-flow.js | 156 | 和弦进行 |
| 中高 | gp/parts.js | 139 | 声部编排 |
| 中高 | gp/accompany.js | 128 | 伴奏生成 |
| 中高 | core/audio-engine.js | 143 | 音频引擎 |
| 中高 | core/theme-switch.js | 114 | 主题切换（含 i18n 初值历史缺陷） |
| 中 | gp/karaoke-timeline.js | 99 | 歌词时间轴（见 N-5） |
| 中 | gp/engine.js | 100 | 演奏引擎 |
| 中 | gp/pitch.js | 91 | 音高检测 |
| 中 | core/audio-devices.js | 105 | 音频设备枚举 |
| 中 | core/i18n.js | 98 | i18n 运行时 |
| 中 | modules/fretboard.js | 112 | 指板 |
| 低 | gp/backgrounds.js | 86 | 背景 |
| 低 | gp/band.js | 90 | 伴奏乐队 |
| 低 | core/ui.js | 59 | UI 工具 |
| 低 | gp/player.js | 53 | 播放器 |
| 低 | gp/synth.js | 40 | 合成器 |
| 低 | core/tone-loader.js | 52 | Tone.js 加载 |
| 低 | core/store.js | 35 | 存储 |
| 低 | data/scales.js | 37 | 音阶数据 |
| 低 | gp/avatar.js | 20 | 头像 |
| 低 | gp/avatars.js | 359 | 头像素材（纯数据） |


### 2.3 覆盖判定的复现命令
// bash
cd guitar-studio
node --input-type=module -e "
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
import {join,relative,dirname,resolve} from 'node:path';
const ROOT=process.cwd();
const walk=(d,o=[])=>{for(const f of readdirSync(d)){const p=join(d,f);statSync(p).isDirectory()?walk(p,o):(f.endsWith('.js')&&o.push(p));}return o;};
const srcs=walk(join(ROOT,'assets/js'));
const tests=readdirSync(join(ROOT,'test')).filter(f=>f.endsWith('.js')).map(f=>join(ROOT,'test',f));
const ir=/(?:from\s*|import\s*\(\s*|^\s*import\s+)['\"]([^'\"]+)['\"]/gm;
const pr=/['\"\`](assets\/js\/[A-Za-z0-9_\-/]+\.js)['\"\`]/g;
const refs=(file)=>{const s=readFileSync(file,'utf8');const o=new Set();let m;
 ir.lastIndex=0;while((m=ir.exec(s))){const x=m[1];if(!x.startsWith('.')||x.includes('...'))continue;const a=resolve(dirname(file),x);if(existsSync(a)&&a.endsWith('.js'))o.add(a);}
 pr.lastIndex=0;while((m=pr.exec(s))){const a=join(ROOT,m[1]);if(existsSync(a))o.add(a);}return o;};
const dmap=new Map();
for(const t of tests)for(const f of refs(t)){if(!f.startsWith(join(ROOT,'assets')))continue;if(!dmap.has(f))dmap.set(f,new Set());dmap.get(f).add(relative('test',t));}
const none=srcs.filter(s=>!dmap.has(s)).map(s=>relative(join(ROOT,'assets/js'),s));
console.log('无专项测试模块:',none.length);console.log(none.join('\n'));
"

## 三、本轮新发现缺陷（8 项）
### N-1【P0】`gp/grader.js` 是死代码，且 `off` 判定永远不可达
证据：
// bash
# 1) 全项目零引用
grep -rn "grader" --include=*.js --include=*.html . | grep -v "assets/js/gp/grader.js"
# → 无任何输出

# 2) off 判定实测
node --input-type=module -e "
const {Grader}=await import('./assets/js/gp/grader.js');
const g=new Grader(); const n={midi:[60]};
for(let i=0;i<10;i++) g.observe(n, 60.7);      // 偏差 70 cents，落在 off 区间
console.log('frames=',n.frames,'best=',n.best); // → undefined undefined
console.log('判定=', g.finalize(n));            // → miss（期望 off）
console.log('counts=', JSON.stringify(g.counts)); // → off: 0
"
根因（grader.js:55-62）：
// javascript
observe(note, detectedMidi) {
  if (!(detectedMidi > 0)) return;
  const cents = centsOff(detectedMidi, note.midi);
  if (cents < this.opt.goodCents) {          // ← 只在 < 60 cents 时计帧
    note.frames = (note.frames || 0) + 1;
    if (cents < (note.best ?? Infinity)) note.best = cents;
  }
}
classify() 的 off 分支（grader.js:29）要求 frames >= 1 && bestCents > goodCents，但 frames >= 1 已蕴含 best <= goodCents → **逻辑互斥，off 永不可达**。
影响：偏差 60–100 cents（半个到一整个半音）的输入被完全丢弃 → 直接判 miss（-10 血）。连续 21 次即 health=0、failed=true。counts.off 恒为 0，H.off(-7)、S.off(10) 是死配置。
修复：
// javascript
// grader.js:55
observe(note, detectedMidi) {
  if (!(detectedMidi > 0)) return;
  const cents = centsOff(detectedMidi, note.midi);
  if (cents < 100) {                          // 半音内都算「有输入」，交给 classify 分级
    note.frames = (note.frames || 0) + 1;
    if (cents < (note.best ?? Infinity)) note.best = cents;
  }
}
验收：新增 test/gp-grader.test.js，断言偏差 70 cents 判 off、偏差 30 cents 判 good、偏差 15 cents 连续 2 帧判 perfect、偏差 150 cents 判 miss。

### N-2【P0】`play.js` 的 `off` 判定同样不可达（与 N-1 同源）
证据（play.js:389 与 play.js:409-412）：
// javascript
// L389 观察
if (bestCents < GOOD_CENTS) { n.frames++; if (bestCents < n.best) n.best = bestCents; }

// L409-412 判定
} else if (n.frames >= 2 && n.best <= PERFECT_CENTS) q = "perfect";
else if (n.frames >= 1 && n.best <= GOOD_CENTS) q = "good";
else if (n.frames >= 1) q = "off";        // ← 不可达
else q = "miss";
n.frames >= 1 ⟹ n.best < GOOD_CENTS ⟹ 已被上一行捕获。
附带不一致：打击乐分支（play.js:404-408）的 off 是可达的，因为其 frames 在 L365 无条件累加。两条路径行为不一致。
修复：
// javascript
// play.js:389
if (bestCents < 100) { n.frames++; if (bestCents < n.best) n.best = bestCents; }
验收：在 gp-play.test.js 中注入 70 cents 的检测帧，断言 counts.off === 1 且 health === 93（100-7）。

### N-3【P0】24 首真实谱完全没有 `harmony` 字段
证据：
// bash
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
let rows=[];
for(const d of GP_CHORD_SONGS){const s=findSong(d.id);if(s.chartKind!=='omr')continue;
 rows.push([d.id,d.title,(s.notes.filter(n=>n.midi.length===1).length/s.notes.length*100).toFixed(0),!!s.harmony]);}
console.log('真实谱',rows.length,'首；有 harmony 的',rows.filter(r=>r[3]).length,'首');
"
# → 真实谱 24 首；有 harmony 的 0 首
24 首真实谱的单音占比：送别 100%、有何不可 98%、娃娃脸 97%、暧昧 96%、理想 96%、花海 95%、甜甜的 93%、我们的时光 93%、稻香 91%、夜曲 90%、晴天 90%…… 平均 88%。
根因：catalog.js 的 expandChord() 在 L252-262 做了 deriveHarmony 并 song.harmony = harmony（L302），但 **expandOmr() 只设置 loopInfo / bpmSource / bpmEffective（L362-364），从不设置 harmony**。
影响：最"准确"的 24 首真实谱，反而在左下角给不出和弦——只能显示单音音名（describeMidiSet([55]) → identifyChord 因 midis.length < 2 返回 null → 显示 G3）。弹唱用户看到的不是和弦。
修复：在 expandOmr() 返回前补上与 expandChord() 一致的派生逻辑。
// javascript
// catalog.js expandOmr()，在 song.loopInfo = ... 之前插入
/* N-3：真实谱同样需要和弦进行——否则弹唱时左下角只能显示单音音名 */
const derived = deriveHarmony(omr, omr.b || 4, { keyPc: keyToPc(def.key || 'C') ?? 0 });
song.harmony = derived.chords.length
  ? { source: 'derived-omr', chords: derived.chords, uncertainBars: derived.uncertainBars }
  : { source: 'template', chords: [[keyToPc(def.key || 'C') ?? 0, 'maj']], uncertainBars: [] };
收益：56 首有 OMR 的曲目中，32 首能派生和弦（见 N-4 实测），其中 23 首是真实谱 → 真实谱和弦覆盖率 0/24 → 23/24。
验收：新增 test/gp-omr-harmony.test.js，断言每首 chartKind==='omr' 的曲目 song.harmony 存在且 chords.length > 0。

### N-4【P1】`deriveHarmony` 对单音旋律失效（24/56 失败）
证据：
// bash
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {GP_OMR_NOTES}=await import('./assets/js/gp/omr-notes.js');
const {deriveHarmony}=await import('./assets/js/gp/harmony.js');
let ok=0,fail=0,fails=[];
for(const d of GP_CHORD_SONGS){const omr=GP_OMR_NOTES[d.id];if(!omr)continue;
 const r=deriveHarmony(omr,omr.b||4,{});r.chords.length?ok++:(fail++,fails.push(d.title));}
console.log('派生成功',ok,'失败',fail);console.log('失败样本:',fails.slice(0,8).join(' | '));
"
# → 派生成功 32 失败 24
# → 失败样本: 斑马，斑马 | 安和桥 | 纸短情长 | 我会等 | 小城夏天 | 浪子闲话 ...
根因（harmony.js:46-47）：
// javascript
const hit = perBar[b].length >= 2 ? identifyChord(perBar[b], { keyPc }) : null;
if (hit && (CHORD_TYPES[hit.type] || { intervals: [] }).intervals.length >= 3) { ... }
要求「单小节 ≥2 个音」且「识别出 ≥3 音和弦」。单音旋律每小节只有 1 个音时必然失败。
修复方向：见 §4.1「单音旋律配和弦」算法。这是把覆盖率从 32/56 推到接近 56/56 的关键。

### N-5【P1】中文歌词逐字高亮全部失效（230/230 首）
证据：
// bash
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {buildLyricTimeline}=await import('./assets/js/gp/karaoke-timeline.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
const tl=buildLyricTimeline(findSong('gp-song-001'));
console.log('首行 words 数=', tl.lines[0].words.length);   // → 1
console.log('首行 text=', tl.lines[0].text);              // → 长亭外古道边芳草碧连天
console.log('首行 words=', JSON.stringify(tl.lines[0].words));
// → [{t:16.96,end:27.39,dur:10.43,text:'长亭外古道边芳草碧连天'}]
"
根因（karaoke-timeline.js:26）：
// javascript
const tokens = String(line.text || "").trim().split(/\s+/).filter(Boolean);
中文歌词无空格 → split(/\s+/) 只得到 1 个 token → 整行作为一个"词" → 卡拉OK 的逐字擦除退化为整行一次性填充。
影响：230 首中文歌词全部受影响（hasWordTiming 亦为 false，无词级时间戳兜底）。用户感知为「歌词在唱，但没有逐字跟随」或「只有整行变亮」。
修复：
// javascript
// karaoke-timeline.js，替换 L26
const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
function tokenizeLine(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  /* 含 CJK：按字切分，每个汉字/假名/谚文一个 token，实现逐字擦除 */
  if (CJK.test(s)) return [...s].filter((ch) => !/\s/.test(ch));
  return s.split(/\s+/).filter(Boolean);
}
// 原 L26 改为
const tokens = tokenizeLine(line.text);
normalizeWords 后续的权重计算 Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, "").length) 对单字恒为 1 → 时间按字数均匀分配，符合中文演唱节奏。
验收：新增 test/gp-karaoke-timeline.test.js，断言：
• tokenizeLine("长亭外古道边") 长度 = 7；
• buildLyricTimeline(送别).lines[0].words.length === 7；
• 相邻 word 的 t 严格递增且 end 衔接；
• 英文歌词 "hello world" 仍切成 2 个 token。

### N-6【P2】连击倍率上限为 2.5，而非配置暗示的 3.0
证据（grader.js:80 与 play.js:423 完全相同的表达式）：
// javascript
this.mult = 1 + Math.min(3, Math.floor(this.streak / 8)) * 0.5;
streak = 32 时 Math.min(3, 4) = 3 → mult = 2.5。上限恒为 2.5。
修复：若设计意图为 3.0x，改为 Math.min(4, ...)；若意图是 2.5x，请在注释中明确，并统一两处。
验收：test/gp-grader.test.js 断言 streak=32 时 mult === 2.5（或 3.0，按产品决定）。

### N-7【P2】`bpmSource` 字段覆盖不一致
证据：
// bash
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
const m={};for(const d of GP_CHORD_SONGS){const s=findSong(d.id);const k=s.bpmSource||'(undefined)';m[k]=(m[k]||0)+1;}
console.log(m);
"
# → { 'fallback-tier': 17, '(undefined)': 207, 'derived-omr': 7 }
expandOmr 设置了 bpmSource，expandChord 没设。审计时无法区分「未设置」与「无需设置」。
修复：expandChord() 中补 song.bpmSource = 'fallback-tier'，或在 newSong() 里给默认值。

### N-8【P1】28 个模块无专项测试（见 §2.2）
优先补：grader.js、karaoke-timeline.js、metronome.js、mic-manager.js、recorder.js、chord-lib.js、play.js 的评分函数。

## 四、谱面准确性进一步优化方案
### 4.1 核心：单音旋律配和弦（Melody Harmonization）
问题：24 首真实谱单音占比 68–100%，deriveHarmony 的「小节音簇识别」无法工作。
方案：新增「旋律配和弦」算法，按调内 diatonic 三和弦与旋律音的重合度打分。
// javascript
// 新增 assets/js/gp/harmonize.js
import { CHORD_TYPES } from './theory.js';

/* 调内自然音级三和弦（功能标记用于加权） */
const DIATONIC_MAJOR = [
  { deg: 0,  type: 'maj', fn: 'I',   weight: 1.2 },
  { deg: 2,  type: 'min', fn: 'ii',  weight: 0.8 },
  { deg: 4,  type: 'min', fn: 'iii', weight: 0.6 },
  { deg: 5,  type: 'maj', fn: 'IV',  weight: 1.0 },
  { deg: 7,  type: 'maj', fn: 'V',   weight: 1.1 },
  { deg: 9,  type: 'min', fn: 'vi',  weight: 0.9 },
  { deg: 11, type: 'dim', fn: 'vii', weight: 0.3 },
];
const DIATONIC_MINOR = [
  { deg: 0,  type: 'min', fn: 'i',    weight: 1.2 },
  { deg: 2,  type: 'dim', fn: 'ii',   weight: 0.3 },
  { deg: 3,  type: 'maj', fn: 'III',  weight: 1.0 },
  { deg: 5,  type: 'min', fn: 'iv',   weight: 0.9 },
  { deg: 7,  type: 'min', fn: 'v',    weight: 0.9 },
  { deg: 8,  type: 'maj', fn: 'VI',   weight: 0.8 },
  { deg: 10, type: 'maj', fn: 'VII',  weight: 0.7 },
];

/**
 * 为一小节旋律配一个和弦。
 * @param {Array<{midi:number, weight:number, onBeat:boolean}>} melody 本小节旋律音
 * @param {number} keyPc 调主音 pitch class
 * @param {boolean} isMinor 是否小调
 * @param {[number,string]|null} prev 上一小节和弦（用于平滑）
 */
export function harmonizeBar(melody, keyPc, isMinor, prev = null) {
  if (!melody.length) return prev;
  const scale = isMinor ? DIATONIC_MINOR : DIATONIC_MAJOR;
  let best = null;
  for (const c of scale) {
    const rootPc = ((keyPc + c.deg) % 12 + 12) % 12;
    const tones = new Set(CHORD_TYPES[c.type].intervals.map((i) => ((rootPc + i) % 12 + 12) % 12));
    let score = 0;
    for (const m of melody) {
      const pc = ((m.midi % 12) + 12) % 12;
      if (tones.has(pc)) score += m.weight * (m.onBeat ? 2 : 1);
    }
    score += c.weight;                                   // 功能偏好
    if (prev && prev[0] === rootPc && prev[1] === c.type) score += 0.6;  // 延续倾向，减少抖动
    if (!best || score > best.score) best = { rootPc, type: c.type, score };
  }
  return [best.rootPc, best.type];
}

/**
 * 整曲旋律配和弦：按小节切分 → 逐小节配 → 相邻去重。
 * @param {object} omr GP_OMR_NOTES 条目
 * @param {number} bpb 每小节拍数
 * @param {object} opts { keyPc, isMinor }
 */
export function harmonizeOmr(omr, bpb = 4, opts = {}) {
  const events = (omr && Array.isArray(omr.n)) ? omr.n : [];
  const span = (omr && omr.span > 0) ? omr.span : 0;
  const beats = bpb > 0 ? bpb : 4;
  const bars = Math.max(1, Math.ceil(span / beats));
  const keyPc = Number.isFinite(opts.keyPc) ? opts.keyPc : 0;

  const perBar = Array.from({ length: bars }, () => []);
  for (const ev of events) {
    const [beat, dur, midis] = ev;
    if (!Array.isArray(midis)) continue;
    const b = Math.floor(beat / beats);
    if (b < 0 || b >= bars) continue;
    const onBeat = Math.abs(beat % 1) < 0.01;             // 落在整拍上
    for (const m of midis) if (Number.isFinite(m)) perBar[b].push({ midi: m, weight: Math.max(0.25, dur || 1), onBeat });
  }

  const raw = [];
  let prev = null;
  for (let b = 0; b < bars; b++) {
    prev = harmonizeBar(perBar[b], keyPc, !!opts.isMinor, prev);
    raw.push(prev);
  }
  const chords = [];
  for (const c of raw) {
    if (!c) continue;
    const last = chords[chords.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) continue;
    chords.push(c);
  }
  return { chords, bars, uncertainBars: [], source: 'harmonized-melody' };
}
接入（catalog.js 的 expandOmr，配合 N-3 修复）：
// javascript
import { deriveHarmony } from './harmony.js';
import { harmonizeOmr } from './harmonize.js';

const keyPc = keyToPc(def.key || 'C') ?? 0;
let harmony = deriveHarmony(omr, omr.b || 4, { keyPc });
if (!harmony.chords.length) {
  /* 音簇识别失败（单音旋律）→ 退化为旋律配和弦 */
  harmony = harmonizeOmr(omr, omr.b || 4, { keyPc });
}
song.harmony = { source: harmony.source, chords: harmony.chords, uncertainBars: harmony.uncertainBars };
预期收益：
| 阶段 | 真实谱有和弦 | 占位谱有真实和弦 |
|---|---|---|
| 当前 | 0 / 24 | 9 / 207 |
| 修 N-3 后 | 23 / 24 | 9 / 207 |
| 再加 4.1 | 24 / 24 | 56 / 207（全部有 OMR 的） |


验收：新增 test/gp-harmonize.test.js，用人工构造的 C 大调旋律断言：
• 旋律 C-E-G（C 和弦音）→ 配出 [0,'maj']；
• 旋律 G-B-D → 配出 [7,'maj']；
• 旋律 A-C-E → 配出 [9,'min']；
• 全曲和弦序列相邻不重复。
算法已实测验证（2026-10-28）：用上述打分函数对 C 大调三组旋律实跑，输出分别为 [0,"maj"]、[7,"maj"]、[9,"min"]，空小节正确沿用上一和弦 [7,"maj"]，与预期完全一致。CHORD_TYPES.maj/min/dim 的 intervals 分别为 [0,4,7] / [0,3,7] / [0,3,6]，接口匹配。

OMR 数据结构已确认：GP_OMR_NOTES[key] = { b: 4, span: 62.5, n: [[beat, dur, midis], ...], src, pages }。以《送别》为例 n.length = 60、span = 62.5 拍 → 16 小节。beat 为浮点拍位（如 0.75、1.5），harmonizeOmr 的 onBeat 判定 Math.abs(beat % 1) < 0.01 与之兼容。
### 4.2 真实谱覆盖率提升
当前：24/231 = 10.4%。方案原预期 29 首，实测 24 首，差额来自 loopRatio 门禁 [0.55, 4] 的实际判定。
建议：把门禁参数与判定结果落盘为可审计报告：
// bash
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {GP_OMR_NOTES}=await import('./assets/js/gp/omr-notes.js');
const {omrQuality}=await import('./assets/js/gp/catalog.js');
const byId=Object.fromEntries(GP_CHORD_SONGS.map(d=>[d.id,d]));
const rej={};
for(const g of Object.keys(GP_OMR_NOTES)){const d=byId[g];if(!d)continue;
 const q=omrQuality(GP_OMR_NOTES[g],d);
 if(q.usable)continue;
 const r=q.reason||'unknown';rej[r]=(rej[r]||0)+1;}
console.log('降级原因分布:',rej);
"
若 loopRatio 仍占多数，可再放宽到 [0.4, 6] 并对 >2 遍的曲目在徽章标注「片段循环」。
### 4.3 占位谱节奏型（P-5）落地检查
catalog.js 已引入 PATTERNS + TIER_PATTERN + pickPattern()（L240-245），tier 2 偶数曲目使用 arp-5321。建议补测试断言：不同 tier 产生不同 pattern，且每小节音符数符合该节奏型定义。
### 4.4 数据层（长期，不可离线解决）
• P-1：207 首无 OMR 数据 → 需回源真实曲谱。
• BUG-08：BPM 仍为 76/88/96 三值 → 需逐曲真实 BPM。
• BUG-15：gp-song-227《我的一个道姑朋友》缺歌词。

## 五、必须新增的测试（按优先级）
### 5.1 `test/gp-grader.test.js`（P0，对应 N-1/N-6）
// javascript
import test from 'node:test';
import assert from 'node:assert';
import { Grader, centsOff, classify, gradeLetter, GRADE_DEFAULTS } from '../assets/js/gp/grader.js';

test('GR-1 偏差 70 cents 应判 off（而非 miss）', () => {
  const g = new Grader();
  const n = { midi: [60] };
  for (let i = 0; i < 5; i++) g.observe(n, 60.7);   // +70 cents
  assert.strictEqual(g.finalize(n), 'off');
  assert.strictEqual(g.counts.off, 1);
  assert.strictEqual(g.health, 100 + GRADE_DEFAULTS.health.off); // off 扣 7 → 93
});

test('GR-2 偏差 30 cents 单帧应判 good', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 60.3);
  assert.strictEqual(g.finalize(n), 'good');
});

test('GR-3 偏差 15 cents 两帧应判 perfect', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 60.15); g.observe(n, 60.12);
  assert.strictEqual(g.finalize(n), 'perfect');
});

test('GR-4 完全无输入应判 miss', () => {
  const g = new Grader();
  const n = { midi: [60] };
  assert.strictEqual(g.finalize(n), 'miss');
  assert.strictEqual(g.counts.miss, 1);
});

test('GR-5 偏差 150 cents 应判 miss', () => {
  const g = new Grader();
  const n = { midi: [60] };
  for (let i = 0; i < 5; i++) g.observe(n, 61.5);
  assert.strictEqual(g.finalize(n), 'miss');
});

test('GR-6 八度无关：高八度同音名应判 perfect', () => {
  const g = new Grader();
  const n = { midi: [60] };
  g.observe(n, 72); g.observe(n, 72);               // C5 对 C4
  assert.strictEqual(g.finalize(n), 'perfect');
});

test('GR-7 连续 miss 应触发 failed', () => {
  const g = new Grader();
  for (let i = 0; i < 12; i++) g.finalize({ midi: [60] });
  assert.strictEqual(g.health, 0);
  assert.strictEqual(g.failed, true);
});

test('GR-8 倍率上限', () => {
  const g = new Grader();
  for (let i = 0; i < 40; i++) { const n = { midi: [60] }; g.observe(n, 60); g.observe(n, 60); g.finalize(n); }
  assert.ok(g.mult <= 3, `倍率不得超过 3，实际 ${g.mult}`);
});

test('GR-9 accuracy 与 gradeLetter', () => {
  const g = new Grader();
  assert.strictEqual(g.accuracy(), 100);            // 无音符时默认 100
  assert.strictEqual(gradeLetter(97, false), 'S');
  assert.strictEqual(gradeLetter(85, false), 'B');
  assert.strictEqual(gradeLetter(100, true), 'F');  // 失败一律 F
});
### 5.2 `test/gp-karaoke-timeline.test.js`（P0，对应 N-5）
// javascript
import test from 'node:test';
import assert from 'node:assert';
import { buildLyricTimeline, activeAt, timelineDuration } from '../assets/js/gp/karaoke-timeline.js';

test('KT-1 中文歌词应按字切分', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 7, text: '长亭外古道边' }] });
  assert.strictEqual(tl.lines[0].words.length, 7);
  assert.deepStrictEqual(tl.lines[0].words.map((w) => w.text), [...'长亭外古道边']);
});

test('KT-2 中文词时间应连续且递增', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 10, dur: 7, text: '长亭外古道边' }] });
  const ws = tl.lines[0].words;
  ws.forEach((w, i) => {
    assert.ok(w.dur > 0);
    if (i) assert.ok(Math.abs(ws[i - 1].end - w.t) < 1e-6, '相邻词时间应衔接');
  });
});

test('KT-3 英文歌词按空格切分', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 4, text: 'hello world again' }] });
  assert.strictEqual(tl.lines[0].words.length, 3);
});

test('KT-4 activeAt 边界', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 5, dur: 4, text: 'abcdefgh' }, { time: 9, dur: 4, text: 'ijklmnop' }] });
  assert.strictEqual(activeAt(tl, 0).lineIdx, -1);
  assert.strictEqual(activeAt(tl, 6).lineIdx, 0);
  assert.strictEqual(activeAt(tl, 10).lineIdx, 1);
  assert.strictEqual(timelineDuration(tl), 13);
});

test('KT-5 已有词级时间戳应原样保留', () => {
  const tl = buildLyricTimeline({ lyrics: [{ time: 0, dur: 4, text: 'ab', words: [{ t: 0, text: 'a' }, { t: 2, text: 'b' }] }] });
  assert.strictEqual(tl.hasWordTiming, true);
  assert.strictEqual(tl.lines[0].words.length, 2);
  assert.strictEqual(tl.lines[0].words[0].dur, 2);
});
### 5.3 `test/gp-omr-harmony.test.js`（P0，对应 N-3）
// javascript
import test from 'node:test';
import assert from 'node:assert';
import { GP_CHORD_SONGS } from '../assets/js/gp/songs.js';
import { findSong } from '../assets/js/gp/catalog.js';

test('OH-1 每首真实谱都必须带和弦进行', () => {
  const omr = GP_CHORD_SONGS.map((d) => findSong(d.id)).filter((s) => s.chartKind === 'omr');
  assert.ok(omr.length > 0);
  const missing = omr.filter((s) => !s.harmony || !s.harmony.chords || !s.harmony.chords.length);
  assert.deepStrictEqual(missing.map((s) => s.id), [], '真实谱缺 harmony');
});

test('OH-2 和弦进行应为合法 [rootPc, type] 二元组', () => {
  for (const d of GP_CHORD_SONGS) {
    const s = findSong(d.id);
    if (!s.harmony) continue;
    for (const c of s.harmony.chords) {
      assert.ok(Array.isArray(c) && c.length === 2, `${d.id} 和弦格式错误`);
      assert.ok(Number.isInteger(c[0]) && c[0] >= 0 && c[0] < 12, `${d.id} rootPc 越界`);
      assert.ok(typeof c[1] === 'string', `${d.id} type 非字符串`);
    }
  }
});
### 5.4 `test/gp-harmonize.test.js`（P1，对应 §4.1）
// javascript
import test from 'node:test';
import assert from 'node:assert';
import { harmonizeBar, harmonizeOmr } from '../assets/js/gp/harmonize.js';

const mel = (midis) => midis.map((m) => ({ midi: m, weight: 1, onBeat: true }));

test('HM-1 C 大调下 C-E-G 应配 C 大三和弦', () => {
  const c = harmonizeBar(mel([60, 64, 67]), 0, false, null);
  assert.deepStrictEqual(c, [0, 'maj']);
});

test('HM-2 C 大调下 G-B-D 应配 G 大三和弦', () => {
  assert.deepStrictEqual(harmonizeBar(mel([67, 71, 74]), 0, false, null), [7, 'maj']);
});

test('HM-3 C 大调下 A-C-E 应配 Am', () => {
  assert.deepStrictEqual(harmonizeBar(mel([69, 72, 76]), 0, false, null), [9, 'min']);
});

test('HM-4 空小节沿用上一和弦', () => {
  assert.deepStrictEqual(harmonizeBar([], 0, false, [7, 'maj']), [7, 'maj']);
});

test('HM-5 全曲和弦序列相邻不重复', () => {
  const omr = { span: 16, b: 4, n: [[0, 1, [60]], [4, 1, [65]], [8, 1, [67]], [12, 1, [72]]] };
  const r = harmonizeOmr(omr, 4, { keyPc: 0 });
  assert.ok(r.chords.length > 0);
  for (let i = 1; i < r.chords.length; i++) {
    assert.notDeepStrictEqual(r.chords[i], r.chords[i - 1], '相邻和弦不应重复');
  }
});
### 5.5 现有测试的回归门槛
// bash
npm test                                   # 必须 0 fail
node tools/diagnose-songbook.mjs           # 必须 0 FAIL（DATA 项除外）
node --test test/songplay-reentry.test.js  # 必须 2 项全绿

## 六、验收清单
### 6.1 自动化验收
- ☐ npm test → 0 fail，且用例数 ≥ 337 + 新增（约 30 项）
- ☐ test/gp-grader.test.js 9 项全绿（N-1、N-6）
- ☐ test/gp-karaoke-timeline.test.js 5 项全绿（N-5）
- ☐ test/gp-omr-harmony.test.js 2 项全绿（N-3）
- ☐ test/gp-harmonize.test.js 5 项全绿（§4.1）
- ☐ 覆盖矩阵 C 类从 28 个降至 ≤ 20 个
### 6.2 人工验收
评分（N-1/N-2）
- ☐ 故意唱偏约半个半音 → 音符显示 off 状态（橙色），血条 -7，不是 -10
- ☐ 连续偏 25 次仍不会立刻 game over（off 扣血更缓）
歌词（N-5）
- ☐ 打开任意中文曲目演奏 → 歌词逐字从左到右点亮，不是整行一次变亮
- ☐ 长歌词行（>10 字）逐字速度均匀，无卡顿
和弦提示（N-3/§4.1）
- ☐ 打开《送别》等 24 首真实谱 → 左下角显示和弦名（如 G、Em），不是 G3、B3
- ☐ 指板图无同弦双圆点
- ☐ 和弦名随小节变化，不长时间停留同一个
谱面
- ☐ 真实谱（24 首）徽章显示「真实谱面」
- ☐ 循环/截断曲目显示「片段循环」标注
- ☐ 占位谱 tier 2 偶数曲目使用分解和弦（arp-5321），非全下扫

## 七、实施优先级
| 顺序 | 任务 | 缺陷 | 改动量 | 收益 |
|---|---|---|---|---|
| 1 | observe 阈值 60→100（两处） | N-1, N-2 | 2 行 | 评分体验修复 |
| 2 | 中文歌词按字切分 | N-5 | ~10 行 | 230 首逐字高亮恢复 |
| 3 | expandOmr 补 harmony | N-3 | ~8 行 | 真实谱和弦 0→23 |
| 4 | 新增 grader / karaoke-timeline 测试 | N-1/N-5/N-8 | 新增 2 文件 | 防回归 |
| 5 | 新增 harmonize.js | N-4/§4.1 | 新增 1 文件 | 真实谱和弦 24/24 |
| 6 | 倍率上限与 bpmSource 统一 | N-6, N-7 | 3 行 | 一致性 |
| 7 | 补 metronome / mic-manager / recorder 测试 | N-8 | 新增 3 文件 | 覆盖盲区 |
| 8 | 数据层（BPM、缺歌词、无 OMR 曲目） | P-1/BUG-08/15 | 数据 | 长期 |



## 八、附录：一键复现全部证据
// bash
cd guitar-studio

# 基线
npm test
node tools/diagnose-songbook.mjs

# N-1 grader off 不可达
node --input-type=module -e "
const {Grader}=await import('./assets/js/gp/grader.js');
const g=new Grader();const n={midi:[60]};
for(let i=0;i<10;i++)g.observe(n,60.7);
console.log('frames=',n.frames,'→ 判定=',g.finalize(n),' counts=',JSON.stringify(g.counts));"

# N-3 真实谱无 harmony
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
const omr=GP_CHORD_SONGS.map(d=>findSong(d.id)).filter(s=>s.chartKind==='omr');
console.log('真实谱',omr.length,'首，有 harmony',omr.filter(s=>s.harmony).length,'首');"

# N-4 派生成功率
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {GP_OMR_NOTES}=await import('./assets/js/gp/omr-notes.js');
const {deriveHarmony}=await import('./assets/js/gp/harmony.js');
let ok=0,fail=0;
for(const d of GP_CHORD_SONGS){const o=GP_OMR_NOTES[d.id];if(!o)continue;
 deriveHarmony(o,o.b||4,{}).chords.length?ok++:fail++;}
console.log('派生成功',ok,'失败',fail);"

# N-5 中文歌词分词
node --input-type=module -e "
const {buildLyricTimeline}=await import('./assets/js/gp/karaoke-timeline.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
const tl=buildLyricTimeline(findSong('gp-song-001'));
console.log('送别首行 words 数 =',tl.lines[0].words.length,'（应为 7，实际 1 说明逐字高亮失效）');"

本内容由 Coze AI 生成，请遵循相关法律法规及《人工智能生成合成内容标识办法》使用与传播。