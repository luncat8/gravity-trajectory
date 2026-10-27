# Local sound generation choice · 2026-10-27

**Default: Stable Audio 3 Medium (distilled), in a native ComfyUI graph.** It
has the best fit for this particular pack: it generates isolated instruments,
SFX and instrumental music in one model, is open-weight and has an official
ComfyUI template. Stability's own 5-second SFX benchmark reports Medium ahead
of both Small-SFX and the older Stable Audio Open on its aggregate metrics;
this is not proof that it will win for every prompt, so keep and audition
multiple takes. [Technical report](https://arxiv.org/html/2605.17991v1),
[ComfyUI workflow and model files](https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3),
[Stability prompt guide](https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/prompting.md).

| Candidate | Decision |
| --- | --- |
| Stable Audio 3 Medium | Default: SFX, isolated guitar, cymbal and music in one model. The ComfyUI checkpoint is ~8.6 GB plus the ~1.1 GB T5Gemma encoder. A GPU is recommended; memory and speed depend on hardware and precision. |
| Stable Audio 3 Small-SFX | Fast, smaller (~2.3 GB plus encoder), specialized for effects. Try `--checkpoint stable_audio_3_small_sfx.safetensors --cue launch` for a comparison; not intended for the musical flight cue. Stability's reference inference uses 8 steps and PingPong; the bundled graph uses the official Comfy Medium template's LCM/simple settings, so Small-SFX in this graph is experimental rather than a proven equivalent. |
| Stable Audio Open 1.0 | Older, shorter and slower for its standard 100-step configuration in the published comparison; usable as an alternative, but requires a different checkpoint, T5 encoder and sampler workflow. |
| MOSS-SoundEffect v2 | Local SFX alternative, not the selected ComfyUI-first workflow. A recent [independent SFX bake-off](https://github.com/vl3c/local-sounds) preferred Small-SFX in its sample and reported much slower inference for MOSS on its tested machine. This is not a universal ranking. |
| Stable Audio 2.5 | The common ComfyUI nodes are a hosted API, not the desired local open-weight workflow. [ComfyUI announcement](https://blog.comfy.org/p/stable-audio-25-is-now-in-comfyui). |

The default distilled Medium graph matches the official ComfyUI template:
`CheckpointLoaderSimple` + separate `CLIPLoader` (`stable_audio` / T5Gemma),
positive and negative `CLIPTextEncode`, `EmptyLatentAudio`, `KSampler`
(LCM/simple, 8 steps, CFG 1), `VAEDecodeAudio`, and `SaveAudioAdvanced` FLAC. The
repository's prompts are already detailed, so Qwen reprompting is not needed.
10-step comparisons are exploratory. The distinct `_base` checkpoints need
different settings; do not switch to them and keep the distilled defaults.

**Caveats:** neither model nor ComfyUI is installed in this repository. Run the
first single-cue test on your own hardware and listen for noise or clipping
before queuing the full pack. A [ComfyUI issue](https://github.com/Comfy-Org/ComfyUI/issues/16087)
reports broadband noise for Small-SFX decoding on MPS/CPU in a particular
ComfyUI build, while the official inference package worked on the same machine;
this is a reported issue, not a claim about every device or Medium. If it
occurs, update ComfyUI, check precision/model compatibility, or try the
official Stable Audio inference path rather than treating static as a valid
take.

**License:** Stable Audio 3 weights use the Stability AI Community License,
not this repository's MIT license. Review the current
[model terms](https://stability.ai/license), any text-encoder terms and your
intended use before shipping. Stability's [announcement](https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models)
states that outputs may be distributed/commercialized under its applicable
license and refers organizations above $1M annual revenue to enterprise terms;
commercial registration or other conditions may apply. The game does not
include generated model weights or audio by default.
