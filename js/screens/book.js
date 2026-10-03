// Sheets around a single book: its card, manual reading log (paper books, timer), adding a book,
// and the random "what to read next" pick.
import { $, html, today, count, PL, uid, fmtDay, norm } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { files, ACCEPT } from '../files.js';
import { ICON, cover, bar, openSheet, updateSheet, closeSheet, toast } from '../ui.js';

export const KIND = { novel: 'Роман', novella: 'Повесть', story: 'Рассказ', stories: 'Сборник рассказов', play: 'Пьеса', poetry: 'Поэзия', epic: 'Эпос', nonfiction: 'Нон-фикшн', series: 'Цикл' };
export const STATUS = { want: 'Хочу', reading: 'Читаю', read: 'Прочитано', paused: 'Отложено' };
export const GENRES = ['Классика', 'Современная проза', 'Детектив', 'Триллер', 'Шпионский роман', 'Фантастика', 'Фэнтези', 'Антиутопия', 'Приключения',
  'Исторический роман', 'Хоррор', 'Сатира и юмор', 'Детская литература', 'Поэзия', 'Драматургия', 'Эпос и древняя литература', 'Философия', 'Психология',
  'Бизнес', 'Саморазвитие', 'Экономика и финансы', 'Наука', 'История', 'Мемуары и биографии'];

/** Hooks the reader and the file importer register themselves into (they load later). */
export const hooks = { read: null, listen: null, importFile: null };

// ---------- status ----------

export function setStatus(id, status, { dated = true } = {}) {
  const b = store.books.get(id);
  if (!b || b.status === status) return;
  const next = { status, touched: Date.now() };
  if (status === 'reading' && !b.startedAt) next.startedAt = today();
  if (status === 'read') next.finishedAt = dated ? today() : (b.finishedAt || null);
  if (status !== 'read' && b.status === 'read') next.finishedAt = null;
  store.patch('books', id, next);
}

/** The tick in lists: a book in hand is finished today; anything else was read some time ago. */
export function toggleRead(id) {
  const b = store.books.get(id);
  if (!b) return;
  if (b.status === 'read') { setStatus(id, 'want'); return; }
  const wasReading = b.status === 'reading';
  setStatus(id, 'read', { dated: wasReading });
  toast(wasReading ? 'Дочитано сегодня' : 'Отмечено прочитанным, без даты');
}

// ---------- the book card ----------

