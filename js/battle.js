/* Artes Mortis Manager — real-time spatial battle engine (DOM-free).
   Runs headless (AI matches, tests) or stepped + rendered (the player's match).
   Produces the same result shape the league layer already consumes. */
'use strict';

const TIME_LIMIT = 150;        // game-seconds
const TERRITORY_WIN = 80;      // % of the field
const DT_MAX = 0.2;

// role → base combat/movement profile
const ROLE_PROFILE = {
  CMD: { speed: 0,   sight: 0,   range: 0,   cd: 0,   fighter: false },
  TS:  { speed: 32,  sight: 150, range: 90,  cd: 1.4, fighter: false },
  RR:  { speed: 132, sight: 190, range: 120, cd: 1.0, fighter: true },
  CM:  { speed: 58,  sight: 200, range: 150, cd: 0.85, fighter: true },
  HK:  { speed: 40,  sight: 320, range: 350, cd: 2.2, fighter: true },
  CT:  { speed: 62,  sight: 170, range: 0,   cd: 0,   fighter: false },
};

function createBattle(teamA, teamB, leagueType, map, plans) {
  const field = genField(map);
  const sides = [
    mkSide(teamA, leagueType, field, 0, plans && plans[0]),
    mkSide(teamB, leagueType, field, 1, plans && plans[1]),
  ];
  const territory = new Int8Array(TERR_CELLS).fill(-1);
  // seed each base's ground
  for (let i = 0; i < TERR_CELLS; i++) {
    const c = cellCenter(i);
    if (Math.hypot(c.x - field.baseA.x, c.y - field.baseA.y) < 90) territory[i] = 0;
    if (Math.hypot(c.x - field.baseB.x, c.y - field.baseB.y) < 90) territory[i] = 1;
  }

  const battle = {
    field, sides, territory, leagueType, map,
    time: 0, over: false, result: null,
    log: [], events: [],            // events = transient visuals (shots, hits)
    reveal: [new Map(), new Map()], // team → Map(enemyUnitId → expiryTime)
    _emit(type, text) { this.log.push({ t: Math.floor(this.time), type, text }); },
    step(dt) { stepBattle(this, dt); },
    terrPct() { return terrPercent(this.territory); },
  };
  battle._emit('info', `The klaxon sounds over ${map.name} — ${map.desc}`);
  for (const s of sides) if (s.shortfalls.length) {
    battle._emit('info', `${s.team.name} field UNDERSTRENGTH: missing ${s.shortfalls.map(sf => sf.missing + ' ' + ROLES[sf.role].name).join(', ')}.`);
  }
  return battle;
}

function mkSide(team, leagueType, field, side, plan) {
  const { fielded, shortfalls } = fieldSquad(team);
  const weapons = legalArmory(team, leagueType);
  // A player plan arrives already fitted to its side (_fitted); AI passes null → auto-plan.
  const usedPlan = plan
    ? (plan._fitted ? plan : fitPlanToField(deepPlan(plan), field, side))
    : autoPlan(team, field, side);
  const base = side === 0 ? field.baseA : field.baseB;
  const gearProtect = weapons.reduce((m, w) => Math.max(m, w.protect || 0), 0);
  const gearGuard = weapons.reduce((m, w) => Math.max(m, w.guard || 0), 0);
  const intelGear = weapons.reduce((s, w) => s + (w.intel || 0), 0);

  const units = [];
  const byRole = {};
  for (const rk of ROLE_ORDER) byRole[rk] = [];
  for (const p of fielded) byRole[p.role].push(p);

  for (const rk of ROLE_ORDER) {
    const group = byRole[rk];
    const g = usedPlan.groups[rk] || { anchor: base, route: [], stance: ROLE_STANCES[rk][0] };
    group.forEach((pl, i) => {
      const spread = spreadOffset(rk, i, group.length);
      const u = mkUnit(pl, rk, side, team, {
        x: clamp(g.anchor.x + spread.x, 12, field.w - 12),
        y: clamp(g.anchor.y + spread.y, 12, field.h - 12),
      }, g, weapons, gearProtect);
      units.push(u);
    });
  }

  const s = {
    team, side, fielded, shortfalls, plan: usedPlan, base,
    units, weapons, gearProtect, gearGuard, intelGear,
    morale: 100, ctCaptured: false, surrendered: false,
    kills: 0, incaps: 0, coordination: 1, drones: [],
  };
  spawnDrones(s, field, leagueType);
  return s;
}

