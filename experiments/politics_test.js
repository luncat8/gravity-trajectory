/*
 * Politics bench (0.5.12): the pure corruption/arrest/rebellion/fly-by laws,
 * the visit and passive clock, one-bribe-per-visit, deterministic arrests,
 * one rebellion roll per planet per epoch, the seizure of a rail and career
 * completion, and the medical quest from the Capital and back.
 * Run: node experiments/politics_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Econ = require(path.join(root, 'orbit_econ.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));

const DT = GravitySim.DT;
const PLANETS = World.PLANETS;
const UNIVERSE = 26;

function universe() {
	const mask = new Uint8Array(PLANETS);
	mask.fill(1, 0, UNIVERSE);
	return mask;
}

function setup(seed) {
	const trade = new Sim(seed);
	const market = Game.createMarket();
	const mask = universe();
	Game.resetMarket(market);
	Game.applyMarketUniverse(market, mask, UNIVERSE);
	Game.applyMarketSpecials(market, trade.world);
	const galaxy = Game.createGalaxy();
	Game.resetGalaxy(galaxy, seed);
	Game.bindRun(market, galaxy, trade.world);
	const sim = new GravitySim(World.WORLD_W, World.WORLD_H);
	const career = Game.createCareer(Game.createLedger());
	Game.setCareerUniverse(career, mask, UNIVERSE);
	Game.startCareer(career, sim, seed, trade, null, galaxy);
	/* the gates read the sim's body count; the flight itself is not tested here */
	sim.bodyCount = UNIVERSE;
	return { trade, world: trade.world, market, galaxy, sim, career };
}

/* a second competing company on the same shared map */
function addRival(w, seed) {
	const sim = new GravitySim(World.WORLD_W, World.WORLD_H);
	const career = Game.createCareer(Game.createLedger());
	Game.setCareerUniverse(career, universe(), UNIVERSE);
	career.ledger.purse = 99;
	Game.startCareer(career, sim, seed, w.trade, null, w.galaxy);
	sim.bodyCount = UNIVERSE;
	return career;
}

/* a planet of the run that is neither the Capital nor the A.R.F. world */
function normalPlanet(w) {
	for (let p = 0; p < UNIVERSE; p++) {
		if (p !== w.market.capitalPlanet && p !== w.market.arfPlanet) return p;
	}
	throw new Error('no normal planet');
}

/* one world step of the political clock at the given world speed */
function step(w, runStep, rate) {
	w.trade.advanceTo(w.trade.t + DT * (rate || 1));
	return Game.advancePolitics(w.market, w.trade, runStep, rate || 1);
}

let checks = 0;
function check(name, fn) {
	fn();
	checks += 1;
	console.log('ok - ' + name);
}

/* --- §1 the pure formulas ---------------------------------------------- */

check('growth factor throttles positive growth only, halved at 50 and 0 at 100', () => {
	assert.strictEqual(Econ.corruptionGrowthFactor(0), 1);
	assert.strictEqual(Econ.corruptionGrowthFactor(50), 0.5);
	assert.strictEqual(Econ.corruptionGrowthFactor(100), 0);
	assert.strictEqual(Econ.corruptionGrowthFactor(130), 0);
	const w = setup(4);
	const trade = w.trade;
	const planet = normalPlanet(w);
	const colony = trade.seedColony(planet, trade.t);
	const clean = colony.pop;
	trade.setCorruption(w.market.corruption);
	w.market.corruption[planet] = 100;
	trade.advanceTo(trade.t + 30);
	assert.ok(Math.abs(colony.pop - clean) < 1e-9, 'rot at 100 still grew the colony');
	/* famine is a loss whatever the rulers do: a barren colony loses people */
	const barren = Econ.createColony(planet, 'barren', 0,
		Econ.resourceMapFor(trade.world, planet, 5, Econ.createMap()));
	barren.ease.fill(0);
	barren.stock.fill(0);
	barren.pop = 20;
	barren.corruption = 100;
	Econ.advanceColony(barren, 10);
	assert.ok(barren.pop < 20, 'famine was cancelled by rot: ' + barren.pop);
});

