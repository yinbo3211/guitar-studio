/* ============================================================
   六弦工坊 · 节奏型数据与纯函数引擎（节奏型练习模块 V1）
   ------------------------------------------------------------
   按《六弦工坊·扫弦与分解节奏型练习·新功能需求手册 V1.0》：
     · 节奏型数据与 UI 分离——后续新增预设只需在此添加数据；
     · 扫弦与分解共用时间轴：gridOf() 把任意预设展开为统一
       「拍-步」网格，不同渲染器分别显示 D/U 或弦序数字；
     · 本文件为无副作用纯函数模块：
       V3.0 M3：ESM 具名导出 + window.RhythmData 兼容。
   动作记号约定：
     扫弦：'D'=下扫  'U'=上扫  'x'=切音/闷音  '-'=空拍（保持时值）
     分解：'R'=根音（随和弦映射）  'B'=交替低音  '1'~'6'=弦序  '-'=空拍
   ============================================================ */
  /* ---------- 和弦根音映射（需求 4.2.6：根音随和弦变化） ----------
     s: 根音所在弦（1=最细 … 6=最粗）  fret: 相对空弦的品位
     altS/altFret: 低音交替型（'B'）使用的第二低音
     仅收录可可靠映射的开放和弦：C / G / D / E / Am；
     '通用' 模式 R→5弦空弦、B→6弦空弦（界面标注「通用弦序」）。 */
  const ROOT_MAP = {
    '通用': { s: 5, fret: 0, altS: 6, altFret: 0 },
    'C':    { s: 5, fret: 3, altS: 6, altFret: 0 },
    'G':    { s: 6, fret: 3, altS: 4, altFret: 0 },
    'D':    { s: 4, fret: 0, altS: 5, altFret: 0 },
    'E':    { s: 6, fret: 0, altS: 5, altFret: 0 },
    'Am':   { s: 5, fret: 0, altS: 6, altFret: 0 }
  };

  /* ---------- 分解和弦指法标注（需求 4.2.2） ----------
     常规指法：4~6 弦用拇指 T，3 弦 i、2 弦 m、1 弦 a。 */
  const FINGER_OF_STRING = { 6: 'T', 5: 'T', 4: 'T', 3: 'i', 2: 'm', 1: 'a' };
  const FINGER_CN = { T: '拇指', i: '食指', m: '中指', a: '无名指' };

  /* ---------- 扫弦节奏型预设（需求 4.2.3，7 种） ----------
     actions 长度必须严格等于 beats × subdivision（测试强制校验）。 */
  const STRUM_PATTERNS = [
    {
      id: 'strum-basic4', cat: 'strum', name: '基础四拍下扫', difficulty: 1,
      beats: 4, beatUnit: 4, subdivision: 1, bpm: 60,
      desc: '最经典的入门扫弦：每拍一次下扫，手腕放松像「甩水珠」，先把拍子踩稳。',
      tips: ['只用手腕发力，手臂不要大幅摆动', '每一下力度均匀，别忽轻忽重'],
      actions: ['D', 'D', 'D', 'D']
    },
    {
      id: 'strum-2x4', cat: 'strum', name: '2/4 弹跳型', difficulty: 1,
      beats: 2, beatUnit: 4, subdivision: 2, bpm: 70,
      desc: '2/4 拍「下 · 上」进行曲律动，常见于民谣与乡村风格，也适合当热身练习。',
      tips: ['2/4 每小节只有两拍，别惯性地数到四', '「下-空」要留得住，别抢成连下两次'],
      actions: ['D', '-', 'D', 'U']
    },
    {
      id: 'strum-du8', cat: 'strum', name: '八分音符交替扫', difficulty: 1,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '每拍两下：下-上、下-上。这是几乎所有流行歌扫弦的地基，务必练到不假思索。',
      tips: ['上扫同样用手腕，幅度比下扫略小', '嘴里数「1 哒 2 哒」帮助稳住八分音符'],
      actions: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U']
    },
    {
      id: 'strum-pop-a', cat: 'strum', name: '流行常用型 A', difficulty: 2,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '「下 空 下 上 空 上 下 上」：加入空拍后立刻有了流行歌的律动，是使用率最高的扫弦型之一。',
      tips: ['空拍时右手保持摆动但悬空，不碰弦', '空拍是「偷来的呼吸」，时值要给足'],
      actions: ['D', '-', 'D', 'U', '-', 'U', 'D', 'U']
    },
    {
      id: 'strum-pop-b', cat: 'strum', name: '流行常用型 B', difficulty: 2,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '「下 空 下 上 下 上 空 上」：与 A 型互为镜像，适合抒情歌的副歌段落。',
      tips: ['先按 A 型练熟再学这个，对比体会重音位置差异', '第 3 拍连续下上容易抢拍，放慢练'],
      actions: ['D', '-', 'D', 'U', 'D', 'U', '-', 'U']
    },
    {
      id: 'strum-waltz', cat: 'strum', name: '华尔兹基础型', difficulty: 1,
      beats: 3, beatUnit: 4, subdivision: 1, bpm: 70,
      desc: '3/4 拍「强-弱-弱」：下-上-上，适合《生日歌》一类的三拍子歌曲。',
      tips: ['第一拍下扫要明显重于后两拍', '数「1 2 3」感受圆舞曲的摇摆感'],
      actions: ['D', 'U', 'U']
    },
    {
      id: 'strum-du8-long', cat: 'strum', name: '持续八分扫弦', difficulty: 2,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '与八分交替扫动作相同，但要求连续循环 8 小节以上不乱不累，是耐力与稳定性的专项训练。',
      tips: ['以「能连续循环不断拍」为目标，而不是速度', '感到手腕发紧立刻降速或休息'],
      actions: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U']
    },
    {
      id: 'strum-chuck', cat: 'strum', name: '切音动作练习', difficulty: 3,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 55,
      desc: '「下 切 下 上 切 上 下 上」：× 处用右手掌侧轻触琴弦发出「嚓」的闷音，是放克/民谣节奏的灵魂。',
      tips: ['切音是「按住」而不是「拍打」，发声短促即正确', '先把不带切音的 A 型弹稳，再逐步替换成 ×'],
      actions: ['D', 'x', 'D', 'U', 'x', 'U', 'D', 'U']
    }
  ];

  /* ---------- 分解和弦节奏型预设（需求 4.2.4，6 种） ----------
     动作：'R'=根音  'B'=交替低音  数字=弦序  '-'=空拍。 */
  const PICK_PATTERNS = [
    {
      id: 'pick-basic4', cat: 'pick', name: '四拍基础分解', difficulty: 1,
      beats: 4, beatUnit: 4, subdivision: 1, bpm: 60,
      desc: '最简单的分解入门：每拍拨一根弦，根音 → 3 → 2 → 1 弦，大拇指负责根音。',
      tips: ['拇指弹根音用「侧压」而非「勾」，音色更饱满', '每根弦音量一致，像琶音一样连成线'],
      actions: ['R', '3', '2', '1']
    },
    {
      id: 'pick-up8', cat: 'pick', name: '八分音符上行', difficulty: 2,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '经典民谣指弹型「根 3 2 1 2 3 2 1」：音流像波浪一样起伏，《月亮代表我的心》常用。',
      tips: ['im 指交替拨 3/2 弦，不要同一根手指连拨', '根音落点始终踩在拍点上'],
      actions: ['R', '3', '2', '1', '2', '3', '2', '1']
    },
    {
      id: 'pick-folk-a', cat: 'pick', name: '民谣分解 A', difficulty: 2,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 60,
      desc: '「根 3 2 3 1 3 2 3」：3 弦做轴心来回穿梭，音型绵密，弹唱伴奏的万能型。',
      tips: ['保持手腕稳定，只有手指关节发力', '先慢速确认每一步都拨对弦'],
      actions: ['R', '3', '2', '3', '1', '3', '2', '3']
    },
    {
      id: 'pick-waltz6', cat: 'pick', name: '六拍流动分解', difficulty: 2,
      beats: 6, beatUnit: 8, subdivision: 1, bpm: 70,
      desc: '6/8 拍「根 3 2 1 2 3」：自带摇曳感，先大声数「1-2-3、2-2-3」找船歌律动。',
      tips: ['6/8 是「两大拍、每拍三份」，重音在 1 和 4', '根音后直接接 3 弦，跨度大时慢练'],
      actions: ['R', '3', '2', '1', '2', '3']
    },
    {
      id: 'pick-bass-alt', cat: 'pick', name: '低音交替型', difficulty: 3,
      beats: 4, beatUnit: 4, subdivision: 2, bpm: 55,
      desc: '「根 3 交替低音 3」：拇指在根音与另一根低音弦之间交替（B），是 Travis picking 的前身。',
      tips: ['B 弦由和弦自动决定，跟着界面提示拨即可', '两根低音音量一致，高音三根弦保持均匀'],
      actions: ['R', '3', 'B', '3', 'R', '3', 'B', '3']
    },
    {
      id: 'pick-triplet', cat: 'pick', name: '三指循环型', difficulty: 3,
      beats: 4, beatUnit: 4, subdivision: 3, bpm: 50,
      desc: '每拍三连音「根-3-2」循环：拇指与 i/m 指形成连绵的三连音滚奏，古典与指弹常用的练习。',
      tips: ['三连音要「等分」，别弹成前八后十六', '以「哒-哒-哒」均匀计数，再上速度'],
      actions: ['R', '3', '2', 'R', '3', '2', 'R', '3', '2', 'R', '3', '2']
    }
  ];

  const ALL_PATTERNS = STRUM_PATTERNS.concat(PICK_PATTERNS);

  /* ---------- 校验：预设数据完整性（新增数据时测试强制跑一遍） ---------- */
  function validatePattern(p) {
    const errs = [];
    if (!p.id || !p.name) errs.push('缺少 id/name');
    if (!p.actions || !Array.isArray(p.actions) || p.actions.length === 0) errs.push(p.id + ': actions 为空');
    else if (p.actions.length !== p.beats * p.subdivision)
      errs.push(p.id + ': 格数 ' + p.actions.length + ' ≠ 拍数 ' + p.beats + ' × 细分 ' + p.subdivision);
    const valid = p.cat === 'strum' ? ['D', 'U', 'x', '-'] : ['R', 'B', '1', '2', '3', '4', '5', '6', '-'];
    (p.actions || []).forEach((a, i) => { if (valid.indexOf(a) < 0) errs.push(p.id + ': 第' + (i + 1) + '格非法动作 ' + a); });
    if (!(p.bpm >= 40 && p.bpm <= 240)) errs.push(p.id + ': 建议 BPM 越界');
    return errs;
  }

  /* ---------- 网格展开：统一时间轴 ----------
     返回 steps[i] = { i, action, beat, subIdx, accent, rest }：
       beat:    所属拍（0 起）      subIdx: 拍内第几步（0 起）
       accent:  是否该拍重音（每拍第 1 步且 beat 为强拍位由播放层决定，此处只标拍头）
       rest:    是否空拍（占时值不出声） */
  function gridOf(pattern) {
    const steps = [];
    for (let i = 0; i < pattern.actions.length; i++) {
      const beat = Math.floor(i / pattern.subdivision);
      const subIdx = i % pattern.subdivision;
      const action = pattern.actions[i];
      steps.push({ i, action, beat, subIdx, accent: subIdx === 0, rest: action === '-' });
    }
    return steps;
  }

  /* ---------- 步时值：四分音符=一拍；八分=1/2 拍；三连音=1/3 拍 ---------- */
  function stepDuration(bpm, subdivision) {
    if (!(bpm >= 20 && bpm <= 300)) throw new Error('BPM 越界: ' + bpm);
    if (![1, 2, 3, 4].includes(subdivision)) throw new Error('非法细分: ' + subdivision);
    return 60 / bpm / subdivision;
  }

  /* ---------- 动作解析：把 action 变成「显示标签 + 发声参数」 ----------
     chordName 允许 undefined → 按通用模式映射。
     返回 { label, sub, cn, kind, string, midi }
       kind: 'down'|'up'|'mute'|'rest'|'pick'
       midi: 分解模式下的实际 MIDI 音高（用于合成拨弦音），扫弦为 null */
  function resolveAction(pattern, action, chordName) {
    const rootInfo = ROOT_MAP[chordName] || ROOT_MAP['通用'];
    if (pattern.cat === 'strum') {
      if (action === 'D') return { label: '↓', sub: '下', cn: '下扫', kind: 'down', string: null, midi: null };
      if (action === 'U') return { label: '↑', sub: '上', cn: '上扫', kind: 'up', string: null, midi: null };
      if (action === 'x') return { label: '×', sub: '切', cn: '切音', kind: 'mute', string: null, midi: null };
      return { label: '·', sub: '空', cn: '空拍', kind: 'rest', string: null, midi: null };
    }
    if (action === 'R') {
      return { label: '根', sub: FINGER_OF_STRING[rootInfo.s] || '', cn: '根音', kind: 'pick', string: rootInfo.s, midi: null };
    }
    if (action === 'B') {
      return { label: 'B', sub: FINGER_OF_STRING[rootInfo.altS] || '', cn: '交替低音', kind: 'pick', string: rootInfo.altS, midi: null };
    }
    if (action === '-') return { label: '·', sub: '空', cn: '空拍', kind: 'rest', string: null, midi: null };
    const s = +action;
    return { label: String(s), sub: FINGER_OF_STRING[s] || '', cn: s + ' 弦', kind: 'pick', string: s, midi: null };
  }

  /* ---------- 根音/低音的 MIDI 音高（由音频层结合 OPEN_MIDI 计算） ----------
     OPEN_MIDI 约定为 6弦→1弦 顺序，因此第 s 弦 = openMidi[6-s]。 */
  function rootMidi(chordName, openMidi) {
    const r = ROOT_MAP[chordName] || ROOT_MAP['通用'];
    const mid = (info) => openMidi[6 - info.s] + (info.fret || 0);
    return { root: mid(r), alt: mid({ s: r.altS, fret: r.altFret }) };
  }

  /* ---------- 拍号显示 ---------- */
  function timeSigText(p) { return p.beats + '/' + p.beatUnit; }

/* ---------- ESM 导出 ---------- */
export { ROOT_MAP, FINGER_OF_STRING, FINGER_CN, STRUM_PATTERNS, PICK_PATTERNS, ALL_PATTERNS, validatePattern, gridOf, stepDuration, resolveAction, rootMidi, timeSigText };

export const RhythmData = { ROOT_MAP, FINGER_OF_STRING, FINGER_CN, STRUM_PATTERNS, PICK_PATTERNS, ALL_PATTERNS, validatePattern, gridOf, stepDuration, resolveAction, rootMidi, timeSigText };

if (typeof window !== 'undefined') window.RhythmData = RhythmData;

export default RhythmData;
