/* ============================================================
   六弦工坊 V3.1 · S0 部署后台安全加固测试
   ------------------------------------------------------------
   覆盖：
     · S0.1 初始化状态机：未初始化时 /api/* → 409；init-status 可见；
           设置弱口令/默认口令被拒；初始化成功后登录可用
     · S0.2 安全响应头：X-Content-Type-Options / X-Frame-Options /
           Referrer-Policy / CSP 在静态页与 API 上均存在
     · S0.3 登录限流：连续失败达阈值后锁定（429），锁定期间正确口令也被拒
   说明：独立子进程 + 临时配置文件（GS_CONFIG），不触碰仓库真实 config.json。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// BUG-07：中文路径下 new URL(...).pathname 是百分号编码串（如 /Coze/Drive/%E6%89%A3%E5%AD%90/...），
// 直接传给 spawn 会 ENOENT，导致本文件全部用例在 before 钩子失败。fileURLToPath 负责正确解码。
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sec-'));
const unsetCfg = path.join(TMP, 'unset.json');      // 无口令 → 需要初始化
const weakCfg = path.join(TMP, 'weak.json');        // 弱口令 → 仍需要初始化
fs.writeFileSync(unsetCfg, JSON.stringify({ webPort: 8080 }));
fs.writeFileSync(weakCfg, JSON.stringify({ adminPassword: 'admin123' }));
const initCfg = path.join(TMP, 'init.json');        // 初始化写入目标

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function req(port, method, reqPath, body) {
  return reqH(port, method, reqPath, body, null);
}
function reqH(port, method, reqPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(extraHeaders || {}) };
    const r = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data, json: (() => { try { return JSON.parse(data); } catch (_) { return null; } })() }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
/* 起一个独立配置的服务实例，返回 { port, child }，调用方负责 kill */
async function freshServer(password) {
  const p = await freePort();
  const cfg = path.join(TMP, `reg-${p}.json`);
  fs.writeFileSync(cfg, JSON.stringify(password ? { adminPassword: password } : { webPort: 8080 }));
  const child = startServer(p, cfg);
  assert.ok(await waitReady(p), '回归测试服务应就绪');
  return { port: p, child };
}
function startServer(port, cfgPath) {
  return spawn(process.execPath, [path.join(ROOT, 'server', 'server.js'), `--port=${port}`], {
    env: { ...process.env, GS_CONFIG: cfgPath }, stdio: 'ignore'
  });
}
async function waitReady(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await req(port, 'GET', '/api/v1/health'); if (r.status === 200) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

let port, child;
test.before(async () => {
  port = await freePort();
  child = startServer(port, initCfg);
  assert.ok(await waitReady(port), '服务应在 8 秒内就绪');
});
test.after(() => { try { child && child.kill(); } catch (_) {} });

/* ---------- S0.1 初始化状态机 ---------- */
test('S0.1 未初始化：init-status 报告 needInit=true', async () => {
  const r = await req(port, 'GET', '/api/init-status');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.needInit, true, '新配置应需要初始化');
});

test('S0.1 未初始化：登录与配置接口一律 409', async () => {
  const login = await req(port, 'POST', '/api/login', { password: 'whatever' });
  assert.strictEqual(login.status, 409, '未初始化时登录应被阻断（默认口令不再存在于代码路径）');
  assert.strictEqual(login.json.needInit, true);
  const cfg = await req(port, 'GET', '/api/config');
  assert.strictEqual(cfg.status, 409, '未初始化时配置接口应被阻断');
});

test('S0.1 弱口令/默认口令初始化被拒', async () => {
  const short = await req(port, 'POST', '/api/init', { password: 'abc' });
  assert.strictEqual(short.status, 400, '少于 8 位应被拒');
  const def = await req(port, 'POST', '/api/init', { password: 'admin123' });
  assert.strictEqual(def.status, 400, '默认口令 admin123 应被拒');
});

test('S0.1 合法口令初始化成功后登录可用，且重复初始化被拒', async () => {
  const init = await req(port, 'POST', '/api/init', { password: 'Str0ng-Pass-2026' });
  assert.strictEqual(init.status, 200, '合法口令应初始化成功');
  assert.ok(init.json.token, '应直接下发会话 token');
  const again = await req(port, 'POST', '/api/init', { password: 'Another-Pass-2026' });
  assert.strictEqual(again.status, 400, '已完成初始化后不应重复设置');
  const login = await req(port, 'POST', '/api/login', { password: 'Str0ng-Pass-2026' });
  assert.strictEqual(login.status, 200, '初始化后应可正常登录');
  const st = await req(port, 'GET', '/api/init-status');
  assert.strictEqual(st.json.needInit, false);
});

