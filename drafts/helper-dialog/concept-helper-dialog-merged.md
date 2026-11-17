# concept (merged) — H, the base comms officer

Three proposals stand side by side in this folder, all answering
`helper-dialog-draft.md`:

| file | author | shape |
|---|---|---|
| `concept-helper-dialog-by-arena.md` | this agent, written **before** opening the other two | diagnosis engine over the rules layer, card UI, no authored tree |
| `suggestion-by-ERNIE55f.md` | ERNIE 5.5f | fact registry + per-topic checklist + option catalogue, JSON content, telemetry |
| `concept-helper-dialog-by-GLM53f(-en).md` | GLM 5.3f | state snapshot + node schema (`steps`/`lines`/`note`/`ref`/`actions`), radio dialog, 5 decisions signed off with the author |

This file is the merge. It keeps the spine all three reached independently,
takes the best primitive from each, **verifies every mechanical claim against
the code**, and drops what the repository cannot carry. It is still a concept:
the implementation plan comes after, and §8 is what that plan must decide first.

An important asymmetry in the input: the GLM file records five decisions
already agreed with the author (entry point, no pause, data-as-JS, faceless
operator for now, bribe wording). Those are treated here as constraints, not
options, except where the code contradicts them — and §3 shows one that does.

---

## 1. the spine: six things all three proposed separately

1. **H stores no answers; it stores rules and assembles the sentence.**
   *"H не хранит ответы"* (E), *"answers are built from the current state, never
   stored as ready-made text"* (G), *"H owns zero facts"* (A).
2. **One cause at a time, in priority order, first true wins.**
   Diagnosis `steps` (G) = first failing check (E) = the `launchBlock` ladder (A).
   The *entry point is the moment of the problem* (the draft, ERNIE): H calls the
   player with one icon when that first cause is closed — §4.11 turns the note
   into three states and a trigger that needs no authoring.
3. **Blocked options are shown with their reason, not hidden** — this is what
   makes *«но у тебя таких нет»* appear without anyone writing it.
4. **Answers end in a button that calls an existing handler.** No new mechanics,
   no autopilot.
5. **The question list is generated too**: chips carry a condition and rank by
   urgency, so a stuck player sees *can't leave* first and a comfortable one
   sees something else.
6. **Be honest rather than fluent**: an unknown cause gets "I see no obvious
   reason — what exactly happens?", never a plausible story.

That is the whole design, and three independent readings agreeing on it is the
strongest evidence in this folder. The differences are all in *the shape of the
data* and *how much fiction is allowed*.

---

## 2. what each proposal contributes, and what is rejected

### from ERNIE — the best primitive in the folder

**Taken: a fact registry where each predicate carries its own `why`.**

	const HF = {
		'purse':        { test: s => s.purse,                      why: s => 'purse ' + money(s.purse) },
		'repair-cost':  { test: s => s.repairCost > 0,             why: s => 'repair ' + money(s.repairCost) },
		'can-repair':   { test: s => s.purse >= s.repairCost,
		                  why: s => 'short ' + money(s.repairCost - s.purse) },
		'no-rail':      { test: s => !s.rail,                      why: () => 'no rail under the ship' },
		'own-pad':      { test: s => s.padOwner === s.index,        why: () => 'you own no pad here' },
		'own-pad-any':  { test: s => s.padCount > 0,                why: () => 'you own no pad anywhere' },
		'bribe-open':   { test: s => s.bribe > 0,                   why: s => 'the ruler offers ' + money(s.bribe) },
		...
	};

Two things fall out for free, and they are exactly what the draft asks for in
one line each: *«но у тебя нет денег»* is `HF['can-repair'].why`, and *«но у
тебя таких нет»* is `HF['own-pad-any'].why`. My own draft had findings and fixes
bundled into one record; ERNIE's split — **predicate registry once, topics
reference it** — is better, because a predicate's wording is then identical
wherever it is cited, and one test covers every use.

Also taken: open/closed option split; **"didn't help"** (*«не помогло»*) as a
real escape hatch that logs the unanswered intent; **"what changed"** from a
state diff; **the content validator at load** — every `when` resolves, every
slot fills, no follow-up cycle (as a node test here, not a runtime loader).

**Rejected, with reasons:**
- *JSON files loaded at start.* `file://` blocks `fetch`/`XMLHttpRequest` for
  local files in every current browser, and the repo is `file://`-first, no
  build. Content lives in a classic `<script>` as JS objects, like
  `saved_maps.js`.
