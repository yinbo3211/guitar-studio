/* ============================================================
   六弦工坊 · 零依赖语法校验
   遍历 assets/js、server、test 下的 .js 文件，用 node --check
   做语法校验。修复：原内联脚本把 process.exit(bad?1:0) 写在
   console.log('lint ok') 之前，导致校验通过时永远不会打印成功信息。
   ============================================================ */
'use strict';
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['assets/js', 'server', 'test'];

let bad = 0;
let checked = 0;
function walk(rel) {
  const abs = path.join(ROOT, rel);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return; // 目录不存在时跳过，不报错
  }
  for (const f of entries) {
    const pRel = path.join(rel, f);
    const pAbs = path.join(abs, f);
    if (statSync(pAbs).isDirectory()) {
      walk(pRel);
    } else if (f.endsWith('.js')) {
      checked++;
      try {
        execFileSync(process.execPath, ['--check', pAbs], { stdio: 'pipe' });
      } catch (e) {
        console.error(pRel, e.message);
        bad++;
      }
    }
  }
}

DIRS.forEach(walk);

if (bad) {
  console.error(`lint failed: ${bad} / ${checked} 个文件存在语法错误`);
  process.exit(1);
}
console.log(`lint ok: ${checked} 个文件通过语法校验`);
