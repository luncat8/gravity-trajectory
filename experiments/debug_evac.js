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
const Ot_ = Ot;

w.ledger.purse = 8;
career.at = -1;
career.stranded = true;
const acts1 = bot.careerBetweenFlights(career, w.sim);
console.log('lost actions', acts1, 'at', career.at, 'evac', career.evacuations);

const other = (career.hq + 1) % PLANETS;
career.at = other;
career.stranded = true;
w.sim.relocate(other);
career.ship.cargoTons = 84;
career.ship.mass = Ot_.shipMass(career.ship, 84);
w.ledger.purse = 8;
console.log('stranded at', other, 'hq', career.hq, 'mass', career.ship.mass);
console.log('  lift (starter EMC-1):', Ot_.speedLimit(Ot_.BATTERIES[0].capacity, career.ship.mass, Ot_.CATAPULTS[0], 1));
console.log('  SPEED_MIN:', GravitySim.SPEED_MIN);

const r = bot.rivals[0];
r.career = career;
r.sim = w.sim;
r.idleTries = 0;
bot.careerPlan = () => null;
bot.traceReset();
for (let i = 0; i < 3; i++) {
	console.log('--- iter', i, 'at', career.at, 'stranded', career.stranded, 'idleTries', r.idleTries, 'evac', career.evacuations, 'purse', career.ledger.purse.toFixed(2));
	const res = bot.careerLaunch(r, w.market, w.trade, RATE, 1000 + i * 600);
	console.log('    careerLaunch returned', res);
}
console.log('final evac', career.evacuations, 'at', career.at);
console.log('trace lines mentioning evac:');
for (const line of bot.trace) {
	if (line.includes('evac') || line.includes('no shot')) console.log(' ', line);
}
