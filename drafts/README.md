# drafts — index

Human design notes, reordered by topic. The wording is theirs and is kept as it
stood: only section headers were added where a numbered run needed a field and
a `→` line follows the notes it answers, saying where they stand in the code
today or what a plan must decide first. Every file is grouped by one big
subject, and the subject order below is also the order the notes should be read.

Every section heading names its source (`archive/draft.txt` or
`0.4-draft-career.md`, both read from commit `56dc80c` before they were folded
here). The two originals were removed afterwards, and `git show
56dc80c:<path>` brings either back.

| # | file | big subject |
|---|---|---|
| 1 | `flight-lab-and-modes.md` | the trajectory itself: prediction, gravity sources, bodies, maps and the rule row |
| 2 | `career-economy.md` | the catapult network: pads, batteries, refits, money, colonies, quests, the Capital |
| 3 | `politics-quests.md` | rot, bribes, arrest, rebellion, the medical mission, the observation device |
| 4 | `science-and-ship.md` | research hull, prototypes, balance knobs, cheats, the ship |
| 5 | `rivals-competitions.md` | rival characters, competitions, map statistics, the economic balance pass |
| 6 | `hud-input-and-help.md` | panels, drawers, controls, selections, landing gates, camera |
| 7 | `sound-and-photos.md` | the music of flight, the postcards, the image prompts |
| 8 | `bots-and-tools.md` | bot and auto-helper behaviour, the balance lab, test harnesses |

What is *not* here:

- `../0.2.0-draft-economy-compare.md` — a measured comparison with
  `galaxy-flythrough@31c6d5a`, decisions signed off. Kept at the root because
  the economy plan cites it as a reference, not as a wish list.
- `../0.4-draft-career.md` — folded into `career-economy.md` and
  `science-and-ship.md` (read it at `git show 56dc80c:0.4-draft-career.md`); the
  two specs written from it are `archive/0.4.0-plan-career-a.md` and `-b.md`.
- `../archive/draft.txt` — its text is now these eight files. The file was
  removed only after every line was placed; `git show 56dc80c:archive/draft.txt`
  has the original.

A section that already ships points at its plan or its README row; a section
that is open ends with the one question a plan has to answer first. The one line
that was an instruction rather than a note — *"make plans 0.5.x and start to
implement"* — is what the `0.6.x` plans below do; it is not carried as text.

## the plans made from the open sections

| plan | draft sections it answers |
|---|---|
| `../0.6.1-plan-observation-device.md` | `politics-quests.md` §3.4 |
| `../0.6.2-plan-pad-fees.md` | `career-economy.md` §2.1, §2.2, §2.6 |
| `../0.6.3-plan-fragile-load.md` | `career-economy.md` §2.4 (`fragile load`) |
| `../0.6.4-plan-competitions.md` | `rivals-competitions.md` §5.2 |
| `../0.6.5-plan-two-leg-quests.md` | `politics-quests.md` §3.5, `rivals-competitions.md` §5.3 |
| `../0.6.6-plan-rival-characters.md` | `rivals-competitions.md` §5.1, `bots-and-tools.md` §8.1 |
| `../0.6.7-plan-accessibility-readout.md` | `sound-and-photos.md` §7.1 |
| `../0.6.8-plan-seeded-map-opening.md` | `flight-lab-and-modes.md` §1.4 |
| `../0.6.9-plan-founding-colony.md` | `career-economy.md` §2.5 (item 3) |

Still without a plan of their own, and why:

- **player-set pad tax** (`career-economy.md` §2.2) — deferred by the draft itself,
  and it needs `0.6.2`'s derived fee as the number it would slide.
- **the science hull as cells, not a convex hull** (`science-and-ship.md` §4.1)
  and the **per-axis merit re-derivation** (§4.2) — both are balance work with one
  home (`balance_lab.html`), not features; plan them together after 0.6.2.
- **competition game modes and variations** (`rivals-competitions.md` §5.2) —
  deliberately out of `0.6.4`; each is the career rule with the board replaced.
- **keyboard aim** (`sound-and-photos.md` §7.1) — the shape is written down in
  `0.6.7` §3 as a deferred step, not a plan.
- **`hard` bot budget** — already `0.4.27-plan-bot-balancing.md`.
