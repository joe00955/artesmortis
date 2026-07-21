/* Artes Mortis Manager — canvas planning board & real-time battle view.
   The camera always draws the player's team attacking left→right, so planning
   and the live match share one orientation regardless of which side they field. */
'use strict';

const BV = { open: false };

const TEAM_COL = { me: '#4f9dff', foe: '#e0574a' };
const ROLE_GLYPH = { CMD: 'star', TS: 'hex', RR: 'square', CM: 'circle', HK: 'triangle', CT: 'diamond' };

// ---------- open / lifecycle ----------
function openBattle(mctx) {
  const preset = playerTeam(G).preset || 'balanced';
  const field = genField(mctx.map);
  const plan = fitPlanToField(buildPlan(preset), field, mctx.playerSide);
  plan._fitted = true;
  BV.open = true;
  BV.phase = 'plan';
  BV.mctx = mctx;
  BV.field = field;
  BV.playerSide = mctx.playerSide;
  BV.plan = plan;
  BV.selGroup = 'CM';
  BV.routeMode = false;
  BV.dragging = null;
  BV.orderGroup = null;

  const ov = document.createElement('div');
  ov.className = 'battle-overlay';
  ov.id = 'battle-overlay';
  document.body.appendChild(ov);
  renderPlanning();
}

function closeBattle() {
  BV.open = false;
  stopWatchdog();
  if (BV._raf) cancelAnimationFrame(BV._raf);
  BV._raf = null;
  const ov = document.getElementById('battle-overlay');
  if (ov) ov.remove();
}

// ---------- camera ----------
function camX(x) { return BV.playerSide === 1 ? FIELD_W - x : x; }
function invX(sx) { return BV.playerSide === 1 ? FIELD_W - sx : sx; }

function canvasToField(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  const sx = (ev.clientX - r.left) / r.width * FIELD_W;
  const sy = (ev.clientY - r.top) / r.height * FIELD_H;
  return { x: clamp(invX(sx), 0, FIELD_W), y: clamp(sy, 0, FIELD_H), sx, sy };
}

// ---------- terrain / shared drawing ----------
function drawField(ctx, showTerritory, territory) {
  const f = BV.field;
  ctx.fillStyle = '#12161d';
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  // territory grid
  if (showTerritory) {
    for (let i = 0; i < territory.length; i++) {
      const owner = territory[i];
      if (owner === -1) continue;
      const c = cellCenter(i);
      ctx.fillStyle = owner === BV.playerSide ? 'rgba(79,157,255,0.20)' : 'rgba(224,87,74,0.20)';
      const x = camX(c.x) - TERR_CELL_W / 2;
      ctx.fillRect(x, c.y - TERR_CELL_H / 2, TERR_CELL_W, TERR_CELL_H);
    }
  }
  // faint grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= FIELD_W; gx += TERR_CELL_W * 2) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, FIELD_H); ctx.stroke(); }

  // terrain features
  for (const h of f.highs) { fillCircle(ctx, camX(h.x), h.y, h.r, 'rgba(120,110,70,0.20)'); ringCircle(ctx, camX(h.x), h.y, h.r, 'rgba(150,140,90,0.35)'); }
  for (const c of f.covers) fillCircle(ctx, camX(c.x), c.y, c.r, 'rgba(70,120,80,0.18)');
  for (const b of f.blocks) { fillCircle(ctx, camX(b.x), b.y, b.r, 'rgba(40,46,58,0.95)'); ringCircle(ctx, camX(b.x), b.y, b.r, 'rgba(90,100,120,0.6)'); }

  // bases
  drawBase(ctx, BV.playerSide === 0 ? f.baseA : f.baseB, TEAM_COL.me, 'YOUR BASE');
  drawBase(ctx, BV.playerSide === 0 ? f.baseB : f.baseA, TEAM_COL.foe, 'ENEMY BASE');
}
function drawBase(ctx, base, col, label) {
  const x = camX(base.x), y = base.y;
  ringCircle(ctx, x, y, 26, col);
  fillCircle(ctx, x, y, 6, col);
  ctx.fillStyle = col; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 32);
}
function fillCircle(ctx, x, y, r, col) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col; ctx.fill(); }
function ringCircle(ctx, x, y, r, col) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }

