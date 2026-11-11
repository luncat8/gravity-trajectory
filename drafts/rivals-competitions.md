# 5 · rivals and competitions

Who else flies, what they are like, the timed events they enter and the numbers
the map is balanced by. Text from `archive/draft.txt` (§bot competitor,
§implement bot character, §implement competitions, §map statistics plots).

## 5.1 a rival with a character ← `archive/draft.txt`

implement bot character that prefer
- capture planet and build facilities
- quest take and solve
- use rocket engine
- participate competitions and have good ship for it.

→ today one controller flies every rival, with two tunable *policies* inside it
(`CAREER_BRIBE_PRONE`, the pad-gear payback rule) — not four characters.

**open** → `0.6.6-plan-rival-characters.md`. It is the largest single thing left
in the drafts. The four preferences are not four toggles: each one changes what
the *opening* buys. `archive/0.5.16-plan-rival-first-shop.md` measured that gap —
a rival that never buys a hold cannot take a quest, so half the board is
invisible to it — and 0.5.22 closed it for every rival at once: the first
`HOLD-8` no longer waits for the HQ (`+3.07 ± 2.02` purse per rival-game over 30
seeds at 1200 s). A character may reorder that opening; it must not undo it.

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

**open** → `0.6.4-plan-competitions.md` — the timed event the note describes is
not built. The three states it needs are already in the code as *shapes*, so the
plan grows the existing slot rather than adding a second one:

1. **a start**: `TASK_OFFERED` → `TASK_ACCEPTED` already exists for contracts;
   a competition gets the same accept step plus a `startsAtStep` the board
   prints as a countdown.
2. **an arm window**: the career already has a queued launch that fires on the
   barrel's alignment (`gun · N s`). "Armed before the countdown, fires at it"
   is that exact queue with `startsAtStep` as a floor on `turretAngle` — no new
   launch path.
3. **a price pool**: one purse per entrant, paid on landing; the note's own
   «see map statistics» is §5.3, the per-time profit table to price it against.

The separate game modes can wait for (1)–(3): each is the career rule with the
board replaced by one contract, which is a mode-row change and not a new rule.
Variations (`from the Capital only`, `EMC only`, no impulse) are fields on the
offer record, not branches in the flight code. **open**, no plan yet: the four
game modes and the variations — which one becomes a mode-row entry first?

## 5.3 map statistics plots ← `archive/draft.txt`

- average profit per time by players and all. useful to balance new quests
- total property cost by player
- total sci spend by player
- average distance fly per time by players and all
- total corruption sum of all planets
think what is also interesting or useful

→ nothing draws these. The benches print a few per run (`earned`, `purse`, mean
rot), and the career already counts `earned`, `bribeIncome`, `taxEarned`,
`fuelSpent` and `evacuations`; the shared market holds `corruption`. Not counted
anywhere: what a flight's visits paid, the money put into property and into
science, the launch fees, the distance flown.

**open** → `0.6.10-plan-map-statistics.md`: the five statistics by player and
for all, three more for the note's last line (the visit value left standing on
the map, income by source, running cost by kind), a history that thins itself so
a run of any length fits, six small plots in a strip under the scoreboard, and
the same table from `career_gravity_bench` with `STATS=1`.

## 5.4 bot competitor ← `archive/draft.txt`

possible set player type user/bot

→ every scoreboard row has a live `bot` checkbox, hand-flight included. How well
that bot plays is `bots-and-tools.md` §8.1; the note on `hard` bots' search time
sits with the rest of its `balance plan` in `flight-lab-and-modes.md` §1.4.
