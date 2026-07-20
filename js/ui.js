/* Artes Mortis Manager — UI rendering & interaction */
'use strict';

let SCREEN = 'home';
let SQUAD_TAB = 'roster';
let MATCH_PLAYBACK = null; // { result, idx, timer, speed, done }

const $app = () => document.getElementById('app');
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
}

// ---------- root render ----------
function render() {
  if (!G) { $app().innerHTML = renderNewGame(); return; }
  const pt = playerTeam(G);
  const lt = leagueType(G);
  const weekLabel = G.seasonOver ? 'Off-season' : `Matchday ${G.week} / ${G.fixtures.length}`;
  $app().innerHTML = `
    <header class="topbar">
      <div class="brand">Artes Mortis<span class="sub">Manager</span></div>
      <div class="topinfo">
        <div><span class="lbl">Club</span><span class="val">${esc(pt.name)}</span></div>
        <div><span class="lbl">League</span><span class="val">${lt.key === 'BSP' ? 'BSP' : 'non-BSP'}</span></div>
        <div><span class="lbl">Season ${G.season}</span><span class="val">${weekLabel}</span></div>
        <div><span class="lbl">Balance</span><span class="val ${pt.balance < 0 ? 'danger' : ''}">${fmtMoney(pt.balance)}</span></div>
        <div><span class="lbl">Wages</span><span class="val">${fmtMoney(weeklyWageBill(pt))}/wk</span></div>
      </div>
      <div class="spacer"></div>
      ${G.seasonOver
        ? `<button class="btn primary" data-action="next-season">Start Season ${G.season + 1}</button>`
        : `<button class="btn primary" data-action="continue">Play Matchday ${G.week}</button>`}
    </header>
    <nav class="tabs">
      ${['home:Overview', 'squad:Squad', 'tactics:Tactics', 'armory:Armory', 'league:League', 'finances:Finances', 'rules:Codex'].map(s => {
        const [k, label] = s.split(':');
        return `<button data-action="nav" data-id="${k}" class="${SCREEN === k ? 'active' : ''}">${label}</button>`;
      }).join('')}
      <div class="spacer"></div>
      <button data-action="new-game-confirm">New Game</button>
    </nav>
    <main>${renderScreen()}</main>`;
}

function renderScreen() {
  switch (SCREEN) {
    case 'home': return renderHome();
    case 'squad': return renderSquad();
    case 'tactics': return renderTactics();
    case 'armory': return renderArmory();
    case 'league': return renderLeague();
    case 'finances': return renderFinances();
    case 'rules': return renderRules();
    default: return '';
  }
}

// ---------- new game ----------
let NG_LEAGUE = 'NONBSP';
let NG_MANAGER = 'A. Shute';
let NG_TEAM = 'Dread Pioneers';
function renderNewGame() {
  return `
    <div class="titleblock"><h1>Artes Mortis</h1><p>Manager · Season One</p></div>
    <div class="newgame panel">
      <h2>Found Your Club</h2>
      <label class="field"><span>Manager name</span><input type="text" id="ng-manager" value="${esc(NG_MANAGER)}" maxlength="30"></label>
      <label class="field"><span>Team name</span><input type="text" id="ng-team" value="${esc(NG_TEAM)}" maxlength="30"></label>
      <label class="field"><span>League</span></label>
      <div class="league-pick">
        ${Object.values(LEAGUE_TYPES).map(lt => `
          <div class="optcard ${NG_LEAGUE === lt.key ? 'sel' : ''}" data-action="ng-league" data-id="${lt.key}">
            <div class="t">${esc(lt.name)}</div>
            <div class="d">${esc(lt.desc)}</div>
            <div class="d" style="margin-top:6px">Starting funds: <b>${fmtMoney(STARTING_BALANCE[lt.key])}</b> · Win prize: <b>${fmtMoney(lt.winPrize)}</b></div>
          </div>`).join('')}
      </div>
      <div style="margin-top:16px;text-align:center">
        <button class="btn primary" data-action="ng-start">Take the Job</button>
      </div>
    </div>`;
}

