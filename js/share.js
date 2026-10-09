// Share panel on the Progress tab: turn sharing on with a GitHub token, see
// whether everything has been shared, and copy the family links.

import * as sync from './sync.js';
import { familyKeyText } from './vault.js';

const panel = () => document.getElementById('share-panel');

export function init() {
  sync.onInfo(render);
  render();
}

function siteBase() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

function render() {
  const info = sync.getInfo();
  const shared = info.lastSharedAt
    ? ` Last shared at ${new Date(info.lastSharedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : '';

  if (!sync.getToken()) {
    panel().innerHTML = `
      <h3>Sharing with Grandma</h3>
      <p class="share-status">Sharing is off on this device. A grown-up can turn it on by pasting the GitHub token here.</p>
      <form id="share-token-form" class="share-row">
        <input id="share-token" type="password" autocomplete="off" placeholder="GitHub token" aria-label="GitHub token">
        <button type="submit">Turn on</button>
      </form>
      <p id="share-message" class="share-message" role="status"></p>
    `;
    panel().querySelector('#share-token-form').addEventListener('submit', turnOn);
    return;
  }

  panel().innerHTML = `
    <h3>Sharing with Grandma</h3>
    <p class="share-status share-${info.state}">${info.message}.${shared}</p>
    <div class="share-row">
      <button id="share-copy-view">Copy Grandma's link</button>
      <button id="share-copy-build">Copy link for another building device</button>
    </div>
    <div class="share-row">
      <button id="share-now">Share now</button>
      <button id="share-forget">Turn sharing off here</button>
    </div>
    <p id="share-message" class="share-message" role="status"></p>
  `;
  const key = familyKeyText();
  panel().querySelector('#share-copy-view').addEventListener('click', () =>
    copy(`${siteBase()}view.html#k=${key}`, "Grandma's link copied. It can only view."));
  panel().querySelector('#share-copy-build').addEventListener('click', () =>
    copy(`${siteBase()}#k=${key}&t=${sync.getToken()}`, 'Building link copied. It can save, so only send it to a family device.'));
  panel().querySelector('#share-now').addEventListener('click', () => sync.syncAll());
  panel().querySelector('#share-forget').addEventListener('click', () => {
    sync.forgetToken();
    render();
  });
}

function say(text) {
  const message = panel().querySelector('#share-message');
  if (message) message.textContent = text;
}

async function turnOn(e) {
  e.preventDefault();
  const value = panel().querySelector('#share-token').value;
  if (!value.trim()) return;
  say('Checking…');
  try {
    await sync.setToken(value);
    render();
  } catch (err) {
    say(err.message);
  }
}

async function copy(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    // no clipboard access: show the link so it can be copied by hand
    const message = panel().querySelector('#share-message');
    message.innerHTML = '<input class="share-link" readonly aria-label="Link">';
    message.firstChild.value = text;
    message.firstChild.select();
  }
}
