---
name: gravity-sounds
description: Generate, audition, and install local ComfyUI launch effects and music for gravity cargo.
---

# Gravity launch sounds

Read `sounds/README.md` for setup and `sounds/generator/model-research.md` for
model, sampler and license decisions. Do not claim audio was generated unless a
ComfyUI server actually ran the jobs. Generated takes and WAVs are ignored by
Git until deliberately selected for shipping.

1. `python3 sounds/generator/generate.py --list` shows the cue prompt pack.
2. `python3 sounds/generator/generate.py --cue aim,armed,launch,fly --wait`
   queues multiple deterministic takes on the local ComfyUI server. Use
   `--dry-run --dump /tmp/sound-graphs` to inspect graphs without a server.
3. Open `sounds/generated/audition.html`; listen before choosing. Use the
   `--select cue=PATH` command shown beside a take to install it. Selection
   requires ffmpeg and performs loop crossfades, length caps and flight fade.
4. Reload the `file://`-compatible game. Selected WAVs replace the synth
   stand-ins independently. Use its sound toggle to stop playback.
5. Validate with `node experiments/sound_test.js` and
   `python3 experiments/sound_generator_test.py` (ffmpeg enables selection
   tests). Do not alter physics, replay data or bot behavior for audio.

Default graph: Stable Audio 3 Medium, T5Gemma, 8-step LCM/simple and CFG 1.
Small-SFX is effects-only and has known ComfyUI caveats; do not use it for the
space-rock cue without explicitly treating the result as an experiment.
