// The reader: opens a book file with foliate-js, applies the reading settings, tracks progress,
// pages and minutes, saves quotes from selected text, and hosts the listening bar.
import { $, html, raw, setHTML, today, count, plural, PL, uid, debounce } from '../util.js';
import { store } from '../store.js';
import * as M from '../model.js';
import { files } from '../files.js';
import { ICON, openSheet, updateSheet, closeSheet, toast } from '../ui.js';
import { setStatus, findBook } from '../screens/book.js';
import { applyTheme } from '../screens/settings.js';
import { makeBook } from '../../vendor/foliate-js/view.js';
import { Overlayer } from '../../vendor/foliate-js/overlayer.js';
import { Speaker, unlock } from './speak.js';
import { scan, partAt } from './omnibus.js';

const THEMES = {
  paper: { name: 'Бумага', bg: '#F4EEDD', fg: '#1E2B26', muted: '#5F6A63', accent: '#7A5C12', line: 'rgba(122,92,18,.3)', dark: false },
  white: { name: 'Белая', bg: '#FFFFFF', fg: '#1B1B1B', muted: '#6B6B6B', accent: '#7A5C12', line: 'rgba(0,0,0,.14)', dark: false },
  sepia: { name: 'Сепия', bg: '#F1E3C6', fg: '#3B2E1E', muted: '#77664D', accent: '#8A5A1B', line: 'rgba(59,46,30,.2)', dark: false },
  gray: { name: 'Серая', bg: '#48494B', fg: '#E8E6E1', muted: '#B9B7B0', accent: '#E3C272', line: 'rgba(255,255,255,.16)', dark: true },
  night: { name: 'Ночная', bg: '#0F2B24', fg: '#E9E1CC', muted: '#A9B8A9', accent: '#D8B25A', line: 'rgba(216,178,90,.3)', dark: true },
  black: { name: 'Чёрная', bg: '#000000', fg: '#C8C6C0', muted: '#8F8D87', accent: '#D8B25A', line: 'rgba(255,255,255,.16)', dark: true },
};
const FONTS = {
  literata: ['Литерата', "'Literata', Georgia, serif"],
  charter: ['Чартер', "Charter, 'Bitstream Charter', Georgia, serif"],
  georgia: ['Георгия', "Georgia, 'Times New Roman', serif"],
  newyork: ['Нью-Йорк', "ui-serif, 'New York', Georgia, serif"],
  sans: ['Без засечек', "'Onest', system-ui, -apple-system, 'Helvetica Neue', sans-serif"],
  book: ['Как в книге', ''],
};
const GAPS = { narrow: '4%', normal: '7%', wide: '11%' };
const RICON = {
  list: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg>'),
  mark: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.6L7 20z"/></svg>'),
  prev: raw('<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>'),
  next: raw('<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>'),
};
const FB2_GENRE = [[/det|crime/, 'Детектив'], [/thriller/, 'Триллер'], [/fantasy/, 'Фэнтези'], [/^sf|sf_/, 'Фантастика'], [/horror/, 'Хоррор'], [/adv/, 'Приключения'],
  [/classic/, 'Классика'], [/prose_history|historical/, 'Исторический роман'], [/poetry/, 'Поэзия'], [/dramaturgy/, 'Драматургия'], [/humor/, 'Сатира и юмор'],
  [/child/, 'Детская литература'], [/psy/, 'Психология'], [/business|economics|banking/, 'Бизнес'], [/philosophy/, 'Философия'], [/sci_history|history/, 'История'],
  [/biograph|memoir/, 'Мемуары и биографии'], [/antique/, 'Эпос и древняя литература'], [/sci_|science/, 'Наука'], [/prose|love/, 'Современная проза']];

// The open file. R.host is the record that owns the file; R.id is the record being read right now:
// the same one for an ordinary book, or one of the works inside a collected volume (R.part).
let R = null;

const themeOf = r => THEMES[r.theme] || THEMES[document.documentElement.dataset.theme === 'light' ? 'paper' : 'night'];
const fontOf = r => FONTS[r.font] || FONTS.literata;
const rateText = rate => rate.toFixed(1).replace('.', ',') + '×';

// ---------- importing a file ----------

const text = x => (typeof x === 'string' ? x : !x ? '' : x.name ? text(x.name) : typeof x === 'object' ? text(Object.values(x)[0]) : String(x));

async function thumb(blob) {
  const bmp = await createImageBitmap(blob);
  const w = 160, h = Math.round(bmp.height / bmp.width * w);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.72);
}

/** Read a book file, work out its length in pages, and attach it to a record (existing or new). */
async function importFile(file, bookId) {
  toast('Разбираю книгу…');
  let book;
  try { book = await makeBook(file); } catch (err) { toast('Этот файл не получилось открыть'); return null; }
  const meta = book.metadata || {};
  const title = text(meta.title).trim() || file.name.replace(/\.[^.]+$/, '');
  const author = [].concat(meta.author || []).map(text).filter(Boolean).join(', ');
  let chars = 0;
  for (const s of book.sections) {
    if (s.linear === 'no' || !s.createDocument) continue;
    try { const doc = await s.createDocument(); chars += ((doc.body || doc.documentElement).textContent || '').replace(/\s+/g, ' ').length; } catch (e) { /* skip a broken chapter */ }
  }
  const pages = Math.max(1, Math.round(chars / M.PAGE_CHARS));
  let cv = null;
  try { const blob = book.getCover && await book.getCover(); if (blob) cv = await thumb(blob); } catch (e) { /* no cover */ }
  const id = bookId || findBook(title, author) || uid();
  const cur = store.books.get(id);
  await files.attach(id, file);
  if (cur) {
    store.patch('books', id, { pages: cur.pages || pages, chars, fmt: 'e', ...(cv ? { cv } : {}), touched: Date.now() });
  } else {
    const subjects = [].concat(meta.subject || []).map(text).join(' ').toLowerCase();
    const genre = (FB2_GENRE.find(([re]) => re.test(subjects)) || [])[1];
    store.put('books', id, { title, author, kind: 'novel', genres: genre ? [genre] : [], status: 'want', custom: true, added: today(), pages, chars, fmt: 'e', cv, touched: Date.now() });
  }
  let found = null;
  try { found = await scan(id, book); } catch (e) { /* no usable contents: an ordinary book */ }
  if (found && found.linked.length) toast(`В файле найдено произведений из твоей библиотеки: ${found.linked.length}`);
  else toast(cur ? 'Файл добавлен к книге' : 'Книга добавлена в библиотеку');
  return id;
}

