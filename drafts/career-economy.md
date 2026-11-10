# 2 · career economy

The catapult network: what a launch costs, who owns the pad, what the pads
grade into, and how the money comes back in. Wording from `0.4-draft-career.md`
(the career spec) and `archive/draft.txt` (everything added on top of it).

## 2.1 progression ← `0.4-draft-career.md`

start on random planet with weak electromagnetic catapult.

collect money for generated tasks:
- visit (fly near) long-not-visited planets - always available.
- land on specific planet = delivery - often, should have cargo hold of specific size, add mass and need more strong launch force and more energy spend
- longest route competition - sometimes

return to HQ cos money, so player have to build EM-catapult on planets. before player have money for this - he should plan to return to HQ by make proper trajectory so delivery has no profit without build catapult.

player should be able to launch to continue game. he can launch from planet only using EM-catapult. if no catapult built on some planet then player automatically call evacuation and return to HD and evacuation cost a lot of money - this make delivery no profit until build catapult on target planet. player can build any time if has enough money.

catapult/solar/battery - is planet equipment. need to GUI to able apply current selected upgrade to all already build facilities. and show how much this cost.

So progression is:
use available tasks to earn money, build catapult on target planet, be ably to land and launch with profit (if catapult power is enough to return to continue)

→ `career` ships this: the HQ start, the four delivery slots plus the
competition slot, the commercial EMC-1 fallback on every planet, `evacuate · 6.00`,
`buy EMC-1`, `all N · …` for a whole network of pads, and `wait · 30 min` to
recharge. `0.4.0-plan-career-a.md` / `-b.md` are the two specs written from this
paragraph.

**open**: the note's own gate — «delivery has no profit without building a
catapult» — is weaker in the shipped build, because a commercial rail is always
there for `3.00`. The exact figures, so a plan starts from measured numbers: a
delivery pays `0.5 + 0.06 · t · (1 + scarcity) · (1 + dist/900)` capped at `4.50`,
a starter purse is `3.00`, an `EMC-1` build is about `3.04` and an evacuation
`6.00`. So one delivery nets under `3.00` — the player cannot fund a pad from the
delivery that needed it, and the `3.00` commercial rail is what actually keeps a
landing alive. Is the commercial rail a starter crutch to keep forever, or should
its fee scale with ship mass or with the distance to the target, so the early
gate the note describes comes back? One `career_bench` A/B decides it.

## 2.2 economy ← `0.4-draft-career.md`

in career mode

usage cost of EMC of other player depends on energy usage, typical i think something like 0.1 to send lightweight ship to space with speed 10. but this is subject to balance.

→ `CAREER.taxPerKwh = 1.00` on the energy a guest rail burns — a flat operating
fee. **open**: the note wants the fee *to depend on the shot* (energy is already
the proxy). The shipped `1.00 / kWh` is not `0.1 per light ship`; the ladder of
`EMC-1…5` changed what a "light ship" costs, so the constant should be re-derived
from the tables rather than kept as a round number.

draw on map EMC of player as circle around planet with short line (gun) color same as player's color. So players claim whole planet by build EMC and receive usage tax.

→ claim ring in the owner colour plus the turning barrel.

TODO (deferred): possibility to adjust tax, changes apply after some time and visible current and next price near EMC

**open** — not built. Same shape as the tax deferral above: a per-pad rate the
owner sets, a delay before it bites, and `now / next` printed on the pad plate.
Needs the tax question answered first.

adjust cost on planet : i think these better gameplay (but this is subject of balance)

EMC-1 default build 9
evacuate to HQ 6
use commercial EMC 3 (available on each planet additional tier-1 EMC)

→ evacuation `6.00` and commercial `3.00` are these numbers. `EMC-1` is no longer
a flat `9`: build cost comes from the research that invented its spec
(`OrbitScience.buildCostOf`), so a padded `3.04` is the *result*, not a constant.
It is the price of the starter rail plus the starter purse rule — see the note
in `orbit_tech.js` above `CATAPULTS`.

