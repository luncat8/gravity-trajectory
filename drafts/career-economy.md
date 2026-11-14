# 2 · career economy

The catapult network: what a launch costs, who owns the pad, what the pads
grade into, and how the money comes back in. Wording from `0.4-draft-career.md`
(the career spec) and `archive/draft.txt` (everything added on top of it).

## 2.1 plan career mode : ← `0.4-draft-career.md`

start on random planet with weak electromagnetic catapult.

collect money for generated tasks:
- visit (fly near) long-not-visited planets - always available.
- land on specific planet = delivery - often, should have cargo hold of specific size, add mass and need more strong launch force and more energy spend
- longest route competition - sometimes

return to HQ cos money, so player have to build EM-catapult on planets. before player have money for this - he should plan to return to HQ by make proper trajectory so delivery has no profit without build catapult.

player should be able to launch to continue game. he can launch from planet only using EM-catapult. if no catapult built on some planet then player automatically call evacuation and return to HQ and evacuation cost a lot of money - this make delivery no profit until build catapult on target planet. player can build any time if has enough money.

catapult/solar/battery - is planet equipment. need to GUI to able apply current selected upgrade to all already build facilities. and show how much this cost.

So progression is:
use available tasks to earn money, build catapult on target planet, be able to land and launch with profit (if catapult power is enough to return to continue)

→ `career` ships this: the HQ start, the four delivery slots plus the
competition slot, the commercial EMC-1 fallback on every planet, `evacuate · 6.00`,
`buy EMC-1`, `all N · …` for a whole network of pads, and `wait · 30 min` to
recharge. `../archive/0.4.0-plan-career-a.md` / `-b.md` are the two specs
written from this paragraph.

The note's own gate — «delivery has no profit without build catapult» — in
today's numbers: the starter purse is `6.00`, an `EMC-1` costs `3.04`, an
evacuation `6.00`, a commercial launch a flat `3.00`, and a delivery pays
`0.5 + 0.06 · t · (1 + scarcity) · (1 + dist/900)`, capped at `4.50`: `0.74…2.42`
for what a `HOLD-8` carries, up to the cap for a `HOLD-24`. So the gate holds
for a small hold (the commercial way off costs more than the delivery paid) and
is gone for a big one; and a pad costs one commercial launch, so it is repaid on
its second departure.

→ `../0.6.2-plan-pad-fees.md` §2, shipped: the commercial fee follows the
shot — `2.00` + `2.50` per kWh, from `2.27` for the slowest dry hop to
`4.54` at full force — so the gate holds for every hold, not only a `HOLD-8`
(the A/B in `experiments/logs/0.6.2-commercial-kwh-ab.txt` settled the knob:
at `1.50` a full-force hop cost `3.52` and a `HOLD-24`'s `4.50` still funded it;
at `2.50` the hop costs `4.54` and no delivery pays for it).

## 2.2 economy ← `0.4-draft-career.md`

in career mode

usage cost of EMC of other player depends on energy usage, typical i think something like 0.1 to send lightweight ship to space with speed 10. but this is subject to balance.

→ shipped as written: a guest pays `CAREER.taxPerKwh = 1.00` × the energy of
its own shot (`launchEnergy(mass, rail, speed)`), to the pad's owner. The dry
10 t ship pays `0.11` at the slowest shot and `1.02` at the `EMC-1` cap, so the
note's «something like 0.1» is the light, slow launch.

→ `../0.6.2-plan-pad-fees.md` §1, shipped: a guest pays `1.00` × the shot's
energy × the rail's tier, so the same shot costs `0.11 / 0.19 / 0.25` on
`EMC-1 / 2 / 3` — upgrading a pad now raises what it earns per guest.

draw on map EMC of player as circle around planet with short line (gun) color same as player's color. So players claim whole planet by build EMC and receive usage tax.

→ claim ring in the owner colour plus the turning barrel.

TODO (deferred): possibility to adjust tax, changes apply after some time and visible current and next price near EMC

**open**, deferred by the note itself, no plan — not built. A per-pad rate the
owner sets, a delay before it bites, and `now / next` printed on the pad plate.
It needs `0.6.2`'s fee first, as the number the slider would move. Still wanted
after that?

adjust cost on planet : i think these better gameplay (but this is subject of balance)