check('bribe formula, arrest endpoints and the saturating rebellion chance', () => {
	assert.strictEqual(Econ.bribeCorruption(0), 1);
	assert.ok(Math.abs(Econ.bribeCorruption(10) - 2) < 1e-12);
	/* (0.5.13) the bribe is the visit value scaled by the rot fraction */
	assert.strictEqual(Econ.bribeValue(2, 0), 0);
	assert.strictEqual(Econ.bribeValue(0, 100), 0);
	assert.ok(Math.abs(Econ.bribeValue(2, 50) - 4) < 1e-12, 'rot 50 pays 2x the value');
	assert.ok(Math.abs(Econ.bribeValue(2, 100) - 8) < 1e-12, 'rot 100 pays 4x the value');
	assert.ok(Math.abs(Econ.bribeValue(2, 150) - Econ.bribeValue(2, 100)) < 1e-12, 'clamped');
	assert.ok(Econ.bribeValue(-1, 100) === 0, 'no value, no bribe');
	assert.strictEqual(Econ.arrestChance(50), 0);
	assert.strictEqual(Econ.arrestChance(49.9), 0);
	assert.ok(Math.abs(Econ.arrestChance(100) - 0.5) < 1e-12);
	assert.strictEqual(Econ.rebellionChance(50), 0);
	assert.strictEqual(Econ.rebellionChance(30), 0);
	const top = Econ.rebellionChance(100);
	assert.ok(Math.abs(top - 0.25 * (1 - Math.exp(-0.0322 * 50))) < 1e-12, 'rebellion cap: ' + top);
	assert.ok(top > 0.19 && top < 0.21, 'rebellion at 100 is about 0.20: ' + top);
	assert.ok(Number.isFinite(top) && Econ.rebellionChance(99.999) < 0.21);
	let last = 0;
	for (let c = 50; c <= 100; c++) {
		const chance = Econ.rebellionChance(c);
		assert.ok(chance >= last, 'rebellion chance is monotone at ' + c);
		last = chance;
	}
	assert.strictEqual(Econ.flybyMultiplier(0), 1);
	assert.strictEqual(Econ.flybyMultiplier(-5), 1);
	const ramp = Econ.flybyMultiplier(Econ.FLYBY_RAMP_SECONDS);
	assert.ok(ramp > 2.8 && ramp < 3.0, 'one ramp constant is about 2.9x: ' + ramp);
	assert.ok(Econ.flybyMultiplier(1e9) < 4.0000001);
});

/* --- §2 visits and the passive clock ----------------------------------- */

check('a visit takes 0.2 rot off and stamps the clock; the A.R.F. and Capital stay clean', () => {
	const w = setup(7);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.corruption[planet] = 10;
	Game.harvestPlanet(ledger, w.market, planet, 100);
	assert.ok(Math.abs(w.market.corruption[planet] - 9.8) < 1e-9, 'visit decay');
	assert.strictEqual(w.market.lastVisitStep[planet], 100);
	assert.ok(Game.bribeWindowOpen(w.market, planet), 'the visit leaves the bribe window shut');
	w.market.corruption[w.market.capitalPlanet] = 9;
	w.market.corruption[w.market.arfPlanet] = 9;
	Game.harvestPlanet(ledger, w.market, w.market.capitalPlanet, 200);
	Game.harvestPlanet(ledger, w.market, w.market.arfPlanet, 200);
	assert.strictEqual(w.market.corruption[w.market.capitalPlanet], 9);
	assert.strictEqual(w.market.corruption[w.market.arfPlanet], 9);
});

check('rot rises only after the grace, never past 100, and only on unvisited worlds', () => {
	const w = setup(11);
	const planet = normalPlanet(w);
	let other = normalPlanet(w) + 1;
	if (other === w.market.capitalPlanet || other === w.market.arfPlanet || other >= UNIVERSE) {
		other = normalPlanet(w) + 2;
	}
	const graceSteps = Math.round(Econ.CORRUPTION_GRACE / DT);
	w.market.lastVisitStep[planet] = 0;
	w.market.lastVisitStep[other] = -1e9;
	w.market.lastReportStep[planet] = 0;
	w.market.lastReportStep[other] = -1e9;
	w.career.at = -1;
	let steps = 0;
	while (steps < graceSteps - 10) {
		step(w, ++steps);
	}
	assert.ok(w.market.corruption[other] > 0, 'a stale world started rotting');
	assert.strictEqual(w.market.corruption[planet], Econ.CORRUPTION_TRADITION, 'a fresh world rotted inside the grace');
	while (steps < graceSteps + 200) step(w, ++steps);
	assert.ok(w.market.corruption[planet] > 0, 'rot did not start after the grace');
	w.market.corruption[planet] = 99.9;
	for (let i = 0; i < 400; i++) step(w, ++steps);
	assert.ok(w.market.corruption[planet] <= 100, 'rot passed 100');
});

