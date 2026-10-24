# gravity cargo

A ballistic grand-tour game and gravity lab on top of the `orbit_trade`
visualisation from `luncat8/exec_queue`. Launch from a planet, sweep inside
planets' port orbits using gravity assists, land cleanly, and stage the next
hop from where you landed. The `route` rule instead plans one longest possible
trajectory without launching it.

One flat mode row: **lab** (free clock, editable gravity) and four seeded rules
— **visit all tour**, **route length**, **money for visit** and **career** (a
solo catapult network). Under the flown rules the clock runs only while cargo
flies, while `route` stays a deterministic planner; links stay shareable.

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
| release drag | arms the shot/plan and draws the predicted trajectory (and, outside `route`, system visits) |
| enter / launch | fires the vessel under `tour`/`money`; disabled for a `route` plan or bot-controlled YOU |
| esc | closes help or cancels the aim/plan |
| clear / clear plan | resets the vessel, or removes the current `route` plan; the saved best remains available |
| `use best` (route) | restores the longest finished plan for the current start planet, with its exact snapped angle and speed |
| gravity positions | radio group `planets` (static) / `ports` (`ports · moving`); launch base is always a static planet |
| `? help` / `h` | toggles the mission & guide drawer (`tourist` / `emperor’s emissary`) |
| space | pauses the trade background only (lab) |
| mode `career` / `lab` / `visit all tour` / `route length` / `money for visit` | one radio row: `lab` is the free lab, every other choice starts its seeded run at once (rebuilds the world at `t+07:00`, freezes it between flights, locks gravity at `1`); switching restarts the seed, `lab` stops the run |
| `tour` | 120 s flight cap, score systems → shots → time |
| `route` | 1 800 s wall, score trajectory length, no launch |
| `money` | 10 shots, score purse → systems → shots → time |
| career | solo catapult network: the vessel starts on a sunlit HQ with the only catapult; a launch fires from the pad under the ship and spends its solar-charged battery (ship + cargo mass caps the speed, the button shows `pad … kWh · shot … · max … px/s`, the pad plate under the planet shows charge and cap) · landing elsewhere strands the ship · `&cheat=communism` (everything free) / `&cheat=endgame` (all pads at top tier, purse 99) · ends `complete` with 26 catapults or `broke` |
| career drawer · planet select | picks the planet the shop builds on; it follows the ship until you pick another |
| career drawer · shop | one button per gear kind buys the next tier on that planet (`EMC-2 · 6.00`), `all N · …` applies it to every built pad of that kind and shows the total first; below, ship parts (`hold`/`tank`/`engine`) are bought and fitted at HQ only |
| career drawer · task board | delivery offers show `from → to`, good, tons, pay and time left with `accept` (needs a big enough hold and no other contract) / `drop`; the sport slot pays for one landing flight of at least the shown length |
| `wait · 30 min` (career) | runs the world clock 30 minutes while nothing flies: every pad charges, the board ages, planet profit grows |
| `evacuate` (career) | buys the stranded ship a flight home to HQ (fee shown on the button) |
| `abort` (game) | ends the running flight at the current step (recorded in the replay) |
| rivals `off` / `easy` / `normal` / `hard` | deterministic shared-market rivals in `tour`, `route` and `money` (`normal` default; `hard` fields 2 rivals with 1-ply lookahead) · switching restarts the seed |
| scoreboard (upper-left, game only) | compares `YOU`, `R1` and `R2` under the active rule’s score (mint, violet, rose) · every player row has its own `bot` checkbox (`user` ↔ `bot`, live at all times and restarts the run), and clicking any `user` player’s row switches which human player is currently active |
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
- **Route rule**: `route` is a deterministic planner (no ship flies). While
  dragging, the resumable tracer (`GravitySim.routeBegin/routeStep`) runs its
  first 4 ms slice immediately and continues across frames when needed, so
  finished plans are captured even during continuous drags. Each human player
  slot remembers its longest finished manual plan for the current start planet;
  `use best` stays pinned in the sticky Cargo HUD footer, highlights in gold
  whenever the current trajectory is shorter than the saved peak, and restores
  its exact snapped angle and speed (even after `clear plan`). Saved bests reset
  on start-planet change, restart, new seed, rule/player/field change, or return
  to lab.
