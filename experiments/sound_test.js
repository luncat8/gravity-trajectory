/* Run: node experiments/sound_test.js */
'use strict';

const assert = require('assert');
const GravitySound = require('../gravity_sound.js');
const { loadPage } = require('./dom_stub.js');

class Param {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); }
	linearRampToValueAtTime(value, at) { this.value = value; this.events.push(['linear', value, at]); }
	exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push(['exp', value, at]); }
	cancelScheduledValues(at) { this.events.push(['cancel', at]); }
	cancelAndHoldAtTime(at) { this.events.push(['hold', at]); }
}

class Node {
	constructor(kind, log) {
		this.kind = kind;
		this.log = log;
		this.gain = new Param(1);
		this.frequency = new Param(0);
		this.detune = new Param(0);
		this.delayTime = new Param(0);
		this.log.push(this);
	}
	connect(other) { this.to = other; return other; }
	start() { this.started = true; }
	stop(at) { this.stopped = at; }
}

class FakeContext {
	constructor() {
		this.currentTime = 3;
		this.sampleRate = 44100;
		this.state = 'suspended';
		this.destination = {};
		this.nodes = [];
		FakeContext.instances.push(this);
	}
	resume() { this.state = 'running'; return Promise.resolve(); }
	createGain() { return new Node('gain', this.nodes); }
	createOscillator() { return new Node('oscillator', this.nodes); }
	createBufferSource() { return new Node('buffer', this.nodes); }
	createBiquadFilter() { return new Node('filter', this.nodes); }
	createWaveShaper() { return new Node('shaper', this.nodes); }
	createDelay() { return new Node('delay', this.nodes); }
	createMediaElementSource() { return new Node('media', this.nodes); }
	createBuffer(channels, count) { return { getChannelData: () => new Float32Array(count) }; }
}
FakeContext.instances = [];

class FakeAudio {
	constructor() { this.listeners = {}; this.plays = 0; this.paused = true; FakeAudio.instances.push(this); }
	addEventListener(name, fn) { this.listeners[name] = fn; }
	load() {}
	pause() { this.paused = true; }
	play() { this.plays++; this.paused = false; return Promise.resolve(); }
	emit(name) { this.listeners[name](); }
}
FakeAudio.instances = [];

const timers = [];
let clock = 0;
const host = {
	AudioContext: FakeContext, Audio: FakeAudio, performance: { now: () => clock },
	setTimeout(fn, ms) { timers.push({ fn, at: clock + ms }); }
};
function advance(ms) {
	const end = clock + ms;
	while (true) {
		timers.sort((a, b) => a.at - b.at);
		if (!timers.length || timers[0].at > end) break;
		const next = timers.shift();
		clock = next.at;
		next.fn();
	}
	clock = end;
}
const sound = GravitySound.create({ host, files: { aim: 'aim.wav', armed: 'armed.wav' } });
const aimFile = FakeAudio.instances[0];
const armedFile = FakeAudio.instances[1];
assert.strictEqual(FakeContext.instances.length, 0, 'page load must not create an audio context');
sound.setActive(true);
assert.strictEqual(FakeContext.instances.length, 0, 'focus must not bypass the gesture requirement');
sound.setLoop('aim');
sound.unlock();
const ctx = FakeContext.instances[0];
assert(ctx && ctx.state === 'running');
assert(ctx.nodes.filter(n => n.kind === 'oscillator' && n.started).length >= 2, 'guitar synth starts');
assert.strictEqual(sound.phase(), 'aim');

aimFile.emit('canplay');
assert.strictEqual(aimFile.plays, 1, 'a late selected take crossfades in');
sound.setLoop('armed');
assert(ctx.nodes.some(n => n.kind === 'buffer' && n.started), 'shimmer synth starts');
assert(ctx.nodes.some(n => n.kind === 'oscillator' && n.stopped), 'old guitar fades out');
armedFile.emit('canplay');
assert.strictEqual(armedFile.plays, 1);
sound.setLoop('aim');
assert.strictEqual(aimFile.plays, 2, 'returning to aim restarts the chosen loop');
advance(400);
assert.strictEqual(aimFile.paused, false, 'a stale fade timer must not pause the restarted loop');
assert(aimFile.volume > 0, 'selected audio fades in through its native media volume');
assert(!ctx.nodes.some(n => n.kind === 'media'), 'file:// media must not be routed through Web Audio');

sound.setLoop('idle');
const before = ctx.nodes.length;
sound.launch();
assert(ctx.nodes.slice(before).some(n => n.kind === 'delay'), 'thunder has an echo');
assert(ctx.nodes.slice(before).some(n => n.kind === 'oscillator' && n.stopped === 13), 'flight is capped at ten seconds');
sound.stopFlight();
assert(ctx.nodes.some(n => n.kind === 'oscillator' && n.stopped === 3.32), 'early landing fades the flight cue');
sound.setLoop('armed');
const armedPlays = armedFile.plays;
sound.setEnabled(false);
assert.strictEqual(sound.enabled(), false);
advance(400);
assert.strictEqual(armedFile.paused, true, 'mute stops a playing loop');
sound.setEnabled(true);
assert.strictEqual(armedFile.plays, armedPlays + 1, 'unmuting resumes only the current loop');
sound.setActive(false);
assert(armedFile.paused && armedFile.volume === 0, 'backgrounding stops media even if timers are throttled');
sound.setActive(true);
assert.strictEqual(armedFile.plays, armedPlays + 2, 'focus restores the current loop');
sound.reset();
assert.strictEqual(sound.phase(), 'idle');