check('the political clock runs once per step number and not at all without a bound run', () => {
	const w = setup(13);
	const planet = normalPlanet(w);
	w.market.corruption[planet] = 10;
	w.market.lastVisitStep[planet] = -1e9;
	step(w, 500);
	const once = w.market.corruption[planet];
	Game.advancePolitics(w.market, w.trade, 500, 1);
	assert.strictEqual(w.market.corruption[planet], once, 'a repeated step number rotted twice');
	const loose = Game.createMarket();
	Game.resetMarket(loose);
	loose.corruption[planet] = 10;
	assert.strictEqual(Game.advancePolitics(loose, w.trade, 600, 1), 0);
	assert.strictEqual(loose.corruption[planet], 10, 'an unbound market ran politics');
	const off = setup(13);
	Game.setPolitics(false);
	const before = off.market.corruption[planet];
	step(off, 900);
	assert.strictEqual(off.market.corruption[planet], before, 'POLITICS=0 still rotted');
	Game.setPolitics(true);
});

check('landed profit grows at half speed and a reporting ship can take a bribe', () => {
	const w = setup(14);
	const p = normalPlanet(w);
	const c = w.career;
	c.at = p;
	w.market.lastVisitStep[p] = 0;
	w.market.lastReportStep[p] = 0;
	w.market.visitPay[p] = 0;
	step(w, 600);
	const expected = Game.planetProfitAt(w.market, p, 600, 300);
	assert.ok(Math.abs(Game.planetProfit(w.market, p, 600) - expected) < 1e-9);
	assert.ok(Game.bribeAmount(w.market, p, 600) > 0);
	assert.ok(Game.acceptBribe(c, w.market, w.sim, p, 600).ok);
	step(w, 700);
	assert.ok(!Game.bribeWindowOpen(w.market, p), 'clock movement reopened bribe');
	c.flying = true;
	step(w, 800);
	assert.strictEqual(w.market.lastVisitStep[p], 350, 'a flying ship does not occupy its origin');
});

check('reporting reduces rot to its floor; optional entrenched rot clears on quelling', () => {
	const w = setup(15);
	const p = normalPlanet(w);
	const c = w.career;
	c.at = p;
	w.market.permanentCorruption = true;
	w.market.corruption[p] = 25;
	w.market.visitPay[p] = 1;
	const bribe = Game.acceptBribe(c, w.market, w.sim, p, 0);
	assert.ok(bribe.ok);
	const floor = w.market.corruptionFloor[p];
	assert.ok(Math.abs(floor - (Econ.CORRUPTION_TRADITION + Econ.bribeCorruption(bribe.amount) * 0.1)) < 1e-9);
	step(w, 100);
	assert.ok(w.market.corruption[p] < bribe.corruption);
	w.market.corruption[p] = floor + 0.01;
	step(w, 200);
	assert.strictEqual(w.market.corruption[p], floor);
	c.ledger.reports = false;
	w.market.lastReportStep[p] = -100000;
	step(w, 300);
	assert.ok(w.market.corruptionFloor[p] > floor, 'passive growth entrenches rot too');
	Game.pacifyPlanet(w.market, p, 300);
	assert.strictEqual(w.market.corruptionFloor[p], Econ.CORRUPTION_TRADITION);
});

/* --- §3 bribes and arrest ---------------------------------------------- */