/** Look again for separate works inside a file that is already in the library. */
async function rescan(id) {
  const file = await files.get(id);
  if (!file) return null;
  return scan(id, await makeBook(file));
}

// ---------- look ----------

function bookCSS(r, th) {
  const base = new URL('../../fonts/', import.meta.url).href;
  const cyr = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
  const lat = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const face = (family, file, style, range) => `@font-face{font-family:'${family}';font-style:${style};font-weight:400 700;src:url(${base}${file}) format('woff2');unicode-range:${range}}`;
  const family = fontOf(r)[1];
  return `@namespace epub "http://www.idpf.org/2007/ops";
${face('Literata', 'literata-cyrillic.woff2', 'normal', cyr)}${face('Literata', 'literata-latin.woff2', 'normal', lat)}
${face('Literata', 'literata-italic-cyrillic.woff2', 'italic', cyr)}${face('Literata', 'literata-italic-latin.woff2', 'italic', lat)}
${face('Onest', 'onest-cyrillic.woff2', 'normal', cyr)}${face('Onest', 'onest-latin.woff2', 'normal', lat)}
html{color-scheme:${th.dark ? 'dark' : 'light'};background:${th.bg} !important;color:${th.fg} !important;font-size:${r.size}px !important;-webkit-text-size-adjust:none}
body{background:none !important;color:inherit !important;${family ? `font-family:${family} !important;` : ''}}
${family ? 'p,div,span,li,blockquote,dd,dt,td,h1,h2,h3,h4,h5,h6,a,em,i,b,strong,cite{font-family:inherit !important}' : ''}
p,li,blockquote,dd{line-height:${r.line} !important;text-align:${r.justify ? 'justify' : 'start'};-webkit-hyphens:${r.justify ? 'auto' : 'manual'};hyphens:${r.justify ? 'auto' : 'manual'};hanging-punctuation:allow-end last;widows:2;orphans:2}
p,div,span,li,blockquote,dd,dt,td,h1,h2,h3,h4,h5,h6,em,i,b,strong{color:inherit !important;background-color:transparent !important}
a:link,a:visited{color:${th.accent} !important}
[align="left"]{text-align:left}[align="right"]{text-align:right}[align="center"]{text-align:center}[align="justify"]{text-align:justify}
pre{white-space:pre-wrap !important}
img,svg{max-width:100%}
::selection{background:rgba(216,178,90,.42)}
aside[epub|type~="endnote"],aside[epub|type~="footnote"],aside[epub|type~="note"],aside[epub|type~="rearnote"]{display:none}`;
}

function applyLook() {
  if (!R) return;
  R.sp = new Map();
  const r = store.settings.reader, th = themeOf(r), el = $('#reader'), v = R.view.renderer;
  for (const [k, val] of [['--r-bg', th.bg], ['--r-fg', th.fg], ['--r-muted', th.muted], ['--r-accent', th.accent], ['--r-line', th.line]]) el.style.setProperty(k, val);
  v.setAttribute('flow', r.flow === 'scrolled' ? 'scrolled' : 'paginated');
  v.setAttribute('gap', GAPS[r.margins] || GAPS.normal);
  v.setAttribute('max-inline-size', '680px');
  v.setAttribute('max-column-count', innerWidth >= 900 ? '2' : '1');
  v.setAttribute('margin', '44px');
  v.setStyles(bookCSS(r, th));
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = th.bg;
  document.documentElement.style.setProperty('--status-bg', th.bg);
  document.body.classList.add('reading');
}

// ---------- shell ----------

