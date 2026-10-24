/* 六弦工坊 V3.1 · 和弦指法数据校验（BUG-7 AC-3） */
import test from 'node:test';
import assert from 'node:assert';

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.AudioContext = class { constructor(){ this.state='running'; this.currentTime=0; } resume(){} };
globalThis.document = { addEventListener(){}, querySelectorAll:()=>[], readyState:'complete', documentElement:{ setAttribute(){} } };
globalThis.AudioCore = { clamp: x=>x };

await import('../assets/js/core/audio-core.js');
const { CHORDS, CHORD_MAP, formatFingering } = await import('../assets/js/data/chords.js');

test('全部和弦都有 6 元素 fingers 且与 frets 等长', () => {
  let total = 0;
  for (const cat of Object.keys(CHORDS)) for (const ch of CHORDS[cat]) {
    total++;
    assert.ok(Array.isArray(ch.fingers), `${ch.name} 缺 fingers`);
    assert.strictEqual(ch.fingers.length, 6, `${ch.name} fingers 长度应为 6`);
    assert.strictEqual(ch.fingers.length, ch.frets.length, `${ch.name} fingers/frets 不等长`);
  }
  assert.ok(total >= 22, `和弦数 ${total} 应不少于 22`);
});

test('fingers 值域：哑音/空弦=0，按弦=1-4（横按弦除外）', () => {
  for (const cat of Object.keys(CHORDS)) for (const ch of CHORDS[cat]) {
    ch.fingers.forEach((g, i) => {
      const f = ch.frets[i];
      if (f <= 0) assert.strictEqual(g, 0, `${ch.name} 第${i}弦 fret=${f} 时 finger 应为 0`);
      else if (!(ch.barre && ch.barre.fret === f))
        assert.ok(g >= 1 && g <= 4, `${ch.name} 第${i}弦 finger=${g} 越界`);
    });
  }
});

test('formatFingering 输出包含全部 6 根弦', () => {
  for (const name of ['C', 'G', 'F', 'Am']) {
    const s = formatFingering(CHORD_MAP[name]);
    for (const sn of [1,2,3,4,5,6]) assert.ok(s.includes(sn+'弦'), `${name} 缺 ${sn}弦`);
  }
});
