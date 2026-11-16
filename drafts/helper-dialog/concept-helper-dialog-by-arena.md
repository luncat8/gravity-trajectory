# concept — H, the comms officer: a dialog that is generated from causes

Source note: `helper-dialog-draft.md`. Written **before** reading
`suggestion-by-ERNIE55f.md` or the two GLM files, so the comparison that follows
it is honest. Nothing here is implemented.

## 1. what the draft asks for

- a captain's-base assistant, **H**, opened as a dialog;
- the player picks questions from something;
- a tree of answers, e.g. *"can't leave the planet"* →
  *«planet too heavy, you need an EMC»* → *«but you have no money for it»* →
  three ways to get money, each tagged with whether it is open to **you**;
- **a system that generates those questions and that tree dynamically**;
- first stage: information only; later stages may add buttons (`[repair btn in dialog]`).

So the deliverable is not a dialog. It is a **diagnosis engine** with a dialog
drawn on top of it. The most expensive mistake available here is to author the
tree.

## 2. the one hard decision: the tree is a projection of the rules layer

A hand-written answer tree is prose that restates numbers. This repository
changes its numbers in every other plan (bribe rot `0.7.16`, competitions
`0.6.4`, ship wear, tech fees). A 300-line tree would be wrong within one
release and nobody would notice, because a wrong answer reads exactly like a
right one. Worse: the game already prints the truth on the HUD, so a stale
tree produces two contradicting stories about the same pad.

The game has already solved the hard half of this problem, three times over:

| the question the player asks | the function that already answers it |
|---|---|
| *why can't I leave?* | `launchBlock` — one ordered reason string, one writer, shared by the launch list, the bot log and every scan: `under arrest` → `ship in space` → `shot leaves from P#` → `ship worn out` → `no rail under the ship` → `cap 48 < 61 px/s` → `fee 2.27 > purse 0.50` |
| *what is a visit worth?* | `careerLandingFacts` — cash and credit of a landing, per the rule's one factor table |
| *what is worth doing next?* | `careerGoalBodies`, `careerLandingFacts`, the launch book, `helperState`'s finished scans |

**Therefore H owns zero facts.** Every sentence it says is either authored
flavour (no numbers) or a formatted slot filled from those functions. A balance
change can make H terse; it can never make H lie. That single constraint is what
makes "dynamically generated" cheap enough to build and cheap enough to trust.

## 3. three layers

\trules layer     gravity_game.js, unchanged in meaning
\t   │  launchBlock / repairCost / exitCostAt / careerLandingFacts / careerGoalBodies
\tdiagnosis layer  commsFindings(career, sim, market) → ranked finding records
\t   │  { id, why, evidence[{label, value, need}], fixes[{ id, act, cost, guard }] }
\tdialog layer     comms card: authored copy + slots, chips, CTAs

The middle layer is the "system" the draft asks for. It is a pure function of
state, so a test can assert it, and the dialog is a dumb renderer over its
output. No dialog code reads `career` directly.

### 3.1 one small refactor in the rules layer

`launchBlock` returns only a formatted string, so H would have to parse English
to know *which* gate closed. Split it without touching one printed character:

\tlaunchReason(career, sim, planet, speed, repaired)
\t→ { id: 'cap', need: 61, have: 48 }  |  { id: 'fee', need: 2.27, have: 0.50 } | null
\tlaunchBlock(...) = formatLaunchReason(launchReason(...))   /* same strings */

Same text, same order, same callers; `launchReason` is the new switch point for
H, and the existing launch-list strings stay a test contract.

## 4. the vocabulary: findings

A finding is one thing wrong (or one thing worth doing) **now**, with its
evidence and its exits. Flat table, ordered by severity, first match wins for
the headline.

| id | when | headline idea | exits |
|---|---|---|---|
| `arrested` | `career.arrested` | the Capital is flying you home | *none — this one is not solvable* |
| `worn-out` | `!careerShipUsable` | no launch, no instrument, no burn | `repair` · `evac` |
| `no-rail` | `!sim.canLaunchFrom(at)` | nobody ever built a rail here | `commercial EMC-1` · `build` · `evac` |
| `cap` | `speed > speedLimit` | the planet is too heavy for your rail | *slower shot* · `build EMC-2` · `commercial` |
| `fee` | `purse < launchFee` | the rail is there, the money is not | `money` (see §5) |
| `condition-low` | `condition ≤ 50 %` | the instrument will go silent at 0 | `repair` · *fly it worn* |
| `broke-risk` | `purse < repairCost + cheapest commercial` | one bad landing ends the company | `money` |
| `deadline` | open contract ends in ≤ 60 s of clock | | `quest scan` · `point arrow` |
| `compete` | competition `startsAt` within 45 s | | `accept` · `point arrow` |
| `rot` | `market.corruption[at]` high and no report yet | a bribe is offered, and it is not free | `bribe` · `report` |
| `idle-money` | a scan finished and nothing is armed | | `arm it` |
| `nothing` | no finding | *you are fine; here is the biggest number on the map* | |

