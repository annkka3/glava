// «Итоги»: pages, time and finished books for a week, a month or a year, with a calendar of lit days.
import { html, today, addDays, parse, toStr, weekday, daysInMonth, MONTHS_NOM, MONTHS_OF, DAYS_SHORT, fmtDay, fmtMin, count, plural, PL, num } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { ICON } from '../ui.js';
import { bookRow } from './library.js';
import { openCard, summaryCard } from '../cards.js';

const view = { mode: 'month', anchor: today() };

function range() {
  const d = parse(view.anchor), y = d.getFullYear(), m = d.getMonth();
  if (view.mode === 'week') {
    const from = addDays(view.anchor, -weekday(view.anchor)), to = addDays(from, 6);
    return { from, to, label: `${fmtDay(from)} – ${fmtDay(to)}` };
  }
  if (view.mode === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y} год` };
  return { from: toStr(new Date(y, m, 1)), to: toStr(new Date(y, m, daysInMonth(y, m))), label: `${MONTHS_NOM[m]} ${y}` };
}

function shift(dir) {
  const d = parse(view.anchor);
  if (view.mode === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (view.mode === 'year') d.setFullYear(d.getFullYear() + dir);
  else d.setMonth(d.getMonth() + dir, 1);
  view.anchor = toStr(d) > today() ? today() : toStr(d);
}

/** Bars of pages per day (or per month in the year view), with the daily goal as a dashed line. */
function chart(r) {
  const goal = store.settings.goals.pages;
  let bars;
  if (view.mode === 'year') {
    const y = parse(r.from).getFullYear();
    bars = MONTHS_NOM.map((name, m) => ({ v: M.totals(toStr(new Date(y, m, 1)), toStr(new Date(y, m, daysInMonth(y, m)))).p, label: name[0], title: name }));
  } else {
    bars = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
      const n = parse(d).getDate();
      bars.push({ v: M.day(d).p, label: view.mode === 'week' ? DAYS_SHORT[weekday(d)] : (n === 1 || n % 5 === 0 ? String(n) : ''), title: fmtDay(d), future: d > today() });
    }
  }
  const W = 320, H = 120, base = 100, max = Math.max(view.mode === 'year' ? 1 : goal, ...bars.map(b => b.v), 1);
  const step = W / bars.length, w = Math.max(3, Math.min(26, step * 0.62));
  const y = v => base - Math.round(v / max * 88);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Страницы по ${view.mode === 'year' ? 'месяцам' : 'дням'}">
${view.mode !== 'year' && goal ? html`<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" style="stroke:var(--line);stroke-dasharray:3 4"/>` : ''}
${bars.map((b, i) => {
    const x = i * step + (step - w) / 2, top = y(b.v);
    return html`${b.v > 0 ? html`<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${base - top}" rx="${Math.min(3, w / 2)}" style="fill:${view.mode !== 'year' && b.v >= goal ? 'var(--ring-a)' : 'var(--track-a)'};stroke:var(--ring-a);stroke-width:1"><title>${b.title}: ${Math.round(b.v)} стр.</title></rect>`
      : html`<rect x="${x.toFixed(1)}" y="${base - 2}" width="${w.toFixed(1)}" height="2" style="fill:var(--line-soft)"/>`}
${b.label ? html`<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${b.label}</text>` : ''}`;
  })}
</svg>`;
}

function calendar(r) {
  const first = parse(r.from), y = first.getFullYear(), m = first.getMonth(), t = today();
  const cells = Array.from({ length: weekday(r.from) }, () => html`<span></span>`);
  for (let n = 1; n <= daysInMonth(y, m); n++) {
    const d = toStr(new Date(y, m, n)), s = M.dayState(d);
    const cls = s.doneP && s.doneM ? 'both' : s.doneP || s.doneM ? 'one' : s.any ? 'any' : '';
    cells.push(html`<button class="d ${cls} ${d === t ? 'today' : ''}" data-act="log" data-date="${d}" ${d > t ? 'disabled' : ''} aria-label="${fmtDay(d)}: ${Math.round(s.p)} стр., ${Math.round(s.m)} мин">${n}</button>`);
  }
  return html`<div class="cal">${DAYS_SHORT.map(w => html`<span class="wd">${w}</span>`)}${cells}</div>
<p class="tiny muted">Залитый день: закрыты оба кольца. Золотой контур: одно кольцо. Тонкий контур: чтение было.</p>`;
}

function summary(r, t, done) {
  if (!t.p && !t.m && !done.length) return '';
  const genres = {};
  for (const [, b] of done) for (const g of (b.genres || []).slice(0, 1)) genres[g] = (genres[g] || 0) + 1;
  const fav = Object.entries(genres).sort((a, b) => b[1] - a[1])[0];
  let bestDay = null;
  for (const [date, d] of store.days) if (date >= r.from && date <= r.to && (!bestDay || (d.p || 0) > bestDay[1])) bestDay = [date, d.p || 0];
  const name = view.mode === 'year' ? `${parse(r.from).getFullYear()} года` : view.mode === 'month' ? MONTHS_OF[parse(r.from).getMonth()] : 'недели';
  const lines = [
    done.length ? `Дочитано: ${count(done.filter(([, b]) => M.countsAsBook(b)).length, PL.books)}.` : '',
    t.p ? `Прочитано ${count(Math.round(t.p), PL.pages)} за ${fmtMin(t.m)}${t.l >= 1 ? `, из них на слух ${fmtMin(t.l)}` : ''}.` : '',
    bestDay && bestDay[1] > 0 ? `Самый читающий день: ${fmtDay(bestDay[0])}, ${count(Math.round(bestDay[1]), PL.pages)}.` : '',
    fav ? `Чаще всего: ${fav[0].toLowerCase()}.` : '',
  ].filter(Boolean);
  return html`<section class="card"><p class="eyebrow">Итоги ${name}</p>${lines.map(l => html`<p>${l}</p>`)}
${view.mode === 'week' ? '' : html`<div class="row"><button class="btn" data-act="card">Карточка итогов</button></div>`}</section>`;
}

/** What goes on the shareable card of the shown month or year. */
function facts() {
  const r = range(), t = M.totals(r.from, r.to), d = parse(r.from), year = view.mode === 'year';
  const done = M.finishedIn(r.from, r.to).filter(([, b]) => M.countsAsBook(b)).reverse();
  const hours = t.m / 60, streakDays = M.bestStreakIn(r.from, r.to), medals = M.medalsIn(r.from, r.to), pages = Math.round(t.p);
  const genres = {};
  for (const [, b] of done) for (const g of (b.genres || []).slice(0, 1)) genres[g] = (genres[g] || 0) + 1;
  const fav = Object.entries(genres).sort((a, b) => b[1] - a[1])[0];
  let bestDay = null;
  for (const [date, x] of store.days) if (date >= r.from && date <= r.to && (!bestDay || (x.p || 0) > bestDay[1])) bestDay = [date, x.p || 0];
  return {
    eyebrow: year ? 'Итоги года' : 'Итоги месяца',
    title: year ? String(d.getFullYear()) : MONTHS_NOM[d.getMonth()],
    sub: year ? 'год в книгах' : String(d.getFullYear()),
    kpis: [
      [done.length, plural(done.length, ['книга', 'книги', 'книг'])],
      [num(pages), plural(pages, PL.pages)],
      hours >= 1 ? [hours.toFixed(hours >= 10 ? 0 : 1).replace('.', ','), 'часов чтения'] : [Math.round(t.m), 'минут чтения'],
      [t.days, plural(t.days, ['день с книгой', 'дня с книгой', 'дней с книгой'])],
      [streakDays, plural(streakDays, ['день подряд', 'дня подряд', 'дней подряд'])],
      [medals, plural(medals, PL.medals)],
    ],
    books: done.map(([, b]) => ({ title: b.title, author: b.author || '' })),
    notes: [fav ? `Чаще всего: ${fav[0].toLowerCase()}` : '', bestDay && bestDay[1] > 0 ? `Самый читающий день: ${fmtDay(bestDay[0])}, ${count(Math.round(bestDay[1]), PL.pages)}` : ''].filter(Boolean),
    file: year ? `glava-${d.getFullYear()}.png` : `glava-${r.from.slice(0, 7)}.png`,
  };
}

export function render() {
  const r = range(), t = M.totals(r.from, r.to), done = M.finishedIn(r.from, r.to);
  const books = done.filter(([, b]) => M.countsAsBook(b)).length;
  const allRead = [...store.books.keys()].filter(id => M.isRead(id)).length;
  const isNow = r.to >= today();
  return html`<header><h1 class="display" style="font-size:40px">Итоги</h1></header>
<div class="seg" role="group" aria-label="Период">${[['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']].map(([k, v]) => html`<button class="${view.mode === k ? 'on' : ''}" data-act="mode" data-m="${k}">${v}</button>`)}</div>
<div class="row between">
  <button class="icon-btn" data-act="shift" data-d="-1" aria-label="Раньше">${ICON.back}</button>
  <p class="h3">${r.label}</p>
  <button class="icon-btn" data-act="shift" data-d="1" ${isNow ? 'disabled' : ''} aria-label="Позже">${ICON.next}</button>
</div>
<div class="kpis">
  <div class="kpi"><b>${num(t.p)}</b><span>страниц</span></div>
  <div class="kpi"><b>${t.m >= 60 ? (t.m / 60).toFixed(1).replace('.', ',') : Math.round(t.m)}</b><span>${t.m >= 60 ? 'часов' : 'минут'}</span></div>
  <div class="kpi"><b>${books}</b><span>книг дочитано</span></div>
</div>
<section class="card">${chart(r)}<p class="tiny muted">Дней с чтением: ${t.days}, с закрытым кольцом: ${t.closed}</p></section>
${view.mode === 'month' ? html`<section class="card">${calendar(r)}</section>` : ''}
${summary(r, t, done)}
<section class="card plain">
  <div class="row between"><span class="small muted">Сейчас подряд</span><span class="numeral" style="font-size:24px">${count(M.streak(), PL.days)}</span></div>
  <div class="divider"></div>
  <div class="row between"><span class="small muted">Лучшая серия</span><span class="numeral" style="font-size:24px">${count(Math.max(M.bestStreak(), M.streak()), PL.days)}</span></div>
  <div class="divider"></div>
  <div class="row between"><span class="small muted">Отмечено прочитанным всего</span><span class="numeral" style="font-size:24px">${num(allRead)}</span></div>
</section>
${done.length ? html`<section class="stack" style="gap:6px"><p class="eyebrow">Дочитано за период</p><div class="list">${done.map(([id, b]) => bookRow(id, b))}</div></section>` : ''}`;
}

export const acts = {
  mode: el => { view.mode = el.dataset.m; return true; },
  shift: el => { shift(+el.dataset.d); return true; },
  card: () => { const f = facts(); openCard({ title: f.eyebrow, file: f.file, make: opts => summaryCard(f, opts) }); },
};
