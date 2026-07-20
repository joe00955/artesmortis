/* Artes Mortis Manager — turn-based match engine (DOM-free) */
'use strict';

const MATCH_TICKS = 90;          // "minutes"
const TERRITORY_WIN = 80;        // % of the field

function simulateMatch(teamA, teamB, leagueType, map) {
  map = map || genMap();
  const sides = [mkSide(teamA, leagueType), mkSide(teamB, leagueType)];
  const log = [];
  const addLog = (t, type, text) => log.push({ t, type, text, terr: [round1(sides[0].terr), round1(sides[1].terr)] });

  addLog(0, 'info', `The klaxon sounds over ${map.name} (${map.desc})`);
  for (const s of sides) {
    if (s.shortfalls.length) {
      const parts = s.shortfalls.map(sf => `${sf.missing} ${ROLES[sf.role].name}`).join(', ');
      addLog(0, 'info', `${s.team.name} take the field UNDERSTRENGTH — missing ${parts}.`);
    }
  }

  let ended = null;
  for (let t = 1; t <= MATCH_TICKS && !ended; t++) {
    for (const s of sides) s.power = sidePower(s, map);

    // 1) Territory claiming (Controllers)
    for (let i = 0; i < 2; i++) tickTerritory(sides[i], sides[1 - i], t, addLog);

    // 2) Hawk overwatch shots
    for (let i = 0; i < 2; i++) tickHawks(sides[i], sides[1 - i], leagueType, map, t, addLog);

    // 3) Traps
    for (let i = 0; i < 2; i++) tickTraps(sides[i], sides[1 - i], leagueType, t, addLog);

    // 4) Main engagements
    tickClash(sides, leagueType, map, t, addLog);

    // 5) Controller capture attempts
    for (let i = 0; i < 2; i++) tickCapture(sides[i], sides[1 - i], t, addLog);

    // 6) Occasional intel flavour
    for (let i = 0; i < 2; i++) tickIntel(sides[i], sides[1 - i], t, addLog);

    // 7) Morale drift & surrender
    for (let i = 0; i < 2; i++) tickMorale(sides[i], sides[1 - i], t, addLog);

    ended = checkEnd(sides, t, addLog);
  }

  if (!ended) {
    // time expired — most territory wins
    const [a, b] = sides;
    if (Math.abs(a.terr - b.terr) < 0.5) {
      ended = { winner: null, condition: 'draw' };
      addLog(MATCH_TICKS, 'end', `Full time. The judges rule it a DRAW at ${round1(a.terr)}% – ${round1(b.terr)}%.`);
    } else {
      const w = a.terr > b.terr ? a : b;
      ended = { winner: w, condition: 'territory-decision' };
      addLog(MATCH_TICKS, 'end', `Full time. ${w.team.name} take it on territory, ${round1(a.terr)}% – ${round1(b.terr)}%.`);
    }
  }

  // Apply post-match consequences to rosters
  const report = { casualties: [[], []], deaths: [[], []] };
  sides.forEach((s, i) => {
    for (const c of s.casualties) {
      if (c.fatal) {
        c.player.status = 'dead';
        report.deaths[i].push(c.player);
      } else {
        const weeks = 1 + Math.floor(c.player.stats.injuryProne / 7) + rint(0, 2);
        c.player.status = 'injured';
        c.player.injuryWeeks = Math.max(c.player.injuryWeeks, weeks);
        report.casualties[i].push({ player: c.player, weeks });
      }
    }
    for (const p of s.fielded) p.seasonStats.matches++;
  });

  return {
    map, log,
    teams: [teamA, teamB],
    terr: [round1(sides[0].terr), round1(sides[1].terr)],
    winnerId: ended.winner ? ended.winner.team.id : null,
    condition: ended.condition,
    kills: [sides[0].kills, sides[1].kills],
    incaps: [sides[0].incaps, sides[1].incaps],
    ctCaptured: [sides[0].ctCaptured, sides[1].ctCaptured],
    casualties: report.casualties,
    deaths: report.deaths,
  };
}

// ---------- side construction ----------
function mkSide(team, leagueType) {
  const { fielded, shortfalls } = fieldSquad(team);
  return {
    team, fielded, shortfalls,
    active: fielded.slice(),           // still on the field
    casualties: [],                    // { player, fatal }
    terr: 10, morale: 100,
    ctCaptured: false, surrendered: false,
    kills: 0, incaps: 0,
    weapons: legalArmory(team, leagueType),
    power: 0,
  };
}

