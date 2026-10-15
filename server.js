/* ============================================================
   六弦工坊 · 外网托管 + IPv6 DDNS 服务（零依赖，仅 Node 内置模块）
   - 同时托管吉他网页与后台面板，根路径只返回吉他网页
   - 双栈监听（IPv6 + IPv4），端口可在后台 / 命令行 / 配置文件调配
   - 网卡枚举 + 外部探测双路获取公网 IPv6
   - 支持 Cloudflare / 腾讯云 DNSPod 的 AAAA 记录动态更新
   - Windows / CentOS 通用，也可直接放在 Nginx 之后（/api 反代）
   运行：node server.js [--port=8080]
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

/* ---------------- 配置 ---------------- */
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULT_CONFIG = {
  adminPassword: 'admin123',
  webPort: 8080,
  bindHost: '::',                 // :: 为 IPv6+IPv4 双栈；可改为 0.0.0.0 仅 IPv4
  ipv6: {
    mode: 'auto',                 // auto | manual
    manualAddress: '',
    preferInterface: ''           // 可选：指定网卡名
  },
  ddns: {
    enabled: false,
    provider: 'cloudflare',       // cloudflare | dnspod
    domain: 'example.com',        // 主域名
    sub: 'guitar',                // 主机记录；@ 表示根域名
    ttl: 120,
    cfProxy: false,               // Cloudflare 橙云代理（默认 DNS only 直连）
    cfToken: '',
    dpId: '',                     // DNSPod Token ID
    dpToken: '',                  // DNSPod Token
    intervalMin: 5
  },
  lastIPv6: '',
  lastUpdate: 0,
  lastResult: ''
};

function clone(o){ return JSON.parse(JSON.stringify(o)); }
function deepMerge(base, over){
  if(!over || typeof over !== 'object') return base;
  for(const k of Object.keys(over)){
    if(over[k] && typeof over[k] === 'object' && base[k] && typeof base[k] === 'object' && !Array.isArray(over[k])){
      deepMerge(base[k], over[k]);
    }else if(over[k] !== undefined && over[k] !== null){
      base[k] = over[k];
    }
  }
  return base;
}
let config = clone(DEFAULT_CONFIG);
function loadConfig(){
  try{
    if(fs.existsSync(CONFIG_PATH)){
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = deepMerge(clone(DEFAULT_CONFIG), raw);
    }
  }catch(e){ log('配置文件读取失败，使用默认配置：'+e.message, 'warn'); }
}
function saveConfig(){
  try{
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  }catch(e){ log('配置写入失败：'+e.message, 'err'); return false; }
}
/* 下发给前端时对凭证脱敏 */
function publicConfig(){
  const c = clone(config);
  const d = c.ddns;
  if(d.cfToken) d.cfToken = '••••••••' + d.cfToken.slice(-4);
  if(d.dpToken) d.dpToken = '••••••••' + d.dpToken.slice(-4);
  if(d.dpId) d.dpId = '••••' + d.dpId.slice(-4);
  return c;
}

/* ---------------- 日志（环形缓冲） ---------------- */
const logs = [];
const LOG_MAX = 300;
function log(msg, level='info'){
  const item = { ts: Date.now(), level, msg: String(msg) };
  logs.push(item);
  if(logs.length > LOG_MAX) logs.shift();
  const tag = { info:'[INFO]', warn:'[WARN]', err:'[ERROR]', ok:'[ OK ]' }[level] || '[INFO]';
  const line = new Date(item.ts).toLocaleString('zh-CN', { hour12:false }) + ' ' + tag + ' ' + msg;
  if(level === 'err') console.error(line); else console.log(line);
}

/* ---------------- 会话 ---------------- */
let sessionToken = null;
function newSession(){
  sessionToken = crypto.randomBytes(24).toString('hex');
  return sessionToken;
}

/* ============================================================
   IPv6 探测
   ============================================================ */
