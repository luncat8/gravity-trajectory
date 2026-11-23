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

/* Seed 1 at 13 planets passes planet start for 3 and 4 companies, fails 5 and 6 on count. */
{
	const f = makeField(1, 13);
	const s3 = Game.startComposition(f.world, f.mask, 13, 3, f.sim, 'planet');
	assert.strictEqual(s3.ok, true);
	assert.strictEqual(s3.minimal, 10);
	assert.strictEqual(s3.additional, 3);
	assert.deepStrictEqual(s3.missing, []);
	assert.ok(s3.light >= 3 && s3.heavyEmc2 >= 1 && s3.heavyEmc3 >= 1 && s3.heavies >= 2);

	const s4 = Game.startComposition(f.world, f.mask, 13, 4, f.sim);
	assert.strictEqual(s4.ok, true);
	assert.strictEqual(s4.minimal, 12);
	assert.strictEqual(s4.additional, 1);

	const s5 = Game.startComposition(f.world, f.mask, 13, 5, f.sim, 'planet');
	assert.strictEqual(s5.ok, false);
	assert.strictEqual(s5.minimal, 14);
	assert.strictEqual(s5.additional, 0);
	assert.ok(s5.missing.includes('planets'));

	const s6 = Game.startComposition(f.world, f.mask, 13, 6, f.sim, 'planet');
	assert.strictEqual(s6.ok, false);
	assert.strictEqual(s6.minimal, 16);
	assert.ok(s6.missing.includes('planets'));

	/* Weakened space and capital starts drop the HQ term and the count gate. */
	const sp5 = Game.startComposition(f.world, f.mask, 13, 5, f.sim, 'space');
	assert.strictEqual(sp5.ok, true);
	assert.strictEqual(sp5.minimal, 9);
	assert.strictEqual(sp5.additional, 4);
	assert.deepStrictEqual(sp5.missing, []);

	const cap6 = Game.startComposition(f.world, f.mask, 13, 6, f.sim, 'capital');
	assert.strictEqual(cap6.ok, true);
	assert.strictEqual(cap6.minimal, 10);
	assert.deepStrictEqual(cap6.missing, []);

	/* Light gate still applies in space/capital starts when players > light worlds. */
	const tooMany = Game.startComposition(f.world, f.mask, 13, s3.light + 1, f.sim, 'space');
	assert.strictEqual(tooMany.ok, false);
	assert.ok(tooMany.missing.includes('light'));
	assert.ok(!tooMany.missing.includes('planets'));
}

/* Rosters 8/3..8/6 fail the minimal planet line for planet starts. */
{
	const f8 = makeField(8, 8);
	for (let players = 3; players <= 6; players++) {
		const res = Game.startComposition(f8.world, f8.mask, 8, players, f8.sim, 'planet');
		assert.strictEqual(res.ok, false);
		assert.ok(res.missing.includes('planets'), '8/' + players + ' must flag planets');
	}
	const space3 = Game.startComposition(f8.world, f8.mask, 8, 3, f8.sim, 'space');
	assert.ok(!space3.missing.includes('planets'));
}

/* Missing heavy tiers: seed 7 at 13 misses emc2; seed 9 at 13 misses emc3. */
{
	const f7 = makeField(7, 13);
	const r7 = Game.startComposition(f7.world, f7.mask, 13, 3, f7.sim, 'planet');
	assert.strictEqual(r7.ok, false);
	assert.ok(r7.missing.includes('emc2'));

	const f9 = makeField(9, 13);
	const r9 = Game.startComposition(f9.world, f9.mask, 13, 3, f9.sim, 'planet');
	assert.strictEqual(r9.ok, false);
	assert.ok(r9.missing.includes('emc3'));
}

/* Masking out a special planet flags 'specials' until specialPlanets is turned off. */
{
	const f = makeField(1, 13);
	f.mask[f.world.capitalPlanet] = 0;
	const withSpecials = Game.startComposition(f.world, f.mask, 12, 3, f.sim, 'planet');
	assert.strictEqual(withSpecials.ok, false);
	assert.ok(withSpecials.missing.includes('specials'));

	Game.setSpecialPlanets(false);
	try {
		const withoutSpecials = Game.startComposition(f.world, f.mask, 12, 3, f.sim, 'planet');
		assert.strictEqual(withoutSpecials.minimal, 8);
		assert.ok(!withoutSpecials.missing.includes('specials'));
	} finally {
		Game.setSpecialPlanets(true);
	}
}

/* Scale changes invalidate the field memo rather than returning stale counts. */
{
	const base = makeField(2, 13, 1, 1);
	const crushed = makeField(2, 13, 4, 0.4);
	const a = Game.startComposition(base.world, base.mask, 13, 3, base.sim, 'planet');
	const b = Game.startComposition(crushed.world, crushed.mask, 13, 3, crushed.sim, 'planet');
	assert.ok(b.light < a.light, 'heavier/weaker scales must reduce light planets');
}

console.log('START COMPOSITION OK');
