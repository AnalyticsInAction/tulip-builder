// Instruction pages are published encrypted (pages/<id>.bin). This fetches
// and decrypts one and hands back an image URL, keeping it for the session.

import { decrypt } from './vault.js';

const cache = new Map();
let key = null;

export function setKey(familyKey) {
  key = familyKey;
}

export function pageUrl(pageId) {
  if (!cache.has(pageId)) {
    const loading = fetch(`pages/${pageId}.bin`)
      .then((res) => {
        if (!res.ok) throw new Error(`Page ${pageId} not found`);
        return res.arrayBuffer();
      })
      .then((data) => decrypt(key, data))
      .then((plain) => URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' })))
      .catch((err) => {
        cache.delete(pageId);
        throw err;
      });
    cache.set(pageId, loading);
  }
  return cache.get(pageId);
}

// Warm the cache for a page that is likely to be shown next.
export function preload(pageId) {
  pageUrl(pageId).catch(() => {});
}