EMC-1 default build 9
evacuate to HQ 6
use commercial EMC 3 (available on each planet additional tier-1 EMC)

→ evacuation `6.00` is this number; the commercial launch is no longer a flat
`3.00` — since 0.6.2 it is `2.00` + `2.50` per kWh of the shot. `EMC-1` is no
longer a flat `9`: build cost comes from the research that invented its spec
(`OrbitScience.buildCostOf`), so a padded `3.04` is the *result*, not a constant.
It is the price of the starter rail plus the starter purse rule — see the note
in `orbit_tech.js` above `CATAPULTS`.

## 2.3 EMC ← `0.4-draft-career.md`

in career mode EMC rotates with planet, 2...5sec/turn. it launch not when player click but when planet rotates to proper angle that fit player trajectory.

→ `turretPeriod` draws `2…5 s` of world time, the barrel turns, the click
queues the shot and the rail fires itself when it aligns; `gun · N s` on the
button.

## 2.4 Special planets ← `archive/draft.txt`

**Planet: A.R.F.** — No profit from flybys; no corruption. Tourist-delivery quests to A.R.F. appear more often.

**Planet: Empire Capital** — Flyby profit is negative: −3. Takeoff is free (EMC-3). Building is not allowed.
Quests involve delivering “tourists” to or from a special resort base here.

Capital, ARF, all start HQ player's planets should have Gravity=1

→ the whole board, the Capital and the A.R.F. world ship (0.5.11, 0.5.12), and
all three kinds of planet have their gravity pinned. A.R.F. pays `0` and takes no bribes, the
Capital pays `−3` on every entry and its fixed imperial EMC-3 makes takeoff free,
building is refused there, and tourists are offered at `2×` an ordinary endpoint
— to A.R.F. as well as to and from the Capital resort (`0.5.11`). Nothing in this
block is open.

### add quest

fragile load - cant survive >EMC1. available on light planets

→ built (0.6.3): `task.fragile`, the `fragile` board row, the aim-line void.

→ `../archive/0.6.3-plan-fragile-load.md`: a `TASK_DELIVERY` flag; the loaded
load is lost when it is launched harder than `2.0 m/s²` (above `105 px/s`),
which an `EMC-1` at full force never reaches on a loaded ship and a stronger
rail does, and it is offered only from planets light enough for an `EMC-1` to
lift it (`g ≤ 0.75`, measured). A stronger rail still carries it when aimed
softer. The one reading, confirmed: «cant survive >EMC1» as *the force of the
launch*, not the rail's tier.

## 2.5 colonies and the trade backdrop ← `0.2.0-draft-economy-compare.md`

The colony economy is not a wish list: `../0.2.0-draft-economy-compare.md` is
the measured comparison, its §5 lists four open decisions, its §6 takes all
four, and `../archive/0.2.0-plan-colony-economy.md` is the spec:

1. **How deep the economy goes** — needs/comfort growth, a deterministic
   resource map, colony stages, habitat scoring; prices deferred.
2. **Who owns the network** — automatic nearest-four, no player commissions.
3. **Whether the cargo experiment touches the economy** — «A landed cargo
   container seeds a colony on a free planet.»
4. **How much GUI** — HUD, hover, a panel with the log, the sky overlay.

→ 1, 2 and 4 shipped. 3 is decided and half built: `Sim.seedColony` is the whole
founding law and nothing in the game calls it.

**open** → `../0.6.9-plan-founding-colony.md`: the call site, as a button at the
pad that spends a loaded delivery. On a 13-planet map 4 to 9 planets never get a
colony on their own, and a planet without one is never a delivery's origin or
destination.

## 2.6 the pad ladder ← `archive/draft.txt`

need balance build catapult cost.

→ the price is research-derived (`buildCostOf`); the balance pass lives in
`balance_lab.html` (`bots-and-tools.md` §8.2).

EMC-3, 4, etc - should not be available by default. we have only 2 levels researched by default - next need to be researched in sci

→ `EMC-1…2` stock, `3…5` behind the research hull (`catapult` family).

