# 4 · science and ship

The research hull and the ship that leaves the pad. Text from
`0.4-draft-career.md` (§how science work, §ballance, §cheat test modes and the
`tech tree:` lines) and `archive/draft.txt` (§science research, §price).

## 4.1 how science work: ← `0.4-draft-career.md`

user set floating point slider to what parameter he want, calculator show preview cost - user accept and this become available.
most important mechanics is knowledge volume: N-dimensional space that limited with discovered items - inside this space items are cheap - outside need new scientific work depends on distance.

example:
engine has force 1 and mass 10. we invented engine with force 2 and mass 15 - this give a line of possible products.
if we next invent engine force 1 with mass 1 we will have triangle on 2d space of possible cheap products

some parameters difficulty (cost) is mostly increased in one direction. i.e. create heavy engine is not difficult but lightweight is difficult.
so in addition of our very good volume-shaped science cost calculation need also add that some parameters below and above researched range is different cost increase.

→ the science tab: per-family `(thrust, mass)`, `(maxForce, efficiency)`,
`(fuelCap, emptyMass)`, `(capacity, leak)` sliders over the convex hull of
accepted points, a cost-surface plot with the dashed researched box, a live
preview, and a per-axis `below`/`above` frontier multiplier. Inside the hull pays
the base fee, outside pays `base + k·(dist + frontier)` in normalized RU, then
× the spec merit. **open**: the hull is a *convex hull* — the draft's triangle
example works, but a concave frontier (an L of cheap points around a dear hole)
still reads as inside. Decide whether that is acceptable (cheap to keep, honest
to the draft's "volume" wording is not exact) or whether the hull should become
the union of the accepted *cells*.

## 4.2 science research ← `archive/draft.txt`

improve sci cost curves related to mass and
similar for efficiency, leak and other sci characteristics. think good what is they for and how logical and realistic it should be. i.e. researching bat with leak is cheaper but not more costly.

fabrication probably not need related to this directly because is is overall with tech level, etc factors so main characteristics price dependency looks good for now.

→ a leak-tight battery is dearer than a leaky one: the spec merit divides the fee
by `1.5` per doubling of a *waste* (mass, leak, `1 − efficiency`), so making a
part worse never raises the fee. Fabrication stays out of the curve.

**open**: the merit exponents are per-axis constants copied from the ladder's
middle rung. There is no *reason* written down for why thrust and mass share a
power curve, and the ladder's own prices were derived from the same function, so
a bad exponent cannot be detected by the ladder. Re-derive one axis at a time
against a named physical story (e.g. a battery's leak is a seal-quality problem,
so its merit should be near-linear in `1 − leak`, not a power curve), and hold
the `balance_lab.html` surface as the check.

## 4.3 price ← `archive/draft.txt`

cost ladder is misconcept. we should have float continues sci research and no 'levels'. so cost = f(cost of research from initial point * some coefficient )
i mean research is somewhat additive - next research may be low cost to push top level a bit but total VECTOR from initial point may be calculated as total research cost of current item and lets like 10...20% if it will be build cost this need to be balanced

→ build cost *is* research from the origin: `buildCostOf` takes the total work of
the spec's point and multiplies it by a share, so there are no rungs left in the
price. `tier` survives only as a shop ordinal. The "10…20 %" is the `BUILD_SHARE`
knob in `balance_lab.html`.

## 4.4 ballance ← `0.4-draft-career.md`

because balance is difficult need some good test and possibility to manual adjust and easy told LLM what need to adjustment - i recommend to have something like button near each tech item to copy t specific name and current parameters that i can paste to LLM chat to tell this item need price up or mass low

→ `copy` on every shop row and every prototype, and `copy knobs` for a family's
frontier line — a paste-ready `tech: KIND ID { … }` block.

## 4.5 cheat test modes: ← `0.4-draft-career.md`

communism mode (all free), endgame mode (all upgrade installed)

→ `&cheat=communism` and `&cheat=endgame` (all pads top tier, purse 99).

## 4.6 the ship before it flies ← `0.4-draft-career.md`

tech tree:
start with weak electromagnetic catapult, solar panel, battery on 1 planet. ship has no cargo hold so only visit-observation and competitions can participate but no space for cargo delivery.
- catapult more force, better solar panel and bat capacity.
- auto-helpers available
- impulse engine (player can pause at any time and make impulse with same mechanics as start launch)
- more engine fuel tank, more force of engine, cargo hold capacity - all affect ship mass, once bought can be installed/uninstalled

→ `HOLD-0/8/24`, `IMP-1…3`, `FT-0…3`, `HELP-0…2`; every part masses, a free
`back` refits to any owned tier, and refit works on any planet. The impulse
engine is the pause-first burn loop (`../archive/0.5.17-plan-flight-hud.md`).

**open**, no plan (balance work, after `../0.6.2-plan-pad-fees.md`): the draft's
own ladder stops at three tiers of ship part while the pads have five. Nothing decides what a `HOLD-48` or an `IMP-4` would be for, and the
research hull can already *invent* a four-parameter engine that has no rung. The
smallest closure is not more tiers: it is letting the research prototype itself
become the `fit` row it already shows — which it does. So the open question is
purely balance: whether the stock ladder should be re-cut to three pads tiers
too, or the parts extended to five.
