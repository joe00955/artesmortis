/* Artes Mortis Manager — static data & helpers (DOM-free) */
'use strict';

// ---------- RNG helpers ----------
function rnd() { return Math.random(); }
function rint(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function chance(p) { return rnd() < p; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(Math.round(n));
  if (n >= 1e6) return sign + '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return sign + '$' + (n / 1e3).toFixed(1) + 'k';
  return sign + '$' + n;
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ---------- Roles ----------
const ROLES = {
  CMD: { key: 'CMD', name: 'Commander', count: 1, desc: 'Stays at base, directs via comms. Cannot view drone feeds directly — acts only on relayed intel.' },
  TS:  { key: 'TS',  name: 'Technical Strategist', count: 3, desc: 'Operates drones, probes and robots. Provides battlefield intel and remote strikes.' },
  RR:  { key: 'RR',  name: 'Road Runner', count: 2, desc: 'Vehicle driver. Fast flanks, extraction and pursuit.' },
  CM:  { key: 'CM',  name: 'Countryman', count: 6, desc: 'Frontline infantry. Movement, kills, trap-setting and territory capture.' },
  HK:  { key: 'HK',  name: 'Hawk', count: 2, desc: 'Sniper / long-range specialist.' },
  CT:  { key: 'CT',  name: 'Controller', count: 1, desc: 'Carries the team flag at the back of the formation. Cannot be killed, only captured. Claims territory in a 500m radius while moving; if captured, all claimed territory transfers to the captors.' },
};
const ROLE_ORDER = ['CMD', 'TS', 'RR', 'CM', 'HK', 'CT'];
const SQUAD_SIZE = 15;

// Stat weights per role, used for the overall rating.
const ROLE_WEIGHTS = {
  CMD: { tacticalIQ: 4, loyalty: 2, courage: 1, endurance: 1 },
  TS:  { tacticalIQ: 3, aim: 2, endurance: 1 },
  RR:  { speed: 3, courage: 2, endurance: 2, tacticalIQ: 1 },
  CM:  { aim: 3, courage: 2, endurance: 2, stealth: 1 },
  HK:  { aim: 4, stealth: 2, tacticalIQ: 2 },
  CT:  { speed: 3, endurance: 2, tacticalIQ: 2, loyalty: 2 },
};
const STAT_KEYS = ['aim', 'speed', 'endurance', 'stealth', 'tacticalIQ', 'courage', 'loyalty', 'injuryProne'];
const STAT_LABELS = {
  aim: 'Aim', speed: 'Speed', endurance: 'Endurance', stealth: 'Stealth',
  tacticalIQ: 'Tactical IQ', courage: 'Courage', loyalty: 'Loyalty', injuryProne: 'Injury Prone',
};

// ---------- Armory ----------
// The permanently banned list (never selectable, shown for flavour/reference).
const BANNED_ITEMS = [
  'Nuclear weapons', 'Weapons of mass destruction', 'RPGs / rocket launchers',
  'Mounted-only machine guns', 'Tanks', 'Armored vehicles', 'Dead-man switches',
  'Explosive bullets', 'Hollow-point bullets', 'Handcrafted weapons',
  'Probes (without an Oversight Board license)',
];

// Legal pool. lethal items are illegal in non-BSP leagues.
// group: which role benefits. power: combat bonus. licensed: needs Probe License.
const WEAPON_POOL = [
  { id: 'sidearm',    name: 'Service Sidearm',        group: 'ALL', lethal: true,  cost: 12000,  power: 2, desc: 'Standard-issue pistol for every fielded player.' },
  { id: 'rifle',      name: 'Pattern-7 Rifle',        group: 'CM',  lethal: true,  cost: 45000,  power: 5, desc: 'Reliable assault rifle for the Countrymen line.' },
  { id: 'shotgun',    name: 'Breacher Shotgun',       group: 'CM',  lethal: true,  cost: 30000,  power: 4, desc: 'Devastating up close; favoured in dense terrain.' },
  { id: 'marksman',   name: 'Longeye Marksman Rifle', group: 'HK',  lethal: true,  cost: 60000,  power: 7, desc: 'Precision rifle for Hawks. Legal ammunition only.' },
  { id: 'bladetrap',  name: 'Blade Trap Kit',         group: 'CM',  lethal: true,  cost: 20000,  power: 3, desc: 'Factory-made lethal traps. Handcrafted traps remain banned.' },
  { id: 'strikedrone',name: 'Strike Drone Package',   group: 'TS',  lethal: true,  cost: 80000,  power: 6, desc: 'Armed drones for the Technical Strategists.' },

  { id: 'stunbaton',  name: 'Stun Batons',            group: 'CM',  lethal: false, cost: 8000,   power: 2, desc: 'Close-quarters incapacitation.' },
  { id: 'rubber',     name: 'Rubber-Round Carbines',  group: 'CM',  lethal: false, cost: 25000,  power: 4, desc: 'Non-lethal carbines. League-standard for non-BSP play.' },
  { id: 'tranq',      name: 'Tranq Marksman System',  group: 'HK',  lethal: false, cost: 40000,  power: 5, desc: 'Long-range sedative darts for Hawks.' },
  { id: 'netlaunch',  name: 'Net Launchers',          group: 'RR',  lethal: false, cost: 15000,  power: 3, desc: 'Vehicle-mounted nets for running down targets.' },
  { id: 'snarekit',   name: 'Snare Trap Kit',         group: 'CM',  lethal: false, cost: 10000,  power: 2, desc: 'Non-lethal snares and shock wire.' },

  { id: 'recondrone', name: 'Recon Drone Wing',       group: 'TS',  lethal: false, cost: 35000,  power: 0, intel: 3, desc: 'Unarmed eyes in the sky. Intel is relayed to the Commander by voice only.' },
  { id: 'probe',      name: 'Probe Mk.II',            group: 'TS',  lethal: false, cost: 90000,  power: 0, intel: 6, licensed: true, desc: 'Autonomous ground probe. Requires an Oversight Board Probe License.' },
  { id: 'scoutbuggy', name: 'Scout Buggies',          group: 'RR',  lethal: false, cost: 50000,  power: 3, desc: 'Light, fast, unarmored — armored vehicles are banned.' },
  { id: 'armor',      name: 'Ballistic Vests',        group: 'ALL', lethal: false, cost: 30000,  power: 0, protect: 2, desc: 'Reduces injury and death risk for the whole squad.' },
  { id: 'ctguard',    name: 'Flag Guard Detail Kit',  group: 'CT',  lethal: false, cost: 25000,  power: 0, guard: 3, desc: 'Smoke, decoy flags and hardened comms to protect the Controller.' },
];
const PROBE_LICENSE_COST = 120000;

// ---------- Leagues ----------
const LEAGUE_TYPES = {
  NONBSP: {
    key: 'NONBSP', name: 'Regional Circuit (non-BSP)',
    desc: 'No lethal weapons or explosives. Injuries only — "for fun". Lower stakes, lower prizes, no oversight fees.',
    lethalAllowed: false, oversightFee: 0, winPrize: 60000, drawPrize: 20000, gateBase: 30000,
    seasonPrizes: [400000, 250000, 150000, 80000, 40000, 20000, 10000, 0],
  },
  BSP: {
    key: 'BSP', name: 'Blood Sport Proper (BSP)',
    desc: 'Real injuries and deaths are sanctioned. Stricter armory rules, Oversight Board fees per match, and death compensation payouts.',
    lethalAllowed: true, oversightFee: 25000, winPrize: 150000, drawPrize: 50000, gateBase: 80000,
    seasonPrizes: [1200000, 700000, 400000, 200000, 100000, 50000, 25000, 0],
  },
};
const DEATH_COMPENSATION = 100000; // paid by a team when one of its players dies (BSP)
const TERRAIN_FEE = 8000;          // per-match field logistics cost
const STARTING_BALANCE = { NONBSP: 900000, BSP: 2000000 };

// ---------- Names ----------
const FIRST_NAMES = [
  'Aldous', 'Bram', 'Caius', 'Dario', 'Emeric', 'Fenn', 'Garrick', 'Hale', 'Ivo', 'Jarek',
  'Kestrel', 'Lazlo', 'Mirek', 'Nash', 'Otho', 'Pell', 'Quill', 'Roan', 'Soren', 'Tavish',
  'Ulric', 'Vance', 'Wren', 'Xan', 'Yorick', 'Zeph', 'Anka', 'Briar', 'Cezar', 'Dov',
  'Esra', 'Freja', 'Gideon', 'Halla', 'Ines', 'Jute', 'Kova', 'Lior', 'Mara', 'Noor',
  'Odile', 'Petra', 'Rasa', 'Sable', 'Tamsin', 'Una', 'Vesna', 'Wilm', 'Yara', 'Zora',
];
const LAST_NAMES = [
  'Ashgrave', 'Blackwood', 'Carrow', 'Duskwalt', 'Emberlain', 'Fairhollow', 'Grimsson', 'Harrowgate',
  'Ironside', 'Jassar', 'Kolvek', 'Larkspur', 'Morrow', 'Nightingale', 'Oakhurst', 'Pellwarden',
  'Quist', 'Ravenor', 'Stormont', 'Thorncastle', 'Umberfell', 'Vasquez', 'Wolfram', 'Yellowfield',
  'Zharov', 'Aldercroft', 'Bane', 'Coldwater', 'Draval', 'Everbleak', 'Fyodorov', 'Greaves',
  'Hollowell', 'Ivarsen', 'Karsk', 'Lockridge', 'Mercer', 'Nyx', 'Osgood', 'Palegrave',
];
const AI_TEAM_NAMES = [
  'Crimson Vultures', 'Iron Jackals', 'Ash Serpents', 'Night Herons',
  'Rust Wolves', 'Pale Riders', 'Storm Crows', 'Black Aurochs',
  'Gallows Foxes', 'Salt Hounds', 'Bone Larks', 'Ember Stags',
];

// ---------- Procedural maps ----------
const TERRAIN_TYPES = [
  { type: 'Forest',     mods: { hawk: -2, stealth: 3, vehicle: -2, drone: -1 }, blurbs: ['old-growth pine cover', 'fog-bound thickets', 'river-cut ravines'] },
  { type: 'Urban Ruin', mods: { hawk: 1,  stealth: 2, vehicle: -1, drone: 1 },  blurbs: ['collapsed tenement blocks', 'a gutted rail terminus', 'sniper-friendly towers'] },
  { type: 'Desert',     mods: { hawk: 3,  stealth: -3, vehicle: 3, drone: 2 },  blurbs: ['open hardpan flats', 'dune ridges and heat shimmer', 'a dry lakebed arena'] },
  { type: 'Marshland',  mods: { hawk: -1, stealth: 2, vehicle: -3, drone: 0 },  blurbs: ['waist-deep fens', 'reed mazes', 'sucking black mud'] },
  { type: 'Highlands',  mods: { hawk: 2,  stealth: 0, vehicle: -1, drone: -1 }, blurbs: ['windswept crags', 'scree slopes and cloud', 'a glacial valley floor'] },
  { type: 'Industrial', mods: { hawk: 0,  stealth: 1, vehicle: 2,  drone: 1 },  blurbs: ['a derelict refinery', 'chemical tank farms', 'container canyons'] },
];
const MAP_ADJ = ['Withered', 'Broken', 'Silent', 'Red', 'Hollow', 'Grey', 'Last', 'Bitter', 'Low', 'Sunken'];
const MAP_NOUN = ['Reach', 'Expanse', 'Quarter', 'Verge', 'Bastion', 'Steppe', 'Warrens', 'Corridor', 'Basin', 'March'];

function genMap() {
  const t = pick(TERRAIN_TYPES);
  return {
    name: pick(MAP_ADJ) + ' ' + pick(MAP_NOUN),
    type: t.type,
    mods: t.mods,
    desc: t.type + ' — ' + pick(t.blurbs) + ', roughly ' + rint(6, 14) + ' km² of sanctioned ground.',
  };
}