`condition-low`, `deadline` and `compete` are *warnings*: they do not block, so
they rank below blockers and never take the headline from one.

## 5. the tree is a recursion over fixes, not over prose

The draft's example is not a tree of text. It is a **goal with methods, where a
blocked method becomes a child goal**:

\tgoal  'leave this planet'
\t ├ fix  own EMC-1            guard: pad owned & charged
\t ├ fix  build EMC-1 · 3.04   guard: purse ≥ 3.04 → BLOCKED
\t │   └ goal 'get 3.04'                     ← the child, generated, not authored
\t ├ fix  commercial EMC-1 · 2.27   guard: purse ≥ 2.27 → BLOCKED, same child
\t ├ fix  guest on a rival rail     guard: rival pad here & purse ≥ fee + tax
\t ├ fix  evac home · 6.00          guard: purse ≥ 6.00
\t └ fix  wait — the pad earns when someone uses it
\t        note: you own no pad anywhere            ← a fact, printed from state
\t        note: a bribe is offered once per visit  ← a fact, printed from state

Rules for the walk: depth ≤ 2 (headline → its fixes → one child goal), each
method's guard is the game's own predicate, a method that passes is printed
once with a CTA, a method that fails is printed with its numbers and — only if
budget allows — one child line under it. Cycles are impossible because the cap
is depth, not memory. The draft's *«но у тебя таких нет»* is exactly the
`note` line: a guard that fails for a structural reason rather than a price.

Rendered, in the shipped voice (§8):

\tH · you are stuck on P6
\t  the rail here is a commercial EMC-1 and caps at 48 px/s; you aimed 61.
\t  fixed by: aim 48 or slower          [ slower shot ]
\t  or by:   build EMC-1 · 3.04         purse 0.50 · short 2.54
\t      → get money: commercial hop, OBS-1 flyby, a contract leg, a bribe,
\t        or a competition prize. You own no pad, so nobody pays you.
\t        [ best profit ] [ quest scan ] [ open the board ]

Two structural notes the copy must respect: `exitCostAt` can return `impossible`
(it must print as impossible, never as a number), and the commercial rail's
`2.27` is the *slowest* hop while a loaded commercial hop `4.54` never pays for
itself — that asymmetry is already in the README and H should say it, not
rediscover it.

## 6. the question list, generated

Two kinds of question, one list:

1. **`what should I do?`** — always first. It is the top finding, expanded.
2. **chips** — up to five, from the findings and the state, in severity order:
   `why can't I leave?` · `no money` · `my ship` · `the contract` ·
   `the competition` · `this bribe` · `what is a pad worth here?`.
3. **the index** — ~15 authored topics a player can browse, including three
   that never match a finding (`instruments`, `rivals`, `the Capital`) and one
   joke (§8). Browsing does not depend on state; only the chips do.

The chip list is `commsAsk(career)` — one function, sorted, capped, deduped by
`id` so a `fee` blocker never offers `no money` twice. A second opener — `?` on
the flight panel — shows the headline only, one line, so a player who never
wants a dialog still gets the *why*.

## 7. the surface

- **one card, bottom-right**, above the flight panel, not a drawer: 260–320 px,
  scrolls, collapses to a single line, and the flight panel keeps its place.
  The career drawer already owns the left/centre space; the photo deck owns
  bottom-left. A card is the only piece of chrome that can open mid-flight
  without moving another one.
- **H never stops the clock.** Career auto-pause already stops it at every
  landing, which is where 90 % of questions are asked; in flight the card shows
  one live line and no CTAs that would need a paused clock. No new pause path.
- **every CTA is an existing handler**, called through the same function the
  button calls (`repairCareer`, `evacuate`, `acceptBribe`, `armCommercial`,
  the shop row, `helperStartQuest`, the guide arrow). H never presses anything
  itself: the card renders a button, the player presses it. No new mechanics,
  no scripted autopilot.
- **stamp every answer** with the clock it was computed at (`checked 412 s`),
  and recompute on open, on landing, and on any `careerMsg`-level state change —
  the same invalidation `cancelHelperForChange` already does for scans. A card
  left open across a landing must never show the previous planet's advice.
- **keyboard/text first**: `h` toggles, `Esc` closes, chips are focusable,
  answers are `aria-live="polite"`, no canvas text. This is the one help
  surface that must be readable at any zoom on a phone (0.6.7 conventions).

## 8. the character

H is an **emissary of the cluster Capital**, and the draft's own picture is its
portrait: *a circus acrobat launched from an oversized planetary cannon, a
maritime signal flag in one hand and a compact aluminium spyglass in the other*
(`photos/draft-helper-joke.md`). That image is canon, not decoration: H is
somebody who was fired at a planet, waved at it, and looked at it through a
glass — a comms officer delivered by catapult. Art lives in `photos/helper/`
with a CSS fallback card, the same pattern `photo_deck.js` already uses, so the
dialog is complete before any art exists.

