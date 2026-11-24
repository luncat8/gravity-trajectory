/*
 * 0.7.47 WS5 — space start and capital start (headless).
 *
 * A career may open with no HQ: every company spawns in flight near the world
 * centre (space) or landed on the Capital (capital). This test pins the
 * spawn state, the grants and purses, the Capital's free rail, the universal
 * no-HQ evacuation rule, the weakened composition gate, and the bot's
 * full-parity space opening (it lands from rest and the run continues).
 *
 * Run: node experiments/career_space_start_test.js (SEEDS=1,8)
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');

const P = OrbitWorld.PLANETS;
const START_COUNT = 13;
const SEEDS = String(process.env.SEEDS || '1,8').split(',').map(Number);

/* one armed trade world + market, shared by the modes of a seed */
function makeWorld(seed) {
	const mask = new Uint8Array(P);
	mask.fill(1, 0, START_COUNT);
	const trade = new OrbitSim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setScales(1, 1);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	sim.setField(P, trade.planetR, strength, (t, outX, outY, n) => {
		for (let i = 0; i < n; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	sim.fieldT = trade.t;
	sim.fieldRate = 1;
	sim.setPlanetMask(mask);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const market = GravityGame.createMarket();
	GravityGame.applyMarketUniverse(market, mask, START_COUNT);
	GravityGame.applyMarketSpecials(market, trade.world);
	GravityGame.bindRun(market, galaxy, trade.world);
	return { seed, mask, trade, sim, galaxy, market };
}

/* start one company in the given mode and return it with its sim */
function startOne(world, mode, index = 0) {
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, world.mask, START_COUNT);
	world.sim.attachCareer(career);
	GravityGame.startCareer(career, world.sim, world.seed, world.trade, null,
		world.galaxy, undefined, mode);
	return career;
}

for (const seed of SEEDS) {
	const world = makeWorld(seed);

	/* --- spawn state, grants and purses ----------------------------------- */
	const space = startOne(world, GravityGame.START_SPACE);
	assert.strictEqual(space.hq, -1, 'seed ' + seed + ': space start has no HQ');
	assert.strictEqual(space.at, -1, 'seed ' + seed + ': space start is in flight');
	assert.strictEqual(space.flying, true, 'seed ' + seed + ': space start is flying');
	assert.ok(space.ship.engine, 'seed ' + seed + ': space start grants an engine');
	assert.strictEqual(space.ship.engine.id, 'IMP-1',
		'seed ' + seed + ': space start grants the IMP-1 engine');
	assert.strictEqual(space.ship.tank.fuelCap, GravityGame.SPACE_START_FUEL_KG,
		'seed ' + seed + ': space start grants the full tank');
	assert.strictEqual(space.ship.fuelKg, GravityGame.SPACE_START_FUEL_KG,
		'seed ' + seed + ': space start fuels the tank');
	assert.ok(Math.abs(space.ledger.purse - (6 + GravityGame.SPACE_START_BONUS)) < 1e-9,
		'seed ' + seed + ': space start purse is grant + 15');

	const capital = startOne(world, GravityGame.START_CAPITAL);
	assert.strictEqual(capital.hq, -1, 'seed ' + seed + ': capital start has no HQ');
	assert.strictEqual(capital.at, capital.capitalPlanet,
		'seed ' + seed + ': capital start is landed on the Capital');
	assert.strictEqual(capital.flying, false, 'seed ' + seed + ': capital start is landed');
	assert.strictEqual(capital.ship.engine, null,
		'seed ' + seed + ': capital start grants no engine');
	assert.ok(Math.abs(capital.ledger.purse - (6 + GravityGame.CAPITAL_START_BONUS)) < 1e-9,
		'seed ' + seed + ': capital start purse is grant + 10');

	const planet = startOne(world, GravityGame.START_PLANET);
	assert.ok(planet.hq >= 0, 'seed ' + seed + ': planet start has an HQ');
	assert.strictEqual(planet.at, planet.hq, 'seed ' + seed + ': planet start is on its HQ');
	assert.strictEqual(planet.ship.engine, null,
		'seed ' + seed + ': planet start grants no engine');

	/* --- the universal no-HQ evacuation rule (decision 6) ----------------- */
	assert.strictEqual(GravityGame.evacTarget(space), space.capitalPlanet,
		'seed ' + seed + ': a space company evacuates to the Capital');
	assert.strictEqual(GravityGame.evacTarget(capital), capital.capitalPlanet,
		'seed ' + seed + ': a capital company evacuates to the Capital');
	assert.strictEqual(GravityGame.evacTarget(planet), planet.hq,
		'seed ' + seed + ': a planet company evacuates to its HQ');
	/* already at the target: no point ordering a tow */
	assert.strictEqual(GravityGame.canEvacuate(capital), false,
		'seed ' + seed + ': a company on the Capital cannot evacuate to it');

	/* --- space spawn is deterministic per seed + index -------------------- */
	const a = GravityGame.spaceSpawnAt(world.trade.world, world.mask, seed, 0);
	const b = GravityGame.spaceSpawnAt(world.trade.world, world.mask, seed, 0);
	const c = GravityGame.spaceSpawnAt(world.trade.world, world.mask, seed, 1);
	assert.deepStrictEqual(a, b, 'seed ' + seed + ': space spawn is deterministic');
	assert.notDeepStrictEqual(a, c, 'seed ' + seed + ': space spawn differs per company');

	/* --- the Capital's free imperial rail is a launch option ------------- */
	/* the Capital's pad is the free imperial rail, so a capital start can
	 * launch from where it stands without building a catapult */
	const capPad = GravityGame.padAt(capital, capital.capitalPlanet);
	assert.ok(capPad, 'seed ' + seed + ': the Capital has a pad');
	assert.notStrictEqual(capPad, GravityGame.COMMERCIAL_PAD,
		'seed ' + seed + ': the Capital pad is not the commercial rail');

	/* --- weakened composition gate (WS2) ---------------------------------- */
	/* a no-HQ start seats nothing, so the minimal-planet rule is weakened:
	 * the composition only needs the light sites and the heavy EMC planets */
	const compSpace = GravityGame.startComposition(world.trade.world, world.mask,
		START_COUNT, 3, world.sim, GravityGame.START_SPACE);
	const compPlanet = GravityGame.startComposition(world.trade.world, world.mask,
		START_COUNT, 3, world.sim, GravityGame.START_PLANET);
	assert.ok(compSpace.minimal <= compPlanet.minimal,
		'seed ' + seed + ': a no-HQ start needs fewer planets than a planet start');
	assert.ok(compSpace.light >= 3, 'seed ' + seed + ': the space composition counts light sites');
	/* The heavy classes still gate the weakened start. Under the 0.7.47
	 * review's corrected probes (EMC-3 positive = margin, full-power-only
	 * exits never class) seeds 1 and 8 carry an EMC-2-margin world but no
	 * EMC-3-margin world, so each fails the gate on 'emc3'. */
	assert.ok(compSpace.heavyEmc2 >= 1,
		'seed ' + seed + ': the space composition counts the EMC-2 heavy class');
	assert.ok(compSpace.missing.includes('emc3'),
		'seed ' + seed + ': the EMC-3 heavy class still gates the space start');

	/* --- the bot's full-parity space opening ------------------------------ */
	/* the space flight opens like any career flight; the bot fans the granted
	 * kit from the spawn state, picks the best landing, and the run continues */
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.reset(seed, GravityGame.RULE_CAREER, GravityGame.BOT_NORMAL,
		GravityGame.PLAYER_BOT, [GravityGame.PLAYER_BOT], 1);
	bot.attachWorld(world.trade);
	bot.setScales(1, 1);
	bot.setPlanetMask(world.mask, START_COUNT);
	const botCareer = startOne(world, GravityGame.START_SPACE);
	world.sim.attachCareer(botCareer);
	bot.attachCareerPlayer(botCareer, world.sim);
	assert.strictEqual(botCareer.flying, true, 'seed ' + seed + ': bot space start is flying');

	let landed = false;
	let steps = 0;
	for (let i = 0; i < 20000; i++) {
		bot.tickCareerPlayerFlight(0, world.market);
		const wasFlying = world.sim.status === GravitySim.STATUS_FLYING;
		const flying = world.sim.status === GravitySim.STATUS_FLYING;
		const moves = flying && world.sim.liveSteps < world.sim.stepLimit;
		GravityGame.careerAdvance(botCareer, 1, moves);
		if (wasFlying) world.sim.stepOne();
		if (!flying && botCareer.flying) {
			GravityGame.careerEndFlight(botCareer, world.sim, world.trade, 0);
		}
		steps += 1;
		if (!botCareer.flying) break;
	}
	assert.strictEqual(botCareer.flying, false,
		'seed ' + seed + ': the bot space flight ends within the cap');
	assert.ok(botCareer.at >= 0, 'seed ' + seed + ': the bot lands from the space start');
	assert.strictEqual(world.sim.endReason, GravitySim.END_IMPACT,
		'seed ' + seed + ': the bot space landing is an impact, not a loss');
	assert.ok(steps <= world.sim.stepLimit, 'seed ' + seed + ': the space flight respects the cap');
	/* after landing the normal career logic runs: the bot can build its first pad */
	assert.strictEqual(botCareer.ended, GravityGame.CAREER_OPEN,
		'seed ' + seed + ': the bot career is still open after the space landing');
}

console.log('CAREER SPACE START OK · ' + (SEEDS.length * 21) + ' checks');