function bookBody(id) {
  const b = store.books.get(id);
  if (!b) return html`<p class="muted">Книга удалена.</p>`;
  const f = M.bookFraction(b), p = M.plan(b), hasFile = files.has(id);
  const inCols = [...store.cols].filter(([, c]) => (c.items || []).includes(id));
  const otherCols = [...store.cols].filter(([, c]) => !(c.items || []).includes(id));
  const quotes = [...store.quotes].filter(([, q]) => q.book === id).sort((a, b2) => (a[1].at < b2[1].at ? 1 : -1));
  return html`
<div class="row top">
  ${cover(b, 'l')}
  <div class="stack tight grow">
    <p class="h3" style="font-size:26px;line-height:27px">${b.title}</p>
    <p class="muted">${b.author || 'Автор не указан'}</p>
    <p class="tiny muted">${[KIND[b.kind] || '', b.year || '', b.original || ''].filter(Boolean).join(' · ')}</p>
    <div class="wrap" style="gap:6px;margin-top:4px">${(b.genres || []).map(g => html`<span class="tag">${g}</span>`)}</div>
  </div>
</div>
<div class="seg" role="group" aria-label="Статус">${Object.entries(STATUS).map(([k, label]) => html`<button class="${b.status === k ? 'on' : ''}" data-act="status" data-s="${k}">${label}</button>`)}</div>
${b.status === 'read' ? html`
<div class="row between">
  <div class="stars" role="group" aria-label="Оценка">${[1, 2, 3, 4, 5].map(n => html`<button class="${(b.rating || 0) >= n ? 'on' : ''}" data-act="rate" data-n="${n}" aria-label="${n} из 5">${ICON.star}</button>`)}</div>
</div>
<label class="field"><span>Когда дочитана</span><input class="input" type="date" max="${today()}" value="${b.finishedAt || ''}" data-field="finishedAt"></label>` : ''}
${b.status !== 'read' && (f > 0 || b.pages) ? html`<div class="stack tight">${bar(f)}<p class="tiny muted">${Math.round(f * 100)} %${b.pages ? html` · ${Math.round(b.pages * f)} из ${count(b.pages, PL.pages)}` : ''}</p></div>` : ''}
<div class="row">
  ${hasFile ? html`<button class="btn primary" data-act="read">${ICON.book}Читать</button><button class="btn" data-act="listen">${ICON.ear}Слушать</button>`
    : html`<button class="btn primary" data-act="attach">${ICON.file}Добавить файл книги</button>`}
</div>
<div class="row"><button class="btn quiet" data-act="log">${ICON.plus}Отметить страницы</button></div>
<div class="row top">
  <label class="field grow"><span>Страниц в книге</span><input class="input" type="number" inputmode="numeric" min="1" max="9999" value="${b.pages || ''}" placeholder="например, 320" data-field="pages"></label>
  <label class="field grow"><span>Дочитать к</span><input class="input" type="date" min="${today()}" value="${(b.plan && b.plan.by) || ''}" data-field="planBy"></label>
</div>
${p && b.status !== 'read' ? html`<p class="small muted">${p.late ? 'Срок прошёл.' : html`Чтобы успеть к ${p.label}, нужно по ${count(p.perDay, PL.pages)} в день.`}</p>` : ''}
<label class="field"><span>Заметка или отзыв</span><textarea class="input" data-field="note" placeholder="Что запомнилось">${b.note || ''}</textarea></label>
<div class="stack" style="gap:8px">
  <div class="row between"><p class="eyebrow">Цитаты</p><button class="chip" data-act="quote-add">${ICON.plus}добавить</button></div>
  ${quotes.length ? quotes.map(([qid, q]) => html`<div class="card plain" style="padding:12px 14px;gap:6px">
    <p style="font-family:var(--f-display);font-size:19px;line-height:1.3">${q.text}</p>
    ${q.note ? html`<p class="tiny muted">${q.note}</p>` : ''}
    <div class="row between tiny muted"><span>${q.at ? fmtDay(q.at) : ''}${q.where ? ' · ' + q.where : ''}</span><button class="chip" data-act="quote-del" data-id="${qid}">удалить</button></div>
  </div>`) : html`<p class="small muted">Пока нет. В читалке цитата сохраняется выделением текста.</p>`}
</div>
<div class="stack" style="gap:8px">
  <p class="eyebrow">Подборки</p>
  <div class="wrap">${inCols.map(([cid, c]) => html`<button class="chip on" data-act="col-open" data-id="${cid}">${c.name}</button>`)}${inCols.length ? '' : html`<span class="small muted">Книга не входит ни в одну подборку.</span>`}</div>
  ${otherCols.length ? html`<label class="field"><span>Добавить в подборку</span><select class="input" data-field="addCol"><option value="">выбрать…</option>${otherCols.map(([cid, c]) => html`<option value="${cid}">${c.name}</option>`)}</select></label>` : ''}
</div>
${hasFile ? html`<div class="row"><button class="btn quiet" data-act="detach">${ICON.trash}Убрать файл с этого устройства</button></div>` : ''}
<div class="row"><button class="btn quiet" data-act="edit">${ICON.edit}Изменить</button><button class="btn danger" data-act="delete">${ICON.trash}Удалить</button></div>
<input type="file" id="bookFile" accept="${ACCEPT}" hidden>`;
}

