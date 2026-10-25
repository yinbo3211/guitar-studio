// Player avatars, composed from independent SVG layers so any combination of
// parts + colours produces a unique look. Each part is data: { id, name,
// rarity, draw(ctx) } where draw() returns an SVG fragment string. Pure
// strings (no DOM) so this loads under the test shim; the markup is injected
// via the `html` prop, exactly like the rest of the app.
import {
  SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, pickById, shadeColor, mixColor, svgDoc,
} from "./parts.js";

// viewBox is 120 x 140 (portrait bust). Head ~ ellipse(60,48,24,27).
const VB = "0 0 120 140";
const INK = "#16161d";

// ---- categories ------------------------------------------------------------

export const EXPRESSIONS = [
  { id: "neutral", name: "Neutral", rarity: "common", draw: (c) =>
    `<g fill="${INK}"><circle cx="50" cy="47" r="2.6"/><circle cx="70" cy="47" r="2.6"/></g>` +
    `<g stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none">` +
    `<path d="M45 40 h9"/><path d="M66 40 h9"/><path d="M53 62 q7 4 14 0"/></g>` +
    `<path d="M60 50 l-2 6 h4 z" fill="${c.skinShade}"/>` },
  { id: "happy", name: "Happy", rarity: "common", draw: (c) =>
    `<g stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none">` +
    `<path d="M46 47 q4 -4 8 0"/><path d="M66 47 q4 -4 8 0"/>` +
    `<path d="M50 60 q10 9 20 0" stroke-width="2.6"/></g>` },
  { id: "smirk", name: "Smirk", rarity: "uncommon", draw: (c) =>
    `<g fill="${INK}"><circle cx="50" cy="47" r="2.6"/><circle cx="70" cy="47" r="2.6"/></g>` +
    `<g stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none">` +
    `<path d="M45 39 q5 -2 9 1"/><path d="M66 40 h9"/><path d="M52 62 q9 2 15 -3"/></g>` },
  { id: "focused", name: "Focused", rarity: "uncommon", draw: (c) =>
    `<g stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none">` +
    `<path d="M46 47 h8"/><path d="M66 47 h8"/>` +
    `<path d="M44 40 l9 2"/><path d="M76 40 l-9 2"/><path d="M53 61 h14"/></g>` },
  { id: "wink", name: "Wink", rarity: "rare", draw: (c) =>
    `<circle cx="50" cy="47" r="2.6" fill="${INK}"/>` +
    `<g stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none">` +
    `<path d="M66 47 q4 -4 8 0"/><path d="M51 60 q9 7 17 -1"/></g>` },
  { id: "surprised", name: "Surprised", rarity: "rare", draw: (c) =>
    `<g fill="#fff" stroke="${INK}" stroke-width="1.6"><circle cx="50" cy="47" r="3.6"/><circle cx="70" cy="47" r="3.6"/></g>` +
    `<g fill="${INK}"><circle cx="50" cy="47" r="1.7"/><circle cx="70" cy="47" r="1.7"/></g>` +
    `<ellipse cx="60" cy="62" rx="3" ry="4" fill="${INK}"/>` },
  { id: "starry", name: "Star-struck", rarity: "epic", draw: (c) =>
    `<g fill="${c.accent}">${star(50, 47, 4.2)}${star(70, 47, 4.2)}</g>` +
    `<path d="M50 60 q10 8 20 0" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` },
];

export const FACIAL_HAIR = [
  { id: "none", name: "Clean Shaven", rarity: "common", draw: () => "" },
  { id: "stubble", name: "Stubble", rarity: "common", draw: (c) =>
    `<path d="M40 56 q20 24 40 0 q-2 16 -20 18 q-18 -2 -20 -18 z" fill="${c.hair}" opacity="0.22"/>` },
  { id: "mustache", name: "Mustache", rarity: "uncommon", draw: (c) =>
    `<path d="M48 58 q12 6 24 0 q-5 6 -12 5 q-7 1 -12 -5 z" fill="${c.hair}"/>` },
  { id: "soulpatch", name: "Soul Patch", rarity: "uncommon", draw: (c) =>
    `<rect x="56.5" y="66" width="7" height="6" rx="2.5" fill="${c.hair}"/>` },
  { id: "goatee", name: "Goatee", rarity: "uncommon", draw: (c) =>
    `<path d="M48 58 q12 6 24 0 q-4 5 -10 5 q1 9 -2 12 q-3 -3 -2 -12 q-6 0 -10 -5 z" fill="${c.hair}"/>` },
  { id: "beard", name: "Beard", rarity: "rare", draw: (c) =>
    `<path d="M37 50 q23 30 46 0 q-1 22 -23 26 q-22 -4 -23 -26 z" fill="${c.hair}"/>` +
    `<path d="M48 58 q12 6 24 0 q-5 4 -12 4 q-7 0 -12 -4 z" fill="${shadeColor(c.hair, -0.2)}"/>` },
  { id: "fullbeard", name: "Lumberjack", rarity: "epic", draw: (c) =>
    `<path d="M34 46 q26 40 52 0 q2 30 -26 38 q-28 -8 -26 -38 z" fill="${c.hair}"/>` +
    `<path d="M47 58 q13 7 26 0 q-6 5 -13 5 q-7 0 -13 -5 z" fill="${shadeColor(c.hair, -0.18)}"/>` },
];

