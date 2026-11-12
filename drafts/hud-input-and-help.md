# 6 · HUD, input and help

Panels, drawers, selections, gates and the camera. Text from
`archive/draft.txt` (§HTML GUI, §ui, §auto helper tools, §flight HUD panel,
§impulse engine fly, §auto pause, §gravity potential view map). This is the
group with the most lines already shipped — what is left is listed at the end of
each block, `**open**`.

## 6.1 HTML GUI ← `archive/draft.txt`

remove abort button in career

→ no abort control exists any more.

remove line: seed, rate.
move seed to url.

→ the footer carries `restart` / `new seed` / `copy replay`; the seed itself is
only in the URL and in the copy links. The world clock's rate sits with the
orbital-trade panel, not in the footer.

move "drag from pad to" to help. split help by all and specific to game mode. it is already have some - so deduplicate help.

→ `COMMON_HELP` for every rule plus `RULE_HELP[mode].controls` for the one that
has its own; the drag instructions live in `COMMON_HELP` only.

1
in Help replace "selected mode" with actual name of current mode

→ the drawer title is `RULE_HELP[rule].name`. Where a literal "selected mode"
still stood in the copy it is gone: `fillHelp` writes `help.name` into both the
drawer title and `#helpRuleName`, and the source of the record is
`selectedHelpRule()` (`game.rule` while a run is on, else `lab`). A politics
preview swaps in `POLITICS_HELP` and its own name. Nothing left to do unless the
note means the *mode row* label (`lab`/`visit all tour`/…) instead of the drawer.

## 6.2 landing gates ← `archive/draft.txt`

2
prevent bot landing on planet where gravity and no enough EMC or no cost to build or no profit or other reason prevent to launch from it.

2b
also add this to auto-helpers and aim tooltip color as warning. greenish - profit, current - loose, reddish - cant launch from destination

→ `careerLandingFacts` + the shared landing gate: the aim readout, the launch
list, the helpers and the rivals all price a landing with one factor table, and
a destination with no affordable departure is red and refused. The helper scans
name their refusal (`no EMC-buildable landing`).

3
calibrate gravity max and random. so from 10 free planets 2-4 are not possible to launch until upgrade EMC.

→ calibrated: `SEEDS=12 node experiments/hq_gravity_probe.js` finds the dry
ship on a starter `EMC-1 + BAT-1` blocked on 973 of 2964 planet–gravity samples
of the `−1…+3.5` field — 3.3 of 10, inside the note's 2–4 — with reach falling
from 99 % at `g 1.25` to 52 % at `g 2.0` and 18 % at `g 2.5`. HQs sit at `g 1`
(`HQ_GRAVITY_MAX`) and a first-flight build site at `g ≤ 1.5`.

**open** → `../0.6.8-plan-seeded-map-opening.md` §2: the number is printed by a
probe, not asserted by a test, and a uniform field up to `+5` would move it to
about 5 of 10.

## 6.3 auto helper tools ← `archive/draft.txt`

implement click on non planet to deselect planet.

→ no planet under the pointer clears the selection.

add helper tools available to user: similar as bot use but with buttons. Especially need them in 'route' mode to make longest route.

→ `quick scan`, `scan here`, `tweak best` in every rule; the career panel adds
`best profit`, `profit + EMC`, `quest scan`.

i think good to have 3 buttons: broad fast search if no planet selected.
if planet selected - use it as start point.
if planet selected and some best route already recorded - then improve it by only small angle and force change.

→ exactly the three buttons and their three regimes, including `tweak best`
nudging the recorded best by a small angle and speed change.

start each adjustments after user click button try with random - so next press will not calculate same attempts again.

→ each press adds fresh random candidates instead of repeating the same grid.

## 6.4 flight HUD panel. ← `archive/draft.txt`

refactor auto-helpers panel to flight HUD panel with auto-helpers content

- speed
- time of fly / launch button (Enter shortcut) (while landed) / burn button (Enter shortcut) when ipm armed

- fuel, refuel button (while landed)
- engine
- quest list with arrows when pointer hover.

think where to place auto-helpers content to be logically functionally grouping

→ shipped, `../archive/0.5.17-plan-flight-hud.md`: `#flightHud` with head /
ship / action / work / helpers groups, the refuel row, the quest rows and their
guide arrow. The plan was checked line by line against the code before it was
archived (`../archive/0.5.22-worklog.md` §5).

## 6.5 impulse engine fly and flight HUD panel ← `archive/draft.txt`

have IMP, fuel

- pause
- drag from the flying ship → aim → release to arm
in fly input event on ship - do not need. we interact only on pause.
- Enter to burn (this also unpause and continue fly)
or
- unpause cause cancel arm

→ the pause-first loop: a press on the *flying* ship does nothing, a drag from
the paused ship arms, unpausing by any route drops the arm, `Enter` burns and
resumes.

### auto pause and pause in game modes that allow pause. useful to avoid players waste game time

career/ game time paused if one or more of player has paused state.
unpause, launch - should unpause after all player unpaused in some way.
paused buttons has independent state for each player. bots dont use pause button.

→ per-player holds on one shared clock, the hatched scoreboard row marks a hold,
bots never hold, a landing auto-pauses by default.

## 6.6 map and camera ← `archive/draft.txt`

### gravity potential view map

smooth gradient color map show gravity abs module .
negative gravity - blue.
near zero - transparent smooth alpha proportional to mod(-1...1)
positive green,
heavy planet - red.
you can draw in low resolution if this is heavy to calculate all pixels

→ `view · potential` (`?view=potential`): blue where gravity repels, see-through
near zero, green where it pulls, red around a heavy planet (`g ≥ +2`); a WebGL
shader with a ¼-resolution 2D fallback. The legend sits by the view radios.

### ui

add after visit profit line with gravity. make this planet info border same color as player's color if has EMC or neutral (current white-orange looks ok)

→ the profit card carries `g` under the payout, and a claimed planet's border is
the owner's colour.

make by default random seed new startup unless url has seed

→ a seedless startup draws a fresh world and writes the seed into the URL.

## 6.7 still open in this file (agent index, no source note)

- The flight HUD has no `work` row for a competition that has not been accepted
  → `../0.6.4-plan-competitions.md` (`rivals-competitions.md` §5.2).
- → built (0.6.1): the help drawer previews a politics topic (bribe,
  corruption, the observation device) while the pointer is on the bribe or
  go-quiet row. The note's «short help drawer on hover bribe button» is
  `politics-quests.md` §3.4 → `../archive/0.6.1-plan-observation-device.md`.
- The blocked share of §6.2 → `../0.6.8-plan-seeded-map-opening.md` §2.
