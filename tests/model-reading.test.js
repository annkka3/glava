import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../js/db.js';
import { store } from '../js/store.js';
import { day, logReading, PAGE_CHARS } from '../js/model.js';

function memoryOnly(t) {
  // Keep the real model and Store write-through path; replace only browser disk I/O.
  t.mock.method(db, 'putDocs', async () => {});
  store.days.clear();
  t.after(() => { store.days.clear(); store.dirty.clear(); });
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.0001,
    `${message}: expected ${expected}, received ${actual}`);
}

test('five-second saves preserve elapsed time and sub-tenth-page reading', t => {
  memoryOnly(t);
  const date = '2026-01-01', bookId = 'synthetic-book';
  // Six minutes saved every five seconds. Rounding each save to 0.1 would
  // inflate the time to 7.2 minutes and discard all these small page increments.
  for (let i = 0; i < 72; i++) {
    logReading({ date, bookId, minutes: 5 / 60, pages: 17 / PAGE_CHARS });
  }
  const total = day(date);
  near(total.m, 6, 'Reading time reflects elapsed playback');
  near(total.p, 72 * 17 / PAGE_CHARS, 'Short word reads are retained');
  assert.equal(total.l, 0);
  assert.deepEqual(total.b[bookId], { p: total.p, m: total.m, l: 0 });
});

test('totals are stable across save frequency and retain the listening subset per book', t => {
  memoryOnly(t);
  const frequentDate = '2026-01-02', batchDate = '2026-01-03';
  for (let i = 0; i < 48; i++) {
    logReading({ date: frequentDate, bookId: 'words', minutes: 0.25 / 60, pages: 9 / PAGE_CHARS });
  }
  for (let i = 0; i < 14; i++) {
    logReading({ date: frequentDate, bookId: 'audio', minutes: 3 / 60, listen: 3 / 60 });
  }
  logReading({ date: batchDate, bookId: 'words', minutes: 12 / 60, pages: 48 * 9 / PAGE_CHARS });
  logReading({ date: batchDate, bookId: 'audio', minutes: 42 / 60, listen: 42 / 60 });

  const frequent = day(frequentDate), batch = day(batchDate);
  for (const field of ['p', 'm', 'l']) {
    near(frequent[field], batch[field], `Daily ${field} does not depend on save frequency`);
    for (const id of ['words', 'audio']) {
      near(frequent.b[id][field], batch.b[id][field], `${id} ${field} remains consistent`);
    }
  }
  near(frequent.m - frequent.l, 12 / 60, 'Listening remains a subset, not extra reading time');
  assert.equal(frequent.b.words.l, 0);
  assert.equal(frequent.b.audio.l, frequent.b.audio.m);
});
