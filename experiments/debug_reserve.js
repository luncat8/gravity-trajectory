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
const expansionReserve = 3 + 6 + 1 + 3*6; // RESERVE(comm) + evac + hold + EMC*6
console.log('expansionReserve =', expansionReserve, 'EMC-1 cost:', Ot.CATAPULTS[0].buildCost);
let count = 0;
while (career.ended === GravityGame.CAREER_OPEN && career.padCount < PLANETS && count < 30) {
	const planet = bot.careerNextPad(career);
	console.log('pad iteration', count, 'next planet:', planet, 'pads:', career.padCount, 'purse:', career.ledger.purse.toFixed(2));
	if (planet < 0) { console.log('no next pad'); break; }
	const item = Ot.CATAPULTS[0];
	const reserve = expansionReserve;
	const price = item.buildCost;
	const need = price + reserve;
	console.log('  need purse >=', need.toFixed(2), 'have', career.ledger.purse.toFixed(2));
	if (career.ledger.purse + 1e-9 < need) { console.log('  STOP - reserve guard'); break; }
	const ok = GravityGame.buildGear(career, planet, 'catapult', item);
	console.log('  build ok:', ok, 'pads now:', career.padCount, 'purse:', career.ledger.purse.toFixed(2));
	if (!ok) break;
	count++;
}
console.log('final: pads', career.padCount, 'ended', career.ended);