export function openBook(id) {
  const refresh = () => updateSheet(bookBody(id));
  const off = store.on(refresh);
  let armed = false;
  openSheet({
    title: 'Книга', body: bookBody(id), onClose: off,
    acts: {
      status: el => setStatus(id, el.dataset.s),
      rate: el => { const b = store.books.get(id), n = +el.dataset.n; store.patch('books', id, { rating: b.rating === n ? 0 : n }); },
      read: () => { if (hooks.read) { closeSheet(); hooks.read(id); } else toast('Читалка ещё загружается'); },
      listen: () => { if (hooks.listen) { closeSheet(); hooks.listen(id); } else toast('Читалка ещё загружается'); },
      attach: () => $('#bookFile').click(),
      detach: async () => { await files.remove(id); refresh(); toast('Файл убран с этого устройства'); },
      log: () => openLog({ book: id }),
      'col-open': el => { closeSheet(); location.hash = '#col/' + el.dataset.id; },
      'quote-add': () => openQuote(id),
      'quote-del': el => store.remove('quotes', el.dataset.id),
      edit: () => openEdit(id),
      delete: el => {
        if (!armed) { armed = true; el.textContent = 'Точно удалить?'; return; }
        for (const [cid, c] of store.cols) if ((c.items || []).includes(id)) store.patch('cols', cid, { items: c.items.filter(x => x !== id) });
        files.remove(id);
        store.remove('books', id);
        closeSheet();
        toast('Книга удалена');
      },
    },
  });
  const dlg = $('#sheet');
  dlg.onchange = async e => {
    const el = e.target, field = el.dataset && el.dataset.field;
    if (el.id === 'bookFile' && el.files[0]) {
      const file = el.files[0];
      if (hooks.importFile) await hooks.importFile(file, id);
      else { await files.attach(id, file); toast('Файл добавлен'); }
      refresh();
      return;
    }
    if (!field) return;
    if (field === 'pages') store.patch('books', id, { pages: Math.max(0, Math.round(+el.value || 0)) || null });
    else if (field === 'planBy') store.patch('books', id, { plan: el.value ? { by: el.value } : null });
    else if (field === 'finishedAt') store.patch('books', id, { finishedAt: el.value || null });
    else if (field === 'note') store.patch('books', id, { note: el.value.trim() });
    else if (field === 'addCol' && el.value) { const c = store.cols.get(el.value); store.patch('cols', el.value, { items: [...(c.items || []), id] }); }
  };
}

// ---------- quotes by hand (paper books) ----------

function openQuote(bookId) {
  openSheet({
    title: 'Новая цитата',
    body: html`<label class="field"><span>Текст</span><textarea class="input" id="qText" style="min-height:140px"></textarea></label>
<label class="field"><span>Страница или глава</span><input class="input" id="qWhere" placeholder="необязательно"></label>
<label class="field"><span>Своя заметка</span><input class="input" id="qNote" placeholder="необязательно"></label>
<div class="row"><button class="btn primary" data-act="save">Сохранить</button></div>`,
    acts: {
      save: () => {
        const text = $('#qText').value.trim();
        if (!text) { $('#qText').focus(); return; }
        store.put('quotes', uid(), { book: bookId, text, where: $('#qWhere').value.trim(), note: $('#qNote').value.trim(), at: today() });
        openBook(bookId);
      },
    },
  });
}

// ---------- add / edit ----------

function form(b = {}) {
  return html`<label class="field"><span>Название</span><input class="input" id="fTitle" value="${b.title || ''}" autocomplete="off"></label>
<label class="field"><span>Автор</span><input class="input" id="fAuthor" value="${b.author || ''}" autocomplete="off"></label>
<div class="row top">
  <label class="field grow"><span>Жанр</span><select class="input" id="fGenre"><option value="">не выбран</option>${GENRES.map(g => html`<option ${b.genres && b.genres[0] === g ? 'selected' : ''}>${g}</option>`)}</select></label>
  <label class="field grow"><span>Вид</span><select class="input" id="fKind">${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${(b.kind || 'novel') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
</div>
<div class="row top">
  <label class="field grow"><span>Страниц</span><input class="input" id="fPages" type="number" inputmode="numeric" min="1" value="${b.pages || ''}"></label>
  <label class="field grow"><span>Год</span><input class="input" id="fYear" type="number" inputmode="numeric" value="${b.year || ''}"></label>
</div>`;
}
function readForm() {
  const title = $('#fTitle').value.trim();
  if (!title) { $('#fTitle').focus(); return null; }
  const genre = $('#fGenre').value;
  return { title, author: $('#fAuthor').value.trim(), genres: genre ? [genre] : [], kind: $('#fKind').value, pages: Math.round(+$('#fPages').value) || null, year: Math.round(+$('#fYear').value) || null };
}

