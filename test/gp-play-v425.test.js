/* ============================================================
   六弦工坊 V4.2.5 · 弹唱页体验整改验收（R-01..R-06 可自动化项）
   ------------------------------------------------------------
   需求源：《V4.2.4 全量测试报告》第五节 7 条缺陷 + 第六节 6.1–6.6 落地方案；
   设计：docs/V4.2.5_INCREMENTAL_DESIGN.md §4（主理人 Q-1..Q-8 拍板版）。

   R-01a/b P1-02 去按钮符号 + 增删 key
   R-02a/b/c P1-01 词级渲染退役、行级时间轴保留、歌词单行纯文本
   R-03a/b/c/d P1-03 和弦提示音（纯函数 / 降级 / 注入 / hasChordNotes 门控）
   R-04a/b P2-02 歌词移出画布
   R-05a/b P2-01 主题一致性（令牌接管 + 七主题对比度）
   R-06a/b P2-04 控制区紧凑化 + 底部安全区
   ------------------------------------------------------------
   不可自动化（人工项，见设计 §4.2）：R-03e 真机听感、R-04c 双分辨率截图、
   R-05c 7 主题 × 4 语言截图、R-06c iPhone 16 Pro 真机安全区。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

await imp('test/_gp-dom.mjs');

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const DICTS = {};
for (const lang of LANGS) DICTS[lang] = (await imp(`assets/js/i18n/${lang}.js`)).DICT;

const PLAY_SRC = read('assets/js/gp/play.js');
const CSS = read('assets/css/gp.css');

/* 贴纸符号范围：箭头/几何(2190-21FF) 杂项符号(2300-27FF，含 ⟲ U+27F2)
   装饰符号(2B00-2BFF) emoji(1F000-1FAFF) */
const STICKER_RE = /[\u2190-\u21FF\u2300-\u27FF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]/u;
/* P1-02 去符号的按钮键（Q-3 拍板：只做按钮键，play.capo 🔼 / play.result.coins 🪙 等非按钮键登记不改） */
const BUTTON_KEYS = [
  'play.start', 'play.restart', 'play.songs', 'play.pause', 'play.resume',
  'play.playAgain', 'play.band', 'play.metronome', 'play.frets', 'play.holes',
];
/* P1-01 / P1-03 退役的 key */
const DEAD_KEYS = ['play.notes', 'play.karaoke', 'play.hint.hitLine', 'play.hint.karaoke'];
/* P1-03 新增的 key */
const NEW_KEYS = ['play.chordHint', 'play.hint.chordHint'];

/* ============================================================
   R-01 去按钮表情符号 + i18n key 增删
   ============================================================ */
test('R-01a 四语 10 个按钮键均不含贴纸符号', () => {
  const bad = [];
  for (const lang of LANGS) {
    for (const k of BUTTON_KEYS) {
      const v = DICTS[lang][k];
      assert.ok(typeof v === 'string' && v.length, `${lang}.${k} 缺失`);
      if (STICKER_RE.test(v)) bad.push(`${lang}.${k} = ${v}`);
    }
  }
  assert.deepStrictEqual(bad, [], `按钮文案仍含贴纸符号：${bad.join(' | ')}`);
});

test('R-01b 退役 key 四语全删、新增 key 四语齐全且非空', () => {
  for (const lang of LANGS) {
    for (const k of DEAD_KEYS) {
      assert.strictEqual(DICTS[lang][k], undefined, `${lang} 仍残留已退役的 ${k}`);
    }
    for (const k of NEW_KEYS) {
      assert.ok(DICTS[lang][k] && String(DICTS[lang][k]).trim().length > 0, `${lang}.${k} 缺失或为空`);
    }
  }
});

test('R-01c 四语 key 集合完全相等（含本次增删）', () => {
  const base = Object.keys(DICTS['zh-CN']).sort();
  for (const lang of LANGS.slice(1)) {
    assert.deepStrictEqual(Object.keys(DICTS[lang]).sort(), base, `${lang} 与 zh-CN 的 key 集合不一致`);
  }
  assert.ok(base.includes('play.chordHint'), '新增键应已入四语字典');
  assert.ok(!base.includes('play.karaoke'), '退役键应已从四语字典移除');
});

