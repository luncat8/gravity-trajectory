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
/* scaled careers keep their own worlds and purse gates: a friendlier rail, and
 * a hostile field whose min-speed shots used to dead-end as same-pad bounces */
const SCALED_WORLDS = [
	{ gravity: 0.8, force: 1.5, purse: 6, seeds: [42, 7] },
	{ gravity: 1.4, force: 0.6, purse: 6, seeds: [42] }
];
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

function makeWorld(seed, gravityScale = 1, forceScale = 1) {
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
	/* the experimental multipliers must reach the sim and the controller alike */
	sim.setScales(gravityScale, forceScale);
	bot.setScales(gravityScale, forceScale);
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

function runCareer(seed, trace, gravityScale = 1, forceScale = 1) {
	const w = makeWorld(seed, gravityScale, forceScale);
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

check('idle controller first repairs a pad its loaded ship cannot lift', () => {
	const w = makeWorld(42);
	w.ledger.purse = 40;
	assert.ok(GravityGame.installPart(w.career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[2]));
	w.career.ship.cargoTons = 24;
	w.career.ship.mass = OrbitTech.shipMass(w.career.ship, 24);
	w.sim.setScales(1, 0.25);
	const pad = w.career.pads[w.career.hq];
	assert.ok(OrbitTech.speedLimit(pad.battery.capacity, w.career.ship.mass,
		pad.catapult, 0.25) < GravitySim.SPEED_MIN, 'test pad is liftable');
	const tier0 = pad.catapult.tier;
	assert.ok(w.bot.careerBetweenFlights(w.career, w.sim) > 0, 'idle controller did nothing');
	assert.ok(pad.catapult.tier > tier0, 'pad rail not upgraded');
	assert.ok(OrbitTech.speedLimit(pad.battery.capacity, w.career.ship.mass,
		pad.catapult, 0.25) >= GravitySim.SPEED_MIN, 'pad still cannot lift the ship');
	assert.ok(w.bot.careerPlan(w.career, w.sim, w.market, w.step, false), 'no plan after repair');
});

check('a shot that lands back on its own pad with no pay is never a plan', () => {
	const w = makeWorld(42);
	const origin = w.career.hq;
	w.career.tasks[GravityGame.COMPETE_SLOT].kind = GravityGame.TASK_NONE;
	w.bot.probe.fieldT = w.sim.fieldT;
	w.bot.probe.fieldRate = w.sim.fieldRate;
	w.bot.probe.visited.set(w.sim.visited);
	w.bot.probe.visitedCount = w.sim.visitedCount;
	w.bot.probe.predictFast(origin, 0, GravitySim.SPEED_MIN, GravityGame.CAP_SECONDS);
	assert.strictEqual(w.bot.probe.predBody, origin, 'fixture shot must fall back on the pad');
	assert.strictEqual(w.bot.careerScoreProbe(w.career, w.sim, origin, GravitySim.SPEED_MIN,
		w.market, 0), -Infinity, 'a pointless bounce must not score');
	const plan = w.bot.careerPlan(w.career, w.sim, w.market, 0, false);
	assert.ok(plan && plan.body !== origin, 'the opening plan bounces on its own pad');
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

check('careerBurnPlan: rescues a missed contract or map exit and never breaks a contract', () => {
	const w = makeWorld(42);
	const { career, sim, bot, market, ledger, trade } = w;
	ledger.purse = 60;
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[2]));
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, OrbitTech.ENGINES[2]));
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_TANK, OrbitTech.TANKS[3]));
	GravityGame.buildGear(career, career.hq, OrbitTech.KIND_CATAPULT, OrbitTech.CATAPULTS[4]);
	GravityGame.buildGear(career, career.hq, OrbitTech.KIND_BATTERY, OrbitTech.BATTERIES[4]);

	/* 1. Active loaded contract already coasting onto target: any burn must STILL land target */
	let target = (career.hq + 1) % PLANETS;
	let hitAngle = 0;
	let hitSpeed = 120;
	let foundHit = false;
	for (let p = 0; p < PLANETS && !foundHit; p++) {
		if (p === career.hq) continue;
		const ang = Math.atan2(sim.planetY[p] - sim.planetY[career.hq],
			sim.planetX[p] - sim.planetX[career.hq]);
		for (let off = -10; off <= 10 && !foundHit; off++) {
			const a = GravityGame.angleOf(GravityGame.angleUnits(ang + off * 0.02));
			for (const sp of [110, 145, 185]) {
				bot.probe.predictFast(career.hq, a, sp, GravityGame.CAP_SECONDS);
				if (bot.probe.predReason === GravitySim.END_IMPACT && bot.probe.predBody === p &&
					bot.probe.predSteps > 40) {
					target = p;
					hitAngle = a;
					hitSpeed = sp;
					foundHit = true;
				}
			}
		}
	}
	assert.ok(foundHit, 'fixture ballistic hit found');
	const task = career.tasks[0];
	task.kind = GravityGame.TASK_DELIVERY;
	task.state = GravityGame.TASK_LOADED;
	task.from = career.hq;
	task.to = target;
	task.tons = 4;
	task.reward = 4.25;
	task.deadline = 99999;
	career.contract = 0;
	career.ship.cargoTons = 4;
	career.ship.mass = OrbitTech.shipMass(career.ship, 4);

	sim.launch(career.hq, hitAngle, hitSpeed);
	GravityGame.careerBeginFlight(career, sim);
	for (let i = 0; i < 20; i++) {
		w.step += 1;
		sim.stepOne();
	}
	const keepPlan = bot.careerBurnPlan(career, sim, market, w.step);
	assert.ok(keepPlan === null || keepPlan.body === target,
		'bot burn broke an already-on-target contract');

	/* 2. Perturb velocity so coasting misses `target`: burn rescues the delivery */
	const missAngle = hitAngle + 0.14;
	sim.launch(career.hq, missAngle, hitSpeed);
	GravityGame.careerBeginFlight(career, sim);
	for (let i = 0; i < 18 && sim.status === GravitySim.STATUS_FLYING; i++) {
		w.step += 1;
		sim.stepOne();
	}
	bot.probe.predictBurnFast(sim, 0, 0);
	assert.notStrictEqual(bot.probe.predBody, target, 'perturbed shot must miss contract target');
	const rescue = bot.careerBurnPlan(career, sim, market, w.step);
	assert.ok(rescue && rescue.body === target, 'careerBurnPlan rescued contract onto target');
	const purseBefore = ledger.purse;
	assert.ok(GravityGame.careerBurn(career, sim, rescue.angle, rescue.dv));
	while (sim.status === GravitySim.STATUS_FLYING) {
		w.step += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger, market, sim, w.step);
	}
	GravityGame.careerEndFlight(career, sim, trade, w.step);
	assert.strictEqual(sim.endBody, target, 'burned flight landed on contract target');
	assert.strictEqual(career.delivered, 1, 'rescued delivery settled');
	assert.ok(ledger.purse >= purseBefore + task.reward - 1e-9, 'contract reward credited');

	/* 3. No contract, heading off-map (END_EXIT): burn pulls ship onto a planet */
	GravityGame.evacuate(career, sim);
	let exitAngle = 0;
	let foundExit = false;
	for (let k = 0; k < 48 && !foundExit; k++) {
		const a = GravityGame.angleOf(GravityGame.angleUnits(k / 48 * Math.PI * 2));
		bot.probe.predictFast(career.hq, a, 240, GravityGame.CAP_SECONDS);
		if (bot.probe.predReason === GravitySim.END_EXIT) {
			exitAngle = a;
			foundExit = true;
		}
	}
	if (foundExit) {
		sim.cargo.x = sim.planetX[career.hq] + 40;
		sim.cargo.y = sim.planetY[career.hq];
		sim.launch(career.hq, exitAngle, 120);
		GravityGame.careerBeginFlight(career, sim);
		for (let i = 0; i < 20 && sim.status === GravitySim.STATUS_FLYING; i++) sim.stepOne();
		bot.probe.predictBurnFast(sim, 0, 0);
		if (bot.probe.predReason !== GravitySim.END_IMPACT) {
			const saveBurn = bot.careerBurnPlan(career, sim, market, w.step);
			assert.ok(saveBurn && saveBurn.body >= 0, 'burn rescued off-map flight');
		}
	}
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