const shell = b => html`
<div class="r-bar r-top">
  <button data-r="close" aria-label="Закрыть книгу">${ICON.back}</button>
  <div class="ttl">${b.title}</div>
  <button data-r="mark" id="rMark" aria-label="Закладка" aria-pressed="false">${RICON.mark}</button>
  <button data-r="toc" aria-label="Оглавление, закладки и поиск">${RICON.list}</button>
  <button data-r="look" aria-label="Настройки чтения" style="font-family:var(--f-display);font-size:21px;font-weight:600">Аа</button>
  <button data-r="listen" aria-label="Слушать">${ICON.ear}</button>
</div>
<button class="r-foot" id="rFoot" data-r="progress" aria-label="Вид прогресса чтения"></button>
<div class="r-bar r-bottom">
  <input type="range" id="rSlider" min="0" max="1000" step="1" value="0" aria-label="Место в книге">
  <span class="r-meta" id="rPage"></span>
</div>
<button class="r-back" id="rBack" data-r="back" hidden>${ICON.back}Вернуться</button>
<button class="r-quote" id="rQuote" data-r="quote" hidden>${ICON.quote}Сохранить цитату</button>
<div class="r-done card" id="rDone" hidden>
  <p class="h3">Книга дочитана?</p>
  <div class="row"><button class="btn primary" data-r="finish">Да, дочитала</button><button class="btn" data-r="not-yet">Ещё нет</button></div>
</div>
<div class="r-listen" id="rListen" hidden>
  <div class="line"><div class="say grow" id="rSay">Готовлю голос…</div><button class="ic" data-r="l-close" aria-label="Выключить чтение вслух">${ICON.x}</button></div>
  <div class="line">
    <button class="ic" data-r="l-prev" aria-label="Предыдущая фраза">${RICON.prev}</button>
    <button class="ic main" data-r="l-toggle" id="rToggle" aria-label="Пауза">${ICON.pause}</button>
    <button class="ic" data-r="l-next" aria-label="Следующая фраза">${RICON.next}</button>
    <button class="chip" data-r="l-sleep" id="rSleep" style="min-height:40px;padding:0 10px">Сон</button>
    <div class="rate" role="group" aria-label="Скорость"><button data-r="l-slower" aria-label="Медленнее">−</button><output id="rRate">1,0×</output><button data-r="l-faster" aria-label="Быстрее">+</button></div>
  </div>
</div>`;

function chrome(on) {
  const el = $('#reader');
  el.classList.toggle('chrome-off', on === undefined ? !el.classList.contains('chrome-off') : !on);
}

/**
 * Pages counted as screens. Inside the open chapter the renderer knows them exactly; other chapters are
 * estimated from their length at the rate measured on the chapters already laid out.
 */
function screenPages() {
  const rel = R.rel, sec = R.view.book.sections;
  if (!rel || !rel.size || rel.index == null || !sec[rel.index]) return null;
  const n = Math.max(1, Math.round(1 / rel.size));
  const inSec = Math.min(n, Math.round((rel.fraction || 0) * n) + 1);
  const size = s => (s && s.linear !== 'no' && s.size > 0 ? s.size : 0);
  R.sp.set(rel.index, n);
  let laid = 0, bytes = 0;
  for (const [i, k] of R.sp) { if (size(sec[i])) { laid += k; bytes += size(sec[i]); } }
  const rate = laid / Math.max(1, bytes);
  const est = i => (R.sp.has(i) ? R.sp.get(i) : size(sec[i]) ? Math.max(1, Math.round(size(sec[i]) * rate)) : 0);
  let before = 0, total = 0;
  sec.forEach((x, i) => { const k = est(i); total += k; if (i < rel.index) before += k; });
  return { page: before + inSec, total: Math.max(total, before + n), chapterLeft: n - inSec };
}

function paint() {
  if (!R || !R.loc) return;
  const f = R.loc.fraction || 0, part = R.part;
  // inside a collected volume the numbers are those of the work, not of the whole file
  const local = part ? Math.min(1, Math.max(0, (f - part.from) / (part.to - part.from))) : f;
  let pages = part ? (store.books.get(R.id).pages || Math.max(1, Math.round(R.pages * (part.to - part.from)))) : R.pages;
  let page = Math.min(pages, Math.floor(local * pages) + 1);
  const t = R.loc.time;
  let left = t && t.total > 0 ? R.pages * (1 - f) * t.section / t.total : 0;
  const sp = store.settings.reader.pages !== 'paper' ? screenPages() : null;
  if (sp) {
    // pages as screens of this phone with the current font: exact inside the chapter, estimated for the book
    const from = part ? Math.round(sp.total * part.from) : 0, to = part ? Math.round(sp.total * part.to) : sp.total;
    pages = Math.max(1, to - from);
    page = Math.min(pages, Math.max(1, sp.page - from));
    left = sp.chapterLeft;
  }
  $('#rSlider').value = Math.round(f * 1000);
  const marked = markAt(f) >= 0;
  $('#rMark').classList.toggle('on', marked);
  $('#rMark').setAttribute('aria-pressed', String(marked));
  $('#rPage').textContent = `${page} из ${pages}`;
  R.shown = { chapter: chapterLeft(left), pages: `${page} из ${pages}`, percent: `${Math.round(local * 100)}%` };
  footer();
}

// ---------- progress, pages, minutes ----------

function flush() {
  if (!R) return;
  const a = R.acc;
  if (a.p >= 0.05 || a.m >= 0.05) {
    M.logReading({ bookId: R.id, pages: a.p, minutes: a.m, listen: a.l });
    R.acc = { p: 0, m: 0, l: 0 };
  }
}

function save() {
  if (!R || !R.loc) return;
  flush();
  const f = R.loc.fraction || 0, t = Date.now();
  R.hostMax = Math.max(R.hostMax, f);
  store.patch('books', R.host, { prog: { f, cfi: R.loc.cfi, max: R.hostMax, t }, touched: t });
  if (R.part) {
    const p = R.part, at = x => Math.min(1, Math.max(0, (x - p.from) / (p.to - p.from)));
    store.patch('books', R.id, { prog: { f: at(f), cfi: R.loc.cfi, max: at(R.max), t }, touched: t });
  }
}
const saveSoon = debounce(save, 5000);