/* ============================================================
   R-02 逐字歌词退役 / 行级时间轴保留
   ============================================================ */
test('R-02a 词级渲染已退役：play.js 不引用 lineFillHTML / karaokeLyrics，karaoke-render.js 不再导出它', async () => {
  assert.ok(!/lineFillHTML/.test(PLAY_SRC), 'play.js 不应再引用 lineFillHTML');
  assert.ok(!/karaokeLyrics/.test(PLAY_SRC), 'play.js 不应再引用 karaokeLyrics');
  const renderSrc = read('assets/js/gp/karaoke-render.js');
  assert.ok(!/export function lineFillHTML/.test(renderSrc), 'karaoke-render.js 不应再导出 lineFillHTML');
  assert.ok(/export function escapeHTML/.test(renderSrc), 'escapeHTML 必须保留（play.js 与 GP-XSS-3 用例化）');
});

test('R-02b 防「回退误判」：行级时间轴仍在被消费（activeAt/buildLyricTimeline 未死）', async () => {
  assert.ok(/import \{ buildLyricTimeline, activeAt \} from "\.\/karaoke-timeline\.js"/.test(PLAY_SRC),
    'play.js 必须继续 import 行级时间轴');
  assert.ok(/activeAt\(lyricTimeline, t\)/.test(PLAY_SRC), 'updateLyric 必须仍用 activeAt 定位当前行');
  const tl = await imp('assets/js/gp/karaoke-timeline.js');
  for (const fn of ['tokenizeLine', 'allocate', 'buildLyricTimeline', 'activeAt', 'timelineDuration']) {
    assert.strictEqual(typeof tl[fn], 'function', `karaoke-timeline.js 必须仍导出 ${fn}`);
  }
});

test('R-02c 歌词渲染为单行纯文本（无子元素、不走 innerHTML、内容 = 当前行）', async () => {
  const { Audio } = await imp('assets/js/gp/engine.js');
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const cat = await imp('assets/js/gp/catalog.js');

  const root = new El('div');
  const cleanup = await play({ el: root, params: ['gp-song-002'], navigate: () => {} });
  const shell = root.children[0];
  const lyric = shell.querySelector('.lyric-line');
  assert.ok(lyric, '应能取到歌词行');

  /* 受控帧泵：接管 rAF，逐帧推进时钟（每帧 50ms，dt 上限即 0.05s） */
  let pendingFrame = null;
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1; };
  const realLive = Audio.micLive;
  Audio.micLive = () => true;                       // 让 ensureMic() 短路，不走 getUserMedia
  try {
    let now = performance.now();
    shell.querySelector('.play-controls').children[0].click();   // 「开始」
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(pendingFrame, '主循环应已启动');

    const expected = cat.findSong('gp-song-002').lyrics[0].text;
    let guard = 0;
    while (guard++ < 600) {
      const cb = pendingFrame; pendingFrame = null;
      if (!cb) break;
      now += 50; cb(now);
      if (lyric.textContent) break;
    }
    assert.ok(lyric.textContent, '推进到有歌词的时刻后，歌词行应渲染出内容');
    assert.strictEqual(lyric.textContent, expected, '歌词应等于当前行原文（单行、无下一行预览）');
    assert.strictEqual(lyric.children.length, 0, '歌词行不得有子元素（逐字 span / 双行 div 已退役）');
    assert.ok(!/[<>]/.test(String(lyric.innerHTML)), '歌词不得经 innerHTML 注入');
  } finally {
    Audio.micLive = realLive;
    globalThis.requestAnimationFrame = realRaf;
    cleanup();
  }
});

