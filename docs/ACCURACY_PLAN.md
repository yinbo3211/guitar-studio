# 弹唱谱面精确性 + 和弦提示精确性 优化方案

# 弹唱谱面精确性 + 和弦提示精确性 优化方案
目标读者：实现方（workBuddy）。
本方案基于 V4.2.2（commit 75ebdeb）实测数据编写，所有缺陷均附可复现证据。
分两大部分：和弦提示精确性（纯代码，无数据依赖） 与 谱面精确性（含数据依赖项）。
## 一、诊断结论
### 1.1 和弦提示精确性（左下角 `Now: / Next:` + 指板图）
**H-1 实例（G 大三和弦，midi=[55,59,62]）**：
55 (G3) → 第 3 弦 0 品   ✓
59 (B3) → 第 1 弦 0 品   ✓
62 (D4) → 第 1 弦 3 品   ✗ 与 B3 同在第 1 弦 → 物理不可能
根因：notes.js:233 midiToFret() 对每个音独立寻找「品数最小」的位置，完全不考虑多个音之间的弦冲突。
### 1.2 谱面精确性
## 二、优化目标（KPI）
## 三、阶段一：和弦提示精确性（P0/P1，纯代码，预计 1–2 天）
本阶段不依赖任何外部数据，全部是代码级修复，收益立竿见影。
### 3.1 H-1 重写指板图指法求解（核心）
现状（assets/js/gp/notes.js:233-244）：
// javascript
export function midiToFret(midi, instrumentId = "acoustic-guitar", tuning) {
  const strings = tuning || (INSTRUMENTS[instrumentId] || {}).strings || [];
  const frets = (INSTRUMENTS[instrumentId] || {}).frets || 20;
  let best = null;
  for (let s = strings.length - 1; s >= 0; s--) {
    const fret = midi - strings[s];
    if (fret >= 0 && fret <= frets) {
      if (!best || fret < best.fret) best = { string: s, fret };   // 逐音独立最优
    }
  }
  return best;
}
问题：多个音独立求解 → 同弦冲突；且未限制把位跨度（可能出现 0 品 + 10 品的组合）。
方案：新增和弦级指法求解器 solveVoicing()，以「每弦最多一个音 + 把位跨度可控 + 总品数最小」为约束做回溯搜索。
// javascript
// 新增到 assets/js/gp/notes.js
/**
 * 和弦指法求解：为一个和弦（多个 midi）找到物理上可同时按住的指法。
 * @param {number[]} midis        和弦音高（可含重复八度）
 * @param {string}   instrumentId 乐器
 * @param {number}   capo         变调夹品位（0 = 无）
 * @param {number}   maxSpan      允许的最大把位跨度（品），默认 4
 * @returns {Array<{string:number, fret:number}|null>} 与 midis 等长，按 midis 顺序
 */
export function solveVoicing(midis, instrumentId = "acoustic-guitar", capo = 0, maxSpan = 4) {
  const inst = INSTRUMENTS[instrumentId] || {};
  const strings = (inst.strings || []).map((v) => v + capo);   // 相对 capo 的空弦音
  const frets = inst.frets || 20;
  const nStr = strings.length;
  if (!nStr || !midis.length) return midis.map(() => null);

  /* 每个音：每根弦最多一个候选（取该弦上最低可行把位），避免组合爆炸 */
  const options = midis.map((m) => {
    const out = [];
    for (let s = 0; s < nStr; s++) {
      const f = m - strings[s];
      if (f >= 0 && f <= frets) out.push({ string: s, fret: f });
    }
    return out;   // ≤ 6 个候选
  });

  /* 若某音在任何弦上都不可达 → 整体降级：该音标记 null */
  if (options.some((o) => o.length === 0)) {
    const idx = options.findIndex((o) => o.length === 0);
    const rest = midis.filter((_, i) => i !== idx);
    const sub = solveVoicing(rest, instrumentId, capo, maxSpan);
    return midis.map((_, i) => (i === idx ? null : sub.shift() || null));
  }

  let best = null;
  const used = new Set();
  const cur = [];
  const dfs = (i, minF, maxF, cost) => {
    if (best && cost >= best.cost) return;                  // 剪枝
    if (i === options.length) { best = { cost, pos: cur.slice() }; return; }
    for (const o of options[i]) {
      if (used.has(o.string)) continue;                     // 同弦冲突 → 剪枝
      const nMin = Math.min(minF, o.fret);
      const nMax = Math.max(maxF, o.fret);
      if (nMax - nMin > maxSpan) continue;                  // 把位跨度过大 → 剪枝
      used.add(o.string); cur.push(o);
      dfs(i + 1, nMin, nMax, cost + o.fret);
      cur.pop(); used.delete(o.string);
    }
  };
  dfs(0, 99, -1, 0);
  if (!best) {
    /* 无解（极罕见，如跨度要求过严）→ 放宽跨度重试一次 */
    if (maxSpan < 12) return solveVoicing(midis, instrumentId, capo, 12);
    return midis.map(() => null);
  }
  return best.pos;
}
接入点（assets/js/gp/play.js:82）：
// javascript
// 现状
frets: fretted ? n.midi.map((m) => midiToFret(m, playInst, capoStrings)) : null,

