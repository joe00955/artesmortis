# Artes Mortis Manager

A single-player, browser-based management sim for the blood sport **Artes Mortis** —
Football Manager, but the fixtures are sanctioned battles. Build a squad of fifteen,
set your doctrine, arm within the law, and survive a full league season.

## Run it

No build step, no dependencies. Either:

```sh
npx serve .
```

…or just open `index.html` directly in a browser. Progress auto-saves to
`localStorage` after every action.

## What's in it

- **Squad management** — recruit and release players across the six fixed roles
  (1 Commander, 3 Technical Strategists, 2 Road Runners, 6 Countrymen, 2 Hawks,
  1 Controller), each with FM-style 1–20 stats, wages, contracts, injuries and
  a free-agent market.
- **Tactics** — aggression level, doctrine (territory / elimination / defensive),
  Controller positioning risk, and Hawk orders. These seed the AI's behaviour
  and your default battle plan.
- **Armory** — buy from the legal pool subject to league law: lethal gear is
  illegal in non-BSP leagues, Probes need an Oversight Board license, and the
  permanently banned list (nukes, RPGs, armored vehicles, dead-man switches, …)
  can never be legalised.
- **Real-time spatial battle engine** — every player is a unit on a
  procedurally generated battlefield (terrain, cover, hard blocks, elevation)
  with role-driven AI: Countrymen advance and hold ground, Hawks take high
  ground and snipe, Road Runners flank and hunt the enemy flag, Technical
  Strategists run recon/strike drones that relay intel to the base-bound
  Commander, and the Controller paints territory in a moving radius. Win by
  elimination, incapacitation, surrender, or controlling >80% of the field.
  Capture an enemy Controller and **all** their claimed ground transfers to you.
- **Plan, then command** — before each match, pick a formation preset, drag your
  six role groups across your half, draw advance routes, and set each group's
  stance on a canvas planning board. During the live battle you watch it unfold
  (1×/2×/4×), **pause to issue fresh orders** (reposition a group, change its
  stance, or click an enemy to focus-fire), or **Skip** to resolve instantly.
  A live territory map, claim radii, drone vision, shots, casualties, morale and
  a battle log surface everything as it happens.
- **League season** — 8 teams, double round-robin, standings, procedurally
  described maps, finances (gate money, prizes, wages, terrain fees, BSP
  oversight fees and death compensation), injuries and recovery, plus an
  off-season with aging, development, retirements and a refreshed transfer
  market before the next season. AI opponents auto-plan their own formations
  from their doctrine.
- **Two league types** — the non-BSP Regional Circuit (injuries only) and
  Blood Sport Proper, where deaths are permanent and the money is bigger.

## Not yet in (by design)

Multi-team matches, mid-match alliance AI (the alliance *rules* are encoded in
the in-game Codex), scouting networks, and long-form career polish.

## Development

The simulation core (`js/data.js`, `player.js`, `team.js`, `field.js`,
`formation.js`, `battle.js`, `league.js`) is DOM-free and runs the spatial
battle engine either headless (AI matches, tests) or stepped and rendered (your
match). `js/ui.js` handles the management screens, `js/battleview.js` the canvas
planning board and live battle, and `js/main.js` persistence. A headless smoke
test runs the full core through two complete seasons in both league types plus
dedicated battle-engine checks:

```sh
node test/sim-test.js
```
