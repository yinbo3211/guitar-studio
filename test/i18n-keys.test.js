/* 六弦工坊 V3 · i18n 四语 Key 全等测试（R-I18N 词条结构约束） */
import test from 'node:test';
import assert from 'node:assert';

const { DICT: ZH } = await import('../assets/js/i18n/zh-CN.js');
const { DICT: EN } = await import('../assets/js/i18n/en.js');
const { DICT: JA } = await import('../assets/js/i18n/ja.js');
const { DICT: KO } = await import('../assets/js/i18n/ko.js');

const keys = (d) => Object.keys(d).sort();

test('四语词条 Key 集合完全一致（en/ja/ko 与 zh-CN 差集为空）', () => {
  const base = keys(ZH);
  for (const [name, d] of [['en', EN], ['ja', JA], ['ko', KO]]) {
    const k = keys(d);
    assert.deepStrictEqual(k, base, `${name} 与 zh-CN 的 Key 集合不一致`);
  }
  assert.ok(base.length >= 45, `词条量 ${base.length} 应不少于 45（chrome 层基线）`);
});

test('所有词条值为非空字符串', () => {
  for (const d of [ZH, EN, JA, KO]) {
    for (const [k, v] of Object.entries(d)) {
      assert.strictEqual(typeof v, 'string', `${k} 值必须是字符串`);
      assert.ok(v.trim().length > 0, `${k} 值不能为空`);
    }
  }
});

test('中英日韩同 Key 文案互不相同（防占位复制）', () => {
  const sample = ['nav.home', 'nav.metro', 'common.start', 'theme.auto'];
  for (const k of sample) {
    const set = new Set([ZH[k], EN[k], JA[k], KO[k]]);
    assert.ok(set.size >= 3, `${k} 四语文案应至少 3 种（got ${set.size}）`);
  }
});