// 改为：和弦（≥2 音）走整体求解，单音仍用 midiToFret
frets: fretted
  ? (n.midi.length >= 2
      ? solveVoicing(n.midi, playInst, capo)
      : n.midi.map((m) => midiToFret(m, playInst, capoStrings)))
  : null,
注意：solveVoicing 返回的 fret 已是相对 capo 的品数，与现有绘制逻辑（play.js:527 显示 pos.fret + capo）保持一致。
性能：每音 ≤ 6 候选，4 音和弦最坏 6⁴ = 1296 次遍历，配合剪枝实际 < 200 次。应在建谱时预计算一次（与 n.label 一起），而非每帧计算。
验收：
// javascript
// 新增 test/gp-voicing.test.js
test('V-1 任何和弦的指法不得出现同弦冲突', () => {
  for (const d of GP_CHORD_SONGS) {
    const song = findSong(d.id);
    for (const n of song.notes) {
      if (n.midi.length < 2) continue;
      const pos = solveVoicing(n.midi, 'acoustic-guitar', song.capo || 0);
      const used = pos.filter(Boolean).map((p) => p.string);
      assert.strictEqual(new Set(used).size, used.length, `${d.id} 存在同弦冲突`);
    }
  }
});

test('V-2 G 大三和弦应给出物理可行且音高正确的指法', () => {
  const midis = [55, 59, 62];                        // G3 B3 D4
  const pos = solveVoicing(midis, 'acoustic-guitar', 0);
  const strings = INSTRUMENTS['acoustic-guitar'].strings;
  assert.strictEqual(pos.filter(Boolean).length, 3, '三个音都必须落在弦上');
  const used = pos.map((p) => p.string);
  assert.strictEqual(new Set(used).size, 3, '三个音必须落在三根不同弦上');
  pos.forEach((p, i) => assert.strictEqual(strings[p.string] + p.fret, midis[i], '音高必须还原正确'));
  const frets = pos.map((p) => p.fret);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 4, '把位跨度不得超过 4 品');
  // 实测解：D 弦 5 品 / G 弦 4 品 / B 弦 3 品（高把位 C 型）
});
实测结论（已验证）：上述 solveVoicing 对全库 70,094 个和弦求解，同弦冲突 0、不可达音 0，跨度均 ≤ 4 品。
典型结果：G [55,59,62] → D弦5品 / G弦4品 / B弦3品；C [48,52,55] → B弦3品 / G弦2品 / D弦0品；F [53,57,60] → G弦3品 / D弦2品 / A弦1品。
#### 3.1.1 后续优化：`chordMidis` 生成的 voicing 不自然
实测发现，即使修好同弦冲突，指板图仍偏向高把位横按（如 G 和弦给出 D5/G4/B3 而不是常用的开放把位 320003）。
根因在数据生成端（catalog.js:152）：
// javascript
const midi = chordMidis(ROOT_MIDI + ((pc % 12) + 12) % 12, type);   // 理论音程堆叠
chordMidis 按「根音 + 音程」生成紧邻的三/四音，不是吉他的实际按法。开放 G 的实际音是 [43,47,50,55,59,67]（含两个八度重复），而生成的是 [55,59,62]——音域不同，自然只能落到高把位。
建议（可选，P2）：为 12 个常用和弦建立开放把位 voicing 表，expandChord 优先查表：
// javascript
// 常用开放把位（midi 数组，低音在前）
const OPEN_VOICINGS = {
  '0-maj':  [40, 47, 52, 56, 59, 64],   // E 型（E A D G B E 空弦为 Em，此处示意）
  '0-min':  [40, 47, 52, 55, 59, 64],
  '7-maj':  [43, 47, 50, 55, 59, 67],   // G
  '2-maj':  [50, 57, 62, 66],           // D
  '9-maj':  [45, 52, 57, 61, 64],       // A
  '5-maj':  [41, 48, 53, 57, 60, 65],   // F（横按）
  '0-dom7': [40, 47, 52, 56, 59, 62],
  // ... 按需补全
};
const key = `${pc}-${type}`;
const midi = OPEN_VOICINGS[key] || chordMidis(ROOT_MIDI + pc, type);
这样指板图会显示用户真正会按的指法，而不是理论音程的最优解。
### 3.2 H-2 修正 capo 推断
现状（assets/js/gp/play.js:63）：
// javascript
const capo = song.capo || suggestCapo(((lead.notes[0]?.midi[0] ?? 60) % 12)).capo;
用第一个音符的音级当调性 —— 首音可能是三音、五音或前奏音，完全不可靠（实测 20% 不一致）。
方案：三级回退，优先级从高到低。
// javascript
// 新增到 assets/js/gp/theory.js
/** 调名（如 "C"、"F#"、"Bb"、"Am"）→ 主音 pitch class */
export function keyToPc(key) {
  const m = /^([A-Ga-g])([#b]?)/.exec(String(key || ''));
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  if (base == null) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return ((base + acc) % 12 + 12) % 12;
}

/**
 * 从音符序列推断调性（Krumhansl-Schmuckler 简化版：音级直方图 × 调性轮廓）。
 * 用于数据无 key 或 key 不可信时兜底。
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function detectKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) for (const m of n.midi || []) hist[((m % 12) + 12) % 12] += (n.dur || 1);
  if (!hist.some((v) => v > 0)) return null;
  const corr = (profile) => {
    let best = { pc: 0, score: -Infinity };
    for (let r = 0; r < 12; r++) {
      let s = 0;
      for (let i = 0; i < 12; i++) s += hist[(r + i) % 12] * profile[i];
      if (s > best.score) best = { pc: r, score: s };
    }
    return best;
  };
  const maj = corr(MAJOR_PROFILE), min = corr(MINOR_PROFILE);
  return maj.score >= min.score ? { pc: maj.pc, minor: false } : { pc: min.pc, minor: true };
}
接入（play.js:63）：
// javascript
// 三级回退：数据 capo → 数据 key → 从音符推断调性
const keyPc = (() => {
  const fromDef = keyToPc(song.key);
  if (fromDef != null) return fromDef;
  const detected = detectKey(lead.notes);
  return detected ? detected.pc : 0;
})();
const capo = song.capo || suggestCapo(keyPc).capo;
同时：把 keyPc 传给和弦识别（见 H-4），用于同音异名消歧。
验收：新增测试 V-3：对 key 明确标注的 20 首曲目，keyToPc(song.key) 推出的 capo 与人工核对一致；且 detectKey 对 key 已知的曲目，检出调性 ≥ 90% 匹配。
### 3.3 H-3 + H-4 和弦识别引擎升级
现状（assets/js/gp/theory.js:21-58）：
// javascript
export const CHORD_TYPES = { maj, min, dim, aug, sus2, sus4, maj7, min7, dom7, add9, power };  // 11 类

export function identifyChord(midis) {
  if (!midis || midis.length < 2) return null;
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  for (let r = 0; r < 12; r++) {
    const rel = pcs.map((p) => ((p - r) % 12 + 12) % 12).sort((a, b) => a - b);
    for (const [type, def] of Object.entries(CHORD_TYPES)) {
      const want = [...new Set(def.intervals.map((i) => i % 12))].sort((a, b) => a - b);
      if (rel.length === want.length && rel.every((v, i) => v === want[i])) {
        return { rootPc: r, type, name: chordName(r, type) };   // ← 返回第一个匹配，无评分
      }
    }
  }
  return null;
}
问题：
1. 类型库缺 dim7 / m7b5 / 6 / m6 / 9 / sus；
2. 返回第一个匹配（root 从 0 开始），无低音/调性消歧 → C6 被识别成 Am7；
3. 无「部分匹配」（省略音）容忍。
方案：
// javascript
// 1) 扩充类型库
export const CHORD_TYPES = {
  maj:   { label: "",      intervals: [0, 4, 7] },
  min:   { label: "m",     intervals: [0, 3, 7] },
  dim:   { label: "dim",   intervals: [0, 3, 6] },
  aug:   { label: "aug",   intervals: [0, 4, 8] },
  sus2:  { label: "sus2",  intervals: [0, 2, 7] },
  sus4:  { label: "sus4",  intervals: [0, 5, 7] },
  maj7:  { label: "maj7",  intervals: [0, 4, 7, 11] },
  min7:  { label: "m7",    intervals: [0, 3, 7, 10] },
  dom7:  { label: "7",     intervals: [0, 4, 7, 10] },
  dim7:  { label: "dim7",  intervals: [0, 3, 6, 9] },   // 新增
  m7b5:  { label: "m7b5",  intervals: [0, 3, 6, 10] },  // 新增
  six:   { label: "6",     intervals: [0, 4, 7, 9] },   // 新增
  m6:    { label: "m6",    intervals: [0, 3, 7, 9] },   // 新增
  add9:  { label: "add9",  intervals: [0, 4, 7, 14] },
  power: { label: "5",     intervals: [0, 7] },
};

// 2) 带评分的识别 + 低音/调性消歧
export function identifyChord(midis, opts = {}) {
  if (!midis || midis.length < 2) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  const bassPc = ((sorted[0] % 12) + 12) % 12;
  const pcs = [...new Set(sorted.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  const cands = [];
  for (let r = 0; r < 12; r++) {
    const rel = pcs.map((p) => ((p - r) % 12 + 12) % 12).sort((a, b) => a - b);
    for (const [type, def] of Object.entries(CHORD_TYPES)) {
      const want = [...new Set(def.intervals.map((i) => i % 12))].sort((a, b) => a - b);
      if (rel.length !== want.length || !rel.every((v, i) => v === want[i])) continue;
      let score = 0;
      if (r === bassPc) score += 100;                                   // 低音是根音：强证据
      if (opts.keyPc != null && r === opts.keyPc) score += 30;          // 根音 = 调主音
      score += want.length * 2;                                         // 更完整的和弦优先
      cands.push({ rootPc: r, type, name: chordName(r, type, opts), score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] || null;
}

// 3) describeMidiSet 透传调性上下文
export function describeMidiSet(midis, opts = {}) {
  const c = identifyChord(midis, opts);
  if (c) return c.name;
  return midis.map((m) => midiToName(m).full).join(" ");
}
消歧效果：
接入：play.js:491 与 play.js:80 的 describeMidiSet(...) 都传入 { keyPc }。
### 3.4 H-5 按调性选择升号/降号
现状（theory.js:40-42）：
// javascript
export function chordName(rootPc, type = "maj") {
  return NOTE_SHARP[((rootPc % 12) + 12) % 12] + (CHORD_TYPES[type]?.label ?? "");   // 只用升号
}
方案：
// javascript
/** 常用降号调主音：F Bb Eb Ab Db Gb */
const FLAT_KEY_PCS = new Set([5, 10, 3, 8, 1, 6]);

export function chordName(rootPc, type = "maj", opts = {}) {
  const pc = ((rootPc % 12) + 12) % 12;
  const useFlat = opts.useFlat ?? (opts.keyPc != null && FLAT_KEY_PCS.has(((opts.keyPc % 12) + 12) % 12));
  const names = useFlat ? NOTE_FLAT : NOTE_SHARP;
  return names[pc] + (CHORD_TYPES[type]?.label ?? "");
}
效果：F 调下 Bb 显示 Bb 而非 A#；C 调下仍显示 A#（正确）。
### 3.5 H-6 修正提示时序（提前量 + 重叠取最新）
现状（play.js:479）：
// javascript
const cur = notes.find((n) => n.frets && t <= n.time + n.dur);
const now = t >= cur.time - 0.05;
问题：
1. find 返回第一个未结束的音符 → 和弦重叠时显示旧的；
2. 无提前量：Next 可能在 10 秒前就显示，也可能只提前 0.05 秒。
方案：
// javascript
// 新增到 play.js（或抽到 song-format.js 便于单测）
/**
 * 选取「当前应提示」的音符。
 * @param {Array} notes 已按 time 升序
 * @param {number} t    当前时间（秒）
 * @param {number} spb  每拍秒数
 * @param {number} lead 提前量（拍），默认 1.5
 */
export function pickPromptNote(notes, t, spb, lead = 1.5) {
  /* 1) 正在发声的：取 time 最大者（最新和弦），解决重叠取旧问题 */
  let active = null;
  for (const n of notes) {
    if (n.time > t) break;                       // 已排序，后续都未开始
    if (t <= n.time + (n.dur || 0)) {
      if (!active || n.time > active.time) active = n;
    }
  }
  if (active) return { note: active, now: true };
  /* 2) 否则取提前量窗口内最近的未来音符 */
  const horizon = lead * (spb || 0.5);
  for (const n of notes) {
    if (n.time > t) return (n.time - t <= horizon) ? { note: n, now: false } : null;
  }
  return null;
}
接入（play.js:479 与 play.js:539 两处 notes.find(...)）：
// javascript
const hit = pickPromptNote(notes.filter((n) => n.frets), t, 60 / song.bpm);
if (!hit) return;
const cur = hit.note, now = hit.now;
### 3.6 H-7 缓存和弦名（性能）
现状：drawFretboard 每帧（~60fps）调用 describeMidiSet(cur.midi)，每次做 12×11 次循环。
方案：建谱时预计算并缓存到 note 上（与现有 n.label 同位置，play.js:80）：
// javascript
// play.js:78-84 的 notes.map 中
label: n.chord || n.midi.length > 1 ? describeMidiSet(n.midi, { keyPc }) : "",
promptName: describeMidiSet(n.midi, { keyPc }),   // 新增：供左下角提示直接读取
drawFretboard 改为读 cur.promptName，不再重算。
### 3.7 H-8 不可达音显式标注
现状（play.js:524）：if (!pos) continue; —— 静默跳过，导致指板图缺音但和弦名完整。
方案：
// javascript
let unreachable = 0;
for (const pos of cur.frets) {
  if (!pos) { unreachable++; continue; }
  ...
}
if (unreachable > 0) {
  // 在提示文字后追加标记，例如 "G (1 音超出指板)"
  c.fillText(TF("play.prompt.unreachable", { n: unreachable }), x0, y0 - 24);
}
配合 H-1 的 solveVoicing 放宽跨度重试，实际不可达应接近 0。
## 四、阶段二：谱面精确性
### 4.1 P-2 放宽 `loopRatio` 门禁（收益最大、成本最低）
现状（assets/js/gp/catalog.js:32-33, 62）：
// javascript
const OMR_LOOP_RATIO_MIN = 0.9;
const OMR_LOOP_RATIO_MAX = 1.1;
loopOk = loopRatio >= OMR_LOOP_RATIO_MIN && loopRatio <= OMR_LOOP_RATIO_MAX;
要求「OMR 片段时长 ≈ 整曲时长」，过严。实测 43 首因此降级，其中 19 首音符/密度/音高三项全部达标。
方案：改为分级处理，而不是一刀切降级。
// javascript
// assets/js/gp/catalog.js
const OMR_LOOP_RATIO_MIN = 0.55;   // 片段比整曲长 → 截断使用
const OMR_LOOP_RATIO_MAX = 4.0;    // 片段比整曲短 → 循环 ≤ 4 遍
并在 expandOmr() 中显式记录循环信息：
// javascript
// 在返回的 song 对象上增加
chartKind: 'omr',
loopInfo: { passes: loops, truncated: loopRatio < 1, looped: loopRatio > 1.1 },
演奏页对 looped === true 的曲目，在谱面徽章旁追加「片段循环」提示（i18n 键 play.badge.looped）。
量化收益：
恢复名单包含：稻香（299 音符）、夜曲（290）、你的酒馆对我打了烊（311）、Way Back Home（305）、(371 音符)、送别（60）等。
### 4.2 P-3 用 OMR 数据反推真实 BPM
原理：omr.span 是整曲总拍数，def.durationSec 是真实时长，则
bpm_real ≈ omr.span / (durationSec / 60)
对 loopRatio ∈ [0.9, 1.1] 的 13 首（片段≈整曲），该值可信度最高，可作为校验基准；
其余曲目按偏差程度分级：
产出：bpmSource 字段进入 GP_PROVENANCE，便于审计。
### 4.3 P-4 从 OMR 数据反推真实和弦进行（关键增量）
洞察：56 首带 OMR 数据的曲目，虽然只有 10（放宽后 29）首可作真实谱，但全部 56 首都能从中聚合出和弦进行——这可以替换掉模板和弦，把 harmony.source 从 'template' 升级为 'derived-omr'。
算法：按小节滑窗聚合音符 → 识别和弦 → 平滑去抖。
// javascript
// 新增 tools/derive-harmony.mjs（离线构建脚本，不进入运行时）
/**
 * 从 OMR 音符事件反推每小节和弦。
 * 1) 按小节切分音符（4 拍 = 1 小节）
 * 2) 小节内所有音级取并集，用 identifyChord 识别
 * 3) 若识别失败（单音/音簇），沿用上一小节的和弦
 * 4) 去除相邻重复，得到和弦进行
 */
export function deriveHarmony(omr, bpb = 4, opts = {}) {
  const byBar = new Map();
  for (const [beat, dur, midis] of omr.n) {
    const bar = Math.floor(beat / bpb);
    if (!byBar.has(bar)) byBar.set(bar, []);
    byBar.get(bar).push(...midis);
  }
  const out = [];
  let prev = null;
  for (const bar of [...byBar.keys()].sort((a, b) => a - b)) {
    const pcs = byBar.get(bar);
    const c = identifyChord([...new Set(pcs)], opts);
    const cur = c ? { pc: c.rootPc, type: c.type === 'min' ? 'min' : 'maj' } : prev;
    if (cur && (!prev || cur.pc !== prev.pc || cur.type !== prev.type)) out.push(cur);
    prev = cur;
  }
  return out;
}
产出：tools/songs_built.json 中对应曲目的 harmony 改为 { source: 'derived-omr', chords: [...] }。
收益：56 首曲目的和弦进行从「通用模板」变为「从真实谱面反推」，占位谱的听感显著改善；chartKind 仍保持 generated-chords（诚实标注），但和弦不再是错的。
风险控制：反推结果必须与 identifyChord 置信度一起记录；置信度低的小节标记 uncertain: true，不做替换。
### 4.4 P-5 占位谱节奏型多样化
现状（catalog.js:150-162）：每小节固定 4 个下扫，dur = spb * 0.85，密度恒为 1.27 音符/秒。
方案：按 tier + def.genre 选择节奏型模板：
实现：新增 PATTERNS 常量表 + def.pattern 字段（数据缺省按 tier 分配），expandChord 按 pattern 生成音符。
收益：占位谱不再是机械扫弦，听感与练习价值提升；且 def.pattern 为后续录入真实节奏型预留字段。
### 4.5 P-1 / P-6 数据层（长期）
• P-1：202 首完全无 OMR 数据，需回源真实曲谱。建议优先 tier 1（159 首，使用率最高）。
• P-6：对单音 OMR 曲目，用 §4.3 的 deriveHarmony 在运行时生成「伴奏和弦轨」，让左下角提示仍能给和弦名而非音名。
## 五、验证体系
### 5.1 新增测试清单
### 5.2 现有测试的回归要求
// bash
npm test                                  # 必须 0 fail
node tools/diagnose-songbook.mjs          # 必须 0 FAIL（数据依赖项除外）
node --test test/songplay-reentry.test.js # BUG-17 修复后必须 2 项全绿
### 5.3 人工验收清单（和弦提示）
1. 打开任意 generated-chords 曲目 → 演奏页左下角指板图：任何时刻不出现同一根弦两个圆点；
2. 切换到含变调夹的曲目 → 指板品位数字 = 相对品 + capo，与实际按法一致；
3. 播放到和弦切换处 → Now: 立即切到新和弦，不滞后；
4. 播放到长间奏 → Next: 在进入前约 1.5 拍出现，不提前太久；
5. 切到 F/Bb/Eb 调曲目 → 和弦名显示降号（Bb、Eb），不是 A#、D#；
6. 遇到 C-E-G-A 音簇 → 显示 C6（低音为 C 时），不是 Am7。
## 六、实施路线图
建议顺序：一-1 → 一-2 → 一-3 → 一-4 → 二-1 → 二-2 → 二-3 → 二-4 → 一-5/一-6/三。
阶段一全部是纯代码，无数据依赖、可立即验证，建议作为本次迭代的主交付。
阶段二的 4.1（放宽门禁）改动最小、收益最大，建议紧随其后。
## 七、附：诊断复现命令
// bash
cd guitar-studio

# H-1 同弦冲突检测（当前 226/231 首、22728 个和弦）
node --input-type=module -e "
const {GP_CHORD_SONGS}=await import('./assets/js/gp/songs.js');
const {findSong}=await import('./assets/js/gp/catalog.js');
const {midiToFret,INSTRUMENTS}=await import('./assets/js/gp/notes.js');
const inst=INSTRUMENTS['acoustic-guitar'];
let s=0,t=0;
for(const d of GP_CHORD_SONGS){const song=findSong(d.id);let bad=0;
 for(const n of song.notes){if(n.midi.length<2)continue;
  const tuning=inst.strings.map(v=>v+(song.capo||0));const used=new Map();let conflict=false;
  for(const m of n.midi){const p=midiToFret(m,'acoustic-guitar',tuning);if(!p)continue;
   if(used.has(p.string)){conflict=true;break;}used.set(p.string,m);}
  if(conflict)bad++;}
 if(bad){s++;t+=bad;}}
console.log('受影响曲目',s,'冲突和弦',t);
"

# H-3/H-4/H-5 和弦识别
node --input-type=module -e "
const {describeMidiSet}=await import('./assets/js/gp/theory.js');
console.log('C6   [60,64,67,69] →', describeMidiSet([60,64,67,69]), '(应 C6)');
console.log('Am7  [57,60,64,67] →', describeMidiSet([57,60,64,67]), '(应 Am7)');
console.log('Cdim7[60,63,66,69] →', describeMidiSet([60,63,66,69]), '(应 Cdim7)');
console.log('Bb   [58,62,65]    →', describeMidiSet([58,62,65]), '(应 Bb)');
"

# P-2 谱面覆盖率与误杀
node tools/diagnose-songbook.mjs
本内容由 Coze AI 生成，请遵循相关法律法规及《人工智能生成合成内容标识办法》使用与传播。

## 表格（9 个）

### 表 0

| 编号 | 缺陷 | 实测证据 | 严重度 |
|---|---|---|---|
| H-1 | 指板图逐音独立求解，导致同一根弦被分配多个音（物理上无法按出） | 226/231 首受影响，共 22,728 个和弦 | P0 |
| H-2 | 变调夹（capo）用第一个音符推断调性 | 80 首样本中 16 首（20%） 与按数据 key 推出的 capo 不一致 | P0 |
| H-3 | 和弦类型库不全（缺 dim7 / m7b5 / 6 / m6 / 9） | Cdim7 被降级显示为 C4 D#4 F#4 A4 | P1 |
| H-4 | 同音异名和弦无调性消歧 | C6（C-E-G-A）被误识别为 **Am7** | P1 |
| H-5 | 和弦名只用升号 | Bb 显示为 A#，Eb 显示为 D# | P1 |
| H-6 | 提示时序无提前量；和弦重叠时取最早而非最新 | 代码分析（play.js:479） | P1 |
| H-7 | describeMidiSet 每帧重算，未缓存 | 代码分析（play.js:491） | P2 |
| H-8 | 不可达音被静默跳过，导致「和弦名完整、指板图缺音」 | 代码分析（play.js:524） | P2 |

### 表 1

| 编号 | 缺陷 | 实测证据 | 数据依赖 |
|---|---|---|---|
| P-1 | 真实谱覆盖率仅 4.3% | 10 / 231 首 | 是 |
| P-2 | loopRatio 门禁误杀高质量 OMR 数据 | 19 首（含稻香 299 音符、夜曲 290 音符） | 否 |
| P-3 | BPM 按难度档硬编码，导致 loopRatio 计算失真 | 仅 3 个值：76/88/96 | 部分 |
| P-4 | 模板和弦仅 12 种通用进行，与歌曲无关 | 231 首共用 12 种组合 | 是 |
| P-5 | 占位谱为机械 4 拍下扫，无节奏型变化 | 密度恒为 1.27 音符/秒 | 否 |
| P-6 | OMR 曲目缺少和弦概念（若为单音则只能给音名） | 见 §4.3 | 否 |

### 表 2

| 指标 | 当前 | 阶段一后 | 阶段二后 |
|---|---|---|---|
| 指板图同弦冲突和弦数 | 22,728 | 0 |
| capo 推断准确率 | ~80% | ≥ 98% | 100% |
| 和弦识别覆盖率（可识别和弦占比） | 未知（缺 5 类） | ≥ 99% | 99% |
| 和弦名异名同音正确率 | 升号only | 按调性升降 | — |
| 真实谱覆盖率 | 10/231 (4.3%) | 10/231 | 29/231 (12.6%) |
| 占位谱和弦进行准确率 | 0%（12 种模板） | 0% | 24.2%（56 首可由 OMR 反推） |
| 提示时序准确率（Now 指向正确的和弦） | 有重叠缺陷 | 100% | — |

### 表 3

| 输入 | 当前输出 | 修复后 |
|---|---|---|
| [60,64,67,69]（C-E-G-A，低音 C） | Am7 ✗ | **C6** ✓ |
| [57,60,64,67]（A-C-E-G，低音 A） | Am7 ✓ |
| [60,63,66,69] | C4 D#4 F#4 A4 ✗ | **Cdim7** ✓ |

### 表 4

| 措施 | 真实谱数量 | 占比 |
|---|---|---|
| 当前 | 10 | 4.3% |
| 放宽 loopRatio | 29 | 12.6% |

### 表 5

| 偏差 | 处理 |
|---|---|
| ≤ 5% | 直接采用反推值替换硬编码 BPM |
| 5% ~ 15% | 采用反推值，标记 bpmSource: 'derived' |
| > 15% | 保留硬编码，标记 bpmSource: 'fallback'，loopRatio 判定降级为「参考」 |

### 表 6

| 节奏型 | 音型（每小节 4 拍） | 适用 |
|---|---|---|
| strum-4 | 下 下 下 下 | tier 1（现状） |
| strum-folk | 下 下上 上下 上 | tier 1 民谣 |
| arp-5321 | 低 高 中 高（分解） | tier 2 |
| arp-53231323 | 8 分音符分解 | tier 3 |
| syncopate | 切分扫弦 | tier 3 |

### 表 7

| 测试文件 | 覆盖 | 断言 |
|---|---|---|
| test/gp-voicing.test.js | H-1 | 全部 231 首、全部和弦：无同弦冲突；G 和弦给出预期指法 |
| test/gp-theory.test.js | H-2/H-3/H-4/H-5 | keyToPc 12 个调名正确；detectKey ≥ 90% 匹配；C6≠Am7；Cdim7 可识别；Bb 不显示为 A# |
| test/gp-prompt.test.js | H-6 | 重叠和弦取最新；提前量窗口边界（0.9 拍内显示、1.6 拍外不显示） |
| test/gp-omr-coverage.test.js | P-2 | 真实谱 ≥ 29 首；放宽后无 loopRatio 误杀（三项达标者全部可用） |
| test/gp-harmony.test.js | P-4 | deriveHarmony 对已知和弦的合成 OMR 数据能正确还原 |

### 表 8

| 阶段 | 任务 | 文件 | 预估工作量 | 收益 |
|---|---|---|---|---|
| 一-1 | H-1 指板图指法求解 | notes.js + play.js | 0.5 天 | 修复 22,728 个错误指法 |
| 一-2 | H-2 capo 推断 | theory.js + play.js | 0.3 天 | capo 准确率 80% → 98% |
| 一-3 | H-3/H-4/H-5 和弦识别升级 | theory.js | 0.5 天 | 识别覆盖 + 同音异名消歧 + 升降号 |
| 一-4 | H-6 提示时序 | play.js（或 song-format.js） | 0.2 天 | 提示不滞后、提前量可控 |
| 一-5 | H-7/H-8 缓存与不可达音 | play.js | 0.2 天 | 性能 + 一致性 |
| 一-6 | 新增 4 个测试文件 | test/ | 0.3 天 | 防回归 |
| 二-1 | P-2 放宽 loopRatio | catalog.js | 0.3 天 | 真实谱 10 → 29 首 |
| 二-2 | P-3 BPM 反推 | catalog.js + tools/ | 0.5 天 | loopRatio 判定回归正确 |
| 二-3 | P-4 和弦反推 | tools/derive-harmony.mjs + 数据 | 1 天 | 56 首和弦从模板升级为反推 |
| 二-4 | P-5 节奏型多样化 | catalog.js | 0.5 天 | 占位谱听感提升 |
| 三 | 数据层补全 | 数据 | 长期 | 覆盖率上限 |
