/*
  六弦工坊 V4.4.1 · test/support-foot.test.js
  REQ-SUPPORT-FOOTER-01 全局赞赏条静态契约测试（不依赖 DOM）

  SF-1  app.html 结构与关键属性齐全
  SF-2  footer 位于 </main> 之后、tabbar 之前（所有路由常驻）
  SF-3  样式走令牌、二维码白底、移动端断点与弹层尺寸
  SF-4  四语 4 键齐全且键集合一致
  SF-5  sw.js CORE 预缓存图片；版本 >= 4.4.1 且两处 JSON 一致
  SF-6  图片存在、体积 < 80KB、为 600×600 方图
  SF-7  弹层交互契约（Esc / 遮罩 / × / 焦点归还 / 语言同步）
  SF-8  无障碍与长按可用性约束
  SF-9  无外链、无音频副作用
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => existsSync(path.join(ROOT, p));

const HTML = read('app.html');
const CSS = read('assets/css/base.css');
const SW = read('sw.js');
const VER = JSON.parse(read('version.json'));
const PKG = JSON.parse(read('package.json'));

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (!len) break;
    i += 2 + len;
  }
  return null;
}

test('SF-1 app.html 含赞赏条结构与关键属性', () => {
  assert.ok(HTML.includes('id="appFoot"'), '缺少 footer 容器 #appFoot');
  assert.ok(HTML.includes('assets/img/support-qr.jpg'), '缺少赞赏码图片引用');
  assert.ok(HTML.includes('data-i18n="foot.support.title"'));
  assert.ok(HTML.includes('data-i18n="foot.support.slogan"'));
  assert.ok(HTML.includes('data-i18n="foot.support.hint"'));
  assert.ok(HTML.includes('data-i18n-aria="foot.support.qrAlt"'));
  assert.ok(/<footer class="app-foot"/.test(HTML), 'footer 语义标签缺失');
  assert.ok(/<button[^>]*id="appFootBtn"[^>]*type="button"/.test(HTML), '可点击区必须为 button[type=button]');
  assert.ok(/loading="lazy"/.test(HTML), '缩略图应懒加载');
  assert.ok(/width="48"/.test(HTML) && /height="48"/.test(HTML), '缩略图需固定 48×48 防抖动');
});

test('SF-2 footer 位于 </main> 之后、tabbar 之前（所有路由常驻）', () => {
  const iMain = HTML.indexOf('</main>');
  const iFoot = HTML.indexOf('id="appFoot"');
  const iTab = HTML.indexOf('class="tabbar"');
  assert.ok(iMain > 0, '未找到 </main>');
  assert.ok(iFoot > iMain, 'footer 必须在 </main> 之后');
  assert.ok(iTab > iFoot, 'footer 必须在移动端底栏之前');
  assert.ok(iFoot > HTML.lastIndexOf('</section>'), 'footer 不得落在任意 section.view 内');
});

test('SF-3 样式走令牌、二维码白底、移动端断点与弹层尺寸', () => {
  assert.ok(/\.app-foot\{[^}]*flex-shrink:0/.test(CSS), 'footer 必须 flex-shrink:0，避免被压缩');
  assert.ok(/\.app-foot\{[^}]*border-top:1px solid var\(--line\)/.test(CSS), '分隔线须走 --line 令牌');
  assert.ok(/\.app-foot\{[^}]*background:var\(--surface-side\)/.test(CSS), '背景须走 --surface-side 令牌');
  assert.ok(/\.app-foot-qr\{[^}]*background:#fff/.test(CSS), '二维码衬底必须固定 #fff（扫码可靠性）');
  assert.ok(/@media \(max-width:860px\)/.test(CSS), '缺少移动端断点');
  assert.ok(/\.app-foot-text span\{display:none\}/.test(CSS), '移动端应隐藏次要文案');
  assert.ok(/width:min\(calc\(100vw - 48px\),360px\)/.test(CSS), '弹层大图宽度需保证窄屏 ≥320px（G2）');
  assert.ok(/\.app-foot-modal \.gs-modal\{[^}]*background:#fff/.test(CSS), '弹层卡片应为白底');
});

test('SF-4 四语 4 键齐全且键集合一致', async () => {
  const langs = ['zh-CN', 'en', 'ja', 'ko'];
  const keys = ['foot.support.title', 'foot.support.slogan', 'foot.support.hint', 'foot.support.qrAlt'];
  const dicts = {};
  for (const l of langs) dicts[l] = (await import('../assets/js/i18n/' + l + '.js')).default;
  for (const l of langs) {
    for (const k of keys) {
      assert.ok(dicts[l][k], `${l} 缺少词条 ${k}`);
      assert.ok(String(dicts[l][k]).trim().length > 0, `${l}.${k} 不能为空`);
    }
  }
  const sets = langs.map((l) => Object.keys(dicts[l]).sort().join('|'));
  assert.ok(sets.every((s) => s === sets[0]), '四语键集合必须完全一致');
});

test('SF-5 sw.js CORE 预缓存图片；版本 >= 4.4.1 且两处 JSON 一致', () => {
  const m = /const CORE = \[([\s\S]*?)\n\];/.exec(SW);
  assert.ok(m, 'sw.js 必须存在 CORE 数组');
  assert.ok(m[1].includes("./assets/img/support-qr.jpg"), 'CORE 必须预缓存赞赏码');
  const v = String(VER.version).split('.').map(Number);
  const ok = v[0] > 4 || (v[0] === 4 && (v[1] > 4 || (v[1] === 4 && v[2] >= 1)));
  assert.ok(ok, `version.json=${VER.version} 应 >= 4.4.1`);
  assert.equal(VER.version, PKG.version, 'version.json 与 package.json 版本必须一致');
});

test('SF-6 图片存在、体积 < 80KB、为 600×600 方图', () => {
  const rel = 'assets/img/support-qr.jpg';
  assert.ok(exists(rel), '缺少 assets/img/support-qr.jpg');
  const abs = path.join(ROOT, rel);
  const kb = statSync(abs).size / 1024;
  assert.ok(kb < 80, `图片 ${kb.toFixed(1)}KB 应 < 80KB（纯本地、轻量）`);
  assert.ok(kb > 5, `图片 ${kb.toFixed(1)}KB 过小，疑似损坏`);
  const size = jpegSize(readFileSync(abs));
  assert.ok(size, '无法解析 JPEG 尺寸');
  assert.equal(size.w, 600, `图片宽应为 600，实际 ${size.w}`);
  assert.equal(size.h, 600, `图片高应为 600，实际 ${size.h}`);
});

test('SF-7 弹层交互契约（Esc / 遮罩 / × / 焦点归还 / 语言同步）', () => {
  assert.ok(/setAttribute\('role', 'dialog'\)/.test(HTML), '弹层需 role=dialog');
  assert.ok(/setAttribute\('aria-modal', 'true'\)/.test(HTML), '弹层需 aria-modal=true');
  assert.ok(/e\.key === 'Escape'/.test(HTML), '缺少 Esc 关闭');
  assert.ok(/e\.target === mask/.test(HTML), '缺少点击遮罩空白区关闭');
  assert.ok(/x\.addEventListener\('click', close\)/.test(HTML), '缺少右上角 × 关闭');
  assert.ok(/lastFocus\.focus/.test(HTML), '关闭后焦点须回到触发按钮');
  assert.ok(/addEventListener\('gs:lang'/.test(HTML), '弹层文案需随语言切换同步');
  assert.ok(/document\.getElementById\('appFootModal'\)\) return/.test(HTML), '重复点击不得叠出多层遮罩');
});

test('SF-8 无障碍与长按可用性约束', () => {
  assert.ok(HTML.includes('aria-haspopup="dialog"'), '触发按钮需声明 aria-haspopup');
  assert.ok(/alt="尹博的微信赞赏码"/.test(HTML), '缩略图 alt 必填');
  assert.ok(!/-webkit-touch-callout/.test(CSS), '不得禁止长按（需支持识别图中二维码）');
  assert.ok(!/app-foot[\s\S]{0,300}user-select:none/.test(CSS), '大图不得禁选');
});

test('SF-9 无外链、无音频副作用', () => {
  const iFoot = HTML.indexOf('id="appFoot"');
  const iTab = HTML.indexOf('class="tabbar"');
  const footBlock = HTML.slice(iFoot, iTab);
  assert.ok(!/https?:\/\//.test(footBlock), '赞赏条不得引用外链');
  const scriptStart = HTML.indexOf('V4.4.1 支持作者');
  const scriptEnd = HTML.lastIndexOf('</script>');
  const footScript = HTML.slice(scriptStart, scriptEnd);
  assert.ok(scriptStart > 0 && scriptEnd > scriptStart, '未找到赞赏条脚本段');
  assert.ok(!/AudioEngine|AudioContext|\.suspend\(|\.resume\(/.test(footScript), '弹层不得触碰音频模块');
});