function onRelocate(reason) {
  if (!R) return;
  const loc = R.view.lastLocation;
  if (!loc) return;
  R.loc = loc;
  const f = loc.fraction || 0;
  const user = reason === 'page' || reason === 'snap' || reason === 'scroll';
  // Every touch ends with a 'snap' back onto the page, even a tap that turned nothing:
  // only a real move to another page may hide the bars or move the voice.
  const moved = R.lastF == null || Math.abs(f - R.lastF) > 1e-6;
  if (R.parts) {
    let part = partAt(R.parts, f);
    if (R.pin) {
      // The work she opened stays the current one until she is clearly outside it (its first page may
      // begin a little before the computed boundary).
      const pinned = R.parts.find(x => x.id === R.pin);
      if (pinned && f < pinned.to && f > pinned.from - 1.5 / R.pages) part = pinned; else R.pin = null;
    }
    const wid = part ? part.id : R.host;
    if (wid !== R.id) enter(wid, part, f);
    const w = store.books.get(R.id);
    if (user && part && w && (w.status === 'want' || w.status === 'paused')) setStatus(R.id, 'reading');
  }
  if (f > R.max) {
    const pages = (f - R.max) * R.pages;
    if (R.settled && pages <= 4) R.acc.p += pages; // a jump through the contents is not reading
    R.max = f;
  }
  R.settled = true;
  R.active = Date.now();
  paint();
  saveSoon();
  R.lastF = f;
  if (user && moved && R.speaker && R.speaker.playing) R.speaker.sync();
  if (user && moved && reason !== 'scroll') chrome(false);
  if (f >= 0.995 && !R.asked && store.books.get(R.id).status !== 'read') { R.asked = true; $('#rDone').hidden = false; }
}

/** "24 страницы до конца главы", counted in the same paper-sized pages as everything else. */
function chapterLeft(left) {
  const n = Math.round(left);
  return n >= 1 ? `${n} ${plural(n, PL.pages)} до конца главы` : 'последняя страница главы';
}

const PROGRESS = {
  'chapter-pages': s => [s.chapter, s.pages],
  'chapter-percent': s => [s.chapter, s.percent],
  pages: s => [s.pages],
  percent: s => [s.percent],
};

/** The line under the page, in the form chosen in «Вид прогресса чтения». */
function footer() {
  if (!R || !R.shown) return;
  const kind = PROGRESS[store.settings.reader.progress] ? store.settings.reader.progress : 'chapter-pages';
  const parts = PROGRESS[kind](R.shown), el = $('#rFoot');
  el.classList.toggle('mid', parts.length === 1);
  setHTML(el, html`${parts.map(x => html`<span>${x}</span>`)}`);
}

function openProgress() {
  const body = () => {
    const cur = store.settings.reader.progress || 'chapter-pages', s = R.shown || { chapter: '24 страницы до конца главы', pages: '5 из 497', percent: '1%' };
    const unit = store.settings.reader.pages === 'paper' ? 'paper' : 'screen';
    return html`<div class="stack" style="gap:6px"><p class="eyebrow">Какие страницы считать</p>
<div class="seg" role="group">${[['screen', 'Экраны телефона'], ['paper', 'Печатные']].map(([k, v]) => html`<button class="${unit === k ? 'on' : ''}" data-act="unit" data-v="${k}">${v}</button>`)}</div>
<p class="tiny muted">${unit === 'screen' ? 'Одна страница — один экран, как ты листаешь. Число зависит от размера шрифта; общее количество в книге — оценка.' : 'Одна страница — примерно страница бумажной книги (1800 знаков), не зависит от шрифта и телефона.'} Статистика и кольца всегда считают печатные страницы.</p></div>
<div class="pick" role="radiogroup">${Object.entries(PROGRESS).map(([k, fn]) => {
      const parts = fn(s);
      return html`<button class="${cur === k ? 'on' : ''} ${parts.length === 1 ? 'mid' : ''}" data-act="pick" data-v="${k}" role="radio" aria-checked="${cur === k}">${parts.map(x => html`<span>${x}</span>`)}</button>`;
    })}</div>`;
  };
  openSheet({
    title: 'Вид прогресса чтения', body: body(),
    acts: {
      pick: el => { store.setSettings({ reader: { progress: el.dataset.v } }); footer(); updateSheet(body()); },
      unit: el => { store.setSettings({ reader: { pages: el.dataset.v } }); paint(); updateSheet(body()); },
    },
  });
}

/** Move the credit to another work of a collected volume (or back to the volume itself). */
function enter(wid, part, f) {
  flush();
  const prev = R.part;
  // Reading straight on across the end of a work finishes it.
  if (prev && R.settled && R.lastF != null && f >= prev.to - 0.5 / R.pages && f - R.lastF < 4 / R.pages && f > R.lastF) {
    const done = store.books.get(prev.id);
    if (done && done.status !== 'read') { setStatus(prev.id, 'read'); toast(`Дочитано: ${done.title}`); }
  }
  R.id = wid;
  R.part = part;
  const w = store.books.get(wid);
  R.max = part ? part.from + ((w.prog && w.prog.max) || 0) * (part.to - part.from) : R.hostMax;
  R.asked = false;
  const ttl = $('#reader .ttl');
  if (ttl && w) ttl.textContent = w.title;
}

/** Every 15 s: count time spent reading (recent page turns) or listening (the voice is on). */
function tick() {
  if (!R) return;
  const now = Date.now(), dt = Math.min(60, (now - R.tickAt) / 1000) / 60;
  R.tickAt = now;
  const sp = R.speaker;
  if (sp && sp.playing) {
    const played = sp.playedSec;
    const min = Math.max(0, played - R.spoken) / 60 / (sp.player.rate || 1);
    R.spoken = played;
    R.acc.m += min; R.acc.l += min;
  } else if (!document.hidden && now - R.active < 120000) {
    R.acc.m += dt;
  }
  if (R.acc.m >= 1 || R.acc.p >= 1) flush();
}

// ---------- quotes ----------