- *Free text with keyword weights, Dice/Levenshtein, multi-intent parsing.* The
  player is choosing from chips that the game itself nominated; a matcher that
  guesses between them adds a failure mode and a language to maintain. A plain
  filter box over the topic index is the honest 5 % of this that pays.
- *Telemetry and metrics* ("share of answers followed by an action", "unknown
  intents", A/B of wording). There is no server and no analytics in this game,
  and none is coming. What replaces it is a test: the copy lint (§4.10) and the
  fixture in §6.
- *Facts that do not exist*: `ship.engines_ok` (the engine is a refit, not a
  wear state), `planet.shop` (a repair is possible on **any** planet the ship
  stands on — `repairCareer` checks nothing else), `planet.market`, `cargo`
  (a contract is one slot with legs; career has nothing to sell), `rep`.
- *`wait_base_income`* — "wait until someone buys EMC **or fuel** at your base".
  Fuel is bought from nobody: `buyFuel` subtracts from the purse and credits no
  owner. A pad's only income is the guest-launch tax (`taxPerKwh`). The draft's
  own example inherits this error and §3 corrects it.
- *Mermaid diagrams* in repo docs; the plans here are plain markdown.

### from GLM — the best data shape, and the honest boundaries

**Taken: the node schema.** `steps` (first true wins), `lines` with a
conditional `note` (one sentence serves every state), `ref` (a shared subtree
plugged into three answers instead of three copies), `chips` with `when`,
`actions` with `when` (hide) vs `enabled` (dim + *"short by 0.90"*).

**Taken: the entry point and the clock.** A radio/console reachable from
anywhere, non-modal, and the world clock **not** paused — landing already
auto-pauses, so the pause would be a second pause path for one question. This
beats my "card that opens where the ship is": H is a call, not a station.

**Taken: the five signed decisions** — with one correction in §3 (they name
rival characters that only exist in an unshipped plan) and one addition
(the persona, §4.8, kept inside "faceless in MVP").

**Taken: the comparison criteria of its §7** — state coverage, honesty, content
cost, boundaries. They are used as the axes in §3 and §5.

**Taken: "history resets when the planet changes"**, hardened in §4.7.

**Rejected:**
- *The `when` string DSL* — `when: "emc.need(planet) > emc.has(planet)"` needs a
  mini-interpreter and an evaluation path in a codebase that has neither, and
  an expression error is a silent wrong answer. Merged replacement: `when` is a
  **registry key** or one of three plain combinators (`{all:[…]}`, `{any:[…]}`,
  `{not:…}`) — still pure data, no parser, and the validator can prove every key
  resolves. See §4.3.
- *Mechanics quoted as live that are still only plans.* Verified below.
- *`h` as a hotkey* — right that it is taken (`KeyH` and `?` both open the rule
  drawer, `gravity_gui.js:917`), but the conclusion should be: **no hotkey in
  the MVP**, a button beside that drawer, and `c` only if a key is ever wanted.
- *"EMC-2 — 3.10"* — the pad rows are `EMC-1 3.04`, `EMC-2 7.83` (README §career,
  `dom_smoke` asserts `buy EMC-1 · 3.04`). Prices are read, never quoted.

### from my own draft — what survives

The `launchReason` split (§4.4) — the single refactor this feature needs in the
rules layer, and the reason H cannot rot. The **no-literal-digits copy lint**
(§4.10). The staging that ships the one-line *why* before any dialog (M0). The
refusal to let H run a fresh `careerPlan` for "what would a rival do?" — it
would be a second, slower opinion that can disagree with the rival on screen.

---

## 3. verified against the code: what H may talk about

Every proposal tells stories about mechanics. Half of those mechanics are still
plans at the repo root. A dialog that explains a countdown that does not exist
is worse than no dialog, so this table is the merge's hard filter.

| claim in a proposal | state in `main` | H's rule |
|---|---|---|
| competition: 45 s announcement, `0.50` entry, pool `2–4 + 0.5 × entrants`, 180 s window, first qualifying landing wins (G §4.4, E `competition.open`) | **not built** — no `startsAt`, no `pool`, no entry (grep: zero hits). Live: one sport slot paying `2…4` for a landing of at least the shown length | talk about the slot that exists: *"the sport slot pays for one long landing; it is on the board now / not now"* |
| founding a colony, "the reward of a loaded delivery is the price" (G §4.4, E `bases`) | **not reachable** — `Sim.seedColony` exists and only `experiments/` calls it (drafts/career-economy §2.5: "decided and half built") | no colony topic until a button exists |
| "bases earn when someone buys EMC **or fuel**"; "wait for fuel sales" (G §4.4, E `wait_base_income`) | **fuel pays nobody** — `buyFuel` takes from the purse, credits no owner. Pad income is the guest-launch tax only (`taxPerKwh`) | *"a guest launch on your rail pays you a tax; nothing else does"* |
| rival characters Builder / Emissary / Rocketeer / Racer, "Rocketeer and Racer take bribes" (G, signed decision 1) | **plan only** (0.6.6, no `CAREER_CHARACTERS` in code). Live: one seeded flag, `GravityBot.prototype.careerBribeProne` | never name a persona; say *"some companies price a bribe into a landing, some don't"* |
| "planet visits pay `0.24 → 4.00`" (G §4.2) | `MONEY = { cost: 1, k: 0.00625, initSec: 40, cap: 4 }` — the curve is the market's, not those numbers | slot reads `planetProfit`; no number is ever typed into copy |
| "the ship is broken / engine broken" (E `ship.engines_ok`, G `ship.broken`) | there is **one** condition, 0–100 %, and only two thresholds exist in the code: `< 1` (a repair is offered, `repairCost` prices `2.00` per whole condition) and `0` (`WORN_OUT_BLOCK`: no launch, no burn, no report, `careerShipUsable` false). Any "warn below N %" would be a **new constant**, which §4.10.2 forbids | say *condition %, what it costs to fix, what it costs to ignore*; never invent a warning line |
| "repair at the local workshop, needs a shop on the planet" (E, G) | false — `repairCareer` works on any planet the ship stands on | "anywhere you stand is a yard" |
| "sell cargo at a market" (E) | no career action; contracts are legs, not inventory | drop it |
| player may take bribes, once per visit, until another planet | **true** (`acceptBribe`, `reportPrev`/`reportStep`, 0.7.16) and the README's rival wording buries it | keep, and fix the README line in the same change (§4.9) |

Everything else the proposals cite checks out: the evacuation at `6.00`, the
commercial rail on every planet, `2.50`/kWh, the `2.27` slowest dry hop against
a `4.50` delivery cap, wear `1 %`/game-second in space and `10 %` per landing,
the repair at `2.00` per whole condition, `EMC-1 3.04`, the arrest
(`under arrest · Capital transport`, and no way out of it), and `OBS-1` going
silent at `0 %`.

---

## 4. the merged design

### 4.1 layers

	rules layer       gravity_game.js / orbit_tech.js — unchanged in meaning
	  │  launchReason · repairCost · exitCostAt · launchFee · careerLandingFacts
	  │  careerGoalBodies · padLift · bribeOffer · planetProfit · careerWeather
	facts layer       HH_FACTS: id → { test(snapshot), why(snapshot) }
	  │               HSNAP: one read-only snapshot built on open / landing / change
	topics layer      H_TOPICS: id → { ask, rank, steps, lines, ref, chips, actions }
	  │               resolves facts by key; combinators are data
	dialog layer      gui_comms.js: card, transcript, chips, CTAs, stamp

Four layers because three of them are separately testable: `HH_FACTS` needs no
page, `H_TOPICS` needs only a snapshot fixture, and only the card needs a DOM.

### 4.2 the snapshot, not the career

`hSnapshot()` reads the live objects **once**, on open, on landing, and on any
`careerMsg`-class event — the same invalidation `cancelHelperForChange` already
performs for scans. Every fact and every line reads the snapshot, so the whole
answer is consistent with one instant and the card can never mix two planets.
Allocation is fine here: it happens on a click, never in the frame loop.

### 4.3 the topic record

	const H_TOPICS = {
		'money': {
			ask: 'no money',
			rank: 20,
			steps: ['at-arrest', 'ended', 'at-space'],   /* first true wins; first true *replaces* the topic */
			lines: [
				{ text: 'money can be earned:' },
				{ text: 'by flying past planets with a working OBS-1.', ref: 'obs' },
				{ text: 'by taking the ruler’s offer — one per visit, until you leave this planet.',
				  when: 'bribe-open' },
				{ text: 'by winning the sport slot.', when: 'sport-open',
				  note: { text: 'nothing on the board now', when: 'sport-closed' } },
				{ text: 'by a guest launch on your rail.', when: 'own-pad-any',
				  note: { text: 'you own no pad anywhere', when: 'own-pad-any', invert: true } },
				{ text: 'by a contract leg.' }
			],
			ref: [],
			chips: ['sport', 'bribe'],
			actions: []
		},
		'leave': { … }
	};

`when` is a key of `HH_FACTS`, or `{ all: [...] }` / `{ any: [...] }` /
`{ not: key }`. No strings are evaluated. The validator proves every key exists,
so an authored typo fails a test instead of hiding a line at runtime.

`note` (GLM) keeps one sentence serving both states. Where a `note` would only
restate a `why`, it is not written at all — the registry produces it. That is
the rule that keeps the copy table from doubling.

### 4.4 one ladder, one writer: `launchReason`

The draft's first question — *«не могу улететь»* — is 90 % of the feature, and
the game already answers it in one place with one ordered ladder
(`gravity_game.js:1205`):

	arrest · ship in space · wrong planet · worn out · no rail · cap < speed · fee > purse

That order is not arbitrary and H must not invent a second one. The only change
proposed to the rules layer:

	launchReason(career, sim, planet, speed, repaired) → { id, need, have } | null
	launchBlock(...) → formatLaunchReason(launchReason(...))   /* same strings */

Same text, same callers (launch list, bot log, scan gate), same test contract;
H switches on `id` instead of parsing English, and a new gate added later shows
up in H for free. This is the single structural change the feature needs, and it
is small enough to land in M0 with nothing else.

Rendered by the ladder, with the draft's own example (heavy planet, no pad,
purse `0.50`):

	H · P6
	  the rail here is a commercial EMC-1 and caps at 48 px/s; you aimed 61.
	  fix: aim 48 or slower                                  [ slower shot ]
	  or:  build EMC-1 · 3.04            purse 0.50 · short 2.54   (dim)
	  or:  evacuate home · 6.00          purse 0.50 · short 5.50   (dim)
	      → why you are short           [ no money ]

