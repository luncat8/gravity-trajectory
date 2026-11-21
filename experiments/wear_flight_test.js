/* Compare wear-aware predictions with real fixed-step career flights. */
'use strict';

const assert = require('assert');
const Game = require('../gravity_game.js');
const Sim = require('../gravity_sim.js');
const Tech = require('../orbit_tech.js');
const World = require('../orbit_world.js');
const Bot = require('../gravity_bot.js');

const x = new Float64Array([200, 800, 400, 600, 700, 1200]);
const y = new Float64Array([500, 500, 600, 400, 600, 850]);
const radius = new Float64Array(6).fill(20);
const orbit = new Float64Array([60, 60, 150, 150, 150, 60]);
const cos = new Float64Array(6).fill(1);
const sin = new Float64Array(6);
const zeros = new Float64Array(6);
const mask = new Uint8Array(World.PLANETS);
mask.fill(1, 0, 6);
const near = (actual, expected, note) => assert.ok(Math.abs(actual - expected) < 1e-9,
	`${note}: ${actual} != ${expected}`);

function world(condition, fitted) {
	const sim = new Sim(World.WORLD_W, World.WORLD_H);
	sim.setPlanets(6, x, y, radius, orbit, orbit, cos, sin);
	sim.setPlanetMask(mask);
	sim.setField(6, radius, zeros, (t, outX, outY, count) => {
		for (let i = 0; i < count; i++) { outX[i] = x[i]; outY[i] = y[i]; }
	}, true);
	const career = Game.createCareer(Game.createLedger(100));
	Game.setCareerUniverse(career, mask, 6);
	career.at = 0;
	career.hq = 0;
	career.ship.mass = 10;
	career.ship.obs = Tech.OBS[fitted ? 1 : 0];
	Game.setShipCondition(career, condition);
	for (const task of career.tasks) { task.kind = Game.TASK_DELIVERY; task.deadline = Infinity; }
	sim.setLaunchNetwork(null, career.ship);
	sim.stepLimit = Game.CAP_STEPS;
	sim.limitReason = Sim.END_TIME;
	const market = Game.createMarket();
	market.capitalPlanet = 3;
	market.arfPlanet = 5;
	market.quiet[4] = 1;
	return { sim, career, market };
}

function oneStep(w) {
	Game.careerAdvance(w.career, 1);
	w.sim.stepOne();
	Game.careerWeatherWear(w.career, w.sim);
	Game.stepHarvest(w.career.ledger, w.market, w.sim, w.sim.liveSteps);
}

function finish(w) {
	while (w.sim.status === Sim.STATUS_FLYING) oneStep(w);
	assert.strictEqual(w.sim.endReason, Sim.END_IMPACT);
	Game.careerEndFlight(w.career, w.sim, null, w.sim.liveSteps);
}

Game.setSpaceWearScale(3);
for (const [start, fitted, name] of [
	[1, true, 'healthy'], [0.30, true, 'landing wear'],
	[0.25, true, 'worn out in flight'], [0.095, true, 'early failure'],
	[1, false, 'device unfitted']
]) {
	const w = world(start, fitted);
	w.sim.predictFull(0, 0, 100, Game.CAP_SECONDS);
	assert.strictEqual(w.sim.predBody, 1, name + ' destination');
	const steps = w.sim.predSteps;
	const reportUntil = Game.forecastReportUntil(w.career, start, 100, 0);
	const gain = Game.estimateProfit(w.market, 0, w.sim, w.career.ledger, reportUntil);
	const end = Game.forecastCondition(w.career, start, steps, 100, 0, true);
	w.sim.launch(0, 0, 100);
	Game.careerBeginFlight(w.career, w.sim);
	finish(w);
	assert.strictEqual(w.sim.liveSteps, steps, name + ' steps');
	near(w.career.ledger.shotGain, gain, name + ' harvest');
	near(w.career.ship.condition, end, name + ' end condition');
	assert.ok(gain >= Game.CAPITAL_VISIT_PAY, name + ' must still collect the special world');
	if (name === 'landing wear') {
		assert.strictEqual(end, 0);
		assert.ok(reportUntil > steps, 'landing wear cannot suppress its final report');
	}
	if (name === 'early failure' || name === 'device unfitted') {
		near(gain, Game.CAPITAL_VISIT_PAY, name + ' only the special world pays');
	}
}

