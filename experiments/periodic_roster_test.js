/* Step 3 roster foundation: capacity, classic prefix and irregular toroidal placement. */
'use strict';

const assert = require('assert');
const World = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityFFT = require('../gravity_fft.js');
const Game = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');

assert.strictEqual(World.PLANETS, 192);
assert.strictEqual(World.CLASSIC_PLANETS, 48);
assert.strictEqual(World.DEFAULT_PLANETS, 26);
assert.strictEqual(World.PERIODIC_DEFAULT_PLANETS, 104);
assert.strictEqual(World.CLASSIC_CAREER_PLANETS, 16);
assert.strictEqual(World.PERIODIC_CAREER_PLANETS, 64);
assert.strictEqual(GravitySim.MAX_BODIES, 192);
for (const seed of [1, 7, 42]) {
	const classic = World.create(seed, World.seedRandom(seed));
	assert.strictEqual(classic.planetCount, 48);
	for (let i = 48; i < 192; i++) {
		assert.strictEqual(classic.planetX[i], 0);
		assert.strictEqual(classic.planetY[i], 0);
	}
	const world = World.create(seed, World.seedRandom(seed), { periodic: true });
	const repeat = World.create(seed, World.seedRandom(seed), { periodic: true });
	assert.deepStrictEqual(world.planetX, repeat.planetX);
	assert.deepStrictEqual(world.planetY, repeat.planetY);
	assert.strictEqual(world.planetCount, 192);
	for (let i = 0; i < 192; i++) {
		const x = world.planetX[i], y = world.planetY[i];
		assert.ok(x >= 0 && x < World.WORLD_W && y >= 0 && y < World.WORLD_H);
		assert.ok(world.orbitRX[i] <= 78 && world.orbitRY[i] <= 78);
	}
}
/* Check actual distribution rather than pinning the grid/order that caused
 * the columns. Each prefix must be spaced, including across both seams. */
for (const seed of [...Array.from({ length: 100 }, (_, i) => i + 1), 0, 0xffffffff]) {
	const world = World.create(seed, World.seedRandom(seed), { periodic: true });
	for (const n of [4, 16, 26, 64, 104, 192]) {
		const cols = new Set(), rows = new Set();
		let aligned = 0;
		for (let i = 0; i < n; i++) {
			cols.add(Math.floor(world.planetX[i] / 100));
			rows.add(Math.floor(world.planetY[i] / (World.WORLD_H / 12)));
			let nearest = Infinity, nearestDX = 0, nearestDY = 0;
			for (let j = 0; j < n; j++) {
				if (i === j) continue;
				const rawX = Math.abs(world.planetX[i] - world.planetX[j]);
				const rawY = Math.abs(world.planetY[i] - world.planetY[j]);
				const dx = Math.min(rawX, World.WORLD_W - rawX);
				const dy = Math.min(rawY, World.WORLD_H - rawY);
				const gap = Math.hypot(dx, dy);
				if (gap >= nearest) continue;
				nearest = gap;
				nearestDX = dx;
				nearestDY = dy;
			}
			assert.ok(nearest >= 0.6 * Math.sqrt(World.WORLD_W * World.WORLD_H / n),
				'spaced prefix: seed ' + seed + ', n ' + n + ', gap ' + nearest);
			if (nearestDX < 3 || nearestDY < 3) aligned++;
		}
		if (n < 64) continue;
		assert.ok(cols.size >= 14 && rows.size >= 11, 'prefix covers both axes');
		assert.ok(aligned / n < 0.2, 'nearest neighbours must not form rows/columns');
	}
}
assert.notDeepStrictEqual(
	World.create(1, World.seedRandom(1), { periodic: true }).planetX,
	World.create(2, World.seedRandom(2), { periodic: true }).planetX,
	'different seeds change the layout, not just subpixel grid jitter');

const trade = new OrbitSim(7, { periodic: true });
assert.strictEqual(trade.tradePlanetLimit, 104);
assert.strictEqual(trade.areaPadX(), 0);
assert.strictEqual(trade.areaPadY(), 0);
assert.strictEqual(trade.areaW(), World.WORLD_W);
assert.strictEqual(trade.areaH(), World.WORLD_H);
const firstX = Array.from(trade.planetX);
trade.reset(7);
assert.strictEqual(trade.world.periodic, true);
assert.strictEqual(trade.tradePlanetLimit, 104);
assert.deepStrictEqual(Array.from(trade.planetX), firstX);