export const HAIRSTYLES = [
  { id: "bald", name: "Bald", rarity: "common", draw: () => "" },
  { id: "buzz", name: "Buzz Cut", rarity: "common", draw: (c) =>
    `<path d="M36 44 q-2 -28 24 -28 q26 0 24 28 q-6 -14 -24 -14 q-18 0 -24 14 z" fill="${c.hair}" opacity="0.92"/>` },
  { id: "short", name: "Short", rarity: "common", draw: (c) =>
    `<path d="M35 46 q-3 -32 25 -32 q28 0 25 32 q-7 -16 -14 -16 q-3 6 -11 6 q-8 0 -11 -6 q-7 0 -14 16 z" fill="${c.hair}"/>` },
  { id: "sidepart", name: "Side Part", rarity: "uncommon", draw: (c) =>
    `<path d="M34 46 q-2 -32 26 -32 q28 0 24 30 q-6 -14 -18 -16 q-10 14 -26 12 q3 -8 8 -12 q-10 2 -14 18 z" fill="${c.hair}"/>` },
  { id: "spiky", name: "Spiky", rarity: "uncommon", draw: (c) =>
    `<path d="M36 38 l2 -12 5 9 4 -13 5 12 5 -14 5 14 5 -12 4 13 5 -9 2 12 q-23 8 -46 0 z" fill="${c.hair}"/>` },
  { id: "curls", name: "Curls", rarity: "uncommon", draw: (c) =>
    `<g fill="${c.hair}"><circle cx="40" cy="30" r="9"/><circle cx="52" cy="24" r="10"/><circle cx="66" cy="24" r="10"/><circle cx="79" cy="31" r="9"/><circle cx="36" cy="42" r="8"/><circle cx="83" cy="42" r="8"/></g>` },
  { id: "mohawk", name: "Mohawk", rarity: "rare", draw: (c) =>
    `<path d="M55 14 q5 -6 10 0 l1 30 h-12 z" fill="${c.hair}"/>` +
    `<path d="M54 18 l-3 -8 4 4 1 -7 2 7 1 -7 2 7 1 -4 4 8 z" fill="${c.hair}"/>` },
  { id: "long", name: "Long", rarity: "rare", draw: (c) =>
    `<path d="M33 44 q-4 -34 27 -34 q31 0 27 34 q4 30 -3 52 q-8 -6 -10 -22 q-1 6 -6 8 q3 -22 -2 -38 q-6 8 -16 8 q-10 0 -16 -8 q-5 16 -2 38 q-5 -2 -6 -8 q-2 16 -10 22 q-7 -22 -3 -52 z" fill="${c.hair}"/>` },
  { id: "ponytail", name: "Ponytail", rarity: "rare", draw: (c) =>
    `<path d="M84 40 q10 6 12 22 q1 14 -4 24 q-3 -2 -4 -8 q-2 6 -6 4 q4 -18 -2 -38 z" fill="${shadeColor(c.hair, -0.12)}"/>` +
    `<path d="M35 46 q-3 -32 25 -32 q28 0 25 32 q-7 -16 -14 -16 q-3 6 -11 6 q-8 0 -11 -6 q-7 0 -14 16 z" fill="${c.hair}"/>` },
  { id: "afro", name: "Afro", rarity: "epic", draw: (c) =>
    `<circle cx="60" cy="34" r="30" fill="${c.hair}"/>` },
  { id: "bun", name: "Top Knot", rarity: "uncommon", draw: (c) =>
    `<circle cx="60" cy="12" r="8" fill="${c.hair}"/>` +
    `<path d="M36 44 q-2 -30 24 -30 q26 0 24 30 q-6 -14 -24 -14 q-18 0 -24 14 z" fill="${c.hair}"/>` },
  { id: "dreads", name: "Dreads", rarity: "epic", draw: (c) =>
    `<path d="M36 44 q-2 -30 24 -30 q26 0 24 30 q-6 -14 -24 -14 q-18 0 -24 14 z" fill="${c.hair}"/>` +
    `<g fill="${c.hair}">${[33, 40, 80, 87].map((x) => `<rect x="${x}" y="34" width="5" height="46" rx="2.5"/>`).join("")}</g>` },
];

