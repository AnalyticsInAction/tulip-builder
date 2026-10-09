// Shares progress and photos through the GitHub repo's data branch.
//
// The building device writes with a GitHub token that is limited to this one
// repo and kept only on that device. Viewers need no token: the repo is
// public, and what is in it can only be read with the family key.
//
//   status.bin           encrypted JSON: { currentPageId, done, updatedAt }
//   photos/<name>.bin    encrypted: 4-byte header length | header JSON | JPEG

import { REPO, DATA_BRANCH } from './config.js';
import { encrypt, decrypt, encryptJson, decryptJson } from './vault.js';
import * as store from './store.js';

const API = `https://api.github.com/repos/${REPO}/contents/`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/`;
const TOKEN_STORAGE = 'tulip.token';
const STATUS_DELAY = 15000; // page turns are frequent; share at most this often

let key = null;
let token = null;
let statusSha; // undefined until looked up, null when the file does not exist yet
let statusTimer = null;
let queue = Promise.resolve(); // GitHub rejects overlapping commits, so one at a time
const watchers = [];
const info = { state: 'off', message: 'Sharing is not set up on this device', lastSharedAt: null };

// ---- token -----------------------------------------------------------------

// Call before vault.loadFamilyKey(), which clears the link from the address bar.
export function loadToken() {
  const match = location.hash.match(/t=([A-Za-z0-9_]+)/);
  try {
    if (match) localStorage.setItem(TOKEN_STORAGE, match[1]);
    token = localStorage.getItem(TOKEN_STORAGE);
  } catch {
    token = match ? match[1] : null;
  }
  return token;
}

export function getToken() {
  return token;
}

// Checks the token can reach the repo before keeping it.
export async function setToken(value) {
  const candidate = value.trim();
  const res = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { Authorization: `Bearer ${candidate}`, Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('GitHub did not accept that token');
  const repo = await res.json();
  if (!repo.permissions || !repo.permissions.push) throw new Error('That token cannot save to the repo');
  token = candidate;
  try {
    localStorage.setItem(TOKEN_STORAGE, token);
  } catch {
    // storage blocked: sharing works until the page is closed
  }
  setInfo('idle', 'Sharing is on');
  syncAll();
}

export function forgetToken() {
  token = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE);
  } catch {
    // nothing stored
  }
  setInfo('off', 'Sharing is not set up on this device');
}

// ---- status for the Share panel -------------------------------------------

export function getInfo() {
  return info;
}

export function onInfo(watcher) {
  watchers.push(watcher);
}

function setInfo(state, message) {
  info.state = state;
  info.message = message;
  for (const watcher of watchers) watcher(info);
}

// ---- GitHub contents API ---------------------------------------------------

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = API + path + (method === 'GET' ? `?ref=${DATA_BRANCH}` : '');
  const res = await fetch(url, {
    method,
    headers,
    cache: 'no-store',
    body: body ? JSON.stringify({ ...body, branch: DATA_BRANCH }) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    throw Object.assign(new Error(`GitHub answered ${res.status}`), { status: res.status });
  }
  return res;
}

async function getSha(path) {
  const res = await api(path);
  return res.status === 404 ? null : (await res.json()).sha;
}

async function putFile(path, bytes, sha) {
  const body = { message: `Update ${path}`, content: toBase64(bytes) };
  if (sha) body.sha = sha;
  const res = await api(path, { method: 'PUT', body });
  if (res.status === 404) throw Object.assign(new Error('Repo or data branch not found'), { status: 404 });
  return (await res.json()).content.sha;
}

// ---- writing (building device) --------------------------------------------

function enqueue(job) {
  queue = queue.then(async () => {
    if (!token || !key) return;
    setInfo('syncing', 'Sharing…');
    try {
      await job();
      info.lastSharedAt = new Date().toISOString();
      setInfo('idle', 'Everything is shared');
    } catch (err) {
      console.error('Sharing failed:', err);
      const reason = err.status === 401 || err.status === 403 ? 'the token was refused' : 'no connection to GitHub';
      setInfo('error', `Not shared yet: ${reason}. It will try again.`);
    }
  });
  return queue;
}

async function pushStatus() {
  const state = await store.getState();
  const payload = { currentPageId: state.currentPageId, done: state.done, updatedAt: state.updatedAt };
  const bytes = await encryptJson(key, payload);
  if (statusSha === undefined) statusSha = await getSha('status.bin');
  try {
    statusSha = await putFile('status.bin', bytes, statusSha);
  } catch (err) {
    if (err.status !== 409 && err.status !== 422) throw err;
    statusSha = await getSha('status.bin'); // someone else saved in between
    statusSha = await putFile('status.bin', bytes, statusSha);
  }
}

async function packPhoto(record) {
  const header = new TextEncoder().encode(JSON.stringify({
    flowerId: record.flowerId, pageId: record.pageId, note: record.note, takenAt: record.takenAt,
  }));
  const image = new Uint8Array(await record.blob.arrayBuffer());
  const plain = new Uint8Array(4 + header.length + image.length);
  new DataView(plain.buffer).setUint32(0, header.length);
  plain.set(header, 4);
  plain.set(image, 4 + header.length);
  return encrypt(key, plain);
}

async function pushPendingPhotos() {
  for (const record of await store.listPhotos()) {
    if (record.synced || !record.name) continue;
    const path = `photos/${record.name}`;
    try {
      await putFile(path, await packPhoto(record));
    } catch (err) {
      if (err.status !== 422) throw err; // 422: already uploaded by an earlier, interrupted try
    }
    await store.markPhotoSynced(record.id);
  }
}

async function removePhoto(record) {
  if (!record.synced || !record.name) return;
  const path = `photos/${record.name}`;
  const sha = await getSha(path);
  if (sha) await api(path, { method: 'DELETE', body: { message: `Remove ${path}`, sha } });
}

function scheduleStatus() {
  if (!token) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(flushStatus, STATUS_DELAY);
}

function flushStatus() {
  if (!statusTimer) return;
  clearTimeout(statusTimer);
  statusTimer = null;
  enqueue(pushStatus);
}

export function syncAll() {
  clearTimeout(statusTimer);
  statusTimer = null;
  return enqueue(async () => {
    await pushPendingPhotos();
    await pushStatus();
  });
}

// Start sharing changes made on this device.
export function start(familyKey) {
  key = familyKey;
  if (token) setInfo('idle', 'Sharing is on');
  store.onChange((type, detail) => {
    if (type === 'state') scheduleStatus();
    if (type === 'photo-added') enqueue(pushPendingPhotos);
    if (type === 'photo-deleted') enqueue(() => removePhoto(detail));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStatus();
  });
  window.addEventListener('online', syncAll);
  if (token) syncAll();
}

// ---- reading (grandmother's view) -----------------------------------------

export function setKey(familyKey) {
  key = familyKey;
}

export async function fetchStatus() {
  const res = await api('status.bin', { raw: true });
  if (res.status === 404) return null;
  return decryptJson(key, await res.arrayBuffer());
}

// Newest first: the names start with the time the photo was taken.
export async function listPhotoNames() {
  const res = await api('photos');
  if (res.status === 404) return [];
  return (await res.json())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.bin'))
    .sort()
    .reverse();
}

export async function fetchPhoto(name) {
  const res = await fetch(RAW + 'photos/' + name);
  if (!res.ok) throw new Error(`Photo ${name} not found`);
  const plain = new Uint8Array(await decrypt(key, await res.arrayBuffer()));
  const headerLength = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + headerLength)));
  return { ...header, name, blob: new Blob([plain.subarray(4 + headerLength)], { type: 'image/jpeg' }) };
}
