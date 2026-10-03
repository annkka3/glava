// Moving data in and out as files: the one-time list import ("seed") and full backup copies.
import { today } from './util.js';
import { store, COLLECTIONS } from './store.js';

const KEEP = ['status', 'finishedAt', 'startedAt', 'rating', 'note', 'prog', 'page', 'pages', 'plan', 'touched', 'speed', 'cv', 'added'];
const RANK = { want: 0, paused: 1, reading: 2, read: 3 };

/** Merge a list file into the library. What the reader has already done with a book is never undone. */
async function importSeed(data) {
  const entries = [];
  let added = 0;
  for (const { id, fix, ...book } of data.books || []) {
    if (!id || !book.title) continue;
    const cur = store.books.get(id);
    if (cur) {
      const mine = Object.fromEntries(KEEP.filter(k => cur[k] != null).map(k => [k, cur[k]]));
      // `fix` marks a correction to an earlier list: it wins over an undated mark that came from that list.
      const corrected = fix && !cur.finishedAt && cur.status !== 'reading';
      const status = corrected ? book.status : (RANK[cur.status] || 0) >= (RANK[book.status] || 0) ? cur.status : book.status;
      entries.push(['books', id, { ...book, ...mine, status }]);
    } else {
      entries.push(['books', id, { ...book, status: book.status || 'want', added: today() }]);
      added++;
    }
  }
  let lists = 0;
  for (const { id, ...col } of data.collections || []) {
    if (!id || !col.name) continue;
    const cur = store.cols.get(id);
    const extra = cur ? (cur.items || []).filter(x => !(col.items || []).includes(x)) : [];
    entries.push(['cols', id, { ...col, items: [...(col.items || []), ...extra] }]);
    lists++;
  }
  await store.bulk(entries);
  return `Загружено: книг ${added}, подборок ${lists}`;
}

async function importBackup(data) {
  const entries = [];
  for (const coll of COLLECTIONS) for (const [id, doc] of Object.entries(data[coll] || {})) entries.push([coll, id, doc]);
  await store.bulk(entries);
  return `Восстановлено записей: ${entries.length}`;
}

export async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('Это не файл «Главы»: его не удалось прочитать'); }
  if (data.format === 'glava-seed') return importSeed(data);
  if (data.format === 'glava-backup') return importBackup(data);
  throw new Error('Это не файл «Главы»');
}

export function backupBlob() {
  const out = { format: 'glava-backup', version: 1, at: new Date().toISOString() };
  for (const coll of COLLECTIONS) {
    out[coll] = {};
    for (const [id, doc] of store[coll]) { const { _d, ...clean } = doc; out[coll][id] = clean; }
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}