export const TOPS = [
  { id: "tee", name: "T-Shirt", rarity: "common", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${c.top}"/>` +
    `<path d="M44 100 q16 12 32 0" stroke="${c.topShade}" stroke-width="2.4" fill="none"/>` },
  { id: "vneck", name: "V-Neck", rarity: "common", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 l18 18 18 -18 q19 10 18 40 z" fill="${c.top}"/>` +
    `<path d="M42 100 l18 18 18 -18" stroke="${c.topShade}" stroke-width="2.4" fill="none"/>` },
  { id: "tank", name: "Tank Top", rarity: "common", draw: (c) =>
    `<path d="M34 140 q-2 -28 10 -38 q6 6 16 6 q10 0 16 -6 q12 10 10 38 z" fill="${c.top}"/>` +
    `<path d="M44 102 q16 12 32 0" stroke="${c.topShade}" stroke-width="2" fill="none"/>` },
  { id: "sweater", name: "Sweater", rarity: "common", draw: (c) =>
    `<path d="M22 140 q-1 -30 20 -40 q8 8 18 8 q10 0 18 -8 q21 10 20 40 z" fill="${c.top}"/>` +
    `<path d="M46 100 q14 9 28 0 l0 5 q-14 9 -28 0 z" fill="${c.topShade}"/>` +
    `<g stroke="${shadeColor(c.top, -0.12)}" stroke-width="1.4">${[112, 120, 128, 136].map((y) => `<path d="M26 ${y} h68"/>`).join("")}</g>` },
  { id: "hoodie", name: "Hoodie", rarity: "uncommon", draw: (c) =>
    `<path d="M40 92 q-14 4 -16 18 q12 -8 22 -6 q-4 -6 -6 -12 z" fill="${shadeColor(c.top, -0.16)}"/>` +
    `<path d="M80 92 q14 4 16 18 q-12 -8 -22 -6 q4 -6 6 -12 z" fill="${shadeColor(c.top, -0.16)}"/>` +
    `<path d="M22 140 q-1 -30 20 -40 q8 8 18 8 q10 0 18 -8 q21 10 20 40 z" fill="${c.top}"/>` +
    `<path d="M52 100 q8 6 16 0 l3 18 h-22 z" fill="${shadeColor(c.top, -0.22)}"/>` +
    `<g stroke="${c.topLight}" stroke-width="2" stroke-linecap="round"><path d="M56 108 v18"/><path d="M64 108 v18"/></g>` },
  { id: "flannel", name: "Flannel", rarity: "uncommon", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${c.top}"/>` +
    `<g stroke="${c.topLight}" stroke-width="2" opacity="0.7">${[34, 46, 58, 70, 82].map((x) => `<path d="M${x} 100 v40"/>`).join("")}${[110, 122, 134].map((y) => `<path d="M24 ${y} h72"/>`).join("")}</g>` +
    `<path d="M44 100 l16 10 16 -10 -3 -3 q-13 9 -26 0 z" fill="${shadeColor(c.top, -0.2)}"/>` },
  { id: "bandtee", name: "Band Tee", rarity: "rare", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="#15151b"/>` +
    `<g transform="translate(60 120)" fill="${c.top}">${star(0, -4, 9)}</g>` +
    `<path d="M48 132 q12 5 24 0" stroke="${c.top}" stroke-width="1.6" fill="none"/>` },
  { id: "denim", name: "Denim Jacket", rarity: "uncommon", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${mixColor(c.top, '#3a5a8c', 0.35)}"/>` +
    `<path d="M52 100 q8 6 16 0 l-3 40 h-3 l-1 -34 -1 34 h-3 z" fill="${shadeColor(mixColor(c.top, '#3a5a8c', 0.35), -0.18)}"/>` +
    `<g fill="${c.topLight}"><circle cx="56" cy="124" r="1.4"/><circle cx="56" cy="132" r="1.4"/></g>` },
  { id: "leather", name: "Leather Jacket", rarity: "rare", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${shadeColor(c.top, -0.3)}"/>` +
    `<path d="M44 100 q16 10 32 0 l-6 6 q-10 6 -20 0 z" fill="${shadeColor(c.top, -0.5)}"/>` +
    `<path d="M58 110 l4 0 -2 30 z" fill="#c9ccd6"/>` +
    `<path d="M50 108 l-6 32 m26 -32 l6 32" stroke="${shadeColor(c.top, -0.5)}" stroke-width="2.5" fill="none"/>` },
  { id: "varsity", name: "Varsity", rarity: "rare", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${c.top}"/>` +
    `<path d="M24 140 q-1 -16 4 -26 l8 0 q-4 12 -3 26 z" fill="${c.topLight}"/>` +
    `<path d="M96 140 q1 -16 -4 -26 l-8 0 q4 12 3 26 z" fill="${c.topLight}"/>` +
    `<path d="M46 100 q14 9 28 0 l0 5 q-14 9 -28 0 z" fill="${c.topLight}"/>` +
    `<text x="60" y="126" font-size="13" font-family="Georgia, serif" font-weight="700" fill="${c.topLight}" text-anchor="middle">G</text>` },
  { id: "blazer", name: "Blazer", rarity: "epic", draw: (c) =>
    `<path d="M24 140 q-1 -30 18 -40 q8 8 18 8 q10 0 18 -8 q19 10 18 40 z" fill="${c.top}"/>` +
    `<path d="M52 100 q8 6 16 0 l0 40 h-16 z" fill="#eef1f6"/>` +
    `<path d="M44 100 l8 6 -8 30 z" fill="${shadeColor(c.top, -0.16)}"/>` +
    `<path d="M76 100 l-8 6 8 30 z" fill="${shadeColor(c.top, -0.16)}"/>` +
    `<path d="M58 104 l4 0 -1 8 -1 16 -1 -16 z" fill="${c.accent}"/>` },
  { id: "dress", name: "Dress", rarity: "epic", draw: (c) =>
    `<path d="M30 140 q4 -30 12 -40 q8 8 18 8 q10 0 18 -8 q8 10 12 40 z" fill="${c.top}"/>` +
    `<path d="M42 100 q18 14 36 0 l-2 6 q-16 12 -32 0 z" fill="${shadeColor(c.top, -0.16)}"/>` +
    `<path d="M44 116 q16 8 32 0" stroke="${c.topLight}" stroke-width="2" fill="none"/>` },
];