function isGlobalUnicastV6(addr){
  if(!addr || addr.includes('.')) return false;
  const a = addr.toLowerCase();
  if(a === '::1') return false;
  if(a.startsWith('fe80') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) return false; // 链路本地
  if(a.startsWith('fc') || a.startsWith('fd')) return false; // 唯一本地
  if(a.startsWith('ff')) return false; // 组播
  if(a.startsWith('2') || a.startsWith('3')) return true;    // 2000::/3 全局单播
  return false;
}
/* 枚举本机网卡上的全局 IPv6 */
function localIPv6Candidates(){
  const out = [];
  const nets = os.networkInterfaces();
  for(const [iface, arr] of Object.entries(nets)){
    if(config.ipv6.preferInterface && iface !== config.ipv6.preferInterface) continue;
    for(const ni of arr || []){
      if(ni.family === 'IPv6' && !ni.internal && isGlobalUnicastV6(ni.address)){
        const addr = ni.address.split('%')[0].toLowerCase();
        if(!out.find(x => x.address === addr)) out.push({ address: addr, iface });
      }
    }
  }
  return out;
}
/* 外部探测：多个 IPv6 地址回显服务并发竞速，取最快成功 */
function fetchExternalIPv6(){
  const services = [
    'https://6.ipw.cn/',
    'https://api-ipv6.ip.sb/ip',
    'https://v6.ident.me/',
    'https://api6.ipify.org/'
  ];
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(()=>{ if(!done){ done = true; resolve(null); } }, 6000);
    services.forEach(u => {
      const req = https.get(u, { timeout: 5000, headers: { 'User-Agent': 'guitar-studio-ddns/1.0' } }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => data += c);
        res.on('end', () => {
          clearTimeout(timer);
          const ip = data.trim().split(/\r?\n/)[0].trim().toLowerCase();
          if(!done && isGlobalUnicastV6(ip)){ done = true; resolve(ip); }
        });
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
    });
  });
}
/* 综合得到当前应使用的公网 IPv6 */
async function detectIPv6(){
  const candidates = localIPv6Candidates();
  let external = null;
  try{ external = await fetchExternalIPv6(); }catch(e){}
  let selected = null, source = '';
  if(config.ipv6.mode === 'manual' && config.ipv6.manualAddress){
    selected = config.ipv6.manualAddress.trim().toLowerCase();
    source = 'manual';
  }else if(external){
    selected = external;
    source = candidates.find(c => c.address === external) ? 'external+nic' : 'external';
  }else if(candidates.length){
    selected = candidates[0].address;
    source = 'nic';
  }
  return {
    address: selected,
    external,
    candidates,
    source,
    ts: Date.now()
  };
}

/* 全局 IPv6 状态：后台异步探测，状态接口立即返回，避免阻塞页面 */
let ipState = { address:null, external:null, candidates:[], source:'', ts:0 };
let ipProbing = false;
async function probeIPv6(force){
  if(ipProbing && !force) return ipState;
  ipProbing = true;
  try{
    const det = await detectIPv6();
    ipState = det;
  }catch(e){
    log('IPv6 探测异常：' + e.message, 'warn');
  }finally{
    ipProbing = false;
  }
  return ipState;
}

/* ============================================================
   HTTP 小工具
   ============================================================ */
function httpRequest(method, urlStr, { headers={}, body=null, timeout=12000 } = {}){
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'guitar-studio-ddns/1.0', ...headers }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try{ json = JSON.parse(data); }catch(e){}
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时')));
    if(body) req.write(body);
    req.end();
  });
}
function formEncode(obj){
  return Object.entries(obj).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
}

/* ============================================================
   DDNS 提供商适配
   ============================================================ */
