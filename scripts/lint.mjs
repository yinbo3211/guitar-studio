#!/usr/bin/env node
/* ============================================================
   六弦工坊 V3.1 · 统一 lint 脚本（S0.4 / F9 / C7 / C8 / C3）
  ------------------------------------------------------------
   1) 语法检查：assets/js、server、test、scripts 全量 node --check
   2) S0.4 XSS 插值面抽查：innerHTML/outerHTML/insertAdjacentHTML 中
      出现「疑似用户输入」的插值（value/input/.name/.title/text 等）时告警
   3) F9 国际化抽查：扫描 app.html 与模块中的硬编码中文文案数量，
      与基线比较，新增超过基线 + 阈值时告警（不阻断）
   4) C7 文档一致性：README 中的路径引用须真实存在
   5) C8 版本一致性（V4.2.6 N-1）：version.json = package.json，且 README 含当前版本章节
   退出码：语法检查失败 / C3 缺失 / C8 不一致时为 1（硬失败，会连带 CI 变红）；
           S0.4 / F9 为告警，保持 CI 友好
   ============================================================ */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['assets/js', 'server', 'test', 'scripts'];
const CJK = /[\u4e00-\u9fa5]/;

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const f of readdirSync(abs)) {
    const p = path.join(abs, f);
    if (statSync(p).isDirectory()) walk(path.join(dir, f), out);
    else if (f.endsWith('.js') || f.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/* ---------- 1. 语法检查 ---------- */
let syntaxBad = 0;
const files = DIRS.flatMap((d) => walk(d));
for (const p of files) {
  try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
  catch (e) { console.error('❌ 语法错误：', path.relative(ROOT, p), '\n', e.stderr?.toString().split('\n').slice(0, 4).join('\n')); syntaxBad++; }
}
console.log(`✔ 语法检查：${files.length} 个 JS 文件，失败 ${syntaxBad}`);

/* ---------- 2. S0.4 XSS 插值面抽查 ---------- */
const XSS_HINT = /innerHTML|outerHTML|insertAdjacentHTML/;
const USER_INPUT_HINT = /\b(value|\.value|prompt|localStorage|JSON\.parse|input|filename|fileName|\.name|\.title|\.note|import)/i;
let xssWarn = 0;
for (const p of files.concat([path.join(ROOT, 'app.html')])) {
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (!XSS_HINT.test(line)) return;
    if (!/\$\{/.test(line) && !/\+\s*[A-Za-z_$]/.test(line)) return;
    if (!USER_INPUT_HINT.test(line)) return;
    if (/esc\(/.test(line)) return;                 // 已转义，合规
    if (/SVG_ICONS|<svg|data-i18n/.test(line)) return; // 内部常量/图标
    console.warn(`⚠ [S0.4] 疑似未转义插值 ${path.relative(ROOT, p)}:${i + 1} → ${line.trim().slice(0, 110)}`);
    xssWarn++;
  });
}
console.log(`${xssWarn ? '⚠' : '✔'} S0.4 插值面抽查：${xssWarn} 处待人工确认（用户输入须经 esc() 或 textContent）`);

/* ---------- 3. F9 硬编码中文扫描（基线告警） ---------- */
const BASELINE_CJK = 420;   // V3.1 基线：存量文案分批补齐，新增不应显著突破
const SCAN = ['app.html', 'assets/js/modules', 'assets/js/core'];
let cjk = 0;
for (const rel of SCAN) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const list = statSync(abs).isDirectory() ? walk(rel) : [abs];
  for (const p of list) {
    const src = readFileSync(p, 'utf8');
    // 只统计「用户可见文案」：字符串/模板串中的中文，忽略注释与 i18n 词表
    if (p.includes(`${path.sep}i18n${path.sep}`)) continue;
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of stripped.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
      if (CJK.test(m[1])) cjk++;
    }
  }
}
console.log(`${cjk > BASELINE_CJK ? '⚠' : '✔'} F9 硬编码中文：${cjk} 处（基线 ${BASELINE_CJK}，新增文案请接入 assets/js/i18n）`);

/* ---------- 4. C7 文档路径一致性 ---------- */
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
/* 运行时生成 / 用户自建文件不属于仓库内容，跳过存在性检查 */
const RUNTIME_FILES = new Set(['config.json']);
const badPaths = [];
for (const m of readme.matchAll(/`([A-Za-z0-9_\-./]+\.(?:js|html|json|md|mjs))`/g)) {
  const rel = m[1];
  if (RUNTIME_FILES.has(rel)) continue;
  if (!existsSync(path.join(ROOT, rel))) badPaths.push(rel);
}
console.log(badPaths.length ? `⚠ README 引用了不存在的路径：${badPaths.join(', ')}` : '✔ C7 README 路径引用均存在');

