# 5 · rivals and competitions

Who else flies, what they are like, and the timed events they enter. Text from
`archive/draft.txt` (§bot competitor, §competitions, §bot character, §map
statistics, §balance).

## 5.1 a rival with a character ← `archive/draft.txt`

implement bot character that prefer
- capture planet and build facilities
- quest take and solve
- use rocket engine
- participate competitions and have good ship for it.

→ today one controller flies every rival, with two tunable *policies* inside it
(`CAREER_BRIBE_PRONE`, the pad-gear payback rule) — not four characters. **open**,
and it is the largest single thing left in the drafts. The four preferences are
not four toggles: each one changes what the *opening* buys, which is exactly the
gap `0.5.16-plan-rival-first-shop.md` measured (a rival that never buys a hold
cannot take a quest, so half the board is invisible to it).

A plan must answer, in this order:

1. **Where the character lives.** A weight table on the rival record (one object
   per preference) read by the existing scoring calls is the smallest shape; a
   separate controller per character is the cleanest but forks `careerPlan`.
   Prefer the weight table: the scorer already ranks candidates, so a character
   is a change of weights, not of search.
2. **What is measurable.** Each character needs a bench name — pads claimed,
   quests completed, burns fired, competitions won — or nothing can be said about
   it. `career_gravity_bench` already prints pads, seized and medic trips.
3. **Which one ships first.** The "capture planet" builder is the one the
   existing scorer is closest to, so it is the cheapest to isolate; the
   "competitions" character has no competition logic to weight at all (§5.2).

## 5.2 competitions ← `archive/draft.txt`

implement competitions:
1. accept
2. time to land to Capital (for competitions that start from capital by rule) or any planet (if competitions rules allow). show timer countdown to competition start and task.
3. at some some before countdown: signal to aim and arm EMC (once armed in this time period then EMC does not run launch until countdown).
4. one launched ships perform task and get prices. prices balanced to be good profit compared to overall profit on this map per time (see map statistics).

### competitions

also implement have them as separate game modes.

max trajectory - any variations
max visits - any variations
land on antigravity planet - from capital only | from exactly planet that is far from target, only EMC
visit specific planet and return back - from exactly planet that is far from target, only EMC

#### competition variations:
- start from capital only / any
- allow rocket IMP engines / only EMC

#### think about new competitions or variations if found really interesting

→ a **first, much simpler** competition ships: one slot on the board in which a
flight launched from a named planet that lands after at least `1500…3000 px`
pays `2…4` within `180 s` (`makeCompete`, `TASK_COMPETE`, `LEG_COMPETE`). Nobody
tells anyone it starts, there is no countdown, and a rival never enters.

**open** — the timed event the note describes is not built. The three states it
needs are already in the code as *shapes*, so the plan should grow the existing
slot rather than add a second one:

1. **a start**: `TASK_OFFERED` → `TASK_ACCEPTED` already exists for contracts;
   a competition gets the same accept step plus a `startsAtStep` the board
   prints as a countdown.
2. **an arm window**: the career already has a queued launch that fires on the
   barrel's alignment (`gun · N s`). "Armed before the countdown, fires at it"
   is that exact queue with `startsAtStep` as a floor on `turretAngle` — no new
   launch path.
3. **a price pool**: one purse per entrant, paid on landing; the note's own
   §5.3 asks for the per-time profit table to price it against.

The separate game modes can wait for (1)–(3): each is the career rule with the
board replaced by one contract, which is a mode-row change and not a new rule.
Variations (`from the Capital only`, `EMC only`, no impulse) are fields on the
offer record, not branches in the flight code.

## 5.3 map statistics plots ← `archive/draft.txt`

- average profit per time by players and all. useful to balance new quests
- total property cost by player
- total sci spend by player
- average distance fly per time by players and all
- total corruption sum of all planets
think what is also interesting or useful

**open** — nothing draws these (the benches print some of them per run). Two of
the five are already tracked per career or per market and only need a readout:
`purse` over clock and `market.corruption` summed. The other three need a counter
that does not exist: property cost (sum of pad build costs per owner, derivable
from the galaxy), science spend (the ledger has no `spent` field today — add one
on the research accept path), and distance flown (the sim has `flightLength` per
flight; a career total is a one-field accumulator).

Placement: the note says *plots*, but the only always-on panel is the scoreboard.
The smallest useful build is one line per player under the scoreboard row —
`+0.42/s · 18 pads · 6.1 sci · 14.2 km/s · rot 214` — and the plot itself as a
collapsible strip under it, re-using the `balance_lab.html` drawing code rather
than a canvas in the frame loop.

## 5.4 the economic balance pass ← `archive/draft.txt`

### bot competitor

possible set player type user/bot

→ every scoreboard row has a live `bot` checkbox, hand-flight included.

### hard bots

hard bots need give more search time then easy. probably measure in startup and split available time

→ `0.4.27-plan-bot-balancing.md` (see `flight-lab-and-modes.md` §1.4 for the
field-side half).
