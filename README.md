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

Open `index.html` (`file://` works, no build, no modules). The address carries
the current world seed and mode, for example `?mode=career&seed=42`; copy it to
regenerate the same world, or use `new seed` to update it. Other query options
such as `?view=field` are preserved. A copied replay adds a `#game=…` hash that
takes priority over the query; starting a new run removes the old replay hash.
Per-body lab edits, experimental multipliers and roster-size changes are not saved
in the seed URL; copied replays include their experimental multipliers.

Sound has four selectable generators in the cargo panel's collapsible **sound**
settings. The default **voronoi** combines trajectory aim cues with a polyphonic
flight sound adapted from [experiment-sound-voronoi](https://github.com/luncat8/experiment-sound-voronoi).
Its default **point tones** preset gives each planet a musical note; the alternate
**distance pitch** preset changes pitch with distance. Both use distance-based
volume and pulsing with stereo relative to the ship's heading. The persistent
**distance scale** slider tunes the world-to-experiment distance conversion
(default ×0.75; lower sounds closer). **Trajectory synth** keeps the previous
pentatonic and instrument flight mappings. **Selected samples** and **classic
synths** preserve the older manual launch cues. See [sounds/README.md](sounds/README.md).
The sound button, generator/preset/mapping choices and volume are persistent;
audio starts only after a user gesture and never changes physics or replays.

## controls

| input | action |
| --- | --- |
| drag from a planet | aim; direction is planet → grip, push grows with drag length · in career the whole range ends at the pad's live cap, so a full drag is always a shot the rail can fire |
| `sound on` / `sound off` | mute or enable all sound; playback starts after a user gesture and the choice is remembered |
| `sound` settings | choose **voronoi** (default), **trajectory synth**, **selected samples** or **classic synths**; choose aim mapping for the first two, flight mapping for trajectory synth, preset and distance scale for Voronoi, and master volume |
| hold shift while dragging | aim at 1/20 sensitivity |
| click a body | select a planet or moving port to tune its gravity in the lab (`-2…5`); keeps the armed shot · ports start with their parent planet’s seeded value and can be edited independently |
| `g` slider | gravity of the selected body; negative values repel · red `+` / blue `−` updates at once |
| `experimental` · `g field` slider | system-wide gravity multiplier (`×0…×9`, default `×1`) applied to every body's pull, every rival and every prediction |
| `experimental` · `catapult` slider | catapult rail-force multiplier (`×0.25…×3`, default `×1`): moves every tier's `maxSpeed`, the career pad cap and the drag range · both sliders stay live in lab and career, and lock at the recorded values while a replay runs (and outside career once a shot is recorded) · replay links carry `&gs=`/`&fs=` only when a scale is not `×1` |
| `experimental` · `stay-pay · per tick` | career only (the box is dark in every other mode) · the visit profit is always collected on the **first** encounter with a system — everything it accrued since the last one, paid the step the ship enters it — so a long flight that crosses the same system again later collects what regrew in between; with this on, every step the ship *stays* inside a system also collects what regrew during that step, so a slow or looping pass earns more than a fly-by and one system can pay a flight several times. Shots, the launch list and the rival plans are still priced by the entry rule, so their money is a floor: the HUD and the aim line say `≥ticks` while it is on. Links carry `&ht=1` |
| `±` trim slider | relative nudge (`-5%…+5%`) of the aim speed, of an armed in-flight `burn Δv`, or of selected gravity when no shot is armed |
| release drag | arms the shot/plan (or in-flight impulse burn) and draws the predicted net career outcome after the launch fee and a physically viable departure cost; green means profit, neutral means a loss, and red means there is no affordable way off the destination · it also shows profit per time of flight (`+0.25/s`), time of flight (`13.0 s`) and system visits · aiming at an accepted delivery pickup (`loads <N> t → <to>`) previews the post-pickup ship mass |
| enter / launch (bottom-right panel) | fires the vessel under `tour`/`money`, or pauses / burns / resumes during a `career` flight when fitted with an impulse engine and fuel; in career a click queues the shot — the button turns into `gun · N s` while the EMC barrel (one turn every `2…5 s` of world time) winds to the aim, then the shot leaves by itself (`click` or `Esc` cancels; re-aiming or a trim cancels it too); the career lives on the world clock, which the game pauses for you at every landing so you can aim in peace (launch, wait or the footer `▶ clock` button unpauses; the `pause at landing` checkbox in the trade footer turns auto-pause off) and which holds the barrels, pads and animations still while paused; the armed career launch labels itself with what the shot spends — `launch, 1.23 kWh` of your own pad battery, or the price of the fallback rail, e.g. `launch, 3.00`; while the ship sits on a planet, `buy EMC-1 · 3.00`, `commercial EMC-1 · 3.00` and `evacuate · 6.00` sit beside `launch` — the commercial choice is offered on every planet, never claims it and never blocks building; disabled for a `route` plan or bot-controlled YOU |
| auto helpers (bottom-right panel) | `quick scan`, `scan here` and `tweak best` sit in the separate bottom-right launch panel above `launch` / `clear` / `use best`; every career helper rejects destinations with no affordable, physically sampled departure across available EMC/battery gear and ranks the rest by net outcome; `best profit` and `profit + EMC` scan from the planet under the ship (34 aims, sliced over frames, the rule's 120 s cap), with the latter requiring a safe pad-build option; saved shots are priced by the same rule before each scan (no trace spent), and seed the search so a press keeps the saved shot when no fresh aim pays more (`launch list · P7 · +1.24`) or reports the fresh find otherwise (`best money shot · …`); a scan that finds nothing at all says so (`no EMC-buildable landing`); every finished trace joins the launch list |
| esc | closes help, cancels an armed burn / resumes a paused flight, or cancels the aim/plan |
| clear / clear plan | in the lab, resets the vessel; in `route`, removes the current plan while keeping the saved best · flights in game modes run to their natural end |
| `use best` (route) | restores the longest finished plan for the current start planet, with its exact snapped angle and speed |
| `view` · `space` / `gravity field` (`f`, `?view=field`) | switches between the starfield backdrop and a live gravity-field map where hue encodes pull direction and lightness encodes potential gradient (`|\mathbf{g}|`); uses a WebGL shader when available (dropping 4× in resolution if slow) or a 1/4-resolution 2D raster fallback; a lost WebGL context falls back to the starfield (`space · field lost`) and restores automatically on `webglcontextrestored` |
| gravity positions | radio group `planets` (static) / `ports` (`ports · moving`); launch base is always a static planet |
| `? help` / `h` | toggles the help drawer: shared controls first, followed by the selected mode’s goal, score and specific details |
| `−` / `+` panel header button | collapses or expands any HUD panel (`game scoreboard`, `career`, `orbital trade · background`, `gravity cargo`); panels in the left HUD column push each other from top to down, and the whole column scrolls vertically when panels extend past the viewport |
| space / `p` | in career flight, pauses at the current fixed-step boundary to aim an impulse burn (or resumes coasting); in lab, `Space` pauses the trade background |
| drag from the flying ship (career) | pauses the flight at the current step boundary and aims an impulse burn up to `min(fuel Δv, thrust Δv)`; `Enter` or `#launch` burns tank fuel and resumes along the continuation path (tanks refill automatically on built pads) |
| mode `career` / `lab` / `visit all tour` / `route length` / `money for visit` | one radio row: `lab` is the free lab, every other choice starts its seeded run at once (rebuilds the world at `t+07:00` with seeded planet gravity); switching restarts the seed, `lab` stops the run |
| `tour` | 120 s flight cap, score systems → shots → time |
| `route` | 1 800 s wall, score trajectory length, no launch |
| `money` | 10 shots, score purse → systems → shots → time |
| career | EMC network on a shared map: the vessel starts on a sunlit HQ with its only EMC, and two rival companies fly their own careers beside you (own purses, ships, pads, task boards, science hulls) · everyone launches whenever they like — the world clock runs continuously, auto-pausing for you at each landing by default · every planet offers a commercial tier‑1 EMC (`3.00` a launch) beside your own rail if you built one, so a landing is never a dead end; your own EMC fires free, any EMC pad spends the battery charge of its shot (a guest launch drains the host battery; the first to queue a launch reserves that energy), and a rival's rail also charges the energy it burns as usage tax, paid into that company's purse · building an EMC claims the whole planet, drawn as a ring in the owner's colour with a barrel turning once per `2…5 s`, on which your launch waits until it lines up with the aim · pads cost `EMC-1 3.00`, an evacuation home `6.00` · `&cheat=communism` (everything free) / `&cheat=endgame` (all pads at top tier, purse 99) · ends `complete` with a catapult on every active planet or `broke` |
| career drawer · upgrades tab · planet select | picks the planet the shop builds on; it follows the ship until you pick another · every entry states that pad's full-battery cap with the ship as loaded now (`P4 · 118 px/s · EMC-2 · R1`), `commercial`, `YOU` / `R1` / `R2`, or `cannot lift` |
| career drawer · upgrades tab · shop | one button per gear kind buys the next buildable record on that planet (`EMC-2 · 8.00`), `all N · …` applies it to every built pad of that kind and shows the total first; the rail and battery rows print the cap they would buy (`92 → 119 px/s`), and the panel row prints `+N kWh · ready in N s` from `light × power` and the pad's full-cap shot energy; below, ship parts (`hold`/`tank`/`engine`) are refitted at HQ only and print the stat they change and the HQ cap it costs (`8 → 24 t · 88 → 78 px/s`), with a free `back` button to the heaviest **owned** tier below the fitted one and `back no engine` to strip the engine (`Δv` of the whole fit is stated on the pad line and in every refit tooltip) · a price the purse cannot cover stays readable in red, while state gates (HQ only, cargo too big, no catapult) stay dim |
| career drawer · upgrades tab · task board | delivery offers show `from → to`, good, tons, pay and time left with `accept` (needs a big enough hold and no other contract) / `drop`; the sport slot pays for one landing flight of at least the shown length |
| career drawer · shots tab · launch list | the drawer has three tabs — `upgrades` (pad, task board, shop, evacuate), `shots` (this list) and `science` — and the list holds every saved trajectory of the company, fireable rows first, best live money first (`loop` returns to the same pad, `EMC` lands where no own EMC stands, `pad` lands on your own). The tab opens with the live rail line the bot log prints (`P4 · own EMC-2 · 8.20/9.00 kWh → 62 px/s (min 30) · fee 0.00 · purse 4.20 · exit 0.00`), then a count (`7 saved · 3 fireable here`), then one row per shot: destination, flight time and the money after the fee (`P7 · 12.4 s · +1.80`). A row that cannot fire now is dim, keeps its `use` button disabled and prints the reason on its own line — `cap 48 < 61 px/s`, `fee 3.00 > purse 0.50`, `shot leaves from P6`, `no rail under the ship`, `ship in space`, `moving field`, `a shot is already queued` — so a disabled button never needs a tooltip; a `use` click is refused with the same words. While the gravity positions are `ports` the list is paused (rows listed, all blocked) and nothing is dropped; a changed field (`g ×`, `catapult ×`, body gravity) makes the saved paths stale — the tab says `stale · N saved in another field` and offers `clear`, which drops them now instead of on the next save. Every finished trace is saved automatically (an armed preview that lands, and each candidate a helper scan finishes), same start planet + landing + visited systems keep only the faster arrival, and the weakest of ten rows leaves first; a new seed or a restarted career starts a clean list |
| career drawer · `copy` (upgrades and science) | every shop row has a `copy` button (the tier on offer, or the fitted one at max tier) that copies a paste-ready `tech: KIND ID { … }` balance line to the clipboard; on pages without clipboard access (`file://`) the line is shown in the drawer notice instead, and it stays enabled after the career ends |
| career drawer · science tab | Research panel over the convex knowledge hull: `engine` `(thrust, mass)`, `catapult` `(maxForce, efficiency)`, `tank` `(fuelCap, emptyMass)` and `battery` `(capacity, leak)` sliders, seeded from the tech tables (`FT-1..FT-3` for tanks, `BAT-1..BAT-5` for batteries), with a cost-surface plot (dashed box = per-axis researched range) and a live preview (inside the hull pays the base fee, outside pays base + `k·(dist + frontier)` in normalized RU, before the spec merit). Beyond the researched range each axis has its own `below`/`above` difficulty (`frontier ↓×… ↑×…`), so a light engine or composite ultralight tank is far dearer than a heavy one, high efficiency or large fuel capacity dearer than low, and a leak-tight battery dearer than a leaky one. The directional distance ignores performance reductions, so making any one attribute worse never raises the fee. The whole fee is then multiplied by the spec merit — how demanding the target is in absolute terms, one power curve per axis (`spec · thrust ×… · mass ×… → ×…`): par is the middle rung of the tech table (IMP-2, EMC-3, FT-2, BAT-3) and costs ×1.00, doubling a capability costs ×1.25, and doubling a waste — mass, leak, or the catapult's own losses `1 − efficiency` — divides the fee by 1.5, so a leakier battery or a lossier rail is genuinely cheaper to invent, not merely not dearer. The product of the axes is clamped to ×0.35–×2.50: the lab is never free and a corner is never priced out of the game. `copy knobs` copies the family's `frontier: … { below, above }` balance line (or shows it in the drawer notice on `file://`). `research` accepts the point into the hull (available anywhere, purse-gated, free under `communism`); the accepted point is unlocked as a prototype: an engine or tank joins the refit block (`fit`, free at HQ, with free `back` refit to owned ladder parts including on the same integer rung), a catapult or battery joins the pad rows (`build` on the selected planet or `all N` for the whole network under the tech tables' upgrade rule, priced by its rung); hull points and `R#` inventions are listed per family, and `copy` gives every prototype its balance line |
| `wait · 30 min` (career, bottom trade bar) | fast-forwards the world clock 30 minutes over 2 s with a cubic ease-in-out while nothing flies (the planet orbits visibly race, the pads recharge, the clock and `careerMsg` settle once at the end); the 2 s is nominal — each frame credits at most 20 ms (a 50 fps budget), so below ~50 fps the run stretches past 2 s instead of freezing the view; the button shows the % and its line the elapsed minutes, then a live settlement line and tooltip state beforehand the exact pad kWh gained, board ageing / rotating offers (or `drops contract!` warning) and galaxy visit-profit growth |
| `evacuate` (career) | buys the stranded ship a flight home to HQ (fee shown on the button) |
| rivals `off` / `easy` / `normal` / `hard` | deterministic shared-market rivals in `tour`, `route` and `money` (`normal` default; `hard` fields 2 rivals with 1-ply lookahead) · switching restarts the seed |
| scoreboard (upper-left, game only) | compares `YOU`, `R1` and `R2` under the active rule’s score (mint, violet, rose) · every player row has its own `bot` checkbox (`user` ↔ `bot`, live at all times and restarts the run), and clicking any `user` player’s row switches which human player is currently active |
| purse & planet profits (game) | starts at `3.00`; each launch costs `1.00` (refused below `1.00`); each planet's fly-visit payout grows with unvisited game time (`+0.24` initial, resets to `+0.00` when visited by you or a rival, `+0.00625/s` at first and saturating asymptotically towards `+3.00`, reached only at infinity) and is drawn as a live pill under every planet · the payout is collected on the **first** encounter with a system and the pill lights while the ship is inside it, going dark again the step it leaves, so the money and the highlight land together |
| `restart` / `new seed` | same seed fresh start / random world; the current seed is written to the URL |
| `copy replay` / `copy rival` | copies your replay link (with `&rule=` and `&bot=` when active) or Rival 1's solo trajectory link |
| `play ×N` `−` / `reset` / `+` (bottom trade bar) | live flight playback ×0.25…×8 (×1 default; in `career`, 4× faster default `×4` and range max `×32`); a replay adds ×0.25…×16 on top — only the pacing changes, never the physics steps or the recorded shots |
| `×1 / ×4 / ×16`, `skip` | replay multiplier / re-simulate the rest of a replay instantly |
| bottom trade bar | `pause` + `time` slider for the trade-clock rate (simulation minutes per real second), `play` multiplier, the career `wait · 30 min`, and `orbits` / `moons` / `links` / `routes` toggles (hidden under 820 px); its height is reserved out of both HUD columns |

## mechanics & visuals

- **Seeded gravity**: each planet draws a deterministic value from `−1…+3.5`
  in `0.05` steps, independent of its position and other planets. The player’s
  starting career HQ is always `1`; the other HQs use their planet’s draw.
  Restarting or reloading the same seed recreates the values. Inactive planets
  exert no pull and keep their values if added back. The G-field multiplier
  applies to these values; gravity can be edited per body only in the lab.
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
  every run (`verified ✓ · purse …`). Replays made before seeded gravity was
  introduced may no longer reproduce their old results.
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
- `orbit_science.js` — knowledge hull (convex volume of discovered parameter vectors; cheap inside, `k·dist` outside, distance solved exactly by Wolfe's min-norm active set) plus the directional frontier: per-axis min/max of discovered points and `below`/`above` difficulty weights add `k·frontier` beyond the researched range; the spec merit (`MERIT`: par on the middle rung of the tech table, `per2` per doubling of merit, `lower` axes and `mirror`ed bounded axes such as efficiency, clamped to `MERIT_MIN`–`MERIT_MAX`) multiplies the whole fee; per-career hull instances (`createHull`/`previewHull`/`acceptHull`/`statsHull`/`pointsHull`/`rangeHull`/`frontierWork`, `meritFactor`/`axisMerit`) and a family-only default-hull API; backs the career science panel and the node benches
- `gravity_sim.js` — gravity field, planet-system visits, per-pass prediction log, headless `predictFast`/`predictBurnFast`, live `stepOne` flight & continuation (`predictFlight`/`predictBurn`, `burn`), career launch & burn gates (`setLaunchNetwork`, `canFire`, `speedLimit`, `canBurn`, `burnLimit`, `relocate`), the `speedAt`/`gripLength` drag map with optional ceiling and floor, and the experimental `setScales` multipliers
- `gravity_game.js` — game rules (`tour`, `route`, `money`, `career`), seeded planet gravity, aim grid, the EMC network (`createGalaxy`, seeded turret periods & phases, `turretPeriod`/`turretAngle`, `padAt`/`padOwner`/`claimOwner`, `setCommercial`, `launchFee`, `exitCostAt`, `padLift`, `railText`/`railBlock`/`railOwnerText` — the live rail line and the one reason a shot cannot leave, shared by the page list and the bot decision log —, commercial pad, rival seeds), replay link codec (`rule`, `bot`, `cheat`, `gs`, `fs`, and `-b<step>.<angle>.<dv>` mid-flight burn suffixes), shared planet-profit market (`MONEY`, `createMarket`, `planetProfit`, `stepHarvest`, the experimental stay-pay `harvestStay`/`setHarvestMode`, `estimateProfit`, `compareScores`), career state (pads, ship fuel & refuel, `careerBurn`, task board from the colony economy, hull + directional frontier science research, evacuation, end condition), and the launch book (`createLaunchBook`, `recordLaunch`, `launchBookTag`/`bookReady`, `estimateProfitLog` — saved career trajectories with their visit logs, deduped by start planet + landing + visited systems on the faster arrival)
- `gravity_bot.js` — deterministic shared-market rivals for all game rules (`off`, `easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead, sliced search, `rivalLink`), the flying career rivals (`startCareers`/`stepCareer`: each runs a whole career with its own purse, pads, EMC claims and tax income, and is refinanced at its HQ after going broke), plus the synchronous headless career controller (`careerPlan`, contract-preserving mid-flight `careerBurnPlan`, cached physical departure checks, dead-end pad repair, task/pad/energy-wait scoring and between-flight shopping), with `setScales` fanning the experimental multipliers into every rival and probe sim
- `photo_deck.js` — postcard popup: planet type and career scene → file candidates, captions, CSS fallback art, compact layout, purse toast
- `gravity_sound.js` — sound controller plus the classic gesture-unlocked launch stages, procedural fallbacks and optional local selected audio
- `gravity_voronoi_sound.js` — polyphonic Voronoi presets and neighborhood selection; `gravity_voronoi_tones.js` — experiment point-tuning algorithm
- `gravity_trajectory_sound.js` — data-driven sonification: deterministic `get_tone_pentatonic` / `get_instrument` planet identities, aim profit/length/EMC and visit fly-through mappings, heading-relative flight bearings, reusable Web Audio voices and no media files
- `gravity_field.js` — gravity-field backdrop renderer (direction → hue, potential gradient → lightness; WebGL 1 shader with slow-frame 1/4 fallback, automatic context-restore notification, and zero-alloc LUT 1/4-resolution 2D fallback)
- `gravity_gui.js` — overlay renderer, planet-profit pills & rival ships, aiming, hop lock & arrow, adaptive 60 fps HUD, game scoreboard, the flat mode row, career drawer in three tabs (`upgrades`: pad plate, task board, shop; `shots`: the launch list; `science`: the research hull), the profit helpers seeded by the launch book, the EMC claim rings & turning barrels with the queued launch, the continuous career clock & landing auto-pause, the experimental gravity/force/stay-pay panel and replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`, `route_bench.js`, `bot_bench.js`, `career_bench.js`,
  `career_bot_bench.js`), headless DOM smoke suite
  (`dom_smoke.js`), focused seed/URL/help tests (`gravity_seed_test.js`), and
  career departure/guidance regressions (`career_departure_test.js`,
  `career_guidance_test.js`) on the shared vm page stub (`dom_stub.js`), and a
  real-browser HUD layout check
  (`layout_check.js`, needs `CHROME_PATH` and `puppeteer-core`) covering the
  action row, help drawer and seeded URL reload across viewport sizes
- `photos/` — user art (`space/`, `landed/`, `career/`), `README.md` (file
  spec), `prompts.md` (17 captions for Krea 2 / MOSS-Image: 14 planet views and
  3 career scenes) and `generator/` (`comfy_queue.py` queues the captions into
  ComfyUI and downloads the renders; `--situation career` writes the scene
  cards)
- `sounds/` — launch sound specifications, Stable Audio 3 ComfyUI workflows,
  prompt variations, queue/collector and offline selection instructions
- `archive/` — standalone plans, worklogs and reference page
