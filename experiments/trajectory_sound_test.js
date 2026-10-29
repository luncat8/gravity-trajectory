/* Run: node experiments/trajectory_sound_test.js */
'use strict';

const assert = require('assert');
const GravitySound = require('../gravity_sound.js');
const Trajectory = require('../gravity_trajectory_sound.js');
const { loadPage } = require('./dom_stub.js');

class Param {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); }
	linearRampToValueAtTime(value, at) { this.value = value; this.events.push(['linear', value, at]); }
	exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push(['exp', value, at]); }
	setTargetAtTime(value, at, tau) { this.value = value; this.events.push(['target', value, at, tau]); }
	cancelScheduledValues(at) { this.events.push(['cancel', at]); }
	cancelAndHoldAtTime(at) { this.events.push(['hold', at]); }
}
class Node {
	constructor(kind, log) {
		this.kind = kind; this.log = log;
		this.gain = new Param(1); this.frequency = new Param(440); this.pan = new Param(0);
		this.detune = new Param(0); this.Q = new Param(1); this.delayTime = new Param(0);
		this.threshold = new Param(0); this.knee = new Param(0); this.ratio = new Param(1);
		this.attack = new Param(0); this.release = new Param(0);
		log.push(this);
	}
	connect(other) { this.to = other; return other; }
	start() { this.started = true; }
	stop(at) { this.stopped = at; }
}
class FakeContext {
	constructor() {
		this.currentTime = 1; this.sampleRate = 8000; this.state = 'suspended';
		this.destination = {}; this.nodes = []; this.suspends = 0;
		FakeContext.instances.push(this);
	}
	resume() { this.state = 'running'; return Promise.resolve(); }
	suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
	createGain() { return new Node('gain', this.nodes); }
	createOscillator() { return new Node('oscillator', this.nodes); }
	createBufferSource() { return new Node('buffer', this.nodes); }
	createBiquadFilter() { return new Node('filter', this.nodes); }
	createWaveShaper() { return new Node('shaper', this.nodes); }
	createDelay() { return new Node('delay', this.nodes); }
	createStereoPanner() { return new Node('panner', this.nodes); }
	createChannelMerger() { return new Node('merger', this.nodes); }
	createDynamicsCompressor() { return new Node('compressor', this.nodes); }
	createBuffer(channels, count) { return { getChannelData: () => new Float32Array(count) }; }
}
FakeContext.instances = [];
class FakeAudio {
	constructor() { this.listeners = {}; this.plays = 0; this.paused = true; FakeAudio.instances.push(this); }
	addEventListener(name, fn) { this.listeners[name] = fn; }
	load() {}
	pause() { this.paused = true; }
	play() { this.plays++; this.paused = false; return Promise.resolve(); }
	emit(name) { if (this.listeners[name]) this.listeners[name](); }
}
FakeAudio.instances = [];
const host = { AudioContext: FakeContext, Audio: FakeAudio, performance: { now: () => 0 }, setTimeout() {} };

function aimFixture() {
	return {
		ready: true, tracing: false, hasProfit: true, profit: 2, length: 1000,
		destination: 2, emcKnown: true, emcReady: true, emcTier: 3, emcSpeed: 220,
		sim: {
			predCount: 3, predSteps: 120, predTime: 1, predLength: 1000, predReason: 1, predBody: 2,
			predLogCount: 2, predLogPlanet: Int32Array.from([1, 2]), predLogStep: Int32Array.from([40, 80]),
			predX: Float32Array.from([0, 100, 180]), predY: Float32Array.from([0, 0, 0]),
			planetX: Float64Array.from([0, 100, 200]), planetY: Float64Array.from([0, -50, -50]),
			predFieldT: 0, routeStartStep: 0, routeStride: 60, angle: 0
		}
	};
}
function flightFixture() {
	return {
		status: 1, angle: 0, cargo: { x: 0, y: 0, vx: 1, vy: 0 },
		planetCount: 1, planetMask: null,
		planetX: Float64Array.from([0]), planetY: Float64Array.from([-100]), planetR: Float64Array.from([10])
	};
}
function oscillators(ctx) { return ctx.nodes.filter(n => n.kind === 'oscillator'); }
function panners(ctx) { return ctx.nodes.filter(n => n.kind === 'panner'); }
function sideGains(ctx) {
	return ctx.nodes.filter(n => n.kind === 'gain' && n.to && n.to.kind === 'merger');
}

