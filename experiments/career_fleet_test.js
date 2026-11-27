/*
 * Experimental fleet (0.7.45): buy automatic ships that share the company.
 * Buy gates, the context swap, the shared purse/property/science, wear ×2,
 * concurrent ships with one pad charge, ten ships, founding and prediction
 * under fleet automation (0.7.44 §5 hand-off), and the page wiring.
 * Run: node experiments/career_fleet_test.js
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
const { loadPage, mapSearch } = require('./dom_stub.js');

const PLANETS = OrbitWorld.PLANETS;
const DT = GravitySim.DT;
const FIELD_RATE = 1;
const EPS = 1e-9;
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

/* the headless career world the benches use, plus the galaxy every page
 * career lives in (the fleet controller's turret queue reads its periods) */
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
	sim.fieldRate = FIELD_RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	const ledger = GravityGame.createLedger();
	const career = GravityGame.createCareer(ledger);
	const market = GravityGame.createMarket();
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, GravityGame.BOT_OFF);
	GravityGame.startCareer(career, sim, seed, trade, null, galaxy);
	GravityGame.resetMarket(market);
	/* emptyWorld/foundColony read the career's own market ref, like the page */
	career.market = market;
	return { seed, trade, sim, career, ledger, market, galaxy, bot, step: 0 };
}

function stepWorld(w, steps) {
	for (let i = 0; i < steps; i++) {
		const flying = w.sim.status === GravitySim.STATUS_FLYING &&
			w.sim.liveSteps < w.sim.stepLimit;
		GravityGame.careerAdvance(w.career, 1, flying);
		if (flying) w.sim.stepOne();
		w.bot.stepCareer(w.step, w.market, w.trade, FIELD_RATE);
		w.bot.stepFleet(w.step, w.market, w.trade, FIELD_RATE);
		w.step += 1;
		w.trade.advanceTo(w.trade.t + DT);
		w.sim.fieldT = w.trade.t;
		assert.strictEqual(w.career.fleetShip, null, 'fleetShip left set after stepFleet');
	}
}

/* fund the company past the starter grant without touching the money identity */
function fund(w, cr) {
	w.ledger.purse += cr;
}

