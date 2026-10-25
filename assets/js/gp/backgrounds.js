// Canvas background renderers for songs: solid colours, animated effects, slideshows.
import { getVar } from "./components.js";

export const ANIMATED_BACKGROUNDS = ["aurora", "waves", "starfield", "pulse"];
export const SOLID_SWATCHES = ["", "#0a0e18", "#101a2b", "#1a1024", "#0c1410", "#161616", "#1d1d28"];

const stars = [];
function ensureStars(w, h) {
  if (stars.length) return;
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.8 + 0.2 });
}

const slideCache = new Map();

/** bg: { type: 'solid'|'animated'|'slideshow', value } */
export function drawBackground(c, w, h, bg, time = 0, duration = 1) {
  bg = bg || { type: "solid", value: "" };
  if (bg.type === "solid") {
    c.fillStyle = bg.value || getVar("--highway");
    c.fillRect(0, 0, w, h);
    return;
  }
  if (bg.type === "slideshow" && Array.isArray(bg.value) && bg.value.length) {
    const idx = Math.min(bg.value.length - 1, Math.floor((time / Math.max(duration, 1)) * bg.value.length));
    const src = bg.value[idx];
    let img = slideCache.get(src);
    if (!img) { img = new Image(); img.src = src; slideCache.set(src, img); }
    c.fillStyle = "#000"; c.fillRect(0, 0, w, h);
    if (img.complete && img.naturalWidth) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      c.globalAlpha = 0.55; c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); c.globalAlpha = 1;
    }
    return;
  }
  // animated
  const accent = getVar("--accent"), accent2 = getVar("--accent-2"), base = getVar("--highway");
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  const name = bg.value || "aurora";
  if (name === "aurora") {
    for (let i = 0; i < 3; i++) {
      const t = time * 0.3 + i * 2;
      const x = w * (0.3 + 0.35 * Math.sin(t + i)), y = h * (0.4 + 0.3 * Math.cos(t * 0.8 + i));
      const r = Math.min(w, h) * (0.4 + 0.1 * Math.sin(t));
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(i % 2 ? accent2 : accent, 0.22));
      g.addColorStop(1, hexA(accent, 0));
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
  } else if (name === "waves") {
    c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.strokeStyle = hexA(i % 2 ? accent2 : accent, 0.18);
      c.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = h * 0.5 + Math.sin(x * 0.01 + time * 1.4 + i) * (30 + i * 18) + i * 10;
        x ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (name === "starfield") {
    ensureStars(w, h);
    c.fillStyle = "#fff";
    for (const s of stars) {
      s.x -= s.z * 0.6;
      if (s.x < 0) { s.x = w; s.y = Math.random() * h; }
      c.globalAlpha = s.z; c.fillRect(s.x, s.y, s.z * 2, s.z * 2);
    }
    c.globalAlpha = 1;
  } else if (name === "pulse") {
    const r = Math.min(w, h) * (0.2 + 0.05 * Math.sin(time * 4));
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r * 3);
    g.addColorStop(0, hexA(accent, 0.18)); g.addColorStop(1, hexA(accent, 0));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
}

function hexA(hex, a) {
  hex = (hex || "#6ea8fe").trim();
  if (hex.startsWith("#") && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgba(110,168,254,${a})`;
}
