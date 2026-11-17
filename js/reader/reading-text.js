// Text for visual reading. Offsets always refer to the unchanged source document;
// display cleanup must never change the DOM used to make a CFI.
import { toUnits } from '../../tts/text.js';

const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DD', 'DT',
  'TD', 'TH', 'PRE', 'SECTION', 'ARTICLE', 'BODY', 'FIGCAPTION', 'CAPTION', 'HEADER', 'FOOTER', 'MAIN']);
const LETTER = /[\p{L}\p{N}]/u;
const SKIP = 'script,style,sup,rt,rp,aside,[hidden],[aria-hidden="true"]';
let segmenter;

export function graphemes(text) {
  if (segmenter === undefined) segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : null;
  // The fallback keeps combining accents with their letter on older browsers.
  return segmenter ? [...segmenter.segment(String(text))].map(x => x.segment)
    : (String(text).match(/\P{M}\p{M}*|\p{M}+/gu) || []);
}

/** A visual anchor, not a claim that this letter is optimal for every reader. */
export function splitFocus(text) {
  const chars = graphemes(text);
  const letters = chars.map((c, i) => LETTER.test(c) ? i : -1).filter(i => i >= 0);
  if (!letters.length) return { before: String(text), pivot: '', after: '' };
  const n = letters.length;
  const at = letters[Math.min(n - 1, n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4)];
  return { before: chars.slice(0, at).join(''), pivot: chars[at], after: chars.slice(at + 1).join('') };
}

export function readingSettings(settings = {}) {
  const rate = Number(settings.wpm);
  return {
    wpm: Number.isFinite(rate) ? Math.max(100, Math.min(600, Math.round(rate))) : 200,
    focus: settings.focus !== false,
    punctuation: settings.punctuation !== false,
    longWords: settings.longWords !== false,
  };
}

