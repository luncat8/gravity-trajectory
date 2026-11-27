/* Step 3 roster foundation: capacity, classic prefix and toroidal lattice. */
'use strict';

const assert = require('assert');
const World = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');

assert.strictEqual(World.PLANETS, 192);
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
	const cells = new Set();
	for (let i = 0; i < 192; i++) {
		const x = world.planetX[i], y = world.planetY[i];
		assert.ok(x >= 0 && x < World.WORLD_W && y >= 0 && y < World.WORLD_H);
		assert.ok(world.orbitRX[i] <= 78 && world.orbitRY[i] <= 78);
		cells.add(Math.floor(x / 100) + 16 * Math.floor(y / (World.WORLD_H / 12)));
		for (let j = 0; j < i; j++) {
			const dx = Math.abs(x - world.planetX[j]);
			const dy = Math.abs(y - world.planetY[j]);
			assert.ok(Math.hypot(Math.min(dx, World.WORLD_W - dx),
				Math.min(dy, World.WORLD_H - dy)) >= 81);
		}
	}
	assert.strictEqual(cells.size, 192);
	const ordered = [];
	for (let j = 0; j < 256; j++) {
		const reversed = parseInt(j.toString(2).padStart(8, '0').split('').reverse().join(''), 2);
		if (reversed < 192) ordered.push(reversed);
	}
	for (let i = 0; i < 192; i++) {
		assert.strictEqual(Math.floor(world.planetX[i] / 100) +
			16 * Math.floor(world.planetY[i] / (World.WORLD_H / 12)), ordered[i]);
	}
	for (const n of [4, 64, 104]) {
		const cols = new Set(), rows = new Set();
		for (let i = 0; i < n; i++) {
			cols.add(Math.floor(world.planetX[i] / 100));
			rows.add(Math.floor(world.planetY[i] / (World.WORLD_H / 12)));
		}
		assert.ok(cols.size >= (n === 4 ? 1 : n === 64 ? 6 : 9));
		assert.ok(Math.min(...rows) === 0 && Math.max(...rows) >= 6);
		assert.ok(rows.size >= (n === 4 ? 3 : 12));
	}
}
const trade = new OrbitSim(7, { periodic: true });
const firstX = Array.from(trade.planetX);
trade.reset(7);
assert.strictEqual(trade.world.periodic, true);
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
console.log('PERIODIC ROSTER OK · 192 lattice, classic tail, reset, exact sparse masks');
