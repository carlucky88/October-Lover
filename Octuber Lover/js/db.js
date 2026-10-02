// Almacenamiento local en IndexedDB: recuerdos, archivos (fotos/videos) y ajustes.
// Todo se guarda aquí primero; la sincronización con la nube parte de estos datos.

const DB_NAME = 'octubre-juntos';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('memories', { keyPath: 'id' });
        db.createObjectStore('media');
        db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  allMemories: () => run('memories', 'readonly', s => s.getAll()),
  getMemory: id => run('memories', 'readonly', s => s.get(id)),
  putMemory: m => run('memories', 'readwrite', s => s.put(m)),
  deleteMemory: id => run('memories', 'readwrite', s => s.delete(id)),

  getMedia: id => run('media', 'readonly', s => s.get(id)),
  putMedia: (id, blob) => run('media', 'readwrite', s => s.put(blob, id)),
  deleteMedia: id => run('media', 'readwrite', s => s.delete(id)),

  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  del: key => run('kv', 'readwrite', s => s.delete(key)),

  async clear() {
    for (const store of ['memories', 'media', 'kv']) {
      await run(store, 'readwrite', s => s.clear());
    }
  },
};