const DDNS = {
  fullDomain(){
    const d = config.ddns;
    return (!d.sub || d.sub === '@') ? d.domain : d.sub + '.' + d.domain;
  },

  async cloudflare(ip){
    const d = config.ddns;
    if(!d.cfToken) throw new Error('缺少 Cloudflare API Token');
    const H = { 'Authorization': 'Bearer ' + d.cfToken, 'Content-Type': 'application/json' };
    // 1) 找 Zone
    let z = await httpRequest('GET', `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(d.domain)}`, { headers: H });
    if(z.status !== 200 || !z.json || !z.json.success || !z.json.result.length)
      throw new Error('Cloudflare 未找到域名 Zone，请检查 Token 权限与主域名');
    const zoneId = z.json.result[0].id;
    const full = this.fullDomain();
    // 2) 查现有 AAAA 记录
    let q = await httpRequest('GET',
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=AAAA&name=${encodeURIComponent(full)}`,
      { headers: H });
    if(q.status !== 200 || !q.json || !q.json.success) throw new Error('Cloudflare 查询 AAAA 记录失败');
    const existing = q.json.result[0];
    const payload = {
      type: 'AAAA', name: full, content: ip, ttl: Number(d.ttl) || 120,
      proxied: !!d.cfProxy, comment: 'Updated by Guitar Studio DDNS'
    };
    let r;
    if(existing){
      r = await httpRequest('PUT',
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`,
        { headers: H, body: JSON.stringify(payload) });
    }else{
      r = await httpRequest('POST',
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
        { headers: H, body: JSON.stringify(payload) });
    }
    if(r.status !== 200 || !r.json || !r.json.success)
      throw new Error('Cloudflare 写入失败：' + (r.json ? JSON.stringify(r.json.errors) : r.status));
    return existing ? '已更新' : '已新建';
  },

  async dnspod(ip){
    const d = config.ddns;
    if(!d.dpId || !d.dpToken) throw new Error('缺少 DNSPod Token ID / Token');
    const base = {
      login_token: `${d.dpId},${d.dpToken}`,
      format: 'json',
      domain: d.domain
    };
    const sub = (!d.sub || d.sub === '@') ? '@' : d.sub;
    // 1) 列记录
    const listBody = formEncode({ ...base, sub_domain: sub, record_type: 'AAAA' });
    let list = await httpRequest('POST', 'https://dnsapi.cn/Record.List', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: listBody
    });
    const lj = list.json;
    if(!lj || String(lj.status.code) !== '1')
      throw new Error('DNSPod 查询失败：' + (lj && lj.status && lj.status.message ? lj.status.message : list.status));
    const records = (lj.records || []).filter(r => r.type === 'AAAA');
    const common = {
      ...base,
      sub_domain: sub,
      record_type: 'AAAA',
      record_line: '默认',
      value: ip,
      ttl: String(Number(d.ttl) || 120)
    };
    let r;
    if(records.length){
      const rec = records[0];
      const body = formEncode({
        ...common,
        record_id: rec.id,
        record_line_id: rec.line_id || '0'
      });
      r = await httpRequest('POST', 'https://dnsapi.cn/Record.Modify', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    }else{
      r = await httpRequest('POST', 'https://dnsapi.cn/Record.Create', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode(common) });
    }
    const rj = r.json;
    if(!rj || String(rj.status.code) !== '1')
      throw new Error('DNSPod 写入失败：' + (rj && rj.status ? rj.status.message : r.status));
    return records.length ? '已更新' : '已新建';
  },

  /* 执行一次 DDNS 同步 */
  async run(){
    const d = config.ddns;
    const det = await detectIPv6();
    ipState = det;
    if(!det.address){
      const msg = '未获取到公网 IPv6（请确认网络已分配 IPv6）';
      config.lastResult = '失败：' + msg; config.lastUpdate = Date.now(); saveConfig();
      log(msg, 'err');
      return { ok:false, msg, detect: det };
    }
    if(config.lastIPv6 === det.address){
      config.lastUpdate = Date.now();
      config.lastResult = 'IP 未变化，跳过更新';
      saveConfig();
      log(`IPv6 未变化（${det.address}），跳过`, 'info');
      return { ok:true, msg:'IP 未变化，无需更新', detect: det, changed:false };
    }
    try{
      const action = d.provider === 'dnspod' ? await this.dnspod(det.address) : await this.cloudflare(det.address);
      config.lastIPv6 = det.address;
      config.lastUpdate = Date.now();
      config.lastResult = `${action} ${this.fullDomain()} → ${det.address}`;
      saveConfig();
      log(`DDNS ${action}：${this.fullDomain()} → ${det.address}`, 'ok');
      return { ok:true, msg: config.lastResult, detect: det, changed:true };
    }catch(e){
      config.lastUpdate = Date.now();
      config.lastResult = '失败：' + e.message;
      saveConfig();
      log('DDNS 更新失败：' + e.message, 'err');
      return { ok:false, msg: e.message, detect: det };
    }
  }
};

/* ---------------- 定时任务 ---------------- */
let ddnsTimer = null;
function stopTimer(){
  if(ddnsTimer){ clearInterval(ddnsTimer); ddnsTimer = null; }
}
function startTimer(){
  stopTimer();
  if(!config.ddns.enabled) return;
  const ms = Math.max(1, Number(config.ddns.intervalMin) || 5) * 60 * 1000;
  ddnsTimer = setInterval(() => { DDNS.run().catch(e => log(e.message, 'err')); }, ms);
  log(`DDNS 定时任务已开启，每 ${config.ddns.intervalMin} 分钟检查一次`, 'ok');
}

/* ============================================================
   静态文件（根路径只返回吉他网页）
   ============================================================ */