check('a bribe pays the visit value scaled by rot, rots the planet and is refused twice per visit', () => {
	const w = setup(17);
	const career = w.career;
	const planet = normalPlanet(w);
	career.at = planet;
	career.ledger.purse = 3;
	w.market.lastVisitStep[planet] = 100;   // the landing that collected 2.00
	w.market.visitPay[planet] = 2;
	w.market.corruption[planet] = 25;
	const expect = Econ.bribeValue(2, 25);  // 2.00: a quarter-rot lord pays 1x
	assert.ok(Math.abs(expect - 2) < 1e-9, 'fixture amount ' + expect);
	const result = Game.acceptBribe(career, w.market, w.sim, planet, 100);
	assert.ok(result.ok, result.reason);
	assert.ok(Math.abs(result.amount - expect) < 1e-9, 'bribe amount ' + result.amount);
	assert.ok(Math.abs(career.ledger.purse - (3 + expect)) < 1e-9);
	assert.strictEqual(career.bribes, 1);
	assert.ok(Math.abs(career.bribeIncome - expect) < 1e-9);
	assert.ok(Math.abs(w.market.corruption[planet] - (25 + Econ.bribeCorruption(expect))) < 1e-9);
	/* a clean lord owes nothing: the visit is already worth no bribe */
	let clean = -1;
	for (let p = planet + 1; p < UNIVERSE; p++) {
		if (p !== w.market.capitalPlanet && p !== w.market.arfPlanet) { clean = p; break; }
	}
	assert.ok(clean >= 0, 'no second normal planet');
	career.at = clean;
	w.market.lastVisitStep[clean] = 100;
	w.market.visitPay[clean] = 2;
	w.market.corruption[clean] = 0;
	const refused = Game.acceptBribe(career, w.market, w.sim, clean, 100);
	assert.ok(!refused.ok && refused.reason.indexOf('owe nothing') >= 0, refused.reason);
	career.at = planet;
	const again = Game.acceptBribe(career, w.market, w.sim, planet, 101);
	assert.ok(!again.ok && again.reason.indexOf('already bribed') >= 0, again.reason);
	/* a new visit opens a new window */
	Game.harvestPlanet(career.ledger, w.market, planet, 105);
	assert.strictEqual(Game.bribeRefusal(career, w.market, planet), '');
});

/* the window is a state of the visit, not of the price: a company sitting on
 * its start pad (no landing ever stamped it) can be bribed, once, and even a
 * bribe below the bot's floor closes it until the next landing */
check('the bribe window opens on any visit, including an unstamped start pad', () => {
	const w = setup(23);
	const career = w.career;
	const planet = normalPlanet(w);
	career.at = planet;
	w.market.visitPay[planet] = 2;
	w.market.corruption[planet] = 1;
	assert.ok(Game.bribeWindowOpen(w.market, planet), 'a never-visited world starts shut');
	const purse = career.ledger.purse;
	const small = Game.acceptBribe(career, w.market, w.sim, planet, 0);
	assert.ok(small.ok, 'a small bribe was refused: ' + small.reason);
	assert.ok(small.amount < Econ.BRIBE_MIN, 'fixture is no longer a small bribe: ' + small.amount);
	assert.ok(career.ledger.purse > purse, 'a small bribe paid nothing');
	assert.ok(!Game.bribeWindowOpen(w.market, planet), 'a start-pad bribe can be taken twice');
	const twice = Game.acceptBribe(career, w.market, w.sim, planet, 0);
	assert.ok(!twice.ok && twice.reason.indexOf('already bribed') >= 0, twice.reason);
	Game.harvestPlanet(career.ledger, w.market, planet, 10);
	assert.ok(Game.bribeWindowOpen(w.market, planet), 'a landing did not reopen the window');
});

check('the Capital, A.R.F. and a rebellion take no bribes', () => {
	const w = setup(19);
	const career = w.career;
	assert.ok(Game.bribeRefusal(career, w.market, w.market.capitalPlanet).length > 0);
	assert.ok(Game.bribeRefusal(career, w.market, w.market.arfPlanet).length > 0);
	const planet = normalPlanet(w);
	career.at = planet;
	w.market.rebel[planet] = 1;
	assert.ok(Game.bribeRefusal(career, w.market, planet).indexOf('rebels') >= 0);
	assert.ok(Game.bribeRefusal(career, w.market, planet + 1).length > 0, 'a bribe away from the ship');
});

