/* Headless smoke test: runs the DOM-free sim core through two full seasons.
   Usage: node test/sim-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math, JSON };
vm.createContext(ctx);
for (const f of ['data.js', 'player.js', 'team.js', 'field.js', 'formation.js', 'battle.js', 'league.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}

vm.runInContext(`
  globalThis.run = function(assert, leagueKey) {
    const state = newGame('Test Manager', 'Test Team', leagueKey);
    assert(state.teams.length === NUM_TEAMS, 'team count');
    assert(state.fixtures.length === (NUM_TEAMS - 1) * 2, 'double round robin length');
    for (const round of state.fixtures) {
      assert(round.length === NUM_TEAMS / 2, 'fixtures per round');
      const ids = round.flatMap(f => [f.home, f.away]);
      assert(new Set(ids).size === NUM_TEAMS, 'every team plays each round');
    }
    const pt = playerTeam(state);
    assert(pt.roster.length === SQUAD_SIZE, 'squad size 15');
    for (const rk of ROLE_ORDER) {
      assert(pt.roster.filter(p => p.role === rk).length === ROLES[rk].count, 'role quota ' + rk);
    }

    // armory transactions
    let r = buyWeapon(state, 'rubber');
    assert(r.ok, 'buy non-lethal weapon: ' + r.msg);
    r = buyWeapon(state, 'rifle');
    assert(leagueKey === 'BSP' ? r.ok : !r.ok, 'lethal legality gate (' + leagueKey + ')');
    r = buyWeapon(state, 'probe');
    assert(!r.ok, 'probe blocked without license');
    r = buyProbeLicense(state);
    assert(r.ok, 'license purchase');
    r = buyWeapon(state, 'probe');
    assert(r.ok, 'probe allowed with license');
    buyWeapon(state, 'armor'); buyWeapon(state, 'recondrone');
    if (leagueKey === 'NONBSP') { buyWeapon(state, 'tranq'); buyWeapon(state, 'snarekit'); }

    // sign & release
    const fa = state.freeAgents[0];
    r = signPlayer(state, fa.id);
    assert(r.ok, 'sign free agent: ' + r.msg);
    assert(pt.roster.includes(fa), 'signed player on roster');
    r = releasePlayer(state, fa.id);
    assert(r.ok, 'release player: ' + r.msg);

    // full season
    let totalLog = 0, playerMatches = 0;
    while (!state.seasonOver) {
      const res = playMatchday(state);
      assert(res, 'player result each matchday');
      if (res) {
        playerMatches++;
        totalLog += res.log.length;
        assert(res.log.length >= 3, 'log has events');
        assert(res.terr[0] >= 0 && res.terr[1] >= 0 && res.terr[0] + res.terr[1] <= 100.5, 'territory sane: ' + res.terr);
        assert(['elimination','incapacitation','surrender','territory','territory-decision','draw'].includes(res.condition), 'condition valid: ' + res.condition);
        if (leagueKey === 'NONBSP') assert(res.deaths[0].length === 0 && res.deaths[1].length === 0, 'no deaths in non-BSP');
        for (const e of res.log) assert(typeof e.text === 'string' && !e.text.includes('undefined'), 'no undefined in log: ' + e.text);
      }
    }
    assert(playerMatches === (NUM_TEAMS - 1) * 2, 'player played full season, got ' + playerMatches);
    const table = standings(state);
    assert(table.reduce((s, t) => s + t.points, 0) > 0, 'points awarded');
    assert(table.every(t => t.played === (NUM_TEAMS - 1) * 2), 'all teams played all matches');
    assert(Number.isFinite(pt.balance), 'balance finite');

    // save/load round trip
    const json = JSON.stringify(state);
    const loaded = JSON.parse(json);
    assert(loaded.teams.length === NUM_TEAMS, 'save/load round trip');

    // next season
    startNextSeason(state);
    assert(state.season === 2 && state.week === 1 && !state.seasonOver, 'season rollover');
    assert(state.fixtures.every(r2 => r2.every(f => !f.result)), 'fresh fixtures');
    // play season 2 too, exercising deaths/refills over time
    while (!state.seasonOver) playMatchday(state);
    return { avgLog: Math.round(totalLog / playerMatches) };
  };
`, ctx, { filename: 'harness' });

// The spatial engine is heavier than the old abstract one, so run a few full
// two-season careers per league rather than dozens.
for (const leagueKey of ['NONBSP', 'BSP']) {
  for (let i = 0; i < 3; i++) {
    const out = ctx.run(assert, leagueKey);
    if (i === 0) console.log(`${leagueKey}: full two-season career ok (avg ${out.avgLog} log events per match)`);
  }
}

// Spatial-engine specifics: units get real positions, terrain, and plans.
vm.runInContext(`
  globalThis.runBattleChecks = function(assert) {
    const map = genMap();
    const field = genField(map);
    assert(field.w === FIELD_W && field.h === FIELD_H, 'field dimensions');
    const a = genTeam('A', 12, true), b = genTeam('B', 12, false);
    // player provides an explicit plan; AI auto-plans
    const plan = fitPlanToField(buildPlan('wedge'), field, 0);
    const battle = createBattle(a, b, LEAGUE_TYPES.BSP, map, [plan, null]);
    let placedInField = 0, total = 0;
    for (const s of battle.sides) for (const u of s.units) {
      total++;
      if (u.x >= 0 && u.x <= FIELD_W && u.y >= 0 && u.y <= FIELD_H) placedInField++;
      assert(u.hp === 100 && u.state === 'active', 'unit starts fit');
    }
    assert(placedInField === total, 'all units placed inside the field');
    assert(total === battle.sides[0].fielded.length + battle.sides[1].fielded.length, 'unit count matches fielded');
    // step it and confirm units actually move and the sim terminates
    const start = battle.sides[0].units.filter(u=>u.role==='CM').map(u=>({x:u.x,y:u.y}));
    let steps = 0;
    while (!battle.over && steps++ < 1400) battle.step(0.3);
    assert(battle.over, 'battle terminates');
    assert(battle.result, 'battle produces a result');
    const moved = battle.sides[0].units.filter(u=>u.role==='CM').some((u,i)=> Math.hypot(u.x-start[i].x,u.y-start[i].y) > 5);
    assert(moved, 'units move during the battle');
    const terr = battle.terrPct();
    assert(terr[0] >= 0 && terr[1] >= 0 && terr[0] + terr[1] <= 100.5, 'territory percentage sane');
    for (const e of battle.result.log) assert(!e.text.includes('undefined'), 'no undefined in battle log');
  };
`, ctx, { filename: 'battleharness' });
for (let i = 0; i < 20; i++) ctx.runBattleChecks(assert);
console.log('battle-engine checks ok');

if (failures) { console.error(failures + ' assertion failure(s)'); process.exit(1); }
console.log('All sim smoke tests passed.');
