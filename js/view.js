// Grandmother's page: read-only progress and photos. It holds the family key
// (from her link) but no GitHub token, so it cannot change anything.

import * as sync from './sync.js';
import { loadFamilyKey } from './vault.js';

const REFRESH_EVERY = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const shown = new Map(); // photo name -> { figure, url }
let build = null;

async function init() {
  let key = null;
  try {
    key = await loadFamilyKey();
  } catch {
    // a damaged link is treated like a missing one
  }
  if (!key) {
    $('updated').textContent = 'This is a private family page. Please open it with the link you were sent.';
    return;
  }
  sync.setKey(key);
  build = await (await fetch('build.json')).json();

  $('refresh').addEventListener('click', refresh);
  $('viewer').addEventListener('click', () => $('viewer').close());
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  refresh();
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('refresh').disabled = true;
  try {
    const [status, names] = await Promise.all([sync.fetchStatus(), sync.listPhotoNames()]);
    renderStatus(status);
    await renderPhotos(names);
    $('refresh').hidden = false;
  } catch (err) {
    console.error('Could not load progress:', err);
    $('updated').textContent = err.name === 'OperationError'
      ? 'This link does not open the family page. Please ask for a new one.'
      : 'Could not check for news just now. Please try again in a little while.';
    $('refresh').hidden = false;
  } finally {
    refreshing = false;
    $('refresh').disabled = false;
  }
}

function when(iso) {
  const date = new Date(iso);
  const day = date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

function renderStatus(status) {
  $('summary').hidden = false;
  const done = (status && status.done) || {};
  const total = build.flowers.reduce((sum, flower) => sum + flower.count, 0);
  const built = build.flowers.reduce((sum, flower) => sum + Math.min(flower.count, done[flower.id] || 0), 0);

  $('count').textContent = built;
  $('bar').style.width = `${(built / total) * 100}%`;
  $('updated').textContent = status ? `Last news: ${when(status.updatedAt)}` : 'The build has not started yet.';

  // one dot per tulip, filled in once it is built
  $('flowers').replaceChildren(...build.flowers.flatMap((flower) =>
    Array.from({ length: flower.count }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = 'flower' + (i < (done[flower.id] || 0) ? ' built' : '');
      dot.style.setProperty('--c', flower.colour);
      dot.title = flower.name;
      return dot;
    })));

  const current = status && build.flowers.find((flower) => flower.pages.includes(status.currentPageId));
  if (built >= total) {
    $('now-swatch').hidden = true;
    $('now-text').textContent = 'The whole bouquet is finished! 🌷';
  } else if (current) {
    const page = current.pages.indexOf(status.currentPageId) + 1;
    $('now-swatch').hidden = false;
    $('now-swatch').style.background = current.colour;
    $('now-text').textContent = `Now building: ${current.name.toLowerCase()} (step page ${page} of ${current.pages.length}, bag ${current.bag} of 5)`;
  } else {
    $('now-swatch').hidden = true;
    $('now-text').textContent = 'Waiting to start.';
  }
}

async function renderPhotos(names) {
  $('photo-section').hidden = false;
  $('photo-empty').hidden = names.length > 0;

  for (const [name, entry] of shown) {
    if (!names.includes(name)) {
      URL.revokeObjectURL(entry.url);
      entry.figure.remove();
      shown.delete(name);
    }
  }

  // names are newest first; new photos go in ahead of the ones already shown
  let previous = null;
  for (const name of names) {
    if (shown.has(name)) {
      previous = shown.get(name).figure;
      continue;
    }
    let photo;
    try {
      photo = await sync.fetchPhoto(name);
    } catch (err) {
      console.error('Could not load photo:', err); // often just not published yet; the next check retries
      continue;
    }
    const figure = photoFigure(photo);
    if (previous) previous.after(figure); else $('photos').prepend(figure);
    previous = figure;
  }
}

function photoFigure(photo) {
  const url = URL.createObjectURL(photo.blob);
  const flower = build.flowers.find((f) => f.id === photo.flowerId);

  const figure = document.createElement('figure');
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Show this photo larger');
  const img = document.createElement('img');
  img.src = url;
  img.alt = flower ? `Photo of the ${flower.name.toLowerCase()}` : 'Photo of the build';
  button.append(img);
  button.addEventListener('click', () => {
    $('viewer-image').src = url;
    $('viewer').showModal();
  });

  const caption = document.createElement('figcaption');
  const title = document.createElement('div');
  title.textContent = flower ? flower.name : 'Tulip Bouquet';
  const time = document.createElement('div');
  time.className = 'muted';
  time.textContent = when(photo.takenAt);
  caption.append(title, time);
  if (photo.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = photo.note;
    caption.append(note);
  }

  figure.append(button, caption);
  shown.set(photo.name, { figure, url });
  return figure;
}

init();
