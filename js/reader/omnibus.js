// A file that holds many works (a collected Poirot, a volume of stories): read its table of contents,
// find which library records those entries are, and tie each record to its place in the file.
// Afterwards a work opens the big file at its own first page and keeps its own progress.
import { norm } from '../util.js';
import { store } from '../store.js';

const STOP = new Set(['в', 'во', 'на', 'и', 'с', 'со', 'о', 'об', 'по', 'из', 'у', 'к', 'за', 'от', 'для', 'или', 'не', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and']);

/** Words of a title reduced to short stems, so «Стайлзе» and «Стайлз» or «экспрессе» and «экспресс» agree. */
function stems(title) {
  const out = new Set();
  for (const w of norm(title).split(' ')) {
    if (!w || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.length > 5 ? w.slice(0, 5) : w);
  }
  return out;
}

/** 0…1: how alike two titles are (shared stems; a title wholly inside the other counts as close). */
function alike(a, b) {
  if (!a.size || !b.size) return 0;
  let same = 0;
  for (const x of a) if (b.has(x)) same++;
  const dice = 2 * same / (a.size + b.size);
  const inside = same === Math.min(a.size, b.size) && same >= 2 ? 0.86 : 0;
  return Math.max(dice, inside);
}

/** A contents label without numbering, the author's name and bracketed remarks. */
function cleanLabel(label, author) {
  let t = String(label || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  t = t.replace(/^(глава|часть|книга|том|раздел)\s+[\dIVXLCivxlc]+[.:]?\s*/i, '');
  t = t.replace(/^[\dIVXLC]+[.)]\s+/, '');
  if (author) for (const word of author.split(/\s+/)) if (word.length > 3) t = t.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.:,]?\\s*', 'i'), '');
  return t.split(' / ')[0].trim();
}

/** Every contents entry with its depth and its position in the file as a fraction 0…1. */
async function entries(book) {
  const flat = [];
  const walk = (items, depth) => { for (const it of items || []) { if (it.href) flat.push({ label: it.label, href: it.href, depth }); walk(it.subitems, depth + 1); } };
  walk(book.toc, 0);
  const sizes = book.sections.map(s => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const starts = [];
  let sum = 0;
  for (const size of sizes) { starts.push(sum / total); sum += size; }

  const resolved = [];
  for (const it of flat) {
    try {
      const r = await book.resolveHref(it.href);
      if (r && r.index != null && sizes[r.index]) resolved.push({ ...it, index: r.index, anchor: r.anchor });
    } catch (e) { /* an entry that points nowhere */ }
  }
  const perSection = {};
  for (const it of resolved) perSection[it.index] = (perSection[it.index] || 0) + 1;
  const docs = new Map();
  for (const it of resolved) {
    let inside = 0;
    // Several entries in one chapter file: find how far into it each one starts.
    if (perSection[it.index] > 1 && typeof it.anchor === 'function') {
      try {
        if (!docs.has(it.index)) docs.set(it.index, await book.sections[it.index].createDocument());
        const doc = docs.get(it.index), target = it.anchor(doc);
        const all = (doc.body.textContent || '').length;
        if (target && all) {
          const r = doc.createRange();
          r.setStart(doc.body, 0);
          if (target.startContainer) r.setEnd(target.startContainer, target.startOffset); else r.setEndBefore(target);
          inside = Math.min(1, r.toString().length / all);
        }
      } catch (e) { /* keep the start of the chapter file */ }
    }
    it.from = starts[it.index] + inside * sizes[it.index] / total;
  }
  resolved.sort((a, b) => a.from - b.from);
  resolved.forEach((it, i) => {
    const next = resolved.slice(i + 1).find(x => x.depth <= it.depth && x.from > it.from);
    it.to = next ? next.from : 1;
  });
  return resolved;
}

/**
 * Match the file's contents to library records and link them.
 * @returns {{linked: {id, title}[], missed: string[], entries: number}}
 */
export async function scan(hostId, book) {
  const host = store.books.get(hostId);
  const list = await entries(book);
  const surname = norm((host.author || '').split(',')[0]).split(' ').pop();
  const pool = [...store.books].filter(([id, b]) => id !== hostId && !b.parts && b.kind !== 'series'
    && (!surname || norm(b.author || '').includes(surname)));
  const titles = pool.map(([id, b]) => ({ id, b, sets: [b.title, ...(b.alt || [])].map(stems) }));

  const pairs = [];
  list.forEach((it, i) => {
    const want = stems(cleanLabel(it.label, host.author));
    if (!want.size) return;
    for (const t of titles) {
      const score = Math.max(...t.sets.map(s => alike(want, s)));
      if (score >= 0.6) pairs.push({ i, id: t.id, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const byEntry = new Map(), taken = new Set();
  for (const p of pairs) {
    if (byEntry.has(p.i) || taken.has(p.id)) continue;
    // a weak likeness must at least be the only one of its kind
    if (p.score < 0.75 && pairs.some(q => q !== p && q.i === p.i && q.score > p.score - 0.15 && !taken.has(q.id))) continue;
    byEntry.set(p.i, p.id);
    taken.add(p.id);
  }

  const parts = [], linked = [];
  for (const [i, id] of [...byEntry].sort((a, b) => list[a[0]].from - list[b[0]].from)) {
    const it = list[i], b = store.books.get(id);
    if (it.to - it.from <= 0) continue;
    parts.push({ id, from: it.from, to: it.to });
    const pages = Math.max(1, Math.round((host.pages || 1) * (it.to - it.from)));
    store.patch('books', id, { src: { book: hostId, href: it.href, from: it.from, to: it.to }, pages: b.pages && !b.src ? b.pages : pages, fmt: 'e' });
    linked.push({ id, title: b.title });
  }
  // records linked on an earlier pass and no longer found keep working only if still listed; drop stale ties
  for (const old of host.parts || []) {
    if (!parts.some(p => p.id === old.id)) { const b = store.books.get(old.id); if (b && b.src && b.src.book === hostId) store.patch('books', old.id, { src: null }); }
  }
  // the volume itself is a shelf for its works, not a book "being read"
  if (parts.length) store.patch('books', hostId, { parts, status: host.status === 'reading' ? 'want' : host.status });
  const top = Math.min(...list.map(x => x.depth));
  const missed = list.filter((it, i) => !byEntry.has(i) && it.depth <= top + 1).map(it => String(it.label || '').trim()).filter(Boolean);
  return { linked, missed, entries: list.length };
}

/** The part of a collected volume that contains position f, or null. */
export function partAt(parts, f) {
  if (!parts) return null;
  for (const p of parts) if (f >= p.from && f < p.to) return p;
  return null;
}
