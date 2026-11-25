do not read this as law or direct implementation plan, adaptation may be need.

→ answered by `../archive/0.7.47-plan-fair-start-modes.md` (whole file); adaptations
are recorded as that plan's "decisions" and per-workstream notes.

previous work:
archive/0.7.43-worklog.md
archive/0.7.43-fair-start-ERNIE-5.5f-report

## current system works ok, but need more relaxed weakened rules for overcrowded cases like few planets / more companies, and for cases when search just unlucky. and few fixes.

OPENING_BUILD_GRAVITY_MAX, stats.exitOk
 should be limited by actual EMC-1/bat-1 with some margin

Exit probe speed fractions (0, 1/3, 2/3, 1), - it looks redundant, isnt faster to skip 0, 1/3, and for high G to use only max. and increase bearings instead.


as i know current strict rules are:

every company gets its own unclaimed, light, exit-safe first landing, and the weakest opening pays ≥ 55 % of the best (OPENING_FAIR_RATIO)

companies_num - number of players (and bots) - each has start HQ in (default) modes with start on planet

### minimal case:
planets = 
companies_num of initial HQ
+
companies_num  of lite planets easy to launch with EMC-1, at least 1 each player can reach from start
+
2 special: (capital, ARF)
+
1 heavy that launch only with >=EMC2
+
1 heavy launch only with > EMC2

for more planets: use rule of 2..4 of heavy planets per 10 of ADDITION planets ABOVE this minimal case.


case 13 planets / 6 companies is not meat this rule and should not be covered by tests as belong to fair cases search.

Do not strict player to choose such cases but show visually that this is not fair start,
so if detected that start cant fit to rules:
- color highlight num of planets and companies
- Helper radio message to decrease companies or increase planets to be possible find fair start.
- search more-or less fair start for time limit and just pic best of searched without hand-off and without block game

- if for any case generation timed out then Helper radio message with live search result of best found position to tell that cant find better and what criterion was not able to meet. ask is ok to 
- play as is in not fair unbalanced start
- load existing fair saves show drop-down list
- wait more
- space start: all start without HQ, with IMP and fuel, in space in some location +- small margin between players, with start money +15cr
- capital start: all start without HQ, in capital, with start money +10cr.

→ planned in `0.7.47` (WS1 in progress) — probe at 75 % of EMC power over 16 bearings, strict
for rails being created, capability for rails that exist;
`OPENING_BUILD_GRAVITY_MAX` deleted, the probe is the authority.
minimal case: WS2 `startComposition`, 2 × players + 4 distinct; the
"2..4 per 10" band is a printed diagnostic, not a gate (per-planet attribution
is undefined). 13/6 *and* 13/5 (14 > 13 under the additive reading) leave the
assert contract, still printed. highlight + helper call: WS3. time-limited
search without blocking, live report and the three choices: WS4 (deterministic
tiers; only completed tiers can become a plan).

## implement 2 new starts to be available in above case and to choose if player want to play them
- space start
- capital start
with weakened fair restrictions (no access test need): 
at least: 
- 1 light planet per player
- 2 special (capital, ARF)
- 1 heavy >=EMC2
- 1 heavy > EMC2

→ `0.7.47` WS5: `game.startMode` (`start=` URL, career-only selector row,
H offers both from the `fair-roster` card); grants 6+15 / 6+10, `hq = -1`,
space spawn in flight at rest near the world centre, capital on the imperial
rail; the weakened gate is `startComposition(..., startMode)`; bots get the
full-parity space opening. Evacuation with no HQ rides to the Capital
(decision 6).

## implement continuos search without freeze page GUI
so player can read helper report of current state while search continues. continue search in background and upd results until player decision.

→ `0.7.47` WS4: resumable `createSeatSearch` driver, 2 s synchronous head,
then a cooperative ~8 ms frame budget (individual work units can take longer);
H's `fair-search` card reports the live best and offers a completed plan or a
saved map. The search continues through deterministic tiers and starts on an
accepted plan; an overcrowded composition starts with the completed fallback,
while an exhausted search waits for the player's choice.

## QA

What should this session build first? (I'll write the full 0.7.47 plan either way; this sets the implementation order.)
- Plan everything first. as for evacuation: better make universal rule: if no HQ then evacuation to Capital

The draft's minimal case lists HQ + light + 2 special + 2 heavy additively (= 2×players+4), which would drop BOTH 13/5 and 13/6 from strict tests — but it only names 13/6. Which reading is right?
- 2×players+4, all distinct

Fix 1: 'OPENING_BUILD_GRAVITY_MAX and stats.exitOk should be limited by actual EMC-1/BAT-1 with some margin' — what should the margin be?
- 75% of EMC power. so it will not so depent on very lucky search or chance

When should the seat search run without freezing the page? (The draft wants a live helper report and a timeout dialog: play as-is / load fair saves / wait more.)
if took more then 2sec then continue in background and show helper's live report

Space start needs bot companies to burn from rest to a planet — how much bot support should this get?
- Full parity burn search. Bots look for best planet to start.

TODO advanced bots with radar equipment may wait and look where other players move to not sit on same planet later right after another bot got visit profit or build EMC and captured planet. This is also for space-start mode and for colonies found may be useful. Radar cost balance for mid-game i suggest 6cr - so better firstly build EMC1 before spend money for it.
→ `0.7.49` (`../archive/0.7.49-plan-radar.md`): reveals every ship's predicted trajectory and time to landing as ghost icons, and a radar-aware bot that avoids a planet another ship is heading to, just profited from, or captured.
TODO implement start game option to make some random gifts to players: example: 6cr, IMP, tech-unlock EMC3, radar. think about to be more-or less balanced.
→ `0.7.48` (`../archive/0.7.48-plan-start-gifts.md`): a start-gift budget (three sliders, 0–20 cr) drawn per company — random 1+ gifts from a pool (an engine kit IMP + FT, a science product = one free invention, radar once `0.7.49` lands) plus the rest of the budget as cash. EMC-3 research costs ~28 cr at the starter hull, so a science gift is a step toward it (6 cr ≈ a 100 kN rail), not the stock unlock.
