#!/usr/bin/env node
/* ============================================================
  P-4 OMR 和弦派生 · 离线分析工具（只读，不写回任何数据文件）
  ------------------------------------------------------------
  运行时是 assets/js/gp/harmony.js（浏览器/单测共用，本文件 re-export）；
  本脚本仅用于人工核查：打印每首降级曲的派生和弦进行与不确定小节。
  用法： node tools/derive-harmony.mjs [gp-song-001 ...]
  ============================================================ */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { deriveHarmony } = await import(join(ROOT, 'assets/js/gp/harmony.js'));
const { keyToPc, chordName } = await import(join(ROOT, 'assets/js/gp/theory.js'));
const { GP_OMR_NOTES } = await import(join(ROOT, 'assets/js/gp/omr-notes.js'));
const { GP_CHORD_SONGS } = await import(join(ROOT, 'assets/js/gp/songs.js'));

export { deriveHarmony };

/* 直接运行时才打印报告（被 import 时静默） */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv.slice(2);
  const ids = only.length ? only : Object.keys(GP_OMR_NOTES);
  for (const id of ids) {
    const omr = GP_OMR_NOTES[id];
    const def = GP_CHORD_SONGS.find((d) => d.id === id);
    if (!omr) { console.log(`${id}: 无 OMR 数据`); continue; }
    const r = deriveHarmony(omr, omr.b || 4, { keyPc: keyToPc((def && def.key) || 'C') ?? 0 });
    const seq = r.chords.map(([pc, t]) => chordName(pc, t)).join(' → ') || '(全部识别失败，回退模板)';
    console.log(`${id} ${def ? def.title : ''}  bars=${r.bars}  uncertain=[${r.uncertainBars.join(',')}]`);
    console.log(`    ${seq}`);
  }
}