// ================= PLANNING =================
function renderPlanning() {
  const m = BV.mctx;
  const ov = document.getElementById('battle-overlay');
  ov.innerHTML = `
    <div class="battle-head">
      <div class="dim small">${esc(m.map.name)} — ${esc(m.map.desc)}</div>
      <div class="vs"><span class="tMe">${esc(playerTeam(G).name)}</span> <span class="dim">vs</span> <span class="tFoe">${esc(otherTeam(m).name)}</span></div>
      <div class="small dim">Terrain: ${terrainEffects(m.map)} · You attack left → right</div>
    </div>
    <div class="battle-body">
      <div class="battle-stage">
        <canvas id="plan-canvas" width="${FIELD_W}" height="${FIELD_H}"></canvas>
        <div class="stage-hint" id="plan-hint"></div>
      </div>
      <div class="battle-side">
        <h3>Formation Preset</h3>
        <div class="preset-list">
          ${PRESET_ORDER.map(k => `<button class="btn mini preset ${BV.plan.preset === k ? 'sel' : ''}" data-bv="preset" data-id="${k}">${esc(PRESETS[k].name)}</button>`).join('')}
        </div>
        <p class="small dim" id="preset-desc">${esc(PRESETS[BV.plan.preset].desc)}</p>
        <h3 style="margin-top:14px">Role Group</h3>
        <div class="group-list">
          ${ROLE_ORDER.map(rk => `<button class="btn mini grp ${BV.selGroup === rk ? 'sel' : ''}" data-bv="selgroup" data-id="${rk}">${ROLES[rk].name}s</button>`).join('')}
        </div>
        <div id="group-panel"></div>
        <div style="margin-top:16px">
          <button class="btn primary" data-bv="start">Deploy &amp; Begin Battle</button>
          <button class="btn" style="margin-top:8px" data-bv="cancel">Back</button>
        </div>
        <p class="small dim" style="margin-top:10px">Drag a role group's marker to reposition it in your half. Pick a group, then <b>Draw Route</b> and click the field to lay advance waypoints. Set each group's stance below.</p>
      </div>
    </div>`;
  drawPlanCanvas();
  renderGroupPanel();
  wirePlanCanvas();
}

