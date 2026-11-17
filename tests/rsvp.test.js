import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeParagraph, splitFocus, graphemes, readingSettings, wordDuration } from '../js/reader/reading-text.js';
import { WordReader } from '../js/reader/rsvp.js';

test('words preserve source offsets, Russian hyphens and decimals; punctuation has no own frame', () => {
  const text = '— «Кто-то» заплатил 10\u202f000,50 ₽, затем спросил: «Правда?»';
  const words = tokenizeParagraph(text);
  assert.deepEqual(words.map(w => w.text), ['— «Кто-то»', 'заплатил', '10 000,50 ₽,', 'затем', 'спросил:', '«Правда?»']);
  for (const w of words) {
    assert.match(w.text, /[\p{L}\p{N}]/u);
    assert.equal(text.slice(w.start, w.end).replace(/\s+/g, ' ').trim(), w.text);
  }
  assert.equal(words.at(-1).paragraphEnd, true);
  assert.equal(words.filter(w => w.paragraphEnd).length, 1);
});

test('initials, common abbreviations and decimals do not create false sentence pauses', () => {
  const words = tokenizeParagraph('А. П. Чехов жил на ул. Садовой. В 1905 г. было иначе. Значение 3.14 осталось.');
  const ends = words.filter(w => w.sentenceEnd).map(w => w.text);
  assert.deepEqual(ends, ['Садовой.', 'иначе.', 'осталось.']);
  assert.equal(words[0].context, 'А. П. Чехов жил на ул. Садовой.');
  assert.equal(words.find(w => w.text === '3.14').sentenceEnd, false);
});

test('long sentences retain their real boundary instead of the TTS chunk limit', () => {
  const sentence = ('Подробное объяснение продолжается, ').repeat(18) + 'здесь конец.';
  const words = tokenizeParagraph(sentence);
  assert(sentence.length > 280);
  assert.equal(new Set(words.map(w => w.sentenceIndex)).size, 1);
  assert.equal(words.filter(w => w.sentenceEnd).length, 1);
  assert.equal(words[3].context, sentence.trim());
});

test('empty paragraphs and punctuation cannot generate empty reading frames', () => {
  assert.deepEqual(tokenizeParagraph('  \n — «» ... \t'), []);
  assert.deepEqual(tokenizeParagraph(''), []);
  assert.equal(tokenizeParagraph('« Привет ! »')[0].text, '« Привет ! »');
});

test('soft hyphens disappear visually while their source positions remain intact', () => {
  const text = 'не\u00adобычный текст';
  const [word] = tokenizeParagraph(text);
  assert.equal(word.text, 'необычный');
  assert.equal(word.start, 0);
  assert.equal(word.end, 10);
  assert.equal(word.chars, 11); // includes the following single separator
});

test('page accounting includes each collapsed inter-word separator exactly once', () => {
  const text = 'Один   два\tтри. Четыре пять.';
  const words = tokenizeParagraph(text);
  assert.equal(words.reduce((sum, word) => sum + word.chars, 0), text.replace(/\s+/g, ' ').length);
  assert.equal(words[0].chars, 5); // four letters and one normalized separator
});

test('focus splits graphemes, keeping combining accents and opening quotes intact', () => {
  const text = '«за\u0301метил»';
  const focus = splitFocus(text);
  assert.equal(focus.before + focus.pivot + focus.after, text);
  assert.deepEqual(graphemes('а\u0301ё'), ['а\u0301', 'ё']);
  assert.equal(splitFocus('о\u0301').pivot, 'о\u0301');
  assert.equal(splitFocus('—').pivot, '');
  assert.equal(splitFocus('«я»').pivot, 'я');
});

test('base cadence and independently configurable punctuation/long-word pauses', () => {
  const ordinary = { text: 'книга', sentenceEnd: false, paragraphEnd: false };
  assert.equal(wordDuration(ordinary, { wpm: 200 }), 300);
  assert.equal(wordDuration(ordinary, { wpm: 600 }), 100);
  assert.equal(wordDuration({ ...ordinary, text: 'книга,' }, { wpm: 200 }), 405);
  assert.equal(wordDuration({ ...ordinary, sentenceEnd: true }, { wpm: 200 }), 570);
  assert.equal(wordDuration({ ...ordinary, sentenceEnd: true, paragraphEnd: true }, { wpm: 200 }), 720);
  assert.equal(wordDuration({ ...ordinary, paragraphEnd: true }, { wpm: 200, punctuation: false }), 300);
  const long = { text: 'достопримечательность' };
  assert(wordDuration(long, { wpm: 200 }) > 300);
  assert.equal(wordDuration(long, { wpm: 200, longWords: false }), 300);
  assert(wordDuration(long, { wpm: 100 }) <= 990);
});

test('rate bounds reject non-finite values; settings preserve opt-outs', () => {
  assert.equal(readingSettings({ wpm: Infinity }).wpm, 200);
  assert.equal(readingSettings({ wpm: NaN }).wpm, 200);
  assert.equal(readingSettings({ wpm: 50 }).wpm, 100);
  assert.equal(readingSettings({ wpm: 900 }).wpm, 600);
  assert.deepEqual(readingSettings({ wpm: 230, focus: false, punctuation: false, longWords: false }),
    { wpm: 230, focus: false, punctuation: false, longWords: false });
});