// Tattoos sit on visible skin (upper neck + one cheek/temple).
export const TATTOOS = [
  { id: "none", name: "None", rarity: "common", draw: () => "" },
  { id: "neckstar", name: "Neck Star", rarity: "uncommon", draw: (c) =>
    `<g fill="${tattooInk(c)}">${star(66, 88, 4)}</g>` },
  { id: "musicnote", name: "Music Note", rarity: "uncommon", draw: (c) =>
    `<g fill="${tattooInk(c)}"><circle cx="54" cy="90" r="2.6"/><rect x="55.6" y="80" width="1.6" height="10"/><path d="M55.6 80 q5 1 5 5 q-2 -3 -5 -3 z"/></g>` },
  { id: "tribal", name: "Tribal", rarity: "rare", draw: (c) =>
    `<path d="M52 84 q8 4 4 12 q-2 -5 -7 -5 q5 -3 3 -7 z" fill="${tattooInk(c)}"/>` },
  { id: "teardrop", name: "Teardrop", rarity: "rare", draw: (c) =>
    `<path d="M48 52 q2 5 0 7 q-2 -2 0 -7 z" fill="${tattooInk(c)}"/>` },
  { id: "vine", name: "Vine", rarity: "rare", draw: (c) =>
    `<path d="M64 96 q4 -8 0 -16" stroke="${tattooInk(c)}" stroke-width="1.6" fill="none"/>` +
    `<g fill="${tattooInk(c)}"><circle cx="65" cy="92" r="1.4"/><circle cx="63" cy="86" r="1.4"/><circle cx="65" cy="82" r="1.4"/></g>` },
  { id: "skull", name: "Skull", rarity: "epic", draw: (c) =>
    `<g fill="${tattooInk(c)}"><circle cx="66" cy="88" r="3.4"/><rect x="64.5" y="90.5" width="3" height="2" rx="0.6"/></g>` +
    `<g fill="#fff"><circle cx="64.8" cy="87.6" r="0.8"/><circle cx="67.2" cy="87.6" r="0.8"/></g>` },
  { id: "flames", name: "Flames", rarity: "epic", draw: (c) =>
    `<path d="M52 94 q-1 -8 4 -12 q-1 5 2 6 q1 -4 4 -6 q-2 9 -4 12 q-3 2 -6 0 z" fill="${tattooInk(c)}"/>` },
];