test('R-02d GP-4 结构不变：歌词栏仍挂在 shell 内（teardown 语义不变）', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const root = new El('div');
  const cleanup = await play({ el: root, params: ['gp-song-002'], navigate: () => {} });
  const shell = root.children[0];
  const bar = shell.querySelector('.gp-lyric-bar');
  assert.ok(bar, '应新增独立歌词栏');
  assert.ok(bar.querySelector('.lyric-line'), '歌词行应位于歌词栏内');
  assert.ok(bar.querySelector('.gp-bar-chord'), '当前小节和弦应并入歌词栏');
  /* V4.2.6 N-4：shell 由「舞台 / 歌词栏 / 控制区」三段变为「返回栏 / 舞台 / 歌词栏 / 控制区」
     四段（新增 .gp-back-bar 承载左上角「← 返回」）。这是有意的演进（同 V4.2.5 加歌词栏时
     把该断言从 2 改到 3），不是掩盖缺陷：teardown 仍只 removeChild(shell)，RE-1/RE-2 不变。 */
  assert.strictEqual(shell.children.length, 4, 'shell 应为 返回栏 / 舞台 / 歌词栏 / 控制区 四段（V4.2.6 N-4 新增 .gp-back-bar）');
  assert.ok(shell.children[0].className.includes('gp-back-bar'), 'shell 首子节点应为返回栏');
  cleanup();
  assert.strictEqual(root.children.length, 0, 'teardown 后 shell 必须被移除（RE-1 语义不变）');
});

/* ============================================================
   R-03 和弦提示音
   ============================================================ */
const { chordHintFreqs, chordVol, strumChord } = await imp('assets/js/gp/play.js');
const { Store } = await imp('assets/js/gp/state.js');

test('R-03a chordHintFreqs 输出升序频率（A4=69 → 440Hz）', () => {
  const f = chordHintFreqs([55, 48, 52]);
  assert.strictEqual(f.length, 3);
  for (let i = 1; i < f.length; i++) assert.ok(f[i] > f[i - 1], '频率须升序');
  assert.ok(Math.abs(f[0] - 130.81) < 0.05, `C3 应≈130.81Hz，实际 ${f[0]}`);
  assert.ok(Math.abs(f[1] - 164.81) < 0.05, `E3 应≈164.81Hz，实际 ${f[1]}`);
  assert.ok(Math.abs(f[2] - 196.00) < 0.05, `G3 应≈196.00Hz，实际 ${f[2]}`);
  assert.deepStrictEqual(chordHintFreqs(null), [], '非法入参返回空数组');
});

test('R-03b strumChord 在无 AudioEngine 环境静默降级（Node 单测护栏）', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'AudioEngine');
  const bak = globalThis.AudioEngine;
  delete globalThis.AudioEngine;
  try {
    assert.strictEqual(strumChord([48, 52, 55], 0.22), false, '无 AudioEngine 时应返回 false 且不抛错');
    assert.strictEqual(strumChord([48], 0.22), false, '单音不发声');
  } finally {
    if (had) globalThis.AudioEngine = bak;
  }
});

test('R-03c 注入 AudioEngine 后走真实扫弦，音量与伴奏滑杆联动', () => {
  const calls = [];
  const bak = globalThis.AudioEngine;
  globalThis.AudioEngine = { strum: (freqs, dir, vol) => { calls.push({ freqs, dir, vol }); } };
  try {
    assert.strictEqual(strumChord([55, 48, 52], 0.22), true, '应触发扫弦');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].dir, 'down', '与和弦库「听扫弦」同为下扫');
    assert.deepStrictEqual(calls[0].freqs, chordHintFreqs([48, 52, 55]), '频率须升序');
    assert.ok(calls[0].vol >= 0.12 && calls[0].vol <= 0.30, `音量应落在 0.12~0.30，实际 ${calls[0].vol}`);
  } finally {
    if (bak === undefined) delete globalThis.AudioEngine; else globalThis.AudioEngine = bak;
  }

  const real = Store.settings().backingVolume;
  try {
    Store.setSetting('backingVolume', 0);
    assert.ok(Math.abs(chordVol() - 0.12) < 1e-9, `滑杆 0 → 0.12，实际 ${chordVol()}`);
    Store.setSetting('backingVolume', 0.7);
    assert.ok(Math.abs(chordVol() - 0.22) < 1e-9, `滑杆 0.7（默认）→ 0.22，实际 ${chordVol()}`);
    Store.setSetting('backingVolume', 1);
    assert.ok(Math.abs(chordVol() - 0.30) < 1e-9, `滑杆 1 → 0.30，实际 ${chordVol()}`);
  } finally {
    Store.setSetting('backingVolume', real);
  }
});

