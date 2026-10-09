// Photos tab: photo grid, viewing, and management

import * as store from './store.js';
import { takePhoto } from './camera.js';

let buildData = null;

export async function init(buildJson) {
  buildData = buildJson;

  setupDOM();
  render();
}

function setupDOM() {
  const container = document.getElementById('journal-content');
  container.innerHTML = `
    <div class="journal-container">
      <div class="journal-controls">
        <button id="btn-add-photo" class="btn-primary">📷 Add photo</button>
      </div>

      <div id="journal-empty" class="journal-empty">
        <p>No photos yet. Take one while building!</p>
      </div>

      <div id="photos-grid" class="photos-grid"></div>
    </div>
  `;

  document.getElementById('btn-add-photo').addEventListener('click', showAddPhotoPrompt);
}

async function render() {
  const photos = await store.listPhotos();
  const grid = document.getElementById('photos-grid');
  const empty = document.getElementById('journal-empty');

  // Revoke old blob URLs to prevent memory leak
  document.querySelectorAll('.photo-image[data-blob-url]').forEach(img => {
    try {
      URL.revokeObjectURL(img.dataset.blobUrl);
    } catch (e) {
      // Ignore errors
    }
  });

  if (photos.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';

    grid.innerHTML = photos.map(photo => {
      const flower = buildData.flowers.find(f => f.id === photo.flowerId);
      const flowerName = flower ? flower.name : 'Unknown flower';
      const date = new Date(photo.takenAt);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const blobUrl = URL.createObjectURL(photo.blob);

      return `
        <div class="photo-card" data-photo-id="${photo.id}">
          <div class="photo-image-wrapper">
            <img class="photo-image" src="${blobUrl}" alt="Photo" data-blob-url="${blobUrl}">
          </div>
          <div class="photo-info">
            <p class="photo-flower">${flowerName}</p>
            <p class="photo-date">${dateStr} ${timeStr}</p>
            ${photo.note ? `<p class="photo-note">${escapeHtml(photo.note)}</p>` : ''}
          </div>
          <button class="btn-delete-photo" data-photo-id="${photo.id}" aria-label="Delete">×</button>
        </div>
      `;
    }).join('');

    // Event listeners
    document.querySelectorAll('.photo-image').forEach(img => {
      img.addEventListener('click', handlePhotoClick);
    });

    document.querySelectorAll('.btn-delete-photo').forEach(btn => {
      btn.addEventListener('click', handleDeletePhoto);
    });
  }
}

function handlePhotoClick(e) {
  const src = e.currentTarget.src;

  const overlay = document.createElement('div');
  overlay.className = 'photo-viewer-overlay';
  overlay.innerHTML = `
    <div class="photo-viewer">
      <button class="btn-close">×</button>
      <img src="${src}" alt="Photo" class="photo-viewer-image">
    </div>
  `;

  overlay.querySelector('.btn-close').addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

async function handleDeletePhoto(e) {
  const photoId = parseInt(e.target.dataset.photoId);
  const card = e.target.closest('.photo-card');

  // Show inline confirmation
  const origHtml = card.innerHTML;
  card.innerHTML = `
    <div class="delete-confirm">
      <p>Delete this photo?</p>
      <button class="btn-confirm-yes">Yes</button>
      <button class="btn-confirm-no">No</button>
    </div>
  `;

  card.querySelector('.btn-confirm-yes').addEventListener('click', async () => {
    // Revoke blob URL
    const img = card.querySelector('.photo-image');
    if (img && img.dataset.blobUrl) {
      URL.revokeObjectURL(img.dataset.blobUrl);
    }

    await store.deletePhoto(photoId);
    render();
  });

  card.querySelector('.btn-confirm-no').addEventListener('click', () => {
    card.innerHTML = origHtml;
    card.querySelector('.photo-image').addEventListener('click', handlePhotoClick);
    card.querySelector('.btn-delete-photo').addEventListener('click', handleDeletePhoto);
  });
}

function showAddPhotoPrompt() {
  const overlay = document.createElement('div');
  overlay.className = 'add-photo-overlay';

  const flowers = buildData.flowers.map(f => `<option value="${f.id}">${f.name}</option>`).join('');

  overlay.innerHTML = `
    <div class="add-photo-dialog">
      <h2>Add Photo</h2>
      <div class="dialog-fields">
        <label>
          Flower:
          <select id="photo-flower-select">
            ${flowers}
          </select>
        </label>
        <label>
          Note (optional):
          <textarea id="photo-note" class="photo-note-input" placeholder="What are you building?"></textarea>
        </label>
        <button id="btn-photo-capture" class="btn-primary">Take photo</button>
        <button id="btn-photo-cancel" class="btn-secondary">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const flowerSelect = overlay.querySelector('#photo-flower-select');
  const noteInput = overlay.querySelector('#photo-note');

  overlay.querySelector('#btn-photo-capture').addEventListener('click', async () => {
    const flowerId = flowerSelect.value;
    const note = noteInput.value.trim();
    overlay.remove();
    try {
      const blob = await takePhoto();
      if (!blob) return;
      // No specific page for photos added from this tab
      await store.addPhoto({ blob, pageId: '', flowerId, note });
      render();
    } catch (err) {
      console.error('Error adding photo:', err);
    }
  });

  overlay.querySelector('#btn-photo-cancel').addEventListener('click', () => {
    overlay.remove();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export async function updateFromState() {
  render();
}
