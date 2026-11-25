# drafts — index

Human design notes, reordered by topic. The wording is theirs and is kept as it
stood; only runs of spaces were collapsed. Section titles were added where a
numbered run needed a name, and a `→` line follows the notes it answers, saying
where they stand in the code today. An open note is marked `**open**`: it names
its plan (`→ 0.8.x / 0.9.x-plan-….md`) when it has one and otherwise ends with the one
question a plan must answer first. Every file is one big subject, and the subject
order below is also the order the notes should be read.

Every section title names its source after `←` (`archive/draft.txt` or
`0.4-draft-career.md`); a section without `←` is an agent's index, not a note.
Both originals were removed once their text was placed, and
`git show 423a494:<path>` brings either back.

| # | file | big subject |
|---|---|---|
| 1 | `flight-lab-and-modes.md` | the trajectory itself: prediction, gravity sources, bodies, maps and the rule row |
| 2 | `career-economy.md` | the catapult network: pads, batteries, refits, money, colonies, quests, the Capital |
| 3 | `politics-quests.md` | rot, bribes, arrest, rebellion, the medical mission, the observation device |
| 4 | `science-and-ship.md` | research hull, prototypes, balance knobs, cheats, the ship |
| 5 | `rivals-sport-competitions.md` | rival characters, sport competitions, map statistics plots, the bot competitor |
| 6 | `hud-input-and-help.md` | panels, drawers, controls, selections, landing gates, camera |
| 7 | `sound-and-photos.md` | the music of flight, the postcards, the image prompts |
| 8 | `bots-and-tools.md` | a bot that competes, the balance lab, test harnesses |
| 9 | `map.md` | periodic FFT gravity, space weather · new notes, not from the split |
| 10 | `found-colony-land.md` | empty heavy planets without EMC (`13 → 16`) and single-use colonization equipment |
| 11 | `lite-version.md` | lite profile (`?lite=1`): saved-map boot, quiet non-gameplay background, mute sound & photos |
| 12 | `map-fair-start-modes.md` | the fair-start contract: composition rule, 75 % exit margin, background search, space & capital starts |
| 13 | `new/game-options.md` | the start-gift budget: sliders, a per-company random draw + the rest as cash |
| 14 | `new/radar.md` | a global ship-trajectory + landing-time reveal, and bot avoidance |
| 15 | `new/adv-explorer-career.md` | explorer career: 32 planets, 4× map, FFT wrap, half empty, gas atmosphere, auction, hidden map, lone stars |
| 16 | `fuel-collector.md` | gas-atmosphere fuel collection: heavy endgame ship equipment |
| 17 | `new/battery-on-ship.md` | ship battery: 10× smaller than planetary, solar variant, energy-transfer slider |
| 18 | `new/observation-device-OBS-1.md` · `new/observation-satellite.md` | OBS-1 visit profit, uninstall on rotten planets, half-power OBS-0.5 satellite |
| 19 | `GUI.md` · `balance.md` · `save.md` · `other.md` · `time-scale-units.md` | small notes: bot-log copy, preview diff, URL vs storage, visit-profit/bribe rebalance, replay/save, endgame, time units |

What is *not* here:

- `../0.2.0-draft-economy-compare.md` — a measured comparison with
  `galaxy-flythrough@31c6d5a`, decisions signed off. Kept at the root because
  the economy plan cites it as a reference, not as a wish list.
- one line of `archive/draft.txt` (L232) that was an instruction rather than a
  note — *"make plans 0.5.x and start to implement"*. The plans below are what it
  asked for; it is not carried as text.

## where every original heading went

Search this table for a heading as it was written.

### `archive/draft.txt`

