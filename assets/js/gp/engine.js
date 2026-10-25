// AudioContext + microphone capture + device enumeration/selection.
// A single shared analyser feeds pitch detection (tuner, play, listen).
import { Store } from "./state.js";

let ctx = null;
let micStream = null;
let micSource = null;
let analyser = null;
let micDeviceLabel = "";
const changeListeners = new Set();

function notify() { changeListeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); }

export const Audio = {
  ctx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  },
  async resume() { const c = this.ctx(); if (c.state === "suspended") await c.resume(); return c; },

  onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },

  micLive() { return !!micStream; },
  analyser() { return analyser; },

  currentDevices() {
    const outId = Store.settings().outputDeviceId;
    return {
      input: micStream ? (micDeviceLabel || "Microphone") : "",
      output: outId ? (this._outLabel(outId) || "Selected output") : "System default",
      micLive: !!micStream,
    };
  },
  _devCache: { inputs: [], outputs: [] },
  _outLabel(id) { return (this._devCache.outputs.find((d) => d.deviceId === id) || {}).label; },

  async listDevices() {
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); }
    catch (e) { console.warn("enumerateDevices failed", e); }
    const inputs = devices.filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));
    const outputs = devices.filter((d) => d.kind === "audiooutput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "Speaker" }));
    this._devCache = { inputs, outputs };
    return { inputs, outputs };
  },

  async startMic(deviceId) {
    await this.resume();
    deviceId = deviceId || Store.settings().inputDeviceId || undefined;
    this.stopMic();
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = micStream.getAudioTracks()[0];
    micDeviceLabel = track ? track.label : "Microphone";
    micSource = this.ctx().createMediaStreamSource(micStream);
    analyser = this.ctx().createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    micSource.connect(analyser);
    // refresh labels now that permission is granted
    await this.listDevices();
    notify();
    return analyser;
  },

  stopMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (micSource) try { micSource.disconnect(); } catch {}
    micStream = null; micSource = null; analyser = null; micDeviceLabel = "";
    notify();
  },

  setOutputDevice(id) {
    Store.setSetting("outputDeviceId", id);
    notify();
  },

  /** Apply chosen output device to an <audio>/<video> element (where supported). */
  async applySink(mediaEl) {
    const id = Store.settings().outputDeviceId;
    if (id && typeof mediaEl.setSinkId === "function") {
      try { await mediaEl.setSinkId(id); } catch (e) { console.warn("setSinkId failed", e); }
    }
  },

  /** Read current time-domain buffer (Float32) for analysis. */
  readTimeDomain(buf) {
    if (!analyser) return false;
    analyser.getFloatTimeDomainData(buf);
    return true;
  },
};
