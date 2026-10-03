// Reads the open book aloud. A chapter is cut into sentence units that remember where they sit in
// the text; the player is fed ahead across chapter boundaries, and the sentence being spoken is
// highlighted and kept on screen (pages turn by themselves).
import { TtsPlayer } from '../../tts/player.js';
import { toUnits } from '../../tts/text.js';
import { Overlayer } from '../../vendor/foliate-js/overlayer.js';

const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DD', 'DT', 'TD', 'TH', 'PRE',
  'SECTION', 'ARTICLE', 'BODY', 'FIGCAPTION', 'CAPTION', 'HEADER', 'FOOTER', 'MAIN']);
const HIGHLIGHT = { color: 'rgba(216,178,90,.42)' };

/** Text of a chapter as blocks: [{text, nodes: [{node, start}]}], whitespace kept 1:1 so offsets map back. */
function collect(doc) {
  const out = [];
  if (!doc || !doc.body) return out;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let cur = null, curBlock = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest('script,style,sup,rt,aside,[hidden]')) continue;
    let block = parent;
    while (block && !BLOCK.has(block.tagName.toUpperCase())) block = block.parentElement;
    if (block !== curBlock) { cur = { text: '', nodes: [] }; out.push(cur); curBlock = block; }
    cur.nodes.push({ node: n, start: cur.text.length });
    cur.text += n.nodeValue.replace(/\s/g, ' ');
  }
  return out;
}

function unitsOf(sec, blocks) {
  const units = [];
  blocks.forEach((b, block) => {
    if (!/[\p{L}\p{N}]/u.test(b.text)) return;
    for (const u of toUnits(b.text)) units.push({ text: u.text, sec, block, start: u.start, end: u.end, paraEnd: u.paraEnd });
  });
  return units;
}

function rangeOf(blocks, u, doc) {
  const b = blocks[u.block];
  if (!b || !b.nodes.length) return null;
  const at = pos => {
    let i = b.nodes.length - 1;
    while (i > 0 && b.nodes[i].start > pos) i--;
    const { node, start } = b.nodes[i];
    return [node, Math.max(0, Math.min(node.nodeValue.length, pos - start))];
  };
  try {
    const r = doc.createRange();
    r.setStart(...at(u.start));
    r.setEnd(...at(u.end));
    return r;
  } catch (e) { return null; }
}

let shared = null; // one player (and one loaded voice) for the whole app

/** The shared player, for diagnostics. */
export const currentPlayer = () => shared;

/** Open the audio session right inside a tap, before the book itself has finished opening. */
export function unlock() {
  (shared || (shared = new TtsPlayer())).prime();
}

export class Speaker extends EventTarget {
  constructor({ view, voice, rate, lift, meta }) {
    super();
    this.view = view;
    this.voice = voice;
    this.meta = meta;
    this.player = shared || (shared = new TtsPlayer());
    this.player.setRate(rate || 1);
    this.player.rise = lift || 0;
    this.blocks = new Map(); // section index → blocks of the document shown on screen
    this.lastSec = -1;       // last section whose text has been handed to the player
    this.selfMove = 0;       // time of our own page turn, so the reader can tell it from the user's
    this.sleepAt = 0;
    this.sleepChapter = null;
    this.on = {
      state: e => this._emit('state', e.detail),
      unit: e => this._onUnit(e.detail),
      low: () => this._feed(),
      ended: () => this._emit('state', { state: 'ended' }),
      interrupted: () => this._emit('state', { state: 'paused' }),
      blocked: () => this._emit('state', { state: 'paused' }),
    };
    for (const [type, fn] of Object.entries(this.on)) this.player.addEventListener(type, fn);
  }

  get playing() { return this.player.state === 'playing' || this.player.state === 'buffering'; }
  get state() { return this.player.state; }
  get playedSec() { return this.player.playedSec; }

  /** Start from what is on screen. Must be called from a tap. */
  async start(onProgress) {
    const p = this.player;
    p.prime();
    p.setMeta(this.meta);
    if (p.voice !== this.voice) {
      this._emit('state', { state: 'loading' });
      await p.load(this.voice, onProgress, { keep: true });
    }
    if (this.dead) return;
    this._startHere(false);
  }

  _shown() { return this.view.renderer.getContents()[0] || {}; }

