/*
 * Headless career-bot bench: weak starter rail, pad-only planning, live speed
 * caps, task/pad/energy-wait scoring, idle shopping, then complete careers on
 * the real GravitySim. An EMC costs 9.00 and every planet's commercial rail
 * charges 3.00 a launch, so the 6.00 starter purse is a grind: the grind guard
 * checks survival, the completion runs start from a funded mid-game purse.
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
const LATE_PURSE = 30;
const MAX_FLIGHTS = 400;
const MAX_WAITS = 1200;
const SEEDS = process.env.SEEDS
	? process.env.SEEDS.split(',').map(Number)
	: [7, 31, 42, 913];
/* scaled careers keep their own worlds and purse gates: a friendlier rail, and
 * a hostile field whose min-speed shots used to dead-end as same-pad bounces */
const SCALED_WORLDS = [
	{ gravity: 0.8, force: 1.5, purse: LATE_PURSE, seeds: [42, 7] },
	{ gravity: 1.4, force: 0.6, purse: 4 * LATE_PURSE, seeds: [42] }
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
	assert.ok(GravityGame.padAt(career, plan.origin).catapult, 'plan origin has no EMC');
	assert.ok(sim.canLaunchFrom(plan.origin), 'sim rejected the planned origin');
	assert.ok(plan.speed <= sim.speedLimit(plan.origin) + 1e-9,
		'plan speed ' + plan.speed + ' exceeds cap ' + sim.speedLimit(plan.origin));
	assert.ok(sim.canFire(plan.origin, plan.speed), 'pad cannot fire the planned shot');
	const score = plan.taskPay + plan.padValue - plan.fee -
		plan.energy * plan.wait * GravityBot.CAREER_ENERGY_WAIT_COST;
	assert.ok(Math.abs(score - plan.score) < 1e-9, 'score terms do not add up');

	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	sim.limitReason = GravitySim.END_TIME;
	sim.launch(plan.origin, plan.angle, plan.speed);
	GravityGame.careerBeginFlight(career, sim);
	let flightStep = 0;
	while (sim.status === GravitySim.STATUS_FLYING) {
		w.step += 1;
		flightStep += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger, market, sim, w.step);
		GravityGame.careerAdvance(career, RATE, 1);
		if (w.bot.careerUseResearch && flightStep === 24 &&
			career.ship.engine !== null && career.ship.fuelKg > 0.5) {
			const burn = w.bot.careerBurnPlan(career, sim, market, w.step);
			if (burn && GravityGame.careerBurn(career, sim, burn.angle, burn.dv)) {
				w.burns = (w.burns || 0) + 1;
			}
		}
		assert.ok(w.step < 100000000, 'flight step guard');
	}
	trade.advanceTo(sim.flightFieldT);
	sim.fieldT = trade.t;
	return GravityGame.careerEndFlight(career, sim, trade, w.step);
}

function runCareer(seed, trace, gravityScale = 1, forceScale = 1, useResearch = false,
	startPurse = PURSE_BASELINE) {
	const w = makeWorld(seed, gravityScale, forceScale);
	w.ledger.purse = startPurse;
	const { bot, career, sim } = w;
	bot.careerUseResearch = useResearch;
	/* CPU meter: candidate traces the controller spent. NOBOOK=1 disables the
	 * launch book, so two runs show what remembering buys. */
	let traces = 0;
	const traceFast = bot.probe.predictFast;
	bot.probe.predictFast = function (...args) {
		traces += 1;
		return traceFast.apply(this, args);
	};
	if (process.env.NOBOOK) bot.careerBookTag = () => NaN;
	const planTrace = [];
	let waits = 0;
	let fallbacks = 0;
	let dropped = 0;
	let boosts = 0;
	while (career.ended === GravityGame.CAREER_OPEN && career.flights < MAX_FLIGHTS) {
		bot.careerBetweenFlights(career, sim);
		if (career.ended !== GravityGame.CAREER_OPEN) break;
		/* a padless planet is no dead end: the commercial EMC lifts every ship */
		assert.ok(career.at >= 0, 'idle policy lost the ship');
		let mark = traces;
		let plan = bot.careerPlan(career, sim, w.market, w.step, false);
		planTrace.push(traces - mark);
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
		researches: bot.careerResearches,
		burns: w.burns || 0,
		delivered: career.delivered,
		evacuations: career.evacuations,
		visited: sim.visitedCount,
		waits,
		fallbacks,
		dropped,
		boosts,
		traces,
		planTrace,
		plans: bot.careerPlans
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
	const expected = plan.taskPay + plan.padValue - plan.fee -
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
	const away = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	assert.ok(away && away.origin === other,
		'a padless planet must still plan off the commercial EMC');
});