// Controller tests use a minimal book/Range fixture, not an imitation of
// Foliate pagination. Real EPUB/FB2 and CFI round-trips are covered in the browser.
function sectionFixture(text, index = 0) {
  const node = { nodeValue: text };
  const doc = { createRange: () => ({
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
  }) };
  const words = tokenizeParagraph(text).map(w => ({ ...w, blockIndex: 0, sourceStart: w.start, sourceEnd: w.end }));
  let start = 0;
  words.forEach((w, i) => { if (i && words[i - 1].sentenceIndex !== w.sentenceIndex) start = i; w.sentenceStartIndex = start; });
  return { index, doc, words, sourceChars: text.length, blocks: [{ text, nodes: [{ node, start: 0, sourceStart: 0 }] }] };
}

function controller(t, texts, callbacks = {}) {
  const sections = texts.map(sectionFixture);
  let now = 0, sequence = 0;
  const timers = new Map();
  t.mock.method(globalThis.performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const view = {
    book: { sections: sections.map(() => ({ size: 1 })) },
    renderer: { getContents: () => [{ index: 0, doc: sections[0].doc }] },
    getCFI: (index, range) => `section:${index}:${range?.startOffset || 0}`,
    getSectionFractions: () => Array.from({ length: sections.length + 1 }, (_, i) => i / sections.length),
  };
  const reader = new WordReader(view, { settings: { wpm: 200, punctuation: false, longWords: false }, ...callbacks });
  reader._load = async index => sections[index];
  t.after(() => reader.destroy());
  return { reader, sections, timers, elapse: ms => { now += ms; },
    async fire(ms) {
      now += ms;
      const ready = [...timers].find(([, timer]) => timer.at <= now);
      if (ready) { timers.delete(ready[0]); await ready[1].fn(); }
    } };
}

test('opening does not autoplay; partial exposure and pauses are not credited as a whole word', async t => {
  const read = [];
  const { reader, timers, elapse, fire } = controller(t, ['Первое второе третье.'], { onRead: e => read.push(e) });
  await reader.open();
  assert.equal(reader.state, 'paused');
  assert.equal(timers.size, 0);
  await reader.play();
  elapse(100);
  reader.pause();
  assert.equal(read.length, 0);
  assert.equal(reader.activeMs, 100);
  elapse(10000);
  assert.equal(reader.activeMs, 100);
  await reader.play();
  await fire(200);
  assert.equal(read.length, 1);
  assert.equal(read[0].cursor.text, 'Первое');
  assert.equal(read[0].milliseconds, 300);
  assert.equal(reader.current.text, 'второе');
  assert.equal(reader.activeMs, 300);
});

test('back and previous-sentence navigation leave playback paused without crediting skipped words', async t => {
  const read = [];
  const { reader, fire } = controller(t, ['Раз два. Три четыре пять. Шесть семь восемь девять десять.'], { onRead: e => read.push(e) });
  await reader.open();
  await reader.play();
  for (let i = 0; i < 4; i++) await fire(300);
  assert.equal(reader.current.text, 'пять.');
  await reader.previousSentence();
  assert.equal(reader.current.text, 'Три');
  assert.equal(reader.state, 'paused');
  assert.equal(read.length, 4);
  await reader.back(10);
  assert.equal(reader.current.text, 'Раз');
  assert.equal(read.length, 4);
});

test('an event-loop stall counts bounded time and never catches up by skipping words', async t => {
  const read = [];
  const { reader, fire, timers } = controller(t, ['Раз два три четыре.'], { onRead: e => read.push(e) });
  await reader.open();
  await reader.play();
  await fire(30000);
  assert.equal(read.length, 1);
  assert.equal(reader.current.text, 'Раз');
  assert.equal(reader.state, 'paused');
  assert.equal(timers.size, 0);
  assert.equal(reader.activeMs, 1000);
});

test('destroying during asynchronous preparation emits no later word/state callbacks', async t => {
  const words = [], states = [];
  const { reader, sections } = controller(t, ['Один два.'], { onWord: w => words.push(w), onState: s => states.push(s) });
  let resolve;
  reader._load = () => new Promise(r => { resolve = r; });
  const pending = reader.open();
  reader.destroy();
  const before = states.length;
  resolve(sections[0]);
  await pending;
  assert.equal(words.length, 0);
  assert.equal(states.length, before);
});

test('pausing/resuming a lazy chapter transition does not duplicate the next chapter', async t => {
  const shown = [];
  const { reader, sections, fire } = controller(t, ['Первое.', 'Второе третье.'], { onWord: w => shown.push(w.text) });
  let resolve;
  reader._load = async index => index === 0 ? sections[0] : new Promise(r => { resolve = r; });
  await reader.open();
  await reader.play();
  const pending = fire(300);
  assert.equal(reader.state, 'loading');
  reader.pause();
  await reader.play();
  resolve(sections[1]);
  await pending;
  assert.deepEqual(shown, ['Первое.', 'Второе']);
  assert.equal(reader.state, 'playing');
});
