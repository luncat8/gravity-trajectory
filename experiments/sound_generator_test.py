#!/usr/bin/env python3
"""Run: python3 experiments/sound_generator_test.py (ffmpeg enables selection tests)."""
import array
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'sounds/generator/generate.py'
spec = importlib.util.spec_from_file_location('sound_generate', SCRIPT)
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


class Handler(BaseHTTPRequestHandler):
	posts = []
	fail_post = 0
	bad_history = False
	flac = b'fLaCtest'

	def log_message(self, *args):
		pass

	def send_data(self, status, data, content='application/json'):
		if isinstance(data, dict):
			data = json.dumps(data).encode()
		self.send_response(status)
		self.send_header('Content-Type', content)
		self.send_header('Content-Length', str(len(data)))
		self.end_headers()
		self.wfile.write(data)

	def do_POST(self):
		assert self.path == '/prompt'
		payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
		self.posts.append(payload)
		if self.fail_post and len(self.posts) == self.fail_post:
			self.send_data(400, {'error': 'intentional'})
			return
		self.send_data(200, {'prompt_id': f'job-{len(self.posts)}'})

	def do_GET(self):
		url = urlparse(self.path)
		if url.path.startswith('/history/'):
			prompt_id = url.path.rsplit('/', 1)[1]
			if self.bad_history:
				entry = {'status': {'status_str': 'error', 'messages': [['execution_error', {'exception_message': 'test failure'}]]}, 'outputs': {}}
			else:
				entry = {'status': {'status_str': 'success'}, 'outputs': {'13': {'audio': [{'filename': 'take.flac', 'subfolder': 'audio', 'type': 'output'}]}}}
			self.send_data(200, {prompt_id: entry})
			return
		if url.path == '/view':
			self.send_data(200, self.flac, 'audio/flac')
			return
		self.send_data(404, {'error': 'not found'})


def run(*args, expected=0):
	result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], cwd=REPO,
		text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
	if result.returncode != expected:
		raise AssertionError(f'exit {result.returncode}, expected {expected}\n{result.stdout}\n{result.stderr}')
	return result


def fixture(path, seconds=2, silence=False):
	samples = array.array('h')
	for i in range(44100 * seconds):
		value = 0 if silence else round(10000 * math.sin(2 * math.pi * 440 * i / 44100))
		samples.extend((value, value))
	if sys.byteorder != 'little':
		samples.byteswap()
	with wave.open(str(path), 'wb') as wav:
		wav.setparams((2, 2, 44100, 0, 'NONE', 'not compressed'))
		wav.writeframes(samples.tobytes())


