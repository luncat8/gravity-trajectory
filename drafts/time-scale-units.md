
## refactor time units

i think better normalize it to 1x speed be IRL timer.
old "wain 30 min" button work good but text told player not useful info that is hard to imagine. so better operate real time with proper scale and tell how many real time it wait fast forward.

→ **done** — the same note lives in `career-economy.md` §2.9
`### normalize time to 1x = real time` with the full answer: `0.7.1` names the
three clocks in `gravity_sim.js`, calls the career's balanced pace `×1` (raw 4),
and labels the wait with the real seconds its fast-forward costs (`wait · 2 s`)
instead of 30 world minutes. `../archive/0.7.1-worklog.md` records it.