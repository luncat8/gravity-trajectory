
## radar item ← `map-fair-start-modes.md`


 the HQ make some info available to players and possible to draw on map in career mode, in other modes by default use global view settings unless restricted.

in clean render mode - show other trajectories only on hover or press other ship; own ship and landed plates always visible. → landed by 0.7.50, superseded by the 0.7.51 view rework below: the predicted checkbox owns other ships now, hover/press stays as the per-ship peek, landed plates always visible still

for every ship (own and rivals), draw ghost icon on its predicted trajectory with
the time to its next landing — i.e. +35 s on his, +41 s on mine. → landed by 0.7.49; 0.7.51 moved the flying ship's `+N s` plate onto the landing point it belongs to (it sat above the ship's current location); 0.7.52 stacks overlapping `+N s` plates per landing planet in arrival order

radar cost suggested 6..8 cr, balanced for mid-game (EMC-1 builds at 3.04, EMC-2 at 7.83), so build EMC-1 and EMC-2 on heavy planets first.

for now i suggest implement it as an HQ facility:  built at the HQ planet for money, any time.

## bots use radar

a bot whose company has radar reads other ships' predicted landings and avoids
landing on a planet another ship is heading to, just profited from, or probably will be captured.

bots should try to compete and outperform other players by compare landing time on trajectories of other players - this is purpose of radar.

## help

especially useful at long trajectories, and in case of all players start from similar location at same time to suspend start, know competitor's move and adjust own aim to outperform or avoid risky landing.

→ `../archive/0.7.49-plan-radar.md`

## view rework (0.7.51)

event now working, but time mark should be correspond to time (landing position), not in current location.

also when clean render unchecked it should show predicted trajectory for bots without hover.
reworked with separate checkboxes for trajectory that will work in all modes:

- checkbox for historical trajectory (other players) — `trails`, on by default.
- checkbox for predicted (other players) — `predicted`, can't enable in career mode
  without radar; installing radar also checks it. hover or press a rival ship
  reveals that one even with the box off.
- checkbox clean render - hide own historical trajectory + other existing changes
  (thick orbit visit highlights); other players' layers left to their own boxes.

→ `../archive/0.7.51-worklog.md` · `gui_draw_world.js` (radar overlay + lab pool),
`gravity_gui.js` (`trailRivalsOn` / `predRivalsOn`), `gui_career.js` (build ticks predicted)