// ---------- home ----------
function renderHome() {
  const pt = playerTeam(G);
  if (G.seasonOver) return renderSeasonEnd();
  const fx = playerFixture(G);
  const opp = fx ? teamById(G, fx.home === pt.id ? fx.away : fx.home) : null;
  const { shortfalls } = fieldSquad(pt);
  const table = standings(G);
  const pos = table.indexOf(pt) + 1;
  return `
    <div class="cols">
      <div>
        <div class="panel">
          <h2>Next Match — Matchday ${G.week}</h2>
          ${opp ? `
            <p style="font-size:17px"><b>${esc(pt.name)}</b> vs <b>${esc(opp.name)}</b></p>
            <p class="dim">${esc(opp.name)}: ${opp.wins}W ${opp.draws}D ${opp.losses}L · ${opp.points} pts · squad strength ~${teamStrength(opp)}</p>
            <p style="margin-top:8px"><b>${esc(fx.map.name)}</b> — <span class="dim">${esc(fx.map.desc)}</span></p>
            <p class="small dim">Terrain effects: ${terrainEffects(fx.map)}</p>` : '<p>No fixture.</p>'}
          ${shortfalls.length ? `<p class="danger" style="margin-top:10px">⚠ UNDERSTRENGTH: missing ${shortfalls.map(s => `${s.missing} ${ROLES[s.role].name}`).join(', ')}. Sign free agents or you fight short-handed.</p>` : '<p class="good" style="margin-top:10px">✓ Full 15-strong squad available.</p>'}
        </div>
        <div class="panel">
          <h2>Standing</h2>
          <p>${ordinal(pos)} of ${G.teams.length} · ${pt.wins}W ${pt.draws}D ${pt.losses}L · ${pt.points} pts</p>
        </div>
      </div>
      <div class="panel">
        <h2>Dispatches</h2>
        <ul class="news">${G.news.slice(0, 14).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      </div>
    </div>`;
}

function teamStrength(team) {
  const { fielded } = fieldSquad(team);
  if (!fielded.length) return 0;
  return Math.round(fielded.reduce((s, p) => s + overallRating(p), 0) / fielded.length);
}
function terrainEffects(map) {
  const m = map.mods;
  const bits = [];
  if (m.hawk) bits.push(`Hawks ${m.hawk > 0 ? '+' : ''}${m.hawk}`);
  if (m.vehicle) bits.push(`vehicles ${m.vehicle > 0 ? '+' : ''}${m.vehicle}`);
  if (m.stealth) bits.push(`stealth ${m.stealth > 0 ? '+' : ''}${m.stealth}`);
  if (m.drone) bits.push(`drones ${m.drone > 0 ? '+' : ''}${m.drone}`);
  return bits.join(', ') || 'neutral ground';
}

function renderSeasonEnd() {
  const table = standings(G);
  const lt = leagueType(G);
  return `
    <div class="panel">
      <h2>Season ${G.season} — Final Standings</h2>
      ${standingsTable(table, lt)}
      <p style="margin-top:12px" class="dim">Season prize money has been paid out. Off-season aging, retirements and the transfer market resolve when you start the next season.</p>
    </div>
    <div class="panel">
      <h2>Dispatches</h2>
      <ul class="news">${G.news.slice(0, 10).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`;
}

// ---------- squad ----------
function renderSquad() {
  const pt = playerTeam(G);
  return `
    <nav class="tabs">
      <button data-action="squad-tab" data-id="roster" class="${SQUAD_TAB === 'roster' ? 'active' : ''}">Roster (${pt.roster.filter(p => p.status !== 'dead').length})</button>
      <button data-action="squad-tab" data-id="market" class="${SQUAD_TAB === 'market' ? 'active' : ''}">Free Agents (${G.freeAgents.length})</button>
    </nav>
    ${SQUAD_TAB === 'roster' ? renderRoster(pt) : renderMarket(pt)}`;
}

