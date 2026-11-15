/* Balance laws and wear forecasts, without a browser. */
'use strict';

const assert = require('assert');
const Game = require('../gravity_game.js');
const Econ = require('../orbit_econ.js');
const Sim = require('../gravity_sim.js');
const World = require('../orbit_world.js');
const Bot = require('../gravity_bot.js');

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
	(message || 'value') + ': ' + actual + ' != ' + expected);

/* The new cap raises the asymptote, not the initial growth rate. */
assert.strictEqual(Game.MONEY.cap, 4);
const market = Game.createMarket();
market.lastVisitStep[0] = 0;
for (const sec of [0.1, 40, 400, 2000, 6000]) {
	near(Game.planetProfit(market, 0, sec / Sim.DT), -4 * Math.expm1(-sec * Game.MONEY.k / 4));
}
assert.ok(Game.planetProfit(market, 0, 6000 / Sim.DT) > 3.99);
assert.ok(Game.planetProfit(market, 0, 1) / Sim.DT < Game.MONEY.k);
assert.ok(Game.planetProfit(market, 0, 1) / Sim.DT > Game.MONEY.k * 0.999);
market.capitalPlanet = 2;
market.arfPlanet = 3;
assert.strictEqual(Game.planetProfit(market, 2, 600000), Game.CAPITAL_VISIT_PAY);
assert.strictEqual(Game.planetProfit(market, 3, 600000), 0);
market.rebel[0] = 1;
market.rebelSinceStep[0] = 0;
assert.ok(Game.planetProfit(market, 0, 6000000) > 15.99);
assert.ok(Game.planetProfit(market, 0, 6000000) <= 16);
market.rebel[0] = 0;

/* A bribe is exactly twice the reported and accrued visit value at every rot. */
market.visitPay[1] = 1.5;
market.lastVisitStep[1] = 0;
const visitValue = 1.5 + Game.planetProfit(market, 1, 600);
for (const rot of [0, 5, 25, 50, 99, 100]) {
	market.corruption[1] = rot;
	near(Game.bribeAmount(market, 1, 600), 2 * visitValue, 'bribe at rot ' + rot);
}
assert.strictEqual(Econ.bribeValue(0), 0);
assert.strictEqual(Econ.bribeValue(-1), 0);

/* Compare the same deterministic seed stream before and after the smooth bias. */
const before = [0, 0, 0, 0];
const after = [0, 0, 0, 0];
const ranges = [[0.9, 1.5], [1.8, 2.5], [-1, 0.55], [2.85, 3.5]];
const levels = new Set();
for (let seed = 1; seed <= 5000; seed++) {
	for (let p = 0; p < 26; p++) {
		const u = World.hash01(seed, p, 0xce);
		const old = (Math.floor(u * 91) - 20) / 20;
		const g = Game.planetGravity(seed, p);
		levels.add(g);
		assert.ok(g >= -1 && g <= 3.5 && Math.abs(g * 20 - Math.round(g * 20)) < 1e-9);
		assert.strictEqual(g, Game.planetGravity(seed, p));
		if (old <= 0.55 || old >= 2.85) assert.strictEqual(g, old, 'tail changed');
		for (let r = 0; r < ranges.length; r++) {
			if (old >= ranges[r][0] && old <= ranges[r][1]) before[r]++;
			if (g >= ranges[r][0] && g <= ranges[r][1]) after[r]++;
		}
	}
}
assert.strictEqual(levels.size, 91, 'every grid value remains possible');
assert.ok(after[0] > before[0] * 1.25, 'more useful middle worlds');
assert.ok(after[1] < before[1] * 0.8, 'fewer heavy-middle worlds');
assert.deepStrictEqual(after.slice(2), before.slice(2), 'low and top tails remain');
console.log('gravity bands % · before ' + before.map(n => (n / 1300).toFixed(1)).join(' / ') +
	' · after ' + after.map(n => (n / 1300).toFixed(1)).join(' / '));

