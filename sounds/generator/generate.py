#!/usr/bin/env python3
"""Queue and audition the launch sound pack through a local ComfyUI server."""

import argparse
import array
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / 'photos' / 'generator'))
import comfy_queue as comfy  # shared ComfyUI HTTP client and queue metadata convention

PROMPTS = HERE / 'prompts.json'
WORKFLOW = HERE / 'stable_audio_3_medium_api.json'
MANIFEST = HERE / 'queue-manifest.json'
OUTPUT = REPO / 'sounds' / 'generated'
SELECTED = REPO / 'sounds' / 'selected'
CUES = ('aim', 'armed', 'launch', 'fly')


def display(path):
	path = Path(path).resolve()
	return str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path)


def resolve(path):
	path = Path(path)
	return path if path.is_absolute() else REPO / path


def read_json(path):
	return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, data):
	path = Path(path)
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_suffix(path.suffix + '.tmp')
	tmp.write_text(json.dumps(data, indent='\t', ensure_ascii=False) + '\n', encoding='utf-8')
	tmp.replace(path)


def nodes(graph, class_type):
	found = [node for node in graph.values() if node.get('class_type') == class_type]
	if len(found) != 1:
		raise ValueError(f'workflow needs exactly one {class_type}, found {len(found)}')
	return found[0]['inputs']


def build_graph(template, job):
	graph = json.loads(json.dumps(template))
	nodes(graph, 'CheckpointLoaderSimple')['ckpt_name'] = job['checkpoint']
	latent = nodes(graph, 'EmptyLatentAudio')
	latent['seconds'] = job['seconds']
	latent['batch_size'] = 1
	sampler = nodes(graph, 'KSampler')
	# Positive and negative encoders have the same class: follow the sampler's link.
	positive = graph[str(sampler['positive'][0])]
	if positive.get('class_type') != 'CLIPTextEncode':
		raise ValueError('KSampler positive must link directly to CLIPTextEncode')
	positive['inputs']['text'] = job['text']
	sampler.update(seed=job['seed'], steps=job['steps'], cfg=job['cfg'],
		sampler_name=job['sampler'], scheduler=job['scheduler'])
	save = nodes(graph, 'SaveAudioAdvanced')
	save['filename_prefix'] = 'gravity-sounds/' + job['cue'] + '/' + job['stem']
	save['format'] = 'flac'
	return graph


def load_manifest(path):
	if not path.exists():
		return {'version': 1, 'jobs': []}
	manifest = read_json(path)
	if manifest.get('version') != 1 or not isinstance(manifest.get('jobs'), list):
		raise ValueError(f'invalid sound manifest: {path}')
	return manifest


def model_slug(checkpoint):
	return Path(checkpoint).stem.replace('stable_audio_3_', '').replace(' ', '_')


def make_jobs(pack, args):
	jobs = []
	selected = set(args.cue.split(',')) if args.cue else set(CUES)
	unknown = selected.difference(CUES)
	if unknown:
		raise ValueError('unknown cue(s): ' + ', '.join(sorted(unknown)))
	# Index is tied to the complete pack, not the filter, so --cue reproduces seeds.
	index = 0
	for cue in CUES:
		for prompt in pack[cue]:
			for take in range(args.takes):
				seed = args.seed + index * 100 + take
				steps = args.steps if args.steps is not None else prompt['steps']
				seconds = args.seconds if args.seconds is not None else prompt['seconds']
				settings = re.sub(r'[^a-zA-Z0-9_-]+', '_', f'c{args.cfg:g}-{args.sampler}-{args.scheduler}')
				stem = f'{prompt["id"]}-s{seed}-t{steps}-d{seconds:g}-{settings}'
				text = re.sub(r'Length: [0-9.]+ seconds?', f'Length: {seconds:g} seconds', prompt['text'])
				if cue in selected:
					path = args.out / model_slug(args.checkpoint) / cue / (stem + '.flac')
					jobs.append({
						'cue': cue, 'variant': prompt['id'], 'text': text,
						'seconds': seconds, 'seed': seed, 'steps': steps,
						'cfg': args.cfg, 'sampler': args.sampler, 'scheduler': args.scheduler,
						'checkpoint': args.checkpoint, 'stem': stem, 'target': display(path),
					})
			index += 1
	return jobs


def list_pack(pack):
	for cue in CUES:
		print(f'\n{cue}:')
		for p in pack[cue]:
			print(f'  {p["id"]:18} {p["seconds"]:g}s  {p["steps"]} steps  {p["text"]}')


def extra_data(job):
	return {'extra_pnginfo': {'workflow': {
		'workflow_name': f'gravity sounds · {job["cue"]} · {job["stem"]}',
		'id': 'gravity-stable-audio-3',
	}}}


