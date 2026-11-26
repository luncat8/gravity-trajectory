# Colonisation gravity review

The draft asks for uninhabited worlds typically in g 1.5..max, not for heavy
worlds with low gravity. The independent seeded draw is uniform over that band
before 0.05 snapping; g 1.5..<2 is moderate and g >= 2 is heavy in the potential
palette. The view-test comment's comparison to a "full heavy law" was misleading.
The standard career retains 13 settled + 3 uninhabited worlds and existing seed
geometry and gravity; no balance law or saved opening was rerolled.

Fixed opening and composition probes to retain a founded planet's original
well, including their cache keys and restored run references. The aim preview now
says founding is available rather than implying it happens automatically. Added
distribution and lifecycle checks, and corrected the seeded-gravity test's
expectations for uninhabited planets.

`node experiments/colony_distribution.js 1000` (seeds 1..1000, default
16-world, three-company planet start) measured 425 / 1290 / 1285 empty worlds
in g 1.5..<2 / 2..<3.5 / 3.5..5. 952 of 1000 maps had at least two empty
worlds with g >= 2. This measures the draws, not whether targets are reachable
or fun to colonize.

The same sample exposed a separate balance concern: only 115/1000 satisfy the
existing start-composition checklist; 839 lack its EMC-3 settled-world class
and 251 lack its EMC-2 class (overlapping counts). The checklist probes the
uninhabited wells but excludes them from settled-world counts. This is not a
measurement of actual opening-seat fairness or long-term playability. It needs
an explicit balance pass on the settled distribution, composition criteria and
seeded openings before changing the law; a silent redraw would change saved
maps, fair seats and replays. Designed gravity fields also deliberately bypass
uninhabited-world generation, so they have no colonisation targets today.

Validation: fast tier, `gravity_seed_test`, `gravity_view_test`,
`career_replay_test`, `fair_start_gui_test`, and `make_saved_maps.js --check`
passed. No long-run bot or human play-balance benchmark was run.
