/* Claim the landing, not a commercial ticket. Use the actual pinned field,
 * ownership, gear and purse of map 10. Run: node experiments/bot_gravity_test.js */
'use strict';
const assert = require('assert');
const { loadPage, mapSearch } = require('./dom_stub.js');

function opening() {
	const { context } = loadPage({ search: mapSearch(93293) + '&rate=0.5' });
	return { ...context.GravityScene, Game: context.GravityGame, Tech: context.OrbitTech };
}

/* Same ship, cash and path income: a claim, a rival rail and the Capital
 * must not all sell the fan a new pad. A ticket alone buys no property. */
{
	const { bot, sim, career, Game, Tech } = opening();
	const host = career.galaxy.actors[1];
	const starter = Tech.CATAPULTS[0];
	const score = p => bot.careerScoreFacts(career, career.hq, career.market,
		0, 0, 0, p, 0, 100, 120, 50, 0, 1, 0);
	assert.strictEqual(bot.careerGravityCost(5), 0);
	assert.ok(bot.careerGravityCost(4) > bot.careerGravityCost(5));
	assert.strictEqual(bot.careerNextPad(career, starter.buildCost - 0.01, sim), -1);
	const pick = bot.careerNextPad(career, starter.buildCost, sim);
	assert.ok(pick >= 0 && sim.strength[pick] <= 1 && Game.planetBuildable(career, pick));
	host.plannedLanding = pick;
	assert.notStrictEqual(bot.careerNextPad(career, starter.buildCost, sim), pick, 'remote shop respects a queued or flying rival');
	host.plannedLanding = -1;
	career.ledger.purse = starter.buildCost;
	const claim = score(5);
	assert.ok(Number.isFinite(claim) && bot.careerEval.builds);
	assert.strictEqual(bot.careerEval.exitCost, starter.buildCost);
	host.plannedLanding = 5;
	assert.ok(score(5) < claim && !bot.careerEval.builds, 'another committed ship is headed there');
	host.plannedLanding = -1;
	assert.ok(Game.buildGear(host, 5, 'catapult', starter));
	assert.ok(score(5) < claim && !bot.careerEval.builds, 'cannot claim the host rail');
	assert.strictEqual(score(career.capitalPlanet), 0, 'no property bonus on the imperial rail');
	career.ledger.purse = starter.buildCost - 0.01;
	assert.ok(Number.isFinite(score(6)) && !bot.careerEval.builds);
	assert.strictEqual(bot.careerEval.padValue, -bot.careerEval.exitCost, 'commercial ticket only');
	career.ledger.purse = 2;
	assert.strictEqual(bot.careerScoreFacts(career, career.at, career.market, 0, 0, 0,
		career.capitalPlanet, 1, 100, 120, 50, 0, 1, Game.CAPITAL_VISIT_PAY), -Infinity,
	'cannot cover the Capital fine if someone else collects the projected flybys');
}

/* A lightly worn ship with barely enough for the landing's EMC keeps the
 * claim. At zero condition the mandatory repair has priority instead. */
for (const condition of [0.6, 0]) {
	const { bot, sim, career, Game, Tech } = opening();
	const starter = Tech.CATAPULTS[0];
	career.at = 5;
	sim.relocate(5);
	Game.setShipCondition(career, condition);
	career.ledger.purse = starter.buildCost + 0.01;
	bot.careerBetweenFlights(career, sim, 100);
	assert.strictEqual(career.pads[5].catapult, condition ? starter : null);
	assert.strictEqual(career.repairs, condition ? 0 : 1);
}