export function openEdit(id) {
  const b = store.books.get(id);
  openSheet({
    title: 'Изменить книгу', body: html`${form(b)}<div class="row"><button class="btn primary" data-act="save">Сохранить</button></div>`,
    acts: { save: () => { const v = readForm(); if (!v) return; const extra = (b.genres || []).slice(1).filter(g => g !== v.genres[0]); store.patch('books', id, { ...v, genres: [...v.genres, ...extra] }); openBook(id); } },
  });
}

export function openAdd() {
  openSheet({
    title: 'Новая книга',
    body: html`<div class="row"><button class="btn primary" data-act="file">${ICON.file}Из файла EPUB или FB2</button></div>
<p class="small muted">Или запиши бумажную книгу вручную:</p>
${form()}
<div class="seg" role="group" aria-label="Статус" id="fStatus">${[['want', 'Хочу прочитать'], ['reading', 'Читаю сейчас']].map(([k, v], i) => html`<button class="${i ? '' : 'on'}" data-act="pick" data-s="${k}">${v}</button>`)}</div>
<div class="row"><button class="btn primary" data-act="save">Добавить</button></div>
<input type="file" id="newFile" accept="${ACCEPT}" hidden>`,
    acts: {
      pick: el => { for (const x of el.parentElement.children) x.classList.toggle('on', x === el); },
      file: () => $('#newFile').click(),
      save: () => {
        const v = readForm();
        if (!v) return;
        const id = uid(), status = $('#fStatus .on').dataset.s;
        store.put('books', id, { ...v, status, custom: true, added: today(), touched: Date.now(), startedAt: status === 'reading' ? today() : null });
        openBook(id);
      },
    },
  });
  $('#sheet').onchange = async e => {
    if (e.target.id !== 'newFile' || !e.target.files[0]) return;
    if (!hooks.importFile) { toast('Читалка ещё загружается, попробуй через пару секунд'); return; }
    const id = await hooks.importFile(e.target.files[0], null);
    if (id) openBook(id);
  };
}

// ---------- manual log and timer ----------

const TIMER_KEY = 'glava-timer';
const timerStart = () => { try { return +localStorage.getItem(TIMER_KEY) || 0; } catch (e) { return 0; } };

export function openLog({ book = '', date = today() } = {}) {
  const reading = M.current();
  const pre = book || (reading[0] && reading[0].id) || '';
  const options = [...reading.map(b => [b.id, b.title])];
  if (pre && !options.some(([id]) => id === pre)) options.unshift([pre, store.books.get(pre).title]);
  let tick = null;
  const clock = () => {
    const el = $('#timerText'), start = timerStart();
    if (!el) return;
    if (!start) { el.textContent = 'Таймер чтения'; return; }
    const sec = Math.floor((Date.now() - start) / 1000);
    el.textContent = `Идёт ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}, остановить`;
  };
  openSheet({
    title: 'Отметить чтение',
    onClose: () => clearInterval(tick),
    body: html`<label class="field"><span>Книга</span><select class="input" id="lBook">${options.map(([id, t]) => html`<option value="${id}" ${id === pre ? 'selected' : ''}>${t}</option>`)}<option value="" ${pre ? '' : 'selected'}>без книги</option></select></label>
<div class="row top">
  <label class="field grow"><span>Страниц</span><input class="input" id="lPages" type="number" inputmode="numeric" min="0" max="2000" placeholder="0"></label>
  <label class="field grow"><span>Минут</span><input class="input" id="lMin" type="number" inputmode="numeric" min="0" max="1440" placeholder="0"></label>
</div>
<div class="row"><button class="btn quiet" data-act="timer" id="timerText">Таймер чтения</button></div>
<label class="field"><span>День</span><input class="input" id="lDate" type="date" max="${today()}" value="${date}"></label>
<div class="row"><button class="btn primary" data-act="save">Сохранить</button></div>`,
    acts: {
      timer: () => {
        const start = timerStart();
        try {
          if (!start) localStorage.setItem(TIMER_KEY, String(Date.now()));
          else {
            localStorage.removeItem(TIMER_KEY);
            $('#lMin').value = Math.max(1, Math.round((Date.now() - start) / 60000) + (+$('#lMin').value || 0));
          }
        } catch (e) { /* private mode: no timer */ }
        clock();
      },
      save: () => {
        const pages = Math.max(0, +$('#lPages').value || 0), minutes = Math.max(0, +$('#lMin').value || 0);
        if (!pages && !minutes) { $('#lPages').focus(); return; }
        const bookId = $('#lBook').value, day = $('#lDate').value || today();
        M.logReading({ date: day, bookId, pages, minutes });
        const b = bookId && store.books.get(bookId);
        if (b) {
          const next = { touched: Date.now() };
          if (b.status === 'want' || b.status === 'paused') { next.status = 'reading'; next.startedAt = b.startedAt || day; }
          if (b.pages && pages) {
            next.page = Math.min(b.pages, (b.page || Math.round(b.pages * M.bookFraction(b))) + pages);
            if (next.page >= b.pages && b.status !== 'read') { next.status = 'read'; next.finishedAt = day; }
          }
          store.patch('books', bookId, next);
          if (next.status === 'read') toast('Книга дочитана');
        }
        closeSheet();
      },
    },
  });
  clock();
  tick = setInterval(clock, 1000);
}

