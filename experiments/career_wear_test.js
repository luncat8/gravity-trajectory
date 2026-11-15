/*
 * Ship condition, wear and repair (0.7.2): the wear law per game second of
 * flight, per landing, per EMC launch and per impulse; the three gates at
 * condition 0; the full repair and its price; the same arithmetic for a rival.
 * Run: node experiments/career_wear_test.js
 */
'use strict';

/* the no-per-step-garbage check needs a forced collection before it samples the
 * heap; without one V8's own timing decides the verdict (measured 0.6-1.0 MB of
 * unswept garbage on unchanged code), so re-run this file with --expose-gc */
if (!global.gc) {
	const child = require('child_process').spawnSync(process.execPath,
		['--expose-gc', __filename], { stdio: 'inherit' });
	process.exit(child.status === null ? 1 : child.status);
}

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const Tech = require(path.join(root, 'orbit_tech.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const DT = GravitySim.DT;
const PLANETS = World.PLANETS;
const UNIVERSE = 13;
const EPS = 1e-9;
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);

function makeSim(trade, strength) {
	const sim = new GravitySim(World.WORLD_W, World.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.setField(PLANETS, trade.planetR, strength, (t, outX, outY, count) => {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	}, true);
	sim.setScales(1, 1);
	return sim;
}

/* two companies on one galaxy: careers[0] is YOU, careers[1] a rival */
function setup(seed, cheat) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const strength = new Float64Array(PLANETS);
	for (let p = 0; p < UNIVERSE; p++) strength[p] = Game.planetGravity(seed, p);
	const market = Game.createMarket();
	Game.resetMarket(market);
	Game.applyMarketUniverse(market, mask, UNIVERSE);
	Game.applyMarketSpecials(market, trade.world);
	const galaxy = Game.createGalaxy();
	Game.resetGalaxy(galaxy, seed);
	Game.bindRun(market, galaxy, trade.world);
	const careers = [];
	const sims = [];
	for (let actor = 0; actor < 2; actor++) {
		const sim = makeSim(trade, strength);
		const career = Game.createCareer(Game.createLedger());
		Game.setCareerUniverse(career, mask, UNIVERSE);
		Game.startCareer(career, sim, actor === 0 ? seed : Game.rivalSeed(seed, 0), trade,
			cheat || null, galaxy);
		careers.push(career);
		sims.push(sim);
	}
	return { trade, market, galaxy, strength, careers, sims, career: careers[0], sim: sims[0] };
}

/* a flight needs only the facts the career functions read off the sim */
function flightSim(origin, speed) {
	return {
		origin: origin, speed: speed, flightLength: 0,
		endReason: GravitySim.END_IMPACT, endBody: -1,
		cargo: { x: 0, y: 0 },
		burnOk: true,
		markSystemsAt() {},
		canBurn(dv) { return this.burnOk && dv > 0; },
		burn() { return true; }
	};
}

function begin(w, career, speed) {
	const sim = flightSim(career.at, speed);
	Game.careerBeginFlight(career, sim);
	return sim;
}

function end(w, career, sim, reason, body) {
	sim.endReason = reason;
	sim.endBody = body;
	return Game.careerEndFlight(career, sim, w.trade, 1000);
}

function near(actual, expected, tol, message) {
	assert.ok(Math.abs(actual - expected) <= (tol === undefined ? EPS : tol),
		(message || 'value') + ': ' + actual + ' vs ' + expected);
}

function emcWear(speed) {
	return Math.min(Game.WEAR_EMC_MAX,
		Game.WEAR_EMC * Tech.launchAccel(speed) / Game.WEAR_EMC_REF);
}

let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log('ok - ' + name); }

check('a fresh company flies a new ship; the constants are the plan\'s', () => {
	const w = setup(3);
	assert.strictEqual(w.career.ship.condition, 1);
	assert.strictEqual(w.career.wearScale, 1);
	assert.strictEqual(w.career.repairs, 0);
	assert.strictEqual(w.career.maintenanceSpent, 0);
	assert.strictEqual(Game.careerShipUsable(w.career), true);
	assert.strictEqual(Game.repairCost(w.career), 0);
	assert.strictEqual(Game.WEAR_SPACE, 0.01);
	assert.strictEqual(Game.WEAR_LANDING, 0.1);
	assert.strictEqual(Game.WEAR_REPAIR_COST, 2);
	assert.strictEqual(Game.careerWearAt(w.career, 10, 20), 1, 'no weather yet');
});

