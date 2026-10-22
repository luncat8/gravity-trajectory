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

## generator

`generator/comfy_queue.py` queues every caption in `prompts.md` into a running
ComfyUI server and downloads the renders straight into `space/` and `landed/`.

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
```

- Every ComfyUI *Save (API format)* json dropped into `generator/` is a
  template automatically — no script edit needed. `--workflow NAME` takes a
  file stem (`image_moss_image_t2i`), any unique part of one (`moss`), or `all`;
  without it the only template present is used, else the krea one.
- `--types gas,ice` and `--situation landed` narrow the set, `--variants 2`
  also writes `-2` files.
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

## checklist

- [ ] rock · space / landed
- [ ] terran · space / landed
- [ ] super · space / landed
- [ ] dwarf · space / landed
- [ ] mini · space / landed
- [ ] gas · space / landed
- [ ] ice · space / landed
