/*
 * Validation of balance_lab.html: the page embeds a pricing mirror of
 * orbit_science.js (parameterised by the balance knobs). This test extracts
 * that block, runs it against the shipped module and compares fee surfaces,
 * research previews and build costs. Run: node experiments/balance_lab_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const OrbitScience = require(path.join(root, 'orbit_science.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));

const html = fs.readFileSync(path.join(root, 'balance_lab.html'), 'utf8');
const m = html.match(/\/\*@@pricing@@\*\/([\s\S]*?)\/\*@@\/pricing@@\*\//);
if (!m) {
	console.error('FAIL: pricing block not found in balance_lab.html');
	process.exit(1);
}
const sandbox = { Math, Number, JSON, console, Infinity, isNaN };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const pricing = sandbox.createPricing();

function clone(o) { return JSON.parse(JSON.stringify(o)); }
const K = {
	k: OrbitScience.K_DIST,
	defaultBase: OrbitScience.DEFAULT_BASE,
	tier: clone(OrbitScience.TIER_SCALE),
	base: clone(OrbitScience.BASE_PRICE),
	frontier: clone(OrbitScience.FRONTIER),
	metric: clone(OrbitScience.METRIC_SCALE),
	merit: clone(OrbitScience.MERIT),
	band: [OrbitScience.MERIT_MIN, OrbitScience.MERIT_MAX],
	buildShare: OrbitScience.BUILD_SHARE
};

const RESEARCH = ['engine', 'catapult', 'tank', 'battery'];
const KINDS = ['catapult', 'panel', 'battery', 'hold', 'engine', 'tank'];
const START_TIER = { catapult: 2, panel: 99, battery: 99, hold: 99, engine: 99, tank: 99 };
const AXES = {
	engine: [[4, 60], [0.2, 3.6]],
	catapult: [[10, 230], [0.5, 0.98]],
	tank: [[20, 220], [0.15, 1.9]],
	battery: [[1, 22], [0.0001, 0.0012]]
};

function seedHull(full) {
	const h = OrbitScience.createHull();
	for (const kind of KINDS) {
		const table = OrbitTech.TABLES[kind];
		const maxTier = full ? 99 : START_TIER[kind];
		for (const item of table) {
			if (item.tier > 0 && item.tier <= maxTier) {
				const spec = kind === 'engine' ? [item.thrust, item.mass]
					: kind === 'catapult' ? [item.maxForce, item.efficiency]
					: kind === 'tank' ? [item.fuelCap, item.emptyMass]
					: kind === 'battery' ? [item.capacity, item.leak]
					: kind === 'panel' ? [item.power]
					: [item.capacity];
				OrbitScience.acceptHull(h, kind, spec, item.id);
			}
		}
	}
	return h;
}

function originHull(family) {
	const h = OrbitScience.createHull();
	const dim = OrbitScience.MERIT[family].length;
	OrbitScience.ensureHull(h, family, dim).points.push({ params: new Array(dim).fill(0), label: 'origin' });
	h.families[family].n = 1;
	return h;
}

const originHulls = {};
for (const kind of KINDS) originHulls[kind] = originHull(kind);

let pass = 0, fail = 0;
function check(name, got, want, tol) {
	if (!Number.isFinite(want)) {
		if (!Number.isFinite(got)) { pass++; return; }
		fail++;
		console.log('FAIL ' + name + ': got ' + got + ' want Infinity');
		return;
	}
	if (!Number.isFinite(got) || Math.abs(got - want) > (tol || 1e-9)) {
		fail++;
		console.log('FAIL ' + name + ': got ' + got + ' want ' + want);
		return;
	}
	pass++;
}

/* fee surfaces over the slider grid, game-seeded and full-ladder-seeded */
for (const full of [false, true]) {
	const h = seedHull(full);
	for (const family of RESEARCH) {
		const ranges = AXES[family];
		let i = 0;
		for (let a = 0; a <= 20; a++) {
			for (let b = 0; b <= 20; b++) {
				const x = ranges[0][0] + (ranges[0][1] - ranges[0][0]) * a / 20;
				const y = ranges[1][0] + (ranges[1][1] - ranges[1][0]) * b / 20;
				const want = OrbitScience.previewHull(h, family, [x, y]).cost;
				const got = pricing.preview(h, family, [x, y], K).cost;
				check('surface ' + family + ' full=' + full + ' #' + (i++), got, want);
			}
		}
	}
}

