// Progress tab: overall progress and per-flower tracking

import * as store from './store.js';
import { pageUrl } from './pages.js';

let buildData = null;
let currentState = null;
let onNavigateToFlower = null;

export async function init(buildJson, navigateCallback) {
  buildData = buildJson;
  currentState = await store.getState();
  onNavigateToFlower = navigateCallback;

  setupDOM();
  render();
}

function setupDOM() {
  const container = document.getElementById('tracker-content');
  container.innerHTML = `
    <div class="tracker-container">
      <div class="overall-progress">
        <h2>Overall Progress</h2>
        <div class="progress-bar-container">
          <div id="progress-bar" class="progress-bar"></div>
        </div>
        <p id="progress-text">0 / 14 flowers</p>
      </div>

      <div class="bags-container" id="bags-container">
      </div>

      <div class="reference-section">
        <h3>Reference</h3>
        <ul id="reference-list"></ul>
      </div>

      <div id="share-panel" class="share-panel"></div>
    </div>
  `;
}

async function render() {
  currentState = await store.getState();

  // Calculate progress
  const flowerIds = buildData.flowers.map(f => f.id);
  const totalCount = buildData.flowers.reduce((sum, f) => sum + f.count, 0);
  const doneCount = Object.values(currentState.done).reduce((sum, v) => sum + v, 0);

  const percentage = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  document.getElementById('progress-bar').style.width = percentage + '%';
  document.getElementById('progress-text').textContent = `${doneCount} / ${totalCount} flowers`;

  // Group flowers by bag
  const bags = {};
  for (const flower of buildData.flowers) {
    if (!bags[flower.bag]) {
      bags[flower.bag] = [];
    }
    bags[flower.bag].push(flower);
  }

  // Render bags
  let bagsHtml = '';
  for (let bag = 1; bag <= 5; bag++) {
    if (!bags[bag]) continue;

    bagsHtml += `<div class="bag-group">
      <h3>Bag ${bag}</h3>
      <div class="flowers-list" data-bag="${bag}">
    `;

    for (const flower of bags[bag]) {
      const done = currentState.done[flower.id] || 0;
      const buildText = flower.count > 1 ? `${done}/${flower.count}` : (done ? '✓' : '○');
      const swatch = `<div class="color-swatch" style="background-color: ${flower.colour}"></div>`;

      bagsHtml += `
        <div class="flower-item" data-flower-id="${flower.id}">
          ${swatch}
          <span class="flower-name">${flower.name}</span>
          <div class="flower-controls">
            <button class="btn-stepper" data-action="minus" aria-label="Decrease">−</button>
            <span class="build-status">${buildText}</span>
            <button class="btn-stepper" data-action="plus" aria-label="Increase">+</button>
            <button class="btn-goto" aria-label="Go to instructions">Open</button>
          </div>
        </div>
      `;
    }

    bagsHtml += '</div></div>';
  }

  document.getElementById('bags-container').innerHTML = bagsHtml;

  // Render reference sections
  let refHtml = '';
  for (const intro of buildData.intro) {
    refHtml += `<li><button class="btn-ref" data-pages="${intro.pages.join(',')}">${intro.title}</button></li>`;
  }
  document.getElementById('reference-list').innerHTML = refHtml;

  // Event listeners
  document.querySelectorAll('.btn-stepper').forEach(btn => {
    btn.addEventListener('click', handleStepper);
  });

  document.querySelectorAll('.btn-goto').forEach(btn => {
    btn.addEventListener('click', handleGoto);
  });

  document.querySelectorAll('.btn-ref').forEach(btn => {
    btn.addEventListener('click', handleReference);
  });
}

async function handleStepper(e) {
  const action = e.target.dataset.action;
  const flowerItem = e.target.closest('.flower-item');
  const flowerId = flowerItem.dataset.flowerId;
  const flower = buildData.flowers.find(f => f.id === flowerId);

  if (!flower) return;

  if (!currentState.done[flowerId]) {
    currentState.done[flowerId] = 0;
  }

  if (action === 'plus' && currentState.done[flowerId] < flower.count) {
    currentState.done[flowerId]++;
  } else if (action === 'minus' && currentState.done[flowerId] > 0) {
    currentState.done[flowerId]--;
  }

  await store.saveState(currentState);
  render();
}

async function handleGoto(e) {
  const flowerItem = e.target.closest('.flower-item');
  const flowerId = flowerItem.dataset.flowerId;
  const flower = buildData.flowers.find(f => f.id === flowerId);

  if (flower && flower.pages.length > 0) {
    const firstPageId = flower.pages[0];
    currentState.currentPageId = firstPageId;
    await store.saveState(currentState);

    if (onNavigateToFlower) {
      onNavigateToFlower();
    }
  }
}

function handleReference(e) {
  const pageIds = e.target.dataset.pages.split(',');
  showReferenceViewer(pageIds, e.target.textContent);
}

function showReferenceViewer(pageIds, title) {
  const overlay = document.createElement('div');
  overlay.className = 'reference-viewer-overlay';

  let currentRefIdx = 0;

  function renderPage() {
    const pageId = pageIds[currentRefIdx];

    overlay.innerHTML = `
      <div class="reference-viewer">
        <div class="ref-header">
          <h2>${title}</h2>
          <button class="btn-close">×</button>
        </div>
        <div class="ref-image-area">
          <img alt="Reference page" class="ref-image">
        </div>
        <div class="ref-controls">
          <button class="ref-btn-back" ${currentRefIdx === 0 ? 'disabled' : ''}>Back</button>
          <span class="ref-position">${currentRefIdx + 1} / ${pageIds.length}</span>
          <button class="ref-btn-next" ${currentRefIdx === pageIds.length - 1 ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `;

    const image = overlay.querySelector('.ref-image');
    pageUrl(pageId).then((url) => { image.src = url; }, (err) => console.error('Could not show page:', err));

    overlay.querySelector('.btn-close').addEventListener('click', () => overlay.remove());

    if (currentRefIdx > 0) {
      overlay.querySelector('.ref-btn-back').addEventListener('click', () => {
        currentRefIdx--;
        renderPage();
      });
    }

    if (currentRefIdx < pageIds.length - 1) {
      overlay.querySelector('.ref-btn-next').addEventListener('click', () => {
        currentRefIdx++;
        renderPage();
      });
    }
  }

  document.body.appendChild(overlay);
  renderPage();
}

export async function updateFromState() {
  currentState = await store.getState();
  render();
}
