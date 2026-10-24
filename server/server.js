/* ============================================================
   六弦工坊 · 外网托管 + IPv6 DDNS 服务（零依赖，仅 Node 内置模块）
   - 静态文件服务 + 密码鉴权 + 内存会话 + IP/账号双维度限流
   - 静态资源白名单（BUG-06: version.json 供 SW 派生缓存名）
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

/* ---------- 配置 ---------- */
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  bindHost: process.env.BIND_HOST || '',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPwdHash: process.env.ADMIN_PWD_HASH || '',
  sessionTtlMs: 24 * 3600 * 1000,
  maxFailPerAccount: 5,
  maxFailPerIp: 20,
  lockoutMs: 15 * 60 * 1000,
};

/* ---------- 弱口令检测 ---------- */
const WEAK_LIST = new Set([
  '12345678','88888888','password','qwertyui','abcdefgh','11111111',
  'admin123','root1234','letmein1','trustno1','iloveyou','abcdefgh',
]);
function isWeakPassword(pw) {
  if (!pw || typeof pw !== 'string') return true;
  const trimmed = pw.trim();
  if (trimmed.length !== pw.length) return true;   // BUG-01: 含首尾空格 → 弱口令
  if (trimmed.length < 8) return true;
  if (WEAK_LIST.has(trimmed.toLowerCase())) return true;
  if (/^(\d{8}|[a-z]{8}|[A-Z]{8})$/.test(trimmed)) return true;
  return false;
}

/* ---------- 限流 ---------- */
const ipFails = new Map();      // ip -> { count, lockedUntil }
const acctFails = new Map();    // account(lower) -> { count, lockedUntil }
function _bucket(map, key) {
  const now = Date.now();
  let b = map.get(key);
  if (!b) { b = { count: 0, lockedUntil: 0 }; map.set(key, b); }
  if (b.lockedUntil && now >= b.lockedUntil) { b.count = 0; b.lockedUntil = 0; }
  return b;
}
function loginAllowed(ip, account) {
  const ipB = _bucket(ipFails, ip);
  const acB = _bucket(acctFails, (account || '').toLowerCase());
  const now = Date.now();
  if (ipB.lockedUntil > now) return { ok: false, reason: 'ip_locked' };
  if (acB.lockedUntil > now) return { ok: false, reason: 'account_locked' };
  if (ipB.count >= config.maxFailPerIp) return { ok: false, reason: 'ip_locked' };
  if (acB.count >= config.maxFailPerAccount) return { ok: false, reason: 'account_locked' };
  return { ok: true };
}
function bumpFail(ip, account) {
  const now = Date.now();
  const ipB = _bucket(ipFails, ip);
  const acB = _bucket(acctFails, (account || '').toLowerCase());
  ipB.count++;
  acB.count++;
  if (ipB.count >= config.maxFailPerIp) ipB.lockedUntil = now + config.lockoutMs;
  if (acB.count >= config.maxFailPerAccount) acB.lockedUntil = now + config.lockoutMs;
}
function loginOk(ip, account) {
  ipFails.delete(ip);
  acctFails.delete((account || '').toLowerCase());
}

/* ---------- MIME ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/* ---------- 静态白名单 / 黑名单（BUG-06）---------- */
const STATIC_ROOT_FILES = new Set([
  'index.html', 'version.json', 'sw.js', 'manifest.webmanifest',
  'favicon.ico', 'robots.txt',
]);
const ALLOWED_FILES = new Set([
  'index.html', 'version.json', 'sw.js', 'manifest.webmanifest',
  'favicon.ico', 'robots.txt',
  'assets/css/style.css',
  'assets/js/main.js',
  'assets/js/core/practice-store.js',
  'assets/js/core/music-spelling.js',
  'assets/js/core/audio-devices.js',
  'assets/js/modules/tuner.js',
  'assets/js/modules/metronome.js',
  'assets/js/modules/rhythm.js',
  'assets/js/modules/chord.js',
  'assets/js/modules/scale.js',
  'assets/js/modules/chord-lib.js',
  'assets/js/modules/fretboard.js',
  'assets/js/modules/ear-training.js',
  'assets/js/modules/plan.js',
  'assets/js/modules/stats.js',
  'assets/js/modules/chord-flow.js',
  'assets/images/logo.svg',
]);
// 明确拦截的文件（即使路径匹配也不返回）
const DENY_FILES = new Set([
  'package.json', 'package-lock.json',
  'server/server.js', 'server/.env',
]);

