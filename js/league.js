/* Artes Mortis Manager — league, calendar, finances, season loop (DOM-free) */
'use strict';

const NUM_TEAMS = 8;

function newGame(managerName, teamName, leagueKey) {
  const leagueType = LEAGUE_TYPES[leagueKey];
  const teams = [genTeam(teamName, 11, true)];
  const aiNames = AI_TEAM_NAMES.slice();
  for (let i = 1; i < NUM_TEAMS; i++) {
    const idx = rint(0, aiNames.length - 1);
    teams.push(genTeam(aiNames.splice(idx, 1)[0], rint(8, 15), false));
  }
  const player = teams[0];
  player.balance = STARTING_BALANCE[leagueKey];

  return {
    version: 1,
    managerName,
    leagueKey,
    season: 1,
    week: 1,                 // 1..fixtures.length, then off-season
    teams,
    fixtures: genFixtures(teams),
    freeAgents: genFreeAgents(30),
    history: [],             // past match results involving the player team
    news: [
      'Your armory is EMPTY. Visit the Armory and equip the squad before matchday 1 — an unarmed team will be overrun.',
      `Season 1 of the ${leagueType.name} begins. ${managerName} takes charge of ${teamName}.`,
    ],
    seasonOver: false,
  };
}

// Double round-robin via the circle method → 14 matchdays for 8 teams
function genFixtures(teams) {
  const ids = teams.map(t => t.id);
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    const ring = [ids[0], ...arr];
    for (let i = 0; i < n / 2; i++) {
      round.push({ home: ring[i], away: ring[n - 1 - i], map: genMap(), result: null });
    }
    rounds.push(round);
    arr.unshift(arr.pop());
  }
  const second = rounds.map(round =>
    round.map(f => ({ home: f.away, away: f.home, map: genMap(), result: null })));
  return rounds.concat(second);
}

function teamById(state, id) { return state.teams.find(t => t.id === id); }
function leagueType(state) { return LEAGUE_TYPES[state.leagueKey]; }
function playerTeam(state) { return state.teams.find(t => t.isPlayer); }

function currentFixtures(state) {
  return state.week <= state.fixtures.length ? state.fixtures[state.week - 1] : null;
}
function playerFixture(state) {
  const round = currentFixtures(state);
  if (!round) return null;
  const pt = playerTeam(state);
  return round.find(f => f.home === pt.id || f.away === pt.id) || null;
}

// Simulate every match of the current week. Returns the player's match result
// (with full log) so the UI can play it back; AI-only results are summarized.
function playMatchday(state) {
  const round = currentFixtures(state);
  if (!round) return null;
  const lt = leagueType(state);
  const pt = playerTeam(state);
  let playerResult = null;

  for (const fx of round) {
    if (fx.result) continue;
    const home = teamById(state, fx.home), away = teamById(state, fx.away);
    const res = simulateMatch(home, away, lt, fx.map);
    fx.result = summarizeResult(res);
    applyResult(state, home, away, res);
    if (home === pt || away === pt) {
      playerResult = res;
      state.history.push(fx.result);
    }
  }

  advanceWeek(state);
  return playerResult;
}

function summarizeResult(res) {
  return {
    homeId: res.teams[0].id, awayId: res.teams[1].id,
    homeName: res.teams[0].name, awayName: res.teams[1].name,
    terr: res.terr, winnerId: res.winnerId, condition: res.condition,
    kills: res.kills, incaps: res.incaps, map: res.map.name,
    deaths: res.deaths.map(list => list.map(p => p.name)),
  };
}

