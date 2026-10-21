# game.1 — game mode: seeded world, flight-only clock, replay links

A competitive mode on top of the grand tour. Every player of a link faces the
same world under the same rules, the world only moves while the cargo flies,
and a finished (or unfinished) run can be shared as a URL that re-simulates it
shot by shot.

## 1. modes

- **lab** (default): free clock. The trade world runs in real time, gravity is
	editable, a new launch may replace a flying cargo.
- **game**: the rules below. A `mode` radio (`lab` / `game`) sits at the top of
	the cargo HUD. Entering game mode starts a game on the current world seed;
	leaving it keeps the world and hands the clock back to real time.

## 2. a game

- definition: `seed` (world, integer ≥ 1) and `rate` (trade minutes per flight
	second, the footer speed slider, multiples of 0.5 in `0.5…12`).
- start state: world rebuilt in place from `seed` and fast-forwarded to
	`t+07:00`, no visits, no landing base, every gravity strength `1`, passenger
	derived from the seed. The first launch may start from any planet.
- the speed slider sets the rate until the first launch, then locks for the
	rest of the game. A game opened from a link keeps the link's rate locked
	from the start (also across `restart`), so a challenge cannot drift.

## 3. flight-only clock

- The trade sim is not stepped by the frame loop. While the cargo flies, every
	fixed physics step (`DT = 1/120 s`) advances the field time by `DT · rate`,
	and after each `GravitySim.step()` call the trade sim advances to exactly the
	cargo's field time (`OrbitSim.advanceTo`).
- When the flight ends (impact, exit, time cap, abort) the clock stops; aiming
	takes any amount of real time without changing the world. Moons only orbit
	while the world clock moves.
- game time = Σ flight steps · DT, shown as `game + mm:ss.s`.

## 4. determinism contract

The state at every launch is a pure function of `(seed, rate, shots so far)`:

- **shot** = gravity source (`planets` / `ports · moving`), origin planet,
	angle, speed, optional abort step. In game mode the aim snaps to
	`2^-20` turn and `2^-10` px/s after every aim edit, so prediction, flight,
	link and replay use bit-identical inputs.
- **flight**: fixed step; field rate constant; the port roster used by the
	field is a snapshot taken at launch (abandoned or founded colonies change it
	only between flights); source switching and strength edits are locked during
	flight. The field is therefore a function of the step index alone, and frame
	chunking only changes pacing, never the path.
- **trade**: events are scheduled from event time and drained in time order,
	so any chunking of `advanceTo` reaches the same state; `advanceTo(target)`
	lands on `target` exactly instead of accumulating frame deltas.
- **termination**: a flight is capped at 120 s (14 400 steps, `time cap`). An
	abort ends the flight at the current step and the shot records that step;
	the replay stops the flight at the same step.
- **across JS engines** only `Math.sin`/`Math.cos` may differ (by 1 ulp). A
	1-ulp angle change moves a flight's end point by ≤ 1e-5 px and never flipped
	an outcome in the bench sweep; each launch restarts from a planet centre, so
	ulp noise does not carry between shots. The link stores the recorded result
	and the replay reports whether it matched.

## 5. rules and locks in game mode

- no aiming or launching while the cargo flies; launches only from the landed
	planet (or the previous base after an exit/abort/cap; anywhere before the
	first landing).
- gravity strengths are fixed at `1`: the `g` slider is disabled and the trim
	slider adjusts the aim only.
- the source radio works between flights (recorded per shot) and locks during
	flight and during a replay.
- trade pause and the space key are disabled.
- the bottom-right action becomes `abort` (enabled only during a live flight).
- 26 / 26: the tour completes at the step the 26th system is entered; the
	running flight may finish, then launches are disabled.

## 6. score

`systems visited / 26 · shots · flight time`. Ranking: more systems, then
fewer shots, then less flight time. A complete tour's time stops at the entry
step of the 26th system; otherwise it is the total of all flights.

## 7. replay link

```
<page>#game=1&seed=7&rate=0.5&shots=p0.4fzk.6v8w_m14.1x2c.3ab9.2k&end=12.5796
```

- `game` — link format version (`1`).
- `shots` — `_`-separated; each shot is `<src><origin>.<angle>.<speed>[.<abort>]`
	with `src` `p` (planets) or `m` (moving ports), `origin` decimal, angle units
	(`0…2^20-1`), speed units (`px/s · 1024`) and abort step in base 36.
- `end` — recorded `visited.scoreSteps`; the replay compares its own result.
- `copy replay` writes the link to the clipboard (falls back to a selectable
	field) and is disabled during a live flight or a running replay, when the
	result is not final.
- opening a link (page load or `hashchange`) switches to game mode with that
	seed and rate and replays the shots: aim shown 0.7 s, flight in real time,
	0.45 s gap; speed cycles `×1 / ×4 / ×16`; `skip` re-simulates the rest
	instantly. At the end the HUD shows `verified` or the recorded result it
	missed, and play continues from that exact state (a viewer may extend the
	run). An origin that is not launchable stops the replay as a desync.
- a link without `shots` is a challenge: same seed and rate, fresh start.
- a malformed link (unknown version, seed < 1, rate off the grid, origin or
	units out of range) changes nothing and the mode tag shows
	`invalid game link`.

## 8. HUD

- `mode` group: radio `lab / game`; in game mode a box with `seed · rate`,
	`score`, `replay` progress and buttons `restart`, `new seed`, `copy replay`,
	plus `×N` / `skip` while a replay runs.
- status line adds `clock runs` / `clock paused`, `tour complete` and
	`replay · aiming` / `replay · in flight`; the replay row shows
	`shot k / n · ×N`, then the verdict.
- help drawer: a `game mode` section with the rules above.

## 9. validation

- `experiments/game_bench.js`: trade chunking fingerprint, link codec round
	trip and rejects, aim snapping, a scripted game (planets and moving-port
	hops, one abort) replayed at 144 Hz, with jittery frames, at `×16` and via
	`skip` (identical cargo position, steps, visits and trade fingerprint),
	1-ulp sensitivity sweep, skip cost.
- `experiments/dom_smoke.js`: mode toggle, clock frozen while aiming and
	advancing in flight, locks, abort, copy-link text, link load and verified
	replay, challenge link with locked rate, clipboard fallback, invalid link.