Voice, as constraints a plan can test by eye:

- **one cause per answer**, then the exits. Never a list of five guesses.
- **numbers, always live, never rounded for comfort.**
- never moralises about the bribe; states the price, the rot it adds, the
  arrest countdown, that it is one per visit — and stops. The scans already
  refuse to price a bribe; H explains it without recommending it.
- at most **one joke per answer**, and it is dry.
- never names a mechanism the HUD does not name. No new nouns.

The two easter eggs the draft asks for ship as cards, not as help text:

\tP: what is the meaning of life?
\tH: wrong address. The mission, though, I can do: collect, carry, report —
\t   up to the cluster Capital, which forwards to the Capital of the galaxy,
\t   which forwards to the Capital of all capitals, which sits outside space
\t   and time. Circus skills are welcome. Not required.
\t   [ the letter of introduction ]

## 9. invariants (each one is a test)

1. **no literal digits in authored copy** — every number arrives through a
   `{slot}` from the rules layer. Mechanically checkable: scan the copy table
   for `[0-9]` outside slot syntax. This is what stops the rot.
2. **no new constants.** If H needs a threshold (say "warn below 50 %
   condition"), it lives in `CAREER`/the rules layer and the HUD reads it too,
   or it does not exist.
3. **H changes no state.** No clock, no purse, no seed, no replay hash, no
   `Math.random`, nothing in the frame loop, no allocation per frame. The card
   is recomputed on events only, like the launch list.
4. **no orphan advice**: every CTA resolves to a real handler, and a CTA the
   purse cannot pay is rendered disabled with its reason — the same discipline
   the launch list already uses (`fee 2.27 > purse 0.50`).
5. **H works in every rule or says so.** `tour` / `money` / `route` get a
   two-line honest answer ("this rule has no purse; here is what *is* scored")
   rather than career advice with `undefined` in it.

## 10. naming

`helperState` and `gui_helper.js` are the **scan engine** — a different thing
with a load-bearing name (tests read `helperState.active`). The character gets
its own prefix so nothing collides:

- files `comms_copy.js?` no — one file: `gui_comms.js`, area "career · comms".
- ids `commsCard`, `commsChips`, `commsBody`, `commsFindings`, `commsAsk`.
- player-facing name: **H**, the comms officer; the panel is `comms`.
- **never call H "the helper" in player copy** — "helper" already means the
  scan buttons, and a help dialog that shares a name with a scan is a support
  ticket.

## 11. test contract

- `comms_findings_test.js` — pure function, no page: fixture careers built by
  the same stubs `career_guidance_test` uses, asserting the headline id and the
  fix list for: stuck on a heavy no-pad world (purse 0.50) → `no-rail` with
  `commercial` short by `1.77`; worn out with an affordable repair →
  `worn-out`; arrest → `arrested` and **no** fixes; healthy → `nothing`.
- `comms_copy_test.js` — the no-digit lint, plus every `{slot}` in every
  authored string resolves on a fixture career, and no string names a noun
  outside a whitelist of HUD nouns.
- `comms_gui_test.js` — a page test: open the card on a seed, read the headline
  text, compare the purse figure with `career.ledger.purse`; press the `repair`
  CTA and assert `careerMsg` shows what the real button shows; land and reopen
  and assert the headline changed.
- `dom_smoke` only once, when the card and its wiring land in `index.html`.

## 12. staged scope

| stage | content | why it is first |
|---|---|---|
| **M0** | `launchReason` refactor + `commsFindings` + the two-line headline on the flight panel, no dialog | the diagnosis is the product; a one-line *why* already beats the whole HUD |
| **M1** | the card: headline + fixes + CTAs, chips, `h`/`Esc`, stamp, invalidation | the draft's core loop, no authored tree yet |
| **M2** | recursion: blocked fix → child goal; `get money` and `get a rail` goals | this is what makes the draft's example appear *without* being written |
| **M3** | the index of topics, the character copy, `photos/helper/` card, the easter eggs | flavour, cheap, and where the joke belongs |
| **M4** | cross-rule answers; *"what would a rival do?"* answered from the **bot log line already printed** (never a fresh `careerPlan` — that is a multi-frame search and a second opinion that could disagree with the rival) | honest, free, and the last thing to add |

## 13. what the plan must answer first

1. **Is the headline single, or a short ranked list?** Single is faster to read
   and impossible to be wrong about; a list of three is more honest when two
   blockers are true at once (worn out *and* no money). My order says one.
2. **Does H ever speak first?** A card that opens itself at a landing is
   helpful once and infuriating on the hundredth time — the sound panel's
   "only after a gesture" discipline suggests: speak only if the player
   opened it before, and never during a replay.
3. **Is the bribe offered as a CTA?** The scan helpers refuse to price it; H
   printing a `[bribe]` button is a policy, not a UI detail. My answer: print
   the offer and its cost, take the player's press, never rank it as advice.