/* Deterministic planet identities, independent of audio state. */
const toneA = Trajectory.get_tone_pentatonic(3);
assert.strictEqual(toneA, Trajectory.get_tone_pentatonic(3));
assert.notStrictEqual(toneA, Trajectory.get_tone_pentatonic(4));
assert.strictEqual(Trajectory.get_instrument(3), Trajectory.get_instrument(3));
assert.notStrictEqual(Trajectory.get_instrument(3).wave, Trajectory.get_instrument(4).wave);

const sound = GravitySound.createController({ host, files: { aim: 'aim.wav' } });
assert.strictEqual(sound.engine(), 'trajectory');
assert.strictEqual(FakeAudio.instances.length, 0, 'the default generator never loads samples');
const aim = aimFixture();
sound.setLoop('aim');
sound.updateAim(aim);
assert.strictEqual(FakeContext.instances.length, 0, 'telemetry before a gesture must not create audio');
sound.unlock();
const ctx = FakeContext.instances[0];
assert.strictEqual(ctx.state, 'running');
const chord = oscillators(ctx).slice(0, 3);
sound.updateAim(aim);
assert(panners(ctx)[2].pan.value < 0,
	'the destination EMC beacon is panned by its bearing from the predicted arrival heading');
const positiveRoot = chord[0].frequency.value;
assert(chord.every(n => n.started), 'persistent chord voices start once');
aim.profit = -4;
ctx.currentTime += 0.1;
sound.updateAim(aim);
assert(chord[0].frequency.value < positiveRoot, 'negative profit lowers the chord root');
const minorThird = chord[1].frequency.value / chord[0].frequency.value;
assert(Math.abs(minorThird - Math.pow(2, 3 / 12)) < 1e-6, 'loss uses a minor third');
/* chord, aim orientation drone, then the pluck pool, then flight and boom */
const pool = oscillators(ctx).slice(4, 12);
const ticksBefore = pool.reduce((sum, n) => sum + n.frequency.events.length, 0);
ctx.currentTime += 1;
sound.updateAim(aim);
assert(pool.reduce((sum, n) => sum + n.frequency.events.length, 0) > ticksBefore, 'length ticks run');
aim.destination = 2;
aim.emcReady = false;
const beaconBefore = pool.reduce((sum, n) => sum + n.frequency.events.length, 0);
ctx.currentTime += 2;
sound.updateAim(aim);
assert(pool.reduce((sum, n) => sum + n.frequency.events.length, 0) >= beaconBefore + 2,
	'a blocked EMC destination gets a two-note beacon');

/* Aim orientation: pan points where the grip is pulled, pitch and volume
 * tell how hard, the note names the launch planet. */
const oriented = aimFixture();
oriented.aimBody = 0;
oriented.aimAngle = 0;
oriented.aimSpeed = 40;
oriented.aimCeiling = 80;
ctx.currentTime += 0.2;
sound.updateAim(oriented);
/* the orientation voice: launch-planet note oscillator -> gain -> panner */
const aimGainNode = ctx.nodes.find(n => n.kind === 'gain' && n.to && n.to.kind === 'panner');
const aimPan = aimGainNode.to;
const aimVoice = ctx.nodes.find(n => n.kind === 'oscillator' && n.to === aimGainNode);
assert(aimVoice, 'the orientation voice exists');
assert.strictEqual(aimPan.kind, 'panner', 'the orientation voice goes through a panner');
assert.strictEqual(aimPan.pan.value, 1, 'aiming straight right pans straight right');
assert(aimGainNode.gain.value > 0, 'the orientation drone is audible while aiming');
const firstPitch = aimVoice.frequency.value;
assert(firstPitch > Trajectory.get_tone_pentatonic(0), 'a stronger pull raises the aim pitch');
oriented.aimAngle = Math.PI;
oriented.aimSpeed = 70;
ctx.currentTime += 0.1;
sound.updateAim(oriented);
assert(aimPan.pan.value < -0.9, 'aiming left pans left');
assert(aimVoice.frequency.value > firstPitch, 'pulling harder raises the orientation pitch');
assert(aimVoice.frequency.value < Trajectory.get_tone_pentatonic(0) * 2,
	'the orientation pitch stays within one octave of the launch note');