→ `../0.6.2-plan-pad-fees.md` §3, shipped: the ladder's demand is now offered
on the board. A `deep` delivery (16 t or more out of a well of g ≥ 2.2) carries
the tag, names the `EMC-3+` rail that lifts it and pays `+60%` on top of the
ordinary reward — an `EMC-2 + BAT-2` lifts a loaded `HOLD-24` off only 43 % of
`g 2.0` planets and 13 % at `g 2.5`, where an `EMC-3 + BAT-3` lifts it off
100 % and 87 %.

## 2.7 balance and GUI ← `archive/draft.txt`

game time and background trade time - are different so they need separate panels near and game time should also have slider of speed

→ the career world clock has its own rate and the orbital-trade panel keeps the
background clock; both are separate controls.

fix The planet-ownership rule is not enforced bug in build EMC of already occupied planet. need to fix this. planet should possible has only commercial EMC, 1 player EMC, evacuate.

→ one rail per planet, the claim is checked; a foreign rail keeps only its
explanation row.

Bots can use other's EMC and pay to other players for it as this a lot cheaper then commercial. They prefer their own EMC first. Commercial EMC is the fallback when the current rail can’t produce a shot—e.g. it is too weak or depleted or some urgent profitable task.

→ the bot's rail order in `careerDeparture`: own, then a rival's (paying tax),
then commercial; the last is the urgent fallback.

## 2.8 fuel ← `archive/draft.txt`

fuel made from owner's battery charge or cost (need balance, fuel more price then EMC but still profitable in some cases: typical strategy: change trajectory to stay in space and avoid to land on heavy planet without owner's EMC or change trajectory visit very profitable planet that is difficult to reach using EMC).

→ `produceFuel` / `buyFuel`, own charge first, `FUEL_PRICE = 0.08/kg`,
`FUEL_KG_PER_KWH = 20`.

battery charge level gui: should show it not only on own planet but on all where players landed. (except commercial because it is always charged). on other planet show it on pointer over planet or info div.

→ `drawPadPlate` under the landed planet, and the hover plate on any other pad.

while landed show refuel button (cost) near launch button.

→ `refuel · <cost>` in the flight HUD.

## 2.9 refactoring time ← `archive/draft.txt`

i think we (should) have only 2 time
- 'career' - actually not just for career but main time for game, useful for fly and play
- background animation (trade, orbits) - this should be only in settings panel, no need in footer, because it currently not gameplay important.

→ done: the game clock, the orbital-trade background clock in its own panel, no
footer copy. `0.7.1` removes the leftover hour/year units from the labels and
the prose; the two clocks stay.

### normalize time to 1x = real time

i think better normalize it to 1x speed be IRL timer.

currently "wain 30 min" button work good but text told player not useful info that is hard to imagine. so better operate real time with proper scale and tell how many real time it wait fast forward.

current default we use x4. this is good speed so we can name it x1

after this refactoring actual speed should remain same, but set visual units more simple.

→ today the career clock is `scene.trade.speed` (background slider, `0.5…12`, default
`0.5`) times `gameRate` (the `game time` slider ×1) for physics pace, while
`1 s` of game time is 1 sim second and 60 *world* seconds for pads
(`WORLD_SEC_PER_MIN`). The `wait · 30 min` button is 30 world minutes = **60
flight s = 15 s of wall clock at the default ×4**; its label the player must
divide by 60 and then by 4 to know how long it takes. `0.7.1` keeps the units,
this note renames them: one unit = one second of wall clock at the career's
default pace, so the button reads `wait · 15 s`, the pad charges per second, and
the ×4 default is called ×1. Physics, prices and every balance number stay put;
only the labels and the rungs of the speed control change.

**answered:** today's ×4 becomes ×1. Physics, prices and the pace the game is
balanced at do not move; only the labels do, so `wait · 30 min` reads
`wait · 15 s` (60 flight s at 15 s of wall clock) and the speed control's rungs
are renumbered `×0.25 … ×8` around the new ×1. The literal `1 flight s = 1 wall
s` reading is rejected: it would make every flight four times longer to watch
and invalidate every balance number priced in flight seconds (0.7.2's wear
included).

## 2.10 EMC catapult ← `archive/draft.txt`

limit range of drag ui to actual catapult strength. so player will not drag and then found catapult is too weak. also this change will make launch more precision.

→ the career drag range ends at the pad's live cap.

## 2.11 experimental settings ← `archive/draft.txt`

make new experimental settings panel add sliders to adjust system global gravity and catapult force.

