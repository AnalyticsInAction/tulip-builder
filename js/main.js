// Main app controller

import * as player from './player.js';
import * as tracker from './tracker.js';
import * as journal from './journal.js';
import * as share from './share.js';
import * as sync from './sync.js';
import * as pages from './pages.js';
import { loadFamilyKey } from './vault.js';

async function init() {
  try {
    sync.loadToken(); // before the key is read: that clears the link from the address bar
    const key = await loadFamilyKey();
    if (!key) {
      showLocked();
      return;
    }
    pages.setKey(key);

    const buildData = await (await fetch('build.json')).json();

    await player.init(buildData);
    await tracker.init(buildData, switchToPlayer);
    await journal.init(buildData);
    share.init();
    sync.start(key);

    setupTabNavigation();
    showTab('build');
  } catch (err) {
    console.error('Error initializing app:', err);
    document.getElementById('player-content').textContent = 'Sorry, the instructions could not be loaded. Try reloading the page.';
  }
}

// Without the family link nothing here can be read.
function showLocked() {
  document.querySelector('.tab-nav').hidden = true;
  document.getElementById('player-content').innerHTML = `
    <div class="locked">
      <h1>Tulip Builder</h1>
      <p>This is a private family page. Open it with the family link to unlock it.</p>
    </div>
  `;
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-nav button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.target.dataset.tab;
      showTab(tabName);
    });
  });
}

async function showTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.add('hidden');
  });

  // Remove active from all nav buttons
  document.querySelectorAll('.tab-nav button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  const tab = document.getElementById(`${tabName}-content`);
  if (tab) {
    tab.classList.remove('hidden');
  }

  // Mark nav button active
  const navBtn = document.querySelector(`[data-tab="${tabName}"]`);
  if (navBtn) {
    navBtn.classList.add('active');
  }

  // Update tab state if needed
  if (tabName === 'build') {
    player.updateFromState();
  } else if (tabName === 'progress') {
    await tracker.updateFromState();
  } else if (tabName === 'photos') {
    await journal.updateFromState();
  }
}

function switchToPlayer() {
  showTab('build');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
