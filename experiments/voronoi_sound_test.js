/* Run: node experiments/voronoi_sound_test.js */
'use strict';
const assert = require('assert');
const Voronoi = require('../gravity_voronoi_sound.js');
const GravitySound = require('../gravity_sound.js');
const Tones = require('../gravity_voronoi_tones.js');
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

// Independent reference for the experiment's distance preset: 54 / 53 / 6.
const sourceFreq = d => 10 * 1000 ** Math.exp(-d / (280 * (20 / 280) ** 0.54));
const sourceVolume = d => 1 / (1 + (d / (320 * (22 / 320) ** 0.53)) ** 2);
const sourceRate = d => 0.1 * 300 ** Math.exp(-Math.max(0, d - 20) / (300 * (28 / 300) ** 0.06));
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9 * Math.max(1, expected), `${actual} != ${expected}`);
const directCtx = new Context();
const direct = Voronoi.create(directCtx, directCtx.destination, undefined, 'distance');
const one = { cargo: { x: 0, y: 0, vx: 1, vy: 0 }, planetCount: 1, planetX: [50], planetY: [0] };
const directCarrier = directCtx.nodes.find(n => n.kind === 'osc' && n.to && n.to.kind === 'filter');
const directFilter = directCarrier.to;
const directEnv = directFilter.to;
const directLevel = directEnv.to;
const directLfo = directCtx.nodes.find(n => n.kind === 'osc' && n.to && n.to.to === directEnv.gain);
for (const distance of [50, 150, 300]) {
	one.planetX[0] = distance;
	direct.update(one);
	const experimentDistance = distance * 0.75;
	close(directCarrier.frequency.value, sourceFreq(experimentDistance));
	close(directLevel.gain.value, 0.46 * sourceVolume(experimentDistance));
	close(directLfo.frequency.value, sourceRate(experimentDistance));
}
direct.setDistanceScale(1);
one.planetX[0] = 150;
direct.update(one);
close(directCarrier.frequency.value, sourceFreq(150));
direct.setDistanceScale(0.25); direct.update(one);
close(directCarrier.frequency.value, sourceFreq(37.5));
// First preset: experiment point pitches with 39 / 77 volume and envelope.
const pointCtx = new Context();
const point = Voronoi.create(pointCtx, pointCtx.destination, 1);
const field = { cargo: { x: 0, y: 0, vx: 1, vy: 0 }, planetCount: 3,
	planetX: [50, 160, 100], planetY: [0, 0, 100] };
point.update(field);
const pointCarrier = pointCtx.nodes.find(n => n.kind === 'osc' && n.to && n.to.kind === 'filter');
const pointFilter = pointCarrier.to;
const pointEnv = pointFilter.to;
const pointLevel = pointEnv.to;
const pointLfo = pointCtx.nodes.find(n => n.kind === 'osc' && n.to && n.to.to === pointEnv.gain);
// Build the source experiment's initial tones and two adjacency refinement passes.
const xs = field.planetX.map(x => x * 0.75), ys = field.planetY.map(y => y * 0.75);
const semitones = new Int16Array(3), nbr = new Int32Array(9), nbrCount = new Int32Array(3);
for (let i = 0; i < 3; i++) semitones[i] = Tones.pick(xs[i], ys[i], xs, ys, semitones, i, -1);
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
	if (!Voronoi.adjacent(field, i, j)) continue;
	nbr[i * 3 + nbrCount[i]++] = j; nbr[j * 3 + nbrCount[j]++] = i;
}
Tones.tuneField(xs, ys, semitones, 3, nbr, nbrCount, 3);
const pointPitch = Tones.hz(semitones[0]);
close(pointCarrier.frequency.value, pointPitch);
close(pointLevel.gain.value, 0.46 * Tones.distVolume(50, 0.39));
close(pointLfo.frequency.value, Tones.envRate(50, 0.77));
field.cargo.x = 20; point.update(field);
close(pointCarrier.frequency.value, pointPitch);
close(pointLevel.gain.value, 0.46 * Tones.distVolume(30, 0.39));
point.setDistanceScale(0.5); point.update(field);
close(pointCarrier.frequency.value, pointPitch);
close(pointLevel.gain.value, 0.46 * Tones.distVolume(15, 0.39));
point.setPreset('distance'); point.update(field);
close(pointCarrier.frequency.value, Tones.distFreq(15, 0.54));
close(pointLevel.gain.value, 0.46 * Tones.distVolume(15, 0.53));
close(pointLfo.frequency.value, Tones.envRate(15, 0.06));
point.setPreset('point'); point.update(field);
close(pointCarrier.frequency.value, pointPitch);
field.planetMask = [0, 1, 1]; point.update(field);
assert.strictEqual(pointLevel.gain.value, 0, 'removed point voice releases');
Context.instances.length = 0;

