/* ============================================================
   六弦工坊 · 外网托管 + IPv6 DDNS 服务（零依赖，仅 Node 内置模块）
   - 同时托管吉他网页与后台面板，根路径只返回吉他网页
   - 双栈监听（IPv6 + IPv4），端口可在后台 / 命令行 / 配置文件调配
   - 网卡枚举 + 外部探测双路获取公网 IPv6
   - 支持 Cloudflare / 腾讯云 DNSPod / 阿里云 的 AAAA 记录动态更新
   - Windows / CentOS 通用，也可直接放在 Nginx 之后（/api 反代）
   运行：node server.js [--port=8080]
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const net = require('net');   // V2-BUG-02：net.isIP 校验 bindHost
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

/* ---------------- 配置 ---------------- */
const ROOT = __dirname;
/* GS_CONFIG 环境变量：仅测试用（test/server.test.js 用临时配置文件，
   避免读写仓库根目录的真实 config.json）；未设置时行为与原来完全一致 */
const CONFIG_PATH = process.env.GS_CONFIG || path.join(ROOT, 'config.json');

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
    provider: 'cloudflare',       // cloudflare | dnspod | aliyun
    domain: 'example.com',        // 主域名
    sub: 'guitar',                // 主机记录；@ 表示根域名
    ttl: 120,
    cfProxy: false,               // Cloudflare 橙云代理（默认 DNS only 直连）
    cfToken: '',
    dpId: '',                     // DNSPod Token ID
    dpToken: '',                  // DNSPod Token
    aliId: '',                    // 阿里云 AccessKey ID（建议 RAM 子账号）
    aliSecret: '',                // 阿里云 AccessKey Secret
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
/* V2-BUG-02 修复（P0）：配置自愈——config.json 被手改坏（webPort='abc'、
   ttl=-5、bindHost='javascript:' 等）会让 listen 抛 ERR_SOCKET_BAD_PORT
   服务直接起不来。启动时逐项校验，非法值回退默认并告警。 */