function statCell(v) {
  const cls = v >= 16 ? 's-hi' : v <= 6 ? 's-lo' : '';
  return `<span class="statv ${cls}">${v}</span>`;
}
function playerRow(p, actionsHtml, leadCells) {
  const s = p.stats;
  const status = p.status === 'dead' ? '<span class="danger">DEAD</span>'
    : p.status === 'injured' ? `<span class="danger">INJ ${p.injuryWeeks}w</span>` : '<span class="good">Fit</span>';
  return `<tr class="${p.status}">
    ${leadCells || ''}<td>${esc(p.name)}</td><td class="num">${p.age}</td>
    <td class="num"><b>${overallRating(p)}</b> <span class="dim small">${playerDesc(p)}</span></td>
    <td class="num">${statCell(s.aim)}</td><td class="num">${statCell(s.speed)}</td>
    <td class="num">${statCell(s.endurance)}</td><td class="num">${statCell(s.stealth)}</td>
    <td class="num">${statCell(s.tacticalIQ)}</td><td class="num">${statCell(s.courage)}</td>
    <td class="num">${statCell(s.loyalty)}</td><td class="num">${statCell(s.injuryProne)}</td>
    <td class="num">${fmtMoney(p.wage)}/wk</td><td class="num">${p.contractYears}y</td>
    <td>${status}</td>
    <td class="num small dim">${p.seasonStats.kills}K ${p.seasonStats.incaps}I ${p.seasonStats.captures}C</td>
    <td>${actionsHtml}</td>
  </tr>`;
}
const STAT_HEADER = `<th>Name</th><th class="num">Age</th><th class="num">Ovr</th>
  <th class="num">Aim</th><th class="num">Spd</th><th class="num">End</th><th class="num">Stl</th>
  <th class="num">TIQ</th><th class="num">Cou</th><th class="num">Loy</th><th class="num">InjP</th>
  <th class="num">Wage</th><th class="num">Ctr</th><th>Status</th><th class="num">Season</th><th></th>`;

function renderRoster(pt) {
  const byRole = rosterByRole(pt);
  let rows = '';
  for (const rk of ROLE_ORDER) {
    const fit = byRole[rk].filter(p => p.status === 'fit').length;
    const need = ROLES[rk].count;
    rows += `<tr class="rolehead"><td colspan="16">${ROLES[rk].name}s — need ${need} to field, ${fit} fit ${fit < need ? '<span class="danger">⚠ SHORT</span>' : ''} <span class="dim" style="text-transform:none;letter-spacing:0">· ${esc(ROLES[rk].desc)}</span></td></tr>`;
    rows += byRole[rk].map(p =>
      playerRow(p, `<button class="btn mini warn" data-action="release" data-id="${p.id}">Release</button>`)).join('');
  }
  return `<div class="panel tablewrap"><table><tr>${STAT_HEADER}</tr>${rows}</table>
    <p class="small dim" style="margin-top:8px">Releasing a player costs a contract payoff (2 weeks wages × contract years). Stats: 1–20. InjP = injury-proneness (lower is better).</p></div>`;
}

function renderMarket(pt) {
  const roleFilter = renderMarket._filter || 'ALL';
  const pool = G.freeAgents
    .filter(p => roleFilter === 'ALL' || p.role === roleFilter)
    .slice().sort((a, b) => overallRating(b) - overallRating(a));
  return `<div class="panel">
    <label class="field"><span>Filter by role</span>
      <select data-action="market-filter">
        <option value="ALL">All roles</option>
        ${ROLE_ORDER.map(rk => `<option value="${rk}" ${roleFilter === rk ? 'selected' : ''}>${ROLES[rk].name}</option>`).join('')}
      </select></label>
    <div class="tablewrap"><table>
      <tr><th>Role</th>${STAT_HEADER}</tr>
      ${pool.map(p => playerRow(p,
        `<button class="btn mini" data-action="sign" data-id="${p.id}">Sign ${fmtMoney(p.wage * 4)}</button>`,
        `<td>${ROLES[p.role].name}</td>`)).join('')}
    </table></div>
    <p class="small dim" style="margin-top:8px">Signing costs a bonus of 4 weeks wages up front, then the weekly wage. Squad limit per role: quota + 2.</p>
  </div>`;
}

