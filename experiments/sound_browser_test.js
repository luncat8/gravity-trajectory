/* Real file:// playback and fades. CHROME_PATH=... node experiments/sound_browser_test.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const chrome = process.env.CHROME_PATH || '';
if (!chrome) {
	console.log('SOUND BROWSER TEST SKIPPED — set CHROME_PATH to a Chromium binary');
	process.exit(0);
}
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (error) {
	if (!process.env.PUPPETEER_DIR) throw error;
	puppeteer = require(path.join(process.env.PUPPETEER_DIR, 'puppeteer-core'));
}

function toneWav(file) {
	const rate = 44100;
	const frames = rate * 2;
	const pcm = Buffer.alloc(frames * 4);
	for (let i = 0; i < frames; i++) {
		const sample = Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / rate));
		pcm.writeInt16LE(sample, i * 4);
		pcm.writeInt16LE(sample, i * 4 + 2);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
	header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28);
	header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
	header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
	fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

(async () => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gravity-sound-browser-'));
	const wav = path.join(temp, 'aim.wav');
	toneWav(wav);
	let browser;
	try {
		browser = await puppeteer.launch({ executablePath: chrome, headless: 'shell',
			args: ['--no-sandbox', '--disable-gpu'] });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(String(error)));
		page.on('console', message => {
			if (message.type() !== 'error') return;
			const url = message.location() && message.location().url || '';
			if (message.text().includes('ERR_FILE_NOT_FOUND') && url.includes('/photos/')) return;
			errors.push(message.text());
		});
		await page.evaluateOnNewDocument(url => {
			Object.defineProperty(window, 'GravitySoundFiles', {
				configurable: true, get: () => ({ aim: url }), set: () => {}
			});
			window.__audioElements = [];
			window.__contexts = 0;
			const AudioElement = window.Audio;
			window.Audio = function (...args) {
				const element = new AudioElement(...args);
				window.__audioElements.push(element);
				return element;
			};
			const NativeContext = window.AudioContext;
			window.AudioContext = class extends NativeContext {
				constructor(...args) {
					super(...args);
					window.__contexts++;
					window.__context = this;
					window.__probe = this.createAnalyser();
					window.__probe.fftSize = 2048;
				}
				createMediaElementSource() { throw new Error('file media must play directly'); }
			};
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (target, ...args) {
				if (window.__context && target === window.__context.destination && this !== window.__probe) {
					connect.call(this, window.__probe);
					return connect.call(window.__probe, target, ...args);
				}
				return connect.call(this, target, ...args);
			};
		}, pathToFileURL(wav).href);
		await page.setViewport({ width: 1280, height: 800 });
		await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href + '?mode=lab&seed=7');
		await page.waitForFunction(() => window.GravityScene);
		assert.strictEqual(await page.evaluate(() => window.__contexts), 0, 'no context before a gesture');
		assert.strictEqual(await page.evaluate(() => GravityScene.sound.engine()), 'voronoi', 'fresh default is the Voronoi distance generator');
		const point = await page.evaluate(() => {
			for (let i = 0; i < OrbitScene.sim.planetX.length; i++) {
				const x = OrbitScene.sim.planetX[i] * OrbitScene.view.scale + OrbitScene.view.offX;
				const y = OrbitScene.sim.planetY[i] * OrbitScene.view.scale + OrbitScene.view.offY;
				if (x > 300 && x < 800 && y > 250 && y < 650 && document.elementFromPoint(x, y)?.id === 'c') return { x, y };
			}
			return null;
		});
		assert(point, 'a visible planet is required');
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.mouse.move(point.x + 130, point.y - 30, { steps: 5 });
		await new Promise(resolve => setTimeout(resolve, 450));
		const live = await page.evaluate(() => {
			const data = new Float32Array(window.__probe.fftSize);
			window.__probe.getFloatTimeDomainData(data);
			let sum = 0;
			for (const v of data) sum += v * v;
			return { phase: GravityScene.sound.phase(), state: window.__context.state,
				media: window.__audioElements.length, rms: Math.sqrt(sum / data.length) };
		});
		assert.strictEqual(live.phase, 'aim');
		assert.strictEqual(live.state, 'running');
		assert.strictEqual(live.media, 0, 'Voronoi synth uses no media elements');
		assert(live.rms > 0.001, 'Voronoi aim produces audible Web Audio output');
		await page.mouse.up();
		await page.click('#launch');
		await new Promise(resolve => setTimeout(resolve, 600));
		const flying = await page.evaluate(() => {
			const data = new Float32Array(window.__probe.fftSize);
			window.__probe.getFloatTimeDomainData(data);
			let sum = 0;
			for (const v of data) sum += v * v;
			return { status: GravityScene.sim.status, mode: GravityScene.sound.flightMode(), rms: Math.sqrt(sum / data.length) };
		});
		assert.strictEqual(flying.status, 1);
		assert.strictEqual(flying.mode, 'pentatonic');
		assert(flying.rms > 0.001, 'Voronoi flight cue is audible');
		await page.evaluate(() => { document.getElementById('soundSettings').open = true; });
		await page.select('#soundEngine', 'trajectory');
		await page.select('#soundFlight', 'instrument');
		await new Promise(resolve => setTimeout(resolve, 400));
		const alternate = await page.evaluate(() => {
			const data = new Float32Array(window.__probe.fftSize);
			window.__probe.getFloatTimeDomainData(data);
			let sum = 0;
			for (const v of data) sum += v * v;
			return { mode: GravityScene.sound.flightMode(), rms: Math.sqrt(sum / data.length) };
		});
		assert.strictEqual(alternate.mode, 'instrument');
		assert(alternate.rms > 0.001, 'switching to instrument range stays audible mid-flight');
		await page.click('#clear');
		await page.evaluate(() => { document.getElementById('soundSettings').open = true; });
		await page.select('#soundEngine', 'samples');
		await page.waitForFunction(() => window.__audioElements[0]?.readyState >= 2);
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.mouse.move(point.x + 130, point.y - 30, { steps: 5 });
		await new Promise(resolve => setTimeout(resolve, 400));
		const aim = await page.evaluate(() => ({ phase: GravityScene.sound.phase(),
			paused: window.__audioElements[0].paused, time: window.__audioElements[0].currentTime,
			volume: window.__audioElements[0].volume, state: window.__context.state }));
		assert.strictEqual(aim.phase, 'aim');
		assert.strictEqual(aim.state, 'running');
		assert(!aim.paused && aim.time > 0.1 && aim.volume > 0.2, 'local WAV plays with an audible native-volume fade');
		await page.mouse.up();
		await new Promise(resolve => setTimeout(resolve, 350));
		const armed = await page.evaluate(() => {
			const data = new Float32Array(window.__probe.fftSize);
			window.__probe.getFloatTimeDomainData(data);
			let sum = 0;
			for (const v of data) sum += v * v;
			return { phase: GravityScene.sound.phase(), paused: window.__audioElements[0].paused,
				volume: window.__audioElements[0].volume, rms: Math.sqrt(sum / data.length) };
		});
		assert.strictEqual(armed.phase, 'armed');
		assert(armed.paused && armed.volume === 0, 'aim fades out and pauses');
		assert(armed.rms > 0.001, 'procedural cymbal produces sound');
		await page.click('#soundToggle');
		await new Promise(resolve => setTimeout(resolve, 350));
		const muted = await page.evaluate(() => {
			const data = new Float32Array(window.__probe.fftSize);
			window.__probe.getFloatTimeDomainData(data);
			return { peak: Math.max(...data.map(v => Math.abs(v))),
				pressed: document.getElementById('soundToggle').getAttribute('aria-pressed') };
		});
		assert(muted.peak < 0.0001 && muted.pressed === 'false', 'mute silences synth and updates the UI');
		assert.deepStrictEqual(errors, [], 'no page or audio errors');
		console.log('SOUND BROWSER TEST OK: default Voronoi synth, trajectory flight mapping, file:// WAV, fades and mute');
	} finally {
		if (browser) await browser.close();
		fs.rmSync(temp, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
