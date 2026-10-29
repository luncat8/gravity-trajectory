/*
 * Build-cost probe: every gear and part record, its spec, the research work it
 * took from the initial point, the build cost (BUILD_SHARE of that work) and the
 * 0.4.41 rung price it replaced. Run: node experiments/build_cost_probe.js
 */
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const OrbitScience = require(path.join(root, 'orbit_science.js'));

const OLD_0_4_41 = {
	'EMC-1': 3, 'EMC-2': 8, 'EMC-3': 12, 'EMC-4': 16, 'EMC-5': 20,
	'SP-1': 0.75, 'SP-2': 1.75, 'SP-3': 3.5, 'SP-4': 6,
	'BAT-1': 0.5, 'BAT-2': 1.25, 'BAT-3': 2.5, 'BAT-4': 4.5, 'BAT-5': 7.5,
	'HOLD-8': 1, 'HOLD-24': 2.5,
	'IMP-1': 2, 'IMP-2': 4, 'IMP-3': 7,
	'FT-1': 0.75, 'FT-2': 1.75, 'FT-3': 3.5
};

const FAMILY = {
	catapult: { table: OrbitTech.CATAPULTS, keys: ['maxForce', 'efficiency'] },
	panel: { table: OrbitTech.PANELS, keys: ['power'] },
	battery: { table: OrbitTech.BATTERIES, keys: ['capacity', 'leak'] },
	hold: { table: OrbitTech.HOLDS, keys: ['capacity'] },
	engine: { table: OrbitTech.ENGINES, keys: ['thrust', 'mass'] },
	tank: { table: OrbitTech.TANKS, keys: ['fuelCap', 'emptyMass'] }
};

function researchFromOrigin(family, params) {
	const hull = OrbitScience.createHull();
	OrbitScience.ensureHull(hull, family, params.length).points.push({ params: params.map(() => 0), label: 'origin' });
	hull.families[family].n = 1;
	return OrbitScience.previewHull(hull, family, params).cost;
}

const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));

console.log('share ' + OrbitScience.BUILD_SHARE + ' of the research work from the origin');
console.log(pad('record', 9) + pad('spec', 40) + pad('research', 11) + pad('build', 8) + pad('0.4.41', 8) + 'ratio');
for (const kind of Object.keys(FAMILY)) {
	const { table, keys } = FAMILY[kind];
	for (const item of table) {
		if (item.tier === 0) continue;
		const spec = keys.map(k => item[k]);
		const work = researchFromOrigin(kind, spec);
		const build = item.buildCost;
		const old = OLD_0_4_41[item.id];
		const specText = keys.map((k, i) => k + ' ' + spec[i]).join(', ');
		console.log(pad(item.id, 9) + pad(specText, 40) + pad(work.toFixed(2), 11) + pad(build.toFixed(2), 8) +
			pad(old === undefined ? '-' : old.toFixed(2), 8) + (build / work).toFixed(3));
	}
}
