/* H's page contract: 1-to-1 verified CTAs, live variable refresh, back history and visit reset. */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const env = loadPage({ search: mapSearch(42) });
env.runFrames(2, 16);
const ctx = env.context;
const ui = env.elements;
const Game = ctx.GravityGame;
const Tech = ctx.OrbitTech;
const Sim = ctx.GravitySim;
const get = expr => vm.runInContext(expr, ctx);
const run = expr => vm.runInContext(expr, ctx);

function clickChip(topicId) {
	env.fireElement(ui.get('commsChips'), 'click',
		{ target: { dataset: { commsTopic: topicId } } });
}

function clickCta(actId, disabled = false) {
	env.fireElement(ui.get('commsCtas'), 'click',
		{ target: { disabled, dataset: { commsAct: actId } } });
}

function unownedNormalPlanet(career) {
	for (let p = 0; p < ctx.OrbitWorld.PLANETS; p++) {
		if (career.planetMask && career.planetMask[p] !== 1) continue;
		if (p === career.hq || p === career.capitalPlanet || p === career.arfPlanet) continue;
		if (!Game.planetBuildable(career, p)) continue;
		if (career.pads[p].catapult === null) return p;
	}
	throw new Error('no unowned buildable planet');
}

/* 1. Every H_ACTIONS key has a verified page handler, with zero orphans either way. */
const declaredActs = get('Object.keys(H_ACTIONS).sort()');
const wiredActs = get('Object.keys(COMMS_HANDLERS).sort()');
assert.deepStrictEqual(Array.from(wiredActs), Array.from(declaredActs));
for (const id of wiredActs) {
	assert.strictEqual(get('typeof COMMS_HANDLERS[' + JSON.stringify(id) + ']'), 'function');
}

/* 2. Open on seed 42: purse matches career.ledger.purse; chips + back navigate cleanly. */
const career = ctx.GravityScene.career;
const sim = ctx.GravityScene.sim;
const hq = career.hq;
env.click('commsButton');
assert.strictEqual(ui.get('commsCard').hidden, false);
assert.ok(ui.get('commsAnswer').textContent.includes(career.ledger.purse.toFixed(2)),
	ui.get('commsAnswer').textContent);
assert.strictEqual(ui.get('commsBack').hidden, true);

clickChip('pad');
assert.ok(ui.get('commsAnswer').textContent.includes('P' + hq));
assert.strictEqual(ui.get('commsBack').hidden, false);
clickChip('fuel');
assert.ok(ui.get('commsAnswer').textContent.includes(Game.fuelPrice(career).toFixed(2) + '/kg'));
assert.strictEqual(get('commsState.exchanges.length'), 3);
env.click('commsBack');
assert.strictEqual(get('commsState.exchanges.length'), 2);
assert.strictEqual(get('commsState.exchanges[commsState.exchanges.length - 1].id'), 'pad');

/* 3. Repair CTA produces the exact same careerMsg as the real shop button, and dims when short. */
Game.setShipCondition(career, 0.5);
const savedPurse = career.ledger.purse;
env.fireElement(ui.get('careerBox'), 'click', { target: { dataset: { act: 'repair' } } });
const realRepairMsg = ui.get('careerMsg').textContent;
assert.strictEqual(career.ship.condition, 1);

career.ledger.purse = 0.25;
Game.setShipCondition(career, 0.5);
ctx.refreshCareerPanel();
clickChip('repair');
const shortHtml = ui.get('commsCtas').innerHTML;
assert.match(shortHtml, /data-comms-act="repair"[^>]*disabled/, shortHtml);
assert.match(shortHtml, /class="miniBtn costly"/, shortHtml);
assert.match(shortHtml, /<span class="commsWhy">short 0\.75 \(purse 0\.25\)<\/span>/, shortHtml);
/* Even a direct action call refuses a disabled CTA. */
assert.strictEqual(get("commsRunAction('repair')"), false);
assert.strictEqual(career.ship.condition, 0.5);

career.ledger.purse = savedPurse;
run('commsInvalidate(); commsTick()');
assert.doesNotMatch(ui.get('commsCtas').innerHTML, /disabled/);
clickCta('repair');
assert.strictEqual(ui.get('careerMsg').textContent, realRepairMsg);
assert.strictEqual(career.ship.condition, 1);
assert.ok(ui.get('commsAnswer').textContent.includes('100%'));

/* 4. Live experiment slider update propagates automatically into open H answer. */
clickChip('repair');
const wearBefore = ui.get('commsAnswer').textContent;
env.setValue('expWear', '2');
run('commsTick()');
const wearAfter = ui.get('commsAnswer').textContent;
assert.notStrictEqual(wearAfter, wearBefore);
const liveRate = Number((Game.spaceWear(career, Sim.stepsForGameSeconds(1)) * 100).toFixed(2));
assert.ok(wearAfter.includes(liveRate + '%/s'), wearAfter);
env.setValue('expWear', '1');

