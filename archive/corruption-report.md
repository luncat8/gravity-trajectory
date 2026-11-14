### Review of the suggestion

Linking passive corruption directly to **visible visit profit (`+1.00 → +3.00`)** is a clear improvement over a hidden timer (`CORRUPTION_GRACE`):

1. **Zero hidden state:** We deleted `CORRUPTION_GRACE` and the entire `market.lastReportStep` array. Passive rot now reads `planetProfit(market, p, runStep)` directly.
2. **Automatic map-size scaling:** Because visit profit regenerates 2× faster on a 13-planet career map (`k = 0.0125`) than on a 26-planet map (`k = 0.00625`), the threshold adapts automatically:
   - On 13 planets (starting at `+0.46`), an unvisited planet crosses **`+1.00` after ~57 game s** (~14 real s at `×4`), reaches half rot speed (`0.05/s`) around **`+2.00` (~224 game s)**, and hits `50%` rebellion eligibility around `~840 game s` instead of jumping straight to max speed after a flat timer.
3. **Clean interaction with `OBS-1` & `go quiet`:**
   - Visiting with `OBS-1` fitted pays and resets visit profit to `+0.00` → passive rot stops immediately; landing with `OBS-1` continues to cool rot (`−0.02/s`) while halving visit-profit regrowth.
   - Visiting without `OBS-1` (or on a `quiet` planet) does not report or reset `lastVisitStep`, so uncollected value stays `> 1.00` and rot keeps growing — until someone takes a **bribe**, which cashes `lastVisitStep` and temporarily relieves passive rot until value regrows past `+1.00`.

---

### What visit-profit colour meant before — and how it is linked now

Previously in `gui_draw_econ.js` (`drawPlanetProfits`), the profit pill's colour was **purely decorative payout tiers** (unrelated to politics):
- `< +0.14`: dim slate
- `+0.14 … +0.49`: pale white
- `+0.50 … +0.99`: **mint** (`#8ef0c0`)
- **`≥ +1.00` all the way to `+3.00`**: flat **gold** (`#ffcf6e`), with no distinction between `+1.00` and `+2.95`. *(Also `PROFIT_MAX_CENTS` was capped at `300`, clamping `4×` rebel fly-by payouts at `+3.00` on the card.)*

Now the planet card's profit colour (and neutral card border) directly communicates the **corruption growth stages**:

| Visit profit on card | Passive corruption rate | Text colour (when not on route) | Unclaimed card border |
|---|---|---|---|
| **`≤ +1.00`** (`+0.00 … +1.00`) | **`0 / s`** (safe — no rot growth) | Dim `< 0.14`, pale `< 0.50`, **mint** (`#8ef0c0`) at `0.50 … 1.00` | Subtle mint at `≥ 0.50` |
| **`+1.01 … +1.99`** | **`0 → 0.05 / s`** (linear ramp, first half) | **Amber / Gold** (`#ffcf6e`) | Subtle amber |
| **`≥ +2.00` up to `+3.00`** | **`0.05 → 0.10 / s`** (fast rot, upper half) | **Coral warn** (`#ff9478`) | Subtle coral |
| **`quiet` planet** (`+0.00` shown) | Grows from underlying unreported value | **Quiet violet** (`QUIET_COLOUR`) | Quiet violet |

*(Other states keep their priority: `inside` white / `onRoute` bright green while aiming or flying through, `Capital` gold `-3.00`, claimed EMC rings/borders in company colour, and `PROFIT_MAX_CENTS` now covers up to `+12.00` for `4×` rebel worlds.)*

---

### Summary of changes

- **`orbit_econ.js`**: Replaced `CORRUPTION_GRACE` with `CORRUPTION_PROFIT_START = 1`, `CORRUPTION_PROFIT_FULL = 3`, and `passiveCorruptionRate(visitValue)` (linear `0 → CORRUPTION_PASSIVE_RATE` across `1..3`, clamped).
- **`gravity_game.js`**: Removed `lastReportStep`; `advancePolitics` computes passive corruption via `OrbitEcon.passiveCorruptionRate(planetProfit(market, p, runStep)) * dtSec`.
- **`gui_tables.js` & `gui_draw_econ.js`**: Added `PROFIT_ROT_START_CENTS` (`100`), `PROFIT_ROT_MID_CENTS` (`200`), extended `PROFIT_STRINGS` to `1200` cents, linked profit pill text & border colours to the rot ramp (including underlying `rawVal` when `OBS-1` is unmounted in career), and updated `POLITICS_HELP`.
- **Tests & Docs**: Updated `experiments/politics_test.js`, `experiments/politics_gui_test.js` (added pill colour threshold checks), `README.md`, `drafts/politics-quests.md`, `0.7.6-plan-balance-knobs.md`, `archive/0.7.1-plan-time-model.md`, and `archive/0.7.1-worklog.md`. All politics, observer, orbit-clock, stats, and gravity-bench checks pass.

**Next step suggestion:** Implement `0.7.2-plan-ship-wear.md` (ship condition, wear per game second in space + landing + EMC acceleration, and the `repair & launch` split button), then `0.7.6-plan-balance-knobs.md` so all four experimental balance knobs (`pads ×`, `rot ×`, `pay ×`, `wear ×`) land together.