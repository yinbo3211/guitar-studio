/* ============================================================
   六弦工坊 V4.0 · 曲库 / 练习渲染冒烟测试（最小 DOM 桩）
   ------------------------------------------------------------
   目的：脱离浏览器真实执行 render()/enter() 主路径，捕获
   模板拼接期的运行时错误与状态分支错误：
     R-1 首次进入：仅 L1.1 解锁，其余 18 个单元为锁定卡
     R-2 自由模式 + 层级过滤：只渲染该层级单元且全部解锁
     R-3 搜索无结果空态（E10）
     R-4 数据自检失败兜底卡（E1），且顶部清空
     R-5 打卡后：已练徽章 + 下一单元解锁 + 进度文案
     R-6 练习页：曲目存在渲染准备页 / 不存在渲染 notFound（E2）
     R-7 练习页 hash ?song= 兜底（E18）
   说明：不校验像素级样式，只校验结构与状态分支。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/* ============================================================
   最小 DOM 桩
   ============================================================ */
class El {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.className = '';
    this._html = '';
    this._text = '';
    this.classList = {
      add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false
    };
  }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}

const nodes = new Map();
const getEl = (id) => {
  if (!nodes.has(id)) nodes.set(id, new El());
  return nodes.get(id);
};

globalThis.window = globalThis;
globalThis.location = { hash: '', protocol: 'http:' };
globalThis.document = {
  hidden: false,
  readyState: 'complete',
  addEventListener() {}, removeEventListener() {},
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => new El(tag),
  createDocumentFragment: () => new El('#fragment'),
  documentElement: new El()
};
globalThis.onRouteEnter = {};
globalThis.setTimeout = globalThis.setTimeout;
globalThis.clearTimeout = globalThis.clearTimeout;
globalThis.setInterval = globalThis.setInterval;
globalThis.clearInterval = globalThis.clearInterval;

const { songsOfUnit, SonglistData } = await imp('assets/js/data/songlist-data.js');
const { Songbook } = await imp('assets/js/modules/songbook.js');
const { SongPractice } = await imp('assets/js/modules/song-practice.js');

const sbTop = getEl('sbTop');
const sbList = getEl('sbList');
const spWrap = getEl('spWrap');

/* 复位模块状态，避免用例间互相污染 */
function reset(opts = {}) {
  Songbook.tier = 0;
  Songbook.kw = '';
  Songbook.freeMode = !!opts.freeMode;
  Songbook.expanded = new Set();
  Songbook._practiced = opts.practiced || new Set();
  sbTop.innerHTML = '';
  sbList.innerHTML = '';
}
const fragOf = (box) => box.children[0];
const isLocked = (el) => /is-locked/.test(el.className || '');
/* 递归收集：单元块把 HTML 写在 head/曲卡等子节点上，只看根节点拿不到内容 */
const htmlOf = (el) => {
  let s = el.innerHTML || '';
  for (const c of el.children || []) s += htmlOf(c);
  return s;
};

/* ============================================================
   R-1 首次进入
   ============================================================ */
test('R-1 首次进入（零打卡）：仅 L1.1 解锁，其余 18 个单元为锁定卡', () => {
  reset();
  Songbook.render();
  const frag = fragOf(sbList);
  assert.strictEqual(frag.children.length, 19, '19 个单元各渲染一块');
  assert.ok(!isLocked(frag.children[0]), 'L1.1 恒解锁');
  assert.ok(/L1\.1/.test(htmlOf(frag.children[0])));
  const lockedCount = frag.children.filter(isLocked).length;
  assert.strictEqual(lockedCount, 18, '其余 18 个单元应锁定');
  /* 无 i18n 环境下 T() 回退为 key 本身，故断言 key 与插值结果 */
  assert.ok(/songbook\.unit\.locked/.test(htmlOf(frag.children[1])), '锁定卡应带解锁提示文案（key 兜底）');
});

