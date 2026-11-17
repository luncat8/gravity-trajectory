#!/usr/bin/env python3
"""Project-aware gallery adapter over the shared ComfyUI queue engine."""
import argparse
import json
import re
import random
import sys
import urllib.parse
import uuid
from pathlib import Path
from types import SimpleNamespace

sys.dont_write_bytecode = True

import comfy_queue as core

HERE = Path(__file__).resolve().parent
cli = argparse.ArgumentParser(add_help=False)
cli.add_argument('--project', default=str(HERE / 'gravity.json'))
selection, _ = cli.parse_known_args()
PROJECT_PATH = Path(selection.project).resolve()
CONFIG, BASE = core.load_project(PROJECT_PATH)
OUTPUT_DIR = BASE / CONFIG.get('gallery_output', CONFIG['output'])
STATE_PATH = OUTPUT_DIR / 'state.toml'
DEFAULT_SERVER = core.DEFAULT_SERVER
DEFAULT_NEGATIVE = ''
http = core.request
get_history = core.history
nodes_of = core.nodes_of

def _mini_toml(text):
	line_re = re.compile(
		r'^\s*(?:\[(?P<section>[^\]]+)\]'
		r'|(?P<key>"(?:[^"\\]|\\.)*")\s*=\s*'
		r'(?P<val>true|false|-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*")'
		r')\s*(?:#.*)?$'
	)
	state, section = {}, None
	for line in text.splitlines():
		m = line_re.match(line)
		if not m:
			continue
		if m.group("section"):
			section = state.setdefault(m.group("section"), {})
			continue
		if section is None:
			continue
		raw = m.group("val")
		if raw == "true":
			val = True
		elif raw == "false":
			val = False
		elif raw.startswith('"'):
			val = json.loads(raw)
		else:
			val = float(raw) if "." in raw else int(raw)
		section[json.loads(m.group("key"))] = val
	return state


def load_state(path=STATE_PATH):
	"""Read state.toml -> dict of sections. {} if missing or unreadable."""
	path = Path(path)
	if not path.exists():
		return {}
	text = path.read_text(encoding="utf-8")
	try:
		import tomllib
	except ImportError:
		return _mini_toml(text)
	try:
		return tomllib.loads(text)
	except Exception:
		return {}


def save_state(state, path=STATE_PATH):
	"""Write checkbox state as TOML (kept to the subset _mini_toml reads)."""
	Path(path).parent.mkdir(parents=True, exist_ok=True)
	lines = []
	for section in ("app", "prompts", "workflows", "jobs"):
		sec = state.get(section) or {}
		if not sec:
			continue
		lines.append(f"[{section}]")
		for key, val in sorted((str(k), v) for k, v in sec.items()):
			if isinstance(val, bool):
				shown = "true" if val else "false"
			elif isinstance(val, str):
				shown = json.dumps(val, ensure_ascii=False)
			elif isinstance(val, int):
				shown = str(val)
			elif isinstance(val, float):
				shown = repr(val)
				if "e" in shown or "E" in shown:
					shown = f"{val:.12f}".rstrip("0").rstrip(".")
			else:
				continue
			lines.append(f"{json.dumps(key, ensure_ascii=False)} = {shown}")
		lines.append("")
	Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def slg_slot(workflow):
	"""The ComfySwitchNode whose on_true feeds SkipLayerGuidanceDiTSimple.

	Returns (node_id, input_name) or (None, None).
	"""
	for nid, node in nodes_of(workflow, "ComfySwitchNode"):
		source = node["inputs"].get("on_true") or []
		target = workflow.get(str(source[0]) if source else "")
		if target and target.get("class_type") in (
			"SkipLayerGuidanceDiTSimple",
			"SkipLayerGuidance",
		):
			return nid, "switch"
	return None, None


def download_image(server, image_info, out_path):
	query = urllib.parse.urlencode(
		{
			"filename": image_info["filename"],
			"subfolder": image_info.get("subfolder", ""),
			"type": image_info.get("type", "output"),
		}
	)
	blob = http(f"{server}/view?{query}", timeout=120)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	out_path.write_bytes(blob)



def find_workflows():
	return [Path(p) for p in core.discover_workflows(BASE / CONFIG['workflows']).values()]


def find_prompt_mds():
	return [BASE / p for p in CONFIG['prompts']]


def parse_prompts(path):
	jobs = []
	for index, item in enumerate(core.project_items(core.read_prompts(path), CONFIG)):
		item.setdefault('aspect_ratio', '3:2')
		item.setdefault('megapixels', 1.5)
		for variant, text in enumerate(item['texts']):
			target = Path(item['target'])
			suffix = '' if variant == 0 else f'-{variant + 1}'
			slug = f'{Path(path).stem}__{target.parent.name}__{target.stem}{suffix}'
			jobs.append(dict(item, index=index + 1, category=item['situation'],
				slug=slug, filename=target.name, caption=text))
	return jobs


