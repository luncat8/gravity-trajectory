/*
 * Lite profile (0.7.38): a viewer setting that never changes the run.
 *
 * 1. `?lite=1&mode=career` boots on a saved opening (no seat search), fast
 *    forwards the trade world once, and creates no AudioContext even after
 *    key and pointer gestures. Every default difficulty with a saved opening
 *    boots the same way, and `new seed` cycles the saved openings (Shift: any).
 * 2. A lite run and a full run of the same map, and a lite seed link armed
 *    from the registry, capture the same state (trade world, tasks, purses)
 *    after the same frames, though the lite page never paints its backdrop.
 * 3. Over static planets the backdrop canvas paints once, then holds still;
 *    a view switch repaints once, moving ports (gravity bodies) and lite off
 *    bring back the live frame.
 * 4. `?lite=1` leaves stored sound keys alone; the checkbox stores the
 *    profile, drops the address override, and unchecking restores the stored
 *    sound choice. A stored profile boots lite, `?lite=0` overrides it.
 * 5. Postcards stay closed in lite and open again without it.
 *
 * Run: node experiments/lite_mode_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { loadPage } = require('./dom_stub.js');
const MAPS = require(path.join(__dirname, '..', 'saved_maps.js'));

/* a constructor the sound code may call: it counts and refuses, so a full
 * page falls back to silence the way a browser without audio does */
function audioProbe() {
	const probe = { contexts: 0 };
	probe.AudioContext = function () {
		probe.contexts += 1;
		throw new Error('no audio in the stub');
	};
	return probe;
}

const plain = value => JSON.parse(JSON.stringify(value));
const runState = env => JSON.stringify(
	env.context.GravityMaps.captureState(env.context.mapRunInfo()));
const savedSeeds = (universe, seats) => MAPS.filter(record => record.kind === 'start' &&
	record.universe === universe && record.seats.length === seats).map(record => record.seed);

function gesture(env) {
	env.fireWindow('keydown', { key: 'a', code: 'KeyA', target: { tagName: 'CANVAS' } });
	env.fireWindow('pointerdown', { button: 0, clientX: 5, clientY: 5,
		target: env.elements.get('c'), shiftKey: false });
	env.fireWindow('pointerup', { clientX: 5, clientY: 5, target: env.elements.get('c'), shiftKey: false });
}

/* --- 1. fast boot ------------------------------------------------------- */

const audio = audioProbe();
const bootAt = Date.now();
const lite = loadPage({ search: '?lite=1&mode=career', globals: { AudioContext: audio.AudioContext } });
const bootMs = Date.now() - bootAt;
const liteScene = lite.context.GravityScene;
const liteSeeds3 = savedSeeds(13, 3);
assert.strictEqual(liteScene.playMode(), 'career', 'the address starts a career');
assert.ok(liteSeeds3.includes(liteScene.game.seed), 'an unpinned lite seed is a saved one: ' + liteScene.game.seed);
const bootRecord = MAPS.find(record => record.kind === 'start' && record.seed === liteScene.game.seed &&
	record.universe === 13 && record.seats.length === 3);
assert.deepStrictEqual(plain(liteScene.game.galaxy.mapSeats), bootRecord.seats, 'seated from the record');
assert.strictEqual(plain(liteScene.game.galaxy.openingTargetPay), bootRecord.targetPay, 'record pay target');
assert.strictEqual(lite.context.GravityMaps.armed(), null, 'the armed record was used up');
assert.strictEqual(lite.context.OrbitScene.fastForwards(), 1, 'one seven-hour fast-forward on boot');
assert.ok(lite.context.location.search.includes('lite=1'), 'the address keeps lite=1');
assert.ok(lite.context.location.search.includes('seed=' + liteScene.game.seed), 'and the seed it chose');
gesture(lite);
lite.runFrames(4);
assert.strictEqual(audio.contexts, 0, 'no AudioContext in lite, even after gestures');
const soundBtn = lite.elements.get('soundToggle');
assert.strictEqual(soundBtn.textContent, 'sound off', 'the toggle reads off');
assert.strictEqual(soundBtn.disabled, true, 'and waits for lite to be unchecked');
/* the positive control: the same gesture on a full page does reach the audio code */
const fullAudio = audioProbe();
const fullPage = loadPage({ search: '?mode=lab&seed=5', globals: { AudioContext: fullAudio.AudioContext } });
assert.strictEqual(fullPage.context.OrbitScene.fastForwards(), 1, 'a lab boot fast-forwards once too');
gesture(fullPage);
assert.ok(fullAudio.contexts > 0, 'a full page asks for audio on a gesture');
console.log('boot: lite career on saved seed ' + liteScene.game.seed + ' in ' + bootMs +
	' ms, 1 fast-forward, 0 AudioContext');

