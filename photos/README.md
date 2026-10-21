# planet photos

Art for the postcard popup that appears when the cargo enters a new planet
system or lands. The game works without any files here — a CSS postcard of the
same planet type is drawn instead — so **images are optional and can be added
one at a time**.

## drop files here

```
photos/space/   <type>.jpg      the world seen from orbit
photos/landed/  <type>.jpg      the surface, or the air platform on a gas giant
```

- `<type>` is one of `rock`, `terran`, `super`, `dwarf`, `mini`, `gas`, `ice`.
  The type comes from the seeded world, so a seed shows the pictures that match
  the worlds it actually generates.
- `jpg` is tried first, then `png`. Both work.
- Optional variants: `<type>-1`, `<type>-2`, `<type>-3` (e.g. `rock-2.jpg`).
  The deck picks `1 + planetIndex % 3`, then falls back to the plain file, so a
  texture you generate twice does not repeat on every rock world.
- Missing files are skipped without errors: variant → plain → CSS postcard.

## image spec

| | |
| --- | --- |
| aspect | 3:2 landscape, 1536 × 1024 recommended |
| smallest | 768 × 512 |
| subject | whole and uncropped; the card never crops, it contains |
| text | none — the kicker and title are drawn by the page |
| mood | diverse on purpose: photo, ink, risograph, poster, matte painting |

The card is shown at roughly 340 × 230 px bottom-left (256 px overlay on small
screens), so detail below ~3 px in the final image is wasted. Keep the horizon
or the planet edge away from the very bottom: the title block sits under the
image, not on it.

## prompts

`prompts.md` holds one ready caption per type and situation for **Krea 2** and
**MOSS-Image**, plus the settings each model expects and a negative prompt.

## checklist

- [ ] rock · space / landed
- [ ] terran · space / landed
- [ ] super · space / landed
- [ ] dwarf · space / landed
- [ ] mini · space / landed
- [ ] gas · space / landed
- [ ] ice · space / landed