function actives(side, roleKey) { return side.active.filter(p => p.role === roleKey); }
function fighters(side) { return side.active.filter(p => ['CM', 'HK', 'RR'].includes(p.role)); }
function controller(side) { return side.ctCaptured ? null : actives(side, 'CT')[0] || null; }
function weaponBonus(side, group) {
  return side.weapons.filter(w => (w.group === group || w.group === 'ALL') && w.power)
    .reduce((s, w) => s + w.power, 0);
}
function gearVal(side, key) { return side.weapons.reduce((s, w) => s + (w[key] || 0), 0); }
function round1(n) { return Math.round(n * 10) / 10; }

function intelFactor(side, map) {
  const ts = actives(side, 'TS');
  if (!ts.length) return 0.4;
  const skill = ts.reduce((s, p) => s + p.stats.tacticalIQ, 0) / ts.length;
  const gear = gearVal(side, 'intel');
  return clamp(0.5 + skill / 30 + gear / 10 + (map.mods.drone || 0) / 20, 0.3, 2.0);
}

function sidePower(side, map) {
  let pow = 0;
  for (const p of side.active) {
    const s = p.stats;
    if (p.role === 'CM') pow += (s.aim * 1.2 + s.courage * 0.6 + s.endurance * 0.5) / 3;
    else if (p.role === 'HK') pow += ((s.aim * 1.5 + s.stealth * 0.5) / 3) * (1 + (map.mods.hawk || 0) / 10);
    else if (p.role === 'RR') pow += ((s.speed * 0.8 + s.courage * 0.6) / 3) * (1 + (map.mods.vehicle || 0) / 10);
    else if (p.role === 'TS') pow += s.tacticalIQ / 6;
  }
  pow += weaponBonus(side, 'CM') + weaponBonus(side, 'HK') * 0.7 + weaponBonus(side, 'RR') * 0.5 + weaponBonus(side, 'TS') * 0.6;
  // Commander directs from base — effectiveness limited by relayed intel quality
  const cmd = actives(side, 'CMD')[0];
  if (cmd) pow += cmd.stats.tacticalIQ * 0.5 * intelFactor(side, map);
  if (side.team.tactics.doctrine === 'elimination') pow *= 1.15;
  pow *= 0.55 + side.morale / 180;
  return Math.max(pow, 1);
}
function defenseMult(side) { return side.team.tactics.doctrine === 'defensive' ? 1.2 : 1; }

// ---------- tick phases ----------
function tickTerritory(side, foe, t, addLog) {
  const ct = controller(side);
  if (!ct || side.surrendered) return;
  const tac = side.team.tactics;
  let rate = 0.25 + (ct.stats.speed / 20) * 0.9;
  if (tac.doctrine === 'territory') rate *= 1.35;
  if (tac.controllerRisk === 'forward') rate *= 1.4;
  const cmActive = actives(side, 'CM').length;
  rate *= 0.5 + cmActive / 12; // infantry secures the ground the flag claims

  const neutral = 100 - side.terr - foe.terr;
  let claimed = 0;
  if (neutral > 0.01) {
    claimed = Math.min(rate, neutral);
    side.terr += claimed;
  } else if (side.power > foe.power * 1.05 && foe.terr > 5) {
    claimed = Math.min(rate * 0.65, foe.terr - 5);
    side.terr += claimed;
    foe.terr -= claimed;
    if (chance(0.12)) addLog(t, 'claim', `${side.team.name}'s flag radius swallows ground held by ${foe.team.name} — the line is buckling.`);
  }
  if (claimed > 0 && chance(0.07)) {
    addLog(t, 'claim', `${ct.name} pushes the flag ${tac.controllerRisk === 'forward' ? 'dangerously far up' : 'steadily forward'}; ${side.team.name} now hold ${round1(side.terr)}% of the field.`);
  }
}