/* 1. buy gates and the purchase itself */
check('buy: gates and price', () => {
	const w = makeWorld(42);
	const career = w.career;
	/* off by default, and every refusal names itself */
	assert.strictEqual(career.fleetUnlocked, false);
	assert.strictEqual(GravityGame.fleetBuyRefusal(career, w.sim),
		'enable allow automatic ships in experimental');
	fund(w, 40);
	career.fleetUnlocked = true;
	const planetsBefore = career.planetCount;
	assert.strictEqual(GravityGame.fleetBuyRefusal(career, w.sim), '');
	/* 29 cr refuses */
	w.ledger.purse = 29;
	assert.strictEqual(GravityGame.fleetBuyRefusal(career, w.sim), 'purse too small');
	assert.strictEqual(GravityGame.buyFleetShip(career, w.trade, w.sim, 10), null);
	/* away from HQ refuses */
	w.ledger.purse = 40;
	GravityGame.placeShip(career, w.sim, (career.hq + 1) % career.planetCount);
	assert.ok(GravityGame.fleetBuyRefusal(career, w.sim).indexOf('HQ') >= 0);
	assert.strictEqual(GravityGame.buyFleetShip(career, w.trade, w.sim, 10), null);
	/* a flagship in flight refuses */
	GravityGame.placeShip(career, w.sim, career.hq);
	w.sim.launch(career.hq, 0.5, 40);
	GravityGame.careerBeginFlight(career, w.sim, 20);
	assert.strictEqual(GravityGame.fleetBuyRefusal(career, w.sim), 'land the flagship first');
	assert.strictEqual(GravityGame.buyFleetShip(career, w.trade, w.sim, 20), null);
	GravityGame.careerEndFlight(career, w.sim, w.trade, 30);
	GravityGame.placeShip(career, w.sim, career.hq);
	/* the purchase itself */
	const before = career.ledger.purse;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 40);
	assert.ok(f, 'buy refused at HQ with the box on');
	assert.strictEqual(career.ledger.purse, before - 30);
	assert.strictEqual(career.fleet.length, 1);
	assert.strictEqual(career.fleetSpent, 30);
	assert.strictEqual(f.id, 1);
	assert.strictEqual(f.at, career.hq);
	assert.strictEqual(f.wearScale, 2);
	assert.strictEqual(f.career, career);
	assert.strictEqual(f.tasks, career.fleetTasks);
	assert.ok(f.readyStep > 40, 'the new ship staggers its first launch');
	/* the §3 fit: the flagship's current fit, empty hold, full condition */
	assert.strictEqual(f.ship.hold, career.ship.hold);
	assert.strictEqual(f.ship.engine, career.ship.engine);
	assert.strictEqual(f.ship.tank, career.ship.tank);
	assert.strictEqual(f.ship.fuelKg, 0);
	assert.strictEqual(f.ship.cargoTons, 0);
	assert.strictEqual(f.ship.condition, 1);
	assert.strictEqual(f.ship.colonyKit, false, 'the kit is per-ship');
	/* a later refit of one ship does not mutate the other's fitted device */
	assert.notStrictEqual(f.ship.obs, career.ship.obs);
	career.ship.obs.fitted = false;
	assert.strictEqual(f.ship.obs.fitted, true);
	career.ship.obs.fitted = true;
	/* the launch gate reads the fleet ship's own fit */
	assert.strictEqual(f.sim.ship, f.ship);
	assert.strictEqual(f.sim.pads, career.launchPads);
	assert.strictEqual(f.sim.landedBody, career.hq);
	/* no planet, no slot (§6.5): the active-world count is untouched */
	assert.strictEqual(career.planetCount, planetsBefore);
	assert.strictEqual(w.galaxy.actors.length, 1);
	assert.strictEqual(career.padCount, 1, 'a buy builds no pad');
	assert.strictEqual(GravityGame.FLEET_GAP, GravityBot.CAREER_RIVAL_GAP,
		'the fleet gap mirrors the rival gap');
});

/* 2. the context swap: record identity and a clean restore */
check('swap: records are reused and the flagship context is restored', () => {
	const w = makeWorld(42);
	const career = w.career;
	const ledger = w.ledger;
	fund(w, 200);
	career.fleetUnlocked = true;
	const f1 = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	const f2 = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	assert.strictEqual(career.fleet.length, 2);
	assert.strictEqual(career.fleetSeq, 2);
	const contextBase = career.contextBase;
	const inside = ledger.inside;
	const flagshipShip = career.ship;
	const wearScale = career.wearScale;
	const stepLimit = Math.round(600 / DT);
	for (let i = 0; i < stepLimit; i++) stepWorld(w, 1);
	assert.strictEqual(career.fleet[0], f1, 'a step must not re-allocate records');
	assert.strictEqual(career.fleet[1], f2);
	assert.strictEqual(career.contextBase, contextBase, 'the save slot is reused');
	assert.ok(career.at >= -1 && career.at < career.planetCount, 'the flagship context is coherent');
	assert.strictEqual(career.ship, flagshipShip, 'the flagship ship object comes back');
	assert.strictEqual(career.wearScale, wearScale);
	assert.strictEqual(ledger.inside, inside, 'the flagship visit mask comes back');
	assert.strictEqual(career.fleetShip, null);
	/* the ledger flight block rides the swap: the ships each own one */
	assert.notStrictEqual(f1.flight.inside, f2.flight.inside);
	assert.notStrictEqual(f1.flight.inside, contextBase.inside);
	/* fleet stepping leaves the flagship landed untouched: no fees, no wear */
	if (!career.flying) {
		assert.strictEqual(career.ship.condition, 1);
	}
});