function spreadOffset(rk, i, n) {
  if (rk === 'CMD' || rk === 'CT') return { x: 0, y: 0 };
  if (rk === 'HK') return { x: -i * 22, y: (i - (n - 1) / 2) * 150 };
  const perRow = Math.min(n, 3);
  const col = i % perRow, row = Math.floor(i / perRow);
  return { x: -row * 34, y: (col - (perRow - 1) / 2) * 46 };
}

function mkUnit(player, role, side, team, pos, group, weapons, gearProtect) {
  const prof = ROLE_PROFILE[role];
  const st = player.stats;
  const w = bestWeapon(weapons, role);
  return {
    id: player.id, player, role, side, team,
    x: pos.x, y: pos.y, hx: pos.x, hy: pos.y,   // home anchor
    hp: 100, state: 'active', wpIndex: 0, forceId: null,
    stance: group.stance, route: group.route.slice(), anchor: { x: pos.x, y: pos.y },
    speed: prof.speed * (0.7 + st.speed / 28),
    sight: prof.sight * (1 + (st.tacticalIQ - 10) / 40),
    range: prof.range + (role === 'HK' ? (st.aim - 10) * 6 : 0),
    cd: prof.cd, cool: rnd() * prof.cd,
    fighter: prof.fighter,
    aim: st.aim, protect: gearProtect,
    dmg: w ? 8 + w.power * 2.5 : 8,
    lethal: w ? !!w.lethal : false,
    weaponName: w ? w.name : 'Service Sidearm',
    lastHitLethal: false,
  };
}
function bestWeapon(weapons, role) {
  const matches = weapons.filter(w => (w.group === role || w.group === 'ALL') && w.power > 0);
  if (!matches.length) return weapons.find(w => w.id === 'sidearm') || null;
  return matches.sort((a, b) => b.power - a.power)[0];
}

function spawnDrones(side, field, leagueType) {
  const tsCount = side.units.filter(u => u.role === 'TS').length;
  if (!tsCount) return;
  const strike = side.weapons.find(w => w.id === 'strikedrone');
  const recon = side.weapons.find(w => w.id === 'recondrone' || w.id === 'probe');
  if (!strike && !recon) return;
  const n = Math.min(tsCount, strike && recon ? 3 : 2);
  for (let i = 0; i < n; i++) {
    const kind = (strike && (i === 0 || !recon)) ? 'strike' : 'recon';
    side.drones.push({
      side: side.side, kind,
      x: side.base.x, y: side.base.y,
      lane: (i - (n - 1) / 2) * 160 + field.h / 2,
      range: kind === 'strike' ? 150 : 220,
      cd: 3, cool: rnd() * 3,
      dmg: strike ? 8 + strike.power * 2.5 : 0,
      lethal: strike ? !!strike.lethal : false,
    });
  }
}

function deepPlan(plan) {
  return { preset: plan.preset, groups: JSON.parse(JSON.stringify(plan.groups)) };
}

// ---------- main step ----------
function stepBattle(b, dt) {
  if (b.over) return;
  dt = clamp(dt, 0, DT_MAX);
  b.time += dt;
  b.events.length = 0;

  for (const s of b.sides) s.coordination = coordination(s, b);
  updateReveal(b, dt);

  for (const s of b.sides) updateDrones(b, s, dt);

  for (let i = 0; i < 2; i++) {
    for (const u of b.sides[i].units) {
      if (u.state !== 'active' || u.role === 'CMD') continue;
      const goal = decideGoal(b, u, b.sides[i], b.sides[1 - i]);
      moveUnit(b, u, goal, dt);
    }
  }
  for (let i = 0; i < 2; i++) {
    for (const u of b.sides[i].units) {
      if (u.state === 'active' && u.fighter) tryShoot(b, u, b.sides[i], b.sides[1 - i], dt);
    }
  }

  for (let i = 0; i < 2; i++) claimTerritory(b, b.sides[i]);
  for (let i = 0; i < 2; i++) tryCapture(b, b.sides[i], b.sides[1 - i], dt);
  for (let i = 0; i < 2; i++) updateMorale(b, b.sides[i], b.sides[1 - i], dt);

  checkWin(b);
  if (!b.over && b.time >= TIME_LIMIT) endByTime(b);
  if (b.over && !b.result) b.result = finalize(b);
}