/* 5. Fuel CTAs: convert from own pad charge and buy from purse. */
career.ship.engine = Tech.ENGINES[0];
career.ship.tank = Tech.TANKS[1];
career.ship.fuelKg = 0;
career.ship.mass = Tech.shipMass(career.ship, 0);
career.pads[hq].chargeKwh = career.pads[hq].battery.capacity;
career.ledger.purse = 10;
ctx.refreshCareerPanel();
clickChip('fuel');
clickCta('produce-fuel');
assert.strictEqual(career.ship.fuelKg, Game.FUEL_BUY_STEP);
assert.match(ui.get('careerMsg').textContent, /^converted /);
const purseBeforeFuel = career.ledger.purse;
clickCta('buy-fuel');
assert.strictEqual(career.ship.fuelKg, Game.FUEL_BUY_STEP * 2);
assert.ok(Math.abs((purseBeforeFuel - career.ledger.purse) -
	Game.FUEL_BUY_STEP * Game.fuelPrice(career)) < 1e-9);
assert.match(ui.get('careerMsg').textContent, /^bought /);

/* 6. Slower-shot and commercial CTAs on leave. */
career.pads[hq].chargeKwh = 0.4;
const partialCap = ctx.activeCareerSim().speedLimit(hq);
assert.ok(partialCap >= Sim.SPEED_MIN && partialCap < 120);
run('armed = true; aimBody = ' + hq + '; aimSpeed = 120; commsInvalidate(); commsTick()');
clickChip('leave');
clickCta('slower-shot');
assert.ok(get('aimSpeed') <= partialCap + 1e-9);
assert.strictEqual(Game.launchReason(career, ctx.activeCareerSim(), hq, get('aimSpeed'), false), null);

run('armed = false');
career.pads[hq].chargeKwh = 0;
run('commsInvalidate(); commsTick()');
clickChip('leave');
clickCta('commercial');
assert.strictEqual(career.commercialPlanet, hq);
assert.match(ui.get('careerMsg').textContent, /^commercial /);
Game.setCommercial(career, -1);
career.pads[hq].chargeKwh = career.pads[hq].battery.capacity;

/* 7. Planet change clears transcript; build-pad builds on career.at even if shop browsed HQ. */
const other = unownedNormalPlanet(career);
Game.placeShip(career, sim, other);
career.stranded = true;
run('careerFollow = false');
ui.get('careerPlanet').value = String(hq);
ctx.refreshCareerPanel();
run('commsTick()');
assert.strictEqual(get('commsState.exchanges.length'), 1, 'visit change resets prior transcript');
assert.match(ui.get('commsStamp').textContent, new RegExp('P' + other + '$'));

career.ledger.purse = 10;
clickChip('pad');
assert.strictEqual(ui.get('commsCtas').innerHTML.includes('data-comms-act="bribe"'), false,
	'pad never offers bribe as a fix CTA');
clickCta('build-pad');
assert.ok(career.pads[other].catapult !== null, 'built pad on ship planet, not browsed shop planet');
assert.match(ui.get('careerMsg').textContent, new RegExp('on P' + other));

/* 8. Bribe CTA exists only on bribe topic and honors once-per-visit rule. */
const market = ctx.GravityScene.game.market;
const clock = ctx.GravityScene.game.clockSteps;
Game.harvestPlanet(career.ledger, market, other, clock);
market.visitPay[other] = 1.0;
market.corruption[other] = 10; /* below REBEL_START so arrest chance is 0 */
run('commsInvalidate(); commsTick()');
clickChip('bribe');
const purseBeforeBribe = career.ledger.purse;
clickCta('bribe');
assert.ok(career.ledger.purse > purseBeforeBribe);
assert.match(ui.get('careerMsg').textContent, /^bribed the rulers of P/);
assert.match(ui.get('commsCtas').innerHTML, /data-comms-act="bribe"[^>]*disabled/);
assert.ok(ui.get('commsCtas').innerHTML.includes('already bribed this visit'));

/* 9. A short purse still evacuates: the quoted fare is affordable cash and the duration grows. */
const third = unownedNormalPlanet(career);
Game.placeShip(career, sim, third);
career.stranded = true;
career.ledger.purse = Game.CAREER.evacFee - 1;
const expectedEvacSeconds = Game.evacuationSeconds(career);
const expectedPaid = career.ledger.purse;
run('commsTick()');
clickChip('pad');
assert.match(ui.get('commsCtas').innerHTML, /data-comms-act="evac"[^>]*>/);
assert.strictEqual(get("commsRunAction('evac')"), true);
assert.ok(career.evacuating, 'the career enters the evacuating state');
assert.strictEqual(career.evacLastPaid, expectedPaid);
assert.ok(career.evacLastSteps > Game.CAREER.evacFullSeconds / Sim.DT,
	'partial fare stretches the trip beyond the minimum');
/* advance the world clock to the end of the trip */
run('game.clockSteps = game.career.evacUntilStep; advanceCareerOneStep(); commsTick()');
assert.strictEqual(career.at, hq);
assert.strictEqual(career.evacuations, 1);
assert.match(ui.get('careerMsg').textContent,
	new RegExp('evacuated to HQ P' + hq + ' · paid ' + expectedPaid.toFixed(2)));

console.log('COMMS PAGE OK');
