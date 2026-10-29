'use strict';
const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const OrbitWorld = require('../orbit_world.js');
const GravityGame = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');
const Ot = require('../orbit_tech.js');
const PLANETS = OrbitWorld.PLANETS;
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

// Simulate expansion part:
const expansionReserve = 3 + 6 + 1;  // commercial + evac + hold = 10
console.log('expansionReserve:', expansionReserve);
let iters = 0;
while (career.ended === GravityGame.CAREER_OPEN && career.padCount < PLANETS && iters < 30) {
	const here = bot.careerDeparture(career, career.at, career.ledger.purse, career.ship.mass, w.sim);
	console.log('iter', iters, 'ok?', here.ok, 'cost', here.cost, 'source', here.source, 'pads', career.padCount, 'purse', career.ledger.purse.toFixed(2));
	if (!here.ok) { console.log('break: no affordable departure'); break; }
	const planet = bot.careerNextPad(career);
	console.log('  next pad planet:', planet);
	if (planet < 0) { console.log('break: no next'); break; }
	const before = career.ledger.purse;
	const ok = bot.careerBuyGear(career, planet, 'catapult', Ot.CATAPULTS[0], expansionReserve);
	console.log('  buy result:', ok, 'spent', (before - career.ledger.purse).toFixed(2));
	if (!ok) { console.log('break: buy failed'); break; }
	iters++;
}
console.log('end: pads', career.padCount, 'ended', career.ended);
