# photo prompts — Krea 2 and MOSS-Image

Fourteen captions: seven planet types × (from space, landed). Each is written
as a description of the finished picture, which is what both models want — Krea
2 is trained on natural-language prose (not tag soup), and MOSS-Image is trained
on captions and explicitly recommends describing the image rather than giving
an instruction. The same paragraph works in both; the settings differ.

## settings

### Krea 2

- Prompt: the full paragraph below. Long, flowing, natural language; do not
  turn it into comma tags. One medium and one lighting idea per image.
- Aspect: 3:2 (1536 × 1024 or 1344 × 896). The turbo model goes up to 2K.
- Creativity: medium for these; low if a particular frame matters.
- No text in the image. If a platform sign is unavoidable, quote the exact
  short string — but the deck's placeholder art has no lettering and the game
  draws its own caption.
- Krea has no CFG; do not write "no X / without X" in the prose. Use the
  platform's negative field if a run keeps adding unwanted objects.

### MOSS-Image (Base or SFT)

- Prompt: the same paragraph, as one cohesive caption. Turn the prompt
  upsampler **off** if you want the wording kept exactly as written.
- Size: 1536 × 1024 (both sides divisible by 16; ≈ 1.5 MP is one of the
  recommended budgets).
- Sampler Euler · steps ≥ 50 · CFG 3.0 (raise toward 6 for short prompts) ·
  shift 5.0 · SLG skip layer 22 if available.
- Negative prompt: `nsfw, worst quality, bad anatomy, watermark, jpeg artifact`
- Layout JSON is not needed here; it is for placing text and panels. Keep the
  whole planet/platform inside the frame and let the model compose.

### shared

- Save as `photos/space/<type>.jpg` or `photos/landed/<type>.jpg`;
  optional variants `<type>-2.jpg`, `<type>-3.jpg`. See `README.md`.
- No lettering, logos or watermarks. The popup adds the title itself.
- Keep the main subject clear of the extreme bottom edge; the card stacks its
  title below the picture.

## the set

Each entry: **type · situation** — file name, then the caption. The style
column is deliberately varied so a run through many systems does not look like
one filter.

### 1 · rock · from space → `photos/space/rock.jpg`

*Style: ink-wash graphic novel.*

> A small airless rock world seen from orbit, its surface a maze of sharp
> craters and long scarps, rendered in loose black ink washes with a single
> warm ochre accent. The planet fills the lower-left of a wide black field, lit
> hard from the upper right so the terminator cuts a crisp diagonal across the
> disc. A handful of tiny port lights glimmer on the night side. Fine paper
> grain, muted grey palette, one colour only, graphic-novel cover art.

### 2 · rock · landed → `photos/landed/rock.jpg`

*Style: hazy science-fiction photograph.*

> A squat cargo lander resting on a vast dust plain at dusk, its three legs
> sunk slightly into grey regolith, a ramp lowered and a single work light
> casting a long cone through drifting dust. Two small moons hang above a flat
> horizon, one behind the other, and the sky fades from dusty violet at the
> ground to near-black overhead. Wide 35 mm view from a low tripod, fine dust
> in the air, cool shadows and a warm lamp, quiet and empty.

### 3 · terran · from space → `photos/space/terran.jpg`

*Style: photoreal orbital photograph.*

> A photorealistic orbital view of a blue ocean world: deep cobalt seas, white
> spiral storm bands, a brown-green continental shelf along the left limb, and
> thin blue atmospheric haze glowing at the edge of the disc. Sunlight comes
> from behind the camera, so most of the visible face is lit, with one soft
> shadow line near the right edge. The planet fills most of the frame against
> black space with a few sharp stars. 50 mm lens, high detail, natural colour,
> documentary satellite photography.

### 4 · terran · landed → `photos/landed/terran.jpg`

*Style: retro-futurist travel poster.*

> A weathered concrete landing pad on a grassy river delta at golden hour, the
> cargo lander standing at the centre with heat still shimmering above its
> engines, and a shallow river braiding away toward green hills. A few white
> clouds, long warm shadows, and a low sun behind the lander rim-lighting the
> hull. Painted travel-poster style: flat colour fields, screen-print texture,
> generous sky, optimistic 1960s space-age palette of teal, ochre and cream.

### 5 · super · from space → `photos/space/super.jpg`

*Style: painterly matte painting.*

> A massive super-Earth looming in a deep indigo sky, its surface a dark
> blue-green ocean broken by chains of volcanic islands and one huge hurricane
> system, wrapped in a teal aurora that spills over the north pole. The planet
> is lit from low behind, a bright crescent on the right limb, the rest in
> shadow with city-scale volcanic glows. Painterly science-fiction matte
> painting, soft atmospheric scattering, dramatic scale, no spacecraft.

### 6 · super · landed → `photos/landed/super.jpg`

*Style: hard science-fiction photograph.*