## 2.3 EMC ← `0.4-draft-career.md`

in career mode EMC rotates with planet, 2...5sec/turn. it launch not when player click but when planet rotates to proper angle that fit player trajectory.

→ `turretPeriod` draws `2…5 s` of world time, the barrel turns, the click
queues the shot and the rail fires itself when it aligns; `gun · N s` on the
button.

## 2.4 quests and the special worlds ← `archive/draft.txt`

→ the whole board, the Capital and the A.R.F. world ship (`0.5.11`, `0.5.12`).
The special planets:

**Planet: A.R.F.** — No profit from flybys; no corruption. Tourist-delivery quests to A.R.F. appear more often.

**Planet: Empire Capital** — Flyby profit is negative: −3. Takeoff is free (EMC-3). Building is not allowed.
Quests involve delivering “tourists” to or from a special resort base here.

Capital, ARF, all start HQ player's planets should have Gravity=1

→ all three are in, gravity pinned. A.R.F. pays `0` and takes no bribes, the
Capital pays `−3` on every entry and its fixed imperial EMC-3 makes takeoff free,
building is refused there, and tourists are offered at `2×` an ordinary endpoint
— to A.R.F. as well as to and from the Capital resort (`0.5.11`). Nothing in this
block is open.

### add quest

fragile load - cant survive >EMC1. available on light planets

**open** — not built (no `fragile` anywhere in the code). It is the one cheap
quest that gives a light planet a *reason* to be a stop and gives the pad ladder
an upper bound to fight: a new `TASK_DELIVERY` flag that voids the reward when
the destination rail is above `EMC-1`, or when the landing impact is above a
threshold. Pairs with the `EMC-3+` research lock in §2.6.

## 2.5 colonies and the trade backdrop ← `0.2.0-draft-economy-compare.md`

The colony economy is not a wish list: `0.2.0-draft-economy-compare.md` is the
measured comparison, §5 lists the open decisions and §6 the ones taken, and
`archive/0.2.0-plan-colony-economy.md` is the spec. What is still open from that
document:

1. **How deep the economy goes** — three goods + needs/comfort, or + a resource
   map and colony stages, or + credits and stock-reactive prices.
2. **Who owns the network** — automatic nearest-four, player commissions, or
   frontier automation.
3. **Whether the cargo experiment touches the economy** — a landed container
   seeding a colony, or a pure physics toy.

Taken (§6, for the record): needs/comfort growth, a deterministic resource map,
colony stages, the automatic network with a log, a budgeted expansion scan,
habitat scoring. Prices deferred. **open**: item 3 is the only one of the four
with no decision recorded, and it is the one that decides whether
`0.3.x`-style cargo can ever carry goods.

## 2.6 the pad ladder ← `archive/draft.txt`

need balance build catapult cost.

→ the price is research-derived (`buildCostOf`); the balance pass lives in
`balance_lab.html` (§8.2).

EMC-3, 4, etc - should not be available by default. we have only 2 levels researched by default - next need to be researched in sci

→ `EMC-1…2` stock, `3…5` behind the research hull (`catapult` family).

**open**: `EMC-3+` is *researchable* but not *required* by anything. Give the
ladder a demand: a quest (see `fragile load` above), a heavy planet that only
`EMC-3` leaves, or a delivery whose cargo only a bigger pad lifts.

## 2.7 time and pads ← `archive/draft.txt`

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
footer copy.

## 2.10 the EMC drag ← `archive/draft.txt`

limit range of drag ui to actual catapult strength. so player will not drag and then found catapult is too weak. also this change will make launch more precision.

→ the career drag range ends at the pad's live cap.

## 2.11 experimental settings ← `archive/draft.txt`

make new experimental settings panel add sliders to adjust system global gravity and catapult force.

→ `experimental`: `g field ×0…×9`, `catapult ×0.25…×3`, `stay-pay · per tick`.
The stay-pay arithmetic is the one part still open — see
`0.4.30-plan-harvest-ticks.md`.
