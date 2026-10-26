/* ============================================================
   六弦工坊 V4.2.1 · 演奏视图 i18n 与 XSS 回归
   ------------------------------------------------------------
   GP-I18N-1 play.js / song-play.js / components.js 零英文硬编码残留
   GP-I18N-2 play.* 键在四语齐全且非空
   GP-I18N-3 T/TF 接线正确：占位符数量为四语一致，且不支持 '{' 拼接非法HTML
   GP-XSS-1  恶意曲名/歌手渲染后不产生元素、不执行脚本
   GP-XSS-2  路由 id（深链 ?song=<payload>）进入 not-found 页不执行脚本
   GP-XSS-3  karaoke escapeHTML 覆盖 & < > " '
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

await imp('test/_gp-dom.mjs');

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const dictOf = async (lang) => (await imp(`assets/js/i18n/${lang}.js`)).DICT;

/* ============================================================
   GP-I18N-1：零英文硬编码残留
   ============================================================ */
const TARGETS = ['assets/js/gp/play.js', 'assets/js/modules/song-play.js', 'assets/js/gp/components.js'];

/* 允许残留的白名单：乐理记号、CSS、代码标识符、console、设备名 */
const ALLOW = [
  /\bBPM\b/, /\bCapo\b/,
];

test('GP-I18N-1 演奏视图不再有面向用户的英文硬编码', () => {
  for (const f of TARGETS) {
    const src = read(f);
    const lines = src.split('\n');
    /* 找面向用户的字面量：el/text/title/label/toast/fillText 里的英文字面串 */
    const bad = [];
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;              // 注释跳过
      const m = line.match(/(?:text|title|label|toast|fillText|placeholder)\s*[:=]\s*(?:\[)?\s*"([^"]*[A-Za-z][^"]*)"/g) || [];
      for (const hit of m) {
        const str = /"([^"]*)"$/.exec(hit.trim())[1];
        if (!/[A-Za-z]/.test(str)) continue;
        if (/^[A-Za-z0-9_.\-[\]{}%/()#:,;=+\s&'!?]+$/.test(str) && !/\s{2}/.test(str)) {
          /* 纯代码/像素/URL 形态：如 "gp-scope"、"13px var(--font)"、"div.panel" */
          if (!/^(footer|label|class|type|value|id|rel|target|hidden|Alexandria|Georgia)/i.test(str)) continue;
        }
        if (ALLOW.some((re) => re.test(str))) continue;
        bad.push(`${f}:${i + 1} ${str}`);
      }
    });
    assert.deepStrictEqual(bad, [], `${f} 仍有英文硬编码：\n${bad.slice(0, 8).join('\n')}`);
  }
});