// ---------- tactics ----------
function renderTactics() {
  const pt = playerTeam(G);
  const t = pt.tactics;
  const card = (group, val, title, desc) => `
    <div class="optcard ${String(t[group]) === String(val) ? 'sel' : ''}" data-action="tactic" data-group="${group}" data-id="${val}">
      <div class="t">${title}</div><div class="d">${desc}</div>
    </div>`;
  return `
    <div class="panel">
      <h2>Aggression</h2>
      <div class="optgrid">
        ${card('aggression', 1, 'Cautious', 'Fewer engagements, fewer casualties. Cedes initiative.')}
        ${card('aggression', 2, 'Balanced', 'Engage when the odds favour you.')}
        ${card('aggression', 3, 'Aggressive', 'Force contact constantly. High risk, high tempo, more capture chances.')}
      </div>
    </div>
    <div class="panel">
      <h2>Doctrine</h2>
      <div class="optgrid">
        ${card('doctrine', 'territory', 'Territory March', 'The Controller claims ground faster. Win by holding >80% of the field.')}
        ${card('doctrine', 'elimination', 'Elimination', '+15% combat power. Hunt their fighters until none stand.')}
        ${card('doctrine', 'defensive', 'Fortress', '+20% defense. Absorb their push and win the long game.')}
      </div>
    </div>
    <div class="panel">
      <h2>Controller Positioning</h2>
      <div class="optgrid">
        ${card('controllerRisk', 'safe', 'Rearguard', 'Flag stays at the back of the formation, as doctrine demands. Slow claims, hard to capture.')}
        ${card('controllerRisk', 'forward', 'Push the Flag', 'Controller shadows the line: +40% claim rate but far easier to capture — losing the flag hands over ALL your territory.')}
      </div>
    </div>
    <div class="panel">
      <h2>Hawk Orders</h2>
      <div class="optgrid">
        ${card('hawkOrders', 'overwatch', 'Overwatch', 'Hawks screen the Controller, halving enemy capture chances. Fewer shots taken.')}
        ${card('hawkOrders', 'hunt', 'Hunt', 'Hawks stalk enemy fighters — nearly double the shot rate, but the flag stands less protected.')}
      </div>
    </div>`;
}

// ---------- armory ----------
function renderArmory() {
  const pt = playerTeam(G);
  const lt = leagueType(G);
  const line = w => {
    const owned = pt.armory.includes(w.id);
    const illegal = w.lethal && !lt.lethalAllowed;
    const needsLic = w.licensed && !pt.probeLicense;
    let action;
    if (owned) action = `<button class="btn mini warn" data-action="sell-weapon" data-id="${w.id}">Sell ${fmtMoney(w.cost * 0.5)}</button>`;
    else if (illegal) action = `<span class="tag lethal">illegal in non-BSP</span>`;
    else if (needsLic) action = `<span class="tag licensed">license required</span>`;
    else action = `<button class="btn mini" data-action="buy-weapon" data-id="${w.id}">Buy ${fmtMoney(w.cost)}</button>`;
    return `<div class="wline">
      <span class="nm">${esc(w.name)}${owned ? '<span class="tag owned">owned</span>' : ''}<span class="tag ${w.lethal ? 'lethal' : 'nonlethal'}">${w.lethal ? 'lethal' : 'non-lethal'}</span></span>
      <span class="meta">${esc(w.desc)} — for ${w.group === 'ALL' ? 'whole squad' : ROLES[w.group].name + 's'}${w.power ? `, power +${w.power}` : ''}${w.intel ? `, intel +${w.intel}` : ''}${w.protect ? `, protection +${w.protect}` : ''}${w.guard ? `, flag guard +${w.guard}` : ''}</span>
      ${action}
    </div>`;
  };
  return `
    <div class="cols">
      <div class="panel">
        <h2>Legal Pool — ${esc(lt.name)}</h2>
        ${WEAPON_POOL.map(line).join('')}
        <div class="wline">
          <span class="nm">Oversight Board Probe License</span>
          <span class="meta">Permanent license to field Probes. ${pt.probeLicense ? 'HELD.' : ''}</span>
          ${pt.probeLicense ? '<span class="tag owned">held</span>' : `<button class="btn mini" data-action="buy-license">Buy ${fmtMoney(PROBE_LICENSE_COST)}</button>`}
        </div>
      </div>
      <div class="panel">
        <h2>Permanently Banned</h2>
        <p class="small dim" style="margin-bottom:8px">No organizer may legalise these, in any league:</p>
        <ul class="banned">${BANNED_ITEMS.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        <p class="small dim" style="margin-top:10px">Owned equipment applies to every match. Lethal gear raises kill probability — kills only occur in BSP play. Non-lethal gear still adds combat power for incapacitations.</p>
      </div>
    </div>`;
}

