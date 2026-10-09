// Storage module - only place that touches localStorage and IndexedDB
// All functions are async to allow cloud backend replacement later

let db = null;
let state = null; // one shared object, so every screen sees the same progress
const listeners = [];

// Lets the sharing code hear about changes without the screens knowing about it.
export function onChange(listener) {
  listeners.push(listener);
}

function emit(type, detail) {
  for (const listener of listeners) {
    try {
      listener(type, detail);
    } catch (err) {
      console.error('Change listener failed:', err);
    }
  }
}

function photoName(takenAt) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${takenAt.replace(/[-:.]/g, '')}-${random}.bin`;
}

async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('tulip', 1);

      req.onerror = () => {
        console.error('DB error:', req.error);
        reject(req.error);
      };

      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };

      req.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains('photos')) {
          database.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

export async function getState() {
  if (state) return state;

  // Default state: first page of first flower
  state = {
    currentPageId: 'b1-009',
    done: {},
    updatedAt: new Date().toISOString()
  };
  try {
    const stored = localStorage.getItem('tulip.state');
    if (stored) {
      Object.assign(state, JSON.parse(stored));
    }
  } catch (err) {
    console.error('Error reading state:', err);
  }
  return state;
}

export async function saveState(state) {
  try {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem('tulip.state', JSON.stringify(state));
  } catch (err) {
    console.error('Error saving state:', err);
  }
  emit('state', state);
}

export async function addPhoto({ blob, pageId, flowerId, note }) {
  try {
    await initDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('photos', 'readwrite');
        const store = tx.objectStore('photos');

        const takenAt = new Date().toISOString();
        const record = {
          blob,
          pageId,
          flowerId,
          note: note || '',
          takenAt,
          name: photoName(takenAt), // file name used when the photo is shared
          synced: false
        };

        const req = store.add(record);
        req.onsuccess = () => {
          record.id = req.result;
          emit('photo-added', record);
          resolve(record);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error adding photo:', err);
    throw err;
  }
}

export async function listPhotos() {
  try {
    await initDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('photos', 'readonly');
        const store = tx.objectStore('photos');
        const req = store.getAll();

        req.onsuccess = () => {
          const photos = req.result;
          photos.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
          resolve(photos);
        };
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error listing photos:', err);
    return [];
  }
}

export async function markPhotoSynced(id) {
  await initDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction('photos', 'readwrite').objectStore('photos');
    const get = store.get(id);
    get.onsuccess = () => {
      if (!get.result) return resolve();
      const put = store.put({ ...get.result, synced: true });
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    };
    get.onerror = () => reject(get.error);
  });
}

export async function deletePhoto(id) {
  try {
    await initDB();

    return new Promise((resolve, reject) => {
      try {
        const store = db.transaction('photos', 'readwrite').objectStore('photos');
        const get = store.get(id);
        get.onsuccess = () => {
          const record = get.result;
          const req = store.delete(id);
          req.onsuccess = () => {
            if (record) emit('photo-deleted', record);
            resolve();
          };
          req.onerror = () => reject(req.error);
        };
        get.onerror = () => reject(get.error);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error deleting photo:', err);
    throw err;
  }
}
