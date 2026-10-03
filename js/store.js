// App data lives in memory (Maps), is written through to IndexedDB at once, and — when signed in —
// is mirrored to Firestore by sync.js. Every document carries `u` (last change, ms) so two devices
// settle on the newest version; `x: 1` marks a deleted document so the deletion travels too.
import { db } from './db.js';

export const COLLECTIONS = ['books', 'cols', 'days', 'quotes', 'meta'];

const DEFAULTS = {
  theme: 'auto', // auto | light | dark
  goals: { pages: 30, minutes: 20, booksMonth: 2, booksYear: 24 },
  reader: { theme: 'auto', font: 'serif', size: 19, line: 1.5, margin: 22, flow: 'paginated', justify: true },
  voice: 'ru_RU-irina-medium',
  rate: 1,
  lift: 0.35, // question tone added to voices that lack it: 0 | 0.35 | 0.6
  ritm: { on: false, item: '' },
};

class Store {
  constructor() {
    for (const c of COLLECTIONS) this[c] = new Map();
    this.listeners = new Set();
    this.dirty = new Set(); // "coll/id" waiting to be sent to the cloud
    this.ready = false;
    this._scheduled = false;
  }

  async init() {
    for (const [key, doc] of await db.allDocs()) {
      const i = key.indexOf('/');
      const coll = key.slice(0, i), id = key.slice(i + 1);
      if (!this[coll]) continue;
      if (doc._d) this.dirty.add(key);
      if (!doc.x) this[coll].set(id, doc);
      else this._tomb(coll).set(id, doc);
    }
    this.ready = true;
  }

  _tomb(coll) { return (this._tombs ||= {})[coll] ||= new Map(); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed(origin) {
    this._origin = origin || this._origin;
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      const o = this._origin; this._origin = null;
      for (const fn of this.listeners) fn(o);
    });
  }

  get(coll, id) { return this[coll].get(id); }

  /** Replace a document. */
  put(coll, id, doc) {
    const full = { ...doc, u: Date.now(), _d: 1 };
    delete full.x;
    this[coll].set(id, full);
    this._tomb(coll).delete(id);
    this.dirty.add(`${coll}/${id}`);
    db.putDocs([[`${coll}/${id}`, full]]);
    this._changed('local');
    return full;
  }

  /** Change some fields of a document (creates it if missing). */
  patch(coll, id, partial) { return this.put(coll, id, { ...(this[coll].get(id) || {}), ...partial }); }

  remove(coll, id) {
    if (!this[coll].has(id)) return;
    const tomb = { x: 1, u: Date.now(), _d: 1 };
    this[coll].delete(id);
    this._tomb(coll).set(id, tomb);
    this.dirty.add(`${coll}/${id}`);
    db.putDocs([[`${coll}/${id}`, tomb]]);
    this._changed('local');
  }

  /** Many writes in one go (imports). entries: [coll, id, doc] */
  async bulk(entries) {
    const now = Date.now(), rows = [];
    for (const [coll, id, doc] of entries) {
      const full = { ...doc, u: now, _d: 1 };
      this[coll].set(id, full);
      this._tomb(coll).delete(id);
      this.dirty.add(`${coll}/${id}`);
      rows.push([`${coll}/${id}`, full]);
    }
    await db.putDocs(rows);
    this._changed('local');
  }

  // ----- used by sync.js -----

  /** The stored form of a document, tombstones included. */
  raw(coll, id) { return this[coll].get(id) || this._tomb(coll).get(id); }

  /** Accept a document that came from the cloud if it is newer than ours. */
  applyRemote(coll, id, doc) {
    const mine = this.raw(coll, id);
    if (mine && mine.u >= doc.u) return false;
    const clean = { ...doc };
    delete clean._d;
    if (clean.x) { this[coll].delete(id); this._tomb(coll).set(id, clean); }
    else { this[coll].set(id, clean); this._tomb(coll).delete(id); }
    this.dirty.delete(`${coll}/${id}`);
    db.putDocs([[`${coll}/${id}`, clean]]);
    this._changed('remote');
    return true;
  }

  /** Mark a document as delivered to the cloud (only if it has not changed since). */
  markSynced(coll, id, u) {
    const mine = this.raw(coll, id);
    if (!mine || mine.u !== u) return;
    delete mine._d;
    this.dirty.delete(`${coll}/${id}`);
    db.putDocs([[`${coll}/${id}`, mine]]);
  }

  // ----- settings -----

  get settings() {
    const s = this.meta.get('settings') || {};
    return {
      ...DEFAULTS, ...s,
      goals: { ...DEFAULTS.goals, ...(s.goals || {}) },
      reader: { ...DEFAULTS.reader, ...(s.reader || {}) },
      ritm: { ...DEFAULTS.ritm, ...(s.ritm || {}) },
    };
  }
  setSettings(partial) {
    const cur = this.meta.get('settings') || {};
    const next = { ...cur, ...partial };
    for (const k of ['goals', 'reader', 'ritm']) if (partial[k]) next[k] = { ...(cur[k] || {}), ...partial[k] };
    delete next.u; delete next._d;
    this.put('meta', 'settings', next);
  }
}

export const store = new Store();