/* 3. one purse: visits pay in, repairs pay out */
check('purse: fleet flights pay into the one ledger, repairs out of it', () => {
	const w = makeWorld(42);
	const career = w.career;
	const ledger = w.ledger;
	fund(w, 200);
	career.fleetUnlocked = true;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	assert.strictEqual(f.sim.ship, f.ship);
	/* fly until the fleet ship completes a landing, then read the shared purse */
	let landed = false;
	const stepLimit = Math.round(600 / DT);
	for (let i = 0; i < stepLimit && !landed; i++) {
		stepWorld(w, 1);
		landed = f.flightStartStep > 0 && !f.flying && f.readyStep > w.step;
	}
	assert.ok(landed, 'the fleet ship flew and landed');
	assert.ok(career.visitIncome > 0, 'the visit pay reached the company total');
	assert.strictEqual(career.ledger, ledger, 'one ledger');
	/* a fleet repair pays the shared purse the same 2 cr scale — through the
	 * same swap the controller uses (careerBetweenFlights routes on
	 * career.fleetShip, so the shop call must ride a load) */
	f.ship.condition = 0.5;
	const purse = ledger.purse;
	GravityGame.saveCareerContext(career, career.contextBase);
	GravityGame.loadCareerContext(career, f);
	const action = w.bot.careerBetweenFlights(career, f.sim, w.step);
	GravityGame.storeCareerContext(career, f);
	GravityGame.restoreCareerContext(career, career.contextBase);
	assert.notStrictEqual(action, 0, 'the reduced shop serviced the ship');
	assert.ok(ledger.purse < purse, 'the shop paid out of the shared purse');
	assert.strictEqual(f.ship.condition, 1, 'the fleet ship left repaired');
});

/* 4. shared property: own rails, owned gear, no research replay */
check('property: the fleet ship lifts on the flagship pad free of fees', () => {
	const w = makeWorld(7);
	const career = w.career;
	const ledger = w.ledger;
	fund(w, 200);
	/* the flagship builds a second rail away from HQ: gear ownership is shared */
	const site = (career.hq + 3) % career.planetCount;
	const rail = OrbitTech.CATAPULTS[0];
	const built = GravityGame.buildGear(career, site, OrbitTech.KIND_CATAPULT, rail);
	assert.ok(built, 'the flagship built a pad');
	const buildSpent = career.buildSpent;
	career.fleetUnlocked = true;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	/* the buy itself charges no research and re-uses owned gear */
	assert.strictEqual(career.research, 0);
	assert.strictEqual(career.buildSpent, buildSpent, 'the buy builds nothing');
	assert.ok(career.owned[career.ship.hold.id], 'holds stay owned property');
	/* park the fleet ship on the own rail and fly from it: no usage fee */
	GravityGame.placeShip(career, f.sim, site);
	/* placeShip works on the flagship context; mirror the record */
	f.at = site;
	const feesBefore = career.feesPaid;
	const plan = w.bot.careerNextShot(f, w.market, w.trade, 100);
	assert.ok(plan, 'the fleet ship plans from the built pad');
	assert.strictEqual(plan.origin, site);
	w.bot.careerLaunch(f, w.market, w.trade, FIELD_RATE, 100);
	/* fire the queue */
	for (let i = 0; i < GravityBot.CAREER_RIVAL_GAP * 4 && !f.flying; i++) {
		w.bot.stepFleet(w.step + i, w.market, w.trade, FIELD_RATE);
	}
	assert.ok(f.flying, 'the fleet ship launched');
	assert.strictEqual(career.feesPaid, feesBefore,
		'a guest on the own rail pays no usage fee');
	/* and it wears its own ship record, not the flagship's */
	assert.ok(f.ship.condition < 1, 'the fleet ship took launch wear');
	assert.strictEqual(career.ship.condition, 1, 'the flagship did not');
});