check('idle controller first repairs a pad its loaded ship cannot lift', () => {
	const w = makeWorld(42);
	w.ledger.purse = 40;
	assert.ok(GravityGame.installPart(w.career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[2]));
	w.career.ship.cargoTons = 24;
	w.career.ship.mass = OrbitTech.shipMass(w.career.ship, 24);
	w.sim.setScales(1, 0.25);
	w.career.forceScale = 0.25;
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

check('padless solvency gate counts this flight\'s launch fee', () => {
	const w = makeWorld(42);
	const other = (w.career.hq + 1) % PLANETS;
	w.career.at = other;
	w.sim.relocate(other);
	w.bot.probe.fieldT = w.sim.fieldT;
	w.bot.probe.fieldRate = w.sim.fieldRate;
	w.bot.probe.visited.set(w.sim.visited);
	w.bot.probe.visitedCount = w.sim.visitedCount;
	/* a commercial shot off the padless planet onto another padless planet */
	let speed = 80;
	let body = -1;
	for (let a = 0; a < 160 && body < 0; a++) {
		w.bot.probe.predictFast(other, a / 160 * Math.PI * 2, speed, GravityGame.CAP_SECONDS);
		if (w.bot.probe.predReason === GravitySim.END_IMPACT &&
			w.bot.probe.predBody !== other && w.bot.probe.predBody !== w.career.hq) {
			body = w.bot.probe.predBody;
		}
	}
	assert.ok(body >= 0, 'fixture found no padless landing');
	const cash = GravityGame.estimateProfit(w.market, 0, w.bot.probe);
	const exit = GravityGame.exitCostAt(w.career, body, w.career.ship.mass);
	const fee = GravityGame.launchFee(w.career, other, speed);
	assert.ok(fee > 0 && exit > 0, 'fixture must fly commercial off a padless planet');
	/* enough for the old gate (purse + cash >= exit + margin), short once
	 * this flight's own fee is counted: the shot must not score */
	w.ledger.purse = fee + exit * 1.5 - cash - 0.5;
	assert.strictEqual(w.bot.careerScoreProbe(w.career, w.sim, other, speed, w.market, 0),
		-Infinity, 'a landing the purse cannot leave must not score');
	w.ledger.purse += 1;
	assert.ok(Number.isFinite(w.bot.careerScoreProbe(w.career, w.sim, other, speed, w.market, 0)),
		'the same shot must score once the exit is covered after the fee');
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

/* the 6.00 starter purse cannot fund a 9.00 pad, so a career only has to
 * survive the commercial-rail grind long enough to claim a second planet */
for (const seed of SEEDS) {
	check('starter grind seed ' + seed + ': survives the 6.00 start and claims a pad', () => {
		const r = runCareer(seed, process.env.TRACE === '1');
		console.log('  grind s' + seed + ': ' + (r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
			' · purse ' + r.purse.toFixed(2) + ' · pads ' + r.pads + ' · flights ' + r.flights);
		assert.ok(r.flights >= 4, 'career died before the first pad: ' + r.flights);
		assert.ok(r.pads >= 2, 'starter career never claimed a second pad');
		assert.ok(r.purse + 1e-9 >= 0, 'purse went negative');
	});
}

for (const seed of SEEDS) {
	check('full career seed ' + seed + ': 26 pads from a funded purse', () => {
		const r = runCareer(seed, process.env.TRACE === '1', 1, 1, false, LATE_PURSE);
		console.log('  career s' + seed + ': ' + (r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
			' · purse ' + r.purse.toFixed(2) + ' · earned ' + r.earned.toFixed(2) +
			' · pads ' + r.pads + ' · flights ' + r.flights + ' · deliveries ' + r.delivered +
			' · upgrades ' + r.upgrades + ' · waits ' + r.waits + ' · fallbacks ' + r.fallbacks +
			' · evac ' + r.evacuations + ' · plans ' + r.plans + ' · traces ' + r.traces);
		assert.strictEqual(r.ended, GravityGame.CAREER_COMPLETE, 'career did not complete');
		assert.strictEqual(r.pads, PLANETS);
		assert.ok(r.purse + 1e-9 >= 0, 'purse went negative: ' + r.purse);
		assert.ok(r.flights > 0 && r.flights < MAX_FLIGHTS, 'flight guard');
		assert.ok(r.builds >= PLANETS - 1, 'not all pads were bought through the controller');
		if (process.env.CPU === '1') {
			const hist = [0, 0, 0, 0];
			for (const n of r.planTrace) {
				if (n === 0) hist[0] += 1;
				else if (n <= 50) hist[1] += 1;
				else if (n <= 250) hist[2] += 1;
				else hist[3] += 1;
			}
			console.log('  CPU s' + seed + ' plans ' + r.planTrace.length + ' (book ' + hist[0] +
				', <=50 ' + hist[1] + ', <=250 ' + hist[2] + ', big ' + hist[3] + ') traces ' + r.traces);
		}
	});
}

/* the experimental multipliers are a world change, not a cheat: the controller
 * must still finish a career under each world's own purse gate */
for (const world of SCALED_WORLDS) {
	for (const seed of world.seeds) {
		check('scaled career seed ' + seed + ' (g ×' + world.gravity + ', f ×' + world.force +
			'): 26 pads', () => {
			const r = runCareer(seed, process.env.TRACE === '1', world.gravity, world.force, false,
				world.purse);
			console.log('  scaled s' + seed + ' g' + world.gravity + ' f' + world.force + ': ' +
				(r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
				' · purse ' + r.purse.toFixed(2) + ' · earned ' + r.earned.toFixed(2) +
				' · pads ' + r.pads + ' · flights ' + r.flights + ' · deliveries ' + r.delivered +
				' · upgrades ' + r.upgrades + ' · waits ' + r.waits + ' · fallbacks ' + r.fallbacks +
				' · evac ' + r.evacuations);
			assert.strictEqual(r.ended, GravityGame.CAREER_COMPLETE, 'scaled career did not complete');
			assert.strictEqual(r.pads, PLANETS);
			assert.ok(r.purse + 1e-9 >= 0, 'scaled purse went negative: ' + r.purse);
			assert.ok(r.flights > 0 && r.flights < MAX_FLIGHTS, 'flight guard');
		});
	}
}

/* 0.4.15 research-enabled careers: HQ R&D unlocks bridge rails + composite tank/engine
 * prototypes and uses mid-flight burns while still meeting the 6.00 purse gate */
for (const cfg of [
	{ seed: 42, gravity: 1.4, force: 0.6, purse: 2 * LATE_PURSE, label: 'hostile bridge-rail R&D' },
	{ seed: 42, gravity: 0.8, force: 1.5, purse: LATE_PURSE, label: 'friendly-rail R&D' }
]) {
	check('research career seed ' + cfg.seed + ' (' + cfg.label +
		'): 26 pads and R&D used', () => {
		const r = runCareer(cfg.seed, process.env.TRACE === '1', cfg.gravity, cfg.force, true,
			cfg.purse);
		console.log('  research s' + cfg.seed + ' g' + cfg.gravity + ' f' + cfg.force + ': ' +
			(r.ended === GravityGame.CAREER_COMPLETE ? 'complete' : 'ENDED ' + r.ended) +
			' · purse ' + r.purse.toFixed(2) + ' · earned ' + r.earned.toFixed(2) +
			' · pads ' + r.pads + ' · flights ' + r.flights + ' · deliveries ' + r.delivered +
			' · researches ' + r.researches + ' · upgrades ' + r.upgrades + ' · burns ' + r.burns);
		assert.strictEqual(r.ended, GravityGame.CAREER_COMPLETE, 'research career did not complete');
		assert.strictEqual(r.pads, PLANETS);
		assert.ok(r.researches >= 1, 'bot did not unlock any research prototype');
		assert.ok(r.purse + 1e-9 >= 0, 'research purse went negative: ' + r.purse);
	});
}

check('career rivals queue on the EMC barrel: the shot fires only once it lines up', () => {
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 42);
	const w = makeWorld(42);
	w.ledger.purse = 60;
	w.bot.reset(42, GravityGame.RULE_CAREER, GravityGame.BOT_EASY);
	assert.strictEqual(w.bot.count, 1, 'one rival career');
	w.bot.startCareers(galaxy, 42, w.trade);
	const r = w.bot.rivals[0];
	assert.ok(r.career && r.career.galaxy === galaxy, 'the rival career missed the galaxy');
	let step = 0;
	while (step < 20000 && !r.turret && r.sim.status !== GravitySim.STATUS_FLYING) {
		step += 1;
		w.bot.stepCareer(step, w.market, w.trade, RATE);
	}
	assert.ok(r.turret, 'the rival never queued a shot');
	assert.notStrictEqual(r.sim.status, GravitySim.STATUS_FLYING,
		'the queued shot left before the barrel lined up');
	assert.ok(r.turret.fireAt >= step, 'the queue must wait for a later step');
	const commercial = r.turret.pad === GravityGame.COMMERCIAL_PAD;
	assert.strictEqual(r.turret.pad.reservedKwh, commercial ? 0 : r.turret.energy,
		'the queued shot must reserve the pad charge it needs');
	const fireAt = r.turret.fireAt;
	while (step < fireAt + 2 && r.sim.status !== GravitySim.STATUS_FLYING) {
		step += 1;
		w.bot.stepCareer(step, w.market, w.trade, RATE);
	}
	assert.strictEqual(r.sim.status, GravitySim.STATUS_FLYING, 'the aligned shot never fired');
	assert.strictEqual(r.turret, null, 'the fired shot keeps its queue entry');
	assert.strictEqual(r.turret === null && r.career.pads[r.sim.origin].reservedKwh, 0,
		'the fired shot must release its reservation');
});

check('career plan saves its winner and reuses it without tracing again', () => {
	const w = makeWorld(42);
	const plan = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	assert.ok(plan, 'no opening plan');
	const book = w.career.launchBook;
	assert.strictEqual(book.entries.length, 1, 'the winner did not reach the book');
	const entry = book.entries[0];
	assert.strictEqual(entry.origin, plan.origin);
	assert.strictEqual(entry.angleU, plan.angleU);
	assert.strictEqual(entry.speedU, plan.speedU);
	assert.strictEqual(entry.body, plan.body);
	assert.ok(entry.logCount > 0, 'a saved trace must keep its visit log');
	/* the stored log re-prices to the very same score a fresh trace gives */
	const stored = w.bot.careerScoreStored(w.career, w.sim, w.market, w.step, entry);
	assert.ok(Math.abs(stored - plan.score) < 1e-9, 'stored ' + stored + ' vs plan ' + plan.score);
	/* a good stored shot ends the search: the second plan spends no trace */
	assert.ok(plan.score >= GravityBot.CAREER_BOOK_ENOUGH,
		'fixture plan must clear the book bar: ' + plan.score);
	let traces = 0;
	const original = w.bot.probe.predictFast;
	w.bot.probe.predictFast = function (...args) {
		traces += 1;
		return original.apply(this, args);
	};
	const again = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	w.bot.probe.predictFast = original;
	assert.strictEqual(traces, 0, 'the book must answer without tracing');
	assert.strictEqual(again.angleU, plan.angleU);
	assert.strictEqual(again.speedU, plan.speedU);
	assert.ok(Math.abs(again.score - plan.score) < 1e-9);
	/* a saved speed above the live pad cap is skipped: the fan must run */
	const speeds = book.entries.map(e => e.speedU);
	for (let i = 0; i < book.entries.length; i++) {
		book.entries[i].speedU = GravityGame.speedUnits(GravitySim.SPEED_MAX);
	}
	traces = 0;
	w.bot.probe.predictFast = function (...args) {
		traces += 1;
		return original.apply(this, args);
	};
	const stale = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	w.bot.probe.predictFast = original;
	for (let i = 0; i < book.entries.length; i++) book.entries[i].speedU = speeds[i];
	assert.ok(traces > 0, 'a stored speed the pad cannot fire must not end the search');
	assert.ok(stale && stale.speed <= w.sim.speedLimit(w.career.at) + 1e-9,
		'the plan exceeds the live pad cap');
	/* and a drained pad is searched from scratch, never above its live cap */
	const pad = w.career.pads[w.career.at];
	const charge = pad.chargeKwh;
	pad.chargeKwh = 0.8;
	const low = w.bot.careerPlan(w.career, w.sim, w.market, w.step, true);
	pad.chargeKwh = charge;
	assert.ok(!low || low.speed <= w.sim.speedLimit(w.career.at) + 1e-9,
		'a drained pad must never plan above its cap');
});

check('patient company: a losing plan that cannot claim a pad is sat out, never forever', () => {
	const w = makeWorld(42);
	/* the queue waits for the EMC barrel, so the career needs its galaxy clock */
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 42);
	w.career.galaxy = galaxy;
	const r = w.bot.rivals[0];
	r.career = w.career;
	r.waitTries = 0;
	/* a padless landing that can pay for its own EMC is progress, so it flies */
	assert.strictEqual(w.bot.careerShouldWait({ score: -5, builds: true }, 0), false);
	/* a paying plan is flown */
	assert.strictEqual(w.bot.careerShouldWait({ score: 2, builds: false }, 0), false);
	/* a losing one is not */
	assert.strictEqual(w.bot.careerShouldWait({ score: -0.5, builds: false }, 0), true);
	assert.strictEqual(
		w.bot.careerShouldWait({ score: -0.5, builds: false }, GravityBot.CAREER_SIT_TRIES - 1), true);
	assert.strictEqual(
		w.bot.careerShouldWait({ score: -0.5, builds: false }, GravityBot.CAREER_SIT_TRIES), false,
		'the sit budget must expire, or a company could wait forever');
	/* the launch path really sits: no queue entry, a longer gap, no energy claimed */
	const plan = w.bot.careerPlan(w.career, w.sim, w.market, w.step, false);
	assert.ok(plan, 'no plan to test the sit with');
	w.bot.careerPlan = function () {
		return { origin: w.career.hq, body: (w.career.hq + 1) % PLANETS, angle: 0.3,
			speed: GravitySim.SPEED_MIN, score: -1, builds: false, taskPay: -1, padValue: 0,
			energy: 0, wait: 0, fee: 0, steps: 10 };
	};
	const step = 500;
	assert.strictEqual(w.bot.careerLaunch(r, w.market, w.trade, RATE, step), false);
	assert.strictEqual(r.turret, null, 'a losing plan must not reserve pad charge');
	assert.strictEqual(r.waitTries, 1);
	assert.ok(r.readyStep >= step + GravityBot.CAREER_SIT_GAP, 'the company must sit the gap');
	assert.ok(r.career.pads[r.career.at].reservedKwh === 0, 'no energy is claimed while sitting');
	/* after the budget it takes the least bad shot anyway */
	for (let i = 1; i < GravityBot.CAREER_SIT_TRIES; i++) {
		assert.strictEqual(w.bot.careerLaunch(r, w.market, w.trade, RATE, step + i), false);
	}
	assert.strictEqual(r.waitTries, GravityBot.CAREER_SIT_TRIES, 'the sit budget must count up');
	assert.strictEqual(w.bot.careerLaunch(r, w.market, w.trade, RATE, step + 100), false);
	assert.ok(r.turret, 'the company never stopped waiting');
	assert.strictEqual(r.waitTries, 0, 'a taken shot resets the patience');
});

check('flat fees are priced as fees: a lost or stranded ship evacuates', () => {
	const w = makeWorld(42);
	const career = w.career;
	w.ledger.purse = 8;
	/* a ship that left the map: the idle controller must bring it home */
	career.at = -1;
	career.stranded = true;
	assert.ok(w.bot.careerBetweenFlights(career, w.sim) > 0,
		'the idle controller ignored a ship in space');
	assert.strictEqual(career.at, career.hq, 'the lost ship did not come home');
	assert.strictEqual(career.evacuations, 1);
	/* a stranded landing: the launch path evacuates after two planless tries */
	/* below the 9.00 pad price the idle shop cannot claim the planet, so the
	 * only way out is the 6.00 evacuation the old fee bug made unaffordable */
	const other = (career.hq + 1) % PLANETS;
	career.at = other;
	career.stranded = true;
	w.sim.relocate(other);
	w.ledger.purse = 8;
	const r = w.bot.rivals[0];
	r.career = career;
	r.sim = w.sim;
	r.idleTries = 0;
	w.bot.careerPlan = () => null;
	w.bot.traceReset();
	for (let i = 0; i < 3; i++) {
		assert.strictEqual(w.bot.careerLaunch(r, w.market, w.trade, RATE, 1000 + i * 600), false);
	}
	assert.strictEqual(career.evacuations, 2, 'the stranded ship never evacuated');
	assert.strictEqual(career.at, career.hq);
	assert.ok(w.bot.trace.some(line => line.includes('evacuated to P')),
		'the evacuation is missing from the decision trace');
});

check('an unreachable contract is dropped instead of parking a company forever', () => {
	const w = makeWorld(42);
	const career = w.career;
	const r = w.bot.rivals[0];
	r.career = career;
	r.sim = w.sim;
	r.idleTries = 0;
	w.ledger.purse = 20;
	/* a starter hold cannot load these tasks; fit the 24 t one at HQ */
	const OrbitTechBench = require(path.join(root, 'orbit_tech.js'));
	assert.ok(GravityGame.installPart(career, OrbitTechBench.KIND_HOLD,
		OrbitTechBench.HOLDS[2]), 'the test hold did not fit');
	let accepted = false;
	for (let i = 0; i < GravityGame.BOARD_SIZE && !accepted; i++) {
		accepted = GravityGame.acceptTask(career, i);
	}
	assert.ok(accepted && career.contract >= 0, 'no contract to test with');
	w.bot.careerPlan = () => null;
	/* the idle shop would immediately take a fresh offer; this check is about
	 * the planless recovery itself */
	w.bot.careerBetweenFlights = () => 0;
	w.bot.traceReset();
	const step = 900;
	for (let i = 0; i < 3; i++) {
		assert.strictEqual(w.bot.careerLaunch(r, w.market, w.trade, RATE, step + i * 600), false);
	}
	assert.strictEqual(career.contract, -1, 'the stale contract was never dropped');
	assert.strictEqual(r.idleTries, 0, 'a recovery must reset the idle counter');
	assert.ok(w.bot.trace.some(line => line.includes('dropped the unreachable contract')),
		'the contract drop is missing from the decision trace');
	assert.ok(r.readyStep <= step + 1201, 'the company must retry at once');
});

check('a finished career gives its queued pad charge back', () => {
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 42);
	const w = makeWorld(42);
	w.bot.reset(42, GravityGame.RULE_CAREER, GravityGame.BOT_EASY);
	w.bot.startCareers(galaxy, 42, w.trade);
	const r = w.bot.rivals[0];
	const pad = r.career.pads[r.career.hq];
	GravityGame.reserveEnergy(pad, 0.5);
	r.turret = { pad: pad, energy: 0.5, fireAt: 99999 };
	r.career.ended = GravityGame.CAREER_COMPLETE;
	w.bot.stepCareer(100, w.market, w.trade, RATE);
	assert.strictEqual(r.turret, null, 'the queue outlived the company');
	assert.strictEqual(pad.reservedKwh, 0, 'the reserved charge was never released');
});

check('the decision log shows live state, reasons and stays bounded', () => {
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 42);
	const w = makeWorld(42);
	w.bot.reset(42, GravityGame.RULE_CAREER, GravityGame.BOT_EASY);
	w.bot.startCareers(galaxy, 42, w.trade);
	for (let step = 1; step <= 4000; step++) w.bot.stepCareer(step, w.market, w.trade, RATE);
	const log = w.bot.decisionLog(4000, 'bench · career');
	assert.ok(log.startsWith('gravity cargo · bot decisions'), 'missing log title');
	assert.ok(log.includes('bench · career'), 'missing page header');
	assert.ok(/R1 · .*purse .*pads .*flights/.test(log), 'missing live state: ' + log);
	assert.ok(log.includes('kWh →'), 'the live rail is missing');
	assert.ok(log.includes('decisions ('), 'the decisions section is missing');
	assert.ok(/] R1 (plan|queue|fire|land|sit|no shot|commercial)/.test(log),
		'no rival decisions were recorded');
	assert.ok(w.bot.trace.length <= GravityBot.TRACE_MAX, 'the trace is unbounded');
	for (let i = 0; i < GravityBot.TRACE_MAX * 2; i++) w.bot.traceAdd(0, 'test', '', i);
	assert.strictEqual(w.bot.trace.length, GravityBot.TRACE_MAX,
		'the ring buffer must evict old lines');
	const short = w.bot.actorStateShort(0, 4000);
	assert.ok(short.length > 0 && short.length < 80, 'unusable short state: ' + short);
});

console.log(failures === 0 ? 'CAREER BOT BENCH OK' : 'CAREER BOT BENCH FAILED ' + failures);
process.exit(failures === 0 ? 0 : 1);
