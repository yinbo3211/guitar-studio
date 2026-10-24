/* ============================================================
   六弦工坊 V3 · 和弦数据 data/chords
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

const { clamp, midiFromFreq, freqFromMidi, NOTE_NAMES, NOTE_CN, noteName, noteNameNoOct, makeSmoother, PitchDetect, OPEN_MIDI, tapBpm, isSubAccent, quantizeToOctave, matchFretTarget, isPitchMatch, centsBetween, pcFromName } = AudioCore;   // V3 M3：模块级解构（原 app 文件共享作用域）

/* ============================================================
   模块 3：和弦库（数据 + 指法图 + 扫弦 + 进行伴奏）
   ============================================================ */
const CHORDS={
  major:[
    {name:'C', cat:'major', frets:[-1,3,2,0,1,0], fingers:[0,3,2,0,1,0], notes:['C','E','G']},
    {name:'D', cat:'major', frets:[-1,-1,0,2,3,2], fingers:[0,0,0,1,3,2], notes:['D','F#','A']},
    {name:'E', cat:'major', frets:[0,2,2,1,0,0], fingers:[0,2,3,1,0,0], notes:['E','G#','B']},
    {name:'F', cat:'major', frets:[1,3,3,2,1,1], fingers:[1,3,4,2,1,1], barre:{fret:1,from:6,to:1}, notes:['F','A','C']},
    {name:'G', cat:'major', frets:[3,2,0,0,0,3], fingers:[2,1,0,0,0,3], notes:['G','B','D']},
    {name:'A', cat:'major', frets:[-1,0,2,2,2,0], fingers:[0,0,1,2,3,0], notes:['A','C#','E']},
    {name:'B', cat:'major', frets:[-1,2,4,4,4,2], fingers:[0,1,2,3,4,1], barre:{fret:2,from:5,to:1}, notes:['B','D#','F#']}
  ],
  minor:[
    {name:'Am', cat:'minor', frets:[-1,0,2,2,1,0], fingers:[0,0,2,3,1,0], notes:['A','C','E']},
    {name:'Em', cat:'minor', frets:[0,2,2,0,0,0], fingers:[0,2,3,0,0,0], notes:['E','G','B']},
    {name:'Dm', cat:'minor', frets:[-1,-1,0,2,3,1], fingers:[0,0,0,2,3,1], notes:['D','F','A']},
    {name:'Bm', cat:'minor', frets:[-1,2,4,4,3,2], fingers:[0,1,3,4,2,1], barre:{fret:2,from:5,to:1}, notes:['B','D','F#']},
    {name:'F#m', cat:'minor', frets:[2,4,4,2,2,2], fingers:[1,3,4,2,1,1], barre:{fret:2,from:6,to:1}, notes:['F#','A','C#']}
  ],
  seven:[
    {name:'G7', cat:'seven', frets:[3,2,0,0,0,1], fingers:[3,2,0,0,0,1], notes:['G','B','D','F']},
    {name:'C7', cat:'seven', frets:[-1,3,2,3,1,0], fingers:[0,3,2,4,1,0], notes:['C','E','G','Bb']},
    {name:'A7', cat:'seven', frets:[-1,0,2,0,2,0], fingers:[0,0,1,0,2,0], notes:['A','C#','E','G']},
    {name:'E7', cat:'seven', frets:[0,2,0,1,0,0], fingers:[0,2,0,1,0,0], notes:['E','G#','B','D']},
    {name:'D7', cat:'seven', frets:[-1,-1,0,2,1,2], fingers:[0,0,0,2,1,3], notes:['D','F#','A','C']}
  ],
  sus:[
    {name:'Dsus2', cat:'sus', frets:[-1,-1,0,2,3,0], fingers:[0,0,0,1,3,0], notes:['D','E','A']},
    {name:'Dsus4', cat:'sus', frets:[-1,-1,0,2,3,3], fingers:[0,0,0,1,3,4], notes:['D','G','A']},
    {name:'Asus2', cat:'sus', frets:[-1,0,2,2,0,0], fingers:[0,0,1,2,0,0], notes:['A','B','E']},
    {name:'Asus4', cat:'sus', frets:[-1,0,2,2,3,0], fingers:[0,0,1,2,3,0], notes:['A','D','E']},
    {name:'Esus4', cat:'sus', frets:[0,2,2,2,0,0], fingers:[0,1,2,3,0,0], notes:['E','A','B']}
  ]
};
const CHORD_MAP={};
Object.values(CHORDS).flat().forEach(c=>CHORD_MAP[c.name]=c);
const PROGRESSIONS=[
  {name:'流行万能 1564', chords:['C','G','Am','F'], desc:'大量华语流行歌的和声骨架'},
  {name:'卡农进行', chords:['C','G','Am','Em','F','C','F','G'], desc:'帕赫贝尔卡农，温暖绵长'},
  {name:'1645 经典', chords:['C','Am','F','G'], desc:'五十年代至今最常见的进行'},
  {name:'4536251', chords:['F','G','Em','Am','Dm','G','C'], desc:'抒情流行高频出现'},
  {name:'6415 抒情', chords:['Am','F','C','G'], desc:'安静、略带忧伤的色彩'},
  {name:'G-C-D-Em', chords:['G','C','D','Em'], desc:'乡村民谣常用进行'}
];
function chordFreqs(chord){
  return chord.frets.map((f,i)=>f<0?null:freqFromMidi(OPEN_MIDI[i]+f)).filter(Boolean);
}
/* 指法数据约定（V3.1 BUG-7）：fingers 与 frets 一一对应（6弦→1弦），
   1=食指 2=中指 3=无名指 4=小指，0=空弦，-1=哑音；barre 横按内的弦标 1。 */
