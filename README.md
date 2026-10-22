# gravity cargo

A ballistic grand-tour game and gravity lab on top of the `orbit_trade`
visualisation from `luncat8/exec_queue`. A `tourist` or `emperor’s emissary`
wants to fly through as many planet systems as possible: launch from a planet,
sweep inside planets' port orbits using gravity assists, land cleanly on a
planet, and stage your next hop from where you landed.

Two modes: **lab** (free clock, editable gravity) and **game** (seeded world,
the clock runs only while the cargo flies, fixed rules, shareable replay links
that re-fly and verify a run).

## run

Open `index.html` (`file://` works, no build, no modules).

## controls

| input | action |
| --- | --- |
| drag from a planet | aim; direction is planet → grip, push grows with drag length |
| hold shift while dragging | aim at 1/20 sensitivity |
| click a body | select planet or moving port to tune its gravity (`-2…2`, default `1`); keeps armed shot |
| `g` slider | gravity of the selected body; negative values repel · red `+` / blue `−` updates at once |
| `±` trim slider | relative nudge (`-5%…+5%`) of the aim speed, or of selected gravity when no shot is armed |
| release drag | arms the shot and draws the predicted trajectory and system visits |
| enter / launch | fires the vessel |
| esc | closes help drawer or cancels the aim |
| clear | resets vessel, trail, visited systems and launch-base lock |
| gravity positions | radio group `planets` (static) / `ports` (`ports · moving`); launch base is always a static planet |
| `? help` / `h` | toggles the mission & guide drawer (`tourist` / `emperor’s emissary`) |
| space | pauses the trade background only (lab) |
| mode `lab` / `game` | game: rebuilds the seeded world at `t+07:00`, freezes it between flights, locks gravity at `1` |
| `abort` (game) | ends the running flight at the current step (recorded in the replay) |
| rule `tour` / `route` / `money` (game) | tour: 120 s flight cap, score systems → shots → time; route: 1 800 s wall, score systems → route length → shots → time; money: 10 shots, score purse → systems → shots → time · switching restarts the seed |
| rivals `off` / `easy` / `normal` / `hard` | deterministic shared-market rivals (`normal` default; `hard` fields 2 rivals with 1-ply lookahead) that harvest planet profits in lockstep · switching restarts the seed |
| purse & planet profits (game) | starts at `3.00`; each launch costs `1.00` (refused below `1.00`); each planet's fly-visit payout grows with unvisited game time (`+0.25` initial, resets to `+0.00` when visited by you or a rival, `+0.00625/s` up to `+0.75` cap) and is drawn as a live pill under every planet |
| `restart` / `new seed` | same seed fresh start / random world |
| `copy replay` / `copy rival` | copies your replay link (with `&rule=` and `&bot=` when active) or Rival 1's solo trajectory link |
| `− slower / + faster`, `×1` | live playback ×0.25…×8; a replay adds ×0.25…×16 on top — only the pacing changes, never the physics steps or the recorded shots |
| `×1 / ×4 / ×16`, `skip` | replay multiplier / re-simulate the rest of a replay instantly |

## mechanics & visuals

- **Grand tour**: entering inside any planet's port-orbit ellipse marks that
  planet system as visited (`visited` rings persist across hops). Predicted
  visit count (`sys · +new`) updates live as your shot or moving orbits change.
- **Staged hops**: once landed on a planet, the next launch is only allowed from
  that landed body (marked on canvas); hovering or dragging elsewhere shows a
  lock tooltip with a directional arrow pointing to the landed location.
- **Continuous flight & 60 fps cadence**: while flying, the predicted trajectory
  continues ahead of the vessel until it lands. When centres move or change,
  prediction updates every frame while `>= 60 fps` and throttles automatically if
  frame time rises above `17.5 ms`.
- **Route rule**: a shot is traced to its end before it is recorded, whatever it
  costs: the tracer is a resumable job (`GravitySim.routeBegin/routeStep`) that
  spends 4 ms per frame, so a 160 s preview never drops a frame, and the aim
  readout shows `computing 43 %` while it runs. Launching drains the job
  synchronously. The 1 800 s wall is a net, not a routine end — measured: no
  unedited shot in the shipped world outlives ~160 s.
