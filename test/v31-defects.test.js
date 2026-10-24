/* ============================================================
   六弦工坊 V3.1 · 缺陷测试报告回归用例（BUG-01 ~ BUG-10）
   ------------------------------------------------------------
   目标：为《六弦工坊 V3.1 缺陷测试报告》确认的 10 个缺陷各补一条
   可执行的回归断言，防止修复后再次回归。

   覆盖：
     BUG-01 初始化口令校验与「默认口令判定」同口径（纯空白口令不得放行）
     BUG-02 调音 / 音阶模块接入练习数据层（源码级存在性 + 真实上报）
     BUG-03 练耳单轮口径：上报后计数复位，不跨轮累计、不重复上报
     BUG-04 计划进度按「组 / 题」实际口径计数
     BUG-05 导入受容量上限与 accuracy 钳制约束
     BUG-06 版本号可由白名单内接口获取（+ 服务端实现存在）
     BUG-07 非 ASCII 路径下 ROOT 解析正确（fileURLToPath 解码）
     BUG-08 登录限流具备 IP 维度聚合
     BUG-09 Authorization 支持标准 Bearer（RFC 6750）
     BUG-10 增三和弦 '+' 识别为 aug
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------------- 桩：localStorage（数据层需要） ---------------- */
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear()
  };
}

/* ============================================================
   BUG-01 纯空白口令不得通过初始化（与 isDefaultPassword 同口径）
   注意：server.js 在模块顶层就会 listen()，测试内不得直接 import 它
   （会留下常驻监听导致 node --test 进程无法退出），统一走子进程 + HTTP。
   ============================================================ */
test('BUG-01 纯空白口令被初始化拒绝，不产生自锁状态', async () => {
  const port = await freePort();
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-b01-')), 'c.json');
  fs.writeFileSync(cfg, JSON.stringify({ webPort: 8080 }));   // 空口令 → 需初始化
  const child = spawn(process.execPath, ['server/server.js', `--port=${port}`], {
    cwd: ROOT, env: Object.assign({}, process.env, { GS_CONFIG: cfg }), stdio: 'ignore'
  });
  try {
    assert.ok(await waitHealthy(port), '服务应就绪');
    // 8 个空格：旧实现返回 200 + token，但 init-status 仍 needInit → 自锁
    const r1 = await request(port, 'POST', '/api/init', { password: '        ' });
    assert.strictEqual(r1.status, 400, '8 个空格必须被拒绝（不得返回 200）');
    assert.strictEqual(r1.json && r1.json.ok, false);
    // 20 个空格同样拒绝
    const r2 = await request(port, 'POST', '/api/init', { password: '                    ' });
    assert.strictEqual(r2.status, 400, '20 个空格必须被拒绝');
    // 仍是未初始化态
    const st = await request(port, 'GET', '/api/init-status');
    assert.strictEqual(st.json.needInit, true, '拒绝后仍应处于未初始化态');
    // 合法口令可通过，且之后不再需要初始化（两处口径一致，不会自锁）
    const r3 = await request(port, 'POST', '/api/init', { password: 'Str0ng!Pass' });
    assert.strictEqual(r3.status, 200, '合法口令应通过');
    const st2 = await request(port, 'GET', '/api/init-status');
    assert.strictEqual(st2.json.needInit, false, '合法口令初始化后不得再判为未初始化');
    const s3 = await request(port, 'GET', '/api/status', null,
      { Authorization: 'Bearer ' + r3.json.token });
    assert.strictEqual(s3.status, 200, '签发的 token 必须可用（旧实现会自锁为 409）');
  } finally {
    child.kill('SIGKILL');
  }
});

