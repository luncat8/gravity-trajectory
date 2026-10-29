'use strict';
const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const OrbitWorld = require('../orbit_world.js');
const GravityGame = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');
const PLANETS = OrbitWorld.PLANETS;
const DT = GravitySim.DT;
const RATE = 0.5;

function makeWorld(seed, gravityScale, forceScale) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	const fillPlanets = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	};
	sim.setField(PLANETS, trade.planetR, strength, fillPlanets, true);
	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	const ledger = GravityGame.createLedger();
	const career = GravityGame.createCareer(ledger);
	const market = GravityGame.createMarket();
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, GravityGame.BOT_OFF);
	GravityGame.startCareer(career, sim, seed, trade, null);
	sim.setScales(gravityScale, forceScale);
	bot.setScales(gravityScale, forceScale);
	GravityGame.resetMarket(market);
	return { seed, trade, sim, career, ledger, market, bot, step: 0 };
}

const w = makeWorld(42, 1.4, 0.6);
w.ledger.purse = 120;
const bot = w.bot;
const career = w.career;
console.log('start: at', career.at, 'hq', career.hq, 'pads', career.padCount, 'purse', career.ledger.purse);
for (let i = 0; i < 3; i++) {
	bot.careerBetweenFlights(career, w.sim);
	console.log('after between', i, ': pads', career.padCount, 'purse', career.ledger.purse.toFixed(2),
		'at', career.at, 'ended', career.ended);
	if (career.ended !== GravityGame.CAREER_OPEN) break;
	const plan = bot.careerPlan(career, w.sim, w.market, w.step, false);
	console.log('plan', plan ? 'ok' : 'null');
	if (plan) console.log('  ', JSON.stringify({origin: plan.origin, body: plan.body, speed: plan.speed, score: plan.score, exitSource: plan.exitSource, exitCost: plan.exitCost}));
	if (plan) break;
}
