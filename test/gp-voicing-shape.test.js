/* ============================================================
   六弦工坊 V4.2.5 · 和弦指型「只固化观测」回归（P2-03 / Q-2 拍板）
   ------------------------------------------------------------
   背景：需求源要求「为 solveVoicing 增加开放把位权重，产出 x32010 之类的
   开放指型」。架构师穷举验证后的结论是 —— 在 maxSpan=4（现状）下：
     · G[55,59,62] / F[53,57,60] 根本不存在含空弦解（数学上不可能）
     · C[48,52,55] 现状已选中含空弦解
     · 加权打分在 span≤4 下 0 个音集变化（零收益）
   因此本轮**不改打分、不改 maxSpan**，只做两件事：
     V-8 形状固化：把当前 solveVoicing 的真实输出钉死（防后续无意回退）
     V-9 观测指标：全库「含空弦事件占比」当前 46.5%，断言 ≥40%（只防劣化）
   ⚠️ 防循环论证：V-8 的期望值是**当前求解器的真实输出**（见下常量），
      不是任何新公式的输出；V-9 只是防劣化下界，不能当作「开放把位改进」的验收。
   ============================================================ */
'use strict';
import test from 'node:test';
import assert from 'node:assert';
import { GP_CHORD_SONGS } from '../assets/js/gp/songs.js';
import { findSong } from '../assets/js/gp/catalog.js';
import { INSTRUMENTS, solveVoicing } from '../assets/js/gp/notes.js';

const STRINGS = INSTRUMENTS['acoustic-guitar'].strings;   // [40,45,50,55,59,64]

/** 位置 → 人类可读指型（吉他习惯：低 E 为 6 弦） */
function shape(positions) {
  return positions.map((p) => (p ? `s${STRINGS.length - p.string}f${p.fret}` : 'x')).join(' ');
}

test('V-8 形状固化：C / G / Am 的指型必须是当前求解器的真实输出', () => {
  assert.strictEqual(shape(solveVoicing([48, 52, 55], 'acoustic-guitar', 0)), 's5f3 s4f2 s3f0',
    'C 大三：现状含 1 个空弦（s3f0），正是开放 C 的前三音，不得被改坏');
  assert.strictEqual(shape(solveVoicing([55, 59, 62], 'acoustic-guitar', 0)), 's4f5 s3f4 s2f3',
    'G 大三：span≤4 下无含空弦解，现状为把位和弦，改动前必须知道这条边界');
  assert.strictEqual(shape(solveVoicing([45, 52, 57], 'acoustic-guitar', 0)), 's5f0 s4f2 s3f2',
    'Am：现状含 1 个空弦');
});

test('V-8 穷举复核：G / F 在 span≤4 下不存在任何含空弦解（注释结论可复算）', () => {
  const brute = (midis, maxSpan) => {
    const opts = midis.map((m) => STRINGS
      .map((s, si) => ({ string: si, fret: m - s }))
      .filter((p) => p.fret >= 0 && p.fret <= 12));
    let withOpen = 0;
    let maxOpen = 0;
    const used = new Set();
    const cur = new Array(midis.length).fill(null);
    const visit = (d, lo, hi) => {
      if (d === opts.length) {
        const opens = cur.filter((p) => p && p.fret === 0).length;
        if (opens > 0) withOpen++;
        if (opens > maxOpen) maxOpen = opens;
        return;
      }
      for (const p of opts[d]) {
        if (used.has(p.string)) continue;
        const nlo = Math.min(lo, p.fret), nhi = Math.max(hi, p.fret);
        if (nhi - nlo > maxSpan) continue;
        used.add(p.string); cur[d] = p;
        visit(d + 1, nlo, nhi);
        cur[d] = null; used.delete(p.string);
      }
    };
    visit(0, Infinity, -Infinity);
    return { withOpen, maxOpen };
  };
  assert.strictEqual(brute([55, 59, 62], 4).withOpen, 0, 'G 在 span≤4 下不可能有空弦解');
  assert.strictEqual(brute([53, 57, 60], 4).withOpen, 0, 'F 在 span≤4 下不可能有空弦解');
  assert.strictEqual(brute([53, 57, 60], 7).withOpen, 0, 'F 放宽到 span≤7 仍无空弦解');
  assert.ok(brute([48, 52, 55], 4).withOpen >= 1, 'C 在 span≤4 下存在含空弦解（现状已选中）');
  /* 放宽到 7 时 G 才出现含空弦解，但会把跨度撑到 7 品（更难弹）—— 故本轮不放宽 */
  assert.ok(brute([55, 59, 62], 7).withOpen >= 1, 'G 仅在放宽 span 后才出现空弦解（代价是更难弹）');
});

test('V-9 观测指标：全库含空弦和弦事件占比 ≥ 40%（当前实测 46.5%，只防劣化）', () => {
  let total = 0;
  let withOpen = 0;
  for (const def of GP_CHORD_SONGS) {
    const song = findSong(def.id);
    for (const note of song.notes) {
      if (!Array.isArray(note.midi) || note.midi.length < 2) continue;
      total++;
      const positions = solveVoicing(note.midi, 'acoustic-guitar', song.capo || 0);
      if (positions.some((p) => p && p.fret === 0)) withOpen++;
    }
  }
  assert.ok(total > 20000, `应覆盖足够多的和弦事件，实际 ${total}`);
  const pct = (withOpen / total) * 100;
  assert.ok(pct >= 40, `含空弦事件占比 ${pct.toFixed(1)}% 低于 40% 防劣化下界（当前基线 46.5%）`);
  /* 上限同样登记：占比若 >70% 说明求解器异常偏向空弦，也属回退信号 */
  assert.ok(pct <= 70, `含空弦事件占比 ${pct.toFixed(1)}% 异常偏高（基线 46.5%），请复核打分`);
});