| line | original heading | now |
|---|---|---|
| 1 | *(no heading: the first experiment, the deterministic mode, the photo popup)* | `flight-lab-and-modes.md` §1.1, §1.2 · `sound-and-photos.md` §7.3 |
| 77 | `### game mode: max trajectory length` | `flight-lab-and-modes.md` §1.2 |
| 83 | `### game mode: money per visit` | `flight-lab-and-modes.md` §1.2 |
| 89 | `## bot competitor` | `rivals-sport-competitions.md` §5.4 |
| 93 | `## auto helper tools` | `hud-input-and-help.md` §6.3 |
| 105 | `## url parameters to run specific game mode to fast start visual test` | `flight-lab-and-modes.md` §1.3 |
| 109 | `## default game mode career. save last used mode` | `flight-lab-and-modes.md` §1.3 |
| 111 | `## possible change number of players, planets` | `flight-lab-and-modes.md` §1.3 |
| 123 | `## balance plan` | `flight-lab-and-modes.md` §1.4 |
| 132 | `## random gravity of planets -1...+5` | `flight-lab-and-modes.md` §1.4 |
| 137 | `## HTML GUI` | `hud-input-and-help.md` §6.1, §6.2 |
| 157 | `## science research` | `science-and-ship.md` §4.2 |
| 164 | `## sound` | `sound-and-photos.md` §7.1 |
| 183 | `## balance and GUI` | `career-economy.md` §2.6, §2.7 |
| 195 | `### balance_lab.html` | `bots-and-tools.md` §8.2 |
| 211 | `### price` | `science-and-ship.md` §4.3 |
| 215 | `## ui` | `hud-input-and-help.md` §6.6 |
| 222 | `### gravity potential view map` | `hud-input-and-help.md` §6.6 |
| 234 | `## fuel` | `career-economy.md` §2.8 |
| 241 | `## Special planets` | `career-economy.md` §2.4 · `flight-lab-and-modes.md` §1.3 (`players count change…`) |
| 254 | `## Corruption (numbers are subject to balance)` | `politics-quests.md` §3.1 |
| 277 | `## bribe` | `politics-quests.md` §3.2 |
| 284 | `## helpers` | `politics-quests.md` §3.5 |
| 290 | `## map statistics plots` | `rivals-sport-competitions.md` §5.3 → `../archive/0.6.10-plan-map-statistics.md` |
| 299 | `## implement bot character that prefer` | `rivals-sport-competitions.md` §5.1 |
| 305 | `## implement competitions:` | `rivals-sport-competitions.md` §5.2 |
| 311 | `### competitions` | `rivals-sport-competitions.md` §5.2 |
| 319 | `#### competition variations:` | `rivals-sport-competitions.md` §5.2 |
| 323 | `#### think about new competitions or variations if found really interesting` | `rivals-sport-competitions.md` §5.2 |
| 326 | `## impulse engine fly and flight HUD panel` | `hud-input-and-help.md` §6.5 |
| 338 | `## auto pause and pause in game modes that allow pause. useful to avoid players waste game time` | `hud-input-and-help.md` §6.5 · `career-economy.md` §2.8 (`while landed show refuel button…`) |
| 349 | `## refactoring time` | `career-economy.md` §2.9 |
| 355 | `## career map generator improve` | `flight-lab-and-modes.md` §1.4 |
| 359 | `### flight HUD panel.` | `hud-input-and-help.md` §6.4 |
| 372 | `## observation device` | `politics-quests.md` §3.4 |
| 379 | `## bribe button` | `politics-quests.md` §3.3 |
| 383 | `## EMC catapult` | `career-economy.md` §2.10 |
| 386 | `##` *(empty)* | `career-economy.md` §2.11 |
| 389 | `## add quest` | `career-economy.md` §2.4 |
| 393 | `## deferred` | `flight-lab-and-modes.md` §1.5 |

### `0.4-draft-career.md`

| line | original heading | now |
|---|---|---|
| 1 | `## plan career mode :` | `career-economy.md` §2.1 · `bots-and-tools.md` §8.1 (`update bot to be compete.`) · `science-and-ship.md` §4.6 (`tech tree:`) |
| 30 | `### economy` | `career-economy.md` §2.2 |
| 46 | `## EMC` | `career-economy.md` §2.3 |
| 51 | `### how science work:` | `science-and-ship.md` §4.1 |
| 62 | `### ballance` | `science-and-ship.md` §4.4 |
| 65 | `### cheat test modes:` | `science-and-ship.md` §4.5 |
| 68 | `### more images` | `sound-and-photos.md` §7.2 |

The two specs written from `0.4-draft-career.md` are
`../archive/0.4.0-plan-career-a.md` and `-b.md`.

## the open plans, split into `0.7.*` (prior to FFT) and `0.8.*` (FFT and later)

Plans continue `0.7.*` for all classic bounded-map work prior to Periodic
FFT, and use `0.8.*` starting at Periodic FFT. Plan numbers are not version
sequence (`AGENTS.md`): `0.7.47`–`0.7.49`, `0.7.51`–`0.7.52` and `0.8.7`
shipped while `0.7.44`–`0.7.45` and `0.8.0`–`0.8.6` are still open, so the
open `0.7.*` plans below are written against the shipped `0.7.47`–`0.7.49`
composition / space & capital starts / gifts / radar and the `0.7.51`–`0.7.52`
view rework, not against the `0.7.43` world they were first drafted on.

