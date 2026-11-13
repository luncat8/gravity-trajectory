# Bribes and reporting worklog

## Review
The 0.6.10 stats strip uses shared market rot and career accounting, so it can
observe the new policy without a second calculation. The 0.6.2 plan concerns
pad prices and contracts, not this political fix; it remains open.

## Changes
- Normal planets start with 5% traditional corruption. Reporting visits cool
  rot by 0.2; landed reporting cools it by 0.02 per world second. After 120
  seconds without reports, rot rises by 0.1 per second. Bribes add 1 + 0.1 per
  money, as before.
- Shared visit value accrues at half speed when at least one ship is landed,
  regardless of observation device. Flight does not count as occupation.
  Report age is independent of value age, and the bribe window is independent
  of both clocks.
- The optional next-run entrenched-corruption setting adds 10% of actual rot
  increases to a planet's floor. The existing medical quest resets the floor
  on quelling. The pad displays the floor and the live bribe price.

## Validation
- `node experiments/politics_test.js`: 20 groups, including landed accrual,
  reporting, bribe window and optional floor.
- `node experiments/obs_test.js`: 9 groups.
- `node experiments/politics_gui_test.js`: passed.
- `node experiments/career_stats_test.js`: passed.
- `git diff --check`: clean.

## Next step suggestion
Implement 0.6.2 pad fees and validate its economics against the STATS=1 table;
re-baseline with the revised politics rules and compare the splits.
