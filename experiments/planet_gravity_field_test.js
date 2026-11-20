/* Designed-field primitives and opening-cache isolation. Run:
 * node experiments/planet_gravity_field_test.js */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const PlanetGravity = require('../planet_gravity.js');
const Game = require('../gravity_game.js');
const MapGen = require('../map_gen.js');

const seed = 42;
const original = MapGen.originalDraw(seed, 13);
const input = Array(13).fill(0.13);
PlanetGravity.arm(input, seed);
const firstTag = PlanetGravity.tagForSeed(seed);
assert.ok(firstTag);
assert.strictEqual(PlanetGravity.gravity(seed, 0), 0.15);
assert.strictEqual(PlanetGravity.gravity(seed + 1, 0), PlanetGravity.seededGravity(seed + 1, 0));
assert.strictEqual(PlanetGravity.gravity(seed, 13), PlanetGravity.seededGravity(seed, 13));
assert.deepStrictEqual(MapGen.originalDraw(seed, 13), original, 'the helper still shows the original draw');
input[0] = 3;
const exposed = PlanetGravity.armed();
exposed.values[0] = 3;
assert.strictEqual(PlanetGravity.gravity(seed, 0), 0.15, 'callers cannot mutate a cached field');
PlanetGravity.arm(Array(13).fill(0.15), seed);
assert.strictEqual(PlanetGravity.tagForSeed(seed), firstTag, 'same snapped field has the same identity');
PlanetGravity.arm(Array(12).fill(0.15), seed);
assert.notStrictEqual(PlanetGravity.tagForSeed(seed), firstTag, 'field length is part of its identity');
assert.throws(() => PlanetGravity.arm([NaN], seed), RangeError);
assert.throws(() => PlanetGravity.arm([], seed), RangeError);
assert.throws(() => PlanetGravity.arm(Array(OrbitWorld.PLANETS + 1).fill(0), seed), RangeError);
assert.strictEqual(PlanetGravity.armed().values.length, 12, 'a failed arm leaves the field intact');
assert.strictEqual(PlanetGravity.tagForSeed(seed + 1), '');
PlanetGravity.arm([-9, 9, -0.001], -1);
assert.deepStrictEqual(PlanetGravity.armed().values, [-1, 3.5, 0]);
assert.strictEqual(PlanetGravity.gravity(0xffffffff, 1), 3.5, 'seeds use unsigned identity');
PlanetGravity.disarm();
assert.strictEqual(PlanetGravity.armed(), null);
assert.deepStrictEqual(Array.from({ length: 13 }, (_, p) => PlanetGravity.gravity(seed, p)), original);

/* Three deliberately different remembered plans on the same world prove both
 * insertion and lookup keys distinguish seed, field A and field B. */
const trade = new OrbitSim(seed);
const mask = new Uint8Array(OrbitWorld.PLANETS);
mask.fill(1, 0, 13);
const galaxy = Game.createGalaxy();
function remember(homes) {
	Game.rememberSeatPlan(galaxy, trade.world, trade, mask, 13, 3, null, homes, 10);
}
function lookup() {
	return Game.prepareCareerStarts(Game.createGalaxy(), trade.world, trade, mask, 13, 3, null);
}
remember([0, 1, 2]);
PlanetGravity.arm(Array(13).fill(0.15), seed);
remember([3, 4, 5]);
PlanetGravity.arm(Array(13).fill(1.5), seed);
remember([6, 7, 8]);
assert.deepStrictEqual(lookup(), [6, 7, 8]);
PlanetGravity.arm(Array(13).fill(0.15), seed);
assert.deepStrictEqual(lookup(), [3, 4, 5]);
PlanetGravity.disarm();
assert.deepStrictEqual(lookup(), [0, 1, 2]);

/* Opening tables are cached separately from the seat plans. */
const smallMask = new Uint8Array(OrbitWorld.PLANETS);
smallMask.fill(1, 0, 4);
const seededTable = Game.careerOpenings(trade.world, trade, smallMask, 4, null, null);
PlanetGravity.arm(Array(4).fill(3.5), seed);
const fieldTable = Game.careerOpenings(trade.world, trade, smallMask, 4, null, null);
assert.notStrictEqual(fieldTable, seededTable, 'an armed field must not reuse the seed opening table');
assert.strictEqual(Game.careerOpenings(trade.world, trade, smallMask, 4, null, null), fieldTable);
PlanetGravity.disarm();
assert.strictEqual(Game.careerOpenings(trade.world, trade, smallMask, 4, null, null), seededTable);

function track() {
	Game.openingPrepare(trade.world, trade, smallMask, 4, null, null);
	return Game.openingTracks(trade.world, smallMask, null, 0, 2, 2, false);
}
const seededTrack = track();
PlanetGravity.arm(Array(4).fill(3.5), seed);
const fieldTrack = track();
assert.notStrictEqual(fieldTrack, seededTrack, 'a field must not reuse a seed trace');
assert.strictEqual(track(), fieldTrack);
PlanetGravity.disarm();
assert.strictEqual(track(), seededTrack);
console.log('planet gravity field: override, seeded draw and opening caches OK');