→ `experimental`: `g field ×0…×9`, `catapult ×0.25…×3`, `stay-pay · per tick`.
**open** → `../0.4.30-plan-harvest-ticks.md`: the stay-pay arithmetic.

## buy more ships
settings checkbox:
allow buy new automatic ship to earn money; acts like bot, shown under player name, shares player purse and all owned property (science/gear) without repaying research.

→ **open** · `../0.7.3-plan-buy-ships.md` — a bought ship is a ship context
inside the one company career, not a scoreboard slot: it shares purse, pads,
science and owned gear, costs 30 cr, wears ×2, and appears under YOU. Unlimited;
no new planet, no `MAX_RIVALS` change.

## ship maintenance cost
represent ship condition (storyline: repair, service, oxygen, food, …) as one parameter ~ cost: wear 0.01/s in space + 0.1 per landing + 0.1×EMC acceleration for the starter ship; upgrades/science reduce wear. limits lucky starts (observation device fail, preventing earn huge amount of money in case of very long route occasionally found).
at 0: observation device fails (visits pay nothing); ship can't launch EMC and use IMP engine.
repair button near (before) launch btn; 2 cr per 1 condition.
replace launch button with btn with dropdown:
- repair & launch (total cost)
from dropdown triangle available separate:
- repair
- launch (as current button)
numbers subject to balance; space weather affects wear.

→ **open** · `../0.7.2-plan-ship-wear.md` — one `condition` per ship, wear in
sim seconds, the 0 gates, 2 cr for a full repair, and the split launch control.
The plan answers the open points: repair anywhere landed; impulse wear ∝ Δv;
no wear while landed; fleet ships ×2; science cuts wear to a 0.5 floor. Space
weather itself is still a separate layer (`map.md`).

## evacuation

not instant move but similar as trade ships speed and visible animation of movement.

#### evacuation cost

if player has no full price money then evacuation cost less but took longer.

i think at 1x speed

full price 12sec irl time

...

zero cost 240sec

→ today `evacuate` is one instant: purse −`6.00`, ship placed on HQ, the trade
background does not move. **Open, and it needs a plan of its own** (`0.7.5`):
these three points are now answered, the rest below is still the spec's job.

- **`12 … 240 s` is wall clock at the new `×1`** (§2.9: today's ×4). So the
  full-price trip is 12 s of watching and the free one is 4 minutes — four
  `wait`s end to end — while the flight clock behind them runs 48 s and 960 s.
- **the price trades for time linearly** (answered): `wait = 240 − 228 ·
  paid / 6.00` seconds, so `6.00 → 12 s`, `3.00 → 126 s`, `0 → 240 s`. The fee
  is *waived*, not deferred: a purse that cannot pay still gets home, slower,
  and `checkEnded`'s broke test must not fire during the trip. `communism`
  (`price() = 0`) therefore always takes the 240 s trip, which is the cheat's
  own bargain.
- **the career ship flies it** (answered), on the gravity map, at a speed in the
  trade ships' band (`SHIP_SPEED_MIN/MAX 16…25`) rather than the ballistic
  solver: the trip is a straight visible ride `at → hq` on the world clock, no
  aim, no burn, no landing payout, ship `landedBody` = HQ at the end. That keeps
  the evacuation out of the physics and out of the replay.
- The wait is career time, so it charges pads, grows visits and lets rivals fly —
  which is the point of making it long. It also must not strand a *broke* player
  on the clock: `checkEnded` calls a stranded company broke today, so the
  evacuation has to be in progress before that test.
- Today the button exists twice — `#launchEvac` in the flight HUD and the pad
  block's `evacuate` row — and both call `GravityGame.evacuate`, which returns
  false unless `career.stranded`. A trip in progress needs its own state
  (`evacUntilStep`, like `arrestUntilStep`) so a second click cannot buy a
  second trip, and the clock's existing pause is the only thing that stops it.
  `GravityBot` calls `evacuate` directly in its broke/stranded paths, so the
  bot gets the trip for free — but its `fallbacks`/`evacuations` counters and
  the `career_stats_test` purse identity must hold across the wait.
- **open** · `../0.7.5-plan-evacuation-trip.md` (to write): the trip state, the
  price/time line, the two buttons and the bot's use of it. Open points so far
  are collected in `../archive/0.7.5-worklog.md`.