/* no aim data: the orientation drone fades out and nothing else breaks */
sound.updateAim(null);
const dead = aimFixture();
dead.aimBody = -1; dead.aimAngle = 0; dead.aimSpeed = 0; dead.aimCeiling = 0;
ctx.currentTime += 0.2;
sound.updateAim(dead);
assert.strictEqual(aimGainNode.gain.value, 0, 'without aim data the orientation drone is silent');

sound.setAimMode('flythrough');
ctx.currentTime += 0.2;
const fly = aimFixture();
fly.aimBody = 7;
sound.updateAim(fly);
ctx.currentTime += 1.2;
sound.updateAim(fly);
ctx.currentTime += 1.2;
sound.updateAim(fly);
const played = pool.flatMap(n => n.frequency.events.filter(e => e[0] === 'set').map(e => e[1]));
assert(played.some(f => Math.abs(f - Trajectory.get_tone_pentatonic(7)) < 1e-6),
	'fly-through opens with the launch planet note');
assert(played.some(f => Math.abs(f - Trajectory.get_tone_pentatonic(1)) < 1e-6),
	'fly-through plays the first predicted planet');
assert(played.some(f => Math.abs(f - Trajectory.get_tone_pentatonic(2)) < 1e-6),
	'fly-through reaches the destination planet');
assert(played.some(f => Math.abs(f - Trajectory.get_tone_pentatonic(2) * 1.5) < 1e-6),
	'fly-through closes the destination phrase on a fifth');
const firstVisitIndex = pool.findIndex(n => n.frequency.events.some(e =>
	e[0] === 'set' && Math.abs(e[1] - Trajectory.get_tone_pentatonic(1)) < 1e-6));
assert(firstVisitIndex >= 0);
assert(panners(ctx)[firstVisitIndex + 1].pan.value < 0,
	'fly-through pans a planet on the ship-left side of its local trajectory heading');

/* Flight: nearest planet, distance, and bearing relative to the live ship heading. */
const flight = flightFixture();
sound.launch();
sound.updateFlight(flight);
const flightVoices = oscillators(ctx).slice(12, 14);
const sides = sideGains(ctx);
assert.strictEqual(sides.length, 2, 'flight splits into explicit left and right gains');
const flightLGain = sides[0];
const flightRGain = sides[1];
assert(Math.abs(flightVoices[0].frequency.value - Trajectory.get_tone_pentatonic(0)) < 1e-6);
assert(flightLGain.gain.value > flightRGain.gain.value,
	'a planet above a right-facing ship pans to ship-left');
const nearLevel = flightLGain.gain.value + flightRGain.gain.value;
flight.cargo.x = 1000;
ctx.currentTime += 0.1;
sound.updateFlight(flight);
assert(flightLGain.gain.value + flightRGain.gain.value < nearLevel, 'distance lowers flight volume');
assert.strictEqual(flightVoices[0].frequency.value, Trajectory.get_tone_pentatonic(0),
	'pentatonic identity stays stable with distance');
flight.cargo.x = 0;
flight.cargo.vx = -1;
ctx.currentTime += 0.1;
sound.updateFlight(flight);
assert(flightRGain.gain.value > flightLGain.gain.value,
	'the same planet moves to ship-right when the ship turns around');