1. **Pre-FFT (`0.7.44`–`0.7.45`) — Empty heavy worlds & colony founding, and automatic company fleet.** Both land on the shipped `0.7.47` seat search and composition rule; neither changes `MAX_PLAYERS` or the fair-start contract.
2. **FFT & gameplay completion (`0.8.0`–`0.8.3`) — Periodic FFT torus (`PLANETS = 192`), Max-Distance modes & `SPORT_MAXDIST` (building on FFT's 192-body arrays, non-shader field view, and `512×256` periodic wrap), Rival Characters, and the single final bot/economy calibration pass.** `0.8.3` lands last in this group, after `0.7.44`–`0.7.45` and `0.8.0`–`0.8.2` have settled the rules it calibrates.
3. **Final UX, readout & sound polish (`0.8.4`–`0.8.6`, after all rules settle) — Helper Dialog (`H` M3/M4), Accessibility Live Readout (`#srStatus`), and Sound Improvements (Voronoi neighbor-scale consonance across 13–192 bodies/FFT, aim-channel cues).** `0.8.4` M0–M2 (`launchReasons`, `comms_copy.js`, `gui_comms.js`) are already live; only M3/M4 remain.

| plan | group | draft sections it answers |
|---|---|---|
| `../0.7.44-plan-founding-colony.md` | `0.7` pre-FFT | `found-colony-land.md`, `career-economy.md` §2.5 |
| `../0.7.45-plan-buy-ships.md` | `0.7` pre-FFT | `career-economy.md` §buy more ships |
| `../0.8.0-plan-periodic-fft.md` | `0.8` FFT+ | `map.md` §gravity (`&fft=1`, `PLANETS = 192`, 256²/512×256 Plummer FFT) |
| `../0.8.1-plan-max-distance-mode.md` | `0.8` FFT+ | `flight-lab-and-modes.md` §1.2 (`max distance from start`); `rivals-sport-competitions.md` §5.2 (`SPORT_MAXDIST`) |
| `../0.8.2-plan-rival-characters.md` | `0.8` FFT+ | `rivals-sport-competitions.md` §5.1, `bots-and-tools.md` §8.1, `politics-quests.md` §3.1 (`the bot’s personality`) |
| `../0.8.3-plan-bot-balancing.md` | `0.8` FFT+ | `flight-lab-and-modes.md` §1.4 (`hard bots…`), `bots-and-tools.md` §8.1 |
| `../0.8.4-plan-helper-dialog.md` | `0.8` after all | `helper-dialog-draft.md` / `helper-dialog/` (remaining M3 topic browser/art/delta & M4 non-career/rival-intent) |
| `../0.8.5-plan-accessibility-readout.md` | `0.8` after all | `sound-and-photos.md` §7.1 (`#srStatus` & HUD landmarks) |
| `../0.8.6-plan-improve-sound.md` | `0.8` after all | `sound-and-photos.md` §7.1 (Voronoi neighbor-scale consonance, toroidal/192-body adjacency, aim/arrival/block cues) |
| `../0.8.8-plan-space-weather.md` | design first | `map.md` §add space weather, `new/observation-device-OBS-1.md` (career weather, observation range and planet sources; decisions pending) |
| `../archive/0.7.46-plan-fair-start-fallback.md` (superseded) | — | `flight-lab-and-modes.md` §1.4 — **superseded by `../archive/0.7.47-plan-fair-start-modes.md`**; options 2 (repair the map), 4 (`MONEY.initSec`) and 5 (cheaper exact check) stay open, see below |
| `../archive/0.7.47-plan-fair-start-modes.md` (done) | — | `map-fair-start-modes.md` (composition rule, exit margin, background search, space & capital starts) |
| `../archive/0.7.48-plan-start-gifts.md` (done) | — | `new/game-options.md` (start-gift budget: three sliders, per-company random draw + rest cash) |
| `../archive/0.7.49-plan-radar.md` (done) | — | `new/radar.md` (radar HQ facility: global ship-trajectory reveal, bot avoidance) |
| `../archive/0.7.42-plan-balance-knobs.md` (done) | — | `career-economy.md` §2.9 / `time-scale-units.md` (`pads ×`, `rot ×`, `pay ×` alongside shipped `wear ×`) |
| `../archive/0.7.41-plan-sport-competitions.md` (done) | — | `rivals-sport-competitions.md` §5.2 (`galaxy.sport` countdown, pool, barrel hold) |
| `../archive/0.7.40-plan-two-leg-quests.md` (done) | — | `politics-quests.md` §3.5 (`careerLegPlan`, `plan quest`) |
| `../archive/0.7.39-plan-harvest-ticks.md` (done) | — | `career-economy.md` §2.11 (stay-pay forecast & book parity) |
| `../archive/0.7.38-plan-lite-profile.md` (done) | — | `lite-version.md` (saved-map boot, still non-gameplay background, mute sound & photos) |
| `../archive/0.7.35-plan-playable-fields.md` (done) | — | playable `map_fields.js` designed gravity fields from `map-generator-helper.htm` |
| `../archive/0.7.16-plan-bribe-rot.md` (done) | — | `politics-quests.md` §3.1–3.2 (bribe rot & quiet restoration) |
| `../archive/0.7.2-plan-ship-wear.md` (done) | — | `career-economy.md` §ship maintenance cost; `map.md` §add space weather (the wear hook) |
| `../archive/0.5.23-plan-medic-capital.md` (done) | — | `politics-quests.md` §3.1 (the medical mission), `career-economy.md` §2.4 (Capital accept refund) |

The landed visit-growth half-rate (`politics-quests.md` §3.2) and the
2-minute warning / 10-minute company liquidation (`other.md`) are implemented.

Open in the drafts and still without a plan of their own, and why:

- **player-set pad tax** (`career-economy.md` §2.2) — deferred by the draft itself,
  and it needs `0.6.2`'s derived fee as the number it would slide.
- **the science hull as cells, not a convex hull** (`science-and-ship.md` §4.1),
  the **per-axis merit re-derivation** (§4.2) and the **three ship tiers against
  five pad tiers** (§4.6) — balance work with one home (`balance_lab.html`), not
  features; plan them together now that `0.6.2` has shipped.
- **competition game modes and variations** (`rivals-sport-competitions.md` §5.2) —
  deliberately out of `0.7.41`; each is the career rule with the board replaced.
  The max-distance pair is `0.8.1`; “max visits”, “land on an antigravity
  planet”, the Capital-only start and the other variations still have no plan.
- **keyboard aim** — deferred until a human draft defines it; no control
  scheme is specified in `0.8.5`.
- **HQ-only refit** outside a casual mode (`flight-lab-and-modes.md` §1.5) —
  deferred by the note itself (Voronoi scale & aim-channel tuning now have
  `0.8.6-plan-improve-sound.md`).
- **the evacuation trip** (`career-economy.md` §evacuation) — shipped
  (`../archive/0.7.5-worklog.md`): a visible career-ship ride on
  the world clock whose wait falls linearly from `12 s` at the full `6.00` to
  `240 s` free.
- **explorer career** (`new/adv-explorer-career.md`) — 32 planets, 4× map, FFT
  wrap, half empty, gas atmosphere, auction, hidden map (fog of war), lone
  stars, observation satellite. Overlaps `0.7.44` (empty worlds), `0.8.0`
  (FFT), `fuel-collector.md` (gas) and `map-fair-start-modes.md` (auction is
  not the fair-start search). No plan; the first question is whether this is
  one career mode or several features split across existing plans.
- **fuel collector** (`fuel-collector.md`) — gas-atmosphere fuel collection,
  20–30 cr, 20 % FT-1 fill per fly-through. No plan; overlaps the explorer
  atmosphere. The draft specifies collection in flight, with braking deferred to explorer
  mode; atmosphere rendering and balance still need a design.
- **battery on ship** (`new/battery-on-ship.md`) — ship BAT-1 at 10× less
  capacity, solar variant, energy-transfer slider. Deferred by the draft
  itself (bot choice at launch). The draft suggests a fuel-cell alternative; no plan until that is decided.
- **`0.7.46` options 2, 4, 5** (`../archive/0.7.46-plan-fair-start-fallback.md`) —
  repair the map (add a good planet for the weakest seat), `MONEY.initSec`
  40 → 120–200, and a cheaper exact check. `0.7.47` shipped options 1 and 3
  (say so + symmetric start) and the tiered ladder rescues the `20/6` cell;
  whether 2/4/5 are still wanted is undecided.
- small checks, each one question in its section: the tourist / emissary line in
  the help drawer and the money rule's rate on a small universe
  (`flight-lab-and-modes.md` §1.1, §1.2), the player cap in the help text and 12
  against 13 planets (§1.3, §1.4), the economy block of the balance lab and the
  seven unreferenced `debug_*.js` (`bots-and-tools.md` §8.2, §8.3), the missing
  pictures and the lander wording of the captions (`sound-and-photos.md` §7.2,
  §7.4).

## review folders

Some subjects are first a **review**: several proposals answering one human note,
then a merge, then a plan. The human's note stays untouched and carries the `→`
status line; the folder holds the proposals as written.

| folder | note | merged concept |
|---|---|---|
| `helper-dialog/` | `helper-dialog-draft.md` — the captain's-base assistant H | `concept-helper-dialog-merged.md` (over `concept-helper-dialog-by-arena.md`, `suggestion-by-ERNIE55f.md`, `concept-helper-dialog-by-GLM53f-en.md`) |
