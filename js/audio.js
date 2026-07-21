/* Artes Mortis Manager — synthesized battle audio (Web Audio, no asset files).
   The AudioContext is created on the first user gesture (the Deploy button). */
'use strict';

const AudioSFX = {
  ctx: null, master: null,
  muted: (typeof localStorage !== 'undefined' && localStorage.getItem('am_muted') === '1'),
  _last: {},

  init() {
    if (this.ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('am_muted', m ? '1' : '0'); } catch (e) {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  },
  _throttle(key, ms) {
    const now = (this.ctx ? this.ctx.currentTime * 1000 : Date.now());
    if (this._last[key] && now - this._last[key] < ms) return false;
    this._last[key] = now; return true;
  },
  _noise(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; return src;
  },
  _env(node, t0, dur, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); return g;
  },
  _tone(freq, dur, type, peak, glideTo) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    this._env(o, t0, dur, peak).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  gun() {
    if (!this.ctx || !this._throttle('gun', 55)) return;
    const t0 = this.ctx.currentTime;
    const src = this._noise(0.09);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 700;
    src.connect(f); this._env(f, t0, 0.09, 0.32).connect(this.master);
    src.start(t0); src.stop(t0 + 0.1);
  },
  hawk() {
    if (!this.ctx || !this._throttle('hawk', 120)) return;
    const t0 = this.ctx.currentTime;
    const src = this._noise(0.18);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    src.connect(f); this._env(f, t0, 0.18, 0.45).connect(this.master);
    src.start(t0); src.stop(t0 + 0.2);
    this._tone(180, 0.16, 'triangle', 0.15, 90);
  },
  hit() { if (this._throttle('hit', 45)) this._tone(150, 0.07, 'square', 0.16, 70); },
  kill() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this._noise(0.14);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    src.connect(f); this._env(f, t0, 0.14, 0.4).connect(this.master);
    src.start(t0); src.stop(t0 + 0.15);
    this._tone(220, 0.25, 'sawtooth', 0.12, 60);
  },
  capture() {
    this._tone(330, 0.18, 'square', 0.2, 500);
    setTimeout(() => this._tone(500, 0.3, 'square', 0.2, 760), 120);
  },
  klaxon() {
    this._tone(440, 0.35, 'square', 0.18);
    setTimeout(() => this._tone(330, 0.45, 'square', 0.18), 320);
  },
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'triangle', 0.2), i * 130)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.35, 'sawtooth', 0.16), i * 150)); },
  ui() { this._tone(660, 0.04, 'sine', 0.08); },
};

if (typeof module !== 'undefined') module.exports = {};