/* P9 needs EMC-2 + BAT-2. Leave it as the only available site: don't buy
 * just the rail, ignore inactive planets, and don't invent charge for BAT-2. */
{
	const { bot, sim, career, Game, Tech } = opening();
	const host = career.galaxy.actors[1];
	host.ledger.purse = 100;
	for (let p = 0; p < sim.planetCount; p++) {
		if (p !== 9 && Game.padOwner(host, p) === Game.OWNER_COMMERCIAL) {
			assert.ok(Game.buildGear(host, p, 'catapult', Tech.CATAPULTS[0]));
		}
	}
	const cost = Tech.CATAPULTS[1].buildCost + Tech.BATTERIES[1].buildCost;
	assert.strictEqual(bot.careerNextPad(career, cost - 0.01, sim), -1);
	assert.strictEqual(bot.careerNextPad(career, cost, sim), 9);
	career.flights = 1;
	career.ledger.purse = cost + Game.commercialMinFee();
	bot.careerBetweenFlights(career, sim, 100);
	assert.strictEqual(career.pads[9].catapult, Tech.CATAPULTS[1]);
	assert.strictEqual(career.pads[9].battery, Tech.BATTERIES[1]);
	assert.strictEqual(career.pads[9].chargeKwh, Tech.BATTERIES[0].capacity);
	assert.ok(Math.abs(career.ledger.purse - Game.commercialMinFee()) < 1e-9);
}

/* An owner can plan for a recharge. A guest cannot spend reserved kWh or
 * assume a full rail; once landed, a short solar wait beats paying to leave. */
{
	const { bot, sim, career, Game, Tech } = opening();
	const host = career.galaxy.actors[1];
	assert.ok(Game.buildGear(host, 5, 'catapult', Tech.CATAPULTS[0]));
	const pad = host.pads[5];
	career.at = 5;
	sim.relocate(5);
	pad.reservedKwh = pad.chargeKwh;
	assert.ok(!bot.careerDeparture(career, 5, 100, career.ship.mass, sim).ok);
	assert.strictEqual(bot.careerDeparture(host, 5, 100, host.ship.mass, sim).source, 'own');
	pad.reservedKwh = 0;
	pad.chargeKwh = 0.05;
	host.ledger.purse = 10;
	assert.ok(Game.buildGear(host, 5, 'panel', Tech.PANELS[1]));
	const actor = { career, sim, index: 0, idleTries: 0, waitTries: 0, gapPhase: 0 };
	assert.strictEqual(bot.careerNextShot(actor, career.market, bot.tradeSim, 100), null);
	assert.strictEqual(actor.waitTries, 1);
	assert.ok(actor.readyStep > 100 && !career.evacuating && career.commercialPlanet === -1);
	Game.careerAdvance(host, actor.readyStep - 100);
	assert.ok(pad.chargeKwh > 0.05, 'only elapsed sunlight bought energy');
}
/* An unprofitable Capital delivery isn't a reason to buy a hold. A local
 * pickup that covers the refit and can actually leave under load is. */
{
	const { bot, sim, career, Game, Tech } = opening();
	for (const task of career.tasks) task.kind = Game.TASK_NONE;
	const task = career.tasks[0];
	Object.assign(task, { kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: career.at, to: career.capitalPlanet, tons: 2, reward: 1.5 });
	assert.ok(!bot.careerWantHold(career, sim));
	task.to = 6;
	assert.ok(bot.careerWantHold(career, sim));
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	career.acceptAfterStep = 200;
	assert.ok(!bot.careerAccept(career, 199, sim));
	assert.ok(!bot.careerAccept(career, 199, sim), 'another shop is not another time step');
	assert.ok(bot.careerAccept(career, 200, sim));
}
/* A pay-positive visit isn't necessarily a profitable return. Commercial
 * selection prices this shot only; on landing the natural rail is back. */
{
	const { bot, career, Game } = opening();
	const p = career.at;
	const score = (pay, fee) => bot.careerScoreFacts(career, p, career.market,
		0, 0, fee, p, pay, 1000, 120, 50, 0.4, 0.8, 0);
	assert.strictEqual(score(0.3, 0), -Infinity, 'even a reported bounce can lose money');
	assert.ok(Math.abs(score(1, 0) - 0.6) < 1e-9, 'a real harvest loop has no fictitious pad penalty');
	Game.setCommercial(career, p);
	const fee = Game.launchFee(career, p, 50);
	assert.strictEqual(score(fee + 0.3, fee), -Infinity, 'a return must cover its commercial fee');
	assert.ok(Math.abs(score(fee + 1, fee) - fee - 0.6) < 1e-9);
	assert.strictEqual(bot.careerEval.exitSource, 'own', 'a return must see the real rail after landing');
	assert.ok(!bot.careerEval.builds);
	assert.strictEqual(Game.padOwner(career, p), Game.OWNER_COMMERCIAL, 'the forecast must not switch the live rail');
}

