# photo prompts — MOSS-Image (optimized)

Seventeen captions: seven planet types × (from space, landed), plus three
career scenes (catapult launch, cargo delivery, sport competition). Each
caption is written as a **finished-image description** for MOSS-Image, which
was trained on captions — not instructions. The model reads a caption as “this
is what the finished picture shows.” The same paragraph works for MOSS Base or
SFT.

MOSS-Image is the recommended renderer for this project (superior texture and
lighting vs Krea 2). The Krea-prompted set is preserved in
`archive/photos-prompts-krea2.md`.

## settings — MOSS-Image

| | |
|---|---|
| Prompt | The full paragraph below, verbatim. Turn the prompt **upsampler OFF** if you want wording kept exactly. |
| Size | **1536 × 1024** (3:2, both sides divisible by 16, 1.5 MP — recommended budget). |
| Sampler | `Euler` · `steps ≥ 50` · `CFG 3.0` (raise toward 6 for short prompts) · `shift 5.0` |
| SLG | skip layer `22` if available |
| Negative | `nsfw, worst quality, bad anatomy, watermark, jpeg artifact` |
| Text in image | none — the deck draws kicker/title below the picture |
| Variants | Save as `photos/space/<type>.jpg` or `photos/landed/<type>.jpg`; optional `-2`, `-3` variants |

Shared notes:

- Save files exactly as `photos/space/<type>.jpg`, `photos/landed/<type>.jpg`
  or `photos/career/<scene>.jpg` — see `README.md` for variant rule
  (`<type>-2.jpg`, planet views only).
- Keep the whole planet/platform inside the frame; keep subject clear of the
  extreme bottom edge (title block sits below image).
- No lettering, logos or watermarks.
- Layout JSON is not needed here (only for placing text panels).

## the set

Each entry: **type · situation** — file name, then the caption. The style
column is varied so a tour through many systems does not look like one filter.

### 1 · rock · from space → `photos/space/rock.jpg`

*Style: ink-wash graphic novel.*

> Ink-wash graphic novel illustration of a small airless rock world seen from orbit. The planet sits in the lower left of a wide black field, occupying about a third of the frame. Its surface is a dense maze of sharp craters, long scarps and pale ejecta rays rendered in loose black brush strokes on textured paper with a single warm ochre accent on sunlit crater rims. Hard sunlight from the upper right cuts a crisp diagonal terminator across the disc; the night side is deep grey-black with four tiny warm-white port lights glimmering near the limb. Fine paper grain throughout, muted palette of charcoal, bone-white and ochre, graphic-novel cover composition with generous empty space above the world.

### 2 · rock · landed → `photos/landed/rock.jpg`

*Style: hazy 35 mm science-fiction photograph.*

> Hazy 35 mm science-fiction photograph of a squat cargo lander at rest on a vast dust plain at dusk. The lander stands in the centre foreground, three legs sunk slightly into fine grey regolith, a ramp lowered to the ground and a single work light casting a long conical beam through drifting pale dust. The horizon is flat and low, foreground dust in sharp focus fading to soft atmospheric haze in the midground. Above, two small moons hang one behind the other in a dusty violet sky that fades to near-black at the top of the frame. Low tripod viewpoint, wide 35 mm perspective, cool shadows and warm lamp color contrast, quiet empty atmosphere, subtle film grain.

### 3 · terran · from space → `photos/space/terran.jpg`

*Style: photoreal orbital photograph.*

> Photoreal orbital photograph of a blue ocean world filling most of the frame. Deep cobalt seas dominate the right two-thirds, white spiral storm bands curl near the top, and a brown-green continental shelf with river deltas lines the left limb. A thin luminous blue atmospheric haze glows at the planet's edge, strongest along the upper right curve. Sunlight comes from behind the camera, so almost the full disc is lit with one soft shadow line near the right edge. The planet floats against black space with four sharp pinpoint stars visible in the upper left. 50 mm lens rendering, natural documentary colour, high detail in cloud tops and coastline, crisp focus from horizon to horizon.