export const GLASSES = [
  { id: "none", name: "None", rarity: "common", draw: () => "" },
  { id: "round", name: "Round", rarity: "common", draw: (c) =>
    `<g fill="none" stroke="${INK}" stroke-width="2"><circle cx="50" cy="47" r="7"/><circle cx="70" cy="47" r="7"/><path d="M57 47 h6"/><path d="M43 45 l-6 -2"/><path d="M77 45 l6 -2"/></g>` },
  { id: "square", name: "Square", rarity: "common", draw: (c) =>
    `<g fill="none" stroke="${INK}" stroke-width="2"><rect x="43" y="42" width="14" height="10" rx="2"/><rect x="63" y="42" width="14" height="10" rx="2"/><path d="M57 47 h6"/></g>` },
  { id: "shades", name: "Shades", rarity: "uncommon", draw: (c) =>
    `<g fill="#15151b"><rect x="42" y="42" width="15" height="11" rx="3"/><rect x="63" y="42" width="15" height="11" rx="3"/></g>` +
    `<g stroke="#15151b" stroke-width="2"><path d="M57 45 h6"/><path d="M42 44 l-6 -2"/><path d="M78 44 l6 -2"/></g>` +
    `<path d="M45 44 l5 6" stroke="#fff" stroke-width="1.4" opacity="0.5"/>` },
  { id: "aviator", name: "Aviators", rarity: "rare", draw: (c) =>
    `<g fill="${mixColor('#15151b', c.accent, 0.25)}"><path d="M42 43 h15 l-2 11 h-9 q-4 0 -4 -8 z"/><path d="M78 43 h-15 l2 11 h9 q4 0 4 -8 z"/></g>` +
    `<g stroke="#caa23a" stroke-width="1.6"><path d="M57 45 h6"/></g>` },
  { id: "star", name: "Star Shades", rarity: "epic", draw: (c) =>
    `<g fill="${c.accent}">${star(50, 47, 7)}${star(70, 47, 7)}</g>` +
    `<path d="M57 47 h6" stroke="${c.accent}" stroke-width="2"/>` },
  { id: "monocle", name: "Monocle", rarity: "epic", draw: (c) =>
    `<g fill="none" stroke="#caa23a" stroke-width="2"><circle cx="70" cy="47" r="7"/></g>` +
    `<path d="M70 54 q-2 10 -6 16" stroke="#caa23a" stroke-width="1.2" fill="none"/>` },
  { id: "eyepatch", name: "Eyepatch", rarity: "rare", draw: (c) =>
    `<path d="M42 42 h14 v11 h-14 z" fill="#15151b" rx="2"/>` +
    `<path d="M36 40 q24 -4 48 6" stroke="#15151b" stroke-width="2" fill="none"/>` },
];