/** 取节点及其子节点的全部文本（shim 的按钮文本落在 Text 子节点上） */
function nodeText(node) {
  if (!node) return '';
  if (typeof node.textContent === 'string' && node.textContent) return node.textContent;
  return (node.children || []).map(nodeText).join('');
}

test('R-03d hasChordNotes 门控：无和弦音的曲目不渲染「和弦提示音」按钮', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const { El } = await imp('test/_gp-dom.mjs');
  const cat = await imp('assets/js/gp/catalog.js');

  /* gp-song-001（omr 真实谱，209 个全单音音符）→ 按钮必须隐藏，不给假承诺 */
  const r1 = new El('div');
  const c1 = await play({ el: r1, params: ['gp-song-001'], navigate: () => {} });
  const shell1 = r1.children[0];
  const noChord = cat.findSong('gp-song-001').notes.every((n) => !Array.isArray(n.midi) || n.midi.length < 2);
  assert.strictEqual(noChord, true, '前置：gp-song-001 确实没有 ≥2 音音符');
  const labels1 = shell1.querySelector('.play-controls').querySelectorAll('.btn').map(nodeText);
  assert.ok(!labels1.includes('play.chordHint'), `无和弦音的曲目不应渲染提示音按钮：${labels1.join('/')}`);

  /* gp-song-002（172 个和弦音符）→ 按钮必须出现 */
  const r2 = new El('div');
  const c2 = await play({ el: r2, params: ['gp-song-002'], navigate: () => {} });
  const shell2 = r2.children[0];
  const labels2 = shell2.querySelector('.play-controls').querySelectorAll('.btn').map(nodeText);
  assert.ok(labels2.includes('play.chordHint'), `有和弦音的曲目应渲染提示音按钮：${labels2.join('/')}`);

  /* 控制栏按钮数应为 7（基线 8 个：去掉逐字歌词与单音提示音，新增和弦提示音） */
  assert.strictEqual(labels2.length, 7, `控制栏按钮应为 7 个，实际 ${labels2.length}：${labels2.join('/')}`);
  c1(); c2();
});

/* ============================================================
   R-04 / R-05 / R-06：样式契约（源码级）
   ============================================================ */
function lastRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  let body = null;
  for (const m of CSS.matchAll(pattern)) body = m[1];
  return body || '';
}

test('R-04a 歌词行脱离画布绝对定位（position: static）', () => {
  assert.match(lastRule('.gp-scope .lyric-line'), /position:\s*static\b/,
    'lyric-line 必须 position: static（进入 .gp-lyric-bar 正常流）');
});

test('R-04a2 无歌词弱提示的 CSS 选择器与 dataset 键名一致（camelCase → 连词符）', () => {
  /* lyric.dataset.noLyrics = "1" 落到 DOM 上的属性名是 data-no-lyrics，
     写 [data-noLyrics] 永远匹配不到 —— 这条曾差点漏掉，故钉死 */
  assert.ok(/lyric\.dataset\.noLyrics\s*=/.test(PLAY_SRC), 'play.js 应用 dataset.noLyrics 标记弱提示');
  assert.match(CSS, /\.gp-scope \.lyric-line\[data-no-lyrics\]/,
    'CSS 必须用连词符属性名 data-no-lyrics');
});

test('R-04b 歌词行不再挂进 .play-overlay（源码正则）', () => {
  const m = /overlay\.append\(([^;]*)\);/.exec(PLAY_SRC);
  assert.ok(m, '应能定位 overlay.append 调用');
  assert.ok(!/\blyric\b/.test(m[1]), `overlay.append 参数不得含 lyric：${m[1]}`);
  assert.ok(/lyricBar/.test(PLAY_SRC), 'shell 应追加独立歌词栏');
});

