/*
 * Composition rule (0.7.47 WS2): minimal planet count, light/heavy class probes,
 * specials toggle, and weakened space/capital start gates.
 * Run: node experiments/start_composition_test.js
 */
'use strict';

const assert = require('assert');
const World = require('../orbit_world.js');
const Trade = require('../orbit_sim.js');
const Sim = require('../gravity_sim.js');
const Game = require('../gravity_game.js');

function makeField(seed, count, gs, fs) {
	const mask = new Uint8Array(World.PLANETS);
	mask.fill(1, 0, count);
	const trade = new Trade(seed);
	const sim = new Sim(World.WORLD_W, World.WORLD_H);
	sim.setPlanets(World.PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.setScales(gs === undefined ? 1 : gs, fs === undefined ? 1 : fs);
	return { world: trade.world, mask, sim };
}

/* Seed 5 at 16 planets (13 settled + 3 uninhabited) passes planet start for 3
 * and 4 companies, fails 5 and 6 on settled count. */
{
	const f = makeField(5, 16);
	const s3 = Game.startComposition(f.world, f.mask, 16, 3, f.sim, 'planet');
	assert.strictEqual(s3.ok, true);
	assert.strictEqual(s3.settled, 13);
	assert.strictEqual(s3.empty, 3);
	assert.strictEqual(s3.minimal, 10);
	assert.strictEqual(s3.additional, 3);
	assert.deepStrictEqual(s3.missing, []);
	assert.ok(s3.light >= 3 && s3.heavyEmc2 >= 1 && s3.heavyEmc3 >= 1 && s3.heavies >= 2);

	const s4 = Game.startComposition(f.world, f.mask, 16, 4, f.sim);
	assert.strictEqual(s4.ok, true);
	assert.strictEqual(s4.minimal, 12);
	assert.strictEqual(s4.additional, 1);

	const s5 = Game.startComposition(f.world, f.mask, 16, 5, f.sim, 'planet');
	assert.strictEqual(s5.ok, false);
	assert.strictEqual(s5.minimal, 14);
	assert.strictEqual(s5.additional, 0);
	assert.ok(s5.missing.includes('planets'));

	const s6 = Game.startComposition(f.world, f.mask, 16, 6, f.sim, 'planet');
	assert.strictEqual(s6.ok, false);
	assert.strictEqual(s6.minimal, 16);
	assert.ok(s6.missing.includes('planets'));

	/* Weakened space and capital starts drop the HQ term and the count gate. */
	const sp5 = Game.startComposition(f.world, f.mask, 16, 5, f.sim, 'space');
	assert.strictEqual(sp5.ok, true);
	assert.strictEqual(sp5.minimal, 9);
	assert.strictEqual(sp5.additional, 4);
	assert.deepStrictEqual(sp5.missing, []);

	const cap6 = Game.startComposition(f.world, f.mask, 16, 6, f.sim, 'capital');
	assert.strictEqual(cap6.ok, true);
	assert.strictEqual(cap6.minimal, 10);
	assert.deepStrictEqual(cap6.missing, []);

	/* Light gate still applies in space/capital starts when players > light worlds. */
	const tooMany = Game.startComposition(f.world, f.mask, 16, s3.light + 1, f.sim, 'space');
	assert.strictEqual(tooMany.ok, false);
	assert.ok(tooMany.missing.includes('light'));
	assert.ok(!tooMany.missing.includes('planets'));

	/* Founding an empty world lifts settled count and unlocks the 5-company gate. */
	const founded = new Uint8Array(World.PLANETS);
	founded[14] = 1;
	founded[15] = 1;
	const afterFound = Game.startComposition(f.world, f.mask, 16, 5, f.sim, 'planet', founded);
	assert.strictEqual(afterFound.settled, 14);
	assert.strictEqual(afterFound.empty, 2);
	assert.ok(!afterFound.missing.includes('planets'));
}

/* Rosters 10/3..10/6 (8 settled + 2 empty) fail the minimal planet line for planet starts. */
{
	const f10 = makeField(8, 10);
	for (let players = 3; players <= 6; players++) {
		const res = Game.startComposition(f10.world, f10.mask, 10, players, f10.sim, 'planet');
		assert.strictEqual(res.ok, false);
		assert.ok(res.missing.includes('planets'), '10/' + players + ' must flag planets');
	}
	const space3 = Game.startComposition(f10.world, f10.mask, 10, 3, f10.sim, 'space');
	assert.ok(!space3.missing.includes('planets'));
}

/* Missing heavy tiers: seed 7 at 16 misses emc2; seed 9 at 16 misses emc3. */
{
	const f7 = makeField(7, 16);
	const r7 = Game.startComposition(f7.world, f7.mask, 16, 3, f7.sim, 'planet');
	assert.strictEqual(r7.ok, false);
	assert.ok(r7.missing.includes('emc2'));

	const f9 = makeField(9, 16);
	const r9 = Game.startComposition(f9.world, f9.mask, 16, 3, f9.sim, 'planet');
	assert.strictEqual(r9.ok, false);
	assert.ok(r9.missing.includes('emc3'));
}

/* Masking out a special planet flags 'specials' until specialPlanets is turned off. */
{
	const f = makeField(1, 16);
	f.mask[f.world.capitalPlanet] = 0;
	const withSpecials = Game.startComposition(f.world, f.mask, 15, 3, f.sim, 'planet');
	assert.strictEqual(withSpecials.ok, false);
	assert.ok(withSpecials.missing.includes('specials'));

	Game.setSpecialPlanets(false);
	try {
		const withoutSpecials = Game.startComposition(f.world, f.mask, 15, 3, f.sim, 'planet');
		assert.strictEqual(withoutSpecials.minimal, 8);
		assert.ok(!withoutSpecials.missing.includes('specials'));
	} finally {
		Game.setSpecialPlanets(true);
	}
}

/* Scale changes invalidate the field memo rather than returning stale counts. */
{
	const base = makeField(2, 16, 1, 1);
	const crushed = makeField(2, 16, 4, 0.4);
	const a = Game.startComposition(base.world, base.mask, 16, 3, base.sim, 'planet');
	const b = Game.startComposition(crushed.world, crushed.mask, 16, 3, crushed.sim, 'planet');
	assert.ok(b.light < a.light, 'heavier/weaker scales must reduce light planets');
}

console.log('START COMPOSITION OK');