/* At the exact exhaustion step, wear happens before harvest. */
for (const scale of [0.5, 1, 3]) {
	Game.setSpaceWearScale(scale);
	for (const steps of [1, 10, 1000, 3600, 12000]) {
		const w = world(1, true);
		const condition = Game.spaceWear(w.career, steps);
		if (condition > 1) continue;
		Game.setShipCondition(w.career, condition);
		w.career.flying = true;
		const until = Game.forecastReportUntil(w.career, condition, 0, 0);
		for (let i = 0; i < steps; i++) Game.careerAdvance(w.career, 1);
		assert.strictEqual(w.career.ledger.reports, false, `live boundary ${scale} × ${steps}`);
		assert.ok(steps >= until, `forecast boundary ${scale} × ${steps}`);
	}
}

/* An in-flight forecast starts after the launch/prefix and applies burn wear once. */
Game.setSpaceWearScale(3);
for (const exhaustedByBurn of [false, true]) {
	const w = world(1, true);
	const ship = w.career.ship;
	ship.engine = Tech.ENGINES[2];
	ship.tank = Tech.TANKS[3];
	ship.fuelKg = ship.tank.fuelCap;
	w.sim.launch(0, 0, 100);
	Game.careerBeginFlight(w.career, w.sim);
	for (let i = 0; i < 240; i++) oneStep(w);
	if (exhaustedByBurn) Game.setShipCondition(w.career, 0.004);
	const before = w.career.ledger.shotGain;
	const condition = ship.condition;
	const dv = 10;
	assert.ok(w.sim.canBurn(dv));
	w.sim.predictBurn(0, dv, 1e9);
	assert.strictEqual(w.sim.predBody, 1);
	const steps = w.sim.predSteps;
	const until = Game.forecastReportUntil(w.career, condition, 0, dv);
	const gain = Game.estimateProfit(w.market, w.sim.liveSteps, w.sim, w.career.ledger, until);
	const end = Game.forecastCondition(w.career, condition, steps, 0, dv, true);
	assert.ok(Game.careerBurn(w.career, w.sim, 0, dv));
	if (exhaustedByBurn) assert.strictEqual(ship.condition, 0);
	finish(w);
	near(w.career.ledger.shotGain - before, gain, 'burn continuation harvest');
	near(ship.condition, end, 'burn continuation condition');
}
/* A scratch burn quote must include the prefix, its clock and its launch force. */
Game.setSpaceWearScale(1);
const oldX = x[2];
const oldY = y[2];
const oldOrbit = orbit[2];
x[2] = 319.9;
y[2] = 500;
orbit[2] = 60;
const prefixWorld = world(1, true);
const prefixCareer = prefixWorld.career;
const prefixShip = prefixCareer.ship;
prefixShip.engine = Tech.ENGINES[2];
prefixShip.tank = Tech.TANKS[3];
prefixShip.fuelKg = prefixShip.tank.fuelCap;
const prefixSpeed = 160;
const prefixDv = 10;
const prefixSteps = Bot.CAREER_BURN_AT;
const prefixWear = Game.launchWear(prefixCareer, prefixSpeed) + Game.spaceWear(prefixCareer, prefixSteps);
Game.setShipCondition(prefixCareer, prefixWear + Game.impulseWear(prefixCareer, prefixDv) * 0.5);
const scratch = world(1, true).sim;
const burnBot = new Bot(World.WORLD_W, World.WORLD_H);
burnBot.probe = world(1, true).sim;
burnBot.careerDeparture = () => ({ ok: true, physical: true, cost: 0, source: 'own',
	builds: false, canBuildStarter: true });
