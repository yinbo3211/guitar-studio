import { el, slider, toast, fmtTime, getVar } from "./components.js";
import { Store } from "./state.js";
import { Audio } from "./engine.js";
import { detectPitch, PitchTracker } from "./pitch.js";
import { Synth } from "./synth.js";
import { TrackPlayer } from "./player.js";
import { Band } from "./band.js";
import { findSong, isOmrDegraded, displayTitle } from "./catalog.js";
import { songById } from "../data/songlist-data.js";
import { songDuration, pickPart, pickPromptNote } from "./song-format.js";
import { autoAccompaniment } from "./accompany.js";
import { freqToMidiFloat, midiToName, midiToFret, solveVoicing, midiToHole, INSTRUMENTS } from "./notes.js";
import { suggestCapo, describeMidiSet, keyToPc, detectKey, prefersFlat } from "./theory.js";
import { drawBackground } from "./backgrounds.js";
import { renderAvatar } from "./avatar.js";
/* V4.2.5 P1-01：行级时间轴保留并继续消费 —— activeAt() 是「当前行」的唯一口径。
   词级渲染（karaoke-render.js 的逐字填色函数）已退役，不再 import，
   见下方 updateLyric 注释。 */
import { buildLyricTimeline, activeAt } from "./karaoke-timeline.js";
import { escapeHTML as esc } from "./karaoke-render.js";
import { chordName } from "./theory.js";
import { GRADE_DEFAULTS, comboMult, gradeLetter as gradeLetterOf } from "./grader.js";

const LEAD_IN = 3.0;          // count-in seconds before notes start
const HIT_PAD = 0.16;         // detection window pad around a note
/* N-1/N-2：判定阈值收敛到 grader.js 的 GRADE_DEFAULTS（单点定义）。
   OFF_CENTS 是「观察窗口」上界（不是 lax-zeroes 判定阈值），半音外的输入仍判 miss。
   禁止在此处再写魔数，改判定口径请改 grader.js。 */
