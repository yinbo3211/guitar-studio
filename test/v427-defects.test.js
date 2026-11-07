/* ============================================================
   六弦工坊 V4.2.7 · 缺陷回归测试（对应 V4.2.6 全量测试手册）
   ------------------------------------------------------------
   BUG-26B（P3）：emoji 清尾在 play.* 命名空间之外存在 7 处漏网，
                 其中「🔊 试音」「🎸 今日计划已生成」「🎉 今日已全部完成」
                 已在用户可见 UI 实测渲染。
   本文件锁定「用户可见文案不得含装饰性 emoji」，防止后续新增文案再回流。
   注意：★☆（难度星级）、✓（准音指示）属于符号语义，不在清理范围内。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* 装饰性 emoji 的粗略区间（本仓已知会用到的都覆盖；不是全量 Unicode 表） */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const LANGS = ['zh-CN', 'en', 'ja', 'ko'];

test('V427-1 四语调音/节拍器试音按钮不得带 🔊', () => {
  for (const lang of LANGS) {
    const src = read(`assets/js/i18n/${lang}.js`);
    const match = /'metro\.test'\s*:\s*'([^']*)'/.exec(src);
    assert.ok(match, `${lang} 应存在 metro.test 词条`);
    assert.ok(!EMOJI.test(match[1]), `${lang} 的 metro.test 仍含 emoji：「${match[1]}」`);
    assert.ok(match[1].trim().length > 0, `${lang} 的 metro.test 不得为空`);
  }
});

test('V427-2 每日计划与节奏练习的 toast 不得带 🎸/🎉', () => {
  const plan = read('assets/js/modules/plan.js');
  const rhythm = read('assets/js/modules/rhythm.js');
  for (const [name, src] of [['plan.js', plan], ['rhythm.js', rhythm]]) {
    const hits = [...src.matchAll(/toast\([^\n]*/g)].filter((m) => EMOJI.test(m[0]));
    assert.deepStrictEqual(hits.map((m) => m[0].slice(0, 40)), [],
      `${name} 的 toast 文案仍含装饰性 emoji`);
  }
});

test('V427-3 曲库/练习/弹唱三大模块的文案不含装饰性 emoji', () => {
  /* play.* 已在 V4.2.6 清尾；这里覆盖其余用户可见模块，防止范围外再次漏网 */
  const files = [
    'assets/js/modules/songbook.js',
    'assets/js/modules/stats.js',
    'assets/js/modules/metronome.js',
    'assets/js/modules/ear-training.js',
    'assets/js/core/mic-manager.js',
  ];
  for (const file of files) {
    const src = read(file);
    const hits = [...src.matchAll(/'([^'\n]*)'/g)]
      .map((m) => m[1])
      .filter((text) => EMOJI.test(text));
    assert.deepStrictEqual(hits, [], `${file} 仍含 emoji：${hits.join(' / ')}`);
  }
});

test('V427-4 静态 HTML 文案不得含装饰性 emoji（i18n 接管前的首屏兜底）', () => {
  /* V4.2.7 实测发现：app.html 的 #metroTest / #metroSoundTest 兜底文案带 🔊，
     i18n 生效后会被覆盖，但首屏与 i18n 失败时仍会露出，因此纳入扫描。 */
  const html = read('app.html');
  const texts = [...html.matchAll(/>([^<>{}]+)</g)]
    .map((m) => m[1].trim())
    .filter((text) => text && EMOJI.test(text));
  assert.deepStrictEqual(texts, [], `app.html 静态文案仍含 emoji：${texts.join(' / ')}`);
});
