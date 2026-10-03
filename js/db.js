// Thin promise wrapper over IndexedDB. Three stores:
//   docs  — app data, key "collection/id" (books, collections, days, quotes, meta)
//   files — book files (EPUB/FB2) as Blobs, key = book id; they never leave the device
//   kv    — device-local bookkeeping (sync cursors, device id)

const NAME = 'glava', VERSION = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['docs', 'files', 'kv']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const db = {
  /** All app documents as [key, value] pairs. */
  async allDocs() {
    const db = await open();
    const s = db.transaction('docs').objectStore('docs');
    const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
    return keys.map((k, i) => [k, values[i]]);
  },
  putDocs(entries) { return tx('docs', 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); }); },
  delDocs(keys) { return tx('docs', 'readwrite', s => { for (const k of keys) s.delete(k); }); },

  async getFile(id) { const db = await open(); return done(db.transaction('files').objectStore('files').get(id)); },
  putFile(id, file) { return tx('files', 'readwrite', s => { s.put(file, id); }); },
  delFile(id) { return tx('files', 'readwrite', s => { s.delete(id); }); },
  async fileKeys() { const db = await open(); return done(db.transaction('files').objectStore('files').getAllKeys()); },

  async kvGet(key) { const db = await open(); return done(db.transaction('kv').objectStore('kv').get(key)); },
  kvSet(key, value) { return tx('kv', 'readwrite', s => { s.put(value, key); }); },
};

/** Ask the browser not to evict our data under storage pressure (granted for home-screen apps). */
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* unsupported */ }
  return false;
}
