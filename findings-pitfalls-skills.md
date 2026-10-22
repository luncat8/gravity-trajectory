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

## DOM smoke test without a browser

`experiments/dom_smoke.js` loads the classic scripts in `node:vm` with a stub
`document`/canvas that records `fillText`/`stroke` counts, then dispatches the
real event handlers (`pointerdown`/`move`/`up`, `input`, `change`, `click`,
`resize`) and asserts the HUD text. Cheap regression net for interaction
plumbing that a physics-only benchmark cannot see.

The stub lives in `experiments/dom_stub.js` (`loadPage({ hash, clipboard })`)
and reads the script list, element ids and initial `disabled` / `hidden` /
`checked` attributes from `index.html`; hand-kept lists broke as soon as a
script was added. Its fake `performance.now()` only moves between frames, so
wall-clock budgets never trip: a flying cargo's continuation traces the full
240 s every frame. Keep vm flights short and do not read vm timings as
browser timings.

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
