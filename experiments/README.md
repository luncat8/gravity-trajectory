# experiments/

Every check and every measurement script. The page never loads this folder: it is
node only, and each file is a standalone script that exits non-zero on failure.

`node experiments/run_fast.js --list` prints the four tiers with their costs;
`node experiments/run_fast.js` runs the fast one. Nothing here boots a browser
except the two files at the bottom.

## tiers

| tier | flag | cost | when |
|---|---|---|---|
| fast | (default) | ~1 min | after every edit: logic only, plus the saved-map contract |
| slow | `--slow` | ~6 min | after a coherent feature: seed sweeps, the seat search, the page tests |
| bench | `--bench` | ~23 min | when a law, a budget or a bot changed: numbers, not pass/fail |
| smoke | `--smoke` | ~2 min | once per plan, or when page boot, script order or wiring changed |

Costs are typical wall time on a two-core box and a busy machine is slower; the
per-file numbers are in `run_fast.js --list` and come from one measured pass. The
runner stops a file at ten times its listed cost (never under a minute) and
reports it as timed out; a red file prints why — the `FAIL` lines it names, or
its error message and where it was thrown.

A career page boot plans the opening seats, and that search is the one slow part
of a page load: ~3 s on a seed link, ~5 s on a seed with no fair opening
(seeds 10, 61, 73, 98 -- the walk stops at `OPENING_EXACT_MISS`; it was 13 s
before 0.7.10, see `logs/0.7.10-seat-search.txt`). A page test whose subject is
not that search boots the saved map of its seed instead:

```js
const { loadPage, mapSearch } = require('./dom_stub.js');
loadPage({ search: mapSearch(42) });                 // was ?rule=career&seed=42&rate=1
loadPage({ search: mapSearch(42) + '&rate=0.5' });   // was ?rule=career&seed=42
```

`mapSearch(seed)` is the `?map=<index>` of the career-default record of that
seed (13 planets, YOU + 2 normal rivals) and throws when `saved_maps.js` has
none. The map boot is the seed link's run without the search (~0.2 s): the same
seats, opening pay, captured state and `Math.random` stream, which
`saved_map_test.js` asserts. `you=` and `rate=` are read from the address as on
a seed link; a seed link without `rate=` runs the career's default clock, hence
the `&rate=0.5`. Three things differ, and a test that reads them keeps its seed
link: the universe and the roster come from the record (see below), the address
always carries `universe=`, `players=` and `rate=` afterwards, and the notice
line says `loaded <name>`.

A boot writes back what it started: `syncSeedUrl` names the universe
(`universe=`), the career roster (`players=`, only for a career, where
`game.playerCount` is real) and the seed, rule, bot, player, cheat and rate from
the live state, and drops `map=` and every param it does not read. So `?map=3`
becomes `?seed=4&mode=career&universe=26&players=3&rate=1` a moment after it
boots, and reloading that address runs the same map with no search (the plan is
cached per seed/universe/seats). `view=` is the one param left as found. A
record seats its own roster and universe: `?map=` does not take `players=` or
`universe=` from the address, and the next address says what it did use.

Keep `?rule=career&seed=…` when the seat search, the address or the seed itself
is the subject (`career_start_seat_test`, `gravity_seed_test`), and for a seed
with no fair opening: the registry is also the pool `load map` draws from, so
`make_saved_maps.js` refuses those. To add a seed, append it to the last
`CONFIGS` entry there and rerun the script; earlier records keep their index.

## what covers what

