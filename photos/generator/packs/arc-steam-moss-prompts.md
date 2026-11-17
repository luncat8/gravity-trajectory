# arc-steam photo prompts — MOSS-Image

Eighteen captions for the **arc-steam** side-view energy-driven mining game,
written for the **MOSS-Image** text-to-image workflow that lives in the
`gravity-trajectory` repo at `photos/generator/image_moss_image_t2i.json`.

The game (from `arc-steam/draft.txt` + `README.md` + `0.1.0-plan.md`) is a
side-view / cross-section mining sim. A wheeled platform rides a rubble
heightmap along the floor of an underground chamber. A translucent elastic
ball with a glowing power core bounces between a sprung tilting piston on
the platform and a layered mineral ceiling (cells coloured by elemental
R/G/B → rust, emerald, violet, ochre bands). Falling debris is caught in a
separate collector region. The platform evolves through energy eras —
**hand-crank (creatures/gnomes) → coal/steam (dwarves + boiler) → oil →
electric → nuclear**. Tech includes radiators, ballistic computer (dashed
trajectory + ghost platform), mineral radar, contact-charge bus, rockets,
sandblaster. Charge pad glows at the centre of the floor. Competitor
platforms share the same floor.

## caption style — MOSS-Image

Each caption below is already prompt-shaped: it describes the **finished
image** in plain prose (80–200 words), opens with medium + main subject,
then setting/composition, then lighting/colours/details. **No quality
keywords** ("masterpiece", "8k", "highly detailed"), **no negative prompt
in the caption**, **no in-image text** (the game UI draws titles/labels).

In the gravity-trajectory generator:

```sh
python3 photos/generator/comfy_queue.py --no-refine --workflow moss ...
```

`--no-refine` sends the caption verbatim and skips the workflow's own LLM
upsampler, so wording is kept exactly. Drop the flag if you want the model's
own rewriter to expand a short prompt.

## settings — MOSS-Image

| | |
|---|---|
| Prompt | The full paragraph below, verbatim. `--no-refine` keeps wording. |
| Splash size | **16:9 · 2 MP** (~1920 × 1080). Patch `19.aspect_ratio` and `19.megapixels`. |
| Background size | **16:9 · 1.5 MP** (UI overlay needs headroom). |
| Art-card size | **3:2 · 1.5 MP** = 1536 × 1024 (matches `gravity-trajectory` photo_deck). |
| Sampler | `Euler` · `steps ≥ 50` · `CFG 3.0` (raise toward 6 for the shorter captions) · `shift 5.0` |
| SLG | skip layer `22` — `--set 18:24.switch=true` |
| Negative | `nsfw, worst quality, bad anatomy, watermark, jpeg artifact` |
| Text in image | none — UI draws kicker / title / SELL markings |
| Variants | re-run with `--seed N` for alternates; keep the file name to pick a winner |

Shared notes:

- Keep the whole platform and the ball's full arc inside the frame; splash
  art is read at thumbnail size too.
- For splash pieces, leave the upper third comparatively empty — that is
  where the title block sits.
- For backgrounds, keep contrast low and detail sparse in the centre so UI
  text stays legible over it.
- No lettering, logos, or watermarks in any image.

## file naming suggestion

```
photos/splash/    <era>-<N>.jpg       splash screens (one per era + a vista)
photos/background/<scene>.jpg         menu / pause backgrounds
photos/art/       <scene>.jpg         scene cards (impact, charge, standoff …)
```

The arc-steam repo does not yet have a `photos/` deck, so the names below
are a proposal — rename freely.

---

## splash screens

Six hero shots, one per energy era plus a wide era-transition vista. Each
is 16:9, framed for a title block in the upper third.

### 1 · splash · steam era → `photos/splash/steam-1.jpg`

*Style: dieselpunk concept art, warm fire glow.*
*Aspect: 16:9 · 2 MP.*

> Dieselpunk concept painting of a wheeled mining platform in a tall underground chamber, side cross-section view. The platform occupies the lower centre, a riveted dark-iron deck on four heavy spoked wheels, a tilted sprung piston plate angling upward from its midsection, two stocky bearded dwarves stoking a brass boiler with coal shovels. Above the platform a translucent elastic sphere the size of a man's head hangs at the apex of its arc, a faint cyan glow pulsing at its core. The ceiling is a ragged mineral layer in stratified bands of rust-red, pale green and violet, cracked where the ball has just struck it, pebbles tumbling. The floor is a churned rubble heightmap. Warm orange firelight from the boiler's open grate rakes up across the hull and the dwarves' faces; cool blue miner-lamps pick out the minerals above. Haze and soot motes, dramatic side light, brass and soot-black palette with a cyan accent, monumental industrial scale, generous dark space above the ball for a title.

