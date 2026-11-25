/* ============================================================
   六弦工坊 V4.4 · test/sheet-editor.test.js
   ------------------------------------------------------------
   编辑器纯逻辑（T04–T07）：撤销栈合并/上限/光标恢复、联想排序、
   校验分级、表单→SheetDoc 钳制、调差换算、四语枚举、
   源码契约（teardown / gs:lang / 播放器停播）、预览 XSS 转义。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §6 F-06/F-07/F-09 / §10.1。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const E = await import('../assets/js/modules/sheet-editor.js');
const F = await import('../assets/js/data/sheet-format.js');
const P = await import('../assets/js/modules/sheet-player.js');

test('ED-1 UndoStack 连续键入 800ms 内合并为一个快照', () => {
  const u = new E.UndoStack(100, 2 * 1024 * 1024, 800);
  u.reset('a', 0);
  u.push('ab', 2, { merge: true, now: 1000 });
  u.push('abc', 3, { merge: true, now: 1100 });
  assert.strictEqual(u.snaps.length, 2, '初始 + 合并后 1 步');
  assert.strictEqual(u.snaps[1].text, 'abc');
  u.push('abcd', 4, { merge: true, now: 3000 });
  assert.strictEqual(u.snaps.length, 3, '超过静默窗口另起一步');
});

test('ED-2 UndoStack 离散操作（插入面板/联想确认/粘贴）不合并', () => {
  const u = new E.UndoStack();
  u.reset('a', 0);
  u.push('aX', 2, { discrete: true, now: 1000 });
  u.push('aXY', 3, { discrete: true, now: 1010 });
  assert.strictEqual(u.snaps.length, 3);
  assert.strictEqual(u.canUndo, true);
  assert.strictEqual(u.canRedo, false);
});

test('ED-3 UndoStack 100 步上限，超出丢最旧且索引不越界', () => {
  const u = new E.UndoStack(5);
  u.reset('0', 0);
  for (let i = 1; i <= 20; i++) u.push('v' + i, 0, { discrete: true, now: 1000 + i * 1000 });
  assert.strictEqual(u.snaps.length, 5);
  assert.strictEqual(u.index, 4);
  assert.strictEqual(u.snaps[0].text, 'v16');
  assert.ok(u.canUndo);
});

test('ED-4 UndoStack 2MB 内存上限丢最旧快照', () => {
  const u = new E.UndoStack(100, 4096);
  u.reset('x'.repeat(1000), 0);
  for (let i = 0; i < 10; i++) u.push('y'.repeat(1000) + i, 0, { discrete: true, now: 1000 + i * 1000 });
  const bytes = u.snaps.reduce((n, s) => n + s.text.length * 2, 0);
  assert.ok(bytes <= 4096, `实际 ${bytes} 字节应 ≤ 4096`);
  assert.ok(u.index >= 0 && u.index < u.snaps.length);
});

test('ED-5 undo / redo 光标恢复，首次撤销有效，clearRedo 清空重做栈', () => {
  const u = new E.UndoStack();
  u.reset('hello', 5);
  const a = u.undo('hello world', 11);
  assert.deepStrictEqual(a, { text: 'hello', caret: 5 }, '未入栈的当前编辑先补一步再回退');
  const b = u.redo();
  assert.strictEqual(b.text, 'hello world');
  assert.strictEqual(u.canRedo, false);
  u.clearRedo();
  assert.strictEqual(u.canRedo, false);
  assert.strictEqual(u.canUndo, true, '撤销栈保留');
});

test('ED-6 validationToView 分级：阻断级与警告级各自映射词条、保留行号', () => {
  const ok = E.validationToView(F.validateSheetText('{title:t}\n[C]啦'));
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.blocking, []);
  const bad = E.validationToView(F.validateSheetText('[C歌词'));
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.blocking[0].msg, 'sheet.ed.validate.block');
  const warn = E.validationToView(F.validateSheetText('{title:t}\n[Cq]啦'));
  assert.strictEqual(warn.warnings[0].code, 'bad-chord');
  assert.strictEqual(warn.warnings[0].msg, 'sheet.ed.warn.badChord');
  assert.strictEqual(warn.warnings[0].line, 2);
});

test('ED-7 suggestFor 调内 diatonic 优先，前缀过滤与 limit 生效', () => {
  const all = E.suggestFor('', 'C', {}, 24);
  assert.deepStrictEqual(all.slice(0, 4).map((c) => c.name), ['C', 'Dm', 'Em', 'F']);
  const q = E.suggestFor('F#', 'C', {}, 8);
  assert.ok(q.length > 0 && q.every((c) => c.name.startsWith('F#')));
  assert.strictEqual(E.suggestFor('C', 'C', {}, 1).length, 1);
  const freq = E.suggestFor('', 'C', { G7: 1000 }, 24);
  assert.ok(Array.isArray(freq) && freq.length <= 24);
});

test('ED-8 formToDoc 字段钳制与初始模板文本', () => {
  const d = E.formToDoc({
    title: 'T'.repeat(80), artist: 'A', transcriber: 'X'.repeat(40),
    key: 'G', originalKey: 'C', tempo: 9999, timeSig: '3/4', capo: 99,
    language: '国语', style: '民谣', arrange: '原创', tags: ['a', 'b', 'c', 'd'],
    patternId: 'pick-folk-a',
  });
  assert.strictEqual(d.title.length, 60);
  assert.strictEqual(d.transcriber.length, 30);
  assert.strictEqual(d.tempo, F.SHEET_ENUMS.TEMPO_MAX);
  assert.strictEqual(d.capo, F.SHEET_ENUMS.CAPO_MAX);
  assert.strictEqual(d.tags.length, 3);
  assert.strictEqual(d.timeSig, '3/4');
  assert.ok(d.text.includes('{title:' + d.title + '}'));
  assert.ok(d.text.includes('{key:G}'));
  assert.ok(d.text.includes('{name:主歌}'));
  assert.strictEqual(F.metaFromText(d.text).title, d.title, '表单⇔头部双向同步闭环');
});

test('ED-9 keyDiff 取最小半音差（含跨八度归一）', () => {
  assert.strictEqual(E.keyDiff('C', 'C'), 0);
  assert.strictEqual(E.keyDiff('C', 'D'), 2);
  assert.strictEqual(E.keyDiff('C', 'Bb'), -2);
  assert.strictEqual(E.keyDiff('C', 'B'), -1);
  assert.strictEqual(E.keyDiff('未知', 'C'), 0);
});

test('ED-10 enumItems 四语：宿主 t 生效时返回译文，长度与枚举一致', () => {
  const savedWin = globalThis.window, savedT = globalThis.t;
  try {
    globalThis.window = globalThis;
    globalThis.t = (k) => (k === 'sheet.enum.langs' ? 'Instrumental|Mandarin|Cantonese|Hokkien|English|French|Japanese|Korean|Thai|Other' : k);
    const items = E.enumItems('lang');
    assert.strictEqual(items.length, 10);
    assert.strictEqual(items[0].value, '纯音乐', '存储值保持原文');
    assert.strictEqual(items[0].label, 'Instrumental', '展示值走当前语言');
    assert.deepStrictEqual(E.enumItems('nope'), []);
  } finally {
    if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin;
    if (savedT === undefined) delete globalThis.t; else globalThis.t = savedT;
  }
});

test('ED-11 编辑器源码契约：路由注册 / teardown / 语言联动 / 停播', () => {
  const src = read('assets/js/modules/sheet-editor.js');
  assert.ok(/onRouteEnter\.sheetEditor\s*=/.test(src), '必须注册 sheetEditor 路由');
  assert.ok(/teardown\(\)\s*\{/.test(src), '必须实现 teardown');
  assert.ok(src.includes("document.addEventListener('gs:lang'"), '必须监听语言切换');
  assert.ok(/SheetPlayer\.stop\(\)/.test(src), '离开必须停播');
  assert.ok(/writeDraft\(/.test(src), '脏状态必须写草稿');
  assert.ok(/beforeunload/.test(src), '必须有离开保护');
  const router = read('assets/js/core/router.js');
  assert.ok(/SheetEditor\.teardown/.test(router), 'cleanupModules 必须调用编辑器 teardown');
  assert.ok(/SheetPlayer\.stop\(\)/.test(router), 'cleanupModules 必须停试听');
});

test('ED-12 预览渲染：XSS 全转义、逐字高亮容器、段落/节奏型/重复标记', () => {
  const evil = '{title:<img src=x onerror=alert(1)>}\n{artist:"&<script>}\n{key:C}\n{name:主歌}\n{rhythm:strum-pop-a}\n[C]啦[Am]啦 {x2}';
  const html = P.renderSheetHtml(evil);
  /* esc() 只转义 < > & " '，其余字符（含 =、空格）作为纯文本保留，不构成注入 */
  assert.ok(!/<img\b/i.test(html) && !/<script\b/i.test(html), '用户输入不得进入 DOM');
  assert.ok(html.includes('&lt;img') && html.includes('&amp;'));
  assert.ok(/class="sbp-word"/.test(html), '逐字容器存在');
  assert.ok(/class="sbp-section"/.test(html));
  assert.ok(/sbp-rhythm-badge/.test(html));
  assert.ok(/sbp-repeat/.test(html));
  const safe = P.renderSheetHtml('{title:t}\n[C]啦', { transpose: 2 });
  assert.ok(/class="sbp-chords">D/.test(safe), '+2 半音渲染层即时移调为 D');
  assert.ok(!safe.includes('[C]') && !safe.includes('[D]'), '渲染只输出和弦名，不回写源文本标记');
});

