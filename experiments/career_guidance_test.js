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
const safeSpeed = 90;
const TAU = Math.PI * 2;

/* The seed picks the world and a shallow HQ (gravity_game pickHq), so the
 * fixture searches the live pad for its two landings instead of hard-coding
 * the planets an older forced-gravity HQ used to reach. */
function seek(speed, want) {
	for (let a = 0; a < 64; a++) {
		const angle = (a + 0.5) / 64 * TAU;
		env.dragAim(origin, angle, speed);
		env.runFrames(3, 16);
		if (scene.sim.predReason !== sim.END_IMPACT) continue;
		if (scene.sim.predBody < 0 || scene.sim.predBody === origin) continue;
		if (scene.aimGuidance() !== want) continue;
		return { angle, body: scene.sim.predBody };
	}
	return null;
}
const blocked = seek(35, 2);
assert.ok(blocked, 'seed 1 has no starter-blocked landing for the aim-state fixture');
const blockedPlanet = blocked.body;
const blockedAngle = blocked.angle;
const safe = seek(safeSpeed, 1);
assert.ok(safe && safe.body !== blockedPlanet,
	'seed 1 has no profitable exit for the aim-state fixture');
const safeAngle = safe.angle;

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

/* The taken medical quest counts as profit: with patients aboard, a shot
 * landing on the Capital prices the per-patient payout into cash. */
const capital = scene.career.capitalPlanet;
assert.ok(capital >= 0, 'fixture career has no capital planet');
const medicTask = scene.career.tasks[0];
medicTask.kind = gameApi.TASK_MEDIC;
medicTask.state = gameApi.TASK_LOADED;
medicTask.from = capital;
medicTask.to = 12;
medicTask.aboard = 4;
medicTask.patients = 8;
medicTask.reward = 8;
scene.career.contract = 0;
const visitPay = 1.5;
const medicShot = env.context.moneyFacts(origin, safeSpeed, capital, 100, 500, visitPay);
assert.strictEqual(medicShot.cash, visitPay + 4 * env.context.OrbitEcon.MEDIC_REWARD_PER_PATIENT,
	'taken medical quest is not counted as profit on the Capital landing');
const noMedicShot = env.context.moneyFacts(origin, safeSpeed, 5, 100, 500, visitPay);
assert.strictEqual(noMedicShot.cash, visitPay,
	'a landing off the quest route must not pay the medical reward');

/* One landing table for every consumer: the aim readout, the launch list, the
 * helper scans and the rival bots all read the same cash/credit/leg factors,
 * so a taken quest can never pay in one place and not in another. */
const facts = { cash: 0, credit: 0, leg: 0 };
const careerAt = () => scene.game.clockSteps;

function landing(origin, body, length, steps, pay, runStep) {
	return gameApi.careerLandingFacts(facts, scene.career, origin, body, 0, length, steps,
		runStep === undefined ? careerAt() : runStep, pay);
}

medicTask.aboard = 0;
medicTask.state = gameApi.TASK_LOADED;
let factsOut = landing(origin, 12, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_MEDICS, 'medic pickup leg is not named');
assert.strictEqual(factsOut.cash, 1.5, 'medics boarding pay no cash');
assert.strictEqual(factsOut.credit, 8 * gameApi.LEG_CREDIT, 'medic pickup carries no credit');

medicTask.aboard = 4;
factsOut = landing(origin, capital, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_PATIENTS, 'patients-home leg is not named');
assert.strictEqual(factsOut.cash, 1.5 + 4 * env.context.OrbitEcon.MEDIC_REWARD_PER_PATIENT,
	'patients landing home do not pay per patient');

/* the rival bot prices the very same landing from the same table */
bot.careerScoreFacts(scene.career, origin, scene.game.market, careerAt(), 0, 0,
	capital, 1.5, 500, 100);
assert.strictEqual(bot.careerEval.cash, factsOut.cash, 'the bot prices a landing differently');
assert.strictEqual(bot.careerEval.leg, gameApi.LEG_PATIENTS, 'the bot names a different leg');

medicTask.kind = gameApi.TASK_DELIVERY;
medicTask.state = gameApi.TASK_ACCEPTED;
medicTask.from = origin;
medicTask.to = 12;
medicTask.reward = 2;
factsOut = landing(origin, origin, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_LOAD, 'delivery load leg is not named');
assert.strictEqual(factsOut.cash, 1.5, 'loading cargo pays nothing yet');
assert.strictEqual(factsOut.credit, 2 * gameApi.LEG_CREDIT, 'delivery load carries no credit');

medicTask.state = gameApi.TASK_LOADED;
factsOut = landing(origin, 12, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_DELIVER, 'delivery landing is not named');
assert.strictEqual(factsOut.cash, 3.5, 'a delivered contract does not pay the reward');
/* a contract that expires before the landing is already gone from the board */
medicTask.deadline = careerAt() + 50;
factsOut = landing(origin, 12, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_NONE, 'an expired contract still claims a leg');
assert.strictEqual(factsOut.cash, 1.5, 'an expired contract still pays its reward');
medicTask.deadline = careerAt() + 100000;
factsOut = landing(origin, 7, 500, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_NONE, 'an unrelated landing claims a leg');
assert.strictEqual(factsOut.cash, 1.5, 'an unrelated landing pays more than the harvest');
assert.strictEqual(factsOut.credit, 0, 'an unrelated landing carries credit');

