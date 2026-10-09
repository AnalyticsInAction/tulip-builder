// Build tab: page player with navigation, playback, zoom, and photo capture

import * as store from './store.js';
import { takePhoto } from './camera.js';
import { pageUrl, preload } from './pages.js';

let pageSequence = null; // every page of every flower, in build order
let state = null;
let playTimer = null;
let playSpeed = 5; // seconds per page
let zoomed = false;

const $ = (id) => document.getElementById(id);

function buildPageSequence(buildData) {
  const sequence = [];
  for (const flower of buildData.flowers) {
    flower.pages.forEach((pageId, i) => {
      sequence.push({ pageId, flower, lastOfFlower: i === flower.pages.length - 1 });
    });
  }
  return sequence;
}

function currentIndex() {
  const idx = pageSequence.findIndex((p) => p.pageId === state.currentPageId);
  return idx < 0 ? 0 : idx;
}

export async function init(buildJson) {
  pageSequence = buildPageSequence(buildJson);
  state = await store.getState();

  setupDOM();
  render();
}

// Called when the Build tab is shown, so a jump made from Progress appears.
export function updateFromState() {
  render();
}

function setupDOM() {
  $('player-content').innerHTML = `
    <div class="player-header">
      <div class="flower-info">
        <h2 id="flower-name"></h2>
        <div id="flower-meta"></div>
      </div>
    </div>

    <div class="player-image-area">
      <div id="image-container" class="image-container">
        <img id="page-image" class="page-image" src="" alt="Instruction page">
      </div>
      <div id="finish-prompt" class="finish-prompt hidden">
        <p id="finish-text">Finished this flower?</p>
        <button id="finish-yes">Yes!</button>
        <button id="finish-not-yet">Not yet</button>
      </div>
      <div id="player-toast" class="player-toast hidden" role="status"></div>
    </div>

    <div class="player-controls">
      <div class="control-row">
        <button id="btn-back" class="btn-control">◀ Back</button>
        <button id="btn-play" class="btn-control">▶ Play</button>
        <button id="btn-next" class="btn-control">Next ▶</button>
      </div>

      <div class="control-row">
        <input type="range" id="page-slider" class="page-slider" min="0" value="0" aria-label="Page">
        <span id="page-position" class="page-position"></span>
      </div>

      <div class="control-row">
        <select id="speed-select" class="speed-select" aria-label="Play speed">
          <option value="8">Slow</option>
          <option value="5" selected>Medium</option>
          <option value="2">Fast</option>
        </select>
        <button id="btn-zoom" class="btn-control">🔍 Zoom</button>
        <button id="btn-photo" class="btn-control btn-photo">📷 Photo</button>
      </div>
    </div>
  `;

  $('page-slider').max = pageSequence.length - 1;

  $('btn-back').addEventListener('click', goBack);
  $('btn-next').addEventListener('click', goNext);
  $('btn-play').addEventListener('click', togglePlay);
  $('speed-select').addEventListener('change', (e) => {
    playSpeed = parseInt(e.target.value, 10);
    if (playTimer) schedulePlay();
  });
  $('page-slider').addEventListener('input', (e) => goTo(parseInt(e.target.value, 10)));
  $('btn-zoom').addEventListener('click', () => setZoom(!zoomed));
  $('btn-photo').addEventListener('click', capturePhoto);
  $('finish-yes').addEventListener('click', () => answerFinish(true));
  $('finish-not-yet').addEventListener('click', () => answerFinish(false));

  setupSwipe($('image-container'));

  document.addEventListener('keydown', (e) => {
    if ($('build-content').classList.contains('hidden')) return;
    if (e.target.closest('input, textarea, select, button')) return;
    if (e.key === 'ArrowLeft') goBack();
    if (e.key === 'ArrowRight') goNext();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });
}

function setupSwipe(element) {
  let startX = 0;
  let startY = 0;
  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  element.addEventListener('touchend', (e) => {
    if (zoomed) return; // dragging pans the zoomed page instead
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext(); else goBack();
    }
  }, { passive: true });
}

