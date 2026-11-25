/* ============================================================
   六弦工坊 V4.4 · test/sheet-format.test.js
   ------------------------------------------------------------
   gs-chord v1 标记语言（T01）回归：行分类 / 切分 / 头部 / 容错 /
   拍位 / harmony / 转调 / capo / 桥接 / 序列化 / x2 / 性能 /
   表单⇔头部双向 / 联想排序 / 校验分级。
   权威口径：docs/V4.4_SHEET_STUDIO_SPEC.md §5 / §10.1 SF-01..SF-12。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import * as F from '../assets/js/data/sheet-format.js';

const DEMO = [
  '{title:七里香}', '{artist:周杰伦}', '{transcriber:}',
  '{key:C}', '{originalKey:C}', '{tempo:70}', '{time:4/4}', '{capo:0}',
  '{rhythm:strum-pop-a}', '{meta:语言:国语}', '{meta:风格:流行}',
  '{meta:编配:高还原}', '{meta:标签:动漫音乐,考级}',
  '{comment:女生变调夹 2 品}', '',
  '{name:主歌}', '{rhythm:pick-folk-a}',
  '[C]窗外的麻[C]雀 在[C]电线杆上多嘴',
  '[Em]你说这一句 [Am]很有夏天的感觉', '',
  '{name:尾奏}', '[C] [Em] [F] [G] [C]',
].join('\n');

test('SF-01 行类型判定（§5.7 顺序敏感，含 ChordPro 未知标记降级）', () => {
  assert.strictEqual(F.classifyLine('{name:主歌}'), 'section');
  assert.strictEqual(F.classifyLine('#主歌'), 'section');
  assert.strictEqual(F.classifyLine('{rhythm:strum-pop-a}'), 'rhythm');
  assert.strictEqual(F.classifyLine('{comment:提示}'), 'comment');
  assert.strictEqual(F.classifyLine('#>提示'), 'comment');
  assert.strictEqual(F.classifyLine('[C] [G]'), 'chord-line');
  assert.strictEqual(F.classifyLine('[C]歌词'), 'lyric');
  assert.strictEqual(F.classifyLine('{title:x}'), 'meta');
  assert.strictEqual(F.classifyLine('{soc}'), 'meta');
  assert.strictEqual(F.classifyLine('   '), 'blank');
});

test('SF-02 和弦切分与 CJK 显示宽度', () => {
  const segs = F.tokenizeLine('[C]窗外的麻[C]雀');
  assert.strictEqual(segs.length, 4);
  assert.strictEqual(segs[0].chord, 'C');
  assert.strictEqual(segs[2].chord, 'C');
  assert.strictEqual(segs[2].col, 8, 'CJK 四字 = 8 半角宽');
  assert.strictEqual(F.displayWidth('窗外A'), 5);
  assert.strictEqual(F.displayWidth('A'), 1);
});

test('SF-03 头部元信息解析（含 meta 分类、tags、未知标记 warning）', () => {
  const ast = F.parseSheetText(DEMO);
  assert.strictEqual(ast.meta.title, '七里香');
  assert.strictEqual(ast.meta.artist, '周杰伦');
  assert.strictEqual(ast.meta.tempo, 70);
  assert.strictEqual(ast.meta.time, '4/4');
  assert.strictEqual(ast.meta.language, '国语');
  assert.strictEqual(ast.meta.style, '流行');
  assert.strictEqual(ast.meta.arrange, '高还原');
  assert.deepStrictEqual(ast.meta.tags, ['动漫音乐', '考级']);
  assert.strictEqual(ast.meta.rhythm, 'strum-pop-a', '段落级 {rhythm} 不得覆盖头部默认节奏型');
  const unknown = F.parseSheetText('{title:t}\n{soc}\n{column_break}\n[C]啦');
  assert.ok(unknown.warnings.some((w) => w.code === 'unknown-marker'));
  assert.strictEqual(F.serializeSheetText(unknown), '{title:t}\n{soc}\n{column_break}\n[C]啦', '未知标记保留原文不丢数据');
});

test('SF-04 容错：未闭合 / 未知和弦 / 空文本 / 斜线和弦', () => {
  assert.deepStrictEqual(F.parseSheetText('').lines, []);
  const unclosed = F.validateSheetText('[C歌词');
  assert.ok(unclosed.warnings.some((w) => w.code === 'unclosed-chord'));
  const bad = F.parseSheetText('{title:t}\n[Cq]啦');
  assert.ok(bad.warnings.some((w) => w.code === 'bad-chord'));
  assert.strictEqual(F.parseChord('Cq').valid, false);
  const slash = F.parseChord('F#m7/E');
  assert.strictEqual(slash.valid, true);
  assert.strictEqual(slash.rootPc, 6);
  assert.strictEqual(slash.type, 'min7');
  assert.strictEqual(slash.bassPc, 4);
});

test('SF-05 拍位映射单调递增，行拍数与显示宽度同源', () => {
  const ast = F.parseSheetText(DEMO);
  const rows = ast.lines.filter((l) => l.type === 'lyric' || l.type === 'chord-line');
  assert.ok(rows.length >= 3);
  for (const l of rows) assert.ok(l.beats >= 1 && l.beatStart >= 0 && l.totalWidth >= 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].beatStart > rows[i - 1].beatStart);
  assert.strictEqual(ast.beatCursor, rows.reduce((n, l) => n + l.beats, 0));
});

test('SF-06 harmony 推导：每小节二元组、空小节沿用、全谱无和弦回退主和弦', () => {
  const gp = F.expandSheetToGp({ id: 's1', title: 't', artist: 'a', key: 'C', tempo: 70, timeSig: '4/4', text: DEMO });
  assert.ok(Array.isArray(gp.harmony.chords) && gp.harmony.chords.length >= 2);
  for (const c of gp.harmony.chords) {
    assert.ok(Array.isArray(c) && c.length === 2);
    assert.ok(Number.isInteger(c[0]) && c[0] >= 0 && c[0] < 12);
    assert.ok(typeof c[1] === 'string');
  }
  const empty = F.expandSheetToGp({ id: 's2', title: 't', key: 'C', tempo: 60, timeSig: '4/4', text: '{title:t}\n{key:C}\n只有歌词没有和弦' });
  assert.deepStrictEqual(empty.harmony.chords, [[0, 'maj']]);
});

test('SF-07 转调：升号拼写、降号拼写、{key} 头同步、斜线和弦', () => {
  const src = '{key:C}\n[C]啦[Em]啦';
  assert.strictEqual(F.transposeSheetText(src, 2), '{key:D}\n[D]啦[F#m]啦');
  assert.strictEqual(F.transposeChord('C', 2), 'D');
  assert.strictEqual(F.transposeChord('Em', 2), 'F#m');
  assert.strictEqual(F.transposeSheetText(src, 0), src, '0 半音原样返回');
  assert.ok(/\]/.test(F.transposeSheetText('{key:C}\n[C/E]啦', 2)), '斜线和弦转调不抛异常');
  const flat = F.transposeChord('C', -1, 11);
  assert.ok(typeof flat === 'string' && flat.length > 0);
});

test('SF-08 capo 换算与推荐变调夹', () => {
  const c = F.capoChord('C', 2);
  assert.strictEqual(c.shapeName, 'D');
  assert.strictEqual(c.soundingName, 'C');
  assert.strictEqual(c.shapePc, 2);
  const sug = F.suggestCapoForKey('Eb');
  assert.ok(sug.capo >= 0 && sug.capo <= 7);
  assert.ok(typeof sug.shapeName === 'string' && sug.shapeName.length > 0);
  assert.strictEqual(F.capoChord('C', 99).capo, F.SHEET_ENUMS.CAPO_MAX, 'capo 钳制到 7');
});

test('SF-09 桥接 GP 定义结构（chartKind=user-chord，必填字段齐全）', () => {
  const gp = F.expandSheetToGp({ id: 's1', title: 'T', artist: 'A', key: 'C', tempo: 70, timeSig: '4/4', capo: 0, text: DEMO, patternId: 'strum-pop-a' });
  for (const k of ['id', 'title', 'artist', 'key', 'capo', 'bpm', 'timeSigText', 'chartKind', 'source', 'pattern', 'harmony', 'lyrics', 'durationSec', 'background', 'lineTimeline']) {
    assert.ok(k in gp, `缺少字段 ${k}`);
  }
  assert.strictEqual(gp.chartKind, 'user-chord');
  assert.strictEqual(gp.source, 'sheet-editor');
  assert.strictEqual(gp.id, 's1');
  assert.strictEqual(gp.bpm, 70);
  assert.strictEqual(gp.pattern, 'strum-pop-a');
  assert.ok(Array.isArray(gp.lyrics) && gp.lyrics.length >= 1);
  assert.ok(Array.isArray(gp.lineTimeline) && gp.lineTimeline.length >= 1);
  assert.ok(gp.durationSec > 0);
});

test('SF-10 parse → serialize → parse 幂等', () => {
  const a = F.parseSheetText(DEMO);
  const text = F.serializeSheetText(a);
  assert.strictEqual(text, DEMO);
  const b = F.parseSheetText(text);
  assert.deepStrictEqual(b.lines, a.lines);
  assert.deepStrictEqual(b.warnings, a.warnings);
  assert.deepStrictEqual(b.meta, a.meta);
});

test('SF-11 {x2} 试听拍位翻倍，{x4} 仅标记不展开', () => {
  const base = '{title:t}\n{key:C}\n{tempo:60}\n{time:4/4}\n{name:副歌}\n[C]啦[Am]啦';
  const one = F.expandSheetToGp({ id: 'x', title: 't', key: 'C', tempo: 60, timeSig: '4/4', text: base });
  const two = F.expandSheetToGp({ id: 'x', title: 't', key: 'C', tempo: 60, timeSig: '4/4', text: base + ' {x2}' });
  const four = F.expandSheetToGp({ id: 'x', title: 't', key: 'C', tempo: 60, timeSig: '4/4', text: base + ' {x4}' });
  assert.strictEqual(two.durationSec, one.durationSec * 2);
  assert.strictEqual(four.durationSec, one.durationSec, 'x4 不展开（M1 上限保护）');
  const line = F.parseSheetText(base + ' {x2}').lines.find((l) => l.repeat);
  assert.strictEqual(line.repeat, 2);
});

test('SF-12 50K 字符解析性能（CPU 时间 <50ms；墙钟受全量并发争抢，不用于断言）', () => {
  const row = '{name:主歌}\n[C]窗外的麻雀在电线杆上多嘴[Am]你说这一句\n';
  const big = row.repeat(1200);
  assert.ok(big.length > 40000 && big.length <= 50000);
  /* npm test 会并发跑 50+ 个测试文件，墙钟可能被 CPU 争抢放大 30 倍；
     process.cpuUsage() 只计本进程的 CPU 时间，才是解析算法本身的可信口径。 */
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const ast = F.parseSheetText(big);
  const cpu = process.cpuUsage(c0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const wallMs = performance.now() - t0;
  assert.ok(ast.lines.length > 2000);
  assert.ok(cpuMs < 50, `解析 CPU 耗时 ${cpuMs.toFixed(1)}ms 应 < 50ms（本地基线约 8ms）`);
  assert.ok(wallMs < 3000, `墙钟 ${wallMs.toFixed(1)}ms 异常，疑似死循环`);
  /* 线性度：12 倍样本量的 CPU 时间不应超过 40 倍（防 O(n²) 退化） */
  const small = row.repeat(100);
  const c1 = process.cpuUsage();
  F.parseSheetText(small);
  const cpu1 = process.cpuUsage(c1);
  const smallMs = Math.max(0.01, (cpu1.user + cpu1.system) / 1000);
  assert.ok(cpuMs < smallMs * 40, `50K 解析 ${cpuMs.toFixed(1)}ms 相对 3.5K 的 ${smallMs.toFixed(1)}ms 非线性膨胀`);
});