check('space: 0.01 per game second of flight, none while landed', () => {
	const w = setup(5);
	const career = w.career;
	const steps100 = Math.round(100 / DT);
	Game.careerAdvance(career, steps100);
	assert.strictEqual(career.ship.condition, 1, 'a landed ship does not wear');
	career.flying = true;
	const steps30 = Math.round(30 / DT);
	for (let i = 0; i < steps30; i++) Game.careerAdvance(career, 1);
	near(career.ship.condition, 0.7, 1e-9, '30 s of flight, stepped');
	Game.setShipCondition(career, 1);
	Game.careerAdvance(career, steps30);
	near(career.ship.condition, 0.7, 1e-9, '30 s of flight, one call');
	/* the weather hook is the identity: it charges nothing on top */
	Game.careerWeatherWear(career, flightSim(career.at, 100));
	near(career.ship.condition, 0.7, 1e-9, 'identity weather');
	Game.setShipCondition(career, 1);
	Game.careerAdvance(career, steps100);
	assert.strictEqual(career.ship.condition, 0, '100 s of flight is a whole ship');
	assert.strictEqual(career.ledger.reports, false, 'a worn-out ship stops reporting in flight');
	Game.careerAdvance(career, steps100);
	assert.strictEqual(career.ship.condition, 0, 'the floor holds');
});

check('landing: an impact costs 0.1; exit, timeout and abort cost none', () => {
	const cases = [
		[GravitySim.END_IMPACT, true, Game.WEAR_LANDING],
		[GravitySim.END_EXIT, false, 0],
		[GravitySim.END_TIME, false, 0],
		[GravitySim.END_ABORT, false, 0]
	];
	for (const [reason, lands, wear] of cases) {
		assert.notStrictEqual(reason, undefined, 'end reason exists');
		const w = setup(7);
		const career = w.career;
		const sim = begin(w, career, 100);
		const before = career.ship.condition;
		end(w, career, sim, reason, lands ? career.hq : -1);
		near(before - career.ship.condition, wear, 1e-12, 'landing wear, reason ' + reason);
		assert.strictEqual(career.flying, false);
	}
});

check('EMC: 100 px/s costs 0.089, 200 px/s 0.357; the launch cap holds', () => {
	for (const [speed, expected] of [[100, 0.089], [200, 0.357]]) {
		const w = setup(9);
		w.career.ledger.purse = 99;
		begin(w, w.career, speed);
		const wear = 1 - w.career.ship.condition;
		near(wear, emcWear(speed), 1e-12, 'EMC wear at ' + speed);
		near(wear, expected, 0.0005, 'plan figure at ' + speed);
	}
	const w = setup(9);
	w.career.ledger.purse = 99;
	begin(w, w.career, 320);
	near(1 - w.career.ship.condition, Game.WEAR_EMC_MAX, 1e-12, 'a very fast rail is capped');
	assert.strictEqual(Game.WEAR_EMC_MAX, 0.5);
});

check('impulse: 200 px/s costs 0.1; a refused burn costs nothing', () => {
	const w = setup(11);
	const career = w.career;
	career.ship.engine = Tech.ENGINES[Tech.ENGINES.length - 1];
	career.ship.tank = Tech.TANKS[Tech.TANKS.length - 1];
	career.ship.fuelKg = career.ship.tank.fuelCap;
	const sim = begin(w, career, GravitySim.SPEED_MIN);
	const before = career.ship.condition;
	sim.burnOk = false;
	assert.strictEqual(Game.careerBurn(career, sim, 0, 200), false, 'the sim refuses');
	assert.strictEqual(career.ship.condition, before, 'no wear for a refused burn');
	sim.burnOk = true;
	const fuel = career.ship.fuelKg;
	assert.strictEqual(Game.careerBurn(career, sim, 0, 200), true);
	assert.ok(career.ship.fuelKg < fuel, 'fuel spent');
	near(before - career.ship.condition, 0.1, 1e-12, '200 px/s burn');
	const mid = career.ship.condition;
	career.ship.fuelKg = career.ship.tank.fuelCap;
	assert.strictEqual(Game.careerBurn(career, sim, 0, 100), true);
	near(mid - career.ship.condition, 0.05, 1e-12, 'proportional to delivered Δv');
});