test('R-05a 主题令牌接管：宿主令牌优先且画布保留高对比专用色', () => {
  const idx = CSS.lastIndexOf('\n.gp-scope {');
  assert.ok(idx > 0, 'gp.css 末尾应有宿主补丁的 .gp-scope 变量块');
  const block = CSS.slice(idx, CSS.indexOf('}', idx));
  assert.match(block, /--accent-ink:\s*var\(--gp-host-bg-2\s*,/, '--accent-ink 应取宿主 --bg-2 别名');
  assert.match(block, /--highway:\s*#0a0e18/, '画布底色恒为 #0a0e18，不随主题变化');
  assert.match(block, /--gp-canvas-accent:\s*#[0-9a-f]{6}/i, '应定义画布专用强调色');
  assert.match(block, /--gp-canvas-muted:\s*#[0-9a-f]{6}/i, '应定义画布专用弱化色');
  assert.match(block, /--text:\s*var\(--txt\s*,/, '--text 应接管宿主 --txt');
  /* 自引用循环护栏：不得出现 `--bg: var(--bg)` 这类同名自引用 */
  for (const name of ['--bg', '--bg-2', '--line']) {
    assert.ok(!new RegExp(`${name}:\\s*var\\(${name}[,)]`).test(block),
      `${name} 不得自引用（CSS 变量循环 → guaranteed-invalid）`);
  }
  /* 宿主侧别名必须写在祖先上（components.css），否则接管不生效 */
  const comp = read('assets/css/components.css');
  assert.match(comp, /--gp-host-bg:\s*var\(--bg\)/, 'components.css 应提供 --gp-host-bg 别名');
  assert.match(comp, /--gp-host-bg-2:\s*var\(--bg-2\)/, 'components.css 应提供 --gp-host-bg-2 别名');
});

const hexRgb = (hex) => {
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const relLum = (hex) => {
  const a = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const contrast = (a, b) => {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

test('R-05b 七主题对比度：主文字 ≥4.5，primary 按钮文字 ≥4.4（cyber 4.47 为 KV-3）', () => {
  const themes = fs.readdirSync(path.join(ROOT, 'assets/css/themes')).filter((f) => /^theme-.*\.css$/.test(f));
  assert.strictEqual(themes.length, 7, `应有 7 套主题，实际 ${themes.length}`);
  const pick = (src, name) => {
    const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(src);
    assert.ok(m, `主题 ${name} 应定义为 6 位 hex`);
    return m[1];
  };
  const textBad = [];
  const inkBad = [];
  for (const f of themes) {
    const src = read(`assets/css/themes/${f}`);
    const txt = pick(src, '--txt');
    const bg2 = pick(src, '--bg-2');
    const blue = pick(src, '--blue');
    const cText = contrast(txt, bg2);
    const cInk = contrast(bg2, blue);
    if (cText < 4.5) textBad.push(`${f}: ${cText.toFixed(2)}`);
    /* KV-3（主理人 Q-5 拍板接受）：cyber 主题 --accent-ink 实测 4.47，差 AA 4.5 仅 0.03，
       单值无法全主题达标（dawn 需更暗、cyber 需更亮，方向相反）→ 阈值写 4.4 */
    if (cInk < 4.4) inkBad.push(`${f}: ${cInk.toFixed(2)}`);
  }
  assert.deepStrictEqual(textBad, [], `主文字对比度低于 4.5：${textBad.join(', ')}`);
  assert.deepStrictEqual(inkBad, [], `primary 按钮文字对比度低于 4.4（KV-3 下界）：${inkBad.join(', ')}`);
});

test('R-06a 控制区 padding 含底部安全区 env(safe-area-inset-bottom)', () => {
  assert.match(lastRule('.gp-scope .play-controls'), /env\(\s*safe-area-inset-bottom/,
    '控制区应处理底部安全区（PWA 全屏 Home 条）');
});

test('R-06b 控制区按钮无条件紧凑化（min-height ≤40px + clamp 内边距）', () => {
  const rule = lastRule('.gp-scope .play-controls .btn');
  const mh = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(rule);
  assert.ok(mh, '按钮应给出 min-height');
  assert.ok(Number(mh[1]) <= 40, `按钮 min-height ${mh[1]}px 超过 40px`);
  assert.match(rule, /padding:\s*[^;]*clamp\(/, '按钮内边距应使用 clamp()（无断点写法）');
  /* Q-4：gp.css 既有 6 个 @media 在 CSSOM 中为空规则（生成器缺陷，本轮不修），
     新增补丁一律不得再依赖断点 */
  const patchIdx = CSS.lastIndexOf('\n.gp-scope {');
  const patch = CSS.slice(patchIdx);
  assert.ok(!/@media/.test(patch), '宿主补丁不得依赖 @media 断点');
});