/* 指法图 SVG：i=0..5 对应 6弦→1弦；左手模式整体镜像 */
function renderDiagram(chord, opts={}){
  const s=opts.big?2:1, lh=opts.leftHand?1:0;
  const W=120*s,H=126*s;
  const X=i=>(24+(lh?5-i:i)*14)*s;
  const nutY=27*s, fretH=23*s;
  const fAt=i=>chord.frets[lh?5-i:i];
  /* 物理机实测修复：指法图原先全部写死 rgba(255,255,255,…) 白线，
     切到浅色主题（dawn/mono）后弦线、品位数字与背景融为一体完全看不清。
     改为引用主题变量（--diag-line / --diag-nut / --diag-num / --dot-bg / --dot-fg），
     每个主题各自定义，深色与浅色都能保证对比度。 */
  const gAt=i=>chord.fingers?(chord.fingers[lh?5-i:i]||0):0;   // V3.1 BUG-7：指法（镜像同步翻转）
  let out=`<svg viewBox="0 0 ${W} ${H}" class="diagram-svg" xmlns="http://www.w3.org/2000/svg">`;
  /* V3.1：defs 前置（先定义后引用，规避前向引用兼容问题） */
  out+=`<defs><linearGradient id="dotGrad${s}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f59136"/></linearGradient></defs>`;
  for(let f=0;f<=4;f++){
    out+=`<line x1="${X(0)}" y1="${nutY+f*fretH}" x2="${X(5)}" y2="${nutY+f*fretH}" stroke="var(--diag-line)" stroke-width="${s}"/>`;
  }
  for(let i=0;i<6;i++){
    const muted=fAt(i)===-1;
    out+=`<line x1="${X(i)}" y1="${nutY}" x2="${X(i)}" y2="${nutY+4*fretH}" stroke="${muted?'var(--diag-line-muted)':'var(--diag-string)'}" stroke-width="${s}"/>`;
  }
  const nutX=Math.min(X(0),X(5))-4*s, nutW=Math.abs(X(5)-X(0))+8*s;
  out+=`<rect x="${nutX}" y="${nutY-5*s}" width="${nutW}" height="${5*s}" rx="${2*s}" fill="var(--diag-nut)"/>`;
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f===-1){
      const cx=X(i),cy=13*s;
      out+=`<g stroke="#ff5d73" stroke-width="${1.6*s}" stroke-linecap="round"><line x1="${cx-4*s}" y1="${cy-4*s}" x2="${cx+4*s}" y2="${cy+4*s}"/><line x1="${cx-4*s}" y1="${cy+4*s}" x2="${cx+4*s}" y2="${cy-4*s}"/></g>`;
    }else if(f===0){
      out+=`<circle cx="${X(i)}" cy="${13*s}" r="${4*s}" fill="none" stroke="var(--diag-num)" stroke-width="${1.4*s}"/>`;
    }
  }
  if(chord.barre){
    const b=chord.barre;
    const iFrom=6-b.from, iTo=6-b.to;
    const x1=X(iFrom),x2=X(iTo);
    const y=nutY+(b.fret-1)*fretH+fretH/2;
    out+=`<rect x="${Math.min(x1,x2)-7*s}" y="${y-6*s}" width="${Math.abs(x2-x1)+14*s}" height="${12*s}" rx="${6*s}" fill="var(--dot-bg)" stroke="var(--dot-ring)" stroke-width="${1.2*s}"/>`;
    // 横按条上标出品位数字（大图时），与圆点保持同一对比配色
    if(s>1){
      out+=`<text x="${(x1+x2)/2}" y="${y+3.6*s}" font-size="${7.5*s}" fill="var(--dot-fg)" font-family="JetBrains Mono,monospace" font-weight="700" text-anchor="middle">${b.fret}</text>`;
    }
  }
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f>0 && !(chord.barre && chord.barre.fret===f)){
      const cx=X(i), cy=nutY+(f-1)*fretH+fretH/2;
      /* 物理机实测需求：原先只有一个橙色圆点，看不出具体按第几品。
         圆点内写品位数字，颜色走主题变量，任何主题下都清晰可读；
         大图再用上标标注手指标号（BUG-7 指法图），两者不冲突。 */
      out+=`<circle cx="${cx}" cy="${cy}" r="${7*s}" fill="var(--dot-bg)" stroke="var(--dot-ring)" stroke-width="${1.2*s}"/>`;
      if(s>1){
        const g=gAt(i), barreHere=!!(chord.barre && chord.barre.fret===f);
        out+=`<text x="${cx}" y="${cy+3.4*s}" font-size="${8*s}" fill="var(--dot-fg)" font-family="JetBrains Mono,monospace" font-weight="700" text-anchor="middle">${f}</text>`;
        if(g>=1 && g<=4 && !barreHere){
          out+=`<text x="${cx+7.5*s}" y="${cy-4*s}" font-size="${5.6*s}" fill="var(--diag-num)" font-weight="700" text-anchor="middle" font-family="JetBrains Mono,monospace">${g}</text>`;
        }
      }
    }
  }
  for(let f=1;f<=4;f++){
    // P2-14 修复：左手镜像模式下品位数字应放在视觉上最后一根弦的外侧
    const numX=Math.max(X(0),X(5))+12*s;
    const numY=nutY+fretH*(f-0.5)+3*s;
    // 侧边品位数字加圆形背景，提升浅色主题下的可读性
    out+=`<circle cx="${numX}" cy="${nutY+fretH*(f-0.5)}" r="${7*s}" fill="var(--diag-num-bg)" stroke="var(--diag-line)" stroke-width="${0.8*s}"/>`;
    out+=`<text x="${numX}" y="${numY}" font-size="${8.5*s}" fill="var(--diag-num)" font-family="JetBrains Mono,monospace" text-anchor="middle">${f}</text>`;
  }
  return out+'</svg>';
}

/* 文字版按法提示（V3.1 BUG-7） */
function formatFingering(chord){
  const parts = [];
  for(let i=0;i<6;i++){
    const f=chord.frets[i], g=(chord.fingers&&chord.fingers[i]!==undefined)?chord.fingers[i]:0;
    const sn=6-i;
    if(f===-1){ parts.push(sn+'弦×'); continue; }
    if(f===0){ parts.push(sn+'弦0(空弦)'); continue; }
    const barreHere = chord.barre && chord.barre.fret===f;
    const gn = (g>=1&&!barreHere)? g+'指' : (barreHere?'横按':(g>=1?g+'指':''));
    parts.push(sn+'弦'+f+'品'+(gn?('·'+gn):''));
  }
  return '按法：'+parts.join(' · ');
}

Object.assign(window, { CHORDS, CHORD_MAP, PROGRESSIONS, chordFreqs, renderDiagram, formatFingering });
export { CHORDS, CHORD_MAP, PROGRESSIONS, chordFreqs, renderDiagram, formatFingering };
