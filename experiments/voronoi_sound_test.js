/* Run: node experiments/voronoi_sound_test.js */
'use strict';
const assert = require('assert');
const Voronoi = require('../gravity_voronoi_sound.js');
const GravitySound = require('../gravity_sound.js');
const { loadPage } = require('./dom_stub.js');

class Param {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(v) { this.value = v; this.events.push(['set', v]); }
	setTargetAtTime(v) { this.value = v; this.events.push(['target', v]); }
	linearRampToValueAtTime(v) { this.value = v; }
	exponentialRampToValueAtTime(v) { this.value = v; }
	cancelScheduledValues() {}
	cancelAndHoldAtTime() {}
}
class Node {
	constructor(kind, nodes) {
		this.kind = kind; this.gain = new Param(1); this.frequency = new Param(440);
		this.pan = new Param(); this.Q = new Param(); this.threshold = new Param();
		this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param();
		nodes.push(this);
	}
	connect(n) { this.to = n; return n; }
	start() {}
}
class Context {
	constructor() { this.currentTime = 1; this.sampleRate = 8000; this.state = 'suspended'; this.nodes = []; this.destination = {}; Context.instances.push(this); }
	createGain() { return new Node('gain', this.nodes); }
	createOscillator() { return new Node('osc', this.nodes); }
	createStereoPanner() { return new Node('pan', this.nodes); }
	createBiquadFilter() { return new Node('filter', this.nodes); }
	createDynamicsCompressor() { return new Node('compressor', this.nodes); }
	createChannelMerger() { return new Node('merger', this.nodes); }
	createBufferSource() { return new Node('source', this.nodes); }
	createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
	resume() { this.state = 'running'; return Promise.resolve(); }
	suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
Context.instances = [];
const sim = {
	status: 1, angle: 0, cargo: { x: 10, y: 0, vx: 1, vy: 0 }, planetCount: 4,
	planetX: [0, 100, 200, 100], planetY: [0, 0, 0, -100], planetR: [20, 20, 20, 20], planetMask: null
};
assert(Voronoi.adjacent(sim, 0, 1));
assert(!Voronoi.adjacent(sim, 0, 2), 'a site hidden behind another is not a neighbor');
assert(Voronoi.adjacent(sim, 0, 3));
assert.strictEqual(Voronoi.distanceFrequency(0), 10000);
assert(Voronoi.distanceFrequency(100) > Voronoi.distanceFrequency(300));
assert(Voronoi.distanceVolume(100) > Voronoi.distanceVolume(300));
assert.strictEqual(Voronoi.envelopeDepth(19), 0);
assert.strictEqual(Voronoi.envelopeDepth(28), 1);
assert(Voronoi.envelopeRate(20) > Voronoi.envelopeRate(200));

const host = { AudioContext: Context };
const sound = GravitySound.createController({ host });
assert.strictEqual(sound.engine(), 'voronoi');
sound.startFlight(); sound.updateFlight(sim);
assert.strictEqual(Context.instances.length, 0, 'telemetry cannot bypass gesture gating');
sound.unlock();
const ctx = Context.instances[0];
sound.updateFlight(sim);
const pans = ctx.nodes.filter(n => n.kind === 'pan');
// Eight aim panners and the orientation panner precede 24 Voronoi voices.
const voices = pans.slice(9);
assert.strictEqual(voices.length, 24);
const active = voices.filter(n => n.to && ctx.nodes.some(g => g.to === n && g.gain.value > 0));
assert.strictEqual(active.length, 3, 'only nearest and its adjacent cells sound');
const left = active.find(n => n.pan.value < -0.1);
assert(left, 'ship-left neighbor is panned left');
const voiceOsc = ctx.nodes.find(n => n.kind === 'osc' && n.to && n.to.kind === 'filter' && n.to.to && n.to.to.to && n.to.to.to.to === left);
assert(voiceOsc, 'voice graph uses triangle carrier and lowpass');
const pitch = voiceOsc.frequency.value;
sim.cargo.y = -50; ctx.currentTime += 0.1; sound.updateFlight(sim);
assert(voiceOsc.frequency.value > pitch, 'same cell voice rises in pitch as ship approaches');
sim.cargo.vx = -1; ctx.currentTime += 0.1; sound.updateFlight(sim);
assert(left.pan.value > 0, 'turning the ship reverses relative bearing');
sim.planetMask = [1, 0, 0, 0]; ctx.currentTime += 0.1; sound.updateFlight(sim);
assert.strictEqual(ctx.nodes.find(g => g.to === left && g.kind === 'gain').gain.value, 0, 'masked cells release');
sound.updateFlight(null);
assert(voices.every(n => ctx.nodes.find(g => g.to === n && g.kind === 'gain').gain.value === 0), 'missing telemetry silences flight');
sound.setEnabled(false); sound.setActive(false);
assert.strictEqual(ctx.state, 'suspended');
sound.setEngine('trajectory'); assert.strictEqual(sound.enabled(), false);
sound.setEngine('voronoi'); assert.strictEqual(sound.enabled(), false);

const env = loadPage({ search: '?mode=lab&seed=7', storage: {} });
assert.strictEqual(env.context.GravityScene.sound.engine(), 'voronoi');
assert.strictEqual(env.elements.get('soundEngine').value, 'voronoi');
assert.strictEqual(env.elements.get('soundFlightControl').hidden, true);
env.elements.get('soundEngine').value = 'trajectory';
env.fireElement(env.elements.get('soundEngine'), 'change');
assert.strictEqual(env.elements.get('soundFlightControl').hidden, false);
assert.strictEqual(env.context.GravityScene.sound.engine(), 'trajectory');
const saved = loadPage({ storage: { 'gravity-sound-engine': 'trajectory', 'gravity-sound-enabled': 'false' } });
assert.strictEqual(saved.context.GravityScene.sound.engine(), 'trajectory');
assert.strictEqual(saved.context.GravityScene.sound.enabled(), false);
console.log('VORONOI SOUND TEST OK: distance preset, adjacency, voice identities, stereo, lifecycle and settings');