function applyResult(state, home, away, res) {
  const lt = leagueType(state);
  [home, away].forEach((team, i) => {
    const won = res.winnerId === team.id;
    const drew = res.winnerId === null;
    team.played++;
    if (won) { team.wins++; team.points += 3; }
    else if (drew) { team.draws++; team.points += 1; }
    else team.losses++;
    team.terrFor += res.terr[i];
    team.terrAgainst += res.terr[1 - i];

    // finances
    let income = lt.gateBase + rint(-5000, 15000);
    if (won) income += lt.winPrize;
    else if (drew) income += lt.drawPrize;
    let costs = TERRAIN_FEE + lt.oversightFee + res.deaths[i].length * DEATH_COMPENSATION;
    team.balance += income - costs;

    // territory season stat for the controller
    const ct = team.roster.find(p => p.role === 'CT' && p.status !== 'dead');
    if (ct) ct.seasonStats.territory += res.terr[i];

    if (team.isPlayer) {
      if (res.deaths[i].length) {
        for (const d of res.deaths[i]) {
          state.news.unshift(`OBITUARY: ${d.name} (${ROLES[d.role].name}) was killed on ${res.map.name}. ${fmtMoney(DEATH_COMPENSATION)} compensation paid to the estate.`);
        }
      }
    }
  });
}

function advanceWeek(state) {
  // wages + injury recovery for everyone
  for (const team of state.teams) {
    team.balance -= weeklyWageBill(team);
    for (const p of team.roster) {
      if (p.status === 'injured' && --p.injuryWeeks <= 0) {
        p.status = 'fit'; p.injuryWeeks = 0;
        if (team.isPlayer) state.news.unshift(`${p.name} has recovered from injury and is fit for selection.`);
      }
    }
  }
  // AI squads replace their dead
  for (const team of state.teams) {
    if (team.isPlayer) continue;
    for (const rk of ROLE_ORDER) {
      const alive = team.roster.filter(p => p.role === rk && p.status !== 'dead').length;
      for (let i = alive; i < ROLES[rk].count; i++) team.roster.push(genPlayer(rk, rint(7, 13)));
    }
  }
  // top up the free agent market
  while (state.freeAgents.length < 22) state.freeAgents.push(genPlayer(pick(ROLE_ORDER), rint(6, 16)));

  state.week++;
  if (state.week > state.fixtures.length) endSeason(state);
}

function standings(state) {
  return state.teams.slice().sort((a, b) =>
    b.points - a.points || (b.terrFor - b.terrAgainst) - (a.terrFor - a.terrAgainst) || b.wins - a.wins);
}

function endSeason(state) {
  if (state.seasonOver) return;
  state.seasonOver = true;
  const table = standings(state);
  const lt = leagueType(state);
  table.forEach((team, i) => { team.balance += lt.seasonPrizes[i] || 0; });
  const champ = table[0];
  const pt = playerTeam(state);
  state.news.unshift(`SEASON ${state.season} COMPLETE — ${champ.name} are champions! ${pt.name} finish ${ordinal(table.indexOf(pt) + 1)} and collect ${fmtMoney(lt.seasonPrizes[table.indexOf(pt)] || 0)} in season prize money.`);
}

function startNextSeason(state) {
  if (!state.seasonOver) return;
  state.season++;
  state.week = 1;
  state.seasonOver = false;
  const retirees = [];
  for (const team of state.teams) {
    team.played = team.wins = team.draws = team.losses = team.points = 0;
    team.terrFor = team.terrAgainst = 0;
    team.roster = team.roster.filter(p => p.status !== 'dead');
    for (const p of team.roster) {
      p.age++;
      p.contractYears = Math.max(0, p.contractYears - 1);
      p.status = 'fit'; p.injuryWeeks = 0;
      p.seasonStats = { kills: 0, incaps: 0, captures: 0, territory: 0, matches: 0 };
      // development / decline
      const k = pick(STAT_KEYS.filter(x => x !== 'injuryProne'));
      if (p.age < 27) p.stats[k] = clamp(p.stats[k] + 1, 1, 20);
      else if (p.age > 31 && p.role !== 'CMD') p.stats[k] = clamp(p.stats[k] - 1, 1, 20);
    }
    // retirement (commanders soldier on until 55)
    const before = team.roster.length;
    team.roster = team.roster.filter(p => !(p.role !== 'CMD' && p.age >= 35 && chance(0.6)) && !(p.role === 'CMD' && p.age >= 55));
    if (team.isPlayer && before > team.roster.length) retirees.push(before - team.roster.length);
    // AI teams refill vacancies
    if (!team.isPlayer) {
      for (const rk of ROLE_ORDER) {
        const have = team.roster.filter(p => p.role === rk).length;
        for (let i = have; i < ROLES[rk].count; i++) team.roster.push(genPlayer(rk, rint(7, 14)));
      }
    }
  }
  state.fixtures = genFixtures(state.teams);
  state.freeAgents = genFreeAgents(30);
  state.news.unshift(`Season ${state.season} begins. The transfer market is open — check the free agent pool for reinforcements.`);
  if (retirees.length) state.news.unshift(`${retirees[0]} of your players retired in the off-season. Recruit replacements before matchday 1.`);
}