// ---------- what to read next ----------

export function openNext({ col = '' } = {}) {
  const state = { genre: '', col, file: false, id: null };
  const pool = () => [...store.books].filter(([id, b]) => (b.status === 'want' || b.status === 'paused') && b.kind !== 'series'
    && (!state.genre || (b.genres || []).includes(state.genre))
    && (!state.col || (store.cols.get(state.col)?.items || []).includes(id))
    && (!state.file || files.has(id)));
  const roll = () => {
    const list = pool().filter(([id]) => id !== state.id || pool().length === 1);
    state.id = list.length ? list[Math.floor(Math.random() * list.length)][0] : null;
  };
  const genres = [...new Set([...store.books.values()].flatMap(b => b.genres || []))].sort((a, b) => a.localeCompare(b, 'ru'));
  const body = () => {
    const b = state.id && store.books.get(state.id);
    return html`<div class="row top">
  <label class="field grow"><span>Жанр</span><select class="input" data-f="genre"><option value="">любой</option>${genres.map(g => html`<option ${g === state.genre ? 'selected' : ''}>${g}</option>`)}</select></label>
  <label class="field grow"><span>Подборка</span><select class="input" data-f="col"><option value="">любая</option>${[...store.cols].map(([id, c]) => html`<option value="${id}" ${id === state.col ? 'selected' : ''}>${c.name}</option>`)}</select></label>
</div>
<label class="row" style="min-height:44px"><input type="checkbox" data-f="file" ${state.file ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--gold)"><span class="small">Только книги с файлом на этом устройстве</span></label>
${b ? html`<div class="card"><div class="row top">${cover(b, 'l')}<div class="stack tight grow">
    <p class="eyebrow">Случай выбрал</p>
    <p class="h3" style="font-size:25px;line-height:26px">${b.title}</p>
    <p class="muted">${b.author || ''}</p>
    <p class="tiny muted">${[KIND[b.kind] || '', b.year || '', (b.genres || [])[0] || ''].filter(Boolean).join(' · ')}</p>
  </div></div>
  <div class="row"><button class="btn primary" data-act="start">Начать читать</button><button class="btn" data-act="roll">${ICON.dice}Другую</button></div>
  <div class="row"><button class="btn quiet" data-act="open">Открыть карточку</button></div></div>
  <p class="tiny muted" style="text-align:center">Выбираю из ${count(pool().length, PL.books)}</p>`
    : html`<div class="empty"><p>Под такие условия ничего не нашлось.</p></div>`}`;
  };
  roll();
  openSheet({
    title: 'Что читать дальше', body: body(),
    acts: {
      roll: () => { roll(); updateSheet(body()); },
      start: () => { setStatus(state.id, 'reading'); closeSheet(); toast('Книга в работе'); },
      open: () => openBook(state.id),
    },
  });
  $('#sheet').onchange = e => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    state[f] = f === 'file' ? e.target.checked : e.target.value;
    state.id = null;
    roll();
    updateSheet(body());
  };
}

/** Find an existing record for a book file by title and author. */
export function findBook(title, author) {
  const t = norm(title), a = norm(author).split(' ').pop();
  if (!t) return null;
  for (const [id, b] of store.books) {
    if (norm(b.title) !== t) continue;
    if (!a || !b.author || norm(b.author).includes(a)) return id;
  }
  return null;
}
