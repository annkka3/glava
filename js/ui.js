// Shared interface pieces: icons, rings, covers, medals, the bottom sheet and the toast.
import { $, html, raw, setHTML, hash } from './util.js';

const svg = (inner, extra = '') => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${inner}</svg>`);
export const ICON = {
  today: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/>'),
  library: svg('<path d="M4 4h4v16H4zM9.5 4h4v16h-4zM15.5 6.2l3.4-.9 3.1 13.6-3.4.9z"/>'),
  cols: svg('<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.6 5 2.6-1.5-7.5"/>'),
  stats: svg('<path d="M5 20v-9M12 20V4M19 20v-6"/>'),
  gear: svg('<path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.4"/><circle cx="10" cy="17" r="2.4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5.5 12.5l4.2 4.2 8.8-9.4"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  ear: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="17" y="13.5" width="4" height="6.5" rx="1.5"/>'),
  book: svg('<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/>'),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".6"/><circle cx="15" cy="15" r=".6"/><circle cx="15" cy="9" r=".6"/><circle cx="9" cy="15" r=".6"/><circle cx="12" cy="12" r=".6"/>'),
  file: svg('<path d="M7 3.5h7l4 4V20.5H7zM14 3.5v4h4"/>'),
  edit: svg('<path d="M4 20l1-4L16.5 4.5l3 3L8 19zM14.5 6.5l3 3"/>'),
  trash: svg('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>'),
  quote: svg('<path d="M9.5 7C6.5 8 5 10.2 5 13.5V17h5v-5H7.5c0-1.8.8-2.8 2.5-3.5zM18.5 7c-3 1-4.5 3.2-4.5 6.5V17h5v-5h-2.5c0-1.8.8-2.8 2.5-3.5z"/>'),
  flag: svg('<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>'),
  star: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.3L12 17.1l-5.6 3.1 1.2-6.3L3 9.6l6.3-.8z"/></svg>'),
  play: raw('<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M7 4.5v15l12-7.5z"/></svg>'),
  pause: raw('<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'),
};

/** Two concentric progress rings: pages outside, minutes inside. `mid` is markup for the centre. */
export function rings(fp, fm, size = 188, mid = '') {
  const c = size / 2, sw = Math.max(4, Math.round(size * 0.0745));
  const ra = c - sw / 2 - 3, rb = ra - sw - 7;
  const arc = (r, f, color, w) => {
    if (f <= 0) return '';
    const C = 2 * Math.PI * r;
    return html`<circle cx="${c}" cy="${c}" r="${r}" transform="rotate(-90 ${c} ${c})" style="fill:none;stroke:${color};stroke-width:${w};stroke-linecap:round;stroke-dasharray:${(C * Math.min(f, 1)).toFixed(1)} ${C.toFixed(1)}"/>`;
  };
  return html`<div class="rings" style="width:${size}px;height:${size}px">
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
<circle cx="${c}" cy="${c}" r="${ra}" style="fill:none;stroke:var(--track-a);stroke-width:${sw}"/>
${arc(ra, fp, 'var(--ring-a)', sw)}${size >= 100 ? arc(ra + 3, fp, 'var(--ring-a-hi)', Math.max(2, sw / 5)) : ''}
<circle cx="${c}" cy="${c}" r="${rb}" style="fill:none;stroke:var(--track-b);stroke-width:${sw}"/>
${arc(rb, fm, 'var(--ring-b)', sw)}
</svg>${mid ? html`<div class="mid">${mid}</div>` : ''}</div>`;
}

const CLOTH = ['#6E1F2D', '#1F2F4D', '#4A2545', '#6B4423', '#1D4E57', '#3A4250', '#5A1F1F', '#2F4A2A', '#5B3A12', '#33324F'];
export function initials(b) {
  const src = b.author ? b.author.split(/[\s,]+/).filter(Boolean) : (b.title || '').split(/\s+/).filter(w => /\p{L}/u.test(w));
  const words = src.length > 2 ? [src[0], src[src.length - 1]] : src;
  return words.slice(0, 2).map(w => (w.match(/\p{L}/u) || [''])[0].toUpperCase() + '.').join(' ');
}
export function cover(b, size = '') {
  if (b.cv && /^data:image\//.test(b.cv)) return html`<div class="cover img ${size}" style="background-image:url('${b.cv}')" aria-hidden="true"></div>`;
  const c = CLOTH[hash((b.author || '') + ((b.genres && b.genres[0]) || '')) % CLOTH.length];
  return html`<div class="cover ${size}" style="--c:${c}" aria-hidden="true"><span>${initials(b)}</span></div>`;
}

export const bar = f => html`<div class="bar"><i style="width:${Math.round(Math.min(1, Math.max(0, f)) * 100)}%"></i></div>`;

/** A stamped medal: filled when earned, an outline while still locked. */
export function medal(tier, done, cls = '') {
  const fill = done ? 'currentColor' : 'none';
  return html`<svg class="medal ${tier} ${done ? '' : 'locked'} ${cls}" viewBox="0 0 48 48" aria-hidden="true">
<path d="M16 30l-5 14 7.5-3.2L22 46l3-12zM32 30l5 14-7.5-3.2L26 46l-3-12z" style="fill:${fill};stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;opacity:${done ? 0.75 : 1}"/>
<circle cx="24" cy="19" r="15.5" style="fill:${done ? 'var(--bg)' : 'none'};stroke:currentColor;stroke-width:1.5"/>
<circle cx="24" cy="19" r="12" style="fill:${fill};stroke:currentColor;stroke-width:1"/>
<path d="M24 11.5l2.3 4.8 5.2.7-3.8 3.6 1 5.2-4.7-2.6-4.7 2.6 1-5.2-3.8-3.6 5.2-.7z" style="fill:${done ? 'var(--bg)' : 'none'};stroke:${done ? 'none' : 'currentColor'};stroke-width:1.2;stroke-linejoin:round"/>
</svg>`;
}

// ---------- bottom sheet ----------
let sheetActs = {};
let onSheetClose = null;
const sheetFrame = (title, body) => html`<div class="head"><h2 class="h2">${title}</h2><button class="icon-btn bare" data-act="sheet-close" aria-label="Закрыть">${ICON.x}</button></div><div class="body">${body}</div>`;

export function openSheet({ title = '', body, acts = {}, onClose = null }) {
  const dlg = $('#sheet');
  setHTML(dlg, sheetFrame(title, body));
  sheetActs = acts;
  onSheetClose = onClose;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.body').scrollTop = 0;
}
/** Re-render the open sheet's body, keeping its scroll position. */
export function updateSheet(body) {
  const el = $('#sheet .body');
  if (!el) return;
  const top = el.scrollTop;
  setHTML(el, body);
  el.scrollTop = top;
}
export function closeSheet() {
  const dlg = $('#sheet');
  if (dlg.open) dlg.close();
}
export const sheetOpen = () => $('#sheet').open;
export const sheetAct = name => sheetActs[name];
export function initSheet() {
  const dlg = $('#sheet');
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    const fn = onSheetClose;
    sheetActs = {};
    onSheetClose = null;
    dlg.replaceChildren();
    if (fn) fn();
  });
}

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
