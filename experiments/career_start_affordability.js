/*
 * Exercise a real first career flight for every planned starting company:
 * find one exact starter-rail trajectory to an unclaimed, starter-exitable
 * site, run it through the live visit ledger, then actually build EMC-1 there.
 *
 * Run: node experiments/career_start_affordability.js (SEEDS=1-5 GS=1 FS=1)
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');
const OrbitTech = require('../orbit_tech.js');

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SEATS = 3;
const RATE = 1;
const TAU = Math.PI * 2;
const OPENING_SPEEDS = 4;
const OPENING_ANGLES = 8;
const EXIT_FRACTIONS = [0, 1 / 3, 2 / 3, 1];

function parseSeeds(value) {
	const parts = value.split('-');
	const from = Number(parts[0]);
	const to = parts.length > 1 ? Number(parts[1]) : from;
	const seeds = [];
	for (let seed = from; seed <= to; seed++) seeds.push(seed);
	return seeds;
}

const SEEDS = parseSeeds(process.env.SEEDS || '1-5');
const GRAVITY_SCALE = Number(process.env.GS || 1);
const FORCE_SCALE = Number(process.env.FS || 1);
assert.ok(Number.isFinite(GRAVITY_SCALE) && Number.isFinite(FORCE_SCALE), 'GS and FS must be finite');
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);

function makeFlightWorld(seed, home) {
	const trade = new OrbitSim(seed);
	trade.advanceTo(420);
	const strength = new Float64Array(GravitySim.MAX_BODIES);
	for (let p = 0; p < UNIVERSE; p++) strength[p] = GravityGame.planetGravity(seed, p);
	if (GravityGame.specialPlanets()) {
		if (trade.world.capitalPlanet >= 0) strength[trade.world.capitalPlanet] = 1;
		if (trade.world.arfPlanet >= 0) strength[trade.world.arfPlanet] = 1;
	}

	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setScales(GRAVITY_SCALE, FORCE_SCALE);
	sim.setPlanetMask(mask);
	const fill = (t, outX, outY, count) => {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	};
	sim.setField(PLANETS, trade.planetR, strength, fill, true);
	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;

	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const seats = GravityGame.prepareCareerStarts(galaxy, trade.world, trade,
		mask, UNIVERSE, SEATS, sim);
	assert.strictEqual(seats.length, SEATS);
	for (const seat of seats) strength[seat] = 1;
	sim.setField(PLANETS, trade.planetR, strength, fill, true);
	sim.fieldT = trade.t;

	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
	GravityGame.applyMarketSpecials(market, trade.world);
	GravityGame.bindRun(market, galaxy, trade.world);

	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, mask, UNIVERSE);
	const actorIndex = home === undefined ? 0 : seats.indexOf(home);
	assert.ok(actorIndex >= 0, 'requested home must be one of the planned seats');
	const plannedHome = seats[actorIndex];
	const actorSeed = actorIndex === 0
		? seed : GravityGame.rivalSeed(seed, actorIndex - 1);
	GravityGame.startCareer(career, sim, actorSeed, trade, null, galaxy, plannedHome);

	const occupied = new Uint8Array(PLANETS);
	for (const seat of seats) occupied[seat] = 1;
	const openings = GravityGame.careerOpenings(trade.world, trade, mask,
		UNIVERSE, occupied, sim);
	return { trade, sim, market, galaxy, career, strength, seats, openings };
}

function bestAffordableSite(world) {
	const { career, sim, market, openings } = world;
	const home = career.hq;
	const siteRow = home * PLANETS;
	const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
		OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], sim.forceScale);
	const steps = GravityGame.SPEED_STEPS;
	const minU = GravitySim.SPEED_MIN * steps;
	let capU = Math.floor(cap * steps + 1e-9);
	const maxU = GravitySim.SPEED_MAX * steps;
	if (capU > maxU) capU = maxU;
	if (capU < minU) return null;
	const span = capU - minU;
	let best = null;
	for (let s = 0; s < OPENING_SPEEDS; s++) {
		const speedU = s === OPENING_SPEEDS - 1 ? capU
			: minU + Math.round(span * s / (OPENING_SPEEDS - 1));
		const speed = GravityGame.speedOf(speedU);
		if (!GravityGame.careerCanFire(career, sim, home, speed)) continue;
		for (let a = 0; a < OPENING_ANGLES; a++) {
			const angle = GravityGame.angleOf(GravityGame.angleUnits((a + 0.5) / OPENING_ANGLES * TAU));
			sim.predictFast(home, angle, speed, GravityGame.CAP_SECONDS);
			const body = sim.predBody;
			if (sim.predReason !== GravitySim.END_IMPACT || body < 0 ||
				!Number.isFinite(openings.sitePay[siteRow + body])) continue;
			const pay = GravityGame.estimateProfit(market, 0, sim);
			if (best === null || pay > best.pay) {
				best = { body, angle, speed, pay, steps: sim.predSteps };
			}
		}
	}
	return best;
}

function starterCanExit(world, planet) {
	const { career, sim } = world;
	const pad = career.pads[planet];
	const cap = OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
		pad.catapult, career.forceScale);
	const steps = GravityGame.SPEED_STEPS;
	const minU = GravitySim.SPEED_MIN * steps;
	let capU = Math.floor(cap * steps + 1e-9);
	const maxU = GravitySim.SPEED_MAX * steps;
	if (capU > maxU) capU = maxU;
	if (capU < minU) return false;
	const span = capU - minU;
	let previous = -1;
	for (let f = 0; f < EXIT_FRACTIONS.length; f++) {
		const speedU = f === EXIT_FRACTIONS.length - 1
			? capU : minU + Math.round(span * EXIT_FRACTIONS[f]);
		if (speedU === previous) continue;
		previous = speedU;
		const speed = speedU / steps;
		for (let a = 0; a < OPENING_ANGLES; a++) {
			const angle = GravityGame.angleOf(GravityGame.angleUnits((a + 0.5) / OPENING_ANGLES * TAU));
			sim.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
			if (sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0 &&
				sim.predBody !== planet) return true;
		}
	}
	return false;
}

let tested = 0;
for (const seed of SEEDS) {
	const planWorld = makeFlightWorld(seed);
	const seats = planWorld.seats.slice();
	for (let index = 0; index < seats.length; index++) {
		const world = index === 0 ? planWorld : makeFlightWorld(seed, seats[index]);
		const { career, sim, market, trade } = world;
		const route = bestAffordableSite(world);
		if (!route) {
			const row = career.hq * PLANETS;
			console.error('no affordable exact first-flight route', { seats: world.seats, home: career.hq,
				buildable: world.openings.buildable[career.hq], buildPay: world.openings.buildPay[career.hq],
				openPay: world.openings.openPay[career.hq], canLaunch: sim.canLaunchFrom(career.hq),
				cap: sim.speedLimit(career.hq), charge: career.pads[career.hq].chargeKwh,
				catapult: career.pads[career.hq].catapult && career.pads[career.hq].catapult.id,
				fees: GravityGame.launchFee(career, career.hq, GravitySim.SPEED_MIN),
				targets: Array.from({ length: PLANETS }, (_, p) => [p, world.openings.sitePay[row + p]])
					.filter(pair => Number.isFinite(pair[1])) });
		}
		assert.ok(route, 'seed ' + seed + ' P' + career.hq + ': no affordable exact first-flight site');
		const purseBefore = career.ledger.purse;
		assert.strictEqual(career.ship.mass, OrbitTech.SHIP_DRY_MASS);

		sim.launch(career.hq, route.angle, route.speed);
		GravityGame.careerBeginFlight(career, sim);
		let step = 0;
		while (sim.status === GravitySim.STATUS_FLYING && step < GravityGame.CAP_STEPS) {
			sim.stepOne();
			step += 1;
			GravityGame.stepHarvest(career.ledger, market, sim, step);
		}
		assert.strictEqual(sim.endReason, GravitySim.END_IMPACT,
			'seed ' + seed + ' P' + career.hq + ': live first flight did not land');
		assert.strictEqual(sim.endBody, route.body,
			'seed ' + seed + ' P' + career.hq + ': live landing differed from prediction');
		GravityGame.careerEndFlight(career, sim, trade, step);

		const site = sim.endBody;
		const emc = OrbitTech.CATAPULTS[0];
		assert.ok(GravityGame.planetBuildable(career, site),
			'seed ' + seed + ' P' + career.hq + ': first landing is not an open build site');
		assert.ok(career.ledger.purse + 1e-9 >= emc.buildCost,
			'seed ' + seed + ' P' + career.hq + ': purse ' + career.ledger.purse.toFixed(2) +
			' cannot cover EMC-1 at ' + emc.buildCost.toFixed(2));
		assert.strictEqual(career.ended, GravityGame.CAREER_OPEN,
			'seed ' + seed + ' P' + career.hq + ': career ended before building');
		assert.ok(GravityGame.buildGear(career, site, OrbitTech.KIND_CATAPULT, emc),
			'seed ' + seed + ' P' + career.hq + ': live EMC-1 purchase failed');
		assert.strictEqual(career.pads[site].catapult, emc);
		assert.ok(starterCanExit(world, site),
			'seed ' + seed + ' P' + career.hq + ': newly built starter EMC cannot leave its site');

		console.log('seed ' + seed + ' company ' + index + ' · HQ P' + career.hq +
			' → P' + site + ' · predicted ' + route.pay.toFixed(2) +
			' / live ' + career.ledger.shotGain.toFixed(2) +
			' · purse ' + purseBefore.toFixed(2) + ' → ' + career.ledger.purse.toFixed(2) +
			' · built EMC-1 and verified starter exit');
		tested += 1;
	}
}
console.log('actual first-flight EMC-1 builds passed for ' + tested + ' companies across ' +
	SEEDS.length + ' seeds');
