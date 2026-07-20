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

## What's in v1

- **Squad management** — recruit and release players across the six fixed roles
  (1 Commander, 3 Technical Strategists, 2 Road Runners, 6 Countrymen, 2 Hawks,
  1 Controller), each with FM-style 1–20 stats, wages, contracts, injuries and
  a free-agent market.
- **Tactics** — aggression level, doctrine (territory / elimination / defensive),
  Controller positioning risk, and Hawk orders.
- **Armory** — buy from the legal pool subject to league law: lethal gear is
  illegal in non-BSP leagues, Probes need an Oversight Board license, and the
  permanently banned list (nukes, RPGs, armored vehicles, dead-man switches, …)
  can never be legalised.
- **Match engine** — turn-by-turn text simulation with a live event log and an
  animated territory map. Win by elimination, incapacitation, surrender, or
  controlling >80% of the field. Controllers claim ground as they move and can
  only be captured — a captured flag transfers **all** claimed territory.
- **League season** — 8 teams, double round-robin, standings, procedurally
  described maps, finances (gate money, prizes, wages, terrain fees, BSP
  oversight fees and death compensation), injuries and recovery, plus an
  off-season with aging, development, retirements and a refreshed transfer
  market before the next season.
- **Two league types** — the non-BSP Regional Circuit (injuries only) and
  Blood Sport Proper, where deaths are permanent and the money is bigger.

## Not yet in v1 (by design)

Multi-team matches, mid-match alliance AI (the alliance *rules* are encoded in
the in-game Codex), scouting networks, and long-form career polish.

## Development

The simulation core (`js/data.js`, `player.js`, `team.js`, `match.js`,
`league.js`) is DOM-free; `js/ui.js` and `js/main.js` handle rendering and
persistence. A headless smoke test runs the full core through two complete
seasons in both league types:

```sh
node test/sim-test.js
```