def job_state_key(path, job):
	return f"{Path(path).stem}::{job['slug']}"


# a gallery file: <slug>__s<seed>__<workflow>[_<n>].<ext>, plus the bare batch
# target <slug>.<ext>. A slug itself contains '__' (prompts__space__rock), so
# only the seed marker or a known workflow stem gives the cut.
SEEDED_NAME_RE = re.compile(r"^(?P<stem>.+?)__s(?P<seed>\d+)__")
SEED_RE = re.compile(r"__s(\d+)")


def split_name(name, stems):
	"""The prompt slug a rendered filename belongs to; `stems` are the workflow
	stems of the project, the only thing that separates a workflow suffix from
	the slug's own last segment."""
	base = Path(name).name.rsplit(".", 1)[0]
	seeded = SEEDED_NAME_RE.match(base)
	if seeded:
		return seeded.group("stem")
	head, sep, rest = base.rpartition("__")
	if sep and rest in stems:
		return head
	return base


def seed_of(name):
	m = SEED_RE.search(Path(name).name)
	return int(m.group(1)) if m else None


def compatible(template, job):
	return bool(core.nodes_of(template, 'SaveVideo')) == (job['situation'] == 'video')


def patch_workflow(template, job, seed, args):
	settings = SimpleNamespace(steps=args.steps, cfg=args.cfg,
		negative=args.negative or None, no_refine=True, size=None, aspect=None,
		megapixels=None, prefix=CONFIG.get('prefix', 'renders'), set=[])
	graph = core.patch_graph(template, dict(job, text=job['caption'],
		target=job['filename'], seed=seed), settings)
	nid, name = slg_slot(graph)
	if nid is not None:
		graph[nid]['inputs'][name] = not args.no_slg
	return graph


def queue_job(server, graph, slug):
	settings = SimpleNamespace(no_extra_data=False, prefix=CONFIG.get('prefix', 'renders'))
	job = dict(target=slug, workflow=CONFIG['name'], situation='gallery')
	return core.queue_job(server, graph, str(uuid.uuid4()), core.job_extra_data(job, settings))


def main():
	parser = argparse.ArgumentParser(description='Batch the enabled gallery cards using the shared queue engine.')
	parser.add_argument('--project', default=str(PROJECT_PATH))
	parser.add_argument('--force', action='store_true')
	parser.add_argument('--list', action='store_true')
	parser.add_argument('--dry-run', action='store_true')
	parser.add_argument('--no-wait', action='store_true')
	options = parser.parse_args()
	state = load_state()
	app = state.get('app', {})
	server = app.get('server', DEFAULT_SERVER)
	core.manifest_path = OUTPUT_DIR / core.MANIFEST_NAME
	core.WORKFLOWS = core.discover_workflows(BASE / CONFIG['workflows'])
	queued = 0
	for workflow in find_workflows():
		if not state.get('workflows', {}).get(workflow.name,
				workflow.stem == CONFIG.get('default_workflow')):
			continue
		template = json.loads(workflow.read_text(encoding='utf-8'))
		nid, name = slg_slot(template)
		overrides = [] if nid is None else [f"{nid}.{name}={str(app.get('slg', True)).lower()}"]
		args = SimpleNamespace(steps=int(app['steps']) if app.get('steps') else None,
			cfg=float(app['cfg']) if app.get('cfg') else None,
			negative=app.get('negative') or None, no_refine=True,
			size=None, aspect=None, megapixels=None, prefix=CONFIG.get('prefix', 'renders'),
			set=overrides, force=options.force, dry_run=options.dry_run,
			dump=None, no_extra_data=False)
		jobs = []
		for path in find_prompt_mds():
			if not state.get('prompts', {}).get(path.name, True):
				continue
			for job in parse_prompts(path):
				if not compatible(template, job) or not state.get('jobs', {}).get(job_state_key(path, job), True):
					continue
				target = OUTPUT_DIR / f"{job['slug']}__{workflow.stem}"
				jobs.append(dict(job, text=job['caption'], target=str(target),
					seed=random.randrange(2**63), variant=0, workflow=workflow.stem))
		if options.list:
			core.print_table(jobs)
			continue
		_, count = core.queue(server, jobs, args, str(uuid.uuid4()))
		queued += count
	if queued and not options.no_wait and not options.dry_run:
		if not core.collect(server, core.load_manifest(), 1800):
			return 1
	return 0


if __name__ == '__main__':
	sys.exit(main())
