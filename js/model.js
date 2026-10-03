// Everything derived from stored data: day totals and rings, the streak ("chapter"), goals and pace,
// collection progress, medals, reading-speed estimates.
import { store } from './store.js';
import { today, addDays, parse, toStr, daysInMonth, daysBetween, fmtDay } from './util.js';

/** One "page" of an e-book: the amount of text on a typical paper page. */
export const PAGE_CHARS = 1800;
const r1 = n => Math.round(n * 10) / 10;

// ---------- days ----------

export function day(date) {
  const d = store.days.get(date);
  return { p: d?.p || 0, m: d?.m || 0, l: d?.l || 0, b: d?.b || {} };
}

/** Add reading to a day. `listen` minutes are also reading minutes: pass them in both. */
export function logReading({ date = today(), bookId, pages = 0, minutes = 0, listen = 0 }) {
  if (!pages && !minutes && !listen) return;
  const d = day(date), b = { ...d.b };
  if (bookId) {
    const cur = b[bookId] || {};
    b[bookId] = { p: r1((cur.p || 0) + pages), m: r1((cur.m || 0) + minutes), l: r1((cur.l || 0) + listen) };
  }
  store.put('days', date, { p: Math.max(0, r1(d.p + pages)), m: Math.max(0, r1(d.m + minutes)), l: Math.max(0, r1(d.l + listen)), b });
}

export function dayState(date) {
  const g = store.settings.goals, d = day(date);
  return {
    ...d, gp: g.pages, gm: g.minutes,
    fp: g.pages ? Math.min(1, d.p / g.pages) : 0,
    fm: g.minutes ? Math.min(1, d.m / g.minutes) : 0,
    doneP: g.pages > 0 && d.p >= g.pages,
    doneM: g.minutes > 0 && d.m >= g.minutes,
    any: d.p > 0 || d.m > 0,
  };
}
/** A day counts towards the streak when at least one ring is closed. */
export const dayClosed = date => { const s = dayState(date); return s.doneP || s.doneM; };