function renderGroupPanel() {
  const rk = BV.selGroup;
  const g = BV.plan.groups[rk];
  const stances = ROLE_STANCES[rk];
  const panel = document.getElementById('group-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="small" style="margin:8px 0 4px"><b>${ROLES[rk].name}s</b> — ${esc(ROLES[rk].desc)}</div>
    <label class="field"><span>Stance</span>
      <select data-bv="stance">
        ${stances.map(s => `<option value="${s}" ${g.stance === s ? 'selected' : ''}>${STANCES[s].label} — ${esc(STANCES[s].desc)}</option>`).join('')}
      </select></label>
    ${rk === 'CMD' ? '<p class="small dim">The Commander directs from base and cannot be moved onto the field.</p>' : `
      <div class="route-btns">
        <button class="btn mini ${BV.routeMode ? 'sel' : ''}" data-bv="routemode">${BV.routeMode ? '● Drawing Route…' : 'Draw Route'}</button>
        <button class="btn mini" data-bv="clearroute">Clear Route</button>
        <span class="small dim">${g.route.length} waypoint${g.route.length === 1 ? '' : 's'}</span>
      </div>`}`;
}

function drawPlanCanvas() {
  const canvas = document.getElementById('plan-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  drawField(ctx, false, null);

  // shade the player's deployment half
  const halfW = FIELD_W * 0.44;
  ctx.fillStyle = 'rgba(79,157,255,0.05)';
  ctx.fillRect(0, 0, halfW, FIELD_H);
  ctx.strokeStyle = 'rgba(79,157,255,0.25)'; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, FIELD_H); ctx.stroke(); ctx.setLineDash([]);

  // routes + anchors
  for (const rk of ROLE_ORDER) {
    const g = BV.plan.groups[rk];
    if (!g) continue;
    const ax = camX(g.anchor.x), ay = g.anchor.y;
    const sel = rk === BV.selGroup;
    if (g.route && g.route.length) {
      ctx.strokeStyle = sel ? '#e6c675' : 'rgba(230,198,117,0.35)';
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (const w of g.route) ctx.lineTo(camX(w.x), w.y);
      ctx.stroke();
      for (const w of g.route) fillCircle(ctx, camX(w.x), w.y, 3, sel ? '#e6c675' : 'rgba(230,198,117,0.5)');
    }
  }
  for (const rk of ROLE_ORDER) {
    const g = BV.plan.groups[rk];
    if (!g) continue;
    drawToken(ctx, camX(g.anchor.x), g.anchor.y, rk, rk === BV.selGroup);
  }
}
function drawToken(ctx, x, y, rk, sel) {
  const n = countInGroup(rk);
  ctx.beginPath(); ctx.arc(x, y, 15, 0, 7);
  ctx.fillStyle = sel ? 'rgba(79,157,255,0.35)' : 'rgba(30,40,55,0.9)';
  ctx.fill();
  ctx.strokeStyle = sel ? '#e6c675' : TEAM_COL.me; ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();
  ctx.fillStyle = '#dfe6f2'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(rk, x, y);
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#9fb0c8';
  ctx.fillText('×' + n, x, y + 20);
  ctx.textBaseline = 'alphabetic';
}
function countInGroup(rk) {
  const { fielded } = fieldSquad(playerTeam(G));
  return fielded.filter(p => p.role === rk).length;
}

function wirePlanCanvas() {
  const canvas = document.getElementById('plan-canvas');
  if (!canvas) return;
  const hint = document.getElementById('plan-hint');
  const inHalf = ex => BV.playerSide === 0 ? ex <= FIELD_W * 0.44 : ex >= FIELD_W * 0.56;

  canvas.onmousedown = ev => {
    const p = canvasToField(canvas, ev);
    if (BV.routeMode && BV.selGroup !== 'CMD') {
      BV.plan.groups[BV.selGroup].route.push({ x: p.x, y: p.y });
      drawPlanCanvas(); renderGroupPanel();
      return;
    }
    // pick up a token
    for (const rk of ROLE_ORDER) {
      const g = BV.plan.groups[rk];
      if (Math.hypot(camX(g.anchor.x) - p.sx, g.anchor.y - p.sy) < 17) {
        BV.selGroup = rk; BV.dragging = rk;
        document.querySelectorAll('[data-bv="selgroup"]').forEach(b => b.classList.toggle('sel', b.dataset.id === rk));
        renderGroupPanel(); drawPlanCanvas();
        return;
      }
    }
  };
  canvas.onmousemove = ev => {
    const p = canvasToField(canvas, ev);
    if (hint) hint.textContent = BV.routeMode ? 'Click to add a waypoint for ' + ROLES[BV.selGroup].name + 's' : '';
    if (!BV.dragging) return;
    const rk = BV.dragging;
    if (rk === 'CMD') return;
    let ex = p.x;
    if (BV.playerSide === 0) ex = clamp(ex, 20, FIELD_W * 0.44);
    else ex = clamp(ex, FIELD_W * 0.56, FIELD_W - 20);
    BV.plan.groups[rk].anchor = { x: ex, y: clamp(p.y, 20, FIELD_H - 20) };
    drawPlanCanvas();
  };
  canvas.onmouseup = () => { BV.dragging = null; };
  canvas.onmouseleave = () => { BV.dragging = null; };
}

function otherTeam(m) { return m.playerSide === 0 ? m.away : m.home; }

// ================= LIVE BATTLE =================
function startLive() {
  const m = BV.mctx;
  const plans = [null, null];
  plans[BV.playerSide] = BV.plan;
  const battle = createBattle(m.home, m.away, leagueType(G), m.map, plans);
  BV.battle = battle;
  BV.phase = 'live';
  BV.paused = false;
  BV.speed = 1;
  BV.orderGroup = null;
  BV.last = performance.now();
  BV.lastDraw = BV.last;
  BV.fx = []; BV.floats = []; BV.feed = []; BV.shake = 0;

  AudioSFX.init(); AudioSFX.resume(); AudioSFX.klaxon();  // audio unlocks on this user gesture

  const ov = document.getElementById('battle-overlay');
  ov.innerHTML = `
    <div class="battle-head">
      <div class="live-terr">
        <div class="tlabel tMe">${esc(playerTeam(G).name)}</div>
        <div class="terrbar2"><div class="a" id="lt-a"></div><div class="b" id="lt-b"></div></div>
        <div class="tlabel tFoe">${esc(otherTeam(m).name)}</div>
      </div>
      <div class="live-status" id="live-status"></div>
    </div>
    <div class="battle-body">
      <div class="battle-stage">
        <canvas id="live-canvas" width="${FIELD_W}" height="${FIELD_H}"></canvas>
        <div class="order-hint" id="order-hint"></div>
      </div>
      <div class="battle-side">
        <div class="live-controls">
          <button class="btn" data-bv="pause" id="btn-pause">❚❚ Pause</button>
          <button class="btn mini ${BV.speed === 1 ? 'sel' : ''}" data-bv="speed" data-id="1">1×</button>
          <button class="btn mini ${BV.speed === 2 ? 'sel' : ''}" data-bv="speed" data-id="2">2×</button>
          <button class="btn mini ${BV.speed === 4 ? 'sel' : ''}" data-bv="speed" data-id="4">4×</button>
          <button class="btn mini" data-bv="skip" id="btn-skip">Skip ▸▸</button>
          <button class="btn mini" data-bv="mute" id="btn-mute">${AudioSFX.muted ? '🔇' : '🔊'}</button>
        </div>
        <div id="order-panel" class="order-panel"></div>
        <h3 style="margin-top:12px">Battle Log</h3>
        <div class="live-log" id="live-log"></div>
      </div>
    </div>`;
  wireLiveCanvas();
  renderOrderPanel();
  BV.logShown = 0;
  BV.beat = performance.now();
  startWatchdog();
  installVisibilityHandler();
  loop();
}

// The render loop is built to be un-killable: it reschedules itself even if a
// single frame throws, and a watchdog restarts it if it ever stops beating
// (e.g. the browser paused requestAnimationFrame while the tab was backgrounded,
// or an unexpected error killed a frame). This prevents the "everything just
// stops" freeze — the simulation always keeps advancing.
function loop() {
  BV._raf = null;
  if (!BV.open || BV.phase !== 'live') return;
  BV.beat = performance.now();
  try {
    const b = BV.battle;
    const now = performance.now();
    let dt = Math.min((now - BV.last) / 1000, 0.05);
    BV.last = now;
    if (!BV.paused && !b.over) {
      const t0 = b.time;
      let t = dt * BV.speed;
      let guard = 0;
      while (t > 0 && guard++ < 64) { b.step(Math.min(t, DT_MAX)); t -= DT_MAX; if (b.over) break; }
      if (b.time > t0) ingestEvents(b);   // turn this step's events into effects/sound
    }
    drawLive();
    updateLiveHUD();
    if (b.over) { finishLive(); return; }
  } catch (err) {
    console.error('Artes Mortis: battle frame error (recovering, sim continues):', err);
  }
  BV._raf = requestAnimationFrame(loop);
}

function startWatchdog() {
  stopWatchdog();
  BV.watchdog = setInterval(() => {
    if (!BV.open || BV.phase !== 'live' || BV.paused) return;
    if (performance.now() - (BV.beat || 0) > 1200) {
      // the loop stopped beating — kick it back to life
      BV.last = performance.now();
      if (BV._raf) cancelAnimationFrame(BV._raf);
      BV._raf = requestAnimationFrame(loop);
    }
  }, 1000);
}
function stopWatchdog() { if (BV.watchdog) { clearInterval(BV.watchdog); BV.watchdog = null; } }

function installVisibilityHandler() {
  if (BV._visInstalled) return;
  BV._visInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && BV.open && BV.phase === 'live') {
      BV.last = performance.now();               // avoid a huge catch-up step
      if (!BV._raf) BV._raf = requestAnimationFrame(loop);
    }
  });
}

function makeOff(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function drawLive() {
  const b = BV.battle;
  const canvas = document.getElementById('live-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const now = performance.now();
  const fdt = Math.min((now - (BV.lastDraw || now)) / 1000, 0.05);
  BV.lastDraw = now;
  ageEffects(fdt);

  ctx.save();
  if (BV.shake > 0.4) ctx.translate((Math.random() - 0.5) * BV.shake, (Math.random() - 0.5) * BV.shake);

  drawField(ctx, false, null);       // terrain + bases (blocky territory handled by the heatmap)
  drawHeatmap(ctx, b);               // smooth territory influence
  drawClaimRadii(ctx, b);
  drawDrones(ctx, b);
  drawEffects(ctx, 'under');         // tracers + muzzle flashes beneath the units
  for (const s of b.sides) for (const u of s.units) drawUnit(ctx, u, s.side === BV.playerSide);
  drawEffects(ctx, 'over');          // sparks + bursts on top
  drawFloating(ctx);
  drawFog(ctx, b);                   // dim ground the player has no eyes on
  if (BV.paused && BV.orderGroup) {
    for (const u of b.sides[BV.playerSide].units) {
      if (u.role === BV.orderGroup && u.state === 'active') ringCircle(ctx, camX(u.x), u.y, 13, '#e6c675');
    }
  }
  ctx.restore();

  drawVignette(ctx);
  drawKillFeed(ctx);
}

function drawHeatmap(ctx, b) {
  const oc = BV.heat || (BV.heat = makeOff(TERR_COLS, TERR_ROWS));
  const octx = oc.getContext('2d');
  const img = octx.createImageData(TERR_COLS, TERR_ROWS);
  for (let i = 0; i < TERR_CELLS; i++) {
    const o = b.territory[i], p = i * 4;
    if (o === BV.playerSide) { img.data[p] = 79; img.data[p + 1] = 157; img.data[p + 2] = 255; img.data[p + 3] = 96; }
    else if (o === 1 - BV.playerSide) { img.data[p] = 224; img.data[p + 1] = 87; img.data[p + 2] = 74; img.data[p + 3] = 96; }
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (BV.playerSide === 1) { ctx.translate(FIELD_W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(oc, 0, 0, TERR_COLS, TERR_ROWS, 0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

function drawClaimRadii(ctx, b) {
  for (const s of b.sides) {
    const ct = s.units.find(u => u.role === 'CT' && u.state === 'active');
    if (!ct) continue;
    const mine = s.side === BV.playerSide;
    const g = ctx.createRadialGradient(camX(ct.x), ct.y, CLAIM_RADIUS * 0.4, camX(ct.x), ct.y, CLAIM_RADIUS);
    g.addColorStop(0, mine ? 'rgba(79,157,255,0.14)' : 'rgba(224,87,74,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(camX(ct.x), ct.y, CLAIM_RADIUS, 0, 7); ctx.fill();
    ringCircle(ctx, camX(ct.x), ct.y, CLAIM_RADIUS, mine ? 'rgba(79,157,255,0.25)' : 'rgba(224,87,74,0.25)');
  }
}

function drawDrones(ctx, b) {
  for (const s of b.sides) for (const dr of s.drones) {
    ringCircle(ctx, camX(dr.x), dr.y, dr.range, 'rgba(255,255,255,0.045)');
    drawDrone(ctx, camX(dr.x), dr.y, s.side === BV.playerSide ? TEAM_COL.me : TEAM_COL.foe, dr.kind === 'strike');
  }
}

// ---------- transient effects ----------
function ageEffects(dt) {
  BV.shake = Math.max(0, (BV.shake || 0) - dt * 34);
  const age = arr => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].age += dt; if (arr[i].age >= arr[i].life) arr.splice(i, 1); } };
  age(BV.fx); age(BV.floats);
  for (let i = BV.feed.length - 1; i >= 0; i--) { BV.feed[i].age += dt; if (BV.feed[i].age >= BV.feed[i].life) BV.feed.splice(i, 1); }
}

function ingestEvents(b) {
  for (const e of b.events) {
    const mine = e.side === BV.playerSide;
    if (e.kind === 'shot') {
      BV.fx.push({ t: 'tracer', x1: camX(e.x1), y1: e.y1, x2: camX(e.x2), y2: e.y2, hawk: e.hawk, drone: e.drone, mine, age: 0, life: 0.13 });
      BV.fx.push({ t: 'flash', x: camX(e.x1), y: e.y1, age: 0, life: 0.08, hawk: e.hawk });
      if (e.drone) { /* silent */ } else if (e.hawk) AudioSFX.hawk(); else AudioSFX.gun();
    } else if (e.kind === 'hit') {
      BV.fx.push({ t: 'spark', x: camX(e.x), y: e.y, age: 0, life: 0.3 });
      if (e.dmg) BV.floats.push({ x: camX(e.x), y: e.y, text: '-' + e.dmg, color: '#ffd36b', age: 0, life: 0.8, vy: 26 });
      AudioSFX.hit();
    } else if (e.kind === 'down' || e.kind === 'kill') {
      const kill = e.kind === 'kill';
      BV.fx.push({ t: 'burst', x: camX(e.x), y: e.y, age: 0, life: 0.55, color: kill ? '#e0574a' : '#8fa3bd', r: kill ? 24 : 15 });
      BV.floats.push({ x: camX(e.x), y: e.y - 6, text: (kill ? '✖ ' : '') + e.name.split(' ').pop(), color: kill ? '#ff8a7a' : '#aab6c8', age: 0, life: 1.4, vy: 15 });
      BV.feed.unshift({ name: e.name, role: e.role, by: e.by, kill, mine, age: 0, life: 5.5 });
      if (BV.feed.length > 6) BV.feed.pop();
      BV.shake = Math.min(16, BV.shake + (kill ? 5 : 2));
      if (kill) AudioSFX.kill(); else AudioSFX.hit();
    } else if (e.kind === 'capture') {
      BV.fx.push({ t: 'burst', x: camX(e.x), y: e.y, age: 0, life: 0.85, color: '#ff7ab8', r: 44 });
      BV.floats.push({ x: camX(e.x), y: e.y - 10, text: 'FLAG TAKEN', color: '#ff7ab8', age: 0, life: 1.9, vy: 12 });
      BV.feed.unshift({ capture: true, by: e.by, foe: e.foe, mine, age: 0, life: 6.5 });
      BV.shake = Math.min(22, BV.shake + 12);
      AudioSFX.capture();
    }
  }
}

function drawEffects(ctx, layer) {
  for (const f of BV.fx) {
    const k = 1 - f.age / f.life;
    if (layer === 'under') {
      if (f.t === 'tracer') {
        ctx.strokeStyle = f.drone ? `rgba(124,207,214,${0.7 * k})` : f.hawk ? `rgba(180,215,255,${k})` : (f.mine ? `rgba(150,200,255,${0.85 * k})` : `rgba(255,150,120,${0.85 * k})`);
        ctx.lineWidth = f.hawk ? 2 : 1.3;
        if (f.drone) ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (f.t === 'flash') {
        fillCircle(ctx, f.x, f.y, (f.hawk ? 5 : 3.5) * (0.6 + k), `rgba(255,230,150,${k})`);
      }
    } else {
      if (f.t === 'spark') {
        fillCircle(ctx, f.x, f.y, 3 + (1 - k) * 4, `rgba(255,220,120,${k})`);
      } else if (f.t === 'burst') {
        ctx.strokeStyle = f.color.replace(')', `,${k})`).replace('rgb', 'rgba').replace('#', '');
        ctx.strokeStyle = hexA(f.color, k); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k) + 4, 0, 7); ctx.stroke();
        fillCircle(ctx, f.x, f.y, f.r * 0.35 * k + 2, hexA(f.color, k * 0.5));
      }
    }
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a)})`;
}

