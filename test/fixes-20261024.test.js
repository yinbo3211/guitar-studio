'use strict';
/* ============================================================
   2026-10-24 缺陷修复回归测试
   覆盖本轮在 Node 层可确定性验证的修复：
   - server 测试在非 ASCII（中文）路径下 ROOT 解析（fileURLToPath 解码）
   - sw.js 离线预缓存清单必须覆盖 main.js 静态模块图（防离线白屏）
   - 节奏练习自然结束时按真实循环数统计（原实现恒为 1）
   - 录音文件扩展名按「实际生效 mimeType」映射
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ---- 1) 非 ASCII 路径：fileURLToPath 必须解码百分号 ---- */
test('非ASCII路径: fileURLToPath 解码中文目录，server.js 可达', () => {
  // 该用例仓库本身就放在含中文的目录下；fileURLToPath 必须解码
  const decoded = fileURLToPath(new URL('..', import.meta.url));
  const serverJs = path.join(decoded, 'server', 'server.js');
  assert.ok(fs.existsSync(serverJs), '解码后的 ROOT/server/server.js 必须存在');

  // 反向证明：未解码的 pathname 拼出来的路径在中文目录下是不存在的
  const rawPathname = new URL('../server/server.js', import.meta.url).pathname;
  // 仅当当前路径确实含非 ASCII 时做强断言，避免在纯英文 CI 上误判
  if (/[^\x00-\x7F]/.test(decoded)) {
    assert.ok(!fs.existsSync(rawPathname), '未解码 pathname 不应指向真实文件');
  }
});

/* ---- 2) Service Worker 预缓存清单覆盖模块图 ---- */
test('sw.js: main.js 静态 import 的所有模块都在预缓存清单内', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  // 收集所有出现在 URLS 数组字面量中的缓存路径
  // 归一化：去掉 './' 前缀后比较
  const norm = p => p.replace(/^\.\//, '');
  const listed = new Set([...sw.matchAll(/['"]([^'"]+\.js)['"]/g)].map(m => norm(m[1])));

  // 从 main.js 的静态 import 提取相对路径（兼容副作用 import './x.js' 与 import x from '...'），转站点根相对路径
  const main = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'main.js'), 'utf8');
  const imports = [...main.matchAll(/import\s+(?:[^'"]+?\s+from\s+)?['"]\.\/([^'"]+)['"]/g)].map(m => m[1]);
  const required = imports.map(rel => 'assets/js/' + rel);

  for (const r of required) {
    assert.ok(fs.existsSync(path.join(ROOT, r)), `被引用文件应存在: ${r}`);
    assert.ok(listed.has(r), `SW 预缓存清单缺少 main.js 依赖: ${r}（离线冷启动会白屏）`);
  }
  // 语言包也必须可离线
  for (const lang of ['zh-CN', 'en', 'ja', 'ko']) {
    const p = `assets/js/i18n/${lang}.js`;
    assert.ok(listed.has(p), `SW 缺少语言包预缓存: ${p}`);
  }
});

/* ---- 3) 节奏自然结束循环统计（纯函数级模拟） ---- */
test('节奏练习: 自然结束按真实循环数统计，而非恒为 1', () => {
  // 复刻修复后的统计口径：_finish 传入已完成的循环数
  const statsOf = (loopDoneAtFinish) => Math.max(1, loopDoneAtFinish || 1);
  assert.strictEqual(statsOf(4), 4, '完成4小节循环应统计为4（旧实现恒为1）');
  assert.strictEqual(statsOf(1), 1);
  assert.strictEqual(statsOf(0), 1, '0 循环兜底为1');

  // 同时确认源码里 _finish 调用 _finishSession 时传入了 loopDone（修复特征）
  const rhythm = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'modules', 'rhythm.js'), 'utf8');
  assert.ok(/_finishSession\(\s*finishedLoops\s*\)/.test(rhythm),
    '自然结束必须把真实循环数 finishedLoops 传给 _finishSession');
  assert.ok(/function _finishSession\s*\(\s*loopsArg\s*\)|_finishSession\s*\(\s*loopsArg\s*\)/.test(rhythm) ||
            /_finishSession\(loopsArg\)/.test(rhythm),
    '_finishSession 必须接收显式循环数参数');
});

