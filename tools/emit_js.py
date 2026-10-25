import json

ROOT = r'C:\Users\Administrator\WorkBuddy\2026-10-25-19-30-01'
d = json.load(open(ROOT + r'\tools\songs_built.json', encoding='utf-8'))
songs, units = d['songs'], d['units']

KEYS = ['id', 'no', 'title', 'artist', 'duration', 'tier', 'unit',
        'minDifficulty', 'sheetCount', 'hasQQChord', 'note', 'sheets']

HEADER = '''/* ============================================================
   六弦工坊 V4.0 · 弹唱曲库数据层 songlist-data.js
   ------------------------------------------------------------
   数据来源：《六弦工坊V4.0需求手册》附录 A（231 首曲目完整索引），
   曲目编号/曲名/演唱者/时长/难度层级/课程单元/最低星级/谱数/技术要点
   全部逐条照录，未做重排与改写。

   曲谱链接口径（务必知悉）：
     手册附录 B 指向的外部曲谱清单文件在当前交付环境中缺失，
     因此 sheets[].url 采用「各来源站点的真实检索地址」而非深链：
       · qq_sheet  → https://y.qq.com/n/ryqq/search?w=<曲名 吉他谱>
       · qq_chord  → https://y.qq.com/n/ryqq/search?w=<曲名 和弦谱>
       · jitashe   → https://www.jitashe.org/search/tab/<曲名>/
     三者均为实测可访问的真实地址（HTTP 200，吉他社检索页标题为
     「<曲名>的吉他谱 - 吉他社」），点击后落在对应来源的曲谱检索结果，
     由用户在来源站内选择具体版本——本模块不抓取、不缓存、不 iframe
     任何第三方曲谱内容。
     待拿到逐条深链清单后，只需替换 sheets[].url 即可，结构不变。

   分配口径（可复算）：
     · hasQQChord（智能和弦谱）127 首：按「谱数降序 → 编号升序」取前
       127（谱数为 1 且已评级的曲目必须保留吉他社谱，不参与选取）；
     · qq_sheet 136 条：每首最多 1 条，按同一顺序取前 136 首有空位的曲目；
     · 其余槽位全部为 jitashe（吉他社）谱，合计 443 条；
     · 已评级曲目的第一条吉他社谱携带 minDifficulty（= 该曲已知最低星级），
       其余未评级为 null；sheets 按「从简到难」排序（未评级排最后）。

   纯函数签名固定：orderedSongs / songsOfUnit / songById / searchSongs /
   validate；兼容导出 window.SonglistData。
   ============================================================ */
'use strict';

/* ---------- 难度层级 ---------- */
export const TIER_META = {
  1: { id: 1, name: '入门级', desc: '开放和弦为主，节奏型简单，适合刚会按和弦的新手弹唱' },
  2: { id: 2, name: '初级', desc: '出现扫弦变化与常用封闭和弦，需要一定的转换熟练度' },
  3: { id: 3, name: '中级', desc: '含横按、离调与复杂节奏，需要稳定的右手律动与切换速度' }
};

/* ---------- 曲谱来源 ---------- */
export const SOURCE_META = {
  qq_sheet: { id: 'qq_sheet', name: 'QQ音乐曲谱', external: true },
  qq_chord: { id: 'qq_chord', name: 'QQ音乐智能和弦谱', external: true },
  jitashe: { id: 'jitashe', name: '吉他社', external: true }
};

/* ---------- 课程单元（数组顺序即课程顺序） ---------- */
export const UNITS = '''

UNITS_JS = json.dumps(units, ensure_ascii=False)

MID = ''';

/* ---------- 曲目（231 首，练习顺序 = no 升序） ---------- */
export const SONGS = [
'''