/* ---------- S0.2 安全响应头 ---------- */
test('S0.2 静态页响应带安全头', async () => {
  const r = await req(port, 'GET', '/app.html');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(r.headers['x-frame-options'], 'SAMEORIGIN');
  assert.strictEqual(r.headers['referrer-policy'], 'no-referrer');
  assert.ok(r.headers['content-security-policy'], '应存在 CSP');
  assert.ok(r.headers['content-security-policy'].includes("default-src 'self'"));
});

test('S0.2 CSP 放行 blob: worker（Tone.js 后台时钟，避免节拍漂移）', async () => {
  const r = await req(port, 'GET', '/app.html');
  const csp = r.headers['content-security-policy'] || '';
  const w = /worker-src([^;]*)/.exec(csp);
  assert.ok(w, 'CSP 应显式声明 worker-src');
  assert.ok(w[1].includes('blob:'), `worker-src 需放行 blob:，实际=${w[1].trim()}`);
  assert.ok(/media-src[^;]*mediastream:/.test(csp), 'media-src 需放行 mediastream（麦克风）');
});

test('S0.2 API 响应带安全头', async () => {
  const r = await req(port, 'GET', '/api/v1/health');
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(r.headers['x-frame-options'], 'SAMEORIGIN');
  assert.ok(r.headers['permissions-policy'], '应存在 Permissions-Policy');
});

/* ---------- S0.3 登录限流（IP + 账号双维度） ---------- */
test('S0.3 连续失败达阈值后锁定，锁定期间正确口令也被拒', async () => {
  const p2 = await freePort();
  const cfg2 = path.join(TMP, 'limit.json');
  fs.writeFileSync(cfg2, JSON.stringify({ adminPassword: 'Limit-Test-Pass' }));
  const c2 = startServer(p2, cfg2);
  try {
    assert.ok(await waitReady(p2), '限流测试服务应就绪');
    let locked = false;
    for (let i = 0; i < 6; i++) {
      const r = await req(p2, 'POST', '/api/login', { password: 'wrong-pass-' + i, account: 'tester' });
      if (r.status === 429) { locked = true; break; }
      assert.strictEqual(r.status, 401, `第 ${i + 1} 次错误口令应 401`);
    }
    // 阈值 5 次：第 6 次触发锁定（阈值内为 401，达到阈值后后续请求 429）
    if (!locked) {
      const after = await req(p2, 'POST', '/api/login', { password: 'Limit-Test-Pass', account: 'tester' });
      assert.strictEqual(after.status, 429, '达到阈值后正确口令也应被临时锁定');
      locked = true;
    }
    assert.ok(locked, '应在有限次数内触发锁定');
  } finally { try { c2.kill(); } catch (_) {} }
});

test('S0.1 默认口令不在任何代码路径（源码扫描）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
  // 仅允许出现在 DEFAULT_CONFIG 默认值块内，或作为「禁止使用默认口令」的校验/提示
  const start = code.indexOf('const DEFAULT_CONFIG = {');
  const end = code.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, '应能定位 DEFAULT_CONFIG 块');
  code.split('\n').forEach((line, i) => {
    if (!line.includes('admin123')) return;
    const offset = code.split('\n').slice(0, i).join('\n').length;
    const inDefaultBlock = offset > start && offset < end;
    assert.ok(inDefaultBlock || /不能使用默认口令|isDefaultPassword|DEFAULT_CONFIG/.test(line),
      `默认口令不应出现在其它代码路径：${line.trim()}`);
  });
});

/* ============================================================
   V3.1 缺陷修复回归（BUG-01 / 06 / 08 / 09）
   ============================================================ */

