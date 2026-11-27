!! is not related to 'accessibility' in therms of business software development. our goal is to make art-product but not follow some typical requirements. maximum result: make possible and interesting to orient on map without visual render. replacing whole GUI of shop and upgrades is not subject of this game features. GUI solved same way as bot do: we introduce GUI bot helper that manage whole other work same as bots do, except features that we implement as sound accessibility.

important and difficult task is to define what can be interesting and possible ways.

- make decisions by dialogs with Helper-radio. straightforward gameplay implementation: autohelper-fly-build-upgrade

- aim with mouse or keys by sound. in current career players will to use auto-helpers to find best profit. we can introduce new mode where autohelper does not work and force to search trajectory by sound. this may be useful in work together with hidden (for of war) map. current AIM synth is ok to show total profit this is too easy and is not so interesting for such mode. let think situation storyline when some electronics does not work or cant determine profit because of jammers or space weather or insufficient map data. then player has some sound-gravity-scope that visualize how near player will fly to planets, where it will land (heavy or light planet) and synth some interesting sound that is possible to interpret. Note: current FLY synth sound good, but if preview it before fly - i doubt someone could understand it, except maybe true blind people who orient by sound and want to solve such task. also it is quite long to hear whole trajectory after every aim adjustment. so need something different approach.


### LLM suggestions

3. **Eyes-free mouse & keyboard aiming + A/B memory (§3):**
   - **Virtual-pad relative mouse drag:** pressing anywhere on the dark canvas anchors the catapult grip to `career.at` (or the ship during burn pause) so mouse aiming never requires hunting for a planet's screen pixel.
   - **Three-gear keyboard aiming:** coarse (`±15°`), normal (`±2°`), and `Shift` vernier (`±0.2°`) angle/speed steps, cardinal `N/E/S/W` detent clicks, plus **`M` / `R` acoustic A/B memory** to bookmark one candidate trajectory and compare two shots directly by ear.

4. **The Sound-Gravity-Scope (`AIM_SCOPE = 'scope'`, §4):**
   - Replaces the slow `2–8 s` `flythrough` sequence and profit-leaking `outcome` chord with a `< 360 ms` closed-loop instrument fed by a zero-allocation path analyzer (`analyzeScopePath` over `predX/predY`):
     - **Layer 1 (0 ms lag):** `360°` compass carrier (`cos` stereo pan + `-sin` North/South filter brightness tilt so North and South never sound identical) + rail-pull pitch tension.
     - **Layer 2 (0 ms lag):** Continuous 3-well proximity cluster that swells across `3.5× → 1.0× orbitR` *before* touching a system ellipse (giving a smooth directional gradient toward nearby planets), locks into shimmer inside `orbitR`, and voices each well's physical mass $g$ by register.
     - **Layer 3 (`0.42 s` micro-radar cycle):** Fast oscilloscope trace (`t = 0` trigger, `0..240 ms` encounter micro-blips, `260 ms` terminal signature) with an immediate contrast between **landing on a light world** ($g < 1.2$, buoyant upward woody-bell dyad), **landing on a heavy world** ($g \ge 2.2$, downward pitch-drop sub-bass thud), **missing into space** (`END_EXIT` / `END_TIME` air fade), and **crossing into fog-of-war static** (`fogTau`).