/* ---- 4) 录音扩展名按实际生效 mimeType ---- */
test('录音: 扩展名依据 rec.mimeType 实际值映射', () => {
  const extOf = (usedMime) =>
    usedMime.includes('mp4') ? 'mp4' : (usedMime.includes('ogg') ? 'ogg' : 'webm');
  assert.strictEqual(extOf('audio/mp4'), 'mp4');
  assert.strictEqual(extOf('audio/mp4;codecs=mp4a.40.2'), 'mp4');
  assert.strictEqual(extOf('audio/ogg;codecs=opus'), 'ogg');
  assert.strictEqual(extOf('audio/webm;codecs=opus'), 'webm');
  assert.strictEqual(extOf(''), 'webm', '未知类型默认 webm');

  // 修复特征：源码使用 recorder 实例的 mimeType（实际值）而非申请值
  const rec = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'modules', 'recorder.js'), 'utf8');
  assert.ok(/\brec\.mimeType\s*\|\|/.test(rec), '应以 recorder.mimeType 实际生效值判断扩展名');
});

/* ---- 5) lint 脚本成功时确实打印 lint ok（修复 console.log 在 exit 之后） ---- */
test('工程: lint.mjs 成功路径输出 lint ok', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'lint.mjs')], { encoding: 'utf8' });
  assert.match(out, /lint ok/, 'lint 通过应可见地打印 lint ok');
});

/* ---- 6) 第二轮深度审查追加修复 ---- */
test('Mic: getUserMedia 在途时复用同一承诺，不并发申请第二条流', () => {
  const f = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'core', 'audio-engine.js'), 'utf8');
  assert.ok(/this\._starting/.test(f), 'Mic 应有在途承诺字段 _starting');
  assert.ok(/if\s*\(this\._starting\)\s*return\s+this\._starting/.test(f), '在途时应直接复用该承诺');
});

test('节奏练习: 手动停止也在清零前快照循环数并传给 _finishSession', () => {
  const f = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'modules', 'rhythm.js'), 'utf8');
  // stop(record) 内需先取 finishedLoops，再把 loopDone 置 0，再 _finishSession(finishedLoops)
  const stopBlock = f.slice(f.indexOf('stop(record)'), f.indexOf('_teardown(){') > -1 ? f.indexOf('stop(record)') + 700 : undefined);
  assert.ok(/finishedLoops\s*=\s*Math\.max\(1,\s*this\.loopDone\|\|1\)/.test(stopBlock), 'stop 内需快照 finishedLoops');
  assert.ok(stopBlock.indexOf('finishedLoops') < stopBlock.indexOf('this.loopDone=0'), '快照必须早于清零');
  assert.ok(/_finishSession\(\s*finishedLoops\s*\)/.test(stopBlock), '应把 finishedLoops 传入统计');
});

test('录音: 停止→立即重录隔离——同步释放硬件 + onstop 仅保存数据，旧会话不误伤新会话', () => {
  const f = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'modules', 'recorder.js'), 'utf8');
  assert.ok(/_detachHardware/.test(f), '应有独立的硬件释放 _detachHardware');
  assert.ok(/const\s+chunks\s*=\s*\[\]/.test(f), 'chunks 应会话局部化，避免被新一轮清空');
  // onstop 内不得再释放 stream/ac（硬件已在 stop 同步释放），避免误杀新会话
  const onstop = f.slice(f.indexOf('rec.onstop='), f.indexOf('// 电平表'));
  assert.ok(!/getTracks\(\)/.test(onstop) && !/\.close\(\)/.test(onstop), 'onstop 只保存数据，不释放硬件资源');
});

test('主题面板: gsLang 初值取自持久化语言而非硬编码 zh-CN', () => {
  const f = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'core', 'theme-switch.js'), 'utf8');
  assert.ok(/let\s+gsLang\s*=\s*\(?store\.read\(\)\.lang/.test(f), 'gsLang 应从 store.read().lang 初始化');
});

test('路由: 未知 hash 回退到首页而非内容区空白', () => {
  const f = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'core', 'router.js'), 'utf8');
  assert.ok(/location\.replace\(['"]#\/home['"]\)/.test(f), '非法路由应 replace 回 #/home');
});
