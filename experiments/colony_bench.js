/*
 * Colony economy benchmark and law checks (0.2.0-plan-colony-economy.md §12).
 *
 * Step 1 covers the world traits and the resource map: determinism, the jitter
 * bound, the site ordering (terran > rock > ice), and the map's cost. Growth
 * checks arrive with the advance law.
 *
 * Run: node experiments/colony_bench.js
 */
'use strict';

const World = require('../orbit_world.js');
const Econ = require('../orbit_econ.js');

let checks = 0;
let failed = 0;

function ok(condition, label, detail) {
	checks++;
	if (condition) return;
	failed++;
	console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail));
}

function world(seed) {
	return World.create(seed, World.seedRandom(seed));
}

/* --- §3 determinism ------------------------------------------------------ */

const SEEDS = [1, 7, 42, 99, 1234];
const mapA = Econ.createMap();
const mapB = Econ.createMap();
const mapC = Econ.createMap();

for (const seed of SEEDS) {
	const w = world(seed);
	for (let planet = 0; planet < World.PLANETS; planet++) {
		Econ.resourceMapFor(w, planet, seed, mapA);
		Econ.resourceMapFor(w, planet, seed, mapB);
		let identical = true;
		for (let r = 0; r < Econ.ALL; r++) {
			if (mapA.ease[r] !== mapB.ease[r]) identical = false;
		}
		ok(identical, 'same seed + planet reproduces the map', 'seed ' + seed + ' planet ' + planet);

		/* a second seed must move at least one good */
		Econ.resourceMapFor(w, planet, seed + 1, mapC);
		let differs = false;
		for (let r = 0; r < Econ.ALL; r++) {
			if (Math.abs(mapA.ease[r] - mapC.ease[r]) > 1e-12) differs = true;
		}
		ok(differs, 'a different seed moves the map', 'seed ' + seed + ' planet ' + planet);
	}

	/* two planets of the same system are different sites */
	Econ.resourceMapFor(w, 0, seed, mapA);
	Econ.resourceMapFor(w, 1, seed, mapB);
	let planetDiffers = false;
	for (let r = 0; r < Econ.ALL; r++) {
		if (Math.abs(mapA.ease[r] - mapB.ease[r]) > 1e-12) planetDiffers = true;
	}
	ok(planetDiffers, 'two planets of one system are different sites', 'seed ' + seed);
}

/* the same seed through a fresh Sim must give the same traits */
for (const seed of SEEDS) {
	const a = world(seed);
	const b = world(seed);
	let same = a.metal === b.metal && a.lum === b.lum && a.beltCount === b.beltCount;
	for (let i = 0; i < World.PLANETS; i++) {
		if (a.planetType[i] !== b.planetType[i]) same = false;
		if (a.planetHabitat[i] !== b.planetHabitat[i]) same = false;
	}
	ok(same, 'traits are deterministic', 'seed ' + seed);
}

/* --- §3 the jitter bound ------------------------------------------------- */

let jitterMax = 0;
for (const seed of SEEDS) {
	const w = world(seed);
	for (let planet = 0; planet < World.PLANETS; planet++) {
		Econ.resourceMapFor(w, planet, seed, mapA, false);
		Econ.resourceMapFor(w, planet, seed, mapB, true);
		for (let r = 0; r < Econ.ALL; r++) {
			const delta = Math.abs(mapA.ease[r] - mapB.ease[r]);
			if (delta > jitterMax) jitterMax = delta;
			ok(mapB.ease[r] >= 0 && mapB.ease[r] <= 1, 'ease stays in [0,1]');
		}
	}
}
ok(jitterMax <= 0.06 + 1e-9, 'jitter stays inside ±0.06', jitterMax.toFixed(4));

/* --- §3 the site ordering ------------------------------------------------ */

