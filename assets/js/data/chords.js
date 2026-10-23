/* ============================================================
   六弦工坊 V3 · 和弦数据 data/chords
   （M3 目录重构：由 V2 app-*.js 拆分，代码体保持不变）
   ============================================================ */
'use strict';

/* ============================================================
   模块 3：和弦库（数据 + 指法图 + 扫弦 + 进行伴奏）
   ============================================================ */
const CHORDS={
  major:[
    {name:'C', cat:'major', frets:[-1,3,2,0,1,0], notes:['C','E','G']},
    {name:'D', cat:'major', frets:[-1,-1,0,2,3,2], notes:['D','F#','A']},
    {name:'E', cat:'major', frets:[0,2,2,1,0,0], notes:['E','G#','B']},
    {name:'F', cat:'major', frets:[1,3,3,2,1,1], barre:{fret:1,from:6,to:1}, notes:['F','A','C']},
    {name:'G', cat:'major', frets:[3,2,0,0,0,3], notes:['G','B','D']},
    {name:'A', cat:'major', frets:[-1,0,2,2,2,0], notes:['A','C#','E']},
    {name:'B', cat:'major', frets:[-1,2,4,4,4,2], barre:{fret:2,from:5,to:1}, notes:['B','D#','F#']}
  ],
  minor:[
    {name:'Am', cat:'minor', frets:[-1,0,2,2,1,0], notes:['A','C','E']},
    {name:'Em', cat:'minor', frets:[0,2,2,0,0,0], notes:['E','G','B']},
    {name:'Dm', cat:'minor', frets:[-1,-1,0,2,3,1], notes:['D','F','A']},
    {name:'Bm', cat:'minor', frets:[-1,2,4,4,3,2], barre:{fret:2,from:5,to:1}, notes:['B','D','F#']},
    {name:'F#m', cat:'minor', frets:[2,4,4,2,2,2], barre:{fret:2,from:6,to:1}, notes:['F#','A','C#']}
  ],
  seven:[
    {name:'G7', cat:'seven', frets:[3,2,0,0,0,1], notes:['G','B','D','F']},
    {name:'C7', cat:'seven', frets:[-1,3,2,3,1,0], notes:['C','E','G','Bb']},
    {name:'A7', cat:'seven', frets:[-1,0,2,0,2,0], notes:['A','C#','E','G']},
    {name:'E7', cat:'seven', frets:[0,2,0,1,0,0], notes:['E','G#','B','D']},
    {name:'D7', cat:'seven', frets:[-1,-1,0,2,1,2], notes:['D','F#','A','C']}
  ],
  sus:[
    {name:'Dsus2', cat:'sus', frets:[-1,-1,0,2,3,0], notes:['D','E','A']},
    {name:'Dsus4', cat:'sus', frets:[-1,-1,0,2,3,3], notes:['D','G','A']},
    {name:'Asus2', cat:'sus', frets:[-1,0,2,2,0,0], notes:['A','B','E']},
    {name:'Asus4', cat:'sus', frets:[-1,0,2,2,3,0], notes:['A','D','E']},
    {name:'Esus4', cat:'sus', frets:[0,2,2,2,0,0], notes:['E','A','B']}
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
/* 指法图 SVG：i=0..5 对应 6弦→1弦；左手模式整体镜像 */
function renderDiagram(chord, opts={}){
  const s=opts.big?2:1, lh=opts.leftHand?1:0;
  const W=120*s,H=126*s;
  const X=i=>(24+(lh?5-i:i)*14)*s;
  const nutY=27*s, fretH=23*s;
  const fAt=i=>chord.frets[lh?5-i:i];
  let out=`<svg viewBox="0 0 ${W} ${H}" class="diagram-svg" xmlns="http://www.w3.org/2000/svg">`;
  for(let f=0;f<=4;f++){
    out+=`<line x1="${X(0)}" y1="${nutY+f*fretH}" x2="${X(5)}" y2="${nutY+f*fretH}" stroke="rgba(255,255,255,.28)" stroke-width="${s}"/>`;
  }
  for(let i=0;i<6;i++){
    const muted=fAt(i)===-1;
    out+=`<line x1="${X(i)}" y1="${nutY}" x2="${X(i)}" y2="${nutY+4*fretH}" stroke="${muted?'rgba(255,255,255,.12)':'rgba(255,255,255,.4)'}" stroke-width="${s}"/>`;
  }
  const nutX=Math.min(X(0),X(5))-4*s, nutW=Math.abs(X(5)-X(0))+8*s;
  out+=`<rect x="${nutX}" y="${nutY-5*s}" width="${nutW}" height="${5*s}" rx="${2*s}" fill="rgba(255,255,255,.55)"/>`;
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f===-1){
      const cx=X(i),cy=13*s;
      out+=`<g stroke="#ff5d73" stroke-width="${1.6*s}" stroke-linecap="round"><line x1="${cx-4*s}" y1="${cy-4*s}" x2="${cx+4*s}" y2="${cy+4*s}"/><line x1="${cx-4*s}" y1="${cy+4*s}" x2="${cx+4*s}" y2="${cy-4*s}"/></g>`;
    }else if(f===0){
      out+=`<circle cx="${X(i)}" cy="${13*s}" r="${4*s}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="${1.4*s}"/>`;
    }
  }
  if(chord.barre){
    const b=chord.barre;
    const iFrom=6-b.from, iTo=6-b.to;
    const x1=X(iFrom),x2=X(iTo);
    const y=nutY+(b.fret-1)*fretH+fretH/2;
    out+=`<rect x="${Math.min(x1,x2)-7*s}" y="${y-6*s}" width="${Math.abs(x2-x1)+14*s}" height="${12*s}" rx="${6*s}" fill="url(#dotGrad${s})"/>`;
  }
  for(let i=0;i<6;i++){
    const f=fAt(i);
    if(f>0 && !(chord.barre && chord.barre.fret===f)){
      const cx=X(i), cy=nutY+(f-1)*fretH+fretH/2;
      out+=`<circle cx="${cx}" cy="${cy}" r="${7*s}" fill="url(#dotGrad${s})"/>`;
    }
  }
  out+=`<defs><linearGradient id="dotGrad${s}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f59136"/></linearGradient></defs>`;
  for(let f=1;f<=4;f++){
    // P2-14 修复：左手镜像模式下品位数字应放在视觉上最后一根弦的外侧
    // （V1 恒用 X(5)+12*s，左手模式时数字叠进弦区）
    const numX=Math.max(X(0),X(5))+12*s;
    out+=`<text x="${numX}" y="${nutY+fretH*(f-0.5)+3*s}" font-size="${9*s}" fill="rgba(255,255,255,.35)" font-family="JetBrains Mono,monospace">${f}</text>`;
  }
  return out+'</svg>';
}

Object.assign(window, { CHORDS, CHORD_MAP, PROGRESSIONS, chordFreqs, renderDiagram });
export { CHORDS, CHORD_MAP, PROGRESSIONS, chordFreqs, renderDiagram };
