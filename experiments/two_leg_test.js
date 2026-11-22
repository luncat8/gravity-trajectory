/*
 * Two-leg quest valuation & quest planner helper (0.7.40):
 *   1. Heavy pickup where EMC-1 cannot lift `ship.mass + tons` is rejected (`feasible === false`).
 *   2. Fragile delivery allows high-speed unloaded leg 1 while capping leg 2 at `<= FRAGILE_SPEED`.
 *   3. Capital entry (-3.00), `CAPITAL_REFUND` (+3.00), `careerRefundEscrow` and flyby visit
 *      stamps match live two-flight execution within 1e-9 (entry and stay-pay modes).
 *   4. `GravityBot` score and `gui_helper` quest score agree within 1e-9 on the same candidate.
 *   5. `plan quest` plans prospective or accepted contracts, writes both `launchBook` rows,
 *      emits `bookTrace` 13-tuples that replay cleanly in `CareerActions`, arms leg 1, and
 *      leaves leg 2 immediately fireable upon landing at `from`.
 *   6. Repeated `careerLegPlan` calls stay allocation-flat under `--expose-gc`.
 *
 * Run: node experiments/two_leg_test.js
 */
'use strict';

if (!global.gc) {
	const child = require('child_process').spawnSync(process.execPath,
		['--expose-gc', __filename], { stdio: 'inherit' });
	process.exit(child.status === null ? 1 : child.status);
}

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

let checks = 0;
function check(ok, msg) {
	checks += 1;
	assert.ok(ok, msg);
}

function get(env, expr) {
	return vm.runInContext(expr, env.context);
}

function until(env, expr, ms = 16, limit = 1800) {
	for (let i = 0; i < limit && !get(env, expr); i++) env.runFrames(1, ms);
	assert.ok(get(env, expr), 'timed out waiting for: ' + expr);
}

/* Find a direct impact shot (origin -> goal) within [minSpeed, maxSpeed]. */
function findImpact(sim, Game, origin, goal, minSpeed, maxSpeed) {
	const tau = Math.PI * 2;
	const lo = Math.max(sim.constructor.SPEED_MIN, minSpeed);
	const hi = Math.min(sim.constructor.SPEED_MAX, maxSpeed);
	for (let s = 0; s <= 12; s++) {
		const speed = Game.speedOf(Game.speedUnits(lo + (hi - lo) * s / 12));
		for (let a = 0; a < 72; a++) {
			const angleU = Game.angleUnits((a + 0.5) / 72 * tau);
			const angle = Game.angleOf(angleU);
			sim.predict(origin, angle, speed, Game.CAP_SECONDS);
			if (sim.predReason === sim.constructor.END_IMPACT && sim.predBody === goal) {
				return {
					origin: origin, body: goal, angleU: angleU, speedU: Game.speedUnits(speed),
					angle: angle, speed: speed, steps: sim.predSteps, length: sim.predLength,
					time: sim.predTime,
					logPlanet: Int16Array.from(sim.predLogPlanet.subarray(0, sim.predLogCount)),
					logStep: Int32Array.from(sim.predLogStep.subarray(0, sim.predLogCount)),
					logDwell: Int32Array.from(sim.predLogDwell.subarray(0, sim.predLogCount)),
					logCount: sim.predLogCount
				};
			}
		}
	}
	return null;
}

/* Fly one exact snapped shot through the live career rules. */
function flyLiveShot(Game, Sim, career, market, sim, trade, startStep, angleU, speedU) {
	const origin = career.at;
	const angle = Game.angleOf(angleU);
	const speed = Game.speedOf(speedU);
	sim.clear();
	sim.stepLimit = Math.round(Game.CAP_SECONDS / Sim.DT);
	sim.limitReason = Sim.END_TIME;
	sim.launch(origin, angle, speed);
	/* careerBeginFlight opens the ledger itself, as the game does: beginFlight's
	 * free-flight shot cost is not a career charge */
	Game.careerBeginFlight(career, sim, startStep);
	let step = startStep;
	while (sim.status === Sim.STATUS_FLYING) {
		step += 1;
		sim.stepOne();
		Game.careerAdvance(career, 1, sim);
		Game.stepHarvest(career.ledger, market, sim, step);
	}
	Game.endFlight(career.ledger);
	Game.careerEndFlight(career, sim, trade, step);
	return step;
}

function unlockGear(career, item) {
	career.owned[item.id] = true;
}

