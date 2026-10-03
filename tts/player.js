// Plays synthesized speech through one <audio> element, several sentences per clip.
// A real media element (not Web Audio) is what keeps sound going on a locked iPhone; while the
// next sentences are still being synthesized, a short silent clip holds the audio session open.
import { forSpeech } from './text.js';
import { risingQuestion } from './prosody.js';

const SENTENCE_GAP = 0.22, PARA_GAP = 0.5; // silence after a unit, seconds
const FILLER_SEC = 0.3;

function wavBlob(parts, total, sampleRate) {
  const buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, total * 2, true);
  const out = new Int16Array(buf, 44, total);
  let o = 0;
  for (const p of parts) { out.set(p.pcm, o); o += p.pcm.length + p.gap; }
  return new Blob([buf], { type: 'audio/wav' });
}

export class TtsPlayer extends EventTarget {
  constructor({ audio, workerUrl } = {}) {
    super();
    this.audio = audio || new Audio();
    this.audio.preload = 'auto';
    this.workerUrl = workerUrl || new URL('./worker.js', import.meta.url);
    this.worker = null;
    this.voice = null;
    this.sampleRate = 22050;
    this.rate = 1;
    this.rise = 0.35;         // extra pitch at the end of yes/no questions (0 = leave the voice as it is)
    this.aheadSec = 75;       // synthesized but not yet played speech to keep in hand
    this.maxSegmentSec = 30;  // longest clip handed to the audio element
    this.state = 'idle';      // idle | loading | buffering | playing | paused | ended
    this._gen = 0;
    this._filler = null;
    this._clear();
    this.audio.addEventListener('ended', () => this._advance());
    this.audio.addEventListener('timeupdate', () => this._tick());
    this.audio.addEventListener('error', () => this._log('ошибка аудио: ' + ((this.audio.error && this.audio.error.message) || 'неизвестная')));
    this.audio.addEventListener('stalled', () => this._log('аудио: stalled'));
    // A pause we did not ask for (a call, Siri, another app taking the sound). The event arrives after
    // our own pause()/src changes have already moved on, so look at where things stand a moment later.
    this.audio.addEventListener('pause', () => setTimeout(() => this._checkInterrupted(), 250));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._checkInterrupted(); });
    if ('mediaSession' in navigator) {
      const on = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) { /* not supported here */ } };
      on('play', () => this.resume());
      on('pause', () => this.pause());
      on('nexttrack', () => this.skip(1));
      on('previoustrack', () => this.skip(-1));
    }
  }

  // ---------- public ----------

  /** Load a voice (downloads it on first use). Resolves with {voice, sampleRate, ms}. */
  load(voice, onProgress, { keep = false } = {}) {
    if (!this.worker) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
      this.worker.onmessage = e => this._onMessage(e.data);
      this.worker.onerror = e => {
        this._log('ошибка движка: ' + (e.message || 'не удалось запустить'));
        if (this._loading) { this._loading.reject(new Error(e.message || 'Не удалось запустить движок голоса')); this._loading = null; }
      };
      this.worker.postMessage({ type: 'reset', gen: this._gen }); // the worker starts at 0; we may already be further
    }
    if (!keep) { this.stop(); this._setState('loading'); }
    return new Promise((resolve, reject) => {
      this._loading = { resolve, reject, onProgress };
      this.worker.postMessage({ type: 'load', voice });
    });
  }

  /** Start speaking. Call from a tap: the first play() must come from a user gesture. */
  start(units, { loop = false, from = 0 } = {}) {
    this.stop();
    this.units = units;
    this.loop = loop;
    this._cursor = this._requested = from;
    this._wantPlay = true;
    this.stats.startedAt = Date.now();
    this._setState('buffering');
    this._pump();
    this._advance();
  }

  /**
   * Start the audio element on silence, inside a tap, before any text is ready: this opens the
   * audio session at once and lets a voice load and text arrive (append) without another tap.
   */
  prime() {
    this.stop();
    this.more = true;
    this._wantPlay = true;
    this.stats.startedAt = Date.now();
    this._setState('buffering');
    this._advance();
  }

  pause() {
    if (!this._wantPlay) return;
    this._wantPlay = false;
    this.audio.pause();
    this._setState('paused');
  }

  resume() {
    if (this._wantPlay || !this.units.length || this.state === 'ended') return;
    this._wantPlay = true;
    if (this._segment) {
      this._setState(this._segment.filler ? 'buffering' : 'playing');
      this._play();
    } else {
      this._advance();
    }
  }

  toggle() { if (this._wantPlay) this.pause(); else this.resume(); }

  /**
   * Feed more text while speaking (the next chapter). Set `player.more = true` while further
   * text may still come: running out then means "wait", not "the end". A 'low' event asks for it.
   */
  append(units) {
    this.units.push(...units);
    this._lowSent = false;
    this._pump();
  }

  stop() {
    this._gen++;
    if (this.worker) this.worker.postMessage({ type: 'reset', gen: this._gen });
    this._wantPlay = false;
    this.audio.pause();
    this._release();
    this._clear();
    if (this.state !== 'loading') this._setState('idle');
  }

  /** Jump by sentences (negative = back). */
  skip(n) { if (this.units.length) this.seek(Math.max(0, (this._current < 0 ? this._cursor : this._current) + n)); }

  seek(index) {
    if (!this._has(index)) return;
    const reusable = index >= this._cursor && index <= this._requested;
    if (reusable) {
      for (const k of [...this._ready.keys()]) if (k < index) this._ready.delete(k);
    } else {
      this._gen++;
      this.worker.postMessage({ type: 'reset', gen: this._gen });
      this._ready.clear();
      this._inFlight = 0;
      this._requested = index;
    }
    if (this._segment && !this._segment.filler) this._playedDone += this.audio.currentTime;
    this.audio.pause();
    this._release();
    this._cursor = index;
    this._wantPlay = true;
    this._pump();
    this._advance();
  }

  setRate(rate) {
    this.rate = rate;
    if (this._segment && !this._segment.filler) this.audio.playbackRate = rate;
  }

  setMeta({ title, artist, album } = {}) {
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title || '', artist: artist || '', album: album || '' });
    }
  }

  /** Seconds of speech actually played since start(). */
  get playedSec() {
    return this._playedDone + (this._segment && !this._segment.filler ? this.audio.currentTime : 0);
  }

  // ---------- internals ----------

  _clear() {
    this.units = [];
    this.loop = false;
    this._ready = new Map();  // unit index → {pcm, gap, dur}
    this._requested = 0;      // next unit to send for synthesis
    this._inFlight = 0;
    this._cursor = 0;         // next unit to put into a clip
    this._segment = null;     // {from, to, starts, dur, url} | {filler: true}
    this._current = -1;
    this._playedDone = 0;
    this._wantPlay = false;
    this.more = false;
    this._lowSent = false;
    this.stats = { units: 0, synthMs: 0, synthSec: 0, worst: Infinity, segments: 0, underruns: 0, underrunSec: 0, firstSoundMs: null, startedAt: 0 };
  }

  _has(i) { return i >= 0 && (this.loop ? this.units.length > 0 : i < this.units.length); }
  _unit(i) { return this.units[i % this.units.length]; }

  _aheadSec() {
    let sec = this._segment && !this._segment.filler ? this._segment.dur - this.audio.currentTime : 0;
    for (const r of this._ready.values()) sec += r.dur;
    return sec;
  }

  _pump() {
    while (this._inFlight < 2 && this._has(this._requested) && this._aheadSec() < this.aheadSec) {
      const i = this._requested++;
      this._inFlight++;
      const text = this._unit(i).text;
      this.worker.postMessage({ type: 'synth', id: i, gen: this._gen, text: forSpeech(text), rise: this.rise && risingQuestion(text) ? this.rise : 0 });
    }
    if (this.more && !this.loop && !this._lowSent && this.units.length - this._requested < 8) {
      this._lowSent = true;
      this._emit('low');
    }
  }

  _onMessage(msg) {
    if (msg.type === 'progress') {
      if (this._loading && this._loading.onProgress) this._loading.onProgress(msg);
    } else if (msg.type === 'ready') {
      this.voice = msg.voice;
      this.sampleRate = msg.sampleRate;
      if (this.state === 'loading') this._setState('idle');
      if (this._loading) { this._loading.resolve(msg); this._loading = null; }
    } else if (msg.type === 'audio') {
      if (msg.gen !== this._gen) return;
      this._inFlight--;
      if (msg.id < this._cursor) { this._pump(); return; } // skipped past while it was being synthesized
      const sec = msg.pcm.length / msg.sampleRate;
      const gap = msg.pcm.length ? Math.round((this._unit(msg.id).paraEnd ? PARA_GAP : SENTENCE_GAP) * msg.sampleRate) : 0;
      this._ready.set(msg.id, { pcm: msg.pcm, gap, dur: (msg.pcm.length + gap) / msg.sampleRate });
      if (sec > 0) {
        const s = this.stats;
        s.units++; s.synthMs += msg.ms; s.synthSec += sec;
        s.worst = Math.min(s.worst, sec * 1000 / msg.ms);
      }
      this._emit('synth', { index: msg.id, sec, ms: msg.ms });
      this._pump();
    } else if (msg.type === 'error') {
      if (msg.during === 'load') {
        if (this.state === 'loading') this._setState('idle');
        if (this._loading) { this._loading.reject(new Error(msg.message)); this._loading = null; }
        return;
      }
      if (msg.gen !== this._gen) return;
      this._inFlight--;
      this._log(`не удалось озвучить фразу ${msg.id}: ${msg.message}`);
      this._ready.set(msg.id, { pcm: new Int16Array(0), gap: 0, dur: 0 });
      this._pump();
    }
  }

  /** Hand the audio element its next clip: ready speech if there is any, silence otherwise. */
  _advance() {
    if (!this._wantPlay) return;
    const prev = this._segment;
    if (prev && !prev.filler) this._playedDone += prev.dur;
    if (prev && prev.filler && this.stats.firstSoundMs != null) this.stats.underrunSec += FILLER_SEC;
    this._release();

    const parts = [], starts = [];
    let samples = 0, i = this._cursor;
    // Opening on one short phrase would leave a hole right after it: wait for the second one.
    const first = this._ready.get(i);
    const hold = this.stats.firstSoundMs == null && first && first.dur < 4 && this._has(i + 1) && !this._ready.has(i + 1);
    while (!hold && this._ready.has(i) && samples / this.sampleRate < this.maxSegmentSec) {
      const r = this._ready.get(i);
      starts.push(samples / this.sampleRate);
      parts.push(r);
      samples += r.pcm.length + r.gap;
      this._ready.delete(i);
      i++;
    }
    if (samples > 0) {
      const url = URL.createObjectURL(wavBlob(parts, samples, this.sampleRate));
      this._segment = { from: this._cursor, to: i, starts, dur: samples / this.sampleRate, url };
      this._cursor = i;
      this.audio.src = url;
      this.audio.defaultPlaybackRate = this.rate;
      this.audio.playbackRate = this.rate;
      this._play();
      const s = this.stats;
      if (s.firstSoundMs == null) s.firstSoundMs = Date.now() - s.startedAt;
      s.segments++;
      this._setState('playing');
      this._tick();
      this._pump();
      return;
    }
    this._cursor = i; // skip units that produced no sound
    if (!this._has(this._cursor) && !this.more) {
      this._wantPlay = false;
      this._setState('ended');
      this._emit('ended');
      return;
    }
    if (this.state === 'playing') this.stats.underruns++;
    if (!this._filler) this._filler = URL.createObjectURL(wavBlob([], Math.round(FILLER_SEC * 22050), 22050));
    this._segment = { filler: true };
    this.audio.src = this._filler;
    this.audio.defaultPlaybackRate = 1;
    this.audio.playbackRate = 1;
    this._play();
    this._setState('buffering');
    this._pump();
  }

  _play() {
    const p = this.audio.play();
    if (p && p.catch) {
      p.catch(err => {
        if (err && err.name === 'AbortError') return; // superseded by the next clip
        this._log('воспроизведение не началось: ' + ((err && err.name) || err));
        if (this._wantPlay) { this._wantPlay = false; this._setState('paused'); this._emit('blocked'); }
      });
    }
  }

  _checkInterrupted() {
    if (!this._wantPlay || !this.audio.paused || this.audio.ended) return;
    this._wantPlay = false;
    this._log('звук остановлен системой');
    this._setState('paused');
    this._emit('interrupted');
  }

  _release() {
    const seg = this._segment;
    if (seg && seg.url) URL.revokeObjectURL(seg.url);
    this._segment = null;
  }

  _tick() {
    const seg = this._segment;
    if (!seg || seg.filler) return;
    const t = this.audio.currentTime;
    let k = 0;
    while (k + 1 < seg.starts.length && seg.starts[k + 1] <= t) k++;
    const index = seg.from + k;
    if (index !== this._current) {
      this._current = index;
      this._emit('unit', { index, unit: this._unit(index) });
    }
  }

  _setState(state) {
    if (state === this.state) return;
    this.state = state;
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = state === 'playing' || state === 'buffering' ? 'playing' : state === 'paused' ? 'paused' : 'none'; } catch (e) { /* older browsers */ }
    }
    this._emit('state', { state });
  }

  _log(text) { this._emit('log', { text }); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
