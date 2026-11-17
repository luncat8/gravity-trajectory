# ComfyUI prompt generator

One shared queue/graph engine (`comfy_queue.py`), with a project-aware Tk
gallery. The generator is self-contained: the preserved arc-steam captions and
MOSS workflow live in `packs/` and this directory, and gravity is the default
project. No game runtime changes are needed.

## Start

Python 3.9+; a running ComfyUI with the models and custom nodes required by your
chosen graph. The CLI uses only the standard library. The desktop gallery also
needs Tkinter (often bundled with Python; on Linux usually a separate system
package). Pillow is optional for smoother image thumbnails. Video files open in
the system video player, not in an embedded player.

```sh
python photos/generator/gallery.py
python photos/generator/gallery.py --project photos/generator/arc-steam.json
python photos/generator/comfy_queue.py --list
python photos/generator/comfy_queue.py --workflow moss --no-refine --wait
python photos/generator/comfy_queue.py --workflow video --situation video --wait
```

`gallery.bat` / `gallery.sh` are desktop shortcuts. **Switch project…** opens a
project JSON in a new gallery window and closes the current one after saving.
This is a local desktop application, not a browser UI.

## Project boundary

Paths in a project JSON are relative to that JSON, not the working directory.
Example for a future separate generator checkout:

```json
{
  "name": "my-game",
  "prompts": ["../my-game/photos/prompts.md"],
  "workflows": "../generator-workflows",
  "output": "../my-game/photos",
  "gallery_output": "./candidates/my-game",
  "prefix": "my-game",
  "default_workflow": "image_moss_image_t2i",
  "category_sizes": {"splash": ["16:9", 2]}
}
```

- `gravity.json` is the default; it includes the existing photo captions and
  the additional helper-joke captions. `arc-steam.json` selects the preserved
  mining-game captions and MOSS workflow.
- `output` is the direct batch destination. `gallery_output` holds candidates,
  gallery state and gallery batch manifests. Copy a winner to its game filename.
- Every API-format workflow JSON in `workflows` is discovered automatically.
  Non-workflow JSON files are ignored. Workflow defaults are per project.
- `category_sizes` supplies optional defaults; explicit caption `*Aspect: ...*`
  metadata takes priority, and explicit CLI size flags take priority over both.
- Copy this generator directory to a standalone project and point project JSON
  files at prompts in each game's repository. Rendering code does not import the
  game. The game can eventually retain only its Markdown prompts and config.

## Prompt format

Existing gravity and arc-steam headings are both accepted:

```md
### 1 · rock · from space → `photos/space/rock.jpg`
*Style: ink-wash illustration.*
*Aspect: 3:2 · 1.5 MP.*

> A small rocky planet above a pale star field.
>
> A second finished-image variant of the rocky planet.
```

For arbitrary projects use `### 1 · category · label → ` followed by a backtick-
quoted relative target filename. A blank quoted line separates variants; ordinary
wrapped quoted lines form one caption. `career` and `video` headings create one
output per paragraph; other categories use CLI `--variants` (the gallery always
exposes each paragraph separately). A leading `photos/` is removed when resolving
under the output directory; other relative target subdirectories are retained.

Video captions use `· video →` and an `.mp4` target. Compatibility is determined
from the graph's `SaveVideo` node, not the template filename. Image graphs skip
video captions; video graphs skip images. Keep the graph's `##prompt` placeholder.

## Features and output safety

The direct CLI retains workflow discovery/selection, type and situation filters,
variants, seeds, skip-existing/force, manifest collection, wait/timeout,
negative/refiner/sampler/size overrides, raw `--set NODE.INPUT=VALUE`, dry-run,
graph dumps, custom server/output/manifest, and queue metadata. It adds
`--project`, repeatable `--prompts`, `--workflow-dir` and `--prefix`.
Run `comfy_queue.py --help` for the full options.

The gallery retains the imported pack's cards, copy-caption/copy-path,
per-file/per-card/per-workflow checkboxes, seed variations and reruns, settings,
server/queue status, batch log window, image viewer, delete-to-trash and Ctrl+Z
undo. State is saved to `<gallery_output>/state.toml`, separately for each
project. One workflow is enabled by default; enable the video graph to render the
video cards. Variations from different workflows include the workflow name in
their filenames.

The card list is painted rather than rebuilt: a finished render, a delete, an undo
and a checkbox toggle repaint one card and keep the scroll position, the hover and
the keyboard focus. A rebuild happens only when the card set itself changes
(filter text, prompt file, a column count change, the grid view). Files are indexed
by prompt in one directory pass, so a project with hundreds of renders costs the
same as one with ten; a render younger than two seconds is not read yet, because it
may still be filling. `N file(s) match no prompt` in the sidebar counts renders
whose name no prompt of this project produces.

| key | where | does |
|---|---|---|
| wheel, right-drag, PgUp/PgDn | the list | scroll the cards (the wheel over the batch log stays the log's) |
| `/` | the list | focus the filter, `Esc` clears it |
| ↑ ↓, `[` `]` | the list | select a card, `Enter` opens its newest image (or queues it) |
| `G` | the list | grid view: every image as a thumbnail |
| ← → | the viewer | previous / next variation of this prompt |
| ↑ ↓ | the viewer | newest image of the previous / next prompt in the list |
| `+` `-`, wheel | the viewer | zoom the picture, drag it when zoomed |
| `Del`, `Esc` | the viewer | delete to `.trash` / close |

The window and the viewer also take a left drag: a click still opens the viewer,
a drag on the picture pans it. Run batch asks once (`Settings` turns that off);
right-click on it is `--force`.

`launch.py --list` previews the gallery's enabled batch; `--dry-run` builds those
graphs without queueing, and `--no-wait` queues with a manifest for later collection.
For example:

```sh
python photos/generator/launch.py --project photos/generator/arc-steam.json --list
python photos/generator/comfy_queue.py --collect --manifest photos/generator/output/arc-steam/queue-manifest.json
```

Gallery batches use the shared queue engine and manifest collector. Interactive
variation downloads are tracked while the gallery is open; keep it open until
they finish. Closing it does not cancel ComfyUI jobs; ComfyUI keeps its output copy.
The low-level `comfy_queue.py` deliberately ignores gallery checkboxes.

Direct CLI `--workflow all` still uses the requested target names: multiple image
workflows overwrite the same target (a warning is printed). Give comparison runs
separate `--out` folders, or use the gallery for separate candidates. CLI seeds
are inherited from the template unless `--seed` is set; gallery variations are
random. Gallery captions are sent verbatim and SLG is controlled by Settings.

The MiniMax/Pika graph has no KSampler: use raw `--set` for its graph-specific
controls. `--steps` / `--cfg` fail clearly for it; leave those gallery settings
blank for video. `--no-refine` is harmless on graphs without a refiner.
Image and video history outputs are downloaded through ComfyUI's `/view` endpoint.

Generated candidates and local state under `output/` are ignored by Git. No
render is automatically added to a game's UI or committed.

## Verification

```sh
python3 -B -m unittest discover -s photos/generator -v
python3 -B -c "import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path('photos/generator').glob('*.py')]"
```

The scripts set `sys.dont_write_bytecode`; `-B` also keeps unittest discovery from
caching the test module itself.

Tests run offline: parsing and variants, preserved arc captions, all bundled
workflow patches, video compatibility, raw overrides, TOML roundtrip, external
project paths, and simulated ComfyUI queue/history/download for images and video.
They do not verify a real model render or exercise Tk widgets.