/* --- 1. Heavy pickup rejection (`feasible === false`) ------------------- */
{
	const env = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: Game, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	const market = scene.game.market;
	career.ledger.purse = 80;
	unlockGear(career, Tech.HOLDS[1]);
	unlockGear(career, Tech.CATAPULTS[2]);
	unlockGear(career, Tech.BATTERIES[2]);
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	assert.ok(Game.buildGear(career, career.at, 'catapult', Tech.CATAPULTS[2]));
	assert.ok(Game.buildGear(career, career.at, 'battery', Tech.BATTERIES[2]));
	career.pads[career.at].chargeKwh = career.pads[career.at].battery.capacity;
	/* Lock EMC-2/EMC-3 blueprints again and keep purse low so an unowned pickup
	 * must rely on its standing commercial EMC-1! */
	delete career.owned[Tech.CATAPULTS[2].id];
	delete career.owned[Tech.BATTERIES[2].id];

	let pickup = -1;
	let dropoff = -1;
	let leg1Hit = null;
	for (let p = 0; p < sim.planetCount && pickup < 0; p++) {
		if (!sim.planetActive(p) || p === career.at || p === career.capitalPlanet ||
			p === career.arfPlanet || career.pads[p].catapult !== null) continue;
		const h1 = findImpact(sim, Game, career.at, p, 60, 260);
		/* the 3.2 purse below is tight: a leg 1 that loses money is a cash trap, not the shallow control */
		if (!h1 || Game.estimateProfitLog(market, scene.game.clockSteps, h1.logPlanet, h1.logStep,
			h1.logCount, career.ledger, undefined, undefined, h1.logDwell) < 0) continue;
		for (let q = 0; q < sim.planetCount; q++) {
			if (!sim.planetActive(q) || q === p || q === career.at || q === career.capitalPlanet) continue;
			const h2 = findImpact(sim, Game, p, q, 55, 82);
			if (h2) {
				pickup = p;
				dropoff = q;
				leg1Hit = h1;
				break;
			}
		}
	}
	assert.ok(pickup >= 0 && dropoff >= 0, 'expected a reachable two-leg pair on map 1');

	for (const t of career.tasks) t.kind = Game.TASK_NONE;
	career.contract = -1;
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: pickup, to: dropoff, tons: 2, fragile: false,
		reward: 5.5, deadline: scene.game.clockSteps + 40000
	});
	assert.ok(Game.acceptTask(career, 0));
	career.ledger.purse = 3.2;

	const outOk = Game.createLegPlan();
	const visit1 = Game.estimateProfitLog(market, scene.game.clockSteps,
		leg1Hit.logPlanet, leg1Hit.logStep, leg1Hit.logCount, career.ledger, undefined,
		undefined, leg1Hit.logDwell);
	Game.careerLegPlan(outOk, career, market, sim, {
		origin: career.at, body: pickup, speed: leg1Hit.speed,
		length: leg1Hit.length, steps: leg1Hit.steps, visitPay: visit1,
		logPlanet: leg1Hit.logPlanet, logStep: leg1Hit.logStep,
		logDwell: leg1Hit.logDwell, logCount: leg1Hit.logCount
	}, scene.game.clockSteps);
	check(outOk.feasible && outOk.hasSecond, 'shallow pickup should have a feasible second leg');

	/* Make `pickup` a deep gravity well where EMC-1 cannot lift `ship.mass + 3t`. */
	career.tasks[0].tons = 3;
	const savedStrength = sim.strength[pickup];
	sim.strength[pickup] = 4.8;
	sim.stepStale = true;
	sim.refreshField();
	scene.bot.probe.strength[pickup] = 4.8;
	scene.bot.probe.stepStale = true;
	scene.bot.probe.refreshField();

	/* Re-find a leg-1 impact into the now-heavy well (even easier to fall into!). */
	const intoHeavy = findImpact(sim, Game, career.at, pickup, 60, 260);
	assert.ok(intoHeavy, 'expected a shot falling into heavy pickup well');
	const visitHeavy = Game.estimateProfitLog(market, scene.game.clockSteps,
		intoHeavy.logPlanet, intoHeavy.logStep, intoHeavy.logCount, career.ledger, undefined,
		undefined, intoHeavy.logDwell);
	const outHeavy = Game.createLegPlan();
	Game.careerLegPlan(outHeavy, career, market, sim, {
		origin: career.at, body: pickup, speed: intoHeavy.speed,
		length: intoHeavy.length, steps: intoHeavy.steps, visitPay: visitHeavy,
		logPlanet: intoHeavy.logPlanet, logStep: intoHeavy.logStep,
		logDwell: intoHeavy.logDwell, logCount: intoHeavy.logCount
	}, scene.game.clockSteps);
	check(outHeavy.feasible === false && outHeavy.credit === 0 && outHeavy.total === -Infinity,
		'heavy pickup that cannot lift loaded ship on EMC-1 must be rejected');

	/* Bot rejects the doomed pickup too (`reject === 'leg2'`). */
	scene.bot.probe.stepStale = true;
	scene.bot.probe.refreshField();
	scene.bot.probe.predict(career.at, intoHeavy.angle, intoHeavy.speed, Game.CAP_SECONDS);
	const botHeavyScore = scene.bot.careerScoreProbe(career, sim, career.at,
		intoHeavy.speed, market, scene.game.clockSteps);
	check(botHeavyScore === -Infinity && scene.bot.careerEval.reject === 'leg2',
		'GravityBot must reject doomed heavy pickup');

	/* Quest scan refuses landing on the doomed heavy pickup. */
	env.click('helperQuest');
	until(env, 'helperStopBtn.hidden');
	if (scene.aimState().armed) {
		check(sim.predBody !== pickup, 'quest scan must not arm a doomed heavy pickup');
	}

	/* Board acceptance (`careerAccept`) rejects gravity-trapped and deadline-impossible offers. */
	Game.dropContract(career);
	career.acceptAfterStep = 0;
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: pickup, to: dropoff, tons: 3, fragile: false,
		reward: 5.5, deadline: scene.game.clockSteps + 40000
	});
	check(scene.bot.careerAccept(career, scene.game.clockSteps, sim) === false,
		'careerAccept must refuse a gravity-trapped pickup on the board');

	sim.strength[pickup] = savedStrength;
	sim.stepStale = true;
	sim.refreshField();
	scene.bot.probe.strength[pickup] = savedStrength;
	scene.bot.probe.stepStale = true;
	scene.bot.probe.refreshField();
	career.tasks[0].tons = 2;
	career.tasks[0].deadline = scene.game.clockSteps + 5;
	check(scene.bot.careerAccept(career, scene.game.clockSteps, sim) === false,
		'careerAccept must refuse a deadline-impossible delivery on the board');
	console.log('1. heavy/deadline pickup rejection: feasible=false, bot & quest scan refuse doomed pickup');
}

