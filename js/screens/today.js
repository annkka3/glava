// «Сегодня»: the streak as a chapter number, today's rings, the book in hand, goals and a few collections.
import { html, today, fmtDayFull, roman, count, PL, plural, addDays, weekday, DAYS_SHORT, MONTHS_OF, num } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { files } from '../files.js';
import { ICON, rings, cover, bar, medal } from '../ui.js';

const ORD = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый',
  'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый', 'двадцатый'];

function head(s) {
  const n = M.streak(), closed = s.doneP || s.doneM;
  const title = n ? `Глава ${roman(n)}` : 'Новая глава';
  const sub = !n ? `прочитай сегодня ${count(s.gp, PL.pages)}, и она начнётся`
    : closed ? `${ORD[n] || n + '-й'} день чтения подряд`
      : `${count(n, PL.days)} подряд, сегодняшнее кольцо ещё открыто`;
  return html`<header class="row top between">
  <div class="stack tight grow">
    <p class="eyebrow">${fmtDayFull(today())}</p>
    <h1 class="display">${title}</h1>
    <p class="small muted">${sub}</p>
  </div>
  <button class="icon-btn" data-act="settings" aria-label="Настройки">${ICON.gear}</button>
</header>`;
}

function week() {
  const t = today(), monday = addDays(t, -weekday(t));
  return html`<div class="week" role="group" aria-label="Эта неделя">${DAYS_SHORT.map((label, i) => {
    const d = addDays(monday, i), s = M.dayState(d);
    return html`<button class="${d === t ? 'is-today' : ''}" data-act="log" data-date="${d}" ${d > t ? 'disabled' : ''} aria-label="${fmtDayFull(d)}: ${Math.round(s.p)} стр., ${Math.round(s.m)} мин">
      <span class="dot">${rings(s.fp, s.fm, 30)}</span>${label}</button>`;
  })}</div>`;
}

function ringBlock(s) {
  const leftP = Math.max(0, Math.ceil(s.gp - s.p)), leftM = Math.max(0, Math.ceil(s.gm - s.m));
  const rest = !leftP && !leftM ? 'Оба кольца закрыты'
    : `До цели дня: ${[leftP ? count(leftP, PL.pages) : '', leftM ? count(leftM, PL.minutes) : ''].filter(Boolean).join(' и ')}`;
  return html`<section class="row" aria-label="Кольца дня">
  ${rings(s.fp, s.fm, 188, html`<b>${Math.round(s.p)}</b><span>из ${s.gp} ${plural(s.gp, PL.pages)}</span>`)}
  <div class="stack grow">
    <div class="stack tight">
      <div class="stat-label" style="color:var(--accent)"><i style="background:var(--ring-a)"></i>Страницы</div>
      <div class="stat-num">${Math.round(s.p)} <small>из ${s.gp}</small></div>
    </div>
    <div class="stack tight">
      <div class="stat-label"><i style="background:var(--ring-b)"></i>Минуты</div>
      <div class="stat-num">${Math.round(s.m)} <small>из ${s.gm}</small></div>
    </div>
    <p class="tiny muted">${rest}</p>
  </div>
</section>`;
}

function bookCard() {
  const [b, ...others] = M.current();
  if (!b) {
    return html`<section class="card">
  <p class="eyebrow">Читаю сейчас</p>
  <p class="h3">Пока ни одной книги в работе</p>
  <p class="small muted">Выбери книгу в библиотеке или доверься случаю.</p>
  <div class="row"><button class="btn primary" data-act="go" data-to="library">В библиотеку</button><button class="btn" data-act="next-read">${ICON.dice}Что читать</button></div>
</section>`;
  }
  const f = M.bookFraction(b), p = M.plan(b);
  const left = b.pages ? Math.max(0, Math.round(b.pages * (1 - f))) : 0;
  const meta = [`${Math.round(f * 100)} % книги`, left ? `осталось ${count(left, PL.pages)}` : ''].filter(Boolean);
  return html`<section class="card">
  <button class="row top" data-act="book" data-id="${b.id}" style="text-align:left">
    ${cover(b)}
    <div class="stack tight grow">
      <p class="eyebrow">Читаю сейчас</p>
      <p class="h3" style="font-size:23px;line-height:24px">${b.title}</p>
      <p class="small muted">${b.author || ''}</p>
    </div>
  </button>
  <div class="stack tight">${bar(f)}<div class="row between tiny muted"><span>${meta[0]}</span><span>${meta[1] || ''}</span></div></div>
  ${p ? html`<p class="tiny muted">${p.late ? 'Срок по плану прошёл: ' : 'План: '}${p.left ? html`к ${p.label} по ${count(p.perDay, PL.pages)} в день` : 'книга дочитана'}</p>` : ''}
  <div class="row">
    ${files.has(b.id) ? html`<button class="btn primary" data-act="read" data-id="${b.id}">Читать</button><button class="btn" data-act="listen" data-id="${b.id}">${ICON.ear}Слушать</button>`
      : html`<button class="btn primary" data-act="log" data-book="${b.id}">Отметить страницы</button><button class="btn" data-act="attach" data-id="${b.id}">${ICON.file}Файл</button>`}
  </div>
  ${others.length ? html`<div class="divider"></div><div class="stack tight">${others.slice(0, 3).map(o => html`<button class="row" data-act="book" data-id="${o.id}" style="text-align:left;min-height:44px">
    <span class="grow small">${o.title}</span><span class="tiny muted">${Math.round(M.bookFraction(o) * 100)} %</span></button>`)}</div>` : ''}
</section>`;
}

