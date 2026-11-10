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
shareable. The career/game clock is gameplay time; background trade/orbit settings
live in the orbital-trade panel. During a running game, orbit motion follows the
game clock so the animated map stays in sync with physics.

## run

Open `index.html` (`file://` works, no build, no modules). A seedless startup
draws a fresh random world; the address then carries the current world seed and
mode, for example `?mode=career&seed=42`. Copy it to regenerate the same world,
or use `new seed` to update it. An explicit `?seed=…` (or a replay hash seed)
pins the world on load. Other query options such as `?view=field` or
`?view=potential` are preserved. A copied replay adds a `#game=…` hash that
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

The scoreboard supports up to 16 rivals and 48 active planets. Each player `+`
activates one randomly chosen planet and starts the new rival there without
resetting the run; `−` removes the newest rival and leaves its planet in play.
Career HQs, A.R.F. and the Capital start at gravity 1. The usual presets remain
26 planets (13 in career) with their normal rival counts.

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
| enter / launch (bottom-right panel) | fires the vessel under `tour`/`money`, or burns an armed impulse during a `career` flight when fitted with an impulse engine and fuel; in career a click queues the shot — the button turns into `gun · N s` while the EMC barrel (one turn every `2…5 s` of world time) winds to the aim, then the shot leaves by itself (`click` or `Esc` cancels; re-aiming or a trim cancels it too); the career lives on the world clock, which the game pauses for you at every landing so you can aim in peace (launch or the game-bar `▶ time` button unpauses; wait explicitly advances 30 minutes even when paused; the `pause at landing` checkbox in the game bar turns auto-pause off) and which holds the barrels, pads and animations still while paused; the armed career launch labels itself with what the shot spends — `launch, 1.23 kWh` of your own pad battery, or the price of the fallback rail, e.g. `launch, 3.00`; while the ship sits on a planet, `buy EMC-1 · 3.04`, `commercial EMC-1 · 3.00` and `evacuate · 6.00` sit beside `launch` — the commercial choice is offered on every planet, never claims it and never blocks building; disabled for a `route` plan or bot-controlled YOU |
| flight hud (bottom-right panel) | one panel for the ship and its flight, in reading order: a state tag (`landed P#`, `coasting`, `flight paused`, `burn armed`, `scanning i/n`), the ship facts — `speed` (live in flight, the armed aim speed on a pad), `flight time`, `engine` with the fitted Δv, and in career a `fuel` gauge with a `refuel +N · <cost>` top-up: one step of fuel, paid from the pad's unreserved charge first and from the purse for the rest, so it reads `· free` when the charge covers it — then the `work` rows (the open contract's next stop and the competition planet; pointing at a row draws the guide arrow to that planet), the context action (`launch` … / `gun · N s` / the armed `burn · Δv N px/s`), and the scans |
| auto helpers (bottom-right panel) | `quick scan`, `scan here` and `tweak best` sit in the separate bottom-right flight panel below the action row; every career helper rejects destinations with no affordable, physically sampled departure across available EMC/battery gear and prices each landing with the rule’s one factor table — the **cash** it puts in the purse (harvest plus every taken contract leg: a delivery reward, patients home from a medical trip) and the **credit** of a leg that only advances a contract (loading cargo, boarding medics) — so the aim readout, the launch list, the scans and the rivals always agree; `tweak best` works on the shot the selected player has armed in every rule (in `route` it starts from the slot's saved best); `best profit` and `profit + EMC` scan from the planet under the ship (34 aims, sliced over frames, the rule’s 120 s cap) and rank by cash net of the EMC fee and the exit cost, the latter requiring a safe pad-build option; `quest scan` runs the same gate and the same 34 aims, ranks by cash plus `10 ×` the leg credit and points half of its aims at the planets the open work wants next, whatever kind of contract that is (`quest shot · P7 · +2.00 · patients`); every scan and the armed shot belong to the player that started them, and the buttons follow the selected player at once when a `bot` box is flipped; saved shots are priced by the same rule before each scan (no trace spent) and seed the search on the button’s own goal, so a press keeps the saved shot when no fresh aim pays more (`launch list · P7 · +1.24`) or reports the fresh find otherwise (`best money shot · …`); a scan that finds nothing at all says so (`no EMC-buildable landing`, `no paying shot found`, `no quest shot found`); every finished trace joins the launch list |
| esc | closes help, cancels an armed burn / resumes a paused flight, or cancels the aim/plan |
| clear / clear plan | in the lab, resets the vessel; in `route`, removes the current plan while keeping the saved best · flights in game modes run to their natural end |
| `use best` (route) | restores the longest finished plan for the current start planet, with its exact snapped angle and speed |
| `view` · `space` / `gravity field` / `potential` (`f`, `?view=field`, `?view=potential`) | `f` cycles the three backdrops. **field** maps pull direction to hue and potential gradient (`|\mathbf{g}|`) to lightness. **potential** maps the signed softened potential `φ = -Σ μg/r` to colour: negative wells blue, positive repulsive hills green, zero dark space; the red wash marks a heavy body's spread (`g ≥ +2`), i.e. the ground its pull reaches. Both use a WebGL shader when available (dropping 4× in resolution if slow) or a 1/4-resolution 2D raster fallback; a lost WebGL context falls back to the starfield (`space · field lost`) and restores automatically on `webglcontextrestored` |
| `view` · `main` / `full area` (`z`) | the camera frame: **main** fits the 1600×1000 planet field exactly as before; **full area** zooms out to the whole 2400×1500 flight area (the field plus a quarter of it on every side), so a ship that left the framed canvas is still on screen. The switch only moves the camera — the play area, the predictions and the replays are the same in either frame |
| gravity positions | radio group `planets` (static) / `ports` (`ports · moving`); launch base is always a static planet |
| `? help` / `h` | toggles the help drawer: shared controls first, followed by the selected mode’s goal, score and specific details |
| `−` / `+` panel header button | collapses or expands any HUD panel (`game scoreboard`, `career`, `orbital trade · background`, `gravity cargo`); panels in the left HUD column push each other from top to down, and the whole column scrolls vertically when panels extend past the viewport |
| space / `p` | in career, toggles the selected player's hold on the gameplay clock like the game-bar time button, in flight or while landed (with several human players the clock runs once every one of them has released; the scoreboard hatches the rows still holding); resuming cancels an armed burn; in lab, `Space` pauses/resumes background trade animation |
| drag from the paused ship (career) | aims an impulse burn up to `min(fuel Δv, thrust Δv)`; `Enter` or `#launch` burns tank fuel and resumes along the continuation path; the aim line and predicted net price the burn at `FUEL_PRICE × kg` · the burn belongs to the selected player's own ship, hand-flown rivals included: another player's coasting ship never takes over the launch row and cannot be burned from this seat, and a bot-flown ship burns only on its controller's schedule |
| mode `career` / `lab` / `visit all tour` / `route length` / `money for visit` | one radio row: `lab` is the free lab, every other choice starts its seeded run at once (rebuilds the world at `t+07:00` with seeded planet gravity); switching restarts the seed, `lab` stops the run |
| `tour` | 120 s flight cap, score systems → shots → time |
| `route` | 1 800 s wall, score trajectory length, no launch |
| `money` | 10 shots, score purse → systems → shots → time |
| career | EMC network on a shared map: the map plans the starting HQ set together for comparable first-flight pay and at least one unclaimed, starter-exitable landing site at G ≤ 1.5 per company; the vessel starts on a sunlit HQ with its only EMC, and two rival companies fly their own careers beside you (own purses, ships, pads, task boards, science hulls) · everyone launches whenever they like — the world clock runs continuously, auto-pausing for you at each landing by default · every planet offers a commercial tier‑1 EMC (`3.00` a launch, a flat operating fee) beside your own rail if you built one, so a landing is never a dead end; your own EMC fires free, any EMC pad spends the battery charge of its shot (a guest launch drains the host battery; the first to queue a launch reserves that energy), and a rival's rail also charges the energy it burns as usage tax, paid into that company's purse · building an EMC claims the whole planet, drawn as a ring in the owner's colour with a barrel turning once per `2…5 s`, on which your launch waits until it lines up with the aim · where a bot builds one it prices the site by sunlight plus the breadth of a starter launch (how many systems that EMC-1 + BAT-1 reaches, cached) minus the well's depth, and refuses a well the starter rail cannot leave · standing on its own pad a bot also sizes the gear there: the next panel, battery or rail is bought only when the money that pad's last launch made, per world second of its launch cycle, pays the price back inside `40 min` of world time, a rail is priced together with the battery that can fill it, and no buy may eat the `3.00` launch reserve · pads cost `EMC-1 3.04`, an evacuation home `6.00` · `&cheat=communism` (everything free) / `&cheat=endgame` (all pads at top tier, purse 99) · ends `complete` with a catapult on every active planet or `broke` |
| career drawer · upgrades tab · planet select | picks the planet the shop builds on; it follows the ship until you pick another · every entry states that pad's full-battery cap with the ship as loaded now (`P4 · 118 px/s · EMC-2 · R1`), `commercial`, `YOU` / `R1` / `R2`, or `cannot lift` |
| career drawer · upgrades tab · shop | one button per gear kind buys the next buildable record on that planet (`EMC-2 · 7.83`); rows are hidden where ownership makes them unavailable (a foreign base keeps only its rail/ownership explanation, a catapult-less planet hides panel/battery upgrades, and the ship refit block follows the vessel instead of the picked planet), `all N · …` applies it to every built pad of that kind and shows the total first; the rail and battery rows print the cap they would buy (`92 → 119 px/s`), and the panel row prints `+N kWh · ready in N s` from `light × power` and the pad's full-cap shot energy (`SP-2 · +1.90 kWh` at full sun); below, ship parts (`hold`/`tank`/`engine`) are refitted wherever the ship stands — any planet is a yard, only a vessel in flight cannot be — and print the stat they change and the cap the rail under the ship affords (`8 → 24 t · 88 → 78 px/s`), with a free `back` button to the heaviest **owned** tier below the fitted one and `back no engine` to strip the engine (`Δv` of the whole fit is stated on the pad line and in every refit tooltip) · a price the purse cannot cover stays readable in red, while state gates (in flight, cargo too big, no catapult) stay dim |
| career drawer · upgrades tab · fuel | `fuel current/cap kg` with a gauge, the kWh/money price of one 10 kg step, `charge → fuel` and `buy fuel`. A new career starts dry; launches, landings, refits, pad builds and evacuation never refill it. Conversion spends only your own pad's unreserved charge (`20 kg/kWh`); purchase works on any planet at `0.08/kg` and never overdraws the purse. Both need a fitted engine and tank. A full FT-1 (40 kg) costs 3.20, above the 3.00 commercial EMC fee, so fuel is the expensive detour/rescue option rather than the default hop |
| career drawer · upgrades tab · task board | delivery offers show `from → to`, good, tons, pay and time left with `accept` (needs a big enough hold and no other contract) / `drop`; the sport slot pays for one landing flight of at least the shown length |
| career drawer · shots tab · launch list | the drawer has three tabs — `upgrades` (pad, task board, shop, evacuate), `shots` (this list) and `science` — and the list holds every saved trajectory of the company the page is pointed at (switching players swaps the list, never leaves the previous company's rows behind), fireable rows first, best live money first (`loop` returns to the same pad, `EMC` lands where no own EMC stands, `pad` lands on your own). The tab opens with the live rail line the bot log prints (`P4 · own EMC-2 · 8.20/9.00 kWh → 62 px/s (min 30) · fee 0.00 · purse 4.20 · exit 0.00`), then a count (`7 saved · 3 fireable here`), then one row per shot: destination, flight time and the money after the fee (`P7 · 12.4 s · +1.80`). A row that cannot fire now is dim, keeps its `use` button disabled and prints the reason on its own line — `cap 48 < 61 px/s`, `fee 3.00 > purse 0.50`, `shot leaves from P6`, `no rail under the ship`, `ship in space`, `moving field`, `a shot is already queued` — so a disabled button never needs a tooltip; a `use` click is refused with the same words. While the gravity positions are `ports` the list is paused (rows listed, all blocked) and nothing is dropped; a changed field (`g ×`, `catapult ×`, body gravity) makes the saved paths stale — the tab says `stale · N saved in another field` and offers `clear`, which drops them now instead of on the next save. Every finished trace is saved automatically (an armed preview that lands, and each candidate a helper scan finishes), same start planet + landing + visited systems keep only the faster arrival, and the weakest of ten rows leaves first; a new seed or a restarted career starts a clean list |
| career drawer · `copy` (upgrades and science) | every shop row has a `copy` button (the tier on offer, or the fitted one at max tier) that copies a paste-ready `tech: KIND ID { … }` balance line to the clipboard; on pages without clipboard access (`file://`) the line is shown in the drawer notice instead, and it stays enabled after the career ends |
| career drawer · science tab | Research panel over the convex knowledge hull: `engine` `(thrust, mass)`, `catapult` `(maxForce, efficiency)`, `tank` `(fuelCap, emptyMass)` and `battery` `(capacity, leak)` sliders, seeded from the tech tables (`FT-1..FT-3` for tanks, `BAT-1..BAT-5` for batteries), with a cost-surface plot (dashed box = per-axis researched range) and a live preview (inside the hull pays the base fee, outside pays base + `k·(dist + frontier)` in normalized RU, before the spec merit). Beyond the researched range each axis has its own `below`/`above` difficulty (`frontier ↓×… ↑×…`), so a light engine or composite ultralight tank is far dearer than a heavy one, high efficiency or large fuel capacity dearer than low, and a leak-tight battery dearer than a leaky one. The directional distance ignores performance reductions, so making any one attribute worse never raises the fee. The whole fee is then multiplied by the spec merit — how demanding the target is in absolute terms, one power curve per axis (`spec · thrust ×… · mass ×… → ×…`): par is the middle rung of the tech table (IMP-2, EMC-3, FT-2, BAT-3) and costs ×1.00, doubling a capability costs ×1.25, and doubling a waste — mass, leak, or the catapult's own losses `1 − efficiency` — divides the fee by 1.5, so a leakier battery or a lossier rail is genuinely cheaper to invent, not merely not dearer. The product of the axes is clamped to ×0.35–×2.50: the lab is never free and a corner is never priced out of the game. `copy knobs` copies the family's `frontier: … { below, above }` balance line (or shows it in the drawer notice on `file://`). `research` accepts the point into the hull (available anywhere, purse-gated, free under `communism`); the accepted point is unlocked as a prototype: an engine or tank joins the refit block (`fit`, free wherever the ship stands, with free `back` refit to owned ladder parts including on the same integer rung), a catapult or battery joins the pad rows (`build` on the selected planet or `all N` for the whole network under the tech tables' upgrade rule, priced by its rung); hull points and `R#` inventions are listed per family, and `copy` gives every prototype its balance line |
| `wait · 30 min` (career, game bar) | fast-forwards the world clock 30 minutes over 2 s with a cubic ease-in-out while nothing flies (the planet orbits visibly race, the pads recharge, the clock and `careerMsg` settle once at the end); the 2 s is nominal — each frame credits at most 20 ms (a 50 fps budget), so below ~50 fps the run stretches past 2 s instead of freezing the view; the button shows the % and its line the elapsed minutes, then a live settlement line and tooltip state beforehand the exact pad kWh gained, board ageing / rotating offers (or `drops contract!` warning) and galaxy visit-profit growth |
| `evacuate` (career) | buys the stranded ship a flight home to HQ (fee shown on the button) |
| rivals `off` / `easy` / `normal` / `hard` | deterministic shared-market rivals in `tour`, `route` and `money` (`normal` default; `hard` fields 2 rivals with 1-ply lookahead) · a level is the controllers' skill, so switching it keeps a live run — its seed, clock, purses, pads and companies — and only the next decision is planned at the new level; outside a career the level also fields its rival count on the spot (and the scoreboard's `+`/`-` still sets a count it then keeps), while a career keeps its companies and only changes their skill; `off` is the one roster reset, so it starts the level's empty field · in `career` the same setting fields the rival companies, and ticking `bot` on your own row hands your company to the same controller: it shops between flights, prices a fuel top-up only for a launch it will actually fly, and fires through the normal turret queue, so the clock, HUD and flight end are unchanged; when the ship carries an impulse engine and fuel it also burns by itself — one early nudge when the modeled landing gain is clear, and a rescue whenever the coast would leave the area, time out or miss the active contract — and the burn is written into the shot so a replay re-flies it at the same step · when a drive is fitted the company also prices each queued launch by that same one-burn landing (fee, battery wait and tank fuel included), so the shot it chooses is the one its impulse can actually reach; when every ballistic pass finds nothing, it prices one bounded ring of launch angles by their one-burn landings before giving up the turn |
| scoreboard (upper-left, game only) | compares `YOU`, `R1` and `R2` under the active rule’s score (mint, violet, rose) · every player row has its own `bot` checkbox (`user` ↔ `bot`, live at all times: outside career it restarts the run, in career it hands the company over on the spot) and clicking any row — bot rows included — selects the player the panels, pads and shop follow; unticking a bot box gives that player the keyboard · in `career` an amber-hatched row with pause bars (`❚❚`) is a human player whose pause still holds the shared clock: time runs only while no row is hatched, each player releases only their own hold, and a bot row never holds |
| purse & planet profits (game) | starts at `3.00`; each launch costs `1.00` (refused below `1.00`); each planet's fly-visit payout grows with unvisited game time (`+0.24` initial, resets to `+0.00` when visited by you or a rival, `+0.00625/s` at first and saturating asymptotically towards `+3.00`, reached only at infinity) and is drawn as a live pill under every planet · the payout is collected on the **first** encounter with a system and the pill lights while the ship is inside it, going dark again the step it leaves, so the money and the highlight land together |
| `restart` / `new seed` | same seed fresh start / random world; the current seed is written to the URL |
| `copy replay` / `copy rival` | copies your replay link (with `&rule=` and `&bot=` when active) or Rival 1's solo trajectory link |
| `play ×N` `−` / `reset` / `+` (game bar) | live flight playback ×0.25…×8 (×1 default; in `career`, 4× faster default `×4` and range max `×32`); a replay adds ×0.25…×16 on top — only the pacing changes, never the physics steps or the recorded shots |
| `×1 / ×4 / ×16`, `skip` | replay multiplier / re-simulate the rest of a replay instantly |
| orbital trade · background → background animation settings | in the orbital-trade panel, pause/resume and set the world-time rate (background trade/orbit animation in the lab; gameplay world rate during a run); toggle orbit, moon, link and route layers. The background pause and layer controls are not in the footer; during a game the orbital scene follows the gameplay clock |

## mechanics & visuals

- **Play area**: the planet field is 1 600 × 1 000; a flight may run out to
  1.5× that in each direction (2 400 × 1 500, centred on the field) and ends only
  at the area's own edge, so a shot can leave the framed canvas and still land.
  The ratio is one constant in `orbit_world.js` (`AREA_SCALE`), and the sim, every
  prediction, every rival probe and the `full area` zoom derive from it.
- **Seeded gravity**: each planet draws a deterministic value from `−1…+3.5`
  in `0.05` steps, independent of its position and other planets. A new page
  without a URL seed picks a random seed; `restart` keeps it, `new seed` redraws it. A career
  map plans the full HQ set together for comparable first-flight profits, preferring sunlit
  homes when enough seats are available. Each HQ is pinned to base strength 1, then the set is
  validated in the final field: every company must have an unclaimed first-flight landing at
  G ≤ 1.5 that an EMC-1 + BAT-1 can physically leave. `HQ_GRAVITY_MAX = 1` is the conservative
  gravity band for standalone/fallback HQ selection, not the landing-site threshold. Restarting
  or reloading the same seed recreates the values. Inactive planets exert no pull and keep their
  values if added back. The G-field multiplier applies to these values; gravity can be edited
  per body only in the lab.
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
  slot remembers its longest finished manual plan for the current start planet,
  and the canvas traces only the selected player's plan — another human player's
  line leaves the map with the selection (its saved best waits for its turn),
  while the bot rivals' plans stay visible; `use best` stays pinned in the
  sticky Cargo HUD footer, highlights in gold
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
  `+3.00`, drawn beneath every planet on a two-line card with its gravity `g`
  and highlighted in green along your predicted trajectory; a claimed planet's
  card border uses the EMC owner's colour, neutral cards keep the profit palette): `tour` (26 systems, 120 s cap), `route` (1 800 s wall,
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
  scoreboard, every player row (`YOU`, `R1`, `R2`) carries its own live `bot`
  checkbox to hand that player to the bot or back to the keyboard, and clicking
  any row (bot rows too) selects the player whose career, pads, purse and shop
  the panels show; a career keeps its map and money across that switch. Replay links
  (`#game=1&seed=…&rate=…[&rule=…][&bot=…]&shots=…&end=…`) re-fly and verify
  every run (`verified ✓ · purse …`). Replays made before seeded gravity was
  introduced may no longer reproduce their old results.
- **Politics in career**: every planet carries shared `corruption` (`0…100`)
  that throttles its colony growth (`× 1 − C/100`), rises `0.1/s` once no
  emissary has called for 120 s and falls `0.2` per fly-visit, so the worlds a
  company skips rot while its regular stops stay clean. The rulers of a
  non-rebellious planet pay a bribe worth that visit's value — what the
  landing collected plus whatever regrew since — times the planet's rot
  fraction times `4`, so a clean lord pays nothing and a planet whose visit
  profit is low has already been reported to the Capital and is worth no
  bribe; a long sit on a rotten world is a parking income, priced by the
  arrest roll. Once per visit, in exchange for
  `1 + 0.1 · money` corruption and an arrest roll that is `0` at `C ≤ 50` and
  `0.5` at `C = 100`: an arrest ships the company to the Capital for 120 s with
  no fee, no reward and its medical cargo dropped. Past `50` rot a planet can
  rebel once per 60 s epoch (deterministic from the run seed); the rebellion
  seizes every pad there into one shared commercial rail, keeps its tiers and
  charge, forbids any further building, counts as covered for the catapult win
  and raises that planet's fly-visit payout towards `4×` over 240 s. The
  Capital and the A.R.F. world never rot, never bribe and never rebel. A
  rebellion seeds `8` patients at the Capital's medical slot: half a standard
  hold ferries medics out and patients home for `1.0` each, and the last
  patient pacifies the planet (rot clamped to `40`, its rail commercial for
  good). The pad block carries the bribe button from the moment the ship lands until this visit has paid one — it stays on the pad block, priced `+0.00` and dim on a clean world, because the offer is a state of the visit rather than a price, and any bribe the rulers actually pay is the player's to take (the `1.00` floor is a bot's policy, told in the tooltip); one landing elsewhere reopens it. The same block shows rot and the arrest countdown;
  a rebellion also draws a `REBELLION` pill and its rail in the rival colour.
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
- `balance_lab.html` — standalone single-screen balance lab: the sci fee surface of engine/catapult/tank/battery with the stock ladder tiers plotted and labelled (id · primary stat · build cost), the draft's fee/build/force callout, a vertical force line and the suggested rung, plus the live build cost of the ladder and the current draft, and balance sliders (frontier weights, metric scales, merit curves, k, base price, tier scale, merit band, build share) that re-draw the plot and the costs on every move; a **ladder gain** card reprices a whole tech table — pick a kind (the build-only panel and hold ladders included), keep one rung as the base, scale every step above it and read what each rung then buys in the player's unit (kWh per wait, px/s rail cap, kWh, t, Δv), the value-per-money curve with a `!` on any flat rung and `↓` on a thinning one, and the derived build cost against the shipped table, `copy table patch` handing back the ready `const PANELS = […]`-style block (specs only, since the game prices them); a collapsible help at the top explains the blocks and walks one such repricing end to end; copy-paste final settings for a balance chat; loads `orbit_science.js`/`orbit_tech.js`, file:// friendly, checked by `experiments/balance_lab_test.js` and `experiments/balance_lab_smoke.js`
- `exec_queue.js` — binary min-heap event queue (vendored)
- `orbit_world.js` — planet geometry (the 1600×1000 field and the 1.5× `AREA_SCALE` play area every sim derives its bounds from), stations on their ellipses, natural traits
- `orbit_econ.js` — colony economy laws: goods, resource map, growth
- `orbit_sim.js` — orbital trade & colony simulation
- `orbit_view.js` — trade renderer, coplanar Kepler moons & belts, camera `OrbitScene` with the `main` / `full area` frames (`setFrame`)
- `orbit_tech.js` — career tech tables (catapults, panels, batteries, holds, engines, tanks, helpers), research prototype records (`engineRecord`, `catapultRecord`, `tankRecord`, `batteryRecord`) priced from their spec, with `tier` as the shop ordinal (`interpolate`), and the launch & propulsion models: rail energy / force speed caps (with the optional experimental `forceScale`), ship mass with any slot refitted (`refitMass`), partial-tank rocket-equation `impulseDeltaV`/`impulseFuel`, thrust-capped single-burn `burnLimit`, solar charge, battery leak, bulk upgrade cost
- `orbit_science.js` — knowledge hull (convex volume of discovered parameter vectors; cheap inside, `k·dist` outside, distance solved exactly by Wolfe's min-norm active set) plus the directional frontier: per-axis min/max of discovered points and `below`/`above` difficulty weights add `k·frontier` beyond the researched range; the spec merit (`MERIT`: par on the middle rung of the tech table, `per2` per doubling of merit, `lower` axes and `mirror`ed bounded axes such as efficiency, clamped to `MERIT_MIN`–`MERIT_MAX`) multiplies the whole fee; build cost `buildCostOf` (`BUILD_SHARE` = 10 % of the research work from the origin, cents); per-career hull instances (`createHull`/`previewHull`/`acceptHull`/`statsHull`/`pointsHull`/`rangeHull`/`frontierWork`, `meritFactor`/`axisMerit`) and a family-only default-hull API; backs the career science panel and the node benches
- `gravity_sim.js` — gravity field bounded by the play area (`OrbitWorld.AREA_SCALE`), planet-system visits, per-pass prediction log, headless `predictFast`/`predictBurnFast`, live `stepOne` flight & continuation (`predictFlight`/`predictBurn`, `burn`), career launch & burn gates (`setLaunchNetwork`, `canFire`, `speedLimit`, `canBurn`, `burnLimit`, `relocate`), the `speedAt`/`gripLength` drag map with optional ceiling and floor, and the experimental `setScales` multipliers
- `gravity_game.js` — game rules (`tour`, `route`, `money`, `career`), seeded planet gravity, aim grid, the EMC network (`createGalaxy`, seeded turret periods & phases, `turretPeriod`/`turretAngle`, `padAt`/`padOwner`/`claimOwner`, `setCommercial`, `launchFee`, `exitCostAt`, `padLift`, `railText`/`railBlock`/`railOwnerText` — the live rail line and the one reason a shot cannot leave, shared by the page list and the bot decision log —, commercial pad, rival seeds), replay link codec (`rule`, `bot`, `cheat`, `gs`, `fs`, and `-b<step>.<angle>.<dv>` mid-flight burn suffixes), shared planet-profit market (`MONEY`, `createMarket`, `planetProfit`, `stepHarvest`, the experimental stay-pay `harvestStay`/`setHarvestMode`, `estimateProfit`, `compareScores`), career state (pads, finite ship fuel with `produceFuel`/`buyFuel`, `careerBurn`, task board from the colony economy, one landing factor table (`careerLandingFacts`: cash the purse takes plus the credit of a contract leg, and `careerGoalBodies`: the planets any open contract or competition wants next — read by the aim readout, the launch list, the helper scans and the rivals), hull + directional frontier science research, evacuation, end condition), and the launch book (`createLaunchBook`, `recordLaunch`, `launchBookTag`/`bookReady`, `estimateProfitLog` — saved career trajectories with their visit logs, deduped by start planet + landing + visited systems on the faster arrival)
- `gravity_bot.js` — deterministic shared-market rivals for all game rules (`off`, `easy`, `normal`, `hard` with 2 rivals + 1-ply lookahead, sliced search, `rivalLink`), the flying career rivals (`startCareers`/`stepCareer`: each runs a whole career with its own purse, pads, EMC claims and tax income, and is refinanced at its HQ after going broke), plus the synchronous headless career controller (`careerPlan`, the contract-preserving mid-flight impulse policy — `careerBurnPlan` two-stage search, `careerFlightBurn` one early nudge plus rescues, `careerBurnGain`, `careerPriceBurn` shortlist re-pricing and `careerRescueBurn` dead-end ring, committed-launch fuel forecasting (`careerPrepareFuel`/`careerCommitFuel`) with own-battery conversion first and purchase second, cached physical departure checks, dead-end pad repair, task/pad/energy-wait scoring, between-flight shopping and `careerPadGear` — panel/battery/rail buys priced as money per world second against the pad's own launch book, a rail always with the battery that fills it), with `setScales` fanning the experimental multipliers into every rival and probe sim
- `photo_deck.js` — postcard popup: planet type and career scene → file candidates, captions, CSS fallback art, compact layout, purse toast
- `gravity_sound.js` — sound controller plus the classic gesture-unlocked launch stages, procedural fallbacks and optional local selected audio
- `gravity_voronoi_sound.js` — polyphonic Voronoi presets and neighborhood selection; `gravity_voronoi_tones.js` — experiment point-tuning algorithm
- `gravity_trajectory_sound.js` — data-driven sonification: deterministic `get_tone_pentatonic` / `get_instrument` planet identities, aim profit/length/EMC and visit fly-through mappings, heading-relative flight bearings, reusable Web Audio voices and no media files
- `gravity_field.js` — gravity backdrop renderer: field (direction → hue, potential gradient → lightness) and signed potential (negative blue, positive green, red wash over the spread of a heavy body, `g²` compared against `HEAVY_G2_LO…HI`; `potentialAt`/`samplePotential` reference helpers); WebGL 1 shader with slow-frame 1/4 fallback, automatic context-restore notification, and zero-alloc LUT 1/4-resolution 2D fallback
- `gravity_gui.js` — overlay renderer, planet-profit pills & rival ships, aiming, hop lock & arrow, adaptive 60 fps HUD, game scoreboard, the flat mode row, career drawer in three tabs (`upgrades`: pad plate, task board, shop; `shots`: the launch list; `science`: the research hull), the profit helpers seeded by the launch book, the EMC claim rings & turning barrels with the queued launch, the continuous career clock & landing auto-pause, the experimental gravity/force/stay-pay panel and replays
- `experiments/` — node benchmarks (`gravity_bench.js`, `colony_bench.js`,
  `game_bench.js`, `route_bench.js`, `bot_bench.js`, `career_bench.js`,
  `career_bot_bench.js`, the seeded-gravity career bench
  `career_gravity_bench.js` with its `SPECIAL=0` / `POLITICS=0` A/B switches),
  headless DOM smoke suite (`dom_smoke.js`), the special-planet and politics
  benches (`special_planets_test.js`, `politics_test.js`, and the page-side
  `politics_gui_test.js` on the same stub), focused seed/URL/help tests
  (`gravity_seed_test.js`),
  potential-view/card tests (`gravity_view_test.js`), the standalone career
  start-fairness probe (`career_start_probe.js`), the page-side start-seat and
  standard-HQ-well check (`career_start_seat_test.js`), actual first-flight/EMC-1
  affordability regression (`career_start_affordability.js`), career
  departure/guidance regressions (`career_departure_test.js`, `career_guidance_test.js`) and
  the two-player helper/level switch (`multiplayer_career_test.js`,
  `helper_multiplayer_test.js`), the career clock with its per-player holds,
  scoreboard pause marks and per-player impulse loop (`career_pause_test.js`,
  `multiplayer_pause_preview_test.js`, `multiplayer_impulse_test.js`) and the
  mid-flight career skill switch
  (`career_level_probe.js`) on the shared vm page stub (`dom_stub.js`), and a
  real-browser HUD layout check
  (`layout_check.js`, needs `CHROME_PATH` and `puppeteer-core`) covering the
  action row, help drawer and seeded URL reload across viewport sizes; plus
  the balance lab checks (`balance_lab_test.js` — the page's pricing mirror
  against `orbit_science.js`, `balance_lab_smoke.js` — the page's UI in a
  minimal DOM stub), the science fee probes (`sci_merit_probe.js`,
  `build_cost_probe.js`) and career rival probes (`career_rival_probe.js`)
- `photos/` — user art (`space/`, `landed/`, `career/`), `README.md` (file
  spec), `prompts.md` (17 captions for Krea 2 / MOSS-Image: 14 planet views and
  3 career scenes) and `generator/` (`comfy_queue.py` queues the captions into
  ComfyUI and downloads the renders; `--situation career` writes the scene
  cards)
- `sounds/` — launch sound specifications, Stable Audio 3 ComfyUI workflows,
  prompt variations, queue/collector and offline selection instructions
- `archive/` — standalone plans, worklogs and reference page