/* --- 2. Fragile delivery: fast unloaded leg 1, gentle (<= 140) leg 2 ---- */
{
	const env = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: Game, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	const market = scene.game.market;
	career.ledger.purse = 80;
	unlockGear(career, Tech.CATAPULTS[2]);
	unlockGear(career, Tech.BATTERIES[2]);
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	assert.ok(Game.buildGear(career, career.at, 'catapult', Tech.CATAPULTS[2]));
	assert.ok(Game.buildGear(career, career.at, 'battery', Tech.BATTERIES[2]));
	career.pads[career.at].chargeKwh = career.pads[career.at].battery.capacity;

	let fromP = -1;
	let toP = -1;
	let fastLeg1 = null;
	for (let p = 0; p < sim.planetCount && fromP < 0; p++) {
		if (!sim.planetActive(p) || p === career.at || p === career.capitalPlanet ||
			p === career.arfPlanet) continue;
		/* Give `p` an EMC-3 rail so high speeds (> FRAGILE_SPEED) WOULD be possible
		 * if fragile weren't enforced on leg 2! */
		Game.buildGear(career, p, 'catapult', Tech.CATAPULTS[2]);
		Game.buildGear(career, p, 'battery', Tech.BATTERIES[2]);
		career.pads[p].chargeKwh = career.pads[p].battery.capacity;
		const h1 = findImpact(sim, Game, career.at, p, Game.FRAGILE_SPEED + 35, 320);
		if (!h1 || h1.speed <= Game.FRAGILE_SPEED + 10) continue;
		for (let q = 0; q < sim.planetCount; q++) {
			if (!sim.planetActive(q) || q === p || q === career.at) continue;
			const gentle2 = findImpact(sim, Game, p, q, 60, Game.FRAGILE_SPEED - 2);
			const fast2 = findImpact(sim, Game, p, q, Game.FRAGILE_SPEED + 30, 300);
			if (gentle2 && fast2) {
				fromP = p;
				toP = q;
				fastLeg1 = h1;
				break;
			}
		}
	}
	assert.ok(fromP >= 0 && toP >= 0 && fastLeg1.speed > Game.FRAGILE_SPEED,
		'expected fast leg-1 + gentle/fast leg-2 pair');

	for (const t of career.tasks) t.kind = Game.TASK_NONE;
	career.contract = -1;
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: fromP, to: toP, tons: 2, fragile: true,
		reward: 6.0, deadline: scene.game.clockSteps + 50000
	});
	assert.ok(Game.acceptTask(career, 0));

	const visit1 = Game.estimateProfitLog(market, scene.game.clockSteps,
		fastLeg1.logPlanet, fastLeg1.logStep, fastLeg1.logCount, career.ledger, undefined,
		undefined, fastLeg1.logDwell);
	const planFragile = Game.createLegPlan();
	Game.careerLegPlan(planFragile, career, market, sim, {
		origin: career.at, body: fromP, speed: fastLeg1.speed,
		length: fastLeg1.length, steps: fastLeg1.steps, visitPay: visit1,
		logPlanet: fastLeg1.logPlanet, logStep: fastLeg1.logStep,
		logDwell: fastLeg1.logDwell, logCount: fastLeg1.logCount
	}, scene.game.clockSteps);
	check(planFragile.feasible && planFragile.hasSecond,
		'fast unloaded leg 1 must be allowed on fragile delivery');
	const leg2Speed = Game.speedOf(planFragile.leg2.speedU);
	check(leg2Speed <= Game.FRAGILE_SPEED + 1e-9,
		'loaded fragile leg 2 exceeded FRAGILE_SPEED: ' + leg2Speed);
	console.log('2. fragile two-leg: leg1 ' + fastLeg1.speed.toFixed(1) +
		' px/s (> ' + Game.FRAGILE_SPEED + '), leg2 ' + leg2Speed.toFixed(1) + ' px/s (<= ' + Game.FRAGILE_SPEED + ')');
}

