# findings, pitfalls, skills

## headless browser in a bare sandbox

`@sparticuz/chromium` + `puppeteer-core` from npm gives a Chromium binary, but
this image lacks `libnss3`, `libnspr4`, `libnssutil3` and has no apt/network for
Debian packages (only npm/pypi/GitHub are reachable). Chromium only imports a
small, fixed set of NSS symbols, so three stub shared objects are enough:

- list the exact imports: `objdump -T /tmp/chromium | grep UND | grep NSS`
	(gives `symbol@NSS_3.x` pairs);
- generate one `void *sym(void) { return 0; }` per symbol, `NSS_VersionCheck`
	returning 1, and a linker version script mapping each symbol to the exact
	version node Chromium requires (`NSS_3.2`, `NSS_3.3`, `NSS_3.4`, `NSS_3.6`,
	`NSS_3.9.2`, `NSS_3.30`, `NSSUTIL_3.12.3`);
- link `libnss3.so` with that script, plus trivial `libnspr4.so` and
	`libnssutil3.so`;
- launch with `env: { ...process.env, LD_LIBRARY_PATH: '<dir>' }`.

TLS is dead with stubbed NSS, but `http://127.0.0.1` screenshots and pointer
automation work. Three extra details matter on Puppeteer v24+:

- pass `headless: chromium.headless` (`'shell'`) and `deviceScaleFactor: 1`
	(a 2x retina framebuffer can exhaust a 64 MB container `/dev/shm`);
- also export unversioned `PR_*` / `PL_*` symbols into `libnspr4.so`;
- implement `PR_Now()` with `clock_gettime(CLOCK_REALTIME, &ts)` in microseconds
	instead of returning `0`, otherwise software-composited screenshots stall
	waiting for a non-zero NSPR clock tick.

Kills the "no visual check possible" dead end.

`@sparticuz/chromium` 153 differences: ESM only (`import chromium from
'@sparticuz/chromium'`; `require` returns no `executablePath`) and
`chromium.headless` is undefined, so pass `'shell'` directly. A `file://` page
works without a server. Costs and traps observed with this page:

- each screenshot of the animating 1440x900 canvas takes ~8 s (JPEG) / ~14 s
	(PNG) with or without a real `PR_Now`; keep captures few;
- rAF timestamps are a synthetic 16.7 ms; measure frame cost with `Date.now()`
	deltas inside `requestAnimationFrame`;
- `waitForFunction` (rAF polling) hung past its timeout; poll with
	`page.evaluate` plus a 250 ms sleep;
- `file://` has no clipboard permission, which conveniently exercises the copy
	fallback.

## 60 Hz frame-time guards vs VSync timestamp jitter

Browsers coarsen `performance.now()` / `requestAnimationFrame` timestamps for
Spectre mitigation, so a steady 60.00 Hz loop delivers alternating deltas such
as `16.5 ms`, `16.7 ms`, `16.8 ms`. Comparing directly against `1000 / 60`
(`16.667 ms`) falsely classifies half of normal 60 fps frames as drops. Smooth
with an EMA (ignoring background-tab gaps `> 120 ms`) and put the drop threshold
at `17.5 ms` (~57 fps).

## HUD panels over an interactive canvas

Read-only HUD cards sitting in screen corners overlap edge world bodies (`P0`
under top-left, `P1/P15/P21` under top-right at `1280x800`). Give panel
containers `pointer-events: none` and opt interactive children (`button`,
`input`, `label`) back into `pointer-events: auto` so planets behind translucent
HUD text stay selectable and launchable.

### aiming through the panel

A panel that sits over the screen corner where the ship's pad happens to be is
a dead end when the canvas is the only pointer target: the press hits the
panel, nothing happens, and the player has no way to aim at all. Let the press
on the panel **padding** fall through to a world pick, but only when it lands on
a body the ship may launch from and only outside `button, input, select, label`
— then a normal drag starts. Panels are translucent and the pad is the biggest
thing there, so the hit is predictable; `pointer-events: auto` on controls keeps
every real control above it.

### one flat mode row instead of mode + rule

`lab | game` with a `[hidden]` rule group inside is two decisions for one
choice, and a JS-hidden box is a layout the CSS cannot see (the panel reserves
no space for it, `:has()` selectors cannot reach it). Ship one flat radio row
keyed by rule name (`lab` is the "no rule" value) and let the same table drive
labels, the help drawer preview, `?mode=`/`?rule=` parsing and the run restart;
a single `syncModeRadios()` called from the HUD refresh makes the DOM a function
of `game.on ? game.rule : 'lab'`, so links and console calls cannot desync it.

