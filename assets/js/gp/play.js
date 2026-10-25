import { el, slider, toast, fmtTime, getVar } from "./components.js";
import { Store } from "./state.js";
import { Audio } from "./engine.js";
import { detectPitch, PitchTracker } from "./pitch.js";
import { Synth } from "./synth.js";
import { TrackPlayer } from "./player.js";
import { Band } from "./band.js";
import { findSong } from "./catalog.js";
import { songDuration, pickPart } from "./song-format.js";
import { autoAccompaniment } from "./accompany.js";
import { freqToMidiFloat, midiToName, midiToFret, midiToHole, INSTRUMENTS } from "./notes.js";
import { suggestCapo, describeMidiSet } from "./theory.js";
import { drawBackground } from "./backgrounds.js";
import { renderAvatar } from "./avatar.js";
import { buildLyricTimeline, activeAt } from "./karaoke-timeline.js";
import { lineFillHTML, escapeHTML as esc } from "./karaoke-render.js";

const LEAD_IN = 3.0;          // count-in seconds before notes start
const HIT_PAD = 0.16;         // detection window pad around a note
const PERFECT_CENTS = 28;
const GOOD_CENTS = 60;

export default async function play(ctx) {
  const { el: root, params, navigate } = ctx;
  const song = findSong(params[0]);
  if (!song) {
    root.appendChild(el("div.panel", { style: { margin: "22px" } }, [
      el("h2", { text: "Song not found" }),
      el("button.btn", { onclick: () => navigate("#/library") }, ["Back to songs"]),
    ]));
    return;
  }
  const s = Store.settings();
  const a4 = s.a4;
  const speed = s.noteSpeed;
  // Which part you play: yours if the arrangement has one, else the song's lead.
  // Everything else in the arrangement becomes the synth band.
  const { parts, index: leadIdx, lead } = pickPart(song, s.instrument);
  const playInst = lead.instrument;
  const duration = songDuration({ notes: lead.notes });
  const capo = song.capo || suggestCapo(((lead.notes[0]?.midi[0] ?? 60) % 12)).capo;
  const inst = INSTRUMENTS[playInst] || INSTRUMENTS["acoustic-guitar"];
  const fretted = inst.kind === "fretted";
  const harp = playInst === "harmonica";   // hole panel is harmonica-specific, not all winds
  const percussion = inst.kind === "percussion";  // unpitched: graded on hit timing, not pitch
  // with a capo, fingering is relative to the capo; midiToFret sees shifted open strings
  const capoStrings = fretted ? inst.strings.map((v) => v + capo) : null;

  // ----- lyrics / karaoke overlay -----
  const lyrics = (song.lyrics || []).slice().sort((a, b) => a.time - b.time);
  const lyricTimeline = lyrics.length ? buildLyricTimeline(song) : null;
  let karaokeLyrics = lyricTimeline ? (s.karaokeLyrics ?? true) : false;

  // ----- per-note runtime state -----
  const notes = lead.notes.map((n) => ({
    time: n.time, dur: n.dur || 0.4, midi: n.midi, chord: n.chord || n.midi.length > 1,
    state: "pending", best: 999, frames: 0,
    frets: fretted ? n.midi.map((m) => midiToFret(m, playInst, capoStrings)) : null,
    holes: harp ? n.midi.map(midiToHole) : null,
  }));
  notes.sort((a, b) => a.time - b.time);

  // ----- DOM -----
  const shell = el("div.play-shell");
  const canvas = el("canvas#highway-canvas");
  const overlay = el("div.play-overlay");
  const scoreBox = el("div.hud-box", { html: scoreHTML(0, 100, 0, 1) });
  const songBox = el("div.hud-box", {}, [
    el("div", { html: `<b>${song.title}</b>` }),
    el("div.muted", { style: { fontSize: "12px" }, html:
      `${song.artist} · key ${song.key} · ${song.bpm} BPM` + (capo ? ` · <span class="capo-note" style="padding:2px 8px">🔼 Capo ${capo}</span>` : "") }),
    parts.length > 1 ? el("div.muted", { style: { fontSize: "12px", marginTop: "2px" },
      text: `🎯 Your part: ${inst.name}` }) : null,
    (song.lyrics && song.lyrics.length)
      ? el("div.muted", { style: { fontSize: "12px", marginTop: "2px" }, text: `🎤 Singalong${song.genre ? " · " + song.genre : ""}` })
      : (song.genre ? el("div.muted", { style: { fontSize: "12px", marginTop: "2px" }, text: song.genre }) : null),
  ]);
  const healthWrap = el("div.healthbar-big", {}, [el("i", { style: { width: "100%" } })]);
  const killfeed = el("div.killfeed");
  const lyric = el("div.lyric-line");
  const banner = el("div.banner.hidden");

  const avatarBadge = el("div.play-avatar", { html: renderAvatar() });
  const hud = el("div.play-hud", {}, [
    el("div.row", { style: { gap: "10px", alignItems: "flex-start" } }, [avatarBadge, songBox]),
    el("div.col", { style: { alignItems: "flex-end", gap: "8px" } }, [scoreBox, healthWrap]),
  ]);
  overlay.append(hud, killfeed, lyric, el("div.play-bottom-fade"), banner);

  // controls
  const playBtn = el("button.btn.primary", { onclick: togglePlay }, ["▶ Start"]);
  const restartBtn = el("button.btn", { onclick: restart }, ["⟲ Restart"]);
  const backBtn = el("button.btn.ghost", { onclick: () => navigate("#/library") }, ["← Songs"]);
  const player = new TrackPlayer();
  player.load(song);

  // ----- synth backing band -----
  // Authored parts you're not playing, plus generated bass/comp/drums for the
  // roles nothing covers. An imported backing track wins by default.
  const bandParts = parts.filter((_, i) => i !== leadIdx);
  bandParts.push(...autoAccompaniment({ ...song, notes: lead.notes, instrument: playInst }, parts));
  const band = new Band(bandParts, { a4, volume: s.backingVolume });
  let bandOn = !band.empty && !player.backing && (s.band ?? true);
  const bandBtn = band.empty ? null : el("button.btn", {
    class: bandOn ? "primary" : "", title: "Synthesized accompaniment: " + band.names.join(", "),
    onclick: () => {
      bandOn = !bandOn; Store.setSetting("band", bandOn);
      bandBtn.classList.toggle("primary", bandOn);
      if (bandOn) band.seek(Math.max(0, clock)); else band.silence();
    },
  }, ["🎺 Band"]);

  const volB = slider({ label: "Backing", value: s.backingVolume, fmt: (v) => Math.round(v * 100) + "%",
    oninput: (v) => { Store.setSetting("backingVolume", v); player.setBackingVolume(v); band.setVolume(v); } });
  const volV = slider({ label: "Vocal", value: s.vocalVolume, fmt: (v) => Math.round(v * 100) + "%",
    oninput: (v) => { Store.setSetting("vocalVolume", v); player.setVocalVolume(v); } });
  const metroBtn = el("button.btn", { onclick: () => { metro = !metro; metroBtn.classList.toggle("primary", metro); } }, ["🥁 Metronome"]);
  let metro = false;
  let noteSounds = s.noteSounds ?? true;
  const soundBtn = el("button.btn", { class: noteSounds ? "primary" : "", title: "Sound each note as it reaches the hit line", onclick: () => {
    noteSounds = !noteSounds; Store.setSetting("noteSounds", noteSounds);
    soundBtn.classList.toggle("primary", noteSounds);
  } }, ["🔊 Notes"]);
  let showFrets = fretted || harp ? (s.showFingering ?? true) : false;
  const fretBtn = fretted || harp ? el("button.btn", { class: showFrets ? "primary" : "", title: harp ? "Show harmonica hole and breath direction" : "Show finger positions on a fretboard", onclick: () => {
    showFrets = !showFrets; Store.setSetting("showFingering", showFrets);
    fretBtn.classList.toggle("primary", showFrets);
    if (!playing) render(clock);
  } }, [harp ? "🎺 Holes" : "🎸 Frets"]) : null;
  const karaokeBtn = lyrics.length ? el("button.btn", { class: karaokeLyrics ? "primary" : "", title: "Word-by-word singalong highlight", onclick: () => {
    karaokeLyrics = !karaokeLyrics; Store.setSetting("karaokeLyrics", karaokeLyrics);
    karaokeBtn.classList.toggle("primary", karaokeLyrics);
    updateLyric(clock);
  } }, ["🎤 Karaoke"]) : null;

  const controls = el("div.play-controls", {}, [
    playBtn, restartBtn,
    el("div.muted", { style: { minWidth: "70px" }, id: "play-clock", text: "0:00" }),
    el("div", { style: { flex: "1" } }),
    (!player.hasAudio() && band.empty) ? el("span.muted", { style: { fontSize: "12px" }, text: "No backing audio — import one in the Song Editor." }) : null,
    (player.backing || !band.empty) ? wrapNarrow(volB) : null,
    player.vocal ? wrapNarrow(volV) : null,
    karaokeBtn, bandBtn, soundBtn, fretBtn, metroBtn, backBtn,
  ]);

  shell.append(el("div.play-stage", {}, [canvas, overlay]), controls);
  root.appendChild(shell);
  const clockEl = controls.querySelector("#play-clock");

  // ----- canvas sizing -----
  const c = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  resize();

  // pitch range for vertical mapping
  const allMidi = notes.flatMap((n) => n.midi);
  let loM = Math.min(...allMidi) - 3, hiM = Math.max(...allMidi) + 3;
  if (!isFinite(loM)) { loM = 48; hiM = 72; }
  if (hiM - loM < 12) { const mid = (hiM + loM) / 2; loM = mid - 6; hiM = mid + 6; }

  // ----- game state -----
  let playing = false, started = false, finished = false;
  let clock = -LEAD_IN;             // seconds; negative during count-in
  let lastTs = 0;
  let health = 100, failed = false;
  let score = 0, streak = 0, maxStreak = 0, mult = 1;
  const counts = { perfect: 0, good: 0, off: 0, miss: 0 };
  let lastMetroBeat = -1;
  let soundIdx = 0;                 // next note to sound via the synth
  const beatLen = 60 / song.bpm;

  // pitch detection
  const tracker = new PitchTracker();
  const buf = new Float32Array(2048);
  let detectedMidi = -1;
  let lastRms = 0, onsetAt = -1, lastOnsetAt = -10;  // percussion hit detection

  // Pixels per second on the highway. Scaled so a narrow screen still shows ~4s of
  // notes coming — at a fixed 240 a phone gives barely a second of warning. Capped
  // at 240 so anything wider than ~1150px keeps the original desktop feel.
  // ponytail: purely visual; grading is time-based, so this can't move a score.
  const PPS = () => Math.min(240, (W * 0.84) / 4) * speed;
  const HIT_X = () => W * 0.16;     // x position of the "now" line
  const yFor = (midi) => {
    const pad = 46;
    return H - pad - ((midi - loM) / (hiM - loM)) * (H - pad * 2);
  };

  async function ensureMic() {
    if (Audio.micLive()) return true;
    try { await Audio.startMic(s.inputDeviceId); return true; }
    catch (e) { toast("Mic off — notes won't be graded. " + e.message, "bad"); return false; }
  }

  async function togglePlay() {
    if (finished) { restart(); return; }
    if (playing) { pause(); return; }
    await ensureMic();
    await Audio.resume();
    playing = true; started = true;
    playBtn.textContent = "⏸ Pause";
    if (clock >= 0) player.play(clock);
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }
  function pause() {
    playing = false; playBtn.textContent = "▶ Resume";
    player.pause(); band.silence();
  }
  function restart() {
    pause();
    finished = false; banner.classList.add("hidden");
    clock = -LEAD_IN; health = 100; failed = false; score = 0; streak = 0; maxStreak = 0; mult = 1;
    counts.perfect = counts.good = counts.off = counts.miss = 0;
    soundIdx = 0; onsetAt = -1; lastOnsetAt = -10; lastRms = 0;
    notes.forEach((n) => { n.state = "pending"; n.best = 999; n.frames = 0; });
    killfeed.innerHTML = "";
    player.seek(0); band.seek(0);
    playBtn.textContent = "▶ Start";
    render(0); updateHud();
  }

  // ----- main loop -----
  function loop(ts) {
    if (!playing) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    // advance clock; sync to audio when available and past lead-in
    if (player.hasAudio() && clock >= 0 && player.backing && !player.backing.paused) {
      clock = player.backing.currentTime;
    } else {
      clock += dt;
      if (clock >= 0 && player.hasAudio() && (player.backing?.paused)) player.play(clock);
    }

    // synth band (schedules ahead of the clock, so it stays in time regardless of frame rate)
    if (bandOn) band.schedule(clock);

    // metronome
    if (metro) {
      const beat = Math.floor(clock / beatLen);
      if (beat !== lastMetroBeat && clock >= -LEAD_IN) { Synth.click({ accent: beat % 4 === 0 }); lastMetroBeat = beat; }
    }

    // sound notes as they cross the hit line (guard skips backlog after audio-sync jumps)
    while (soundIdx < notes.length && notes[soundIdx].time <= clock) {
      const n = notes[soundIdx++];
      if (noteSounds && clock - n.time < 0.3) {
        for (const m of n.midi) Synth.playMidi(m, { dur: Math.max(0.4, Math.min(n.dur, 2)), a4, gain: 0.18, instrument: playInst });
      }
    }

    // read pitch (and, for percussion, hit transients)
    if (Audio.readTimeDomain(buf)) {
      const { freq, rms } = detectPitch(buf, Audio.ctx().sampleRate, s.micGate);
      if (percussion) {
        // ponytail: RMS-spike onset detector; upgrade to spectral flux if false triggers annoy
        if (rms > s.micGate * 3 && rms > lastRms * 2 && clock - lastOnsetAt > 0.09) { onsetAt = clock; lastOnsetAt = clock; }
        lastRms = rms;
      }
      const f = tracker.push(freq, a4);
      detectedMidi = f > 0 ? freqToMidiFloat(f, a4) : -1;
    }

    grade();
    render(clock);
    updateHud();

    clockEl.textContent = fmtTime(Math.max(0, clock)) + " / " + fmtTime(duration);

    if (clock > duration + 1.2) { finish(); return; }
    requestAnimationFrame(loop);
  }

  // ----- grading -----
  function grade() {
    if (percussion) {
      // a hit credits the nearest active note; quality = timing offset, any drum voice counts
      if (onsetAt >= 0) {
        let best = null;
        for (const n of notes) {
          if (n.state !== "pending") continue;
          if (n.time - HIT_PAD > onsetAt) break;
          if (onsetAt <= n.time + n.dur + HIT_PAD &&
              (!best || Math.abs(n.time - onsetAt) < Math.abs(best.time - onsetAt))) best = n;
        }
        if (best) { best.frames++; best.best = Math.min(best.best, Math.abs(best.time - onsetAt)); }
        onsetAt = -1;
      }
      for (const n of notes) {
        if (n.state !== "pending") continue;
        if (clock < n.time - HIT_PAD) break;
        if (clock > n.time + n.dur + HIT_PAD) finalize(n);
      }
      return;
    }
    for (const n of notes) {
      if (n.state !== "pending") continue;
      const winStart = n.time - HIT_PAD;
      const winEnd = n.time + n.dur + HIT_PAD;
      if (clock < winStart) break;            // notes sorted; none active yet
      if (clock > winEnd) { finalize(n); continue; }
      // active: try to match detected pitch to any chord tone (octave-agnostic)
      if (detectedMidi > 0) {
        let bestCents = 999;
        for (const target of n.midi) {
          const diff = detectedMidi - target;
          const cents = Math.abs((diff - Math.round(diff / 12) * 12) * 100);
          if (cents < bestCents) bestCents = cents;
        }
        if (bestCents < GOOD_CENTS) { n.frames++; if (bestCents < n.best) n.best = bestCents; }
      }
    }
  }
  function finalize(n) {
    let q;
    if (percussion) {                       // n.best holds seconds off the beat, not cents
      if (n.frames && n.best <= 0.07) q = "perfect";
      else if (n.frames && n.best <= 0.15) q = "good";
      else if (n.frames) q = "off";
      else q = "miss";
    } else if (n.frames >= 2 && n.best <= PERFECT_CENTS) q = "perfect";
    else if (n.frames >= 1 && n.best <= GOOD_CENTS) q = "good";
    else if (n.frames >= 1) q = "off";
    else q = "miss";
    n.state = q;
    applyJudgment(q, n);
  }
  function applyJudgment(q, n) {
    counts[q]++;
    if (q === "perfect") { health = Math.min(100, health + 6); streak++; score += Math.round(100 * mult); }
    else if (q === "good") { health = Math.min(100, health + 3); streak++; score += Math.round(60 * mult); }
    else if (q === "off") { health = Math.max(0, health - 7); streak = 0; score += 10; }
    else { health = Math.max(0, health - 10); streak = 0; }
    maxStreak = Math.max(maxStreak, streak);
    mult = 1 + Math.min(3, Math.floor(streak / 8)) * 0.5;
    if (health <= 0 && !failed) { failed = true; toast("Healthbar empty — keep going, but this run won't count as a pass.", "bad"); }
    pushKill(q, n);
  }
  function pushKill(q, n) {
    const label = describeMidiSet(n.midi);
    const k = el(`div.kill.${q}`, { html: `${q[0].toUpperCase() + q.slice(1)} <span class="muted">${label}</span>` });
    killfeed.appendChild(k);
    while (killfeed.children.length > 6) killfeed.firstChild.remove();
    setTimeout(() => { k.style.opacity = "0"; k.style.transition = "opacity 500ms"; }, 1400);
    setTimeout(() => k.remove(), 2000);
  }

  // ----- rendering -----
  function render(t) {
    drawBackground(c, W, H, song.background, Math.max(0, t), duration);
    // dim overlay for contrast
    c.fillStyle = "rgba(0,0,0,0.28)"; c.fillRect(0, 0, W, H);

    const hitX = HIT_X(), pps = PPS();

    // horizontal pitch gridlines for octaves
    c.strokeStyle = getVar("--highway-line"); c.lineWidth = 1; c.font = "10px var(--mono)"; c.fillStyle = getVar("--muted");
    for (let m = Math.ceil(loM / 12) * 12; m <= hiM; m += 12) {
      const y = yFor(m); c.globalAlpha = 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      c.globalAlpha = 1; c.fillText(midiToName(m).full, 4, y - 3);
    }

    // hit line
    c.globalAlpha = 1;
    const grd = c.createLinearGradient(hitX - 30, 0, hitX + 30, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)"); grd.addColorStop(0.5, getVar("--accent")); grd.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = grd; c.fillRect(hitX - 30, 0, 60, H);
    c.strokeStyle = getVar("--accent"); c.lineWidth = 2; c.beginPath(); c.moveTo(hitX, 0); c.lineTo(hitX, H); c.stroke();

    // notes
    for (const n of notes) {
      const x = hitX + (n.time - t) * pps;
      const wRect = Math.max(16, n.dur * pps);
      if (x + wRect < -20 || x > W + 40) continue;
      for (const midi of n.midi) {
        const y = yFor(midi);
        drawNote(x, y, wRect, n.state, midi, n.chord);
      }
    }

    // live pitch marker (meaningless for unpitched percussion)
    if (!percussion && detectedMidi > 0) {
      const y = yFor(detectedMidi);
      c.fillStyle = getVar("--accent-2");
      c.beginPath(); c.arc(hitX, y, 7, 0, 7); c.fill();
      c.globalAlpha = 0.3; c.fillRect(0, y - 1.5, hitX, 3); c.globalAlpha = 1;
    }

    // fingering hint: fretboard dots or harmonica holes
    if (showFrets) (harp ? drawHoles : drawFretboard)(t);

    // count-in
    if (t < 0) {
      const n = Math.ceil(-t);
      c.fillStyle = getVar("--text"); c.font = "bold 120px var(--font)"; c.textAlign = "center";
      c.globalAlpha = (1 - (Math.abs(t) % 1)) * 0.9 + 0.1;
      c.fillText(String(n), W / 2, H / 2 + 40); c.globalAlpha = 1; c.textAlign = "start";
    }

    // lyrics
    updateLyric(t);
  }

  function drawNote(x, y, w, state, midi, chord) {
    const h = 26;
    const colors = { pending: getVar("--accent"), perfect: getVar("--j-perfect"),
      good: getVar("--j-good"), off: getVar("--j-off"), miss: getVar("--j-miss") };
    const col = colors[state] || colors.pending;
    c.globalAlpha = state === "miss" ? 0.35 : 1;
    roundRect(x, y - h / 2, w, h, 8);
    const g = c.createLinearGradient(x, y - h / 2, x, y + h / 2);
    g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.25));
    c.fillStyle = g; c.fill();
    if (state === "pending") { c.shadowColor = col; c.shadowBlur = 10; c.fill(); c.shadowBlur = 0; }
    c.globalAlpha = 1;
    c.fillStyle = "rgba(0,0,0,0.8)"; c.font = "bold 11px var(--font)";
    const lbl = chord ? "" : midiToName(midi).name;
    if (lbl && w > 22) c.fillText(lbl, x + 5, y + 4);
  }
  // fretboard strip: dots for the current (or next) note's fingering
  function drawFretboard(t) {
    const cur = notes.find((n) => n.frets && t <= n.time + n.dur);
    if (!cur) return;
    const now = t >= cur.time - 0.05;
    const nStr = inst.strings.length;
    const FRETS = 12;
    const fbW = Math.min(340, W * 0.42), fbH = 6 + nStr * 13;
    const x0 = 22, y0 = H - fbH - 44;
    const nutX = x0 + 22, cell = (fbW - 30) / FRETS;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(x0 - 10, y0 - 24, fbW + 20, fbH + 44, 10); c.fill();
    c.fillStyle = now ? getVar("--accent") : getVar("--muted");
    c.font = "bold 12px var(--font)";
    c.fillText((now ? "Now: " : "Next: ") + describeMidiSet(cur.midi) + (capo ? ` · capo ${capo}` : ""), x0, y0 - 8);
    const sy = (si) => y0 + fbH - 6 - si * 13;   // string 0 (lowest pitch) at bottom
    c.lineWidth = 1;
    c.strokeStyle = "rgba(255,255,255,0.4)";
    for (let si = 0; si < nStr; si++) { const y = sy(si); c.beginPath(); c.moveTo(nutX, y); c.lineTo(nutX + cell * FRETS, y); c.stroke(); }
    c.fillStyle = getVar("--muted"); c.font = "10px var(--mono)";
    for (let si = 0; si < nStr; si++) c.fillText(midiToName(inst.strings[si]).name, x0 - 2, sy(si) + 3);
    for (let f = 0; f <= FRETS; f++) {
      const x = nutX + f * cell;
      c.strokeStyle = f === 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.22)";
      c.lineWidth = f === 0 ? 3 : 1;
      c.beginPath(); c.moveTo(x, sy(nStr - 1) - 5); c.lineTo(x, sy(0) + 5); c.stroke();
    }
    c.fillStyle = getVar("--muted"); c.font = "9px var(--mono)";
    for (const f of [3, 5, 7, 9, 12]) c.fillText(String(f + capo), nutX + (f - 0.5) * cell - 3, sy(0) + 14);
    const col = now ? getVar("--accent") : "rgba(255,255,255,0.75)";
    for (const pos of cur.frets) {
      if (!pos) continue;                        // note unreachable on this instrument
      const y = sy(pos.string);
      if (pos.fret === 0) {                      // open string: ring left of the nut
        c.strokeStyle = col; c.lineWidth = 2;
        c.beginPath(); c.arc(nutX - 9, y, 4, 0, 7); c.stroke();
      } else {
        const x = nutX + (pos.fret - 0.5) * cell;
        c.fillStyle = col; c.beginPath(); c.arc(x, y, 6.5, 0, 7); c.fill();
        const lbl = String(pos.fret + capo);
        c.fillStyle = "rgba(0,0,0,0.85)"; c.font = "bold 9px var(--mono)";
        c.fillText(lbl, x - lbl.length * 2.5, y + 3);
      }
    }
  }

  // harmonica strip: which hole to play and whether to blow (↑) or draw (↓)
  function drawHoles(t) {
    const cur = notes.find((n) => n.holes && t <= n.time + n.dur);
    if (!cur) return;
    const now = t >= cur.time - 0.05;
    const cell = 28, x0 = 22, fbW = 10 * cell + 4, fbH = 56;
    const y0 = H - fbH - 44;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(x0 - 10, y0 - 24, fbW + 20, fbH + 34, 10); c.fill();
    const played = cur.holes.filter(Boolean);
    const label = played.length
      ? played.map((p) => `hole ${p.hole} ${p.draw ? "draw ↓" : "blow ↑"}`).join(" · ")
      : "not on a C harp";
    c.fillStyle = now ? getVar("--accent") : getVar("--muted");
    c.font = "bold 12px var(--font)";
    c.fillText((now ? "Now: " : "Next: ") + describeMidiSet(cur.midi) + " — " + label, x0, y0 - 8);
    const col = now ? getVar("--accent") : "rgba(255,255,255,0.75)";
    for (let i = 0; i < 10; i++) {
      const x = x0 + i * cell;
      const p = played.find((h) => h.hole === i + 1);
      roundRect(x, y0, cell - 5, 34, 5);
      if (p) { c.fillStyle = col; c.fill(); }
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1; c.stroke();
      c.fillStyle = p ? "rgba(0,0,0,0.85)" : getVar("--muted");
      c.font = "bold 11px var(--mono)";
      const num = String(i + 1);
      c.fillText(num, x + (cell - 5) / 2 - num.length * 3, y0 + 21);
      if (p) {
        c.fillStyle = col; c.font = "bold 14px var(--font)";
        c.fillText(p.draw ? "↓" : "↑", x + (cell - 5) / 2 - 4, y0 + 52);
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // lyrics — word-by-word karaoke fill when enabled, else simple current/next
  function updateLyric(t) {
    if (!lyrics.length) { lyric.innerHTML = ""; return; }
    if (karaokeLyrics && lyricTimeline) {
      const a = activeAt(lyricTimeline, t);
      const lines = lyricTimeline.lines;
      const cur = a.lineIdx >= 0 ? lineFillHTML(lines[a.lineIdx], a.wordIdx, a.wordProgress) : "";
      const nIdx = a.lineIdx >= 0 ? a.lineIdx + 1 : 0;
      const next = lines[nIdx] ? esc(lines[nIdx].text) : "";
      lyric.innerHTML =
        `<div style="font-size:26px;line-height:1.2;font-weight:700">${cur}</div>` +
        (next ? `<div style="font-size:15px;opacity:.55;margin-top:2px">${next}</div>` : "");
      return;
    }
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) { if (t >= lyrics[i].time) idx = i; else break; }
    const cur = idx >= 0 ? lyrics[idx].text : "";
    const next = lyrics[idx + 1] ? lyrics[idx + 1].text : "";
    lyric.innerHTML =
      `<div style="font-size:26px;line-height:1.2">${esc(cur)}</div>` +
      (next ? `<div style="font-size:15px;opacity:.55;margin-top:2px">${esc(next)}</div>` : "");
  }

  function updateHud() {
    const acc = accuracy();
    scoreBox.innerHTML = scoreHTML(score, Math.round(health), streak, mult, acc, failed);
    healthWrap.firstChild.style.width = health + "%";
    document.getElementById("health-mini")?.classList.remove("hidden");
    const mini = document.getElementById("health-mini");
    if (mini) mini.style.setProperty("--h", health + "%");
  }
  function accuracy() {
    const total = counts.perfect + counts.good + counts.off + counts.miss;
    if (!total) return 100;
    return Math.round(((counts.perfect + counts.good * 0.6) / total) * 100);
  }

  function finish() {
    finished = true; playing = false; player.pause(); band.silence();
    playBtn.textContent = "⟲ Play again";
    const acc = accuracy();
    const passed = !failed && acc >= 60;
    const grade = gradeLetter(acc, failed);
    const entry = {
      ts: Date.now(), songId: song.id, songTitle: song.title, instrument: playInst,
      score, accuracy: acc, maxStreak, passed, durationSec: Math.round(duration),
      notes: { ...counts },
    };
    Store.addHistory(entry);
    showBanner(grade, acc, passed, entry.coins || 0);
  }

  function showBanner(grade, acc, passed, coinsEarned) {
    banner.innerHTML = "";
    banner.appendChild(el("div.panel", {}, [
      el("div.big-grade", { text: grade, style: { color: passed ? getVar("--good") : getVar("--bad") } }),
      el("h2", { text: passed ? "Song complete — passed!" : (failed ? "Finished (failed — healthbar emptied)" : "Finished") }),
      coinsEarned ? el("div", { style: { fontSize: "16px", fontWeight: "700", color: "var(--warn)", margin: "2px 0 6px" },
        html: `🪙 +${coinsEarned} coins earned · <span class="muted" style="font-weight:400">spend them in the Locker</span>` }) : null,
      el("div.grid.cards", { style: { margin: "14px 0" } }, [
        miniStat(acc + "%", "Accuracy"), miniStat(score, "Score"), miniStat(maxStreak, "Best streak"),
        miniStat(counts.perfect, "Perfect"), miniStat(counts.miss, "Missed"),
      ]),
      el("div.row", { style: { justifyContent: "center" } }, [
        el("button.btn.primary", { onclick: restart }, ["⟲ Play again"]),
        el("button.btn", { onclick: () => navigate("#/library") }, ["← Songs"]),
        el("button.btn", { onclick: () => navigate("#/history") }, ["📈 Progress"]),
        coinsEarned ? el("button.btn", { onclick: () => navigate("#/locker") }, ["🎨 Locker"]) : null,
      ]),
    ]));
    banner.classList.remove("hidden");
  }

  // space bar = play/pause (hands rarely leave the guitar mid-song otherwise)
  const onKey = (e) => {
    if (e.code === "Space" && !e.target.closest("input,select,textarea,button")) { e.preventDefault(); togglePlay(); }
  };
  window.addEventListener("keydown", onKey);

  // initial paint
  render(-LEAD_IN); updateHud();

  // cleanup
  return () => {
    playing = false; ro.disconnect(); player.stop(); band.stop(); Audio.stopMic();
    window.removeEventListener("keydown", onKey);
    document.getElementById("health-mini")?.classList.add("hidden");
  };
}

// ---------- helpers ----------
function wrapNarrow(node) { node.style.minWidth = "150px"; return node; }
function miniStat(num, label) {
  return el("div.stat", {}, [el("div.num", { text: String(num) }), el("div.lbl", { text: label })]);
}
function scoreHTML(score, health, streak, mult, acc = 100, failed = false) {
  return `<div style="font-size:22px;font-weight:800">${score.toLocaleString()}</div>
    <div class="muted" style="font-size:12px">${acc}% · streak ${streak} · ×${mult}${failed ? ' · <span style="color:var(--bad)">FAILED</span>' : ""}</div>`;
}
function gradeLetter(acc, failed) {
  if (failed) return "F";
  if (acc >= 97) return "S";
  if (acc >= 92) return "A";
  if (acc >= 82) return "B";
  if (acc >= 70) return "C";
  if (acc >= 60) return "D";
  return "F";
}
function shade(hex, amt) {
  hex = (hex || "#6ea8fe").trim();
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + amt))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))));
  return `rgb(${r},${g},${b})`;
}
