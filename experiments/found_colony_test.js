/* Focused founding, kit capacity, empty-world sim/snapshot, GUI and bot invariants (0.7.44). */
'use strict';
const assert = require('assert');
const World = require('../orbit_world.js');
const Tech = require('../orbit_tech.js');
const Sim = require('../orbit_sim.js');
const PlanetGravity = require('../planet_gravity.js');
const SavedMap = require('../saved_map.js');
const Game = require('../gravity_game.js');
const GravitySim = require('../gravity_sim.js');
const { loadPage, mapSearch } = require('./dom_stub.js');

/* 1. Kit capacity, hold lock, no-rail pad, and seedColony rollback */
{
	const market = Game.createMarket();
	const career = Game.createCareer(Game.createLedger(100));
	career.market = market;
	career.hq = career.at = 0;
	career.ship.hold = Tech.HOLDS[2];
	const target = 15;
	market.empty[target] = market.heavy[target] = 1;
	career.ship.cargoTons = 13;
	assert.ok(Game.kitRefusal(career));
	career.ship.cargoTons = 0;
	career.contract = 0;
	assert.ok(Game.kitRefusal(career));
	career.contract = -1;
	const dryMass = Tech.shipMass(career.ship, 0);
	assert.ok(Game.buyColonyKit(career));
	assert.strictEqual(career.ship.mass, dryMass + Tech.COLONY_KIT.mass);
	assert.ok(Game.partRefusal(career, Tech.KIND_HOLD, Tech.HOLDS[1]));
	assert.strictEqual(Game.foundColony(career, { seedColony() { return {}; } }), false);
	assert.strictEqual(career.ship.colonyKit, true);
	career.at = target;
	Game.setCommercial(career, target);
	assert.strictEqual(Game.padOwner(career, target), Game.OWNER_EMPTY);
	assert.strictEqual(Game.claimOwner(career, target), Game.OWNER_EMPTY);
	assert.strictEqual(Game.padAt(career, target).catapult, null);
	assert.strictEqual(Game.planetProfit(market, target, 100), 0);
	assert.strictEqual(Game.foundColony(career, { seedColony() { return null; } }), false);
	assert.strictEqual(career.ship.colonyKit, true);
	market.permanentCorruption = true;
	assert.ok(Game.foundColony(career, { seedColony(p) { assert.strictEqual(p, target); return {}; } }, 250));
	assert.strictEqual(career.ship.colonyKit, false);
	assert.strictEqual(career.ship.mass, dryMass);
	assert.strictEqual(market.empty[target], 0);
	assert.strictEqual(market.heavy[target], 1);
	assert.strictEqual(market.lastVisitStep[target], 250);
	assert.strictEqual(market.reportStep[target], 250);
	assert.strictEqual(market.reportPrev[target], 250);
	assert.ok(market.corruptionFloor[target] > 0, 'permanent corruption seeds tradition floor on founding');
	assert.strictEqual(Game.padOwner(career, target), Game.OWNER_COMMERCIAL);
	assert.ok(Game.padAt(career, target).catapult);
	assert.strictEqual(Game.foundColony(career, { seedColony() { return {}; } }, 260), false);
}

/* 2. Empty-world counts across 8..48, specials skip, and designed-field bypass */
{
	for (const [n, want] of [[8, 1], [16, 3], [26, 4], [48, 8]]) {
		const mask = new Uint8Array(World.PLANETS);
		mask.fill(1, 0, n);
		const opening = Game.createMarket();
		const world = new Sim(7).world;
		assert.strictEqual(Game.deriveEmptyWorlds(opening, mask, n, world), want);
		assert.strictEqual(opening.empty.reduce((a, b) => a + b, 0), want);
		assert.strictEqual(opening.empty[world.capitalPlanet], 0);
		assert.strictEqual(opening.empty[world.arfPlanet], 0);
		assert.strictEqual(opening.politicsSeed, 7);
	}
	const mask48 = new Uint8Array(World.PLANETS).fill(1);
	const m48 = Game.createMarket();
	Game.deriveEmptyWorlds(m48, mask48, 48, new Sim(3).world);
	assert.ok(m48.empty.subarray(26, 48).reduce((a, b) => a + b, 0) > 0,
		'48-world universe derives empty heavy worlds beyond index 25');

	PlanetGravity.arm([1, 1, 1, 1, 1, 1, 1, 1], 99);
	try {
		const mask8 = new Uint8Array(World.PLANETS);
		mask8.fill(1, 0, 8);
		const designed = Game.createMarket();
		assert.strictEqual(Game.deriveEmptyWorlds(designed, mask8, 8, { seed: 99, capitalPlanet: 1, arfPlanet: 2 }), 0);
		assert.strictEqual(designed.heavy.reduce((a, b) => a + b, 0), 0);
	} finally {
		PlanetGravity.disarm();
	}
}