check('high rot can end a bribe in arrest: Capital transport, no planning, medical cargo dropped', () => {
	const w = setup(23);
	const career = w.career;
	const planet = normalPlanet(w);
	career.at = planet;
	let arrested = 0;
	let trials = 0;
	for (let i = 0; i < 200 && arrested === 0; i++) {
		w.market.corruption[planet] = 99.9;
		Game.harvestPlanet(career.ledger, w.market, planet, 1000 + trials);
		w.market.lastVisitStep[planet] = 1000 + trials;
		w.market.visitPay[planet] = 1;
		const result = Game.acceptBribe(career, w.market, w.sim, planet, 1100 + trials);
		trials += 1;
		if (!result.ok) throw new Error('bribe refused: ' + result.reason);
		if (!result.arrested) continue;
		arrested = 1;
		assert.ok(career.arrested, 'the arrested flag');
		assert.ok(career.at === career.capitalPlanet, 'the Capital transport');
		assert.ok(career.arrestUntilStep >= 1100 + trials - 1);
		assert.ok(Game.railBlock(career, w.sim, career.at, 100).indexOf('arrest') >= 0, 'the rail gate');
		assert.strictEqual(Game.canAccept(career, 0), false);
	}
	assert.strictEqual(arrested, 1, 'no arrest in 200 high-rot bribes');
	/* the transport retires on the world clock */
	const until = career.arrestUntilStep;
	step(w, until);
	assert.ok(!career.arrested, 'the arrest never retired');
	assert.strictEqual(Game.railBlock(career, w.sim, career.at, GravitySim.SPEED_MIN), '');
});

check('arrest takes the medical cargo with it', () => {
	const w = setup(29);
	const career = w.career;
	const planet = normalPlanet(w);
	Game.seizePlanet(w.market, w.galaxy, planet, 50);
	career.at = career.capitalPlanet;
	career.ship.hold = require(path.join(root, 'orbit_tech.js')).HOLDS[1];
	const slot = Game.MEDIC_SLOT;
	Game.refreshBoard(career, w.trade, 60);
	const task = career.tasks[slot];
	assert.strictEqual(task.kind, Game.TASK_MEDIC, 'no medical offer');
	assert.ok(Game.acceptTask(career, slot), 'medical offer refused');
	assert.strictEqual(career.ship.cargoTons, task.medics);
	Game.arrestCareer(career, w.market, w.sim, 70);
	assert.strictEqual(career.contract, -1, 'the medical contract survived the arrest');
	assert.strictEqual(career.ship.cargoTons, 0, 'the medics rode to the Capital');
	assert.ok(!task.aboard && !task.medics);
});

/* --- §4 rebellion and seizure ----------------------------------------- */

check('rebellion rolls once per epoch and never below the threshold', () => {
	const w = setup(31);
	const planet = normalPlanet(w);
	w.market.lastVisitStep[planet] = -1e9;
	w.market.corruption[planet] = 49;
	let steps = 0;
	while (steps < 40) step(w, ++steps);
	assert.strictEqual(w.market.rebel[planet], 0, 'a rebellion started below the threshold');
	assert.ok(w.market.lastCheckEpoch[planet] < 0, 'an ineligible planet consumed an epoch roll');
	w.market.corruption[planet] = 100;
	const start = steps;
	for (; steps < start + Math.round(4000 / DT); steps++) {
		step(w, steps);
		if (w.market.rebel[planet]) break;
	}
	assert.strictEqual(w.market.rebel[planet], 1, 'no rebellion in 4000 world seconds at 100 rot');
	/* the epoch stamp is the guard: at most one roll per planet per epoch */
	const epochAt = step => Math.floor(step * DT / Econ.REBEL_CHECK_SECONDS);
	assert.strictEqual(w.market.lastCheckEpoch[planet], epochAt(steps));
	Game.pacifyPlanet(w.market, planet, steps);
	w.market.rebelCooldownStep[planet] = 0;
	w.market.corruption[planet] = 100;
	w.market.lastCheckEpoch[planet] = -1;
	const epochs = Math.floor((steps + Math.round(Econ.REBEL_CHECK_SECONDS * 3 / DT)) * DT /
		Econ.REBEL_CHECK_SECONDS) - epochAt(steps);
	let stamps = 0;
	let previous = w.market.lastCheckEpoch[planet];
	const end = steps + Math.round(Econ.REBEL_CHECK_SECONDS * 3 / DT);
	for (; steps < end; steps++) {
		step(w, steps);
		if (w.market.lastCheckEpoch[planet] === previous) continue;
		stamps += 1;
		previous = w.market.lastCheckEpoch[planet];
		if (w.market.rebel[planet]) {
			Game.pacifyPlanet(w.market, planet, steps);
			w.market.corruption[planet] = 100;
		}
	}
	assert.ok(stamps >= epochs && stamps <= epochs + 1,
		'one roll per epoch: ' + stamps + ' stamps for ' + epochs + ' epochs');
});