/* 5. wear ×2 and repair price */
check('wear: a fleet ship wears twice as fast on the same flight', () => {
	const w = makeWorld(42);
	const career = w.career;
	fund(w, 200);
	career.fleetUnlocked = true;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	/* two identical 30 s flights, wearScale 2 then 1 */
	GravityGame.loadCareerContext(career, f);
	const steps = Math.round(30 / DT);
	career.flying = true;
	GravityGame.careerAdvanceShip(career, steps, true);
	const fast = 1 - career.ship.condition;
	career.wearScale = 1;
	career.ship.condition = 1;
	GravityGame.careerAdvanceShip(career, steps, true);
	const slow = 1 - career.ship.condition;
	GravityGame.restoreCareerContext(career, career.contextBase);
	assert.ok(fast > 0);
	assert.ok(Math.abs(fast / slow - 2) < 1e-9, 'the wear ratio is exactly 2');
	/* the repair price reads the same 2 cr per whole condition scale */
	assert.strictEqual(career.maintenanceSpent, 0);
	GravityGame.loadCareerContext(career, f);
	const cost = GravityGame.repairCost(career);
	GravityGame.restoreCareerContext(career, career.contextBase);
	assert.ok(cost > 0 && cost < 2.1, 'the fleet repair prices like a flagship repair');
});

/* 6. concurrent ships, one pad clock */
check('concurrent: two ships fly on their own sims; pads charge once', () => {
	const w = makeWorld(42);
	const career = w.career;
	fund(w, 500);
	career.fleetUnlocked = true;
	w.bot.attachFleet(career, w.trade);
	GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	/* a no-fleet twin: same seed, pads only — the pad clock may not tick
	 * once per fleet ship */
	const twin = makeWorld(42);
	const chargeTrace = [];
	const twinTrace = [];
	const sampleEvery = Math.round(30 / DT);
	const stepLimit = Math.round(240 / DT);
	/* keep every ship landed for the pad-clock comparison */
	for (const f of career.fleet) f.readyStep = w.step + stepLimit * 2;
	for (let i = 0; i < stepLimit; i++) {
		stepWorld(w, 1);
		GravityGame.careerAdvance(twin.career, 1, false);
		if (i % sampleEvery === 0) {
			chargeTrace.push(Math.round(career.pads[career.hq].chargeKwh * 1e6) / 1e6);
			twinTrace.push(Math.round(twin.career.pads[twin.career.hq].chargeKwh * 1e6) / 1e6);
		}
	}
	assert.deepStrictEqual(chargeTrace, twinTrace,
		'the shared pad clock advanced once per step, not per ship');
	/* now let all three fly at once and check the per-ship state */
	GravityGame.placeShip(career, w.sim, career.hq);
	w.sim.launch(career.hq, 0.3, 45);
	GravityGame.careerBeginFlight(career, w.sim, w.step);
	for (const f of career.fleet) f.readyStep = w.step;
	let sawAllThree = false;
	const stepLimit2 = Math.round(240 / DT);
	for (let i = 0; i < stepLimit2; i++) {
		stepWorld(w, 1);
		if (career.flying && career.fleet.every(f => f.flying)) sawAllThree = true;
		for (const f of career.fleet) {
			assert.notStrictEqual(f.sim, w.sim, 'each ship flies its own sim');
		}
		assert.notStrictEqual(career.fleet[0].sim, career.fleet[1].sim);
	}
	assert.ok(sawAllThree, 'flagship and fleet flew at once');
	/* each ship ends with its own condition and flight block */
	for (const f of career.fleet) {
		assert.ok(f.ship.condition >= 0 && f.ship.condition <= 1,
			'per-ship condition is tracked');
		assert.strictEqual(f.sim.ship, f.ship);
		assert.ok(Number.isFinite(f.flightStartStep), 'the ship owns its flight log');
	}
});

