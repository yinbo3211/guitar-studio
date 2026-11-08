/* ============================================================
   六弦工坊 V4.3.1 · 国际化收尾回归（GS-TASK-2026-004）
   ------------------------------------------------------------
   对照《六弦工坊国际化收尾任务书》第七章验收清单 A1-A6：
   V431-1/2/3  A2 乐理术语四语齐全 + 数据层挂键完整
   V431-4      A1/A2 节奏动作名四语化（含 {n} 弦序占位符）
   V431-5/6    A3 红线守卫：内容字段不词条化 + 曲库专名不进译文词典
   V431-7/8    A4 九模块 gs:lang 联动 + 状态保持契约
   V431-9      A1 渲染路径无中文面量（数据表 fallback 白名单除外）
   V431-10     A6 R1 移动端语言入口不回退
   V431-11     V4.3.1 data-i18n-title 维度与挂载看门纳入
   V431-12     A4 行为级：和弦库切语言保留选中态与播放高亮
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const DICT = {};
for (const lang of ['zh-CN', 'en', 'ja', 'ko']) {
  DICT[lang] = (await imp(`assets/js/i18n/${lang}.js`)).DICT;
}
const { 'zh-CN': ZH, en: EN, ja: JA, ko: KO } = DICT;
const CJK = /[\u4e00-\u9fff]/;
const tF = (dict, key, pairs) => {
  let s = dict[key] ?? key;
  for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
  return s;
};

const MODULES = [
  'rhythm', 'scale', 'ear-training', 'plan', 'chord-game',
  'chord-lib', 'recorder', 'fretboard', 'chord-flow',
];
const src = (m) => read(`assets/js/modules/${m}.js`);

/* ------------------------------------------------------------
   A2：四语键集合与乐理术语
   ------------------------------------------------------------ */

test('V431-1 A2 四语键集合完全一致、全键非空、词条量覆盖收尾增量', () => {
  const base = Object.keys(ZH);
  assert.ok(base.length >= 660, `词条量应 >= 660，实测 ${base.length}`);
  for (const lang of ['en', 'ja', 'ko']) {
    assert.deepStrictEqual(Object.keys(DICT[lang]).sort(), base.slice().sort(),
      `${lang} 与 zh-CN 键集合不一致`);
  }
  for (const lang of Object.keys(DICT)) {
    const empty = Object.keys(DICT[lang]).filter((k) => !String(DICT[lang][k]).trim());
    assert.deepStrictEqual(empty, [], `${lang} 存在空词条：${empty.join(', ')}`);
  }
});

test('V431-2 A2 乐理术语四语齐全且译名正确（音阶/音程/节奏型/进行名/把位/品位/关卡）', () => {
  const terms = [
    'scx.type.major',            // 音阶名
    'scx.pos.open',              // 把位名
    'scx.pos.n',                 // 把位名（占位符）
    'ear.iv.m2',                 // 音程名
    'rhythm.pat.strum-basic4.name', // 节奏型名
    'rhythm.sub.triplet',        // 节奏型细分术语
    'chords.prog.p1.name',       // 和弦进行名
    'chords.fretN',              // 品位（占位符）
    'game.level.l1',             // 关卡名
  ];
  for (const k of terms) {
    assert.ok(k in ZH, `缺少乐理术语键 ${k}`);
    const vals = ['zh-CN', 'en', 'ja', 'ko'].map((l) => DICT[l][k]);
    for (const v of vals) assert.ok(String(v).trim(), `${k} 存在空译名`);
    // 译名须真实不同（防占位复制）；英文译名不得残留中文
    for (const lang of ['en', 'ja', 'ko']) {
      assert.notStrictEqual(DICT[lang][k], ZH[k], `${k} 的 ${lang} 译名与中文相同（疑似未翻译）`);
    }
    assert.ok(!CJK.test(EN[k]), `${k} 的英文译名残留中文：${EN[k]}`);
  }
  // 抽查译名正确性（任务书 A2「抽查译名正确性」）
  assert.strictEqual(EN['ear.iv.m2'], 'Major 2nd');
  assert.strictEqual(EN['scx.type.major'], 'Major');
  assert.strictEqual(EN['chords.prog.p1.name'], 'Pop standard 1-5-6-4');
  assert.ok(EN['rhythm.pat.strum-basic4.name'].includes('strum'));
});