test('GP-I18N-1b play.js 所有 user-facing 文案都经过 T()/TF() 取词', () => {
  const src = read('assets/js/gp/play.js');
  const keys = [...src.matchAll(/T(?:F)?\("(play\.[a-zA-Z.]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 40, `至少 40 处文案应接入 i18n，实际 ${keys.length}`);
  const uniq = [...new Set(keys)];
  const zh = read('assets/js/i18n/zh-CN.js');
  for (const k of uniq) {
    assert.ok(zh.includes(`'${k}':`), `词条缺失：${k}`);
  }
});

/* ============================================================
   GP-I18N-2：四语齐全
   ============================================================ */
test('GP-I18N-2 全部 play.* 与 songbook.simpleAcc* 键在四语齐全且非空', async () => {
  const dicts = {};
  for (const lang of LANGS) dicts[lang] = await dictOf(lang);
  const playKeys = Object.keys(dicts['zh-CN']).filter((k) => /^play\./.test(k) || /^songbook\.simpleAcc/.test(k));
  assert.ok(playKeys.length >= 60, `演奏视图词条应 ≥60，实际 ${playKeys.length}`);
  for (const lang of LANGS) {
    const set = Object.keys(dicts[lang]);
    for (const k of playKeys) {
      assert.ok(set.includes(k), `${lang} 缺词条 ${k}`);
      assert.ok(dicts[lang][k] && String(dicts[lang][k]).trim().length > 0, `${lang}.${k} 为空`);
    }
  }
});

test('GP-I18N-3 带参词条的占位符在四语中完全一致', async () => {
  const dicts = {};
  for (const lang of LANGS) dicts[lang] = await dictOf(lang);
  const KEY = 'play.hud.line';   // {acc}{streak}{mult}
  const slots = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort();
  const base = slots(dicts['zh-CN'][KEY]);
  for (const lang of LANGS) {
    assert.deepStrictEqual(slots(dicts[lang][KEY]), base, `${lang}.${KEY} 占位符不一致`);
  }
  for (const k of ['play.meta', 'play.notFound.detail', 'play.result.coins', 'play.band.title']) {
    assert.deepStrictEqual(slots(dicts['en'][k]), slots(dicts['ko'][k]), `${k} 占位符跨语言不一致`);
  }
});

/* ============================================================
   GP-XSS：注入回归
   ============================================================ */
const PAYLOAD = '<img src=x onerror="window.__XSS__=1">';

test('GP-XSS-1 恶意曲名渲染为纯文本，不生成 img 元素、不执行脚本', async () => {
  const { El } = await imp('test/_gp-dom.mjs');
  const cat = await imp('assets/js/gp/catalog.js');
  const { GP_CHORD_SONGS } = await imp('assets/js/gp/songs.js');
  const def = GP_CHORD_SONGS.find((s) => !cat.hasRealChart(s.id));
  const song = cat.findSong(def.id);
  song.title = PAYLOAD;
  song.artist = PAYLOAD;

  const play = (await imp('assets/js/gp/play.js')).default;
  const root = new El('div');
  const cleanup = await play({ el: root, params: [def.id], navigate: () => {} });
  const dump = root.dump ? root.dump() : String(root.innerHTML);
  assert.ok(!/<img/i.test(dump), '曲名中的 img 标签必须被转义成文本');
  assert.ok(typeof cleanup === 'function');
  cleanup();
});

test('GP-XSS-2 深链 id 走 not-found 页时不拼 HTML、不执行脚本', async () => {
  const mod = await imp('assets/js/modules/song-play.js');
  const { El } = await imp('test/_gp-dom.mjs');
  const SongPlay = mod.default;
  const root = new El('div');
  SongPlay.songId = PAYLOAD;
  SongPlay.renderNotFound(root);
  const dump = String(root.innerHTML || '');
  assert.ok(!/<img/i.test(dump), 'not-found 详情不得包含注入的 img 标签');
  assert.ok(dump.includes('&lt;img') || !dump.includes('img'), '必须转义为实体或直接不出现原始标签');
  void mod.SongPlay;
});

test('GP-XSS-3 escapeHTML 覆盖 & < > " \' 五类字符', async () => {
  const { escapeHTML } = await imp('assets/js/gp/karaoke-render.js');
  const out = escapeHTML('<p class="x">&\'</p>');
  assert.ok(!out.includes('<') && !out.includes('>'), '尖括号必须转义');
  assert.ok(!out.includes('"') && !out.includes("'"), '引号必须转义');
  assert.ok(out.includes('&lt;') && out.includes('&amp;'));
  assert.strictEqual(escapeHTML(null), '');
  assert.strictEqual(escapeHTML(undefined), '');
});

test('GP-XSS-4 恶意曲名/歌手的曲卡渲染后不含可执行标签（行为级回归）', async () => {
  const { Songbook } = await imp('assets/js/modules/songbook.js');
  Songbook._practiced = new Set();
  Songbook.expanded = new Set();
  const evil = {
    id: 'song-999', no: 999, title: PAYLOAD, artist: PAYLOAD, duration: '03:00',
    tier: 1, unit: 'L1.1', minDifficulty: 3, sheetCount: 1, hasQQChord: true, note: PAYLOAD,
    sheets: [{ source: 'jitashe', name: PAYLOAD, difficulty: null, url: 'https://example.com/x' }],
  };
  const card = Songbook.songCard(evil, 1);
  const html = String(card.innerHTML || '');
  assert.ok(!/<img/i.test(html), '曲卡 HTML 中不得出现注入的 img 标签');
  /* esc() 必须连引号一起转义，否则仍可闭合已有属性再注入事件 handler */
  assert.ok(!/onerror="/.test(html), '注入的引号必须被转义，不能形成事件属性');
  assert.ok(!/(^|[^&])[<>]/.test(html.replace(/<[a-zA-Z/!][^>]*>/g, '')),
    '除模板自身标签外，HTML 中不得残留裸尖括号');
  assert.ok(html.includes('&lt;img'), '曲名必须被 esc() 转义');
  /* 数据里的 https 外链仍应正常渲染（不能因转义把正常功能一起干掉） */
  assert.ok(html.includes('https://example.com/x'), '正常外链应保留');
});

test('GP-XSS-4b 曲卡模板的动态插值必须走 esc()（源码级扫描）', () => {
  const sbSrc = read('assets/js/modules/songbook.js');
  const start = sbSrc.indexOf('card.innerHTML = `');
  assert.ok(start > 0, '应找到曲卡模板');
  const tpl = sbSrc.slice(start, sbSrc.indexOf('return card;', start));
  /* 逐个平衡扫描 ${...} 表达式，提取其中的原始插值 */
  const exprs = [];
  let depth = 0, buf = '';
  for (let i = 0; i < tpl.length - 1; i++) {
    if (tpl[i] === '$' && tpl[i + 1] === '{') { depth = 1; buf = ''; i++; continue; }
    if (depth > 0) {
      if (tpl[i] === '{') depth++;
      else if (tpl[i] === '}') { depth--; if (depth === 0) { exprs.push(buf); continue; } }
      buf += tpl[i];
    }
  }
  const dataFields = /\b(s\.(title|artist|duration|note|no)|tierName|stars|src\.name|sh\.name|diff|sh\.url)\b/;
  const unsafe = exprs.filter((e) => dataFields.test(e) && !/esc\(/.test(e));
  assert.deepStrictEqual(unsafe, [], `曲卡模板存在未转义的数据插值：${unsafe.join(' | ')}`);
});

test('GP-XSS-5 play.js 不再用 html: 插值曲名/歌手/id', () => {
  const src = read('assets/js/gp/play.js');
  assert.ok(!/html:\s*`<b>\$\{song\.title\}/.test(src), '标题不得再经 html: 注入');
  assert.ok(!/html:\s*\$\{song\.artist\}/.test(src), '歌手不得再经 html: 注入');
  const sp = read('assets/js/modules/song-play.js');
  assert.ok(!/innerHTML\s*=\s*`<div class="panel"[\s\S]*\$\{String\(this\.songId/.test(sp),
    'song-play.js 的 not-found 不得再把 id 拼进 innerHTML');
  assert.ok(!/innerHTML = `<div class="panel"/.test(sp), '兜底页应改用 DOM 构建');
});