/* The colony band preserves medium-to-heavy variety over many seeds. */
{
	const bins = [0, 0, 0];
	const heavyPerMap = [0, 0, 0, 0];
	for (let seed = 1; seed <= 1000; seed++) {
		let heavy = 0;
		for (let p = 13; p < 16; p++) {
			const g = PlanetGravity.emptyGravity(seed, p);
			assert.ok(g >= 1.5 && g <= 5);
			assert.strictEqual(g, PlanetGravity.emptyGravity(seed, p));
			assert.ok(Math.abs(g * 20 - Math.round(g * 20)) < 1e-9);
			bins[g < 2 ? 0 : g < 3.5 ? 1 : 2]++;
			if (g >= 2) heavy++;
		}
		heavyPerMap[heavy]++;
	}
	assert.ok(bins[0] > 300 && bins[0] < 550, 'moderate worlds remain a minority');
	assert.ok(bins[1] > 1100 && bins[1] < 1500, 'mid-heavy wells are common');
	assert.ok(bins[2] > 1100 && bins[2] < 1500, 'deep wells are common');
	assert.ok(heavyPerMap[2] + heavyPerMap[3] > 900, 'most maps have at least two heavy targets');
}

/* Founding changes settlement, not gravity, in opening probes and their caches. */
{
	const trade = new Sim(5);
	const mask = new Uint8Array(World.PLANETS);
	mask.fill(1, 0, 16);
	const market = Game.createMarket();
	Game.deriveEmptyWorlds(market, mask, 16, trade.world);
	trade.setPlanetMask(mask);
	trade.setEmptyMask(market.empty, market.heavy);
	const target = market.empty.findIndex(v => v === 1);
	assert.notStrictEqual(PlanetGravity.gravity(5, target), PlanetGravity.emptyGravity(5, target));
	market.empty[target] = 0;
	const expected = PlanetGravity.emptyGravity(5, target);
	const originalSetField = GravitySim.prototype.setField;
	let fields = [];
	GravitySim.prototype.setField = function (count, radii, strengths, ...rest) {
		fields.push(Array.from(strengths));
		return originalSetField.call(this, count, radii, strengths, ...rest);
	};
	try {
		const normal = new Uint8Array(market.empty);
		Game.startComposition(trade.world, mask, 16, 3, null, 'planet', market.empty, normal);
		fields = [];
		Game.startComposition(trade.world, mask, 16, 3, null, 'planet', market.empty, market.heavy);
		assert.ok(fields.length && fields[0][target] === expected, 'composition cache uses founded gravity');

		trade.colonyGravityMask = normal;
		Game.openingPrepare(trade.world, trade, mask, 16, null, null);
		const before = Game.openingTracks(trade.world, mask, null, 0, 1, 1, false);
		trade.colonyGravityMask = market.heavy;
		Game.openingPrepare(trade.world, trade, mask, 16, null, null);
		fields = [];
		const after = Game.openingTracks(trade.world, mask, null, 0, 1, 1, false);
		assert.notStrictEqual(after, before, 'trace cache distinguishes the gravity mask');
		assert.ok(fields.some(field => field[target] === expected), 'opening probes use founded gravity');
	} finally {
		GravitySim.prototype.setField = originalSetField;
	}
}

/* 3. Live OrbitSim emptyMask + seedColony + SavedMap round-trip */
{
	const mask = new Uint8Array(World.PLANETS);
	mask.fill(1, 0, 16);
	const sim = new Sim(11);
	const market = Game.createMarket();
	Game.deriveEmptyWorlds(market, mask, 16, sim.world);
	sim.setPlanetMask(mask);
	sim.setEmptyMask(market.empty, market.heavy);
	sim.step(420);
	for (let p = 0; p < 16; p++) {
		if (market.empty[p]) {
			assert.strictEqual(sim.planetInPlay(p), false);
			assert.strictEqual(sim.planetPort[p], 255);
			assert.ok(!sim.colonies.some(c => c.planet === p));
		}
	}
	const emptyPlanet = market.empty.findIndex(v => v === 1);
	const col = sim.seedColony(emptyPlanet);
	assert.ok(col && col.planet === emptyPlanet, 'seedColony creates live colony on empty planet');
	market.empty[emptyPlanet] = 0;
	sim.setEmptyMask(market.empty, market.heavy);
	sim.step(60);
	assert.strictEqual(sim.planetInPlay(emptyPlanet), true);
	assert.notStrictEqual(sim.planetPort[emptyPlanet], 255, 'seeded colony joins port roster');
}