check('science: 20 accepted points wear 0.6 of the base; the floor is 0.5', () => {
	const w = setup(13);
	const career = w.career;
	near(Game.wearFactor(career), 1);
	career.research = 20;
	near(Game.wearFactor(career), 0.6);
	career.flying = true;
	Game.careerAdvance(career, Math.round(30 / DT));
	near(1 - career.ship.condition, 0.3 * 0.6, 1e-9, 'the same 30 s flight');
	career.research = 25;
	near(Game.wearFactor(career), 0.5);
	career.research = 400;
	near(Game.wearFactor(career), Game.WEAR_SCIENCE_MIN, EPS, 'floor');
	career.wearScale = Game.WEAR_FLEET;
	near(Game.wearFactor(career), 1, EPS, 'a fleet ship wears twice as fast');
});

check('zero gates: no launch from any rail, no burn, no report; evacuation still works', () => {
	const w = setup(17);
	const career = w.career;
	const sim = w.sim;
	career.ledger.purse = 99;
	const speed = GravitySim.SPEED_MIN;
	const rival = w.careers[1];
	/* own HQ, a padless commercial world, the Capital, a rival's HQ */
	const capital = career.capitalPlanet;
	let padless = -1;
	for (let p = 0; p < UNIVERSE && padless < 0; p++) {
		if (p !== career.hq && p !== rival.hq && p !== capital && p !== career.arfPlanet) padless = p;
	}
	const spots = [career.hq, padless, rival.hq];
	if (capital >= 0) spots.push(capital);
	for (const planet of spots) {
		Game.placeShip(career, sim, planet);
		Game.setCommercial(career, planet === padless ? planet : -1);
		Game.setShipCondition(career, 1);
		const healthy = Game.railBlock(career, sim, planet, speed);
		assert.notStrictEqual(healthy, Game.WORN_OUT_BLOCK, 'a new ship is not worn out on P' + planet);
		Game.setShipCondition(career, 0);
		assert.strictEqual(Game.railBlock(career, sim, planet, speed), Game.WORN_OUT_BLOCK,
			'worn out on P' + planet);
		assert.strictEqual(Game.careerCanFire(career, sim, planet, speed), false);
		assert.strictEqual(Game.repairLaunchBlock(career, sim, planet, speed), healthy,
			'a repair restores exactly the healthy gate on P' + planet);
	}
	assert.strictEqual(career.ledger.reports, false);
	w.market.lastVisitStep[padless] = -1e9;
	assert.strictEqual(Game.harvestPlanet(career.ledger, w.market, padless, 100), 0,
		'a visit pays nothing at 0');
	Game.setShipCondition(career, 0.01);
	assert.strictEqual(career.ledger.reports, true);
	assert.ok(Game.harvestPlanet(career.ledger, w.market, padless, 100) > 0,
		'and pays again above 0');

	/* no impulse at 0, even with a full tank and a willing sim */
	career.ship.engine = Tech.ENGINES[Tech.ENGINES.length - 1];
	career.ship.tank = Tech.TANKS[Tech.TANKS.length - 1];
	career.ship.fuelKg = career.ship.tank.fuelCap;
	Game.setShipCondition(career, 0);
	const fuel = career.ship.fuelKg;
	assert.strictEqual(Game.careerBurn(career, flightSim(career.at, speed), 0, 50), false);
	assert.strictEqual(career.ship.fuelKg, fuel, 'a refused burn spends no fuel');

	/* evacuation is not an EMC launch */
	Game.placeShip(career, sim, padless);
	assert.strictEqual(career.stranded, true);
	const purse = career.ledger.purse;
	assert.strictEqual(Game.evacuate(career, sim), true);
	assert.strictEqual(career.at, career.hq);
	near(purse - career.ledger.purse, Game.CAREER.evacFee);
	assert.strictEqual(career.ended, Game.CAREER_OPEN, 'the purse still covers the repair');
});

