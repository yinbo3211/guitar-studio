// Monophonic pitch detection via normalized autocorrelation.
// Returns the fundamental frequency in Hz, an RMS level, and a clarity score (0..1).
import { freqToMidiFloat } from "./notes.js";

const MIN_FREQ = 60;    // a bit below low bass B/E
const MAX_FREQ = 1400;  // high fretted notes

/** @param {Float32Array} buf time-domain samples in [-1,1]
 *  @param {number} sampleRate
 *  @param {number} gate RMS noise gate */
export function detectPitch(buf, sampleRate, gate = 0.012) {
  const n = buf.length;
  // RMS
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < gate) return { freq: -1, rms, clarity: 0 };

  // Trim quiet ends to reduce noise impact
  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_FREQ), Math.floor(n / 2));

  // Normalized square difference (McLeod-style) for robust peak selection
  let bestLag = -1, bestVal = 0;
  let prevCorr = 0, ascending = false;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, normA = 0, normB = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += buf[i] * buf[i + lag];
      normA += buf[i] * buf[i];
      normB += buf[i + lag] * buf[i + lag];
    }
    const nsdf = (2 * corr) / (normA + normB || 1); // -1..1
    if (nsdf > prevCorr) ascending = true;
    if (ascending && nsdf < prevCorr) {
      // we just passed a local peak at lag-1
      const peakLag = lag - 1;
      if (prevCorr > bestVal) { bestVal = prevCorr; bestLag = peakLag; }
      ascending = false;
      // first strong peak (>0.9 of running best) is usually the fundamental
      if (bestVal > 0.92) break;
    }
    prevCorr = nsdf;
  }

  if (bestLag < 0 || bestVal < 0.5) return { freq: -1, rms, clarity: bestVal };

  // parabolic interpolation around bestLag using NSDF neighbours
  const y0 = nsdfAt(buf, n, bestLag - 1), y1 = nsdfAt(buf, n, bestLag), y2 = nsdfAt(buf, n, bestLag + 1);
  const denom = (y0 - 2 * y1 + y2);
  const shift = denom ? 0.5 * (y0 - y2) / denom : 0;
  const refinedLag = bestLag + shift;
  const freq = sampleRate / refinedLag;
  if (freq < MIN_FREQ || freq > MAX_FREQ) return { freq: -1, rms, clarity: bestVal };
  return { freq, rms, clarity: bestVal };
}

function nsdfAt(buf, n, lag) {
  if (lag < 1) lag = 1;
  let corr = 0, normA = 0, normB = 0;
  for (let i = 0; i < n - lag; i++) {
    corr += buf[i] * buf[i + lag];
    normA += buf[i] * buf[i];
    normB += buf[i + lag] * buf[i + lag];
  }
  return (2 * corr) / (normA + normB || 1);
}

/** Smoother that suppresses octave jumps and brief dropouts. */
export class PitchTracker {
  constructor() { this.last = -1; this.lastMidi = -1; this.holds = 0; }
  push(freq, a4 = 440) {
    if (freq <= 0) {
      this.holds++;
      if (this.holds > 4) { this.last = -1; this.lastMidi = -1; }
      return this.last;
    }
    this.holds = 0;
    // octave correction toward previous reading
    if (this.last > 0) {
      const candidates = [freq, freq / 2, freq * 2];
      candidates.sort((a, b) => Math.abs(a - this.last) - Math.abs(b - this.last));
      freq = candidates[0];
    }
    // light smoothing
    this.last = this.last > 0 ? this.last * 0.4 + freq * 0.6 : freq;
    this.lastMidi = freqToMidiFloat(this.last, a4);
    return this.last;
  }
}