def queue_jobs(jobs, args):
	manifest = load_manifest(args.manifest)
	template = read_json(args.workflow)
	client_id = str(uuid.uuid4())
	queued = 0
	for job in jobs:
		graph = build_graph(template, job)
		if args.dump:
			path = args.dump / job['cue'] / (job['stem'] + '.json')
			write_json(path, graph)
		if args.dry_run:
			print(f'  · {job["target"]}  {job["seconds"]:g}s · seed {job["seed"]} · {job["steps"]} steps')
			continue
		key = job['target']
		prior = next((j for j in manifest['jobs'] if j['target'] == key), None)
		if not args.force and resolve(key).exists():
			print(f'  = {key} exists')
			continue
		if not args.force and prior and prior.get('status') == 'queued':
			print(f'  = {key} already queued ({prior["prompt_id"][:8]})')
			continue
		prompt_id = comfy.queue_job(args.server, graph, client_id, extra_data(job))
		entry = dict(job, prompt_id=prompt_id, server=args.server,
			status='queued', queued=time.strftime('%Y-%m-%d %H:%M:%S'))
		manifest['jobs'] = [j for j in manifest['jobs'] if j['target'] != key]
		manifest['jobs'].append(entry)
		# Persist every accepted prompt, even if the next request or the process fails.
		write_json(args.manifest, manifest)
		queued += 1
		print(f'  + {key} ({prompt_id[:8]})')
	return manifest, queued


def audio_output(entry):
	outputs = []
	for node in (entry.get('outputs') or {}).values():
		outputs.extend(node.get('audio') or ())
	if len(outputs) != 1:
		raise ValueError(f'expected exactly one saved audio file, got {len(outputs)}')
	return outputs[0]


def download(server, entry, job):
	item = audio_output(entry)
	filename = item['filename']
	if Path(filename).suffix.lower() != '.flac':
		raise ValueError(f'expected FLAC from SaveAudioAdvanced, got {filename}')
	query = urllib.parse.urlencode({'filename': filename,
		'subfolder': item.get('subfolder', ''), 'type': item.get('type', 'output')})
	blob = comfy.request(f'{server}/view?{query}', timeout=120)
	if not blob.startswith(b'fLaC'):
		raise ValueError(f'ComfyUI returned invalid FLAC for {job["target"]}')
	path = resolve(job['target'])
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_suffix('.flac.tmp')
	tmp.write_bytes(blob)
	tmp.replace(path)


def audition_page(manifest, out):
	out = out.resolve()
	rows = []
	for job in manifest['jobs']:
		path = resolve(job['target']).resolve()
		if job.get('status') != 'done' or not path.exists() or not path.is_relative_to(out):
			continue
		rel = urllib.parse.quote(path.relative_to(out).as_posix())
		cmd = f'python3 sounds/generator/generate.py --select {job["cue"]}="{display(path)}"'
		meta = f'{job["cue"]} · {job["variant"]} · seed {job["seed"]} · {job["seconds"]:g}s · {job["steps"]} steps · {job["checkpoint"]}'
		rows.append(f'<article><h2>{html.escape(meta)}</h2><audio controls preload="none" src="{rel}"></audio>'
			f'<p>{html.escape(job["text"])}</p><code>{html.escape(cmd)}</code></article>')
	out.mkdir(parents=True, exist_ok=True)
	page = out / 'audition.html'
	page.write_text('<!doctype html><html lang="en"><meta charset="utf-8">'
		'<meta name="viewport" content="width=device-width,initial-scale=1">'
		'<title>Gravity launch sound takes</title><style>'
		'body{font:16px system-ui;background:#111922;color:#e1eee8;max-width:900px;margin:2rem auto;padding:0 1rem}'
		'h1{font-size:1.7rem}h2{font-size:1rem;color:#9ee8c0}article{border:1px solid #36534d;'
		'border-radius:10px;padding:1rem;margin:1rem 0}audio{width:min(100%,600px)}'
		'code{display:block;overflow-wrap:anywhere;color:#ffe0a2}</style>'
		'<h1>Gravity launch sound takes</h1><p>Listen, then run the command under a take to install it in the game. '
		'FLAC playback depends on your browser; the original files are lossless.</p>' +
		''.join(rows) + '</html>', encoding='utf-8')
	print(f'  audition: {display(page)} ({len(rows)} takes)')