// ---------- league ----------
function standingsTable(table, lt) {
  return `<div class="tablewrap"><table>
    <tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Terr ±</th><th class="num">Pts</th><th class="num">Season prize</th></tr>
    ${table.map((t, i) => `<tr class="${t.isPlayer ? 'me' : ''}">
      <td class="pos">${i + 1}</td><td>${esc(t.name)}</td>
      <td class="num">${t.played}</td><td class="num">${t.wins}</td><td class="num">${t.draws}</td><td class="num">${t.losses}</td>
      <td class="num">${Math.round(t.terrFor - t.terrAgainst)}</td><td class="num"><b>${t.points}</b></td>
      <td class="num dim">${fmtMoney(lt.seasonPrizes[i] || 0)}</td>
    </tr>`).join('')}
  </table></div>`;
}

function renderLeague() {
  const lt = leagueType(G);
  const pt = playerTeam(G);
  const rounds = G.fixtures.map((round, i) => {
    const played = round.some(f => f.result);
    const current = i === G.week - 1 && !G.seasonOver;
    if (!played && !current && i > G.week - 1 && i > G.week + 1) return '';
    return `<div class="panel fixgrid">
      <h3>Matchday ${i + 1} ${current ? '· NEXT' : ''}</h3>
      ${round.map(f => {
        const h = teamById(G, f.home), a = teamById(G, f.away);
        const mine = h === pt || a === pt;
        if (f.result) {
          const r = f.result;
          const wName = r.winnerId ? (r.winnerId === r.homeId ? r.homeName : r.awayName) : null;
          return `<p ${mine ? 'style="font-weight:700"' : ''}>
            <span class="${r.winnerId === r.homeId ? 'win' : ''}">${esc(r.homeName)}</span> ${r.terr[0]}% – ${r.terr[1]}% <span class="${r.winnerId === r.awayId ? 'win' : ''}">${esc(r.awayName)}</span>
            <span class="dim small"> — ${wName ? wName + ' win by ' + r.condition : 'draw'} on ${esc(r.map)}${r.deaths[0].length + r.deaths[1].length ? ' · ' + (r.deaths[0].length + r.deaths[1].length) + ' dead' : ''}</span></p>`;
        }
        return `<p ${mine ? 'style="font-weight:700"' : ''}>${esc(h.name)} vs ${esc(a.name)} <span class="dim small">on ${esc(f.map.name)} (${esc(f.map.type)})</span></p>`;
      }).join('')}
    </div>`;
  }).join('');
  return `<div class="panel"><h2>Standings — ${esc(lt.name)}</h2>${standingsTable(standings(G), lt)}</div>${rounds}`;
}

