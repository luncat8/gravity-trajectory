'use strict';
const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const OrbitWorld = require('../orbit_world.js');
const GravityGame = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');
const Ot = require('../orbit_tech.js');
const PLANETS = OrbitWorld.PLANETS;
const RATE = 0.5;

function makeWorld(seed) {
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
	GravityGame.resetMarket(market);
	return { seed, trade, sim, career, ledger, market, bot };
}

const w = makeWorld(42);
const career = w.career;
const bot = w.bot;

w.ledger.purse = 8;
const other = (career.hq + 1) % PLANETS;
career.at = other;
career.stranded = true;
w.sim.relocate(other);
career.ship.cargoTons = 84;
career.ship.mass = Ot.shipMass(career.ship, 84);

// simulate build first
console.log('before build: padLift', GravityGame.padLift(career, other));
const built = GravityGame.buildGear(career, other, 'catapult', Ot.CATAPULTS[0]);
console.log('built?', built, 'stranded', career.stranded);
console.log('after build: padLift', GravityGame.padLift(career, other), '< SPEED_MIN?', GravityGame.padLift(career, other) + 1e-9 < GravitySim.SPEED_MIN);
console.log('purse', career.ledger.purse, 'evacPrice', 6);