  _blocksFor(sec) {
    const { doc, index } = this._shown();
    if (index !== sec) return null;
    let b = this.blocks.get(sec);
    if (!b || b.doc !== doc) { b = { doc, list: collect(doc) }; this.blocks.set(sec, b); }
    return b;
  }

  /** First unit of the shown chapter that is still (partly) on the visible page. */
  _firstVisible(units, sec) {
    const b = this._blocksFor(sec), visible = this.view.lastLocation && this.view.lastLocation.range;
    if (!b || !visible) return 0;
    for (let i = 0; i < units.length; i++) {
      const r = rangeOf(b.list, units[i], b.doc);
      try { if (r && r.compareBoundaryPoints(Range.START_TO_END, visible) > 0) return i; } catch (e) { return 0; }
    }
    return Math.max(0, units.length - 1);
  }

  _startHere(reprime = true) {
    const { index } = this._shown();
    if (index == null) return;
    const b = this._blocksFor(index);
    const units = unitsOf(index, b.list);
    const from = this._firstVisible(units, index);
    const p = this.player;
    this.started = false; // prime() asks for more text at once; hold that until this chapter is in
    if (reprime) { p.prime(); p.setMeta(this.meta); }
    this.lastSec = index;
    this.started = true;
    p.append(units.slice(from));
    if (!units.length) this._feed();
  }

  /** Hand the player the next chapter's text before the current one runs out. */
  async _feed() {
    if (this.feeding || this.dead || !this.started) return;
    this.feeding = true;
    try {
      const sections = this.view.book.sections;
      for (;;) {
        let sec = this.lastSec + 1;
        while (sec < sections.length && (sections[sec].linear === 'no' || !sections[sec].createDocument)) sec++;
        if (sec >= sections.length) { this.player.more = false; break; }
        this.lastSec = sec;
        const doc = await sections[sec].createDocument();
        if (this.dead) return;
        const units = unitsOf(sec, collect(doc));
        if (units.length) { this.player.append(units); break; }
      }
    } catch (e) {
      this.player.more = false;
    }
    this.feeding = false;
  }

  async _onUnit({ index, unit }) {
    if (this.dead || !unit) return;
    if (this.sleepChapter != null && unit.sec !== this.sleepChapter) { this.sleepChapter = null; this.pause(); this._emit('sleep'); return; }
    if (this.sleepAt && Date.now() >= this.sleepAt) { this.sleepAt = 0; this.pause(); this._emit('sleep'); return; }
    this.current = index;
    this._emit('say', { text: unit.text });
    const view = this.view;
    if (this._shown().index !== unit.sec) {
      this.selfMove = Date.now();
      try { await view.renderer.goTo({ index: unit.sec }); } catch (e) { return; }
      if (this.dead) return;
    }
    const b = this._blocksFor(unit.sec);
    const range = b && rangeOf(b.list, unit, b.doc);
    if (!range) return;
    const { overlayer } = this._shown();
    try {
      if (overlayer) { overlayer.remove('tts'); overlayer.add('tts', range, Overlayer.highlight, HIGHLIGHT); }
      this.selfMove = Date.now();
      await view.renderer.scrollToAnchor(range);
    } catch (e) { /* the page changed under us: the next unit will catch up */ }
  }

  /** The reader turned the page herself: continue speaking from what is now on screen. */
  sync() {
    if (this.dead || Date.now() - this.selfMove < 700) return;
    const { index } = this._shown();
    if (index == null) return;
    const units = this.player.units;
    const first = units.findIndex(u => u.sec === index);
    if (first < 0) { this._startHere(); return; }
    const inSec = units.filter(u => u.sec === index);
    this.player.seek(first + this._firstVisible(inSec, index));
  }

  toggle() { this.player.toggle(); }
  pause() { this.player.pause(); }
  skip(n) { this.player.skip(n); }
  setRate(rate) { this.player.setRate(rate); }

  /** minutes > 0, 'chapter', or 0 to switch the sleep timer off. */
  setSleep(value) {
    this.sleepAt = typeof value === 'number' && value > 0 ? Date.now() + value * 60000 : 0;
    const u = this.player.units[Math.max(0, this.current || 0)];
    this.sleepChapter = value === 'chapter' && u ? u.sec : null;
  }

  stop() {
    this.dead = true;
    for (const [type, fn] of Object.entries(this.on)) this.player.removeEventListener(type, fn);
    this.player.stop();
    try { const { overlayer } = this._shown(); if (overlayer) overlayer.remove('tts'); } catch (e) { /* view already closed */ }
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