/* A file that becomes ready after cancellation must not start a stale loop. */
const late = GravitySound.create({ host, files: { aim: 'late.wav' } });
const lateFile = FakeAudio.instances[2];
late.unlock();
late.setLoop('aim');
late.setLoop('idle');
lateFile.emit('canplay');
assert.strictEqual(lateFile.plays, 0);

/* A media error after playback starts replaces it with the procedural cue. */
const fault = GravitySound.create({ host, files: { aim: 'fault.wav' } });
const faultFile = FakeAudio.instances[3];
fault.unlock();
const faultCtx = FakeContext.instances.at(-1);
faultFile.emit('canplay');
fault.setLoop('aim');
assert.strictEqual(faultFile.plays, 1);
const beforeError = faultCtx.nodes.length;
faultFile.emit('error');
assert(faultCtx.nodes.slice(beforeError).some(n => n.kind === 'oscillator' && n.started),
	'a failed selected loop falls back to synth');
advance(100);
assert(faultFile.paused, 'the failed file is stopped');

/* Selected launch and flight sounds are one-shots; flight fades at ten seconds. */
const shots = GravitySound.create({ host, files: { launch: 'launch.wav', fly: 'fly.wav' } });
const launchFile = FakeAudio.instances[4];
const flyFile = FakeAudio.instances[5];
launchFile.emit('canplay');
flyFile.emit('canplay');
shots.unlock();
shots.launch();
advance(600);
assert(!launchFile.loop && !flyFile.loop && !launchFile.paused && !flyFile.paused);
assert(launchFile.volume > 0 && flyFile.volume > 0, 'selected one-shots fade in');
shots.setVolume(0.2);
assert(Math.abs(flyFile.volume - 0.14) < 0.001, 'volume changes apply to native media');
advance(8000);
assert(flyFile.volume < 0.14 && flyFile.volume > 0, 'flight fades during its final 1.5 seconds');
advance(1500);
assert(flyFile.paused && flyFile.volume === 0, 'flight stops at ten seconds');
shots.launch();
advance(2000);
shots.launch();
advance(6500);
assert(!flyFile.paused && flyFile.volume > 0, 'a stale flight fade cannot stop the next launch');
shots.stopFlight();
advance(400);
assert(flyFile.paused, 'landing fades the chosen flight sound early');

/* Exercise the actual page event paths without an audio device. */
const env = loadPage({ search: '?mode=lab&seed=7' });
env.runFrames(2);
const scene = env.context.GravityScene;
const ui = env.elements;
const sceneSound = scene.sound;
let launches = 0;
const originalLaunch = sceneSound.launch;
sceneSound.launch = () => { launches++; originalLaunch(); };
const canvas = ui.get('c');
const p = env.planetScreen(0);
env.fireWindow('pointerdown', { button: 0, clientX: p.x, clientY: p.y, target: canvas, shiftKey: false });
assert.strictEqual(sceneSound.phase(), 'idle', 'a click is not a drag');
env.fireWindow('pointermove', { clientX: p.x + 150, clientY: p.y - 30, target: canvas, shiftKey: false });
assert.strictEqual(sceneSound.phase(), 'aim', 'guitar starts as the drag takes over');
env.fireWindow('pointerup', { clientX: p.x + 150, clientY: p.y - 30, target: canvas, shiftKey: false });
assert.strictEqual(sceneSound.phase(), 'armed', 'release changes to shimmer');
env.runFrames(2);
env.click('launch');
assert.strictEqual(launches, 1, 'actual lab launch triggers one pair of one-shots');
assert.strictEqual(sceneSound.phase(), 'idle');
env.click('clear');
assert.strictEqual(sceneSound.phase(), 'idle');
env.dragAim(0, 0.6, 100);
assert.strictEqual(sceneSound.phase(), 'armed');
env.fireWindow('keydown', { key: 'Escape', code: 'Escape', preventDefault() {} });
assert.strictEqual(sceneSound.phase(), 'idle', 'escape silences the armed loop');
env.click('soundToggle');
assert.strictEqual(sceneSound.enabled(), false);
assert.strictEqual(ui.get('soundToggle').attributes['aria-pressed'], 'false');
env.click('soundToggle');
assert.strictEqual(sceneSound.enabled(), true);

assert.strictEqual(sceneSound.engine(), 'trajectory', 'the data-driven generator is the fresh default');
scene.setPlayMode('route');
env.runFrames(2);
env.dragAim(0, 0.6, 100);
assert.strictEqual(sceneSound.phase(), 'armed', 'trajectory synth keeps a released route plan audible');
sceneSound.setEngine('fallback');
env.runFrames(1);
assert.strictEqual(sceneSound.phase(), 'idle', 'classic synths keep route mode silent after release');
sceneSound.setEngine('trajectory');
env.runFrames(1);

scene.startGame(7, false, 'career');
env.runFrames(2);
const career = scene.career;
const game = scene.game;
const gun = env.context.GravityGame.turretAngle(game.galaxy, career.hq, game.clockSteps * env.context.GravitySim.DT);
env.dragAim(career.hq, gun + Math.PI, Math.min(80, scene.speedCeiling(career.hq)));
env.runFrames(2);
assert.strictEqual(sceneSound.phase(), 'armed');
const beforeClick = launches;
env.click('launch');
assert.strictEqual(launches, beforeClick, 'career launch button only queues the barrel');
assert.strictEqual(sceneSound.phase(), 'armed', 'shimmer continues while the barrel turns');
for (let i = 0; i < 300 && launches === beforeClick; i++) env.runFrames(1, 16);
assert.strictEqual(launches, beforeClick + 1, 'thunder occurs when the barrel really fires');
assert.strictEqual(sceneSound.phase(), 'idle');
console.log('SOUND TEST OK: gestures, loops, fade races, mute, lab/route and queued career launch');
