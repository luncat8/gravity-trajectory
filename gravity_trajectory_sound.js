/* Data-driven trajectory sonification. No samples, no simulation writes. */
(function (root) {
	'use strict';

	const PLANETS = 32;
	const EVENTS = 64;
	const POOL = 8;
	const PENTATONIC = [0, 2, 4, 7, 9];
	const AIM_OUTCOME = 'outcome';
	const AIM_FLYTHROUGH = 'flythrough';
	const FLIGHT_PENTATONIC = 'pentatonic';
	const FLIGHT_INSTRUMENT = 'instrument';
	const TONES = new Float64Array(PLANETS);
	const INSTRUMENTS = [
		{ wave: 'sine', harmonic: 'triangle', ratio: 2, cutoff: 1600, pitch: 110, tremolo: 1.4 },
		{ wave: 'triangle', harmonic: 'sine', ratio: 1.5, cutoff: 2200, pitch: 130.81, tremolo: 1.8 },
		{ wave: 'sawtooth', harmonic: 'triangle', ratio: 2, cutoff: 900, pitch: 146.83, tremolo: 2.2 },
		{ wave: 'square', harmonic: 'sine', ratio: 0.5, cutoff: 700, pitch: 164.81, tremolo: 2.6 },
		{ wave: 'triangle', harmonic: 'sawtooth', ratio: 3, cutoff: 1400, pitch: 196, tremolo: 3 },
		{ wave: 'sine', harmonic: 'square', ratio: 4, cutoff: 1100, pitch: 220, tremolo: 3.4 }
	];

	function planetIndex(planetId) {
		const id = Number(planetId);
		if (!Number.isFinite(id)) return 0;
		return ((Math.floor(id) % PLANETS) + PLANETS) % PLANETS;
	}

	function midiHz(note) {
		return 440 * Math.pow(2, (note - 69) / 12);
	}

	for (let i = 0; i < PLANETS; i++) {
		const degree = (i * 7 + 3) % 15;
		TONES[i] = midiHz(48 + Math.floor(degree / 5) * 12 + PENTATONIC[degree % 5]);
	}

	function get_tone_pentatonic(planetId) {
		return TONES[planetIndex(planetId)];
	}

	function get_instrument(planetId) {
		return INSTRUMENTS[planetIndex(planetId) % INSTRUMENTS.length];
	}

	function clamp(value, min, max) {
		value = Number(value);
		if (!Number.isFinite(value)) return min;
		return value < min ? min : value > max ? max : value;
	}

	function create(options) {
		options = options || {};
		const host = options.host || root;
		let enabled = options.enabled !== false;
		let active = true;
		let volume = options.volume === undefined ? 0.45 : clamp(options.volume, 0, 1);
		let desired = 'idle';
		let flying = false;
		let aimMode = options.aimMode === AIM_FLYTHROUGH ? AIM_FLYTHROUGH : AIM_OUTCOME;
		let flightMode = options.flightMode === FLIGHT_INSTRUMENT ? FLIGHT_INSTRUMENT : FLIGHT_PENTATONIC;
		let context = null;
		let master = null;
		let aimBus = null;
		let profitFilter = null;
		let flightBus = null;
		let flightLevel = null;
		let flightFilter = null;
		let flightPan = null;
		let flightTremolo = null;
		let flightLfo = null;
		let flightLfoDepth = null;
		let blastGain = null;
		let blastFilter = null;
		let boomGain = null;
		let boom = null;
		const chordOsc = [];
		const chordGain = [];
		const flightOsc = [];
		const poolOsc = [];
		const poolGain = [];
		const poolPan = [];
		let poolCursor = 0;
		let aim = null;
		let flightSim = null;
		let flightPlanet = -1;
		let lastAimUpdate = -Infinity;
		let lastFlightUpdate = -Infinity;
		let nextLengthAt = 0;
		let nextEmcAt = 0;
		let previewStart = 0;
		let previewDuration = 4;
		let eventCursor = 0;
		let eventCount = 0;
		let eventsDirty = false;
		let lastAimChange = 0;
		let signCount = -1;
		let signSteps = -1;
		let signLogCount = -1;
		let signBody = -2;
		let signLength = -1;
		let signTime = -1;
		let signFieldT = NaN;
		let signStartStep = -1;
		const eventPlanet = new Int32Array(EVENTS);
		const eventAt = new Float64Array(EVENTS);
		const eventPan = new Float32Array(EVENTS);
		const eventLevel = new Float32Array(EVENTS);

		function fade(param, value, seconds) {
			const now = context.currentTime;
			if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
			else {
				param.cancelScheduledValues(now);
				param.setValueAtTime(param.value, now);
			}
			param.linearRampToValueAtTime(value, now + seconds);
		}

		function smooth(param, value, seconds) {
			param.setTargetAtTime(value, context.currentTime, seconds);
		}

		function gain(value, target) {
			const node = context.createGain();
			node.gain.value = value;
			if (target) node.connect(target);
			return node;
		}

		function oscillator(type, frequency, target) {
			const node = context.createOscillator();
			node.type = type;
			node.frequency.value = frequency;
			node.connect(target);
			node.start();
			return node;
		}

		function filter(frequency, target) {
			const node = context.createBiquadFilter();
			node.type = 'lowpass';
			node.frequency.value = frequency;
			node.Q.value = 0.7;
			node.connect(target);
			return node;
		}

		function panner(target) {
			if (context.createStereoPanner) {
				const node = context.createStereoPanner();
				node.connect(target);
				return node;
			}
			return gain(1, target);
		}

		function makeNoise() {
			const count = Math.round(context.sampleRate);
			const buffer = context.createBuffer(1, count, context.sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < count; i++) data[i] = Math.random() * 2 - 1;
			return buffer;
		}

		function buildGraph() {
			const limiter = context.createDynamicsCompressor();
			limiter.threshold.value = -10;
			limiter.knee.value = 12;
			limiter.ratio.value = 6;
			limiter.attack.value = 0.003;
			limiter.release.value = 0.18;
			limiter.connect(context.destination);
			master = gain(enabled && active ? volume : 0, limiter);
			aimBus = gain(0, master);
			profitFilter = filter(1400, aimBus);
			for (let i = 0; i < 3; i++) {
				chordGain[i] = gain(0.15, profitFilter);
				chordOsc[i] = oscillator(i === 1 ? 'triangle' : 'sine', 130.81, chordGain[i]);
			}
			for (let i = 0; i < POOL; i++) {
				poolPan[i] = panner(aimBus);
				poolGain[i] = gain(0, poolPan[i]);
				poolOsc[i] = oscillator('triangle', 440, poolGain[i]);
			}
			flightBus = gain(0, master);
			flightPan = panner(flightBus);
			flightTremolo = gain(0.82, flightPan);
			flightLevel = gain(0, flightTremolo);
			flightFilter = filter(1800, flightLevel);
			flightOsc[0] = oscillator('sine', 130.81, flightFilter);
			flightOsc[1] = oscillator('triangle', 261.62, flightFilter);
			flightLfoDepth = gain(0.16, flightTremolo.gain);
			flightLfo = oscillator('sine', 2.2, flightLfoDepth);
			blastGain = gain(0, master);
			blastFilter = filter(1600, blastGain);
			const noise = context.createBufferSource();
			noise.buffer = makeNoise();
			noise.loop = true;
			noise.connect(blastFilter);
			noise.start();
			boomGain = gain(0, master);
			boom = oscillator('sine', 90, boomGain);
		}

		function ensureContext() {
			if (context) return true;
			const AudioContext = host.AudioContext || host.webkitAudioContext;
			if (!AudioContext) return false;
			try {
				context = new AudioContext();
				buildGraph();
			} catch (err) {
				context = null;
				master = null;
				return false;
			}
			return true;
		}

		function applyLoop() {
			if (!context) return;
			const level = desired === 'idle' ? 0 : desired === 'armed' ? 0.13 : 0.18;
			fade(aimBus.gain, enabled && active ? level : 0, 0.12);
			if (flying) smooth(flightBus.gain, enabled && active && desired !== 'idle' ? 0.08 : 0.22, 0.12);
		}

		function unlock() {
			if (!enabled || !active || !ensureContext()) return;
			if (context.state === 'suspended') {
				const resumed = context.resume();
				if (resumed && resumed.catch) resumed.catch(() => {});
			}
			applyLoop();
		}

		function pluck(frequency, at, level, pan, decay) {
			const i = poolCursor;
			poolCursor = (poolCursor + 1) % POOL;
			const start = Math.max(at, context.currentTime);
			const osc = poolOsc[i];
			const envelope = poolGain[i].gain;
			osc.frequency.setValueAtTime(clamp(frequency, 30, 6000), start);
			envelope.cancelScheduledValues(start);
			envelope.setValueAtTime(0, start);
			envelope.linearRampToValueAtTime(level, start + 0.008);
			envelope.exponentialRampToValueAtTime(0.0001, start + decay);
			envelope.setValueAtTime(0, start + decay + 0.01);
			if (poolPan[i].pan) poolPan[i].pan.setValueAtTime(clamp(pan, -1, 1), start);
		}

		function profitNote(profit) {
			const degree = Math.round(clamp((profit + 6) / 18, 0, 1) * 14);
			return 130.81 * Math.pow(2, Math.floor(degree / 5) + PENTATONIC[degree % 5] / 12);
		}

		function lengthInterval(length) {
			const rate = 0.8 + 4.2 * Math.log1p(clamp(length, 0, 100000) / 1000) / Math.log(101);
			return 1 / rate;
		}

		function updateChord(data, now) {
			const profit = data.hasProfit ? clamp(data.profit, -6, 12) : 0;
			const magnitude = Math.min(1, Math.abs(profit) / 6);
			const root = profitNote(profit);
			const third = profit < -0.05 ? Math.pow(2, 3 / 12) : Math.pow(2, 4 / 12);
			smooth(chordOsc[0].frequency, root, 0.09);
			smooth(chordOsc[1].frequency, root * third, 0.09);
			smooth(chordOsc[2].frequency, root * 1.5, 0.09);
			const level = data.hasProfit ? 0.16 + magnitude * 0.18 : 0.1;
			smooth(chordGain[0].gain, level, 0.12);
			smooth(chordGain[1].gain, profit < -0.05 ? 0.12 : 0.18, 0.12);
			smooth(chordGain[2].gain, 0.14, 0.12);
			smooth(profitFilter.frequency, 600 + magnitude * 2400 + (profit > 0 ? 700 : 0), 0.15);
			if (aimMode === AIM_FLYTHROUGH) smooth(aimBus.gain, 0.07, 0.15);
			else if (desired !== 'idle') smooth(aimBus.gain, desired === 'armed' ? 0.13 : 0.18, 0.15);
			if (now >= nextLengthAt && aimMode === AIM_OUTCOME) {
				pluck(660 + magnitude * 220, now, 0.1, 0, 0.07);
				nextLengthAt = now + lengthInterval(data.length);
			}
		}

		function emcBeacon(data, now) {
			if (data.destination < 0 || now < nextEmcAt) return;
			const base = get_tone_pentatonic(data.destination);
			const blocked = data.emcKnown && !data.emcReady;
			const tier = clamp(data.emcTier, 0, 5);
			const interval = blocked ? Math.pow(2, 6 / 12) : tier >= 3 ? 1.5 : tier >= 1 ? 1.25 : 1.5;
			const level = blocked ? 0.1 : 0.12 + clamp(data.emcSpeed / 320, 0, 1) * 0.08;
			pluck(blocked ? base * 0.5 : base, now, level, data.pan, 0.22);
			pluck(blocked ? base * 0.53 : base * interval, now + 0.16, level * 0.8, data.pan, 0.28);
			nextEmcAt = now + 1.8;
		}

		function aimChanged(data) {
			const sim = data.sim;
			return sim.predCount !== signCount || sim.predSteps !== signSteps ||
				sim.predLogCount !== signLogCount || sim.predBody !== signBody ||
				sim.predLength !== signLength || sim.predTime !== signTime ||
				sim.predFieldT !== signFieldT || sim.routeStartStep !== signStartStep;
		}

		function rememberAim(data) {
			const sim = data.sim;
			signCount = sim.predCount;
			signSteps = sim.predSteps;
			signLogCount = sim.predLogCount;
			signBody = sim.predBody;
			signLength = sim.predLength;
			signTime = sim.predTime;
			signFieldT = sim.predFieldT;
			signStartStep = sim.routeStartStep;
		}

		function buildEvents(data, now) {
			const sim = data.sim;
			eventCount = 0;
			eventCursor = 0;
			previewStart = now + 0.05;
			previewDuration = clamp(sim.predTime * 0.25, 2, 8);
			if (data.tracing || sim.predCount < 2) return;
			const span = sim.predSteps - sim.routeStartStep;
			const stride = sim.routeStride > 0 ? sim.routeStride : 1;
			for (let i = 0; i < sim.predLogCount && eventCount < EVENTS - 1; i++) {
				const step = sim.predLogStep[i];
				const fraction = span > 0 ? clamp((step - sim.routeStartStep) / span, 0, 1) : 0;
				let point = Math.floor((step - sim.routeStartStep) / stride);
				point = Math.round(clamp(point, 0, sim.predCount - 1));
				eventPlanet[eventCount] = sim.predLogPlanet[i];
				eventAt[eventCount] = fraction * previewDuration;
				eventPan[eventCount] = clamp((sim.predX[point] - data.centerX) / (sim.worldW * 0.25), -1, 1);
				eventLevel[eventCount] = 0.16;
				eventCount++;
			}
			if (data.destination >= 0) {
				eventPlanet[eventCount] = data.destination;
				eventAt[eventCount] = previewDuration;
				eventPan[eventCount] = data.pan;
				eventLevel[eventCount] = 0.22;
				eventCount++;
			}
		}

		function runFlythrough(now) {
			if (eventsDirty && now - lastAimChange >= 0.12) {
				buildEvents(aim, now);
				eventsDirty = false;
			}
			if (eventsDirty) return;
			if (now > previewStart + previewDuration + 0.5) {
				previewStart = now + 0.1;
				eventCursor = 0;
			}
			while (eventCursor < eventCount && previewStart + eventAt[eventCursor] <= now + 0.04) {
				const i = eventCursor++;
				pluck(get_tone_pentatonic(eventPlanet[i]), previewStart + eventAt[i],
					eventLevel[i], eventPan[i], 0.3);
			}
		}

		function updateAim(data) {
			aim = data;
			if (!context || !enabled || !active || !data || desired === 'idle') return;
			const now = context.currentTime;
			if (now - lastAimUpdate < 0.04) return;
			lastAimUpdate = now;
			if (aimChanged(data)) {
				rememberAim(data);
				lastAimChange = now;
				eventsDirty = true;
				if (data.tracing) eventCount = 0;
			}
			updateChord(data, now);
			if (aimMode === AIM_FLYTHROUGH && !data.tracing) runFlythrough(now);
			else emcBeacon(data, now);
		}

		function nearestPlanet(sim) {
			const cargo = sim.cargo;
			let best = -1;
			let bestDistance = Infinity;
			let currentDistance = Infinity;
			for (let i = 0; i < sim.planetCount; i++) {
				if (sim.planetMask && !sim.planetMask[i]) continue;
				const dx = sim.planetX[i] - cargo.x;
				const dy = sim.planetY[i] - cargo.y;
				const distance = Math.sqrt(dx * dx + dy * dy);
				if (i === flightPlanet) currentDistance = distance;
				if (distance < bestDistance) {
					bestDistance = distance;
					best = i;
				}
			}
			if (best >= 0 && (flightPlanet < 0 || bestDistance < currentDistance * 0.9)) flightPlanet = best;
			return flightPlanet;
		}

		function updateFlight(sim) {
			flightSim = sim;
			if (!context || !enabled || !active || !flying || !sim || sim.status !== 1) return;
			const now = context.currentTime;
			if (now - lastFlightUpdate < 0.05) return;
			lastFlightUpdate = now;
			const planet = nearestPlanet(sim);
			if (planet < 0) return;
			const cargo = sim.cargo;
			const dx = sim.planetX[planet] - cargo.x;
			const dy = sim.planetY[planet] - cargo.y;
			const distance = Math.max(0, Math.sqrt(dx * dx + dy * dy) - sim.planetR[planet]);
			const range = clamp(distance / 1200, 0, 1);
			const proximity = 1 / (1 + Math.pow(distance / 300, 2));
			const pan = clamp(dx / (sim.worldW * 0.25), -1, 1);
			let frequency;
			if (flightMode === FLIGHT_INSTRUMENT) {
				const instrument = get_instrument(planet);
				frequency = clamp(instrument.pitch * Math.pow(2, range * 2), 80, 2400);
				flightOsc[0].type = instrument.wave;
				flightOsc[1].type = instrument.harmonic;
				smooth(flightOsc[1].frequency, frequency * instrument.ratio, 0.12);
				smooth(flightFilter.frequency, instrument.cutoff * (1 + range), 0.15);
				smooth(flightLfo.frequency, instrument.tremolo, 0.2);
			} else {
				frequency = get_tone_pentatonic(planet);
				flightOsc[0].type = 'sine';
				flightOsc[1].type = 'triangle';
				smooth(flightOsc[1].frequency, frequency * 2, 0.12);
				smooth(flightFilter.frequency, 1800, 0.15);
				smooth(flightLfo.frequency, 2.2, 0.2);
			}
			smooth(flightOsc[0].frequency, frequency, 0.12);
			smooth(flightLevel.gain, 0.04 + proximity * 0.34, 0.1);
			if (flightPan.pan) smooth(flightPan.pan, pan, 0.1);
		}

		function startFlight() {
			flying = true;
			flightPlanet = -1;
			lastFlightUpdate = -Infinity;
			if (!context || !enabled || !active) return;
			fade(flightBus.gain, desired === 'idle' ? 0.22 : 0.08, 0.2);
			if (flightSim) updateFlight(flightSim);
		}

		function launch() {
			setLoop('idle');
			startFlight();
			if (!context || !enabled || !active) return;
			const now = context.currentTime;
			blastGain.gain.cancelScheduledValues(now);
			blastGain.gain.setValueAtTime(0.28, now);
			blastGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
			blastFilter.frequency.cancelScheduledValues(now);
			blastFilter.frequency.setValueAtTime(1800, now);
			blastFilter.frequency.exponentialRampToValueAtTime(120, now + 1);
			boom.frequency.cancelScheduledValues(now);
			boom.frequency.setValueAtTime(90, now);
			boom.frequency.exponentialRampToValueAtTime(35, now + 0.8);
			boomGain.gain.cancelScheduledValues(now);
			boomGain.gain.setValueAtTime(0.24, now);
			boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
		}

		function stopFlight() {
			flying = false;
			if (context) fade(flightBus.gain, 0, 0.25);
		}

		function clearNotes() {
			if (!context) return;
			const now = context.currentTime;
			for (let i = 0; i < POOL; i++) {
				poolGain[i].gain.cancelScheduledValues(now);
				poolGain[i].gain.setValueAtTime(0, now);
			}
			eventCount = 0;
			eventCursor = 0;
			eventsDirty = false;
			nextLengthAt = now;
			nextEmcAt = now;
		}

		function stopAll() {
			if (!context) return;
			fade(aimBus.gain, 0, 0.08);
			fade(flightBus.gain, 0, 0.08);
			fade(blastGain.gain, 0, 0.08);
			fade(boomGain.gain, 0, 0.08);
			clearNotes();
		}

		function setLoop(name) {
			if (name !== 'aim' && name !== 'armed') name = 'idle';
			if (desired === name) return;
			desired = name;
			if (name === 'idle') clearNotes();
			else {
				nextLengthAt = 0;
				nextEmcAt = 0;
				previewStart = context ? context.currentTime : 0;
				eventCursor = 0;
				eventsDirty = Boolean(aim);
				lastAimChange = context ? context.currentTime : 0;
			}
			applyLoop();
		}

		function setEnabled(value) {
			enabled = Boolean(value);
			if (!context) return;
			if (!enabled) {
				stopAll();
				fade(master.gain, 0, 0.06);
				return;
			}
			fade(master.gain, active ? volume : 0, 0.06);
			applyLoop();
		}

		function setVolume(value) {
			volume = clamp(value, 0, 1);
			if (master && enabled && active) fade(master.gain, volume, 0.05);
		}

		function setActive(value) {
			active = Boolean(value);
			if (!context) return;
			if (!active) {
				stopAll();
				master.gain.cancelScheduledValues(context.currentTime);
				master.gain.setValueAtTime(0, context.currentTime);
				const suspended = context.suspend();
				if (suspended && suspended.catch) suspended.catch(() => {});
				return;
			}
			fade(master.gain, enabled ? volume : 0, 0.06);
			unlock();
		}

		function reset() {
			desired = 'idle';
			flying = false;
			aim = null;
			flightSim = null;
			stopAll();
		}

		function setAimMode(value) {
			aimMode = value === AIM_FLYTHROUGH ? AIM_FLYTHROUGH : AIM_OUTCOME;
			eventCursor = 0;
			previewStart = context ? context.currentTime : 0;
			nextLengthAt = 0;
			eventsDirty = Boolean(aim);
			lastAimChange = context ? context.currentTime : 0;
			if (aim && context) updateAim(aim);
		}

		function setFlightMode(value) {
			flightMode = value === FLIGHT_INSTRUMENT ? FLIGHT_INSTRUMENT : FLIGHT_PENTATONIC;
			flightPlanet = -1;
			lastFlightUpdate = -Infinity;
			if (flightSim && context) updateFlight(flightSim);
		}

		return { unlock, setLoop, launch, startFlight, stopFlight, setEnabled, setVolume, setActive, reset,
			updateAim, updateFlight, setAimMode, setFlightMode,
			phase: () => desired, enabled: () => enabled,
			aimMode: () => aimMode, flightMode: () => flightMode };
	}

	const api = { create, get_tone_pentatonic, get_instrument,
		AIM_OUTCOME, AIM_FLYTHROUGH, FLIGHT_PENTATONIC, FLIGHT_INSTRUMENT };
	root.GravityTrajectorySound = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