export const HATS = [
  { id: "none", name: "None", rarity: "common", draw: () => "" },
  { id: "beanie", name: "Beanie", rarity: "common", draw: (c) =>
    `<path d="M34 34 q0 -22 26 -22 q26 0 26 22 q-26 -8 -52 0 z" fill="${c.hat}"/>` +
    `<rect x="33" y="30" width="54" height="8" rx="4" fill="${shadeColor(c.hat, -0.14)}"/>` },
  { id: "cap", name: "Ball Cap", rarity: "common", draw: (c) =>
    `<path d="M36 36 q-2 -24 24 -24 q26 0 24 24 q-24 -8 -48 0 z" fill="${c.hat}"/>` +
    `<path d="M34 36 q-14 2 -18 8 q2 -10 20 -10 z" fill="${shadeColor(c.hat, -0.16)}"/>` +
    `<circle cx="60" cy="16" r="2" fill="${shadeColor(c.hat, -0.2)}"/>` },
  { id: "snapback", name: "Snapback", rarity: "uncommon", draw: (c) =>
    `<path d="M36 34 q-2 -22 24 -22 q26 0 24 22 l-48 0 z" fill="${c.hat}"/>` +
    `<rect x="30" y="34" width="40" height="6" rx="3" fill="${shadeColor(c.hat, -0.18)}"/>` +
    `<rect x="50" y="20" width="20" height="10" fill="${c.accent}" opacity="0.85"/>` },
  { id: "bandana", name: "Bandana", rarity: "uncommon", draw: (c) =>
    `<path d="M35 32 q25 -14 50 0 q-25 6 -50 0 z" fill="${c.hat}"/>` +
    `<path d="M84 30 l10 -4 -4 8 z" fill="${shadeColor(c.hat, -0.14)}"/>` },
  { id: "fedora", name: "Fedora", rarity: "rare", draw: (c) =>
    `<ellipse cx="60" cy="34" rx="34" ry="7" fill="${shadeColor(c.hat, -0.1)}"/>` +
    `<path d="M42 34 q-2 -20 18 -20 q20 0 18 20 q-18 -6 -36 0 z" fill="${c.hat}"/>` +
    `<rect x="42" y="28" width="36" height="5" fill="${shadeColor(c.hat, -0.3)}"/>` },
  { id: "cowboy", name: "Cowboy", rarity: "rare", draw: (c) =>
    `<path d="M24 36 q36 -16 72 0 q-12 8 -36 8 q-24 0 -36 -8 z" fill="${c.hat}"/>` +
    `<path d="M44 34 q-3 -22 16 -22 q19 0 16 22 q-16 -6 -32 0 z" fill="${shadeColor(c.hat, 0.06)}"/>` +
    `<rect x="44" y="29" width="32" height="4" fill="${shadeColor(c.hat, -0.28)}"/>` },
  { id: "tophat", name: "Top Hat", rarity: "epic", draw: (c) =>
    `<ellipse cx="60" cy="34" rx="30" ry="6" fill="${shadeColor(c.hat, -0.12)}"/>` +
    `<rect x="44" y="2" width="32" height="32" rx="2" fill="${c.hat}"/>` +
    `<rect x="44" y="26" width="32" height="6" fill="${c.accent}"/>` },
  { id: "headphones", name: "Headphones", rarity: "rare", draw: (c) =>
    `<path d="M34 50 q0 -34 26 -34 q26 0 26 34" stroke="${shadeColor(c.hat, -0.1)}" stroke-width="5" fill="none"/>` +
    `<rect x="28" y="44" width="11" height="18" rx="4" fill="${c.hat}"/>` +
    `<rect x="81" y="44" width="11" height="18" rx="4" fill="${c.hat}"/>` },
  { id: "crown", name: "Crown", rarity: "legendary", draw: (c) =>
    `<path d="M38 32 l0 -16 8 8 6 -14 6 14 6 -8 6 14 6 -8 8 8 0 16 z" fill="#e7b53a" stroke="#caa23a" stroke-width="1.2"/>` +
    `<g fill="#ff4757"><circle cx="60" cy="24" r="2.4"/></g><g fill="#19f0ff"><circle cx="48" cy="27" r="1.6"/><circle cx="72" cy="27" r="1.6"/></g>` },
  { id: "halo", name: "Halo", rarity: "legendary", draw: () =>
    `<ellipse cx="60" cy="10" rx="18" ry="5" fill="none" stroke="#ffe27a" stroke-width="3"/>` +
    `<ellipse cx="60" cy="10" rx="18" ry="5" fill="none" stroke="#fff7cf" stroke-width="1"/>` },
];

export const JEWELRY = [
  { id: "none", name: "None", rarity: "common", draw: () => "" },
  { id: "studs", name: "Stud Earrings", rarity: "common", draw: () =>
    `<g fill="#caa23a"><circle cx="36" cy="58" r="1.8"/><circle cx="84" cy="58" r="1.8"/></g>` },
  { id: "hoops", name: "Hoop Earrings", rarity: "uncommon", draw: () =>
    `<g fill="none" stroke="#caa23a" stroke-width="1.6"><circle cx="36" cy="60" r="3.4"/><circle cx="84" cy="60" r="3.4"/></g>` },
  { id: "chain", name: "Gold Chain", rarity: "rare", draw: () =>
    `<path d="M44 96 q16 14 32 0" stroke="#e7b53a" stroke-width="2.6" fill="none"/>` +
    `<path d="M44 96 q16 14 32 0" stroke="#fff3c0" stroke-width="0.8" fill="none"/>` },
  { id: "nosering", name: "Nose Ring", rarity: "uncommon", draw: () =>
    `<circle cx="58" cy="57" r="2" fill="none" stroke="#c9ccd6" stroke-width="1.4"/>` },
];