function drawFloating(ctx) {
  ctx.textAlign = 'center'; ctx.font = 'bold 12px sans-serif';
  for (const f of BV.floats) {
    const k = 1 - f.age / f.life;
    ctx.fillStyle = hexA(f.color, k);
    ctx.fillText(f.text, f.x, f.y - f.vy * f.age);
  }
  ctx.textAlign = 'left';
}

function drawFog(ctx, b) {
  const scale = 0.5, fw = Math.round(FIELD_W * scale), fh = Math.round(FIELD_H * scale);
  const oc = BV.fog || (BV.fog = makeOff(fw, fh));
  const octx = oc.getContext('2d');
  octx.clearRect(0, 0, fw, fh);
  octx.fillStyle = 'rgba(6,9,14,0.6)'; octx.fillRect(0, 0, fw, fh);
  octx.globalCompositeOperation = 'destination-out';
  const me = b.sides[BV.playerSide];
  const punch = (x, y, r) => {
    const sx = camX(x) * scale, sy = y * scale, sr = r * scale;
    const g = octx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.72, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = g; octx.beginPath(); octx.arc(sx, sy, sr, 0, 7); octx.fill();
  };
  punch(me.base.x, me.base.y, 150);
  for (const u of me.units) { if (u.state === 'active' && u.sight) punch(u.x, u.y, u.sight * 0.92); }
  for (const dr of me.drones) punch(dr.x, dr.y, dr.range);
  octx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(oc, 0, 0, fw, fh, 0, 0, FIELD_W, FIELD_H);
}