test('ED-13 节奏型名称按当前语言动态取词（V4.4.3 同步补修）', () => {
  const src = read('assets/js/modules/sheet-editor.js');
  /* 不得在模块加载时固化语言：否则以 EN 启动后切回 ZH 仍是英文，反之亦然 */
  assert.ok(!/const PATTERN_NAME_MAP\s*=/.test(src) && !/PATTERN_NAME_MAP\[/.test(src), '不得保留模块加载时固化的名称映射');
  assert.ok(/const patternLabel = \(id\) =>/.test(src), '必须提供按当前语言取词的函数');
  assert.ok(/const v = T\(p\.nk\)/.test(src), '必须调用 T(nk) 走四语词条');
  assert.ok(/v !== p\.nk/.test(src), '词条缺失须回退 rhythm-data 中文名，不得显示词条键');
  assert.ok(/getElementById\('sbeFPattern'\)[\s\S]{0,220}textContent = patternLabel\(o\.value\)/.test(src),
    'refreshLang 必须刷新表单下拉名称，且不重建 <option>（保住选中态）');
  assert.ok(/SHEET_ENUMS\.PATTERN_IDS\.map\(patternLabel\)/.test(src), '表单下拉显示可读名');
  assert.ok(/data-ins="rhythm"[\s\S]{0,160}patternLabel\(id\)/.test(src), '插入面板显示可读名');
  assert.ok(/data-ins="rhythm"[^>]*title="\$\{esc\(id\)\}"/.test(src), '原始 ID 仅保留在 title 供核对');
  /* 远端 V4.4.3 的模板告警回归仍在 */
  const tpl = F.newSheetTemplate({ title: 'T', artist: 'A' });
  assert.ok(!tpl.includes('触发和弦联想'), '默认模板不得含裸 [ 占位文案');
  assert.deepStrictEqual(F.validateSheetText(tpl).warnings, [], '新建模板应零告警');
});