function isPort(v){ return Number.isInteger(v) && v >= 1 && v <= 65535; }
function sanitizeConfig(cfg){
  if(!isPort(cfg.webPort)){
    log(`配置 webPort=${JSON.stringify(cfg.webPort)} 非法（应为 1-65535 整数），回退默认 8080`, 'warn');
    cfg.webPort = DEFAULT_CONFIG.webPort;
  }
  const hostOk = cfg.bindHost === 'localhost' || net.isIP(String(cfg.bindHost)) === 4 || net.isIP(String(cfg.bindHost)) === 6;
  if(!hostOk){
    log(`配置 bindHost=${JSON.stringify(cfg.bindHost)} 非法（应为 IPv4/IPv6/localhost），回退默认 ::`, 'warn');
    cfg.bindHost = DEFAULT_CONFIG.bindHost;
  }
  if(cfg.ddns){
    if(!Number.isInteger(cfg.ddns.ttl) || cfg.ddns.ttl < 60 || cfg.ddns.ttl > 86400){
      log(`配置 ddns.ttl=${JSON.stringify(cfg.ddns.ttl)} 非法（应为 60-86400 整数），回退默认 120`, 'warn');
      cfg.ddns.ttl = DEFAULT_CONFIG.ddns.ttl;
    }
    if(!Number.isInteger(cfg.ddns.intervalMin) || cfg.ddns.intervalMin < 1){
      cfg.ddns.intervalMin = DEFAULT_CONFIG.ddns.intervalMin;
    }
  }
  if(typeof cfg.adminPassword !== 'string' || !cfg.adminPassword){
    log('配置 adminPassword 为空，回退默认 admin123（请尽快在后台修改）', 'warn');
    cfg.adminPassword = DEFAULT_CONFIG.adminPassword;
  }
  return cfg;
}
function loadConfig(){
  try{
    if(fs.existsSync(CONFIG_PATH)){
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config = sanitizeConfig(deepMerge(clone(DEFAULT_CONFIG), raw));
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
  if(d.aliId) d.aliId = '••••' + d.aliId.slice(-4);
  if(d.aliSecret) d.aliSecret = '••••••••' + d.aliSecret.slice(-4);
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
/* Fix-5: 会话令牌加固——改为 Map 多会话存储并带过期时间，取代单一全局令牌：
   1. 每次登录生成独立令牌，互不影响，带 TTL 自动过期；
   2. 请求校验时惰性清理过期会话，活跃会话自动续期；
   3. 会话数量上限，防止内存被恶意刷登录撑爆。 */
const SESSION_TTL = 24*60*60*1000;      // 会话有效期 24 小时
const SESSION_MAX = 16;                 // 最大并发会话数
const sessions = new Map();             // token -> { expires, ip, ts }
function newSession(ip){
  const now = Date.now();
  for(const [k,v] of sessions){ if(v.expires <= now) sessions.delete(k); } // 清理过期
  if(sessions.size >= SESSION_MAX){       // 超限淘汰最早创建的会话
    let oldestKey = null, oldestTs = Infinity;
    for(const [k,v] of sessions){ if(v.ts < oldestTs){ oldestTs = v.ts; oldestKey = k; } }
    if(oldestKey !== null) sessions.delete(oldestKey);
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { expires: now + SESSION_TTL, ip: String(ip || ''), ts: now });
  return token;
}

/* ---------------- 登录防爆破（P2-11） ---------------- */
/* 按来源 IP 记录失败次数：连续 5 次失败锁定 10 分钟，登录成功即清零 */
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 10*60*1000;
const loginFails = new Map();   // ip -> { count, lockUntil }
function loginAllowed(ip){
  const f = loginFails.get(ip);
  return !(f && f.lockUntil > Date.now());
}
function loginFail(ip){
  const f = loginFails.get(ip) || { count:0, lockUntil:0 };
  f.count++;
  if(f.count >= LOGIN_MAX_FAILS){
    f.lockUntil = Date.now() + LOGIN_LOCK_MS; f.count = 0;
    log('检测到连续登录失败，来源 IP 已临时锁定 10 分钟', 'warn');
  }
  loginFails.set(ip, f);
  if(loginFails.size > 256){ // 防内存膨胀：清理已解锁且无计数的条目
    const now = Date.now();
    for(const [k,v] of loginFails){ if(v.lockUntil <= now && !v.count) loginFails.delete(k); }
  }
}
function loginOk(ip){ loginFails.delete(ip); }

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
    // P1-06 修复：V1 在任何 end（含返回非法内容）时都 clearTimeout，
    // 若其余服务全部失败，Promise 将永久挂起，ipState 停在「探测中」。
    // 改为：仅成功取得有效 IPv6 才提前结束；并统计已结束的请求数，
    // 全部失败时立即 resolve(null)，6 秒兜底定时器仅作最后保险。
    const timer = setTimeout(()=>{ if(!done){ done = true; resolve(null); } }, 6000);
    const finish = () => { if(done) return; done = true; clearTimeout(timer); resolve(null); };
    let pending = services.length;
    const settled = () => { if(--pending === 0) finish(); };
    services.forEach(u => {
      const req = https.get(u, { timeout: 5000, headers: { 'User-Agent': 'guitar-studio-ddns/1.0' } }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => data += c);
        res.on('end', () => {
          if(done) return;
          const ip = data.trim().split(/\r?\n/)[0].trim().toLowerCase();
          if(isGlobalUnicastV6(ip)){ done = true; clearTimeout(timer); resolve(ip); }
          else settled();
        });
      });
      req.on('error', () => { if(!done) settled(); });
      // P2-12 修复：timeout 只 destroy 不计数时，极端情况要等 6 秒兜底才继续；
      // destroy 会触发 'error'，但仍需同步调用 settled() 立即收敛
      req.on('timeout', () => { req.destroy(); if(!done) settled(); });
    });
  });
}
/* 综合得到当前应使用的公网 IPv6 */
async function detectIPv6(){
  const candidates = localIPv6Candidates();
  // 手动指定地址：立即采用，不等待外部探测（外部探测结果在该模式下不使用，避免无谓等待数秒）
  if(config.ipv6.mode === 'manual' && config.ipv6.manualAddress){
    return {
      address: config.ipv6.manualAddress.trim().toLowerCase(),
      external: null,
      candidates,
      source: 'manual',
      ts: Date.now()
    };
  }
  let external = null;
  try{ external = await fetchExternalIPv6(); }catch(e){}
  let selected = null, source = '';
  if(external){
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
      // P2-13 修复：携带请求体时补 Content-Length——V1 缺失该头，
      // 部分网关/服务端（严格 HTTP 实现）会按无Body处理或挂起等待，DDNS 随机失败
      headers: { 'User-Agent': 'guitar-studio-ddns/1.0', ...headers }
    };
    if(body){
      const len = Buffer.byteLength(body);
      if(!Object.keys(opts.headers).some(k => k.toLowerCase() === 'content-length'))
        opts.headers['Content-Length'] = len;
      if(!Object.keys(opts.headers).some(k => k.toLowerCase() === 'content-type'))
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
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

  /* ---------- 阿里云云解析 DNS（alidns，RPC + HMAC-SHA1 签名） ---------- */
  _aliPe(s){ // RPC 风格 percentEncode（RFC3986）
    return encodeURIComponent(String(s))
      .replace(/\+/g,'%20').replace(/\*/g,'%2A').replace(/%7E/g,'~')
      .replace(/!/g,'%21').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29');
  },
  async _aliReq(params){
    const d = config.ddns;
    const all = Object.assign({
      Format:'JSON',
      Version:'2015-01-09',
      AccessKeyId:d.aliId,
      SignatureMethod:'HMAC-SHA1',
      SignatureVersion:'1.0',
      SignatureNonce:crypto.randomBytes(16).toString('hex'),
      Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')
    }, params);
    const cqs = Object.keys(all).sort().map(k => this._aliPe(k)+'='+this._aliPe(all[k])).join('&');
    const stringToSign = 'GET&' + this._aliPe('/') + '&' + this._aliPe(cqs);
    all.Signature = crypto.createHmac('sha1', d.aliSecret + '&').update(stringToSign).digest('base64');
    const qs = Object.keys(all).map(k => this._aliPe(k)+'='+this._aliPe(all[k])).join('&');
    const res = await httpRequest('GET', 'https://alidns.aliyuncs.com/?'+qs);
    return res.json;
  },
  async aliyun(ip){
    const d = config.ddns;
    if(!d.aliId || !d.aliSecret) throw new Error('缺少阿里云 AccessKey ID / Secret');
    const sub = (!d.sub || d.sub === '@') ? '@' : d.sub;
    // P2-18 修复①：分页拉全 DescribeDomainRecords——V1 只查第 1 页（≤100 条），
    // 域名记录数超页时找不到已有记录，会误建重复 AAAA 记录
    let rec = null, pageNum = 1, totalPages = 1;
    while(pageNum <= totalPages && !rec){
      const page = await this._aliReq({
        Action:'DescribeDomainRecords',
        DomainName:d.domain,
        PageNumber:pageNum,
        PageSize:100
      });
      if(!page || !page.DomainRecords)
        throw new Error('阿里云查询失败：' + (page && (page.Message||page.Code) ? (page.Message+' ('+page.Code+')') : '请检查域名与 AccessKey'));
      rec = (page.DomainRecords.Record || []).find(r => r.RR === sub && r.Type === 'AAAA');
      const total = Number(page.TotalCount) || 0;
      totalPages = Math.ceil(total/100) || 1;
      pageNum++;
    }
    // P2-18 修复②：写入带上 TTL（阿里云最小 600 秒，配置低于 600 按 600）
    const ttl = String(Math.max(600, Number(d.ttl) || 600));
    let r;
    if(rec){
      r = await this._aliReq({ Action:'UpdateDomainRecord', RecordId:rec.RecordId, RR:sub, Type:'AAAA', Value:ip, TTL:ttl });
    }else{
      r = await this._aliReq({ Action:'AddDomainRecord', DomainName:d.domain, RR:sub, Type:'AAAA', Value:ip, TTL:ttl });
    }
    if(!r || !r.RecordId)
      throw new Error('阿里云写入失败：' + (r && (r.Message||r.Code) ? (r.Message+' ('+r.Code+')') : '未知错误'));
    return rec ? '已更新' : '已新建';
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
      const action = d.provider === 'dnspod' ? await this.dnspod(det.address)
        : d.provider === 'aliyun' ? await this.aliyun(det.address)
        : await this.cloudflare(det.address);
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
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.webm':'audio/webm', '.mp4':'audio/mp4', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.woff':'font/woff', '.woff2':'font/woff2'
};
/* 仅允许这些静态文件被外部访问，避免泄露源码/配置/部署脚本 */
const ALLOWED_FILES = new Set([
  'guitar-studio.html', 'admin.html', 'index.html',
  'app-1.js', 'app-2.js', 'app-3.js',
  'audio-core.js', 'sw.js', 'manifest.webmanifest'   // V2 M1：算法库 / Service Worker / PWA 清单
]);
const ALLOWED_EXT = new Set(['.png','.jpg','.jpeg','.gif','.svg','.ico','.webm','.mp4','.wav','.ogg','.woff','.woff2','.css','.js']);
/* P2-14 修复：按扩展名放行 + 敏感文件黑名单。
   之前纯白名单硬编码，新增 js/css 会直接 404；改为扩展名放行后，
   必须挡住后端源码与配置文件本身。 */
const DENY_FILES = new Set([
  'server.js', 'config.json', 'config.example.json',
  'package.json', 'package-lock.json',
  'deploy-windows.ps1', 'deploy-centos.sh', 'server.ps1'
]);
const DENY_DIRS = ['nginx/', 'test/', 'node_modules/'];

function serveStatic(req, res, pathname){
  /* V2-BUG-03 修复（P2）：URI 解析失败（如 /%）与空字节（%00）归为 400，
     避免在 path 层抛 ERR_INVALID_PATH / TypeError 被外层 catch 变成 500 */
  let rel;
  try{ rel = decodeURIComponent(pathname); }
  catch(e){ res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('400 Bad Request'); }
  if(rel.indexOf('\0') !== -1){ res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('400 Bad Request'); }
  if(rel === '/' || rel === '') rel = '/guitar-studio.html'; // 根路径只返回吉他网页
  if(rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  // 防路径穿越
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if(!filePath.startsWith(ROOT)){ res.writeHead(403); return res.end('403 Forbidden'); }
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  // P2-14：扩展名放行 + 黑名单（文件名 + 目录）
  const relNorm = safe.replace(/\\/g, '/');
  const deniedDir = DENY_DIRS.some(d => ('/' + relNorm).includes('/' + d));
  const allowed = !deniedDir && !DENY_FILES.has(base) &&
    (ALLOWED_FILES.has(base) || (ALLOWED_EXT.has(ext) && !base.startsWith('.')));
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
    let settled = false;
    // 附录 1 修复：超限先 reject 明确错误再断开连接——V1 只 destroy()，
    // 'end' 不会触发，外层 await 永远挂起，连接被占用
    req.on('data', c => {
      if(settled) return;
      data += c;
      if(data.length > 200000){
        settled = true;
        /* V2-BUG-03 修复（P2）：错误对象携带 status=413；用 resume() 排空
           代替 destroy()——destroy 会重置连接，客户端拿不到任何状态码 */
        const err413 = new Error('请求体过大（上限 200KB）');
        err413.status = 413;
        reject(err413);
        req.resume();
      }
    });
    req.on('end', () => {
      if(settled) return;
      settled = true;
      if(!data) return resolve({});
      try{ resolve(JSON.parse(data)); }
      catch(e){
        /* V2-BUG-03：非合法 JSON 归为 400 客户端错误（修复前落进外层 catch 变 500） */
        const err400 = new Error('请求体不是合法 JSON');
        err400.status = 400;
        reject(err400);
      }
    });
    req.on('error', e => {
      if(settled) return;          // 超限主动断开导致的错误已处理
      settled = true;
      reject(e);
    });
  });
}
function auth(req){
  // P2-12 修复：令牌只从 Authorization 请求头读取——V1 还接受 URL
  // 查询参数 ?token=，会被访问日志/代理日志/Referer 泄露；
  // admin.html 前端本就只用请求头方式，此分支可安全移除
  const t = req.headers['authorization'] || '';
  if(!t) return false;
  const s = sessions.get(t);
  if(!s) return false;
  if(s.expires <= Date.now()){ sessions.delete(t); return false; } // 已过期：即时剔除
  s.expires = Date.now() + SESSION_TTL;                            // 活跃会话自动续期
  return true;
}

/* ============================================================
   HTTP 服务
   ============================================================ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  try{
    /* V2 M1：公开健康检查（供负载均衡/监控探针使用，无需登录；PRD API 一览） */
    if(pathname === '/api/v1/health' && req.method === 'GET'){
      return sendJSON(res, 200, {
        ok: true,
        service: 'guitar-studio',
        version: '2.0.0-m1',
        uptimeSec: Math.round(process.uptime()),
        ts: Date.now()
      });
    }

    /* 登录 */
    if(pathname === '/api/login' && req.method === 'POST'){
      const ip = (req.socket && req.socket.remoteAddress) || '';
      // P2-11：锁定中的 IP 直接拒绝，不再校验密码
      if(!loginAllowed(ip)){
        log('登录尝试被拒绝（该 IP 锁定中）', 'warn');
        return sendJSON(res, 429, { ok:false, msg:'失败次数过多，请 10 分钟后再试' });
      }
      const body = await readBody(req);
      if(body.password && body.password === config.adminPassword){
        loginOk(ip);
        const token = newSession(req.socket && req.socket.remoteAddress); // Fix-5: 记录会话来源 IP
        log('管理员登录成功', 'ok');
        // P2-11 修复②：仍在使用默认密码时返回标记，admin.html 据此显示强制改密提醒
        const mustChangePassword = config.adminPassword === 'admin123';
        return sendJSON(res, 200, { ok:true, token, mustChangePassword });
      }
      loginFail(ip);
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
        /* V2-BUG-02 修复（P0）：非法配置值直接 400 拒绝——
           原 Number(body.webPort)||默认 会把 'abc'/负数/超大值「假成功」写进
           配置文件，重启后服务起不来 */
        if(body.webPort !== undefined){
          const p = Number(body.webPort);
          if(!Number.isInteger(p) || p < 1 || p > 65535)
            return sendJSON(res, 400, { ok:false, msg:'webPort 非法：应为 1-65535 的整数' });
          config.webPort = p;
        }
        if(body.bindHost !== undefined){
          const h = String(body.bindHost).trim();
          if(h !== 'localhost' && net.isIP(h) === 0)
            return sendJSON(res, 400, { ok:false, msg:'bindHost 非法：应为 IPv4/IPv6 地址或 localhost' });
          config.bindHost = h;
        }
        if(body.adminPassword !== undefined && body.adminPassword !== '') config.adminPassword = String(body.adminPassword);
        if(body.ipv6){
          config.ipv6.mode = body.ipv6.mode === 'manual' ? 'manual' : 'auto';
          config.ipv6.manualAddress = String(body.ipv6.manualAddress || '');
          config.ipv6.preferInterface = String(body.ipv6.preferInterface || '');
        }
        if(body.ddns){
          const d = body.ddns;
          const cur = config.ddns;
          if(d.provider) cur.provider = ['dnspod','aliyun','cloudflare'].includes(d.provider) ? d.provider : 'cloudflare';
          if(d.domain !== undefined) cur.domain = String(d.domain).trim();
          if(d.sub !== undefined) cur.sub = String(d.sub).trim();
          if(d.ttl !== undefined){
            const t = Number(d.ttl);
            if(!Number.isInteger(t) || t < 60 || t > 86400)
              return sendJSON(res, 400, { ok:false, msg:'ddns.ttl 非法：应为 60-86400 的整数（秒）' });
            cur.ttl = t;
          }
          if(d.cfProxy !== undefined) cur.cfProxy = !!d.cfProxy;
          if(d.intervalMin !== undefined) cur.intervalMin = Math.max(1, Number(d.intervalMin) || 5);
          // 凭证：脱敏占位符表示不修改
          if(d.cfToken && !d.cfToken.includes('•')) cur.cfToken = d.cfToken;
          if(d.dpId && !d.dpId.includes('•')) cur.dpId = d.dpId;
          if(d.dpToken && !d.dpToken.includes('•')) cur.dpToken = d.dpToken;
          if(d.aliId && !d.aliId.includes('•')) cur.aliId = d.aliId;
          if(d.aliSecret && !d.aliSecret.includes('•')) cur.aliSecret = d.aliSecret;
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
    /* V2-BUG-03 修复（P2）：按错误对象携带的 status 分流（4xx 记 warn），
       并防重复写响应（headersSent 后再 writeHead 会抛 ERR_HTTP_HEADERS_SENT） */
    const status = Number.isInteger(e.status) ? e.status : 500;
    log('请求处理异常：' + e.message, status < 500 ? 'warn' : 'err');
    if(!res.headersSent) sendJSON(res, status, { ok:false, msg: e.message });
  }
});

