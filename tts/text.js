// Text preparation for speech: cut running text into sentence-sized units (keeping their
// offsets in the original, so the reader can highlight what is being spoken) and rewrite
// each unit into something the phonemizer pronounces sensibly.

const ABBR = new Set(['г', 'гг', 'ул', 'д', 'т', 'тт', 'стр', 'с', 'см', 'рис', 'им', 'др', 'пр', 'проф', 'акад', 'св',
  'гл', 'ч', 'п', 'пп', 'н', 'э', 'в', 'вв', 'тыс', 'млн', 'млрд', 'руб', 'коп', 'мин', 'сек', 'ок', 'напр',
  'англ', 'нем', 'фр', 'лат', 'греч', 'рус', 'ред', 'изд', 'кн', 'e', 'i']);
const CLOSERS = '»”“")]’';
const isUpper = ch => ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const isLetter = ch => /\p{L}/u.test(ch);

/** Sentences of one paragraph as [{start, end}] offsets into `text`. */
function sentenceSpans(text) {
  const spans = [];
  let from = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
    let j = i;
    while (j + 1 < n && '.!?…'.includes(text[j + 1])) j++;
    while (j + 1 < n && CLOSERS.includes(text[j + 1])) j++;
    if (j + 1 >= n) break;
    if (!/\s/.test(text[j + 1])) { i = j; continue; }
    let k = j + 1;
    while (k < n && /\s/.test(text[k])) k++;
    if (k >= n) break;
    const next = text[k];
    const opens = '«„“"(—–-'.includes(next) || /\d/.test(next) || (isLetter(next) && isUpper(next));
    if (!opens) { i = j; continue; }
    if (ch === '.' && j === i) {
      // "А. П. Чехов", "т. е.", "1905 г. было…": a full stop after an initial or a known abbreviation is not an end.
      let w = i - 1;
      while (w >= 0 && isLetter(text[w])) w--;
      const word = text.slice(w + 1, i);
      if (word.length === 1 && isUpper(word)) { i = j; continue; }
      if (word && ABBR.has(word.toLowerCase()) && !(isLetter(next) && isUpper(next) && word.length > 2)) { i = j; continue; }
    }
    spans.push({ start: from, end: j + 1 });
    from = k;
    i = k - 1;
  }
  if (from < n) spans.push({ start: from, end: n });
  return spans;
}

/** Break an over-long sentence at the punctuation mark nearest to its middle. */
function splitLong(text, span, max, out) {
  const len = span.end - span.start;
  if (len <= max) { out.push(span); return; }
  const mid = span.start + len / 2;
  let best = -1, bestScore = Infinity;
  for (let i = span.start + 40; i < span.end - 40; i++) {
    const ch = text[i];
    const weight = ch === ';' || ch === ':' ? 0 : ch === '—' || ch === '–' ? 20 : ch === ',' ? 40 : -1;
    if (weight < 0 || !/\s/.test(text[i + 1] || '')) continue;
    const score = Math.abs(i - mid) + weight;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) {
    // No punctuation at all: fall back to the space nearest the middle.
    for (let d = 0; d < len / 2 - 20; d++) {
      for (const i of [Math.floor(mid) + d, Math.floor(mid) - d]) {
        if (/\s/.test(text[i] || '')) { best = i - 1; break; }
      }
      if (best >= 0) break;
    }
  }
  if (best < 0) { out.push(span); return; }
  let k = best + 1;
  while (k < span.end && /\s/.test(text[k])) k++;
  splitLong(text, { start: span.start, end: best + 1 }, max, out);
  splitLong(text, { start: k, end: span.end }, max, out);
}

/**
 * Cut text into speech units.
 * @returns {{text: string, start: number, end: number, paraEnd: boolean}[]}
 */
export function toUnits(text, { max = 280 } = {}) {
  const units = [];
  for (const m of text.matchAll(/[^\n]+/g)) {
    const para = m[0];
    if (!para.trim()) continue;
    const spans = [];
    for (const s of sentenceSpans(para)) splitLong(para, s, max, spans);
    spans.forEach((s, i) => {
      const piece = para.slice(s.start, s.end);
      if (!/[\p{L}\p{N}]/u.test(piece)) return;
      units.push({ text: piece, start: m.index + s.start, end: m.index + s.end, paraEnd: i === spans.length - 1 });
    });
  }
  return units;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function roman(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]], next = ROMAN[s[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}
const isRoman = s => /^(?=[IVXLCDM])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s);

/** Rewrite one unit so it is read naturally: no quote marks, dashes as pauses, Roman numerals as numbers. */
export function forSpeech(s) {
  return s
    .replace(/­/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\[\d+\]|\{\d+\}/g, '')
    .replace(/[«»„“”"]/g, '')
    .replace(/^\s*[—–-]\s+/, '')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/…|\.{3}/g, '.')
    .replace(/№\s*/g, 'номер ')
    .replace(/(?<![\p{L}\p{N}])т\.\s?е\./gu, 'то есть')
    .replace(/(?<![\p{L}\p{N}])т\.\s?д\./gu, 'так далее')
    .replace(/(?<![\p{L}\p{N}])т\.\s?п\./gu, 'тому подобное')
    .replace(/(?<![\p{L}\p{N}])т\.\s?к\./gu, 'так как')
    .replace(/(?<![\p{L}\p{N}])([IVXLCDM]{2,7})(?![\p{L}\p{N}])/gu, (all, r) => (isRoman(r) ? String(roman(r)) : all))
    .replace(/(?<![\p{L}\p{N}])((?:глав|част|том|книг|раздел|век)[\p{L}]*)\s+([IVX])(?![\p{L}\p{N}])/giu, (all, w, r) => w + ' ' + roman(r))
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}
