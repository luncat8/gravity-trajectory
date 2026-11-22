/* H's topic validator, copy lint, chip ranking, ref subtrees and one-step look-ahead. */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Tech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Comms = require(path.join(root, 'comms_copy.js'));

/* 1. Copy & schema validator passes with zero errors. */
assert.deepStrictEqual(Comms.validateCopy(), []);

const PLANETS = World.PLANETS;
const UNIVERSE = 13;
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const strength = new Float64Array(PLANETS);
	for (let p = 0; p < UNIVERSE; p++) strength[p] = Game.planetGravity(seed, p);
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
	const market = Game.createMarket();
	Game.resetMarket(market);
	Game.applyMarketUniverse(market, mask, UNIVERSE);
	Game.applyMarketSpecials(market, trade.world);
	const galaxy = Game.createGalaxy();
	Game.resetGalaxy(galaxy, seed);
	Game.bindRun(market, galaxy, trade.world);
	const career = Game.createCareer(Game.createLedger());
	Game.setCareerUniverse(career, mask, UNIVERSE);
	/* pinned home: these chip fixtures depend on the HQ's planet (the A.R.F.
	 * refuses bribes), not on whichever planet the seat law picks today */
	Game.startCareer(career, sim, seed, trade, market, galaxy, 7);
	sim.attachCareer(career);
	return { trade, sim, market, galaxy, career, clockSteps: Math.round(420 / GravitySim.DT) };
}

function snap(w, extra = {}) {
	w.sim.attachCareer(w.career);
	return Comms.buildSnapshot(Object.assign({
		rule: Game.RULE_CAREER,
		gameOn: true,
		clockSteps: w.clockSteps,
		career: w.career,
		market: w.market,
		galaxy: w.galaxy,
		sim: w.sim,
		planetCount: UNIVERSE,
		armed: false,
		aimBody: -1,
		aimSpeed: GravitySim.SPEED_MIN,
		waitLocked: false
	}, extra));
}

function normalUnowned(w) {
	const c = w.career;
	for (let p = 0; p < UNIVERSE; p++) {
		if (p === c.hq || p === c.capitalPlanet || p === c.arfPlanet) continue;
		if (c.pads[p].catapult === null) return p;
	}
	throw new Error('no unowned planet');
}

function assertCleanOutput(rendered, label) {
	assert.ok(rendered.text.length > 0, label + ': empty text');
	for (const bad of ['undefined', 'NaN', '{', '}']) {
		assert.strictEqual(rendered.text.includes(bad), false,
			label + ': bad token ' + bad + ' in ' + rendered.text);
	}
	for (const act of rendered.actions) {
		for (const bad of ['undefined', 'NaN', '{', '}']) {
			assert.strictEqual(act.label.includes(bad), false, label + ' label: ' + act.label);
			assert.strictEqual(act.why.includes(bad), false, label + ' why: ' + act.why);
		}
		if (!act.enabled) {
			assert.ok(act.why.length > 0, label + ': disabled CTA ' + act.id + ' must print why');
		}
	}
}

/* 2. Every slot resolves cleanly on career and non-career snapshots. */
const w = makeWorld(7);
const liveSnap = snap(w);
const labSnap = Comms.buildSnapshot({ rule: 'lab', gameOn: false, clockSteps: 0 });
for (const slot of Object.keys(Comms.H_SLOTS)) {
	for (const fixture of [liveSnap, labSnap]) {
		const value = Comms.H_SLOTS[slot](fixture);
		assert.strictEqual(typeof value, 'string', slot);
		assert.strictEqual(value.includes('undefined'), false, slot + ': ' + value);
		assert.strictEqual(value.includes('NaN'), false, slot + ': ' + value);
	}
}
for (const rule of ['lab', Game.RULE_TOUR, Game.RULE_ROUTE, Game.RULE_MONEY]) {
	const s = Comms.buildSnapshot({ rule, gameOn: true, clockSteps: 100 });
	for (const id of [Comms.H_META_ID, ...Object.keys(Comms.H_TOPICS)]) {
		assertCleanOutput(Comms.renderTopic(id, s), rule + '/' + id);
	}
}

/* 3. Exact chip lists across four canonical fixtures: stuck, worn, healthy, arrested. */
const other = normalUnowned(w);

/* A normal off-network stop is not itself a problem or a reason to build. */
Game.placeShip(w.career, w.sim, other);
w.career.stranded = false;
Game.setShipCondition(w.career, 1);
w.career.ledger.purse = 100;
const solventVisitor = snap(w);
assert.notStrictEqual(Comms.topTopicId(solventVisitor), 'pad', 'no own pad is not an emergency');

/* Fixture A: stuck (unowned planet, short on fee and build, full hull). */
Game.placeShip(w.career, w.sim, other);
w.career.stranded = true;
Game.setShipCondition(w.career, 1);
w.career.ledger.purse = 0.5;
const stuck = snap(w);
assert.deepStrictEqual(Comms.chipList(stuck).map(c => c.ask), [
	'what should I do?',
	'why is launch blocked?',
	'pad and rail',
	'no money',
	'fuel and tank',
	'bribe and its rot'
]);
assert.strictEqual(Comms.topTopicId(stuck), 'leave');

