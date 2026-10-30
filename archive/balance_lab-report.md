everything is on **one screen** now, no tabs, and every slider updates the plot and the costs live.

**Layout**
- Top: family buttons (engine / catapult / tank / battery)
- Left: the sci fee-surface plot, then the build-cost panel under it
- Right: draft sliders → big result readouts → balance sliders
- Bottom: the copy-paste box

**The plot now shows the suggested tiers**
- Every stock ladder rung is plotted and labelled: `EMC-2 · 90kN · 7.83` (tier id · force · build cost). Known tiers are filled; ones that still need research (EMC-3/4/5) are hollow and dim, with a dashed ladder line through them.
- The draft marker has a callout with the main characteristics: **`fee 1.28 · build 8.07 · 26kN`** — cost and force right on the point.
- A vertical dashed line highlights the draft's **force** value, and a hollow diamond marks the **suggested rung** — the tier the draft implies (`rung 2.13`, sitting between IMP-2 and IMP-3).

**Result readouts (right under the sliders, big)**
`fee 1.28 · build 8.07 · thrust 26 kN · merit ×0.96` then `outside · dist 0.000 RU · fee at par 1.33 · suggests rung 2.13 · IMP-2 → IMP-3`.

**Balance sliders (right column, live)** — frontier below/above, metric scale, merit par/per2/lower/mirror for the current family, plus globals (k, build share, merit band, base price, tier scale). Move any of them and you immediately see the plot recolor and the build costs in the left panel change — no searching, no tab switching.

**Build cost panel (left, under the plot)** — every tier of the current family with live build cost vs shipped and Δ, the draft row (`draft [26.0, 1.8] 8.07 · suggests IMP-2 → IMP-3`), and per-family totals.

**Copy box (bottom)** — unchanged: copy final settings (the paste-ready blob), fee lines, or the build table.