/* research preview fields of the slider defaults */
const DEFAULTS = { engine: [26, 1.8], catapult: [100, 0.76], tank: [100, 1.0], battery: [6, 0.0005] };
for (const family of RESEARCH) {
	const h = seedHull(false);
	const params = DEFAULTS[family];
	const want = OrbitScience.previewHull(h, family, params);
	const got = pricing.preview(h, family, params, K);
	check('default fee ' + family, got.cost, want.cost);
	check('default dist ' + family, got.dist, want.dist);
	check('default frontier ' + family, got.frontier, want.frontier);
	check('default merit ' + family, got.merit, want.merit);
	check('default inside ' + family, got.inside ? 1 : 0, want.inside ? 1 : 0, 0);
}

/* build cost of every stock record, from the origin */
const SPEC_KEYS = {
	catapult: ['maxForce', 'efficiency'], panel: ['power'], battery: ['capacity', 'leak'],
	hold: ['capacity'], engine: ['thrust', 'mass'], tank: ['fuelCap', 'emptyMass']
};
for (const kind of KINDS) {
	for (const item of OrbitTech.TABLES[kind]) {
		if (item.tier === 0) continue;
		const spec = SPEC_KEYS[kind].map(k => item[k]);
		const want = OrbitScience.buildCostOf(kind, spec);
		const got = pricing.buildCost(kind, spec, K, originHulls);
		check('build ' + item.id, got, want, 0.005);
	}
}

/* build work (unrounded) */
for (const kind of KINDS) {
	for (const item of OrbitTech.TABLES[kind]) {
		if (item.tier === 0) continue;
		const spec = SPEC_KEYS[kind].map(k => item[k]);
		const hull = originHull(kind);
		const want = OrbitScience.previewHull(hull, kind, spec).cost;
		const got = pricing.buildWork(kind, spec, K, originHulls);
		check('work ' + item.id, got, want);
	}
}

/* the recorded probe numbers: defaults and the worse-is-cheaper sweeps */
const PROBE = [
	['engine', [26, 1.8], 1.277], ['catapult', [100, 0.76], 1.632],
	['tank', [100, 1], 0.648], ['battery', [6, 0.0005], 0.742]
];
for (const [family, params, fee] of PROBE) {
	const h = seedHull(true);
	const got = pricing.preview(h, family, params, K).cost;
	check('probe fee ' + family, got, fee, 0.01);
}

/* knob sensitivity: a changed k must scale the distance part, the merit
 * band must clamp a sub-floor spec, build share must scale the build cost */
{
	const h = seedHull(true);
	const K2 = clone(K);
	K2.k = 8;
	const p = pricing.preview(h, 'engine', [50, 1.5], K);
	const moved = pricing.preview(h, 'engine', [50, 1.5], K2).cost;
	check('knob k moves the fee', moved > p.cost ? 1 : 0, 1, 0);
	check('knob k scales distance+frontier', moved - p.cost, (8 - 4) * (p.dist + p.frontier) * p.merit, 1e-6);

	const K3 = clone(K);
	K3.band = [0.5, 2.5];
	const low = pricing.preview(h, 'battery', [1, 0.0012], K);
	const lowC = pricing.preview(h, 'battery', [1, 0.0012], K3);
	check('band floor binds', lowC.merit, 0.5, 1e-9);
	check('band floor binds fee', lowC.cost, low.cost / low.merit * 0.5, 1e-9);

	const K4 = clone(K);
	K4.buildShare = 0.16;
	const spec = [135, 0.8];
	const w = pricing.buildWork('catapult', spec, K, originHulls);
	check('build share scales', pricing.buildCost('catapult', spec, K4, originHulls), Math.round(0.16 * w * 100) / 100, 1e-9);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
