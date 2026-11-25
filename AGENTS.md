# AGENTS.md


## style

- use a single tab indentation. LF end.
const $ = id => document.getElementById(id);

- avoid deep nesting of braces { } and long if-else.
- flatten with early returns, helper functions, or flat data tables.

- avoid duplication of code.

- avoid allocations in the hot path (per-frame loop, sim, render).
- no new {}, [], object literals, closures, or string concat in the frame loop.
- reuse preallocated buffers / typed arrays / scratch objects.
- allocate once at setup, mutate in place per frame.
- these are not strict rules, use best.

- plan*.md is NOT the implementation log. if need - update/improve plan, but keep final plan as artifact for possible fork or reimplementation without referring of what was and what done, without referring chat, etc.
- plan number i.e. 0.1.2 - is not version sequence. it is ok to continue old numbers by subject and implement in any useful order.

- only essential concise comments (in code and in worklogs) that really helpful i.e. explain why and decision. prefer descriptive naming.

- no legacy support, no old versions, no outdated browsers, no leftovers and no over protecting from unreal edge cases. we need clean architecture.

good:
obj.action(obj.data)
obj.data.action()

not good:
getObj().data().action()

## runtime

- file:// friendly, classic <script> tags, no modules, no build.
- guard module.exports so files also run under node.
- no internet links: vendor any lib as a local js file.

## concepts


## files

findings-pitfalls-skills.md - notes and pitfalls for LLM agents. write here if found good way to do something.

archive/ - for implemented plans and worklogs.

root `*-plan*.md` - open plans.

drafts/ - general human ideas about goals and design. minimal concise changes allowed, anvers from chat and approved decisions.
, indexed by `drafts/README.md` every section is the human's own words plus a `→` line saying where it stands in the code, and a note
still open ends with the one question a plan must answer first. `0.2.0-draft-economy-compare.md`
is the one draft kept at the root: signed-off decisions, cited by the economy plan.

experiments/ - measurement scripts (node), not loaded by the page.
experiments/logs/ - without long formatting, keep only useful data that helpful in future to compare and detect improvement vs regression;

### gravity gui

the gui is split one file per area (0.5, done): 25 `gui_*.js` classic scripts plus
`gravity_gui.js` (1,074 lines: state, element refs, wiring, boot — not an IIFE, and never
an empty re-export hub). never read the composer whole.
the areas still inside it are indexed by a banner comment; one grep gives the table of contents with
what each holds and the file it is slated to move into:

	grep -n "── " gravity_gui.js

then read only that line range and edit there. a typical edit needs one area, at most two;
the state it reads all lives in the composer, which a typical edit does not touch. plan: archive/0.5-plan-gui-split.md

every file below is in place. each area file reads the composer's state as ordinary globals — flat top-level scope, no imports, no module wrappers.

| file | lines | owns |
|---|---|---|
| `gui_tables.js` | 279 | constants, gear/tech/science/help tables, speed presets, rule copy, stats plot sizes/labels |
| `gui_help.js` | 62 | rule help drawer: open, pin, hold to preview |
| `gui_share.js` | 197 | url copy, replay/bot links, load from link, bot log |
| `gui_maps.js` | 505 | saved maps: the four buttons, the `?map=` boot, run capture and restore, status line |
| `gui_lite.js` | 107 | lite profile: `?lite=` / stored choice, the `#liteMode` box, saved-opening seeds and arming, still backdrop, sound and postcard gates |
| `gui_science.js` | 454 | hull plot geometry, merit and spec text, accept, sliders |
| `gui_shop.js` | 752 | cost/cap/pad/gear text, purse checks, shop buttons, EMC claims, part and proto rows |
| `gui_book.js` | 391 | task board, launch book, money trace, ranked launch list, rail lines |
| `gui_view.js` | 480 | view mode, canvas resize, HUD rects and hit tests, world<->screen, slot accessors, playback |
| `gui_route.js` | 266 | route plan rows, best-route record/restore, route leader |
| `gui_helper.js` | 594 | career helpers: goal table over the rule's landing factors, broad/focus/profit/quest scans, candidates, budgeted tick |
| `gui_replay.js` | 194 | replay lifecycle, per-shot aim replay, verdicts, skip |
| `gui_hud_game.js` | 220 | scoreboard, score meta, player/rival summaries, the career map-statistics strip |
| `gui_world.js` | 301 | planet universe and strengths, attach to the trade world, mode/bot/score radios, seed url |
| `gui_career.js` | 523 | career tabs, wait easing and settlement, build/bulk/part/accept/drop, evacuate, act |
| `gui_predict.js` | 551 | predicted gain/profit/rate readouts, experiment panel, aim trace, rule gating, blocked pad notes |
| `gui_hud_text.js` | 578 | paint entry, clock and end text, live HUD, launch state, status |
| `gui_flight.js` | 381 | flight HUD panel: state tag, ship facts and fuel gauge, refuel transaction, work rows and their guide arrow |
| `gui_aim.js` | 698 | grip drag and snap, fine trim, turret queue, burns, launch/fire, pointer + trim input |
| `gui_game.js` | 733 | start/stop game, career run, step loop, bot settle, flight end |
| `gravity_gui.js` | 1074 | composer: shared sims, element refs, game/replay/helperState/sound objects, boot, root.GravityScene — **plus every piece of mutable state the areas read** |
| `gui_draw_world.js` | 647 | wells, signs, prediction, trail, cargo, aim, markers, labels |
| `gui_draw_econ.js` | 369 | route pills, rival ships, planet profit pills, EMC rings, career pads |
| `gui_frame.js` | 208 | HUD throttle, syncField, the frame loop, fps pacing, fold and sound settings |