/* --- 3. Capital entry, CAPITAL_REFUND & live two-flight purse parity ---- */
for (const mode of ['entry', 'tick']) {
	const env = loadPage({ search: mapSearch(1) + (mode === 'tick' ? '&ht=1' : '') });
	const { GravityScene: scene, GravityGame: Game, GravitySim: Sim, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	const market = scene.game.market;
	const trade = env.context.OrbitScene.sim;

	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	career.ledger.purse = 18;
	const cap = career.capitalPlanet;
	assert.ok(cap >= 0, 'expected active Capital planet');
	Game.placeShip(career, sim, cap);

	/* 3a. Medical contract at Capital: +3 refund, free Capital departure,
	 * rebel commercial fee on loaded return, -3 Capital entry + patient reward. */
	const loadedMass = Tech.shipMass(career.ship, 4);
	const capOutLimit = Tech.speedLimit(Game.CAPITAL_PAD.battery.capacity, loadedMass,
		Game.CAPITAL_PAD.catapult, sim.forceScale);
	const rebelRetLimit = Tech.speedLimit(Game.COMMERCIAL_PAD.battery.capacity, loadedMass,
		Game.COMMERCIAL_PAD.catapult, sim.forceScale);
	let rebel = -1;
	let outShot = null;
	for (let p = 0; p < sim.planetCount; p++) {
		if (!sim.planetActive(p) || p === cap || p === career.arfPlanet) continue;
		const h1 = findImpact(sim, Game, cap, p, 52, capOutLimit - 2);
		const h2 = findImpact(sim, Game, p, cap, 52, rebelRetLimit - 1);
		if (h1 && h2) {
			rebel = p;
			outShot = h1;
			break;
		}
	}
	assert.ok(rebel >= 0, 'expected reachable rebel <-> Capital pair');
	Game.seizePlanet(market, scene.game.galaxy, rebel, scene.game.clockSteps);
	market.patients[rebel] = 4;
	Game.refreshBoard(career, trade, scene.game.clockSteps);
	const mTask = career.tasks[Game.MEDIC_SLOT];
	assert.strictEqual(mTask.kind, Game.TASK_MEDIC);
	mTask.to = rebel;
	mTask.patients = 4;
	mTask.medics = 4;
	mTask.reward = 8;

	/* Prospective evaluation BEFORE accepting at Capital includes +3 CAPITAL_REFUND. */
	const cond0 = career.ship.condition;
	const repUntil = Game.forecastReportUntil(career, cond0, outShot.speed, 0);
	const visit1 = Game.estimateProfitLog(market, scene.game.clockSteps,
		outShot.logPlanet, outShot.logStep, outShot.logCount, career.ledger,
		repUntil, undefined, outShot.logDwell);
	const preAcceptPlan = Game.createLegPlan();
	Game.careerLegPlan(preAcceptPlan, career, market, sim, {
		origin: cap, body: rebel, speed: outShot.speed,
		length: outShot.length, steps: outShot.steps, visitPay: visit1,
		condition: cond0, logPlanet: outShot.logPlanet, logStep: outShot.logStep,
		logDwell: outShot.logDwell, logCount: outShot.logCount
	}, scene.game.clockSteps, { slot: Game.MEDIC_SLOT });
	check(preAcceptPlan.feasible && preAcceptPlan.hasSecond && preAcceptPlan.prospective,
		'prospective Capital medic offer must verify');

	const purseBeforeAccept = career.ledger.purse;
	assert.ok(Game.acceptTask(career, Game.MEDIC_SLOT));
	check(Math.abs(career.ledger.purse - (purseBeforeAccept + Game.CAPITAL_REFUND)) < 1e-9,
		'accepting medic at Capital must grant +3 refund');

	const postAcceptPlan = Game.createLegPlan();
	Game.careerLegPlan(postAcceptPlan, career, market, sim, {
		origin: cap, body: rebel, speed: outShot.speed,
		length: outShot.length, steps: outShot.steps, visitPay: visit1,
		condition: cond0, logPlanet: outShot.logPlanet, logStep: outShot.logStep,
		logDwell: outShot.logDwell, logCount: outShot.logCount
	}, scene.game.clockSteps);
	check(postAcceptPlan.feasible && postAcceptPlan.hasSecond,
		'accepted Capital medic contract must verify');
	check(Math.abs((purseBeforeAccept + preAcceptPlan.purseDelta) -
		(career.ledger.purse + postAcceptPlan.purseDelta)) < 1e-9,
		'pre-accept (+3 refund) and post-accept purse forecasts must match');

	const expectedFinalPurse = career.ledger.purse + postAcceptPlan.purseDelta;
	const stepAfter1 = flyLiveShot(Game, Sim, career, market, sim, trade,
		scene.game.clockSteps, outShot.angleU, outShot.speedU);
	assert.strictEqual(career.at, rebel);
	assert.strictEqual(career.tasks[Game.MEDIC_SLOT].aboard, 4);
	flyLiveShot(Game, Sim, career, market, sim, trade,
		stepAfter1, postAcceptPlan.leg2.angleU, postAcceptPlan.leg2.speedU);
	assert.strictEqual(career.at, cap);
	assert.strictEqual(career.contract, -1, 'medical mission completed and cleared escrow');
	/* the plan books the forced repair of a worn-out arrival; the game charges it at the next exit */
	const livePurse = career.ledger.purse - Game.forecastRepairReserve(career, career.ship.condition);
	check(Math.abs(livePurse - expectedFinalPurse) < 1e-9,
		'live two-flight medic purse (' + livePurse + ') drifted from careerLegPlan (' +
		expectedFinalPurse + ') in mode=' + mode);
	console.log('3. Capital/medic/escrow two-flight parity (' + mode + '): purse ' +
		career.ledger.purse.toFixed(4) + ' === forecast');
}

/* --- 4. Bot score and helper score agree within 1e-9 -------------------- */
{
	const env = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: Game, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	const market = scene.game.market;
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	/* Place on Capital (zero solar-recharge wait penalty) with purse = 2.2
	 * (< EMC-1 buildCost 3.04) and fresh visit stamps so `claim` is false:
	 * both bot and helper evaluate pure two-leg trajectory net with zero
	 * pad-building bonus or solar-wait offset. */
	Game.placeShip(career, sim, career.capitalPlanet);
	market.lastVisitStep.fill(55000);
	scene.game.clockSteps = 50000;

	/* Pick an unowned commercial world where `purse < EMC-1.buildCost (3.04)`
	 * and `visitPay === 0` from Capital (zero solar wait), so `claim === false`
	 * and both bot and helper evaluate pure two-leg trajectory net (`hasSecond`). */
	let pickup = -1;
	let dropoff = -1;
	let candShot = null;
	for (let p = 0; p < sim.planetCount && pickup < 0; p++) {
		if (!sim.planetActive(p) || p === career.at || p === career.capitalPlanet ||
			Game.padOwner(career, p, false) !== Game.OWNER_COMMERCIAL) continue;
		market.corruption[p] = 0;
		const h1 = findImpact(sim, Game, career.at, p, 50, 140);
		if (!h1) continue;
		for (let q = 0; q < sim.planetCount; q++) {
			if (!sim.planetActive(q) || q === p || q === career.at || q === career.capitalPlanet) continue;
			if (Game.hasFeasibleLeg(career, sim, p, q, Tech.shipMass(career.ship, 1), false, 45000)) {
				pickup = p;
				dropoff = q;
				candShot = h1;
				break;
			}
		}
	}
	assert.ok(candShot && dropoff >= 0, 'expected Capital -> commercial -> dropoff candidate');
	for (const t of career.tasks) t.kind = Game.TASK_NONE;
	career.contract = -1;
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: pickup, to: dropoff, tons: 1, fragile: false,
		reward: 6.5, deadline: scene.game.clockSteps + 45000
	});
	assert.ok(Game.acceptTask(career, 0));
	career.tasks[0].capitalRefund = 0;
	career.ledger.purse = 2.95;

	/* Score through GravityBot */
	scene.bot.probe.predict(career.at, candShot.angle, candShot.speed, Game.CAP_SECONDS);
	const botScore = scene.bot.careerScoreProbe(career, sim, career.at,
		candShot.speed, market, scene.game.clockSteps);

	/* Score the identical candidate through gui_helper (`helperScore` with goal='quest') */
	const helperQuestScore = get(env, `(() => {
		helperAttachWorld();
		helperState.goal = 'quest';
		helperProbe.predict(${career.at}, ${candShot.angle}, ${candShot.speed}, GravityGame.CAP_SECONDS);
		const s = helperScore(helperProbe, { origin: ${career.at}, angleU: ${candShot.angleU}, speedU: ${candShot.speedU} });
		helperState.goal = 'score';
		return s;
	})()`);

	check(Number.isFinite(botScore) && Number.isFinite(helperQuestScore),
		'both bot and helper must produce finite two-leg scores');
	check(Math.abs(botScore - helperQuestScore) < 1e-9,
		'bot score (' + botScore + ') vs helper score (' + helperQuestScore + ') exceeded 1e-9');
	check(Math.abs(scene.bot.careerEval.legPlan - helperQuestScore) < 1e-12,
		'careerEval.legPlan and helperQuestScore must be identical');
	console.log('4. bot/helper score parity: ' + botScore.toFixed(6) + ' vs ' + helperQuestScore.toFixed(6));
}

