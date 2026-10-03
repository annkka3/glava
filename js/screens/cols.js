// «Подборки»: lists and series with their progress, and the medal shelf.
import { $, html, plural, PL, uid, fmtDay } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { ICON, bar, medal, openSheet, closeSheet, toast } from '../ui.js';
import { bookRow } from './library.js';

const view = { hideRead: false };

/** The best medal a collection has reached so far. */
function badge(id, all) {
  const mine = all.filter(m => m.col === id && m.done);
  const top = mine[mine.length - 1];
  return top ? medal(top.tier, true) : medal('gold', false);
}

export function render() {
  const all = M.medals();
  const earned = all.filter(m => m.done).sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const cols = [...store.cols].map(([id, c]) => ({ id, c, ...M.colProgress(c) }));
  const order = x => (x.read === x.total && x.total ? 2 : x.read ? 0 : 1);
  cols.sort((a, b) => order(a) - order(b) || b.read / (b.total || 1) - a.read / (a.total || 1) || a.c.name.localeCompare(b.c.name, 'ru'));
  return html`<header class="row between">
  <h1 class="display" style="font-size:40px">Подборки</h1>
  <button class="icon-btn" data-act="col-new" aria-label="Новая подборка">${ICON.plus}</button>
</header>
<div class="row"><button class="btn" data-act="next-read">${ICON.dice}Что читать дальше</button></div>
<section class="stack" style="gap:10px">
  <div class="row between"><p class="eyebrow">Медали</p><button class="chip" data-act="medals">${earned.length} из ${all.length}</button></div>
  ${earned.length ? html`<div class="shelf">${earned.slice(0, 12).map(m => html`<button class="stack tight" data-act="medals" style="align-items:flex-start">
    ${medal(m.tier, true)}<span class="tiny" style="font-weight:600">${m.name}</span><span class="tiny muted">${m.desc}</span></button>`)}</div>`
    : html`<p class="small muted">Первая медаль появится за закрытое кольцо три дня подряд или за собранную серию.</p>`}
</section>
<section class="stack" style="gap:10px">
  ${cols.map(x => html`<button class="card col-card" data-act="col" data-id="${x.id}" style="flex-direction:row;align-items:center">
    ${badge(x.id, all)}
    <span class="stack tight grow">
      <span class="h3">${x.c.name}</span>
      <span class="tiny muted">${x.read === x.total && x.total ? 'собрано полностью' : `${x.read} из ${x.total}`}${x.c.kind === 'series' ? ' · серия' : ''}</span>
      ${bar(x.total ? x.read / x.total : 0)}
    </span>
  </button>`)}
  ${cols.length ? '' : html`<div class="empty"><p>Подборок пока нет.</p><button class="btn fit" data-act="import">Загрузить список</button></div>`}
</section>`;
}

export function renderCol(id) {
  const c = store.cols.get(id);
  if (!c) return html`<div class="empty"><p>Такой подборки нет.</p><button class="btn fit" data-act="go" data-to="cols">К подборкам</button></div>`;
  const { read, total } = M.colProgress(c);
  const steps = M.medals().filter(m => m.col === id);
  const items = (c.items || []).map((bid, i) => [bid, store.books.get(bid), i + 1]).filter(([bid, b]) => b && !(view.hideRead && M.isRead(bid)));
  return html`<header class="row top">
  <button class="icon-btn" data-act="go" data-to="cols" aria-label="Назад к подборкам">${ICON.back}</button>
  <div class="stack tight grow">
    <p class="eyebrow">${c.kind === 'series' ? 'Серия' : 'Список'}</p>
    <h1 class="display" style="font-size:34px">${c.name}</h1>
  </div>
  <button class="icon-btn" data-act="col-edit" data-id="${id}" aria-label="Изменить подборку">${ICON.edit}</button>
</header>
${c.desc ? html`<p class="small muted">${c.desc}</p>` : ''}
<section class="card">
  <div class="row between"><span class="numeral" style="font-size:38px;line-height:38px">${read} <small class="muted" style="font-size:20px">из ${total}</small></span>
    <span class="small muted">${total ? Math.round(read / total * 100) : 0} %</span></div>
  ${bar(total ? read / total : 0)}
  <div class="row" style="gap:14px;flex-wrap:wrap">${steps.map(m => html`<div class="stack tight" style="align-items:center;gap:2px">${medal(m.tier, m.done)}<span class="tiny ${m.done ? '' : 'muted'}">${m.need === total ? 'все' : m.need}</span></div>`)}</div>
</section>
<div class="row"><button class="btn" data-act="next-read" data-col="${id}">${ICON.dice}Что читать отсюда</button>
  <button class="chip ${view.hideRead ? 'on' : ''}" data-act="hide-read" style="min-height:46px;border-radius:23px">${view.hideRead ? 'Показать все' : 'Скрыть прочитанное'}</button></div>
<div class="list">${items.map(([bid, b, n]) => bookRow(bid, b, c.ordered ? n : null))}</div>
${items.length ? '' : html`<div class="empty"><p>${total ? 'Здесь всё прочитано.' : 'В подборке пока нет книг. Добавить книгу можно из её карточки.'}</p></div>`}`;
}

