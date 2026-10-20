# gravity cargo

A ballistic cargo experiment on top of the `orbit_trade` visualisation from
`luncat8/exec_queue`. The trade world runs as the background; the new experiment
is a container launched from a planet with direction and push, under the gravity
of every planet.

## run

Open `index.html` (file:// works, no build, no modules).

## controls

| input | action |
| --- | --- |
| drag from a planet | aim; direction is planet → grip, push grows with drag length |
| hold shift while dragging | aim at 1/20 sensitivity |
| click a planet | select it and tune its gravity (`-2…2`, default `1`) |
| `g` slider | gravity of the selected planet; negative values repel |
| `±` trim slider | relative nudge (`-5%…+5%`) of the aim speed, or of the selected gravity when no shot is armed |
| release drag | arms the shot and draws the full trajectory |
| enter / launch | fires the container |
| esc | cancels the aim |
| clear | removes the cargo and its trail |
| space | pauses the trade background only |

Trade time and experiment time are independent: the background starts at
`t+07:00` and runs at `×0.5`, the cargo clock is real seconds and never pauses
with the trade.

## files

- `index.html`, `style.css` — page and panels
- `exec_queue.js` — binary min-heap event queue (vendored)
- `orbit_sim.js` — orbital trade simulation (vendored, trade log removed)
- `orbit_view.js` — trade renderer and controls, shares its camera as `OrbitScene`
- `gravity_sim.js` — gravity field, live cargo, capped trajectory prediction
- `gravity_gui.js` — overlay renderer, aiming, gravity editing, cargo HUD
- `experiments/` — node benchmarks and a headless DOM smoke test
- `archive/` — plan, worklog and the vendored reference page

## physics

```
a = Σ s_i · MU · (p_i − p) / (|p_i − p|² + SOFT²)^(3/2)
MU = 400000 px³/s², SOFT = 60 px, fixed step 1/120 s
```

Prediction and live flight run the same `advance()` from the same spawn state,
capped at 2450 steps, a 20 s horizon and a 10 ms wall-clock budget.