/* --- 5. `plan quest` UI + launchBook + live two-leg flight + replay ----- */
{
	const env = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: Game, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	career.ledger.purse = 25;
	assert.ok(Game.buildGear(career, career.at, 'catapult', Tech.CATAPULTS[1]));
	assert.ok(Game.buildGear(career, career.at, 'battery', Tech.BATTERIES[1]));
	career.pads[career.at].chargeKwh = career.pads[career.at].battery.capacity;
	get(env, "careerAct({act:'careerTab',tab:'shots'})");

	let pickup = -1;
	let dropoff = -1;
	for (let p = 0; p < sim.planetCount && pickup < 0; p++) {
		if (!sim.planetActive(p) || p === career.at || p === career.capitalPlanet ||
			p === career.arfPlanet) continue;
		if (!findImpact(sim, Game, career.at, p, 55, 165)) continue;
		for (let q = 0; q < sim.planetCount; q++) {
			if (!sim.planetActive(q) || q === p || q === career.at || q === career.capitalPlanet) continue;
			if (findImpact(sim, Game, p, q, 55, 82)) {
				pickup = p;
				dropoff = q;
				break;
			}
		}
	}
	assert.ok(pickup >= 0 && dropoff >= 0, 'expected plannable delivery route on map 1');

	for (const t of career.tasks) t.kind = Game.TASK_NONE;
	career.contract = -1;
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: pickup, to: dropoff, tons: 2, fragile: false,
		reward: 7.5, deadline: scene.game.clockSteps + 50000
	});

	/* 5a. Prospective `plan quest` while contract < 0: plans offer #1 without
	 * auto-accepting or spending purse. */
	const purseBefore = career.ledger.purse;
	env.click('helperPlanQuest');
	check(!env.elements.get('helperStop').hidden, 'plan quest must start sliced scan');
	until(env, 'helperStopBtn.hidden');
	check(career.contract === -1 && career.ledger.purse === purseBefore,
		'prospective plan quest must not auto-accept or touch purse');
	check(/offer #1 \(accept to fly\)/.test(env.elements.get('careerMsg').textContent),
		'prospective plan quest must name the planned board offer: ' +
		env.elements.get('careerMsg').textContent);

	/* Solo (`bot=off`) career without active rivals must still prime exitProbe in plan quest. */
	const soloEnv = loadPage({ search: mapSearch(1) + '&bot=off' });
	const soloScene = soloEnv.context.GravityScene;
	const soloGame = soloEnv.context.GravityGame;
	const soloTech = soloEnv.context.OrbitTech;
	assert.ok(soloGame.installPart(soloScene.career, 'hold', soloTech.HOLDS[1]));
	soloScene.career.ledger.purse = 25;
	assert.ok(soloGame.buildGear(soloScene.career, soloScene.career.at, 'catapult', soloTech.CATAPULTS[1]));
	assert.ok(soloGame.buildGear(soloScene.career, soloScene.career.at, 'battery', soloTech.BATTERIES[1]));
	soloScene.career.pads[soloScene.career.at].chargeKwh =
		soloScene.career.pads[soloScene.career.at].battery.capacity;
	for (const t of soloScene.career.tasks) t.kind = soloGame.TASK_NONE;
	Object.assign(soloScene.career.tasks[0], {
		kind: soloGame.TASK_DELIVERY, state: soloGame.TASK_OFFERED,
		from: pickup, to: dropoff, tons: 2, fragile: false,
		reward: 7.5, deadline: soloScene.game.clockSteps + 50000
	});
	soloEnv.click('helperPlanQuest');
	until(soloEnv, 'helperStopBtn.hidden');
	check(/^quest plan · offer #1/.test(soloEnv.elements.get('careerMsg').textContent),
		'solo bot=off plan quest must find route without unprimed exitProbe: ' +
		soloEnv.elements.get('careerMsg').textContent);

	/* 5b. Full recorded session for CareerActions replay: fresh page so every
	 * setup mutation goes through recorded careerAct calls. */
	let chosenSlot = -1;
	let runEnv = null;
	for (const mapId of [1, 2, 3, 7, 42, 93293, 520383]) {
		const candEnv = loadPage({ search: mapSearch(mapId) + '&cheat=communism' });
		get(candEnv, "careerAct({act:'part',kind:'hold',tier:2}); careerAct({act:'build',kind:'catapult',tier:2}); careerAct({act:'build',kind:'battery',tier:2}); careerAct({act:'careerTab',tab:'shots'});");
		const cs = candEnv.context.GravityScene;
		const cg = candEnv.context.GravityGame;
		for (let s = 0; s < 3; s++) {
			const t = cs.career.tasks[s];
			if (t.kind !== cg.TASK_DELIVERY || !cg.canAccept(cs.career, s) || t.from === cs.career.at) continue;
			if (cg.planetBuildable(cs.career, t.from) && cs.career.pads[t.from].catapult === null) {
				get(candEnv, `careerAct({act:'build',planet:${t.from},kind:'catapult',tier:2}); careerAct({act:'build',planet:${t.from},kind:'battery',tier:2});`);
			}
			const h1 = findImpact(cs.sim, cg, cs.career.at, t.from, 30, cs.sim.speedLimit(cs.career.at));
			const loadedMass = candEnv.context.OrbitTech.shipMass(cs.career.ship, t.tons);
			if (h1 && cg.hasFeasibleLeg(cs.career, cs.sim, t.from, t.to, loadedMass, t.fragile, 40000)) {
				chosenSlot = s;
				runEnv = candEnv;
				break;
			}
		}
		if (chosenSlot >= 0) break;
	}
	assert.ok(chosenSlot >= 0, 'expected a seeded map with a 2-leg starter delivery');

	const rScene = runEnv.context.GravityScene;
	const rGame = runEnv.context.GravityGame;
	const startOrigin = rScene.career.at;
	const contractTask = rScene.career.tasks[chosenSlot];
	const stop1 = contractTask.from;
	const goal2 = contractTask.to;

	assert.ok(get(runEnv, `careerAct({act:'accept',slot:${chosenSlot}})`), 'accept delivery');
	runEnv.click('helperPlanQuest');
	until(runEnv, 'helperStopBtn.hidden');

	const notice = runEnv.elements.get('careerMsg').textContent;
	check(/^quest plan · P\d+ \([^)]+\) \u2192 deliver P\d+ \([^)]+\) · net /.test(notice),
		'unexpected plan quest notice: ' + notice);

	const entries = rScene.career.launchBook.entries;
	const row1 = entries.find(e => e.origin === startOrigin && e.body === stop1);
	const row2 = entries.find(e => e.origin === stop1 && e.body === goal2);
	check(Boolean(row1 && row2), 'plan quest must write both leg-1 and leg-2 rows to launchBook');
	check(rScene.aimState().armed && rScene.aimState().body === startOrigin,
		'plan quest must arm leg 1 on the current pad');

	const listBeforeHtml = runEnv.elements.get('careerLaunchList').innerHTML;
	check(listBeforeHtml.includes('shot leaves from P' + stop1),
		'leg 2 must appear dimmed with "shot leaves from P#" before landing at stop1');

	/* Launch leg 1 and fly to `stop1`. */
	get(runEnv, 'playIndex = PLAY_SPEEDS.indexOf(4); launchShot()');
	until(runEnv, 'game.career.flights === 1 && cargoSim.status !== STATUS_FLYING');
	assert.strictEqual(rScene.career.at, stop1, 'leg 1 must land on stop1');
	assert.strictEqual(rScene.career.tasks[chosenSlot].state, rGame.TASK_LOADED,
		'landing on stop1 must load the cargo');

	/* Leg 2 in launchBook must be immediately fireable on `stop1` with zero re-scan! */
	const leg2Idx = rScene.career.launchBook.entries.indexOf(row2);
	assert.ok(leg2Idx >= 0, 'leg 2 row must remain in launchBook');
	const block2 = get(runEnv, `(() => {
		const e = game.career.launchBook.entries[${leg2Idx}];
		return launchBlock(game.career, e, GravityGame.speedOf(e.speedU));
	})()`);
	check(block2 === '', 'leg 2 must be immediately fireable upon landing at stop1, got: ' + block2);

	/* Arm leg 2 from launchBook (`book`) and fly to `goal2`! */
	get(runEnv, `careerAct({act:'book',entry:${leg2Idx}})`);
	check(rScene.aimState().armed && rScene.aimState().body === stop1,
		'clicking book row 2 must arm leg 2 on stop1');
	get(runEnv, 'launchShot()');
	until(runEnv, 'game.career.flights === 2 && cargoSim.status !== STATUS_FLYING');
	assert.strictEqual(rScene.career.at, goal2, 'leg 2 must land on goal2');
	assert.strictEqual(rScene.career.delivered, 1, 'two-leg delivery must complete');

	/* Verify sparse GRAVITY_ACTIONS recording & deterministic replay! */
	runEnv.click('gameCopy');
	const actionText = runEnv.clipboardText;
	check(actionText.startsWith('GRAVITY_ACTIONS:'), 'expected GRAVITY_ACTIONS recording');
	const decoded = runEnv.context.CareerActions.decode(actionText);
	const bookTraces = decoded.actions.filter(a => a.type === 'bookTrace');
	check(bookTraces.length >= 2 && bookTraces.every(b => b.trace.length === 13),
		'expected two 13-tuple bookTrace actions in GRAVITY_ACTIONS');

	const replayEnv = loadPage({ search: '?mode=lab&seed=7' });
	replayEnv.elements.get('replayInput').value = actionText;
	replayEnv.click('replayLoad');
	assert.strictEqual(replayEnv.elements.get('replayLoadNote').textContent, 'replay opened');
	until(replayEnv, '!careerActionReplay.active', 35, 2500);
	assert.strictEqual(get(replayEnv, 'careerActionReplay.skipped'), 0,
		replayEnv.elements.get('careerMsg').textContent);
	assert.match(replayEnv.elements.get('careerMsg').textContent, /history matches/);
	assert.strictEqual(get(replayEnv, 'game.career.delivered'), 1);
	assert.strictEqual(
		get(replayEnv, 'JSON.stringify(careerRecordingSnapshot().state.careers)'),
		get(runEnv, 'JSON.stringify(careerRecordingSnapshot().state.careers)'),
		'replayed two-leg career state must match live state byte-for-byte'
	);
	console.log('5. plan quest + 2-leg launchBook execution + CareerActions replay OK');
}