export const FRAMES = [
  { id: "none", name: "None", rarity: "common", draw: () => "" },
  { id: "ring", name: "Ring", rarity: "common", draw: (c) =>
    `<circle cx="60" cy="64" r="58" fill="none" stroke="${c.accent}" stroke-width="3" opacity="0.6"/>` },
  { id: "spotlight", name: "Spotlight", rarity: "uncommon", draw: (c) =>
    `<g><ellipse cx="60" cy="52" rx="62" ry="74" fill="${c.accent}" opacity="0.08"/>` +
    `<ellipse cx="60" cy="48" rx="42" ry="52" fill="${c.accent}" opacity="0.10"/>` +
    `<ellipse cx="60" cy="44" rx="24" ry="30" fill="${c.accent}" opacity="0.16"/></g>` },
  { id: "vinyl", name: "Vinyl", rarity: "rare", draw: (c) =>
    `<g><circle cx="60" cy="64" r="56" fill="#101015"/><circle cx="60" cy="64" r="56" fill="none" stroke="${c.accent}" stroke-width="1" opacity="0.4"/><circle cx="60" cy="64" r="40" fill="none" stroke="#2a2a33" stroke-width="1"/><circle cx="60" cy="64" r="14" fill="${c.accent}"/><circle cx="60" cy="64" r="3" fill="#101015"/></g>` },
  { id: "burst", name: "Star Burst", rarity: "rare", draw: (c) =>
    `<g stroke="${c.accent}" stroke-width="2" opacity="0.5">${Array.from({ length: 12 }, (_, i) => i * 30).map((a) => `<path d="M60 64 L${(60 + 70 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(64 + 70 * Math.sin(a * Math.PI / 180)).toFixed(1)}"/>`).join("")}</g>` },
  { id: "laurel", name: "Laurel", rarity: "epic", draw: () =>
    `<g fill="#caa23a" opacity="0.9"><path d="M30 110 q-10 -30 4 -54 q2 8 -2 14 q6 -2 8 2 q-6 2 -8 8 q6 -1 8 4 q-7 1 -9 8 q6 0 8 5 q-7 0 -9 7 z"/><path d="M90 110 q10 -30 -4 -54 q-2 8 2 14 q-6 -2 -8 2 q6 2 8 8 q-6 -1 -8 4 q7 1 9 8 q-6 0 -8 5 q7 0 9 7 z"/></g>` },
  { id: "confetti", name: "Confetti", rarity: "uncommon", draw: (c) =>
    `<g>${[[14, 24, c.accent], [102, 30, '#ff4757'], [20, 96, '#19f0ff'], [100, 100, '#ffe27a'], [10, 60, '#46b35a'], [108, 64, '#e673b2']].map(([x, y, col]) => `<rect x="${x}" y="${y}" width="4" height="4" rx="1" transform="rotate(20 ${x} ${y})" fill="${col}"/>`).join("")}</g>` },
  { id: "hexagon", name: "Hex Tech", rarity: "rare", draw: (c) =>
    `<path d="M60 8 L106 36 L106 92 L60 120 L14 92 L14 36 Z" fill="none" stroke="${c.accent}" stroke-width="2" opacity="0.6"/>` },
];

// ---- catalog index ---------------------------------------------------------

