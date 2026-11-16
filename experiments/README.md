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
| slow | `--slow` | ~5 min | after a coherent feature: seed sweeps, the seat search, the page tests |
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
| `gravity_sim` tracing, field, predict | `gravity_bench` (parity + budget), `gravity_view_test` |
| `gravity_game` career/economy/laws | `career_wear_test`, `obs_test`, `politics_test`, `balance_changes_test` |
| career opening and the seat search | `career_start_seat_test`, `make_saved_maps.js --check` (stale records), `career_start_probe.js` |
| `gravity_bot` planning/scoring | `bribe_score_test`, `career_bench`, `career_bot_bench` |
| `gravity_gui`/`gui_*.js` page state | the one page test for the area (`politics_gui_test`, `obs_fragile_gui_test`, `career_pause_test`, `profit_monotonic_test`, …) |
| saved maps: `saved_map.js`, `gui_maps.js`, the `?map=` boot | `saved_map_test` |
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

## red on a clean main

`run_fast.js` marks these, runs them and does not sink the tier over them. It
prints why each one failed, so a new reason cannot hide behind the old note. A
green one means the note is stale.

- `bot_gravity_test` — the `careerNextPad` fixture never arms the bot's
  `exitProbe`, so every site values `-Infinity` and the pick is −1 (fixture,
  not law).
- `gravity_view_test` — two assertions. The drag-zone colours at seed 61
  (`blue` 112, wanted > 200; red since 0.7.1) stop the file, and behind them
  the visit-profit card is asserted as `+0.46` where the seed-42 page draws
  `+0.47`. With both logged instead of asserted the file reaches
  `GRAVITY VIEW OK`.
- `career_bench` (3), `career_bot_bench` (10) — known failures, listed with
  their names in `findings-pitfalls-skills.md`.

Left this list:

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
smaller question in seconds), `career_start_fairness.js`, `career_start_affordability.js`,
`career_level_probe.js`, `career_rival_probe.js`, `career_gui_bot_probe.js`,
`career_gui_repro.js`, `hq_gravity_probe.js`, `medic_offer_probe.js`,
`sci_merit_probe.js`, `build_cost_probe.js`, `layout_check.js`,
`balance_lab_smoke.js`, `sound_generator_test.py` and the `debug_*.js` scratch
files.

`make_saved_maps.js` generates `saved_maps.js`: it plans the seeds in its
`CONFIGS` and writes the records the search accepts (~20 s). With `--check` it
writes nothing and fails on every record that is no longer what the search
returns; that run closes the slow tier.