function meanScoreByType(seed) {
	const w = world(seed);
	const sum = new Float64Array(World.TYPE_COUNT);
	const count = new Float64Array(World.TYPE_COUNT);
	for (let planet = 0; planet < World.PLANETS; planet++) {
		Econ.resourceMapFor(w, planet, seed, mapA);
		sum[w.planetType[planet]] += mapA.score;
		count[w.planetType[planet]]++;
	}
	const mean = new Float64Array(World.TYPE_COUNT);
	for (let t = 0; t < World.TYPE_COUNT; t++) mean[t] = count[t] > 0 ? sum[t] / count[t] : 0;
	return mean;
}

for (const seed of SEEDS) {
	const mean = meanScoreByType(seed);
	ok(mean[World.TYPE_TERRAN] > mean[World.TYPE_GAS], 'terran sites beat gas giants',
		seed + ': ' + mean[World.TYPE_TERRAN].toFixed(2) + ' vs ' + mean[World.TYPE_GAS].toFixed(2));
	ok(mean[World.TYPE_ROCK] > mean[World.TYPE_ICE], 'rock sites beat ice giants',
		seed + ': ' + mean[World.TYPE_ROCK].toFixed(2) + ' vs ' + mean[World.TYPE_ICE].toFixed(2));
}

/* a metal-poor system cannot make rare; a dim one cannot make antimatter */
function easeWith(metalScale, lumScale) {
	const w = world(7);
	w.metal = 0.020 * metalScale;
	w.lum = lumScale;
	Econ.resourceMapFor(w, 3, 7, mapA, false);
	return Float64Array.from(mapA.ease);   // a copy: the scratch map is reused
}
const poor = easeWith(0.2, 1);
const rich = easeWith(1.6, 1);
const dim = easeWith(1, 0.02);
const bright = easeWith(1, 2.2);
ok(poor[Econ.RARE] < rich[Econ.RARE] * 0.5, 'a metal-poor star cannot make rare',
	poor[Econ.RARE].toFixed(2) + ' vs ' + rich[Econ.RARE].toFixed(2));
ok(dim[Econ.ANTIMATTER] < bright[Econ.ANTIMATTER] * 0.5, 'a dim star cannot make antimatter',
	dim[Econ.ANTIMATTER].toFixed(2) + ' vs ' + bright[Econ.ANTIMATTER].toFixed(2));

/* food follows the world, not the star: a terran world out-farms an ice giant */
for (const seed of SEEDS) {
	const w = world(seed);
	let best = -1, worst = -1;
	for (let planet = 0; planet < World.PLANETS; planet++) {
		if (w.planetType[planet] === World.TYPE_TERRAN) best = planet;
		if (w.planetType[planet] === World.TYPE_ICE) worst = planet;
	}
	if (best < 0 || worst < 0) continue;
	Econ.resourceMapFor(w, best, seed, mapA);
	Econ.resourceMapFor(w, worst, seed, mapB);
	ok(mapA.ease[Econ.FOOD] > mapB.ease[Econ.FOOD], 'a terran world out-farms an ice giant',
		seed + ': ' + mapA.ease[Econ.FOOD].toFixed(2) + ' vs ' + mapB.ease[Econ.FOOD].toFixed(2));
}

/* --- cost ---------------------------------------------------------------- */

const w = world(7);
const runs = 20000;
const started = process.hrtime.bigint();
for (let i = 0; i < runs; i++) Econ.resourceMapFor(w, i % World.PLANETS, 7, mapA);
const perMapMs = Number(process.hrtime.bigint() - started) / 1e6 / runs;
ok(perMapMs < 0.05, 'map cost under 50 µs', perMapMs.toFixed(4) + ' ms');

console.log('colony bench: ' + (checks - failed) + '/' + checks + ' checks');
console.log('  jitter max ' + jitterMax.toFixed(4) + ' · map ' +
	(perMapMs * 1000).toFixed(1) + ' µs');
if (failed > 0) process.exitCode = 1;
else console.log('COLONY BENCH OK');
