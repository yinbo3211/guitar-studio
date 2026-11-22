/* ============================================================
   六弦工坊 V4.3.3 · test/v433-scale-tip.test.js
   ------------------------------------------------------------
   按用户反馈：音阶跟弹的「弹错报错」不精确且降低练琴效率，整体回退到
   V4.3.1 的「弹对才推进、弹错静默重置」；改用正向引导——跟弹提示条
   明确告知「下一音该弹第几弦（第几品）」。

   T1 组为真实行为级：在测试桩下 import scale.js 并驱动 showTarget /
   refreshLang，验证 DOM 文本与语言切换重算，不只做静态源码断言。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const SCALE_SRC = read('assets/js/modules/scale.js');
const HTML = read('app.html');
const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const D = {};
for (const lang of LANGS) D[lang] = (await imp(`assets/js/i18n/${lang}.js`)).DICT;
const CJK = /[\u4e00-\u9fff]/;
const slots = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort();

/* ---------- 测试桩引导 ---------- */
async function boot() {
  await imp('test/_gp-stubs.mjs');
  // DOM 桩未实现浏览器原生的 scrollIntoView（markNow 会调用）
  const proto = Object.getPrototypeOf(document.createElement('div'));
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = function () {};
  await imp('assets/js/data/scales.js');
  const { Scale } = await imp('assets/js/modules/scale.js');
  globalThis.window = globalThis;
  return Scale;
}
function setLang(lang) {
  const d = D[lang];
  globalThis.t = (k) => (d[k] ?? k);
  globalThis.gsI18n = {
    tF(k, pairs) {
      let s = d[k] ?? k;
      for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
      return s;
    },
  };
}
const textOf = (sel) => document.querySelector(sel)?.textContent;
function stage(Scale, c, mode = 'follow') {
  Scale.inited = true;
  Scale.mode = mode;
  Scale.seq = [c]; Scale.cells = [c]; Scale.i = 0;
  Scale._langText = {};
  Scale.cooldown = 0;
}

/* ---------- T1-1 四语词条 ---------- */
test('T1-1 scx.tip.next 四语齐全、占位符一致、EN/KO 不夹带中文', () => {
  const base = slots(D['zh-CN']['scx.tip.next']);
  assert.deepStrictEqual(base, ['{f}', '{s}'], '中文模板应含 {s} 弦号与 {f} 品位');
  for (const lang of LANGS) {
    const v = D[lang]['scx.tip.next'];
    assert.ok(v && v.trim(), `${lang} 缺失 scx.tip.next`);
    assert.deepStrictEqual(slots(v), base, `${lang} 占位符集合不一致`);
  }
  assert.ok(!CJK.test(D.en['scx.tip.next']), '英文译文夹带汉字');
  assert.ok(!CJK.test(D.ko['scx.tip.next']), '韩文译文夹带汉字');
  assert.notStrictEqual(D.en['scx.tip.next'], D['zh-CN']['scx.tip.next'], '英文未翻译');
  assert.notStrictEqual(D.ja['scx.tip.next'], D['zh-CN']['scx.tip.next'], '日文未翻译');
  assert.notStrictEqual(D.ko['scx.tip.next'], D['zh-CN']['scx.tip.next'], '韩文未翻译');
});

/* ---------- T1-2 showTarget 行为级 ---------- */
test('T1-2 showTarget 行为级：提示条明确给出弦号，且与 #scxPos 口径一致', async () => {
  const Scale = await boot();
  setLang('zh-CN');
  const c = { s: 0, f: 3, midi: 43, pc: 7 };     // s=0 → 第 6 弦，3 品
  stage(Scale, c);
  Scale.showTarget();
  assert.strictEqual(textOf('#scxTip'), '下一音在第 6 弦（3品）', '提示条未说明弦号');
  assert.strictEqual(textOf('#scxPos'), '6弦 · 3品', '位置栏口径被破坏');
  assert.strictEqual(textOf('#scxProg'), '1/1');
  assert.deepStrictEqual(Scale._langText['#scxTip'],
    { key: 'scx.tip.next', pairs: { s: 6, f: '3品' } }, '未记录取词来源');
  assert.ok(SCALE_SRC.includes('showTip(c)'), 'showTarget 未委托 showTip');
});

