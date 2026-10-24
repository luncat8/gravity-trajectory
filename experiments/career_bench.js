/*
 * Career mode bench (0.4.0): knowledge hull, mass gating, solar power,
 * evacuation economics and bulk planet-gear upgrades. Deterministic, node-only.
 * Run: node experiments/career_bench.js
 */
'use strict';

var assert = require('assert');
var OrbitTech = require('../orbit_tech.js');
var OrbitScience = require('../orbit_science.js');

var failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log('ok - ' + name);
	} catch (e) {
		failures++;
		console.log('FAIL - ' + name + ': ' + e.message);
	}
}

/* --- §1 mass / energy gating ------------------------------------------ */

check('dry ship launchable by EMC-1 from BAT-1 charge', function () {
	var mass = OrbitTech.shipMass({}, 0); // 10 t dry, no battery mass now
	var e = OrbitTech.launchEnergy(mass, 'EMC-1', 100);
	assert.ok(e <= 1.5, 'energy ' + e + ' kWh > 1.5 kWh battery');
	assert.ok(OrbitTech.canLaunch(1.5, mass, 'EMC-1', 100));
});

check('24 t cargo + HOLD-24 cannot launch on EMC-1 / BAT-1', function () {
	var mass = OrbitTech.shipMass({hold: 'HOLD-24'}, 24); // 10 + 4 + 24 = 38 t
	var e = OrbitTech.launchEnergy(mass, 'EMC-1', 100);
	assert.ok(e > 1.5, 'energy ' + e + ' should exceed 1.5 kWh');
	assert.ok(!OrbitTech.canLaunch(1.5, mass, 'EMC-1', 100), 'overloaded launch must be rejected');
	assert.ok(OrbitTech.canLaunch(16.0, mass, 'EMC-5', 100), 'BAT-5 + EMC-5 should launch it');
});

check('stronger catapult / efficiency cuts energy', function () {
	var m = OrbitTech.shipMass({hold: 'HOLD-8'}, 8); // 19.5 t
	var e1 = OrbitTech.launchEnergy(m, 'EMC-1', 90);
	var e5 = OrbitTech.launchEnergy(m, 'EMC-5', 90);
	assert.ok(e5 < e1, 'EMC-5 should need less energy than EMC-1');
});

check('impulse delta-v needs engine + fuel', function () {
	var dv = OrbitTech.impulseDeltaV(10, 'IMP-2', 20);
	assert.ok(dv > 0);
	assert.ok(OrbitTech.impulseDeltaV(0, 'IMP-2', 20) === 0);
	assert.ok(OrbitTech.impulseDeltaV(10, null, 20) === 0);
});

/* --- §2 knowledge hull ------------------------------------------------ */

check('1D hull: segment, interior cheap, exterior costs k*dist', function () {
	var fam = 'test1d';
	OrbitScience.accept(fam, [0], 'zero');
	OrbitScience.accept(fam, [10], 'ten');

	var inside = OrbitScience.preview(fam, [5]);
	assert.ok(inside.inside, 'midpoint of segment must be inside');
	assert.ok(Math.abs(inside.dist) < 1e-6);

	var outside = OrbitScience.preview(fam, [20]);
	assert.ok(!outside.inside);
	assert.ok(Math.abs(outside.dist - 10) < 1e-6);
	assert.ok(outside.cost > inside.cost);

	OrbitScience.accept(fam, [20], 'twenty');
	assert.ok(OrbitScience.preview(fam, [20]).inside);
});

check('2D hull: triangle interior cheap, exterior priced by distance', function () {
	var fam = 'test2d';
	OrbitScience.accept(fam, [0, 0], 'a');
	OrbitScience.accept(fam, [10, 0], 'b');
	OrbitScience.accept(fam, [0, 10], 'c');

	assert.ok(OrbitScience.preview(fam, [3, 3]).inside, 'triangle interior cheap');

	var out = OrbitScience.preview(fam, [8, 8]);
	assert.ok(!out.inside);
	assert.ok(Math.abs(out.dist - 6 / Math.sqrt(2)) < 1e-6);
	assert.ok(out.cost > OrbitScience.preview(fam, [3, 3]).cost);
});

check('empty family: everything outside, infinite dist', function () {
	var p = OrbitScience.preview('nope', [1]);
	assert.ok(!p.inside);
	assert.ok(p.dist === Infinity);
});

