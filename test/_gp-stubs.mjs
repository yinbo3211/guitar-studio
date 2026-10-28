/* ============================================================
   六弦工坊 V4.2.4 · test/_gp-stubs.mjs（N-8 补测公共桩）
   ------------------------------------------------------------
   用途：给「依赖浏览器宿主全局」的模块（modules/*、core/*、data/*）
   提供注入前缀，使它们能在 `node --test` 里被直接 import。

   为什么单独成文件：
     这些模块在**模块顶层**就解构宿主全局（例如 metronome.js:14
     `const { tapBpm, ... } = AudioCore;`、metronome.js:393 `onRouteEnter.metro=`、
     scale.js:35 `Object.assign(window, {...})`），因此全局必须在 import
     那些模块**之前**注入完毕。抽成公共文件可保证 6 个补测文件口径一致。

   注意（设计报告 §2-N-8）：
     本文件是 `.mjs`，既不会被 `npm test`（test/*.test.js）当作用例执行，
     也不计入手册 §2.3 覆盖矩阵（该脚本只扫 test/*.js）——
     **各用例文件必须自己动态 import 被测模块**，否则 C 类计数不会下降。
   ============================================================ */
'use strict';
import './_gp-dom.mjs';

/* ---------- 1. $ / $$：查询不到时惰性补建节点（与 core/ui.js 语义一致） ----------
   core/ui.js 的 `$` 直接返回 document.querySelector 的结果（可能为 null），
   而 metronome/chord-lib/recorder 大量使用 `$('#id').prop = v` 的空值不安全写法。
   真实页面里这些节点都存在（app.html），测试桩若返回 null 只会掩盖真实行为，
   故这里按需补建同选择器节点，让「宿主缺 DOM」与「模块逻辑」解耦。 */
function autoEl(sel) {
  const node = document.createElement("div");
  if (sel.startsWith("#")) node.id = sel.slice(1);
  else if (sel.startsWith(".")) node.className = sel.slice(1);
  document.documentElement.appendChild(node);
  return node;
}
globalThis.$ = (sel, root) => (root || document).querySelector(sel) || autoEl(sel);
globalThis.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
export function installDollar() {
  globalThis.$ = (sel, root) => (root || document).querySelector(sel) || autoEl(sel);
  globalThis.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
}

/* ---------- 2. document / window 级别监听（theme-switch 等需要） ---------- */
if (typeof document.addEventListener !== "function") document.addEventListener = () => {};
if (typeof globalThis.addEventListener !== "function") globalThis.addEventListener = () => {};

/* ---------- 3. AudioCore：必须在 import 被测模块前注入 ---------- */
const audioCoreMod = await import("../assets/js/core/audio-core.js");
globalThis.AudioCore = audioCoreMod.AudioCore ?? audioCoreMod.default;

/* ---------- 4. 路由回调注册表（metronome.js:393 顶层写 onRouteEnter.metro） ---------- */
globalThis.onRouteEnter = globalThis.onRouteEnter || {};

/* ---------- 5. 与宿主契约无关的通用桩 ---------- */
/* core/ui.js 会把真实 $ / $$ / toast 覆盖到 window（Object.assign(window, …)）。
   这里需要它提供的 SVG_ICONS / esc 等宿主常量，但必须把 $ / $$ / toast
   重新换回本文件的测试版本，否则缺 DOM 的节点会返回 null 而非惰性补建节点，
   真实 toast 还会在测试里留下 setTimeout 定时器。 */
const realToast = globalThis.toast;
await import("../assets/js/core/ui.js");
installDollar();
globalThis.toast = () => {};
export { realToast };

if (globalThis.isSecureContext === undefined) globalThis.isSecureContext = true;
if (globalThis.location === undefined) {
  globalThis.location = { protocol: "https:", hostname: "localhost", href: "https://localhost/" };
}

