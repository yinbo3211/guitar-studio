/* ============================================================
   六弦工坊 · 静态资产引用一致性回归测试（RT-013）
   ------------------------------------------------------------
   覆盖目录迁移（guitar-studio.html → app.html）后的残留死链：
     · manifest.webmanifest 的 start_url 必须指向真实存在的入口，
       icons src 必须与 assets/icons 实际文件一致；
     · manifest 引用的图标必须在 sw.js 缓存清单中（含 maskable）；
     · server/admin.html 与部署脚本不得再引用已删除的
       guitar-studio.html（HTTPS 健康检查会因此永远误判失败）；
     · app.html 必须引用 manifest。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

const manifest = JSON.parse(read('manifest.webmanifest'));
const sw = read('sw.js');
const appHtml = read('app.html');
const adminHtml = read('server/admin.html');
const httpsPs1 = read('deploy/enable-https-aliyun.ps1');

test('RT-013: manifest.start_url 指向真实存在的应用入口', () => {
  const target = manifest.start_url.replace(/^\.\//, '');
  assert.ok(exists(target), `start_url 目标 ${target} 必须存在（修复前指向已删除的 guitar-studio.html）`);
  assert.ok(!manifest.start_url.includes('guitar-studio.html'));
});

test('RT-013: manifest.icons 中每个图标文件真实存在', () => {
  assert.ok(manifest.icons.length >= 2, '至少声明普通 + maskable 图标');
  for (const icon of manifest.icons) {
    assert.ok(exists(icon.src), `图标 ${icon.src} 必须存在（修复前漏写 assets/ 前缀）`);
  }
});

test('RT-013: manifest 声明的图标均纳入 sw.js 缓存清单', () => {
  for (const icon of manifest.icons) {
    assert.ok(sw.includes(icon.src), `sw.js 应预缓存 ${icon.src}`);
  }
});

test('RT-013: app.html 通过 <link rel=manifest> 引用清单', () => {
  assert.ok(/<link[^>]+rel=["']manifest["']/.test(appHtml));
});

test('RT-013: admin.html 不再包含 guitar-studio.html 死链', () => {
  assert.ok(!adminHtml.includes('guitar-studio.html'),
    '后台「返回练习室/打开练习室」必须指向 ../app.html');
  assert.ok(adminHtml.includes('../app.html'));
});

test('RT-013: HTTPS 部署脚本健康检查与提示使用 app.html', () => {
  assert.ok(!httpsPs1.includes('guitar-studio.html'),
    'enable-https-aliyun.ps1 健康检查若指向死链，会把成功部署误判为未就绪');
  assert.ok(httpsPs1.includes('https://$Domain/app.html'));
});