burnBot.careerSiteValue = () => 0;
burnBot.careerBurnLaunch({ sim: prefixWorld.sim, career: prefixCareer }, scratch, 0,
	Game.angleUnits(0), Game.speedUnits(prefixSpeed));
assert.strictEqual(scratch.status, Sim.STATUS_FLYING);
/* the pad's own system opens a step-0 row, the prefix's entry closes it */
assert.strictEqual(burnBot.careerBurnPrefix.count, 2);
assert.strictEqual(burnBot.careerBurnPrefix.planet[0], 0);
assert.strictEqual(burnBot.careerBurnPrefix.step[0], 0);
assert.strictEqual(burnBot.careerBurnPrefix.planet[1], 2);
assert.strictEqual(burnBot.careerBurnPrefix.step[1], prefixSteps,
	'the last prefix step pays before an exhausting burn');
burnBot.probe.predictBurnFast(scratch, 0, prefixDv);
assert.strictEqual(burnBot.probe.predBody, 2);
const remaining = prefixCareer.ship.condition - prefixWear;
assert.strictEqual(Game.forecastReportUntil(prefixCareer, remaining, 0, prefixDv), 0);
assert.ok(Number.isFinite(burnBot.careerScoreFlight(prefixCareer, 0, prefixWorld.market, 0,
	scratch.flightLength, 0, 0, prefixWear, prefixDv, scratch)));
const predictedPrefixCash = burnBot.careerEval.cash;
assert.ok(predictedPrefixCash > 0, 'a pre-burn report cannot disappear when the burn wears out the device');

/* A deadline and a fragile load use the full scratch flight, not just its tail. */
const task = prefixCareer.tasks[0];
prefixCareer.contract = 0;
task.kind = Game.TASK_DELIVERY;
task.state = Game.TASK_LOADED;
task.to = 2;
task.reward = 10;
task.fragile = false;
task.deadline = prefixSteps + burnBot.probe.predSteps - 1;
burnBot.careerScoreFlight(prefixCareer, 0, prefixWorld.market, 0,
	scratch.flightLength, 0, 0, prefixWear, prefixDv, scratch);
near(burnBot.careerEval.cash, predictedPrefixCash, 'scratch deadline includes the prefix');
task.deadline += 1;
burnBot.careerScoreFlight(prefixCareer, 0, prefixWorld.market, 0,
	scratch.flightLength, 0, 0, prefixWear, prefixDv, scratch);
near(burnBot.careerEval.cash, predictedPrefixCash + 10, 'scratch delivery arrives on its deadline');
task.fragile = true;
burnBot.careerScoreFlight(prefixCareer, 0, prefixWorld.market, 0,
	scratch.flightLength, 0, 0, prefixWear, prefixDv, scratch);
near(burnBot.careerEval.cash, predictedPrefixCash, 'scratch launch breaks the fragile load');
prefixCareer.contract = -1;

/* Re-entry must use the prefix's visit stamp; an unfitted device reports neither. */
burnBot.probe.predLogCount = 2;
burnBot.probe.predLogPlanet[0] = 2;
burnBot.probe.predLogStep[0] = 60;
burnBot.probe.predLogPlanet[1] = 3;
burnBot.probe.predLogStep[1] = 80;
const joined = Game.estimateProfitLog(prefixWorld.market, 0,
	new Int32Array([2, 2, 3]), new Int32Array([prefixSteps, prefixSteps + 60, prefixSteps + 80]),
	3, prefixCareer.ledger, Infinity);
near(burnBot.careerBurnVisitPay(prefixCareer, prefixWorld.market, 0, scratch, Infinity), joined,
	'scratch re-entry market history');
prefixShip.obs = Tech.OBS[0];
near(burnBot.careerBurnVisitPay(prefixCareer, prefixWorld.market, 0, scratch, 0),
	Game.CAPITAL_VISIT_PAY, 'an unfitted device still pays the Capital entry');
prefixShip.obs = Tech.OBS[1];

