// server-security.test.js — BUG-01/06/07/08/09 服务端安全测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server', 'server.js');
const PORT = 19800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc;
let cfgFile;

function freshServer(env = {}) {
  const e = { ...process.env, ...env, GS_CONFIG: env.GS_CONFIG || '' };
  return spawn('node', [SERVER, `--port=${PORT}`], {
    env: e,
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function startServer(env = {}) {
  if (serverProc) serverProc.kill();
  serverProc = freshServer(env);
  await waitReady();
}

async function waitReady(timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`${BASE}/api/v1/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server not ready');
}

async function killServer() {
  if (serverProc) { serverProc.kill(); serverProc = null; }
  if (cfgFile) { try { fs.unlinkSync(cfgFile); } catch {} cfgFile = null; }
  await new Promise(r => setTimeout(r, 100));
}

function tmpConfig(obj) {
  const f = path.join(ROOT, `.test-cfg-${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(obj));
  cfgFile = f;
  return f;
}

test.afterEach(async () => { await killServer(); });

// S0.1：未初始化时，/api/login → 409
test('S0.1 needInit blocks login', async () => {
  const cfg = tmpConfig({}); // no adminPassword
  await startServer({ GS_CONFIG: cfg });
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password:'any'}) });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.needInit, true);
});

// S0.1：/api/init-status → needInit: true
test('S0.1 init-status reports needInit', async () => {
  const cfg = tmpConfig({});
  await startServer({ GS_CONFIG: cfg });
  const r = await fetch(`${BASE}/api/init-status`);
  const j = await r.json();
  assert.equal(j.needInit, true);
});

// S0.1：init 成功后，/api/login 正常
test('S0.1 init then login works', async () => {
  const cfg = tmpConfig({});
  await startServer({ GS_CONFIG: cfg });
  const initR = await fetch(`${BASE}/api/init`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'Good-Pass-9'}) });
  assert.equal(initR.status, 200);
  const initJ = await initR.json();
  assert.ok(initJ.ok);
  assert.ok(initJ.token);
  const r2 = await fetch(`${BASE}/api/init-status`);
  const j2 = await r2.json();
  assert.equal(j2.needInit, false);
});

// BUG-01：空白口令不能通过 init
test('BUG-01: reject blank / short password in /api/init', async () => {
  const cfg = tmpConfig({});
  await startServer({ GS_CONFIG: cfg });
  for (const bad of ['', '   ', '\t\n  \t', 'short', '  ab12  ']) {
    const r = await fetch(`${BASE}/api/init`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: bad}) });
    assert.equal(r.status, 400, `should reject ${JSON.stringify(bad)}`);
  }
});

// BUG-01：禁止默认口令 admin123
test('BUG-01: reject default password admin123', async () => {
  const cfg = tmpConfig({});
  await startServer({ GS_CONFIG: cfg });
  const r = await fetch(`${BASE}/api/init`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'admin123'}) });
  assert.equal(r.status, 400);
});

// BUG-01：init 成功后 login 用 trim 后口令可以
test('BUG-01: login with trimmed password after init', async () => {
  const cfg = tmpConfig({});
  await startServer({ GS_CONFIG: cfg });
  await fetch(`${BASE}/api/init`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'  Good-Pass-9'}) });
  const r1 = await fetch(`${BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'Good-Pass-9'}) });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'  Good-Pass-9'}) });
  assert.equal(r2.status, 401);
});

// BUG-06：version.json 可访问，package.json 不可
test('BUG-06: version.json allowed, package.json blocked', async () => {
  const cfg = tmpConfig({adminPassword:'Test-9999'});
  await startServer({ GS_CONFIG: cfg });
  const r1 = await fetch(`${BASE}/version.json`);
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${BASE}/package.json`);
  assert.notEqual(r2.status, 200);
});

// BUG-08：IP+账号双维度限流
test('BUG-08: rate-limit blocks after repeated failures', async () => {
  const cfg = tmpConfig({adminPassword:'Test-9999'});
  await startServer({ GS_CONFIG: cfg });
  for (let i = 0; i < 6; i++) {
    await fetch(`${BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'wrong'}) });
  }
  const r = await fetch(`${BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'Test-9999'}) });
  assert.equal(r.status, 429);
});

// BUG-09：Bearer 头与裸 token 都应通过
test('BUG-09: auth accepts Bearer token and bare token', async () => {
  const cfg = tmpConfig({adminPassword:'Test-9999'});
  await startServer({ GS_CONFIG: cfg });
  const loginR = await fetch(`${BASE}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'Test-9999'}) });
  const j = await loginR.json();
  const token = j.token;
  // Bearer
  const r1 = await fetch(`${BASE}/api/status`, { headers: { 'Authorization': `Bearer ${token}` } });
  assert.equal(r1.status, 200);
  // bare
  const r2 = await fetch(`${BASE}/api/status`, { headers: { 'Authorization': token } });
  assert.equal(r2.status, 200);
  // no auth
  const r3 = await fetch(`${BASE}/api/status`);
  assert.equal(r3.status, 401);
});
