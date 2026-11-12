# drafts — index

Human design notes, reordered by topic. The wording is theirs and is kept as it
stood; only runs of spaces were collapsed. Section titles were added where a
numbered run needed a name, and a `→` line follows the notes it answers, saying
where they stand in the code today. An open note is marked `**open**`: it names
its plan (`→ 0.6.x-plan-….md`) when it has one and otherwise ends with the one
question a plan must answer first. Every file is one big subject, and the subject
order below is also the order the notes should be read.

Every section title names its source after `←` (`archive/draft.txt` or
`0.4-draft-career.md`); a section without `←` is an agent's index, not a note.
Both originals were removed once their text was placed, and
`git show 423a494:<path>` brings either back.

| # | file | big subject |
|---|---|---|
| 1 | `flight-lab-and-modes.md` | the trajectory itself: prediction, gravity sources, bodies, maps and the rule row |
| 2 | `career-economy.md` | the catapult network: pads, batteries, refits, money, colonies, quests, the Capital |
| 3 | `politics-quests.md` | rot, bribes, arrest, rebellion, the medical mission, the observation device |
| 4 | `science-and-ship.md` | research hull, prototypes, balance knobs, cheats, the ship |
| 5 | `rivals-competitions.md` | rival characters, competitions, map statistics plots, the bot competitor |
| 6 | `hud-input-and-help.md` | panels, drawers, controls, selections, landing gates, camera |
| 7 | `sound-and-photos.md` | the music of flight, the postcards, the image prompts |
| 8 | `bots-and-tools.md` | a bot that competes, the balance lab, test harnesses |

What is *not* here:

- `../0.2.0-draft-economy-compare.md` — a measured comparison with
  `galaxy-flythrough@31c6d5a`, decisions signed off. Kept at the root because
  the economy plan cites it as a reference, not as a wish list.
- one line of `archive/draft.txt` (L232) that was an instruction rather than a
  note — *"make plans 0.5.x and start to implement"*. The plans below are what it
  asked for; it is not carried as text.

## where every original heading went

Search this table for a heading as it was written.

### `archive/draft.txt`

| line | original heading | now |
|---|---|---|
| 1 | *(no heading: the first experiment, the deterministic mode, the photo popup)* | `flight-lab-and-modes.md` §1.1, §1.2 · `sound-and-photos.md` §7.3 |
| 77 | `### game mode: max trajectory length` | `flight-lab-and-modes.md` §1.2 |
| 83 | `### game mode: money per visit` | `flight-lab-and-modes.md` §1.2 |
| 89 | `## bot competitor` | `rivals-competitions.md` §5.4 |
| 93 | `## auto helper tools` | `hud-input-and-help.md` §6.3 |
| 105 | `## url parameters to run specific game mode to fast start visual test` | `flight-lab-and-modes.md` §1.3 |
| 109 | `## default game mode career. save last used mode` | `flight-lab-and-modes.md` §1.3 |
| 111 | `## possible change number of players, planets` | `flight-lab-and-modes.md` §1.3 |
| 123 | `## balance plan` | `flight-lab-and-modes.md` §1.4 |
| 132 | `## random gravity of planets -1...+5` | `flight-lab-and-modes.md` §1.4 |
| 137 | `## HTML GUI` | `hud-input-and-help.md` §6.1, §6.2 |
| 157 | `## science research` | `science-and-ship.md` §4.2 |
| 164 | `## sound` | `sound-and-photos.md` §7.1 |
| 183 | `## balance and GUI` | `career-economy.md` §2.6, §2.7 |
| 195 | `### balance_lab.html` | `bots-and-tools.md` §8.2 |
| 211 | `### price` | `science-and-ship.md` §4.3 |
| 215 | `## ui` | `hud-input-and-help.md` §6.6 |
| 222 | `### gravity potential view map` | `hud-input-and-help.md` §6.6 |
| 234 | `## fuel` | `career-economy.md` §2.8 |
| 241 | `## Special planets` | `career-economy.md` §2.4 · `flight-lab-and-modes.md` §1.3 (`players count change…`) |
| 254 | `## Corruption (numbers are subject to balance)` | `politics-quests.md` §3.1 |
| 277 | `## bribe` | `politics-quests.md` §3.2 |
| 284 | `## helpers` | `politics-quests.md` §3.5 |
| 290 | `## map statistics plots` | `rivals-competitions.md` §5.3 → `../0.6.10-plan-map-statistics.md` |
| 299 | `## implement bot character that prefer` | `rivals-competitions.md` §5.1 |
| 305 | `## implement competitions:` | `rivals-competitions.md` §5.2 |
| 311 | `### competitions` | `rivals-competitions.md` §5.2 |
| 319 | `#### competition variations:` | `rivals-competitions.md` §5.2 |
| 323 | `#### think about new competitions or variations if found really interesting` | `rivals-competitions.md` §5.2 |
| 326 | `## impulse engine fly and flight HUD panel` | `hud-input-and-help.md` §6.5 |
| 338 | `## auto pause and pause in game modes that allow pause. useful to avoid players waste game time` | `hud-input-and-help.md` §6.5 · `career-economy.md` §2.8 (`while landed show refuel button…`) |
| 349 | `## refactoring time` | `career-economy.md` §2.9 |
| 355 | `## career map generator improve` | `flight-lab-and-modes.md` §1.4 |
| 359 | `### flight HUD panel.` | `hud-input-and-help.md` §6.4 |
| 372 | `## observation device` | `politics-quests.md` §3.4 |
| 379 | `## bribe button` | `politics-quests.md` §3.3 |
| 383 | `## EMC catapult` | `career-economy.md` §2.10 |
| 386 | `##` *(empty)* | `career-economy.md` §2.11 |
| 389 | `## add quest` | `career-economy.md` §2.4 |
| 393 | `## deferred` | `flight-lab-and-modes.md` §1.5 |

