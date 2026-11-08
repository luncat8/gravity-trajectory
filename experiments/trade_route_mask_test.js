/*
 * A narrower career universe must not leave background ships following route
 * coordinates that were solved for a retired (now invisible) destination.
 *
 * Run: node experiments/trade_route_mask_test.js
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');

const mask = new Uint8Array(OrbitWorld.PLANETS);
mask.fill(1, 0, 13);
let retiredFlights = 0;

for (let seed = 1; seed <= 20; seed++) {
	const sim = new OrbitSim(seed);
	sim.advanceTo(420);
	for (let ship = 0; ship < sim.shipCount; ship++) {
		if (sim.shipState[ship] !== 1) continue;
		const target = sim.shipTarget[ship];
		if (!mask[sim.portPlanet[target]]) retiredFlights += 1;
	}

	sim.setPlanetMask(mask);
	for (let port = 0; port < sim.portCount; port++) {
		assert.ok(mask[sim.portPlanet[port]], 'seed ' + seed + ': hidden trade port');
		if (sim.builderActive[port]) {
			assert.ok(mask[sim.builderTarget[port]], 'seed ' + seed + ': hidden builder target');
		}
	}
	for (let ship = 0; ship < sim.shipCount; ship++) {
		const home = sim.shipHome[ship];
		assert.ok(mask[sim.portPlanet[home]], 'seed ' + seed + ': hidden ship home');
		if (sim.shipState[ship] !== 1) continue;
		const target = sim.shipTarget[ship];
		assert.ok(mask[sim.portPlanet[target]], 'seed ' + seed + ': hidden route target');
		const error = Math.hypot(
			sim.shipAimX[ship] - sim.portX(target, sim.shipArrive[ship]),
			sim.shipAimY[ship] - sim.portY(target, sim.shipArrive[ship])
		);
		assert.ok(error < 1e-6, 'seed ' + seed + ': route kept a retired aim point');
	}

	/* A cancelled stale ARRIVE event must not wake up later and register its old
	 * aim against the ship's new home. */
	const aimError = sim.maxAimError;
	sim.advanceTo(440);
	assert.ok(sim.maxAimError - aimError < 1e-5,
		'seed ' + seed + ': stale arrival changed aim error');
	for (let port = 0; port < sim.portCount; port++) {
		assert.ok(mask[sim.portPlanet[port]],
			'seed ' + seed + ': cancelled builder recreated a hidden port');
	}
}

assert.ok(retiredFlights > 0, 'fixture did not retire an in-flight route');
console.log('trade route mask reset passed · ' + retiredFlights + ' in-flight routes retired cleanly');
