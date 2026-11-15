# experiments/

Every check and every measurement script. The page never loads this folder: it is
node only, and each file is a standalone script that exits non-zero on failure.

`node experiments/run_fast.js --list` prints the four tiers with their costs;
`node experiments/run_fast.js` runs the fast one. Nothing here boots a browser
except the two files at the bottom.

## tiers

| tier | flag | cost | when |
|---|---|---|---|
| fast | (default) | ~1.5 min | after every edit: logic only, no page boot |
| slow | `--slow` | ~35 min | after a coherent feature: 17 page boots plus the long soaks |
| bench | `--bench` | ~35 min | when a law, a budget or a bot changed: numbers, not pass/fail |
| smoke | `--smoke` | ~25 min | once per plan, or when page boot, script order or wiring changed |

Costs are typical wall time on a two-core box and a busy machine is slower; the
per-file numbers are in `run_fast.js --list` and come from one measured pass. A
page test that boots a career pays one seat search before its first assertion
(~35 s), which is what makes the slow tier a plan-boundary run; a page test
without a career boots in seconds.

A test that only needs a world can boot a saved map instead of a seed: adding
`?map=<index|name>` to the page search skips the seat search and boots in about
half a second (`saved_map_test.js` does this, and `saved_maps.js` holds the
maps). Use `?rule=career&seed=...` when the seat search itself is the subject.

## what covers what

| touched | start with |
|---|---|
| `orbit_world`, `orbit_sim`, `orbit_econ` trade laws | `special_planets_test`, `orbit_clock_test`, `politics_test` |
| the seeded PRNG (`seedRandom`) and world geometry | `gravity_seed_test` (bench tier), `orbit_clock_test` |
| `gravity_sim` tracing, field, predict | `gravity_bench` (parity + budget), `gravity_view_test` |
| `gravity_game` career/economy/laws | `career_wear_test`, `obs_test`, `politics_test`, `balance_changes_test` |
| career opening and the seat search | `career_start_seat_test`, `saved_map_test`, `career_start_probe.js` |
| `gravity_bot` planning/scoring | `bribe_score_test`, `career_bench`, `career_bot_bench` |
| `gravity_gui`/`gui_*.js` page state | the one page test for the area (`politics_gui_test`, `obs_fragile_gui_test`, `career_pause_test`, `profit_monotonic_test`, …) |
| `index.html`, script order, composer, saved maps | `dom_smoke` once, plus `saved_map_test` |
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

`run_fast.js` marks these, runs them and does not sink the tier over them. A
green one means the note is stale.

- `bot_gravity_test` — the `careerNextPad` fixture never arms the bot's
  `exitProbe`, so every site values `-Infinity` and the pick is −1 (fixture,
  not law).
- `gravity_view_test` — drag-zone colours at seed 61, red since 0.7.1.
- `career_bench` (3), `career_bot_bench` (10), `bot_bench` (1) — known failures,
  listed with their names in `findings-pitfalls-skills.md`.
- `player_growth_test` — 17 rival-count rebuilds on one career page; it had not
  finished after 10 minutes at the base commit, so it sits at the end of the
  slow tier and is worth a timeout of its own.
- `profit_monotonic_test` was on this list ("helper profit search yields no
  number at seed 520383"): the search found a negative winner and the page
  prints a typographic minus, which the test's `[+-]` never matched. Fixed in
  the test.

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
`balance_lab_smoke.js`, `sound_generator_test.py`, the `debug_*.js` scratch
files, and `make_saved_maps.js` (regenerates `saved_maps.js` from seed offsets).