FOOT = '''
];

/* ---------- 纯函数 ---------- */
/** 按编号升序返回曲目副本 */
export function orderedSongs() {
  return SONGS.slice().sort((a, b) => a.no - b.no);
}

/** 某单元的全部曲目（按编号升序） */
export function songsOfUnit(unitId) {
  return orderedSongs().filter((s) => s.unit === unitId);
}

/** 按 id 取曲目，未命中返回 null */
export function songById(id) {
  if (!id) return null;
  return SONGS.find((s) => s.id === id) || null;
}

/** 关键词检索：trim + 小写包含匹配 title/artist，空关键词返回全量 */
export function searchSongs(kw) {
  const q = String(kw == null ? '' : kw).trim().toLowerCase();
  const list = orderedSongs();
  if (!q) return list;
  return list.filter((s) =>
    String(s.title).toLowerCase().includes(q) || String(s.artist).toLowerCase().includes(q));
}

/** 曲目数（曲库总量基线） */
export function songCount() {
  return SONGS.length;
}

/* ---------- 数据自检：返回错误数组，[] 表示通过 ---------- */
export function validate() {
  const errs = [];
  const list = orderedSongs();
  const unitMap = new Map(UNITS.map((u) => [u.id, u]));

  if (list.length !== 231) errs.push('SONGS.length=' + list.length + '，应为 231');
  if (UNITS.length !== 19) errs.push('UNITS.length=' + UNITS.length + '，应为 19');

  const ids = new Set();
  let prevTier = 0;
  list.forEach((s, i) => {
    const tag = s.id || ('#' + (i + 1));
    if (s.no !== i + 1) errs.push(tag + ' no 不连续（应为 ' + (i + 1) + '，实为 ' + s.no + '）');
    if (s.id !== 'song-' + String(s.no).padStart(3, '0')) errs.push(tag + ' id 与编号不一致');
    if (ids.has(s.id)) errs.push(tag + ' id 重复');
    ids.add(s.id);
    if (![1, 2, 3].includes(s.tier)) errs.push(tag + ' tier 非法：' + s.tier);
    if (s.tier < prevTier) errs.push(tag + ' tier 未按编号单调不减');
    prevTier = s.tier;
    if (!/^\\d{2}:\\d{2}$/.test(s.duration || '')) errs.push(tag + ' duration 格式非法：' + s.duration);
    if (s.tier !== 3 && String(s.note || '').trim()) errs.push(tag + ' 非中级曲目不应带技术要点');
    const u = unitMap.get(s.unit);
    if (!u) errs.push(tag + ' unit 不存在：' + s.unit);
    else if (u.tier !== s.tier) errs.push(tag + ' unit.tier 与 song.tier 不一致');

    if (s.sheetCount !== (s.sheets || []).length) {
      errs.push(tag + ' sheetCount=' + s.sheetCount + ' 与 sheets.length=' + (s.sheets || []).length + ' 不一致');
    }
    const rated = [];
    let hasChord = false;
    let prevKey = null;
    for (const sh of s.sheets || []) {
      if (!SOURCE_META[sh.source]) errs.push(tag + ' 曲谱来源未知：' + sh.source);
      if (!/^https:\\/\\//.test(sh.url || '') || /\\s/.test(sh.url || '')) {
        errs.push(tag + ' 曲谱链接非 https 或含空白：' + sh.url);
      }
      if (sh.source === 'qq_chord') hasChord = true;
      if (sh.source === 'jitashe' && Number.isFinite(sh.difficulty)) rated.push(sh.difficulty);
      const key = sh.difficulty == null ? Infinity : sh.difficulty;
      if (prevKey !== null && key < prevKey) errs.push(tag + ' sheets 未按从简到难排序');
      prevKey = key;
    }
    if (hasChord !== !!s.hasQQChord) errs.push(tag + ' hasQQChord 与 sheets 中的智能和弦谱不一致');
    const minRated = rated.length ? Math.min(...rated) : null;
    if (minRated !== (s.minDifficulty == null ? null : s.minDifficulty)) {
      errs.push(tag + ' minDifficulty 与吉他社已评级最低星级不一致');
    }
  });

  for (const u of UNITS) {
    const n = songsOfUnit(u.id).length;
    if (n !== u.songCount) errs.push('单元 ' + u.id + ' songCount=' + u.songCount + '，实际 ' + n + ' 首');
  }
  const sum = UNITS.reduce((a, u) => a + u.songCount, 0);
  if (sum !== list.length) errs.push('各单元 songCount 合计 ' + sum + ' 与曲目总数 ' + list.length + ' 不一致');

  return errs;
}

export const SonglistData = {
  TIER_META, SOURCE_META, UNITS, SONGS,
  orderedSongs, songsOfUnit, songById, searchSongs, songCount, validate
};
export default SonglistData;

if (typeof window !== 'undefined') window.SonglistData = SonglistData;
'''

lines = []
for s in songs:
    obj = {k: s.get(k) for k in KEYS}
    lines.append('  ' + json.dumps(obj, ensure_ascii=False))

out = HEADER + UNITS_JS + MID + ',\n'.join(lines) + FOOT
path = ROOT + r'\assets\js\data\songlist-data.js'
open(path, 'w', encoding='utf-8', newline='\n').write(out)
print('written', path, len(out), 'bytes')
