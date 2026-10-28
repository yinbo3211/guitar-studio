/* 无头 DOM shim：让移植过来的 GuitarPicker 视图能在 Node 里挂载/拆卸。
   改编自 GuitarPicker 自带的 dom-smoke.mjs（MIT）。仅供测试使用。 */

const allEls = [];
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (p === "createLinearGradient" || p === "createRadialGradient") return () => ({ addColorStop() {} });
    if (p === "measureText") return () => ({ width: 0 });
    if (p in t) return t[p];
    return typeof p === "string" ? () => {} : undefined;
  },
  set(t, p, v) { t[p] = v; return true; },
});

export class El {
  constructor(tag = "div") {
    this.tagName = String(tag).toUpperCase(); this.id = ""; this.className = "";
    this.children = []; this.attributes = {}; this.style = {}; this.dataset = {};
    this._listeners = {};
    this._html = ""; this._text = ""; this.parentNode = null;
    const set = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !set.has(c) : f; on ? set.add(c) : set.delete(c); return on; },
      contains: (c) => set.has(c),
    };
    allEls.push(this);
  }
  appendChild(c) { if (c == null) return c; if (typeof c !== "object") c = new Text(c); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => c != null && this.appendChild(c)); }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { this.parentNode && this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this._html = v; if (v === "") this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attributes[k] = v; if (k === "id") this.id = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  /* 测试驱动用：同步派发已注册的事件（el() 的 onclick 走 addEventListener） */
  dispatch(type, ev = {}) {
    for (const fn of (this._listeners[type] || []).slice()) fn({ target: this, preventDefault() {}, ...ev });
    return true;
  }
  click() { return this.dispatch("click"); }
  getContext() { return ctx2d; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 }; }
  get clientWidth() { return 800; } get clientHeight() { return 400; }
  focus() {} play() { return Promise.resolve(); } pause() {} load() {}
  querySelector(sel) { return search(this, sel, false); }
  querySelectorAll(sel) { return search(this, sel, true) || []; }
}
class Text { constructor(t) { this.nodeType = 3; this._text = String(t); } get textContent() { return this._text; } set textContent(v) { this._text = v; } }

function match(el, sel) {
  if (!(el instanceof El)) return false;
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  if (sel.startsWith(".")) return el.className.split(/\s+/).includes(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}
function search(root, sel, all) {
  const out = [];
  const visit = (n) => { for (const c of n.children || []) { if (match(c, sel)) { if (!all) return c; out.push(c); } const r = visit(c); if (r && !all) return r; } return null; };
  const r = visit(root);
  return all ? out : r;
}

const documentEl = new El("html");
globalThis.document = {
  hidden: false,
  createElement: (t) => new El(t),
  createTextNode: (t) => new Text(t),
  getElementById: (id) => [...allEls].reverse().find((e) => e.id === id) || null,
  querySelector: (sel) => search({ children: allEls }, sel, false),
  querySelectorAll: (sel) => search({ children: allEls }, sel, true),
  documentElement: documentEl,
  body: new El("body"),
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (cb) => { cb(16); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#888888" });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([]); } unobserve() {} disconnect() {} };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      enumerateDevices: async () => [],
      getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [{ label: "Mic", stop() {} }] }),
      getDisplayMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [{ addEventListener() {}, stop() {} }] }),
    },
  },
});
/* AudioParam 桩：够用的调度方法集合。
   N-2 行为测试会真实驱动 play.js 主循环 → band.schedule → voices.playVoice，
   因此 frequency / detune / Q 必须与 gain 一样具备完整调度接口。 */
const audioParam = () => ({
  value: 0,
  setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  setTargetAtTime() {}, setValueCurveAtTime() {}, cancelScheduledValues() {}, cancelAndHoldAtTime() {},
});
const audioNodeTarget = {
  gain: audioParam(), frequency: audioParam(), detune: audioParam(),
  Q: audioParam(), pan: audioParam(), playbackRate: audioParam(), delayTime: audioParam(),
};
const audioNode = new Proxy(audioNodeTarget, { get(t, p) { return p in t ? t[p] : () => {}; } });
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; this.sampleRate = 44100; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return audioNode; } createOscillator() { return audioNode; }
  createAnalyser() { return new Proxy({ fftSize: 2048, smoothingTimeConstant: 0 }, { get(t, p) { return p in t ? t[p] : () => {}; }, set(t, p, v) { t[p] = v; return true; } }); }
  createMediaStreamSource() { return audioNode; } createMediaElementSource() { return audioNode; }
  createBiquadFilter() { return audioNode; } createBufferSource() { return audioNode; }
  createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
};
globalThis.webkitAudioContext = globalThis.AudioContext;
globalThis.Audio = class extends El { constructor() { super("audio"); } };
globalThis.URL = globalThis.URL || {};
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => "blob:x";
globalThis.Blob = globalThis.Blob || class {};
globalThis.confirm = () => true;
globalThis.alert = () => {};

export { allEls, ctx2d };
export default globalThis.document;
