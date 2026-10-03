// Settings sheet: theme, daily and long-term goals, voice, account, data in and out.
import { $, html, today } from '../util.js';
import { store } from '../store.js';
import { openSheet, updateSheet, toast } from '../ui.js';
import { importFile, backupBlob } from '../data.js';

export const VERSION = '0.1.0';
/** Filled in by sync.js once it has loaded: renders the account block and handles its buttons. */
export const account = { render: null, acts: {}, changed: () => {} };

export function applyTheme() {
  const t = store.ready ? store.settings.theme : 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0F2B24' : '#F4EEDD';
  try { localStorage.setItem('glava-theme', t); } catch (e) { /* private mode */ }
}

const GOALS = [
  ['pages', 'Страниц в день', 5, 300, 5],
  ['minutes', 'Минут в день', 5, 240, 5],
  ['booksMonth', 'Книг в месяц', 0, 30, 1],
  ['booksYear', 'Книг в год', 0, 300, 1],
];

function body() {
  const s = store.settings;
  const seg = (name, value, options) => html`<div class="seg" role="group">${options.map(([k, v]) => html`<button class="${value === k ? 'on' : ''}" data-act="set" data-k="${name}" data-v="${k}">${v}</button>`)}</div>`;
  return html`
<section class="stack"><p class="eyebrow">Оформление</p>${seg('theme', s.theme, [['auto', 'Как в телефоне'], ['light', 'Светлое'], ['dark', 'Тёмное']])}</section>
<section class="stack"><p class="eyebrow">Цели</p>
  ${GOALS.map(([k, label, min, max, step]) => html`<div class="row between"><span>${label}</span>
    <div class="stepper"><button data-act="goal" data-k="${k}" data-d="${-step}" ${s.goals[k] <= min ? 'disabled' : ''} aria-label="Меньше">−</button><output>${s.goals[k] || 'нет'}</output><button data-act="goal" data-k="${k}" data-d="${step}" ${s.goals[k] >= max ? 'disabled' : ''} aria-label="Больше">+</button></div></div>`)}
  <p class="tiny muted">Кольцо страниц и кольцо минут закрываются отдельно. День идёт в зачёт главы, когда закрыто хотя бы одно.</p>
</section>
<section class="stack"><p class="eyebrow">Голос для чтения вслух</p>${seg('voice', s.voice, [['ru_RU-irina-medium', 'Ирина'], ['ru_RU-dmitri-medium', 'Дмитрий'], ['ru_RU-ruslan-medium', 'Руслан']])}
  <p class="tiny muted">Каждый голос скачивается один раз (63 МБ). Скорость настраивается в читалке и запоминается для каждой книги.</p>
  <div class="row between"><span>Тон в конце вопроса</span></div>
  ${seg('lift', String(s.lift), [['0', 'Как есть'], ['0.35', 'Мягко'], ['0.6', 'Сильнее']])}
  <p class="tiny muted">Ирина и Дмитрий читают вопросы ровно, поэтому приложение само поднимает тон в конце. Руслан задаёт вопросы сам, ему это не нужно.</p></section>
${account.render ? html`<section class="stack"><p class="eyebrow">Аккаунт и синхронизация</p>${account.render()}</section>` : ''}
<section class="stack"><p class="eyebrow">Данные</p>
  <div class="row"><button class="btn" data-act="import">Загрузить из файла</button><button class="btn" data-act="export">Сохранить копию</button></div>
  <p class="tiny muted">Копия содержит списки, отметки, цитаты и статистику. Файлы книг в неё не входят.</p>
  <input type="file" id="importFile" accept=".json,application/json" hidden>
</section>
<p class="tiny muted" style="text-align:center">Глава ${VERSION}</p>`;
}

export function openSettings() {
  const refresh = () => updateSheet(body());
  const off = store.on(refresh);
  account.changed = refresh;
  openSheet({
    title: 'Настройки', body: body(), onClose: () => { off(); account.changed = () => {}; },
    acts: {
      set: el => { store.setSettings({ [el.dataset.k]: el.dataset.k === 'lift' ? +el.dataset.v : el.dataset.v }); if (el.dataset.k === 'theme') applyTheme(); },
      goal: el => {
        const [, , min, max] = GOALS.find(g => g[0] === el.dataset.k);
        const cur = store.settings.goals[el.dataset.k];
        store.setSettings({ goals: { [el.dataset.k]: Math.min(max, Math.max(min, cur + +el.dataset.d)) } });
      },
      import: () => $('#importFile').click(),
      export: () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(backupBlob());
        a.download = `glava-${today()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      },
      ...account.acts,
    },
  });
  $('#sheet').onchange = async e => {
    if (e.target.id !== 'importFile' || !e.target.files[0]) return;
    try { toast(await importFile(e.target.files[0])); } catch (err) { toast(err.message); }
    e.target.value = '';
  };
}

/** Open the file picker straight away (for the empty-library shortcut). */
export function pickImport() {
  openSettings();
  $('#importFile').click();
}
