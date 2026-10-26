// Tiny DOM + chart helpers shared across views.

/** i18n 取词兜底：宿主 core/i18n 把 t 挂到 window；无 i18n 环境返回 key 自身 */
function T(k) {
  try {
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k);
    if (typeof t === 'function') return t(k);
  } catch (e) { /* 忽略 */ }
  return k;
}
/** 图表空状态文案（canvas 无法用 DOM 文本节点，取词后当作纯文本绘制） */
function trendingEmptyText() { return T('play.chart.empty'); }

/** Hyperscript-ish element builder.
 *  el("div.card#x", { onclick }, [children])  */
export function el(tag, props = {}, children = []) {
  let tagName = "div", id = null;
  const classes = [];
  tag.replace(/([#.][^#.]+)/g, (m) => {
    if (m[0] === "#") id = m.slice(1); else classes.push(m.slice(1));
  });
  const base = tag.match(/^[a-z0-9]+/i);
  if (base) tagName = base[0];
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className += " " + v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== "list") { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function pageHead(title, subtitle, actions = []) {
  return el("div.page-head.spread", {}, [
    el("div", {}, [el("h1", { text: title }), subtitle && el("p", { text: subtitle })]),
    el("div.row", {}, actions),
  ]);
}

export function stat(num, label) {
  return el("div.stat", {}, [el("div.num", { text: String(num) }), el("div.lbl", { text: label })]);
}

export function slider({ label, min = 0, max = 1, step = 0.01, value = 0, fmt = (v) => v, oninput }) {
  const valEl = el("span.val", { text: fmt(value) });
  const input = el("input", { type: "range", min, max, step, value, oninput: (e) => {
    const v = parseFloat(e.target.value); valEl.textContent = fmt(v); oninput && oninput(v);
  }});
  const wrap = el("label.field", {}, [
    label && el("span", { text: label }),
    el("div.slider", {}, [input, valEl]),
  ]);
  wrap.setValue = (v) => { input.value = v; valEl.textContent = fmt(v); };
  return wrap;
}

// An option may carry `group`; consecutive options sharing one land in an
// <optgroup>. Ungrouped lists behave exactly as before.
export function select({ label, options, value, onchange }) {
  const sel = el("select.input", { onchange: (e) => onchange && onchange(e.target.value) });
  let group = null, groupName = null;
  for (const o of options) {
    const opt = el("option", { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    if (o.group && o.group !== groupName) { groupName = o.group; group = el("optgroup", { label: o.group }); sel.appendChild(group); }
    else if (!o.group) { group = null; groupName = null; }
    (group || sel).appendChild(opt);
  }
  const node = label ? el("label.field", {}, [el("span", { text: label }), sel]) : sel;
  node.selectEl = sel;
  return node;
}

export function tag(text, cls = "") { return el(`span.tag.${cls}`.replace(/\.$/, ""), { text }); }

export function progressBar(frac) {
  return el("div.progress", {}, [el("i", { style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%` } })]);
}

let toastHost;
/* 宿主适配：优先复用宿主的 toast（容器 #toastWrap）；没有宿主实现时
   自建一个最小容器，保证提示不会丢失。 */
export function toast(msg, kind = "") {
  try {
    if (typeof window !== "undefined" && typeof window.toast === "function") {
      window.toast(String(msg), kind === "bad" ? "err" : "info");
      return;
    }
  } catch (e) { /* 宿主 toast 不可用时走自建分支 */ }
  try {
    toastHost ||= document.getElementById("toast-host") || document.getElementById("toastWrap");
    if (!toastHost) {
      toastHost = el("div#gp-toast-host");
      Object.assign(toastHost.style, {
        position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: "9999",
      });
      document.body.appendChild(toastHost);
    }
    const t = el(`div.toast.${kind}`.replace(/\.$/, ""), { text: msg });
    toastHost.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 300ms"; }, 2600);
    setTimeout(() => t.remove(), 2950);
  } catch (e) { console.warn("[gp] toast failed:", msg); }
}

/** Simple multi-series line chart onto a canvas. series: [{color, points:[{x,y}], label}] */
export function lineChart(canvas, series, opts = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 220;
  canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 38, r: 12, t: 12, b: 24 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    ctx.fillStyle = getVar("--muted"); ctx.font = "13px var(--font)";
    ctx.fillText(trendingEmptyText(), pad.l, h / 2);
    return;
  }
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = opts.minY ?? Math.min(...ys, 0), maxY = opts.maxY ?? Math.max(...ys, 1);
  const X = (x) => pad.l + ((x - minX) / (maxX - minX || 1)) * (w - pad.l - pad.r);
  const Y = (y) => h - pad.b - ((y - minY) / (maxY - minY || 1)) * (h - pad.t - pad.b);
  // gridlines
  ctx.strokeStyle = getVar("--line"); ctx.fillStyle = getVar("--muted");
  ctx.font = "10px var(--mono)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (i / 4) * (h - pad.t - pad.b);
    ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
    ctx.globalAlpha = 1;
    const val = Math.round(maxY - (i / 4) * (maxY - minY));
    ctx.fillText(String(val), 4, gy + 3);
  }
  for (const s of series) {
    if (!s.points.length) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.points.forEach((p, i) => { const x = X(p.x), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = s.color;
    s.points.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.5, 0, 7); ctx.fill(); });
  }
}

/* 宿主适配：GuitarPicker 的变量定义在 .gp-scope 上（避免与宿主令牌冲突），
   而 documentElement 上没有；这里先查作用域节点，再回退到根元素。 */
export function getVar(name) {
  try {
    const scope = document.querySelector(".gp-scope");
    if (scope) {
      const v = getComputedStyle(scope).getPropertyValue(name).trim();
      if (v) return v;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  } catch (e) {
    return "#888";
  }
}

export function download(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = ".json") {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept, style: { display: "none" } });
    input.addEventListener("change", () => {
      const f = input.files[0]; if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: r.result, file: f });
      r.readAsText(f);
    });
    document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
  });
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