// ---------- squad & armory transactions (player team) ----------
function signPlayer(state, playerId) {
  const team = playerTeam(state);
  const idx = state.freeAgents.findIndex(p => p.id === playerId);
  if (idx < 0) return { ok: false, msg: 'Player no longer available.' };
  const p = state.freeAgents[idx];
  const fee = p.wage * 4; // signing bonus
  if (team.balance < fee) return { ok: false, msg: `Cannot afford the ${fmtMoney(fee)} signing bonus.` };
  const roleCount = team.roster.filter(x => x.role === p.role && x.status !== 'dead').length;
  if (roleCount >= ROLES[p.role].count + 2) return { ok: false, msg: `Squad limit: max ${ROLES[p.role].count + 2} ${ROLES[p.role].name}s (need ${ROLES[p.role].count} to field).` };
  state.freeAgents.splice(idx, 1);
  team.roster.push(p);
  team.balance -= fee;
  state.news.unshift(`${p.name} (${ROLES[p.role].name}) signs for ${team.name} — ${fmtMoney(fee)} bonus, ${fmtMoney(p.wage)}/wk.`);
  return { ok: true, msg: `${p.name} signed.` };
}

function releasePlayer(state, playerId) {
  const team = playerTeam(state);
  const idx = team.roster.findIndex(p => p.id === playerId);
  if (idx < 0) return { ok: false, msg: 'Not on your roster.' };
  const p = team.roster[idx];
  const payoff = p.status === 'dead' ? 0 : p.wage * 2 * p.contractYears;
  if (team.balance < payoff) return { ok: false, msg: `Cannot afford the ${fmtMoney(payoff)} contract payoff.` };
  team.roster.splice(idx, 1);
  team.balance -= payoff;
  if (p.status !== 'dead') { p.contractYears = rint(1, 3); state.freeAgents.push(p); }
  return { ok: true, msg: `${p.name} released${payoff ? ' (' + fmtMoney(payoff) + ' payoff)' : ''}.` };
}

function buyWeapon(state, weaponId) {
  const team = playerTeam(state);
  const w = WEAPON_POOL.find(x => x.id === weaponId);
  if (!w) return { ok: false, msg: 'Unknown item.' };
  if (team.armory.includes(weaponId)) return { ok: false, msg: 'Already in your armory.' };
  if (w.lethal && !leagueType(state).lethalAllowed) return { ok: false, msg: 'Lethal equipment is illegal in a non-BSP league.' };
  if (w.licensed && !team.probeLicense) return { ok: false, msg: 'Requires an Oversight Board Probe License.' };
  if (team.balance < w.cost) return { ok: false, msg: `Cannot afford ${fmtMoney(w.cost)}.` };
  team.balance -= w.cost;
  team.armory.push(weaponId);
  return { ok: true, msg: `${w.name} added to the armory.` };
}

function sellWeapon(state, weaponId) {
  const team = playerTeam(state);
  const idx = team.armory.indexOf(weaponId);
  if (idx < 0) return { ok: false, msg: 'Not in your armory.' };
  const w = WEAPON_POOL.find(x => x.id === weaponId);
  team.armory.splice(idx, 1);
  team.balance += Math.round(w.cost * 0.5);
  return { ok: true, msg: `${w.name} sold back at half price.` };
}

function buyProbeLicense(state) {
  const team = playerTeam(state);
  if (team.probeLicense) return { ok: false, msg: 'License already held.' };
  if (team.balance < PROBE_LICENSE_COST) return { ok: false, msg: `The license costs ${fmtMoney(PROBE_LICENSE_COST)}.` };
  team.balance -= PROBE_LICENSE_COST;
  team.probeLicense = true;
  return { ok: true, msg: 'Oversight Board Probe License granted.' };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
