// Picture cards to share: a quote, or the totals of a month or a year. Drawn on a canvas in the
// app's own look (cloth, gold frame, Cormorant), as a 4:5 post or a 9:16 story.
import { html } from './util.js';
import { openSheet, updateSheet } from './ui.js';

const W = 1080;
const LOOK = {
  dark: { bg: '#0F2B24', weaveA: 'rgba(255,255,255,.03)', weaveB: 'rgba(0,0,0,.12)', ink: '#F3ECDA', muted: '#A9B8A9', gold: '#D8B25A', frame2: 'rgba(216,178,90,.5)' },
  light: { bg: '#F4EEDD', weaveA: 'rgba(18,50,42,.04)', weaveB: 'rgba(255,255,255,.4)', ink: '#12322A', muted: '#55635B', gold: '#9A7417', frame2: 'rgba(154,116,23,.5)' },
};
const serif = (size, style = '600') => `${style} ${size}px 'Cormorant','Times New Roman',serif`;
const sans = (size, weight = 600) => `${weight} ${size}px 'Onest','Helvetica Neue',sans-serif`;

/** Make sure the faces are loaded for the letters we are about to draw (subsets load on demand). */
async function fonts(sample) {
  const text = sample + ' “Глава';
  try {
    await Promise.all([document.fonts.load(serif(60), text), document.fonts.load(serif(60, 'italic 600'), text), document.fonts.load(sans(24), text), document.fonts.load(sans(24, 500), text)]);
  } catch (e) { /* fall back to the system serif */ }
}

function canvas(H, look) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = look.weaveA;
  for (let y = 0; y < H; y += 7) ctx.fillRect(0, y, W, 2);
  ctx.fillStyle = look.weaveB;
  for (let x = 0; x < W; x += 7) ctx.fillRect(x, 0, 2, H);
  const frame = (inset, radius, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, radius);
    ctx.stroke();
  };
  frame(50, 34, look.gold, 4);
  frame(70, 22, look.frame2, 2);
  ctx.textBaseline = 'alphabetic';
  return { c, ctx };
}

/** Break text into lines no wider than maxW (words longer than a line are split). */
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (ctx.measureText(word).width > maxW) {
        let n = word.length - 1;
        while (n > 1 && ctx.measureText(word.slice(0, n)).width > maxW) n--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** One line cut to maxW with an ellipsis. */
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let n = text.length;
  while (n > 1 && ctx.measureText(text.slice(0, n).trimEnd() + '…').width > maxW) n--;
  return text.slice(0, n).trimEnd() + '…';
}

/** Upper-case label with letter-spacing, centred on x (canvas letter-spacing is not available everywhere). */
function label(ctx, text, x, y, gap) {
  const chars = [...text.toUpperCase()];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  let at = x - (widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)) / 2;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => { ctx.fillText(ch, at, y); at += widths[i] + gap; });
}

const rule = (ctx, look, y, width = 90) => { ctx.fillStyle = look.gold; ctx.fillRect((W - width) / 2, y, width, 2); };

function signature(ctx, look, H) {
  ctx.font = serif(34, 'italic 600');
  ctx.fillStyle = look.gold;
  ctx.textAlign = 'center';
  ctx.fillText('Глава', W / 2, H - 104);
}

const blobOf = c => new Promise(resolve => c.toBlob(resolve, 'image/png'));

// ---------- quote ----------

export async function quoteCard({ text, title, author }, { look: lookName = 'dark', H = 1350 } = {}) {
  await fonts(text + title + author);
  const look = LOOK[lookName] || LOOK.dark;
  const { c, ctx } = canvas(H, look);
  const side = 130, maxW = W - side * 2;
  const top = H > 1500 ? 470 : 330, bottom = H - (author || title ? 330 : 190);

  ctx.font = serif(230);
  ctx.fillStyle = look.gold;
  ctx.textAlign = 'center';
  ctx.fillText('“', W / 2, top - 30);

  // The largest size at which the whole quote fits; past the smallest, the end is cut.
  let size = 32, lines = [];
  for (const s of [78, 70, 62, 56, 50, 45, 40, 36, 32]) {
    ctx.font = serif(s);
    lines = wrap(ctx, text, maxW);
    size = s;
    if (lines.length * s * 1.26 <= bottom - top) break;
  }
  const lh = size * 1.26, room = Math.max(1, Math.floor((bottom - top) / lh));
  if (lines.length > room) { lines = lines.slice(0, room); lines[room - 1] = clip(ctx, lines[room - 1] + ' …', maxW); }
  const centred = lines.length <= 7;
  ctx.fillStyle = look.ink;
  ctx.textAlign = centred ? 'center' : 'left';
  let y = top + ((bottom - top) - lines.length * lh) / 2 + size;
  for (const line of lines) { ctx.fillText(line, centred ? W / 2 : side, y); y += lh; }

  if (title || author) {
    rule(ctx, look, H - 282);
    ctx.textAlign = 'center';
    if (title) {
      ctx.font = serif(46, 'italic 600');
      ctx.fillStyle = look.ink;
      ctx.fillText(clip(ctx, title, maxW), W / 2, H - 214);
    }
    if (author) {
      ctx.font = sans(24);
      ctx.fillStyle = look.gold;
      label(ctx, clip(ctx, author, maxW - 200), W / 2, H - 162, 5);
    }
  }
  signature(ctx, look, H);
  return blobOf(c);
}

// ---------- totals of a period ----------

/**
 * facts: {eyebrow, title, sub, kpis: [[value, label] × 6], books: [{title, author}], notes: [string]}
 */
