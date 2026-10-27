# Launch sounds

The game plays a four-stage cue for a **manual** launch:

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

Without selected files the game uses approximate, procedural Web Audio synths
—not AI-generated guitar, cymbal, thunder, or rock recordings. This keeps the
feature usable offline immediately. Selected generated takes replace individual
synths; missing or unplayable files fall back to the synth. Audio is decorative
and never affects simulation or replay results. Selected local media plays
directly with native volume fades, without `fetch` or a Web Audio media source,
so it also works from `file://` without special browser flags.

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
python3 experiments/sound_generator_test.py  # ffmpeg also exercises selection
CHROME_PATH=/path/to/chromium node experiments/sound_browser_test.js  # requires puppeteer-core
```
