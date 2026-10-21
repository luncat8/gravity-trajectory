# game.1 worklog — game mode

Specification: `game.1-plan.md` (this folder). Request: a deterministic,
seeded game mode in which time runs only while the cargo flies, so that players
can compare results, with a button that copies the replay as a URL.

## 2026-10-21 — review of the previous task (0.2.0 step 2)

Baseline before any change: `gravity_bench` BENCH OK (parity 0.000068 px),
`dom_smoke` SMOKE OK, `colony_bench` 1622/1622. Fixes from the review:

- `fillPorts`, the field callback that runs inside physics steps, read
  `tradeSim.portPlanet` live and rewrote `portStrength` on every fill. A colony
  founded or abandoned between two steps changed the field mid-flight, and a
  fill had side effects. The roster is now copied once per frame, before
  stepping, into `fieldPortPlanet` (`syncPortRoster`); fills only read it. In
  game mode the roster is frozen for the whole flight.
- the launch button's `disabled` / class / text / title were written every
  frame; `setLaunchState` now writes only on change.
- the `gravity_gui.js` header said prediction throttles above 16.7 ms; the code
  and README use the smoothed 17.5 ms guard.

## 2026-10-21 — game mode

Scope: the game mode itself, plus the tracking half of the 0.2.0 §8 suggestion
(hop count, total flight time and 26 / 26 completion become the game score).
Colony founding on landing stays open.

Changes:

- `orbit_sim.js`: the constructor calls `reset(seed)` (in-place rebuild for
  restart / new seed); `advanceTo(target)` drains events and lands on `target`
  exactly; `step(m)` delegates. Chunked advances match a single jump bit for
  bit, including `t`.
- `orbit_view.js`: `setGameClock(on)` (no wall-clock stepping, pause and space
  disabled, moons advance only when `sim.t` moves), `setSpeed`, `lockSpeed`,
  `reset(seed)` (rebuild, fast-forward to `t+07:00`, moons, HUD); the private
  `seedRandom` copy is replaced by `OrbitWorld.seedRandom`.
- `gravity_sim.js`: the fixed live limit became `stepLimit` / `limitReason`
  (lab: none; game: 14 400 steps, `time cap`); `abort()` → `END_ABORT`; visits
  record their step (`visitStep`), so a full tour's time stops at the 26th
  entry; `flightTime` is `liveSteps · DT` instead of an accumulated sum (801
  steps showed `6.68 s` next to a `6.67 s` score).
- `gravity_game.js` (new): aim grid (`2^-20` turn, `2^-10` px/s), flight cap,
  rate grid, shot record, link codec with strict validation; shared with the
  benches.
- `gravity_gui.js`: mode radios; game state (seed, fixed rate, shots, steps,
  completion step); one `fire()` path for player and replay launches; abort;
  locks (§5); score; copy with clipboard and selectable-field fallback;
  replays (aim 0.7 s → flight → 0.45 s gap, `×1/×4/×16`, synchronous `skip`,
  verdict, hand-over to live play); `hashchange`; `attachWorld()` re-wires the
  trade arrays after `reset`; `syncField()` + split frame paths for the lab
  clock and the flight clock. An invalid link shows its note in either mode.
- `index.html`, `style.css`: mode group, game box, replay row, help rules,
  `[hidden] { display: none !important; }`.
- `experiments/dom_stub.js` (new): the vm page harness, now shared; it reads
  the script list, ids and initial `disabled` / `hidden` / `checked` from
  `index.html` (the old hand-kept list failed on the new script).
  `dom_smoke.js` moved onto it and gained a game section; `game_bench.js` is
  new.

Decisions:

- no custom trigonometry: a 1-ulp change of the launch angle or of every port
  position (the only cross-engine difference) never flipped an outcome in
  5 616 flight pairs (max end drift 1.4e-6 px). Each launch restarts from a
  planet centre, and the link carries the recorded result so a replay states
  whether it matched.
- the rate locks at the first launch; a link's rate is locked from the start
  and across `restart`.
- `copy replay` is disabled during a flight or a running replay, when the
  result is not final.

Validation (`../experiments/logs/game.1-bench.txt`):

- `game_bench` GAME BENCH OK: trade chunking 9/9 identical, reset equals a new
  sim; codec 300 round trips and 10 rejects; aim grid idempotent on 1e5 values
  (snap error ≤ 3.0e-6 rad); a scripted 8-shot game (seed 31, rate 3: three
  planet hops, three moving-port hops including an abort at step 90, two planet
  hops; `26 / 26 ✓ · 8 shots · 50.27 s`) replayed at 144 Hz, with 4–45 ms
  jitter and 120 ms stalls, at `×16` and via `skip` (0.1 s): all four
  bit-identical and `verified ✓`.
- `dom_smoke` SMOKE OK: the lab section is unchanged from baseline (`16.8 s ·
  impact P14`, cadence 30/30 and 11/24). Game section: frozen idle world,
  flight-locked trade clock (`t+ 0.950 min` after 57 steps at ×2), locks,
  abort, copied link, `verified ✓` replay with identical end state, challenge
  link with locked rate, clipboard fallback, invalid link note.
- `gravity_bench` BENCH OK (parity 0.000068 px, moving vs frozen 1358.1 px);
  `colony_bench` 1622/1622; `node --check` on every script.
- headless Chromium 153 (`file://`): idle, armed, in-flight, mid-replay and
  verified screens render as specified; a real mouse-drag flight
  (`impact P0 · 6 / 26 · 1 shot · 6.67 s`) froze the trade clock at `t+ 07:03`,
  its link replayed in a fresh page to `verified ✓` and re-copied identically;
  in-flight frames take 17 ms in both modes; resize handlers 0.30 ms; no console
  errors.

Observations:

- a greedy search with the page's own predictor completes 26 / 26 in two long
  shots (seed 31) or eight 20 s hops. With a 60 s visible horizon, players can
  find long touring shots too, so the shot count may saturate quickly and
  flight time would decide most rankings.
- during a flight the continuation is re-traced up to 240 s ahead every frame
  (10 ms budget), even in a static field where it equals the tail of the last
  trace.

## next step

0.2.0 §8: found an outpost on an uncolonised world when the cargo lands there
(`sim.seedColony()`). In game mode this stays deterministic if founding happens
at the landing step and enters the port roster between flights (the roster
snapshot rule already guarantees that), so replay links remain valid. Worth
pairing with a game-balance pass: shorter visible horizon or a per-seed par in
game mode, and reusing the continuation tail in static fields.