Bribe and guest-tax land under `[ no money ]`, which is the draft's second
question, reached from the first one — by data, not by a hand-drawn branch.

### 4.5 the money topic is one subtree, cited three times

`money.faq` (G) is plugged in by *can't leave*, *can't repair*, *can't build*.
In the merged schema this is `ref: ['money']` on those topics, exactly one copy
of the wording. Where the shortfall is a single step away ("take the offer, then
the evacuator is paid"), H may say so as one line — the bounded look-ahead both
E and I wanted — but only one step, only over *actions that exist on this
planet*, and never as a ranked recommendation. If the step does not exist, the
line is not printed.

### 4.6 chips: integer ranks, no formula

ERNIE's weighted score (`3·intent + 2·urgency + 1·context + 1·novelty −
2·fatigue`) is the right instinct with five knobs nobody can test. Merged:

- every topic carries an integer `rank` (`0` = blocking, `50` = flavour);
- the chip list is the topics whose `when` holds, sorted by `rank`, then by
  *not asked since this planet* (one boolean, `H.seen[id]`), capped at 6;
- `what should I do?` is always chip #1 and is not a topic — it is the top
  finding, expanded with `ref`;
- no two chips may share a `ref` target, so `no money` never appears twice from
  two different blockers.

One integer and one boolean. A test can assert the exact chip list for a
fixture, which is worth more than a well-argued weight vector.

### 4.7 surface, freshness, transcript

- **entry**: a `comms` button beside the rule-help button (`?` / `KeyH` open the
  rule drawer today — `gravity_gui.js:917`), and a **notice icon that H raises
  itself** when it finds a problem at the moment of the problem. See §4.11 for
  the call, the ignore, and when the icon disappears. **No new hotkey in the
  MVP**: `KeyH` and `?` already open the rule drawer, and `KeyC` is free but
  would sit next to `KeyF`/`KeyZ`/`KeyP` and the arrow trims — a key is only
  worth taking when the button proves too far.
- **card**, non-modal, ~300 px, bottom-right above the flight panel, scrolls,
  collapses to one line. It never pauses the clock and never moves the flight
  panel. On a phone it becomes the same overlay the photo deck already uses when
  space runs out.
- **stamp**: every answer line reads `checked 412 s · P6`. **The transcript
  clears on a planet change** (G) — old numbers are exactly the rot this design
  exists to prevent, and a stamp alone does not stop a player reading them.
- **history** up to the last 3 exchanges, with `back`, because the draft is a
  conversation.
- **`didn't help`** (E) as the last chip of every answer: it clears the topic
  and offers the three nearest, and writes `careerMsg`-style log line. No
  telemetry — the log is the player's, and a test can read it.
- text first: focusable chips, `Esc` closes, `aria-live` on the answer block, no
  canvas text (this is the one help surface that must work at any zoom).

### 4.8 the character: a voice with a canon and no face

The five signed decisions keep H faceless in the MVP. Kept — and filled with
the canon the draft already contains, so the voice costs no art and no new
system:

H is the **comms officer at the captain's base**: an emissary of the cluster
Capital, delivered to a planet by somebody else's catapult, signal flag in one
hand, aluminium spyglass in the other (`photos/draft-helper-joke.md` — the
draft's own image). No portrait in the MVP; when art exists it lands in
`photos/helper/` with the CSS fallback card `photo_deck.js` already uses, which
is the repo's one pattern for optional art.

Voice, as constraints rather than taste:

- one cause, then the exits; numbers live, never rounded for comfort;
- at most one dry joke per answer, and none while the ladder is blocking;
- never a noun the HUD does not already use — H introduces no vocabulary;
- the bribe gets the price, the rot, the arrest countdown and the one-per-visit
  rule, and no advice (§4.9);
- the two easter eggs ship as cards, not as help text:

	P: what is the meaning of life?
	H: wrong address — the mission I can do. Collect, carry, report: up to the
	   cluster Capital, which forwards to the Capital of the galaxy, which
	   forwards to the Capital of all capitals, which sits outside space and
	   time. Circus skills welcome. Not required.
	   [ the letter of introduction ]

### 4.9 the bribe: reported, never ranked

The scans already refuse to price a bribe into a landing (`careerLandingFacts`
ignores it; only `careerBribeProne` rivals price it), and that asymmetry is
deliberate. H inherits it: it **prints the offer with its value, its rot, its
arrest countdown and that it is once per visit**, and it never puts the offer in
a ranked *fix* list. A player learns it is there and what it costs; the decision
stays theirs. One button, one press, no confirmation dialog invented.

GLM's README correction stands, with the law that actually exists: *any* company
may take the rulers' offer, one per visit, and a rival's difference is only
whether its controller prices that offer — not four named characters. This is a
one-line README edit made in the same change as the dialog, because H quotes it.

### 4.10 invariants — each one is a test, not a style note

1. **no literal digits in authored copy.** Every number arrives through a slot
   from the rules layer or the snapshot. Grep-able: a test walks the copy
   tables and fails on `[0-9]` outside a slot. This is the one rule that keeps
   H from becoming the fourth source of truth about a price.
2. **no new constants.** A threshold H needs ("warn at `≤ 50 %`") either exists
   in the rules layer and the HUD reads it too, or it does not exist — and §3
   shows that the wear warning does not exist, so H prints the condition and
   the repair price and warns nothing. Only `< 1` and `0` are real.
3. **H changes no state** — no purse, clock, seed, replay hash, no
   `Math.random`, nothing in the frame loop, no per-frame allocation.
4. **no orphan CTA**: every `act` resolves to a real handler, and a CTA the
   purse cannot pay is dimmed **with its reason printed** — never a tooltip
   (the launch list's own rule: `fee 2.27 > purse 0.50`).
5. **no unimplemented feature is ever described** (§3): if a mechanic has no
   button and no state, H has no topic for it.
6. **H works in every rule or says so.** `tour` / `money` / `route` get an
   honest two lines (`this rule scores distance; no purse`) instead of career
   advice with `undefined` in it.

---

### 4.11 the entry point: H calls the player, and the icon is the contract

The draft's own line — *«entry point at the moment of the problem»* — is a
**call, not a toast**. H does not speak first: it raises one small icon, the
player decides whether to answer. The three states are the whole specification:

| state | shown | cleared by |
|---|---|---|
| **quiet** | the `comms` button, dim, no badge | — |
| **called** | the same button, lit, with the finding's tag (`no rail`, `worn`, `fee 2.54 › purse`) and a `!` badge | the finding changes, the card is opened, or the player dismisses |
| **dismissed** | the button only, no badge, no tag | nothing. One silent re-call per fact-change (§4.11.2) |

**4.11.1 what counts as a problem.** Not "something is suboptimal" — that is the
scan engine's job (`gui_helper.js`) and it already has its own button. H calls
only for a **closed gate the player is standing behind**, and the trigger is
mechanical, so nothing is authored for it: *called ⇔ the player has a shot
armed from this planet (`armed`, `aimBody` — the state the launch button
reads), and `launchReason` names a gate for it, and neither the gate nor the
player's last armed shot changed in the last second.* Both sides exist already
— `launchReason` (§4.4) and the armed-shot state `gui_aim.js` keeps — so the
call invents no timer, no threshold and no second ranking. That condition is
also what makes the call rare: it cannot fire during a drag (the aim is
changing), it fires once the player stops fighting the pad, and taking the
shot away quiets it. The one case that calls without an aim is the ship worn to
`0` (`WORN_OUT_BLOCK`): every shot is blocked by that fact alone, so the gate is
the problem whether or not a shot is armed, and `launchReason` already reports
it — no second check is written for it.

**4.11.2 it never nags.** Three rules, and they are why this is not a tutorial:

- **one call per fact-key per planet visit** — the key is
  `gate id + planet + the numbers in it` (from §4.4's `{ id, need, have }`), so
  *"fee 2.54 › purse 0.50"* called once is never called again, but the same gate
  with a new price after a purse change is a new fact and may call once more;
- **the ignore is remembered** for the whole planet visit (`commsState.dismissed[key]`),
  and §4.7's transcript reset clears it with the transcript — a dismissal is a
  statement about this planet, not about the game;
- **never while the clock is settling, during a replay, or while the card is
  open**, and never twice in the same second: the call rides the HUD tick
  (`gui_frame.js`) in the same throttle the flight panel already uses.

**4.11.3 when the icon disappears.** *"problem solved → icon disappears"* is
taken literally, and it is free: the call is a **rendering of the snapshot**, not
a record. `launchReason` returning `null` (gate cleared, or the ship left the
planet) puts the button back to quiet in the same tick, with no timer and no
"dismissed" flag to clean up. A dismissal hides a *call*, never a *fact*: the
tag still updates, so an impatient player who dismissed it can see the number
move when they sell the OBS data.

**4.11.4 what the call costs.** Nothing new in the frame loop: §4.4's
`launchReason` is already computed for the launch button and the flight panel's
state tag, and the comparison `call key ≠ last key` is a string compare per HUD
tick (twice a second) — the same shape as `flightHud.state` in `gui_flight.js`.
The counter and the dismissal map live in `commsState`, are cleared by the same
`cancelHelperForChange`-style invalidation, and §4.10.3's "H changes no state"
still holds: a call writes a *log line and a badge*, never a purse, a clock or a
replay hash.

**4.11.5 why not the toast.** A toast is seen during a flight the player is
losing, cannot be re-read, and competes with the flight panel's own state tag,
which already prints the gate in words. The icon is the smallest object that
survives both — and it is the draft's own shape: *"if call ignored or problem
solved, the icon disappears"*.

## 5. content inventory (live features only)

| topic | rank | source of the wording | ref/cited by |
|---|---|---|---|
| *what should I do?* (meta) | — | A/G | expands the top finding |
| can't leave | 0 | draft, `launchReason` ladder | `money` |
| ship condition / repair | 5 | draft, G §4.3 | `money` |
| no rail here / build a pad | 6 | draft | `money` |
| no money | 10 | draft, E §4.2, G §5.3 | — |
| fuel (tank, `0.08/kg`, `20 kg/kWh`) | 12 | G §4.4 | `money` |
| a bribe and its rot | 14 | draft, 0.7.16 | `money` |
| contracts and legs | 16 | README, 0.6.5 | `money` |
| the sport slot | 18 | README (live law only) | `money` |
| what a visit pays / OBS-1 | 20 | draft, G | `money` |
| the rail line, EMC tiers, the turret | 30 | README | `leave` |
| rivals and the clock | 34 | README | — |
| evacuator | 36 | G §4.4 | `leave` |
| saving, seeds, replays | 40 | README | — |
| the Capital / A.R.F. | 42 | draft | — |
| *meaning of life* | 99 | draft | — |
| *didn't help* | — | E | every answer |

~16 topics, three of them flavour, one of them a joke. ERNIE and GLM each
estimated 10–14 nodes; the live-feature filter lands in the same place, which is
a good sign for the content budget.

---

## 6. test contract

| test | asserts | why it is the cheapest guard |
|---|---|---|
| `comms_facts_test.js` | every `HH_FACTS` key has `test` and `why`; `why` never contains a digit literal; the ladder order equals `launchReason`'s | no page, milliseconds |
| `comms_topics_test.js` | every `when`/`ref`/`chips` id resolves; the combinator trees are acyclic; the chip list for four fixtures (stuck, worn, healthy, arrested) is exactly `['what should I do?', …]`; the copy tables contain no digit literal; every slot resolves on a fixture snapshot | this is ERNIE's loader validator, moved to CI where it cannot be skipped |
| `comms_call_test.js` | the call key is `gate id + planet + numbers`; a dismissed key stays quiet for the rest of the visit and is offered again only after the numbers change; `launchReason` returning `null` quiets the button in the same tick; no call during a replay or while the card is open | the facts, no page |
| `comms_page_test.js` | open on a seed, headline text, purse figure equals `career.ledger.purse`, the `repair` CTA produces the same `careerMsg` the real button does, land, reopen, headline changed, transcript cleared | one page load |
| `dom_smoke` | the card's wiring and load order, once | only when `index.html` changes |

Plus one rules-layer check in the same change: `launchBlock`'s strings before
and after `launchReason` are identical for every existing caller — the launch
list's own page test already covers most of it.

---

## 7. stages

| stage | content | the point |
|---|---|---|
| **M0** | `launchReason` split + `HH_FACTS` + one line of *why* on the flight panel's state tag | a one-line cause already beats the whole HUD, and it needs no dialog |
| **M1** | the call icon (§4.11) and, on a press, the card: chips, answer, dim CTAs with reasons, stamp, transcript reset, `Esc`, no pause | the draft's core loop plus its own entry point, still with zero authored answers |
| **M2** | `ref` subtrees + the bounded one-step look-ahead (`money` under a shortfall) | this is where *«потому что у тебя нет денег»* appears without being written as a tree |
| **M3** | the topic index, the canon and the voice, `photos/helper/`, the easter eggs, `didn't help`, *what changed* | flavour, cheap, and the only place a joke belongs |
| **M4** | the README bribe wording; per-rule answers for `tour`/`money`/`route`; optionally *"what is the rival doing?"* answered from the **bot log line already printed** (never a fresh `careerPlan` — a second opinion that can contradict the rival on screen) | the edges |

---

## 8. what the plan must decide first

1. **Decided: headline plus other blockers.** Show the first active launch
   blocker as the headline and the remaining active blockers underneath, in
   the shared `launchReason` ladder order. H has no independent blocker ranking.
   Example: “Repair your hull first”, then “You need 20 more credits for launch.”
   The shared checker must expose all active blockers while preserving the
   first-result contract for existing launch callers; do not duplicate rules in H.
2. **Does H ever speak unasked?** Decided in §4.11: **it calls with an icon,
   never with text or a toast**, once per fact-key per planet visit, and the call
   disappears by itself the moment the gate clears. The flight panel's state tag
   already prints the same gate in words, so the icon adds `!` and a tag, not a
   second story. H never opens the card by itself — that stays the player's
   press, and never during a replay.
3. **Is the one-step look-ahead allowed to recommend?** "Take the offer, then
   the evacuator is paid" is arithmetic over live numbers, or it is a strategy
   the player did not ask for. My answer: allowed, one step, printed as a line
   under the two dim options it connects — never as a chip, never with the bribe
   ranked (§4.9).
4. **Does `launchReason` land first?** It touches `gravity_game.js`, which
   four callers share. My answer: yes, alone, in M0, with its test — and nothing
   else in that commit.
5. **What is the file called?** `0.7.17-plan-helper-dialog.md` at the root
   (0.7.16 is the highest open plan), code in `gui_comms.js` + `comms_copy.js`
   if the copy table outgrows it. The prefix is `comms`, never `helper` — that
   name belongs to the scan engine (`helperState`, `gui_helper.js`), and a
   dialog sharing a name with a scan is a support ticket. Player-facing name is
   **H**; the panel is `comms`.

---

## 9. one sentence

**H is a small, testable reader of the rules layer with a dry voice: it walks
the same gate ladder the launch list already prints, raises one icon when the
player is standing behind a closed gate, shows the first closed gate with the
numbers that closed it, keeps every alternative visible but dim with its own
price, and never writes down a number of its own.**