export function streak() {
  let d = today(), n = 0;
  if (!dayClosed(d)) d = addDays(d, -1); // today is still open: the run up to yesterday stands
  while (dayClosed(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function bestStreak() {
  let best = 0, run = 0, prev = null;
  for (const date of [...store.days.keys()].sort()) {
    if (!dayClosed(date)) continue;
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}

/** Longest run of closed days inside a date range. */
export function bestStreakIn(from, to) {
  let best = 0, run = 0, prev = null;
  for (const date of [...store.days.keys()].sort()) {
    if (date < from || date > to || !dayClosed(date)) continue;
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}

/** Totals for an inclusive date range. */
export function totals(from, to) {
  const t = { p: 0, m: 0, l: 0, days: 0, closed: 0 };
  for (const [date, d] of store.days) {
    if (date < from || date > to) continue;
    t.p += d.p || 0; t.m += d.m || 0; t.l += d.l || 0;
    if ((d.p || 0) > 0 || (d.m || 0) > 0) t.days++;
    if (dayClosed(date)) t.closed++;
  }
  return t;
}

/** Pages per minute over the last month of reading, for "time left" estimates. */
export function pace() {
  const t = totals(addDays(today(), -30), today());
  const eyes = t.m - t.l;
  return eyes >= 20 && t.p > 0 ? Math.min(3, Math.max(0.2, t.p / t.m)) : 0.5;
}

// ---------- books ----------

export function isRead(id, seen = new Set()) {
  const b = store.books.get(id);
  if (!b) return false;
  if (b.status === 'read') return true;
  if (b.covers && b.covers.length && !seen.has(id)) {
    seen.add(id);
    return b.covers.every(c => isRead(c, seen));
  }
  return false;
}

export function finishedIn(from, to) {
  return [...store.books].filter(([, b]) => b.status === 'read' && b.finishedAt && b.finishedAt >= from && b.finishedAt <= to)
    .sort((a, b) => (a[1].finishedAt < b[1].finishedAt ? 1 : -1));
}

/** Short stories count towards a series, but not as "books read". */
export const countsAsBook = b => b.kind !== 'story' && !b.parts;

export function bookFraction(b) {
  if (b.status === 'read') return 1;
  if (b.prog && b.prog.f) return Math.min(1, b.prog.f);
  if (b.pages && b.page) return Math.min(1, b.page / b.pages);
  return 0;
}

export function current() {
  const reading = [...store.books].filter(([, b]) => b.status === 'reading' && !b.parts);
  reading.sort((a, b) => (b[1].touched || 0) - (a[1].touched || 0));
  return reading.map(([id, b]) => ({ id, ...b }));
}

/** What it takes to finish a book by its planned date. */
export function plan(b) {
  if (!b.plan || !b.plan.by || !b.pages) return null;
  const left = Math.max(0, Math.round(b.pages * (1 - bookFraction(b))));
  const days = Math.max(1, daysBetween(today(), b.plan.by) + 1);
  const late = b.plan.by < today();
  return { left, days, perDay: Math.ceil(left / days), late, by: b.plan.by, label: fmtDay(b.plan.by) };
}

// ---------- goals ----------

export function monthGoal(date = today()) {
  const d = parse(date), y = d.getFullYear(), m = d.getMonth();
  const from = toStr(new Date(y, m, 1)), to = toStr(new Date(y, m, daysInMonth(y, m)));
  const goal = store.settings.goals.booksMonth;
  const done = finishedIn(from, to).filter(([, b]) => countsAsBook(b)).length;
  const expected = goal * d.getDate() / daysInMonth(y, m);
  return { goal, done, state: done >= goal ? 'done' : done + 0.5 >= expected ? 'ontrack' : 'behind', month: m };
}

export function yearGoal(date = today()) {
  const y = parse(date).getFullYear();
  const goal = store.settings.goals.booksYear;
  const done = finishedIn(`${y}-01-01`, `${y}-12-31`).filter(([, b]) => countsAsBook(b)).length;
  const dayOfYear = daysBetween(`${y}-01-01`, date) + 1;
  const expected = goal * dayOfYear / (daysBetween(`${y}-01-01`, `${y}-12-31`) + 1);
  return { goal, done, year: y, ahead: Math.round(done - expected) };
}

// ---------- collections and medals ----------

export function colProgress(col) {
  let read = 0;
  for (const id of col.items || []) if (isRead(id)) read++;
  return { read, total: (col.items || []).length };
}

const STEPS = [10, 25, 50, 75];
const TIER = { 10: 'bronze', 25: 'bronze', 50: 'silver', 75: 'silver' };

/** Every medal the app knows, with current progress. */
export function medals() {
  const out = [];
  for (const [id, col] of store.cols) {
    const { read, total } = colProgress(col);
    if (!total) continue;
    for (const step of STEPS) {
      if (total >= step * 1.6) out.push({ id: `col:${id}:${step}`, group: 'col', col: id, tier: TIER[step], name: col.name, desc: `${step} из ${total}`, have: read, need: step });
    }
    out.push({ id: `col:${id}:all`, group: 'col', col: id, tier: 'gold', name: col.name, desc: col.kind === 'series' ? 'серия собрана' : 'список закрыт', have: read, need: total });
  }
  const best = Math.max(bestStreak(), streak());
  for (const [n, name] of [[3, 'Три главы подряд'], [7, 'Неделя с книгой'], [14, 'Две недели'], [30, 'Месяц с книгой'], [60, 'Шестьдесят глав'], [100, 'Сто глав']]) {
    out.push({ id: `streak:${n}`, group: 'streak', tier: n >= 30 ? 'gold' : n >= 7 ? 'silver' : 'bronze', name, desc: `${n} дней чтения подряд`, have: best, need: n });
  }
  const dated = [...store.books.values()].filter(b => b.status === 'read' && b.finishedAt && countsAsBook(b)).length;
  for (const [n, name] of [[1, 'Первая книга'], [5, 'Пять книг'], [10, 'Десять книг'], [25, 'Двадцать пять книг'], [50, 'Пятьдесят книг']]) {
    out.push({ id: `books:${n}`, group: 'books', tier: n >= 25 ? 'gold' : n >= 5 ? 'silver' : 'bronze', name, desc: 'дочитано в «Главе»', have: dated, need: n });
  }
  const all = totals('0000-00-00', '9999-99-99');
  for (const n of [500, 1000, 5000, 10000]) {
    out.push({ id: `pages:${n}`, group: 'pages', tier: n >= 5000 ? 'gold' : n >= 1000 ? 'silver' : 'bronze', name: `${n >= 1000 ? n / 1000 + ' 000' : n} страниц`, desc: 'прочитано всего', have: Math.floor(all.p), need: n });
  }
  for (const [h, name] of [[1, 'Первый час на слух'], [10, 'Десять часов на слух']]) {
    out.push({ id: `listen:${h}`, group: 'listen', tier: h >= 10 ? 'silver' : 'bronze', name, desc: 'прослушано', have: Math.floor(all.l / 60 * 10) / 10, need: h });
  }
  const earned = (store.meta.get('medals') || {}).earned || {};
  for (const m of out) { m.done = m.have >= m.need; m.date = earned[m.id] || null; }
  return out;
}

/** How many medals were earned inside a date range. */
export function medalsIn(from, to) {
  const earned = (store.meta.get('medals') || {}).earned || {};
  return Object.values(earned).filter(d => d >= from && d <= to).length;
}

/** Record medals that have just been reached; returns the new ones (for the celebration). */
export function claimMedals() {
  const doc = store.meta.get('medals') || {};
  const earned = { ...(doc.earned || {}) };
  const fresh = medals().filter(m => m.done && !earned[m.id]);
  if (!fresh.length) return [];
  for (const m of fresh) earned[m.id] = today();
  store.put('meta', 'medals', { earned });
  return fresh;
}