### `0.4-draft-career.md`

| line | original heading | now |
|---|---|---|
| 1 | `## plan career mode :` | `career-economy.md` §2.1 · `bots-and-tools.md` §8.1 (`update bot to be compete.`) · `science-and-ship.md` §4.6 (`tech tree:`) |
| 30 | `### economy` | `career-economy.md` §2.2 |
| 46 | `## EMC` | `career-economy.md` §2.3 |
| 51 | `### how science work:` | `science-and-ship.md` §4.1 |
| 62 | `### ballance` | `science-and-ship.md` §4.4 |
| 65 | `### cheat test modes:` | `science-and-ship.md` §4.5 |
| 68 | `### more images` | `sound-and-photos.md` §7.2 |

The two specs written from `0.4-draft-career.md` are
`../archive/0.4.0-plan-career-a.md` and `-b.md`.

## the open plans and the sections they answer

| plan | draft sections it answers |
|---|---|
| `../0.6.2-plan-pad-fees.md` | `career-economy.md` §2.1, §2.2, §2.6 |
| `../0.6.4-plan-competitions.md` | `rivals-competitions.md` §5.2 |
| `../0.6.5-plan-two-leg-quests.md` | `politics-quests.md` §3.5 |
| `../0.6.6-plan-rival-characters.md` | `rivals-competitions.md` §5.1, `bots-and-tools.md` §8.1, `politics-quests.md` §3.1 (`the bot’s personality`) |
| `../0.6.7-plan-accessibility-readout.md` | `sound-and-photos.md` §7.1 |
| `../0.6.8-plan-seeded-map-opening.md` | `flight-lab-and-modes.md` §1.4, `hud-input-and-help.md` §6.2 (`2-4 of 10`) |
| `../0.6.9-plan-founding-colony.md` | `career-economy.md` §2.5 |
| `../0.6.10-plan-map-statistics.md` | `rivals-competitions.md` §5.3 (`map statistics plots`) |
| `../0.4.27-plan-bot-balancing.md` | `flight-lab-and-modes.md` §1.4 (`hard bots…`), `bots-and-tools.md` §8.1 |
| `../0.4.30-plan-harvest-ticks.md` | `career-economy.md` §2.11 (stay-pay) |
| `../0.5.23-plan-medic-capital.md` | `politics-quests.md` §3.1 (the medical mission) |

Open in the drafts and still without a plan of their own, and why:

- **player-set pad tax** (`career-economy.md` §2.2) — deferred by the draft itself,
  and it needs `0.6.2`'s derived fee as the number it would slide.
- **the science hull as cells, not a convex hull** (`science-and-ship.md` §4.1),
  the **per-axis merit re-derivation** (§4.2) and the **three ship tiers against
  five pad tiers** (§4.6) — balance work with one home (`balance_lab.html`), not
  features; plan them together after `0.6.2`.
- **competition game modes and variations** (`rivals-competitions.md` §5.2) —
  deliberately out of `0.6.4`; each is the career rule with the board replaced.
- **keyboard aim** (`sound-and-photos.md` §7.1) — the shape is written down in
  `0.6.7` §3 as a deferred step, not a plan.
- **the Voronoi scale review and its aim chord** (`sound-and-photos.md` §7.1) and
  the **HQ-only refit** outside a casual mode (`flight-lab-and-modes.md` §1.5) —
  both deferred by the notes themselves.
- small checks, each one question in its section: the tourist / emissary line in
  the help drawer and the money rule's rate on a small universe
  (`flight-lab-and-modes.md` §1.1, §1.2), the player cap in the help text and 12
  against 13 planets (§1.3, §1.4), the economy block of the balance lab and the
  seven unreferenced `debug_*.js` (`bots-and-tools.md` §8.2, §8.3), the missing
  pictures and the lander wording of the captions (`sound-and-photos.md` §7.2,
  §7.4).