prefixWorld.sim.launch(0, 0, prefixSpeed);
Game.careerBeginFlight(prefixCareer, prefixWorld.sim);
for (let i = 0; i < prefixSteps; i++) oneStep(prefixWorld);
assert.ok(prefixCareer.ledger.shotGain > 0);
assert.ok(Game.careerBurn(prefixCareer, prefixWorld.sim, 0, prefixDv));
assert.strictEqual(prefixShip.condition, 0);
finish(prefixWorld);
near(prefixCareer.ledger.shotGain, predictedPrefixCash, 'scratch prefix plus burn versus live harvest');
x[2] = oldX;
y[2] = oldY;
orbit[2] = oldOrbit;

/* Rival burns happen at the same boundary as a human or YOU-as-bot burn. */
const w = world(1, true);
w.career.ship.engine = Tech.ENGINES[2];
w.career.ship.tank = Tech.TANKS[3];
w.career.ship.fuelKg = w.career.ship.tank.fuelCap;
w.sim.launch(0, 0, 100);
Game.careerBeginFlight(w.career, w.sim);
Game.setShipCondition(w.career, Game.spaceWear(w.career, 1) * 0.75);
const bot = new Bot(World.WORLD_W, World.WORLD_H);
bot.count = 1;
/* a rival slot always carries its saved shots: the burn is attached to the
 * flight's own shot record, so the hand-built slot needs the empty list */
bot.rivals[0] = { sim: w.sim, career: w.career, ledger: w.career.ledger, steps: 0, shots: [] };
let burned = false;
let burnStep = -1;
bot.careerFlightBurn = (career, sim, market, step) => {
	burnStep = step;
	burned = Game.careerBurn(career, sim, 0, 0.01);
};
bot.stepCareer(1, w.market, null, 1);
assert.ok(burned, 'a rival with condition at the boundary can burn before this step');
assert.strictEqual(burnStep, 0, 'the burn forecast starts at the previous world step');
assert.strictEqual(w.career.ship.condition, 0, 'space wear follows the burn on this step');

/* A hand-flown rival must not receive an automatic impulse. */
const human = world(1, true);
human.sim.launch(0, 0, 100);
Game.careerBeginFlight(human.career, human.sim);
bot.rivals[0] = { sim: human.sim, career: human.career, ledger: human.career.ledger, steps: 0, shots: [] };
bot.rivalTypes[0] = Game.PLAYER_USER;
burned = false;
burnStep = -1;
bot.stepCareer(1, human.market, null, 1);
assert.strictEqual(burnStep, -1, 'a hand-flown rival must not use the bot burn policy');
assert.strictEqual(burned, false, 'a hand-flown rival must not be auto-burned');
assert.ok(human.career.ship.condition < 1, 'the hand-flown rival still wears in space');
bot.rivalTypes[0] = Game.PLAYER_BOT;

/* Finishing at a flight cap is not an extra flight step, even in stay-pay. */
const capped = world(1, true);
capped.sim.launch(0, 0, 100);
Game.careerBeginFlight(capped.career, capped.sim);
Game.setShipCondition(capped.career, 0.5);
capped.sim.stepLimit = capped.sim.liveSteps;
const actor = { sim: capped.sim, career: capped.career, ledger: capped.career.ledger, steps: 0, shots: [] };
bot.rivals[0] = actor;
bot.careerLand = () => {};
Game.setHarvestMode(Game.HARVEST_TICK);
bot.stepCareer(1, capped.market, null, 1);
assert.strictEqual(capped.sim.status, Sim.STATUS_ENDED);
assert.strictEqual(capped.career.ship.condition, 0.5, 'the cap cannot charge an extra space step');
assert.strictEqual(capped.career.ledger.shotGain, 0, 'the cap cannot pay an extra tick');
assert.strictEqual(actor.steps, 0, 'the cap cannot add a phantom flight step');
Game.setHarvestMode(Game.HARVEST_ENTRY);
console.log('WEAR FLIGHT OK · fixed-step harvest, landing, specials, boundary and impulse continuation');