/* Exercise the real opening part without publishing its private key API. */
const inner = { OrbitWorld: World, createMarket: () => ({}) };
require('../game_opening.js')({}, inner);
const key = inner.openingMaskBits;
assert.notStrictEqual(key(null), key(new Uint8Array(192)));
const seen = new Set();
for (const i of [0, 32, 53, 63, 64, 128, 191]) {
	const mask = new Uint8Array(192);
	mask[i] = 1;
	seen.add(key(mask));
}
assert.strictEqual(seen.size, 7);

/* 192-bit launchMask and topology-aware launchBookTag */
assert.notStrictEqual(Game.launchMask([0], 1), Game.launchMask([53], 1));
assert.notStrictEqual(Game.launchMask([64], 1), Game.launchMask([191], 1));
assert.notStrictEqual(Game.launchMask([0, 191], 2), Game.launchMask([1, 191], 2));
assert.strictEqual(typeof Game.launchMask([0, 47], 2), 'number');
assert.strictEqual(typeof Game.launchMask([0, 191], 2), 'string');
const tagStrength = new Float64Array(192).fill(1);
assert.notStrictEqual(
	Game.launchBookTag(true, 1, 1, tagStrength, 64, false, 1600, 1000),
	Game.launchBookTag(true, 1, 1, tagStrength, 64, true, 1600, 1000));
assert.notStrictEqual(
	Game.launchBookTag(true, 1, 1, tagStrength, 64, true, 1600, 1000),
	Game.launchBookTag(true, 1, 1, tagStrength, 64, true, 3200, 1000));

/* 3-digit shot origins, 3-digit visit counts, and &fft=1 link rules */
const encodedPeriodic = Game.encodeLink({
	seed: 42, rate: 1, rule: 'tour', periodic: true,
	shots: [Game.createShot(Game.SRC_PLANETS, 100, 120, Game.speedUnits(100), Game.NO_ABORT, []),
		Game.createShot(Game.SRC_PLANETS, 191, 240, Game.speedUnits(120), Game.NO_ABORT, [])],
	visited: 104, steps: 9876
});
assert.ok(encodedPeriodic.includes('&fft=1'), 'periodic link emits &fft=1');
const decodedPeriodic = Game.decodeLink('#' + encodedPeriodic);
assert.ok(decodedPeriodic && decodedPeriodic.periodic === true);
assert.strictEqual(decodedPeriodic.shots[0].origin, 100);
assert.strictEqual(decodedPeriodic.shots[1].origin, 191);
assert.strictEqual(decodedPeriodic.end.visited, 104);
assert.strictEqual(Game.decodeLink('#game=1&seed=42&rate=1&shots=p100.3c.b4&end=104.9876'), null,
	'3-digit planet origin rejected without &fft=1');
assert.strictEqual(Game.decodeLink('#game=1&seed=42&rate=1&rule=route&fft=1'), null,
	'route + &fft=1 rejected');

/* Periodic opening, composition, seat search and bot snapshot sharing */
const pTrade = new OrbitSim(19, { periodic: true });
const pMask64 = new Uint8Array(192);
pMask64.fill(1, 0, 64);
pTrade.setPlanetMask(pMask64);
pTrade.setPlanetLimit(64);
pTrade.advanceTo(420);
const pSim = new GravitySim(World.WORLD_W, World.WORLD_H);
pSim.setPeriodic(true);
pSim.setPlanets(192, pTrade.planetX, pTrade.planetY, pTrade.planetR,
	pTrade.orbitRX, pTrade.orbitRY, pTrade.orbitTiltCos, pTrade.orbitTiltSin);
pSim.setPlanetMask(pMask64);
const pStrength = new Float64Array(192);
for (let i = 0; i < 64; i++) pStrength[i] = Game.planetGravity(19, i);
const pFill = (t, ox, oy, n) => {
	for (let i = 0; i < n; i++) { ox[i] = pTrade.planetX[i]; oy[i] = pTrade.planetY[i]; }
};
pSim.setField(64, pTrade.planetR, pStrength, pFill, true);

