
## refactor time units

i think better normalize it to 1x speed be IRL timer.
old "wain 30 min" button work good but text told player not useful info that is hard to imagine. so better operate real time with proper scale and tell how many real time it wait fast forward.

→ **done, second pass** — the same note lives in `career-economy.md` §2.9
`### normalize time to 1x = real time` with the full answer: `0.7.1` now
normalizes the engine itself to game seconds. ×1 is **real time** (one game
second per real second) in every mode, career just opens on the honest ×4 it is
balanced at, there is no “world minute” left to explain, and a `1 h` goal is
`3600` game s = `360` s at ×10. The wait reads `wait · 60 s` (the game seconds
it buys) and its tooltip carries the real cost. The background animation knob is
decoration only; separate pad/politics/profit balance sliders are
`../0.7.6-plan-balance-knobs.md`. `../archive/0.7.1-worklog.md` §5 records what
the first pass got wrong.