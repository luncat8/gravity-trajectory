/* Launch sound stages. Selected local WAVs replace the procedural stand-ins. */
(function (root) {
	'use strict';

	const TrajectorySound = typeof module !== 'undefined' && module.exports
		? require('./gravity_trajectory_sound.js')
		: root.GravityTrajectorySound;
	const ENGINES = { voronoi: true, trajectory: true, samples: true, fallback: true };
	const AIM_MODES = { outcome: true, flythrough: true };
	const FLIGHT_MODES = { pentatonic: true, instrument: true };

	const CUES = ['aim', 'armed', 'launch', 'fly'];
	const ATTACK = { aim: 0.18, armed: 0.1, launch: 0.01, fly: 0.5 };
	const RELEASE = { aim: 0.18, armed: 0.09, launch: 0.12, fly: 0.3 };
	const LEVEL = { aim: 0.18, armed: 0.10, launch: 0.36, fly: 0.19 };

	function create(options) {
		options = options || {};
		const host = options.host || root;
		const files = options.files || host.GravitySoundFiles || {};
		let enabled = options.enabled !== false;
		let active = true;
		let volume = options.volume === undefined ? 0.45 : clamp(options.volume);
		let desired = 'idle';
		let context = null;
		let master = null;
		let noise = null;
		let curve = null;
		let loop = null;
		let blast = null;
		let flight = null;
		const assets = {};

		function clamp(value) {
			value = Number(value);
			return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
		}

		function fade(param, value, seconds) {
			const now = context.currentTime;
			if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
			else {
				param.cancelScheduledValues(now);
				param.setValueAtTime(param.value, now);
			}
			param.linearRampToValueAtTime(value, now + seconds);
		}

		function loadAssets() {
			if (typeof host.Audio !== 'function') return;
			for (let i = 0; i < CUES.length; i++) {
				const name = CUES[i];
				if (!files[name]) continue;
				const element = new host.Audio();
				const asset = { element, ready: false, envelope: 0, token: 0 };
				assets[name] = asset;
				element.preload = 'auto';
				element.addEventListener('canplay', () => {
					asset.ready = true;
					if (!context || !enabled || !active || desired !== name || !loop || loop.asset) return;
					const replacement = play(name, true);
					if (!replacement.asset) {
						stopVoice(replacement, RELEASE[name]);
						return;
					}
					stopVoice(loop, RELEASE[name]);
					loop = replacement;
				});
				element.addEventListener('error', () => {
					asset.ready = false;
					fallbackAsset(name, asset);
				});
				element.src = files[name];
				element.load();
			}
		}

		function ensureContext() {
			if (context) return true;
			const AudioContext = host.AudioContext || host.webkitAudioContext;
			if (!AudioContext) return false;
			try {
				context = new AudioContext();
				master = context.createGain();
				master.gain.value = volume;
				master.connect(context.destination);
			} catch (err) {
				context = null;
				return false;
			}
			return true;
		}

		function unlock() {
			if (!enabled || !active || !ensureContext()) return;
			if (context.state === 'suspended') {
				const resumed = context.resume();
				if (resumed && resumed.catch) resumed.catch(() => {});
			}
			if (!loop && desired !== 'idle') loop = play(desired, true);
		}

		function makeNoise() {
			if (noise) return noise;
			const count = Math.round(context.sampleRate * 2);
			noise = context.createBuffer(1, count, context.sampleRate);
			const data = noise.getChannelData(0);
			for (let i = 0; i < count; i++) data[i] = Math.random() * 2 - 1;
			const overlap = Math.min(256, Math.floor(count / 4));
			for (let i = 0; i < overlap; i++) {
				const fade = i / overlap;
				data[i] *= fade;
				data[count - 1 - i] *= fade;
			}
			return noise;
		}

		function makeCurve() {
			if (curve) return curve;
			curve = new Float32Array(1024);
			for (let i = 0; i < curve.length; i++) {
				const x = i * 2 / (curve.length - 1) - 1;
				curve[i] = Math.tanh(x * 6) / Math.tanh(6);
			}
			return curve;
		}

		function voice(name, duration) {
			const gain = context.createGain();
			const now = context.currentTime;
			gain.gain.setValueAtTime(0, now);
			gain.gain.linearRampToValueAtTime(LEVEL[name], now + ATTACK[name]);
			if (duration) {
				gain.gain.setValueAtTime(LEVEL[name], now + duration - 1.5);
				gain.gain.linearRampToValueAtTime(0, now + duration);
			}
			gain.connect(master);
			return { name, gain, sources: [], asset: null };
		}

		function oscillator(v, type, frequency, target, stopAt) {
			const osc = context.createOscillator();
			osc.type = type;
			osc.frequency.setValueAtTime(frequency, context.currentTime);
			osc.connect(target);
			osc.start();
			if (stopAt) osc.stop(context.currentTime + stopAt);
			v.sources.push(osc);
			return osc;
		}

		function noiseSource(v, target, stopAt) {
			const source = context.createBufferSource();
			source.buffer = makeNoise();
			source.loop = true;
			source.connect(target);
			source.start();
			if (stopAt) source.stop(context.currentTime + stopAt);
			v.sources.push(source);
			return source;
		}

		function filter(type, frequency, target) {
			const node = context.createBiquadFilter();
			node.type = type;
			node.frequency.value = frequency;
			node.connect(target);
			return node;
		}

		function guitar() {
			const v = voice('aim');
			const low = filter('lowpass', 2600, v.gain);
			const drive = context.createWaveShaper();
			drive.curve = makeCurve();
			drive.connect(low);
			const input = context.createGain();
			input.gain.value = 0.38;
			input.connect(drive);
			oscillator(v, 'sawtooth', 82.41, input);
			const harmonic = oscillator(v, 'sawtooth', 82.65, input);
			harmonic.detune.value = 4;
			return v;
		}

		function shimmer() {
			const v = voice('armed');
			const high = filter('highpass', 4300, v.gain);
			const tremolo = context.createGain();
			tremolo.gain.value = 0.55;
			tremolo.connect(high);
			noiseSource(v, tremolo);
			const modulation = context.createGain();
			modulation.gain.value = 0.4;
			modulation.connect(tremolo.gain);
			oscillator(v, 'sine', 13, modulation);
			return v;
		}

		function thunder() {
			const v = voice('launch', 4);
			const now = context.currentTime;
			const low = filter('lowpass', 240, v.gain);
			const rumble = context.createGain();
			rumble.gain.setValueAtTime(0.9, now);
			rumble.gain.exponentialRampToValueAtTime(0.02, now + 3.8);
			rumble.connect(low);
			noiseSource(v, rumble, 4);
			const boom = context.createGain();
			boom.gain.setValueAtTime(0.8, now);
			boom.gain.exponentialRampToValueAtTime(0.01, now + 2.6);
			boom.connect(v.gain);
			const tone = oscillator(v, 'sine', 64, boom, 4);
			tone.frequency.exponentialRampToValueAtTime(31, now + 1.2);
			const echo = context.createDelay(1);
			echo.delayTime.value = 0.36;
			const echoGain = context.createGain();
			echoGain.gain.value = 0.32;
			rumble.connect(echo);
			echo.connect(echoGain);
			echoGain.connect(low);
			return v;
		}

		function spaceRock() {
			const v = voice('fly', 10);
			const now = context.currentTime;
			const notes = [82.41, 82.41, 110, 123.47, 98, 82.41, 146.83, 123.47];
			const amp = context.createGain();
			amp.gain.value = 0.4;
			const low = filter('lowpass', 1800, v.gain);
			const drive = context.createWaveShaper();
			drive.curve = makeCurve();
			drive.connect(low);
			amp.connect(drive);
			const bass = oscillator(v, 'sawtooth', notes[0], amp, 10);
			const leadAmp = context.createGain();
			leadAmp.gain.value = 0.12;
			leadAmp.connect(v.gain);
			const lead = oscillator(v, 'triangle', notes[0] * 2, leadAmp, 10);
			for (let i = 0; i < 24; i++) {
				const at = now + i * 0.375;
				bass.frequency.setValueAtTime(notes[i % notes.length], at);
				lead.frequency.setValueAtTime(notes[i % notes.length] * 2, at);
				amp.gain.setValueAtTime(0.42, at);
				amp.gain.linearRampToValueAtTime(0.16, at + 0.3);
			}
			const kickGain = context.createGain();
			kickGain.gain.value = 0;
			kickGain.connect(v.gain);
			const kick = oscillator(v, 'sine', 120, kickGain, 10);
			for (let i = 0; i < 12; i++) {
				const at = now + i * 0.75;
				kick.frequency.setValueAtTime(120, at);
				kick.frequency.exponentialRampToValueAtTime(45, at + 0.16);
				kickGain.gain.setValueAtTime(0.8, at);
				kickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
			}
			const hats = context.createGain();
			hats.gain.value = 0;
			hats.connect(filter('highpass', 6000, v.gain));
			noiseSource(v, hats, 10);
			for (let i = 0; i < 24; i++) {
				const at = now + i * 0.375;
				hats.gain.setValueAtTime(0.14, at);
				hats.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
			}
			return v;
		}

		function mediaVolume(asset) {
			asset.element.volume = clamp(asset.envelope * volume);
		}

		function fadeMedia(asset, target, seconds, token, finish) {
			const start = host.performance.now();
			const from = asset.envelope;
			function tick() {
				if (asset.token !== token) return;
				const progress = Math.min(1, (host.performance.now() - start) / (seconds * 1000));
				asset.envelope = from + (target - from) * progress;
				mediaVolume(asset);
				if (progress < 1) host.setTimeout(tick, 20);
				else if (finish) finish();
			}
			tick();
		}

		function fallbackAsset(name, asset) {
			const repeating = name === 'aim' || name === 'armed';
			const current = repeating ? loop : name === 'fly' ? flight : blast;
			if (!enabled || !active || !current || current.asset !== asset) return;
			const replacement = play(name, repeating);
			stopVoice(current, 0.05);
			if (repeating) loop = replacement;
			else if (name === 'fly') flight = replacement;
			else blast = replacement;
		}

		function playAsset(name, repeating) {
			const asset = assets[name];
			asset.token += 1;
			asset.element.pause();
			asset.element.currentTime = 0;
			asset.element.loop = repeating;
			asset.envelope = 0;
			mediaVolume(asset);
			const token = asset.token;
			const started = asset.element.play();
			fadeMedia(asset, 0.7, ATTACK[name], token);
			if (name === 'fly') host.setTimeout(() => {
				if (asset.token !== token) return;
				fadeMedia(asset, 0, 1.5, token, () => asset.element.pause());
			}, 8500);
			if (started && started.catch) started.catch(() => {
				if (asset.token !== token) return;
				asset.ready = false;
				fallbackAsset(name, asset);
			});
			return { name, gain: null, sources: [], asset };
		}

		function play(name, repeating) {
			if (assets[name] && assets[name].ready) {
				try { return playAsset(name, repeating); }
				catch (err) { assets[name].ready = false; }
			}
			if (name === 'aim') return guitar();
			if (name === 'armed') return shimmer();
			if (name === 'launch') return thunder();
			return spaceRock();
		}

		function stopVoice(v, seconds) {
			if (!v || !context) return;
			if (v.asset) {
				const asset = v.asset;
				const token = ++asset.token;
				fadeMedia(asset, 0, seconds, token, () => asset.element.pause());
				return;
			}
			fade(v.gain.gain, 0, seconds);
			for (let i = 0; i < v.sources.length; i++) {
				try { v.sources[i].stop(context.currentTime + seconds + 0.02); }
				catch (err) { /* A finished one-shot has already stopped. */ }
			}
		}

		function setLoop(name) {
			if (name !== 'aim' && name !== 'armed') name = 'idle';
			if (desired === name) return;
			desired = name;
			if (loop) stopVoice(loop, RELEASE[loop.name]);
			loop = null;
			if (enabled && active && context && name !== 'idle') loop = play(name, true);
		}

		function startFlight() {
			if (!enabled || !active || !context) return;
			stopVoice(flight, RELEASE.fly);
			flight = play('fly', false);
		}

		function launch() {
			setLoop('idle');
			if (!enabled || !active || !context) return;
			stopVoice(blast, RELEASE.launch);
			blast = play('launch', false);
			startFlight();
		}

		function stopFlight() {
			stopVoice(flight, RELEASE.fly);
			flight = null;
		}

		function stopAll() {
			stopVoice(loop, loop ? RELEASE[loop.name] : 0.1);
			stopVoice(blast, RELEASE.launch);
			stopVoice(flight, RELEASE.fly);
			loop = null;
			blast = null;
			flight = null;
		}

		function setEnabled(value) {
			enabled = Boolean(value);
			if (!enabled) stopAll();
			else unlock();
		}

		function setVolume(value) {
			volume = clamp(value);
			if (master) fade(master.gain, volume, 0.05);
			for (let i = 0; i < CUES.length; i++) {
				const asset = assets[CUES[i]];
				if (asset) mediaVolume(asset);
			}
		}

		function setActive(value) {
			active = Boolean(value);
			if (!active) {
				stopAll();
				/* Background tabs may throttle timers, so don't leave a media loop playing. */
				for (let i = 0; i < CUES.length; i++) {
					const asset = assets[CUES[i]];
					if (!asset) continue;
					asset.token++;
					asset.envelope = 0;
					mediaVolume(asset);
					asset.element.pause();
				}
			} else if (context && enabled) unlock();
		}

		function reset() {
			desired = 'idle';
			stopAll();
		}

		loadAssets();
		return { unlock, setLoop, launch, startFlight, stopFlight, setEnabled, setVolume, setActive, reset,
			phase: () => desired, enabled: () => enabled };
	}

	/* Keeps user preferences and the current stage across a backend switch. */
	function createController(options) {
		options = options || {};
		const host = options.host || root;
		let engine = Object.hasOwn(ENGINES, options.engine) ? options.engine : 'voronoi';
		let enabled = options.enabled !== false;
		let active = true;
		let volume = options.volume === undefined ? 0.45 : Math.max(0, Math.min(1, Number(options.volume) || 0));
		let desired = 'idle';
		let flying = false;
		let aimMode = Object.hasOwn(AIM_MODES, options.aimMode) ? options.aimMode : 'outcome';
		let flightMode = Object.hasOwn(FLIGHT_MODES, options.flightMode) ? options.flightMode : 'pentatonic';
		let aimData = null;
		let flightSim = null;
		let backend = makeBackend();

		function makeBackend() {
			const config = { host, enabled, volume, aimMode, flightMode };
			if (engine === 'trajectory' || engine === 'voronoi') {
				config.voronoi = engine === 'voronoi';
				return TrajectorySound.create(config);
			}
			config.files = engine === 'samples' ? options.files : {};
			return create(config);
		}

		function restoreBackend() {
			backend.setActive(active);
			if (flying) backend.startFlight();
			backend.setLoop(desired);
			if (aimData && backend.updateAim) backend.updateAim(aimData);
			if (flightSim && backend.updateFlight) backend.updateFlight(flightSim);
		}

		function setEngine(value) {
			if (!Object.hasOwn(ENGINES, value) || value === engine) return false;
			backend.reset();
			backend.setActive(false);
			engine = value;
			backend = makeBackend();
			restoreBackend();
			return true;
		}

		function setLoop(name) {
			if (name !== 'aim' && name !== 'armed') name = 'idle';
			desired = name;
			backend.setLoop(name);
		}

		function launch() {
			desired = 'idle';
			flying = true;
			backend.launch();
		}

		function startFlight() {
			flying = true;
			backend.startFlight();
		}

		function stopFlight() {
			flying = false;
			backend.stopFlight();
		}

		function reset() {
			desired = 'idle';
			flying = false;
			aimData = null;
			flightSim = null;
			backend.reset();
		}

		function setEnabled(value) {
			enabled = Boolean(value);
			backend.setEnabled(enabled);
		}

		function setActive(value) {
			active = Boolean(value);
			backend.setActive(active);
		}

		function setVolume(value) {
			volume = Math.max(0, Math.min(1, Number(value) || 0));
			backend.setVolume(volume);
		}

		function updateAim(data) {
			aimData = data;
			if (backend.updateAim) backend.updateAim(data);
		}

		function updateFlight(sim) {
			flightSim = sim;
			if (backend.updateFlight) backend.updateFlight(sim);
		}

		function setAimMode(value) {
			aimMode = Object.hasOwn(AIM_MODES, value) ? value : 'outcome';
			if (backend.setAimMode) backend.setAimMode(aimMode);
		}

		function setFlightMode(value) {
			flightMode = Object.hasOwn(FLIGHT_MODES, value) ? value : 'pentatonic';
			if (backend.setFlightMode) backend.setFlightMode(flightMode);
		}

		return { unlock: () => backend.unlock(), setLoop, launch, startFlight, stopFlight, reset,
			setEnabled, setActive, setVolume, setEngine, updateAim, updateFlight, setAimMode, setFlightMode,
			phase: () => desired, enabled: () => enabled, engine: () => engine, volume: () => volume,
			aimMode: () => aimMode, flightMode: () => flightMode };
	}

	const api = { create, createController };
	root.GravitySound = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