const host = { AudioContext: Context };
const sound = GravitySound.createController({ host });
assert.strictEqual(sound.engine(), 'voronoi');
assert.strictEqual(sound.voronoiPreset(), 'point');
sound.setVoronoiPreset('distance');
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
sound.setVoronoiPreset('point');
assert.notStrictEqual(voiceOsc.frequency.value, pitch, 'preset change immediately updates live voices');
sound.setVoronoiPreset('distance');
close(voiceOsc.frequency.value, pitch);
assert.strictEqual(sound.distanceScale(), 0.75);
sound.setDistanceScale(0.5);
assert(voiceOsc.frequency.value > pitch, 'changing the scale immediately updates live voices');
sound.setDistanceScale(0.75);
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

const storage = {};
const env = loadPage({ search: '?mode=lab&seed=7', storage });
assert.strictEqual(env.context.GravityScene.sound.engine(), 'voronoi');
assert.strictEqual(env.elements.get('soundEngine').value, 'voronoi');
assert.strictEqual(env.elements.get('soundFlightControl').hidden, true);
assert.strictEqual(env.elements.get('soundDistanceControl').hidden, false);
assert.strictEqual(env.elements.get('soundVoronoiPresetControl').hidden, false);
assert.strictEqual(env.elements.get('soundVoronoiPreset').value, 'point');
assert.strictEqual(env.context.GravityScene.sound.voronoiPreset(), 'point');
assert.strictEqual(env.elements.get('soundDistance').value, '0.75');
env.elements.get('soundDistance').value = '1.25';
env.fireElement(env.elements.get('soundDistance'), 'input');
assert.strictEqual(env.context.GravityScene.sound.distanceScale(), 1.25);
assert.strictEqual(env.elements.get('soundDistanceLabel').textContent, '×1.25');
env.elements.get('soundVoronoiPreset').value = 'distance';
env.fireElement(env.elements.get('soundVoronoiPreset'), 'change');
assert.strictEqual(env.context.GravityScene.sound.voronoiPreset(), 'distance');
assert.strictEqual(storage['gravity-sound-voronoi-preset'], 'distance');
assert.strictEqual(loadPage({ storage }).context.GravityScene.sound.voronoiPreset(), 'distance');
env.elements.get('soundEngine').value = 'trajectory';
env.fireElement(env.elements.get('soundEngine'), 'change');
assert.strictEqual(env.elements.get('soundFlightControl').hidden, false);
assert.strictEqual(env.elements.get('soundDistanceControl').hidden, true);
assert.strictEqual(env.elements.get('soundVoronoiPresetControl').hidden, true);
env.elements.get('soundEngine').value = 'voronoi';
env.fireElement(env.elements.get('soundEngine'), 'change');
assert.strictEqual(env.context.GravityScene.sound.distanceScale(), 1.25);
assert.strictEqual(env.context.GravityScene.sound.voronoiPreset(), 'distance');
assert.strictEqual(env.elements.get('soundDistanceControl').hidden, false);
env.elements.get('soundEngine').value = 'trajectory';
env.fireElement(env.elements.get('soundEngine'), 'change');
assert.strictEqual(env.context.GravityScene.sound.engine(), 'trajectory');
const saved = loadPage({ storage: { 'gravity-sound-engine': 'trajectory', 'gravity-sound-enabled': 'false', 'gravity-sound-distance-scale': '1.25', 'gravity-sound-voronoi-preset': 'distance' } });
assert.strictEqual(saved.context.GravityScene.sound.distanceScale(), 1.25);
assert.strictEqual(saved.context.GravityScene.sound.voronoiPreset(), 'distance');
const invalid = loadPage({ storage: { 'gravity-sound-distance-scale': '100' } });
assert.strictEqual(invalid.context.GravityScene.sound.distanceScale(), 0.75);
const old = loadPage({ storage: { 'gravity-sound-engine': 'voronoi' } });
assert.strictEqual(old.context.GravityScene.sound.voronoiPreset(), 'point', 'existing Voronoi users get the new default');
assert.strictEqual(saved.context.GravityScene.sound.engine(), 'trajectory');
assert.strictEqual(saved.context.GravityScene.sound.enabled(), false);
console.log('VORONOI SOUND TEST OK: point and distance presets, adjacency, voice identities, stereo, lifecycle and settings');
