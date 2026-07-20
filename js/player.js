/* Artes Mortis Manager — player generation & ratings (DOM-free) */
'use strict';

// quality: rough centre of stat distribution, 1–20
function genPlayer(roleKey, quality) {
  const stats = {};
  for (const k of STAT_KEYS) {
    if (k === 'injuryProne') { stats[k] = rint(1, 20); continue; }
    stats[k] = clamp(quality + rint(-4, 4), 1, 20);
  }
  // nudge role-critical stats upward
  const weights = ROLE_WEIGHTS[roleKey];
  for (const k in weights) {
    stats[k] = clamp(stats[k] + rint(0, 3), 1, 20);
  }
  const age = roleKey === 'CMD' ? rint(30, 48) : rint(18, 34);
  const p = {
    id: uid(),
    name: pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES),
    role: roleKey,
    age,
    stats,
    wage: 0,
    contractYears: rint(1, 3),
    status: 'fit',       // fit | injured | dead
    injuryWeeks: 0,
    seasonStats: { kills: 0, incaps: 0, captures: 0, territory: 0, matches: 0 },
  };
  p.wage = wageFor(p);
  return p;
}

function overallRating(p) {
  const weights = ROLE_WEIGHTS[p.role];
  let sum = 0, wsum = 0;
  for (const k in weights) { sum += p.stats[k] * weights[k]; wsum += weights[k]; }
  return Math.round((sum / wsum) * 5); // 5–100 scale
}

function wageFor(p) {
  const ovr = overallRating(p);
  const roleMult = { CMD: 1.4, TS: 1.0, RR: 0.9, CM: 0.8, HK: 1.2, CT: 1.3 }[p.role];
  return Math.round((ovr * ovr * 3.2 * roleMult) / 100) * 100; // weekly wage
}

function playerDesc(p) {
  const ovr = overallRating(p);
  if (ovr >= 85) return 'Elite';
  if (ovr >= 70) return 'Excellent';
  if (ovr >= 55) return 'Solid';
  if (ovr >= 40) return 'Journeyman';
  return 'Raw';
}

// Free agent pool: a spread of quality across every role
function genFreeAgents(n) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const role = pick(ROLE_ORDER);
    pool.push(genPlayer(role, rint(6, 16)));
  }
  return pool;
}