/* BUG-01：纯空白口令不能绕过长度校验（trim 后不足 8 位必须 400） */
test('回归 BUG-01：纯空白/带前后空格的弱口令初始化被拒', async () => {
  const srv = await freshServer(null);
  try {
    const blank = await req(srv.port, 'POST', '/api/init', { password: '        ' });
    assert.strictEqual(blank.status, 400, '8 个空格 trim 后为空，应 400');
    const tabnl = await req(srv.port, 'POST', '/api/init', { password: '\t\n  \t' });
    assert.strictEqual(tabnl.status, 400, '纯制表符换行应 400');
    const shortPad = await req(srv.port, 'POST', '/api/init', { password: '  ab12  ' });
    assert.strictEqual(shortPad.status, 400, 'trim 后不足 8 位应 400');
    // 前后空格包裹的合法口令：服务端 trim 后接受，且用去空格口令可登录
    const ok = await req(srv.port, 'POST', '/api/init', { password: '  Good-Pass-9' });
    assert.strictEqual(ok.status, 200, 'trim 后达强度要求应通过');
    const loginTrimmed = await req(srv.port, 'POST', '/api/login', { password: 'Good-Pass-9' });
    assert.strictEqual(loginTrimmed.status, 200, '存储口令应为 trim 后的值');
    const loginRaw = await req(srv.port, 'POST', '/api/login', { password: '  Good-Pass-9' });
    assert.strictEqual(loginRaw.status, 401, '带空格的原始口令不应匹配');
  } finally { try { srv.child.kill(); } catch (_) {} }
});

/* BUG-08：同一 IP 下轮换账号撞库，IP 维度也要锁定（429） */
test('回归 BUG-08：同 IP 跨账号轮换撞库触发 IP 维度 429', async () => {
  const srv = await freshServer('Cred-Stuff-Pass-1');
  try {
    let saw429 = false;
    // 每账号最多失败 2~4 次就换名，单账号永远到不了 5 次阈值
    for (let i = 0; i < 12; i++) {
      const account = 'attacker-' + Math.floor(i / 3);
      const r = await req(srv.port, 'POST', '/api/login', { password: 'wrong-' + i, account });
      if (r.status === 429) { saw429 = true; break; }
      assert.ok(r.status === 401, `锁定前应返回 401，实际 ${r.status}`);
    }
    assert.ok(saw429, '同一来源 IP 累计失败达阈值后应被 429，即使账号一直在换');
    // 锁定期间换新账号、正确口令同样被拦
    const blocked = await req(srv.port, 'POST', '/api/login', { password: 'Cred-Stuff-Pass-1', account: 'totally-new-admin' });
    assert.strictEqual(blocked.status, 429, 'IP 锁定期间任何账号都应被拦截');
  } finally { try { srv.child.kill(); } catch (_) {} }
});

/* BUG-09：标准 Bearer 头与历史裸 token 都应通过鉴权 */
test('回归 BUG-09：Bearer 头与裸 token 均可访问受保护接口', async () => {
  const srv = await freshServer('Bearer-Test-Pass');
  try {
    const login = await req(srv.port, 'POST', '/api/login', { password: 'Bearer-Test-Pass' });
    assert.strictEqual(login.status, 200);
    const token = login.json.token;
    assert.ok(token, '登录应返回 token');

    const noAuth = await req(srv.port, 'GET', '/api/status');
    assert.strictEqual(noAuth.status, 401, '无 Authorization 头应 401');
    const garbage = await reqH(srv.port, 'GET', '/api/status', null, { Authorization: 'Bearer ' });
    assert.strictEqual(garbage.status, 401, '空 Bearer 应 401');

    const bearer = await reqH(srv.port, 'GET', '/api/status', null, { Authorization: 'Bearer ' + token });
    assert.strictEqual(bearer.status, 200, '标准 Bearer 头应通过（前端 admin.html 实际发送格式）');
    const raw = await reqH(srv.port, 'GET', '/api/status', null, { Authorization: token });
    assert.strictEqual(raw.status, 200, '历史裸 token 应保持兼容');
    const padded = await reqH(srv.port, 'GET', '/api/status', null, { Authorization: '  ' + token + '  ' });
    assert.strictEqual(padded.status, 200, '带空白的裸 token 应 trim 后通过');
  } finally { try { srv.child.kill(); } catch (_) {} }
});

/* BUG-06：version.json 必须经静态白名单对外可读（sw.js 缓存名派生依赖） */
test('回归 BUG-06：GET /version.json 返回 200 且含版本号，package.json 仍被拦', async () => {
  const srv = await freshServer('Version-Test-Pass');
  try {
    const v = await req(srv.port, 'GET', '/version.json');
    assert.strictEqual(v.status, 200, 'version.json 应加入静态白名单');
    assert.ok(/application\/json/.test(v.headers['content-type'] || ''), 'Content-Type 应为 JSON');
    assert.ok(v.json && typeof v.json.version === 'string' && v.json.version, '应含非空 version 字段');

    const pkg = await req(srv.port, 'GET', '/package.json');
    assert.notStrictEqual(pkg.status, 200, 'package.json 不得因修白名单而泄露（DENY_FILES 仍生效）');
  } finally { try { srv.child.kill(); } catch (_) {} }
});