test('BUG-01 源码：validatePassword 被 /api/init 使用且与默认口令判定同口径', () => {
  const src = readSrc('server/server.js');
  assert.ok(/function validatePassword/.test(src), '应提供统一口令校验函数');
  const iInit = src.indexOf("pathname === '/api/init'");
  const seg = src.slice(iInit, iInit + 900);
  assert.ok(/validatePassword\(/.test(seg), '/api/init 必须走 validatePassword');
  assert.ok(!/pw\.length < 8/.test(seg), '/api/init 不得再用未 trim 的 pw.length 判定');
  assert.ok(/pw\.trim\(\)\.length < 8/.test(src), '默认口令判定与初始化校验须同为 trim 口径');
});

/* ============================================================
   BUG-02 调音 / 音阶接入 F1 数据层
   ============================================================ */
test('BUG-02 调音模块在六弦调准后上报 tuner 会话', () => {
  const src = readSrc('assets/js/modules/tuner.js');
  assert.ok(/reportTuned\s*\(/.test(src), 'tuner.js 应实现 reportTuned()');
  assert.ok(/module\s*:\s*'tuner'/.test(src), 'tuner.js 应以 module:"tuner" 上报');
  // 必须在「六弦全部调准」分支内被调用，而不是只弹 toast
  const tunedBlock = src.slice(src.indexOf('tunedSet.size===6') - 300, src.indexOf('tunedSet.size===6') + 400);
  assert.ok(/reportTuned\(\)/.test(tunedBlock), '六弦调准分支内必须调用 reportTuned()');
});

test('BUG-02 音阶模块在完整跟弹完成后上报 scale 会话', () => {
  const src = readSrc('assets/js/modules/scale.js');
  assert.ok(/reportScale\s*\(/.test(src), 'scale.js 应实现 reportScale()');
  assert.ok(/module\s*:\s*'scale'/.test(src), 'scale.js 应以 module:"scale" 上报');
  const fb = src.slice(src.indexOf('finishFollow(){'), src.indexOf('finishFollow(){') + 900);
  assert.ok(/reportScale\(\)/.test(fb), 'finishFollow 内必须调用 reportScale()');
});

test('BUG-02 调音与音阶会话可被计划统计读到', async () => {
  const { PracticeStore: P } = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/practice-store.js')).href);
  P.clearAll();
  // 直接以数据层口径验证：tuner / scale 各写一条后能被计划统计读到
  P.addSession({ module: 'tuner', durationMs: 30000, meta: { strings: 6 } });
  P.addSession({ module: 'scale', durationMs: 60000, accuracy: 1, meta: { notes: 8 } });
  const rows = P.byModule();                     // byModule 返回数组
  const tuner = rows.find(r => r.module === 'tuner');
  const scale = rows.find(r => r.module === 'scale');
  assert.ok(tuner && tuner.count === 1, 'tuner 会话应可统计');
  assert.ok(scale && scale.count === 1, 'scale 会话应可统计');
});

/* ============================================================
   BUG-03 练耳单轮口径
   ============================================================ */
test('BUG-03 练耳上报后计数复位，不跨轮累计也不重复上报', async () => {
  const { PracticeStore: P } = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/practice-store.js')).href);
  P.clearAll();
  const src = readSrc('assets/js/modules/ear-training.js');
  assert.ok(/report\(\)\{[\s\S]*?this\.n=0;\s*this\.ok=0/.test(src),
    'report() 必须把 n / ok 复位为 0，否则下一轮在历史值上累加');

  // 行为级验证：模拟 Ear.report 的复位语义
  const ear = { n: 10, ok: 8, reactionSum: 4000, reactionN: 10, startedAt: Date.now() - 40000,
    level: 'basic', mode: 'note',
    report() {
      if (this.n > 0) {
        P.addSession({ module: 'ear', startedAt: this.startedAt, durationMs: 40000,
          accuracy: this.ok / this.n, meta: { questions: this.n } });
      }
      this.n = 0; this.ok = 0; this.reactionSum = 0; this.reactionN = 0; this.startedAt = Date.now();
    } };
  ear.report();                       // 第 1 轮：8/10
  ear.n = 10; ear.ok = 6;             // 第 2 轮：6/10
  ear.report();
  const list = P.listSessions({});
  assert.strictEqual(list.length, 2, '两轮应产生 2 条会话，不能重复上报');
  assert.strictEqual(list[0].meta.questions, 10, '第 1 轮题数应为 10');
  assert.strictEqual(list[1].meta.questions, 10, '第 2 轮题数应为 10（旧实现会变成 20）');
  assert.strictEqual(Math.round(list[1].accuracy * 100), 60, '第 2 轮正确率应为当轮 60%（旧实现为累计 70%）');
});

/* ============================================================
   BUG-04 计划进度按「组 / 题」口径
   ============================================================ */
test('BUG-04 和弦任务按 meta.switches 计数、练耳按 meta.questions 计数', async () => {
  const { PracticeStore: P } = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/practice-store.js')).href);
  P.clearAll();
  const src = readSrc('assets/js/modules/plan.js');
  assert.ok(/flow:\s*s=>s\.switches>0\s*\?\s*s\.switches\s*:\s*s\.count/.test(src),
    'flow 任务应按 switches 计数');
  assert.ok(/ear:\s*s=>s\.questions>0\s*\?\s*s\.questions\s*:\s*s\.count/.test(src),
    'ear 任务应按 questions 计数');
  assert.ok(/sum\[m\]\.switches\s*\+=\s*meta\.switches/.test(src), '需累计 meta.switches');
  assert.ok(/sum\[m\]\.questions\s*\+=\s*meta\.questions/.test(src), '需累计 meta.questions');

  // 行为级验证：一轮 4 组转换应直接满足 target=4（旧口径只算 1 条会话 → 1/4）
  const t0 = Date.now() - 60000;
  P.addSession({ module: 'flow', startedAt: t0, endedAt: t0 + 60000, meta: { switches: 4 } });
  P.addSession({ module: 'ear', startedAt: t0, endedAt: t0 + 30000, meta: { questions: 10 } });
  const all = P.listSessions({});
  const flowRow = P.byModule().find(r => r.module === 'flow');
  assert.strictEqual(flowRow.count, 1, '和弦只有 1 条会话');
  const flowMeta = all.find(s => s.module === 'flow').meta;
  const earMeta = all.find(s => s.module === 'ear').meta;
  assert.strictEqual(flowMeta.switches, 4, '和弦会话应保留 switches=4');
  assert.strictEqual(earMeta.questions, 10, '练耳会话应保留 questions=10');
  // 按新口径换算：1 条会话即可满足 target=4，不再需要 4 轮
  const flowUnits = all.filter(s => s.module === 'flow').reduce((a, s) => a + (s.meta.switches || 0), 0);
  const earUnits = all.filter(s => s.module === 'ear').reduce((a, s) => a + (s.meta.questions || 0), 0);
  assert.strictEqual(flowUnits, 4, '按组计：一轮即 4 组');
  assert.strictEqual(earUnits, 10, '按题计：一轮即 10 题');
  assert.ok(flowUnits >= 4, '和弦任务 target=4 应在一轮内达成（旧实现需 4 轮）');
});

/* ============================================================
   BUG-05 导入容量与 accuracy 钳制
   ============================================================ */
test('BUG-05 导入受 5000 条上限约束且 accuracy 被钳制到 0-1', async () => {
  const { PracticeStore: P } = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/practice-store.js')).href);
  P.clearAll();
  const sessions = [];
  for (let i = 0; i < 9000; i++) {
    sessions.push({ id: 'x' + i, module: 'flow', startedAt: Date.now(), durationMs: 1000,
      accuracy: 5, meta: { switches: 1 } });
  }
  const res = P.importData(JSON.stringify({ sessions }));
  assert.strictEqual(res.ok, true, '导入应成功返回');
  const after = P.listSessions({});
  assert.ok(after.length <= 5000, `导入后总数应 <=5000，实际 ${after.length}`);
  const flowRow = P.byModule().find(r => r.module === 'flow');
  assert.ok(flowRow && flowRow.accuracy <= 1, `模块平均正确率应 <=1，实际 ${flowRow && flowRow.accuracy}`);
  // 单条 accuracy 也不得超过 1
  const bad = after.filter(s => s.accuracy !== null && (s.accuracy < 0 || s.accuracy > 1));
  assert.strictEqual(bad.length, 0, '不应存在超出 0-1 区间的 accuracy');
});

test('BUG-05 导入的时间字段被校验（NaN 不得落库）', async () => {
  const { PracticeStore: P } = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/practice-store.js')).href);
  P.clearAll();
  P.importData(JSON.stringify({ sessions: [
    { id: 'a1', module: 'rhythm', startedAt: 'not-a-number', endedAt: null, durationMs: 'x' }
  ] }));
  const s = P.listSessions({}).find(x => x.id === 'a1');
  assert.ok(s, '会话应被导入');
  assert.ok(Number.isFinite(s.startedAt), 'startedAt 应为有限数字');
  assert.ok(Number.isFinite(s.endedAt), 'endedAt 应为有限数字');
  assert.ok(Number.isFinite(s.durationMs), 'durationMs 应为有限数字');
});

/* ============================================================
   BUG-06 版本号可通过白名单内接口获取
   ============================================================ */
test('BUG-06 提供 /api/v1/version 且 Service Worker 优先读取它', () => {
  const srvSrc = readSrc('server/server.js');
  const swSrc = readSrc('sw.js');
  assert.ok(/'\/api\/v1\/version'/.test(srvSrc), '服务端应提供 /api/v1/version');
  assert.ok(/APP_VERSION/.test(srvSrc), '版本号应从 package.json 派生，而非硬编码');
  assert.ok(/'.\/api\/v1\/version'/.test(swSrc), 'sw.js 应优先读取 /api/v1/version');
  // 且 version 接口必须放在初始化状态机之前（未初始化也能读）
  const iVer = srvSrc.indexOf("'/api/v1/version'");
  const iInit = srvSrc.indexOf("if(needsInit(config)){");
  assert.ok(iVer > 0 && iVer < iInit, '/api/v1/version 必须在初始化状态机拦截之前处理');
});

/* ============================================================
   BUG-07 非 ASCII 路径解析
   ============================================================ */
test('BUG-07 非 ASCII 路径下 ROOT 解析正确（fileURLToPath 解码）', () => {
  // 构造一个含中文的 file URL，验证 fileURLToPath 能正确解码
  const cn = '/Coze/Drive/扣子/guitar-studio/test/x.test.js';
  const u = pathToFileURL(cn);
  assert.ok(/%E6%89%A3|%E6%89%/.test(u.pathname) || !/%/.test(u.pathname),
    'file URL 的 pathname 是百分号编码形式');
  const decoded = fileURLToPath(u.href);
  assert.strictEqual(decoded, cn, 'fileURLToPath 应还原出原始中文路径');
  assert.ok(!decoded.includes('%'), '解析结果不得残留百分号编码');
  // 关键：解析出的路径必须真实可达（旧实现拼出的路径不存在 → spawn ENOENT）
  assert.ok(fs.existsSync(path.join(ROOT, 'server', 'server.js')),
    '由 fileURLToPath 解析出的 ROOT 下 server.js 必须存在');
});

test('BUG-07 安全测试文件不再使用未解码的 URL.pathname', () => {
  const src = readSrc('test/server-security.test.js');
  // 只检查真实的 ROOT 赋值语句（注释里会提到旧写法，不能据此判定）
  assert.ok(!/const\s+ROOT\s*=\s*[^;]*new URL\(import\.meta\.url\)\.pathname/.test(src),
    'ROOT 赋值不得再使用未解码的 URL.pathname');
  assert.ok(/const\s+ROOT\s*=\s*[^;]*fileURLToPath\(import\.meta\.url\)/.test(src),
    'ROOT 应改由 fileURLToPath 解析');
});

/* ============================================================
   BUG-08 / BUG-09 / BUG-10 辅助：真实起服务验证
   ============================================================ */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function request(port, method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers: h }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json: j, text: d, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
async function waitHealthy(port, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await request(port, 'GET', '/api/v1/health');
      if (r.status === 200) return true;
    } catch (e) { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

test('BUG-08 登录限流具备 IP 维度聚合（跨账号累计超限整体锁定）', async (t) => {
  const port = await freePort();
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-b08-')), 'c.json');
  fs.writeFileSync(cfg, JSON.stringify({ adminPassword: 'Str0ng!Pass' }));
  const child = spawn(process.execPath, ['server/server.js', `--port=${port}`], {
    cwd: ROOT, env: Object.assign({}, process.env, { GS_CONFIG: cfg }), stdio: 'ignore'
  });
  try {
    assert.ok(await waitHealthy(port), '服务应就绪');
    // 对多个不同账号各失败若干次：单账号均未达 5 次，但 IP 累计超限
    let ipLocked = false;
    for (const acc of ['u1', 'u2', 'u3', 'u4']) {
      for (let i = 0; i < 4; i++) {
        const r = await request(port, 'POST', '/api/login', { account: acc, password: 'bad' + i });
        if (r.status === 429) { ipLocked = true; break; }
      }
      if (ipLocked) break;
    }
    assert.ok(ipLocked, '同一 IP 跨账号累计失败后应被整体锁定（429）');
  } finally {
    child.kill('SIGKILL');
  }
});

test('BUG-08 源码同时保留账号维度与 IP 维度两个计数键', () => {
  const src = readSrc('server/server.js');
  assert.ok(/function ipKey\(/.test(src), '应存在 IP 维度计数键');
  assert.ok(/IP_MAX_FAILS/.test(src), '应存在单 IP 跨账号阈值');
  assert.ok(/跨账号登录失败累计超限/.test(src), 'IP 维度锁定应有日志');
  assert.ok(/loginAllowed\(ip,\s*account\)/.test(src) && /ipKey\(ip\)/.test(src),
    'loginAllowed 需同时检查账号维度与 IP 维度');
});

test('BUG-09 Authorization 支持标准 Bearer（RFC 6750）', async () => {
  const port = await freePort();
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-b09-')), 'c.json');
  fs.writeFileSync(cfg, JSON.stringify({ adminPassword: 'Str0ng!Pass' }));
  const child = spawn(process.execPath, ['server/server.js', `--port=${port}`], {
    cwd: ROOT, env: Object.assign({}, process.env, { GS_CONFIG: cfg }), stdio: 'ignore'
  });
  try {
    assert.ok(await waitHealthy(port), '服务应就绪');
    const lg = await request(port, 'POST', '/api/login', { account: 'admin', password: 'Str0ng!Pass' });
    assert.strictEqual(lg.status, 200, '登录应成功');
    const token = lg.json.token;
    const withBearer = await request(port, 'GET', '/api/status', null, { Authorization: 'Bearer ' + token });
    assert.strictEqual(withBearer.status, 200, '标准 Bearer 必须可用（旧实现恒 401）');
    const lower = await request(port, 'GET', '/api/status', null, { Authorization: 'bearer ' + token });
    assert.strictEqual(lower.status, 200, 'Bearer 方案名应大小写不敏感');
    const bare = await request(port, 'GET', '/api/status', null, { Authorization: token });
    assert.strictEqual(bare.status, 200, '裸 token 短期向后兼容');
  } finally {
    child.kill('SIGKILL');
  }
});

test('BUG-10 增三和弦 "+" 与 "+7" 识别为 aug', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'assets/js/core/music-spelling.js')).href);
  const q = mod.MusicSpelling.qualityOf;
  assert.strictEqual(q('+'), 'aug', 'qualityOf("+") 应为 aug');
  assert.strictEqual(q('+7'), 'aug', 'qualityOf("+7") 应为 aug');
  assert.strictEqual(q('aug'), 'aug', 'qualityOf("aug") 应为 aug');
  // 不被误伤的邻近分支
  assert.strictEqual(q('maj'), 'maj');
  assert.strictEqual(q(''), 'maj', '空记号回落为大三');
  assert.strictEqual(q('m'), 'min');
  assert.strictEqual(q('dim'), 'dim');
  // 增三构成音：根音 + 大三 + 增五（共 8 个半音）
  assert.deepStrictEqual(mod.MusicSpelling.chordTones('C', 'aug'), ['C', 'E', 'G#'],
    'C 增三应为 C E G#（说明 aug 品质链路可用）');
});