export async function summaryCard(facts, { look: lookName = 'dark', H = 1350 } = {}) {
  await fonts(JSON.stringify(facts));
  const look = LOOK[lookName] || LOOK.dark;
  const { c, ctx } = canvas(H, look);
  const tall = H > 1500, oy = tall ? 150 : 0, maxW = W - 260;

  ctx.fillStyle = look.gold;
  ctx.font = sans(26);
  label(ctx, facts.eyebrow, W / 2, 190 + oy, 7);

  const big = facts.title.length <= 4;
  ctx.font = serif(big ? 230 : 150, 'italic 600');
  ctx.fillStyle = look.ink;
  ctx.textAlign = 'center';
  ctx.fillText(facts.title, W / 2, (big ? 395 : 350) + oy);
  ctx.font = sans(28, 500);
  ctx.fillStyle = look.muted;
  ctx.fillText(facts.sub, W / 2, 440 + oy);
  rule(ctx, look, 482 + oy);

  const cols = [230, 540, 850];
  facts.kpis.slice(0, 6).forEach(([value, name], i) => {
    const x = cols[i % 3], y = 620 + oy + Math.floor(i / 3) * 190;
    ctx.textAlign = 'center';
    ctx.font = sans(88, 600); // Onest: its figures stand on the line, Cormorant's hang below it
    ctx.fillStyle = i === 0 ? look.gold : look.ink;
    ctx.fillText(String(value), x, y);
    ctx.font = sans(25, 500);
    ctx.fillStyle = look.muted;
    ctx.fillText(name, x, y + 46);
  });

  let y = 930 + oy;
  rule(ctx, look, y);
  y += 62;
  const room = tall ? 9 : 3;
  if (facts.books.length) {
    ctx.fillStyle = look.gold;
    ctx.font = sans(22);
    label(ctx, 'Дочитано', W / 2, y, 6);
    y += 58;
    ctx.textAlign = 'center';
    const shown = facts.books.slice(0, facts.books.length > room ? room - 1 : room);
    for (const b of shown) {
      ctx.font = serif(40);
      ctx.fillStyle = look.ink;
      ctx.fillText(clip(ctx, b.author ? `${b.title} · ${b.author}` : b.title, maxW + 60), W / 2, y);
      y += 54;
    }
    if (facts.books.length > shown.length) {
      ctx.font = sans(26, 500);
      ctx.fillStyle = look.muted;
      ctx.fillText(`и ещё ${facts.books.length - shown.length}`, W / 2, y);
    }
  } else {
    ctx.font = serif(40, 'italic 600');
    ctx.fillStyle = look.muted;
    ctx.textAlign = 'center';
    ctx.fillText('Дочитанные книги ещё впереди', W / 2, y + 40);
  }
  if (tall && facts.notes.length) {
    ctx.font = sans(27, 500);
    ctx.fillStyle = look.muted;
    ctx.textAlign = 'center';
    let ny = H - 250 - (facts.notes.length - 1) * 44;
    for (const line of facts.notes) { ctx.fillText(clip(ctx, line, maxW + 100), W / 2, ny); ny += 44; }
  }
  signature(ctx, look, H);
  return blobOf(c);
}

// ---------- the sheet with the preview ----------

/** make({look, H}) → Promise<Blob>. `file` is the name the picture is saved under. */
export function openCard({ title, file, make, onClose }) {
  const s = { look: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', tall: false, blob: null, url: '' };
  const canShare = () => {
    try { return !!(s.blob && navigator.canShare && navigator.canShare({ files: [new File([s.blob], file, { type: 'image/png' })] })); } catch (e) { return false; }
  };
  const seg = (key, value, options) => html`<div class="seg" role="group">${options.map(([v, name]) => html`<button class="${value === v ? 'on' : ''}" data-act="opt" data-k="${key}" data-v="${v}">${name}</button>`)}</div>`;
  const body = () => html`${s.url ? html`<img src="${s.url}" alt="${title}" style="display:block;margin:0 auto;max-width:100%;max-height:56dvh;border-radius:10px;border:1px solid var(--line)">` : html`<p class="muted">Рисую карточку…</p>`}
${seg('look', s.look, [['dark', 'Тёмная'], ['light', 'Светлая']])}
${seg('tall', s.tall ? '1' : '', [['', 'Пост 4:5'], ['1', 'Сторис 9:16']])}
<div class="row">${canShare() ? html`<button class="btn primary" data-act="share">Поделиться</button>` : ''}<button class="btn ${canShare() ? '' : 'primary'}" data-act="save" ${s.blob ? '' : 'disabled'}>Сохранить картинку</button></div>`;
  const save = () => {
    const a = document.createElement('a');
    a.href = s.url;
    a.download = file;
    a.click();
  };
  const draw = async () => {
    const blob = await make({ look: s.look, H: s.tall ? 1920 : 1350 });
    if (s.url) URL.revokeObjectURL(s.url);
    s.blob = blob;
    s.url = URL.createObjectURL(blob);
    updateSheet(body());
  };
  openSheet({
    title, body: body(),
    onClose: () => { if (s.url) URL.revokeObjectURL(s.url); if (onClose) onClose(); },
    acts: {
      opt: el => { if (el.dataset.k === 'look') s.look = el.dataset.v; else s.tall = !!el.dataset.v; draw(); },
      save,
      share: async () => {
        try { await navigator.share({ files: [new File([s.blob], file, { type: 'image/png' })] }); } catch (e) { /* closed without sharing */ }
      },
    },
  });
  draw();
}