### 2 · splash · nuclear era → `photos/splash/nuclear-1.jpg`

*Style: photoreal cinematic, cold reactor light.*
*Aspect: 16:9 · 2 MP.*

> Photoreal cinematic science-fiction still of a heavy nuclear mining platform in a vast underground shaft, side cross-section view. The platform sits in the lower third, a lead-grey hull on six wide tracked wheels, a squat shielded reactor pod glowing faint blue-green at its centre, a vertical piston assembly and tilted reflector plate on top. A translucent elastic ball mid-bounce streaks upward from the plate, a sharp cyan core visible through its shell, leaving a faint dashed trajectory line behind it. The mineral ceiling above is a dense layered mosaic of amber, emerald and indigo crystals, freshly fractured in one place with a cascade of glowing fragments falling. Cold blue-green reactor uplight grazes the platform's underside; a single warm work-lamp on the hull throws a cone across the rubble floor. Atmospheric haze, deep shadow, volumetric light shafts, cinematic 35 mm perspective, palette of lead grey, indigo, amber and cyan, oppressive monumental scale, dark empty space in the upper third for a title.

### 3 · splash · coal era → `photos/splash/coal-1.jpg`

*Style: painterly matte painting, smoky chiaroscuro.*
*Aspect: 16:9 · 2 MP.*

> Painterly science-fiction matte painting of a coal-fired mining platform deep in a smoky mine shaft, side cross-section view. The platform dominates the lower half, a blackened steel deck on iron wheels, a tall soot-streaked smokestack rising from a riveted boiler, a tilted sprung piston plate on top where a translucent elastic ball with a warm amber core is captured mid-compression. Three small hooded dwarf engineers tend the boiler, one shovelling coal, one watching a pressure gauge, one pointing up at the ball. Above, a thick mineral ceiling in bands of ochre, teal and cream shows a fresh impact crater with debris falling in clumps. The floor is uneven rubble. Volumetric coal-smoke fills the upper third, lit from below by the boiler's orange fire-glow; a few carbide lamps pierce the haze with hard white points. Loose painterly brushwork, warm soot-black, ochre, teal and cream palette, dramatic chiaroscuro, deep atmospheric perspective, sense of gruelling labour and heat, smoke-cloud space in the upper third for a title.

### 4 · splash · electric era → `photos/splash/electric-1.jpg`

*Style: retro-futurist industrial poster, clean high-key.*
*Aspect: 16:9 · 2 MP.*

> Retro-futurist industrial poster of a clean electric mining platform in a bright mine chamber, side cross-section view. The platform sits centred on a smooth rubble floor, a glossy cream-and-teal hull on slim spoked wheels, exposed copper bus bars running along its flank, a slim vertical piston and a tilted white reflector plate on top. A translucent elastic ball with a soft cyan core arcs upward, leaving a fine dashed trajectory line. The mineral ceiling is a tidy mosaic of pastel green, salmon and lavender cells, one fresh impact crater shedding a small neat cascade of fragments. A central floor strip under the platform glows pale teal, charging it. Flat colour fields, subtle screen-print halftone grain, crisp geometric shapes, optimistic 1960s space-age palette of cream, teal, copper and pastel mineral tones, even high-key lighting, generous empty space above the ball for a title block, clean optimistic composition.

### 5 · splash · hand-crank era → `photos/splash/hand-1.jpg`

*Style: whimsical painted storybook, candlelight.*
*Aspect: 16:9 · 2 MP.*

> Whimsical painted storybook illustration of an early hand-cranked mining platform in a modest underground chamber, side cross-section view. The platform is a small wooden cart on four iron wheels, a wooden lever arm and a tilted sprung plate on top, with a hamster-like creature in a large side-mounted running wheel and two small bearded gnomes turning a hand crank. A translucent elastic ball with a warm yellow core bounces between the plate and a low mineral ceiling in soft bands of sand, ochre and pale green. The floor is gentle rubble. Warm candlelight from a small lantern on the cart lights the gnomes' faces; soft ambient glow from bioluminescent moss on the chamber walls. Loose watercolour texture, warm wood, brass, moss-green and ochre palette, gentle storybook mood, intimate scale, slight curvature to the chamber suggesting a tiny world, generous soft space above for a title.