/** True for the open file's own record and for every work inside it. */
const inFile = id => id === R.host || !!(R.parts && R.parts.some(p => p.id === id));

function drawQuotes() {
  if (!R) return;
  for (const [, q] of store.quotes) if (inFile(q.book) && q.cfi) R.view.addAnnotation({ value: q.cfi }).catch(() => {});
}

function onLoad({ doc, index }) {
  doc.addEventListener('selectionchange', debounce(() => {
    if (!R) return;
    const sel = doc.getSelection();
    const ok = sel && sel.rangeCount && !sel.isCollapsed && sel.toString().trim().length > 2;
    R.sel = ok ? { range: sel.getRangeAt(0).cloneRange(), text: sel.toString().replace(/\s+/g, ' ').trim(), index } : null;
    $('#rQuote').hidden = !ok;
  }, 250));
  // A tap is taken from whichever arrives first: the click (what iPhone sends for a tap) or a short,
  // still pointer touch (for places where no click comes). The other one of the pair is ignored.
  let down = null;
  const onTap = (cx, cy, target) => {
    if (!R || Date.now() - R.tapAt < 450) return;
    if (target && target.closest && target.closest('a[href]')) return;
    const sel = doc.getSelection();
    if (sel && !sel.isCollapsed) return;
    R.tapAt = Date.now();
    const rect = doc.defaultView.frameElement ? doc.defaultView.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    const x = rect.left + cx, y = rect.top + cy;
    if (store.settings.reader.flow === 'scrolled') { chrome(); return; }
    if (y < innerHeight * 0.14) chrome(); // the top strip always toggles the bars, as a way back to them
    else if (x < innerWidth * 0.25) R.view.prev();
    else if (x > innerWidth * 0.75) R.view.next();
    else chrome();
  };
  doc.addEventListener('click', e => { if (!e.defaultPrevented) onTap(e.clientX, e.clientY, e.target); });
  doc.addEventListener('pointerdown', e => { down = e.isPrimary !== false ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; });
  doc.addEventListener('pointercancel', () => { down = null; });
  doc.addEventListener('pointerup', e => {
    const d = down;
    down = null;
    if (d && Date.now() - d.t < 400 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) onTap(e.clientX, e.clientY, e.target);
  });
  doc.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!R || $('#sheet').open) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { R.view.prev(); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { R.view.next(); e.preventDefault(); }
  else if (e.key === 'Escape') close();
}

// ---------- listening ----------

function listenUI(state) {
  if (!R) return;
  const playing = state === 'playing' || state === 'buffering' || state === 'loading';
  setHTML($('#rToggle'), playing ? ICON.pause : ICON.play);
  $('#rToggle').setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
  if (state === 'ended') $('#rSay').textContent = 'Книга закончилась.';
}

async function listen() {
  if (!R) return;
  if (R.speaker) { R.speaker.toggle(); return; }
  const b = store.books.get(R.id), s = store.settings;
  const rate = store.books.get(R.host).speed || s.rate || 1;
  const sp = new Speaker({ view: R.view, voice: s.voice, rate, lift: s.lift, meta: { title: b.title, artist: b.author || '', album: 'Глава' } });
  R.speaker = sp;
  R.spoken = 0;
  $('#rListen').hidden = false;
  $('#rRate').textContent = rateText(rate);
  $('#rSay').textContent = 'Готовлю голос…';
  chrome(false);
  sp.addEventListener('state', e => listenUI(e.detail.state));
  sp.addEventListener('say', e => { if (R) $('#rSay').textContent = e.detail.text; });
  sp.addEventListener('sleep', () => { if (R) { $('#rSleep').textContent = 'Сон'; R.sleep = 0; toast('Таймер сна: чтение остановлено'); } });
  try {
    await sp.start(p => {
      if (!R) return;
      const mb = n => Math.round(n / 1048576);
      $('#rSay').textContent = p.stage === 'start' ? 'Запускаю голос…' : `Загружаю ${p.stage === 'voice' ? 'голос' : 'движок'}: ${mb(p.loaded)} из ${mb(p.total)} МБ`;
    });
  } catch (err) {
    toast('Голос не загрузился: ' + (err.message || 'нет связи'));
    stopListening();
  }
}

function stopListening() {
  if (!R || !R.speaker) return;
  tick();
  R.speaker.stop();
  R.speaker = null;
  $('#rListen').hidden = true;
}

const SLEEP = [0, 15, 30, 60, 'chapter'];
function cycleSleep() {
  R.sleep = ((R.sleep || 0) + 1) % SLEEP.length;
  const v = SLEEP[R.sleep];
  R.speaker.setSleep(v);
  $('#rSleep').textContent = v === 0 ? 'Сон' : v === 'chapter' ? 'до главы' : `${v} мин`;
}

function changeRate(d) {
  const b = store.books.get(R.host);
  const rate = Math.min(2, Math.max(0.7, Math.round(((b.speed || store.settings.rate || 1) + d) * 10) / 10));
  store.patch('books', R.host, { speed: rate });
  R.speaker.setRate(rate);
  $('#rRate').textContent = rateText(rate);
}

// ---------- sheets ----------