/* the experimental multipliers are a world change, not a cheat: the controller
 * must still finish a career under each world's own purse gate */
for (const world of SCALED_WORLDS) {
	for (const seed of world.seeds) {
		check('scaled career seed ' + seed + ' (g ×' + world.gravity + ', f ×' + world.force +
			'): 26 pads and purse >= ' + world.purse.toFixed(2), () => {
			const r = runCareer(seed, process.env.TRACE === '1', world.gravity, world.force);
			console.log('  scaled s' + seed + ' g' + world.gravity + ' f' + world.force + ': ' +
				(r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
				' · purse ' + r.purse.toFixed(2) + ' · earned ' + r.earned.toFixed(2) +
				' · pads ' + r.pads + ' · flights ' + r.flights + ' · deliveries ' + r.delivered +
				' · upgrades ' + r.upgrades + ' · waits ' + r.waits + ' · fallbacks ' + r.fallbacks +
				' · evac ' + r.evacuations);
			assert.strictEqual(r.ended, GravityGame.CAREER_COMPLETE, 'scaled career did not complete');
			assert.strictEqual(r.pads, PLANETS);
			assert.ok(r.purse + 1e-9 >= world.purse, 'scaled purse gate missed: ' + r.purse);
			assert.ok(r.flights > 0 && r.flights < MAX_FLIGHTS, 'flight guard');
		});
	}
}

console.log(failures === 0 ? 'CAREER BOT BENCH OK' : 'CAREER BOT BENCH FAILED ' + failures);
process.exit(failures === 0 ? 0 : 1);