### 4 · terran · landed → `photos/landed/terran.jpg`

*Style: retro-futurist travel poster.*

> Retro-futurist travel poster painting of a weathered concrete landing pad on a grassy river delta at golden hour. The cargo lander stands at the centre of the pad, heat shimmer rising above its engines, with a shallow braided river meandering from the foreground toward green hills in the background. A few flat white clouds drift in a wide teal sky. The low sun sits directly behind the lander on the horizon, rim-lighting the hull with a thin gold edge and casting long warm ochre shadows across the grass and concrete. Flat colour fields, subtle screen-print halftone texture, generous sky occupying the top half, optimistic 1960s space-age palette of teal, ochre, cream and warm grey, clean geometric composition.

### 5 · super · from space → `photos/space/super.jpg`

*Style: painterly matte painting.*

> Painterly science-fiction matte painting of a massive super-Earth looming in the centre of the frame, viewed from high orbit. The surface is a dark blue-green global ocean broken by chains of volcanic islands glowing faint orange and one enormous white hurricane vortex in the lower right quadrant. A translucent teal aurora curtains over the north pole, spilling down the night side. The planet is lit from low behind the camera on the right, creating a bright crescent along the right limb while the left two-thirds falls into shadow punctuated by scattered volcanic glows at city scale. Soft atmospheric scattering, deep indigo sky fading to black at the edges, dramatic scale, no spacecraft, broad painterly brushwork with luminous edges.

### 6 · super · landed → `photos/landed/super.jpg`

*Style: hard science-fiction photograph.*

> Hard science-fiction photograph of a cargo lander on a black basalt shore under a crushing orange atmosphere. The lander dominates the left foreground, hull plates visibly bowed under gravity, three thick struts half-buried in coarse volcanic gravel, a loading ramp extending to the right. To the right, a heavy sea of dark oil-like liquid stretches flat to a blurred ochre horizon. The air is thick with suspended rust dust; the local star is a small hard white disc high in a hazy burnt-orange sky, casting short, dense shadows straight down. Wide-angle view from low ground level with slight lens distortion, desaturated blacks and rusts, oppressive high-gravity mood, cinematic realism with sharp micro-detail on hull rivets and gravel texture.

### 7 · dwarf · from space → `photos/space/dwarf.jpg`

*Style: minimalist screen print.*

> Minimalist screen print of a small grey dwarf world in the upper right quarter, tiny against a huge deep-red parent star that fills the left half of the image. The star is cropped by the left and bottom frame edges so only its curved limb is visible, radiating subtle granular texture in warm vermilion. The planet is a pale bone-grey pebble, delicately cratered, with a faint terminator line along its lower left edge. The background is a flat dark charcoal field with two small white stars. Two-colour design: warm vermilion and bone-grey on dark ground, large flat shapes, subtle paper texture, scientific poster composition with expansive empty space emphasizing scale, crisp edges.

### 8 · dwarf · landed → `photos/landed/dwarf.jpg`

*Style: isometric illustration.*

> Clean isometric cutaway illustration of a cramped research outpost perched on a narrow crater rim. In the foreground, white dome modules and a small cargo lander cluster on the ledge; the crater wall falls away steeply on the left into deep shadow, revealing layered grey strata. The horizon curves noticeably, emphasizing the tiny world. A swollen orange sun sits low on the right horizon, enormous, casting long hard shadows to the left across the grey regolith. The sky is near-black fading to deep rust at the horizon. Limited palette of rust, sand, slate and warm white, precise vector-like edges, crisp shadows, no text, viewpoint from slightly above and to the right looking across the outpost.

### 9 · mini · from space → `photos/space/mini.jpg`

*Style: pastel risograph.*

> Pastel risograph print of a pebble-sized asteroid centred slightly left of frame, barely three kilometres across, floating in a busy asteroid belt. The main body is potato-shaped, light warm grey with soft pitted craters, in sharp focus. Behind it to the right, three larger angular rocks drift out of focus, rendered as muted pastel blobs. A distant small sun glows pale pink-white in the upper right, softly illuminating the scene. The background is cream paper with visible halftone dots and slight misregistration, palette of mint, salmon pink and warm grey, gentle grain, playful quiet composition with generous negative space, print texture visible across flat colour areas.

