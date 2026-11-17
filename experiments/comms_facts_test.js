/* H's facts and slots: live-variable sensitivity, ladder order, zero hardcoded values, unranked bribes. */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Econ = require(path.join(root, 'orbit_econ.js'));
const Tech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Comms = require(path.join(root, 'comms_copy.js'));

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
	Game.startCareer(career, sim, seed, trade, market, galaxy);
	sim.attachCareer(career);
	return { trade, sim, market, galaxy, career, clockSteps: Math.round(420 / GravitySim.DT) };
}

function normalUnownedPlanet(w) {
	const c = w.career;
	for (let p = 0; p < UNIVERSE; p++) {
		if (p === c.hq || p === c.capitalPlanet || p === c.arfPlanet) continue;
		if (c.pads[p].catapult !== null) continue;
		return p;
	}
	throw new Error('no normal unowned planet');
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

/* 1. Every HH_FACTS entry has test + why, and no why contains a digit literal. */
const factKeys = Object.keys(Comms.HH_FACTS);
assert.ok(factKeys.length >= Comms.LAUNCH_GATE_ORDER.length + 10, 'fact registry covers gates and M2 topics');
assert.strictEqual(Object.isFrozen(Comms.HH_FACTS), true);
for (const key of factKeys) {
	const fact = Comms.HH_FACTS[key];
	assert.strictEqual(typeof fact.test, 'function', key + '.test');
	assert.strictEqual(typeof fact.why, 'function', key + '.why');
	assert.strictEqual(/[0-9]/.test(String(fact.why)), false,
		key + '.why contains a digit literal: ' + String(fact.why));
}

/* 2. Launch-gate order equals launchReasons order across composite states. */
assert.deepStrictEqual(Array.from(Comms.LAUNCH_GATE_ORDER),
	['arrest', 'space', 'wrong-planet', 'worn', 'no-rail', 'cap', 'fee']);

const w = makeWorld(43);
const hq = w.career.hq;
w.career.ship.condition = 0;
w.career.ledger.purse = -1;
const composite = snap(w, { armed: true, aimBody: hq, aimSpeed: GravitySim.SPEED_MAX });
const rawReasons = Game.launchReasons(w.career, w.sim, hq, GravitySim.SPEED_MAX, false);
assert.deepStrictEqual(composite.reasons.map(r => r.id), rawReasons.map(r => r.id));
const activeGates = Comms.LAUNCH_GATE_ORDER.filter(id => Comms.HH_FACTS[id].test(composite));
assert.deepStrictEqual(activeGates, rawReasons.map(r => r.id));
for (const reason of rawReasons) {
	assert.strictEqual(Comms.HH_FACTS[reason.id].why(composite), Game.formatLaunchReason(reason));
}
const leaveLines = Comms.renderTopic('leave', composite).text.split('\n');
assert.strictEqual(leaveLines[0], Game.formatLaunchReason(rawReasons[0]));
for (let i = 1; i < rawReasons.length; i++) {
	assert.strictEqual(leaveLines[i], 'Also blocked: ' + Game.formatLaunchReason(rawReasons[i]));
}

/* Position gates keep ship-state gates without a separate ladder. */
w.career.at = -1;
w.career.stranded = true;
const inSpace = snap(w);
assert.deepStrictEqual(inSpace.reasons.map(r => r.id), ['space', 'worn']);
assert.strictEqual(Comms.HH_FACTS.space.test(inSpace), true);
assert.strictEqual(Comms.HH_FACTS.worn.test(inSpace), true);
assert.strictEqual(Comms.HH_FACTS.fee.test(inSpace), false);

/* 3. Snapshot is immutable and mutates no live game state. */
Game.placeShip(w.career, w.sim, hq);
Game.setShipCondition(w.career, 0.65);
w.career.ledger.purse = 4.37;
const serialBefore = w.career.serial;
const politicsSerialBefore = w.market.politicsSerial;
const stampBefore = w.market.stamp;
const s0 = snap(w);
assert.strictEqual(Object.isFrozen(s0), true);
assert.strictEqual(Object.isFrozen(s0.reasons), true);
for (const id of Object.keys(Comms.H_TOPICS)) {
	const out = Comms.renderTopic(id, s0);
	assert.strictEqual(Object.isFrozen(out), true);
	assert.strictEqual(Object.isFrozen(out.actions), true);
}
assert.strictEqual(w.career.ledger.purse, 4.37);
assert.strictEqual(w.career.ship.condition, 0.65);
assert.strictEqual(w.career.serial, serialBefore);
assert.strictEqual(w.market.politicsSerial, politicsSerialBefore);
assert.strictEqual(w.market.stamp, stampBefore);

/* 4. Live-variable sensitivity: changing rule constants, scales, cheats, item IDs
 * or career/market fields automatically changes snapshot, slots, why and prose. */
const other = normalUnownedPlanet(w);
Game.placeShip(w.career, w.sim, other);
w.career.stranded = true;
w.career.ship.engine = Tech.ENGINES[0];
w.career.ship.tank = Tech.TANKS[1];
w.career.ship.mass = Tech.shipMass(w.career.ship, 0);
w.career.ship.fuelKg = 7.5;
Game.setShipCondition(w.career, 0.4);
w.career.ledger.purse = 1.15;

/* Repair follows condition, WEAR_REPAIR_COST, spaceWearScale and research hardening. */
const savedWearScale = Game.spaceWearScaleOf();
const savedRepairCost = Game.WEAR_REPAIR_COST;
const savedEvacFee = Game.CAREER.evacFee;
const savedTax = Game.CAREER.taxPerKwh;
const savedCatId = Tech.CATAPULTS[0].id;
const savedCatCost = Tech.CATAPULTS[0].buildCost;
const savedObsId = Tech.OBS[1].id;
const savedTankCap = Tech.TANKS[1].fuelCap;
try {
	let s = snap(w);
	assert.strictEqual(s.repairCost, Game.repairCost(w.career));
	assert.strictEqual(s.conditionPct, 40);
	assert.strictEqual(Comms.HH_FACTS['can-repair'].test(s), false);
	const expectedShort = (s.repairCost - s.purse).toFixed(2);
	assert.ok(Comms.HH_FACTS['can-repair'].why(s).includes(expectedShort),
		Comms.HH_FACTS['can-repair'].why(s));
	let repairText = Comms.renderTopic('repair', s).text;
	assert.ok(repairText.includes('40%'), repairText);
	assert.ok(repairText.includes(s.repairCost.toFixed(2)), repairText);
	assert.ok(repairText.includes(s.purse.toFixed(2)), repairText);
	assert.ok(repairText.includes(expectedShort), repairText);

	/* Change spaceWearScale and research count: live wear rate moves automatically. */
	Game.setSpaceWearScale(2.5);
	w.career.research = 5;
	s = snap(w);
	const wantSpace = Game.spaceWear(w.career, GravitySim.stepsForGameSeconds(1)) * 100;
	const wantLand = Game.landingWear(w.career) * 100;
	assert.ok(Math.abs(s.wearSpacePct - wantSpace) < 1e-9);
	assert.ok(Math.abs(s.wearLandingPct - wantLand) < 1e-9);
	repairText = Comms.renderTopic('repair', s).text;
	assert.ok(repairText.includes(Comms.H_SLOTS.wearSpacePct(s)), repairText);
	assert.ok(repairText.includes(Comms.H_SLOTS.wearLandingPct(s)), repairText);

	/* Change WEAR_REPAIR_COST on module: full-hull slot moves without touching copy. */
	Game.WEAR_REPAIR_COST = 3.75;
	s = snap(w);
	assert.strictEqual(s.repairFullCost, 3.75);
	assert.ok(Comms.renderTopic('repair', s).text.includes('3.75'));
	Game.WEAR_REPAIR_COST = savedRepairCost;

	/* Change CAREER.evacFee, CAREER.taxPerKwh, CATAPULTS[0].id/buildCost and forceScale. */
	Game.CAREER.evacFee = 9.45;
	Game.CAREER.taxPerKwh = 1.75;
	Tech.CATAPULTS[0].id = 'EMC-ALPHA';
	Tech.CATAPULTS[0].buildCost = 5.67;
	w.career.knownGear['EMC-ALPHA'] = true;
	w.sim.setScales(1, 1.5);
	s = snap(w);
	assert.strictEqual(s.evacCost, 9.45);
	assert.strictEqual(s.taxPerKwh, 1.75);
	assert.strictEqual(s.nextPadId, 'EMC-ALPHA');
	assert.strictEqual(s.nextPadCost, 5.67);
	const wantLift = Math.min(GravitySim.SPEED_MAX, Game.padLift(w.career, other, 1.5));
	assert.ok(Math.abs(s.padLift - wantLift) < 1e-9);
	const padOut = Comms.renderTopic('pad', s);
	assert.ok(padOut.text.includes('EMC-ALPHA'), padOut.text);
	assert.ok(padOut.text.includes('5.67'), padOut.text);
	assert.ok(padOut.text.includes('1.75'), padOut.text);
	const buildBtn = padOut.actions.find(a => a.id === 'build-pad');
	assert.ok(buildBtn && buildBtn.label.includes('EMC-ALPHA') && buildBtn.label.includes('5.67'));
	assert.strictEqual(buildBtn.enabled, false);
	assert.ok(buildBtn.why.includes((5.67 - 1.15).toFixed(2)), buildBtn.why);
	const evacBtn = padOut.actions.find(a => a.id === 'evac');
	assert.ok(evacBtn && evacBtn.label.includes('9.45'));
	assert.strictEqual(evacBtn.enabled, false);
	assert.ok(evacBtn.why.includes((9.45 - 1.15).toFixed(2)), evacBtn.why);

	/* Change OBS[1].id: money and repair pick up the live device name, not a string literal. */
	Tech.OBS[1].id = 'OBS-PRIME';
	s = snap(w);
	assert.strictEqual(s.obsId, 'OBS-PRIME');
	assert.ok(Comms.renderTopic('money', s).text.includes('OBS-PRIME'));

	/* Change tank cap, fuelKg, FUEL_KG_PER_KWH and FUEL_BUY_STEP: fuel topic tracks all four. */
	Tech.TANKS[1].fuelCap = 64;
	const savedRate = Game.FUEL_KG_PER_KWH;
	const savedStep = Game.FUEL_BUY_STEP;
	try {
		Game.FUEL_KG_PER_KWH = 25;
		Game.FUEL_BUY_STEP = 15;
		s = snap(w);
		assert.strictEqual(s.fuelPrice, Game.fuelPrice(w.career));
		assert.strictEqual(s.fuelCap, 64);
		assert.strictEqual(s.fuelKg, 7.5);
		assert.strictEqual(s.fuelKgPerKwh, 25);
		assert.strictEqual(s.fuelStep, 15);
		assert.ok(Math.abs(s.fuelStepCost - 15 * Game.fuelPrice(w.career)) < 1e-9);
		assert.ok(Math.abs(s.fuelStepKwh - 15 / 25) < 1e-9);
		const fuelText = Comms.renderTopic('fuel', s).text;
		assert.ok(fuelText.includes('7.5 / 64 kg'), fuelText);
		assert.ok(fuelText.includes(Game.fuelPrice(w.career).toFixed(2) + '/kg'), fuelText);
		assert.ok(fuelText.includes('25 kg/kWh'), fuelText);
		assert.ok(fuelText.includes('15 kg'), fuelText);
		assert.ok(fuelText.includes((15 * Game.fuelPrice(w.career)).toFixed(2)), fuelText);
		assert.ok(fuelText.includes((15 / 25).toFixed(2) + ' kWh'), fuelText);
	} finally {
		Game.FUEL_KG_PER_KWH = savedRate;
		Game.FUEL_BUY_STEP = savedStep;
	}

	/* Change COMMERCIAL_BASE / COMMERCIAL_KWH and politics constants: all propagate live. */
	const savedCommBase = Game.COMMERCIAL_BASE;
	const savedCommKwh = Game.COMMERCIAL_KWH;
	const savedArrestSec = Econ.ARREST_SECONDS;
	const savedRebelStart = Econ.REBEL_START;
	const savedBribeCoef = Econ.BRIBE_VALUE_COEF;
	try {
		Game.COMMERCIAL_BASE = 3.33;
		Game.COMMERCIAL_KWH = 4.44;
		Econ.ARREST_SECONDS = 195;
		Econ.REBEL_START = 62;
		Econ.BRIBE_VALUE_COEF = 3.5;
		s = snap(w);
		assert.strictEqual(s.commercialBase, 3.33);
		assert.strictEqual(s.commercialKwh, 4.44);
		assert.strictEqual(s.arrestSeconds, 195);
		assert.strictEqual(s.rebelStart, 62);
		assert.strictEqual(s.bribeCoef, 3.5);
		const padLive = Comms.renderTopic('pad', s).text;
		assert.ok(padLive.includes('3.33 + 4.44/kWh'), padLive);
		const bribeLive = Comms.renderTopic('bribe', s).text;
		assert.ok(bribeLive.includes('195 s'), bribeLive);
		assert.ok(bribeLive.includes('62%'), bribeLive);
		assert.ok(bribeLive.includes('× 3.5'), bribeLive);
	} finally {
		Game.COMMERCIAL_BASE = savedCommBase;
		Game.COMMERCIAL_KWH = savedCommKwh;
		Econ.ARREST_SECONDS = savedArrestSec;
		Econ.REBEL_START = savedRebelStart;
		Econ.BRIBE_VALUE_COEF = savedBribeCoef;
	}

	/* Communism cheat zeroes every rule-priced cost automatically. */
	w.career.cheat = Game.CHEAT_COMMUNISM;
	s = snap(w);
	assert.strictEqual(s.repairCost, 0);
	assert.strictEqual(s.nextPadCost, 0);
	assert.strictEqual(s.evacCost, 0);
	assert.strictEqual(s.fuelPrice, 0);
	assert.strictEqual(Comms.HH_FACTS['can-repair'].test(s), true);
	assert.strictEqual(Comms.HH_FACTS['can-build-pad'].test(s), true);
	assert.strictEqual(Comms.HH_FACTS['can-evac'].test(s), true);
	w.career.cheat = null;
} finally {
	Game.setSpaceWearScale(savedWearScale);
	Game.WEAR_REPAIR_COST = savedRepairCost;
	Game.CAREER.evacFee = savedEvacFee;
	Game.CAREER.taxPerKwh = savedTax;
	delete w.career.knownGear['EMC-ALPHA'];
	Tech.CATAPULTS[0].id = savedCatId;
	Tech.CATAPULTS[0].buildCost = savedCatCost;
	Tech.OBS[1].id = savedObsId;
	Tech.TANKS[1].fuelCap = savedTankCap;
	w.sim.setScales(1, 1);
	w.career.research = 0;
}

/* 5. Dynamic pad count, sport board and contract board flow straight into money. */
w.career.padCount = 0;
let moneyText = Comms.renderTopic('money', snap(w)).text;
assert.ok(moneyText.includes(Comms.HH_FACTS['own-pad-any'].why(snap(w))),
	'no-pad note derives from HH_FACTS: ' + moneyText);
w.career.padCount = 3;
moneyText = Comms.renderTopic('money', snap(w)).text;
assert.ok(!moneyText.includes('you own no pad anywhere'), moneyText);
assert.ok(moneyText.includes('3/' + UNIVERSE), moneyText);

const sport = w.career.tasks[Game.COMPETE_SLOT];
sport.kind = Game.TASK_COMPETE;
sport.planet = 5;
sport.minLength = 2345;
sport.reward = 3.42;
sport.deadline = w.clockSteps + Math.round(97 / GravitySim.DT);
moneyText = Comms.renderTopic('money', snap(w)).text;
assert.ok(moneyText.includes('P5') && moneyText.includes('2345 px') &&
	moneyText.includes('+3.42') && moneyText.includes('97 s'), moneyText);
sport.kind = Game.TASK_NONE;
moneyText = Comms.renderTopic('money', snap(w)).text;
assert.ok(moneyText.includes('nothing on the board now'), moneyText);

/* 6. Bribes: live amount, rot, arrest chance, transport duration and one-per-visit
 * rule are reported faithfully, and bribes are never ranked as top finding or fix CTA. */
Game.harvestPlanet(w.career.ledger, w.market, other, w.clockSteps);
w.market.visitPay[other] = 1.6;
w.market.corruption[other] = 68;
const sb = snap(w);
const wantOffer = Game.bribeAmount(w.market, other, w.clockSteps);
const wantRot = Econ.bribeCorruption(wantOffer);
const wantAfter = Math.round(Econ.clampCorruption(68 + wantRot));
const wantArrest = Math.round(Econ.arrestChance(Econ.clampCorruption(68 + wantRot)) * 100);
assert.ok(wantOffer > 0);
assert.strictEqual(sb.bribeAmount, wantOffer);
assert.strictEqual(sb.bribeRot, wantRot);
assert.strictEqual(sb.bribeAfterPct, wantAfter);
assert.strictEqual(sb.bribeArrestPct, wantArrest);
assert.strictEqual(sb.arrestSeconds, Econ.ARREST_SECONDS);

const bribeOut = Comms.renderTopic('bribe', sb);
assert.ok(bribeOut.text.includes('+' + wantOffer.toFixed(2)), bribeOut.text);
assert.ok(bribeOut.text.includes('+' + wantRot.toFixed(2)), bribeOut.text);
assert.ok(bribeOut.text.includes(wantArrest + '%'), bribeOut.text);
assert.ok(bribeOut.text.includes(Econ.ARREST_SECONDS + ' s'), bribeOut.text);
assert.ok(bribeOut.text.includes('one per visit'), bribeOut.text);
assert.strictEqual(bribeOut.actions.length, 1);
assert.strictEqual(bribeOut.actions[0].id, 'bribe');
assert.strictEqual(bribeOut.actions[0].enabled, true);

/* Never ranked as a fix CTA outside the bribe topic, and never picked as topTopicId. */
for (const id of Object.keys(Comms.H_TOPICS)) {
	if (id === 'bribe') continue;
	const rendered = Comms.renderTopic(id, sb);
	assert.strictEqual(rendered.actions.some(a => a.id === 'bribe'), false,
		id + ' must not rank bribe as an action');
}
assert.notStrictEqual(Comms.topTopicId(sb), 'bribe');

/* Once taken on this visit, the bribe action disables with the law's refusal. */
w.market.bribeVisitStep[other] = w.clockSteps;
const sbTaken = snap(w);
assert.strictEqual(Comms.HH_FACTS['bribe-open'].test(sbTaken), false);
const bribeTakenOut = Comms.renderTopic('bribe', sbTaken);
assert.strictEqual(bribeTakenOut.actions[0].enabled, false);
assert.strictEqual(bribeTakenOut.actions[0].why, Game.bribeRefusal(w.career, w.market, other));

console.log('COMMS FACTS OK');
