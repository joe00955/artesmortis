/* Artes Mortis Manager — formations, plans & orders (DOM-free) */
'use strict';

// A plan describes, per role group, where the group forms up (anchor), an
// optional route of waypoints to advance along, and a stance the unit AI obeys.
// Coordinates are always given for TEAM A (attacking left→right); mirrorPlan()
// flips them for team B.

const STANCES = {
  push:      { label: 'Push',      desc: 'Advance along the route and engage.' },
  hold:      { label: 'Hold',      desc: 'Take position and hold, firing in range.' },
  flank:     { label: 'Flank',     desc: 'Sweep fast along the route, then push in.' },
  overwatch: { label: 'Overwatch', desc: 'Take high ground, screen the flag, fire at range.' },
  hunt:      { label: 'Hunt',      desc: 'Stalk enemy fighters and the enemy flag.' },
  guard:     { label: 'Guard',     desc: 'Stay rearguard, claim ground, flee threats.' },
  support:   { label: 'Support',   desc: 'Hold the backfield and run the drones.' },
  command:   { label: 'Command',   desc: 'Direct from base on relayed intel.' },
  fallback:  { label: 'Fall Back', desc: 'Withdraw toward your own base.' },
};
// Which stances make sense per role (first is the default).
const ROLE_STANCES = {
  CMD: ['command'],
  TS:  ['support', 'hold'],
  RR:  ['flank', 'hunt', 'push', 'fallback'],
  CM:  ['push', 'hold', 'flank', 'fallback'],
  HK:  ['overwatch', 'hunt', 'hold'],
  CT:  ['guard', 'push', 'fallback'],
};

// Formation presets. Each returns per-group { anchor, route, stance } in team-A space.
const PRESETS = {
  balanced: {
    name: 'Balanced Line', desc: 'Even advance, flag guarded, hawks on overwatch.',
    build: () => ({
      CMD: { anchor: p(60, 300), route: [], stance: 'command' },
      TS:  { anchor: p(140, 300), route: [], stance: 'support' },
      CT:  { anchor: p(175, 300), route: [p(360, 300)], stance: 'guard' },
      CM:  { anchor: p(300, 300), route: [p(560, 300)], stance: 'push' },
      HK:  { anchor: p(235, 150), route: [], stance: 'overwatch' },
      RR:  { anchor: p(280, 300), route: [p(620, 120)], stance: 'flank' },
    }),
  },
  wedge: {
    name: 'Spearhead', desc: 'Massed central thrust to crack the middle fast.',
    build: () => ({
      CMD: { anchor: p(60, 300), route: [], stance: 'command' },
      TS:  { anchor: p(140, 320), route: [], stance: 'support' },
      CT:  { anchor: p(190, 300), route: [p(430, 300)], stance: 'guard' },
      CM:  { anchor: p(320, 300), route: [p(640, 300)], stance: 'push' },
      HK:  { anchor: p(250, 300), route: [p(470, 300)], stance: 'hold' },
      RR:  { anchor: p(300, 300), route: [p(600, 300)], stance: 'push' },
    }),
  },
  spread: {
    name: 'Wide Envelope', desc: 'Stretch across the field to claim maximum ground.',
    build: () => ({
      CMD: { anchor: p(60, 300), route: [], stance: 'command' },
      TS:  { anchor: p(130, 300), route: [], stance: 'support' },
      CT:  { anchor: p(180, 300), route: [p(380, 300)], stance: 'guard' },
      CM:  { anchor: p(300, 300), route: [p(560, 300)], stance: 'flank' },
      HK:  { anchor: p(240, 90), route: [], stance: 'overwatch' },
      RR:  { anchor: p(280, 500), route: [p(640, 520)], stance: 'flank' },
    }),
  },
  turtle: {
    name: 'Fortress', desc: 'Dig in near base and grind them down on the counter.',
    build: () => ({
      CMD: { anchor: p(60, 300), route: [], stance: 'command' },
      TS:  { anchor: p(120, 300), route: [], stance: 'support' },
      CT:  { anchor: p(150, 300), route: [], stance: 'guard' },
      CM:  { anchor: p(240, 300), route: [], stance: 'hold' },
      HK:  { anchor: p(200, 200), route: [], stance: 'overwatch' },
      RR:  { anchor: p(220, 400), route: [], stance: 'hold' },
    }),
  },
  flankLeft: {
    name: 'Left Hook', desc: 'Heavy weight down the top edge to turn their flank.',
    build: () => ({
      CMD: { anchor: p(60, 300), route: [], stance: 'command' },
      TS:  { anchor: p(140, 340), route: [], stance: 'support' },
      CT:  { anchor: p(180, 260), route: [p(400, 160)], stance: 'guard' },
      CM:  { anchor: p(300, 160), route: [p(620, 120)], stance: 'push' },
      HK:  { anchor: p(240, 120), route: [], stance: 'overwatch' },
      RR:  { anchor: p(300, 120), route: [p(640, 90)], stance: 'flank' },
    }),
  },
};
function p(x, y) { return { x, y }; }
const PRESET_ORDER = ['balanced', 'wedge', 'spread', 'turtle', 'flankLeft'];

function buildPlan(presetKey) {
  const preset = PRESETS[presetKey] || PRESETS.balanced;
  return { preset: presetKey, groups: preset.build() };
}

// Snap a plan's anchors/routes to be sensible on a given field (avoid blocks,
// nudge overwatch hawks onto nearby high ground).
function fitPlanToField(plan, field, side) {
  for (const rk of ROLE_ORDER) {
    const g = plan.groups[rk];
    if (!g) continue;
    g.anchor = sideify(g.anchor, field, side);
    g.route = (g.route || []).map(w => sideify(w, field, side));
    if (rk === 'HK' && g.stance === 'overwatch') {
      const h = nearestHigh(field, g.anchor.x, g.anchor.y);
      if (h && Math.hypot(h.x - g.anchor.x, h.y - g.anchor.y) < 180) g.anchor = { x: h.x, y: h.y };
    }
  }
  return plan;
}
// Convert a team-A coordinate to the given side, keeping it inside the field.
function sideify(pt, field, side) {
  let x = side === 0 ? pt.x : field.w - pt.x;
  let y = clamp(pt.y, 20, field.h - 20);
  x = clamp(x, 20, field.w - 20);
  return { x, y };
}

// Auto-generate a plan for an AI team from its tactics.
function autoPlan(team, field, side) {
  const t = team.tactics;
  let presetKey;
  if (t.doctrine === 'defensive') presetKey = 'turtle';
  else if (t.doctrine === 'elimination') presetKey = t.aggression >= 3 ? 'wedge' : 'balanced';
  else presetKey = t.aggression >= 3 ? 'spread' : 'balanced';
  if (chance(0.25)) presetKey = pick(PRESET_ORDER);
  const plan = buildPlan(presetKey);

  // apply tactics to stances
  const g = plan.groups;
  if (t.aggression >= 3) { g.CM.stance = 'push'; if (g.CT.route.length) g.CT.stance = 'push'; }
  if (t.aggression <= 1) { g.CM.stance = 'hold'; g.CT.stance = 'guard'; }
  if (t.controllerRisk === 'forward') { g.CT.stance = 'push'; g.CT.route = [p(480, 300)]; }
  g.HK.stance = t.hawkOrders === 'hunt' ? 'hunt' : 'overwatch';
  if (t.doctrine === 'elimination') g.RR.stance = 'hunt';
  return fitPlanToField(plan, field, side);
}

if (typeof module !== 'undefined') module.exports = {};