/* A booked contract pickup can score well on credit without earning cash.
 * It must not rule out trying fresh shots. A rich, currently payable entry
 * still skips tracing. An expired leg does not count as a directed hit. */
{
	const { bot, sim, career, Game, Tech } = opening();
	const target = 6;
	career.ledger.purse = 20;
	assert.ok(Game.buildGear(career, target, 'catapult', Tech.CATAPULTS[0]));
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	for (const task of career.tasks) task.kind = Game.TASK_NONE;
	const task = career.tasks[0];
	Object.assign(task, { kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED, from: target,
		to: 8, tons: 2, reward: 30, deadline: 50000 });
	assert.ok(Game.acceptTask(career, 0));
	const market = career.market;
	const k = market.k;
	market.k = 0;
	const plan = bot.careerPlan(career, sim, market, 10, true);
	assert.ok(plan && plan.body === target && plan.score >= 6, 'fixture needs a high-credit pickup');
	assert.ok(bot.careerPlan(career, sim, market, 11, true));
	assert.ok(bot.careerScan.book > 0 && bot.careerScan.tried > 0, 'pickup credit is not harvest cash');
	market.k = k;
	market.lastVisitStep.fill(-100000);
	assert.ok(bot.careerPlan(career, sim, market, 12, true).fromBook);
	assert.strictEqual(bot.careerScan.tried, 0, 'a strong cash-paying book shot still saves the fan');
	task.deadline = 14;
	assert.strictEqual(bot.careerPlan(career, sim, market, 13, true), null, 'cannot pick up after the deadline');
}

/* Keep the five coarse speed rungs. Normal and hard spend only a small
 * extra fan around promising aims; easy still uses the cheap coarse fan. */
for (const [level, extra] of [['easy', 0], ['normal', 14], ['hard', 21]]) {
	const { bot, sim, career, Game } = opening();
	bot.setPlayerType(Game.PLAYER_BOT);
	bot.setLevel(level);
	career.flights = 1;
	const predict = bot.probe.predictFast;
	let extended = 0;
	let top = 0;
	const limit = sim.speedLimit(career.at);
	bot.probe.predictFast = function (origin, angle, speed, horizon) {
		assert.ok(speed <= limit + 1e-9, 'a refinement exceeded live battery charge');
		assert.ok(horizon <= (level === 'hard' ? 120 : 90));
		if (horizon > 45) extended++;
		top = Math.max(top, speed);
		return predict.call(this, origin, angle, speed, horizon);
	};
	assert.ok(bot.careerPlan(career, sim, career.market, 100, false, bot.spec().careerAngles));
	assert.ok(limit - top < 0.01, 'the primary fan dropped its full-speed rung');
	if (extra) assert.ok(extended > 0 && extended <= extra, 'bounded refinement count: ' + extended);
	else assert.strictEqual(extended, 0);
}

/* Book, fresh fan and shared commercial barrels: never duplicate the aim
 * another company has committed, even if the destination penalty is small. */
{
	const { bot, sim, career, Game } = opening();
	const market = career.market;
	const rival = bot.rivals[0];
	const plan = { ...bot.careerPlan(career, sim, market, 10, true) };
	assert.ok(plan.origin >= 0 && plan.body >= 0);
	rival.career.at = plan.origin;
	rival.career.plannedLanding = plan.body;
	rival.turret = plan;
	const different = bot.careerPlan(career, sim, market, 11, true);
	assert.ok(!different || different.angleU !== plan.angleU || different.speedU !== plan.speedU);
	assert.ok(bot.careerScan.busy > 0, 'no rival aim was skipped');
	assert.ok(!bot.careerShotBusy(career, plan.origin, plan.angleU + 1, plan.speedU), 'nearby aims remain available');
	rival.turret = null;
	rival.sim.relocate(plan.origin);
	Game.setCommercial(rival.career, plan.origin);
	rival.sim.launch(plan.origin, plan.angle, plan.speed);
	Game.careerBeginFlight(rival.career, rival.sim);
	assert.ok(bot.careerShotBusy(career, plan.origin, plan.angleU, plan.speedU), 'a coasting rival still harvests that route');
	rival.career.flying = false;
	rival.career.plannedLanding = -1;
	assert.ok(!bot.careerShotBusy(career, plan.origin, plan.angleU, plan.speedU), 'a landed rival no longer blocks the trajectory');
	bot.setPlayerType(Game.PLAYER_BOT);
	Object.assign(bot.careerPlayer.plan, plan);
	career.plannedLanding = plan.body;
	assert.ok(bot.careerShotBusy(rival.career, plan.origin, plan.angleU, plan.speedU), 'YOU shares the same deconfliction');
}