check('a rebellion is deterministic for a seed and its roll rate matches the law', () => {
	const first = setup(37);
	const second = setup(37);
	const planet = normalPlanet(first);
	first.market.lastVisitStep.fill(-1e9);
	second.market.lastVisitStep.fill(-1e9);
	first.market.corruption.fill(100);
	second.market.corruption.fill(100);
	for (let i = 1; i <= 20000; i++) {
		step(first, i);
		step(second, i);
	}
	assert.deepStrictEqual(Array.from(first.market.rebel), Array.from(second.market.rebel),
		'two identical markets rebelled differently');
	let seized = 0;
	for (let p = 0; p < UNIVERSE; p++) {
		if (first.market.seized[p]) seized += 1;
	}
	assert.ok(seized > 0, 'no planet rebelled in 20 000 steps at 100 rot');
	assert.strictEqual(seized, Array.from(second.market.seized).reduce((n, v) => n + v, 0));
	/* a 100-rot planet rolls at about 0.20 per epoch: count the rolls */
	let started = 0;
	for (let epoch = 0; epoch < 400; epoch++) {
		if (Econ.rebellionChance(100) <= 0) continue;
		const key = World.hashBits(first.market.politicsSeed, planet, 0xce);
		if (World.hashBits(key, epoch, 0xcf) / 4294967296 < Econ.rebellionChance(100)) started += 1;
	}
	assert.ok(started > 40 && started < 160, 'roll rate ' + started + '/400');
});

check('seizure keeps the best tiers, drops every owner pad and stays commercial', () => {
	const w = setup(41);
	const planet = normalPlanet(w);
	const a = w.galaxy.actors[0];
	const tech = require(path.join(root, 'orbit_tech.js'));
	a.ledger.purse = 99;
	assert.ok(Game.buildGear(a, planet, 'catapult', tech.CATAPULTS[1]), 'the first rail');
	/* a second company joins after the rail stands, so its HQ cannot be here */
	const b = addRival(w, 41);
	/* one player EMC per planet is the standing rule, so a second actor's
	 * stronger rail can only exist after a handover: place it directly */
	b.pads[planet].catapult = tech.CATAPULTS[2];
	b.pads[planet].panel = tech.PANELS[2];
	b.pads[planet].battery = tech.BATTERIES[2];
	b.pads[planet].chargeKwh = tech.BATTERIES[2].capacity;
	b.padCount += 1;
	const pads = a.padCount + b.padCount;
	Game.seizePlanet(w.market, w.galaxy, planet, 500);
	const rebelPad = w.market.rebelPads[planet];
	assert.ok(rebelPad && rebelPad.catapult === tech.CATAPULTS[2], 'not the best former rail');
	assert.strictEqual(rebelPad.chargeKwh, rebelPad.battery.capacity);
	assert.strictEqual(a.pads[planet].catapult, null);
	assert.strictEqual(b.pads[planet].catapult, null);
	assert.strictEqual(a.padCount + b.padCount, pads - 2);
	assert.strictEqual(Game.padAt(a, planet), rebelPad);
	assert.strictEqual(Game.padOwner(a, planet), Game.OWNER_REBEL);
	assert.strictEqual(Game.claimOwner(w.galaxy, planet), Game.OWNER_REBEL);
	assert.strictEqual(Game.launchFee(a, planet, 100), Game.CAREER.commercialFee);
	assert.strictEqual(Game.planetBuildable(a, planet), false);
	assert.strictEqual(Game.buildGear(a, planet, 'catapult', tech.CATAPULTS[0]), false);
	assert.strictEqual(w.market.patients[planet], Econ.MEDIC_PATIENTS);
	/* visits pay the ramp now */
	const step = 500 + Math.round(Econ.FLYBY_RAMP_SECONDS / DT);
	w.market.lastVisitStep[planet] = 0;
	w.market.rebelSinceStep[planet] = 500;
	const plain = Game.createMarket();
	Game.resetMarket(plain);
	const paying = Game.planetProfit(w.market, planet, step);
	const before = Game.planetProfit(plain, planet, step);
	assert.ok(paying > before * 1.5, 'the fly-by ramp is not paying: ' + paying + ' vs ' + before);
	/* the bot leaves on the rebel rail: a commercial fee, never a rebuilt pad */
	Game.placeShip(a, w.sim, planet);
	a.ship.mass = 4;
	const GravityBot = require(path.join(root, 'gravity_bot.js'));
	const bot = new GravityBot(World.WORLD_W, World.WORLD_H);
	bot.attachWorld(w.trade);
	bot.setPlanetMask(universe(), UNIVERSE);
	const exit = bot.careerDeparture(a, planet, 99, a.ship.mass);
	assert.ok(exit.ok, 'the rebel rail cannot be left: ' + exit.reason);
	assert.strictEqual(exit.source, 'rebel');
	assert.strictEqual(exit.cost, Game.CAREER.commercialFee);
	assert.strictEqual(exit.canBuildStarter, false);
});