def collect(args, manifest):
	pending = [j for j in manifest['jobs'] if j.get('status') == 'queued']
	deadline = time.monotonic() + args.timeout
	failed = sum(1 for job in manifest['jobs'] if job.get('status') == 'error')
	if failed:
		print(f'  {failed} previous job(s) failed; use --force to requeue them', file=sys.stderr)
	while pending:
		for job in pending[:]:
			server = args.collect_server or job['server']
			entry = comfy.history(server, job['prompt_id'])
			if not entry:
				continue
			status = (entry.get('status') or {}).get('status_str', '')
			try:
				if status == 'error':
					detail = (entry.get('status') or {}).get('messages', [])
					raise ValueError('ComfyUI execution failed: ' + str(detail))
				download(server, entry, job)
			except (ValueError, KeyError) as err:
				job['status'] = 'error'
				job['error'] = str(err)
				failed += 1
				print(f'  ! {job["target"]}: {err}', file=sys.stderr)
			else:
				job['status'] = 'done'
				print(f'  + {job["target"]}')
			pending.remove(job)
			write_json(args.manifest, manifest)
		if not args.wait or not pending or time.monotonic() >= deadline:
			break
		time.sleep(1)
	audition_page(manifest, args.out)
	if pending:
		print(f'  {len(pending)} still pending; run --collect again (or --collect --wait)')
	return not failed and (not args.wait or not pending)