**load order matters**: `gui_tables.js` first (it owns `root` and `$`, and nothing else may declare them), then the areas, then `gravity_gui.js` last, because the composer declares the state they read. a moved block that reads composer state *at definition time* (a top-level `const` array of element refs, say) takes that declaration with it; top-level `addEventListener` wiring never moves, because it reads refs the composer declares. state and element refs belong with the area that owns them, and that is the target, not the current fact: the shared mutable state (`game`, `career`, `armed`/`aiming`/`aim*`, `hudAt`, `dirty`, the field refs) stays in `gravity_gui.js`, because an inventory showed each of those has 6–11 writing areas and no single owner — moving it would only spread the coupling. new element refs belong with the code that needs them at load time.

state and element refs belong with the area that owns them, never in a shared state/utils file.
root.GravityScene keys are a test contract (experiments/ read them) - keep the names.

### rule set, bot and copy

`GravityGame`, `GravityBot` and `CommsCopy` are each a core plus parts (0.7.53, done): the core
(`gravity_game.js`, `gravity_bot.js`, `comms_copy.js`) holds the vocabulary every part reads and
`PARTS`, the load order with one comment per file. find the file from `PARTS`, then read that part
alone; each part's header says what it owns and what it does not. plan:
archive/0.7.53-plan-js-split.md

	grep -n -A20 "const PARTS" gravity_game.js gravity_bot.js comms_copy.js

the big single files that stay whole (`orbit_view.js`, `gui_game.js`, `gravity_sim.js`,
`gui_draw_world.js`, `gui_shop.js`, `gui_helper.js`, `orbit_sim.js`, besides `gravity_gui.js`)
and the parts over ~600 lines are indexed the same way as the composer: `grep -n "── " file`.

how a part is wired (`experiments/parts_test.js` checks all of it):

- it takes names from the core and earlier parts on one `const { … } = inner;` line, and
  publishes at its end: `Object.assign(GravityGame, { … })` for public keys,
  `Object.assign(inner, { … })` for names a later part needs (shorthand only, never a rename).
- a call into a later part is `inner.name(…)`, at call time only, never while the part loads.
- a top-level `let` is read from another part through its accessor (`harvestModeOf()`,
  `politicsOn()`, `specialPlanetsOn()`, the scale getters, `openingTraces()`,
  `cachedPairTracks()`); a destructured `let` would be a stale copy. no cross-part writes.
- internal callers never go through the public object, so a test that patches
  `GravityGame.x` reaches only what it reached before.
- bot parts add `GravityBot.prototype` methods (shared through `this`); a part's own constants
  and public statics (`GravityBot.LEVELS = LEVELS`) live with it.
- a constant read by one part lives in that part; the core keeps what two or more read.
- node: the core requires its parts, and tests keep requiring the three cores; never `require`
  a part. page: each part is a classic script that calls `GravityGame.part(file, attach)`; the
  core refuses a part out of order and removes `part` after the last one (`CommsCopy` is frozen
  then).
