/* ============================================================
   六弦工坊 · server.js 校验与错误语义测试（V2-BUG-02 / V2-BUG-03 回归）
   ------------------------------------------------------------
   覆盖：
     · PUT /api/config 非法 webPort/bindHost/ttl → 400（不再「假成功」）
     · 合法值正常 200
     · GET /%（URI 解析失败）→ 400；GET /server.js → 404（源码不泄露）
     · 超大请求体 → 413 且响应可达（修复前连接被重置拿不到状态码）
     · 损坏的 config.json 启动自愈（服务仍能起来）
   运行方式：独立子进程起真实服务（随机端口 + GS_CONFIG 临时配置），
   不触碰仓库根目录的真实 config.json。
   ============================================================ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-test-'));
const goodCfg = path.join(TMP, 'good.json');
const badCfg = path.join(TMP, 'bad.json');
fs.writeFileSync(goodCfg, JSON.stringify({ adminPassword: 'test-pw-123' }));
fs.writeFileSync(badCfg, JSON.stringify({ webPort: 'abc', bindHost: 'javascript:alert(1)', ddns: { ttl: -5 } }));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
function reqRaw(port, method, reqPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const reqJSON = (port, method, p, obj, token) =>
  reqRaw(port, method, p, { body: obj ? JSON.stringify(obj) : undefined, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) } });

function startServer(port, cfgFile) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port=' + String(port)],
    { env: { ...process.env, GS_CONFIG: cfgFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.unref();
  return child;
}
async function waitHealthy(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await reqRaw(port, 'GET', '/api/v1/health'); if (r.status === 200) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

let PORT, child, token;

test.before(async () => {
  PORT = await freePort();
  child = startServer(PORT, goodCfg);
  assert.ok(await waitHealthy(PORT), '服务应在 8 秒内就绪');
  const r = await reqJSON(PORT, 'POST', '/api/login', { password: 'test-pw-123' });
  assert.strictEqual(r.status, 200, '登录应成功');
  token = JSON.parse(r.text).token;
  assert.ok(token, '应返回会话 token');
});

test.after(() => { try { child && child.kill(); } catch (_) {} });

/* ---------- V2-BUG-02：PUT /api/config 校验 ---------- */
test('webPort 非法值 400：字符串/0/负数/超范围', async () => {
  for (const v of ['abc', 0, -1, 99999, 8080.5]) {
    const r = await reqJSON(PORT, 'PUT', '/api/config', { webPort: v }, token);
    assert.strictEqual(r.status, 400, `webPort=${JSON.stringify(v)} 应 400`);
    assert.ok(JSON.parse(r.text).msg.includes('webPort'));
  }
});
test('bindHost 非法值 400：非 IP 字符串被拒', async () => {
  const r = await reqJSON(PORT, 'PUT', '/api/config', { bindHost: 'javascript:alert(1)' }, token);
  assert.strictEqual(r.status, 400);
});
test('bindHost 合法值 200：IPv4/IPv6/localhost', async () => {
  for (const h of ['0.0.0.0', '::', 'localhost']) {
    const r = await reqJSON(PORT, 'PUT', '/api/config', { bindHost: h }, token);
    assert.strictEqual(r.status, 200, `bindHost=${h} 应 200`);
  }
});
test('ddns.ttl 非法值 400 / 合法值 200', async () => {
  let r = await reqJSON(PORT, 'PUT', '/api/config', { ddns: { ttl: -5 } }, token);
  assert.strictEqual(r.status, 400);
  r = await reqJSON(PORT, 'PUT', '/api/config', { ddns: { ttl: 59 } }, token);
  assert.strictEqual(r.status, 400);
  r = await reqJSON(PORT, 'PUT', '/api/config', { ddns: { ttl: 600 } }, token);
  assert.strictEqual(r.status, 200);
});
test('合法 webPort 200 且被接受（健康检查仍通）', async () => {
  const r = await reqJSON(PORT, 'PUT', '/api/config', { webPort: PORT }, token);
  assert.strictEqual(r.status, 200);
  assert.ok(await waitHealthy(PORT), '健康检查应仍通');
});

/* ---------- V2-BUG-03：错误语义 ---------- */
test('GET /%（URI 解析失败）→ 400 而非 500', async () => {
  const r = await reqRaw(PORT, 'GET', '/%');
  assert.strictEqual(r.status, 400);
});
test('GET /server.js → 404（源码不泄露）', async () => {
  const r = await reqRaw(PORT, 'GET', '/server.js');
  assert.strictEqual(r.status, 404);
});
test('GET /guitar-studio.html → 200（正常服务不受影响）', async () => {
  const r = await reqRaw(PORT, 'GET', '/guitar-studio.html');
  assert.strictEqual(r.status, 200);
});
test('250KB 请求体 → 413 JSON 响应可达（修复前连接被重置）', async () => {
  const big = 'x'.repeat(250 * 1024);
  const r = await reqJSON(PORT, 'POST', '/api/login', { password: big });
  assert.strictEqual(r.status, 413, `应 413，实际 ${r.status}`);
  assert.ok(JSON.parse(r.text).msg.includes('200KB'), '应返回中文错误说明');
});
test('非 JSON 请求体 → 400 带说明（修复前 500）', async () => {
  const r = await reqRaw(PORT, 'POST', '/api/login', { body: 'xx', headers: { 'Content-Type': 'application/json' } });
  assert.strictEqual(r.status, 400, `应 400，实际 ${r.status}`);
});

/* ---------- V2-BUG-02：损坏配置自愈 ---------- */
test('config.json 被改坏（webPort="abc"）服务仍能启动', async () => {
  const p2 = await freePort();
  const c2 = startServer(p2, badCfg);
  try {
    assert.ok(await waitHealthy(p2), '自愈后服务应正常监听');
  } finally { try { c2.kill(); } catch (_) {} }
});