function coordination(side, b) {
  const cmd = side.units.find(u => u.role === 'CMD');
  const intel = side.intelGear + side.drones.filter(d => d.kind === 'recon').length * 3;
  const cmdIQ = cmd ? cmd.player.stats.tacticalIQ : 6;
  const droneMod = (b.map.mods.drone || 0) / 20;
  return clamp(0.82 + cmdIQ / 60 + intel / 40 + droneMod, 0.75, 1.3);
}

// ---------- targeting / vision ----------
function updateReveal(b, dt) {
  for (const m of b.reveal) for (const [id, exp] of m) if (b.time > exp) m.delete(id);
}
function canSee(b, u, side, foe, enemy) {
  const d = Math.hypot(enemy.x - u.x, enemy.y - u.y);
  if (d <= u.sight && losClear(b.field, u.x, u.y, enemy.x, enemy.y)) return d;
  if (b.reveal[side.side].has(enemy.id) && d <= u.range * 1.1) return d;
  return -1;
}
function acquire(b, u, side, foe) {
  // a player-issued focus-fire order takes priority while the target is reachable
  if (u.forceId) {
    const t = foe.units.find(e => e.id === u.forceId);
    if (t && t.state === 'active' && t.role !== 'CT' && canSee(b, u, side, foe, t) >= 0) return t;
    u.forceId = null;
  }
  let best = null, bd = Infinity;
  for (const e of foe.units) {
    if (e.state !== 'active' || e.role === 'CMD') continue;
    if (e.role === 'CT') continue; // Controllers can't be shot, only captured
    const d = canSee(b, u, side, foe, e);
    if (d < 0) continue;
    // prefer closer + wounded, hawks prefer whatever they can reach
    const score = d - (100 - e.hp) * 0.6;
    if (score < bd) { bd = score; best = e; }
  }
  return best;
}

// ---------- movement / AI ----------
function decideGoal(b, u, side, foe) {
  const f = b.field;
  // Controller: guard/advance behind the line, flee nearby enemies, claim ground.
  if (u.role === 'CT') {
    const threat = nearestEnemy(u, foe, 190);
    if (threat) return fleeFrom(u, threat, side.base);
    if (u.stance === 'push' && u.route.length) return advanceRoute(u);
    // shadow the countryman line from well behind
    const line = frontline(side, foe);
    const backX = side.side === 0 ? line - 95 : line + 95;
    return { x: clamp(backX, side.base.x, side.base.x + (side.side === 0 ? 360 : -360)), y: u.hy };
  }
  if (u.role === 'TS') return { x: u.anchor.x, y: u.anchor.y }; // run drones from backfield

  // acquire once per tick; tryShoot reuses this to avoid a second scan
  const enemy = u.fighter ? acquire(b, u, side, foe) : null;
  u._target = enemy;
  switch (u.stance) {
    case 'hold':
      if (enemy && dist(u, enemy) < u.range * 1.15) return { x: u.x, y: u.y };
      return u.route.length ? advanceRoute(u) : { x: u.anchor.x, y: u.anchor.y };
    case 'overwatch': {
      // sit on high ground near anchor, but drift toward screening the flag
      const ct = side.units.find(x => x.role === 'CT' && x.state === 'active');
      if (enemy && dist(u, enemy) < u.range) return { x: u.x, y: u.y };
      if (ct && side.team.tactics && side.plan.groups.HK.stance === 'overwatch') {
        return { x: (u.anchor.x + ct.x) / 2, y: (u.anchor.y + ct.y) / 2 };
      }
      return { x: u.anchor.x, y: u.anchor.y };
    }
    case 'hunt': {
      const ct = enemyController(foe);
      if (ct) return { x: ct.x, y: ct.y };
      if (enemy) return { x: enemy.x, y: enemy.y };
      return advanceRoute(u);
    }
    case 'flank':
      if (u.wpIndex < u.route.length) return advanceRoute(u);
      return enemy ? { x: enemy.x, y: enemy.y } : deepPush(side, foe);
    case 'fallback':
      return { x: side.base.x, y: side.base.y };
    case 'push':
    default:
      if (enemy && dist(u, enemy) < u.range * 0.85 && u.hp < 55) {
        // wounded: take cover if any is close
        const c = nearbyCover(f, u);
        if (c) return c;
      }
      if (u.wpIndex < u.route.length) return advanceRoute(u);
      return enemy ? { x: enemy.x, y: enemy.y } : deepPush(side, foe);
  }
}