test('V431-3 A2 数据层挂键完整（节奏 14 / 音阶 6 / 进行 6 / 音程 16 / 关卡 4 / 计划任务 6）', () => {
  const counts = [
    ['assets/js/data/rhythm-data.js', /nk:'rhythm\.pat\./g, 14],
    ['assets/js/data/scales.js', /nk:'scx\.type\./g, 6],
    ['assets/js/data/chords.js', /nk:'chords\.prog\./g, 6],
    ['assets/js/modules/ear-training.js', /lk:'ear\./g, 16],
    ['assets/js/modules/chord-game.js', /nk:'game\.level\./g, 4],
    ['assets/js/modules/plan.js', /lk:'plan\./g, 6],
  ];
  for (const [f, re, n] of counts) {
    const got = (read(f).match(re) || []).length;
    assert.ok(got >= n, `${f} 挂键数量应 >= ${n}，实测 ${got}`);
  }
  // 每个挂键都必须在四语词典中存在
  for (const f of counts.map((x) => x[0])) {
    for (const m of read(f).matchAll(/(?:nk|dk|tk|lk|ek|cnKey):'([a-zA-Z0-9.\-_]+)'/g)) {
      assert.ok(m[1] in ZH, `${f} 挂了不存在的键 ${m[1]}`);
    }
  }
});

test('V431-4 A1/A2 节奏动作名全量四语化，EN 无中文残留，弦序占位符插值正确', async () => {
  const mod = await imp('assets/js/data/rhythm-data.js');
  const RD = mod.default ?? mod.RhythmData ?? mod;
  const cases = [
    [{ cat: 'strum' }, 'D'], [{ cat: 'strum' }, 'U'],
    [{ cat: 'strum' }, 'x'], [{ cat: 'strum' }, '-'],
    [{ cat: 'pick' }, 'R'], [{ cat: 'pick' }, 'B'],
    [{ cat: 'pick' }, '-'], [{ cat: 'pick' }, '3'], [{ cat: 'pick' }, '6'],
  ];
  for (const [p, a] of cases) {
    const c = RD.resolveAction(p, a, 'C');
    assert.ok(c.cnKey, `动作 ${a} 缺少 cnKey（动作名无法国际化）`);
    const pairs = c.cnN != null ? { n: c.cnN } : {};
    for (const lang of ['zh-CN', 'en', 'ja', 'ko']) {
      const name = tF(DICT[lang], c.cnKey, pairs);
      assert.ok(name && name !== c.cnKey, `${a}/${lang} 动作名取词失败`);
      assert.ok(!name.includes('{n}'), `${a}/${lang} 占位符未替换：${name}`);
      // 仅英文做「无汉字」硬断言：日/韩译名合法使用汉字（如 下/上/第），不能按中文残留误判
      if (lang === 'en') assert.ok(!CJK.test(name), `${a}/en 动作名残留中文：${name}`);
    }
  }
  // 数字弦动作：四语文案必须带上弦号
  assert.strictEqual(tF(EN, 'rhythm.act.string', { n: 3 }), 'String 3');
  // R 动作 lab 由中文「根」改为通用符号，避免 44px 网格 EN 模式残留
  assert.strictEqual(RD.resolveAction({ cat: 'pick' }, 'R', 'C').label, 'R');
});

/* ------------------------------------------------------------
   A3：红线守卫（歌名/歌手/歌词/来源名保持原文）
   ------------------------------------------------------------ */

test('V431-5 A3 红线守卫：catalog 内容字段直取 def，纯数据层不得引入取词或挂载', () => {
  const s = read('assets/js/gp/catalog.js');
  assert.ok(!s.includes('window.t') && !s.includes('gsI18n'), 'catalog 不得调用宿主取词');
  assert.ok(!s.includes('data-i18n') && !s.includes('i18n'), 'catalog 不得挂 i18n 键');
  // 内容字段必须直取 def（禁止 T(def.title) 之类包裹）
  for (const f of ['title', 'artist', 'lyrics']) {
    const re = new RegExp(`${f}:\\s*def\\.${f}`, 'g');
    assert.ok(re.test(s), `${f} 必须由 def.${f} 原样赋值（禁止词条化）`);
  }
  // source 是谱面来源/生成方式标记，属数据字段而非 UI 标签
  assert.ok(!/source:\s*T\(/.test(s), 'source 不得经取词转换');
});

test('V431-6 A3 红线守卫：曲库中文专名未进入译文词典（整值判定）', () => {
  const songs = read('assets/js/gp/songs.js');
  const names = new Set();
  for (const m of songs.matchAll(/"(?:title|artist|qqname|qqsinger|album)":"([^"]+)"/g)) {
    if (CJK.test(m[1])) names.add(m[1]);
  }
  assert.ok(names.size >= 400, `曲库中文专名应 >= 400，实测 ${names.size}`);
  // 通用 UI 词「自定义」恰好与某曲名同名，属允许的界面词，非歌名词条化
  const allow = new Set(['自定义']);
  for (const lang of ['en', 'ja', 'ko']) {
    const vals = new Set(Object.values(DICT[lang]));
    const hit = [...names].filter((n) => vals.has(n));
    assert.deepStrictEqual(hit, [], `${lang} 词典把曲库专名当成了词条值：${hit.join(', ')}`);
  }
  const zhVals = new Set(Object.values(ZH));
  const zhHit = [...names].filter((n) => zhVals.has(n) && !allow.has(n));
  assert.deepStrictEqual(zhHit, [], `zh-CN 词典出现曲库专名整值：${zhHit.join(', ')}`);
  // 专名也不得成为词条键名
  for (const n of names) assert.ok(!(n in ZH), `曲库专名「${n}」被词条化为键名`);
});

/* ------------------------------------------------------------
   A4：语言联动与状态保持
   ------------------------------------------------------------ */

test('V431-7 A4 九模块全部注册 gs:lang、提供 refreshLang 且经 T/TF 取词', () => {
  for (const m of MODULES) {
    const s = src(m);
    assert.ok(s.includes("document.addEventListener('gs:lang'"), `${m} 缺少 gs:lang 监听`);
    assert.ok(s.includes('refreshLang()'), `${m} 缺少 refreshLang`);
    assert.ok(s.includes('window.gsI18n.tF'), `${m} 的 TF 必须委托宿主 tF（R4 口径）`);
    assert.ok(/const T\s*=/.test(s), `${m} 缺少 T() 取词 helper`);
    // refreshLang 方法体里必须至少有一次取词，防止空实现
    const at = s.indexOf('refreshLang(){');
    assert.ok(at >= 0, `${m} 未找到 refreshLang 方法定义`);
    const body = s.slice(at, at + 1400);
    // plan 走 render() 委托（历史计划现取词），其余模块在 refreshLang 内直接取词
    assert.ok(/T\(|TF\(|this\.render\(\)/.test(body), `${m} 的 refreshLang 未实际取词或委托重渲染`);
    if (m === 'plan') {
      assert.ok(/labelOf|descOf|unitOf/.test(s), 'plan 的 render 必须现取词，不得读 localStorage 旧文案');
    }
  }
});

test('V431-8 A4 状态保持契约（切语言只改文本，不重建交互 DOM / 不丢状态）', () => {
  const marks = {
    rhythm: ["this.phase==='idle'", '_paintCellNames'],        // 播放中不重建网格
    scale: ['_langText', 'dataset.n'],                          // 文本来源表 + 指板弦标
    'ear-training': ['data-lk', '_qKey'],                       // 选项按钮 + 题面取词来源
    plan: ['labelOf', 'descOf', 'unitOf'],                      // 历史计划现取词，不读旧 label
    'chord-game': ['this.running&&this.cur', 'renderLevels'],   // 运行态防复位
    'chord-lib': ['select(this.sel,true)', 'PROGRESSIONS[i].nk'], // 静默重绘 + 进行名
    recorder: ['refreshLang'],                                  // 不重建录音列表
    fretboard: ['_hintKey', 'this.playing'],                     // 提示来源 + 运行态
    'chord-flow': ['this.running', 'this.seq.length'],           // 运行态 + 序列
  };
  for (const m of MODULES) {
    const s = src(m);
    for (const mark of marks[m]) {
      assert.ok(s.includes(mark), `${m} 缺少状态保持标记「${mark}」`);
    }
  }
  // rhythm：播放中切语言不得重建网格（renderGrid 只在 idle 分支）
  const r = src('rhythm');
  const refresh = r.slice(r.indexOf('refreshLang(){'));
  assert.ok(refresh.indexOf('renderGrid()') > refresh.indexOf("this.phase==='idle'"),
    'rhythm 的 renderGrid 必须受 idle 条件保护');
});

test('V431-9 A1 渲染路径无中文面量（数据表 zh-CN fallback 与状态值白名单除外）', () => {
  /* 数据表保留中文作 zh-CN 回退与既有单测契约，但它们只出现在对象定义行；
     渲染表达式（textContent/innerHTML/toast/setAttribute/title 赋值）不得再输出中文。
     '通用' 是和弦映射的状态值比较（c.dataset.c==='通用'），不是 UI 输出。 */
  const allow = new Set(['通用']);
  const render = /textContent\s*=|innerHTML\s*=|toast\(|setAttribute\(|\.title\s*=|placeholder\s*=/;
  const lit = /['"`]([^'"`\n]*)['"`]/g;
  for (const m of MODULES) {
    const s = src(m).replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = [];
    s.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || line.includes('console.')) return;
      if (!render.test(line)) return;
      for (const x of line.matchAll(lit)) {
        if (CJK.test(x[1]) && !allow.has(x[1])) bad.push(`L${i + 1}:${x[1].slice(0, 30)}`);
      }
    });
    assert.deepStrictEqual(bad, [], `${m} 渲染路径残留中文面量：${bad.join(' | ')}`);
  }
});

test('V431-10 A6 R1 移动端语言入口不回退（双注入 + 44px 定宽）', () => {
  const i18n = read('assets/js/core/i18n.js');
  const theme = read('assets/js/core/theme-switch.js');
  assert.ok(i18n.includes("make(document.querySelector('.sidebar'))"));
  assert.ok(i18n.includes("make(document.querySelector('.topbar'))"));
  assert.ok(i18n.includes('flex:0 0 44px'));
  assert.ok(theme.includes("parent.classList.contains('topbar')"));
  assert.ok(theme.includes('flex:0 0 44px'));
});

test('V431-11 V4.3.1 data-i18n-title 运行时维度 + 挂载看门纳入', () => {
  const i18n = read('assets/js/core/i18n.js');
  assert.ok(i18n.includes("querySelectorAll('[data-i18n-title]')"), '缺少 title 维度扫描');
  assert.ok(i18n.includes('el.dataset.i18nTitle'), 'title 必须按 dataset 取键');
  const html = read('app.html');
  const titles = [...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(titles.length >= 4, `BPM 微调按钮应补挂 title，实测 ${titles.length}`);
  for (const k of titles) assert.ok(k in ZH, `title 挂了不存在的键 ${k}`);
  const mount = read('test/i18n-mount.test.js');
  assert.ok(mount.includes('data-i18n-title'), 'MOUNT 看门必须纳入 title 维度');
});

/* ------------------------------------------------------------
   A4：行为级——真实模块在 gs:lang 下刷新文本且状态不丢
   ------------------------------------------------------------ */

test('V431-12 A4 行为级：和弦库切语言刷新进行名，且保留选中和弦与播放高亮', async () => {
  await imp('test/_gp-stubs.mjs');
  const listeners = [];
  globalThis.document.addEventListener = (ev, fn) => { if (ev === 'gs:lang') listeners.push(fn); };
  let LANG = 'zh-CN';
  const dict = () => DICT[LANG];
  globalThis.t = (k) => dict()[k] ?? k;
  globalThis.gsI18n = { tF: (k, p) => tF(dict(), k, p) };
  await imp('assets/js/data/chords.js');
  const { ChordLib } = await imp('assets/js/modules/chord-lib.js');

  assert.ok(listeners.length >= 1, 'chord-lib 必须注册 gs:lang 监听');
  ChordLib.sel = 'C';
  ChordLib.progPlaying = 2;
  const selBefore = ChordLib.sel, playBefore = ChordLib.progPlaying;

  LANG = 'en';
  listeners.forEach((fn) => fn({ detail: { lang: 'en' } }));

  assert.strictEqual(ChordLib.sel, selBefore, '切语言不得丢选中和弦');
  assert.strictEqual(ChordLib.progPlaying, playBefore, '切语言不得丢播放高亮状态');
  // 进行名取词确实切换到英文（抽查一个真实词条）
  assert.strictEqual(globalThis.t('chords.prog.p1.name'), EN['chords.prog.p1.name']);
  LANG = 'zh-CN';
  listeners.forEach((fn) => fn({ detail: { lang: 'zh-CN' } }));
  assert.strictEqual(globalThis.t('chords.prog.p1.name'), ZH['chords.prog.p1.name']);
});

test('V431-13 A1 词典看门：EN/KO 译文不得夹带中文，节奏符号统一用 R=', () => {
  /* 白名单均为设计允许：
     - en.lang.title = 'Language / 语言'：语言入口双标签（A6 验收口径）
     - ko.songbook.source.jitashe = 'Jitashe(吉他社)'：曲谱来源名保持原文（红线 A3） */
  const allow = { en: new Set(['lang.title']), ko: new Set(['songbook.source.jitashe']) };
  for (const lang of ['en', 'ko']) {
    const bad = Object.keys(DICT[lang])
      .filter((k) => !allow[lang].has(k) && CJK.test(DICT[lang][k]));
    assert.deepStrictEqual(bad, [],
      `${lang} 词典译文夹带中文：${bad.map((k) => `${k}=${DICT[lang][k]}`).join(' | ')}`);
  }
  /* 日文合法使用汉字，故只针对「把中文『根』当作 UI 符号」这一具体缺陷设防：
     四语说明须统一使用 R=（与 resolveAction 的 label 一致）。 */
  for (const lang of ['zh-CN', 'en', 'ja', 'ko']) {
    const s = DICT[lang]['rhythm.help.symbolsBody'];
    assert.ok(/R\s*=/.test(s), `${lang} 节奏符号说明应使用 R= 而非中文「根」`);
    assert.ok(!s.includes('根=') && !s.includes('=根'),
      `${lang} 节奏符号说明仍把中文「根」当符号：${s}`);
  }
});