/** Milliseconds for one displayed item. The chosen WPM is the base cadence. */
export function wordDuration(word, settings = {}) {
  const s = readingSettings(settings);
  let factor = 1;
  if (s.punctuation) {
    if (word.paragraphEnd) factor = 2.4;
    else if (word.sentenceEnd) factor = 1.9;
    else if (/[,;:][»”"')\]]*$/.test(word.text)) factor = 1.35;
    else if (/[—–]\s*$/.test(word.text)) factor = 1.35;
  }
  const length = graphemes(word.text).filter(c => LETTER.test(c)).length;
  if (s.longWords && length > 9) factor *= Math.min(1.65, 1 + (length - 9) * 0.065);
  return 60000 / s.wpm * factor;
}

const clean = text => text.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

/**
 * One paragraph, keeping UTF-16 source offsets. Punctuation-only pieces join a
 * neighbouring word, so quotes, dialogue dashes and currency signs never flash
 * alone. Hyphenated words and decimal numbers remain intact.
 */
export function tokenizeParagraph(text) {
  text = String(text);
  const pieces = [...text.matchAll(/\S+/gu)].map(m => ({ start: m.index, end: m.index + m[0].length }));
  const raw = [];
  let pending = null;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i], value = text.slice(p.start, p.end);
    if (!LETTER.test(value)) {
      if (/^[«“„"([{—–-]+$/u.test(value) && i + 1 < pieces.length) pending ??= p.start;
      else if (raw.length) raw[raw.length - 1].end = p.end;
      else pending ??= p.start;
      continue;
    }
    const item = { start: pending ?? p.start, end: p.end };
    pending = null;
    // Keep a conventional space-grouped number such as 10 000 or 1 250,50
    // together. A normal sequence of short numbers is left as separate items.
    if (/^[+−-]?\d{1,3}$/u.test(value)) {
      while (i + 1 < pieces.length && /^\d{3}(?:[.,]\d+)?[%.,;:!?]?$/.test(text.slice(pieces[i + 1].start, pieces[i + 1].end))) {
        item.end = pieces[++i].end;
      }
    }
    raw.push(item);
  }
  if (pending != null && raw.length) raw[raw.length - 1].end = text.length;
  if (!raw.length) return [];
  // Infinity prevents the speech helper's long-sentence splitting: a sentence
  // remains a sentence even when it takes more than 280 characters to say it.
  const sentences = toUnits(text, { max: Infinity });
  let sentenceIndex = 0;
  return raw.map((span, i) => {
    while (sentenceIndex + 1 < sentences.length && span.start >= sentences[sentenceIndex].end) sentenceIndex++;
    const sentence = sentences[sentenceIndex] || { start: 0, end: text.length };
    const next = raw[i + 1];
    return {
      ...span,
      text: clean(text.slice(span.start, span.end)),
      context: clean(text.slice(sentence.start, sentence.end)),
      sentenceIndex,
      sentenceEnd: !next || next.start >= sentence.end,
      paragraphEnd: i === raw.length - 1,
      // PAGE_CHARS is based on text with whitespace collapsed. Charge the
      // following separator once with this word, not as a separate frame.
      chars: text.slice(span.start, next ? next.start : text.length).replace(/\s+/g, ' ').length,
    };
  });
}

/** All eligible text in a section, with character offsets in its original body. */
export function collectReadingText(doc) {
  const body = doc?.body || doc?.documentElement;
  if (!body || !doc.createTreeWalker) return { blocks: [], words: [], sourceChars: 0, complex: false };
  const complex = [...(body.querySelectorAll?.('table,math,pre,svg text') || [])].some(node => !node.closest(SKIP));
  const blocks = [];
  const walker = doc.createTreeWalker(body, 5); // SHOW_ELEMENT | SHOW_TEXT, including detached documents
  let cur = null, curBlock = null, sourceChars = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      // A line break has no text node. Keep its words separate without changing
      // the original document or its CFI/character offsets.
      if (node.tagName.toUpperCase() === 'BR' && !node.closest(SKIP) && cur) cur.text += ' ';
      continue;
    }
    const value = node.nodeValue || '';
    const sourceStart = sourceChars;
    sourceChars += value.length;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) continue;
    let block = parent;
    while (block && !BLOCKS.has(block.tagName.toUpperCase())) block = block.parentElement;
    if (!cur || block !== curBlock) {
      cur = { text: '', nodes: [] };
      blocks.push(cur);
      curBlock = block;
    }
    cur.nodes.push({ node, start: cur.text.length, sourceStart });
    cur.text += value.replace(/\s/g, ' '); // same length, therefore the same DOM offsets
  }
  const words = [];
  let sentenceCounter = 0;
  blocks.forEach((block, blockIndex) => {
    const tokens = tokenizeParagraph(block.text);
    const sentenceBase = sentenceCounter;
    for (const token of tokens) {
      const first = pointAt(block, token.start, false);
      const last = pointAt(block, token.end, true);
      words.push({ ...token, blockIndex, sentenceIndex: sentenceBase + token.sentenceIndex,
        sourceStart: first.sourceOffset, sourceEnd: last.sourceOffset });
    }
    if (tokens.length) sentenceCounter += tokens[tokens.length - 1].sentenceIndex + 1;
  });
  let firstInSentence = 0;
  words.forEach((word, i) => {
    if (i && words[i - 1].sentenceIndex !== word.sentenceIndex) firstInSentence = i;
    word.sentenceStartIndex = firstInSentence;
  });
  return { blocks, words, sourceChars, complex };
}

function pointAt(block, pos, end) {
  let i = block.nodes.length - 1;
  // For an end exactly between two nodes, choose the preceding node's end.
  while (i > 0 && (end ? block.nodes[i].start >= pos : block.nodes[i].start > pos)) i--;
  const entry = block.nodes[i];
  const offset = Math.max(0, Math.min(entry.node.nodeValue.length, pos - entry.start));
  return { node: entry.node, offset, sourceOffset: entry.sourceStart + offset };
}

export function rangeForWord(section, word) {
  const block = section.blocks[word.blockIndex];
  if (!block?.nodes.length) return null;
  const start = pointAt(block, word.start, false), end = pointAt(block, word.end, true);
  const range = section.doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** First word whose end is after the selected/visible range's start. */
export function wordAtAnchor(section, anchor) {
  if (!anchor || !section.words.length) return 0;
  const point = section.doc.createRange();
  if (anchor.startContainer) point.setStart(anchor.startContainer, anchor.startOffset);
  else point.selectNodeContents(anchor);
  point.collapse(true);
  for (let i = 0; i < section.words.length; i++) {
    const end = rangeForWord(section, section.words[i]);
    end.collapse(false);
    if (end.compareBoundaryPoints(0, point) > 0) return i; // START_TO_START of two collapsed points
  }
  return Math.max(0, section.words.length - 1);
}