export const AVATAR_PARTS = {
  skinTone: { label: "Skin Tone", kind: "color", colors: SKIN_TONES, key: "skinTone" },
  expression: { label: "Expression", kind: "part", items: EXPRESSIONS, key: "expression" },
  hair: { label: "Hair", kind: "part", items: HAIRSTYLES, key: "hair" },
  hairColor: { label: "Hair Colour", kind: "color", colors: HAIR_COLORS, key: "hairColor" },
  facialHair: { label: "Facial Hair", kind: "part", items: FACIAL_HAIR, key: "facialHair" },
  top: { label: "Clothing", kind: "part", items: TOPS, key: "top" },
  topColor: { label: "Clothing Colour", kind: "color", colors: CLOTH_COLORS, key: "topColor" },
  tattoo: { label: "Tattoo", kind: "part", items: TATTOOS, key: "tattoo" },
  glasses: { label: "Eyewear", kind: "part", items: GLASSES, key: "glasses" },
  hat: { label: "Headwear", kind: "part", items: HATS, key: "hat" },
  hatColor: { label: "Headwear Colour", kind: "color", colors: CLOTH_COLORS, key: "hatColor" },
  jewelry: { label: "Jewellery", kind: "part", items: JEWELRY, key: "jewelry" },
  frame: { label: "Frame", kind: "part", items: FRAMES, key: "frame" },
};

export const AVATAR_CATEGORY_ORDER = [
  "skinTone", "expression", "hair", "hairColor", "facialHair",
  "top", "topColor", "tattoo", "glasses", "hat", "hatColor", "jewelry", "frame",
];

export const DEFAULT_AVATAR = {
  skinTone: "light", expression: "neutral", hair: "short", hairColor: "black",
  facialHair: "none", top: "tee", topColor: "indigo", tattoo: "none",
  glasses: "none", hat: "none", hatColor: "crimson", jewelry: "none", frame: "none",
};

// ---- composition -----------------------------------------------------------

function ctxFor(lo, accent) {
  const skin = pickById(SKIN_TONES, lo.skinTone);
  const top = pickById(CLOTH_COLORS, lo.topColor).hex;
  const hat = pickById(CLOTH_COLORS, lo.hatColor).hex;
  return {
    lo,
    accent: accent || "#6ea8fe",
    skin: skin.hex, skinShade: skin.shade,
    hair: pickById(HAIR_COLORS, lo.hairColor).hex,
    top, topShade: shadeColor(top, -0.22), topLight: shadeColor(top, 0.2),
    hat,
  };
}

function part(items, id) { for (const i of items) if (i.id === id) return i; return items[0]; }

/** Compose a full avatar SVG string from a loadout. `accent` tints frames/flair. */
export function composeAvatar(loadout = {}, accent) {
  const lo = { ...DEFAULT_AVATAR, ...loadout };
  const c = ctxFor(lo, accent);
  const layers = [];
  layers.push(part(FRAMES, lo.frame).draw(c));
  // torso skin base (so tanks / open collars show skin)
  layers.push(`<path d="M22 140 q-1 -30 20 -40 q8 9 18 9 q10 0 18 -9 q21 10 20 40 z" fill="${c.skin}"/>`);
  // neck
  layers.push(`<path d="M52 74 h16 v18 q-8 6 -16 0 z" fill="${c.skin}"/><path d="M52 88 q8 5 16 0 v4 q-8 5 -16 0 z" fill="${c.skinShade}"/>`);
  // clothing
  layers.push(part(TOPS, lo.top).draw(c));
  // head + ears
  layers.push(
    `<ellipse cx="36" cy="52" rx="4.5" ry="6.5" fill="${c.skin}"/>` +
    `<ellipse cx="84" cy="52" rx="4.5" ry="6.5" fill="${c.skin}"/>` +
    `<ellipse cx="60" cy="48" rx="24" ry="27" fill="${c.skin}"/>` +
    `<path d="M82 44 q4 8 0 18 q-4 -2 -4 -9 q0 -7 4 -9 z" fill="${c.skinShade}" opacity="0.5"/>`
  );
  // tattoo (on skin), face, facial hair, hair, glasses, jewelry, hat
  layers.push(part(TATTOOS, lo.tattoo).draw(c));
  layers.push(part(EXPRESSIONS, lo.expression).draw(c));
  layers.push(part(FACIAL_HAIR, lo.facialHair).draw(c));
  layers.push(part(HAIRSTYLES, lo.hair).draw(c));
  layers.push(part(GLASSES, lo.glasses).draw(c));
  layers.push(part(JEWELRY, lo.jewelry).draw(c));
  layers.push(part(HATS, lo.hat).draw(c));
  return svgDoc(VB, layers.join(""), "cos-avatar");
}

// ---- small shared shape helpers -------------------------------------------

function tattooInk(c) { return shadeColor(c.skin, -0.55); }

// A 5-point star path centred at (cx,cy) with outer radius r.
function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}