/* Combined stuck + worn caps at CHIP_CAP (6) and keeps bribe behind blocking/core topics. */
Game.setShipCondition(w.career, 0);
const stuckWorn = snap(w);
const stuckWornChips = Comms.chipList(stuckWorn).map(c => c.ask);
assert.strictEqual(stuckWornChips.length, Comms.CHIP_CAP);
assert.deepStrictEqual(stuckWornChips, [
	'what should I do?',
	'why is launch blocked?',
	'ship condition and repair',
	'pad and rail',
	'no money',
	'fuel and tank'
]);
assert.strictEqual(new Set(stuckWornChips).size, stuckWornChips.length, 'no duplicate chips');

/* Fixture B: worn (own ready pad, 60% hull, solvent, no launch gate closed). */
Game.placeShip(w.career, w.sim, w.career.hq);
w.career.stranded = false;
Game.setShipCondition(w.career, 0.6);
w.career.ledger.purse = 6;
const worn = snap(w);
assert.deepStrictEqual(Comms.chipList(worn).map(c => c.ask), [
	'what should I do?',
	'ship condition and repair',
	'pad and rail',
	'no money',
	'fuel and tank',
	'bribe and its rot'
]);
assert.strictEqual(Comms.topTopicId(worn), 'repair');

/* Fixture C: healthy (own maxed & full pad, 100% hull, solvent). */
Game.setShipCondition(w.career, 1);
const topCat = Tech.CATAPULTS[Tech.CATAPULTS.length - 1];
const hqPad = w.career.pads[w.career.hq];
const oldCat = hqPad.catapult;
hqPad.catapult = topCat;
hqPad.chargeKwh = hqPad.battery.capacity;
const healthy = snap(w);
assert.deepStrictEqual(Comms.chipList(healthy).map(c => c.ask), [
	'what should I do?',
	'no money',
	'fuel and tank',
	'bribe and its rot'
]);
assert.strictEqual(Comms.topTopicId(healthy), 'money');
hqPad.catapult = oldCat;

/* Fixture D: arrested (on Capital under transport countdown). */
Game.arrestCareer(w.career, w.market, w.sim, w.clockSteps);
const arrested = snap(w);
assert.deepStrictEqual(Comms.chipList(arrested).map(c => c.ask), [
	'what should I do?',
	'why is launch blocked?'
]);
assert.strictEqual(Comms.topTopicId(arrested), 'leave');
const arrestedOut = Comms.renderTopic(Comms.H_META_ID, arrested);
assertCleanOutput(arrestedOut, 'arrested');
assert.ok(arrestedOut.text.startsWith('under arrest · Capital transport'), arrestedOut.text);
assert.strictEqual(arrestedOut.actions.length, 0);
w.career.arrested = false;

/* 4. Shared `money` subtree attaches once under shortfalls and stays hidden when solvent. */
Game.placeShip(w.career, w.sim, other);
w.career.stranded = true;
Game.setShipCondition(w.career, 0.2);
w.career.ledger.purse = 0.5;
const shortSnap = snap(w);
for (const id of [Comms.H_META_ID, 'leave', 'repair', 'pad']) {
	const out = Comms.renderTopic(id, shortSnap);
	assertCleanOutput(out, 'short/' + id);
	const count = out.text.split('Money can be earned').length - 1;
	assert.strictEqual(count, 1, id + ' must attach money subtree exactly once:\n' + out.text);
}

w.career.ledger.purse = 20;
const richSnap = snap(w);
for (const id of ['repair', 'pad']) {
	const out = Comms.renderTopic(id, richSnap);
	assertCleanOutput(out, 'rich/' + id);
	assert.strictEqual(out.text.includes('Money can be earned'), false,
		id + ' must omit money subtree when solvent');
}

/* Stranded in space with too little purse also attaches the money subtree once. */
w.career.at = -1;
w.career.stranded = true;
w.career.ledger.purse = 1;
const spaceShort = snap(w);
const spaceRepair = Comms.renderTopic('repair', spaceShort);
assertCleanOutput(spaceRepair, 'space/repair');
assert.strictEqual(spaceRepair.text.split('Money can be earned').length - 1, 1);
assert.strictEqual(spaceRepair.actions.length, 1);
assert.strictEqual(spaceRepair.actions[0].id, 'evac');
assert.strictEqual(spaceRepair.actions[0].enabled, true);
assert.ok(spaceRepair.text.includes('takes ' + Game.evacuationSeconds(w.career).toFixed(0) + ' s'));

