/*
 * Career aim states and auto-helper departure filtering.
 * Run: node experiments/career_guidance_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const env = loadPage({ search: '?mode=career&seed=1' });
env.runFrames(2, 16);
const scene = env.context.GravityScene;
const ui = env.elements;
const sim = env.context.GravitySim;
const gameApi = env.context.GravityGame;
const bot = scene.bot;
const origin = scene.career.hq;
const blockedPlanet = 3;
const blockedAngle = 2.1353012567368124;
const safeAngle = 0.4663301595172349;
const safeSpeed = 90;

function assertCanvasColour(expected) {
	const label = ui.get('aimReadout').textContent;
	env.calls.texts.length = 0;
	env.calls.textColors.length = 0;
	env.runFrames(1, 16);
	const index = env.calls.texts.indexOf(label);
	assert.ok(index >= 0, 'canvas did not draw the armed aim label');
	assert.strictEqual(env.calls.textColors[index], expected,
		'aim label colour did not match its economic state');
}

/* A real incoming trajectory reaches a gravity-locked free planet, but the
 * starter purse cannot fund the EMC-2 rescue rail needed there. */
env.dragAim(origin, blockedAngle, 35);
env.runFrames(3, 16);
assert.strictEqual(scene.sim.predReason, sim.END_IMPACT);
assert.strictEqual(scene.sim.predBody, blockedPlanet);
assert.strictEqual(scene.aimGuidance(), 2);
assert.ok(ui.get('aimReadout').classList.contains('unlaunchable'));
assert.ok(ui.get('predVisitReadout').classList.contains('unlaunchable'));
assert.ok(ui.get('predProfitReadout').classList.contains('unlaunchable'));
assert.match(ui.get('predProfitReadout').textContent, /no exit/);
assertCanvasColour('#ff9478');

/* The same ordinary exit can be neutral after a small harvest, then profitable
 * when the live shared market has grown. */
env.dragAim(origin, safeAngle, safeSpeed);
env.runFrames(3, 16);
assert.ok(scene.sim.predBody !== blockedPlanet);
assert.strictEqual(scene.aimGuidance(), 1, 'normal opening profit shot should be green');

scene.game.market.k = 0.0001;
env.dragAim(origin, safeAngle, safeSpeed);
env.runFrames(3, 16);
assert.strictEqual(scene.sim.predReason, sim.END_IMPACT);
assert.strictEqual(scene.aimGuidance(), 0);
assert.ok(ui.get('aimReadout').classList.contains('neutral'));
assert.ok(ui.get('predVisitReadout').classList.contains('neutral'));
assert.ok(ui.get('predProfitReadout').classList.contains('neutral'));
assert.match(ui.get('predProfitReadout').textContent, /^−/);
assertCanvasColour('#ffcf6e');

scene.game.market.k = 100;
env.dragAim(origin, safeAngle, safeSpeed);
env.runFrames(3, 16);
assert.strictEqual(scene.sim.predReason, sim.END_IMPACT);
assert.strictEqual(scene.aimGuidance(), 1);
assert.ok(ui.get('aimReadout').classList.contains('profitable'));
assert.ok(ui.get('predVisitReadout').classList.contains('profitable'));
assert.ok(ui.get('predProfitReadout').classList.contains('profitable'));
assertCanvasColour('#8ef0c0');

/* The general career scan still scores task destinations after applying the
 * common departure gate. This also exercises the accepted-contract branch. */
const task = scene.career.tasks[0];
task.kind = gameApi.TASK_DELIVERY;
task.state = gameApi.TASK_ACCEPTED;
task.from = origin;
task.to = 12;
task.tons = 2;
task.reward = 1;
task.deadline = scene.game.clockSteps + 50000;
scene.career.contract = 0;
const originalDeparture = bot.careerDeparture;
let departureChecks = 0;
bot.careerDeparture = function (...args) {
	departureChecks += 1;
	const result = originalDeparture.apply(this, args);
	result.ok = true;
	result.cost = 0;
	result.source = 'own';
	return result;
};
const originalRandom = vm.runInContext('Math.random', env.context);
const cap = scene.sim.speedLimit(origin);
const randoms = [safeAngle / (2 * Math.PI), 0.5,
	(safeSpeed - 30) / (cap - 30), 0.5];
let randomIndex = 0;
env.context.__careerGuidanceRandom =
	() => randomIndex < randoms.length ? randoms[randomIndex++] : 0.25;
vm.runInContext('Math.random = __careerGuidanceRandom', env.context);
env.click('helperFocus');
env.context.__careerGuidanceRandom = originalRandom;
vm.runInContext('Math.random = __careerGuidanceRandom', env.context);
delete env.context.__careerGuidanceRandom;
let focusFrames = 0;
while (!ui.get('helperStop').hidden && focusFrames < 1800) {
	env.runFrames(1, 16);
	focusFrames += 1;
}
bot.careerDeparture = originalDeparture;
assert.ok(ui.get('helperStop').hidden, 'general career helper did not finish');
assert.ok(focusFrames < 1800, 'general career helper scan exceeded its frame guard');
assert.ok(departureChecks > 0, 'general career helper never scored a valid contract shot');

/* Even a scan seeded by an earlier saved shot must not arm anything when the
 * shared departure evaluator rejects every destination. */
const before = scene.aimState();
bot.careerDeparture = function (...args) {
	const result = originalDeparture.apply(this, args);
	result.ok = false;
	result.builds = false;
	result.canBuildStarter = false;
	result.cost = Infinity;
	result.source = '';
	result.reason = 'forced unlaunchable test';
	return result;
};
env.click('helperProfit');
let frames = 0;
while (!ui.get('helperStop').hidden && frames < 1800) {
	env.runFrames(1, 16);
	frames += 1;
}
bot.careerDeparture = originalDeparture;
assert.ok(ui.get('helperStop').hidden, 'profit helper did not finish');
const after = scene.aimState();
assert.strictEqual(after.angle, before.angle, 'helper armed an unlaunchable destination');
assert.strictEqual(after.speed, before.speed, 'helper changed the aim without a viable exit');
assert.ok(frames < 1800, 'helper scan exceeded its frame guard');

env.runFrames(2, 16);
assert.strictEqual(scene.aimGuidance(), 1, 'restored departure rule should recover the green aim state');
console.log('CAREER GUIDANCE OK');