function tickHawks(side, foe, leagueType, map, t, addLog) {
  if (side.surrendered) return;
  const hawks = actives(side, 'HK');
  if (!hawks.length) return;
  const hunting = side.team.tactics.hawkOrders === 'hunt';
  const terrainMod = 1 + (map.mods.hawk || 0) / 8;
  for (const hk of hawks) {
    if (!chance((hunting ? 0.05 : 0.028) * terrainMod)) continue;
    const target = pickTarget(foe);
    if (!target) continue;
    const hitScore = hk.stats.aim + rint(-6, 6) + weaponBonus(side, 'HK');
    const evade = target.stats.speed * 0.5 + target.stats.stealth * 0.5 + rint(0, 8) + gearVal(foe, 'protect');
    if (hitScore > evade) {
      downPlayer(foe, target, side, leagueType, 0.18, addLog, t,
        `${hk.name} finds ${target.name} in the scope from long range`);
      creditTake(side, hk, foe);
    } else if (chance(0.3)) {
      addLog(t, 'hawk', `A round from ${side.team.name}'s overwatch cracks past ${target.name} — near miss.`);
    }
  }
}

function tickTraps(side, foe, leagueType, t, addLog) {
  if (side.surrendered) return;
  const kits = side.weapons.filter(w => w.id === 'bladetrap' || w.id === 'snarekit');
  if (!kits.length || !actives(side, 'CM').length) return;
  if (!chance(0.02 + kits.length * 0.01)) return;
  const target = pickTarget(foe);
  if (!target) return;
  const lethalTrap = kits.some(w => w.lethal);
  downPlayer(foe, target, side, leagueType, lethalTrap ? 0.15 : 0, addLog, t,
    `${target.name} walks into a ${lethalTrap ? 'blade trap' : 'snare'} laid by ${side.team.name}'s Countrymen`);
  const setter = pick(actives(side, 'CM'));
  if (setter) creditTake(side, setter, foe);
}

function tickClash(sides, leagueType, map, t, addLog) {
  const [a, b] = sides;
  if (a.surrendered || b.surrendered) return;
  if (!fighters(a).length || !fighters(b).length) return;
  const aggro = a.team.tactics.aggression + b.team.tactics.aggression;
  if (!chance(0.10 + aggro * 0.045)) return;

  // more aggressive / stronger side is likelier to be the attacker
  const aScore = a.power * (0.7 + a.team.tactics.aggression * 0.15);
  const bScore = b.power * (0.7 + b.team.tactics.aggression * 0.15);
  const atk = rnd() < aScore / (aScore + bScore) ? a : b;
  const def = atk === a ? b : a;

  const atkRoll = atk.power * (0.75 + rnd() * 0.5);
  const defRoll = def.power * (0.75 + rnd() * 0.5) * defenseMult(def) * (1 + (map.mods.stealth || 0) / 25);

  if (atkRoll > defRoll * 1.05) {
    const target = pickTarget(def);
    if (!target) return;
    const shooter = pick(fighters(atk)) || null;
    const lethalShare = lethalPowerShare(atk);
    downPlayer(def, target, atk, leagueType, 0.10 + lethalShare * 0.15, addLog, t,
      `${atk.team.name} overrun a position — ${target.name} is caught in the open`);
    if (shooter) creditTake(atk, shooter, def);
    def.morale -= 3;
  } else if (defRoll > atkRoll * 1.15 && chance(0.5)) {
    const target = pickTarget(atk);
    if (!target) return;
    downPlayer(atk, target, def, leagueType, 0.08 + lethalPowerShare(def) * 0.12, addLog, t,
      `${atk.team.name}'s push collapses under fire — ${target.name} goes down in the counterattack`);
    const shooter = pick(fighters(def));
    if (shooter) creditTake(def, shooter, atk);
    atk.morale -= 4;
  } else if (chance(0.35)) {
    addLog(t, 'clash', `Sporadic exchanges between ${a.team.name} and ${b.team.name}; both lines hold.`);
  }
}

function tickCapture(side, foe, t, addLog) {
  if (side.surrendered || foe.ctCaptured) return;
  const ct = controller(foe);
  if (!ct) return;
  const tac = side.team.tactics;
  let p = 0.004 * tac.aggression;
  if (foe.team.tactics.controllerRisk === 'forward') p *= 2.6;
  p *= clamp(side.power / foe.power, 0.4, 2.2);
  if (actives(side, 'RR').length) p *= 1.3;                       // vehicles run the flag down
  if (foe.team.tactics.hawkOrders === 'overwatch' && actives(foe, 'HK').length) p *= 0.55;
  if (gearVal(foe, 'guard')) p *= 0.5;
  p *= 0.4 + (20 - ct.stats.speed) / 25;                          // fast Controllers are slippery
  if (!chance(clamp(p, 0, 0.06))) return;

  foe.ctCaptured = true;
  foe.active = foe.active.filter(x => x !== ct);
  const gained = foe.terr;
  side.terr += gained;
  foe.terr = 0;
  foe.morale -= 40;
  side.morale += 15;
  const raider = pick(actives(side, 'RR')) || pick(fighters(side));
  if (raider) raider.seasonStats.captures++;
  addLog(t, 'capture', `FLAG CAPTURED! ${side.team.name} seize ${ct.name} and the ${foe.team.name} colours — ${round1(gained)}% of claimed ground transfers at a stroke.`);
}