const MIME = {
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.txt':'text/plain; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.webm':'audio/webm', '.mp4':'audio/mp4', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.woff':'font/woff', '.woff2':'font/woff2'
};
/* 仅允许这些静态文件被外部访问，避免泄露源码/配置/部署脚本 */
const ALLOWED_FILES = new Set([
  'guitar-studio.html', 'admin.html', 'index.html',
  'app-1.js', 'app-2.js', 'app-3.js'
]);
const ALLOWED_EXT = new Set(['.png','.jpg','.jpeg','.gif','.svg','.ico','.webm','.mp4','.wav','.ogg','.woff','.woff2','.css']);

function serveStatic(req, res, pathname){
  let rel = decodeURIComponent(pathname);
  if(rel === '/' || rel === '') rel = '/guitar-studio.html'; // 根路径只返回吉他网页
  if(rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  // 防路径穿越
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if(!filePath.startsWith(ROOT)){ res.writeHead(403); return res.end('403 Forbidden'); }
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const allowed = ALLOWED_FILES.has(base) || (ALLOWED_EXT.has(ext) && !base.startsWith('.'));
  if(!allowed){ res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('404 Not Found'); }
  fs.readFile(filePath, (err, data) => {
    if(err){ res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- API 工具 ---------------- */
function sendJSON(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if(data.length > 200000) req.destroy(); });
    req.on('end', () => {
      if(!data) return resolve({});
      try{ resolve(JSON.parse(data)); }catch(e){ reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
function auth(req){
  const t = req.headers['authorization'] || (req.url.includes('token=') ? new URL(req.url, 'http://x').searchParams.get('token') : '');
  return t && t === sessionToken;
}

/* ============================================================
   HTTP 服务
   ============================================================ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  try{
    /* 登录 */
    if(pathname === '/api/login' && req.method === 'POST'){
      const body = await readBody(req);
      if(body.password && body.password === config.adminPassword){
        const token = newSession();
        log('管理员登录成功', 'ok');
        return sendJSON(res, 200, { ok:true, token });
      }
      log('管理员登录失败（密码错误）', 'warn');
      return sendJSON(res, 401, { ok:false, msg:'密码错误' });
    }

    /* 以下接口均需登录 */
    if(pathname.startsWith('/api/')){
      if(!auth(req)) return sendJSON(res, 401, { ok:false, msg:'未登录或登录已失效' });

      if(pathname === '/api/status' && req.method === 'GET'){
        if(Date.now() - ipState.ts > 10000 && !ipProbing) probeIPv6();
        return sendJSON(res, 200, {
          ok:true,
          ipv6: Object.assign({}, ipState, { probing: ipProbing }),
          ddns: {
            enabled: config.ddns.enabled,
            provider: config.ddns.provider,
            fullDomain: DDNS.fullDomain(),
            running: !!ddnsTimer,
            intervalMin: config.ddns.intervalMin,
            lastIPv6: config.lastIPv6,
            lastUpdate: config.lastUpdate,
            lastResult: config.lastResult
          },
          server: {
            webPort: currentPort,
            bindHost: config.bindHost,
            hostname: os.hostname(),
            platform: process.platform,
            uptime: Math.round(process.uptime())
          }
        });
      }

      if(pathname === '/api/config' && req.method === 'GET'){
        return sendJSON(res, 200, { ok:true, config: publicConfig() });
      }

      if(pathname === '/api/config' && req.method === 'PUT'){
        const body = await readBody(req);
        if(body.adminPassword !== undefined && body.adminPassword !== '') config.adminPassword = String(body.adminPassword);
        if(body.webPort !== undefined) config.webPort = Number(body.webPort) || config.webPort;
        if(body.bindHost !== undefined) config.bindHost = String(body.bindHost);
        if(body.ipv6){
          config.ipv6.mode = body.ipv6.mode === 'manual' ? 'manual' : 'auto';
          config.ipv6.manualAddress = String(body.ipv6.manualAddress || '');
          config.ipv6.preferInterface = String(body.ipv6.preferInterface || '');
        }
        if(body.ddns){
          const d = body.ddns;
          const cur = config.ddns;
          if(d.provider) cur.provider = d.provider === 'dnspod' ? 'dnspod' : 'cloudflare';
          if(d.domain !== undefined) cur.domain = String(d.domain).trim();
          if(d.sub !== undefined) cur.sub = String(d.sub).trim();
          if(d.ttl !== undefined) cur.ttl = Number(d.ttl) || 120;
          if(d.cfProxy !== undefined) cur.cfProxy = !!d.cfProxy;
          if(d.intervalMin !== undefined) cur.intervalMin = Math.max(1, Number(d.intervalMin) || 5);
          // 凭证：脱敏占位符表示不修改
          if(d.cfToken && !d.cfToken.includes('•')) cur.cfToken = d.cfToken;
          if(d.dpId && !d.dpId.includes('•')) cur.dpId = d.dpId;
          if(d.dpToken && !d.dpToken.includes('•')) cur.dpToken = d.dpToken;
          if(d.enabled !== undefined) cur.enabled = !!d.enabled;
        }
        saveConfig();
        startTimer();
        log('配置已更新并保存', 'ok');
        return sendJSON(res, 200, { ok:true, msg:'已保存。若修改了端口，需重启服务后生效。', config: publicConfig() });
      }

      if(pathname === '/api/refresh-ip' && req.method === 'POST'){
        probeIPv6(true);
        return sendJSON(res, 200, { ok:true, probing:true });
      }
      if(pathname === '/api/ddns/run' && req.method === 'POST'){
        const r = await DDNS.run();
        return sendJSON(res, r.ok ? 200 : 500, r);
      }
      if(pathname === '/api/ddns/start' && req.method === 'POST'){
        config.ddns.enabled = true; saveConfig(); startTimer();
        const r = await DDNS.run();
        return sendJSON(res, r.ok ? 200 : 500, r);
      }
      if(pathname === '/api/ddns/stop' && req.method === 'POST'){
        config.ddns.enabled = false; saveConfig(); stopTimer();
        log('DDNS 定时任务已停止', 'warn');
        return sendJSON(res, 200, { ok:true, msg:'已停止 DDNS 定时任务' });
      }
      if(pathname === '/api/logs' && req.method === 'GET'){
        const since = Number(u.searchParams.get('since') || 0);
        return sendJSON(res, 200, { ok:true, logs: logs.filter(l => l.ts > since) });
      }
      return sendJSON(res, 404, { ok:false, msg:'接口不存在' });
    }

    /* 静态页面 */
    if(req.method === 'GET') return serveStatic(req, res, pathname);
    res.writeHead(405); res.end('405 Method Not Allowed');
  }catch(e){
    log('请求处理异常：' + e.message, 'err');
    sendJSON(res, 500, { ok:false, msg: e.message });
  }
});

/* ---------------- 启动（双栈） ---------------- */
let currentPort = config.webPort;
function parseArgs(){
  process.argv.slice(2).forEach(a => {
    const m = a.match(/^--port=(\d+)$/);
    if(m) config.webPort = Number(m[1]);
    const h = a.match(/^--host=(.+)$/);
    if(h) config.bindHost = h[1];
  });
}
function listen(host){
  server.on('error', err => {
    if((err.code === 'EADDRINUSE')){
      log(`端口 ${currentPort} 被占用，请在后台或用 --port=xxxx 修改端口`, 'err');
      process.exit(1);
    } else if(host === '::' && (err.code === 'EAFNOSUPPORT' || err.code === 'EINVAL')){
      log('系统不支持 IPv6 双栈，回退到 IPv4 0.0.0.0', 'warn');
      server.listen(currentPort, '0.0.0.0');
    } else {
      log('服务启动失败：' + err.message, 'err');
      process.exit(1);
    }
  });
  server.listen(currentPort, host, () => {
    currentPort = config.webPort;
    log('================================================', 'info');
    log('六弦工坊 · 外网托管服务已启动', 'ok');
    log(`监听端口：${currentPort}（绑定 ${host}，IPv6/IPv4 双栈）`, 'ok');
    const ifaces = os.networkInterfaces();
    let v6 = '', v4 = '';
    for(const arr of Object.values(ifaces)){
      for(const ni of arr || []){
        if(ni.family === 'IPv6' && !ni.internal && isGlobalUnicastV6(ni.address) && !v6) v6 = ni.address;
        if(ni.family === 'IPv4' && !ni.internal && !v4) v4 = ni.address;
      }
    }
    log(`本机访问：    http://localhost:${currentPort}/guitar-studio.html`, 'info');
    if(v4) log(`局域网 IPv4： http://${v4}:${currentPort}/guitar-studio.html`, 'info');
    if(v6) log(`外网 IPv6：    http://[${v6}]:${currentPort}/guitar-studio.html`, 'info');
    log(`后台面板：    /admin  （默认密码 admin123，请尽快修改）`, 'warn');
    log('================================================', 'info');
    probeIPv6(); // 启动后后台异步探测一次公网 IPv6
    if(config.ddns.enabled) startTimer();
  });
}
loadConfig();
parseArgs();
currentPort = config.webPort;
listen(config.bindHost || '::');
