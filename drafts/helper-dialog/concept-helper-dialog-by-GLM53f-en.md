# Concept: H-helper — the captain's base radio assistant

**Status:** concept (pre-implementation-plan stage), suitable for comparison with other proposals.
**Related files:** `gui_helper.js` — the trajectory auto-scanner (quick scan / best profit / EMC scan); that is a *different* entity, not the dialog assistant. `gui_help.js` — the static help on `?`/`h`. The H-helper trees will read the state currently collected by `gravity_game.js` / `gui_career.js` / `orbit_econ.js`.
**Language:** this is the English copy of `concept-h-helper.md`; in-game dialog copy is authored in Russian first, node ids and the DSL are English (localization-ready).
**Notation:** P — player, H — helper. *Italics inside H's answers* — a dynamic insert. `[Button]` — an action.

---

## 1. Idea

Career mode asks the player to keep many rules in mind: EMC tiers per planet gravity, the evacuator, bribes, colonies, competitions, contracts, wear and fuel. Players get stuck ("can't take off"), opening the static help is awkward, and there are no on-the-fly hints in the game.

**H-helper (H)** is the duty radio operator at the captain's base (HQ). The player (P) calls in and picks a question from chips. H answers with **generated** text assembled from the live game state: irrelevant branches are hidden, matching ones get conditional inserts like *"...but you don't have any"*, and action buttons are attached to the answer.

Principles:

1. **On request.** No pop-up tutorials: H stays silent until the player asks.
2. **Context.** The answer is built from the current state (an Hctx snapshot), never stored as ready-made text.
3. **Action.** If an action is available, the answer ends with a button: [Repair], [Build EMC-2], [Shop].
4. **Honest.** H only says what it can compute from the state; an unknown cause gets an honest fallback, not a made-up story.
5. **No spoilers.** Trajectory search stays with the auto-scanner; H explains rules and game state.

---

## 2. Dialog mockup

**Entry point:** a **radio dialog with HQ** — a radio button on the panel plus a hotkey (pick a free key at implementation time: `h` is taken by help). The radio works from anywhere, not only at the base. The dialog is non-modal and the world clock is **not** paused: landing already triggers an auto-pause, and most questions are asked by a ship that is already parked on a planet. Close with ESC, like help.

```
┌─ HQ radio ────────────────────────────────── ✕ ┐
│ Captain, how can I help?                        │
│ [Can't take off]        [No money]              │
│ [Ship damaged]          [Fuel]                  │
│ [Quests] [Bases] [Competitions] [Evacuator]     │
│ [Career rules]                                  │
│ ──────────────────────────────────────────────  │
│ P: I can't take off from this planet            │
│ H: The planet is too heavy: EMC-2 is required,  │
│    you have EMC-1 — it must be built.           │
│    But you have no money to build it.           │
│    Or leave on a commercial evacuator.          │
│    [Build EMC-2 — 3.10] [Evacuator — 6.00]      │
│    [Where do I get money?]                      │
│ ▲ history scrolls                                │
└────────────────────────────────────────────────┘
```

Behavior rules:

- **Chips** are the top level, question categories. The chip set is generated too: e.g. the "Quests" and "Competitions" chips carry `when: "mode == 'career'"` and are hidden in lab.
- **H's answer** is a block: text lines + conditional inserts + action buttons + follow-up chips (clarifications like "Where do I get money?").
- **Action buttons** call existing handlers (shop, repair, evacuator, building). If money is short, the button is dimmed with a tooltip "short by 0.90".
- **History** persists until the player changes planets, then resets (the inserts would go stale).

---

## 3. Catalog of typical questions

| Category | Player question | What H generates |
|---|---|---|
| Launch | "I can't take off from this planet" | diagnosis: EMC → repair → fuel → not on pad |
| Money | "No money" | income sources filtered by state |
| Ship | "Ship damaged", "What about OBS-1?" | repair with price, condition warnings |
| Fuel | "Running out of fuel" | refueling, pad charge conversion, FT-1…FT-3 tanks |
| Bases | "How do I found a colony?", "Why is my base not earning?" | founding requirements, what bases give, who buys |
| Quests | "How do contracts work?", "Quest failed" | deliveries and medevacs, rewards, two-leg quests |
| Competitions | "How do I enter a competition?" | rules, 0.50 entry, prize pool, nearest announcement |
| Evacuator | "How do I get home?" | price 6.00, when it makes sense |
| Rules | "What is career mode?", "How do I save?" | EMC network, rivals (16), planets (48), seeds/replays |

