// Book files (EPUB, FB2…) stay on this device only: they live in IndexedDB and are never synced,
// so "has a file" is a fact about the device, not about the book record.
import { db } from './db.js';

const ids = new Set();
const sizes = new Map();
// Anything showing which books are on the device redraws on this event.
const changed = () => window.dispatchEvent(new Event('glava-files'));

export const files = {
  async init() {
    for (const k of await db.fileKeys()) {
      ids.add(k);
      const rec = await db.getFile(k);
      if (rec) sizes.set(k, rec.size || 0);
    }
  },
  has: id => ids.has(id),
  size: id => sizes.get(id) || 0,
  get count() { return ids.size; },
  /** @param {File} file */
  async attach(id, file) {
    await db.putFile(id, { blob: file, name: file.name, size: file.size, type: file.type, at: Date.now() });
    ids.add(id);
    sizes.set(id, file.size || 0);
    changed();
  },
  async get(id) {
    const rec = await db.getFile(id);
    return rec ? new File([rec.blob], rec.name, { type: rec.type }) : null;
  },
  async info(id) {
    const rec = await db.getFile(id);
    return rec ? { name: rec.name, size: rec.size } : null;
  },
  async remove(id) { await db.delFile(id); ids.delete(id); sizes.delete(id); changed(); },
};