- a new part goes into `PARTS` and `index.html` together, right after the core and its earlier
  parts.

| subject | rule | bot | GUI | fast check |
|---|---|---|---|---|
| mode caps, link codec, balance scales | `gravity_game.js`, `game_ship.js` (knobs) | `bot_setup.js` | `gui_share.js`, `gui_world.js` | `gravity_seed_test`, `balance_knobs_test` |
| visit profit, harvest, stay-pay | `game_market.js` | `bot_rivals.js`, `bot_career_score.js` | `gui_predict.js`, `gui_draw_econ.js` | `harvest_ticks_test`, `profit_monotonic_test` |
| pads, turrets, fees, launch reasons | `game_network.js` | `bot_career_shot.js` | `gui_flight.js`, `gui_aim.js`, `gui_shop.js` | `launch_reason_test`, `career_departure_test` |
| company start, gifts, endgame | `game_career.js`, `game_science.js` (gifts) | `bot_career_loop.js` | `gui_game.js`, `gui_world.js` | `career_space_start_test`, `gift_test` |
| wear, repair, fuel | `game_ship.js` | `bot_career_shop.js`, `bot_career_burn.js` | `gui_flight.js`, `gui_shop.js` | `career_wear_test`, `wear_flight_test` |
| building, parts, radar | `game_build.js` | `bot_career_shop.js`, `bot_career_score.js` | `gui_shop.js`, `gui_draw_world.js` | `radar_test`, `obs_test` |
| research, prototypes | `game_science.js` | `bot_career_assets.js` | `gui_science.js` | `obs_test` |
| fair start, seats, composition | `game_opening.js`, `game_seat_*.js` | — | `gui_game.js`, `gui_maps.js` | `seat_search_test`, `start_composition_test`, `career_start_fairness` |
| politics, bribes, arrest | `game_politics.js` | `bot_career_shop.js` | `gui_shop.js`, `gui_draw_econ.js` | `politics_test`, `bribe_score_test`, `politics_gui_test` |
| deliveries, medics, board | `game_contracts.js` | `bot_career_shop.js` | `gui_book.js`, `gui_career.js` | `fragile_test`, `special_planets_test` |
| sport race | `game_sport.js` | `bot_career_shot.js` (race entry) | `gui_book.js` | `competition_test` |
| departure solvency, two-leg quests | `game_departure.js`, `game_legs.js` | `bot_career_assets.js`, `bot_career_plan.js` | `gui_helper.js`, `gui_predict.js` | `two_leg_test`, `career_departure_test` |
| flight hooks, landing, evacuation | `game_flight.js` | `bot_career_shot.js` | `gui_flight.js`, `gui_career.js` | `career_evacuation_test` |
| launch book | `game_book.js` | `bot_career_plan.js` | `gui_book.js` | `career_bench` |
| non-career bots (tour/money/route) | `game_market.js` | `bot_rivals.js`, `bot_route.js` | `gui_route.js`, `gui_hud_game.js` | `bot_bench`, `route_bench` |
| impulse burns, fuel pricing, rescue | `game_ship.js` | `bot_career_burn.js` | `gui_aim.js`, `gui_flight.js` | `multiplayer_impulse_test`, `career_bot_bench` |
| H facts vs copy vs rendering | `comms_facts.js` / `comms_topics.js` / `comms_render.js` | — | `gui_comms.js` | `comms_facts_test`, `comms_topics_test`, `comms_call_test` |

## tests

- run the fast checks while working, not the whole `experiments/` folder. a change
	needs the files whose subject it touches and nothing more (seconds for a page test,
	1-2 min for a seed sweep, see the table below); most edits need none at all.
- **do not run `dom_smoke.js` per step.** it is ~3 900 lines and 41 page loads and
	takes ~2 min of CPU. run it once, when the plan (all steps of it) is complete and
	the code is otherwise final, or when the change is in the page plumbing itself
	(`index.html`, script load order, the composer, event wiring) where a physics test
	cannot see the break. never re-run it to "be safe" after a docs or test-only edit.