// ---------- finances ----------
function renderFinances() {
  const pt = playerTeam(G);
  const lt = leagueType(G);
  const wages = weeklyWageBill(pt);
  return `
    <div class="cols">
      <div class="panel">
        <h2>Ledger</h2>
        <table>
          <tr><td>Balance</td><td class="num ${pt.balance < 0 ? 'danger' : 'good'}"><b>${fmtMoney(pt.balance)}</b></td></tr>
          <tr><td>Weekly wage bill</td><td class="num">−${fmtMoney(wages)}</td></tr>
          <tr><td>Gate revenue (per match)</td><td class="num">+~${fmtMoney(lt.gateBase)}</td></tr>
          <tr><td>Win prize</td><td class="num">+${fmtMoney(lt.winPrize)}</td></tr>
          <tr><td>Draw prize</td><td class="num">+${fmtMoney(lt.drawPrize)}</td></tr>
          <tr><td>Terrain / logistics fee (per match)</td><td class="num">−${fmtMoney(TERRAIN_FEE)}</td></tr>
          <tr><td>Oversight fee (per match)</td><td class="num">−${fmtMoney(lt.oversightFee)}</td></tr>
          ${lt.lethalAllowed ? `<tr><td>Death compensation (per fatality)</td><td class="num">−${fmtMoney(DEATH_COMPENSATION)}</td></tr>` : ''}
        </table>
        ${pt.balance < 0 ? '<p class="danger" style="margin-top:8px">⚠ You are in the red. Sell equipment or release players before the creditors call in the Oversight Board.</p>' : ''}
      </div>
      <div class="panel">
        <h2>Season Prize Fund</h2>
        <table>
          ${lt.seasonPrizes.map((p, i) => `<tr><td>${ordinal(i + 1)} place</td><td class="num">${fmtMoney(p)}</td></tr>`).join('')}
        </table>
      </div>
    </div>`;
}

// ---------- rules / codex ----------
function renderRules() {
  return `
    <div class="cols">
      <div class="panel">
        <h2>The Fifteen</h2>
        <table>${ROLE_ORDER.map(rk => `<tr><td style="white-space:nowrap"><b>${ROLES[rk].count}× ${ROLES[rk].name}</b></td><td style="white-space:normal">${esc(ROLES[rk].desc)}</td></tr>`).join('')}</table>
        <h2 style="margin-top:16px">Victory Conditions</h2>
        <ul style="padding-left:18px">
          <li><b>Elimination</b> — every enemy fighter dead (BSP only).</li>
          <li><b>Incapacitation</b> — every enemy fighter downed.</li>
          <li><b>Surrender</b> — the enemy Commander keys the concession code.</li>
          <li><b>Territory</b> — control more than 80% of the field.</li>
        </ul>
        <h2 style="margin-top:16px">The Flag</h2>
        <p style="white-space:normal">Claimed land follows the Controller in a 500m radius as they move. The Controller can never be killed — only captured. A captured flag transfers <b>all</b> claimed territory to the captors at a stroke.</p>
      </div>
      <div class="panel">
        <h2>Leagues</h2>
        <p><b>${esc(LEAGUE_TYPES.NONBSP.name)}</b> — ${esc(LEAGUE_TYPES.NONBSP.desc)}</p>
        <p style="margin-top:6px"><b>${esc(LEAGUE_TYPES.BSP.name)}</b> — ${esc(LEAGUE_TYPES.BSP.desc)}</p>
        <h2 style="margin-top:16px">Alliances</h2>
        <p style="white-space:normal">Alliances between teams are legal mid-match only — never pre-planned. They may be broken at any time, may not exceed one third of competing teams, and a winning alliance splits the prize evenly. <span class="dim">(Alliance play arrives with multi-team matches in a future rules revision — the current calendar is head-to-head.)</span></p>
        <h2 style="margin-top:16px">Armory Law</h2>
        <p style="white-space:normal">Each organizer selects an allowed-weapons list from the legal pool. The permanently banned list (see Armory) can never be legalised. Probes require an Oversight Board license.</p>
      </div>
    </div>`;
}

