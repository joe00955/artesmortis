/* Artes Mortis Manager — navigation grid & A* pathfinding (DOM-free).
   Units steer directly when they can see their goal; when a hard obstacle blocks
   the way, they plan a path around it on a coarse grid. */
'use strict';

const NAV_COLS = 50;
const NAV_ROWS = 30;

function buildNav(field) {
  const cw = field.w / NAV_COLS, ch = field.h / NAV_ROWS;
  const blocked = new Uint8Array(NAV_COLS * NAV_ROWS);
  for (let r = 0; r < NAV_ROWS; r++) {
    for (let c = 0; c < NAV_COLS; c++) {
      const x = (c + 0.5) * cw, y = (r + 0.5) * ch;
      // inflate obstacles by a unit radius so paths keep clear
      if (isBlocked(field, x, y, 12)) blocked[r * NAV_COLS + c] = 1;
    }
  }
  return { cw, ch, blocked };
}
function navOf(field) { return field.nav || (field.nav = buildNav(field)); }

function navCell(nav, x, y) {
  return { c: clamp(Math.floor(x / nav.cw), 0, NAV_COLS - 1), r: clamp(Math.floor(y / nav.ch), 0, NAV_ROWS - 1) };
}
function navFree(nav, c, r) { return c >= 0 && r >= 0 && c < NAV_COLS && r < NAV_ROWS && !nav.blocked[r * NAV_COLS + c]; }
function nearestFree(nav, c, r) {
  if (navFree(nav, c, r)) return { c, r };
  for (let rad = 1; rad < 8; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
      if (navFree(nav, c + dc, r + dr)) return { c: c + dc, r: r + dr };
    }
  }
  return { c, r };
}

// A* on the nav grid. Returns an array of world-space points (cell centres) or null.
function aStar(field, sx, sy, gx, gy) {
  const nav = navOf(field);
  const s = nearestFree(nav, ...cell(nav, sx, sy));
  const g = nearestFree(nav, ...cell(nav, gx, gy));
  const startI = s.r * NAV_COLS + s.c, goalI = g.r * NAV_COLS + g.c;
  if (startI === goalI) return null;

  const open = [startI];
  const came = new Map();
  const gScore = new Map([[startI, 0]]);
  const fScore = new Map([[startI, octile(s, g)]]);
  const inOpen = new Set([startI]);
  let iter = 0;
  while (open.length && iter++ < 3000) {
    // pop lowest f
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((fScore.get(open[i]) || 1e9) < (fScore.get(open[bi]) || 1e9)) bi = i;
    const cur = open.splice(bi, 1)[0];
    inOpen.delete(cur);
    if (cur === goalI) return reconstruct(nav, came, cur, sx, sy);
    const cc = cur % NAV_COLS, cr = Math.floor(cur / NAV_COLS);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const nc = cc + dc, nr = cr + dr;
      if (!navFree(nav, nc, nr)) continue;
      if (dc && dr && (!navFree(nav, cc + dc, cr) || !navFree(nav, cc, cr + dr))) continue; // no corner cutting
      const ni = nr * NAV_COLS + nc;
      const step = (dc && dr) ? 1.414 : 1;
      const tentative = (gScore.get(cur) || 1e9) + step;
      if (tentative < (gScore.get(ni) || 1e9)) {
        came.set(ni, cur);
        gScore.set(ni, tentative);
        fScore.set(ni, tentative + octile({ c: nc, r: nr }, g));
        if (!inOpen.has(ni)) { open.push(ni); inOpen.add(ni); }
      }
    }
  }
  return null;
}
function cell(nav, x, y) { const p = navCell(nav, x, y); return [p.c, p.r]; }
function octile(a, b) { const dc = Math.abs(a.c - b.c), dr = Math.abs(a.r - b.r); return (dc + dr) + (1.414 - 2) * Math.min(dc, dr); }
function reconstruct(nav, came, cur, sx, sy) {
  const pts = [];
  while (came.has(cur)) {
    const c = cur % NAV_COLS, r = Math.floor(cur / NAV_COLS);
    pts.unshift({ x: (c + 0.5) * nav.cw, y: (r + 0.5) * nav.ch });
    cur = came.get(cur);
  }
  return pts.length ? pts : null;
}

if (typeof module !== 'undefined') module.exports = {};
