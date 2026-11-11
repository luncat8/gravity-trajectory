# 8 · bots and tools

The rival controller, the benches it is tuned against, and the page a human
balances with. Human text: one line of `0.4-draft-career.md` (§8.1) and
`archive/draft.txt` §balance_lab.html (§8.2). §8.3 is an agent's index for plans,
not a note, so it has no `←`.

## 8.1 a bot that competes ← `0.4-draft-career.md`

update bot to be compete.

→ the career controller today: sliced search (`3 ms` / 64-candidate slices),
1-ply lookahead on `hard`, one early burn nudge plus rescues, the between-flight
shop, pad-gear payback pricing, cached departure checks.

What the benches say about «compete» (`archive/0.5.22-worklog.md`):

1. **the first shop — closed.** The opening `HOLD-8` no longer waits for the HQ
   (`archive/0.5.16-plan-rival-first-shop.md`, its variant A): `+3.07 ± 2.02`
   purse per rival-game over 30 seeds at 1200 s, earned +38 %, pads +16 %.
2. **the stuck rival — never a game bug.** A rival «sitting on a `g 2.1` HQ» was
   `career_gravity_bench` starting careers differently from the page. The page
   seats every company on one planned map and pins each HQ to `g 1.00`
   (`experiments/career_start_seat_test.js`), and the bench now does the same.
3. **the medical mission — open** → `0.5.23-plan-medic-capital.md`. A rival takes
   it once in 24 games: it has to be accepted *on the Capital*, and no shot
   score carries its reward there.

**open** → `0.4.27-plan-bot-balancing.md` (`hard` beat `easy` on 2 of 4 seeded
fields) and `0.6.6-plan-rival-characters.md` (four companies that want different
things).

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

## 8.3 benches a plan should reuse (agent index, no source note)

- `career_bench` — the career economy, three known failures.
- `career_bot_bench` — the controller, known failures named.
- `career_gravity_bench` — rivals on seeded fields, started the way the page
  starts them (pads, seized, medic trips; `PAIRED=1` prints one purse per game).
- `career_start_probe` / `career_start_fairness` / `career_start_seat_test` — the
  opening.
- `medic_offer_probe` — why a medical mission is or is not taken.
- `bot_bench`, `game_bench`, `gravity_bench`, `player_growth_test`,
  `politics_test`, `politics_gui_test`, `special_planets_test`.

**open** → `0.6.10-plan-map-statistics.md` §5: nothing prints the statistics of
`rivals-competitions.md` §5.3 per player, so a balance question still needs its
own probe; `STATS=1` on `career_gravity_bench` is that table.

**open (small)**, no plan: seven `experiments/debug_*.js` (`debug_evac`,
`debug_evac2`, `debug_evac3`, `debug_loop`, `debug_reserve`, `debug_scaled`,
`debug_scaled2`) are named in no plan, worklog or README — delete them, or give
each a header that says what it measures? `debug_career_costs.js` is not one of
them: it is the calibration probe of 0.4.41–0.4.43.
