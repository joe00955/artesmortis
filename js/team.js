/* Artes Mortis Manager — team model (DOM-free) */
'use strict';

const DEFAULT_TACTICS = () => ({
  aggression: 2,            // 1 cautious, 2 balanced, 3 aggressive
  doctrine: 'territory',    // territory | elimination | defensive
  controllerRisk: 'safe',   // safe | forward
  hawkOrders: 'overwatch',  // overwatch | hunt
});

function genTeam(name, quality, isPlayer) {
  const roster = [];
  for (const rk of ROLE_ORDER) {
    for (let i = 0; i < ROLES[rk].count; i++) {
      roster.push(genPlayer(rk, clamp(quality + rint(-2, 2), 4, 18)));
    }
  }
  const t = {
    id: uid(),
    name,
    isPlayer: !!isPlayer,
    roster,
    tactics: DEFAULT_TACTICS(),
    preset: 'balanced',
    armory: isPlayer ? [] : aiDefaultArmory(quality),
    probeLicense: false,
    balance: 0,
    // season record
    played: 0, wins: 0, draws: 0, losses: 0, points: 0,
    terrFor: 0, terrAgainst: 0,
  };
  if (!isPlayer) {
    t.tactics.aggression = rint(1, 3);
    t.tactics.doctrine = pick(['territory', 'elimination', 'defensive']);
    t.tactics.controllerRisk = pick(['safe', 'safe', 'forward']);
    t.tactics.hawkOrders = pick(['overwatch', 'hunt']);
  }
  return t;
}

function aiDefaultArmory(quality) {
  // AI teams get a sensible kit; lethal items are filtered at match time by league legality.
  const ids = ['sidearm', 'rubber', 'stunbaton', 'recondrone', 'armor'];
  if (quality >= 10) ids.push('rifle', 'tranq', 'scoutbuggy');
  if (quality >= 13) ids.push('marksman', 'ctguard', 'strikedrone');
  return ids;
}

function rosterByRole(team) {
  const out = {};
  for (const rk of ROLE_ORDER) out[rk] = team.roster.filter(p => p.role === rk);
  return out;
}

function availableByRole(team) {
  const out = {};
  for (const rk of ROLE_ORDER) {
    out[rk] = team.roster.filter(p => p.role === rk && p.status === 'fit');
  }
  return out;
}

// Which fit players actually take the field (up to the role cap).
// Best-rated first; returns { fielded, shortfalls } — shortfalls lists roles below quota.
function fieldSquad(team) {
  const avail = availableByRole(team);
  const fielded = [];
  const shortfalls = [];
  for (const rk of ROLE_ORDER) {
    const sorted = avail[rk].slice().sort((a, b) => overallRating(b) - overallRating(a));
    const need = ROLES[rk].count;
    fielded.push(...sorted.slice(0, need));
    if (sorted.length < need) shortfalls.push({ role: rk, missing: need - sorted.length });
  }
  return { fielded, shortfalls };
}

function weeklyWageBill(team) {
  return team.roster.reduce((s, p) => s + (p.status === 'dead' ? 0 : p.wage), 0);
}

// Armory items usable in a given league (legality filter + license check)
function legalArmory(team, leagueType) {
  return team.armory
    .map(id => WEAPON_POOL.find(w => w.id === id))
    .filter(w => w && (leagueType.lethalAllowed || !w.lethal) && (!w.licensed || team.probeLicense));
}