/* 7. unlimited: ten buys, one purse, ten flyable ships */
check('unlimited: ten buys leave ten flyable ships', () => {
	const w = makeWorld(913);
	const career = w.career;
	fund(w, 400);
	career.fleetUnlocked = true;
	w.bot.attachFleet(career, w.trade);
	for (let i = 0; i < 10; i++) {
		const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
		assert.ok(f, 'buy ' + (i + 1) + ' refused');
		w.bot.attachFleet(career, w.trade);
		assert.strictEqual(f.id, i + 1);
	}
	assert.strictEqual(career.fleet.length, 10);
	assert.strictEqual(career.fleetSpent, 300);
	assert.strictEqual(career.fleet.every(f => f.career === career), true);
	assert.strictEqual(career.fleet.every(f => f.sim.canLaunchFrom(career.hq)), true,
		'every ship stands launchable on the HQ');
	/* a long ten-ship run stays inside the step budget and keeps the
	 * pad clock single (the plan's 60 s stress, headless) */
	const runSteps = Math.round(60 / DT);
	const charge = [];
	for (let i = 0; i < runSteps; i++) {
		stepWorld(w, 1);
		if (i % Math.round(10 / DT) === 0) {
			charge.push(Math.round(career.pads[career.hq].chargeKwh * 1e6) / 1e6);
		}
	}
	let flew = 0;
	for (const f of career.fleet) if (f.flightStartStep > 0) flew += 1;
	assert.ok(flew > 0, 'the ten-ship run flew ships');
	assert.ok(charge.length > 0);
	assert.strictEqual(career.planetCount, 48);
	assert.strictEqual(career.ended, GravityGame.CAREER_OPEN,
		'a fleet never ends the company');
});

/* 8. founding under fleet automation (0.7.44 §5 hand-off) */
check('founding: the flagship founds, a fleet ship never does', () => {
	const w = makeWorld(1);
	const career = w.career;
	const market = w.market;
	fund(w, 500);
	/* force an in-play uninhabited world: the founding gate, not the map
	 * generator, is under test here */
	const empty = (career.hq + 3) % career.planetCount;
	market.empty[empty] = 1;
	career.fleetUnlocked = true;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	/* the flagship buys the kit at the HQ and keeps it: the copy flies
	 * without one (the starter hold cannot carry the 12 t kit, so refit —
	 * the same shortcut found_colony_test takes) */
	career.ship.hold = OrbitTech.HOLDS[2];
	assert.strictEqual(GravityGame.kitRefusal(career), '', GravityGame.kitRefusal(career));
	assert.ok(GravityGame.buyColonyKit(career), 'the flagship bought the kit');
	assert.strictEqual(career.ship.colonyKit, true);
	assert.strictEqual(f.ship.colonyKit, false, 'the fleet ship carries no kit');
	GravityGame.placeShip(career, w.sim, empty);
	/* a fleet ship standing on the empty world shops reduced: no kit, no
	 * founding (the reduced shop may still fuel the ship) */
	GravityGame.placeShip(career, f.sim, empty);
	f.at = empty;
	GravityGame.saveCareerContext(career, career.contextBase);
	GravityGame.loadCareerContext(career, f);
	w.bot.careerBetweenFlights(career, f.sim, 2000);
	GravityGame.storeCareerContext(career, f);
	GravityGame.restoreCareerContext(career, career.contextBase);
	assert.strictEqual(market.empty[empty], 1, 'no founding from the fleet shop');
	assert.strictEqual(f.ship.colonyKit, false);
	assert.strictEqual(career.ship.colonyKit, true, 'the kit stayed with the flagship');
	/* the flagship still founds with the fleet present */
	assert.ok(GravityGame.foundColony(career, w.trade, 2100), 'the flagship founded');
	assert.strictEqual(market.empty[empty], 0);
	assert.strictEqual(career.ship.colonyKit, false);
});

/* 9. prediction under fleet automation: the reveal and the memo are the
 * company's, and a flying fleet ship changes neither */