test('SF-13 表单 ⇔ 头部双向同步（含 meta 分类与节奏型）', () => {
  const m = F.metaFromText(DEMO);
  assert.strictEqual(m.title, '七里香');
  assert.strictEqual(m.timeSig, '4/4');
  assert.strictEqual(m.patternId, 'strum-pop-a');
  assert.deepStrictEqual(m.tags, ['动漫音乐', '考级']);
  const out = F.applyFieldsToText('{title:旧}\n[C]啦', { title: '新', style: '摇滚', tempo: 120 });
  assert.ok(out.includes('{title:新}'));
  assert.ok(out.includes('{meta:风格:摇滚}'));
  assert.ok(out.includes('{tempo:120}'));
  assert.ok(!out.includes('{title:旧}'));
  assert.strictEqual(F.metaFromText(out).style, '摇滚');
  assert.strictEqual(F.metaFromText(out).tempo, 120);
});

test('SF-14 插入片段 / 行号偏移 / 转调另存标题', () => {
  assert.deepStrictEqual(F.insertSnippet('abcd', 2, 'XY'), { text: 'abXYcd', caret: 4 });
  assert.deepStrictEqual(F.insertSnippet('ab', 99, 'Z') , { text: 'abZ', caret: 3 });
  assert.strictEqual(F.lineStartOffset('aaa\nbbb\nccc', 3), 8);
  assert.strictEqual(F.lineStartOffset('aaa', 99), 3);
  assert.strictEqual(F.transposedDocTitle('七里香', 2), '七里香(移调+2)');
  assert.strictEqual(F.transposedDocTitle('t', -3), 't(移调-3)');
});