- a UI regression in one area does not need the whole file: run just that block in a
	scratch file (`loadPage` + `check` + the helpers the block reads, seconds), fix
	everything it reports, then one full `dom_smoke` at the end.
- `check` throws on the first failure, so a broken label costs one full run per label.
	Copy the file, swap `check` for a logger that prints `CHECKFAIL` and keeps going,
	run once, fix the whole list.
- start the slow ones (`career_bot_bench` ~5 min, the slow tier ~6 min,
	`dom_smoke` ~2 min) in the background on a snapshot and
	keep working; never block a turn on them, and never pipe them through `tail` (the
	output only appears at the end, so a hang and a long run look identical).
- a red test you did not cause is not yours to fix in passing unless the plan says
	so: check it at the base commit first, then write it in the worklog as known.
- one command per tier: `node experiments/run_fast.js` (fast, ~1 min),
	`--slow` (seed sweeps and page tests, ~6 min more), `--bench` (numbers),
	`--smoke` (dom_smoke), `--list` for the costs and the files. the tiers, the areas
	they cover and the handful of files that are red on a clean main live in
	`experiments/README.md`.
- say what happened: passed, failed, deferred, interrupted or timed out — a
	deferred smoke is never a pass, and an earlier pass does not validate later
	changes. compare bench failures by name, not by count; isolate a fixture in a
	scratch script before rerunning a whole bench, and never weaken an assertion to
	make a tier green.

| touch | run |
|---|---|
| `orbit_world`, `orbit_sim`, `orbit_econ` trade laws | `special_planets_test`, `orbit_clock_test`, `politics_test` |
| `gravity_sim` tracing, field, predict | `gravity_bench` (parity + budget), `route_bench` (long trace), `bot_gravity_test` (exit/claim decisions on a saved field) |
| `gravity_field` CPU raster and palette | `gravity_bench` (color + budget), `gravity_view_test` |
| `gravity_game.js`/`game_*.js` career/economy/laws | the part's row in the pairing table above, else `career_wear_test`, `obs_test`, `politics_test`, `balance_changes_test` |
| `gravity_bot.js`/`bot_*.js` planning/scoring | the part's row above, else `bribe_score_test`, `career_bench`, `career_bot_bench` |
| `comms_copy.js`/`comms_*.js` | `comms_facts_test`, `comms_topics_test`, `comms_call_test` |
| a part boundary: imports, publish lists, `PARTS`, a new part | `parts_test`, then the area test (and `dom_smoke` once if `index.html` changed) |
| the career seat search (`prepareCareerStarts` and below) | `career_start_fairness` (independent exit-safe pay band), `career_start_seat_test`, then `make_saved_maps.js --check`: a stale saved map needs the generator rerun |
| `gravity_gui`/`gui_*.js` page state | the one page test for the area (`politics_gui_test`, `obs_fragile_gui_test`, `career_pause_test`, `profit_monotonic_test`, …) |
| `index.html`, script order, composer | `dom_smoke` once, plus the area test |
| docs, plans, worklogs, test files only | nothing |

a career page boot plans the seats before a test's first assertion: ~3 s on a seed
link, ~5 s on a seed with no fair opening (`OPENING_EXACT_MISS`), ~0.2 s on the
saved map of that seed, which is the same run without the search
(`loadPage({ search: mapSearch(42) })` for `?rule=career&seed=42&rate=1`; add
`&rate=0.5` where the seed link carried no `rate=`). keep the seed link when the seat
search, the address or the seed itself is the subject. `saved_maps.js` is generated
(`experiments/make_saved_maps.js`), never edited by hand.
`career_start_probe.js SEEDS=42` asks the seat planner directly.

## sandbox

git push returns "Invalid username or token" is ok, no need to investigate or report - i will apply manually

## Workflow

- **Worklog**: 

start work with review previous task: it was done by another agent and you can find really better way to improve it or find some issues. dont need to run tests again because already done in previous stage.
then continue with next: review next step plan, if found good ideas - improve plan, implement.
record development steps and its validation in `archive/*-worklog.md`, end job with a next step suggestion.

example of file structure:
drafts/<subject>.md
archive/0.1.0-plan.md
archive/0.1.0-worklog.md
0.1.1-plan.md
gui.1-plan.md

a note that lands in the code keeps its line and gains a `→` marker; do not delete the human's words.

