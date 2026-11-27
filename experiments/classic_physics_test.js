/* Fixed pre-FFT fingerprints, captured at 47c4288. No page boot or seed sweep.
 * Hash explicit little-endian doubles, not capacity-sized buffers: raising the
 * array cap must not change classic geometry, RNG consumption or arithmetic.
 * Intentional physics changes need reviewed fixtures, never auto-regeneration. */
'use strict';

const assert = require('assert');
const { createHash } = require('crypto');
const World = require('../orbit_world.js');
const PlanetGravity = require('../planet_gravity.js');
const Sim = require('../gravity_sim.js');

const CLASSIC_COUNT = 48;
const EXPECTED = {
	geometry: '79144fb79660dec1ec24423a38a3583e4c0cdacc99075249c707d0df19b851cb',
	static: '5e5c0ad2c365c2131b0ad80d9648442535bafa0c58f632304bd95ae0fdd15cda',
	moving: 'e4e2acd4e7146bc184be0663663c28348f913ff8f7c4779c070543667f57c2e8'
};

function fingerprint(values) {
	const bytes = Buffer.alloc(values.length * 8);
	for (let i = 0; i < values.length; i++) bytes.writeDoubleLE(values[i], i * 8);
	return createHash('sha256').update(bytes).digest('hex');
}

function geometry() {
	const values = [];
	const keys = ['planetX', 'planetY', 'planetR', 'orbitRX', 'orbitRY',
		'orbitPhase', 'orbitOmega', 'orbitTilt', 'orbitTiltCos', 'orbitTiltSin',
		'initialPlanets', 'planetType', 'planetMetal', 'planetLight', 'planetHabitat', 'planetKind'];
	for (const seed of [1, 7, 42]) {
		const rand = World.seedRandom(seed);
		const world = World.create(seed, rand);
		for (const key of keys) {
			for (let p = 0; p < CLASSIC_COUNT; p++) values.push(world[key][p]);
		}
		for (let p = 0; p < CLASSIC_COUNT; p++) values.push(PlanetGravity.gravity(seed, p));
		values.push(world.capitalPlanet, world.arfPlanet, world.metal, world.lum, rand.getState());
	}
	return fingerprint(values);
}

function trajectory(moving) {
	const world = World.create(1, World.seedRandom(1));
	const sim = new Sim(World.WORLD_W, World.WORLD_H);
	const strength = new Float64Array(CLASSIC_COUNT);
	for (let p = 0; p < CLASSIC_COUNT; p++) strength[p] = PlanetGravity.gravity(1, p);
	const fill = (t, x, y, count) => {
		for (let p = 0; p < count; p++) {
			const angle = world.orbitPhase[p] + world.orbitOmega[p] * t;
			const rx = moving ? world.orbitRX[p] * Math.cos(angle) : 0;
			const ry = moving ? world.orbitRY[p] * Math.sin(angle) : 0;
			x[p] = world.planetX[p] + rx * world.orbitTiltCos[p] - ry * world.orbitTiltSin[p];
			y[p] = world.planetY[p] + rx * world.orbitTiltSin[p] + ry * world.orbitTiltCos[p];
		}
	};
	sim.setPlanets(CLASSIC_COUNT, world.planetX, world.planetY, world.planetR,
		world.orbitRX, world.orbitRY, world.orbitTiltCos, world.orbitTiltSin);
	sim.setField(CLASSIC_COUNT, world.planetR, strength, fill, !moving);
	sim.setScales(0.75, 1);
	sim.spawn(sim.probe, 0, 0.73, 180, 0);
	const values = [sim.padX, sim.padY];
	const out = { ax: 0, ay: 0 };
	/* Fixed integration steps deliberately continue past collision checks. */
	for (let step = 0; step < 240; step++) {
		sim.fieldT = step * Sim.DT;
		sim.refreshField();
		sim.fillStep(sim.fieldT);
		sim.fieldAt(sim.probe.x, sim.probe.y, out);
		sim.advance(sim.probe, Sim.DT);
		values.push(out.ax, out.ay, sim.probe.x, sim.probe.y, sim.probe.vx, sim.probe.vy,
			sim.impact(sim.probe.x, sim.probe.y), Number(sim.outside(sim.probe.x, sim.probe.y)));
	}
	return fingerprint(values);
}

const actual = { geometry: geometry(), static: trajectory(false), moving: trajectory(true) };
for (const name of Object.keys(EXPECTED)) {
	assert.strictEqual(actual[name], EXPECTED[name], 'classic ' + name + ' fingerprint');
}
console.log('CLASSIC PHYSICS OK · seeded 48-body prefix, RNG, static/moving 240-step fingerprints');
