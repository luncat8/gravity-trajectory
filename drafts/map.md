
## gravity solver

Add option for periodic FFT-based gravity solver. When enabled:
- Use xy-wrapping (toroidal) periodic map topology
- Increase default and max planet count by 4x, without 'full area' space around map
- (maybe good) Apply approximately 2x weaker gravity per body


→ **open** · `../0.8.0-plan-periodic-fft.md` — experimental checkbox, FFT of the shipped Plummer kernel on a 1600×1000 torus, 104 / 52 / 192 planets, half well, no `full area` margin.

## add space weather

- high-ship-wear zones (x,y offset += change )
- zones where observation device report range is reduced or disabled; update area observation device render. (z+= change)
- view option to show weather overlay.
- high level observation device: endgame high cost, reduce weather (jammer) effect. 

- corrupted planet (>50% corruption level) : has chance to install jammer reducing observation report range 4×. act similar to space weather so we can add it to same field as just another source of weather.
- rebel planet: has chance to add high-ship-wear field to weather map every N frames: and it fly from planet with space wind. (storyline - it may be space debris)

some type of zones are - slowly move 2d noise x,y offset += change
some change like 3d noise z+= change
what type of zone will be looks better with what type of movement - open question.

→ **open** · `../0.8.8-plan-space-weather.md` covers the whole note for career
mode. Compare drifting and evolving noise in a visual prototype before choosing
motion; `careerWearAt` is the existing wear hook. Gameplay parameters and the
open rules in the plan need decisions before implementation.