## DOM smoke test without a browser

`experiments/dom_smoke.js` loads the classic scripts in `node:vm` with a stub
`document`/canvas that records `fillText`/`stroke` counts, then dispatches the
real event handlers (`pointerdown`/`move`/`up`, `input`, `change`, `click`,
`resize`) and asserts the HUD text. Cheap regression net for interaction
plumbing that a physics-only benchmark cannot see.

Generated markup is exercised by firing the *panel's* `click` with a
`{ target: { dataset } }` shaped event (the page delegates and reads
`data-act` there) — the stub element has no real `dataset`, `closest` or
`contains`, so helper functions that use them must guard as the page does. Read
the real `data-*` values out of the rendered `innerHTML` instead of hard-coding
tier indices; that is what caught the hold table starting at tier 0.

The stub lives in `experiments/dom_stub.js` (`loadPage({ hash, clipboard })`)
and reads the script list, element ids and initial `disabled` / `hidden` /
`checked` attributes from `index.html`; hand-kept lists broke as soon as a
script was added. Its fake `performance.now()` only moves between frames, so
wall-clock budgets never trip: a flying cargo's continuation traces the full
240 s every frame. Keep vm flights short and do not read vm timings as
browser timings.

The stub's `navigator.clipboard.writeText` records the text synchronously and
then returns a resolved promise. Assert `env.clipboardText` right after the
click; anything done in the `.then()` (a "copied ✓" notice) is a microtask and
is still empty in the same synchronous segment. The no-clipboard fallback path
(notice set directly) is the one to assert synchronously. Also remember a newly
added script must go into `index.html` — a module that only worked under node
(`require`) stays `undefined` in the vm until its tag is added.

## throttled HUD vs pointer feedback

Throttling a whole HUD to ~10 Hz is fine for clocks and stats but hides the
effect of fine-grained input: the aim readout lagged the pointer and made a 1/20
sensitivity look 8x coarser. Split the readout that follows the pointer out of
the throttle instead of lowering the interval.

## precision mode needs delta accumulation, not absolute mapping

Mapping the grip straight to the pointer makes any "precise" mode impossible:
the moment the factor changes, the grip jumps back under the cursor. Accumulate
`grip += (pointer − lastPointer) * factor` instead, in floats (a 0.05 factor
applied to a 10 px event delta must stay 0.5 px, not be rounded), and always
update `lastPointer` on every event, also when no aim is active. Verified with a
real pointer in headless Chromium: 100 px of travel at 1/20 gave ~7 px/s of the
~290 px/s full range.

## deterministic replays over a real-time frame loop

- One time base for everything replayed: integer fixed steps. The secondary
	sim advances to an exact target (`advanceTo(fieldT)`) after each physics call
	instead of accumulating frame deltas; its event queue drains in time order,
	so random chunking reaches the same state (check with a fingerprint that
	includes exact `t`).
- Quantise inputs before anything uses them (angle `2^-20` turn, speed
	`2^-10` px/s) so prediction, flight, link and replay see identical doubles.
- Snapshot mutable inputs at launch (the port roster) and lock edits mid-flight.
- Prove it by replaying one recorded run at different cadences (144 Hz,
	4–45 ms jitter with 120 ms stalls, `×16`, synchronous skip) and comparing
	`String(double)` fingerprints, not rounded readouts.

## cross-engine float determinism

IEEE `+ − × ÷ sqrt` are exactly rounded everywhere; only `Math.sin`/`cos`/…
may differ by an ulp between engines. Measure instead of vendoring trig: nudge
inputs with `nextUp` (a `Float64Array` + `BigInt64Array` view, `i64[0] += 1n`)
and compare live flights. Here: 5 616 flight pairs, 0 outcome flips, max end
drift 1.4e-6 px. Measure on double state (`cargo.x`); the `Float32Array`
prediction buffers round away exactly the differences being measured.

## small pitfalls

- An author `display: flex/grid` rule beats the UA `[hidden] { display: none }`;
	add `[hidden] { display: none !important; }` once.
- `t += DT` drifts: 801 × `1/120` accumulates to `6.6750000000001215` (`6.68`)
	while `801 * DT` is `6.675` (`6.67`). Derive displayed times from step counts
	when they sit next to step-based scores.
- A greedy search with the page's own predictor finds 26 / 26 tours in two long
	shots or eight 20 s hops, so in benches scripted with it, assert that each
	planned shot actually fired: after completion, launches are locked.

## watching a deterministic sim at any speed

- Change the pace, not the steps: keep the fixed `DT` integrator, accumulate
	`dt · multiplier` and feed it in capped slices (`1/60 s`). A replay then stays
	a pure function of its shot list, which is exactly what the verification
	bench proves at ×0.25 and ×16.