/* 5. Bounded one-step look-ahead: states arithmetic only when 1 on-planet step covers it. */
Game.placeShip(w.career, w.sim, other);
w.career.stranded = true;
Game.setShipCondition(w.career, 0);
w.career.ledger.purse = 1.0;
Game.harvestPlanet(w.career.ledger, w.market, other, w.clockSteps);
w.market.lastVisitStep[other] = w.clockSteps;
w.market.visitPay[other] = 0.3; /* offer = 0.60 -> 1.00 + 0.60 = 1.60 < repair 2.00 */
const tooSmall = Comms.renderTopic('repair', snap(w));
assert.strictEqual(tooSmall.text.includes('covering repair'), false,
	'look-ahead omitted when offer does not reach repair cost');

w.market.visitPay[other] = 0.75; /* offer = 1.50 -> 1.00 + 1.50 = 2.50 >= repair 2.00 */
const justEnough = Comms.renderTopic('repair', snap(w));
assert.ok(justEnough.text.includes('Purse 1.00 + rulers’ offer 1.50 = 2.50, covering repair 2.00'),
	justEnough.text);
assert.strictEqual(justEnough.actions.some(a => a.id === 'bribe'), false,
	'look-ahead never adds a bribe CTA');

/* Evac look-ahead fires when purse + offer reaches evacFee. */
Game.setShipCondition(w.career, 1);
w.career.ledger.purse = 4.0;
w.market.visitPay[other] = 1.25; /* offer = 2.50 -> 4.00 + 2.50 = 6.50 >= evac 6.00 */
const evacAhead = Comms.renderTopic('pad', snap(w));
assert.ok(evacAhead.text.includes('covering the full evacuation fare ' + Game.CAREER.evacFee.toFixed(2)),
	evacAhead.text);
assert.strictEqual(evacAhead.actions.some(a => a.id === 'bribe'), false);

/* Slower-speed look-ahead fires when a high-speed shot fails fee but min speed fits purse. */
const minFee = Game.launchFee(w.career, other, GravitySim.SPEED_MIN);
const fastFee = Game.launchFee(w.career, other, 90);
assert.ok(fastFee > minFee + 0.05);
w.career.ledger.purse = (minFee + fastFee) / 2;
w.market.bribeVisitStep[other] = w.clockSteps;
const slowerAhead = Comms.renderTopic('leave', snap(w, { armed: true, aimBody: other, aimSpeed: 90 }));
assert.ok(slowerAhead.text.includes('At min speed (' + GravitySim.SPEED_MIN + ' px/s), launch fee is ' +
	minFee.toFixed(2)), slowerAhead.text);

/* Own-pad charge look-ahead fires on fuel when purse is 0 and own battery has free kWh. */
Game.placeShip(w.career, w.sim, w.career.hq);
w.career.stranded = false;
w.career.ship.engine = Tech.ENGINES[0];
w.career.ship.tank = Tech.TANKS[1];
w.career.ship.fuelKg = 0;
w.career.ship.mass = Tech.shipMass(w.career.ship, 0);
w.career.pads[w.career.hq].chargeKwh = w.career.pads[w.career.hq].battery.capacity;
w.career.ledger.purse = 0;
const fuelAhead = Comms.renderTopic('fuel', snap(w));
assertCleanOutput(fuelAhead, 'fuel/charge');
assert.ok(fuelAhead.text.includes('with no purse cost'), fuelAhead.text);
assert.strictEqual(fuelAhead.actions.find(a => a.id === 'produce-fuel').enabled, true);
const buyOff = fuelAhead.actions.find(a => a.id === 'buy-fuel');
assert.strictEqual(buyOff.enabled, false);
assert.ok(buyOff.label.includes((Game.FUEL_BUY_STEP * Game.fuelPrice(w.career)).toFixed(2)),
	'disabled buy-fuel shows step price, never free: ' + buyOff.label);
assert.ok(buyOff.why.includes(Game.fuelPrice(w.career).toFixed(2) + '/kg'), buyOff.why);
assert.strictEqual(fuelAhead.text.includes('Money can be earned'), false,
	'fuel omits money subtree when own pad can convert fuel');

/* Drained own pad + empty purse attaches money subtree under fuel. */
w.career.pads[w.career.hq].chargeKwh = 0;
const fuelBroke = Comms.renderTopic('fuel', snap(w));
assertCleanOutput(fuelBroke, 'fuel/broke');
assert.strictEqual(fuelBroke.text.split('Money can be earned').length - 1, 1);

/* Drained own pad + solvent purse mentions commercial rail in leave look-ahead. */
w.career.ledger.purse = 5;
const commAhead = Comms.renderTopic('leave', snap(w));
assertCleanOutput(commAhead, 'leave/comm');
assert.ok(commAhead.text.includes('Commercial ' + Game.COMMERCIAL_PAD.catapult.id + ' here lifts to'),
	commAhead.text);
assert.strictEqual(commAhead.actions.find(a => a.id === 'commercial').enabled, true);
assert.strictEqual(commAhead.actions.find(a => a.id === 'wait').enabled, true);

console.log('COMMS TOPICS OK');