// ---------- match playback ----------
function startMatchPlayback(result) {
  const pt = playerTeam(G);
  const meIdx = result.teams[0].id === pt.id ? 0 : 1;
  MATCH_PLAYBACK = { result, idx: 0, speed: 700, done: false, meIdx };
  const [ta, tb] = result.teams;
  const overlay = document.createElement('div');
  overlay.className = 'match-overlay';
  overlay.id = 'match-overlay';
  overlay.innerHTML = `
    <div class="match-box">
      <div class="match-head">
        <div class="dim small">${esc(result.map.name)} — ${esc(result.map.desc)}</div>
        <div class="vs"><span class="tA">${esc(ta.name)}</span> <span class="dim">vs</span> <span class="tB">${esc(tb.name)}</span></div>
      </div>
      <div class="terrbar"><div class="a" id="tb-a" style="width:10%">10%</div><div class="n"></div><div class="b" id="tb-b" style="width:10%">10%</div></div>
      <div class="terrmap" id="terrmap">${'<div class="c"></div>'.repeat(200)}</div>
      <div class="mlog" id="mlog"></div>
      <div class="match-controls">
        <button class="btn" data-action="pb-speed" data-id="700">▶ Normal</button>
        <button class="btn" data-action="pb-speed" data-id="150">▶▶ Fast</button>
        <button class="btn" data-action="pb-skip">Skip to Result</button>
      </div>
      <div id="match-result-slot"></div>
    </div>`;
  document.body.appendChild(overlay);
  schedulePlaybackTick();
}

function schedulePlaybackTick() {
  const pb = MATCH_PLAYBACK;
  if (!pb || pb.done) return;
  clearTimeout(pb.timer);
  pb.timer = setTimeout(() => { playbackStep(); schedulePlaybackTick(); }, pb.speed);
}

function playbackStep() {
  const pb = MATCH_PLAYBACK;
  if (!pb) return;
  if (pb.idx >= pb.result.log.length) { finishPlayback(); return; }
  revealLogEntry(pb.result.log[pb.idx++]);
}

function revealLogEntry(e) {
  const logEl = document.getElementById('mlog');
  if (!logEl) return;
  const p = document.createElement('p');
  p.className = 'e-' + e.type;
  p.innerHTML = `<span class="tk">[${String(e.t).padStart(2, '0')}']</span> ${esc(e.text)}`;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
  updateTerritoryViz(e.terr[0], e.terr[1]);
}

function updateTerritoryViz(a, b) {
  const ea = document.getElementById('tb-a'), eb = document.getElementById('tb-b');
  if (ea) { ea.style.width = a + '%'; ea.textContent = Math.round(a) + '%'; }
  if (eb) { eb.style.width = b + '%'; eb.textContent = Math.round(b) + '%'; }
  const map = document.getElementById('terrmap');
  if (map) {
    // 40 cols × 5 rows; grid children are placed row-major, so derive each
    // cell's column-major rank to fill team A from the left edge, B from the right
    const cells = map.children;
    const na = Math.round(a * 2), nb = Math.round(b * 2);
    for (let i = 0; i < 200; i++) {
      const col = i % 40, row = Math.floor(i / 40);
      const rankFromLeft = col * 5 + row;
      const rankFromRight = (39 - col) * 5 + row;
      cells[i].className = 'c' + (rankFromLeft < na ? ' a' : rankFromRight < nb ? ' b' : '');
    }
  }
}