/* each default difficulty with saved openings boots on one of them, as does a 4-seat roster */
const easy = loadPage({ search: '?lite=1&mode=career&bot=easy' });
assert.ok(savedSeeds(13, 2).includes(easy.context.GravityScene.game.seed), 'easy boots on a saved 2-seat opening');
assert.strictEqual(easy.context.GravityScene.game.galaxy.mapSeats.length, 2, 'YOU + one rival');
assert.strictEqual(easy.context.GravityMaps.armed(), null, 'easy used its record');
const four = loadPage({ search: '?lite=1&mode=career&players=4' });
const liteSeeds4 = savedSeeds(13, 4);
assert.ok(liteSeeds4.includes(four.context.GravityScene.game.seed), '4-seat career boots on a saved opening');
assert.strictEqual(four.context.GravityScene.game.galaxy.mapSeats.length, 4, 'four companies');
assert.strictEqual(four.context.GravityMaps.armed(), null, '4-seat career used its record');

/* `new seed` cycles the saved openings of the roster, Shift rolls any world,
 * and a single-record roster rolls fresh instead of repeating the current seed */
const order = Array.from(new Set(liteSeeds3)).sort((a, b) => a - b);
const before = liteScene.game.seed;
lite.fireElement(lite.elements.get('gameNewSeed'), 'click', { shiftKey: false });
const next = order[(order.indexOf(before) + 1) % order.length];
assert.strictEqual(liteScene.game.seed, next, 'new seed: the next saved opening ' + before + ' → ' + next);
assert.strictEqual(lite.context.GravityMaps.armed(), null, 'and it seated from it');
const nextRecord = MAPS.find(record => record.kind === 'start' && record.seed === next &&
	record.universe === 13 && record.seats.length === 3);
assert.deepStrictEqual(plain(liteScene.game.galaxy.mapSeats), nextRecord.seats, 'new seed seats from the record');
assert.strictEqual(lite.context.newRunSeed(true) >= 1, true, 'Shift asks for a random world');
lite.context.Math.random = () => 0.123456;
assert.strictEqual(lite.context.newRunSeed(true), lite.context.randomSeed(), 'Shift is randomSeed');
const oneRecord = loadPage({ search: '?lite=1&mode=career&universe=26' });
assert.strictEqual(oneRecord.context.GravityScene.game.seed, 4, '26-world 3-seat boots on its single saved seed');
oneRecord.context.Math.random = () => 0.25;
assert.notStrictEqual(oneRecord.context.newRunSeed(false), 4,
	'new seed never repeats the live seed when only one saved record fits');

/* --- 2. same run, lite or not ------------------------------------------- */

const record0 = MAPS[0];
const runs = [
	loadPage({ search: '?map=0&you=bot' }),
	loadPage({ search: '?map=0&you=bot&lite=1' }),
	loadPage({ search: '?rule=career&seed=' + record0.seed + '&rate=' + record0.rate + '&you=bot&lite=1' })
];
assert.strictEqual(runs[2].context.GravityScene.game.seed, record0.seed, 'a pinned seed stays pinned in lite');
assert.deepStrictEqual(plain(runs[2].context.GravityScene.game.galaxy.mapSeats), record0.seats,
	'a lite seed link with a saved opening is seated from it');
const startState = runState(runs[0]);
for (let i = 1; i < runs.length; i++) assert.strictEqual(runState(runs[i]), startState, 'same state at boot · run ' + i);
const FRAMES = 600;
for (const env of runs) env.runFrames(FRAMES, 16.7);
const steps = runs[0].context.GravityScene.game.clockSteps;
assert.ok(steps >= 1000, 'the runs covered 1000 career steps: ' + steps);
const endState = runState(runs[0]);
assert.notStrictEqual(endState, startState, 'the world moved');
for (let i = 1; i < runs.length; i++) {
	assert.strictEqual(runs[i].context.GravityScene.game.clockSteps, steps, 'same clock · run ' + i);
	assert.strictEqual(runState(runs[i]), endState, 'same captured state after ' + steps + ' steps · run ' + i);
}
assert.ok(runs[1].context.OrbitScene.paints() <= 2, 'the lite page held its backdrop still: ' +
	runs[1].context.OrbitScene.paints() + ' paints');
assert.ok(runs[0].context.OrbitScene.paints() >= FRAMES, 'the full page painted every frame');
console.log('determinism: ' + steps + ' career steps, lite = full = lite seed link; backdrop paints ' +
	runs[1].context.OrbitScene.paints() + ' vs ' + runs[0].context.OrbitScene.paints());

