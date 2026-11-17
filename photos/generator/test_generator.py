#!/usr/bin/env python3
"""Offline generator regressions: python -m unittest discover -s photos/generator."""
import contextlib
import io
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.dont_write_bytecode = True

import comfy_queue as core
import launch

HERE = Path(__file__).resolve().parent


def settings(**overrides):
	values = dict(steps=None, cfg=None, no_refine=True, negative=None,
		aspect=None, megapixels=None, size=None, prefix='test', set=[],
		variants=1, seed=42, out='/tmp/test-generator')
	values.update(overrides)
	return SimpleNamespace(**values)


class GeneratorTests(unittest.TestCase):
	def test_existing_prompts_and_variants(self):
		items = core.read_prompts(HERE.parent / 'prompts.md')
		self.assertEqual(len(items), 18)
		self.assertEqual(len(items[-1]['texts']), 2)
		jobs = core.make_jobs(items, settings(), ['image_moss_image_t2i'])
		self.assertEqual(len(jobs), 19)
		self.assertTrue(jobs[-1]['target'].endswith('career/circus-2.jpg'))

	def test_arc_pack_preserved(self):
		config, _ = core.load_project(HERE / 'arc-steam.json')
		self.assertEqual(len(config['prompts']), 1)
		pack = HERE / config['prompts'][0]
		self.assertTrue(pack.is_file())
		self.assertEqual(len(core.read_prompts(pack)), 18)

	def test_all_templates_patch_without_mutating(self):
		for name, path in core.WORKFLOWS.items():
			with self.subTest(workflow=name):
				template = json.loads(Path(path).read_text())
				before = json.dumps(template)
				graph = core.patch_graph(template, dict(text='A silver launch rail.',
					seed=123, target='photos/career/test.jpg', situation='career'), settings())
				self.assertEqual(json.dumps(template), before)
				self.assertNotIn('##prompt', json.dumps(graph))
				video = bool(core.nodes_of(graph, 'SaveVideo'))
				seed_node = core.one_node(graph, 'RandomNoise' if video else 'KSampler')
				self.assertEqual(seed_node['inputs']['noise_seed' if video else 'seed'], 123)

	def test_video_filtering_is_graph_based(self):
		items = core.read_prompts(HERE.parent / 'helper-joke-prompts.md')
		jobs = core.make_jobs(items, settings(), list(core.WORKFLOWS))
		self.assertEqual(len(jobs), 8)  # 3 captions x 2 image graphs + 2 video captions
		for job in jobs:
			self.assertEqual(job['situation'] == 'video', 'video' in job['workflow'])

	def test_size_and_raw_overrides(self):
		graph = core.build(HERE / 'video_minimax_pika_h3_flex_t2v_api.json',
			dict(text='A flag flutters.', seed=4, target='video/test.mp4', situation='video'),
			settings(size=(960, 640), set=['140:133.value=6']))
		self.assertEqual(graph['140:131']['inputs']['width'], 960)
		self.assertEqual(graph['140:131']['inputs']['height'], 640)
		self.assertEqual(graph['140:133']['inputs']['value'], 6)

	def test_unsupported_video_sampler_override(self):
		with self.assertRaisesRegex(SystemExit, 'ManualSigmas'):
			core.build(HERE / 'video_minimax_pika_h3_flex_t2v_api.json',
				dict(text='A flag.', seed=1), settings(steps=30))

	def test_gallery_parser_and_compatibility(self):
		jobs = launch.parse_prompts(HERE.parent / 'prompts.md')
		self.assertEqual(len(jobs), 19)
		for job in jobs:
			self.assertTrue(all(key in job for key in ('aspect_ratio', 'megapixels', 'caption', 'filename', 'slug', 'category')))
		self.assertEqual(len({j['slug'] for j in jobs}), 19)
		video = json.loads((HERE / 'video_minimax_pika_h3_flex_t2v_api.json').read_text())
		self.assertFalse(launch.compatible(video, jobs[0]))


	def test_gallery_filenames_map_to_their_prompt(self):
		stems = {path.stem for path in launch.find_workflows()}
		self.assertEqual(launch.split_name('prompts__space__rock.jpg', stems),
			'prompts__space__rock')
		for stem in stems:
			name = f'prompts__space__rock__s123__{stem}_2.png'
			self.assertEqual(launch.split_name(name, stems), 'prompts__space__rock')
		# a unknown suffix is not a workflow: keep the whole name as the stem
		self.assertEqual(launch.split_name('space__trench.jpg', stems), 'space__trench')
		self.assertEqual(launch.seed_of('prompts__space__rock__s123__image_moss_image_t2i.png'), 123)
		self.assertIsNone(launch.seed_of('prompts__space__rock.jpg'))

	def test_nested_target_paths_and_pack_sizes(self):
		job = dict(target='assets/scenes/moon.jpg', variant=0)
		self.assertEqual(core.target_path(job, '/renders'), Path('/renders/assets/scenes/moon.jpg'))
		with self.assertRaises(SystemExit):
			core.target_path(dict(target='../escape.jpg', variant=0), '/renders')
		config, _ = core.load_project(HERE / 'arc-steam.json')
		items = core.project_items(core.read_prompts(HERE / 'packs/arc-steam-moss-prompts.md'), config)
		self.assertEqual(items[6]['aspect_ratio'], '16:9')
		self.assertEqual(items[6]['megapixels'], 1)

	def test_state_roundtrip(self):
		with tempfile.TemporaryDirectory() as directory:
			path = Path(directory) / 'nested/state.toml'
			state = {'app': {'server': 'http://host:8188', 'slg': False},
				'jobs': {'file::caption': False}}
			launch.save_state(state, path)
			self.assertEqual(launch.load_state(path), state)
			self.assertEqual(launch._mini_toml(path.read_text()), state)

	def test_external_project_and_workflow_directory(self):
		with tempfile.TemporaryDirectory() as directory:
			root = Path(directory)
			(root / 'pack.md').write_text('### 1 · art · hello → `photos/art/hello.jpg`\n> A moon.\n')
			(root / 'project.json').write_text(json.dumps(dict(name='external',
				prompts=['pack.md'], output='renders', workflows=str(HERE))))
			with contextlib.redirect_stdout(io.StringIO()) as output:
				core.main(['--project', str(root / 'project.json'), '--list'])
			self.assertIn('hello.jpg', output.getvalue())

	def test_queue_collect_image_and_video(self):
		requests = []
		class Handler(BaseHTTPRequestHandler):
			def log_message(self, *args):
				pass

			def do_POST(self):
				data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
				requests.append(data)
				self.send_response(200)
				self.end_headers()
				self.wfile.write(json.dumps({'prompt_id': str(len(requests))}).encode())

			def do_GET(self):
				self.send_response(200)
				self.end_headers()
				if self.path.startswith('/view?'):
					self.wfile.write(b'fixture-media')
					return
				pid = self.path.rsplit('/', 1)[-1]
				graph = requests[int(pid) - 1]['prompt']
				video = bool(core.nodes_of(graph, 'SaveVideo'))
				entry = {'status': {'status_str': 'success'}, 'outputs': {'save': {
					'videos' if video else 'images': [{'filename': 'render.mp4' if video else 'render.png'}]}}}
				self.wfile.write(json.dumps({pid: entry}).encode())

		server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
		thread = threading.Thread(target=server.serve_forever, daemon=True)
		thread.start()
		try:
			with tempfile.TemporaryDirectory() as directory:
				root = Path(directory)
				for workflow, situation, count in [('moss', 'career', 8), ('video', 'video', 2)]:
					with contextlib.redirect_stdout(io.StringIO()):
						result = core.main(['--server', f'http://127.0.0.1:{server.server_port}',
							'--workflow', workflow, '--situation', situation, '--wait',
							'--out', str(root), '--manifest', str(root / 'manifest.json')])
					self.assertEqual(result, 0)
					self.assertEqual(len(list((root / situation).iterdir())), count)
				self.assertTrue(all('extra_pnginfo' in r['extra_data'] for r in requests))
		finally:
			server.shutdown()
			server.server_close()
			thread.join()


if __name__ == '__main__':
	unittest.main()
