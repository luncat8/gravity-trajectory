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
| `restart` / `new seed` | same seed fresh start / random world |
| `copy replay` | copies a link with seed, rate, every launch and the result |
| `×1 / ×4 / ×16`, `skip` | replay speed / re-simulate the rest of a replay instantly |

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
- **Game mode**: the world is rebuilt from a seed and advances only with the
  cargo's fixed physics steps (`DT = 1/120 s`, field time `+= DT · rate`), so
  aiming takes any amount of real time. The aim snaps to `2^-20` turn and
  `2^-10` px/s, the port roster is frozen per flight and flights cap at 120 s,
  which makes the run a pure function of `(seed, rate, shots)`. Score: systems,
  then fewer shots, then less flight time (a full tour stops at the entry step
  of the 26th system). A replay link
  (`#game=1&seed=…&rate=…&shots=…&end=…`) re-flies every shot and reports
  `verified` when it reproduces the recorded result; play continues from there.
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
- `gravity_sim.js` — gravity field, planet-system visits, live flight & continuation
- `gravity_game.js` — game rules shared with the benches: aim grid, flight cap, replay link codec
- `gravity_gui.js` — overlay renderer, aiming, hop lock & arrow, adaptive 60 fps HUD, game mode & replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`), headless DOM smoke suite (`dom_smoke.js`) on the shared vm
  page stub (`dom_stub.js`)
- `archive/` — standalone plans, worklogs and reference page
