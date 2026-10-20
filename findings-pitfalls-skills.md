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
automation work. Kills the "no visual check possible" dead end.

## DOM smoke test without a browser

`experiments/dom_smoke.js` loads the classic scripts in `node:vm` with a stub
`document`/canvas that records `fillText`/`stroke` counts, then dispatches the
real event handlers (`pointerdown`/`move`/`up`, `input`, `change`, `click`,
`resize`) and asserts the HUD text. Cheap regression net for interaction
plumbing that a physics-only benchmark cannot see.

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
