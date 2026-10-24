/*
 * Headless career-bot bench: weak starter rail, pad-only planning, live speed
 * caps, task/pad/energy-wait scoring, idle shopping, then complete careers on
 * the real GravitySim. The final purse must preserve the 6.00 starter baseline.
 * Run: node experiments/career_bot_bench.js (SEEDS=42 TRACE=1 for diagnostics)
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const PLANETS = OrbitWorld.PLANETS;
const RATE = 1;
const DT = GravitySim.DT;
const PURSE_BASELINE = 6;
const MAX_FLIGHTS = 400;
const MAX_WAITS = 1200;
const SEEDS = process.env.SEEDS
	? process.env.SEEDS.split(',').map(Number)
	: [7, 31, 42, 913];
let failures = 0;

function check(name, fn) {
	try {
		fn();
		console.log('ok - ' + name);
	} catch (e) {
		failures += 1;
		console.log('FAIL - ' + name + ': ' + e.stack);
	}
}

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	const fillPlanets = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	};
	sim.setField(PLANETS, trade.planetR, strength, fillPlanets, true);
	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	const ledger = GravityGame.createLedger();
	const career = GravityGame.createCareer(ledger);
	const market = GravityGame.createMarket();
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, GravityGame.BOT_OFF);
	GravityGame.startCareer(career, sim, seed, trade, null);
	GravityGame.resetMarket(market);
	return { seed, trade, sim, career, ledger, market, bot, step: 0 };
}

function wait(w) {
	const minutes = GravityBot.CAREER_WAIT_SECONDS / 60;
	const steps = Math.max(1, Math.round(minutes / (DT * RATE)));
	GravityGame.careerAdvance(w.career, RATE, steps);
	w.step += steps;
	w.trade.advanceTo(w.trade.t + minutes);
	GravityGame.refreshBoard(w.career, w.trade, w.step);
	GravityGame.checkEnded(w.career);
	w.sim.fieldT = w.trade.t;
	w.sim.predCount = 0;
}

function fly(w, plan) {
	const { sim, career, ledger, market, trade } = w;
	assert.strictEqual(plan.origin, career.at, 'plan origin is not under the ship');
	assert.ok(career.pads[plan.origin].catapult, 'plan origin has no catapult');
	assert.ok(sim.canLaunchFrom(plan.origin), 'sim rejected the planned origin');
	assert.ok(plan.speed <= sim.speedLimit(plan.origin) + 1e-9,
		'plan speed ' + plan.speed + ' exceeds cap ' + sim.speedLimit(plan.origin));
	assert.ok(sim.canFire(plan.origin, plan.speed), 'pad cannot fire the planned shot');
	const score = plan.taskPay + plan.padValue -
		plan.energy * plan.wait * GravityBot.CAREER_ENERGY_WAIT_COST;
	assert.ok(Math.abs(score - plan.score) < 1e-9, 'score terms do not add up');

	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	sim.limitReason = GravitySim.END_TIME;
	sim.launch(plan.origin, plan.angle, plan.speed);
	GravityGame.careerBeginFlight(career, sim);
	while (sim.status === GravitySim.STATUS_FLYING) {
		w.step += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger, market, sim, w.step);
		GravityGame.careerAdvance(career, RATE, 1);
		assert.ok(w.step < 100000000, 'flight step guard');
	}
	trade.advanceTo(sim.flightFieldT);
	sim.fieldT = trade.t;
	return GravityGame.careerEndFlight(career, sim, trade, w.step);
}

function runCareer(seed, trace) {
	const w = makeWorld(seed);
	const { bot, career, sim } = w;
	let waits = 0;
	let fallbacks = 0;
	let dropped = 0;
	let boosts = 0;
	while (career.ended === GravityGame.CAREER_OPEN && career.flights < MAX_FLIGHTS) {
		bot.careerBetweenFlights(career, sim);
		if (career.ended !== GravityGame.CAREER_OPEN) break;
		assert.ok(!career.stranded, 'idle policy left the ship stranded');
		let plan = bot.careerPlan(career, sim, w.market, w.step, false);
		if (!plan) {
			plan = bot.careerPlan(career, sim, w.market, w.step, true);
			if (plan) fallbacks += 1;
		}
		if (!plan && career.at >= 0 && career.pads[career.at].catapult &&
			career.pads[career.at].chargeKwh < career.pads[career.at].battery.capacity - 0.01) {
			wait(w);
			waits += 1;
			assert.ok(waits <= MAX_WAITS, 'recharge wait guard on seed ' + seed);
			continue;
		}
		if (!plan && career.contract >= 0) {
			GravityGame.dropContract(career);
			GravityGame.refreshBoard(career, w.trade, w.step);
			dropped += 1;
			continue;
		}
		if (!plan && bot.careerUpgrade(career, sim, 120, 0)) {
			boosts += 1;
			continue;
		}
		if (!plan) {
			wait(w);
			waits += 1;
			assert.ok(waits <= MAX_WAITS, 'wait guard on seed ' + seed);
			continue;
		}
		if (trace) {
			console.log('s' + seed + ' f' + (career.flights + 1) + ' P' + plan.origin + '→P' + plan.body +
				' v' + plan.speed.toFixed(2) + '/' + sim.speedLimit(plan.origin).toFixed(2) +
				' score ' + plan.score.toFixed(3) + ' pay ' + plan.taskPay.toFixed(2) +
				' purse ' + w.ledger.purse.toFixed(2) + ' pads ' + career.padCount);
		}
		fly(w, plan);
	}
	return {
		seed,
		ended: career.ended,
		purse: w.ledger.purse,
		earned: career.earned,
		flights: career.flights,
		steps: w.step,
		pads: career.padCount,
		builds: bot.careerBuilds,
		upgrades: bot.careerUpgrades,
		delivered: career.delivered,
		evacuations: career.evacuations,
		visited: sim.visitedCount,
		waits,
		fallbacks,
		dropped,
		boosts
	};
}

check('starter EMC-1 is rail-limited to a weak 85-95 px/s dry band', () => {
	const w = makeWorld(42);
	const cap = w.sim.speedLimit(w.career.hq);
	assert.ok(cap >= 85 && cap <= 95, 'cap ' + cap);
	assert.ok(Math.abs(cap - OrbitTech.maxSpeed(w.career.ship.mass, OrbitTech.CATAPULTS[0])) < 1e-9);
	assert.ok(!w.sim.canFire(w.career.hq, 100));
});

check('career plan uses only the occupied pad, caps speed, and exposes exact score terms', () => {
	const w = makeWorld(42);
	const plan = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	assert.ok(plan, 'no opening plan');
	assert.strictEqual(plan.origin, w.career.hq);
	assert.ok(plan.speed <= w.sim.speedLimit(plan.origin) + 1e-9);
	assert.ok(Number.isFinite(plan.taskPay) && Number.isFinite(plan.padValue));
	assert.ok(plan.energy > 0 && plan.wait > 0);
	const expected = plan.taskPay + plan.padValue -
		plan.energy * plan.wait * GravityBot.CAREER_ENERGY_WAIT_COST;
	assert.ok(Math.abs(expected - plan.score) < 1e-9);
	const pad = w.career.pads[w.career.hq];
	const fullCharge = pad.chargeKwh;
	pad.chargeKwh = 0.8;
	const capped = w.bot.careerPlan(w.career, w.sim, w.market, w.step, true);
	assert.ok(capped, 'no low-charge plan');
	assert.ok(capped.speed <= w.sim.speedLimit(w.career.hq) + 1e-9,
		'low-charge speed exceeds cap ' + w.sim.speedLimit(w.career.hq));
	pad.chargeKwh = fullCharge;
	const other = (w.career.hq + 1) % PLANETS;
	w.career.at = other;
	w.sim.relocate(other);
	assert.strictEqual(w.bot.careerPlan(w.career, w.sim, w.market, w.step, false), null);
});

check('idle controller buys a hold and pads, and upgrades a weak loaded pad', () => {
	const w = makeWorld(42);
	w.ledger.purse = 40;
	w.bot.careerBetweenFlights(w.career, w.sim);
	assert.ok(w.career.ship.hold === OrbitTech.HOLDS[1], 'HOLD-8 not fitted');
	assert.ok(w.career.padCount > 1 && w.bot.careerBuilds > 0, 'no pads bought');
	assert.ok(w.ledger.purse >= PURSE_BASELINE - 1e-9, 'optional shopping spent the reserve');
	const v = makeWorld(7);
	v.ledger.purse = 100;
	assert.ok(GravityGame.installPart(v.career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[2]));
	v.career.ship.cargoTons = 24;
	v.career.ship.mass = OrbitTech.shipMass(v.career.ship, 24);
	const before = v.career.pads[v.career.hq].catapult.tier;
	assert.ok(v.bot.careerUpgrade(v.career, v.sim, 75, 6), 'loaded pad did not upgrade');
	assert.ok(v.career.pads[v.career.hq].catapult.tier > before && v.bot.careerUpgrades > 0);
});

for (const seed of SEEDS) {
	check('full career seed ' + seed + ': 26 pads and purse >= ' + PURSE_BASELINE.toFixed(2), () => {
		const r = runCareer(seed, process.env.TRACE === '1');
		console.log('  career s' + seed + ': ' + (r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
			' · purse ' + r.purse.toFixed(2) + ' · earned ' + r.earned.toFixed(2) +
			' · pads ' + r.pads + ' · flights ' + r.flights + ' · deliveries ' + r.delivered +
			' · upgrades ' + r.upgrades + ' · waits ' + r.waits + ' · fallbacks ' + r.fallbacks +
			' · evac ' + r.evacuations);
		assert.strictEqual(r.ended, GravityGame.CAREER_COMPLETE, 'career did not complete');
		assert.strictEqual(r.pads, PLANETS);
		assert.ok(r.purse + 1e-9 >= PURSE_BASELINE, 'purse baseline missed: ' + r.purse);
		assert.ok(r.flights > 0 && r.flights < MAX_FLIGHTS, 'flight guard');
		assert.ok(r.builds >= PLANETS - 1, 'not all pads were bought through the controller');
	});
}

console.log(failures === 0 ? 'CAREER BOT BENCH OK' : 'CAREER BOT BENCH FAILED ' + failures);
process.exit(failures === 0 ? 0 : 1);
