// Encryption for everything that is published: photos, status and the
// instruction pages. The key is 32 random bytes that live only in the link
// fragment (#k=...) and in each family device's local storage, so the public
// site holds nothing readable.
//
// File layout: "TLP1" (4 bytes) | iv (12 bytes) | AES-256-GCM ciphertext + tag.

const MAGIC = new TextEncoder().encode('TLP1');
const KEY_STORAGE = 'tulip.key';

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function familyKeyText() {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function importKey(text) {
  const raw = fromBase64Url(text);
  if (raw.length !== 32) throw new Error('Family key must be 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Takes the key from the link the first time, then remembers it on this
// device and removes it from the address bar. Returns null when there is none.
export async function loadFamilyKey() {
  const match = location.hash.match(/k=([A-Za-z0-9_-]+)/);
  let text = match ? match[1] : null;
  try {
    if (text) {
      localStorage.setItem(KEY_STORAGE, text);
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      text = localStorage.getItem(KEY_STORAGE);
    }
  } catch {
    // storage blocked: the key still works for this visit
  }
  return text ? importKey(text) : null;
}

export async function encrypt(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(MAGIC.length + iv.length + sealed.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(sealed, MAGIC.length + iv.length);
  return out;
}

export async function decrypt(key, data) {
  const bytes = new Uint8Array(data);
  if (!MAGIC.every((byte, i) => bytes[i] === byte)) throw new Error('Not a Tulip Builder file');
  const iv = bytes.subarray(4, 16);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(16));
}

export async function encryptJson(key, value) {
  return encrypt(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJson(key, data) {
  return JSON.parse(new TextDecoder().decode(await decrypt(key, data)));
}