/* 4. Page boot gravity, GUI buyColonyKit + foundColony, and bot colonization */
{
	const page = loadPage({ search: mapSearch(1) });
	const { GravityScene: scene, GravityGame: G, OrbitTech: T } = page.context;
	const career = scene.career;
	const market = scene.game.market;
	const emptyPlanet = market.empty.findIndex((v, idx) => v === 1 && scene.sim.planetActive(idx));
	assert.ok(emptyPlanet >= 0, '16-world career map boots with uninhabited worlds');
	assert.strictEqual(
		scene.sim.strength[emptyPlanet],
		PlanetGravity.emptyGravity(scene.game.seed, emptyPlanet),
		'first page boot assigns emptyGravity to uninhabited heavy worlds'
	);

	/* Human GUI action flow: fit HOLD-24, buy kit at HQ, relocate to empty world, found colony */
	career.ledger.purse = 200;
	assert.ok(page.context.careerAct({ act: 'part', kind: 'hold', tier: 2 }));
	assert.ok(page.context.careerAct({ act: 'buyColonyKit' }));
	assert.strictEqual(career.ship.colonyKit, true);
	assert.match(page.context.predProfitText({}, { destEmpty: true, foundExits: true, net: 0 }),
		/can found colony/, 'preview does not imply that founding is automatic');
	assert.match(page.context.predProfitText({}, { destEmpty: true, foundExits: false }),
		/after founding · exit blocked/);
	G.placeShip(career, scene.sim, emptyPlanet);
	scene.game.clockSteps = 1234;
	assert.ok(page.context.careerAct({ act: 'foundColony' }));
	assert.strictEqual(career.ship.colonyKit, false);
	assert.strictEqual(market.empty[emptyPlanet], 0);
	assert.strictEqual(market.heavy[emptyPlanet], 1);
	assert.strictEqual(market.lastVisitStep[emptyPlanet], 1234);
	assert.strictEqual(
		scene.sim.strength[emptyPlanet],
		PlanetGravity.emptyGravity(scene.game.seed, emptyPlanet),
		'founded colony retains its heavy gravity draw'
	);

	/* Snapshot round-trip preserves remaining emptyMask in tradeSim */
	const save = SavedMap.runRecord(page.context.mapRunInfo());
	const page2 = loadPage({ search: mapSearch(1) });
	SavedMap.arm(save);
	assert.ok(page2.context.applyRunRecord(save));
	assert.strictEqual(page2.context.GravityScene.game.market.empty[emptyPlanet], 0);
	assert.strictEqual(page2.context.GravityScene.game.market.heavy[emptyPlanet], 1);
	assert.strictEqual(page2.context.mapRunInfo().trade.colonyGravityMask, page2.context.GravityScene.game.market.heavy);
	assert.strictEqual(page2.context.GravityScene.sim.strength[emptyPlanet], PlanetGravity.emptyGravity(scene.game.seed, emptyPlanet));
	assert.strictEqual(page2.context.mapRunInfo().trade.planetInPlay(emptyPlanet), true);

	/* Bot endgame colonization: buys kit at HQ when settled worlds are built, founds on arrival */
	const nextEmpty = market.empty.findIndex((v, idx) => v === 1 && scene.sim.planetActive(idx));
	assert.ok(nextEmpty >= 0);
	for (let p = 0; p < World.PLANETS; p++) {
		if (!scene.sim.planetActive(p) || market.empty[p] || !G.planetBuildable(career, p)) continue;
		career.pads[p].catapult = T.CATAPULTS[2];
		career.pads[p].battery = T.BATTERIES[2];
		career.pads[p].panel = T.PANELS[2];
		career.pads[p].chargeKwh = career.pads[p].battery.capacity;
	}
	G.refreshNetwork(career.galaxy);
	G.placeShip(career, scene.sim, career.hq);
	career.ship.fuelTons = career.ship.tank.capacity;
	career.ledger.purse = 500;
	scene.bot.careerBetweenFlights(career, scene.sim, 2000);
	assert.strictEqual(career.ship.colonyKit, true, 'endgame bot buys colonization kit at HQ');
	G.placeShip(career, scene.sim, nextEmpty);
	scene.bot.careerBetweenFlights(career, scene.sim, 2100);
	assert.strictEqual(career.ship.colonyKit, false, 'bot founds colony on uninhabited world');
	assert.strictEqual(market.empty[nextEmpty], 0);
}

console.log('found_colony_test: kit, sim, snapshot, GUI and bot founding invariants passed');