- Cap the slices per frame (measured: 128 × 1/60 s is under 4 ms for 26 bodies)
	and clamp the total multiplier (×32) so a stall cannot turn into a catch-up
	spiral. Drain the accumulator when a flight ends, or the next shot starts
	with a burst.
- Keep world-rate and watch-speed separate. The world rate feeds `fieldT` and
	changes the physics; the watch multiplier must not, or a link recorded at one
	rate will not replay at another.

## optional user art without a manifest

- Resolve a picture by trying a candidate chain and advancing on the image's own
	`error` event (variant → plain, jpg → png); a miss costs one failed load and
	nothing else, and the CSS placeholder stays until a `load` fires.
- Remember the last URL that loaded and restore it synchronously: otherwise
	every reopen flashes the placeholder and refetches.
- Keep the fallback visual in the same element with a type class
	(`.photoArt.gas`), so the card's height and the layout maths do not depend on
	whether art exists yet.

## derived run state that must survive across flights

- When a per-flight log is derived from a run-cumulative mask (the purse from
  `visited`), keep the "already logged" mask run-cumulative too and reset only
  the log array at launch. Resetting both re-logs every previously visited
  system on the flight's first new visit — the money bench caught it as
  cumulative per-flight rows and an inflated purse in one run.
- Derive money (or any score side-state) in one place from integer step counts
  (`Δt = steps · DT`), never from wall time: the purse then replays
  bit-identically at any playback speed, and the link never has to carry it —
  recompute and show it in the verdict instead.
- Deduct a gated cost at the moment of gating (launch), pay the gains at event
  time; a state bit per condition in the launch-button cache keeps the label
  truthful when a flight ends while the button is already disabled.

## lockstep shared-market rivals and sliced search

- Check `liveSteps >= stepLimit` at the **end** of the `N`-th `stepOne()` (as
  well as guarding `stepLimit <= 0` at entry): checking only on entry leaves
  `status === STATUS_FLYING` after step `N` and requires a dummy `(N + 1)`-th
  loop pass during replay, advancing any external lockstep counter (`clockSteps`,
  rivals) one step further on replay than on a live `abort()`.
- Bound background search slices by **both** wall milliseconds (`3 ms`) and
  candidate count (`SLICE_CANDIDATES = 64`): in a real browser the wall budget
  protects `emaFrameMs` (`< 16.7 ms`), while in `dom_stub` (`performance.now()`
  fixed within a frame) the candidate cap prevents draining 1,440 lookahead
  traces in one tick and exercises multi-frame `thinking N %` paths.
- In a 26-planet growing market (`k · Δt` per planet), total map accrual scales
  with `26 · k`: `k >= 0.0125/s` (`0.325/s` across the galaxy) floods 10-shot
  purses past `$30`, whereas `k = 0.00625/s`, `init = +0.25`, `cap = 0.75`,
  `purse0 = 3.00` against a `1.00` launch cost forces players to chain 4+ aged
  planets and steer away from clusters recently harvested by rivals.


## numbers that decide a purchase

- Compute a shop's promise from the same function the engine gates on
	(`OrbitTech.speedLimit` with the *full* battery, the shipped mass and the
	experimental force scale), never from the currently charged pad and never
	from a copy of the formula. The drawer, the canvas plate and the launch
	button then cannot disagree, and a slider move only has to re-render.
- Say what a purchase *changes*: the rail row prints `92 → 119 px/s`, the
	battery row prints the cap it would add (usually nothing while the rail is
	the limit), and the panel row prints `+N kWh · ready in N s` from
	`solarCharge` and full-cap `launchEnergy`. Any action that advances the
	world (`wait · 30 min`) should preview its settled numbers from the exact
	step count and leak/charge/board/market formulas that execute it. A row or
	action without a number is one the player cannot judge.
- Put the deciding number before the gear id in a `<select>`: a narrow picker
	clips the tail, and `P4 · 118 px/s · EMC-2` survives that better than
	`P4 · EMC-2 · 118 px/s`.
- Mass is a purchase too: a heavier part buys nothing a lighter one does not, so
	every ship-part row prints what it adds (`8 → 24 t`, `40 → 90 kg`) **and** the
	HQ pad cap it costs (`88 → 78 px/s`, from the same `speedLimit` the launch
	button gates on). Without the second number the shop sells a downforce the
	player only discovers when the rail refuses to fire.
