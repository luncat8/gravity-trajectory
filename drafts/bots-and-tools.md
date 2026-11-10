# 8 · bots and tools

The rival controller, the benches it is tuned against, and the two pages a human
balances with. Text from `archive/draft.txt` (§balance, §balance_lab.html,
§observation, §helpers) — the sibling of `0.4.27-plan-bot-balancing.md` and
`0.5.16-plan-rival-first-shop.md`.

## 8.1 what a bot has to be able to do ← `archive/draft.txt`

→ the controller's shape today: sliced search (`3 ms` / 64-candidate slices),
1-ply lookahead on `hard`, one early burn nudge plus rescues, the between-flight
shop, pad-gear payback pricing, cached departure checks.

**open**: the 0.5.21 review's three bench findings, in the order they cost the
most:

1. **the medical gate** — no rival ever stands on the Capital with a free
   contract slot, so `TASK_MEDIC` is accepted 0 times in every measured seed.
   The hold was necessary and is not sufficient (`0.5.16`).
2. **the first shop** — the opening purchase now works (varA), but it lowers the
   purse total inside its error. Not merged; the plan waits for `SEEDS=1-30` at
   `1200 s`.
3. **the stuck rival** — a rival sitting on a `g 2.1` HQ for a whole bench run.
   That is `flight-lab-and-modes.md` §1.4's map rule, found by a bot.

## 8.2 balance_lab.html ← `archive/draft.txt`

separate html to draw sci research and calculated build cost, etc to i can manually move balance sliders

button to copy/paste final settings

so i could adjust and copy to chat what i want

i want see result of adjust.

i expect: sci plot, on plot points with suggested tiers
highlight main characteristics: like cost and force

sliders to adjust balance, start price, etc and i will see how plot changes and how build cost changes on single screen

→ shipped: the fee surface per family with the stock ladder plotted and labelled,
the merit/force callouts, the **ladder gain** card that reprices a whole tech
table and copies a `const TABLES = …` patch, the collapsible help, and
`copy-paste final settings`. `experiments/balance_lab_test.js` and
`balance_lab_smoke.js` cover it.

**open (small)**: the lab reads `orbit_science.js`/`orbit_tech.js` but not the
*career* numbers the draft's later questions turn on (pad payback, visit
regrowth `k`, bribe coefficient). Either add one more block (`economy sliders`)
or state in the help that the economy is balanced in `career_bench` — the second
is cheaper and honest; pick one.

## 8.3 observation ← `archive/draft.txt`

→ see `politics-quests.md` §3.4: the observation device is the missing part and
it belongs to the GUI (a hover drawer) as much as to the sim.

## 8.4 benches a plan should reuse ← `archive/draft.txt` (§helpers)

- `career_bench` — the career economy, three known failures.
- `career_bot_bench` — the controller, known failures named.
- `career_gravity_bench` — rivals on seeded fields (pads, seized, medic trips).
- `career_start_probe` / `career_start_fairness` — the opening fairness.
- `bot_bench`, `game_bench`, `gravity_bench`, `player_growth_test`,
  `politics_test`, `politics_gui_test`, `special_planets_test`.

**open**: nothing prints the §5.3 statistics per player, so a balance question
asked in chat still needs a bespoke probe. One flag on `career_gravity_bench`
(`STATS=1`) that prints the five map statistics would retire most of the ad-hoc
`debug_*.js` files in `experiments/` — those eight are scratch, and none is
named in a plan or a worklog.