def transform_wav(source, dest, cue, crossfade_ms):
	with wave.open(str(source), 'rb') as wav:
		channels, rate, width = wav.getnchannels(), wav.getframerate(), wav.getsampwidth()
		if channels != 2 or rate != 44100 or width != 2:
			raise ValueError('expected 44.1 kHz stereo 16-bit PCM from ffmpeg')
		frames = wav.getnframes()
		data = array.array('h')
		data.frombytes(wav.readframes(frames))
	if sys.byteorder != 'little':
		data.byteswap()
	if frames < rate // 4:
		raise ValueError('sound is too short to install (minimum 0.25 seconds)')
	peak = max(abs(v) for v in data)
	if peak == 0:
		raise ValueError('sound is silent')
	gain = min(1.5, 0.75 * 32767 / peak)
	if cue in ('aim', 'armed'):
		overlap = min(round(rate * crossfade_ms / 1000), frames // 4)
		if overlap > 1:
			# Play the middle first, then blend the tail into the head. The last
			# blended sample meets the first middle sample at the loop boundary.
			out = array.array('h', data[overlap * channels:(frames - overlap) * channels])
			for i in range(overlap):
				w = i / (overlap - 1)
				for ch in range(channels):
					v = data[(frames - overlap + i) * channels + ch] * (1 - w) + data[i * channels + ch] * w
					out.append(round(v))
			data = out
			frames -= overlap
	fade = min(frames, round(rate * (1.5 if cue == 'fly' else 0.04))) if cue in ('fly', 'launch') else 0
	for i in range(len(data)):
		factor = gain
		if fade and i // channels >= frames - fade:
			factor *= (frames - 1 - i // channels) / max(1, fade - 1)
		data[i] = max(-32768, min(32767, round(data[i] * factor)))
	if sys.byteorder != 'little':
		data.byteswap()
	dest.parent.mkdir(parents=True, exist_ok=True)
	with wave.open(str(dest), 'wb') as wav:
		wav.setnchannels(channels)
		wav.setsampwidth(width)
		wav.setframerate(rate)
		wav.writeframes(data.tobytes())


def select_takes(args):
	ffmpeg = shutil.which('ffmpeg')
	if not ffmpeg:
		raise ValueError('selection needs ffmpeg on PATH to decode FLAC to browser-friendly WAV')
	selections = []
	for spec in args.select:
		cue, separator, name = spec.partition('=')
		if not separator or cue not in CUES or not name:
			raise ValueError(f'bad --select {spec!r}; use aim|armed|launch|fly=PATH')
		source = Path(name).expanduser().resolve()
		if not source.is_file():
			raise ValueError(f'no sound file: {source}')
		selections.append((cue, source))
	if len({cue for cue, _ in selections}) != len(selections):
		raise ValueError('select each cue at most once per command')
	with tempfile.TemporaryDirectory() as temporary:
		prepared = []
		for cue, source in selections:
			wav = Path(temporary) / (cue + '-decoded.wav')
			output = Path(temporary) / (cue + '.wav')
			cmd = [ffmpeg, '-v', 'error', '-y', '-ss', str(args.start), '-i', str(source)]
			cap = 4.2 if cue == 'launch' else 10 if cue == 'fly' else None
			length = args.length
			if cap is not None:
				length = min(length, cap) if length is not None else cap
			if length is not None:
				cmd += ['-t', str(length)]
			cmd += ['-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', str(wav)]
			subprocess.run(cmd, check=True)
			transform_wav(wav, output, cue, args.crossfade_ms)
			prepared.append((cue, output))
		args.selected_dir.mkdir(parents=True, exist_ok=True)
		for cue, output in prepared:
			shutil.copyfile(output, args.selected_dir / (cue + '.wav'))
			print(f'  + {display(args.selected_dir / (cue + ".wav"))}')
	# The browser never probes absent files, and can still play the remaining synth cues.
	mapping = {cue: 'sounds/selected/' + cue + '.wav' for cue in CUES
		if (args.selected_dir / (cue + '.wav')).is_file()}
	pack = '/* Rewritten by sounds/generator/generate.py --select; missing cues use the synth. */\n'
	pack += '(function (root) {\n\troot.GravitySoundFiles = ' + json.dumps(mapping, indent='\t') + ';\n'
	pack += "})(typeof window !== 'undefined' ? window : globalThis);\n"
	(args.selected_dir / 'pack.js').write_text(pack, encoding='utf-8')
	print('  reload the game to hear the selected takes')


def main(argv=None):
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument('--list', action='store_true', help='print all prompts and settings')
	parser.add_argument('--cue', help='comma-separated aim,armed,launch,fly (default all)')
	parser.add_argument('--takes', type=int, default=2, help='seeds per prompt (default 2)')
	parser.add_argument('--seed', type=int, default=4100, help='reproducible base seed')
	parser.add_argument('--server', default=None, help='ComfyUI URL (default COMFYUI env or http://127.0.0.1:8188)')
	parser.add_argument('--workflow', type=Path, default=WORKFLOW, help='ComfyUI API graph')
	parser.add_argument('--checkpoint', default='stable_audio_3_medium.safetensors')
	parser.add_argument('--steps', type=int, help='override prompt-pack sampler steps')
	parser.add_argument('--seconds', type=float, help='override duration for every selected prompt')
	parser.add_argument('--cfg', type=float, default=1.0)
	parser.add_argument('--sampler', default='lcm')
	parser.add_argument('--scheduler', default='simple')
	parser.add_argument('--out', type=Path, default=OUTPUT)
	parser.add_argument('--manifest', type=Path, default=MANIFEST)
	parser.add_argument('--dump', type=Path, help='write patched API graphs for inspection')
	parser.add_argument('--dry-run', action='store_true', help='print jobs without contacting ComfyUI')
	parser.add_argument('--collect', action='store_true', help='collect queued jobs without submitting new ones')
	parser.add_argument('--wait', action='store_true', help='poll until the queued jobs finish')
	parser.add_argument('--timeout', type=float, default=600, help='maximum wait in seconds')
	parser.add_argument('--force', action='store_true', help='requeue existing or failed takes')
	parser.add_argument('--select', action='append', metavar='CUE=PATH', help='install an auditioned take; may repeat')
	parser.add_argument('--start', type=float, default=0, help='selection: crop start in seconds')
	parser.add_argument('--length', type=float, help='selection: crop length in seconds')
	parser.add_argument('--crossfade-ms', type=float, default=250, help='selection: loop crossfade in milliseconds')
	parser.add_argument('--selected-dir', type=Path, default=SELECTED, help=argparse.SUPPRESS)
	args = parser.parse_args(argv)
	if args.takes < 1 or args.seed < 0 or (args.steps is not None and args.steps < 1):
		parser.error('--takes and --steps must be positive, --seed nonnegative')
	if args.seconds is not None and not 1 <= args.seconds <= 380:
		parser.error('--seconds must be 1–380')
	if not math.isfinite(args.cfg) or args.cfg < 0:
		parser.error('--cfg must be finite and nonnegative')
	if args.timeout <= 0 or args.start < 0 or args.crossfade_ms < 0 or (args.length is not None and args.length <= 0):
		parser.error('timeout/length must be positive and start/crossfade nonnegative')
	args.collect_server = args.server.rstrip('/') if args.server else None
	args.server = (args.server or os.environ.get('COMFYUI', 'http://127.0.0.1:8188')).rstrip('/')
	try:
		if args.select:
			select_takes(args)
			return 0
		pack = read_json(PROMPTS)
		if args.list:
			list_pack(pack)
			return 0
		if args.collect:
			return 0 if collect(args, load_manifest(args.manifest)) else 1
		jobs = make_jobs(pack, args)
		print(f'{len(jobs)} takes · {args.checkpoint} · {"dry run" if args.dry_run else args.server}')
		manifest, _ = queue_jobs(jobs, args)
		if args.wait and not args.dry_run:
			return 0 if collect(args, manifest) else 1
		return 0
	except (comfy.ComfyError, ValueError, OSError, subprocess.CalledProcessError, KeyError) as err:
		print(f'error: {err}', file=sys.stderr)
		return 1


if __name__ == '__main__':
	sys.exit(main())