/* --- 3. a still backdrop ------------------------------------------------ */

const still = loadPage({ search: '?lite=1&mode=lab&seed=5' });
const orbit = still.context.OrbitScene;
still.runFrames(2);
assert.ok(orbit.still(), 'static planets hold still in lite');
let paints = orbit.paints();
assert.strictEqual(paints, 1, 'one static paint');
still.runFrames(60);
assert.strictEqual(orbit.paints(), paints, 'no repaint over 60 frames at rest');
const tradeT = still.context.OrbitScene.sim.t;
assert.strictEqual(tradeT, 420, 'the idle lab trade world does not run behind a still backdrop');
still.choose('viewField');
still.runFrames(10);
assert.strictEqual(orbit.paints(), paints + 1, 'a view switch repaints once');
paints = orbit.paints();
still.fireWindow('resize', {});
still.runFrames(10);
assert.strictEqual(orbit.paints(), paints + 1, 'a resize repaints once');
paints = orbit.paints();
still.context.OrbitScene.sim.portSpec[0] = (still.context.OrbitScene.sim.portSpec[0] + 1) % 6;
still.runFrames(10);
assert.strictEqual(orbit.paints(), paints + 1, 'a colony export-spec change repaints once');
still.choose('viewSpace');
still.choose('srcPorts');
assert.ok(!orbit.still(), 'moving ports are gravity bodies: live again');
paints = orbit.paints();
still.runFrames(10);
assert.strictEqual(orbit.paints(), paints + 10, 'live frames resume at once');
still.choose('srcPlanets');
assert.ok(orbit.still(), 'back to static planets');
still.runFrames(1);
paints = orbit.paints();
still.toggle('liteMode');
assert.ok(!orbit.still(), 'lite off: live');
still.runFrames(10);
assert.strictEqual(orbit.paints(), paints + 10, 'live frames without lite');
console.log('still backdrop: 1 paint at rest over 60 frames, repaint on view/resize, live with ports or lite off');

/* --- 4. stored preferences ---------------------------------------------- */

const storage = { 'gravity-sound-enabled': 'true', 'gravity-sound-volume': '60' };
const stored = Object.assign({}, storage);
const pref = loadPage({ search: '?lite=1&mode=lab&seed=5', storage });
assert.deepStrictEqual(storage, stored, '?lite=1 writes no stored key');
assert.strictEqual(pref.elements.get('liteMode').checked, true, 'the checkbox shows the profile');
pref.toggle('liteMode');
assert.strictEqual(storage['gravity.lite'], '0', 'the checkbox stores the profile');
assert.strictEqual(storage['gravity-sound-enabled'], 'true', 'sound choice untouched');
assert.strictEqual(storage['gravity-sound-volume'], '60', 'volume untouched');
assert.strictEqual(pref.elements.get('soundToggle').textContent, 'sound on', 'unchecking restores the stored sound');
assert.strictEqual(pref.elements.get('soundToggle').disabled, false, 'and the toggle');
assert.ok(!pref.context.location.search.includes('lite='), 'the address override is dropped');
pref.toggle('liteMode');
assert.strictEqual(storage['gravity.lite'], '1', 'checked again: stored on');
const storedLite = loadPage({ search: '?mode=lab&seed=5', storage: { 'gravity.lite': '1' } });
assert.strictEqual(storedLite.context.GravityScene.liteMode(), true, 'a stored profile boots lite');
assert.ok(!storedLite.context.location.search.includes('lite='), 'without writing it into the address');
const override = loadPage({ search: '?mode=lab&seed=5&lite=0', storage: { 'gravity.lite': '1' } });
assert.strictEqual(override.context.GravityScene.liteMode(), false, '?lite=0 overrides the stored profile');
assert.ok(override.context.location.search.includes('lite=0'), 'and stays in the address');
console.log('preferences: stored sound kept, checkbox stores, ?lite=0 overrides');

/* --- 5. postcards ------------------------------------------------------- */

const deck = still.context.PhotoDeck;
still.toggle('liteMode');
assert.strictEqual(still.context.GravityScene.liteMode(), true, 'lite on again');
deck.show('space', 1, 3);
deck.toast('kicker', 'title', 'text');
assert.strictEqual(deck.visible(), false, 'no postcard or toast in lite');
assert.ok(!still.elements.get('photoImg').src, 'no art request in lite');
still.toggle('liteMode');
deck.show('space', 1, 3);
assert.strictEqual(deck.visible(), true, 'postcards return without lite');
console.log('postcards: closed in lite, back without it');
console.log('lite_mode_test: ok');
