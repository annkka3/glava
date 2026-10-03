// All bookmarks and all quotes across the library, for browsing outside the reader.
import { html, fmtDay } from '../util.js';
import { store } from '../store.js';
import { openSheet, updateSheet, closeSheet, toast } from '../ui.js';
import { openCard, quoteCard } from '../cards.js';
import { hooks, readable, openBook } from './book.js';

const clip = (t, n) => (t.length > n ? t.slice(0, n).trimEnd() + '…' : t);

/** Bookmarks live on the record that owns the file: [{book, i, mark}], newest first. */
function allMarks() {
  const out = [];
  for (const [id, b] of store.books) (b.marks || []).forEach((m, i) => out.push({ book: id, b, i, m }));
  return out.sort((x, y) => (x.m.at < y.m.at ? 1 : x.m.at > y.m.at ? -1 : y.m.f - x.m.f));
}

function allQuotes() {
  return [...store.quotes].map(([id, q]) => ({ id, q, b: store.books.get(q.book) })).filter(x => x.b)
    .sort((x, y) => ((x.q.at || '') < (y.q.at || '') ? 1 : -1));
}

/** Open the reader at a place, or the book's card when its file is not on this device. */
function go(bookId, cfi) {
  closeSheet();
  if (cfi && readable(bookId) && hooks.read) hooks.read(bookId, cfi);
  else { openBook(bookId); if (cfi) toast('Файла книги нет на этом устройстве'); }
}

/** Group a list by book, keeping the order in which books first appear. */
function byBook(list) {
  const groups = new Map();
  for (const x of list) { const id = x.q ? x.q.book : x.book; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(x); }
  return [...groups];
}

export function openMarks() {
  const body = () => {
    const list = allMarks();
    if (!list.length) return html`<div class="empty"><p>Закладок пока нет. В читалке закладка ставится значком закладки вверху страницы.</p></div>`;
    return html`${byBook(list).map(([id, items]) => html`<section class="stack" style="gap:4px">
  <p class="eyebrow">${items[0].b.title}</p>
  <div class="toc">${items.map(x => html`<div class="row" style="border-bottom:1px solid var(--line-soft)">
    <button class="grow" data-act="go" data-id="${id}" data-i="${x.i}" style="text-align:left;padding:10px 0;min-height:44px">
      <span class="tiny muted">${[x.m.label, x.m.at ? fmtDay(x.m.at) : ''].filter(Boolean).join(' · ')}</span>
      <span style="display:block">${clip(x.m.text || 'Без текста', 140)}</span></button>
    <button class="chip" data-act="del" data-id="${id}" data-i="${x.i}">убрать</button></div>`)}</div>
</section>`)}`;
  };
  openSheet({
    title: 'Мои закладки', body: body(),
    acts: {
      go: el => { const m = (store.books.get(el.dataset.id).marks || [])[+el.dataset.i]; if (m) go(el.dataset.id, m.cfi); },
      del: el => {
        const b = store.books.get(el.dataset.id), marks = [...(b.marks || [])];
        marks.splice(+el.dataset.i, 1);
        store.patch('books', el.dataset.id, { marks });
        updateSheet(body());
      },
    },
  });
}

export function openQuotes() {
  const body = () => {
    const list = allQuotes();
    if (!list.length) return html`<div class="empty"><p>Цитат пока нет. В читалке выдели текст и нажми «Сохранить цитату», для бумажной книги цитата добавляется в её карточке.</p></div>`;
    return html`<p class="tiny muted">Всего ${list.length}</p>${byBook(list).map(([id, items]) => html`<section class="stack" style="gap:8px">
  <p class="eyebrow">${items[0].b.title}${items[0].b.author ? ' · ' + items[0].b.author : ''}</p>
  ${items.map(x => html`<div class="card plain" style="padding:12px 14px;gap:6px">
    <button data-act="go" data-id="${x.id}" style="text-align:left"><span style="font-family:var(--f-display);font-size:19px;line-height:1.3">${x.q.text}</span></button>
    ${x.q.note ? html`<p class="tiny muted">${x.q.note}</p>` : ''}
    <div class="row between tiny muted"><span>${[x.q.at ? fmtDay(x.q.at) : '', x.q.where || ''].filter(Boolean).join(' · ')}</span>
      <span class="row" style="gap:6px"><button class="chip" data-act="card" data-id="${x.id}">картинкой</button></span></div>
  </div>`)}
</section>`)}`;
  };
  openSheet({
    title: 'Мои цитаты', body: body(),
    acts: {
      go: el => { const q = store.quotes.get(el.dataset.id); if (q) go(q.book, q.cfi); },
      card: el => {
        const q = store.quotes.get(el.dataset.id), b = store.books.get(q.book);
        openCard({ title: 'Цитата картинкой', file: 'glava-citata.png', make: opts => quoteCard({ text: q.text, title: b.title, author: b.author || '' }, opts), onClose: openQuotes });
      },
    },
  });
}