| touched | start with |
|---|---|
| `orbit_world`, `orbit_sim`, `orbit_econ` trade laws | `special_planets_test`, `orbit_clock_test`, `politics_test` |
| the seeded PRNG (`seedRandom`) and world geometry | `gravity_seed_test` (bench tier), `orbit_clock_test` |
| colonization and seeded planet mix | `found_colony_test`, `colony_distribution.js` (measurement, not reachability) |
| `gravity_sim` tracing, field, predict | `gravity_bench` (parity + budget), `route_bench` (long trace), `bot_gravity_test` (exit/claim decisions on a saved field) |
| `gravity_field` CPU raster and palette | `gravity_bench` (color + budget), `gravity_view_test` |
| `gravity_game.js`/`game_*.js` career/economy/laws | the part's row in the `AGENTS.md` pairing table, else `career_wear_test`, `obs_test`, `politics_test`, `balance_changes_test` |
| the stay-pay trace price (`estimateProfitLog` dwells) and launch-book `logDwell` | `harvest_ticks_test` (both rules, book round trip, heap), `bot_bench` (both-rule parity) |
| two-leg quest valuation (`careerLegPlan`) and `plan quest` (`#helperPlanQuest`) | `two_leg_test` (heavy/fragile/deadline gates, Capital escrow parity, bot/helper parity, `bookTrace` replay, heap) |
| career opening and the seat search | `seat_search_test` (read-only reports, sliced determinism), `career_start_fairness` (independent exit-safe pay band), `career_start_seat_test`, `make_saved_maps.js --check` (stale records) |
| route visit-log tracking | `route_log_test` (overlap, re-entry, masks, overflow, slice parity), `harvest_ticks_test` (economic parity) |
| `gravity_bot.js`/`bot_*.js` planning/scoring | the part's row in the `AGENTS.md` pairing table, else `bribe_score_test`, `career_bench`, `career_bot_bench` |
| a part boundary of `GravityGame`/`GravityBot`/`CommsCopy`: an import line, a publish list, `PARTS`, a new part | `parts_test` (each core's `PARTS` in `index.html` order, every import published earlier, every `inner.name` published, Node and page assembly give the same keys), then the area test |
| `gravity_gui`/`gui_*.js` page state | the one page test for the area (`politics_gui_test`, `obs_fragile_gui_test`, `career_pause_test`, `profit_monotonic_test`, …) |
| saved maps: `saved_map.js`, `gui_maps.js`, the `?map=` boot, the map picker | `saved_map_test` |
| `planet_gravity.js`, the map-generator helper page (`map_gen.js`, `map_fields.js`) | `map_gen_test` |
| compact career playback and bot history | `career_actions_test`, `career_history_seed_test` (handover), `career_evacuation_test` (reported P8 returns and tow) |
| full career save, clipboard fallback and H calls | `career_replay_test` |
| remembered view checkboxes: `trails`, `clean render` (`gravity.trails`, `gravity.cleanRender`) | `view_prefs_test` |
| the lite profile: `gui_lite.js`, the still backdrop in `orbit_view.js`, the boot pre-history, sound/postcard gates | `lite_mode_test` |
| the radar reveal: `radarShips`, the `radar` gift + build gate, the `predView`/`trailView` boxes and the `+N s` plate, the bot `careerRadarAvoid`/`careerRadarHot` | `radar_test` (career facility + reveal + memo + bot), `lab_radar_test` (the box outside career) |
| `index.html`, script order, composer | `dom_smoke` once, plus the area test |
| docs, plans, worklogs, test files only | nothing |

Search the folder for the feature name before choosing: a focused test can cover
one side of a change only, and the header of each file says what it asks.

## running and reporting

- Long runs: background them, send output to a file, and never pipe them
  through `tail` (progress and the exit status both vanish). If relevant files
  change during a run, it does not validate the final tree.
- Say what happened: passed, failed, deferred, interrupted, timed out. A
  deferred or timed-out run is never a pass, and an earlier pass does not
  validate later changes.
- Isolate a fixture in a scratch script before rerunning a whole bench, and
  never weaken an assertion to make a tier green; a diagnostic that skips
  assertions is not a passing test.
- Compare failures by name, not by count.

The `route_bench` 60 ms wall-trace and `gravity_bench` 16 ms fallback-raster
limits are actual work/frame targets, not scale factors inferred from the CPU.
0.7.12 kept both limits and reduced the work instead (a 216,000-step empty-space
trace and the field's common LUT path). A slower host can still report a timing
failure; compare old and new code on the *same* host before treating it as a
physics regression. Parity, pixel accuracy and the absolute timings are separate
checks.

## red on a clean main

Four files are exempt in `run_fast.js` `KNOWN_RED`; each was reproduced on the
base revision (`68905ee`) on 2026-11-24 with the named failure below, and a
green result means the note is stale. A new exemption needs a named failure
reproduced on the base revision, not just a count.

- `bot_gravity_test.js` — `score(6) finite, no build`: the exit/claim decision
  on a saved field scores a finite value without the build the assertion
  expects (`Number.isFinite(score(6)) && !bot.careerEval.builds`).
- `career_guidance_test.js` — `seed 1 has no starter-blocked landing for the
  aim-state fixture` on the base. Since 0.7.44 the 16-planet saved seed 1 has
  one (the fixture skips uninhabited worlds) and the file fails later at
  `restored departure rule should recover the green aim state`: the profit
  helper's earlier armed contract shot back onto the HQ prices neutral (−0.36).
- `career_bot_bench.js` — `padless solvency gate counts this flight's launch
  fee`: the same shot must score once the exit is covered after the fee.
- `dom_smoke.js` — `0.4.17: no landing with a commercial exit from HQ`.

Previously fixed:

- `bot_gravity_test`, `career_bench`, `career_bot_bench` (0.7.27): real field
  and ownership for pad choice; separate tourist and freight endpoints, compare
  loaded/dry on the same rail, and count the Capital's coverage and the free HQ.
  See [the replay comparison and checks](../archive/0.7.27-worklog.md).
- `gravity_view_test` — fixed in 0.7.11, no longer red. Its two stale
  expectations were the pre-pinning blue count (seed 61 career now shows 112
  blue px; bar lowered to > 50 with the reason in the test) and the `+0.46`
  card from the cap-3 era (cap 4 since 0.7.7 gives `+0.47`).
- `career_start_fairness` — fixed in 0.7.13 and now in the slow tier. The
  old max-min matcher called seed 4 and 6 unfair because it never lowered the
  best-paid seat; the pinned field was already correct. The independent
  exit-safe pay-window matcher finds a fair distinct assignment on all eight
  default seeds. `REFUSED_SEED=10` also checks the bounded refused walk, and
  `MATRIX=1` measures all `8, 13, 20, 26, 48 × 2..6` rosters on seeds `1-12`
  (`logs/0.6.8-roster-matrix.txt`). The gate covers the default roster only:
  `COUNT=13 SEATS=5 SEEDS=1-4` still reports no distinct buildable site for all
  four *chosen HQ sets* (see the open 0.6.8 plan, which traces the failures to
  max-floor `seatAssignment` and the `seatsWanted <= 4 && count <= 26` cutoff).
- `bot_bench` (0.7.9) — `BOT BENCH OK` at the 0.7.8 commit and after it; the
  "1 known failure" had no name on record.
- `player_growth_test` (0.7.9) — never red, only slow: 8 min at the 0.7.8
  commit, ~45 s now. Its two saved-map boots cost 0.2 s each; the rest is 19
  rival expansions, two restarts at 17 and 8 players (each a seat search no
  saved map covers) and one boot on seed 10, which has no fair opening to save.
- `profit_monotonic_test` (0.7.8) — "helper profit search yields no number at
  seed 520383": the search found a negative winner and the page prints a
  typographic minus, which the test's `[+-]` never matched. Fixed in the test.

## browser only

`field_gl_test.js` (the real GLSL against the CPU reference) and
`sound_browser_test.js` (file:// playback) need a real Chromium:
`CHROME_PATH=/path/to/chrome node experiments/field_gl_test.js`.

## probes

Ad-hoc scripts, not gates: `career_start_probe.js` (asks the seat planner a
smaller question in seconds), `career_start_affordability.js`,
`career_level_probe.js`, `career_rival_probe.js`, `career_gui_bot_probe.js`,
`career_gui_repro.js`, `hq_gravity_probe.js`, `medic_offer_probe.js`,
`sci_merit_probe.js`, `build_cost_probe.js`, `layout_check.js`,
`balance_lab_smoke.js`, `sound_generator_test.py` and the `debug_*.js` scratch
files.

`make_saved_maps.js` generates `saved_maps.js`: it plans the seeds in its
`CONFIGS` and writes the records the search accepts (~20 s). With `--check` it
writes nothing and fails on every record that is no longer what the search
returns; that run closes the slow tier.
