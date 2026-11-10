# 7 · sound and photos

The music of flight and the postcards of the worlds. Text from
`archive/draft.txt` (§sound) and `0.4-draft-career.md` (§more images).

## 7.1 sound ← `archive/draft.txt`

make optional separate sound generator (current we have 2: sample-based and default fallback), enable it by default, add settings selector:

→ four generators in the sound settings: `voronoi` (default), `trajectory synth`,
`selected samples`, `classic synths`; the choice is persistent.

while aim: visualize in sound profit, length, EMC in destination. think good about interesting variants that may possible hear predicted trajectory.

→ the aim mapping has predicted profit, length and the destination's EMC as
pitch/level cues.

while fly: get_tone_pentatonic(planet_id), distance and direction is L-R volume (low distance lauder)
while fly alternate variant: get_instrument(planet_id), hi freq is distance, low volume is distance

→ both flight mappings exist (trajectory synth: pentatonic and instrument).

sound should related to space ship head direction on a current trajectory position. and where planets related to this position.

→ every flight mapping is heading-relative; the ship's own heading sets the
stereo frame.

look at
https://github.com/luncat8/experiment-sound-voronoi
get sound generator - it work good with default preset to sonification distance, make it default here. probably need to be adopted to current project

→ ported as the `voronoi` generator (`gravity_voronoi_tones.js`,
`gravity_voronoi_sound.js`), default preset **point tones**, distance-based
volume and pulsing.

note voronoi seems need only to restrict notes to music scale (nearest planets form scale by design). TODO deferred: review and/or improve this here and/or in experiment project.

**deferred, still open** — the Voronoi generator's tuning lives in the
experiment project; nothing here re-derives the scale. Review both sides together
(in this repo first, since the experiment has no bench): the claim "nearest
planets form the scale by design" is worth one measurement over several seeds —
if the nearest-neighbour cell set drifts off the pentatonic map on some seeds,
that is the improvement, and it is a change to `gravity_voronoi_tones.js` alone.

think how blind people could play and think about trajectory (if we implement such in future)

**deferred, not started.** The honest first step is not new audio: it is a text
route — the aim line already prints length, time, visits and profit, so the
missing piece is the same readout reachable without seeing the canvas (a
live region on the aim line and the HUD's state tag). Design it as a screen-reader
contract before any sonification change; the Voronoi generator is already the
distance channel a blind player would need.

**open**: the Voronoi generator does have an aim channel — the same sound object
plays the aim bus whether or not `useVoronoi` is on, so the profit chord, length
ticks and the EMC beacon all sound under `voronoi` (`SOUND_AIM_HINTS.outcome`,
`updateChord`, `emcBeacon`). What is missing is tuning that knows it: the chord
is the pentatonic/profit mapping shared with the trajectory synth, while the
flight side has a dedicated `voronoiPreset` with two voices. Decide whether the
Voronoi preset should also bend its aim chord (a timbre per preset), or whether
one aim mapping for every generator is the intended promise before porting
anything.

## 7.2 other sound notes ← `archive/draft.txt`

as we extended game concept to electromagnetic catapult launch, delivery and sport competition - need to make new image prompts for such scenes.
photos/prompts.md
MOSS is superior model and currently is main choice. improve prompts optimized for MOSS.

→ `photos/prompts.md` — seventeen captions (seven planet types from space and
landed, plus catapult / delivery / sport) written in MOSS-Image caption style with
its settings table; the Krea 2 set is preserved in
`archive/photos-prompts-krea2.md`; the queue script has a `moss` workflow.

**open (small)**: `photos/career/` is empty and only two of the fourteen planet
pictures exist (`space/terran.jpg`, `landed/gas.jpg`). The deck falls back to a
CSS postcard, so nothing is broken — the missing step is generation, not code.
The one code question left: whether a career scene should show at most once
*per run* (it does) or once per *company* now that rivals fly careers too — one
line in `photo_deck.js`.

## 7.3 the postcard popup ← `archive/draft.txt`

plan add photo popup after fly near new planet or land at surface (at tis stage no need to correspond of colony growth level, just feel free any art landing situation). in case of gas giant land to some air platform. any style, diverse.
photo placed temporary at left bottom of the screen left from canvas, keep aspect, scale to free space, if no space in current screen size and layout - 256x on top of all also ok..
make folder for photos of planets from space and landed. make captions for such images - i will generate them in krea2 or MOSS-image (search what prompt type these models expect). So planet types - captions - images (i generate)

→ `photo_deck.js`: the card appears bottom-left when a system is first
entered (`space`) and on landing (`landed`), a gas giant landing is the air
platform, the aspect is kept and it scales to the free space with a 256 px
overlay on small screens, one card per planet per run. Folders
`photos/space/`, `photos/landed/`, `photos/career/` and the MOSS captions are in
`photos/prompts.md` (§7.4). Missing files draw a CSS postcard of the same type.

## 7.4 what `photos/prompts.md` still wants ← `0.4-draft-career.md`

The draft asks for prompts *optimized* for MOSS, and the file now carries the
seven rules the set is judged by (`photos/prompts.md`, "rules that hold the set
together"): one named camera and light, the cargo lander as one recurring
machine, air above the subject, one style per situation, no ship in a planet
view, the type legible at 256 px, no text in the image.

**open**: rule 2 is only half held — the five landed captions describe the same
blunt three-legged pod, but each in its own words and under its own light — so
the improvement pass is a tightening of those paragraphs, not a code change.
Then generate: only `photos/space/terran.jpg` and `photos/landed/gas.jpg` exist,
`photos/career/` is empty, and the deck falls back to a CSS postcard for every
missing file, so nothing is broken while that waits.