const comp = Game.startComposition(pTrade.world, pMask64, 64, 3, pSim);
assert.ok(comp && comp.settled > 0 && comp.empty > 0, 'periodic 64-world composition runs');
const cMask64 = new Uint8Array(192);
cMask64.fill(1, 0, 48);
const cTrade = new OrbitSim(19);
cTrade.setPlanetMask(cMask64);
cTrade.advanceTo(420);
const rowsPeriodic = Game.careerOpenings(pTrade.world, pTrade, pMask64, 64, null, pSim);
assert.ok(rowsPeriodic.light instanceof Int16Array && rowsPeriodic.reach instanceof Int16Array &&
	rowsPeriodic.buildable instanceof Int16Array, 'opening counts use Int16Array for 192 worlds');
assert.ok(Number.isFinite(rowsPeriodic.best) && rowsPeriodic.best > 0);

const galaxy = Game.createGalaxy();
Game.resetGalaxy(galaxy, 19);
const market = Game.createMarket();
Game.resetMarket(market);
Game.applyMarketUniverse(market, pMask64, 64);
Game.applyMarketSpecials(market, pTrade.world);
Game.deriveEmptyWorlds(market, pMask64, 64, pTrade.world);
Game.bindRun(market, galaxy, pTrade.world);
const seats = Game.prepareCareerStarts(galaxy, pTrade.world, pTrade, pMask64, 64, 3, pSim);
assert.ok(seats && seats.length === 3 && new Set(seats).size === 3, 'periodic 64-world seats 3 HQs');
for (const hq of seats) pStrength[hq] = 1;
pSim.invalidateField();

const playerCareer = Game.createCareer(Game.createLedger());
Game.setCareerUniverse(playerCareer, pMask64, 64);
Game.startCareer(playerCareer, pSim, 19, pTrade, null, galaxy, seats[0]);
pSim.attachCareer(playerCareer);

const bot = new GravityBot(World.WORLD_W, World.WORLD_H);
bot.setPeriodic(true, pSim);
bot.attachWorld(pTrade);
bot.setPlanetMask(pMask64, 64);
bot.strength.set(pStrength);
bot.invalidateField();
bot.reset(19, Game.RULE_CAREER, Game.BOT_NORMAL, Game.PLAYER_USER, null, 2);
bot.startCareers(galaxy, 19, pTrade);

playerCareer.ledger.purse += 100;
const fleetRec = Game.buyFleetShip(playerCareer, pTrade, pSim, 0);
assert.ok(fleetRec && fleetRec.sim.periodic, 'fleet ship inherits periodic topology');
bot.attachFleet(playerCareer, pTrade);

const solvesBefore = GravityFFT.solves;
const acc = { ax: 0, ay: 0 };
pSim.fieldAt(250, 250, acc);
bot.probe.fieldAt(250, 250, acc);
bot.prepareCareerExitProbe(pSim);
bot.exitProbe.fieldAt(250, 250, acc);
bot.rivals[0].sim.fieldAt(250, 250, acc);
bot.rivals[1].sim.fieldAt(250, 250, acc);
fleetRec.sim.fieldAt(250, 250, acc);
assert.strictEqual(GravityFFT.solves - solvesBefore, 1,
	'live, bot probe, exitProbe, rivals and fleet share one FFT solve');
const rootSnap = pSim.periodicGrid();
assert.strictEqual(bot.probe.periodicGrid(), rootSnap);
assert.strictEqual(bot.exitProbe.periodicGrid(), rootSnap);
assert.strictEqual(bot.rivals[0].sim.periodicGrid(), rootSnap);
assert.strictEqual(fleetRec.sim.periodicGrid(), rootSnap);

const expansion = Game.planCareerExpansion(galaxy, pTrade.world, pTrade, pMask64, 64, pSim);
assert.ok(expansion && expansion.planet >= 64 && expansion.planet < 192,
	'periodic career expansion picks an inactive planet in 64..191');
assert.strictEqual(pSim.periodicGrid(), rootSnap,
	'opening/expansion probes never mutate the live periodic snapshot');

console.log('PERIODIC ROSTER OK · 192 irregular worlds, defaults, masks, codec, opening, bot & fleet sharing');