### 6 · splash · era-transition vista → `photos/splash/vista-1.jpg`

*Style: ink-wash graphic novel, double-page spread.*
*Aspect: 16:9 · 2 MP.*

> Ink-wash graphic novel illustration of a vast underground mine chamber seen in side cross-section, three mining platforms working different eras of the same vein along its length. On the left, a tiny wooden hand-crank cart with gnomes. In the centre midground, a blackened coal-steam platform with dwarves and a tall smokestack. On the right, a sleek nuclear platform with a faint blue reactor glow. A single translucent elastic ball with a cyan core bounces between the central platform and the mineral ceiling above, its dashed trajectory arc traced across the chamber. The ceiling is a long stratified mosaic of rust, teal, amber and violet mineral bands, cratered in many places. The floor is an undulating rubble heightmap. Loose black brush strokes on textured paper, single warm ochre accent on sunlit mineral rims and furnace glows, dramatic graphic-novel double-page spread composition, palette of charcoal, bone-white and ochre with mineral colour notes, monumental scale.

---

## backgrounds

Atmospheric, lower contrast, generous negative space in the centre for UI
overlay. 16:9, 1.5 MP.

### 7 · background · empty chamber → `photos/background/chamber.jpg`

*Style: dark atmospheric painterly, low contrast.*

> Dark atmospheric painterly background of an empty underground mine chamber, side cross-section view, no platform. A thick mineral ceiling in muted bands of slate, deep rust and dusty indigo spans the top quarter, faintly glimmering where crystal veins catch distant light. Below it, a vast empty vertical space filled with cool haze, a few drifting dust motes catching faint light. The floor is an undulating plain of dark rubble stretching across the bottom, two faint vertical scratches on the far left and right walls suggesting market markings. A single pale warm glow at the centre of the floor marks the charge pad strip, throwing a soft uplight into the haze. Deep indigo and charcoal palette with a single warm amber accent, very low contrast, atmospheric perspective, heavy negative space in the middle for overlay text, quiet expectant mood.

### 8 · background · mineral ceiling macro → `photos/background/ceiling-macro.jpg`

*Style: abstract scientific macro, top-down.*

> Macro photograph of a fractured mineral ceiling surface, abstract scientific close-up. The frame fills with a dense mosaic of polygonal cells in stratified bands of rust-red, pale emerald, dusty violet and bone-white, each cell small and roughly square, their colours blending at the edges where elemental composition shifts. A fresh impact crater punctures the centre, ringed by a halo of progressively weaker fractures fading outward, a few loose fragments detaching from the rim. Cool even diffuse lighting from below, soft shadows in the crater, fine crystalline texture catching light on intact cells, muted industrial palette of oxidised metals and mineral stains, flat top-down perspective, tight composition with no horizon, quiet geological mood, even negative space for overlay.

### 9 · background · deep shaft vertigo → `photos/background/shaft-up.jpg`

*Style: low-angle painterly, forced perspective.*

> Low-angle painterly illustration looking straight up into a vast underground mine shaft. The mineral ceiling recedes dramatically upward in forced perspective, bands of rust, teal, amber and violet compressing toward a distant dark vanishing point at the top centre. Around the edges of the frame, the chamber walls curve inward, studded with faint bioluminescent moss and rust-stained bolts. A few loose pebbles drift downward in silhouette against the lit ceiling, motion-blurred. Cool ambient uplight, deep atmospheric haze thickening with depth, dramatic one-point perspective, palette of deep indigo, slate and muted mineral colours with a faint warm amber glow at the implied floor below the frame, vertiginous monumental scale, quiet awe, dark negative space at the centre for overlay.

### 10 · background · side wall market → `photos/background/wall-market.jpg`

*Style: atmospheric chiaroscuro, quiet commercial.*

> Atmospheric illustration of a mine shaft side wall in side cross-section view, no platform in frame. The vertical wall stretches the full height of the chamber, rough-hewn dark rock with vertical market scratches cut into its face, the scratches catching faint warm light. A flat rubble floor meets the wall at the bottom, a worn track groove running along the floor where wheels have passed. The opposite wall is implied by the chamber's far edge, out of focus in the haze. A single pale lantern hangs on the near wall midway up, throwing a warm pool of light across the rock. Cool ambient fill, deep shadow above and below the lantern pool, atmospheric haze, palette of charcoal, slate and warm amber, quiet commercial mood, generous dark negative space for overlay.