flight.cargo.vx = 1;
flight.planetX[0] = 100;
flight.planetY[0] = 0;
ctx.currentTime += 0.1;
sound.updateFlight(flight);
assert(Math.abs(flightLGain.gain.value - flightRGain.gain.value) < 1e-6,
	'a planet directly ahead is centered rather than pinned to a screen side');

flight.cargo.x = 0;
flight.planetX[0] = 0;
flight.planetY[0] = -100;
sound.setFlightMode('instrument');
ctx.currentTime += 0.1;
sound.updateFlight(flight);
const nearPitch = flightVoices[0].frequency.value;
const instrument = Trajectory.get_instrument(0);
assert.strictEqual(flightVoices[0].type, instrument.wave);
const nearSideLevel = flightLGain.gain.value + flightRGain.gain.value;
flight.cargo.x = 1000;
ctx.currentTime += 0.1;
sound.updateFlight(flight);
assert(flightVoices[0].frequency.value > nearPitch, 'alternate mapping raises pitch with distance');
assert(flightLGain.gain.value + flightRGain.gain.value < nearSideLevel,
	'alternate mapping lowers volume with distance');
assert(flightLGain.gain.value > flightRGain.gain.value,
	'a distant planet remains on the correct side relative to the current heading');

/* Backend switches preserve preferences and stage without loading samples for fallback. */
sound.setVolume(0.25);
sound.setEnabled(false);
assert.strictEqual(sound.setEngine('samples'), true);
assert.strictEqual(sound.enabled(), false);
assert.strictEqual(sound.volume(), 0.25);
assert.strictEqual(sound.phase(), 'idle');
const sampleCount = FakeAudio.instances.length;
assert(sampleCount > 0, 'selected-sample backend loads its media');
assert.strictEqual(sound.setEngine('fallback'), true);
assert.strictEqual(FakeAudio.instances.length, sampleCount, 'classic fallback explicitly disables media');
sound.setEnabled(true);
sound.setLoop('armed');
assert.strictEqual(sound.phase(), 'armed');
sound.setEngine('trajectory');
sound.unlock();
const liveContext = FakeContext.instances.at(-1);
sound.setActive(false);
assert(liveContext.suspends > 0, 'backgrounding suspends the trajectory graph');
sound.setActive(true);
sound.reset();
assert.strictEqual(sound.phase(), 'idle');

/* Settings are real controls, persist, and restore without a build step. */
const storage = {
	'gravity-sound-enabled': 'false',
	'gravity-sound-engine': 'fallback',
	'gravity-sound-aim': 'flythrough',
	'gravity-sound-flight': 'instrument',
	'gravity-sound-volume': '30'
};
const env = loadPage({ search: '?mode=lab&seed=7', storage });
const scene = env.context.GravityScene;
const ui = env.elements;
assert.strictEqual(scene.sound.engine(), 'fallback');
assert.strictEqual(scene.sound.enabled(), false, 'an explicit mute survives the new default');
assert.strictEqual(ui.get('soundAim').value, 'flythrough');
assert.strictEqual(ui.get('soundFlight').value, 'instrument');
assert.strictEqual(ui.get('soundVolume').value, '30');
assert.strictEqual(ui.get('trajectorySoundOptions').hidden, true);
ui.get('soundEngine').value = 'trajectory';
env.fireElement(ui.get('soundEngine'), 'change');
assert.strictEqual(scene.sound.engine(), 'trajectory');
assert.strictEqual(storage['gravity-sound-engine'], 'trajectory');
assert.strictEqual(ui.get('trajectorySoundOptions').hidden, false);
ui.get('soundFlight').value = 'pentatonic';
env.fireElement(ui.get('soundFlight'), 'change');
assert.strictEqual(storage['gravity-sound-flight'], 'pentatonic');
env.setValue('soundVolume', '60');
assert.strictEqual(scene.sound.volume(), 0.6);
assert.strictEqual(storage['gravity-sound-volume'], '60');
assert.strictEqual(ui.get('soundVolumeLabel').textContent, '60%');
console.log('TRAJECTORY SOUND TEST OK: default, aim data, aim orientation, fly-through, both flight mappings, switching, mute and settings');