function tickIntel(side, foe, t, addLog) {
  if (side.surrendered || !chance(0.02)) return;
  const ts = actives(side, 'TS');
  const cmd = actives(side, 'CMD')[0];
  if (!ts.length || !cmd) return;
  const op = pick(ts);
  addLog(t, 'drone', pick([
    `${op.name}'s drone wing sweeps the ${foe.team.name} flank; ${cmd.name} redirects the line off the relayed picture.`,
    `Probe telemetry crackles over comms — ${cmd.name} calls a repositioning on ${op.name}'s word alone.`,
    `${op.name} marks the enemy Controller's last bearing; the intel is relayed by voice to base.`,
  ]));
}

function tickMorale(side, foe, t, addLog) {
  if (side.surrendered) return;
  if (side.terr > foe.terr) side.morale += 0.15;
  side.morale = clamp(side.morale, 0, 120);
  if (side.morale < 22 && side.terr < foe.terr && chance(0.10)) {
    side.surrendered = true;
    addLog(t, 'surrender', `${side.team.name}'s Commander keys the surrender code. The match is over.`);
  }
}

// ---------- casualties ----------
function pickTarget(side) {
  const pool = [];
  for (const p of side.active) {
    const w = { CM: 6, RR: 2, TS: 0.6, HK: side.team.tactics.hawkOrders === 'hunt' ? 2 : 1 }[p.role] || 0;
    for (let i = 0; i < Math.round(w * 10); i++) pool.push(p);
  }
  return pool.length ? pick(pool) : null;
}

function lethalPowerShare(side) {
  const tot = side.weapons.reduce((s, w) => s + (w.power || 0), 0);
  if (!tot) return 0;
  return side.weapons.filter(w => w.lethal).reduce((s, w) => s + (w.power || 0), 0) / tot;
}

function downPlayer(side, player, bySide, leagueType, deathChance, addLog, t, how) {
  side.active = side.active.filter(x => x !== player);
  const protect = gearVal(side, 'protect');
  const fatal = leagueType.lethalAllowed && chance(Math.max(0, deathChance - protect * 0.03));
  side.casualties.push({ player, fatal });
  side.morale -= fatal ? 9 : 5;
  if (fatal) {
    bySide.kills++;
    addLog(t, 'death', `${how}. ${player.name} (${ROLES[player.role].name}) is KILLED. The oversight drones descend.`);
  } else {
    bySide.incaps++;
    addLog(t, 'incap', `${how}. ${player.name} (${ROLES[player.role].name}) is incapacitated and dragged off the field.`);
  }
}

function creditTake(side, shooter, foeSide) {
  const last = foeSide.casualties[foeSide.casualties.length - 1];
  if (!last) return;
  if (last.fatal) shooter.seasonStats.kills++;
  else shooter.seasonStats.incaps++;
}

// ---------- win conditions ----------
function checkEnd(sides, t, addLog) {
  const [a, b] = sides;
  for (const [s, foe] of [[a, b], [b, a]]) {
    if (foe.surrendered) {
      addLog(t, 'end', `${s.team.name} WIN by surrender.`);
      return { winner: s, condition: 'surrender' };
    }
    if (!fighters(foe).length && foe.fielded.some(p => ['CM', 'HK', 'RR'].includes(p.role))) {
      const anyDead = foe.casualties.some(c => c.fatal);
      const cond = anyDead ? 'elimination' : 'incapacitation';
      addLog(t, 'end', `${foe.team.name} have no fighters left standing. Their Commander signals the concession — ${s.team.name} WIN by ${cond}.`);
      return { winner: s, condition: cond };
    }
    if (s.terr >= TERRITORY_WIN) {
      addLog(t, 'end', `${s.team.name} control ${round1(s.terr)}% of the field — TERRITORY VICTORY.`);
      return { winner: s, condition: 'territory' };
    }
  }
  return null;
}
