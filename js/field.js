/* Artes Mortis Manager — spatial battlefield generation & geometry (DOM-free) */
'use strict';

const FIELD_W = 1000;
const FIELD_H = 600;
const TERR_COLS = 40;
const TERR_ROWS = 24;
const TERR_CELL_W = FIELD_W / TERR_COLS;
const TERR_CELL_H = FIELD_H / TERR_ROWS;
const TERR_CELLS = TERR_COLS * TERR_ROWS;
const CLAIM_RADIUS = 78;          // Controller's claiming radius (the "500m")
const BASE_A = { x: 64, y: FIELD_H / 2 };
const BASE_B = { x: FIELD_W - 64, y: FIELD_H / 2 };

// Terrain feature density per map type.
// cover  = soft cover (reduces incoming hit chance)
// block  = hard obstacle (blocks movement + line of sight)
// high   = elevation (bonus for Hawks / overwatch, minor cover)
const TERRAIN_FEATURES = {
  Forest:     { cover: 22, block: 6,  high: 1 },
  'Urban Ruin': { cover: 10, block: 16, high: 4 },
  Desert:     { cover: 3,  block: 2,  high: 5 },
  Marshland:  { cover: 16, block: 4,  high: 1 },
  Highlands:  { cover: 8,  block: 7,  high: 7 },
  Industrial: { cover: 12, block: 14, high: 3 },
};

function genField(map) {
  const spec = TERRAIN_FEATURES[map.type] || TERRAIN_FEATURES.Forest;
  const covers = [], blocks = [], highs = [];
  const away = (x, y, list, minD) => list.every(f => Math.hypot(f.x - x, f.y - y) > (f.r + minD));
  const placeMany = (n, list, rMin, rMax, minGap) => {
    let tries = 0;
    while (list.length < n && tries++ < n * 30) {
      // keep features off the two bases and out of the far margins
      const x = rint(120, FIELD_W - 120);
      const y = rint(40, FIELD_H - 40);
      const r = rint(rMin, rMax);
      if (Math.hypot(x - BASE_A.x, y - BASE_A.y) < 130) continue;
      if (Math.hypot(x - BASE_B.x, y - BASE_B.y) < 130) continue;
      if (!away(x, y, blocks, minGap)) continue;
      list.push({ x, y, r });
    }
  };
  placeMany(spec.block, blocks, 18, 34, 34);
  placeMany(spec.cover, covers, 24, 46, 8);
  placeMany(spec.high, highs, 30, 52, 20);

  return {
    map, w: FIELD_W, h: FIELD_H,
    baseA: BASE_A, baseB: BASE_B,
    covers, blocks, highs,
    moveMod: 1 + (map.mods.vehicle || 0) / 40, // marsh/forest slow, desert fast — reused loosely
  };
}

function inField(x, y) { return x >= 8 && x <= FIELD_W - 8 && y >= 8 && y <= FIELD_H - 8; }

function isBlocked(field, x, y, pad) {
  pad = pad || 6;
  for (const b of field.blocks) if (Math.hypot(b.x - x, b.y - y) < b.r + pad) return true;
  return false;
}

// Line of sight: clear unless the segment passes through a hard block.
function losClear(field, x1, y1, x2, y2) {
  for (const b of field.blocks) if (segCircle(x1, y1, x2, y2, b.x, b.y, b.r)) return false;
  return true;
}
function segCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) < r;
}

// Cover value at a point: 0 (open) .. ~0.55 (max protection factor reduction)
function coverAt(field, x, y) {
  let best = 0;
  for (const c of field.covers) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < c.r) best = Math.max(best, 0.5 * (1 - d / c.r));
  }
  for (const h of field.highs) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < h.r) best = Math.max(best, 0.25 * (1 - d / h.r));
  }
  return best;
}
function onHighGround(field, x, y) {
  for (const h of field.highs) if (Math.hypot(h.x - x, h.y - y) < h.r) return true;
  return false;
}
function nearestHigh(field, x, y) {
  let best = null, bd = Infinity;
  for (const h of field.highs) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

// territory grid helpers
function cellIndex(x, y) {
  const c = clamp(Math.floor(x / TERR_CELL_W), 0, TERR_COLS - 1);
  const r = clamp(Math.floor(y / TERR_CELL_H), 0, TERR_ROWS - 1);
  return r * TERR_COLS + c;
}
function cellCenter(i) {
  const c = i % TERR_COLS, r = Math.floor(i / TERR_COLS);
  return { x: (c + 0.5) * TERR_CELL_W, y: (r + 0.5) * TERR_CELL_H };
}

if (typeof module !== 'undefined') module.exports = {};