### 10 · mini · landed → `photos/landed/mini.jpg`

*Style: playful cartoon illustration.*

> Bright playful cartoon illustration of a cargo lander absurdly large for the tiny world it stands on. The lander occupies the centre, landing legs straddling the sharply curving horizon that bends down on both sides just past the pads, revealing the asteroid as a small round grey-brown rock with soft craters. In the lower left foreground, two tiny astronauts in white suits stand beside the pad for scale, one holding a flag-less pole, casting short shadows. Behind the lander, a huge pastel gas giant with cream and peach bands dominates the black sky, spanning the upper half of the frame. Clean outlines, warm highlight on the lander's left side and deep blue shadow on the right, friendly and humorous mood, clear readable composition.

### 11 · gas · from space → `photos/space/gas.jpg`

*Style: photoreal planetary imaging.*

> Photoreal planetary image of a gas giant filling the entire frame horizontally. Broad horizontal cloud bands in cream, warm rust and pale gold stretch across the disc, interrupted by turbulent white storm ovals and a thin dark ring system seen almost edge-on cutting across the lower third. The planet is lit from the left, the right limb falling into deep shadow; a single large dark moon casts a small crisp circular shadow transiting the mid-right disc. Deep black space with half a dozen sharp stars surrounds the planet. Long telephoto compression, extremely high detail in cloud texture — wispy filaments, churning eddies and soft haze between bands — scientific imaging clarity, natural colour balanced for print.

### 12 · gas · landed → `photos/landed/gas.jpg`

*Style: dieselpunk engineering concept art.*

> Dieselpunk engineering concept art of a heavy air platform floating in the mid-level cloud deck of a gas giant. The platform occupies the foreground centre, a riveted dark metal deck with four huge downward-angled ducted fans churning amber air, a cargo lander clamped to the pad centre, and a railing along the right edge where two tiny silhouetted figures look outward. Above, massive banded storm clouds in warm amber, rust and cream curve away toward a bright opening in the overcast at the top centre; below the deck, the cloud ocean drops into shadow with no visible ground. Volumetric haze and sunbeams cutting through cloud gaps, warm brass and soot-black palette, dramatic side light from the left, painterly detail on metal rivets and fan blades, sense of immense altitude and engineering bravado.

### 13 · ice · from space → `photos/space/ice.jpg`

*Style: luminous digital painting.*

> Luminous digital painting of a pale ice giant viewed from a high three-quarter angle, offset to the right. The planet shows a marbled cyan and white atmosphere with faint subtle horizontal bands. A bright, thin ring system sweeps in front of the lower half of the disc, casting a delicate shadow line, with a second fainter arc visible behind the planet on the upper left. The sun is hidden directly behind the planet, so the atmosphere is rimmed with a thin luminous white-cyan edge light and the unlit night side glows with a soft translucent teal aurora near the pole. The rings catch the backlight and appear to glow. Background is very dark navy-black with a few faint stars. Cool palette of cyan, white, pale teal and deep navy, long-exposure serenity, serene monumental scale, smooth luminous gradients.

### 14 · ice · landed → `photos/landed/ice.jpg`

*Style: art-deco travel poster.*

> Art-deco travel poster of a low platform on a frozen methane sea extending flat to a distant horizon. In the centre foreground, geometric white struts and a domed hangar with a cargo lander parked beside it are reflected perfectly in the glossy black ice surface, creating a symmetrical vertical mirror. Above, huge curtains of green aurora arc from the left horizon to the right, rippling in clean geometric folds. A small pale sun sits just above the flat horizon line in the centre distance, casting a thin gold line across the ice. The sky fades from black at the top to deep glacial blue at the horizon. Gold and glacial-blue palette, precise symmetry, bold geometry, subtle engraved line texture, elegant cold stillness.

## career scenes