test('SF-15 和弦联想：调内 diatonic 优先，前缀过滤，含指法图标记', () => {
  const all = F.chordSuggestions('', 'C', { limit: 24 });
  assert.deepStrictEqual(all.slice(0, 4).map((c) => c.name), ['C', 'Dm', 'Em', 'F']);
  assert.ok(all.every((c) => c.name && typeof c.rank === 'number' && typeof c.hasDiagram === 'boolean'));
  const q = F.chordSuggestions('F#', 'C', { limit: 8 });
  assert.ok(q.length > 0 && q.every((c) => c.name.startsWith('F#')));
  const first = F.chordSuggestions('C', 'C', { limit: 1 });
  assert.strictEqual(first.length, 1);
});

test('SF-16 语法校验分级：阻断级阻止保存，警告级不阻止', () => {
  const ok = F.validateSheetText('{title:t}\n[C]啦');
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.blocking, []);
  const noTitle = F.validateSheetText('[C]啦');
  assert.strictEqual(noTitle.ok, false);
  assert.ok(noTitle.blocking.some((b) => b.code === 'no-title'));
  const tooLong = F.validateSheetText('{title:t}\n' + 'x'.repeat(50001));
  assert.ok(tooLong.blocking.some((b) => b.code === 'too-long'));
  const warn = F.validateSheetText('{title:t}\n{rhythm:no-such-id}\n[Cq]啦');
  assert.strictEqual(warn.ok, true);
  assert.ok(warn.warnings.some((w) => w.code === 'bad-chord'));
  assert.ok(warn.warnings.some((w) => w.code === 'unknown-pattern'));
});