/* Predict the same sequence of visits that the live wear law charges. */
const career = Game.createCareer(Game.createLedger(100));
career.at = 0;
career.hq = 0;
Game.setShipCondition(career, 0.22);
Game.setSpaceWearScale(1);
const speed = 100;
const start = career.ship.condition;
const planets = new Int32Array([0, 0, 1, 2, 4]);
const steps = new Int32Array([60, 600, 1800, 2400, 2500]);
market.quiet[4] = 1;
market.lastVisitStep.fill(-Game.initSteps());
const limit = Game.forecastReportUntil(career, start, speed, 0);
assert.ok(limit > 600 && limit < 1800);
const forecast = Game.estimateProfitLog(market, 0, planets, steps, planets.length, career.ledger, limit);
const initialMarket = Game.createMarket();
initialMarket.capitalPlanet = market.capitalPlanet;
initialMarket.arfPlanet = market.arfPlanet;
initialMarket.quiet[4] = 1;
const unbounded = Game.estimateProfitLog(initialMarket, 0, planets, steps, planets.length, career.ledger);
assert.ok(forecast < unbounded, 'an exhausted device must lose later reports');
Game.setShipCondition(career, start - Game.launchWear(career, speed));
career.flying = true;
let live = 0;
let prev = 0;
for (let i = 0; i < planets.length; i++) {
	Game.careerAdvance(career, steps[i] - prev);
	live += Game.harvestPlanet(career.ledger, market, planets[i], steps[i]);
	prev = steps[i];
}
near(live, forecast, 'forecast versus live harvest');
assert.strictEqual(career.ship.condition, 0);
assert.strictEqual(career.ledger.reports, false);
assert.strictEqual(Game.forecastReportUntil(career, 0, 0, 0), 0);
const afterRepair = Game.forecastReportUntil(career, 1, speed, 0);
assert.ok(afterRepair > 0, 'forecast can model a repair without mutating the ledger');
assert.ok(Game.estimateProfitLog(initialMarket, 0, new Int32Array([1]), new Int32Array([60]),
	1, career.ledger, afterRepair) > 0);

/* Every multiplier affects all ships' space time only, and costs saturate at 0. */
career.flying = true;
for (const scale of [0, 0.5, 1, 3]) {
	Game.setSpaceWearScale(scale);
	Game.setShipCondition(career, 1);
	Game.careerAdvance(career, 30 / Sim.DT);
	near(career.ship.condition, Math.max(0, 1 - 0.3 * scale), 'space scale ' + scale);
	near(Game.forecastCondition(career, 1, 30 / Sim.DT, speed, 0, true),
		Math.max(0, 1 - 0.3 * scale - Game.launchWear(career, speed) - Game.landingWear(career)));
}
Game.setSpaceWearScale(0);
assert.strictEqual(Game.forecastReportUntil(career, 1, speed, 0), Infinity);
assert.ok(Game.forecastWearCost(career, 1, 100 / Sim.DT, speed, 0, true) > 0,
	'zero space wear must not erase launch and landing wear');
assert.strictEqual(Game.forecastWearCost(career, 0.1, 100 / Sim.DT, speed, 0, true), 0.2,
	'cannot repair more condition than the ship had');
career.cheat = Game.CHEAT_COMMUNISM;
assert.strictEqual(Game.forecastWearCost(career, 1, 100, speed, 0, true), 0);
career.cheat = null;
Game.setSpaceWearScale(1);