/** 手动泵动 requestAnimationFrame 的队列。
 *  metronome/录音电平表都用递归 rAF 做视觉循环；_gp-dom.mjs 默认同步回调会
 *  造成无限递归（栈溢出），改为队列后可精确控制帧数与「停止后是否还在排帧」。 */
export function installRafQueue() {
  const queue = [];
  let seq = 0;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { queue.push({ id: ++seq, cb }); return seq; };
  globalThis.cancelAnimationFrame = (id) => {
    const i = queue.findIndex((x) => x.id === id);
    if (i >= 0) queue.splice(i, 1);
  };
  return {
    queue,
    size: () => queue.length,
    /** 泵动 n 帧；返回实际泵动帧数 */
    pump(n = 1) {
      let done = 0;
      for (let i = 0; i < n; i++) {
        const item = queue.shift();
        if (!item) break;
        item.cb(performance.now());
        done++;
      }
      return done;
    },
    restore() {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancel;
      queue.length = 0;
    },
  };
}

/** Transport 测试替身（transport.js 自身行为由 test/transport.test.js 覆盖）。
 *  这里只记录调用，用于验证 metronome 不再自建时钟、且 stop 后无残留回调。 */
export function installTransport() {
  const log = { setBpm: [], init: 0, start: 0, stop: 0, tickCbs: [], bpmCbs: [] };
  globalThis.Transport = {
    backend: "stub",
    _bpm: 90,
    init: async () => { log.init++; },
    start: async () => { log.start++; },
    stop: () => { log.stop++; },
    setBpm: (v) => { log.setBpm.push(v); globalThis.Transport._bpm = v; },
    onTick: (cb) => { log.tickCbs.push(cb); },
    onBpm: (cb) => { log.bpmCbs.push(cb); },
    stepTicks: () => 1,
    beatDuration: () => 60 / globalThis.Transport._bpm,
    elapsedBeats: () => 0,
  };
  return log;
}

/** AudioEngine 测试替身：只记录调用，不产生任何真实音频节点。 */
export function installAudioEngine() {
  const log = { ensure: 0, strum: [], pluck: [], click: 0, hasSample: false };
  globalThis.AudioEngine = {
    ctx: new globalThis.AudioContext(),
    master: {},
    ensure() { log.ensure++; },
    strum(fs, dir, vol, off) { log.strum.push({ n: (fs || []).length, dir, vol, off }); },
    pluck(f, off) { log.pluck.push({ f, off }); },
    click(strong, off) { log.click++; },
    hasSample() { return log.hasSample; },
    playSample() { return false; },
    decodeSample: async () => {},
    loadSampleUrl: async () => {},
  };
  return log;
}

/** MediaRecorder 测试替身。opts.available=false 模拟「浏览器不支持录音」。 */
export function installMediaRecorder(opts = {}) {
  const log = { instances: 0, typesSupported: ["audio/webm;codecs=opus"], gumCalls: 0 };
  const tracks = [];
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  };
  const prevMR = globalThis.MediaRecorder;
  if (opts.available === false) {
    delete globalThis.MediaRecorder;
  } else {
    globalThis.MediaRecorder = class {
      constructor(s, o = {}) {
        log.instances++;
        this.stream = s;
        this.mimeType = o.mimeType || "audio/webm";
        this.state = "inactive";
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
      }
      static isTypeSupported(t) { return log.typesSupported.includes(t); }
      start() { this.state = "recording"; }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        if (this.ondataavailable) this.ondataavailable({ data: { size: 8 } });
        if (this.onstop) this.onstop();
      }
    };
  }
  const prevNav = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      ...(prevNav || {}),
      mediaDevices: {
        ...((prevNav && prevNav.mediaDevices) || {}),
        getUserMedia: async () => { log.gumCalls++; return stream; },
        enumerateDevices: async () => [],
      },
    },
  });
  return {
    log,
    stream,
    restore() {
      if (prevMR === undefined) delete globalThis.MediaRecorder;
      else globalThis.MediaRecorder = prevMR;
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: prevNav });
    },
  };
}