- Make refits reversible in the data, not in the markup: own every bought part
	(`career.owned[id]`), charge only for a part that is not owned, and price the
	starter fit as owned from the first frame — then "buy up" and "fit back down"
	are the same call and cannot drift. Offer the *heaviest owned tier below* the
	fitted one so a three-tier table still has a one-click way back.

## an armed drag input outlives its range

- When a control re-maps an input (a pad cap re-mapping the drag length), store
	the mapping's parameter (`aimCeiling`) next to the derived input and re-place
	the input whenever that parameter moves — in *both* directions, from *every*
	path that moves the ceiling (slider input, `wait`, build, ship refit, cargo
	load/drop). Clamping only downwards or only from the slider leaves the grip
	dot contradicting the armed shot after a shop or wait edit.

## any finite plan beats no plan

- A controller that returns the best-scoring candidate will happily fly a
	negative-score no-op when nothing scores better — the headless career flew
	"launch and land back on the same pad" 400 times. Score the no-op as
	`-Infinity` so "no plan" wins; the idle policy (wait for charge, upgrade the
	rail) then takes over. Flights that *do* pay on the way round (new systems, a
	sport landing) keep their finite score.
- Guard this with a scaled world, not just the default one: `g ×1.4 · f ×0.6`
	needs a stronger rail to leave the pad, so it is exactly the world where
	min-speed shots fall back home, and it went from "never finishes" to 26 pads
	in 69 flights once the no-op was rejected. The default seeds were
	bit-identical before and after, so only the scaled run could catch it.

## full-screen WebGL backdrop with a 1/4-res 2D fallback

- `gl_FragCoord.y` runs bottom-to-top while CSS/world `y` runs top-to-bottom:
	set `uOrigin.y = (cssH - offY) / scale` and `uStep.y = -(cssH / fbH) / scale`
	so the shader aligns pixel-for-pixel with the 2D canvases above it.
- Create the WebGL context with `{ alpha: false, preserveDrawingBuffer: true }`
	when caching static frames: skipping `drawArrays` on unchanged frames then
	keeps the rendered field intact across compositor frames and screenshots.
- In `dom_stub.js`, `getContext('webgl')` ignores its argument and returns the
	2D paint stub; guard WebGL init with `gl && typeof gl.createShader === 'function'`
	so headless tests exercise the 1/4-resolution 2D fallback cleanly.
- A canvas keeps the **first** context type it was given: `getContext('2d')` on a
	canvas that once had `webgl` returns `null` for the life of the element, so a
	`webglcontextlost` handler cannot "fall back to 2D in place" — the field just
	freezes. Rebuild the program/buffer on `webglcontextrestored`, reset any
	slow-frame resolution divider (`glDiv = 1`), and notify the GUI while keeping
	`viewDesired` separate from the active `viewMode` so the view restores
	automatically instead of stranding the tag on `'space · field lost'`.

## mid-flight burns: partial-tank rocket equation & step-boundary parity

- Burning `b` kg out of `f` kg on board acts on wet mass `m_dry + f`, not
	`m_dry + b`: use `g0 · Isp · ln((m_dry + f) / (m_dry + f - b))` and its
	inverse `f_burn = (m_dry + f) · (1 - exp(-Δv / (g0 · Isp)))`. Sequential
	partial burns then telescope (`Δv_1 + Δv_2 === Δv_full`) instead of quietly
	dropping fuel mass between burns.
- Apply and replay impulses at the integer step boundary (`liveSteps === step`)
	before `stepOne()`, and cap `predictBurn` by the remaining `stepLimit -
	liveSteps` steps (while copying `source.stepX/stepY` into external bot probes
	so moving-field stride alignment is preserved). Live flights, `predictBurn`,
	`predictBurnFast`, and `-b<step>.<angle>.<dv>` replay links then match
	step-for-step.

## convex-hull distance on real, nearly-collinear data

The knowledge-hull distance is a projected-gradient simplex projection
(`orbit_science.js`), fine on the bench's well-separated toy points. Real tech
tuples are nearly collinear and badly scaled (engine `(thrust 12..40, mass
1..2.5)`): with a fixed 200-iteration budget and step `1/‖P‖_F²`, re-previewing
an *already accepted* vertex returned a small nonzero distance, so researching
the same vector twice was mispriced above the base fee. Fix before the
iteration: an exact-vertex short circuit (component-wise `EPS` match →
`inside, dist 0`). Keep the iterative path for genuine interior/exterior
targets instead of "improving" the solver globally — the cheap exact check is
what the acceptance flow needs, and the bench's tolerance-sensitive toy cases
must stay unchanged. Also make hull state an instance (`createHull()`) from the
start: a module-global point table cannot be reset per career or isolated
between two runs in the same page.
