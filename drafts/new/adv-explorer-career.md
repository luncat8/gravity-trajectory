
# avd explorer career mode

32  planets by default,
4x size map - scale so planets are far from each other, scale is in start settings
fft gravity, wrap - if this works faster
half planets are empty (no visit cost, should be colonized as usual)
10% has gas fuel atmosphere
atmosphere friction - simple constant while fly near planets: visible planet ico size is dense atmosphere that is cause landing. above braking possible without landing. update auto-helpers and other calculation.
 

no fair start check
check auto-help with emc1 power for all planets in background and save result. start search from lite G planets. do multiple pass throw  whole list to refine result instead of 1 planet long then next. but give more time to next few lite planets who is not sold yet.
 if available then use  pre-calculated seed.
 
 all start at Capital

## if auction enabled then:

start game with time paused by bots unless all including bots make bids and buy what they can and want.

buy rights to build on planet price is 
buy now: 5...20*emc1 cost depends on G
 
start auction starting price is 1*emc1 cost. bid step 0.1, random order in cycle. 
if > 2 bid. 5s no bid = sell 
else if > 1 then 10s timeout
else 300s

players has live list of found results, show power need to launch from planet and what planets G possible to reach, highlighting emc1-threshold and multiple possibilities, according to live results.
dont forget to save all good results so best trajectories will be in list and anyone can use.

players bid and buy planet with hq and emc-1, then possible evacuate or use other options to continue as always.
once all unpaused then game started.

auction strategy :
- lite planet 
- as soon as possible
- few lite if enough money
- near star position to save evacuation time or cost
player can close or open auction any time.

## hidden map (fog of war)

for human players by  default map is hidden and opened around ship and properties. deferred:  implement for bots.
installed planet radar and next tier ship's observation device unhide bigger radius then build-in level-0 radar in EMC and ship.
trajectory prediction work only with bodies in visible area. all planets outside SKIP in calculation, this emulate calculation errors and make long trips to undiscovered area random and dangerous. bots know this behavior to not be confused by result is not what they predicted.
typical strategy: fly near, uncover gradually, or try do not fall on stars with IPM onboard engine.

drafts/new/observation-satellite.md

### lone stars

new gravity body and map item: star without planet and moon. landing on star cause endgame this is reason to unhide map.
10% of bodies set type star. star g set max (5g typically)

#### deferred render

shadows from planets from stars

todo in storyline and tooltip on stars told that every planet on map is visual representation of a star+planets but we show best landing location.