function finishPlayback() {
  const pb = MATCH_PLAYBACK;
  if (!pb || pb.done) return;
  pb.done = true;
  clearTimeout(pb.timer);
  const r = pb.result;
  const pt = playerTeam(G);
  const me = pb.meIdx, them = 1 - me;
  const won = r.winnerId === pt.id;
  const drew = r.winnerId === null;
  const headline = drew ? 'A DRAW — honours even.' : won ? `VICTORY by ${r.condition}!` : `DEFEAT — ${esc(r.teams[them].name)} win by ${r.condition}.`;
  const cas = r.casualties[me].map(c => `${esc(c.player.name)} (out ${c.weeks}w)`).join(', ') || 'none';
  const dead = r.deaths[me].map(p => esc(p.name)).join(', ');
  const slot = document.getElementById('match-result-slot');
  if (slot) slot.innerHTML = `
    <div class="match-result">
      <div class="headline">${headline}</div>
      <p>Final territory: ${r.terr[0]}% – ${r.terr[1]}% · You: ${r.kills[me]} kills, ${r.incaps[me]} incapacitations${r.ctCaptured[them] ? ' · enemy flag CAPTURED' : ''}${r.ctCaptured[me] ? ' · <span class="danger">your flag was captured</span>' : ''}</p>
      <p class="small">Your casualties: ${cas}${dead ? ` · <span class="danger">KILLED: ${dead}</span>` : ''}</p>
      <button class="btn primary" style="margin-top:10px" data-action="pb-close">Continue</button>
    </div>`;
}

function skipPlayback() {
  const pb = MATCH_PLAYBACK;
  if (!pb) return;
  while (pb.idx < pb.result.log.length) revealLogEntry(pb.result.log[pb.idx++]);
  finishPlayback();
}

function closePlayback() {
  const pb = MATCH_PLAYBACK;
  if (pb) clearTimeout(pb.timer);
  MATCH_PLAYBACK = null;
  const el = document.getElementById('match-overlay');
  if (el) el.remove();
  saveGame();
  render();
}

// ---------- event wiring ----------
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'nav': SCREEN = id; render(); break;
    case 'continue': {
      const res = playMatchday(G);
      saveGame();
      if (res) startMatchPlayback(res);
      else render();
      break;
    }
    case 'next-season': startNextSeason(G); saveGame(); SCREEN = 'home'; render(); break;
    case 'squad-tab': SQUAD_TAB = id; render(); break;
    case 'sign': { const r = signPlayer(G, id); toast(r.msg); if (r.ok) saveGame(); render(); break; }
    case 'release': { const r = releasePlayer(G, id); toast(r.msg); if (r.ok) saveGame(); render(); break; }
    case 'tactic': {
      const g = el.dataset.group;
      playerTeam(G).tactics[g] = g === 'aggression' ? parseInt(id, 10) : id;
      saveGame(); render(); break;
    }
    case 'buy-weapon': { const r = buyWeapon(G, id); toast(r.msg); if (r.ok) saveGame(); render(); break; }
    case 'sell-weapon': { const r = sellWeapon(G, id); toast(r.msg); if (r.ok) saveGame(); render(); break; }
    case 'buy-license': { const r = buyProbeLicense(G); toast(r.msg); if (r.ok) saveGame(); render(); break; }
    case 'ng-league': {
      NG_MANAGER = document.getElementById('ng-manager').value;
      NG_TEAM = document.getElementById('ng-team').value;
      NG_LEAGUE = id; render(); break;
    }
    case 'ng-start': {
      const mgr = document.getElementById('ng-manager').value.trim() || 'The Manager';
      const team = document.getElementById('ng-team').value.trim() || 'Dread Pioneers';
      G = newGame(mgr, team, NG_LEAGUE);
      saveGame(); SCREEN = 'home'; render(); break;
    }
    case 'new-game-confirm':
      if (confirm('Abandon the current save and start a new game?')) {
        localStorage.removeItem(SAVE_KEY);
        G = null; render();
      }
      break;
    case 'pb-speed': { if (MATCH_PLAYBACK) { MATCH_PLAYBACK.speed = parseInt(id, 10); schedulePlaybackTick(); } break; }
    case 'pb-skip': skipPlayback(); break;
    case 'pb-close': closePlayback(); break;
  }
});

document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'market-filter') { renderMarket._filter = el.value; render(); }
});
