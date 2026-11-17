// One-word reading of the same Foliate book. No network, audio engine or changes
// to book HTML; CFI addresses link each displayed word back to the regular page.
import { collectReadingText, rangeForWord, wordAtAnchor, readingSettings, wordDuration } from './reading-text.js';
export { splitFocus } from './reading-text.js';

const clock = () => globalThis.performance?.now?.() ?? Date.now();
const clamp = n => Math.max(0, Math.min(1, n));

export class WordReader {
  constructor(view, { settings = {}, onWord, onState, onRead, onError, onEnd } = {}) {
    this.view = view;
    this.settings = readingSettings(settings);
    this.callbacks = { onWord, onState, onRead, onError, onEnd };
    this.state = 'paused';
    this.dead = false;
    this._ready = false;
    this._cache = new Map();
    this._loads = new Map();
    this._navigation = 0;
    this._advancing = null;
    this._timer = null;
    this._segmentAt = null;
    this._wordElapsed = 0;
    this._activeMs = 0;
    this._credited = false;
    this._wantedPlaying = false;
    this._current = null;
    this._section = null;
    this._wordIndex = 0;
    this._visibility = () => { if (globalThis.document?.hidden) this.pause(); };
    this._pagehide = () => this.pause();
    globalThis.document?.addEventListener('visibilitychange', this._visibility);
    globalThis.window?.addEventListener('pagehide', this._pagehide);
  }

  get current() { return this._current; }
  get playing() { return this.state === 'playing'; }
  get activeMs() {
    return this._activeMs + (this._segmentAt == null ? 0 : Math.min(Math.max(0, clock() - this._segmentAt), this._timeCap()));
  }

  /** Prepare one section. Opening is always paused, including when a CFI is supplied. */
  async open(cfi = null) {
    if (this.dead) return null;
    this.pause();
    const navigation = ++this._navigation;
    this._ready = false;
    this._setState('loading');
    try {
      let target;
      if (cfi) target = await this.view.resolveCFI(cfi);
      else {
        const contents = this.view.renderer.getContents();
        const visible = this.view.lastLocation?.range;
        const shown = contents.find(x => visible?.startContainer?.ownerDocument === x.doc) || contents[0];
        if (!shown || shown.index == null) throw this._error('Не удалось определить место на странице. Открой книгу и попробуй снова.', 'NO_LOCATION');
        const visibleCFI = visible ? this.view.getCFI(shown.index, visible) : null;
        target = visibleCFI ? await this.view.resolveCFI(visibleCFI) : { index: shown.index };
      }
      if (!target || !Number.isInteger(target.index)) throw this._error('Не удалось восстановить это место в книге.', 'INVALID_LOCATION');
      const section = await this._load(target.index);
      if (!this._alive(navigation)) return null;
      const anchor = typeof target.anchor === 'function' ? target.anchor(section.doc) : null;
      const index = anchor ? wordAtAnchor(section, anchor) : 0;
      this._ready = true;
      this._show(section, index);
      this._setState('paused');
      return this.current;
    } catch (error) {
      if (this._alive(navigation)) this._fail(error);
      return null;
    }
  }

  async play() {
    if (this.dead || !this._ready || globalThis.document?.hidden || this.state === 'error' || this.state === 'ended') return;
    this._wantedPlaying = true;
    if (this.state === 'loading' || this.playing) return;
    if (this._credited) { await this._advance(this._navigation); return; }
    this._resume();
  }

  pause() {
    if (this.dead) return;
    this._wantedPlaying = false;
    this._clearTimer();
    this._settleTime();
    this._credit();
    if (this.state !== 'ended' && this.state !== 'error') this._setState('paused');
  }

  toggle() { return this.playing || this._wantedPlaying ? this.pause() : this.play(); }

  /** Moving back is navigation, never reading. It always leaves playback paused. */
  async back(count = 10) {
    if (this.dead || !this._section) return;
    this.pause();
    const navigation = ++this._navigation;
    let section = this._section;
    let index = this._wordIndex - Math.max(1, Math.floor(Number(count) || 10));
    try {
      while (index < 0) {
        const prev = this._linearSection(section.index, -1);
        if (prev < 0) { index = 0; break; }
        this._setState('loading');
        section = await this._load(prev);
        if (!this._alive(navigation)) return;
        index += section.words.length;
      }
      if (!this._alive(navigation)) return;
      this._show(section, index);
      this._setState('paused');
    } catch (error) { if (this._alive(navigation)) this._fail(error); }
  }

