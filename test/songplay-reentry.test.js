/* ============================================================
   V4.2.3 · 演奏视图重复进入 / 拆卸 DOM 回归测试
   ------------------------------------------------------------
   用户报告：点「开始弹唱」→ 返回曲库 → 再点另一首，
   演奏界面会出现 2 个画面；点三次出现 3 个。

   根因（本测试固化）：
   1) gp/play.js 的 teardown 只清理定时器/监听器/音频，不移除 DOM；
   2) modules/song-play.js 的 enter() 只设 root.className，不清空 root.innerHTML。
   → 每次进入都向同一 root 追加一个新的 .play-shell，旧的永不回收。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

await imp('test/_gp-dom.mjs');
const { El } = await imp('test/_gp-dom.mjs');

test('RE-1 teardown 必须移除演奏视图 DOM（否则返回曲库后残留）', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const root = new El('div');
  const cleanup = await play({ el: root, params: ['gp-song-001'], navigate: () => {} });
  assert.ok(root.children.length > 0, '前置：应渲染出内容');
  cleanup();
  assert.strictEqual(root.children.length, 0,
    `teardown 后 DOM 仍残留 ${root.children.length} 个节点（应全部移除）`);
});

test('RE-2 同一 root 重复挂载不得叠加画面', async () => {
  const play = (await imp('assets/js/gp/play.js')).default;
  const root = new El('div');
  const c1 = await play({ el: root, params: ['gp-song-001'], navigate: () => {} });
  const n1 = root.children.length;
  c1();
  const c2 = await play({ el: root, params: ['gp-song-002'], navigate: () => {} });
  const n2 = root.children.length;
  c2();
  assert.strictEqual(n2, n1,
    `重复进入后画面叠加：首次 ${n1} 个节点，第二次 ${n2} 个节点（应相等）`);
});