/* --- 6. Zero hot-path allocation check (`--expose-gc`) ------------------ */
{
	const env = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: Game, OrbitTech: Tech } = env.context;
	const career = scene.career;
	const sim = scene.sim;
	const market = scene.game.market;
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	career.ledger.purse = 25;
	let p1 = -1;
	let p2 = -1;
	let shot = null;
	for (let p = 0; p < sim.planetCount && p1 < 0; p++) {
		if (!sim.planetActive(p) || p === career.at || p === career.capitalPlanet) continue;
		const h1 = findImpact(sim, Game, career.at, p, 52, 85);
		if (!h1) continue;
		for (let q = 0; q < sim.planetCount; q++) {
			if (!sim.planetActive(q) || q === p || q === career.at) continue;
			if (findImpact(sim, Game, p, q, 52, 82)) { p1 = p; p2 = q; shot = h1; break; }
		}
	}
	Object.assign(career.tasks[0], {
		kind: Game.TASK_DELIVERY, state: Game.TASK_ACCEPTED,
		from: p1, to: p2, tons: 2, fragile: false, reward: 5.0, deadline: 60000
	});
	career.contract = 0;

	const out = Game.createLegPlan();
	const inp = {
		origin: career.at, body: p1, speed: shot.speed, flownLen: 0,
		length: shot.length, steps: shot.steps, visitPay: 0.5, bribe: 0,
		condition: 1, burnDv: 0, fee: 0,
		logPlanet: shot.logPlanet, logStep: shot.logStep,
		logDwell: shot.logDwell, logCount: shot.logCount
	};
	/* Warm past V8 Maglev/TurboFan tier-up (~2500 calls) so native Code objects
	 * do not land inside the measured allocation window under CPU load. */
	for (let i = 0; i < 3000; i++) Game.careerLegPlan(out, career, market, sim, inp, 100 + (i & 7));
	global.gc();
	global.gc();
	const before = process.memoryUsage().heapUsed;
	for (let i = 0; i < 2000; i++) Game.careerLegPlan(out, career, market, sim, inp, 100 + (i & 7));
	global.gc();
	global.gc();
	const deltaKb = (process.memoryUsage().heapUsed - before) / 1024;
	check(deltaKb < 64, 'careerLegPlan retained heap grew by ' + deltaKb.toFixed(1) + ' kB');
	console.log('6. heap flat over 2000 careerLegPlan calls: ' + deltaKb.toFixed(1) + ' kB');
}

console.log('TWO-LEG QUESTS OK · ' + checks + ' checks');