function openMedals() {
  const all = M.medals();
  const groups = [['col', 'Серии и списки'], ['streak', 'Главы подряд'], ['books', 'Дочитанные книги'], ['pages', 'Страницы'], ['listen', 'На слух']];
  openSheet({
    title: 'Медали',
    body: html`${groups.map(([g, title]) => {
      const list = all.filter(m => m.group === g).sort((a, b) => Number(b.done) - Number(a.done));
      return list.length ? html`<section class="stack" style="gap:10px"><p class="eyebrow">${title}</p>
<div class="medals">${list.map(m => html`<div>${medal(m.tier, m.done)}<b>${m.name}</b><span class="muted">${m.done ? (m.date ? fmtDay(m.date) : m.desc) : `${m.desc}: ${Math.min(m.have, m.need)} из ${m.need}`}</span></div>`)}</div></section>` : '';
    })}`,
  });
}

function openColForm(id) {
  const c = id ? store.cols.get(id) : null;
  let armed = false;
  openSheet({
    title: c ? 'Изменить подборку' : 'Новая подборка',
    body: html`<label class="field"><span>Название</span><input class="input" id="cName" value="${c ? c.name : ''}" autocomplete="off"></label>
<label class="field"><span>Описание</span><input class="input" id="cDesc" value="${c ? c.desc || '' : ''}" autocomplete="off"></label>
<div class="seg" id="cKind" role="group" aria-label="Вид">${[['list', 'Список'], ['series', 'Серия']].map(([k, v]) => html`<button class="${(c ? c.kind : 'list') === k ? 'on' : ''}" data-act="kind" data-k="${k}">${v}</button>`)}</div>
<div class="row"><button class="btn primary" data-act="save">Сохранить</button>${c ? html`<button class="btn danger" data-act="del">Удалить</button>` : ''}</div>
${c ? html`<p class="tiny muted">Удаляется только подборка. Книги останутся в библиотеке.</p>` : ''}`,
    acts: {
      kind: el => { for (const x of el.parentElement.children) x.classList.toggle('on', x === el); },
      save: () => {
        const name = $('#cName').value.trim();
        if (!name) { $('#cName').focus(); return; }
        const kind = $('#cKind .on').dataset.k, desc = $('#cDesc').value.trim();
        const cid = id || uid();
        store.patch('cols', cid, { name, desc, kind, ordered: c ? c.ordered : kind === 'series', items: c ? c.items : [] });
        closeSheet();
        location.hash = '#col/' + cid;
      },
      del: el => {
        if (!armed) { armed = true; el.textContent = 'Точно удалить?'; return; }
        store.remove('cols', id);
        closeSheet();
        location.hash = '#cols';
        toast('Подборка удалена');
      },
    },
  });
}

export const acts = {
  medals: openMedals,
  'col-new': () => openColForm(null),
  'col-edit': el => openColForm(el.dataset.id),
  'hide-read': () => { view.hideRead = !view.hideRead; return true; },
};
