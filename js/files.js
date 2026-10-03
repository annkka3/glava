// Book files (EPUB, FB2…) stay on this device only: they live in IndexedDB and are never synced,
// so "has a file" is a fact about the device, not about the book record.
import { db } from './db.js';

const ids = new Set();

export const files = {
  async init() { for (const k of await db.fileKeys()) ids.add(k); },
  has: id => ids.has(id),
  /** @param {File} file */
  async attach(id, file) {
    await db.putFile(id, { blob: file, name: file.name, size: file.size, type: file.type, at: Date.now() });
    ids.add(id);
  },
  async get(id) {
    const rec = await db.getFile(id);
    return rec ? new File([rec.blob], rec.name, { type: rec.type }) : null;
  },
  async info(id) {
    const rec = await db.getFile(id);
    return rec ? { name: rec.name, size: rec.size } : null;
  },
  async remove(id) { await db.delFile(id); ids.delete(id); },
};
