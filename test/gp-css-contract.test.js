/* V4.2.3 · 演奏视图 CSS 宿主补丁源码契约。 */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'assets/css/gp.css'), 'utf8');
const PATCH_MARKER = '宿主补丁 V4.2.3';
const markerIndex = CSS.lastIndexOf(PATCH_MARKER);
assert.ok(markerIndex >= 0, 'gp.css 末尾应包含 V4.2.3 宿主补丁');
const markerEnd = CSS.indexOf('*/', markerIndex);
const PATCH = CSS.slice(markerEnd + 2);

function lastRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  let body = null;
  for (const match of CSS.matchAll(pattern)) body = match[1];
  return body;
}

test('CSS-1 歌词层级必须高于底部渐变遮罩', () => {
  assert.match(lastRule('.gp-scope .lyric-line') || '', /z-index:\s*2\b/,
    'lyric-line 需 z-index: 2');
  assert.match(lastRule('.gp-scope .play-bottom-fade') || '', /z-index:\s*1\b/,
    'play-bottom-fade 需 z-index: 1');
});

test('CSS-2 歌词阴影模糊半径不得大于 4px', () => {
  const rule = lastRule('.gp-scope .lyric-line') || '';
  const declaration = /text-shadow:\s*([^;]+)/.exec(rule);
  assert.ok(declaration, 'lyric-line 需定义 text-shadow');
  const length = '(?:-?\\d+(?:\\.\\d+)?px|0)';
  const shadows = [...declaration[1].matchAll(new RegExp(
    `(${length})\\s+(${length})\\s+(${length})`, 'g'))];
  assert.ok(shadows.length > 0, '应能解析 lyric-line 的阴影尺寸');
  for (const shadow of shadows) {
    const blur = Number.parseFloat(shadow[3]);
    assert.ok(blur <= 4, `阴影模糊半径 ${blur}px 过大，会导致文字发虚`);
  }
});

test('CSS-3 clip-text 当前词禁用 text-shadow 并使用 drop-shadow', () => {
  const rule = /\.gp-scope \.lyric-line \.kw\.cur,\s*\.gp-scope \.kara-cur \.kw\.cur\s*\{([^}]*)\}/.exec(PATCH);
  assert.ok(rule, '宿主补丁应同时覆盖演奏歌词与卡拉 OK 当前词');
  assert.match(rule[1], /text-shadow:\s*none\b/, '.kw.cur 必须禁用 text-shadow');
  assert.match(rule[1], /filter:\s*drop-shadow\(/, '.kw.cur 必须使用 drop-shadow');
});

test('CSS-4 HUD 高度上限不得超过 90px', () => {
  const rule = lastRule('.gp-scope .hud-box') || '';
  const match = /max-height:\s*(\d+(?:\.\d+)?)px/.exec(rule);
  assert.ok(match, 'hud-box 需设置 max-height');
  assert.ok(Number(match[1]) <= 90, `hud-box max-height ${match[1]}px 超过 90px`);
});

test('CSS-5 尾部宿主补丁的选择器全部带 .gp-scope 前缀', () => {
  const selectors = [...PATCH.matchAll(/(?:^|})\s*([^{}]+)\{/g)]
    .flatMap((match) => match[1].split(','))
    .map((selector) => selector.trim())
    .filter(Boolean);
  assert.ok(selectors.length > 0, '宿主补丁应包含选择器');
  const unscoped = selectors.filter((selector) => !selector.startsWith('.gp-scope'));
  assert.deepStrictEqual(unscoped, [], `未加 .gp-scope 前缀：${unscoped.join(', ')}`);
});
