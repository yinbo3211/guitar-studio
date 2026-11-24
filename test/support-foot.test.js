/*
  六弦工坊 V4.4.2 · test/support-foot.test.js
  REQ-SUPPORT-CARD-01 支持作者卡（首页工具网格末位）静态契约测试（不依赖 DOM）

  SC-1  卡片由 JS 创建，追加到 #toolGrid 末尾
  SC-2  底部常驻条已彻底移除（app.html 无 footer.app-foot，base.css 无条状样式）
  SC-3  卡片刻意弱化：虚线边框、无浮起位移，颜色全走令牌
  SC-4  四语词条齐全（title / slogan / desc / badge / qrAlt）且键集合一致
  SC-5  sw.js CORE 预缓存图片；版本 >= 4.4.2 且两处 JSON 一致
  SC-6  图片存在、体积 < 80KB、为 600×600 方图
  SC-7  弹层交互契约（Esc / 遮罩 / × / 焦点归还 / 语言同步）
  SC-8  无障碍约束（aria-haspopup / aria-label / 允许长按识别）
  SC-9  无外链、无音频副作用
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
const BASE_CSS = read('assets/css/base.css');
const COMP_CSS = read('assets/css/components.css');
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

const scriptStart = HTML.indexOf('V4.4.2 支持作者');
const scriptEnd = HTML.lastIndexOf('})();');
const SCRIPT = HTML.slice(scriptStart, scriptEnd);

test('SC-1 卡片由 JS 创建并追加到 #toolGrid 末尾', () => {
  assert.ok(scriptStart > 0, '未找到支持作者脚本段');
  assert.ok(/document\.createElement\('button'\)/.test(SCRIPT), '卡片须由 JS 创建（不在静态网格里占位）');
  assert.ok(/grid\.appendChild\(card\)/.test(SCRIPT), '必须 appendChild 到 toolGrid 末尾');
  assert.ok(/card\.id = 'appFootCard'/.test(SCRIPT));
  assert.ok(/card\.className = 'tool-card tc-support'/.test(SCRIPT), '沿用工具卡基类 + 弱化修饰类');

  // 保证「后续新增功能排在前面」：静态工具网格里不得预埋该卡
  const gridStart = HTML.indexOf('<div class="tool-grid" id="toolGrid">');
  const gridEnd = HTML.indexOf('</div>', HTML.indexOf('data-i18n="tool.sheets"', gridStart));
  assert.ok(gridStart > 0 && gridEnd > gridStart, '未定位到静态工具网格');
  const staticGrid = HTML.slice(gridStart, gridEnd);
  assert.ok(!/appFootCard/.test(staticGrid), '卡片不得写死在静态网格中，否则新功能会排到它后面');
  assert.ok(!/<script[\s\S]*?<\/script>/.test(staticGrid), '静态网格内不应插入脚本');
});

test('SC-2 底部常驻条已彻底移除', () => {
  assert.ok(!/id="appFoot"/.test(HTML), '不得保留 footer 容器 #appFoot');
  assert.ok(!/<footer class="app-foot"/.test(HTML), '不得保留 footer.app-foot');
  assert.ok(!/\.app-foot-card\{/.test(BASE_CSS), 'base.css 不得残留条状卡片样式');
  assert.ok(!/\.app-foot-qr\{/.test(BASE_CSS), 'base.css 不得残留缩略码样式');
  assert.ok(!/\.app-foot-hint\{/.test(BASE_CSS), 'base.css 不得残留「点击查看大图」胶囊样式');
  // 弹层样式须保留
  assert.ok(/\.app-foot-modal \.gs-modal\{/.test(BASE_CSS), '弹层样式必须保留');
  assert.ok(/width:min\(calc\(100vw - 48px\),360px\)/.test(BASE_CSS), '弹层大图宽度需保证窄屏 ≥320px');
});

test('SC-3 卡片刻意弱化：虚线边框、无浮起位移、颜色走令牌', () => {
  assert.ok(/\.tool-card\.tc-support\{[^}]*background:transparent/.test(COMP_CSS), '弱化卡须去掉渐变底');
  assert.ok(/\.tool-card\.tc-support\{[^}]*border-style:dashed/.test(COMP_CSS), '弱化卡须用虚线边框');
  assert.ok(/\.tool-card\.tc-support:hover\{[^}]*transform:none/.test(COMP_CSS), '弱化卡 hover 不得上浮');
  assert.ok(/\.tool-card\.tc-support:hover\{[^}]*box-shadow:none/.test(COMP_CSS), '弱化卡 hover 不得发光');
  assert.ok(/\.tool-card\.tc-support h3\{[^}]*color:var\(--txt\)/.test(COMP_CSS), '标题保持正文色（靠边框/底/无动效弱化，不牺牲可读性）');
  assert.ok(/\.tool-card\.tc-support:focus-visible\{[^}]*outline:2px solid var\(--amber\)/.test(COMP_CSS),
    '键盘聚焦须有可见焦点环');
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(
    COMP_CSS.slice(COMP_CSS.indexOf('.tool-card.tc-support'), COMP_CSS.indexOf('.tool-card.tc-support') + 900)
      .replace(/rgba\(255,255,255,\.0?2\)|rgba\(255,255,255,\.05\)/g, '')
  ), '弱化卡配色须走令牌，不写死十六进制色');
});

test('SC-4 四语词条齐全且键集合一致', async () => {
  const langs = ['zh-CN', 'en', 'ja', 'ko'];
  const keys = ['foot.support.title', 'foot.support.desc', 'foot.support.badge', 'foot.support.qrAlt'];
  const dicts = {};
  for (const l of langs) dicts[l] = (await import('../assets/js/i18n/' + l + '.js')).default;
  for (const l of langs) {
    for (const k of keys) {
      assert.ok(dicts[l][k], `${l} 缺少词条 ${k}`);
      assert.ok(String(dicts[l][k]).trim().length > 0, `${l}.${k} 不能为空`);
    }
    assert.ok(!('foot.support.hint' in dicts[l]), `${l} 不应保留已废弃的 foot.support.hint`);
    assert.ok(!('foot.support.slogan' in dicts[l]), `${l} 不应保留与海报重复的 foot.support.slogan`);
  }
  const sets = langs.map((l) => Object.keys(dicts[l]).sort().join('|'));
  assert.ok(sets.every((s) => s === sets[0]), '四语键集合必须完全一致');
  // 卡片文案须克制：不出现「打赏 / 捐赠 / 赞助 / 求」类索取词
  const pushy = /打赏|捐赠|赞助|捐助|求支持|跪求/i;
  for (const l of langs) {
    const desc = String(dicts[l]['foot.support.desc']);
    assert.ok(!pushy.test(desc), `${l} 卡片描述语气过重：${desc}`);
  }
});

test('SC-5 sw.js CORE 预缓存图片；版本 >= 4.4.2 且两处 JSON 一致', () => {
  const m = /const CORE = \[([\s\S]*?)\n\];/.exec(SW);
  assert.ok(m, 'sw.js 必须存在 CORE 数组');
  assert.ok(m[1].includes('./assets/img/support-qr.jpg'), 'CORE 必须预缓存赞赏码');
  const v = String(VER.version).split('.').map(Number);
  const ok = v[0] > 4 || (v[0] === 4 && (v[1] > 4 || (v[1] === 4 && v[2] >= 2)));
  assert.ok(ok, `version.json=${VER.version} 应 >= 4.4.2`);
  assert.equal(VER.version, PKG.version, 'version.json 与 package.json 版本必须一致');
});

test('SC-6 图片存在、体积 < 80KB、为 600×600 方图', () => {
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

test('SC-7 弹层交互契约（Esc / 遮罩 / × / 焦点归还 / 语言同步）', () => {
  assert.ok(/setAttribute\('role', 'dialog'\)/.test(SCRIPT), '弹层需 role=dialog');
  assert.ok(/setAttribute\('aria-modal', 'true'\)/.test(SCRIPT), '弹层需 aria-modal=true');
  assert.ok(/e\.key === 'Escape'/.test(SCRIPT), '缺少 Esc 关闭');
  assert.ok(/e\.target === mask/.test(SCRIPT), '缺少点击遮罩空白区关闭');
  assert.ok(/x\.addEventListener\('click', close\)/.test(SCRIPT), '缺少右上角 × 关闭');
  assert.ok(/lastFocus\.focus/.test(SCRIPT), '关闭后焦点须回到卡片');
  assert.ok(/document\.addEventListener\('gs:lang'/.test(SCRIPT), '弹层 aria 需随语言切换同步');
  assert.ok(/getElementById\('appFootModal'\)\) return/.test(SCRIPT), '重复点击不得叠出多层遮罩');
  assert.ok(/card\.addEventListener\('click', open\)/.test(SCRIPT), '卡片须绑定点击开弹层');
});

test('SC-8 无障碍约束', () => {
  assert.ok(/card\.setAttribute\('aria-haspopup', 'dialog'\)/.test(SCRIPT), '卡片需声明 aria-haspopup');
  assert.ok(/setAttribute\('data-i18n-aria', 'foot\.support\.qrAlt'\)/.test(SCRIPT), '卡片 aria-label 须走词条');
  assert.ok(/img\.alt = '尹博的微信赞赏码'/.test(SCRIPT), '弹层大图 alt 必填');
  const cssAll = BASE_CSS + COMP_CSS;
  assert.ok(!/-webkit-touch-callout/.test(cssAll), '不得禁止长按（需支持识别图中二维码）');
  assert.ok(!/\.app-foot[\s\S]{0,300}user-select:none/.test(cssAll), '大图不得禁选');
});

test('SC-9 无外链、无音频副作用、无额外网络请求', () => {
  assert.ok(!/https?:\/\//.test(SCRIPT), '脚本不得引用外链');
  assert.ok(!/AudioEngine|AudioContext|\.suspend\(|\.resume\(/.test(SCRIPT), '弹层不得触碰音频模块');
  assert.equal((HTML.match(/assets\/img\/support-qr\.jpg/g) || []).length, 1, '图片引用应仅一处（弹层）');
});