---

## art / scene cards

Specific moments, each in a different style, light, and camera angle. 3:2,
1536 × 1024 — same spec as the gravity-trajectory card deck.

### 11 · art · ball impact on ceiling → `photos/art/impact.jpg`

*Style: photoreal macro action, frozen instant.*

> Photoreal macro action shot of a translucent elastic mining ball at the instant of impact with a mineral ceiling. The ball, the size of a man's head, occupies the centre of the frame, its translucent shell compressed flat against the ceiling, a bright cyan core pulsing inside. Around the contact point, a radial fracture pattern spreads outward through the mineral layer — rust-red, emerald and violet cells cracking, a halo of finer fractures fading to intact rock at the edges. Pebbles and crystal fragments eject downward in a frozen cascade, motion-blurred. Hard directional light from below-left rakes across the fractured surface, casting the ball's shadow upward into the crater. Sharp micro-detail on shell ripples and crystal facets, shallow depth of field, palette of rust, emerald, violet and cyan, frozen-instant intensity.

### 12 · art · platform catching debris → `photos/art/catch.jpg`

*Style: dieselpunk action illustration, kinetic.*

> Dieselpunk action illustration of a mining platform catching falling debris, side cross-section view. The platform races from left to right across the rubble floor, six spoked wheels churning, a tilted reflector plate on top angling a translucent elastic ball away in a streaking arc to the upper right. On the left side of the deck, an open collector tray catches a cascade of mineral fragments falling from a freshly fractured ceiling above — rust, emerald and amber chunks tumbling into the bin. Two dwarf engineers cling to the deck, one working a brass control wheel, the other pointing up at the falling debris. The mineral ceiling shows a fresh impact crater. Warm orange boiler-glow rakes across the hull from below, cool blue miner-lamps pick out the falling debris, motion blur on the wheels, palette of soot-black, brass, rust and cyan, kinetic urgency.

### 13 · art · charge pad at rest → `photos/art/charge.jpg`

*Style: moody science-fiction, between-shifts quiet.*

> Moody science-fiction illustration of a mining platform parked on a central charge pad in an underground chamber at rest, side cross-section view. The platform sits in the horizontal centre on a glowing floor strip that throws pale teal uplight across its hull, a translucent elastic ball resting in a clamped cradle on top, its cyan core dimmed to a standby pulse. The mineral ceiling above is quiet, faintly glimmering in bands of rust and indigo. Around the platform, the chamber is in deep shadow, two distant competitor platforms barely visible as dark silhouettes against the far walls. A single dwarf engineer sits on the deck eating, lit from below by the charge pad. Cool teal uplight, deep indigo ambient, warm amber lantern on the deck, atmospheric haze, palette of indigo, slate, teal and a single amber accent, quiet between-shifts mood.

### 14 · art · ballistic computer overlay → `photos/art/ballistic.jpg`

*Style: technical HUD, schematic.*

> Technical science-fiction illustration of a mining chamber with a ballistic computer overlay active, side cross-section view. The platform sits in the lower centre, a tilted reflector plate on top, a translucent elastic ball arcing upward to the right. A fine dashed cyan trajectory line traces the ball's predicted path — rising, striking the mineral ceiling, rebounding, falling, striking the reflector again, then a second arc fading to a horizon mark. A faint ghost outline of the platform sits at the predicted intercept point on the floor. The mineral ceiling is a grid of small cells in rust, emerald and violet, one cell highlighted with a scan reticle. Cool clean cyan overlay light against warm industrial chamber tones, holographic HUD aesthetic, palette of charcoal, rust, amber and crisp cyan, technical schematic mood.

### 15 · art · competitor standoff → `photos/art/standoff.jpg`

*Style: dramatic wide painterly, warm-vs-cold split.*

> Dramatic wide painterly illustration of two mining platforms facing off on the same rubble floor, side cross-section view. On the left, a coal-steam platform with a tall smokestack and dwarves stoking a boiler, warm orange glow. On the right, a sleek nuclear platform with a faint blue-green reactor pod, cold uplight. Between them, a single translucent elastic ball with a cyan core hangs at the apex of its arc, claimed by neither. The mineral ceiling above is a long stratified mosaic of rust, teal, amber and violet, cratered in multiple places. The floor is churned rubble with wheel ruts. Both platforms have small triangular 45-degree wedge tails unfolding from their ends, just beginning to extend as they approach. Warm versus cold lighting clash at the centre, atmospheric haze, palette split between warm amber-orange on the left and cold blue-green on the right, tense standoff mood.