/* ---------------- 启动（双栈） ---------------- */
let currentPort = config.webPort;
function parseArgs(){
  process.argv.slice(2).forEach(a => {
    const m = a.match(/^--port=(\d+)$/);
    if(m){
      const p = Number(m[1]);
      /* V2-BUG-02：CLI 端口同样校验，非法直接退出而不是带病启动 */
      if(!isPort(p)){ log(`参数 ${a} 非法：--port 需为 1-65535 的整数`, 'err'); process.exit(1); }
      config.webPort = p;
    }else if(a.startsWith('--port=')){
      log(`参数 ${a} 非法：--port 需为 1-65535 的整数`, 'err'); process.exit(1);
    }
    const h = a.match(/^--host=(.+)$/);
    if(h){
      const v = h[1].trim();
      if(v !== 'localhost' && net.isIP(v) === 0){ log(`参数 ${a} 非法：--host 需为 IPv4/IPv6 地址或 localhost`, 'err'); process.exit(1); }
      config.bindHost = v;
    }
  });
}
/* 附录 3 修复：error 监听只注册一次——V1 在 listen(host) 内注册，
   IPv6 回退 IPv4 再次 listen 时会重复注册，同一次失败打出两遍日志 */
server.on('error', err => {
  if((err.code === 'EADDRINUSE')){
    log(`端口 ${currentPort} 被占用，请在后台或用 --port=xxxx 修改端口`, 'err');
    process.exit(1);
  } else if((err.code === 'EAFNOSUPPORT' || err.code === 'EINVAL') && !server._fellBackToV4){
    server._fellBackToV4 = true;
    log('系统不支持 IPv6 双栈，回退到 IPv4 0.0.0.0', 'warn');
    server.listen(currentPort, '0.0.0.0');
  } else {
    log('服务启动失败：' + err.message, 'err');
    process.exit(1);
  }
});
function listen(host){
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
/* 附录 2 修复：优雅退出——收到 SIGINT/SIGTERM 时停止 DDNS 定时器、
   关闭 HTTP 监听并保存配置后再退出，避免状态文件损坏 */
function shutdown(signal){
  log(`收到 ${signal}，正在优雅退出…`, 'info');
  try{ if(ddnsTimer){ clearInterval(ddnsTimer); ddnsTimer = null; } }catch(e){}
  try{ saveConfig(); }catch(e){}
  try{
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref(); // 3 秒强制兜底
  }catch(e){ process.exit(0); }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
loadConfig();
parseArgs();
currentPort = config.webPort;
listen(config.bindHost || '::');
