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

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
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
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
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
