// plan.js — 练习计划模块 V3.1
const PLAN_LEVELS = ['L1','L2','L3','L4'];
const FOCUS = {
  finger: { label: '手指灵活', modules: ['scale'] },
  ear:    { label: '练耳',     modules: ['ear'] },
  rhythm: { label: '节奏',     modules: ['metronome'] },
  chord:  { label: '和弦',     modules: ['tuner'] },
  flow:   { label: '和弦进行', modules: ['chord-flow'] }
};

const planTaskDefs = [
  { id: 'tuner-5min',   module: 'tuner',   duration: 300000, unitKey: 'tuner' },
  { id: 'scale-10min',  module: 'scale',   duration: 600000, unitKey: 'scale' },
  { id: 'ear-5min',     module: 'ear',     duration: 300000, unitKey: 'ear' },
  { id: 'met-5min',     module: 'metronome', duration: 300000, unitKey: 'rhythm' },
  { id: 'flow-5min',    module: 'chord-flow', duration: 300000, unitKey: 'flow' }
];

function refreshProgress(sessions) {
  const buckets = {};
  for (const [key] of Object.entries(FOCUS)) {
    buckets[key] = { count: 0, durationMs: 0, acc: [], switches: 0, questions: 0 };
  }
  for (const s of sessions || []) {
    const b = buckets[s.module === 'ear' ? 'ear' : s.module === 'scale' ? 'finger' : s.module === 'tuner' ? 'chord' : s.module === 'metronome' ? 'rhythm' : 'flow'];
    if (!b) continue;
    b.count++;
    b.durationMs += Number(s.durationMs) || 0;
    if (typeof s.accuracy === 'number') b.acc.push(s.accuracy);
    b.switches += Number(s.meta && s.meta.switches) || 0;
    b.questions += Number(s.meta && s.meta.questions) || 0;
  }
  const unitOf = {
    tuner: s => s.count,
    flow: s => s.switches,
    rhythm: s => Math.floor(s.durationMs / 4000),
    scale: s => s.count,
    ear: s => s.questions
  };
  const progress = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    const mod = FOCUS[key].modules[0];
    progress[key] = { ...bucket, units: unitOf[mod] ? unitOf[mod](bucket) : 0 };
  }
  return progress;
}

export const Plan = { PLAN_LEVELS, FOCUS, planTaskDefs, refreshProgress };
export { PLAN_LEVELS, FOCUS, planTaskDefs };
window.Plan = Plan;