  /** At a sentence start, move to the previous sentence; otherwise to this start. */
  async previousSentence() {
    if (this.dead || !this._section) return;
    this.pause();
    const navigation = ++this._navigation;
    let section = this._section;
    let index = section.words[this._wordIndex].sentenceStartIndex;
    try {
      if (index === this._wordIndex) {
        if (index > 0) index = section.words[index - 1].sentenceStartIndex;
        else {
          const prev = this._linearSection(section.index, -1);
          if (prev >= 0) {
            this._setState('loading');
            section = await this._load(prev);
            if (!this._alive(navigation)) return;
            index = section.words[section.words.length - 1].sentenceStartIndex;
          }
        }
      }
      if (!this._alive(navigation)) return;
      this._show(section, index);
      this._setState('paused');
    } catch (error) { if (this._alive(navigation)) this._fail(error); }
  }

  setSettings(patch = {}) {
    if (this.dead) return;
    const wasPlaying = this.playing;
    if (wasPlaying) { this._clearTimer(); this._settleTime(); }
    this.settings = readingSettings({ ...this.settings, ...patch });
    if (wasPlaying) {
      this._segmentAt = clock();
      this._schedule();
    }
  }

  destroy() {
    if (this.dead) return;
    this._settleTime();
    this.dead = true;
    this._navigation++;
    this._wantedPlaying = false;
    this._clearTimer();
    globalThis.document?.removeEventListener('visibilitychange', this._visibility);
    globalThis.window?.removeEventListener('pagehide', this._pagehide);
    this._cache.clear();
    this._loads.clear();
    this._section = null;
    this.callbacks = {};
  }

  async _load(index) {
    if (this._cache.has(index)) return this._cache.get(index);
    if (this._loads.has(index)) return this._loads.get(index);
    const bookSection = this.view.book.sections[index];
    const pending = (async () => {
      if (!bookSection?.createDocument) throw this._error('Этот раздел нельзя показать по словам. Открой его обычной страницей.', 'UNSUPPORTED_SECTION', index);
      const doc = await bookSection.createDocument();
      if (this.dead) return null;
      const text = collectReadingText(doc);
      if (text.complex) throw this._error('В этом разделе есть таблица, формула или сложная вёрстка. Продолжи на обычной странице.', 'UNSUPPORTED_SECTION', index);
      if (!text.words.length) throw this._error('В этом разделе нет обычного текста для показа по словам. Посмотри его на странице книги.', 'NO_TEXT', index);
      const section = { ...text, doc, index };
      this._cache.set(index, section);
      return section;
    })();
    this._loads.set(index, pending);
    try { return await pending; }
    catch (error) {
      if (error.sectionIndex == null) {
        error.sectionIndex = index;
        try { error.cfi = this.view.getCFI(index); } catch (_) { /* no usable address */ }
      }
      throw error;
    } finally { if (this._loads.get(index) === pending) this._loads.delete(index); }
  }

  _fractions() {
    const sections = this.view.book.sections;
    const supplied = this.view.getSectionFractions?.();
    if (supplied?.length === sections.length + 1 && supplied.every(Number.isFinite)) return supplied.map(clamp);
    let sizes = sections.map(s => s.linear === 'no' ? 0 : Math.max(0, Number(s.size) || 0));
    if (!sizes.some(x => x > 0)) sizes = sections.map(s => s.linear === 'no' ? 0 : 1);
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    let sum = 0;
    return [0, ...sizes.map(size => (sum += size) / total)];
  }

  _show(section, index) {
    if (this.dead) return;
    this._section = section;
    this._wordIndex = Math.max(0, Math.min(section.words.length - 1, index));
    this._wordElapsed = 0;
    this._credited = false;
    this._segmentAt = null;
    const word = section.words[this._wordIndex];
    const range = rangeForWord(section, word);
    const fractions = this._fractions();
    const start = fractions[section.index] ?? 0;
    const size = (fractions[section.index + 1] ?? 1) - start;
    let chapter = '';
    try { chapter = this.view.getProgressOf?.(section.index, range)?.tocItem?.label || ''; } catch (_) { /* no TOC */ }
    this._current = {
      text: word.text, context: word.context,
      cfi: this.view.getCFI(section.index, range),
      sectionIndex: section.index, wordIndex: this._wordIndex,
      totalWords: section.words.length, // current section only; other sections are loaded lazily
      fraction: clamp(start + size * word.sourceStart / Math.max(1, section.sourceChars)),
      endFraction: clamp(start + size * word.sourceEnd / Math.max(1, section.sourceChars)),
      chars: word.chars, chapter: String(chapter || `Раздел ${section.index + 1}`),
      sentenceStartIndex: word.sentenceStartIndex,
      sentenceEnd: word.sentenceEnd, paragraphEnd: word.paragraphEnd,
    };
    // Keep the current and a few neighbouring documents; a long anthology must
    // not leave its entire DOM in memory simply because it was read once.
    if (this._cache.size > 3) {
      const farthest = [...this._cache.keys()].filter(i => i !== section.index)
        .sort((a, b) => Math.abs(b - section.index) - Math.abs(a - section.index));
      while (this._cache.size > 3 && farthest.length) this._cache.delete(farthest.shift());
    }
    this._call('onWord', this._current);
  }