function goals() {
  const g = M.monthGoal(), y = M.yearGoal();
  if (!g.goal && !y.goal) return '';
  const state = { done: 'цель месяца закрыта', ontrack: 'идёшь по плану', behind: 'чуть отстаёшь от плана' }[g.state];
  const pips = g.goal && g.goal <= 8 ? html`<div class="pips" aria-hidden="true">${Array.from({ length: g.goal }, (_, i) => html`<i class="${i < g.done ? 'on' : ''}"></i>`)}</div>` : '';
  return html`<section class="card plain" style="padding:12px 16px">
  <div class="row between">
    <div class="stack tight grow">
      <p class="eyebrow">Цель ${MONTHS_OF[g.month]}</p>
      <p class="small" style="color:var(--ink)">${g.goal ? html`${Math.min(g.done, 99)} из ${g.goal} ${plural(g.goal, PL.books)}, ${state}` : 'не задана'}</p>
    </div>
    ${pips}
  </div>
  ${y.goal ? html`<div class="stack tight">${bar(y.done / y.goal)}<p class="tiny muted">${y.year} год: ${y.done} из ${y.goal}${y.done >= y.goal ? ', цель года закрыта' : y.ahead > 0 ? `, с опережением на ${y.ahead}` : `, до цели ${y.goal - y.done}`}</p></div>` : ''}
</section>`;
}

function collections() {
  const all = [...store.cols].map(([id, c]) => ({ id, c, ...M.colProgress(c) })).filter(x => x.total);
  if (!all.length) return '';
  const doneOnes = all.filter(x => x.read === x.total);
  const open = all.filter(x => x.read < x.total && x.read > 0).sort((a, b) => b.read / b.total - a.read / a.total);
  const pick = [...doneOnes.slice(0, 1), ...open].slice(0, 3);
  if (pick.length < 3) pick.push(...all.filter(x => !pick.includes(x)).slice(0, 3 - pick.length));
  return html`<section class="stack" style="gap:8px">
  <div class="row between"><h2 class="h2" style="font-size:20px">Подборки</h2><button class="chip" data-act="go" data-to="cols">все ${all.length}</button></div>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${pick.map(x => html`<button class="card" data-act="col" data-id="${x.id}" style="padding:10px;gap:4px;border-radius:14px">
    ${x.read === x.total ? medal('gold', true, '') : html`<span class="numeral" style="font-size:24px;line-height:26px;color:var(--accent)">${x.read} <small class="muted" style="font-size:15px">/ ${x.total}</small></span>`}
    <span class="tiny" style="font-weight:500">${x.c.name}</span>
    ${x.read === x.total ? html`<span class="tiny" style="color:var(--accent)">собрано</span>` : bar(x.read / x.total)}
  </button>`)}</div>
</section>`;
}

export function render() {
  const s = M.dayState(today());
  const total = store.books.size;
  return html`${head(s)}${week()}${ringBlock(s)}
<div class="row"><button class="btn quiet" data-act="log">${ICON.plus}Отметить чтение</button></div>
${total ? html`${bookCard()}${goals()}${collections()}` : html`<section class="card">
  <p class="h3">Библиотека пока пуста</p>
  <p class="small muted">Загрузи свой список книг из файла или добавь первую книгу вручную.</p>
  <div class="row"><button class="btn primary" data-act="import">Загрузить список</button><button class="btn" data-act="add-book">Добавить книгу</button></div>
</section>`}
<p class="tiny muted" style="text-align:center">${total ? `В библиотеке ${num(total)} ${plural(total, PL.works)}` : ''}</p>`;
}
