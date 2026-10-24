#!/usr/bin/env python3
"""Queue photos/prompts.md into ComfyUI, then collect the renders into photos/.

The workflow JSONs next to this file are saved from ComfyUI's "Save (API
format)" dialog; every such json is picked up automatically, so a new graph
needs no edit here. They are used as templates: the prompt, the seed, the size
and the Save Image prefix are patched per caption, everything else (models,
sampler, prompt-refiner chain) stays exactly as exported, so a better graph can
be dropped in without touching this script.

    python3 photos/generator/comfy_queue.py --list             # 17 captions
    python3 photos/generator/comfy_queue.py                    # queue missing ones
    python3 photos/generator/comfy_queue.py --collect          # download them
    python3 photos/generator/comfy_queue.py --workflow moss --wait
    python3 photos/generator/comfy_queue.py --situation career --wait

Zero dependencies, stdlib only. Nodes are found by class_type, never by the
numeric id from the export, so re-exporting a graph does not break the script.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROMPTS_MD = REPO / 'photos' / 'prompts.md'
MANIFEST = HERE / 'queue-manifest.json'
manifest_path = MANIFEST
MANIFEST_NAME = 'queue-manifest.json'


def discover_workflows():
	"""Every API-format workflow json next to this script is a template.

	The queue manifest and any json that is not a ComfyUI "Save (API format)"
	export (a dict of nodes keyed by id, each with a class_type) are skipped.
	"""
	found = {}
	for path in sorted(HERE.glob('*.json')):
		if path.name == MANIFEST_NAME:
			continue
		try:
			graph = json.loads(path.read_text(encoding='utf-8'))
		except (OSError, ValueError):
			continue
		if not (isinstance(graph, dict) and graph and
				all(isinstance(node, dict) and 'class_type' in node
					for node in graph.values())):
			continue
		found[path.stem] = path.name
	return found


WORKFLOWS = discover_workflows()


def resolve_workflow(name):
	"""A template by its file stem, by a unique part of one, or all of them."""
	if name in ('all', 'both'):
		return list(WORKFLOWS)
	if name in WORKFLOWS:
		return [name]
	matches = [stem for stem in WORKFLOWS if name in stem]
	if len(matches) == 1:
		return matches
	known = ', '.join(WORKFLOWS) or 'none found'
	if not matches:
		raise SystemExit(f'no workflow template {name!r}; available: {known}')
	raise SystemExit(f'--workflow {name!r} matches several templates: '
		f'{", ".join(matches)}')


def default_workflow():
	"""Without --workflow: the only template, else the historical krea pick."""
	if not WORKFLOWS:
		raise SystemExit(f'no workflow templates in {HERE}; export a graph from '
			'ComfyUI with "Save (API format)" and drop the json next to this script')
	if len(WORKFLOWS) == 1:
		return next(iter(WORKFLOWS))
	krea = [stem for stem in WORKFLOWS if 'krea' in stem]
	if len(krea) == 1:
		return krea[0]
	print('several templates (' + ', '.join(WORKFLOWS) + '); picking the first, '
		'pass --workflow to choose')
	return next(iter(WORKFLOWS))

# ComfyUI ResolutionSelector labels (comfy_extras/nodes_resolution.py)
ASPECT_3_2 = '3:2 (Photo)'
# 1.5 MP at 3:2 is exactly 1536 x 1024, the size photos/README.md asks for.
MEGAPIXELS = 1.5
PROMPT_SLOT = '##prompt'
EXTS = ('.jpg', '.png')
DEFAULT_SERVER = os.environ.get('COMFYUI', 'http://127.0.0.1:8188')

CAPTION_ROW = re.compile(
	r'^###\s+\d+\s*·\s*([a-z]+)\s*·\s*(from space|landed|career)\s*→\s*`([^`]+)`\s*$')


class ComfyError(RuntimeError):
	"""A ComfyUI call failed; the message is the whole diagnosis."""


# ---------------------------------------------------------------- prompts.md

def read_prompts(path):
	"""Parse the caption pack: type, situation, target file, style, caption."""
	items = []
	current = None
	for raw in path.read_text(encoding='utf-8').splitlines():
		line = raw.strip()
		match = CAPTION_ROW.match(line)
		if match:
			type_, where, target = match.groups()
			current = {'type': type_,
				'situation': 'space' if where == 'from space' else where,
				'target': target, 'style': '', 'text': ''}
			items.append(current)
			continue
		if current is None:
			continue
		if line.startswith('## ') or line.startswith('# '):
			current = None
		elif line.startswith('*Style:'):
			current['style'] = line[7:].strip().rstrip('*').strip().rstrip('.')
		elif line.startswith('>'):
			current['text'] = (current['text'] + ' ' + line[1:].strip()).strip()
	if not items:
		raise SystemExit(f'no captions found in {path}')
	empty = [i['target'] for i in items if not i['text']]
	if empty:
		raise SystemExit(f'empty caption for {", ".join(empty)}')
	return items


def select(items, types, situation):
	want = None if types in (None, '', 'all') else {t.strip() for t in types.split(',')}
	picked = [i for i in items
		if (want is None or i['type'] in want)
		and (situation == 'both' or i['situation'] == situation)]
	if not picked:
		raise SystemExit(f'no caption matches types={types!r} situation={situation!r}')
	return picked


# ------------------------------------------------------------- workflow patch

def nodes_of(workflow, class_type):
	return [(nid, node) for nid, node in workflow.items()
		if node.get('class_type') == class_type]


def one_node(workflow, class_type):
	found = nodes_of(workflow, class_type)
	if not found:
		raise SystemExit(f'workflow has no {class_type} node')
	return found[0][1]


def prompt_slot(workflow):
	"""The multiline text node holding the '##prompt' placeholder."""
	for nid, node in nodes_of(workflow, 'PrimitiveStringMultiline'):
		if PROMPT_SLOT in str(node['inputs'].get('value', '')):
			return nid
	raise SystemExit(f'workflow has no text node containing {PROMPT_SLOT!r}')


def refine_slot(workflow):
	"""The bool that decides whether the graph rewrites the caption before use.

	MOSS exports the decision as a literal `switch` on an If/Else node whose
	true branch is the TextGenerate refiner; Krea exports it as a PrimitiveBoolean
	titled "Refine Prompt?". Return (node_id, input_name) for whichever exists.
	"""
	for nid, node in nodes_of(workflow, 'ComfySwitchNode'):
		flag = node['inputs'].get('switch')
		if not isinstance(flag, bool):
			continue
		source = node['inputs'].get('on_true') or []
		target = workflow.get(str(source[0]) if source else '')
		if target and target.get('class_type') == 'TextGenerate':
			return nid, 'switch'
	for nid, node in nodes_of(workflow, 'PrimitiveBoolean'):
		title = node.get('_meta', {}).get('title', '').lower()
		if 'refine' in title:
			return nid, 'value'
	return None, None


def sampler_node(workflow):
	return one_node(workflow, 'KSampler')


def negative_slot(workflow):
	"""The CLIPTextEncode wired into KSampler.negative, if it takes raw text."""
	link = sampler_node(workflow)['inputs'].get('negative') or []
	node = workflow.get(str(link[0]) if link else '')
	if node and node.get('class_type') == 'CLIPTextEncode':
		if isinstance(node['inputs'].get('text'), str):
			return node
	return None


def latent_node(workflow):
	for class_type in ('EmptyLatentImage', 'EmptyFlux2LatentImage'):
		found = nodes_of(workflow, class_type)
		if found:
			return found[0][1]
	return None


def apply_override(workflow, spec):
	"""--set NODE.INPUT=VALUE, e.g. --set 30:3.steps=8 or 30:24.value=false."""
	target, sep, raw = spec.partition('=')
	node_id, _, name = target.partition('.')
	if not sep or not name:
		raise SystemExit(f'bad --set {spec!r}, expected NODE.INPUT=VALUE')
	if node_id not in workflow:
		raise SystemExit(f'--set {spec!r}: workflow has no node {node_id!r}')
	if name not in workflow[node_id]['inputs']:
		raise SystemExit(f'--set {spec!r}: node {node_id} has no input {name!r}')
	try:
		value = json.loads(raw)
	except json.JSONDecodeError:
		value = raw
	workflow[node_id]['inputs'][name] = value


def build(workflow_path, job, args):
	"""Load the template and patch one job into it."""
	workflow = json.loads(workflow_path.read_text(encoding='utf-8'))

	workflow[prompt_slot(workflow)]['inputs']['value'] = job['text']

	sampler = sampler_node(workflow)['inputs']
	if job['seed'] is not None:
		sampler['seed'] = job['seed']
	if args.steps is not None:
		sampler['steps'] = args.steps
	if args.cfg is not None:
		sampler['cfg'] = args.cfg

	if args.no_refine:
		node_id, name = refine_slot(workflow)
		if node_id is None:
			raise SystemExit('workflow has no prompt-refine switch to turn off')
		workflow[node_id]['inputs'][name] = False

	negative = negative_slot(workflow)
	if negative is not None and args.negative is not None:
		negative['inputs']['text'] = args.negative

	resolution = nodes_of(workflow, 'ResolutionSelector')
	if resolution and args.size is None:
		inputs = resolution[0][1]['inputs']
		inputs['aspect_ratio'] = args.aspect
		inputs['megapixels'] = args.megapixels

	latent = latent_node(workflow)
	if latent is not None and args.size is not None:
		width, height = args.size
		latent['inputs']['width'] = width
		latent['inputs']['height'] = height

	stem = Path(job['target']).stem
	one_node(workflow, 'SaveImage')['inputs']['filename_prefix'] = \
		f'gravity/{job["situation"]}/{stem}'

	for spec in args.set or ():
		apply_override(workflow, spec)
	return workflow


# ------------------------------------------------------------------ comfy api

def request(url, payload=None, timeout=60):
	data = None if payload is None else json.dumps(payload).encode('utf-8')
	req = urllib.request.Request(url, data=data,
		headers={'Content-Type': 'application/json'} if data else {})
	try:
		with urllib.request.urlopen(req, timeout=timeout) as reply:
			return reply.read()
	except urllib.error.HTTPError as err:
		body = err.read().decode('utf-8', 'replace')
		try:
			detail = json.loads(body)
		except json.JSONDecodeError:
			detail = body
		shown = json.dumps(detail, indent=2) if not isinstance(detail, str) else detail
		raise ComfyError(f'{url} failed: HTTP {err.code}\n{shown}')
	except urllib.error.URLError as err:
		raise ComfyError(f'cannot reach ComfyUI at {url}: {err.reason}\n'
			'start ComfyUI or pass --server http://host:port')


def job_extra_data(job, args):
	"""The metadata the web UI attaches to a prompt, which queue nodes read.

	Queue Manager (before 2026-10) dereferences
	extra_data.extra_pnginfo.workflow.workflow_name for every dequeued item, so
	an API job without it raises KeyError inside the prompt worker and aborts
	ComfyUI. `workflow_name` is what its queue list shows per job, `id` groups
	the runs of one template (recent ComfyUI also reports it as workflow_id).
	"""
	if args.no_extra_data:
		return None
	stem = Path(job['target']).stem
	return {'extra_pnginfo': {'workflow': {
		'workflow_name': f'gravity · {job["workflow"]} · {job["situation"]}/{stem}',
		'id': f'gravity-{job["workflow"]}',
	}}}


def queue_job(server, workflow, client_id, extra_data):
	payload = {'prompt': workflow, 'client_id': client_id}
	if extra_data is not None:
		payload['extra_data'] = extra_data
	reply = json.loads(request(f'{server}/prompt', payload))
	return reply['prompt_id']


def history(server, prompt_id):
	"""Finished entries only; empty while queued or running."""
	raw = request(f'{server}/history/{urllib.parse.quote(prompt_id)}', timeout=30)
	return json.loads(raw).get(prompt_id) or {}


def save_outputs(server, entry, target):
	written = []
	for node_output in (entry.get('outputs') or {}).values():
		for image in node_output.get('images') or ():
			query = urllib.parse.urlencode({
				'filename': image['filename'],
				'subfolder': image.get('subfolder', ''),
				'type': image.get('type', 'output'),
			})
			blob = request(f'{server}/view?{query}', timeout=120)
			path = resolve(target).with_suffix(Path(image['filename']).suffix or '.png')
			path.parent.mkdir(parents=True, exist_ok=True)
			path.write_bytes(blob)
			written.append(path)
	return written


# --------------------------------------------------------------------- jobs

def target_path(job, out_dir):
	"""photos/space/rock.jpg -> <out>/space/rock[-N].jpg (also career/), matching photo_deck.js."""
	named = Path(job['target'])
	stem = named.stem
	if job['variant']:
		stem = f'{stem}-{job["variant"] + 1}'
	return Path(out_dir) / named.parent.name / f'{stem}{named.suffix}'


def resolve(target):
	"""Targets are stored repo-relative so a manifest survives a moved checkout."""
	path = Path(target)
	return path if path.is_absolute() else REPO / path


def display(path):
	path = Path(path)
	return str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path)


def existing(target):
	stem = resolve(target).with_suffix('')
	return [p for p in (stem.with_suffix(ext) for ext in EXTS) if p.exists()]


def make_jobs(items, args, workflows):
	jobs = []
	for workflow in workflows:
		for item in items:
			# career cards have one scene key each; photo_deck.js reads no variants
			pictures = 1 if item['situation'] == 'career' else args.variants
			for variant in range(pictures):
				job = dict(item)
				job['workflow'] = workflow
				job['variant'] = variant
				job['target'] = display(target_path(job, args.out))
				# one deterministic seed per job so a rerun reproduces the same
				# picture; without --seed the template's own seed is reused
				job['seed'] = None if args.seed is None else args.seed + len(jobs)
				jobs.append(job)
	return jobs


def load_manifest():
	if manifest_path.exists():
		try:
			return json.loads(manifest_path.read_text(encoding='utf-8'))
		except json.JSONDecodeError:
			pass
	return {'jobs': []}


def write_manifest(manifest):
	manifest_path.write_text(json.dumps(manifest, indent='\t') + '\n', encoding='utf-8')


def print_table(items):
	print(f'{"type":8} {"situation":10} {"style":34} target')
	for item in items:
		print(f'{item["type"]:8} {item["situation"]:10} {item["style"][:34]:34} {item["target"]}')
	print(f'{len(items)} captions')


# --------------------------------------------------------------------- main

def collect(server, manifest, timeout, only_targets=None):
	"""Poll finished jobs in the manifest and download their images."""
	pending = [j for j in manifest['jobs']
		if not j.get('done') and (only_targets is None or j['target'] in only_targets)]
	if not pending:
		print('nothing to collect')
		return True
	print(f'collecting {len(pending)} job(s) ...')
	deadline = time.time() + timeout
	missing = set(j['prompt_id'] for j in pending)
	while missing and time.time() < deadline:
		for prompt_id in list(missing):
			try:
				entry = history(server, prompt_id)
			except ComfyError as err:
				raise ComfyError(f'{err}\n\nComfyUI stopped answering while jobs were '
					'pending. If its log ends with KeyError: \'extra_pnginfo\' inside '
					'a prompt_worker thread, an old Queue Manager build crashed on a job '
					'without extra_data. This script sends it by default, so check that '
					'--no-extra-data is not set, restart ComfyUI and run --collect again.')
			if not entry:
				continue
			job = next(j for j in pending if j['prompt_id'] == prompt_id)
			status = (entry.get('status') or {}).get('status_str', '')
			if status == 'error':
				print(f'  ! {job["target"]}: {job["workflow"]} run failed server-side')
			else:
				for path in save_outputs(server, entry, job['target']):
					print(f'  + {display(path)}')
				job['done'] = True
			missing.discard(prompt_id)
			write_manifest(manifest)
		if missing:
			time.sleep(1)
	if missing:
		print(f'{len(missing)} job(s) still queued after {timeout:.0f}s; '
			f'run --collect again once ComfyUI finishes them')
		return False
	return True


def queue(server, jobs, args, client_id):
	manifest = load_manifest()
	queued = 0
	claimed = {}
	for job in jobs:
		claimed.setdefault(job['target'], set()).add(job['workflow'])
	clashes = {t: w for t, w in claimed.items() if len(w) > 1}
	for target, owners in sorted(clashes.items()):
		print(f'  ! {target} is rendered by {" + ".join(sorted(owners))}; '
			f'the last finished render wins (use --out to keep both sets)')
	for job in jobs:
		have = existing(job['target'])
		if have and not args.force:
			print(f'  = {display(have[0])} exists (use --force to redo)')
			continue
		template = WORKFLOWS.get(job['workflow'])
		if template is None:
			raise SystemExit(f'workflow template {job["workflow"]!r} is gone; '
				f'available: {", ".join(WORKFLOWS) or "(none)"}')
		workflow = build(HERE / template, job, args)
		if args.dump:
			dump = Path(args.dump) / f'{job["workflow"]}_{Path(job["target"]).stem}.json'
			dump.parent.mkdir(parents=True, exist_ok=True)
			dump.write_text(json.dumps(workflow, indent='\t') + '\n', encoding='utf-8')
		if args.dry_run:
			print(f'  · {job["workflow"]} {display(resolve(job["target"]))} '
				f'seed={job["seed"] if job["seed"] is not None else "template"}')
			continue
		prompt_id = queue_job(server, workflow, client_id, job_extra_data(job, args))
		key = f'{job["workflow"]}:{job["target"]}'
		manifest['jobs'] = [j for j in manifest['jobs'] if j.get('key') != key]
		manifest['jobs'].append({
			'key': key,
			'prompt_id': prompt_id, 'target': job['target'], 'type': job['type'],
			'situation': job['situation'], 'variant': job['variant'],
			'workflow': job['workflow'], 'seed': job['seed'],
			'queued': time.strftime('%Y-%m-%d %H:%M:%S'), 'done': False,
		})
		queued += 1
		print(f'  + queue {display(resolve(job["target"]))} ({job["workflow"]}, {prompt_id[:8]})')
	if not args.dry_run:
		write_manifest(manifest)
	return manifest, queued


def parse_size(text):
	match = re.fullmatch(r'\s*(\d+)\s*[x×]\s*(\d+)\s*', text)
	if not match:
		raise SystemExit(f'bad --size {text!r}, expected WIDTHxHEIGHT')
	return int(match.group(1)), int(match.group(2))


def main(argv=None):
	parser = argparse.ArgumentParser(
		description='Queue photos/prompts.md into ComfyUI and collect the renders.',
		formatter_class=argparse.RawDescriptionHelpFormatter,
		epilog='examples:\n'
			'  comfy_queue.py --list\n'
			'  comfy_queue.py --workflow all --variants 2 --wait\n'
			'  comfy_queue.py --types gas,ice --situation landed --force\n'
			'  comfy_queue.py --set 30:3.steps=6 --set 30:24.value=false\n')
	parser.add_argument('--server', default=DEFAULT_SERVER,
		help=f'ComfyUI base url (default {DEFAULT_SERVER}, env COMFYUI)')
	parser.add_argument('--workflow', default=None, metavar='NAME',
		help='template to use: its json file stem, a unique part of one, or all '
			'(default: the only template, else the krea one)')
	parser.add_argument('--types', default='all',
		help='comma list of rock,terran,super,dwarf,mini,gas,ice or catapult,delivery,sport (default all)')
	parser.add_argument('--situation', choices=['space', 'landed', 'career', 'both'], default='both')
	parser.add_argument('--variants', type=int, default=1,
		help='pictures per caption; extra ones are saved as <type>-2, <type>-3')
	parser.add_argument('--seed', type=int, default=None,
		help='base seed; without it the seed stored in the template is reused')
	parser.add_argument('--steps', type=int, default=None, help='override KSampler steps')
	parser.add_argument('--cfg', type=float, default=None, help='override KSampler cfg')
	parser.add_argument('--aspect', default=ASPECT_3_2,
		help=f'ResolutionSelector aspect_ratio (default {ASPECT_3_2!r})')
	parser.add_argument('--megapixels', type=float, default=MEGAPIXELS)
	parser.add_argument('--size', type=parse_size, default=None,
		help='exact WxH, bypassing the ResolutionSelector (e.g. 1536x1024)')
	parser.add_argument('--negative', default=None, help='replace the negative prompt text')
	parser.add_argument('--no-refine', action='store_true',
		help='send the caption verbatim, skipping the graph\'s prompt refiner')
	parser.add_argument('--out', default=str(REPO / 'photos'),
		help='where photos/space and photos/landed live (default photos/)')
	parser.add_argument('--force', action='store_true', help='redo captions that already have art')
	parser.add_argument('--no-extra-data', action='store_true',
		help='omit extra_data.extra_pnginfo; only for servers without a queue custom node')
	parser.add_argument('--dry-run', action='store_true', help='print the jobs, queue nothing')
	parser.add_argument('--dump', default=None, metavar='DIR',
		help='write each patched workflow to DIR for inspection')
	parser.add_argument('--wait', action='store_true', help='download the images as they finish')
	parser.add_argument('--timeout', type=float, default=1800,
		help='seconds to wait for renders with --wait/--collect (default 1800)')
	parser.add_argument('--collect', action='store_true',
		help='only download jobs recorded in the manifest')
	parser.add_argument('--manifest', default=str(MANIFEST))
	parser.add_argument('--list', action='store_true', help='print the caption pack and exit')
	parser.add_argument('--set', action='append', default=[], metavar='NODE.INPUT=VALUE',
		help='raw patch of the template, repeatable')
	args = parser.parse_args(argv)
	if args.variants < 1:
		parser.error('--variants must be at least 1')
	if args.variants > 3:
		parser.error('--variants is capped at 3: photo_deck.js only looks for '
			'<type>, <type>-2 and <type>-3')

	global manifest_path
	manifest_path = Path(args.manifest)

	items = read_prompts(PROMPTS_MD)
	if args.list:
		print_table(items)
		return 0

	if args.collect:
		try:
			return 0 if collect(args.server, load_manifest(), args.timeout) else 1
		except ComfyError as err:
			raise SystemExit(str(err))

	workflows = resolve_workflow(args.workflow if args.workflow is not None
		else default_workflow())
	for workflow in workflows:
		for spec in args.set:
			apply_override(json.loads((HERE / WORKFLOWS[workflow]).read_text(encoding='utf-8')), spec)

	jobs = make_jobs(select(items, args.types, args.situation), args, workflows)
	print(f'{len(jobs)} job(s): {", ".join(workflows)} · {args.aspect} · '
		f'{args.megapixels} MP{"" if args.size is None else f" · {args.size[0]}x{args.size[1]}"}'
		f'{" · dry run" if args.dry_run else ""}')
	try:
		manifest, queued = queue(args.server, jobs, args, uuid.uuid4().hex)
	except ComfyError as err:
		raise SystemExit(str(err))
	if args.dry_run:
		return 0
	print(f'queued {queued}')
	if args.wait and queued:
		try:
			return 0 if collect(args.server, manifest, args.timeout) else 1
		except ComfyError as err:
			raise SystemExit(str(err))
	if queued:
		print('watch them in the ComfyUI queue; run --collect when done to download')
	return 0


if __name__ == '__main__':
	sys.exit(main())