function advanceRoute(u) {
  if (u.wpIndex >= u.route.length) {
    const last = u.route[u.route.length - 1];
    return last || { x: u.x, y: u.y };
  }
  const wp = u.route[u.wpIndex];
  if (Math.hypot(wp.x - u.x, wp.y - u.y) < 26) u.wpIndex++;
  return wp;
}
function deepPush(side, foe) {
  return { x: foe.base.x, y: foe.base.y };
}
function frontline(side, foe) {
  const cms = side.units.filter(u => u.role === 'CM' && u.state === 'active');
  if (!cms.length) return side.base.x;
  return cms.reduce((s, u) => s + u.x, 0) / cms.length;
}
function fleeFrom(u, threat, base) {
  const dx = u.x - threat.x, dy = u.y - threat.y;
  const m = Math.hypot(dx, dy) || 1;
  return { x: u.x + (dx / m) * 60 + (base.x - u.x) * 0.15, y: u.y + (dy / m) * 60 };
}
function nearestEnemy(u, foe, within) {
  let best = null, bd = within;
  for (const e of foe.units) {
    if (e.state !== 'active' || e.role === 'CMD' || e.role === 'CT') continue;
    const d = Math.hypot(e.x - u.x, e.y - u.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function enemyController(foe) { return foe.ctCaptured ? null : foe.units.find(u => u.role === 'CT' && u.state === 'active'); }
function nearbyCover(f, u) {
  let best = null, bd = 90;
  for (const c of f.covers) {
    const d = Math.hypot(c.x - u.x, c.y - u.y);
    if (d < bd) { bd = d; best = { x: c.x, y: c.y }; }
  }
  return best;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function moveUnit(b, u, goal, dt) {
  let dx = goal.x - u.x, dy = goal.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) return;
  dx /= d; dy /= d;
  // separation from nearby allies
  let sx = 0, sy = 0;
  for (const a of b.sides[u.side].units) {
    if (a === u || a.state !== 'active') continue;
    const ad = Math.hypot(a.x - u.x, a.y - u.y);
    if (ad < 20 && ad > 0.1) { sx += (u.x - a.x) / ad; sy += (u.y - a.y) / ad; }
  }
  dx += sx * 0.5; dy += sy * 0.5;
  const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;

  let sp = u.speed * terrainSpeed(b, u.x, u.y);
  if (u.stance === 'flank' || u.role === 'RR') sp *= 1.1;
  let step = sp * dt;
  let nx = u.x + dx * step, ny = u.y + dy * step;
  // obstacle avoidance: try straight, then rotate
  if (isBlocked(b.field, nx, ny, 8) || !inField(nx, ny)) {
    let placed = false;
    for (const ang of [0.6, -0.6, 1.2, -1.2, 2.0, -2.0]) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
      nx = u.x + rx * step; ny = u.y + ry * step;
      if (!isBlocked(b.field, nx, ny, 8) && inField(nx, ny)) { placed = true; break; }
    }
    if (!placed) { nx = u.x; ny = u.y; }
  }
  u.x = clamp(nx, 10, b.field.w - 10);
  u.y = clamp(ny, 10, b.field.h - 10);
}
function terrainSpeed(b, x, y) {
  let s = 1;
  if (b.map.type === 'Marshland') s *= 0.75;
  if (b.map.type === 'Forest') s *= 0.9;
  if (b.map.type === 'Desert') s *= 1.1;
  if (coverAt(b.field, x, y) > 0.3) s *= 0.9;
  return s;
}

// ---------- combat ----------
function tryShoot(b, u, side, foe, dt) {
  u.cool -= dt;
  if (u.cool > 0) return;
  const target = (u._target && u._target.state === 'active') ? u._target : acquire(b, u, side, foe);
  if (!target) return;
  const d = dist(u, target);
  if (d > u.range) return;
  u.cool = u.cd * (0.85 + rnd() * 0.3);

  const aimN = u.aim / 20;
  let pHit = 0.14 + aimN * 0.30;
  pHit *= clamp(1.12 - (d / u.range) * 0.9, 0.15, 1.05);
  pHit *= 1 - coverAt(b.field, target.x, target.y);
  if (target._moving) pHit *= 0.82;
  if (onHighGround(b.field, u.x, u.y)) pHit *= u.role === 'HK' ? 1.25 : 1.1;
  pHit *= side.coordination;
  b.events.push({ kind: 'shot', x1: u.x, y1: u.y, x2: target.x, y2: target.y, side: u.side, hawk: u.role === 'HK' });

  if (rnd() < pHit) {
    const dmg = (u.dmg + rint(-3, 3)) * (1 - Math.min(0.4, target.protect * 0.06));
    applyDamage(b, target, foe, u, dmg);
    b.events.push({ kind: 'hit', x: target.x, y: target.y, side: u.side });
  }
}

function applyDamage(b, target, targetSide, shooter, dmg) {
  target.hp -= dmg;
  target.lastHitLethal = shooter ? shooter.lethal : false;
  if (target.hp <= 0) downUnit(b, target, targetSide, shooter);
}

function downUnit(b, target, targetSide, shooter) {
  const lethalCtx = b.leagueType.lethalAllowed && target.lastHitLethal;
  const deathP = clamp(0.22 - target.protect * 0.05, 0.03, 0.28);
  const fatal = lethalCtx && chance(deathP);
  target.state = fatal ? 'dead' : 'down';
  target.hp = 0;
  targetSide.morale -= fatal ? 10 : 6;
  if (shooter) {
    if (shooter.side !== target.side) {
      const shooterSide = b.sides[shooter.side];
      if (fatal) { shooterSide.kills++; shooter.player.seasonStats.kills++; }
      else { shooterSide.incaps++; shooter.player.seasonStats.incaps++; }
    }
  }
  if (fatal) b._emit('death', `${target.player.name} (${ROLES[target.role].name}, ${target.team.name}) is KILLED${shooter ? ' by ' + shooter.player.name : ''}. The oversight drones descend.`);
  else b._emit('incap', `${target.player.name} (${ROLES[target.role].name}, ${target.team.name}) is incapacitated${shooter ? ' by ' + shooter.player.name : ''} and dragged off.`);
}

// ---------- drones ----------
function updateDrones(b, side, dt) {
  const foe = b.sides[1 - side.side];
  for (const dr of side.drones) {
    // patrol: advance into enemy half along the lane, then loiter with a weave
    const tgtX = side.side === 0 ? b.field.w * (0.55 + 0.08 * Math.sin(b.time * 0.4 + dr.lane)) : b.field.w * (0.45 - 0.08 * Math.sin(b.time * 0.4 + dr.lane));
    const tgtY = dr.lane + Math.sin(b.time * 0.6 + dr.lane) * 40;
    const dx = tgtX - dr.x, dy = tgtY - dr.y, d = Math.hypot(dx, dy) || 1;
    const sp = 150 * dt;
    dr.x += (dx / d) * Math.min(sp, d);
    dr.y += (dy / d) * Math.min(sp, d);
    // reveal enemies in range for the team
    for (const e of foe.units) {
      if (e.state !== 'active') continue;
      if (Math.hypot(e.x - dr.x, e.y - dr.y) < dr.range) b.reveal[side.side].set(e.id, b.time + 3);
    }
    // strike drones fire
    if (dr.kind === 'strike') {
      dr.cool -= dt;
      if (dr.cool <= 0) {
        let tgt = null, bd = dr.range;
        for (const e of foe.units) {
          if (e.state !== 'active' || e.role === 'CMD' || e.role === 'CT') continue;
          const dd = Math.hypot(e.x - dr.x, e.y - dr.y);
          if (dd < bd) { bd = dd; tgt = e; }
        }
        if (tgt) {
          dr.cool = dr.cd;
          b.events.push({ kind: 'shot', x1: dr.x, y1: dr.y, x2: tgt.x, y2: tgt.y, side: dr.side, drone: true });
          if (chance(0.5)) {
            const fakeShooter = { side: dr.side, lethal: dr.lethal, player: droneOperator(side) };
            applyDamage(b, tgt, foe, fakeShooter, dr.dmg + rint(-3, 3));
            b.events.push({ kind: 'hit', x: tgt.x, y: tgt.y, side: dr.side });
          }
        }
      }
    }
  }
}
function droneOperator(side) {
  const ts = side.units.find(u => u.role === 'TS' && u.state === 'active') || side.units.find(u => u.role === 'TS');
  return ts ? ts.player : { name: 'Drone', seasonStats: { kills: 0, incaps: 0 } };
}

// ---------- territory ----------
function claimTerritory(b, side) {
  if (side.ctCaptured) return;
  const ct = side.units.find(u => u.role === 'CT' && u.state === 'active');
  if (!ct) return;
  const foe = b.sides[1 - side.side];
  const efoeCt = foe.units.find(u => u.role === 'CT' && u.state === 'active');
  const cx = Math.floor(ct.x / TERR_CELL_W), cy = Math.floor(ct.y / TERR_CELL_H);
  const rad = Math.ceil(CLAIM_RADIUS / Math.min(TERR_CELL_W, TERR_CELL_H));
  for (let ry = cy - rad; ry <= cy + rad; ry++) {
    for (let rx = cx - rad; rx <= cx + rad; rx++) {
      if (rx < 0 || ry < 0 || rx >= TERR_COLS || ry >= TERR_ROWS) continue;
      const i = ry * TERR_COLS + rx;
      const c = cellCenter(i);
      if (Math.hypot(c.x - ct.x, c.y - ct.y) > CLAIM_RADIUS) continue;
      if (b.territory[i] === side.side) continue;
      if (b.territory[i] === -1) { b.territory[i] = side.side; continue; }
      // contested: steal enemy ground only if their Controller isn't defending it
      if (!efoeCt || Math.hypot(c.x - efoeCt.x, c.y - efoeCt.y) > CLAIM_RADIUS) {
        b.territory[i] = side.side;
      }
    }
  }
}
function terrPercent(territory) {
  let a = 0, bb = 0;
  for (let i = 0; i < territory.length; i++) { if (territory[i] === 0) a++; else if (territory[i] === 1) bb++; }
  return [a / TERR_CELLS * 100, bb / TERR_CELLS * 100];
}

// ---------- captures ----------
function tryCapture(b, side, foe, dt) {
  if (side.surrendered || foe.ctCaptured) return;
  const ct = foe.units.find(u => u.role === 'CT' && u.state === 'active');
  if (!ct) return;
  // an attacker must reach the flag; nearby friendly fighters (and guard gear) protect it
  const attacker = side.units.find(u => u.state === 'active' && u.fighter && Math.hypot(u.x - ct.x, u.y - ct.y) < 30);
  if (!attacker) return;
  let guards = foe.units.filter(u => u.state === 'active' && u.fighter && Math.hypot(u.x - ct.x, u.y - ct.y) < 80).length;
  guards += foe.gearGuard > 0 ? 1 : 0;
  // an unguarded flag falls in a few seconds of sustained contact; each guard cuts the odds hard
  const p = clamp(0.2 - guards * 0.3, 0.01, 0.2) * dt;
  if (!chance(p)) return;

  foe.ctCaptured = true;
  ct.state = 'captured';
  attacker.player.seasonStats.captures++;
  // transfer all of the victim's claimed ground
  let moved = 0;
  for (let i = 0; i < b.territory.length; i++) if (b.territory[i] === foe.side) { b.territory[i] = side.side; moved++; }
  foe.morale -= 40; side.morale = clamp(side.morale + 15, 0, 120);
  b._emit('capture', `FLAG CAPTURED! ${attacker.player.name} seizes the ${foe.team.name} colours — ${Math.round(moved / TERR_CELLS * 100)}% of the field transfers to ${side.team.name} at a stroke.`);
}

// ---------- morale / surrender ----------
function updateMorale(b, side, foe, dt) {
  if (side.surrendered) return;
  const terr = terrPercent(b.territory);
  if (terr[side.side] > terr[1 - side.side]) side.morale = clamp(side.morale + 2 * dt, 0, 120);
  const fightersLeft = side.units.filter(u => u.state === 'active' && u.fighter).length;
  const fightersTotal = side.units.filter(u => u.fighter).length;
  if (fightersTotal && fightersLeft / fightersTotal < 0.35 && side.morale < 26 && terr[side.side] < terr[1 - side.side]) {
    if (chance(0.6 * dt)) {
      side.surrendered = true;
      b._emit('surrender', `${side.team.name}'s Commander keys the surrender code.`);
    }
  }
}

// ---------- win conditions ----------
function fightersActive(side) { return side.units.filter(u => u.state === 'active' && u.fighter).length; }
function hadFighters(side) { return side.units.some(u => u.fighter); }

function checkWin(b) {
  const [a, bs] = b.sides;
  for (const [s, foe] of [[a, bs], [bs, a]]) {
    if (foe.surrendered) return finish(b, s, 'surrender', `${s.team.name} WIN by surrender.`);
    if (hadFighters(foe) && fightersActive(foe) === 0) {
      const anyDead = foe.units.some(u => u.state === 'dead');
      const cond = anyDead ? 'elimination' : 'incapacitation';
      return finish(b, s, cond, `${foe.team.name} have no fighters left standing — ${s.team.name} WIN by ${cond}.`);
    }
    const terr = terrPercent(b.territory);
    if (terr[s.side] >= TERRITORY_WIN) return finish(b, s, 'territory', `${s.team.name} control ${Math.round(terr[s.side])}% of the field — TERRITORY VICTORY.`);
  }
}
function finish(b, winnerSide, condition, msg) {
  b.over = true; b._winner = winnerSide; b._condition = condition;
  b._emit('end', msg);
}
function endByTime(b) {
  const terr = terrPercent(b.territory);
  if (Math.abs(terr[0] - terr[1]) < 1.5) {
    b.over = true; b._winner = null; b._condition = 'draw';
    b._emit('end', `Time. The judges rule a DRAW at ${Math.round(terr[0])}% – ${Math.round(terr[1])}%.`);
  } else {
    const w = terr[0] > terr[1] ? b.sides[0] : b.sides[1];
    b.over = true; b._winner = w; b._condition = 'territory-decision';
    b._emit('end', `Time. ${w.team.name} take it on territory, ${Math.round(terr[0])}% – ${Math.round(terr[1])}%.`);
  }
}

// ---------- result + roster consequences ----------
function finalize(b) {
  const terr = terrPercent(b.territory);
  const casualties = [[], []], deaths = [[], []];
  b.sides.forEach((s, i) => {
    for (const u of s.units) {
      if (u.state === 'dead') {
        u.player.status = 'dead';
        deaths[i].push(u.player);
      } else if (u.state === 'down') {
        const weeks = 1 + Math.floor(u.player.stats.injuryProne / 7) + rint(0, 2);
        u.player.status = 'injured';
        u.player.injuryWeeks = Math.max(u.player.injuryWeeks, weeks);
        casualties[i].push({ player: u.player, weeks });
      }
      u.player.seasonStats.matches++;
    }
  });
  return {
    map: b.map, log: b.log,
    teams: [b.sides[0].team, b.sides[1].team],
    terr: [Math.round(terr[0] * 10) / 10, Math.round(terr[1] * 10) / 10],
    winnerId: b._winner ? b._winner.team.id : null,
    condition: b._condition,
    kills: [b.sides[0].kills, b.sides[1].kills],
    incaps: [b.sides[0].incaps, b.sides[1].incaps],
    ctCaptured: [b.sides[0].ctCaptured, b.sides[1].ctCaptured],
    casualties, deaths,
  };
}

// ---------- headless entry (AI matches + tests) ----------
function simulateMatch(teamA, teamB, leagueType, map, plans) {
  const b = createBattle(teamA, teamB, leagueType, map || genMap(), plans);
  let steps = 0;
  while (!b.over && steps++ < 1400) b.step(0.3); // coarse fixed step for speed
  if (!b.over) endByTime(b);
  if (!b.result) b.result = finalize(b);
  return b.result;
}

if (typeof module !== 'undefined') module.exports = {};
