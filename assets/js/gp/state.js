/* ============================================================
   六弦工坊 V4.1 · 适配器：GuitarPicker Store → 宿主持久化层
   ------------------------------------------------------------
   被移植的 GuitarPicker 模块（engine/player/band/synth）只依赖
   Store.settings() / Store.setSetting() / Store.addHistory() 三个面，
   这里把它们映射到宿主既有的 gsStore（localStorage `gs.prefs` 的 `gp`
   子对象）与 PracticeStore（统一练习数据层），避免引入第二套存储。
   宿主环境下 gsStore / PracticeStore 缺失时退化为内存态，不抛错。
   ============================================================ */
'use strict';

/* 曲库侧权威歌曲字典：用于把 gp-song-xxx 归一并回填真实 unit/tier */
import { songById } from '../data/songlist-data.js';
/* 与 GuitarPicker 默认值保持一致；缺失项由这里补齐 */
const GP_DEFAULTS = {
  a4: 440,
  noteSpeed: 1,
  instrument: 'acoustic-guitar',
  inputDeviceId: '',
  outputDeviceId: '',
  backingVolume: 0.7,
  vocalVolume: 0.8,
  band: true,
  /* V4.2.5 P1-03：单音提示音退役，新增「和弦提示音」。
     chordHint = 新键（唯一写入键）；noteSounds = 旧键，**只作一次性迁移来源**，
     读取后不再写入（保留在默认值里，老用户升级后开关状态不丢）。
     ⚠️ chordHint 刻意**不写进 GP_DEFAULTS**：一旦给了默认值，settings() 里的
        chordHint 恒有值，play.js 的 `s.chordHint ?? s.noteSounds ?? true` 迁移链
        就永远走不到 noteSounds（等价于死代码，老用户的关闭态会被默认值顶掉）。
        默认值由迁移链末端 `?? true` 提供，语义完全等价。 */
  noteSounds: true,
  showFingering: true,
  /* V4.2.5 P1-01：逐字歌词（karaokeLyrics）随词级渲染一起退役，消费方已删除，
     故默认值也删除（行级时间轴 buildLyricTimeline/activeAt 不受影响）。 */
  karaokeScoring: false,
  micGate: 0.012,
};

const mem = { gp: { ...GP_DEFAULTS }, history: [] };

/**
 * id 归一：演奏层用 gp-song-001，曲库/打卡登记用 song-001。
 * 写库前必须归一，否则曲库 practicedSongIds 匹配不上（BUG-04 根因之一）。
 */
export function normSongId(id) {
  return String(id || '').replace(/^gp-song-/, 'song-');
}

function readPrefs() {
  try {
    if (typeof gsStore !== 'undefined' && gsStore && typeof gsStore.read === 'function') return gsStore.read() || {};
    if (typeof window !== 'undefined' && window.gsStore) return window.gsStore.read() || {};
  } catch (e) { /* 隐私模式：退化为内存态 */ }
  return {};
}
function writePrefs(patch) {
  try {
    if (typeof gsStore !== 'undefined' && gsStore && typeof gsStore.write === 'function') return gsStore.write(patch);
    if (typeof window !== 'undefined' && window.gsStore) return window.gsStore.write(patch);
  } catch (e) { /* 写入失败不阻断 UI */ }
  Object.assign(mem, patch);
  return null;
}
function toastSafe(msg, kind) {
  try { if (typeof toast === 'function') toast(msg, kind === 'bad' ? 'err' : kind); } catch (e) { /* 无 toast 环境静默 */ }
}

export const Store = {
  settings() {
    const gp = readPrefs().gp || mem.gp || {};
    return { ...GP_DEFAULTS, ...gp };
  },
  setSetting(key, value) {
    const gp = { ...(readPrefs().gp || mem.gp || {}), [key]: value };
    mem.gp = gp;
    writePrefs({ gp });
  },
  patch(obj) {
    const gp = { ...(readPrefs().gp || mem.gp || {}), ...obj };
    mem.gp = gp;
    writePrefs({ gp });
  },
  /**
   * 成绩入宿主统一练习数据层。
   * V4.2.1 BUG-04：module 必须是 'songbook'（曲库侧 practicedSongIds /
   * songbookStats 只认 songbook），songId 必须归一为 song-xxx（去掉 gp- 前缀，
   * 否则曲卡/单元解锁匹配不上），弹唱 accuracy 恒 null（宿主打卡契约）。
   * unit/tier 从曲库权威字典回填，保证后续按单元/难度统计可用。
   */
  addHistory(entry) {
    const songId = normSongId(entry.songId || '');
    const src = typeof songById === 'function' ? (songById(songId) || null) : null;
    const rec = {
      module: 'songbook',
      startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : (Date.now() - (entry.durationSec || 0) * 1000),
      endedAt: entry.ts || Date.now(),
      durationMs: Math.max(0, Math.round((entry.durationSec || 0) * 1000)),
      /* 弹唱不做音准评分：占位和弦/跟唱都不产生可比的 accuracy */
      accuracy: null,
      targetBpm: Number.isFinite(entry.bpm) ? entry.bpm : null,
      detectedBpm: null,
      meta: {
        songId,
        songTitle: entry.songTitle || (src && src.title) || '',
        unit: (src && src.unit) || '',
        tier: (src && src.tier) != null ? src.tier : null,
        score: entry.score || 0,
        maxStreak: entry.maxStreak || 0,
        passed: !!entry.passed,
        grade: entry.grade || '',
        notes: entry.notes || { perfect: 0, good: 0, off: 0, miss: 0 },
        record: false,
        source: 'gp-highway',
        /* 演奏细项保留在 playDetail，供结算/历史展示，不影响 accuracy 契约 */
        playDetail: {
          score: entry.score || 0,
          maxStreak: entry.maxStreak || 0,
          grade: entry.grade || '',
          rawAccuracy: Number.isFinite(entry.accuracy) ? entry.accuracy / 100 : null,
        },
      },
    };
    try {
      if (typeof PracticeStore !== 'undefined' && PracticeStore && typeof PracticeStore.addSession === 'function') {
        PracticeStore.addSession(rec);
      }
    } catch (e) {
      toastSafe('成绩写入失败（不影响本次演奏）', 'bad');
    }
    mem.history.push(entry);
    return entry;
  },
  history() { return mem.history.slice(); },
  onChange() { return () => {}; },
};

export default Store;
