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
- plan number i.e. 0.1 - is not version sequence. it is ok to continue old numbers by subject and implement in any useful order.

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

archive/ - for implemented plans

experiments/ - measurement scripts (node), not loaded by the page.
experiments/logs/ - without long formatting, keep only useful data that helpful in future to compare and detect improvement vs regression;

### gravity gui

the gui is split one file per area (0.5, done): 20 `gui_*.js` classic scripts plus
`gravity_gui.js` (1,025 lines: state, element refs, wiring, boot — not an IIFE, and never
an empty re-export hub). never read the composer whole.
the areas still inside it are indexed by a banner comment; one grep gives the table of contents with
what each holds and the file it is slated to move into:

	grep -n "── " gravity_gui.js

then read only that line range and edit there. a typical edit needs one area, at most two;
the state it reads all lives in the composer, which a typical edit does not touch. plan: 0.5-plan-gui-split.md

every file below is in place. each area file reads the composer's state as ordinary globals — flat top-level scope, no imports, no module wrappers.

| file | lines | owns |
|---|---|---|
| `gui_tables.js` | 239 | constants, gear/tech/science/help tables, speed presets, rule copy |
| `gui_help.js` | 63 | rule help drawer: open, pin, hold to preview |
| `gui_share.js` | 198 | url copy, replay/bot links, load from link, bot log |
| `gui_science.js` | 455 | hull plot geometry, merit and spec text, accept, sliders |
| `gui_shop.js` | 566 | cost/cap/pad/gear text, purse checks, shop buttons, EMC claims, part and proto rows |
| `gui_book.js` | 361 | task board, launch book, money trace, ranked launch list, rail lines |
| `gui_view.js` | 403 | view mode, canvas resize, HUD rects and hit tests, world<->screen, slot accessors, playback |
| `gui_route.js` | 267 | route plan rows, best-route record/restore, route leader |
| `gui_helper.js` | 472 | profit helpers: broad/focus scans, candidates, budgeted tick |
| `gui_replay.js` | 195 | replay lifecycle, per-shot aim replay, verdicts, skip |
| `gui_hud_game.js` | 222 | scoreboard, score meta, player/rival summaries |
| `gui_world.js` | 249 | planet universe and strengths, attach to the trade world, mode/bot/score radios, seed url |
| `gui_career.js` | 460 | career tabs, wait easing and settlement, build/bulk/part/accept/drop, evacuate, act |
| `gui_predict.js` | 498 | predicted gain/profit/rate readouts, experiment panel, aim trace, rule gating, blocked pad notes |
| `gui_aim.js` | 693 | grip drag and snap, fine trim, turret queue, burns, launch/fire, pointer + trim input |
| `gui_hud_text.js` | 553 | paint entry, clock and end text, live HUD, launch state, status |
| `gui_game.js` | 540 | start/stop game, career run, step loop, bot settle, flight end |
| `gravity_gui.js` | 1025 | composer: shared sims, element refs, game/replay/helperState/sound objects, boot, root.GravityScene — **plus every piece of mutable state the areas read** |
| `gui_draw_world.js` | 647 | wells, signs, prediction, trail, cargo, aim, markers, labels |
| `gui_draw_econ.js` | 307 | route pills, rival ships, planet profit pills, EMC rings, career pads |
| `gui_frame.js` | 216 | HUD throttle, syncField, the frame loop, fps pacing, fold and sound settings |

**load order matters**: `gui_tables.js` first (it owns `root` and `$`, and nothing else may declare them), then the areas, then `gravity_gui.js` last, because the composer declares the state they read. a moved block that reads composer state *at definition time* (a top-level `const` array of element refs, say) takes that declaration with it; top-level `addEventListener` wiring never moves, because it reads refs the composer declares. state and element refs belong with the area that owns them, and that is the target, not the current fact: the shared mutable state (`game`, `career`, `armed`/`aiming`/`aim*`, `hudAt`, `dirty`, the field refs) stays in `gravity_gui.js`, because an inventory showed each of those has 6–11 writing areas and no single owner — moving it would only spread the coupling. new element refs belong with the code that needs them at load time.

state and element refs belong with the area that owns them, never in a shared state/utils file.
root.GravityScene keys are a test contract (experiments/ read them) - keep the names.

## sandbox

git push returns "Invalid username or token" is ok, no need to investigate or report - i will apply manually

## Workflow

- **Worklog**: 

start work with review previous task: it was done by another agent and you can find really better way to improve it or find some issues. dont need to run tests again because already done in previous stage.
then continue with next: review next step plan, if found good ideas - improve plan, implement.
record development steps and its validation in `archive/*-worklog.md`, end job with a next step suggestion.

example of file structure:
0.1.x-draft.md - human write thoughts about goals and design
archive/0.1.0-plan.md
archive/0.1.0-worklog.md
0.1.1-plan.md
gui.1-plan.md
0.1.3-draft.md - you may also write user prompts as draft files to store reference of global task