---

## 4. Answer trees (working depth)

### 4.1 P: "I can't take off from this planet. What do I do?"

H checks causes by priority and shows **only** the matching branches:

**Branch 1 — the planet is too heavy: EMC tier insufficient** (`emc.need(planet) > emc.has(planet)`)

- H: The planet is too heavy: {emc.needName} is required, you have {emc.hasName} — it must be built.
  - **Money available** (`money >= emc.cost(planet)`):
    - [Build {emc.needName} — {emc.cost}] — once built, the launch becomes available.
  - **But you have no money to build or research it** (`money < emc.cost(planet)`):
    - You can leave on a commercial evacuator. [Evacuator — 6.00]
    - You can wait a bit and take a bribe from the planetary ruler. Note: this is available only once, until you visit another planet.
      *insert if the bribe is already taken: "you already took the bribe on this planet"* — branch hidden.
    - Or wait until someone buys EMC or fuel at your base.
      *insert if there are no bases: "...but you don't have any"; if there are: "your base: {bases.where}"*
    - Or win a competition prize → follow-up chip "How do I enter a competition?".
  - **If an EMC cannot be built here** (Capital, A.R.F., or the planet is taken): only the evacuator, or a hop to a lighter planet on impulse (fuel cost, IMP-engine burns).

**Branch 2 — the ship is broken** (`ship.broken`)

- H: Your ship is broken, it needs repair at the local workshop. [Repair — {repairCost}]
  - But you have no money. → (→ ref `money.faq`, see 4.2)
  - Insert: "repair costs 2.00 per full condition, proportionally: from 72% — 0.56".

**Branch 3 — no fuel** (`fuel < launch.minFuel`)

- H: There is not enough fuel to launch.
  - Refuel at the port — 0.08/kg. [Refuel]
  - Pad charge conversion — 20 kg/kWh. *insert if the pad is not yours: "but this pad is not yours"*
  - A bigger tank fixes it for the future. [Shop: FT-1…FT-3]

**Branch 4 — you are still in flight / not on a pad** (`!ship.onPad`)

- H: Land first (or wait until you approach the port) — launches happen from a pad.

**Fallback** (no cause confirmed): H: I see no obvious reason — the ship is ready and the EMC is sufficient. Try launching again; if it fails, tell me what exactly happens.

### 4.2 P: "No money" — shared subtree (id: `money.faq`)

H: Money can be earned:

- by flying past planets with a working OBS-1 observation device.
  *insert if OBS-1 is not working: "but OBS-1 is down right now — check ship condition"*
- take a bribe from a planetary ruler — once, until you change planets. *branch hidden if the bribe is unavailable or already taken*
- win a competition prize. *insert if one is upcoming: "nearest: {competition.where}, entry 0.50"*
- profit from sales at one of your bases.
  *insert if there are no bases: "...but you don't have any"; if there are: "sales at {bases.where}"*
- planet visits: the longer a planet stays unvisited, the higher the payout (from 0.24 up to 4.00).
- complete a contract: a delivery (up to 4.50 with HOLD-24) or a medevac. [Contract list]

Chips: "Quests", "Competitions". No actions — this block is informational.

### 4.3 P: "Ship damaged"

- H: Ship condition: {ship.condition}% (OBS-1 tracks condition and dies at 0%).
  - **Light wear** (> 50%): you can fly, but wear accumulates in flight (space wear ×0…×3 in career).
  - **Heavy** (≤ 50%): OBS-1 lies or goes silent; risk of being left without a ship far from workshops.
- [Repair at the local workshop — {repairCost}] — 2.00 per full condition, proportional to wear (from 72% — 0.56).
- But you have no money → (→ ref `money.faq`).
- Tip: hard landings and burns at the limit are the main sources of wear.

### 4.4 Compact trees for the remaining systems