/* --- §3 solar / battery ---------------------------------------------- */

check('solar charge: W*s -> kWh, dim world charges slowly', function () {
	assert.ok(Math.abs(OrbitTech.solarCharge('SP-1', 0.2, 3600) - 0.012) < 1e-9);
	assert.ok(OrbitTech.solarCharge('SP-4', 1.0, 3600) >
		OrbitTech.solarCharge('SP-1', 0.2, 3600));
});

check('battery leak decays charge over years; BAT-5 leaks least', function () {
	var c1 = OrbitTech.batteryLeak('BAT-1', 1.5, 1);
	assert.ok(c1 < 1.5 && c1 > 0);
	assert.ok(OrbitTech.batteryLeak('BAT-5', 1.5, 1) > c1);
});

/* --- §4 evacuation economics ------------------------------------------ */

check('delivery to catapult-less planet is unprofitable (evacuation fee)',
	function () {
		/* A delivery pays only if the target has a catapult strong enough to
		 * launch the loaded ship back. Without one, evacuation fee applies. */
		var mass = OrbitTech.shipMass({hold: 'HOLD-8'}, 8);
		var e1 = OrbitTech.launchEnergy(mass, 'EMC-1', 90);
		assert.ok(e1 > 1.5, 'EMC-1/BAT-1 cannot launch loaded 8 t ship');
		var e5 = OrbitTech.launchEnergy(mass, 'EMC-5', 90);
		assert.ok(e5 <= 16.0, 'EMC-5/BAT-5 can launch loaded 8 t ship');
	});

/* --- §5 bulk planet-gear upgrade -------------------------------------- */

check('bulkUpgradeCost sums cost to upgrade all built facilities', function () {
	var planets = [
		{ catapult: 'EMC-1', panel: 'SP-1', battery: 'BAT-1', chargeKwh: 1.5 },
		{ catapult: 'EMC-1', panel: 'SP-1', battery: 'BAT-1', chargeKwh: 1.5 },
		{ catapult: null, panel: null, battery: null, chargeKwh: 0 } // not built
	];
	var cost = OrbitTech.bulkUpgradeCost(planets, 'catapult', 'EMC-3');
	assert.ok(cost === 2 * 10.0, 'should cost 2 * EMC-3 build cost, got ' + cost);

	var res = OrbitTech.applyBulkUpgrade(planets, 'catapult', 'EMC-3');
	assert.ok(res.cost === cost);
	assert.ok(res.planets[0].catapult === 'EMC-3');
	assert.ok(res.planets[1].catapult === 'EMC-3');
	assert.ok(res.planets[2].catapult === null, 'not-built planet stays null');
	assert.ok(res.planets[0] !== planets[0], 'pure: does not mutate input');
});

check('bulk upgrade to same tier costs nothing', function () {
	var planets = [{ catapult: 'EMC-3', panel: 'SP-1', battery: 'BAT-1',
		chargeKwh: 1.5 }];
	assert.ok(OrbitTech.bulkUpgradeCost(planets, 'catapult', 'EMC-3') === 0);
});

/* --- §6 copy spec ----------------------------------------------------- */

check('copySpec emits parseable tech line', function () {
	var line = OrbitTech.copySpec('catapult', 'EMC-2');
	assert.ok(/^tech: CATAPULT EMC-2 \{/.test(line));
	assert.ok(line.indexOf('maxForce: 90') >= 0);
	var line2 = OrbitTech.copySpec('engine', 'IMP-2');
	assert.ok(/^tech: ENGINE IMP-2 \{/.test(line2));
	assert.ok(OrbitTech.copySpec('nope', 'x') === '');
});

/* --- starter grant ---------------------------------------------------- */

check('starter grant: weak planet gear on start planet, ship has no hold', function () {
	var g = OrbitTech.starterGrant();
	assert.ok(g.startPlanet.catapult === 'EMC-1');
	assert.ok(g.startPlanet.panel === 'SP-1' && g.startPlanet.battery === 'BAT-1');
	assert.ok(g.ship.hold === 'HOLD-0' && g.ship.engine === null);
	assert.ok(g.purse === 3.00);
});

console.log(failures === 0 ? 'CAREER BENCH OK' : 'CAREER BENCH FAILED ' + failures);
process.exit(failures === 0 ? 0 : 1);