- **Game mode, planet-profit market & rivals**: the world is rebuilt from a seed
  and advances only with fixed physics steps (`DT = 1/120 s`, field time
  `+= DT · rate`), so aiming takes any amount of real time. Aim snaps to
  `2^-20` turn and `2^-10` px/s, locking determinism to `(seed, rate, rule, bot,
  shots)`. Three rules share a `3.00` starting purse, `1.00` launch fee, and a
  shared 26-planet market where each planet's fly-visit payout grows while
  unvisited (`+0.25` at start, `+0.00625/s` up to `+0.75`, drawn beneath every
  planet and highlighted in green along your predicted trajectory): `tour`
  (26 systems, 120 s cap), `route` (26 systems, 1 800 s wall, ranked by route
  length), and `money` (10 shots, ranked by final purse). Optional deterministic
  rivals (`easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead) fly in
  integer-step lockstep and compete for the same growing planet values without
  dropping 60 fps (`3 ms` / 64-candidate background slices). Replay links
  (`#game=1&seed=…&rate=…[&rule=…][&bot=…]&shots=…&end=…`) re-fly and verify
  every run (`verified ✓ · purse …`).
- **Playback**: the flight is watched, not simulated, faster — one multiplier
  scales the wall-clock slice fed to the fixed `DT = 1/120 s` steps, so ×0.25
  and ×8 produce the same step sequence and the same replay. The trade `rate`
  slider stays locked once a shot is fired, because it *does* change the world.
- **Planet photos**: entering a system for the first time shows a postcard of
  that world from space (bottom-left, aspect kept, 256 px overlay on a small
  screen); landing shows the surface, and a gas giant gets an air platform.
  Art is optional — `photos/space|landed/<type>[-n].jpg|png`, see
  `photos/README.md` and the Krea 2 / MOSS-Image captions in
  `photos/prompts.md`; without a file a CSS postcard of the same planet type is
  drawn. One card per planet and per landing, per run.
- **Secondary moons & belts**: coplanar moons and Saturn/rubble belts share each
  planet's orbital inclination, apocenter axis and spin direction, following
  Keplerian orbital speed scaled by planet gravity (`sqrt(|g|) · a^(-3/2)`) with
  front/back limb occlusion and zero simulation impact.

## files

- `index.html`, `style.css` — page, HUD panels and slide-out help drawer
- `exec_queue.js` — binary min-heap event queue (vendored)
- `orbit_world.js` — planet geometry, stations on their ellipses, natural traits
- `orbit_econ.js` — colony economy laws: goods, resource map, growth
- `orbit_sim.js` — orbital trade & colony simulation
- `orbit_view.js` — trade renderer, coplanar Kepler moons & belts, camera `OrbitScene`
- `gravity_sim.js` — gravity field, planet-system visits, per-pass prediction log, headless `predictFast`, live `stepOne` flight & continuation
- `gravity_game.js` — game rules (`tour`, `route`, `money`), aim grid, replay link codec (`rule`, `bot`), shared planet-profit market (`MONEY`, `createMarket`, `planetProfit`, `stepHarvest`, `estimateProfit`, `compareScores`)
- `gravity_bot.js` — deterministic shared-market rival competitors (`off`, `easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead, sliced zero-alloc search, `rivalLink`)
- `photo_deck.js` — postcard popup: type → file candidates, captions, compact layout, purse toast
- `gravity_gui.js` — overlay renderer, planet-profit pills & rival ships, aiming, hop lock & arrow, adaptive 60 fps HUD, game mode & replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`, `route_bench.js`, `bot_bench.js`), headless DOM smoke suite
  (`dom_smoke.js`) on the shared vm page stub (`dom_stub.js`)
- `photos/` — user art (`space/`, `landed/`), `README.md` (file spec),
  `prompts.md` (14 captions for Krea 2 / MOSS-Image) and `generator/`
  (`comfy_queue.py` queues the captions into ComfyUI and downloads the renders)
- `archive/` — standalone plans, worklogs and reference page