const PERFECT_CENTS = GRADE_DEFAULTS.perfectCents;   // 28
const GOOD_CENTS = GRADE_DEFAULTS.goodCents;         // 60
const OFF_CENTS = GRADE_DEFAULTS.observeCents;       // 100

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
  /* V4.2.3：曲库 key/capo 多为占位值。显式 capo 优先，否则先从真实音符检调，
     最后才回退到曲目 key；keySource 记录本次推断路径，便于后续审计。 */
  const explicitCapo = Number.isFinite(song.capo) && song.capo > 0 ? Math.floor(song.capo) : 0;
  const detectedKey = detectKey(lead.notes);
  const metadataKeyPc = keyToPc(song.key);
  let keyPc = 0;
  let capo = explicitCapo;
  if (explicitCapo > 0) {
    keyPc = detectedKey ? detectedKey.pc : (metadataKeyPc ?? 0);
    song.keySource = "capo";
  } else if (detectedKey) {
    keyPc = detectedKey.pc;
    capo = suggestCapo(keyPc).capo;
    song.keySource = "detected";
  } else if (metadataKeyPc != null) {
    keyPc = metadataKeyPc;
    capo = suggestCapo(keyPc).capo;
    song.keySource = "metadata";
  } else {
    capo = 0;
    song.keySource = "fallback";
  }
  const useFlat = prefersFlat(keyPc);
  const inst = INSTRUMENTS[playInst] || INSTRUMENTS["acoustic-guitar"];
  const fretted = inst.kind === "fretted";
  const harp = playInst === "harmonica";   // hole panel is harmonica-specific, not all winds
  const percussion = inst.kind === "percussion";  // unpitched: graded on hit timing, not pitch
  // with a capo, fingering is relative to the capo; midiToFret sees shifted open strings
  const capoStrings = fretted ? inst.strings.map((v) => v + capo) : null;

  // ----- lyrics / karaoke overlay -----
  const lyrics = (song.lyrics || []).slice().sort((a, b) => a.time - b.time);
  /* V4.2.5 P1-01：歌词改为单行。行级时间轴（buildLyricTimeline/activeAt）保留并继续
     消费 —— 它仍然是「当前行定位」的唯一口径，被产品决策退役的只是**词级渲染**
     （karaoke-render.js 的逐字填色：逐字 span 填色 + 下一行弱化预览）。
     ⚠️ 这不是 N-5 的回退：N-5 的 tokenizeLine/allocate 与其 KT-1/2/3/4/5/7 全部保留，
        本文件仍在用 activeAt() 定位当前行。这是产品取舍，不是 bug 修复的反复。 */
  const lyricTimeline = lyrics.length ? buildLyricTimeline(song) : null;

  // ----- per-note runtime state -----
  const chordOptions = { keyPc, useFlat };
  const notes = lead.notes.map((n) => {
    const promptName = describeMidiSet(n.midi, chordOptions);
    return {
      time: n.time, dur: n.dur || 0.4, midi: n.midi, chord: n.chord || n.midi.length > 1,
      /* 和弦名与指法只在建谱时计算一次，渲染帧直接读取缓存。 */
      label: n.chord || n.midi.length > 1 ? promptName : "",
      promptName,
      state: "pending", best: 999, frames: 0,
      frets: fretted
        ? (n.midi.length >= 2
            ? solveVoicing(n.midi, playInst, capo)
            : n.midi.map((m) => midiToFret(m, playInst, capoStrings)))
        : null,
      holes: harp ? n.midi.map(midiToHole) : null,
    };
  });
  notes.sort((a, b) => a.time - b.time);
  const fretPromptNotes = notes.filter((n) => n.frets);
  const holePromptNotes = notes.filter((n) => n.holes);

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
  ]);
  const healthWrap = el("div.healthbar-big", {}, [el("i", { style: { width: "100%" } })]);
  const killfeed = el("div.killfeed");
  const lyric = el("div.lyric-line");
  const banner = el("div.banner.hidden");
  /* N-3 消费端：当前小节和弦（读 song.harmony.barChords，按当前小节下标取）。
     ⚠️ R-2 诚实标注：231 首 def.key 全是占位 'C'，harmonized-melody 的和弦是按
        假设调性推算出来的，不是真实编配 —— 故：
          source === 'derived-omr'        → 直接显示（有真实音簇证据）
          source === 'harmonized-melody'  → 加括号标记推算值，如 (G)
        绝不允许无标记显示成原曲和弦。标记用括号而非文案 → 零 i18n key。
     同时写 data-harmony-source 供审计与测试读取。 */
  const harmony = (song.harmony && Array.isArray(song.harmony.chords) && song.harmony.chords.length)
    ? song.harmony : null;
  /* V4.2.5 P2-02：和弦行随歌词一起迁出画布，进入独立歌词栏（.gp-lyric-bar）左侧槽位，
     不再绝对定位压在指板面板上。配色从 --accent 改为 --text：
     浅色主题（dawn）下 --accent=#2f6fd0 落在 --bg-2 上对比仅约 4.26（<4.5），
     而 --text 在七套主题下实测 13.2~16.7，靠 font-weight:800 区分层级。 */
  const barChordEl = el("div.gp-bar-chord", {
    style: {
      flex: "none", fontSize: "16px", fontWeight: "800",
      color: "var(--text)", opacity: ".92",
      letterSpacing: ".5px", pointerEvents: "none",
    },
  });
  if (harmony) barChordEl.setAttribute("data-harmony-source", harmony.source);

  const avatarBadge = el("div.play-avatar", { html: renderAvatar() });
  const hud = el("div.play-hud", {}, [
    el("div.row", { style: { gap: "10px", alignItems: "flex-start" } }, [avatarBadge, songBox]),
    el("div.col", { style: { alignItems: "flex-end", gap: "8px" } }, [scoreBox, healthWrap]),
  ]);
  /* P2-02：歌词与和弦行移出 overlay（原先 absolute 定位在画布内，与左下指板面板
     恒重叠 17px）；overlay 只留 HUD / 判定流水 / 底部渐变 / 结算横幅。 */
  overlay.append(hud, killfeed, el("div.play-bottom-fade"), banner);

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
  /* V4.2.5 P1-03：单音提示音退役，改为「和弦提示音」——复用宿主 AudioEngine.strum 的
     拨弦音色（与和弦库「听扫弦」同源，assets/js/modules/chord-lib.js）。
     设置迁移：新键 chordHint 优先，旧键 noteSounds 只作为一次性的值来源被读取，
     之后只写 chordHint（旧键保留在 GP_DEFAULTS 里不再写入，避免老用户设置丢失）。
     覆盖缺口（Q-1 拍板 = 隐藏）：236 首中有 6 首（gp-song-001 + 5 首 pd-* 旋律）全部
     是单音、没有任何 ≥2 音音符，提示音必然不响 —— 这些曲子**不渲染按钮**，
     不给「亮着却不响」的假承诺。 */
  const hasChordNotes = notes.some((n) => n.midi.length > 1);
  let chordHint = hasChordNotes && (s.chordHint ?? s.noteSounds ?? true);
  const chordBtn = hasChordNotes ? el("button.btn", { class: chordHint ? "primary" : "", title: T("play.hint.chordHint"), onclick: () => {
    chordHint = !chordHint; Store.setSetting("chordHint", chordHint);
    chordBtn.classList.toggle("primary", chordHint);
  } }, [T("play.chordHint")]) : null;
  let showFrets = fretted || harp ? (s.showFingering ?? true) : false;
  const fretBtn = fretted || harp ? el("button.btn", { class: showFrets ? "primary" : "", title: harp ? T("play.hint.harmonica") : T("play.hint.fretboard"), onclick: () => {
    showFrets = !showFrets; Store.setSetting("showFingering", showFrets);
    fretBtn.classList.toggle("primary", showFrets);
    if (!playing) render(clock);
  } }, [harp ? T("play.holes") : T("play.frets")]) : null;

  const practiceInfo = chartDetails(song.id, chartKind, {
    partName: parts.length > 1 ? inst.name : "",
    genre: song.genre || "",
    hasLyrics: Boolean(song.lyrics && song.lyrics.length),
  });
  const controls = el("div.play-controls", {}, [
    playBtn, restartBtn,
    el("div.muted", { style: { minWidth: "70px" }, id: "play-clock", text: "0:00" }),
    practiceInfo,
    el("div", { style: { flex: "1" } }),
    (!player.hasAudio() && band.empty) ? el("span.muted", { style: { fontSize: "12px" }, text: T("play.noBacking") }) : null,
    (player.backing || !band.empty) ? wrapNarrow(volB) : null,
    player.vocal ? wrapNarrow(volV) : null,
    chordBtn, bandBtn, fretBtn, metroBtn, backBtn,
  ]);

  /* P2-02：歌词栏是 .play-shell 的第二个子节点（画布与歌词、控制区三者分层），
     teardown 仍只 removeChild(shell) → RE-1/RE-2 重入语义不变。 */
  const lyricBar = el("div.gp-lyric-bar", {}, [barChordEl, lyric]);
  shell.append(el("div.play-stage", {}, [canvas, overlay]), lyricBar, controls);
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
      /* V4.2.5 P1-03：只有和弦音（≥2 音）才提示，单音不再发声（产品决策）。
         clock - n.time < 0.3 的守卫保留：音频同步跳转后的积压不补发。 */
      if (chordHint && n.midi.length > 1 && clock - n.time < 0.3) {
        strumChord(n.midi, chordVol());
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
  /* 分支语义差异（有意保留，勿对齐）：
     · 打击乐：onset 落在窗口内即计帧，n.best 单位=秒，用 0.07/0.15 分级；
     · 旋律  ：需 bestCents < OFF_CENTS 才计帧，n.best 单位=cents，用 28/60 分级。
     两者量纲不同，阈值不可互换；旋律若照抄「无条件计帧」，任何环境噪声都会
     把 miss 抬成 off，等于变相削弱 miss 惩罚。 */
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
        /* N-2：同 N-1，观察窗口放宽到 1 个半音，off 才可达（半音外仍算 miss） */
        if (bestCents < OFF_CENTS) { n.frames++; if (bestCents < n.best) n.best = bestCents; }
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
    mult = comboMult(streak);
    if (health <= 0 && !failed) { failed = true; toast(T("play.healthEmpty"), "bad"); }
    pushKill(q, n);
  }
  function pushKill(q, n) {
    const label = n.promptName;
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
    c.strokeStyle = getVar("--highway-line"); c.lineWidth = 1; c.font = "10px var(--mono)"; c.fillStyle = getVar("--gp-canvas-muted");
    for (let m = Math.ceil(loM / 12) * 12; m <= hiM; m += 12) {
      const y = yFor(m); c.globalAlpha = 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      c.globalAlpha = 1; c.fillText(midiToName(m).full, 4, y - 3);
    }

    // hit line
    c.globalAlpha = 1;
    const grd = c.createLinearGradient(hitX - 30, 0, hitX + 30, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)"); grd.addColorStop(0.5, getVar("--gp-canvas-accent")); grd.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = grd; c.fillRect(hitX - 30, 0, 60, H);
    c.strokeStyle = getVar("--gp-canvas-accent"); c.lineWidth = 2; c.beginPath(); c.moveTo(hitX, 0); c.lineTo(hitX, H); c.stroke();

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
      c.fillStyle = getVar("--gp-canvas-accent-2");
      c.beginPath(); c.arc(hitX, y, 7, 0, 7); c.fill();
      c.globalAlpha = 0.3; c.fillRect(0, y - 1.5, hitX, 3); c.globalAlpha = 1;
    }

    // fingering hint: fretboard dots or harmonica holes
    if (showFrets) (harp ? drawHoles : drawFretboard)(t);

    // count-in
    if (t < 0) {
      const n = Math.ceil(-t);
      c.fillStyle = getVar("--gp-canvas-text"); c.font = "bold 120px var(--font)"; c.textAlign = "center";
      c.globalAlpha = (1 - (Math.abs(t) % 1)) * 0.9 + 0.1;
      c.fillText(String(n), W / 2, H / 2 + 40); c.globalAlpha = 1; c.textAlign = "start";
    }

    // lyrics
    updateLyric(t);
    /* N-3：当前小节和弦 */
    updateBarChord(t);
  }

  function drawNote(x, y, w, state, midi, chord, label) {
    const h = 26;
    const colors = { pending: getVar("--gp-canvas-accent"), played: getVar("--gp-canvas-muted"), perfect: getVar("--j-perfect"),
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
    const hit = pickPromptNote(fretPromptNotes, t, beatLen);
    if (!hit) return;
    const cur = hit.note;
    const now = hit.now;
    const nStr = inst.strings.length;
    const FRETS = 12;
    const unreachable = cur.frets.reduce(
      (count, pos) => count + (!pos || pos.fret < 0 || pos.fret > FRETS ? 1 : 0), 0);
    const fbW = Math.min(340, W * 0.42), fbH = 6 + nStr * 13;
    const x0 = 22, y0 = H - fbH - 44;
    const nutX = x0 + 22, cell = (fbW - 30) / FRETS;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(x0 - 10, y0 - 24, fbW + 20, fbH + 44, 10); c.fill();
    c.fillStyle = now ? getVar("--gp-canvas-accent") : getVar("--gp-canvas-muted");
    c.font = "bold 12px var(--font)";
    const unreachableText = unreachable > 0 ? " · " + TF("play.prompt.unreachable", { n: unreachable }) : "";
    c.fillText((now ? T("play.now") : T("play.next")) + cur.promptName
      + (capo ? " · " + TF("play.capoShort", { fret: capo }) : "") + unreachableText, x0, y0 - 8);
    const sy = (si) => y0 + fbH - 6 - si * 13;   // string 0 (lowest pitch) at bottom
    c.lineWidth = 1;
    c.strokeStyle = "rgba(255,255,255,0.4)";
    for (let si = 0; si < nStr; si++) { const y = sy(si); c.beginPath(); c.moveTo(nutX, y); c.lineTo(nutX + cell * FRETS, y); c.stroke(); }
    c.fillStyle = getVar("--gp-canvas-muted"); c.font = "10px var(--mono)";
    for (let si = 0; si < nStr; si++) c.fillText(midiToName(inst.strings[si]).name, x0 - 2, sy(si) + 3);
    for (let f = 0; f <= FRETS; f++) {
      const x = nutX + f * cell;
      c.strokeStyle = f === 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.22)";
      c.lineWidth = f === 0 ? 3 : 1;
      c.beginPath(); c.moveTo(x, sy(nStr - 1) - 5); c.lineTo(x, sy(0) + 5); c.stroke();
    }
    c.fillStyle = getVar("--gp-canvas-muted"); c.font = "9px var(--mono)";
    for (const f of [3, 5, 7, 9, 12]) c.fillText(String(f + capo), nutX + (f - 0.5) * cell - 3, sy(0) + 14);
    const col = now ? getVar("--gp-canvas-accent") : "rgba(255,255,255,0.75)";
    for (const pos of cur.frets) {
      if (!pos || pos.fret < 0 || pos.fret > FRETS) continue;
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
    const hit = pickPromptNote(holePromptNotes, t, beatLen);
    if (!hit) return;
    const cur = hit.note;
    const now = hit.now;
    const cell = 28, x0 = 22, fbW = 10 * cell + 4, fbH = 56;
    const y0 = H - fbH - 44;
    c.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(x0 - 10, y0 - 24, fbW + 20, fbH + 34, 10); c.fill();
    const played = cur.holes.filter(Boolean);
    const label = played.length
      ? played.map((p) => TF("play.harmonica.hole", { hole: p.hole, dir: p.draw ? T("play.harmonica.draw") : T("play.harmonica.blow") })).join(" · ")
      : T("play.harmonica.na");
    c.fillStyle = now ? getVar("--gp-canvas-accent") : getVar("--gp-canvas-muted");
    c.font = "bold 12px var(--font)";
    c.fillText((now ? T("play.now") : T("play.next")) + cur.promptName + " — " + label, x0, y0 - 8);
    const col = now ? getVar("--gp-canvas-accent") : "rgba(255,255,255,0.75)";
    for (let i = 0; i < 10; i++) {
      const x = x0 + i * cell;
      const p = played.find((h) => h.hole === i + 1);
      roundRect(x, y0, cell - 5, 34, 5);
      if (p) { c.fillStyle = col; c.fill(); }
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1; c.stroke();
      c.fillStyle = p ? "rgba(0,0,0,0.85)" : getVar("--gp-canvas-muted");
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

  /**
   * 歌词渲染（V4.2.5 P1-01）：**单行**、只显示当前行。
   *
   * ⚠️ 这不是 N-5 的回退 —— 行级时间轴仍由 activeAt() 消费（见上方 lyrics 段注释），
   *    产品决策是「不再消费词级渲染」（逐字 span 填色 + 下一行弱化预览），
   *    不是「不再切词」。tokenizeLine/allocate 及其 KT-1/2/3/4/5/7 全部保留。
   *
   * 用 textContent 而非 innerHTML：单行纯文本天然免疫 XSS，
   * 也省掉每帧的 HTML 解析与节点重建（歌词栏只有 1 个文本节点）。
   * @param {number} t 当前演奏时刻（秒）
   */
  function updateLyric(t) {
    /* BUG-15：无歌词曲目不再静默空白，显式提示「暂无歌词」（只渲染一次） */
    if (!lyrics.length) {
      if (!lyric.dataset.noLyrics) {
        lyric.dataset.noLyrics = "1";
        lyric.textContent = T("play.noLyrics");
      }
      return;
    }
    let text = "";
    if (lyricTimeline) {
      const a = activeAt(lyricTimeline, t);
      const line = a.lineIdx >= 0 ? lyricTimeline.lines[a.lineIdx] : null;
      if (line) text = line.text || "";
    }
    /* 无时间轴 / 时间轴未命中（如前奏段）：退回 lyrics 线性扫描 */
    if (!text) {
      let idx = -1;
      for (let i = 0; i < lyrics.length; i++) { if (t >= lyrics[i].time) idx = i; else break; }
      text = idx >= 0 ? (lyrics[idx].text || "") : "";
    }
    if (lyric._last === text) return;            // 同文本不重排（省每帧 reflow）
    lyric._last = text;
    lyric.textContent = text;
  }

  /**
   * N-3 消费端：把当前小节的和弦名写到 overlay 左上角提示区。
   * barChords 长度恒 === bars（chords 是去重后的进行，按下标取会错拍）。
   * @param {number} t 当前演奏时刻（秒）
   */
  function updateBarChord(t) {
    if (!harmony) return;
    const bars = harmony.barChords && harmony.barChords.length
      ? harmony.barChords : harmony.chords;
    const secPerBar = beatLen * (harmony.beatsPerBar || 4);
    const idx = secPerBar > 0 ? Math.max(0, Math.floor(Math.max(0, t) / secPerBar)) : 0;
    const cur = bars[idx % bars.length];
    if (!cur) { barChordEl.textContent = ""; return; }
    const name = chordName(cur[0], cur[1], { keyPc, useFlat });
    /* 推算和弦加括号，避免与识别得出的真实和弦混淆（见上方 R-2 说明） */
    barChordEl.textContent = `${T("play.now")} ${harmony.source === "harmonized-melody" ? `(${name})` : name}`;
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
    if (shell.parentNode) shell.parentNode.removeChild(shell);
  };
}

/* ---------- V4.2.5 P1-03 和弦提示音 ----------
   与和弦库「听扫弦」同源（assets/js/core/audio-engine.js 的 AudioEngine.strum）。
   AudioEngine 是宿主挂到 window 的全局对象，此处只做惰性查找：
     · 浏览器：走真实扫弦，与和弦库同音色、共享 master 总线；
     · Node 单测（test/_gp-dom.mjs 没有 AudioContext，也没有 AudioEngine）：
       显式降级为静默并返回 false，绝不让演奏视图在无音频环境抛错；
     · 测试可注入 window.AudioEngine = { strum: spy } 断言发声，产品代码无测试分支。 */

/** MIDI → 频率（升序）。A4=69 → 440Hz。 */
export function chordHintFreqs(midis) {
  return Array.isArray(midis) ? midis.map((m) => 440 * Math.pow(2, (m - 69) / 12)).sort((a, b) => a - b) : [];
}

/** 与伴奏音量滑杆联动：backingVolume 0→1 映射为 0.12~0.30（默认 0.7 → 0.22）。
    区间落在和弦库 chord-lib.js 的 .22~.30 内，不新增滑杆（否则与控制区紧凑化冲突）。 */
export function chordVol() {
  const v = Store.settings().backingVolume ?? 0.7;
  return Math.max(0.12, Math.min(0.30, 0.22 * (v / 0.7)));
}

/** 触发一次吉他扫弦；无 AudioEngine / 非和弦时静默降级返回 false。 */
export function strumChord(midis, vol) {
  const AE = (typeof window !== "undefined" && window.AudioEngine) || null;
  if (!AE || typeof AE.strum !== "function") return false;
  const freqs = chordHintFreqs(midis);
  if (freqs.length < 2) return false;
  AE.strum(freqs, "down", vol);
  return true;
}

// ---------- helpers ----------
function wrapNarrow(node) { node.style.minWidth = "150px"; return node; }

/** 谱面来源徽章。HUD 中只保留单行来源，避免遮挡画布上的演奏提示。 */
function chartBadge(songId, chartKind) {
  const key = chartKind === "omr" ? "play.badge.omr"
    : chartKind === "melody" ? "play.badge.melody"
      : "play.badge.generated";
  const extra = (chartKind === "generated-chords" && isOmrDegraded(songId)) ? T("play.badge.incomplete") : "";
  return el("div", { style: { fontSize: "12px", marginTop: "2px", whiteSpace: "nowrap" } }, [
    el("span.capo-note", { style: { padding: "2px 8px" }, text: T(key) + (extra ? " " + extra : "") }),
  ]);
}

/** 次要练习信息放进控制栏，避免扩张左上 HUD。 */
function chartDetails(songId, chartKind, { partName = "", genre = "", hasLyrics = false } = {}) {
  const row = el("div.muted", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" } });
  if (partName) row.appendChild(el("span", { text: TF("play.yourPart", { inst: partName }) }));
  if (hasLyrics) row.appendChild(el("span", { text: TF("play.part.singalong", { genre }) }));
  else if (genre) row.appendChild(el("span", { text: genre }));
  if (chartKind === "generated-chords") {
    row.appendChild(el("span", { text: T("play.singalongNotice") }));
    const sheet = externalSheet(songId);
    if (sheet) {
      row.appendChild(el("a.play-link", {
        href: sheet,
        target: "_blank",
        rel: "noopener noreferrer",
        text: T("play.sheetLink"),
      }));
    }
  }
  return row.children.length ? row : null;
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
/* N-1：与 grader.js 的 gradeLetter 曾逐字节重复 → 统一为单一实现 */
const gradeLetter = gradeLetterOf;
function shade(hex, amt) {
  hex = (hex || "#6ea8fe").trim();
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + amt))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))));
  return `rgb(${r},${g},${b})`;
}
