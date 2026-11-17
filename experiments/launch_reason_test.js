/* Structured launch reasons: one ordered source for the launch list and H. */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));

const PLANETS = World.PLANETS;
const UNIVERSE = 13;
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);

function setup(seed) {
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
	Game.startCareer(career, sim, seed, trade, null, galaxy);
	return { career, sim };
}

function ids(reasons) { return reasons.map(reason => reason.id); }

const w = setup(43);
const career = w.career;
const sim = w.sim;
const planet = career.at;
const speed = GravitySim.SPEED_MIN;
sim.canLaunchFrom = () => true;
sim.speedLimit = () => 100;

assert.strictEqual(Game.launchReason(career, sim, planet, speed, false), null);
assert.deepStrictEqual(Game.launchReasons(career, sim, planet, speed, false), []);
assert.strictEqual(Game.launchBlock(career, sim, planet, speed, false), '');

career.ship.condition = 0;
career.ledger.purse = -1;
assert.deepStrictEqual(ids(Game.launchReasons(career, sim, planet, 120, false)),
	['worn', 'cap', 'fee']);
assert.strictEqual(Game.launchReason(career, sim, planet, 120, false).id, 'worn');
assert.strictEqual(Game.formatLaunchReason(Game.launchReason(career, sim, planet, 120, false)),
	Game.WORN_OUT_BLOCK);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false), Game.WORN_OUT_BLOCK);

sim.canLaunchFrom = () => false;
assert.deepStrictEqual(ids(Game.launchReasons(career, sim, planet, 120, false)),
	['worn', 'no-rail']);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false), Game.WORN_OUT_BLOCK);

career.at = -1;
assert.deepStrictEqual(ids(Game.launchReasons(career, sim, planet, 120, false)), ['space', 'worn']);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false), 'ship in space');

career.at = planet + 1;
assert.deepStrictEqual(ids(Game.launchReasons(career, sim, planet, 120, false)),
	['wrong-planet', 'worn']);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false),
	'shot leaves from P' + planet);

career.at = planet;
career.arrested = true;
assert.deepStrictEqual(ids(Game.launchReasons(career, sim, planet, 120, false)),
	['arrest', 'worn', 'no-rail']);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false),
	'under arrest · Capital transport');

career.arrested = false;
career.at = planet;
career.ship.condition = 1;
sim.canLaunchFrom = () => true;
const cap = sim.speedLimit(planet);
assert.ok(cap === 100);
career.ledger.purse = -1;
const reasons = Game.launchReasons(career, sim, planet, 120, false);
assert.deepStrictEqual(ids(reasons), ['cap', 'fee']);
assert.strictEqual(Game.launchBlock(career, sim, planet, 120, false),
	'cap 100 < 120 px/s');
assert.strictEqual(Game.formatLaunchReason(reasons[1]),
	'fee ' + reasons[1].need.toFixed(2) + ' > purse -1.00');

career.ship.condition = 0.5;
const repaired = Game.launchReasons(career, sim, planet, 100, true);
assert.deepStrictEqual(ids(repaired), ['fee']);
assert.strictEqual(repaired[0].repair, true);
assert.strictEqual(Game.formatLaunchReason(repaired[0]).startsWith('repair + fee '), true);

console.log('LAUNCH REASONS OK');