check('prediction: radarShips counts ships, not fleet records', () => {
	const w = makeWorld(42);
	const career = w.career;
	const rivalCareer = GravityGame.createCareer(GravityGame.createLedger());
	const rivalSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	rivalSim.setPlanets(PLANETS, w.trade.planetX, w.trade.planetY, w.trade.planetR,
		w.trade.orbitRX, w.trade.orbitRY, w.trade.orbitTiltCos, w.trade.orbitTiltSin);
	rivalSim.setField(PLANETS, w.trade.planetR,
		new Float64Array(GravitySim.MAX_BODIES).fill(1),
		w.sim.fillField, true);
	rivalSim.fieldT = w.trade.t;
	GravityGame.startCareer(rivalCareer, rivalSim, GravityGame.rivalSeed(42, 0),
		w.trade, null, w.galaxy);
	fund(w, 200);
	career.radar = true;
	const out = [];
	const read = () => GravityGame.radarShips(out, career, w.trade, w.sim);
	assert.strictEqual(read(), 2, 'the reveal reads the company and the rival');
	const stampKey = career.radarStamp.steps;
	career.fleetUnlocked = true;
	const f = GravityGame.buyFleetShip(career, w.trade, w.sim, 0);
	w.bot.attachFleet(career, w.trade);
	/* fly the fleet ship and re-read: same count, memo untouched */
	let flew = false;
	for (let i = 0; i < Math.round(120 / DT) && !flew; i++) {
		stepWorld(w, 1);
		flew = f.flying;
	}
	assert.ok(flew, 'the fleet ship is airborne');
	assert.strictEqual(read(), 2, 'a fleet ship is not a reveal target');
	assert.strictEqual(career.radarStamp.steps, stampKey,
		'the reveal memo is the flagship facility\u2019s');
	/* career.sim stays the flagship's, so every predictor reads the right sim */
	assert.strictEqual(career.sim, w.sim);
});

/* 10. no-HQ starts stay blocked (§7) */
check('starts: space and Capital companies cannot buy until an HQ exists', () => {
	const w = makeWorld(42);
	const career = w.career;
	const space = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(space, null, PLANETS);
	GravityGame.startCareer(space, w.sim, 42, w.trade, null, w.galaxy,
		undefined, GravityGame.START_SPACE, false);
	assert.strictEqual(space.hq, -1, 'a space start has no HQ yet');
	career.fleetUnlocked = false;
	space.fleetUnlocked = true;
	assert.ok(GravityGame.fleetBuyRefusal(space, w.sim).indexOf('HQ') >= 0,
		'the space start names the missing HQ');
	assert.strictEqual(GravityGame.buyFleetShip(space, w.trade, w.sim, 0), null);
	const capital = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.startCareer(capital, w.sim, 42, w.trade, null, w.galaxy,
		undefined, GravityGame.START_CAPITAL, false);
	assert.strictEqual(capital.hq, -1, 'a Capital start has no HQ yet');
	capital.fleetUnlocked = true;
	assert.ok(GravityGame.fleetBuyRefusal(capital, w.sim).indexOf('HQ') >= 0);
	/* once the company settles an HQ, the same gate opens */
	space.ledger.purse = 100;
	space.hq = space.at = career.hq;
	assert.strictEqual(GravityGame.fleetBuyRefusal(space, w.sim), '',
		'the gate is the HQ, not the start mode');
});