def main():
	server = HTTPServer(('127.0.0.1', 0), Handler)
	thread = threading.Thread(target=server.serve_forever, daemon=True)
	thread.start()
	try:
		with tempfile.TemporaryDirectory() as temp:
			tmp = Path(temp)
			out = tmp / 'generated'
			manifest = tmp / 'manifest.json'
			dump = tmp / 'graphs'
			url = f'http://127.0.0.1:{server.server_port}'
			args = ('--server', url, '--out', out, '--manifest', manifest, '--cue', 'launch', '--takes', 1)
			result = run(*args, '--dry-run', '--dump', dump)
			assert '3 takes' in result.stdout and not Handler.posts
			graphs = list(dump.rglob('*.json'))
			assert len(graphs) == 3
			graph = json.loads(graphs[0].read_text())
			assert graph['3']['inputs']['sampler_name'] == 'lcm'
			assert graph['3']['inputs']['cfg'] == 1.0
			assert graph['11']['inputs']['seconds'] in (4, 4.5)
			assert graph['6']['inputs']['text'].startswith('TrackType: SFX')
			assert graph['13']['class_type'] == 'SaveAudioAdvanced'
			assert graph['13']['inputs']['format'] == 'flac'
			visual = json.loads((SCRIPT.parent / 'stable_audio_3_medium_workflow.json').read_text())
			visual_nodes = {node['id']: node for node in visual['nodes']}
			for link, source, output, target, input_slot, kind in visual['links']:
				assert link in visual_nodes[source]['outputs'][output]['links']
				assert visual_nodes[target]['inputs'][input_slot]['link'] == link
				assert visual_nodes[source]['outputs'][output]['type'] == kind
			assert visual_nodes[13]['type'] == 'SaveAudioAdvanced'
			assert visual_nodes[13]['widgets_values'][-1] == 'flac'
			assert visual_nodes[3]['widgets_values'][2:6] == [8, 1, 'lcm', 'simple']
			result = run(*args, '--dry-run', '--seconds', 3, '--sampler', 'euler', '--dump', tmp / 'other')
			assert '-d3-c1-euler-simple' in result.stdout
			changed = json.loads(next((tmp / 'other').rglob('*.json')).read_text())
			assert 'Length: 3 seconds' in changed['6']['inputs']['text']

			wav = tmp / 'fixture.wav'
			fixture(wav)
			if shutil.which('ffmpeg'):
				flac = tmp / 'fixture.flac'
				subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), str(flac)], check=True)
				Handler.flac = flac.read_bytes()
			Handler.fail_post = 2
			run(*args, expected=1)
			data = json.loads(manifest.read_text())
			assert len(data['jobs']) == 1 and data['jobs'][0]['status'] == 'queued', 'accepted jobs survive a later HTTP failure'
			assert Handler.posts[0]['extra_data']['extra_pnginfo']['workflow']['workflow_name'].startswith('gravity sounds')
			Handler.fail_post = 0
			result = run(*args, '--wait')
			assert 'already queued' in result.stdout
			data = json.loads(manifest.read_text())
			assert len(data['jobs']) == 3 and all(j['status'] == 'done' for j in data['jobs'])
			assert len(Handler.posts) == 4, 'the already queued take must not be submitted twice'
			for job in data['jobs']:
				assert Path(job['target']).read_bytes() == Handler.flac
			page = (out / 'audition.html').read_text()
			assert page.count('<audio controls') == 3 and '--select launch=' in page
			run(*args)
			assert len(Handler.posts) == 4, 'finished files must be skipped'

			if shutil.which('ffmpeg'):
				selected = tmp / 'selected'
				run('--select', f'aim={flac}', '--start', 0.5, '--length', 1,
					'--crossfade-ms', 200, '--selected-dir', selected)
				with wave.open(str(selected / 'aim.wav')) as f:
					assert f.getparams()[:3] == (2, 2, 44100)
					assert f.getnframes() == 35280, 'crossfade must overlap, not append silence'
				run('--select', f'fly={flac}', '--selected-dir', selected)
				long_wav = tmp / 'long.wav'
				fixture(long_wav, seconds=11)
				run('--select', f'launch={long_wav}', '--select', f'fly={long_wav}',
					'--length', 11, '--selected-dir', selected)
				with wave.open(str(selected / 'launch.wav')) as f:
					assert f.getnframes() == round(4.2 * 44100), 'launch crop stays capped at 4.2 seconds'
				with wave.open(str(selected / 'fly.wav')) as f:
					assert f.getnframes() == 10 * 44100, 'flight crop stays capped at 10 seconds'
				pack = (selected / 'pack.js').read_text()
				assert 'sounds/selected/aim.wav' in pack and 'sounds/selected/fly.wav' in pack
				with wave.open(str(selected / 'fly.wav')) as f:
					samples = array.array('h', f.readframes(f.getnframes()))
					assert abs(samples[-1]) <= 1, 'flight music has a real fade-out'
				before = (selected / 'aim.wav').read_bytes()
				silent = tmp / 'silent.wav'
				fixture(silent, silence=True)
				run('--select', f'aim={silent}', '--selected-dir', selected, expected=1)
				assert (selected / 'aim.wav').read_bytes() == before, 'failed selection preserves the previous take'

			Handler.bad_history = True
			run(*args, '--force', '--wait', expected=1)
			data = json.loads(manifest.read_text())
			assert all(j['status'] == 'error' and 'test failure' in j['error'] for j in data['jobs'])
			run('--collect', '--manifest', manifest, '--out', out, expected=1)
			print('SOUND GENERATOR TEST OK: graph, durable queue, history, audition, selection and errors')
	finally:
		server.shutdown()
		thread.join()


if __name__ == '__main__':
	main()