scene.career.contract = -1;
const compete = scene.career.tasks[gameApi.COMPETE_SLOT];
compete.kind = gameApi.TASK_COMPETE;
compete.planet = origin;
compete.minLength = 1000;
compete.reward = 2.5;
compete.deadline = careerAt() + 100000;
factsOut = landing(origin, 12, 1200, 100, 1.5);
assert.strictEqual(factsOut.leg, gameApi.LEG_COMPETE, 'competition leg is not named');
assert.strictEqual(factsOut.cash, 4, 'a competition win pays nothing');
factsOut = landing(origin, 12, 200, 100, 1.5);
assert.strictEqual(factsOut.cash, 1.5, 'a too-short flight wins the competition');
compete.kind = gameApi.TASK_NONE;

/* the rule also names the next stop of every contract kind */
scene.career.contract = 0;
medicTask.state = gameApi.TASK_ACCEPTED;
assert.deepStrictEqual(Array.from(gameApi.careerGoalBodies(scene.career)), [origin],
	'an accepted delivery does not send the ship to load');
medicTask.state = gameApi.TASK_LOADED;
assert.deepStrictEqual(Array.from(gameApi.careerGoalBodies(scene.career)), [12],
	'a loaded delivery does not send the ship to deliver');
medicTask.kind = gameApi.TASK_MEDIC;
medicTask.aboard = 0;
medicTask.to = 12;
assert.deepStrictEqual(Array.from(gameApi.careerGoalBodies(scene.career)), [12],
	'a medical mission does not send the ship out with medics');
medicTask.aboard = 4;
assert.deepStrictEqual(Array.from(gameApi.careerGoalBodies(scene.career)), [capital],
	'a medical mission does not send the patients home');
scene.career.contract = -1;
assert.deepStrictEqual(Array.from(gameApi.careerGoalBodies(scene.career)), [],
	'an empty board still names a goal');

/* The aim readout counts the taken medical quest too: a landing on the
 * (temporarily relocated) Capital pays the per-patient reward in predGain. */
const realCapital = scene.career.capitalPlanet;
scene.career.tasks[0].kind = gameApi.TASK_MEDIC;
scene.career.tasks[0].aboard = 4;
scene.career.tasks[0].reward = 8;
scene.career.contract = 0;
scene.career.capitalPlanet = safe.body;
env.dragAim(origin, safeAngle, safeSpeed);
env.runFrames(3, 16);
assert.strictEqual(scene.sim.predBody, safe.body, 'the fixture aim no longer lands where it did');
const gainWithPatients = scene.predGain();
assert.ok(gainWithPatients >= 4 - 1e-9,
	'the aim readout does not price the patients landing home: ' + gainWithPatients);
scene.career.capitalPlanet = realCapital;
scene.career.contract = -1;

/* The quest helper is wired, runs a scan from the landed pad and finishes
 * inside the frame guard, arming only a flyable shot. */
scene.career.tasks[0].kind = gameApi.TASK_DELIVERY;
scene.career.tasks[0].state = gameApi.TASK_ACCEPTED;
scene.career.tasks[0].from = 5;
scene.career.tasks[0].to = 12;
scene.career.tasks[0].reward = 2;
scene.career.contract = 0;
const questBefore = scene.aimState();
env.click('helperQuest');
assert.ok(!ui.get('helperStop').hidden, 'the quest helper button is not wired to a scan');
let questFrames = 0;
while (!ui.get('helperStop').hidden && questFrames < 1800) {
	env.runFrames(1, 16);
	questFrames += 1;
}
assert.ok(ui.get('helperStop').hidden, 'quest helper did not finish');
assert.ok(questFrames < 1800, 'quest helper scan exceeded its frame guard');
const questAfter = scene.aimState();
if (questAfter.angle !== questBefore.angle || questAfter.speed !== questBefore.speed) {
	assert.ok(scene.sim.predReason === sim.END_IMPACT && scene.sim.predBody >= 0,
		'quest helper armed a non-landing shot');
}
/* the notice prints purse cash and the leg it completes, never the ranking score */
const questNotice = ui.get('careerMsg').textContent;
assert.match(questNotice, /^(quest shot|launch list) · /, 'quest notice lost its label: ' + questNotice);
const printed = Number(questNotice.slice(questNotice.lastIndexOf('·') + 1).replace(/[^\d.+-]/g, ''));
assert.ok(Number.isFinite(printed) && Math.abs(printed) < 100,
	'quest notice printed the ranking score instead of cash: ' + questNotice);

/* nothing flyable means the goal table's own empty line, not a stale find */
const originalQuestDeparture = bot.careerDeparture;
bot.careerDeparture = function (career, planet, cash, mass, sourceSim) {
	const result = originalQuestDeparture.call(this, career, planet, cash, mass, sourceSim);
	result.ok = false;
	result.cost = Infinity;
	return result;
};
scene.career.contract = -1;
env.click('helperQuest');
questFrames = 0;
while (!ui.get('helperStop').hidden && questFrames < 1800) {
	env.runFrames(1, 16);
	questFrames += 1;
}
bot.careerDeparture = originalQuestDeparture;
assert.strictEqual(ui.get('careerMsg').textContent, 'no quest shot found',
	'quest helper did not report the empty scan');

console.log('CAREER GUIDANCE OK');