function render() {
  const idx = currentIndex();
  const { pageId, flower } = pageSequence[idx];
  const built = state.done[flower.id] || 0;

  $('player-content').style.setProperty('--flower-colour', flower.colour);
  $('flower-name').textContent = flower.name;
  $('flower-meta').textContent = `Bag ${flower.bag} · Page ${idx + 1} of ${pageSequence.length}` +
    (built >= flower.count ? ' · Built ✓' : '');

  showPage(pageId);
  if (idx + 1 < pageSequence.length) preload(pageSequence[idx + 1].pageId);

  $('page-slider').value = idx;
  $('page-position').textContent = `${idx + 1} / ${pageSequence.length}`;
  $('btn-back').disabled = idx === 0;

  setZoom(false);
  $('finish-prompt').classList.add('hidden');
}

let shownPageId = null;
async function showPage(pageId) {
  if (pageId === shownPageId) return;
  shownPageId = pageId;
  try {
    const url = await pageUrl(pageId);
    if (shownPageId === pageId) $('page-image').src = url; // a later page turn wins
  } catch (err) {
    console.error('Could not show page:', err);
    if (shownPageId === pageId) {
      shownPageId = null;
      showToast('This page could not be loaded');
    }
  }
}

function goTo(idx) {
  if (idx < 0 || idx >= pageSequence.length) return;
  state.currentPageId = pageSequence[idx].pageId;
  store.saveState(state);
  render();
}

function goBack() {
  goTo(currentIndex() - 1);
}

// Leaving the last page of a flower asks whether it is finished first.
function goNext() {
  const idx = currentIndex();
  const { flower, lastOfFlower } = pageSequence[idx];
  const built = state.done[flower.id] || 0;

  if (lastOfFlower && built < flower.count) {
    if (!$('finish-prompt').classList.contains('hidden')) return;
    stopPlay();
    $('finish-text').textContent = flower.count > 1
      ? `Finished one of these? (${built} of ${flower.count} built)`
      : 'Finished this flower?';
    $('finish-prompt').classList.remove('hidden');
    return;
  }
  goTo(idx + 1);
}

function answerFinish(finished) {
  const idx = currentIndex();
  const { flower } = pageSequence[idx];
  if (finished) {
    state.done[flower.id] = Math.min(flower.count, (state.done[flower.id] || 0) + 1);
    store.saveState(state);
  }
  if (idx + 1 < pageSequence.length) {
    goTo(idx + 1);
  } else {
    render();
    if (finished) showToast('The whole bouquet is built! 🌷');
  }
}

function togglePlay() {
  if (playTimer) stopPlay(); else schedulePlay();
}

function schedulePlay() {
  clearTimeout(playTimer);
  $('btn-play').textContent = '⏸ Pause';
  playTimer = setTimeout(() => {
    playTimer = null;
    if (currentIndex() >= pageSequence.length - 1) return stopPlay();
    goNext();
    // goNext stops playback itself when it asks "Finished this flower?"
    if ($('finish-prompt').classList.contains('hidden')) schedulePlay();
  }, playSpeed * 1000);
}

function stopPlay() {
  clearTimeout(playTimer);
  playTimer = null;
  $('btn-play').textContent = '▶ Play';
}

function setZoom(on) {
  zoomed = on;
  $('image-container').classList.toggle('zoomed', on);
  $('btn-zoom').textContent = on ? '🔍 Fit' : '🔍 Zoom';
  if (!on) $('image-container').scrollTo(0, 0);
}

async function capturePhoto() {
  stopPlay();
  const { pageId, flower } = pageSequence[currentIndex()];
  try {
    const blob = await takePhoto();
    if (!blob) return;
    await store.addPhoto({ blob, pageId, flowerId: flower.id, note: '' });
    showToast('Photo saved 📷');
  } catch (err) {
    console.error('Error capturing photo:', err);
    showToast('Sorry, that photo could not be saved');
  }
}

let toastTimer = null;
function showToast(text) {
  const toast = $('player-toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2500);
}