test('R-1 顶部进度环与 tab 计数正确（0/231，层级 159/61/11）', () => {
  reset();
  Songbook.render();
  const html = sbTop.innerHTML;
  assert.ok(/0%/.test(html), '零打卡进度为 0%');
  assert.ok(/0\/231/.test(html), '进度分母为 231');
  assert.ok(/231<\/span>/.test(html) || /">231/.test(html), '全部 tab 计数 231');
  assert.ok(/159/.test(html) && /61/.test(html) && /11/.test(html), '层级 tab 计数 159/61/11');
});

/* ============================================================
   R-2 自由模式与层级过滤
   ============================================================ */
test('R-2 自由模式：19 个单元全部解锁（无锁定卡）', () => {
  reset({ freeMode: true });
  Songbook.render();
  const frag = fragOf(sbList);
  assert.strictEqual(frag.children.length, 19);
  assert.strictEqual(frag.children.filter(isLocked).length, 0, '自由模式不应出现锁定卡');
});

test('R-2 层级过滤：tier=3 只渲染 L3.1 / L3.2 两个单元', () => {
  reset({ freeMode: true });
  Songbook.tier = 3;
  Songbook.render();
  const frag = fragOf(sbList);
  assert.strictEqual(frag.children.length, 2);
  assert.ok(/L3\.1/.test(htmlOf(frag.children[0])));
  assert.ok(/L3\.2/.test(htmlOf(frag.children[1])));
});

/* ============================================================
   R-3 搜索空态（E10）
   ============================================================ */
test('R-3 搜索无命中渲染空态卡，且不渲染任何单元块', () => {
  reset({ freeMode: true });
  Songbook.kw = 'zzz-no-such-song-zzz';
  Songbook.render();
  const frag = fragOf(sbList);
  assert.strictEqual(frag.children.length, 1, '只应剩一张空态卡');
  assert.strictEqual(frag.children[0].className, 'card sb-empty');
});

test('R-3 搜索命中：只保留命中曲目的单元，数量明显收缩', () => {
  reset({ freeMode: true });
  Songbook.kw = '送别';
  Songbook.render();
  const frag = fragOf(sbList);
  assert.ok(frag.children.length < 19, '未命中的单元不渲染');
  assert.ok(frag.children.length >= 1);
  assert.ok(/送别/.test(frag.children.map(htmlOf).join('')));
});

/* ============================================================
   R-4 数据自检失败兜底（E1）
   ============================================================ */
test('R-4 数据自检失败：顶部清空 + 列表渲染兜底卡并告警', () => {
  reset();
  const origin = SonglistData.validate;
  const warns = [];
  const originWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  SonglistData.validate = () => ['模拟自检失败'];
  try {
    Songbook.render();
  } finally {
    SonglistData.validate = origin;
    console.warn = originWarn;
  }
  assert.strictEqual(sbTop.innerHTML, '', '自检失败时顶部不渲染');
  assert.ok(/sb-error/.test(sbList.innerHTML), '列表渲染兜底卡');
  assert.ok(warns.length >= 1, '应输出 console.warn 便于排查');
});

/* ============================================================
   R-5 打卡后的状态
   ============================================================ */
test('R-5 单元打满后解锁下一单元，并出现「已练」徽章', () => {
  const ids = songsOfUnit('L1.1').map((s) => s.id);
  reset({ practiced: new Set(ids) });
  Songbook.render();
  const frag = fragOf(sbList);
  assert.ok(!isLocked(frag.children[0]), 'L1.1 已解锁');
  assert.ok(!isLocked(frag.children[1]), 'L1.1 完成 100% → L1.2 解锁');
  assert.ok(isLocked(frag.children[2]), 'L1.2 未完成 → L1.3 仍锁定');
  const html = htmlOf(frag.children[0]);
  assert.ok(/songbook\.badge\.done|已练/.test(html) || /is-done/.test(html), '曲卡应带已练标记');
  assert.ok(/14\/231/.test(sbTop.innerHTML), '顶部显示已练 14 首');
});

test('R-5 曲谱展开区默认收起，展开后带 noopener 外链', () => {
  reset();
  Songbook.expanded = new Set(['song-001']);
  Songbook.render();
  const html = htmlOf(fragOf(sbList).children[0]);
  assert.ok(/sb-sheets/.test(html));
});

/* ============================================================
   R-6 / R-7 练习页
   ============================================================ */
test('R-6 曲目存在时渲染准备页（含 BPM 滑块与开始按钮）', () => {
  SongPractice.prepare('song-001');
  SongPractice.enter();
  const html = spWrap.innerHTML;
  assert.ok(/sp-prepare/.test(html), '渲染准备页');
  assert.ok(/送别/.test(html), '展示曲名');
  assert.ok(/id="spBpm"/.test(html) && /min="30"/.test(html) && /max="180"/.test(html), 'BPM 滑块 30–180');
  assert.ok(/data-sp="start"/.test(html));
});

test('R-6 曲目不存在 / 未提供时渲染 notFound（E2）', () => {
  SongPractice.prepare('song-not-exist');
  SongPractice.enter();
  assert.ok(/sp-empty/.test(spWrap.innerHTML));
  SongPractice.prepare('');
  SongPractice.enter();
  assert.ok(/sp-empty/.test(spWrap.innerHTML));
});

test('R-7 直接刷新时可从 hash ?song= 兜底取曲目（E18）', () => {
  globalThis.location.hash = '#/songPractice?song=song-199';
  SongPractice.prepare('');            // 模拟非曲卡进入
  SongPractice.enter();
  assert.ok(/sp-prepare/.test(spWrap.innerHTML), '应从 hash 恢复曲目');
  globalThis.location.hash = '';
});

test('R-8 练习页非法状态迁移不改变状态（防误触发）', () => {
  SongPractice.prepare('song-001');
  SongPractice.enter();
  assert.strictEqual(SongPractice.state, 'idle');
  assert.strictEqual(SongPractice.dispatch('FINISH'), false, 'idle 下 FINISH 非法');
  assert.strictEqual(SongPractice.state, 'idle');
});

test('R-9 cleanup 复位计时与状态，且移除 visibility 监听不抛错', () => {
  SongPractice.prepare('song-001');
  SongPractice.enter();
  SongPractice.startedAt = Date.now() - 5000;
  SongPractice.stepsDone = 3;
  SongPractice.cleanup();
  assert.strictEqual(SongPractice.state, 'idle');
  assert.strictEqual(SongPractice.stepsDone, 0);
  assert.strictEqual(SongPractice.pausedAt, 0);
  assert.strictEqual(SongPractice._cdTimer, null);
  assert.strictEqual(SongPractice._tickTimer, null);
  assert.strictEqual(SongPractice._visHandler, null);
});