function lookBody() {
  const r = store.settings.reader;
  const step = (key, label, value, shown) => html`<div class="row between"><span>${label}</span>
<div class="stepper"><button data-act="step" data-k="${key}" data-d="-1" aria-label="Меньше">−</button><output>${shown}</output><button data-act="step" data-k="${key}" data-d="1" aria-label="Больше">+</button></div></div>`;
  return html`<section class="stack"><p class="eyebrow">Фон</p>
<div class="swatches"><button class="${THEMES[r.theme] ? '' : 'on'}" data-act="theme" data-v="auto" style="background:linear-gradient(135deg,#F4EEDD 50%,#0F2B24 50%);color:#7A5C12">Авто</button>
${Object.entries(THEMES).map(([k, t]) => html`<button class="${r.theme === k ? 'on' : ''}" data-act="theme" data-v="${k}" style="background:${t.bg};color:${t.fg}">${t.name}</button>`)}</div></section>
<section class="stack"><p class="eyebrow">Шрифт</p>
<div class="wrap">${Object.entries(FONTS).map(([k, [name, css]]) => html`<button class="chip ${(FONTS[r.font] ? r.font : 'literata') === k ? 'on' : ''}" data-act="font" data-v="${k}" style="font-family:${css || 'inherit'};font-size:15px">${name}</button>`)}</div>
${step('size', 'Размер', r.size, r.size)}
${step('line', 'Межстрочный интервал', r.line, String(r.line).replace('.', ','))}</section>
<section class="stack"><p class="eyebrow">Прогресс внизу страницы</p><div class="row"><button class="btn quiet" data-act="progress">Выбрать вид</button></div></section>
<section class="stack"><p class="eyebrow">Страница</p>
<div class="seg" role="group" aria-label="Поля">${[['narrow', 'Узкие поля'], ['normal', 'Средние'], ['wide', 'Широкие']].map(([k, v]) => html`<button class="${(r.margins || 'normal') === k ? 'on' : ''}" data-act="set" data-k="margins" data-v="${k}">${v}</button>`)}</div>
<div class="seg" role="group" aria-label="Листание">${[['paginated', 'Страницы'], ['scrolled', 'Лента']].map(([k, v]) => html`<button class="${(r.flow || 'paginated') === k ? 'on' : ''}" data-act="set" data-k="flow" data-v="${k}">${v}</button>`)}</div>
<div class="seg" role="group" aria-label="Выравнивание">${[[true, 'По ширине'], [false, 'По левому краю']].map(([k, v]) => html`<button class="${!!r.justify === k ? 'on' : ''}" data-act="set" data-k="justify" data-v="${k ? '1' : ''}">${v}</button>`)}</div></section>`;
}

function openLook() {
  const set = patch => { store.setSettings({ reader: patch }); applyLook(); updateSheet(lookBody()); };
  openSheet({
    title: 'Вид страницы', body: lookBody(),
    acts: {
      progress: () => openProgress(),
      theme: el => set({ theme: el.dataset.v }),
      font: el => set({ font: el.dataset.v }),
      set: el => set({ [el.dataset.k]: el.dataset.k === 'justify' ? !!el.dataset.v : el.dataset.v }),
      step: el => {
        const r = store.settings.reader, d = +el.dataset.d;
        if (el.dataset.k === 'size') set({ size: Math.min(34, Math.max(13, r.size + d)) });
        else set({ line: Math.min(2.2, Math.max(1.1, Math.round((r.line + d * 0.1) * 10) / 10)) });
      },
    },
  });
}

// A bookmark belongs to the page it was set on: anything within a third of a page counts as "here".
function markAt(f) {
  const marks = store.books.get(R.host).marks || [], near = 0.34 / R.pages;
  return marks.findIndex(m => Math.abs(m.f - f) <= near);
}

function toggleMark() {
  if (!R.loc) return;
  const b = store.books.get(R.host), marks = [...(b.marks || [])], f = R.loc.fraction || 0, i = markAt(f);
  if (i >= 0) marks.splice(i, 1);
  else {
    const here = R.loc.range ? R.loc.range.toString().replace(/\s+/g, ' ').trim().slice(0, 90) : '';
    marks.push({ cfi: R.loc.cfi, f, at: today(), label: (R.loc.tocItem && R.loc.tocItem.label || '').trim(), text: here });
    marks.sort((a, c) => a.f - c.f);
  }
  store.patch('books', R.host, { marks });
  paint();
  toast(i >= 0 ? 'Закладка снята' : 'Закладка поставлена');
}

async function runSearch(query) {
  const box = $('#rFound');
  if (!box || !R) return;
  R.view.clearSearch();
  query = query.trim();
  if (query.length < 2) { box.replaceChildren(); return; }
  box.textContent = 'Ищу…';
  const token = R.searching = {}, found = [];
  try {
    for await (const res of R.view.search({ query })) {
      if (!R || R.searching !== token) return;
      if (res === 'done') break;
      for (const it of res.subitems || []) if (found.length < 80) found.push({ cfi: it.cfi, excerpt: it.excerpt || {}, label: (res.label || '').trim() });
    }
  } catch (e) { /* a chapter that cannot be searched is skipped */ }
  if (!R || !$('#rFound')) return;
  R.found = found;
  setHTML($('#rFound'), found.length
    ? html`<p class="tiny muted">${found.length >= 80 ? 'Первые 80 мест' : `Найдено мест: ${found.length}`}</p>${found.map((it, i) => html`<button data-act="found" data-i="${i}"><span class="tiny muted">${it.label}</span><span style="display:block">${it.excerpt.pre || ''}<b style="color:var(--accent)">${it.excerpt.match || ''}</b>${it.excerpt.post || ''}</span></button>`)}`
    : html`<p class="small muted">Ничего не нашлось.</p>`);
}