> A cargo lander on a black basalt shore under a crushing orange sky, its hull
> visibly bowed, the struts half-buried in coarse volcanic gravel, and a heavy
> sea of dark oil-like liquid stretching to a blurred horizon. Dust hangs in
> the thick air, the local star is a small hard disc, and everything casts
> short heavy shadows. Wide-angle, slight wide-lens distortion, desaturated
> blacks and rust, oppressive high-gravity atmosphere, cinematic realism.

### 7 · dwarf · from space → `photos/space/dwarf.jpg`

*Style: minimalist screen print.*

> A small grey dwarf world in the upper right of the frame, tiny against a
> huge deep-red parent star that fills the left half of the image — the star
> cropped by the frame so only its curve is visible. The planet is a pale
> pebble with a few craters and a faint terminator. Two-colour screen print:
> warm vermilion and bone grey on a dark ground, big flat shapes, subtle paper
> texture, scientific poster composition with lots of empty space.

### 8 · dwarf · landed → `photos/landed/dwarf.jpg`

*Style: isometric illustration.*

> An isometric cutaway of a cramped research outpost on a crater rim, dome
> modules and a small cargo lander clustered on the narrow ledge, the crater
> falling away steeply on one side. A swollen orange sun sits low and enormous
> in the sky, casting long shadows across the grey ground; the far horizon
> curves noticeably. Clean vector-like isometric style, limited palette of
> rust, sand and slate, crisp shadows, no text.

### 9 · mini · from space → `photos/space/mini.jpg`

*Style: pastel risograph.*

> A pebble of a world, barely three kilometres across, floating in a busy
> asteroid belt: the little potato-shaped body is in sharp focus centre-left,
> three larger rocks drift out of focus behind it, and a distant star glows
> pale pink. Soft pastel risograph style, visible halftone dots, mint and
> salmon ink on cream paper, gentle grain, playful and quiet.

### 10 · mini · landed → `photos/landed/mini.jpg`

*Style: playful cartoon.*

> A cargo lander absurdly large for the world it stands on: the tiny round
> asteroid curves away to both sides just past the landing legs, and the
> horizon is close enough to see it bend. Two tiny astronauts for scale stand
> beside the pad, one holding a flag-less pole. A huge pastel gas giant hangs
> in the black sky behind. Bright cartoon illustration, clean outlines, warm
> highlight and deep blue shadow, friendly and funny.

### 11 · gas · from space → `photos/space/gas.jpg`

*Style: photoreal.*

> A photorealistic gas giant filling the frame: broad cream and rust bands,
> turbulent white storm ovals, and a thin dark ring system seen almost edge-on.
> The planet is lit from the left, the right limb in deep shadow, and one large
> moon transits the disc as a small black dot. Deep black space, sharp stars,
> very high detail in the cloud tops, long telephoto compression, planetary
> science imaging.

### 12 · gas · landed → `photos/landed/gas.jpg`

*Style: dieselpunk.*

> A heavy air platform floating in the cloud deck of a gas giant: riveted
> metal deck, four huge ducted fans holding station, a cargo lander clamped to
> the pad, and a railing where two tiny figures look out over an ocean of
> amber clouds. Above, banded storm clouds curve away toward a bright opening
> in the overcast; below, no ground at all. Dieselpunk engineering, warm brass
> and soot-black palette, dramatic side light, volumetric haze, painterly
> concept art.

### 13 · ice · from space → `photos/space/ice.jpg`

*Style: luminous digital painting.*

> A pale ice giant seen from a high angle, its marbled cyan and white
> atmosphere faintly banded, a bright ring system sweeping in front of the disc
> and another arc behind it. The sun is hidden behind the planet, so the rings
> glow and the atmosphere is outlined in a thin luminous rim; the night side
> shows a soft teal aurora. Luminous digital painting, cool palette, long
> exposure feel, serene and monumental.

### 14 · ice · landed → `photos/landed/ice.jpg`

*Style: art-deco poster.*

> A low platform on a frozen methane sea, white geometric struts and a domed
> hangar reflected in black ice, a cargo lander parked beside it, and curtains
> of green aurora arcing overhead. The horizon is flat and very far away; a
> small pale sun sits just above it. Art-deco travel-poster style: clean
> geometry, gold and glacial-blue palette, symmetrical composition, engraved
> texture, elegant and cold.

## what the deck does with them

The popup appears bottom-left when a new planet system is entered (`space`) and
again on landing (`landed`); a gas giant landing is the air-platform picture.
It keeps the aspect ratio and scales to the free space, falls back to a 256 px
overlay on small screens, closes on × or after nine seconds, and never shows
the same planet twice in one run. Every missing file simply shows the CSS
postcard for that type — so generate in any order.

## references

- Krea 2 prompting: <https://github.com/krea-ai/krea-2> (natural language,
  long detailed prompts; docs/prompting.md)
- MOSS-Image user guide: <https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md>
  (caption-style prompts, CFG 3.0, Euler, ≥50 steps, shift 5.0, negative tags)
