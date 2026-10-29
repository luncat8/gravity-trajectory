# Sound

The cargo panel's **sound** selector chooses one of four generators. The choice,
aim/flight mappings, volume and mute state are stored locally when storage is
available. Audio remains decorative: it reads predictions and flight state but
never writes physics, economics, aim inputs or replay data.

## Voronoi distance (default)

The sample-free flight synth is adapted from the MIT-licensed
[experiment-sound-voronoi](https://github.com/luncat8/experiment-sound-voronoi),
using its distance preset (frequency steepness 54, volume 53, envelope 6).
The nearest active planet center and its Voronoi-adjacent centers each get a
triangle voice with a low-pass filter and distance-dependent sine envelope.
Closer centers are higher and louder; inside 20 world pixels the envelope is
continuous. The nearest plus up to 19 closest neighbors sound at once, with
stable voice identities and smooth releases. Geometry is recomputed from the
moving planet positions and active mask, using unbounded Voronoi cells.
Unlike the original experiment's screen-horizontal pan, this adaptation uses
ship-relative left/right bearing, faded near the center. Distances are to
planet centers, not surfaces. This makes the center-distance preset meaningful
without changing it for planets of different sizes.

The default shares the trajectory synth's aim mappings and synthesized ignition;
it ducks flight during an impulse-burn preview. Existing saved generator and
mute preferences are respected. Both synths unlock on a user gesture and suspend
in the background.

## Trajectory synth

`gravity_trajectory_sound.js` provides the aim and alternate flight mappings,
reusing its oscillators and note pool without media files.

**Aim mappings**

- **Outcome + EMC**: a continuous chord encodes the displayed profit (brighter
  and higher for positive net outcome, darker/minor for loss; magnitude controls
  intensity). Short ticks speed up logarithmically with trajectory length. A
  two-note destination beacon uses the destination planet's note; in career a
  blocked or unaffordable departure gets a low dissonant pair, while a usable EMC
  gets a consonant interval whose tier/speed affect brightness. Career profit is
  the net estimate after launch fee and viable exit cost, not gross receipts.
- **Trajectory fly-through**: the predicted visit log is compressed into a short
  repeating phrase, preserving encounter order and relative timing. Each system
  uses its planet note, panned by its bearing from that point relative to the
  local path tangent (the ship's heading), not by screen x-position. A predicted
  landing closes the phrase. While a long route is still tracing, only continuous
  layers and length ticks run, so a partial endpoint is never presented as final.

Released route plans stay audible in this generator. Impulse-burn previews use
the same aim sonification and duck the live flight cue underneath.

**Flight mappings**

- **Pentatonic proximity**: `get_tone_pentatonic(planet_id)` gives the nearest
  active planet a stable note from a shared pentatonic collection. Closer planets
  are louder. Equal-power left/right pan is relative to the ship's instantaneous
  heading, derived from the current velocity; the launch angle is a fallback if
  the velocity is momentarily zero.
- **Instrument range**: `get_instrument(planet_id)` gives the planet a stable
  synthetic timbre. Farther planets are higher in pitch and lower in volume;
  nearer planets are lower and louder. The same heading-relative pan applies.

Distance is measured from the cargo to the planet surface (zero inside the disc).
The stereo pan uses the planet's lateral bearing (left/right of the ship's nose),
not its world-screen x coordinate. A planet directly ahead or behind is centered;
ordinary stereo does not distinguish fore from aft.
A short synthesized ignition marks launch; landing/reset/mute fade the flight bus.
Switching generator or flight mapping mid-flight changes the cue without
restarting the simulation or replaying the ignition.

## Classic four-stage cues (selected samples / classic synths)

The older engines play a four-stage cue for a **manual** launch:

| Stage | Sound | When it ends |
| --- | --- | --- |
| `aim` | sustained high-gain guitar-like note, looping with a soft attack | fade out on release, cancellation or mute |
| `armed` | fast, soft cymbal-roll shimmer, looping | short fade at cancellation or actual launch |
| `launch` | one low thunder impact with echoes | about four seconds |
| `fly` | a short sci-fi space-rock instrumental | fades out over the last 1.5 seconds of ten seconds; earlier on landing |

In career, the shimmer continues while the EMC barrel turns: the thunder is
triggered when it **fires**, not when the button queues the shot. Lab and the
flown game rules use the same stages. Route planning has the drag sound but no
armed loop, and bot launches, replays, and mid-flight impulse burns do not
trigger the launch cues.
Restarting, clearing cargo or starting a replay clears the sounds. The **sound on/off** button is in
the gravity cargo header. Browsers require a user gesture before audio starts;
if storage is available, the mute choice is remembered. Backgrounding the
page silences the cues. On returning, only a still-active loop resumes.

**Selected samples** uses local generated takes where present and falls back to
the approximate procedural Web Audio synths for missing or unplayable cues.
**Classic synths** forces those fixed procedural cues and loads no media. Neither
is an AI-generated guitar, cymbal, thunder, or rock recording. Selected local
media plays directly with native volume fades, without `fetch` or a Web Audio
media source, so it also works from `file://` without special browser flags.

## Generate and audition

The chosen model is **Stable Audio 3 Medium**, an open-weight local model that
can generate both the SFX/instrument cues and the musical flight cue. The
smaller SFX-only model is a useful alternative for the effects, not the full
music cue. Selection, caveats, licensing, and source links are in
[generator/model-research.md](generator/model-research.md).

1. Update your local ComfyUI. Put these files from
   [Comfy-Org/stable-audio-3](https://huggingface.co/Comfy-Org/stable-audio-3)
   under its `models/` directory:

   ```text
   checkpoints/stable_audio_3_medium.safetensors        (~8.6 GB)
   text_encoders/t5gemma_b_b_ul2.safetensors            (~1.1 GB)
   ```

   Start ComfyUI normally. No API key, custom node, Qwen model, Python package
   or network service is needed by the graph after downloading the weights.
   The script itself uses Python 3's standard library and reuses the photo
   generator's ComfyUI HTTP client (Python 3.9 or newer). The graph is based
   on the official Medium template, with direct detailed prompts rather than
   Qwen rewriting.

2. From the repository root:

   ```sh
   python3 sounds/generator/generate.py --list
   python3 sounds/generator/generate.py --dry-run --dump /tmp/sound-graphs
   python3 sounds/generator/generate.py --wait
   ```

   The default pack has 3 prompts × 2 deterministic seeds for each of the 4
   cues (24 takes). Duration, prompt, seed, and 8/10 sampling steps vary. The
   distilled model's recommended starting point is 8 steps, CFG 1, LCM/simple;
   the 10-step variants are exploratory, not a promise of better quality.
   Captions use `TrackType: Instrument`, `TrackType: SFX`, and
   `TrackType: Music, VocalType: Instrumental` as appropriate.

   The server defaults to `http://127.0.0.1:8188` (set `COMFYUI` or pass
   `--server http://host:port`). Jobs are recorded immediately in
   `generator/queue-manifest.json`. If you queued without `--wait`, collect
   completed jobs later:

   ```sh
   python3 sounds/generator/generate.py --collect         # one pass
   python3 sounds/generator/generate.py --collect --wait  # poll until done
   ```

   Open `sounds/generated/audition.html` in a browser to hear the FLAC takes,
   read their prompts/settings, and copy the selection command beside each.
   If the browser cannot play FLAC, listen to the files in an audio player.
   The original files and the queue manifest are ignored by Git.

3. Install [ffmpeg](https://ffmpeg.org/) on your machine, then select the
   takes you prefer. For example (use the actual filenames in the audition
   page):

   ```sh
   python3 sounds/generator/generate.py \
     --select aim="sounds/generated/medium/aim/your-take.flac" \
     --select armed="sounds/generated/medium/armed/your-take.flac" \
     --select launch="sounds/generated/medium/launch/your-take.flac" \
     --select fly="sounds/generated/medium/fly/your-take.flac"
   ```

   You can select one cue at a time. Selection converts to 44.1 kHz stereo
   PCM WAV, applies a bounded peak adjustment, and crossfades each loop's
   boundary (250 ms by default). Launch is capped at 4.2 seconds, flight at
   10 seconds with a fade, even if a longer `--length` is requested. The
   originals remain untouched. `--start 1.2 --length 4` selects a region of a
   take; `--crossfade-ms 400` changes the
   loop seam. The script rewrites `sounds/selected/pack.js` to list only the
   selected WAVs. Reload the game to hear them. Generated WAVs are ignored by
   Git: if you decide to ship them, verify their license and explicitly add
   the selected files along with `pack.js`.

### Useful variations

```sh
python3 sounds/generator/generate.py --cue aim,armed --takes 4 --seed 9000 --wait
python3 sounds/generator/generate.py --cue launch --steps 8 --seconds 4 --wait
python3 sounds/generator/generate.py --cue launch --checkpoint stable_audio_3_small_sfx.safetensors --wait
python3 sounds/generator/generate.py --force --cue fly --wait
```

`--force` requeues matching filenames; otherwise completed files and already
queued jobs are skipped. `--steps`, `--seconds`, `--cfg`, `--sampler`, and
`--scheduler` override settings, and their values are reflected in filenames.
Filtered runs keep the same seeds as the full run. `--out DIR` changes the
candidate and audition directory; keep the same `--out` when collecting.
A failed job is reported, not silently marked done; use `--force` to requeue.

The script sends `extra_data.extra_pnginfo.workflow` as the photo queue does,
so older ComfyUI Queue Manager nodes have their expected metadata. For manual
editing, drag `generator/stable_audio_3_medium_workflow.json` into ComfyUI.
It is derived from the official template, but has not yet been imported into
ComfyUI or used for inference in this environment. The script uses the
companion `stable_audio_3_medium_api.json`; after editing
in the UI, export **Save (API format)** and pass it with `--workflow PATH`.
The script expects one checkpoint loader, latent, sampler, and
`SaveAudioAdvanced`, with a direct positive `CLIPTextEncode`. It sets the
output format to lossless FLAC.

## Tests

```sh
node experiments/sound_test.js
node experiments/trajectory_sound_test.js
node experiments/voronoi_sound_test.js
python3 experiments/sound_generator_test.py  # ffmpeg also exercises selection
CHROME_PATH=/path/to/chromium node experiments/sound_browser_test.js  # requires puppeteer-core
```