check('a seized planet counts as covered for completion and is never buildable again', () => {
	const w = setup(43);
	const career = w.career;
	const planet = normalPlanet(w);
	Game.seizePlanet(w.market, w.galaxy, planet, 100);
	const covered = Game.coveredPlanets(career);
	assert.ok(covered >= 2, 'the seized planet is not covered: ' + covered);
	career.padCount = career.planetCount - covered;
	assert.strictEqual(Game.checkEnded(career), Game.CAREER_COMPLETE);
	/* quelling lifts the rebellion but not the commercial rail */
	Game.pacifyPlanet(w.market, planet, 200);
	assert.strictEqual(w.market.rebel[planet], 0);
	assert.strictEqual(w.market.seized[planet], 1);
	assert.ok(w.market.corruption[planet] <= Econ.PACIFY_CORRUPTION_MAX);
	assert.strictEqual(Game.planetBuildable(career, planet), false);
	assert.strictEqual(Game.padOwner(career, planet), Game.OWNER_COMMERCIAL);
	assert.ok(Game.coveredPlanets(career) >= 2);
	assert.ok(w.market.rebelCooldownStep[planet] > 0, 'no rebellion cooldown after a quelling');
});

/* --- §5 the medical quest ---------------------------------------------- */

function medicSetup(seed) {
	const w = setup(seed);
	const career = w.career;
	const planet = normalPlanet(w);
	Game.seizePlanet(w.market, w.galaxy, planet, 100);
	career.at = career.capitalPlanet;
	career.ship.hold = require(path.join(root, 'orbit_tech.js')).HOLDS[1];
	career.ship.cargoTons = 0;
	Game.refreshBoard(career, w.trade, 120);
	return { w, career, planet, task: career.tasks[Game.MEDIC_SLOT] };
}

check('the medical quest takes half a hold of medics and quells the planet after two trips', () => {
	const { w, career, planet, task } = medicSetup(47);
	assert.strictEqual(task.kind, Game.TASK_MEDIC);
	assert.strictEqual(task.to, planet);
	assert.strictEqual(task.from, career.capitalPlanet);
	assert.strictEqual(task.medics, Math.floor(career.ship.hold.capacity / 2));
	assert.ok(task.reward > 0);
	assert.ok(Game.canAccept(career, Game.MEDIC_SLOT));
	assert.ok(Game.acceptTask(career, Game.MEDIC_SLOT));
	assert.strictEqual(career.ship.cargoTons, task.medics, 'the medics did not board');
	const purse = career.ledger.purse;
	/* trip out: medics off, patients on */
	Game.settleMedic(career, task, planet, 150);
	assert.strictEqual(task.aboard, task.medics);
	assert.strictEqual(career.ship.cargoTons, task.medics);
	/* the patients are still on the planet until they land at the Capital */
	assert.strictEqual(w.market.patients[planet], Econ.MEDIC_PATIENTS);
	/* trip home: patients off, paid, medics reloaded for the rest */
	assert.strictEqual(Econ.MEDIC_PATIENTS - task.medics, 4);
	Game.settleMedic(career, task, career.capitalPlanet, 200);
	assert.strictEqual(career.ship.cargoTons, task.medics, 'the next load of medics');
	assert.ok(Math.abs(career.ledger.purse - purse -
		task.medics * Econ.MEDIC_REWARD_PER_PATIENT) < 1e-9);
	assert.strictEqual(career.patientsDelivered, task.medics);
	assert.strictEqual(w.market.patients[planet], Econ.MEDIC_PATIENTS - task.medics);
	assert.strictEqual(w.market.rebel[planet], 1, 'the planet was quelled after one trip');
	/* the second trip empties the planet and ends the quest */
	Game.settleMedic(career, task, planet, 250);
	Game.settleMedic(career, task, career.capitalPlanet, 300);
	assert.strictEqual(w.market.patients[planet], 0);
	assert.strictEqual(w.market.rebel[planet], 0, 'the planet was not quelled');
	assert.strictEqual(career.contract, -1);
	assert.strictEqual(career.ship.cargoTons, 0);
	assert.strictEqual(career.patientsDelivered, Econ.MEDIC_PATIENTS);
});

