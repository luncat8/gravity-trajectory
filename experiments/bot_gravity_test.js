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
console.log('BOT GRAVITY OK · claim economics, repair, whole kits, guest recharge and contracts');