- **Game mode, planet-profit market & rivals**: the world is rebuilt from a seed
  and advances only with fixed physics steps (`DT = 1/120 s`, field time
  `+= DT · rate`), so aiming takes any amount of real time. Aim snaps to
  `2^-20` turn and `2^-10` px/s, locking determinism to `(seed, rate, rule, bot,
  shots)`. Three rules share a `3.00` starting purse, `1.00` launch fee, and a
  shared 26-planet market where each planet's fly-visit payout grows while
  unvisited (`+0.25` at start, `+0.00625/s` up to `+0.75`, drawn beneath every
  planet and highlighted in green along your predicted trajectory): `tour`
  (26 systems, 120 s cap), `route` (1 800 s wall, ranked by trajectory length),
  and `money` (10 shots, ranked by final purse). `career` is solo and swaps the
  launch fee and market ranking for the pad network: every planet needs its own
  catapult, panel and battery, the battery pays each shot, and the purse comes
  from delivery/sport tasks plus fly-visit profit. Optional deterministic
  competitors (`easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead) fly in
  integer-step lockstep and compete for the same growing planet values without
  dropping 60 fps (`3 ms` / 64-candidate background slices). In the upper-left
  scoreboard, every player row (`YOU`, `R1`, `R2`) carries its own `bot`
  checkbox to assign `user` or `bot` control, and clicking any `user` row
  switches the active human player on the fly. Replay links
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
- `orbit_tech.js` — career tech tables (catapults, panels, batteries, holds, engines, tanks, helpers) and the launch model: rail energy / force speed caps, solar charge, battery leak, bulk upgrade cost
- `orbit_science.js` — knowledge hull (convex volume of discovered parameter vectors; cheap inside, `k·dist` outside) for the planned research screen, node-only so far
- `gravity_sim.js` — gravity field, planet-system visits, per-pass prediction log, headless `predictFast`, live `stepOne` flight & continuation, career launch gate (`setLaunchNetwork`, `canFire`, `speedLimit`, `relocate`)
- `gravity_game.js` — game rules (`tour`, `route`, `money`, `career`), aim grid, replay link codec (`rule`, `bot`, `cheat`), shared planet-profit market (`MONEY`, `createMarket`, `planetProfit`, `stepHarvest`, `estimateProfit`, `compareScores`), career state (pads, ship, task board from the colony economy, evacuation, end condition)
- `gravity_bot.js` — deterministic shared-market rivals for all game rules (`off`, `easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead, sliced search, `rivalLink`), plus the synchronous headless career controller (pad-only plans, live speed caps, task/pad/energy-wait scoring and between-flight shopping)
- `photo_deck.js` — postcard popup: type → file candidates, captions, compact layout, purse toast
- `gravity_gui.js` — overlay renderer, planet-profit pills & rival ships, aiming, hop lock & arrow, adaptive 60 fps HUD, game scoreboard, the flat mode row, career drawer (pad plate, shop, task board) & replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`, `route_bench.js`, `bot_bench.js`, `career_bench.js`,
  `career_bot_bench.js`), headless DOM smoke suite
  (`dom_smoke.js`) on the shared vm page stub (`dom_stub.js`), and a real-browser
  HUD layout check (`layout_check.js`, needs `CHROME_PATH`) that asserts the
  action row stays reachable and never reflows while aiming
- `photos/` — user art (`space/`, `landed/`), `README.md` (file spec),
  `prompts.md` (14 captions for Krea 2 / MOSS-Image) and `generator/`
  (`comfy_queue.py` queues the captions into ComfyUI and downloads the renders)
- `archive/` — standalone plans, worklogs and reference page
