import { el, slider, toast, fmtTime, getVar } from "./components.js";
import { Store } from "./state.js";
import { Audio } from "./engine.js";
import { detectPitch, PitchTracker } from "./pitch.js";
import { Synth } from "./synth.js";
import { TrackPlayer } from "./player.js";
import { Band } from "./band.js";
import { findSong, isOmrDegraded, displayTitle } from "./catalog.js";
import { songById } from "../data/songlist-data.js";
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

/* ---------- i18n 取词（BUG-03） ----------
   宿主只全局暴露了 window.t-core/i18n.js），带参替换由各模块本地实现。
   无 window / 无 t 时回退为返回 key 本身，保证 Node 单测可直接跑。 */
function T(k) {
  try {
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(k);
    if (typeof t === 'function') return t(k);
  } catch (e) { /* 无 i18n 环境用 key 兜底 */ }
  return k;
}
/** 占位符替换：{n}/{id}/{bpm}/{key}… 一律走这里，禁止拼进模板 */
function TF(k, pairs) {
  let s = T(k);
  for (const a of Object.keys(pairs || {})) s = s.split('{' + a + '}').join(String(pairs[a]));
  return s;
}

export default async function play(ctx) {
  const { el: root, params, navigate } = ctx;
  const song = findSong(params[0]);
  if (!song) {
    root.appendChild(el("div.panel", { style: { margin: "22px" } }, [
      el("h2", { text: T("play.notFound.title") }),
      el("button.btn", { onclick: () => navigate("#/library") }, [T("play.backToSongs")]),
    ]));
    return;
  }
  /* BUG-02 Step A：占位/退化谱不得参与音准评分，也不扣血，只作跟唱伴奏 */
  const chartKind = song.chartKind || "generated-chords";
  const singalongOnly = chartKind === "generated-chords";
  const s = Store.settings();
  const a4 = s.a4;
  const speed = s.noteSpeed;
  // Which part you play: yours if the arrangement has one, else the song's lead.
  // Everything else in the arrangement becomes the synth band.
  const { parts, index: leadIdx, lead } = pickPart(song, s.instrument);
  const playInst = lead.instrument;
  /* BUG-11：时长统一口径 max(谱面末音, 歌词末行)，卡拉 OK 歌词不被中途截断 */
  const duration = songDuration({ notes: lead.notes, lyrics: song.lyrics });
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
    /* 和弦块在 highway 上显示和弦名（弹唱谱的可读性关键：否则只见色块不知按什么） */
    label: n.chord || n.midi.length > 1 ? describeMidiSet(n.midi) : "",
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
  /* BUG-06：曲名/歌手一律走 textContent，不再用 html: 插值（防范曲名夹带标记） */
  const metaBits = [TF("play.meta", { artist: song.artist || "", key: song.key ?? "C", bpm: song.bpm })];
  if (capo) metaBits.push(TF("play.capo", { fret: capo }));
  const songBox = el("div.hud-box", {}, [
    el("div", {}, [el("b", { text: displayTitle(song) })]),   // BUG-14：同名曲「曲名 · 歌手」消歧
    el("div.muted", { style: { fontSize: "12px" }, text: metaBits.join(" · ") }),
    chartBadge(song.id, chartKind),
    parts.length > 1 ? el("div.muted", { style: { fontSize: "12px", marginTop: "2px" },
      text: TF("play.yourPart", { inst: inst.name }) }) : null,
    (song.lyrics && song.lyrics.length)
      ? el("div.muted", { style: { fontSize: "12px", marginTop: "2px" },
          text: TF("play.part.singalong", { genre: song.genre || "" }) })
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
  const playBtn = el("button.btn.primary", { onclick: togglePlay }, [T("play.start")]);
  const restartBtn = el("button.btn", { onclick: restart }, [T("play.restart")]);
  const backBtn = el("button.btn.ghost", { onclick: () => navigate("#/library") }, [T("play.songs")]);
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
    class: bandOn ? "primary" : "", title: TF("play.band.title", { parts: band.names.join(", ") }),
    onclick: () => {
      bandOn = !bandOn; Store.setSetting("band", bandOn);
      bandBtn.classList.toggle("primary", bandOn);
      if (bandOn) band.seek(Math.max(0, clock)); else band.silence();
    },
  }, [T("play.band")]);

  const volB = slider({ label: T("play.mixer.backing"), value: s.backingVolume, fmt: (v) => Math.round(v * 100) + "%",
    oninput: (v) => { Store.setSetting("backingVolume", v); player.setBackingVolume(v); band.setVolume(v); } });
  const volV = slider({ label: T("play.mixer.vocal"), value: s.vocalVolume, fmt: (v) => Math.round(v * 100) + "%",
    oninput: (v) => { Store.setSetting("vocalVolume", v); player.setVocalVolume(v); } });
  const metroBtn = el("button.btn", { onclick: () => { metro = !metro; metroBtn.classList.toggle("primary", metro); } }, [T("play.metronome")]);
  let metro = false;
  let noteSounds = s.noteSounds ?? true;
  const soundBtn = el("button.btn", { class: noteSounds ? "primary" : "", title: T("play.hint.hitLine"), onclick: () => {
    noteSounds = !noteSounds; Store.setSetting("noteSounds", noteSounds);
    soundBtn.classList.toggle("primary", noteSounds);
  } }, [T("play.notes")]);
  let showFrets = fretted || harp ? (s.showFingering ?? true) : false;
  const fretBtn = fretted || harp ? el("button.btn", { class: showFrets ? "primary" : "", title: harp ? T("play.hint.harmonica") : T("play.hint.fretboard"), onclick: () => {
    showFrets = !showFrets; Store.setSetting("showFingering", showFrets);
    fretBtn.classList.toggle("primary", showFrets);
    if (!playing) render(clock);
  } }, [harp ? T("play.holes") : T("play.frets")]) : null;
  const karaokeBtn = lyrics.length ? el("button.btn", { class: karaokeLyrics ? "primary" : "", title: T("play.hint.karaoke"), onclick: () => {
    karaokeLyrics = !karaokeLyrics; Store.setSetting("karaokeLyrics", karaokeLyrics);
    karaokeBtn.classList.toggle("primary", karaokeLyrics);
    updateLyric(clock);
  } }, [T("play.karaoke")]) : null;

  const controls = el("div.play-controls", {}, [
    playBtn, restartBtn,
    el("div.muted", { style: { minWidth: "70px" }, id: "play-clock", text: "0:00" }),
    el("div", { style: { flex: "1" } }),
    (!player.hasAudio() && band.empty) ? el("span.muted", { style: { fontSize: "12px" }, text: T("play.noBacking") }) : null,
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
  /* 宿主适配：ResizeObserver 的回调在首帧 render() 之后才触发，而给 canvas.width
     赋值会清空画布；非演奏态又不会重绘，结果就是进入页面看到一块全黑的 highway。
     这里在尺寸变化后补一次静态重绘（painted 为 false 时短路，避开 playing/clock
     的 TDZ——它们声明在 resize() 之后）。 */
  let painted = false;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (painted) render(clock);
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
    catch (e) { toast(TF("play.micOff", { err: e && e.message ? e.message : "" }), "bad"); return false; }
  }

  async function togglePlay() {
    if (finished) { restart(); return; }
    if (playing) { pause(); return; }
    await ensureMic();
    await Audio.resume();
    playing = true; started = true;
    playBtn.textContent = T("play.pause");
    if (clock >= 0) player.play(clock);
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }
  function pause() {
    playing = false; playBtn.textContent = T("play.resume");
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
    playBtn.textContent = T("play.start");
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

    /* BUG-02 Step A：占位/识谱不完整的伴奏没有可对照的原曲音高，
       继续判分等于给「假谱」打真分 —— 跟唱模式下不判分、不扣血。 */
    if (!singalongOnly) grade();
    else markSingalong(clock);
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
  /** 跟唱模式：只把已经过去的音符标记为已奏（流水滚动需要状态），不产生判定与扣分 */
  function markSingalong(t) {
    for (const n of notes) {
      if (n.state !== "pending") continue;
      if (t <= n.time + n.dur + HIT_PAD) break;
      n.state = "played";
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
    if (health <= 0 && !failed) { failed = true; toast(T("play.healthEmpty"), "bad"); }
    pushKill(q, n);
  }
  function pushKill(q, n) {
    const label = describeMidiSet(n.midi);
    const killer = el(`div.kill.${q}`, {}, [T(GRADE_KEY[q] || "play.grade.off"), " ", el("span.muted", { text: label })]);
    const k = killer;
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
      n.midi.forEach((midi, mi) => {
        const y = yFor(midi);
        // 同一和弦的多个音只在最上面一块标和弦名，避免重复文字糊成一片
        drawNote(x, y, wRect, n.state, midi, n.chord, mi === n.midi.length - 1 ? n.label : "");
      });
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

  function drawNote(x, y, w, state, midi, chord, label) {
    const h = 26;
    const colors = { pending: getVar("--accent"), played: getVar("--muted"), perfect: getVar("--j-perfect"),
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
    const lbl = label || (chord ? "" : midiToName(midi).name);
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
    c.fillText((now ? T("play.now") : T("play.next")) + describeMidiSet(cur.midi) + (capo ? " · " + TF("play.capoShort", { fret: capo }) : ""), x0, y0 - 8);
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
      ? played.map((p) => TF("play.harmonica.hole", { hole: p.hole, dir: p.draw ? T("play.harmonica.draw") : T("play.harmonica.blow") })).join(" · ")
      : T("play.harmonica.na");
    c.fillStyle = now ? getVar("--accent") : getVar("--muted");
    c.font = "bold 12px var(--font)";
    c.fillText((now ? T("play.now") : T("play.next")) + describeMidiSet(cur.midi) + " — " + label, x0, y0 - 8);
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
    /* BUG-15：无歌词曲目不再静默空白，显式提示「暂无歌词」（只渲染一次） */
    if (!lyrics.length) {
      if (!lyric.dataset.noLyrics) {
        lyric.dataset.noLyrics = "1";
        lyric.innerHTML = `<div style="font-size:14px;opacity:.5">${esc(T("play.noLyrics"))}</div>`;
      }
      return;
    }
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
    scoreBox.innerHTML = scoreHTML(score, Math.round(health), streak, mult, acc, failed, singalongOnly);
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
    playBtn.textContent = T("play.playAgain");
    /* 跟唱模式：占位和弦不是原曲音高，Accuracy/分数没有意义 —— 只记录「完成」 */
    const acc = singalongOnly ? null : accuracy();
    const passed = singalongOnly ? true : (!failed && acc >= 60);
    const grade = singalongOnly ? "" : gradeLetter(acc, failed);
    const entry = {
      ts: Date.now(), songId: song.id, songTitle: displayTitle(song), instrument: playInst,
      score: singalongOnly ? 0 : score, accuracy: singalongOnly ? null : acc,
      maxStreak: singalongOnly ? 0 : maxStreak, passed, durationSec: Math.round(duration),
      notes: { ...counts }, chartKind,
      /* BUG-13 金币规则：每 100 分兑换 1 枚（四舍五入），通过保底 1 枚；
         未通过 0 枚；跟唱模式（占位谱，BUG-10 不评分）不产出金币。 */
      coins: (singalongOnly || !passed) ? 0 : Math.max(1, Math.round((score || 0) / 100)),
    };
    Store.addHistory(entry);
    showBanner(grade, acc, passed, entry.coins || 0);
  }

  function showBanner(grade, acc, passed, coinsEarned) {
    banner.innerHTML = "";
    const stats = singalongOnly
      ? [miniStat(T("play.result.completed"), T("play.result.singalongLabel")),
         miniStat(fmtTime(Math.max(0, Math.round(duration))), T("play.result.duration"))]
      : [
          miniStat(acc + "%", T("play.result.accuracy")), miniStat(score, T("play.result.score")),
          miniStat(maxStreak, T("play.result.bestStreak")),
          miniStat(counts.perfect, T("play.result.perfect")), miniStat(counts.miss, T("play.result.missed")),
        ];
    const title = singalongOnly ? T("play.result.finished")
      : (passed ? T("play.result.passed") : (failed ? T("play.result.failed") : T("play.result.finished")));
    banner.appendChild(el("div.panel", {}, [
      grade ? el("div.big-grade", { text: grade, style: { color: passed ? getVar("--good") : getVar("--bad") } }) : null,
      el("h2", { text: title }),
      coinsEarned ? el("div", { style: { fontSize: "16px", fontWeight: "700", color: "var(--warn)", margin: "2px 0 6px" } }, [
        TF("play.result.coins", { n: coinsEarned }), " ",
        el("span.muted", { style: { fontWeight: "400" }, text: T("play.result.coinsHint") }),
      ]) : null,
      el("div.grid.cards", { style: { margin: "14px 0" } }, stats),
      el("div.row", { style: { justifyContent: "center" } }, [
        el("button.btn.primary", { onclick: restart }, [T("play.playAgain")]),
        el("button.btn", { onclick: () => navigate("#/library") }, [T("play.songs")]),
        el("button.btn", { onclick: () => navigate("#/history") }, [T("play.progress")]),
        coinsEarned ? el("button.btn", { onclick: () => navigate("#/locker") }, [T("play.locker")]) : null,
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
  painted = true;                 // 之后的 resize 才会触发补绘

  // cleanup
  return () => {
    playing = false; ro.disconnect(); player.stop(); band.stop(); Audio.stopMic();
    window.removeEventListener("keydown", onKey);
    document.getElementById("health-mini")?.classList.add("hidden");
  };
}

// ---------- helpers ----------
function wrapNarrow(node) { node.style.minWidth = "150px"; return node; }

/**
 * 谱面来源徽章（BUG-02 Step A）。
 * omr / melody → 真实谱；generated-chords → 明确告知这不是原曲编配，
 * 并在数据里有外链谱时给出原版吉他谱入口，而不是让人以为 highway 就是原谱。
 */
function chartBadge(songId, chartKind) {
  const key = chartKind === "omr" ? "play.badge.omr"
    : chartKind === "melody" ? "play.badge.melody"
      : "play.badge.generated";
  const extra = (chartKind === "generated-chords" && isOmrDegraded(songId)) ? T("play.badge.incomplete") : "";
  const row = el("div", { style: { fontSize: "12px", marginTop: "2px" } }, [
    el("span.capo-note", { style: { padding: "2px 8px" }, text: T(key) + (extra ? " " + extra : "") }),
  ]);
  if (chartKind === "generated-chords") {
    row.appendChild(el("div.muted", { style: { fontSize: "11px", marginTop: "2px" }, text: T("play.singalongNotice") }));
    const sheet = externalSheet(songId);
    if (sheet) {
      row.appendChild(el("a.play-link", { href: sheet, target: "_blank", rel: "noopener noreferrer",
        style: { display: "inline-block", marginTop: "2px", fontSize: "12px" }, text: T("play.sheetLink") }));
    }
  }
  return row;
}

/** 曲库权威数据里的第三方外链谱（曲名/歌手/URL 均来自包内静态数据） */
function externalSheet(songId) {
  try {
    const raw = String(songId || "").replace(/^gp-song-/, "song-");
    const hit = typeof songById === "function" ? songById(raw) : null;
    const list = (hit && Array.isArray(hit.sheets)) ? hit.sheets : [];
    for (const s of list) {
      if (s && typeof s.url === "string" && /^https:\/\//.test(s.url)) return s.url;
    }
  } catch (e) { /* 外链缺失不影响演奏 */ }
  return "";
}
function miniStat(num, label) {
  return el("div.stat", {}, [el("div.num", { text: String(num) }), el("div.lbl", { text: label })]);
}
function scoreHTML(score, health, streak, mult, acc = 100, failed = false, singalong = false) {
  const line = singalong
    ? T("play.hud.singalong")
    : TF("play.hud.line", { acc, streak, mult: String(mult) }) + (failed ? " · " + T("play.failed") : "");
  return `<div style="font-size:22px;font-weight:800">${score.toLocaleString()}</div>
    <div class="muted" style="font-size:12px">${esc(line)}</div>`;
}
/* 判定等级 → i18n key */
const GRADE_KEY = { perfect: "play.grade.perfect", good: "play.grade.good", off: "play.grade.off", miss: "play.grade.miss" };
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