/* A loaded fragile contract searches the safe speed band, including at
 * full battery, rather than selecting an impact that would void the order. */
{
	const { bot, sim, career, Game, Tech } = opening();
	career.ledger.purse = 20;
	assert.ok(Game.buildGear(career, career.at, 'catapult', Tech.CATAPULTS[1]));
	assert.ok(Game.buildGear(career, career.at, 'battery', Tech.BATTERIES[1]));
	career.pads[career.at].chargeKwh = Tech.BATTERIES[1].capacity;
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	Object.assign(career.tasks[0], { kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: career.at, to: 6, reward: 2, tons: 2, fragile: true, deadline: 50000 });
	assert.ok(Game.acceptTask(career, 0));
	assert.ok(sim.speedLimit(career.at) > Game.FRAGILE_SPEED, 'fixture needs a rail strong enough to break the load');
	const predict = bot.probe.predictFast;
	let shots = 0;
	bot.probe.predictFast = function (origin, angle, speed, horizon) {
		assert.ok(speed <= Game.FRAGILE_SPEED + 1e-9);
		shots++;
		return predict.call(this, origin, angle, speed, horizon);
	};
	bot.careerPlan(career, sim, career.market, 100, true);
	assert.ok(shots > 0);
}

/* Ordinary patience can run out; an affordable recharge still beats a
 * cash-losing commercial ticket that neither claims a pad nor advances work. */
{
	const { bot, sim, career } = opening();
	career.pads[career.at].chargeKwh = 0.48;
	const r = { career, sim, index: 0, idleTries: 0, waitTries: 4 };
	const fare = { builds: false, cashNet: -2, fee: 4.54 };
	bot.careerPlan = c => c.commercialPlanet < 0 ? null : fare;
	assert.strictEqual(bot.careerNextShot(r, career.market, bot.tradeSim, 100), null);
	assert.strictEqual(career.commercialPlanet, -1, 'one-shot commercial override must clear on a wait');
	assert.ok(r.readyStep > 100 && !career.evacuating);
	assert.ok(bot.trace.some(line => line.includes('instead of losing a 4.54 commercial ticket')));
}

/* A return loop is not a reposition toward the unreachable destination. Drop
 * the load and reprice at dry mass before choosing a shot, then pause the board. */
{
	const { bot, sim, career, Game, Tech } = opening();
	assert.ok(Game.installPart(career, 'hold', Tech.HOLDS[1]));
	const task = career.tasks[0];
	Object.assign(task, { kind: Game.TASK_DELIVERY, state: Game.TASK_OFFERED,
		from: career.at, to: 6, reward: 2, tons: 2, deadline: 10000 });
	assert.ok(Game.acceptTask(career, 0));
	const loaded = career.ship.mass;
	const loop = { origin: career.at, body: career.at, score: 1 };
	bot.careerPlan = (c, src, market, step, fallback, angles, relaxed) => {
		if (c.contract >= 0) return relaxed ? loop : null;
		assert.ok(c.ship.mass < loaded, 'the replacement shot must be priced dry');
		return loop;
	};
	const actor = { career, sim, index: 0, idleTries: 0, waitTries: 0 };
	assert.strictEqual(bot.careerNextShot(actor, career.market, bot.tradeSim, 100), loop);
	assert.strictEqual(career.contract, -1);
	assert.ok(career.acceptAfterStep > 100 && !bot.careerAccept(career, 100, sim));
}
console.log('BOT GRAVITY OK · claims, exit kits, recharge, paid returns, book gate, refinements, shared shots and work legs');