/* 11. the page: checkbox, drawer, score rows, and a live buy */
check('page: the checkbox, drawer block, fleet row and buy action', () => {
	const page = loadPage({ search: mapSearch(1) });
	const scene = page.context.GravityScene;
	const career = scene.career;
	const box = page.elements.get('expFleet');
	const fleetRows = page.elements.get('scoreFleetRows');
	const drawer = page.elements.get('careerFleet');
	/* off by default, dark outside career is the refresh's job */
	assert.strictEqual(box.checked, false);
	assert.strictEqual(box.disabled, false);
	/* the drawer names the fleet and refuses with the box off */
	page.context.refreshCareerPanel();
	assert.match(drawer.textContent, /fleet 0 · 30 cr each · wear ×2/);
	assert.match(drawer.textContent, /enable allow automatic ships in experimental/);
	/* the buy action refuses */
	const purse = career.ledger.purse + 40;
	career.ledger.purse = purse;
	page.context.careerAct({ act: 'buyShip' });
	assert.strictEqual(scene.fleetCount(), 0, 'no ship with the box off');
	/* turn the box on and buy */
	box.checked = true;
	box.listeners.change.forEach(fn => fn());
	assert.strictEqual(career.fleetUnlocked, true, 'the box mirrors into the career');
	page.context.refreshCareerPanel();
	page.context.careerAct({ act: 'buyShip' });
	assert.strictEqual(scene.fleetCount(), 1, 'one buy');
	assert.strictEqual(career.ledger.purse, purse - 30);
	assert.strictEqual(career.fleetSpent, 30);
	assert.strictEqual(fleetRows.hidden, false);
	assert.strictEqual(fleetRows.children.length, 1);
	const row = fleetRows.children[0];
	assert.strictEqual(row._fleetNodes.name.textContent, 'YOU · ship 1');
	assert.match(row._fleetNodes.meta.textContent, /P\d+ · cond 100 % · ready/);
	assert.strictEqual(row._fleetNodes.name.parentElement, row);
	/* the drawer shows the fleet and the buy button */
	assert.match(drawer.textContent, /fleet 1 · 30 cr each · wear ×2/);
	assert.match(drawer.textContent, /buy ship · 30/);
	/* turning the box off parks new buys only */
	box.checked = false;
	box.listeners.change.forEach(fn => fn());
	assert.strictEqual(career.fleetUnlocked, false);
	assert.strictEqual(scene.fleetCount(), 1, 'bought ships keep flying');
	page.context.refreshCareerPanel();
	assert.match(drawer.textContent, /enable allow automatic ships in experimental/);
	/* the score-row count is unchanged */
	assert.strictEqual(page.elements.has('rivalScoreName1'), true);
	page.context.careerAct({ act: 'buyShip' });
	assert.strictEqual(scene.fleetCount(), 1, 'buying refuses with the box off');
	/* fleet stepping through the page loop, and the row follows the ship */
	const trade = require('vm').runInContext('tradeSim', page.context);
	const market = scene.game.market;
	for (let i = 0; i < Math.round(240 / DT); i++) {
		const flying = scene.sim.status === GravitySim.STATUS_FLYING &&
			scene.sim.liveSteps < scene.sim.stepLimit;
		GravityGame.careerAdvance(career, 1, flying);
		if (flying) scene.sim.stepOne();
		scene.bot.stepCareer(i, market, trade, 1);
		scene.bot.stepFleet(i, market, trade, 1);
		trade.advanceTo(trade.t + DT);
		scene.sim.fieldT = trade.t;
	}
	assert.strictEqual(career.fleetShip, null);
	assert.ok(career.fleet[0].flightStartStep > 0, 'the bought ship flew');
	page.context.refreshGameUi();
	assert.match(row._fleetNodes.meta.textContent, /cond \d+ % · (flying|ready)/,
		'the row follows the ship');
	/* a full-save round trip keeps the fleet */
	const SavedMap = require(path.join(root, 'saved_map.js'));
	const record = SavedMap.runRecord(page.context.mapRunInfo());
	const page2 = loadPage({ search: mapSearch(1) });
	SavedMap.arm(record);
	assert.ok(page2.context.applyRunRecord(record), 'the record restores');
	const scene2 = page2.context.GravityScene;
	assert.strictEqual(scene2.fleetCount(), 1, 'the fleet survives the save');
	assert.strictEqual(scene2.fleet()[0].id, career.fleet[0].id);
	assert.strictEqual(scene2.fleet()[0].ship.condition, career.fleet[0].ship.condition);
});

assert.strictEqual(failures, 0, failures + ' failing checks');
console.log('career_fleet_test OK');