check('a purse-gated repair-and-launch counts both prices', () => {
	const w = setup(19);
	const career = w.career;
	const speed = GravitySim.SPEED_MIN;
	Game.setShipCondition(career, 0.5);
	career.ledger.purse = 0.99;
	assert.ok(Game.repairLaunchBlock(career, w.sim, career.hq, speed).startsWith('repair + fee 1.00'),
		Game.repairLaunchBlock(career, w.sim, career.hq, speed));
	career.ledger.purse = 1;
	assert.strictEqual(Game.repairLaunchBlock(career, w.sim, career.hq, speed),
		Game.railBlock(career, w.sim, career.hq, speed));
});

check('repair: 2.00 from 0, 1.00 from 0.5, free under communism, never twice', () => {
	const w = setup(23);
	const career = w.career;
	career.ledger.purse = 10;
	assert.strictEqual(Game.repairCareer(career), false, 'nothing to repair at 1');
	Game.setShipCondition(career, 0);
	assert.strictEqual(Game.repairCost(career), 2);
	assert.strictEqual(Game.repairCareer(career), true);
	assert.strictEqual(career.ship.condition, 1);
	assert.strictEqual(career.ledger.reports, true, 'the repaired ship reports again');
	near(career.ledger.purse, 8);
	Game.setShipCondition(career, 0.5);
	assert.strictEqual(Game.repairCost(career), 1);
	assert.strictEqual(Game.repairCareer(career), true);
	near(career.ledger.purse, 7);
	assert.strictEqual(Game.repairCareer(career), false, 'no double charge at 1');
	near(career.ledger.purse, 7);
	assert.strictEqual(career.repairs, 2);
	near(career.maintenanceSpent, 3);
	const stats = { income: 0, running: 0, profit: 0, property: 0, science: 0, flown: 0 };
	Game.careerStats(stats, career);
	near(stats.running, 3, EPS, 'maintenance is a running cost');
	assert.strictEqual(stats.property, 0, 'a repair is consumed, not owned');

	/* the purse must cover it, and a 0.001 residue never survives a repair */
	Game.setShipCondition(career, 0.25);
	career.ledger.purse = 1.49;
	assert.strictEqual(Game.repairCareer(career), false, '1.50 > 1.49');
	assert.strictEqual(career.ship.condition, 0.25);
	Game.setShipCondition(career, 0.999);
	assert.strictEqual(Game.repairCareer(career), true);
	assert.strictEqual(career.ship.condition, 1);

	/* not in flight, not lost in space */
	Game.setShipCondition(career, 0.5);
	career.ledger.purse = 10;
	career.flying = true;
	assert.strictEqual(Game.repairCareer(career), false, 'no repair in flight');
	career.flying = false;
	const at = career.at;
	career.at = -1;
	assert.strictEqual(Game.repairCareer(career), false, 'no repair lost in space');
	career.at = at;

	const c = setup(23, 'communism').career;
	Game.setShipCondition(c, 0);
	const purse = c.ledger.purse;
	assert.strictEqual(Game.repairCost(c), 0);
	assert.strictEqual(Game.repairCareer(c), true);
	assert.strictEqual(c.ledger.purse, purse, 'communism repairs for nothing');
	assert.strictEqual(c.maintenanceSpent, 0);
	assert.strictEqual(c.ship.condition, 1);
});

check('a worn-out ship the purse cannot repair ends the company; a fresh start is a fresh ship', () => {
	const w = setup(29);
	const career = w.career;
	career.ledger.purse = 1.5;
	const sim = begin(w, career, GravitySim.SPEED_MIN);
	Game.setShipCondition(career, 0.05);
	assert.strictEqual(Game.checkEnded(career), Game.CAREER_OPEN, 'not judged in flight');
	assert.strictEqual(end(w, career, sim, GravitySim.END_IMPACT, career.hq), Game.CAREER_BROKE);
	assert.strictEqual(career.ship.condition, 0);
	Game.startCareer(career, w.sim, 29, w.trade, null, w.galaxy, career.hq);
	assert.strictEqual(career.ship.condition, 1);
	assert.strictEqual(career.ledger.reports, true);
	assert.strictEqual(career.repairs, 0);
	assert.strictEqual(career.maintenanceSpent, 0);
});