/* ---------- 会话 ---------- */
const sessions = new Map();  // token -> { user, createdAt }
function createSession(user) {
  const tok = crypto.randomBytes(24).toString('hex');
  sessions.set(tok, { user, createdAt: Date.now() });
  return tok;
}
function pruneSessions() {
  const cutoff = Date.now() - config.sessionTtlMs;
  for (const [t, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(t);
  }
}
setInterval(pruneSessions, 3600 * 1000);

/* ---------- 鉴权中间件 ---------- */
function auth(req) {
  const raw = req.headers['authorization'] || '';
  // BUG-09: 兼容标准 "Bearer xxx" 与历史裸 token
  const t = (raw.startsWith('Bearer ') ? raw.slice(7) : raw).trim();
  const s = sessions.get(t);
  if (!s) return null;
  if (Date.now() - s.createdAt > config.sessionTtlMs) { sessions.delete(t); return null; }
  return s;
}

/* ---------- JSON body ---------- */
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on('data', c => { len += c.length; if (len > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- IP 提取 ---------- */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

/* ---------- 安全头 ---------- */
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/* ---------- 静态文件 ---------- */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 只允许根级白名单文件和 assets/ 下文件
  let relPath;
  if (urlPath.startsWith('/assets/')) {
    relPath = urlPath.slice(1); // 去掉前导 /
  } else if (urlPath === '/index.html' || STATIC_ROOT_FILES.has(urlPath.slice(1))) {
    relPath = urlPath.slice(1);
  } else {
    res.writeHead(404); res.end('Not Found'); return;
  }
  // 禁止路径穿越
  const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  if (safeRel.startsWith('..') || path.isAbsolute(safeRel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // BUG-06: 拦截 package.json 等敏感文件
  if (DENY_FILES.has(safeRel)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!ALLOWED_FILES.has(safeRel)) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  const absPath = path.join(ROOT, safeRel);
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(absPath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

/* ---------- CORS（仅管理 API） ---------- */
function corsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '3.1.0', uptime: process.uptime() }));
    return;
  }

  // 管理 API: /api/*
  if (req.url.startsWith('/api/')) {
    corsHeaders(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    /* POST /api/init —— 首次设置管理员口令 */
    if (req.method === 'POST' && req.url === '/api/init') {
      if (config.adminPwdHash) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'already_initialized' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        // BUG-01: 先 trim 再校验，禁止默认口令 / 纯空格
        const pw = typeof body.password === 'string' ? body.password.trim() : '';
        if (pw.length < 8) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'password_too_short', min: 8 }));
          return;
        }
        if (isWeakPassword(pw)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'weak_password' }));
          return;
        }
        config.adminPwdHash = crypto.createHash('sha256').update(pw).digest('hex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400); res.end('Bad Request'); }
      return;
    }

    /* POST /api/login */
    if (req.method === 'POST' && req.url === '/api/login') {
      const ip = clientIp(req);
      try {
        const body = JSON.parse(await readBody(req));
        const user = String(body.user || '').trim();
        const pw = typeof body.password === 'string' ? body.password.trim() : '';

        // BUG-08: 双维度限流
        const allowed = loginAllowed(ip, user);
        if (!allowed.ok) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '900' });
          res.end(JSON.stringify({ error: 'rate_limited', reason: allowed.reason }));
          return;
        }

        const hash = crypto.createHash('sha256').update(pw).digest('hex');
        if (user === config.adminUser && hash === config.adminPwdHash) {
          loginOk(ip, user);
          const token = createSession(user);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, token }));
        } else {
          bumpFail(ip, user);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_credentials' }));
        }
      } catch { res.writeHead(400); res.end('Bad Request'); }
      return;
    }

    /* POST /api/logout */
    if (req.method === 'POST' && req.url === '/api/logout') {
      const raw = req.headers['authorization'] || '';
      const t = (raw.startsWith('Bearer ') ? raw.slice(7) : raw).trim();
      sessions.delete(t);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    /* GET /api/ping —— 验证 token */
    if (req.method === 'GET' && req.url === '/api/ping') {
      const s = auth(req);
      if (!s) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: s.user }));
      return;
    }

    /* 其他 /api/* —— 404 */
    res.writeHead(404); res.end('Not Found');
    return;
  }

  // 管理页面（需鉴权）
  if (req.url === '/admin' || req.url === '/admin/') {
    const s = auth(req);
    if (!s) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>401</h1><p>请通过 <code>Authorization</code> 头提供 token。</p>');
      return;
    }
    const absPath = path.join(ROOT, 'server', 'admin.html');
    fs.stat(absPath, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': stat.size,
      });
      fs.createReadStream(absPath).pipe(res);
    });
    return;
  }

  // 静态文件
  if (req.method === 'GET') { serveStatic(req, res); return; }

  res.writeHead(405); res.end('Method Not Allowed');
});

/* ---------- 启动 ---------- */
if (config.adminPwdHash) {
  console.log('[server] 已配置管理员口令哈希，跳过初始化');
} else {
  console.log('[server] 未配置管理员口令 — 首次使用请 POST /api/init');
}
console.log(`[server] 监听 ${config.port} 端口，根目录 ${ROOT}`);
listen(config.bindHost || '::');
