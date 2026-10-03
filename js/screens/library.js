// «Библиотека»: every book and story, with search, status / genre / collection filters and sorting.
import { $, html, setHTML, norm, plural, PL, num } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { ICON, cover } from '../ui.js';
import { STATUS, KIND } from './book.js';

export const filter = { q: '', status: '', genre: '', col: '', sort: 'author', limit: 60 };

const surname = b => {
  const first = (b.author || '').split(',')[0].trim().split(/\s+/);
  return (first[first.length - 1] || 'яя').toLowerCase().replace(/ё/g, 'е');
};
const SORT = {
  author: (a, b) => surname(a[1]).localeCompare(surname(b[1]), 'ru') || a[1].title.localeCompare(b[1].title, 'ru'),
  title: (a, b) => a[1].title.localeCompare(b[1].title, 'ru'),
  recent: (a, b) => (b[1].touched || b[1].u || 0) - (a[1].touched || a[1].u || 0),
  year: (a, b) => (a[1].year || 9999) - (b[1].year || 9999),
};

function selected() {
  const q = norm(filter.q);
  const inCol = filter.col ? new Set(store.cols.get(filter.col)?.items || []) : null;
  return [...store.books].filter(([id, b]) => {
    if (filter.status && (filter.status === 'read' ? !M.isRead(id) : b.status !== filter.status)) return false;
    if (filter.genre && !(b.genres || []).includes(filter.genre)) return false;
    if (inCol && !inCol.has(id)) return false;
    return !q || norm(`${b.title} ${b.author || ''} ${b.original || ''}`).includes(q);
  }).sort(SORT[filter.sort] || SORT.author);
}

/** One list row: tap the text to open the card, tap the circle to tick the book off. */
export function bookRow(id, b, n = null) {
  const read = M.isRead(id), state = read ? 'read' : b.status === 'reading' ? 'reading' : '';
  return html`<div class="book">
  ${n != null ? html`<span class="n">${n}</span>` : ''}
  <button class="row grow" data-act="book" data-id="${id}" style="text-align:left;min-height:54px">
    ${cover(b, 's')}
    <span class="stack tight grow" style="gap:1px"><span class="t">${b.title}</span><span class="a">${[b.author, b.kind === 'story' || b.kind === 'series' || b.kind === 'play' ? KIND[b.kind].toLowerCase() : ''].filter(Boolean).join(' · ')}</span></span>
  </button>
  <button class="mark ${state}" data-act="tick" data-id="${id}" aria-label="${read ? 'Прочитано. Снять отметку' : 'Отметить прочитанным'}" aria-pressed="${read}"><i>${ICON.check}</i></button>
</div>`;
}

function listPart() {
  const rows = selected();
  return html`<p class="tiny muted">${rows.length === store.books.size ? `Всего ${num(rows.length)}` : `Найдено ${num(rows.length)} из ${num(store.books.size)}`}</p>
<div class="list">${rows.slice(0, filter.limit).map(([id, b]) => bookRow(id, b))}</div>
${rows.length > filter.limit ? html`<div class="row"><button class="btn quiet" data-act="more">Показать ещё ${Math.min(120, rows.length - filter.limit)}</button></div>` : ''}
${rows.length ? '' : html`<div class="empty"><p>Ничего не нашлось.</p><button class="btn fit" data-act="reset-filter">Сбросить фильтры</button></div>`}`;
}

export function render() {
  const genres = [...new Set([...store.books.values()].flatMap(b => b.genres || []))].sort((a, b) => a.localeCompare(b, 'ru'));
  const chip = (value, label) => html`<button class="chip ${filter.status === value ? 'on' : ''}" data-act="f-status" data-v="${value}">${label}</button>`;
  return html`<header class="row between">
  <h1 class="display" style="font-size:40px">Библиотека</h1>
  <button class="icon-btn" data-act="add-book" aria-label="Добавить книгу">${ICON.plus}</button>
</header>
<label class="search">${ICON.search}<input id="q" type="search" placeholder="Название или автор" value="${filter.q}" autocomplete="off" enterkeyhint="search" aria-label="Поиск по библиотеке"></label>
<div class="chips" role="group" aria-label="Статус">${chip('', 'Все')}${Object.entries(STATUS).map(([k, v]) => chip(k, v))}</div>
<div class="row top">
  <label class="field grow"><span>Жанр</span><select class="input" data-f="genre"><option value="">все</option>${genres.map(g => html`<option ${g === filter.genre ? 'selected' : ''}>${g}</option>`)}</select></label>
  <label class="field grow"><span>Подборка</span><select class="input" data-f="col"><option value="">все</option>${[...store.cols].map(([id, c]) => html`<option value="${id}" ${id === filter.col ? 'selected' : ''}>${c.name}</option>`)}</select></label>
</div>
<label class="field"><span>Порядок</span><select class="input" data-f="sort">${[['author', 'по автору'], ['title', 'по названию'], ['year', 'по году'], ['recent', 'сначала недавние']].map(([k, v]) => html`<option value="${k}" ${k === filter.sort ? 'selected' : ''}>${v}</option>`)}</select></label>
<div id="libList" class="stack">${listPart()}</div>`;
}

export const acts = {
  'f-status': el => { filter.status = el.dataset.v; filter.limit = 60; return true; },
  more: () => { filter.limit += 120; return true; },
  'reset-filter': () => { Object.assign(filter, { q: '', status: '', genre: '', col: '', limit: 60 }); return true; },
};

/** Typing in the search box redraws only the list, so the keyboard stays up. */
export function onInput(e) {
  if (e.target.id === 'q') { filter.q = e.target.value; filter.limit = 60; setHTML($('#libList'), listPart()); return false; }
  const f = e.target.dataset && e.target.dataset.f;
  if (f && e.type === 'change') { filter[f] = e.target.value; filter.limit = 60; return true; }
  return false;
}
