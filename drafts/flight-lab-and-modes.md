# 1 · flight lab and modes

The trajectory itself. Ballistics, the gravity field the page draws, the seeded
map, and the rules the mode row picks between. Text from the drafts, grouped and
ordered; `→` marks what ships, so an open item is what has no arrow under it.

## 1.1 the first experiment ← `archive/draft.txt`

look at this
https://github.com/luncat8/exec_queue/orbit_trade.html

pick it.
for this experiment we use it as simulation background. by default fast-forward to t+7:00
then set slow time 0.5

→ the trade world is the backdrop (`orbit_sim.js`); a game world opens at `t+07:00`.

our new experiment has separate timer and not related to trade so keep it separate.

→ separate clock: gameplay `rate` vs orbital-trade background rate.

assign all planets gravity force and possible select and change -2...2 , by default 1.

→ seeded `−1…+3.5` in `0.05` steps, editable per body in the lab only.

user send cargo container from planet set direction and initial push like ballistic shot.
before launch - draw calculated trajectory.

→ drag from a planet, release to arm, the trajectory is traced before launch.

press shift cause 20x slow angle and force change to precision change also slider that do adjust values by add or subtract relative portion line -5%...5% relative

→ Shift = 1/20 sensitivity, `±` trim slider on speed, burn Δv or selected gravity.

limit calculated trajectory to some big but reasonable value to not took more then ~10-20ms per calculation. add slider to adjust

→ `route` slices its tracer over frames; the flight cap is `capSteps` per rule. No
slider for the cap — the slice budget is internal (`routeBegin/routeStep`).

canvas
draw red + and blue - in gravity body centers depends on gravity sign. update when body gravity change

→ sign marks on the canvas, live with the field.

in case of gravity centers movement - update trajectory.

→ the prediction follows moving ports.

properly calculate trajectory in case of movable gravity

→ moving-source integrator in `gravity_sim.js`.

input
press without drag should not delete old trajectory

→ a press without drag leaves the armed shot alone.

GUI
select gravity positions: radio group
- planets
- ports

→ `gravity positions` radio row (`srcPlanets` / `srcPorts`).

show trajectory length and total time to end

→ in the aim line and the HUD.

increase update trajectory in case of gravity-body move or changed and if this is not cause fps drop below 60

→ prediction throttles above a 17.5 ms frame.

add small points as secondary moons around planets and belts as visual design (not affect simulation, no gravity, but keep proper orbital speed depends on planet gravity and ellipsoid orbit. better make all same orbital apocenter, inclination and other so they good look like typical Saturn or Earth system)

→ coplanar moons and belts, Keplerian speed scaled by `sqrt(|g|)`, zero sim
impact — the last bullet of `README.md` under *mechanics & visuals*.

in all:
planets / ports · moving
user launch from planet - for stable launch base

→ that is the source radio, above.

add game goal: visit max planet systems (inside port orbit) and print predicted visit count as orbit change.
keep visited marking, next launch allow from landed body and visually mark this. and visually mark tooltip that is not allow from other with arrow to position of landed location.

→ `tour` rule, visited rings, staged hops, the lock tooltip with the guide arrow.

while fly continue trajectory until landed

→ the prediction runs ahead of the ship every frame.

in help drawer GUI add that game goal is random(tourist, emperor’s emissary) want to fly through each system.
help drawer open on click and pointer over button (in this case hide on out).

→ help drawer: open, pin, press-and-hold preview; `R#` goal copy per rule.

make visited orbits a bit more dim.
make current predicted visits as more bright green highlight

→ clean render and visit highlights.

end trajectory out of system warning reddish launch button

→ blocked-launch arrow and the red launch state.

## 1.2 deterministic modes ← `archive/draft.txt`

new game mode: deterministic seed and time only while ship move. after trajectory end - pause until launch. this allow compare players results. button to copy replay as url: with launch parameters.

→ `tour` and `money`: the clock runs only while cargo flies, and `copy replay`
carries the shots.

should be possible to change speed after launch or in replay - to fast forward faster or slower.

→ `play ×N` / replay multiplier; the physics steps never change.

### game mode: max trajectory length