- **P: "Running out of fuel"** — branches: port (0.08/kg) → own pad (charge conversion, 20 kg/kWh) → a bigger tank [FT-1…FT-3] → Δv economy: gravity assists instead of burns (IMP-1/IMP-2 burn fuel).
- **P: "How do I found a colony?"** — requirements: the ship has landed; no colony on the planet yet; it is not Capital and not A.R.F.; you hold a loaded delivery contract with ≥ 8 t of freight, and it is not a tourist one. The price is the contract itself: its reward is lost. What it gives: a new port in the trade network, a delivery origin/destination, EMC/fuel sales.
- **P: "Why is my base not earning?"** — bases earn when someone buys EMC or fuel; the buyers are rivals (Builder hoards pad gear, Emissary — HOLD, Rocketeer — engine and tank, Racer — engine). Insert: "no purchases yet" / "sold X this session".
- **P: "How do contracts work?"** — deliveries (HOLD-24, up to 4.50 per run) and medevacs (two-leg: pick up → deliver). The "Quest failed" branch: the reward burns, the slot frees up. Chip: the auto-scanner's "quest scan" searches trajectories for a quest (that is its job, not H's).
- **P: "How do I enter a competition?"** — an announcement with a 45 s countdown on planet P#; entry costs 0.50 from the purse (it goes into the pool); you must launch after the start and land ≥ 1500–3000 px away within a 180 s window; the first qualifying landing wins and takes the whole pool (2–4 + 0.50 × entrants). *Insert if money < 0.50: "the entry is beyond your purse — see money"*.
- **P: "How do I get home?"** — the commercial evacuator, 6.00, flies you to the base. Worth it when EMC/fuel is short and there is nothing left to do here; it is an expense, not an investment.
- **P: "What is career mode?"** — a shared galaxy with an EMC network, a continuous world clock, up to 16 rivals and 48 active planets; saving via seeds in the URL and replays; rival characters: Builder, Emissary, Rocketeer, Racer. Bribes from planetary rulers are available to every company, yours included; bot characters only affect their willingness to take them (Rocketeer and Racer do, Builder and Emissary don't).

---

## 5. Dynamic generation system

### 5.1 Layers

1. **State adapter (Hctx).** The single point reading game state: collects a snapshot — money, mode, planet (gravity, EMC tier, build cost), ship (condition, fuel, onPad), obs1, bribe, bases, quests, competition. Rebuilt on dialog open and before every answer — answers never go stale.
2. **Condition DSL.** Boolean expressions over Hctx: `money < 6.00`, `emc.need(planet) > emc.has(planet)`, `bases.count == 0`, `bribe.available && !bribe.taken`, `mode == 'career'`. An expression error = the branch is hidden + a log entry, not a dialog crash.
3. **Trees as data.** Each intent (chip) is a data node: conditional lines, diagnosis steps, references to shared subtrees, buttons, follow-up chips.
4. **Renderer.** Walks the node: steps → lines (+inserts) → ref-subtree lines → buttons → chips. `{placeholders}` are substituted with Hctx values.

### 5.2 Node schema

```js
// Trees are JS objects in hhelper_data.js (the repo has no build system, styled like saved_maps.js)
Node = {
  id: "money.faq",
  steps: [ { when: "emc.need(planet) > emc.has(planet)", then: "launch.heavy" },  // diagnosis: first true wins
           { when: "ship.broken", then: "ship.repair" },
           { then: "fallback.unknown" } ],          // a step without when is the fallback
  lines: [ { text: "Money can be earned:" },
           { text: "…take a bribe from the ruler…", when: "bribe.available && !bribe.taken",
             note: { text: "*you already took the bribe here*", when: "bribe.takenHere" } } ],
  ref:  ["money.faq"],                               // shared-subtree lines are appended to the answer
  chips: [ { id: "competition.rules", when: "mode == 'career'" } ],
  actions: [ { label: "Build {emc.needName} — {emc.cost}", act: "buildEmc",
               when: "emc.buildable(planet)", enabled: "money >= emc.cost(planet)" } ],
};
```

Key mechanics:

- **Diagnosis** (`steps`) — an ordered list of causes: the first true one renders. Order = priority by likelihood/severity (cannot fly at all > flying at risk).
- **Dynamic inserts** (`note`) — conditional italic additions to a line: *"...but you don't have any"*. This way one text serves any state.
- **Shared subtrees** (`ref`) — `money.faq` is plugged in by "Can't take off" and "Ship damaged" without duplicating text.
- **Buttons** (`actions`) — `when` hides the unavailable, `enabled` dims with a tooltip "short by X". `act` references an existing game handler; no new game code is needed.
- **Chip filtering** — the top menu and follow-up chips carry `when`, so the menu is always relevant to the mode and state.

### 5.3 Example: the "No money" node in full

```js
HH.money_faq = {
  id: "money.faq",
  lines: [
    { text: "Money can be earned:" },
    { text: "by flying past planets with a working OBS-1.",
      when: "obs1.installed",
      note: { text: "but OBS-1 is down right now — check ship condition",
              when: "!obs1.working" } },
    { text: "take a bribe from a planetary ruler — once, until you change planets.",
      when: "bribe.available && !bribe.taken" },
    { text: "win a competition prize.",
      when: "mode == 'career'",
      note: { text: "nearest: {competition.where}, entry 0.50", when: "competition.next" } },
    { text: "profit from sales at one of your bases.",
      when: "mode == 'career'",
      note: { text: "*...but you don't have any*", when: "bases.count == 0" } },
    { text: "planet visits: the longer unvisited, the higher the payout (0.24 → 4.00)." },
    { text: "complete a contract: a delivery (up to 4.50 with HOLD-24) or a medevac." },
  ],
  chips: [ { id: "quests.list" }, { id: "competition.rules", when: "mode == 'career'" } ],
};
```

The "Can't take off" node uses the same primitives (§5.2): `steps` picks the cause branch, inside branch `launch.heavy` — lines with money conditions, `actions` for build/evacuator/bribe, and the chip "Where do I get money?" → `money.faq`.

### 5.4 Content volume and integration

- ~14 data nodes (9 chips + 4 shared subtrees + fallback), each 10–30 lines. Copy is written once; the DSL handles the state combinatorics.
- New files: `hhelper_data.js` (trees), `gui_hhelper.js` (dialog + Hctx adapter, ~100 lines). Read points: career state, shop prices, the planet table. No existing file is rewritten.

---

## 6. Roadmap

| Stage | Scope |
|---|---|
| MVP | Hctx + DSL + the radio dialog + 4 intents: "Can't take off", "No money", "Ship damaged", "Fuel". Text and inserts, no buttons |
| v1.1 | All 9 intents, action buttons, dynamic chips, `ref` subtrees |
| v2 | Auto-suggestions ("You have 12% fuel — ask how to refuel?"), RU/EN, a radio click on call (sound system), ties into the auto-scanner |

**H's persona.** For now H is a faceless radio operator. Captain selection will appear in the game later; H's persona and voice will be reworked together with it (a separate plan, outside the MVP).

The MVP tests the main hypothesis: a 4-branch "Can't take off" tree is enough to unstick the player.

---

## 7. How to compare with other proposals

- **State coverage:** how many real stuck-causes are covered by data, not general words.
- **Honesty:** answers are computed from state or quoted from the rules; no invented mechanics.
- **Content cost:** how many hand-written lines per new intent (here: 1 node, ~10–30 lines).
- **Boundaries:** H does not search trajectories and does not play for the player (spoiler risk).

---

## 8. Decisions and open questions

### Decided (reviewed with the author)

1. **Bribe direction.** All companies act alike: they **take bribes from planetary rulers** (for the player it is an income source). Bots merely differ a little in character: Rocketeer and Racer take bribes, Builder and Emissary don't. The README wording ("rival characters can take bribes affecting landing costs") reads as if only rivals take bribes — it should be reworded, e.g.: "Any company, including the player, can take a bribe from a planetary ruler — once per planet until it visits another planet. Rivals differ in willingness: Rocketeer and Racer take bribes, Builder and Emissary don't."
2. **Entry point.** A radio dialog with HQ, reachable from anywhere (see §2).
3. **Clock.** No pause: landing already auto-pauses.
4. **H's persona.** A faceless radio operator for now; captain selection comes later and the persona will be reworked with it (§6).
5. **Data vs JSON.** Trees as JS objects in `hhelper_data.js`, in repo style (like `saved_maps.js`).

### Still open

1. **Wear launch-block threshold.** At which condition launching is blocked (branch 2 in §4.1) — verify against the code.
2. **Radio hotkey.** replace `h` (taken by help), radio place near general help in GUI.
