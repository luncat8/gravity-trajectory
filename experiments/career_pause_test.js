/* Run: node experiments/career_pause_test.js */
'use strict';

const assert = require('assert');
const { loadPage } = require('./dom_stub.js');

function key(env, code, target, repeat) {
	let prevented = false;
	env.fireWindow('keydown', {
		code, key: code === 'Space' ? ' ' : code, target: target || { tagName: 'BODY' }, repeat,
		preventDefault() { prevented = true; }
	});
	return prevented;
}

function launch(env) {
	const scene = env.context.GravityScene;
	env.dragAim(scene.career.hq, 0.65, Math.min(72, scene.speedCeiling(scene.career.hq)));
	env.runFrames(2, 16);
	env.click('launch');
	for (let i = 0; i < 900 && scene.sim.status !== env.context.GravitySim.STATUS_FLYING; i++) {
		env.runFrames(1, 16);
	}
	assert.strictEqual(scene.sim.status, env.context.GravitySim.STATUS_FLYING);
}

const env = loadPage({ search: '?mode=career&seed=42&rate=1' });
const scene = env.context.GravityScene;
const ui = env.elements;
env.runFrames(2, 16);
assert(!ui.has('flightPauseBtn'));
assert(scene.careerPaused());
assert(key(env, 'Space', ui.get('careerClock')));
assert(!scene.careerPaused());
key(env, 'Space', ui.get('careerClock'), true);
assert(!scene.careerPaused(), 'key repeat must not toggle');
env.click('careerClock');
assert(scene.careerPaused());

const career = scene.career;
const game = env.context.GravityGame;
const tech = env.context.OrbitTech;
career.ledger.purse = 30;
game.installPart(career, tech.KIND_ENGINE, tech.ENGINES[1]);
game.installPart(career, tech.KIND_TANK, tech.TANKS[2]);
career.ship.fuelKg = 90;
launch(env);
env.runFrames(4, 16);
const sim = scene.sim;
env.dragBurn(-1.15, sim.burnLimit() * 0.6);
assert(!scene.burnState().armed && !scene.careerPaused());

env.click('careerClock');
assert(scene.careerPaused() && scene.burnPaused());
const steps = sim.liveSteps;
const clock = scene.game.clockSteps;
const worldTime = env.context.OrbitScene.sim.t;
env.runFrames(8, 16);
assert.strictEqual(sim.liveSteps, steps);
assert.strictEqual(scene.game.clockSteps, clock);
assert.strictEqual(env.context.OrbitScene.sim.t, worldTime);
assert.strictEqual(ui.get('careerClock').textContent, '▶ time');
env.dragBurn(-1.15, sim.burnLimit() * 0.6);
assert(scene.burnState().armed);
key(env, 'Space');
assert(!scene.careerPaused() && !scene.burnState().armed);
assert.strictEqual(ui.get('careerClock').textContent, '❚❚ time');
key(env, 'KeyP');
assert(scene.careerPaused() && scene.burnPaused());
env.dragBurn(-1.15, sim.burnLimit() * 0.6);
const fuel = career.ship.fuelKg;
key(env, 'Enter');
assert(!scene.careerPaused() && !scene.burnPaused());
assert(career.ship.fuelKg < fuel);
assert.strictEqual(scene.game.shots[0].burns.length, 1);
assert.strictEqual(ui.get('careerClock').textContent, '❚❚ time');

career.ship.fuelKg = 0;
env.click('careerClock');
assert(scene.careerPaused() && !scene.burnPaused(), 'an empty tank must not disable the clock');
const emptySteps = sim.liveSteps;
env.runFrames(5, 16);
assert.strictEqual(sim.liveSteps, emptySteps);
env.click('careerClock');
assert(!scene.careerPaused());

const noDrive = loadPage({ search: '?mode=career&seed=42&rate=1' });
noDrive.runFrames(2, 16);
launch(noDrive);
const noDriveScene = noDrive.context.GravityScene;
key(noDrive, 'Space');
assert(noDriveScene.careerPaused() && !noDriveScene.burnPaused());
const noDriveSteps = noDriveScene.sim.liveSteps;
noDrive.runFrames(5, 16);
assert.strictEqual(noDriveScene.sim.liveSteps, noDriveSteps);
assert.strictEqual(noDrive.elements.get('flightState').textContent, 'flight paused');
noDrive.click('careerClock');
assert(!noDriveScene.careerPaused());
console.log('career pause: footer, keyboard, clocks, impulse and no-drive flight passed');