/* ---------- 4.5 C8 版本一致性（N-1：version.json = package.json，且 README 含当前版本章节） ----------
   起因为 version.json/package.json 长期停在 4.2.3，而 README 已写到 V4.2.5：
   版本号是发布口径，同时是 sw.js 缓存名的唯一来源，错版本号会导致 SW 缓存串号。
   三个独立事实源（两个 JSON + README 文本）互相校验，非自证。 */
let c8Bad = 0;
try {
  const pkgV = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const verV = JSON.parse(readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  if (pkgV !== verV) {
    console.error(`❌ C8 版本不一致：package.json=${pkgV}，version.json=${verV}（两处必须同步，SW 缓存名取自 version.json）`);
    c8Bad++;
  }
  /* 鲁棒性口径：README 只要求「当前版本」的标题行存在（形如 `## V4.2.6`），
     历史章节（V4.2.1..V4.2.5）允许共存，不要求唯一、也不要求其余章节等于当前版本。
     \b 边界防误命中：`4.2.6` 不会被 `V4.2.60` / `V4.2.6x` 蒙混过关。 */
  const escV = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{1,6}\\s+V${escV(verV)}\\b`, 'm');
  if (!headingRe.test(readme)) {
    console.error(`❌ C8 README 缺少当前版本章节：version.json=${verV}，但未找到形如「## V${verV}」的标题行（历史章节不受影响）`);
    c8Bad++;
  }
  if (!c8Bad) console.log(`✔ C8 版本一致性：${pkgV}（package.json = version.json，README 含 V${verV} 章节）`);
} catch (e) {
  console.error('❌ C8 版本文件解析失败：', e.message);
  c8Bad++;
}

/* ---------- 5. C3 / P1-5 离线模块图覆盖 ----------
   Service Worker 预缓存清单必须与 main.js 的静态 import 图一致：
   漏掉任何一个静态依赖，离线冷启动时模块图直接 reject → 全站白屏。
   该缺陷已发生过两次（P1-5、V3.1 新增模块未同步），故设为硬失败。 */
const mainSrc = readFileSync(path.join(ROOT, 'assets/js/main.js'), 'utf8');
const swSrc = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const staticImports = new Set();
/* 覆盖两种写法：副作用导入 `import './x.js';` 与具名导入 `import ... from './x.js';`
   （动态 import() 属于运行时按需加载，不在模块图硬依赖内，不计入）
   main.js 位于 assets/js 下，相对路径需换算为仓库根路径后与 sw.js 对齐 */
const toRoot = (spec) => path.normalize(path.join('assets/js', spec));
for (const m of mainSrc.matchAll(/^\s*import\s+['"](\.\/[^'"]+\.js)['"]/gm)) {
  staticImports.add(toRoot(m[1]));
}
for (const m of mainSrc.matchAll(/^\s*import\s[^;()]*?from\s+['"](\.\/[^'"]+\.js)['"]/gm)) {
  staticImports.add(toRoot(m[1]));
}
/* 仅校验 CORE：OPTIONAL 允许个别缺失 */
const coreBlock = /const\s+CORE\s*=\s*\[([\s\S]*?)\];/.exec(swSrc);
const coreSet = new Set(
  coreBlock ? [...coreBlock[1].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((m) => path.normalize(m[1])) : []
);
const missingCore = [...staticImports].filter((u) => !coreSet.has(u));
if (missingCore.length) {
  console.error(`❌ sw.js CORE 预缓存缺失 ${missingCore.length} 个静态依赖（离线冷启动会白屏）：\n   ${missingCore.join('\n   ')}`);
} else {
  console.log(`✔ C3 离线模块图覆盖：CORE 已覆盖 main.js 全部 ${staticImports.size} 个静态 import`);
}

/* 汇总行：保持兼容旧断言（成功路径必须可见地打印 lint ok） */
if (!syntaxBad && !missingCore.length && !c8Bad) {
  console.log(`lint ok: ${files.length} 个文件通过语法校验 + S0.4/F9/C7/C8/C3 抽查`);
}

process.exit(syntaxBad || missingCore.length || c8Bad ? 1 : 0);