function openToc() {
  const flat = [];
  const walk = (items, depth) => { for (const it of items || []) { flat.push({ ...it, depth }); walk(it.subitems, depth + 1); } };
  walk(R.view.book.toc, 0);
  const cur = R.loc && R.loc.tocItem ? R.loc.tocItem.href : '';
  const marks = store.books.get(R.host).marks || [];
  const mine = [...store.quotes].filter(([, q]) => inFile(q.book) && q.cfi);
  const page = f => Math.min(R.pages, Math.floor(f * R.pages) + 1);
  openSheet({
    title: 'Оглавление',
    onClose: () => { if (R) { R.searching = null; R.view.clearSearch(); } },
    body: html`<label class="search">${ICON.search}<input id="rQ" type="search" placeholder="Найти в книге" autocomplete="off" enterkeyhint="search" aria-label="Поиск по книге"></label>
<div class="toc" id="rFound"></div>
${marks.length ? html`<section class="stack" style="gap:4px"><p class="eyebrow">Закладки</p><div class="toc">${marks.map((m, i) => html`<button data-act="mark" data-i="${i}"><span class="tiny muted">стр. ${page(m.f)}${m.label ? ' · ' + m.label : ''}</span><span style="display:block">${m.text || 'Без текста'}</span></button>`)}</div></section>` : ''}
<section class="stack" style="gap:4px"><p class="eyebrow">Главы</p><div class="toc">${flat.map((it, i) => html`<button class="${it.href === cur ? 'cur' : ''}" data-act="go" data-i="${i}" style="padding-left:${it.depth * 16}px">${(it.label || '').trim() || 'Без названия'}</button>`)}
${flat.length ? '' : html`<p class="muted">В этой книге нет оглавления.</p>`}</div></section>
${mine.length ? html`<section class="stack" style="gap:4px"><p class="eyebrow">Цитаты</p><div class="toc">${mine.map(([qid, q]) => html`<button data-act="quote" data-id="${qid}"><span style="font-family:var(--f-display);font-size:18px;line-height:1.3">${q.text.length > 140 ? q.text.slice(0, 140) + '…' : q.text}</span></button>`)}</div></section>` : ''}`,
    acts: {
      go: el => { const it = flat[+el.dataset.i]; closeSheet(); if (it && it.href) jumpTo(it.href); },
      mark: el => { const m = marks[+el.dataset.i]; closeSheet(); if (m) jumpTo(m.cfi); },
      quote: el => { const q = store.quotes.get(el.dataset.id); closeSheet(); if (q) jumpTo(q.cfi); },
      found: el => { const it = R.found && R.found[+el.dataset.i]; closeSheet(); if (it) jumpTo(it.cfi); },
    },
  });
  $('#sheet').onchange = e => { if (e.target.id === 'rQ') runSearch(e.target.value); };
}

// ---------- open / close ----------

// ---------- links and footnotes ----------

/** Go somewhere inside the book and offer a way back to the page she was on. */
function jumpTo(target) {
  if (!R) return;
  if (R.loc && R.loc.cfi && !R.backTo) R.backTo = R.loc.cfi;
  $('#rBack').hidden = !R.backTo;
  R.view.goTo(target);
}

function goBack() {
  if (!R || !R.backTo) return;
  const to = R.backTo;
  R.backTo = null;
  $('#rBack').hidden = true;
  R.view.goTo(to);
}