Three optional cards for the career rule. The deck looks for one plain file per
scene (`photos/career/<scene>.jpg` or `.png`) and shows a CSS postcard when it
is missing, so these can be generated in any order. The generator writes them
with `--situation career` and never makes variants of a career card.

### 15 · catapult · career → `photos/career/catapult.jpg`

*Style: photoreal industrial photograph.*

> Photoreal industrial photograph of a long electromagnetic launch rail crossing a dusty plain on a small airless world. The rail fills the lower third of the frame, running from the lower left foreground toward a vanishing point near the right horizon; paired steel beams and evenly spaced copper coils catch low sunlight. A blunt silver cargo pod sits clamped in a cradle at the near end, and a thin cyan arc of stored charge runs between the coils. In the left middle distance, low solar-panel arrays and stacked battery modules make a dark silhouette in ochre dust. The horizon curves upward on the right, showing how small the world is, and a black sky with a pale white sun fills the top. Hard raking light from the upper right throws long shadows to the left; fine dust haze near the ground, muted rust, steel grey and cyan palette, sharp engineering detail on rails and cradle, no lettering.

### 16 · delivery · career → `photos/career/delivery.jpg`

*Style: warm documentary illustration.*

> Warm documentary illustration of a cargo container being unloaded at a colony landing pad at dusk. In the centre foreground, a scuffed rectangular container hangs from a yellow gantry crane, its clamps open just above the deck of a small cargo lander. Two crew in bulky grey suits stand to the left, one guiding the load with a handheld control box, the other steadying a cable. On the right, low white habitat domes and a squat field of solar panels sit beyond the pad, their windows glowing amber. The concrete surface reflects the last warm light; crates and coiled hoses line the bottom edge. Above, a broad violet sky fades to deep indigo at the top, with two small moons near the upper left. Soft side light from the lower right, dust motes in the air, gentle painterly texture, warm amber and slate palette, quiet everyday mood, clear readable composition, no text.

### 17 · sport · career → `photos/career/sport.jpg`

*Style: retro-futurist race poster.*

> Retro-futurist race poster painting of a timing gate in orbit at the finish of a long gravity-assisted flight. A slim silver cargo racer crosses the centre of the frame from left to right, nose toward the right edge, trailing a thin pale-blue arc of its curved trajectory behind it. A ring-shaped timing gate of weathered white struts and amber lamps frames the right third, with a checkered band painted across its inner rim. Below the gate, the dark blue limb of a planet curves along the bottom edge, a thin atmospheric glow separating it from black space. Small pennant flags and two tiny observer craft float near the upper left; a bright white star sits at the top right. Flat colour fields, subtle screen-print grain, crisp geometric shapes, teal, cream, amber and deep navy palette, generous black space above the racer, celebratory but calm, no lettering.

## what the deck does with them

The popup appears bottom-left when a new planet system is entered (`space`) and
again on landing (`landed`); a gas giant landing is the air-platform picture.
It keeps the aspect ratio and scales to the free space, falls back to a 256 px
overlay on small screens, closes on × or after nine seconds, and never shows
the same planet twice in one run. Every missing file simply shows the CSS
postcard for that type — so generate in any order. Career shows the same card
once per run on the first catapult launch, the first completed delivery, and
the first won sport competition (`photos/career/<scene>.jpg|png`).

## generator

`generator/comfy_queue.py` queues the captions into ComfyUI; see `README.md`
for usage. The MOSS template is `generator/image_moss_image_t2i.json`.

```sh
python3 photos/generator/comfy_queue.py --list
python3 photos/generator/comfy_queue.py --workflow moss
python3 photos/generator/comfy_queue.py --workflow moss --wait
python3 photos/generator/comfy_queue.py --workflow moss --situation career --wait
```

## references

- MOSS-Image user guide: <https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md>
  (caption-style prompts, CFG 3.0, Euler ≥50 steps, shift 5.0, negative tags,
  upsampler toggle)
- Krea 2 history: `archive/photos-prompts-krea2.md` (long-form natural language;
  docs/prompting.md)