### 16 · art · rockets on ceiling → `photos/art/rockets.jpg`

*Style: dramatic fireworks, explosive flash.*

> Dramatic science-fiction illustration of three small rockets detonating against a mineral ceiling, side cross-section view. The rockets burst at staggered altitudes across the upper third, each a bright amber-white explosion scattering a fan of fine glowing fragments outward into the mineral layer. The fragments pepper the ceiling in scattered clusters, dislodging small cascades of rust, emerald and violet crystals. Below, a mining platform on the rubble floor has a raised rocket rack tilting upward, two more rockets climbing on thin smoke trails. A translucent elastic ball with a cyan core bounces between the platform and an intact section of ceiling on the right. Warm explosive flash-light rakes down from above, cool blue reactor uplight from below, atmospheric smoke, palette of charcoal, rust, amber and cyan, celebratory fireworks mood.

### 17 · art · sandblaster rig → `photos/art/sandblaster.jpg`

*Style: gritty industrial, harsh side light.*

> Gritty industrial illustration of a sandblaster rig firing at a mineral ceiling, side cross-section view. From a turret on the mining platform's deck, a focused jet of fine gravel and grit shoots upward at a steep angle, striking the mineral ceiling in a tight cluster. Where the stream hits, a small dense dust plume erupts, and a few individual crystals dislodge and tumble back down. The platform sits on the rubble floor with wheels locked, a small hopper feeding the rig. A translucent elastic ball with a cyan core bounces elsewhere in the chamber, out of the line of fire. Hard side light from a work lamp on the deck picks out the grit stream and dust plume, cool ambient fill, atmospheric haze thick with suspended dust, palette of slate, rust, ochre and cyan, harsh industrial mood.

### 18 · art · overheated radiators → `photos/art/radiators.jpg`

*Style: technical close-up, thermal glow.*

> Technical close-up illustration of overheated radiator fins on a mining platform, side view. A bank of dark metal fins projects from the platform's flank, glowing dull cherry-red at their base fading to soot-black at the tips, heat shimmer rising in a column. Behind the fins, the platform's hull is stained with soot and coolant residue, a small brass thermometer mounted on the deck showing a needle pegged into the red zone. A faint cyan glow from the ball's core visible at the upper edge of the frame. Low raking side light from the lower left, deep shadow behind the fins, atmospheric heat haze, palette of cherry-red, soot-black, brass and a single cyan accent, oppressive thermal mood.

---

## how to run them

The captions are ready to feed straight to the gravity-trajectory MOSS
generator. Adapt the call to however arc-steam wires its photo deck — the
captions themselves are model-ready either way.

```sh
# queue every caption above verbatim into ComfyUI (MOSS-Image graph)
python3 photos/generator/comfy_queue.py --no-refine --workflow moss --wait

# one splash, deterministic seed, 16:9 2 MP, SLG on
python3 photos/generator/comfy_queue.py --no-refine --workflow moss \
  --splash steam-1 --seed 42 \
  --set 19.aspect_ratio="16:9 (Widescreen)" --set 19.megapixels=2 \
  --set 18:24.switch=true --wait

# art card at the gravity-trajectory default 3:2 1.5 MP
python3 photos/generator/comfy_queue.py --no-refine --workflow moss \
  --art impact --seed 7 --wait
```

`comfy_queue.py` finds the prompt by `--splash` / `--art` / `--background`
slugs if you add them to its caption table; otherwise paste the paragraph
into the workflow's `##prompt` field (`18:17`) directly and patch the size
on node `19` (`aspect_ratio` string + `megapixels` integer). The negative
prompt lives on node `18:5`; SLG flips on with `18:24.switch=true`.

## references

- MOSS-Image user guide: <https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md>
  (caption-style prompts, CFG 3.0, Euler ≥ 50 steps, shift 5.0, SLG skip 22)
- gravity-trajectory photo deck + generator: `photos/prompts.md`,
  `photos/README.md`, `photos/generator/image_moss_image_t2i.json`,
  `photos/generator/comfy_queue.py`
- arc-steam game design: `draft.txt`, `README.md`, `0.1.0-plan.md`,
  `html-layout-draft.md`