/** A link that looks like a note reference: marked as one, or a small raised number or star. */
function isNoteRef(a) {
  const types = (a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').split(/\s+/);
  const roles = (a.getAttribute('role') || '').split(/\s+/);
  if (types.some(t => /noteref|glossref|biblioref/.test(t)) || roles.some(r => /doc-(noteref|glossref|biblioref)/.test(r))) return true;
  if (types.includes('backlink') || roles.includes('doc-backlink')) return false;
  const win = a.ownerDocument.defaultView;
  const raised = el => !!el && (el.matches('sup') || /^(super|top|text-top)$/.test(win.getComputedStyle(el).verticalAlign));
  if (raised(a) || raised(a.parentElement) || (a.children.length === 1 && raised(a.children[0]))) return true;
  return /^\s*[\[(]?(\d{1,4}|[*†‡]+)[\])]?\s*$/.test(a.textContent || '');
}

/** The text a note reference points to, or '' if it is not a short note. */
async function noteText(target) {
  const book = R.view.book;
  const section = book.sections[target.index];
  if (!section || !section.createDocument) return '';
  const doc = await section.createDocument();
  let el = typeof target.anchor === 'function' ? target.anchor(doc) : null;
  if (!el || el === doc.body || el === doc.documentElement) return '';
  if (el.startContainer) el = el.startContainer.nodeType === 1 ? el.startContainer : el.startContainer.parentElement;
  const inline = 'a, span, sup, sub, em, strong, i, b, small, big, cite';
  const start = el;
  while (el.matches && el.matches(inline) && el.parentElement && el.parentElement !== doc.body) el = el.parentElement;
  // an empty anchor right before the note: the note is the next block
  if (!(el.textContent || '').trim() || el === doc.body) el = start.nextElementSibling || el.nextElementSibling || el;
  const blocks = [...el.querySelectorAll('p, li, dd, div:not(:has(p, li, div))')];
  const parts = (blocks.length ? blocks : [el]).map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // FB2 notes start with their number as a title line: drop it
  if (parts.length > 1 && /^[\[(]?\d{1,4}[\])]?\.?$|^[*†‡]+$/.test(parts[0])) parts.shift();
  const text = parts.join('\n');
  return text.length > 0 && text.length < 4000 ? text : '';
}

async function onLink(e) {
  const { a, href } = e.detail;
  e.preventDefault();
  if (!R) return;
  let target = null;
  try { target = await R.view.book.resolveHref(href); } catch (err) { /* broken link */ }
  if (!target) return;
  if (isNoteRef(a)) {
    let text = '';
    try { text = await noteText(target); } catch (err) { /* fall back to jumping */ }
    if (text) {
      const label = (a.textContent || '').trim();
      // the note usually repeats its own number at the start: «[6] Purse strings…»
      text = text.replace(/^\s*[\[(]?(\d{1,4}|[*†‡]+)[\])]?\.?\s+/, '');
      openSheet({
        title: label && label.length <= 6 ? `Сноска ${label.replace(/[\[\]()]/g, '')}` : 'Сноска',
        body: html`<div class="stack" style="gap:10px">${text.split('\n').map(t => html`<p style="font-family:var(--f-display);font-size:20px;line-height:1.4">${t}</p>`)}</div>
<div class="row"><button class="btn quiet" data-act="goto">Открыть в книге</button><button class="btn primary" data-act="sheet-close">Закрыть</button></div>`,
        acts: { goto: () => { closeSheet(); jumpTo(href); } },
      });
      return;
    }
  }
  jumpTo(href);
}

const acts = {
  close: () => close(),
  back: () => goBack(),
  toc: () => openToc(),
  progress: () => openProgress(),
  mark: () => toggleMark(),
  look: () => openLook(),
  listen: () => (R.speaker ? stopListening() : listen()),
  quote: () => {
    if (!R.sel) return;
    const cfi = R.view.getCFI(R.sel.index, R.sel.range);
    store.put('quotes', uid(), { book: R.id, text: R.sel.text, cfi, at: today(), where: (R.loc && R.loc.tocItem && R.loc.tocItem.label || '').trim() });
    R.view.addAnnotation({ value: cfi }).catch(() => {});
    R.view.deselect();
    R.sel = null;
    $('#rQuote').hidden = true;
    toast('Цитата сохранена');
  },
  finish: () => { setStatus(R.id, 'read'); $('#rDone').hidden = true; toast('Книга дочитана'); },
  'not-yet': () => { $('#rDone').hidden = true; },
  'l-toggle': () => R.speaker && R.speaker.toggle(),
  'l-prev': () => R.speaker && R.speaker.skip(-1),
  'l-next': () => R.speaker && R.speaker.skip(1),
  'l-close': () => stopListening(),
  'l-sleep': () => R.speaker && cycleSleep(),
  'l-slower': () => R.speaker && changeRate(-0.1),
  'l-faster': () => R.speaker && changeRate(0.1),
};

async function open(id, { andListen = false, at = null } = {}) {
  const b = store.books.get(id);
  if (!b) return;
  const hostId = b.src && files.has(b.src.book) ? b.src.book : id;
  const host = store.books.get(hostId);
  const file = await files.get(hostId);
  if (!file || !host) { toast('Файла этой книги нет на этом устройстве'); return; }
  if (R) close();
  const el = $('#reader');
  setHTML(el, shell(b));
  el.hidden = false;
  el.classList.remove('chrome-off');
  const view = document.createElement('foliate-view');
  el.insertBefore(view, $('#rFoot'));
  try {
    await view.open(file);
  } catch (err) {
    el.hidden = true;
    el.replaceChildren();
    toast('Книга не открылась: файл повреждён или защищён');
    return;
  }
  const hostMax = (host.prog && (host.prog.max || host.prog.f)) || 0;
  R = { host: hostId, id: hostId, part: null, parts: host.parts && host.parts.length ? host.parts : null, pin: hostId !== id ? id : null,
    view, pages: host.pages || 1, tapAt: 0, sp: new Map(), rel: null, max: hostMax, hostMax, lastF: null, acc: { p: 0, m: 0, l: 0 }, active: Date.now(), tickAt: Date.now(), settled: false, spoken: 0 };
  view.renderer.addEventListener('relocate', e => { if (R) R.rel = e.detail; onRelocate(e.detail.reason); });
  view.addEventListener('load', e => onLoad(e.detail));
  view.addEventListener('link', onLink);
  view.addEventListener('create-overlay', drawQuotes);
  view.addEventListener('draw-annotation', e => e.detail.draw(Overlayer.highlight, { color: 'rgba(216,178,90,.45)' }));
  applyLook();
  await view.init({ lastLocation: at || (hostId !== id ? ((b.prog && b.prog.cfi) || b.src.href) : (host.prog && host.prog.cfi)), showTextStart: true });
  if (!R.parts && (b.status === 'want' || b.status === 'paused')) setStatus(id, 'reading');
  R.timer = setInterval(tick, 15000);
  if (andListen) listen();
}

function close() {
  document.documentElement.style.removeProperty('--status-bg');
  document.body.classList.remove('reading');
  if (!R) return;
  stopListening();
  tick();
  save();
  clearInterval(R.timer);
  try { R.view.close(); } catch (e) { /* already gone */ }
  R = null;
  const el = $('#reader');
  el.hidden = true;
  el.replaceChildren();
  applyTheme();
}

export function install(hooks) {
  hooks.read = (id, at) => open(id, { at });
  hooks.listen = id => { unlock(); open(id, { andListen: true }); };
  hooks.importFile = importFile;
  hooks.scan = rescan;
  const el = $('#reader');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (b && R && acts[b.dataset.r]) acts[b.dataset.r](b);
  });
  el.addEventListener('change', e => { if (e.target.id === 'rSlider' && R) R.view.goToFraction(+e.target.value / 1000); });
  document.addEventListener('keydown', e => { if (R && !e.target.closest('input,textarea,select')) onKey(e); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && R) { tick(); save(); } });
  window.addEventListener('pagehide', () => { if (R) { tick(); save(); } });
}
