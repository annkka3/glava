// Small shared helpers: DOM, escaping, dates (local time, weeks start on Monday), Russian plurals.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// Markup is built with the html`…` tag, which escapes every interpolated value. Only markup that
// itself came from html`…` (or raw(), for strings written in this codebase) passes through as is,
// so a book title or a note can never turn into tags.
class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const part = v => (v instanceof Safe ? v.s : v == null || v === false || v === true ? '' : esc(v));
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (Array.isArray(v) ? v.map(part).join('') : part(v)) + strings[i + 1];
  }
  return new Safe(out);
}
export const raw = s => new Safe(String(s));
/** Replace an element's content with markup produced by html`…`. */
export function setHTML(el, safe) {
  if (!(safe instanceof Safe)) throw new TypeError('setHTML needs markup made with html``');
  const doc = new DOMParser().parseFromString('<body>' + safe.s, 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export const PL = {
  pages: ['страница', 'страницы', 'страниц'],
  minutes: ['минута', 'минуты', 'минут'],
  books: ['книга', 'книги', 'книг'],
  days: ['день', 'дня', 'дней'],
  works: ['произведение', 'произведения', 'произведений'],
  quotes: ['цитата', 'цитаты', 'цитат'],
  medals: ['медаль', 'медали', 'медалей'],
};
export const count = (n, forms) => `${n} ${plural(n, forms)}`;

export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const DAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
export const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const toStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => toStr(new Date());
export const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d || 1); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
export const weekday = s => (parse(s).getDay() + 6) % 7; // 0 = Monday
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const fmtDay = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
export const fmtDayFull = s => `${DAYS_FULL[weekday(s)]}, ${fmtDay(s)}`;

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n) {
  if (n <= 0) return '';
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

export const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** "1 ч 20 мин" / "45 мин" */
export function fmtMin(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** A stable small integer from a string, for picking cover colours. */
export function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»„“”"'.,:;!?()\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
