/* Headless smoke test: runs the DOM-free sim core through two full seasons.
   Usage: node test/sim-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math, JSON };
vm.createContext(ctx);
for (const f of ['data.js', 'player.js', 'team.js', 'match.js', 'league.js']) {
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

for (const leagueKey of ['NONBSP', 'BSP']) {
  for (let i = 0; i < 15; i++) {
    const out = ctx.run(assert, leagueKey);
    if (i === 0) console.log(`${leagueKey}: ok (avg ${out.avgLog} log events per match)`);
  }
}

if (failures) { console.error(failures + ' assertion failure(s)'); process.exit(1); }
console.log('All sim smoke tests passed.');
