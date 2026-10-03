// Boot, routing between the four tabs, and one click handler that dispatches every data-act.
import { $, $$, html, setHTML, debounce, today } from './util.js';
import { store } from './store.js';
import { files } from './files.js';
import { persist } from './db.js';
import * as M from './model.js';
import { ICON, medal, initSheet, openSheet, closeSheet, sheetOpen, sheetAct, toast } from './ui.js';
import * as Today from './screens/today.js';
import * as Library from './screens/library.js';
import * as Cols from './screens/cols.js';
import * as Stats from './screens/stats.js';
import { openBook, openLog, openAdd, openNext, toggleRead, hooks } from './screens/book.js';
import { openSettings, pickImport, applyTheme } from './screens/settings.js';

const TABS = [['today', 'Сегодня', ICON.today], ['library', 'Библиотека', ICON.library], ['cols', 'Подборки', ICON.cols], ['stats', 'Итоги', ICON.stats]];
const SCREENS = { today: Today, library: Library, cols: Cols, col: Cols, stats: Stats };

function route() {
  const [name, arg] = (location.hash.slice(1) || 'today').split('/');
  return { name: SCREENS[name] ? name : 'today', arg: arg ? decodeURIComponent(arg) : '' };
}

function render() {
  const r = route();
  const keep = document.activeElement && document.activeElement.id === 'q' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  setHTML($('#view'), r.name === 'col' ? Cols.renderCol(r.arg) : SCREENS[r.name].render());
  const tab = r.name === 'col' ? 'cols' : r.name;
  for (const b of $$('#tabs button')) {
    if (b.dataset.to === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (keep && $('#q')) { $('#q').focus(); $('#q').setSelectionRange(keep[0], keep[1]); }
}

const acts = {
  go: el => { location.hash = '#' + el.dataset.to; },
  settings: () => openSettings(),
  import: () => pickImport(),
  log: el => openLog({ book: el.dataset.book || '', date: el.dataset.date || today() }),
  book: el => openBook(el.dataset.id),
  tick: el => toggleRead(el.dataset.id),
  col: el => { closeSheet(); location.hash = '#col/' + encodeURIComponent(el.dataset.id); },
  'add-book': () => openAdd(),
  'next-read': el => openNext({ col: el.dataset.col || '' }),
  read: el => (hooks.read ? hooks.read(el.dataset.id) : toast('Читалка ещё загружается')),
  listen: el => (hooks.listen ? hooks.listen(el.dataset.id) : toast('Читалка ещё загружается')),
  attach: el => { openBook(el.dataset.id); $('#bookFile').click(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const name = el.dataset.act;
  if (name === 'sheet-close') { closeSheet(); return; }
  const inSheet = !!el.closest('#sheet');
  const fn = (inSheet && sheetAct(name)) || (!inSheet && SCREENS[route().name].acts && SCREENS[route().name].acts[name]) || acts[name];
  if (fn && fn(el, e) === true) render();
});
for (const type of ['input', 'change']) {
  document.addEventListener(type, e => {
    if (route().name === 'library' && !e.target.closest('#sheet') && Library.onInput(e)) render();
  });
}

function celebrate(fresh) {
  if (sheetOpen()) { toast(fresh.length > 1 ? `Новые медали: ${fresh.length}` : `Новая медаль: ${fresh[0].name}`); return; }
  openSheet({
    title: fresh.length > 1 ? 'Новые медали' : 'Новая медаль',
    body: fresh.length === 1
      ? html`<div class="stack cheer">${medal(fresh[0].tier, true, 'l')}<p class="h3" style="font-size:26px">${fresh[0].name}</p><p class="muted">${fresh[0].desc}</p></div>
<div class="row"><button class="btn primary" data-act="sheet-close">Отлично</button></div>`
      : html`<div class="medals">${fresh.map(m => html`<div>${medal(m.tier, true)}<b>${m.name}</b><span class="muted">${m.desc}</span></div>`)}</div>
<div class="row"><button class="btn primary" data-act="sheet-close">Отлично</button></div>`,
  });
}
const checkMedals = debounce(() => { const fresh = M.claimMedals(); if (fresh.length) celebrate(fresh); }, 500);

async function boot() {
  initSheet();
  setHTML($('#tabs'), html`<div class="in">${TABS.map(([to, label, icon]) => html`<button data-act="go" data-to="${to}">${icon}${label}</button>`)}</div>`);
  await store.init();
  await files.init();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  render();
  store.on(() => { render(); checkMedals(); });
  window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
  // A day that rolls over while the app is open: redraw when it comes back to the front.
  let shown = today();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && shown !== today()) { shown = today(); render(); } });
  persist();
  if (location.hostname === 'localhost') window.glava = { store, hooks, files }; // handle for local testing
  import('./reader/reader.js').then(m => m.install(hooks)).catch(() => {});
  import('./sync.js').then(m => m.start()).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