check('a big hold quells the planet in one trip and every exit clears the cargo', () => {
	const { w, career, planet, task } = medicSetup(53);
	career.ship.hold = require(path.join(root, 'orbit_tech.js')).HOLDS[2];
	career.ship.cargoTons = 0;
	career.contract = -1;
	Game.refreshBoard(career, w.trade, 130);
	const big = career.tasks[Game.MEDIC_SLOT];
	assert.ok(Game.acceptTask(career, Game.MEDIC_SLOT), 'big hold refused');
	Game.settleMedic(career, big, planet, 200);
	assert.strictEqual(big.aboard, Econ.MEDIC_PATIENTS);
	Game.settleMedic(career, big, career.capitalPlanet, 250);
	assert.strictEqual(w.market.rebel[planet], 0);
	assert.strictEqual(career.contract, -1);
	assert.strictEqual(career.ship.cargoTons, 0);
	/* dropping and arresting clear the cargo of a running mission */
	Game.seizePlanet(w.market, w.galaxy, planet, 400);
	career.at = career.capitalPlanet;
	career.contract = -1;
	Game.refreshBoard(career, w.trade, 410);
	const again = career.tasks[Game.MEDIC_SLOT];
	assert.strictEqual(again.kind, Game.TASK_MEDIC);
	assert.ok(Game.acceptTask(career, Game.MEDIC_SLOT));
	Game.settleMedic(career, again, planet, 430);
	assert.ok(career.ship.cargoTons > 0);
	Game.dropContract(career);
	assert.strictEqual(career.ship.cargoTons, 0);
	assert.strictEqual(again.aboard, 0);
});

check('a medical offer needs the Capital, a free contract and live patients', () => {
	const { w, career, planet } = medicSetup(59);
	assert.strictEqual(Game.canAccept(career, Game.MEDIC_SLOT), true);
	career.at = planet;
	assert.strictEqual(Game.canAccept(career, Game.MEDIC_SLOT), false, 'accepted away from the Capital');
	career.at = career.capitalPlanet;
	career.contract = 0;
	career.tasks[0].kind = Game.TASK_COMPETE;
	assert.strictEqual(Game.canAccept(career, Game.MEDIC_SLOT), false, 'two contracts at once');
	career.contract = -1;
	w.market.patients[planet] = 0;
	w.market.rebel[planet] = 0;
	Game.refreshBoard(career, w.trade, 500);
	assert.strictEqual(career.tasks[Game.MEDIC_SLOT].kind, Game.TASK_NONE, 'offer without patients');
});

/* --- §6 the colony side ------------------------------------------------ */

check('rot is copied into the trade colonies on the political clock', () => {
	const w = setup(61);
	const planet = normalPlanet(w);
	const colony = w.trade.seedColony(planet, w.trade.t);
	w.market.corruption[planet] = 60;
	step(w, 1000);
	assert.strictEqual(w.trade.corruption, w.market.corruption);
	w.trade.advanceTo(w.trade.t + 3);
	assert.strictEqual(colony.corruption, 60);
});

console.log('POLITICS OK · ' + checks + ' groups');