check('every company: a rival wears by the same arithmetic and services at 0.7', () => {
	const w = setup(31);
	const rival = w.careers[1];
	const rivalSim = w.sims[1];
	assert.strictEqual(rival.index, 1);
	const speed = 100;
	rival.ledger.purse = 20;
	const sim = begin(w, rival, speed);
	const steps = Math.round(20 / DT);
	for (let i = 0; i < steps; i++) Game.careerAdvance(rival, 1);
	end(w, rival, sim, GravitySim.END_IMPACT, rival.hq);
	const expected = 1 - emcWear(speed) - 0.2 - Game.WEAR_LANDING;
	near(rival.ship.condition, expected, 1e-9, 'launch + 20 s + landing');
	assert.ok(rival.ship.condition <= GravityBot.CAREER_REPAIR_AT);

	const bot = new GravityBot(World.WORLD_W, World.WORLD_H);
	bot.attachWorld(w.trade);
	bot.setPlanetMask(mask, UNIVERSE);
	bot.setScales(1, 1);
	bot.strength.set(w.strength);
	bot.probe.fieldT = w.trade.t;
	bot.probe.fieldRate = 1;

	/* above the service line nothing is spent */
	Game.setShipCondition(rival, 0.71);
	assert.strictEqual(bot.careerRepair(rival, 0), false);
	/* at the line the launch reserve is kept back */
	Game.setShipCondition(rival, 0.7);
	rival.ledger.purse = Game.repairCost(rival) + GravityBot.CAREER_PURSE_RESERVE - 0.01;
	assert.strictEqual(bot.careerRepair(rival, 0), false, 'the reserve is not spent on service');
	/* at 0 the whole purse goes: nothing else gets the ship flying */
	Game.setShipCondition(rival, 0);
	rival.ledger.purse = 2;
	assert.strictEqual(bot.careerRepair(rival, 0), true);
	assert.strictEqual(rival.ship.condition, 1);

	Game.setShipCondition(rival, expected);
	rival.ledger.purse = 20;
	const cost = Game.repairCost(rival);
	bot.careerBetweenFlights(rival, rivalSim, 0);
	assert.strictEqual(rival.ship.condition, 1, 'serviced between flights');
	assert.strictEqual(rival.repairs, 2);
	assert.ok(rival.ledger.purse <= 20 - cost + EPS, 'and paid for');

	/* the bot's exit gate names a worn-out ship where it stands */
	Game.setShipCondition(rival, 0);
	const exit = bot.careerDeparture(rival, rival.at, 99, rival.ship.mass, rivalSim);
	assert.strictEqual(exit.ok, false);
	assert.strictEqual(exit.reason, 'ship worn out');
});

check('the frame path allocates nothing: careerAdvance and the weather hook are arithmetic', () => {
	const w = setup(37);
	const career = w.career;
	const sim = flightSim(career.at, 100);
	career.flying = true;
	career.research = 400;
	const run = n => {
		for (let i = 0; i < n; i++) {
			Game.careerAdvance(career, 1);
			Game.careerWeatherWear(career, sim);
			if (career.ship.condition < 0.5) Game.setShipCondition(career, 1);
		}
	};
	/* warm the JIT on the same loop, then sample only retained memory: an
	 * uncollected step costs nothing and a compiled one is not garbage */
	run(20000);
	run(200000);
	global.gc();
	const before = process.memoryUsage().heapUsed;
	run(200000);
	global.gc();
	const grown = process.memoryUsage().heapUsed - before;
	console.log('   200000 flight steps · heap ' + (grown / 1024).toFixed(0) + ' kB');
	assert.ok(grown < 512 * 1024, 'no per-step garbage: ' + grown + ' bytes');
});

console.log('WEAR OK · ' + checks + ' groups');