calculate and draw trajectory without length limit (probably need split calculation to avoid freeze).
only single launch.
max trajectory distance until landed or out of map is win. Because win is deterministic, no need actually launch but gradually show current winner. This is more like planner mode: win by make longest trajectory.
disallow to select same start planet in this mode (show tip). can choose other but not currently occupied.

→ `route`: planner, one plan per start planet per slot, the claimed start is
refused with a tip, `use best` restores the exact plan.

### game mode: money per visit

launch cost 1 money, each planet fly-visit give something like 0.1*time from last visit.
need calculate good balance so money is valuable.
show visit profit near planets in this mode and total player's money.

→ `money` (10 launches, purse ranking) and the `+0.24 → +3.00` saturating
payout drawn under every planet. The `0.1 × time` idea became
`MONEY.k = 0.00625/s` saturating at `cap 3` — **open**: whether the rate should be
steeper on a small universe (only the count scale is in, `k × 26 / count`).

## 1.3 the seed, the roster, the map ← `archive/draft.txt`

### url parameters to run specific game mode to fast start visual test

→ `?mode=…&seed=…&view=…`; `#game=…` replays.

### default game mode career. save last used mode

→ `MODE_STORAGE = 'gravity.lastMode'`.

### possible change number of players, planets

add buttons to change number of players
+- near score in top left panel

→ scoreboard `+` / `−`.

add number input to change number of planets
in system visited x / 26
13 is new default for career. 26 - default for other modes.
increase - add random
decrease - remove random without refund, keep 1st HQ of each player

→ `planetCountInput` (4…48, career default 13); removing keeps every HQ.

players count change: should be without limit and just add new random position planet with player.

→ the scoreboard `+` seats one more company on a random free planet, up to the
16 rivals the roster holds. **open**: "without limit" collides with the 48-planet
cap — a seat needs a planet. Either the roster cap is raised with a second
planet tier, or the sentence should read "up to the planets available"; the
existing `+` behaviour is the second reading and needs only the cap explained in
the help text.

## 1.4 balance of the field ← `archive/draft.txt`

### balance plan

task to balance career also against 12 planets
i think speed of grow profit of visit should be faster on smaller planets number. so 13 planets will be 2x more regeneration of profit per time then 26 planets.
and this probably enough to keep balance.

→ `applyMarketUniverse` scales `k` by `26 / count`, so 13 planets regenerate
twice as fast. **open**: the note says 12, the career default is 13 — confirm the
count before pricing anything else, and re-check that `k × 2` is enough once the
pad ladder is priced.

hard bots need give more search time then easy. probably measure in startup and split available time

→ `0.4.27-plan-bot-balancing.md` — identical seeded fields, a measured
seed/outcome table, no budget change before the table exists.

### random gravity of planets -1...+5
but 1st HQ is 1

→ field is `−1…+3.5`; HQ, Capital and A.R.F. are pinned to 1. **open**: raise the
draw ceiling to `+5`? That is a one-constant change (`PLANET_GRAVITY_MAX`) and
touches every seeded replay, so it needs its own plan and a fresh baseline.

slider G-field increase max to 9x

→ `EXPERIMENT.gravityMax = 9`.

### career map generator improve

choose seed and/or adjust player's planet start positions to 1st predicted flight be more or less similar profit. and all has in more or less equal ability to land on not heavy planet to build new EMC in 1st fly.
because if some player possible to land on only heavy G>~1.5 planets this cause big score impact from start.

→ the HQ set is planned together and validated: every company must have an
unclaimed first-flight landing at `G ≤ 1.5` that an `EMC-1 + BAT-1` can leave
(`career_start_probe.js`, `career_start_fairness.js`). **open**: the `stuck` rivals
noticed in the 0.5.21 worklog (seed 2 R1 sitting on `g 2.1` HQ for a whole bench,
4 of 24 rival-games at 400 s) contradict this rule. The opening planner itself
looks correct — `openingTraceHome` forces its own home to `g 1` while it traces —
so the suspect is either `startCareers` overwriting a strength after the plan or
the bench's own setup. One probe reproduces seed 2 R1 on the page before any
generator work.

## 1.5 what a career ignores on purpose ← `archive/draft.txt` (deferred)

casual mode - refit at any planet else at HQ

→ refit already works on any planet (**done differently**); the `casual mode` that
would gate it to the HQ is the deferred half. **open**: does anything still need
that gate — a "hard refit" variant at the HQ only?