/* ---------- T1-3 四语切换重算（含嵌套品位翻译） ---------- */
test('T1-3 行为级：四语切换后提示条按当前语言重算，不残留上一语言品位名', async () => {
  const Scale = await boot();
  const c = { s: 0, f: 3, midi: 43, pc: 7 };
  stage(Scale, c);
  const expect = {
    'zh-CN': '下一音在第 6 弦（3品）',
    en: 'Next note: String 6 (fret 3)',
    ja: '次の音は 6弦（3フレット）',
    ko: '다음 음: 6번 줄 (3프렛)',
  };
  setLang('zh-CN'); Scale.showTarget();
  assert.strictEqual(textOf('#scxTip'), expect['zh-CN']);
  for (const lang of ['en', 'ja', 'ko', 'zh-CN']) {
    setLang(lang);
    Scale.refreshLang();
    assert.strictEqual(textOf('#scxTip'), expect[lang], `${lang} 提示条未随语言重算`);
    assert.ok(!CJK.test(textOf('#scxTip')) || lang === 'zh-CN' || lang === 'ja',
      `${lang} 提示条夹带中文`);
  }
});

/* ---------- T1-4 停止跟弹后 + 空弦口径 ---------- */
test('T1-4 行为级：停止跟弹后切语言仍重算；空弦走 rhythm.open 四语', async () => {
  const Scale = await boot();
  const c0 = { s: 5, f: 0, midi: 64, pc: 4 };    // 第 1 弦空弦
  stage(Scale, c0);
  setLang('zh-CN'); Scale.showTarget();
  assert.strictEqual(textOf('#scxTip'), '下一音在第 1 弦（空弦）');
  Scale.mode = 'idle';
  setLang('en'); Scale.refreshLang();
  assert.strictEqual(textOf('#scxTip'), 'Next note: String 1 (open)',
    '停止跟弹后提示条仍在，切语言必须重算');
});

/* ---------- T1-5 回退契约与死词条 ---------- */
test('T1-5 静态：弹错反馈全链路已移除，新键被真实引用（无死词条）', () => {
  for (const bad of ['flashMiss', 'missN', 'missUntil', 'missTimer', 'missTipTimer',
                     'scx.wrong', 'scx.tip.wrong', "add('miss')", 'AudioEngine.tone(196']) {
    assert.ok(!SCALE_SRC.includes(bad), `scale.js 仍残留 ${bad}`);
  }
  assert.ok(!HTML.includes('scxShake') && !HTML.includes('.scx-cell.miss'),
    'app.html 仍残留弹错闪红/抖动样式');
  // MOUNT-3 口径：新键必须以字面量在 assets/js 中被引用
  assert.ok(SCALE_SRC.includes("'scx.tip.next'"), 'scx.tip.next 未在 JS 中字面量引用，会判死词条');
  for (const lang of LANGS) {
    assert.ok(!('scx.wrong' in D[lang]), `${lang} 仍残留 scx.wrong`);
    assert.ok(!('scx.tip.wrong' in D[lang]), `${lang} 仍残留 scx.tip.wrong`);
  }
  // 判定算法保持 V4.3.1：连续 2 帧匹配推进，不匹配仅静默重置
  assert.ok(/if\(this\.candN>=2\)/.test(SCALE_SRC), '2 帧推进阈值被改动');
  assert.ok(/else\{\s*this\.cand=null;\s*\}/.test(SCALE_SRC), '不匹配分支不是静默重置');
});

/* ---------- T1-6 四语键集合 ---------- */
test('T1-6 四语键集合仍完全一致', () => {
  const base = Object.keys(D['zh-CN']).sort();
  assert.ok(base.length >= 697, `对象键数应 >= 697，实测 ${base.length}`);
  for (const lang of ['en', 'ja', 'ko']) {
    assert.deepStrictEqual(Object.keys(D[lang]).sort(), base, `${lang} 键集合不一致`);
  }
});
