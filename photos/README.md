# planet photos

Art for the postcard popup that appears when the cargo enters a new planet
system, lands, or (in career) launches, delivers, or wins a sport task. The
game works without any files here — a CSS postcard of the same type or scene is
drawn instead — so **images are optional and can be added one at a time**.

## drop files here

```
photos/space/   <type>.jpg      the world seen from orbit
photos/landed/  <type>.jpg      the surface, or the air platform on a gas giant
photos/career/  <scene>.jpg     catapult, delivery, sport
```

- `<type>` is one of `rock`, `terran`, `super`, `dwarf`, `mini`, `gas`, `ice`.
  The type comes from the seeded world, so a seed shows the pictures that match
  the worlds it actually generates.
- `<scene>` is one of `catapult`, `delivery`, `sport`; career shows each scene's
  card once per run (first launch, first delivery, first sport win).
- `jpg` is tried first, then `png`. Both work.
- Optional variants (planet views only): `<type>-1`, `<type>-2`, `<type>-3`
  (e.g. `rock-2.jpg`). The deck picks `1 + planetIndex % 3`, then falls back to
  the plain file, so a texture you generate twice does not repeat on every rock
  world. Career scenes read one plain file each, no variants.
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

`prompts.md` holds 18 ready captions — 14 planet views, 3 career scenes and a
two-variant circus card — for **Krea 2** and **MOSS-Image**, plus the settings
each model expects and a negative prompt. A caption with several blank-separated
quoted paragraphs is a variant set: each paragraph is queued as its own file
(`<stem>.jpg`, `<stem>-2.jpg`, …).

## generator

`generator/comfy_queue.py` defaults to `gravity.json`, which includes
`prompts.md` and `helper-joke-prompts.md`, and queues compatible captions into a running
ComfyUI server and downloads the renders straight into `space/`, `landed/` and
`career/`.

```
generator/image_krea2_turbo_t2i_int8.json   Krea 2 turbo API graph (exported template)
generator/image_moss_image_t2i.json         MOSS-Image API graph (exported template)
generator/comfy_queue.py                    stdlib-only queue + collector
generator/queue-manifest.json               written when jobs are queued
```

```sh
python3 photos/generator/comfy_queue.py --list            # what it will caption
python3 photos/generator/comfy_queue.py                   # queue the missing ones
python3 photos/generator/comfy_queue.py --collect         # download when done
python3 photos/generator/comfy_queue.py --workflow moss --wait
python3 photos/generator/comfy_queue.py --situation career --wait
```

- Every ComfyUI *Save (API format)* json dropped into `generator/` is a
  template automatically — no script edit needed. `--workflow NAME` takes a
  file stem (`image_moss_image_t2i`), any unique part of one (`moss`), or `all`;
  without it the only template present is used, else the krea one.
- `--types gas,ice` and `--situation landed|space|career` narrow the set,
  `--variants 2` also writes `-2` files for planet views. A caption with several
  quoted paragraphs cycles them under `--variants`; a career caption writes one
  file per paragraph (`circus.jpg`, `circus-2.jpg`), because `photo_deck.js`
  reads no `-N` variants for career scenes.
- The exported graphs are **templates**: the script only patches the caption,
  the seed, the size (`3:2 (Photo)` · 1.5 MP = exactly 1536 × 1024) and the Save
  Image prefix. Nodes are found by `class_type`, so a re-export does not break
  it. Re-export from ComfyUI with *Save (API format)* after changing a graph.
- Already rendered files are skipped; `--force` redoes them. `--seed N` gives
  one deterministic seed per job, otherwise the template's seed is reused.
- `--no-refine` sends the caption verbatim (`photos/prompts.md` is already
  prompt-shaped), `--steps/--cfg/--negative/--size` override the sampler, and
  `--set NODE.INPUT=VALUE` patches anything else, e.g.
  `--set 18:24.switch=true` to enable MOSS skip-layer guidance.
- Every job carries `extra_data.extra_pnginfo.workflow` (`workflow_name`
  `gravity · <model> · <situation>/<type>`, `workflow_id` per model), which the
  ComfyUI queue custom nodes read — the Queue Manager dereferences
  `extra_pnginfo.workflow.workflow_name` for every dequeued item, and a job
  without it raises `KeyError: 'extra_pnginfo'` in its prompt worker and takes
  ComfyUI down. The field does not affect the render (`--no-extra-data` drops it
  for servers with no queue node); it only names the job in the queue list.
  Update Queue Manager if it still errors: API jobs are handled natively since
  its 2026-10-10 build.
- `--dump DIR` writes each patched graph for inspection, `--dry-run` prints the
  jobs and queues nothing.
- The server defaults to `http://127.0.0.1:8188` (override with `--server` or
  the `COMFYUI` env var). All templates write the same file names, so
  `--workflow all` is a comparison run: the last finished render wins unless
  you give each run its own `--out`.

### visual gallery and reusable projects

Run `python3 photos/generator/gallery.py` (or `generator/gallery.bat` /
`generator/gallery.sh`) for the desktop Tk gallery: prompt cards, thumbnails,
checkboxes, seed variations, delete/undo, batch rendering and settings.
**Switch project…** opens another project JSON; `arc-steam.json` preserves the
imported mining-game prompt pack. Gravity remains the default.

The gallery keeps candidates separate from the game's selected art, under
`generator/output/<project>/`; copy a chosen image to its documented game path.
For direct-to-game batch output, keep using `comfy_queue.py`.

```sh
python3 photos/generator/comfy_queue.py --project photos/generator/arc-steam.json --list
python3 photos/generator/comfy_queue.py --workflow video --situation video --wait
```

Image workflows skip video captions and vice versa. The supplied video graph
uses `RandomNoise`, `MiniMaxH3ImageToVideo` and `SaveVideo`; its sampler is not a
KSampler. Use `--set` for graph-specific controls, for example
`--set 140:133.value=6` for duration, rather than `--steps` / `--cfg`.

See [`generator/README.md`](generator/README.md) for project configuration,
standalone extraction, GUI state, requirements and offline tests.

## checklist

- [ ] rock · space / landed
- [ ] terran · space / landed
- [ ] super · space / landed
- [ ] dwarf · space / landed
- [ ] mini · space / landed
- [ ] gas · space / landed
- [ ] ice · space / landed
- [ ] career · catapult / delivery / sport
- [ ] career · circus (extra art, two variants)
