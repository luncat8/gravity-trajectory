# gravity cargo

A ballistic grand-tour game and gravity lab on top of the `orbit_trade`
visualisation from `luncat8/exec_queue`. Launch from a planet, sweep inside
planets' port orbits using gravity assists, land cleanly, and stage the next
hop from where you landed. The `route` rule instead plans one longest possible
trajectory without launching it.

One flat mode row: **lab** (free clock, editable gravity) and four seeded rules
— **visit all tour**, **route length**, **money for visit** and **career** (a
shared-galaxy catapult network). Under `tour` and `money` the clock runs only
while cargo flies, `route` stays a deterministic planner, and `career` runs on
a continuous live clock with optional auto-pause on player landing; links stay
shareable.

## run

Open `index.html` (`file://` works, no build, no modules).

## controls

| input | action |
| --- | --- |
| drag from a planet | aim; direction is planet → grip, push grows with drag length · in career the whole range ends at the pad's live cap, so a full drag is always a shot the rail can fire |
| hold shift while dragging | aim at 1/20 sensitivity |
| click a body | select planet or moving port to tune its gravity (`-2…2`, default `1`); keeps armed shot |
| `g` slider | gravity of the selected body; negative values repel · red `+` / blue `−` updates at once |
| `experimental` · `g field` slider | system-wide gravity multiplier (`×0…×2`, default `×1`) applied to every body's pull, every rival and every prediction |
| `experimental` · `catapult` slider | catapult rail-force multiplier (`×0.25…×3`, default `×1`): moves every tier's `maxSpeed`, the career pad cap and the drag range · both sliders stay live in lab and career, and lock at the recorded values while a replay runs (and outside career once a shot is recorded) · replay links carry `&gs=`/`&fs=` only when a scale is not `×1` |
| `±` trim slider | relative nudge (`-5%…+5%`) of the aim speed, of an armed in-flight `burn Δv`, or of selected gravity when no shot is armed |
| release drag | arms the shot/plan (or in-flight impulse burn) and draws the predicted trajectory with profit (and a separate subtract of the cheapest exit cost when landing on a padless career planet, e.g. `+3.25-9` for a build or `+3.25-3` for the commercial rail), profit per time of flight (`+0.25/s`), time of flight (`13.0 s`), and system visits · in career, aiming at the pickup planet of an accepted delivery (`loads <N> t → <to>`) also previews the post-pickup pad speed cap of a starter `EMC-1` there, so you can see before launching whether it will lift the newly loaded ship |
| enter / launch (bottom-right panel) | fires the vessel under `tour`/`money`, or pauses / burns / resumes during a `career` flight when fitted with an impulse engine and fuel; in career a click queues the shot — the button turns into `gun · N s` while the EMC barrel (one turn every `2…5 s` of world time) winds to the aim, then the shot leaves by itself (`click` or `Esc` cancels; re-aiming or a trim cancels it too); the career lives on the world clock, which the game pauses for you at every landing so you can aim in peace (launch, wait or the footer `▶ clock` button unpauses; the `pause at landing` checkbox in the trade footer turns auto-pause off) and which holds the barrels, pads and animations still while paused; the armed career launch labels itself with what the shot spends — `launch, 1.23 kW` of your own pad battery, or the price of the fallback rail, e.g. `launch, 3.00`; while the ship sits on a planet, `buy EMC-1 · 9.00`, `commercial EMC-1 · 3.00` and `evacuate · 6.00` sit beside `launch` — the commercial choice is offered on every planet, never claims it and never blocks building; disabled for a `route` plan or bot-controlled YOU |
| auto helpers (bottom-right panel) | `quick scan`, `scan here` and `tweak best` sit in the separate bottom-right launch panel above `launch` / `clear` / `use best` |
| esc | closes help, cancels an armed burn / resumes a paused flight, or cancels the aim/plan |
| clear / clear plan | resets the vessel, or removes the current `route` plan; the saved best remains available |
| `use best` (route) | restores the longest finished plan for the current start planet, with its exact snapped angle and speed |
| `view` · `space` / `gravity field` (`f`, `?view=field`) | switches between the starfield backdrop and a live gravity-field map where hue encodes pull direction and lightness encodes potential gradient (`|\mathbf{g}|`); uses a WebGL shader when available (dropping 4× in resolution if slow) or a 1/4-resolution 2D raster fallback; a lost WebGL context falls back to the starfield (`space · field lost`) and restores automatically on `webglcontextrestored` |
| gravity positions | radio group `planets` (static) / `ports` (`ports · moving`); launch base is always a static planet |
| `? help` / `h` | toggles the mission & guide drawer (`tourist` / `emperor’s emissary`) |
| `−` / `+` panel header button | collapses or expands any HUD panel (`game scoreboard`, `career`, `orbital trade · background`, `gravity cargo`); panels in the left HUD column push each other from top to down, and the whole column scrolls vertically when panels extend past the viewport |
| space / `p` | in career flight, pauses at the current fixed-step boundary to aim an impulse burn (or resumes coasting); in lab, `Space` pauses the trade background |
| drag from the flying ship (career) | pauses the flight at the current step boundary and aims an impulse burn up to `min(fuel Δv, thrust Δv)`; `Enter` or `#launch` burns tank fuel and resumes along the continuation path (tanks refill automatically on built pads) |
| mode `career` / `lab` / `visit all tour` / `route length` / `money for visit` | one radio row: `lab` is the free lab, every other choice starts its seeded run at once (rebuilds the world at `t+07:00`, locks gravity at `1`); switching restarts the seed, `lab` stops the run |
| `tour` | 120 s flight cap, score systems → shots → time |
| `route` | 1 800 s wall, score trajectory length, no launch |
| `money` | 10 shots, score purse → systems → shots → time |
| career | EMC network on a shared map: the vessel starts on a sunlit HQ with its only EMC, and two rival companies fly their own careers beside you (own purses, ships, pads, task boards, science hulls) · everyone launches whenever they like — the world clock runs continuously, auto-pausing for you at each landing by default · every planet offers a commercial tier‑1 EMC (`3.00` a launch) beside your own rail if you built one, so a landing is never a dead end; your own EMC fires free, any EMC pad spends the battery charge of its shot (a guest launch drains the host battery; the first to queue a launch reserves that energy), and a rival's rail also charges the energy it burns as usage tax, paid into that company's purse · building an EMC claims the whole planet, drawn as a ring in the owner's colour with a barrel turning once per `2…5 s`, on which your launch waits until it lines up with the aim · pads cost `EMC-1 9.00`, an evacuation home `6.00` · `&cheat=communism` (everything free) / `&cheat=endgame` (all pads at top tier, purse 99) · ends `complete` with 26 catapults or `broke` |
| career drawer · planet select | picks the planet the shop builds on; it follows the ship until you pick another · every entry states that pad's full-battery cap with the ship as loaded now (`P4 · 118 px/s · EMC-2 · R1`), `commercial`, `YOU` / `R1` / `R2`, or `cannot lift` |
| career drawer · shop | one button per gear kind buys the next tier on that planet (`EMC-2 · 18.00`), `all N · …` applies it to every built pad of that kind and shows the total first; the rail and battery rows print the cap they would buy (`92 → 119 px/s`), and the panel row prints `+N kWh · ready in N s` from `light × power` and the pad's full-cap shot energy; below, ship parts (`hold`/`tank`/`engine`) are refitted at HQ only and print the stat they change and the HQ cap it costs (`8 → 24 t · 88 → 78 px/s`), with a free `back` button to the heaviest **owned** tier below the fitted one and `back no engine` to strip the engine (`Δv` of the whole fit is stated on the pad line and in every refit tooltip) · a price the purse cannot cover stays readable in red, while state gates (HQ only, cargo too big, no catapult) stay dim |
| career drawer · task board | delivery offers show `from → to`, good, tons, pay and time left with `accept` (needs a big enough hold and no other contract) / `drop`; the sport slot pays for one landing flight of at least the shown length |
| career drawer · `copy` | every shop row has a `copy` button (the tier on offer, or the fitted one at max tier) that copies a paste-ready `tech: KIND ID { … }` balance line to the clipboard; on pages without clipboard access (`file://`) the line is shown in the drawer notice instead, and it stays enabled after the career ends |
| career drawer · science | HQ research panel over the convex knowledge hull: `engine` `(thrust, mass)`, `catapult` `(maxForce, efficiency)`, `tank` `(fuelCap, emptyMass)` and `battery` `(capacity, leak)` sliders, seeded from the tech tables (`FT-1..FT-3` for tanks, `BAT-1..BAT-5` for batteries), with a cost-surface plot (dashed box = per-axis researched range) and a live preview (`inside hull · recombine` pays the base fee, outside pays base + `k·(dist + frontier)` in normalized RU). Beyond the researched range each axis has its own `below`/`above` difficulty (`frontier ↓×… ↑×…`), so a light engine or composite ultralight tank is far dearer than a heavy one, high efficiency or large fuel capacity dearer than low, and a leak-tight battery dearer than a leaky one; the surcharge is added to the hull distance, not substituted for it. `copy knobs` copies the family's `frontier: … { below, above }` balance line (or shows it in the drawer notice on `file://`). `research` accepts the point into the hull (HQ only, purse-gated, free under `communism`); the accepted point is unlocked as a prototype: an engine or tank joins the refit block (`fit`, free at HQ, with free `back` refit to owned ladder parts including on the same integer rung), a catapult or battery joins the pad rows (`build` on the selected planet or `all N` for the whole network under the tech tables' upgrade rule, priced by its rung); hull points and `R#` inventions are listed per family, and `copy` gives every prototype its balance line |
| `wait · 30 min` (career, bottom trade bar) | fast-forwards the world clock 30 minutes over 2 s with a cubic ease-in-out while nothing flies (the planet orbits visibly race, the pads recharge, the clock and `careerMsg` settle once at the end); the 2 s is nominal — each frame credits at most 20 ms (a 50 fps budget), so below ~50 fps the run stretches past 2 s instead of freezing the view; the button shows the % and its line the elapsed minutes, then a live settlement line and tooltip state beforehand the exact pad kWh gained, board ageing / rotating offers (or `drops contract!` warning) and galaxy visit-profit growth |
| `evacuate` (career) | buys the stranded ship a flight home to HQ (fee shown on the button) |
| `abort` (game) | ends the running flight at the current step (recorded in the replay) |
| rivals `off` / `easy` / `normal` / `hard` | deterministic shared-market rivals in `tour`, `route` and `money` (`normal` default; `hard` fields 2 rivals with 1-ply lookahead) · switching restarts the seed |
| scoreboard (upper-left, game only) | compares `YOU`, `R1` and `R2` under the active rule’s score (mint, violet, rose) · every player row has its own `bot` checkbox (`user` ↔ `bot`, live at all times and restarts the run), and clicking any `user` player’s row switches which human player is currently active |
| purse & planet profits (game) | starts at `3.00`; each launch costs `1.00` (refused below `1.00`); each planet's fly-visit payout grows with unvisited game time (`+0.24` initial, resets to `+0.00` when visited by you or a rival, `+0.00625/s` at first and saturating asymptotically towards `+3.00`, reached only at infinity) and is drawn as a live pill under every planet |
| `restart` / `new seed` | same seed fresh start / random world |
| `copy replay` / `copy rival` | copies your replay link (with `&rule=` and `&bot=` when active) or Rival 1's solo trajectory link |
| `play ×N` `−` / `reset` / `+` (bottom trade bar) | live flight playback ×0.25…×8 (×1 default; in `career`, 4× faster default `×4` and range max `×32`); a replay adds ×0.25…×16 on top — only the pacing changes, never the physics steps or the recorded shots |
| `×1 / ×4 / ×16`, `skip` | replay multiplier / re-simulate the rest of a replay instantly |
| bottom trade bar | `pause` + `time` slider for the trade-clock rate (simulation minutes per real second), `play` multiplier, the career `wait · 30 min`, and `orbits` / `moons` / `links` / `routes` toggles (hidden under 820 px); its height is reserved out of both HUD columns |

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
  unvisited (`+0.24` at start, `+0.00625/s` at first and saturating towards
  `+3.00`, drawn beneath every planet and highlighted in green along your
  predicted trajectory): `tour` (26 systems, 120 s cap), `route` (1 800 s wall,
  ranked by trajectory length), and `money` (10 shots, ranked by final purse).
  `career` swaps the launch fee and market ranking for a shared EMC network:
  every planet needs its own catapult, panel and battery, the battery pays each
  shot (a guest launch drains the host battery too), any planet can also fire
  its commercial rail at 3.00 a launch on demand, and rival companies fly their
  own careers on the same map — their pads charge usage tax when you fire from
  them, yours does the same to them, and a claimed planet keeps its owner's
  colour on the map. Optional deterministic
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
  drawn. One card per planet and per landing, per run. Career adds three
  optional scene cards (`photos/career/catapult|delivery|sport.jpg|png`), shown
  once per run on the first launch, delivery and sport win.
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
- `orbit_tech.js` — career tech tables (catapults, panels, batteries, holds, engines, tanks, helpers), research prototype records placed on those ladders (`engineRecord`, `catapultRecord`, `tankRecord`, `batteryRecord`, `interpolate`), and the launch & propulsion models: rail energy / force speed caps (with the optional experimental `forceScale`), ship mass with any slot refitted (`refitMass`), partial-tank rocket-equation `impulseDeltaV`/`impulseFuel`, thrust-capped single-burn `burnLimit`, solar charge, battery leak, bulk upgrade cost
- `orbit_science.js` — knowledge hull (convex volume of discovered parameter vectors; cheap inside, `k·dist` outside, distance solved exactly by Wolfe's min-norm active set) plus the directional frontier: per-axis min/max of discovered points and `below`/`above` difficulty weights add `k·frontier` beyond the researched range; per-career hull instances (`createHull`/`previewHull`/`acceptHull`/`statsHull`/`pointsHull`/`rangeHull`/`frontierWork`) and a family-only default-hull API; backs the career science panel and the node benches
- `gravity_sim.js` — gravity field, planet-system visits, per-pass prediction log, headless `predictFast`/`predictBurnFast`, live `stepOne` flight & continuation (`predictFlight`/`predictBurn`, `burn`), career launch & burn gates (`setLaunchNetwork`, `canFire`, `speedLimit`, `canBurn`, `burnLimit`, `relocate`), the `speedAt`/`gripLength` drag map with optional ceiling and floor, and the experimental `setScales` multipliers
- `gravity_game.js` — game rules (`tour`, `route`, `money`, `career`), aim grid, the EMC network (`createGalaxy`, seeded turret periods & phases, `turretPeriod`/`turretAngle`, `padAt`/`padOwner`/`claimOwner`, `setCommercial`, `launchFee`, `exitCostAt`, `padLift`, commercial pad, rival seeds), replay link codec (`rule`, `bot`, `cheat`, `gs`, `fs`, and `-b<step>.<angle>.<dv>` mid-flight burn suffixes), shared planet-profit market (`MONEY`, `createMarket`, `planetProfit`, `stepHarvest`, `estimateProfit`, `compareScores`), career state (pads, ship fuel & refuel, `careerBurn`, task board from the colony economy, hull + directional frontier science research, evacuation, end condition)
- `gravity_bot.js` — deterministic shared-market rivals for all game rules (`off`, `easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead, sliced search, `rivalLink`), the flying career rivals (`startCareers`/`stepCareer`: each runs a whole career with its own purse, pads, EMC claims and tax income, and is refinanced at its HQ after going broke), plus the synchronous headless career controller (`careerPlan`, contract-preserving mid-flight `careerBurnPlan`, dead-end pad repair, task/pad/energy-wait scoring and between-flight shopping), with `setScales` fanning the experimental multipliers into every rival and probe sim
- `photo_deck.js` — postcard popup: planet type and career scene → file candidates, captions, CSS fallback art, compact layout, purse toast
- `gravity_field.js` — gravity-field backdrop renderer (direction → hue, potential gradient → lightness; WebGL 1 shader with slow-frame 1/4 fallback, automatic context-restore notification, and zero-alloc LUT 1/4-resolution 2D fallback)
- `gravity_gui.js` — overlay renderer, planet-profit pills & rival ships, aiming, hop lock & arrow, adaptive 60 fps HUD, game scoreboard, the flat mode row, career drawer (pad plate, shop, task board), the EMC claim rings & turning barrels with the queued launch, the continuous career clock & landing auto-pause, the experimental gravity/force panel and replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`, `route_bench.js`, `bot_bench.js`, `career_bench.js`,
  `career_bot_bench.js`), headless DOM smoke suite
  (`dom_smoke.js`) on the shared vm page stub (`dom_stub.js`), and a real-browser
  HUD layout check (`layout_check.js`, needs `CHROME_PATH`) that asserts the
  action row stays reachable and never reflows while aiming
- `photos/` — user art (`space/`, `landed/`, `career/`), `README.md` (file
  spec), `prompts.md` (17 captions for Krea 2 / MOSS-Image: 14 planet views and
  3 career scenes) and `generator/` (`comfy_queue.py` queues the captions into
  ComfyUI and downloads the renders; `--situation career` writes the scene
  cards)
- `archive/` — standalone plans, worklogs and reference page