test('SF-17 枚举完整性与版本常量（附录 A）', () => {
  const E = F.SHEET_ENUMS;
  assert.strictEqual(F.SHEET_VERSION, 1);
  assert.strictEqual(E.KEYS.length, 21);
  assert.strictEqual(E.TIME_SIGS.length, 5);
  assert.strictEqual(E.LANGUAGES.length, 10);
  assert.strictEqual(E.STYLES.length, 10);
  assert.strictEqual(E.ARRANGES.length, 5);
  assert.strictEqual(E.TAGS.length, 5);
  assert.strictEqual(E.SECTION_PRESETS.length, 9);
  assert.strictEqual(E.PATTERN_IDS.length, 14);
  assert.strictEqual(E.FINGERPRINT_CHORDS.length, 22);
  assert.strictEqual(E.TEXT_MAX, 50000);
  assert.strictEqual(E.SHEET_MAX, 200);
  assert.strictEqual(E.CAPO_MAX, 7);
  assert.strictEqual(E.STYLE_PATTERN['民谣'], 'pick-folk-a');
  const tpl = F.newSheetTemplate({ title: 'T', artist: 'A', key: 'G', tempo: 90 });
  assert.ok(tpl.includes('{title:T}') && tpl.includes('{key:G}') && tpl.includes('{tempo:90}') && tpl.includes('{name:主歌}'));
  assert.strictEqual(F.META_CATEGORIES.language, '语言');
  /* V4.4.3 回归（P-01）：新谱默认模板不得自带任何告警——
     V4.4.0 模板占位文案含未闭合 [，导致每张新谱创建即报「L16 · 未闭合的 [ 标记」 */
  const tplCheck = F.validateSheetText(F.newSheetTemplate({ title: 'T', artist: 'A' }));
  assert.deepStrictEqual(tplCheck.warnings, [], '新谱默认模板不应产生告警');
  assert.ok(tplCheck.ok, '新谱默认模板不应有阻断项');
  assert.ok(!tpl.includes('触发和弦联想'), '占位文案不得包含裸 [ 触发误报');
});