/* Fresh and stored bot routes must price the same visits and maintenance. */
const bot = new Bot(World.WORLD_W, World.WORLD_H);
const botCareer = Game.createCareer(Game.createLedger(100));
botCareer.at = 0;
botCareer.hq = 0;
botCareer.ship.mass = 10;
botCareer.pads[0].catapult = require('../orbit_tech.js').CATAPULTS[0];
bot.careerDeparture = () => ({ ok: true, cost: 0, builds: false, canBuildStarter: true, source: 'own' });
bot.careerSiteValue = () => 0;
const probe = bot.probe;
probe.predReason = Sim.END_IMPACT;
probe.predBody = 1;
probe.predLength = 500;
probe.predLogCount = 1;
probe.predLogPlanet[0] = 1;
probe.predLogStep[0] = 60;
const rail = { launchEnergy: () => 0 };
const botMarket = Game.createMarket();
probe.predSteps = 1200;
const shortScore = bot.careerScoreProbe(botCareer, rail, 0, speed, botMarket, 0);
probe.predSteps = 4800;
const longScore = bot.careerScoreProbe(botCareer, rail, 0, speed, botMarket, 0);
assert.ok(Number.isFinite(shortScore) && Number.isFinite(longScore));
near(shortScore - longScore, 0.6, '30 seconds of extra maintenance');
const entry = { origin: 0, speedU: Game.speedUnits(speed), body: 1, steps: probe.predSteps,
	length: probe.predLength, logPlanet: probe.predLogPlanet, logStep: probe.predLogStep,
	logCount: probe.predLogCount };
near(bot.careerScoreStored(botCareer, rail, botMarket, 0, entry), longScore, 'stored score');

/* A ship predicted to arrive at zero must reserve a full repair before exit. */
Game.setShipCondition(botCareer, 0.05);
botCareer.ledger.purse = 1.99;
assert.strictEqual(bot.careerScoreProbe(botCareer, rail, 0, speed, botMarket, 0), -Infinity,
	'a dead ship with no repair money cannot afford the free exit');
botCareer.cheat = Game.CHEAT_COMMUNISM;
assert.ok(Number.isFinite(bot.careerScoreProbe(botCareer, rail, 0, speed, botMarket, 0)),
	'communism makes the mandatory repair free');
assert.strictEqual(bot.careerEval.cash, 0, 'launch wear exhausted the reporting device');
botCareer.cheat = null;
botCareer.ledger.purse = 100;
const scratchFlight = { status: Sim.STATUS_FLYING, speed: 100, liveSteps: 24 };
assert.strictEqual(bot.careerBurnPlan(botCareer, scratchFlight, botMarket, 0, false, 0), null,
	'a scratch launch that already exhausted the ship cannot burn');

/* The burn scorer includes a scratch launch's wear, but not the live prefix twice. */
Game.setShipCondition(botCareer, 0.7);
const prefix = Game.launchWear(botCareer, speed) + Game.spaceWear(botCareer, 24);
const dv = 10;
const remaining = Math.max(0, botCareer.ship.condition - prefix);
const arrival = Game.forecastCondition(botCareer, remaining, probe.predSteps, 0, dv, true);
const expectedWear = (botCareer.ship.condition - arrival) * Game.WEAR_REPAIR_COST;
const scoreFacts = bot.careerScoreFacts;
let pricedWear = -1;
let pricedArrival = -1;
bot.careerScoreFacts = function (...args) {
	pricedWear = args[11];
	pricedArrival = args[12];
	return scoreFacts.apply(this, args);
};
assert.ok(Number.isFinite(bot.careerScoreFlight(botCareer, 0, botMarket, 0, 0, 0, 0, prefix, dv)));
near(pricedWear, expectedWear, 'scratch launch and burn wear');
near(pricedArrival, arrival, 'scratch arrival condition');
bot.careerScoreFacts = scoreFacts;

/* Links validate and preserve the experimental ageing level, including zero. */
const base = { seed: 1, rate: 1, rule: Game.RULE_CAREER, shots: [], spaceWearScale: 0 };
assert.ok(Game.encodeLink(base).includes('&ws=0'));
assert.strictEqual(Game.decodeLink(Game.encodeLink(base)).spaceWearScale, 0);
base.spaceWearScale = 1.75;
assert.strictEqual(Game.decodeLink(Game.encodeLink(base)).spaceWearScale, 1.75);
assert.strictEqual(Game.decodeLink('game=1&seed=1&rate=1&rule=career&ws=3.01'), null);
assert.strictEqual(Game.decodeLink('game=1&seed=1&rate=1&rule=career').spaceWearScale, 1);
console.log('BALANCE CHANGES OK · visit cap, bribes, gravity distribution, wear forecasts, bot and links');