function drawVignette(ctx) {
  const g = ctx.createRadialGradient(FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.35, FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

function drawKillFeed(ctx) {
  ctx.textAlign = 'right'; ctx.font = '12px "SFMono-Regular", Consolas, monospace';
  let y = 20;
  for (const f of BV.feed) {
    const k = Math.min(1, (f.life - f.age) / 0.6);
    if (f.capture) {
      ctx.fillStyle = hexA('#ff7ab8', k);
      ctx.fillText(`⚑ ${f.by} took the ${f.foe} flag`, FIELD_W - 10, y);
    } else {
      ctx.fillStyle = hexA(f.kill ? '#ff8a7a' : '#c7d0de', k * (f.kill ? 1 : 0.8));
      const verb = f.kill ? '✖ killed' : '· downed';
      ctx.fillText(`${f.by || '—'} ${verb} ${f.name} (${f.role})`, FIELD_W - 10, y);
    }
    y += 17;
  }
  ctx.textAlign = 'left';
}

function drawUnit(ctx, u, mine) {
  const x = camX(u.x), y = u.y;
  const col = mine ? TEAM_COL.me : TEAM_COL.foe;
  if (u.state === 'dead') { drawX(ctx, x, y, 'rgba(120,60,60,0.8)'); return; }
  if (u.state === 'down') { drawX(ctx, x, y, mine ? 'rgba(79,157,255,0.4)' : 'rgba(224,87,74,0.4)'); return; }
  if (u.state === 'captured') return;
  const shape = ROLE_GLYPH[u.role];
  const r = u.role === 'CT' ? 8 : u.role === 'RR' ? 7 : 6;

  // soft drop shadow
  fillCircle(ctx, x + 1.5, y + 2, r + 1, 'rgba(0,0,0,0.35)');

  // facing barrel for fighters (camera flips x, so mirror the angle for side 1)
  if (u.fighter) {
    const fa = BV.playerSide === 1 ? Math.PI - u.face : u.face;
    ctx.strokeStyle = mine ? 'rgba(190,215,255,0.9)' : 'rgba(255,190,175,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(fa) * (r + 6), y + Math.sin(fa) * (r + 6)); ctx.stroke();
  }
  // suppression shudder ring
  if (u.suppress > 0.25) ringCircle(ctx, x, y, r + 4, `rgba(230,200,120,${0.5 * u.suppress})`);

  ctx.fillStyle = col; ctx.strokeStyle = '#0c0f14'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x, y, r, 0, 7);
  else if (shape === 'square') { ctx.rect(x - r, y - r, r * 2, r * 2); }
  else if (shape === 'triangle') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); ctx.closePath(); }
  else if (shape === 'diamond') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
  else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = i / 6 * 7; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
  else if (shape === 'star') { star(ctx, x, y, r + 2, r * 0.5, 5); }
  ctx.fill(); ctx.stroke();
  // health arc
  if (u.hp < 100 && u.fighter) {
    ctx.beginPath(); ctx.strokeStyle = u.hp > 50 ? '#3f9d5f' : '#e0a13d'; ctx.lineWidth = 2;
    ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + (u.hp / 100) * 7); ctx.stroke();
  }
  // flag marker for controller
  if (u.role === 'CT') { ctx.fillStyle = mine ? '#bcd8ff' : '#ffc2b8'; ctx.fillRect(x + r, y - r - 6, 8, 6); }
}
function drawX(ctx, x, y, col) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke(); }
function drawDrone(ctx, x, y, col, strike) {
  ctx.fillStyle = strike ? '#e6c675' : col;
  ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x - 4, y + 3); ctx.lineTo(x + 4, y + 3); ctx.closePath(); ctx.fill();
}
function star(ctx, cx, cy, outer, inner, points) {
  for (let i = 0; i < points * 2; i++) { const r = i % 2 ? inner : outer; const a = i / (points * 2) * 7 - Math.PI / 2; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath();
}

function updateLiveHUD() {
  const b = BV.battle;
  const terr = b.terrPct();
  const me = terr[BV.playerSide], foe = terr[1 - BV.playerSide];
  const ea = document.getElementById('lt-a'), eb = document.getElementById('lt-b');
  if (ea) ea.style.width = me + '%';
  if (eb) eb.style.width = foe + '%';
  const sMe = b.sides[BV.playerSide], sFoe = b.sides[1 - BV.playerSide];
  const st = document.getElementById('live-status');
  if (st) st.innerHTML = `
    <span class="dim">${String(Math.floor(b.time)).padStart(3, ' ')}s</span> ·
    <span class="tMe">You</span> terr ${Math.round(me)}% · fit ${activeFighters(sMe)}/${totalFighters(sMe)} · morale ${Math.round(sMe.morale)}
    &nbsp;|&nbsp; <span class="tFoe">Enemy</span> terr ${Math.round(foe)}% · fit ${activeFighters(sFoe)}/${totalFighters(sFoe)}`;
  // append new log lines
  const logEl = document.getElementById('live-log');
  if (logEl) {
    while (BV.logShown < b.log.length) {
      const e = b.log[BV.logShown++];
      const p = document.createElement('p');
      p.className = 'e-' + e.type;
      p.innerHTML = `<span class="tk">[${String(e.t).padStart(3, ' ')}s]</span> ${esc(e.text)}`;
      logEl.appendChild(p);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }
}
function activeFighters(s) { return s.units.filter(u => u.state === 'active' && u.fighter).length; }
function totalFighters(s) { return s.units.filter(u => u.fighter).length; }

function renderOrderPanel() {
  const panel = document.getElementById('order-panel');
  if (!panel) return;
  if (!BV.paused) { panel.innerHTML = '<p class="small dim">Pause to issue live orders — redirect a group, change stance, or focus-fire.</p>'; return; }
  const rk = BV.orderGroup;
  panel.innerHTML = `
    <h3>Live Orders</h3>
    <div class="group-list">
      ${ROLE_ORDER.filter(r => r !== 'CMD').map(r => `<button class="btn mini grp ${BV.orderGroup === r ? 'sel' : ''}" data-bv="ordergroup" data-id="${r}">${ROLES[r].name}s</button>`).join('')}
    </div>
    ${rk ? `
      <div class="small" style="margin:8px 0"><b>${ROLES[rk].name}s</b> — pick a stance or click the field to send them there (click an enemy to focus-fire).</div>
      <div class="stance-btns">
        ${ROLE_STANCES[rk].map(s => `<button class="btn mini" data-bv="orderstance" data-id="${s}">${STANCES[s].label}</button>`).join('')}
      </div>` : '<p class="small dim">Select a role group above, then command them on the field.</p>'}`;
}

function wireLiveCanvas() {
  const canvas = document.getElementById('live-canvas');
  if (!canvas) return;
  canvas.onmousedown = ev => {
    if (!BV.paused || !BV.orderGroup) return;
    const p = canvasToField(canvas, ev);
    // focus-fire if clicking near an enemy
    const foe = BV.battle.sides[1 - BV.playerSide];
    let hit = null, bd = 16;
    for (const e of foe.units) {
      if (e.state !== 'active') continue;
      const d = Math.hypot(camX(e.x) - p.sx, e.y - p.sy);
      if (d < bd) { bd = d; hit = e; }
    }
    issueMove(BV.orderGroup, p.x, p.y, hit);
    flashOrderHint(hit ? `${ROLES[BV.orderGroup].name}s focus ${hit.player.name}` : `${ROLES[BV.orderGroup].name}s moving out`);
    drawLive();
  };
}
function issueMove(rk, ex, ey, focusEnemy) {
  const s = BV.battle.sides[BV.playerSide];
  for (const u of s.units) {
    if (u.role !== rk || u.state !== 'active') continue;
    u.route = [{ x: ex, y: ey }]; u.wpIndex = 0;
    u.forceId = focusEnemy ? focusEnemy.id : null;
    if (u.stance === 'fallback' || u.stance === 'hold' || u.stance === 'guard') u.stance = rk === 'HK' ? 'overwatch' : rk === 'CT' ? 'push' : 'push';
  }
  BV.battle._emit('order', `Orders relayed: ${ROLES[rk].name}s ${focusEnemy ? 'focus ' + focusEnemy.player.name : 'reposition'}.`);
}
function issueStance(rk, stance) {
  const s = BV.battle.sides[BV.playerSide];
  for (const u of s.units) if (u.role === rk && u.state !== 'dead') u.stance = stance;
  BV.battle._emit('order', `Orders relayed: ${ROLES[rk].name}s → ${STANCES[stance].label}.`);
}
function flashOrderHint(text) {
  const h = document.getElementById('order-hint');
  if (!h) return;
  h.textContent = text; h.style.opacity = '1';
  clearTimeout(flashOrderHint._t);
  flashOrderHint._t = setTimeout(() => { h.style.opacity = '0'; }, 1400);
}

function skipLive() {
  const b = BV.battle;
  if (BV._raf) cancelAnimationFrame(BV._raf);
  let s = 0;
  // step() forces a time-decision once TIME_LIMIT passes, so this always resolves
  while (!b.over && s++ < 2000) b.step(0.3);
  drawLive(); updateLiveHUD();
  finishLive();
}

function finishLive() {
  const b = BV.battle;
  if (!b.result || BV.phase === 'done') return;
  BV.phase = 'done';
  stopWatchdog();
  drawLive(); updateLiveHUD();
  const r = b.result;
  const me = BV.playerSide, them = 1 - me;
  const pt = playerTeam(G);
  const won = r.winnerId === pt.id, drew = r.winnerId === null;
  if (drew) AudioSFX.ui(); else if (won) AudioSFX.win(); else AudioSFX.lose();
  const headline = drew ? 'A DRAW — honours even.' : won ? `VICTORY by ${r.condition}!` : `DEFEAT — ${esc(r.teams[them].name)} win by ${r.condition}.`;
  const cas = r.casualties[me].map(c => `${esc(c.player.name)} (out ${c.weeks}w)`).join(', ') || 'none';
  const dead = r.deaths[me].map(p => esc(p.name)).join(', ');
  const panel = document.getElementById('order-panel');
  if (panel) panel.innerHTML = `
    <div class="match-result">
      <div class="headline">${headline}</div>
      <p class="small">Territory ${r.terr[me]}% – ${r.terr[them]}% · ${r.kills[me]} kills, ${r.incaps[me]} incaps${r.ctCaptured[them] ? ' · enemy flag CAPTURED' : ''}${r.ctCaptured[me] ? ' · <span class="danger">your flag captured</span>' : ''}</p>
      <p class="small">Your casualties: ${cas}${dead ? ` · <span class="danger">KILLED: ${dead}</span>` : ''}</p>
      <button class="btn primary" style="margin-top:10px" data-bv="commit">Continue</button>
    </div>`;
  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) pauseBtn.disabled = true;
}

function commitAndClose() {
  const b = BV.battle;
  commitPlayerResult(G, BV.mctx.fx, b.result);
  saveGame();
  closeBattle();
  SCREEN = 'home';
  render();
}

// ---------- event wiring (delegated) ----------
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-bv]');
  if (!el || !BV.open) return;
  const id = el.dataset.id;
  switch (el.dataset.bv) {
    case 'preset':
      BV.plan = fitPlanToField(buildPlan(id), BV.field, BV.playerSide); BV.plan._fitted = true;
      playerTeam(G).preset = id; saveGame();
      renderPlanning(); break;
    case 'selgroup': BV.selGroup = id; BV.routeMode = false; renderPlanning(); break;
    case 'stance': break; // handled on change
    case 'routemode': BV.routeMode = !BV.routeMode; renderGroupPanel(); break;
    case 'clearroute': BV.plan.groups[BV.selGroup].route = []; drawPlanCanvas(); renderGroupPanel(); break;
    case 'start': startLive(); break;
    case 'cancel': closeBattle(); render(); break;
    case 'pause':
      BV.paused = !BV.paused;
      el.textContent = BV.paused ? '▶ Resume' : '❚❚ Pause';
      BV.last = performance.now();
      renderOrderPanel(); drawLive(); break;
    case 'speed':
      BV.speed = parseInt(id, 10);
      document.querySelectorAll('[data-bv="speed"]').forEach(b2 => b2.classList.toggle('sel', b2.dataset.id === id));
      break;
    case 'skip': skipLive(); break;
    case 'mute': {
      AudioSFX.init(); AudioSFX.setMuted(!AudioSFX.muted);
      el.textContent = AudioSFX.muted ? '🔇' : '🔊';
      if (!AudioSFX.muted) { AudioSFX.resume(); AudioSFX.ui(); }
      break;
    }
    case 'ordergroup': BV.orderGroup = id; renderOrderPanel(); drawLive(); break;
    case 'orderstance': if (BV.orderGroup) { issueStance(BV.orderGroup, id); flashOrderHint(`${ROLES[BV.orderGroup].name}s → ${STANCES[id].label}`); } break;
    case 'commit': commitAndClose(); break;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-bv]');
  if (!el || !BV.open) return;
  if (el.dataset.bv === 'stance') {
    BV.plan.groups[BV.selGroup].stance = el.value;
    drawPlanCanvas();
  }
});