  _resume() {
    if (this.dead || !this._wantedPlaying || !this._current || globalThis.document?.hidden) return;
    this._setState('playing');
    if (this.dead || !this._wantedPlaying) return;
    this._segmentAt = clock();
    this._schedule();
  }

  _duration() { return this._current ? wordDuration(this._current, this.settings) : 0; }
  _timeCap() { return Math.max(1000, this._duration() + 250); }
  _clearTimer() { if (this._timer != null) clearTimeout(this._timer); this._timer = null; }

  _settleTime() {
    if (this._segmentAt == null) return 0;
    const elapsed = Math.max(0, clock() - this._segmentAt);
    const counted = Math.min(elapsed, this._timeCap());
    this._activeMs += counted;
    this._wordElapsed += counted;
    this._segmentAt = null;
    return elapsed;
  }

  _credit() {
    if (this.dead || !this._current || this._credited || this._wordElapsed + 0.5 < this._duration()) return;
    this._credited = true;
    this._call('onRead', { cursor: this._current, from: this._current.fraction, to: this._current.endFraction,
      characters: this._current.chars, milliseconds: this._wordElapsed });
  }

  _schedule() {
    this._clearTimer();
    if (this.dead || !this.playing || !this._wantedPlaying) return;
    const navigation = this._navigation;
    this._timer = setTimeout(async () => {
      this._timer = null;
      if (!this._alive(navigation) || !this._wantedPlaying) return;
      if (globalThis.document?.hidden) { this.pause(); return; }
      const elapsed = this._settleTime();
      this._credit();
      if (!this._alive(navigation) || !this._wantedPlaying) return;
      // A suspended or blocked event loop must never race through missed words.
      // Keep the word visible and ask for an explicit continuation after a long stall.
      if (elapsed > this._timeCap() + 1000) { this.pause(); return; }
      if (!this._credited) { this._segmentAt = clock(); this._schedule(); return; }
      await this._advance(navigation);
    }, Math.max(1, this._duration() - this._wordElapsed));
  }

  async _advance(navigation) {
    if (!this._alive(navigation) || this._advancing === navigation) return;
    this._advancing = navigation;
    try {
      if (this._wordIndex + 1 < this._section.words.length) {
        this._show(this._section, this._wordIndex + 1);
      } else {
        const next = this._linearSection(this._section.index, 1);
        if (next < 0) {
          this._wantedPlaying = false;
          this._setState('ended');
          this._call('onEnd', this.current);
          return;
        }
        this._setState('loading');
        const section = await this._load(next);
        if (!this._alive(navigation)) return;
        this._show(section, 0);
      }
      if (this._wantedPlaying) this._resume();
      else this._setState('paused');
    } catch (error) { if (this._alive(navigation)) this._fail(error); }
    finally { if (this._advancing === navigation) this._advancing = null; }
  }

  _linearSection(index, direction) {
    const sections = this.view.book.sections;
    for (let i = index + direction; i >= 0 && i < sections.length; i += direction)
      if (sections[i].linear !== 'no') return i;
    return -1;
  }

  _error(message, code, sectionIndex) {
    const error = new Error(message);
    error.code = code;
    if (sectionIndex != null) {
      error.sectionIndex = sectionIndex;
      try { error.cfi = this.view.getCFI(sectionIndex); } catch (_) { /* no usable address */ }
    }
    return error;
  }
  _alive(navigation) { return !this.dead && navigation === this._navigation; }
  _setState(state) {
    if (this.dead || this.state === state) return;
    this.state = state;
    this._call('onState', state);
  }
  _fail(error) {
    this._wantedPlaying = false;
    this._clearTimer();
    this._settleTime();
    this._setState('error');
    this._call('onError', error instanceof Error ? error : new Error(String(error)));
  }
  _call(name, value) {
    if (this.dead) return;
    try { this.callbacks[name]?.(value); }
    catch (error) { console.error(`WordReader ${name}:`, error); }
  }
}
