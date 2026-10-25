/* 真实浏览器校验：用 CDP 在 Edge/Chrome 里打开演奏视图，读取计算样式、画布像素
   与控制台错误。无头 DOM 单测抓不到「CSS 是否生效 / canvas 是否被清空」，
   这类问题只能靠真实浏览器验证。

   用法：
     node tools/browser-check.mjs                       # 默认 pd-twinkle
     node tools/browser-check.mjs "http://...?song=gp-song-001"
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8080/app.html#/songPlay?song=pd-twinkle';
const PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BIN = fs.existsSync(EDGE) ? EDGE : (fs.existsSync(CHROME) ? CHROME : null);
if (!BIN) { console.error('未找到 Edge/Chrome'); process.exit(2); }

const proc = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\gs-cdp-${Date.now()}`,
  '--window-size=1400,880', URL,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(500);
  }
  return null;
}

const EXPR = `(() => {
  const q = (s) => document.querySelector(s);
  const cs = (el) => el ? getComputedStyle(el) : null;
  const root = q('#gpPlayRoot');
  const shell = q('.play-shell');
  const canvas = q('#highway-canvas');
  const scope = q('.gp-scope');
  const v = (n) => scope ? getComputedStyle(scope).getPropertyValue(n).trim() : null;
  let painted = -1, sample = null;
  if (canvas) {
    try {
      const g = canvas.getContext('2d');
      const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 60) n++;
      }
      painted = n;
      sample = [d[0], d[1], d[2], d[3]].join(',');
    } catch (e) { painted = -2; sample = String(e.message).slice(0, 80); }
  }
  return JSON.stringify({
    hash: location.hash,
    rootClass: root ? root.className : null,
    varHighway: v('--highway'), varLine: v('--highway-line'), varAccent: v('--accent'),
    shellPosition: shell ? cs(shell).position : null,
    shellHeight: shell ? cs(shell).height : null,
    canvasAttrW: canvas ? canvas.width : 0,
    canvasAttrH: canvas ? canvas.height : 0,
    canvasCssH: canvas ? canvas.clientHeight : 0,
    painted, sample,
    hasOverlay: !!q('.play-overlay'), hasKillfeed: !!q('.killfeed'),
    hasLyric: !!q('.lyric-line'), hasHealth: !!q('.healthbar-big'),
    lyricText: q('.lyric-line') ? (q('.lyric-line').textContent || '').slice(0, 50) : '',
    hudText: q('.hud-box') ? (q('.hud-box').textContent || '').slice(0, 70) : '',
    title: q('#topbarTitle') ? q('#topbarTitle').textContent : null,
  });
})()`;

let out = null;
const logs = [];
try {
  const page = await getTarget();
  if (!page) throw new Error('未能获取调试目标');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === myId) { ws.removeEventListener('message', onMsg); resolve(m); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    const d = m.params && m.params.exceptionDetails;
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + String((d && (d.exception && d.exception.description || d.text)) || '').split('\n').slice(0, 3).join(' | '));
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].indexOf(m.params && m.params.type) >= 0) {
      logs.push(String(m.params.type).toUpperCase() + ': ' + (m.params.args || []).map((a) => a.value != null ? a.value : (a.description || '')).join(' ').slice(0, 220));
    } else if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
      logs.push('LOG: ' + String(m.params.entry.text).slice(0, 220));
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(7000);                       // 等 ESM 加载 + 视图挂载 + RO 回调
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
  out = JSON.parse((r.result && r.result.result && r.result.result.value) || '{}');
  await sleep(1200);                       // 再等一拍，收迟到的异常
  ws.close();
} catch (e) {
  console.error('校验失败：', e.message);
} finally {
  proc.kill();
}

console.log(JSON.stringify(out, null, 2));
console.log('--- 控制台错误（前 12 条）---');
console.log(logs.length ? logs.slice(0, 12).join('\n') : '(无)');
process.exit(0);
