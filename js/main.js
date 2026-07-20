/* Artes Mortis Manager — bootstrap & persistence */
'use strict';

const SAVE_KEY = 'artesMortisSave';
let G = null;

function saveGame() {
  if (!G) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(G));
  } catch (e) {
    console.error('Save failed', e);
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state && state.version === 1 && state.teams) return state;
  } catch (e) {
    console.error('Load failed', e);
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  G = loadGame();
  render();
});
