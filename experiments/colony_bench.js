/*
 * Colony economy benchmark and law checks (0.2.0-plan-colony-economy.md §12).
 *
 * Covers:
 * - §3 resource map determinism, jitter bound, site ordering
 * - §4 needs order regression (food dominates; transposed table fails),
 *      logistic growth toward K (never above K), famine < 0.4, capital surplus
 *      and 1 %/y decay, warehouse cap, chunking determinism, coarse flag,
 *      ascending stage events, ordered famine/recovery transitions, abandonment
 * - §5–§7 sim wiring: one colony per planet, founding/seeding, TICK advance,
 *      two-year export guard, shortfall/distance destination choice, migrants
 *      flow (moves people and not tons, gated at 0.6 comfort), town/city
 *      expansion gate, heap route re-arm survival
 * - §12 cost per colony-year and per 26-colony tick, 5 000 y NaN-free sweep
 *
 * Run: node experiments/colony_bench.js
 */
'use strict';

const World = require('../orbit_world.js');
const Econ = require('../orbit_econ.js');
const Sim = require('../orbit_sim.js');

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

function syntheticMap(overrides, score) {
	const map = Econ.createMap();
	map.noJitter = true;
	for (let r = 0; r < Econ.ALL; r++) map.ease[r] = 0.85;
	if (overrides) {
		for (const key of Object.keys(overrides)) {
			map.ease[Number(key)] = overrides[key];
		}
	}
	map.score = score === undefined ? 0.5 : score;
	return map;
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
	return Float64Array.from(mapA.ease);
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

/* --- §4 needs order (the regression test) -------------------------------- */

let maxNeedGood = -1;
let maxNeedVal = -1;
let nonFoodNeedSum = 0;
for (let r = 0; r < Econ.ALL; r++) {
	if (Econ.NEED[r] > maxNeedVal) {
		maxNeedVal = Econ.NEED[r];
		maxNeedGood = r;
	}
	if (r !== Econ.FOOD) nonFoodNeedSum += Econ.NEED[r];
}
ok(maxNeedGood === Econ.FOOD, 'NEED[food] is the largest need',
	'max good ' + maxNeedGood + ' (' + maxNeedVal + ')');
ok(Econ.NEED[Econ.FOOD] > 1.5 * nonFoodNeedSum,
	'NEED[food] exceeds 60% of total need so missing food triggers famine',
	Econ.NEED[Econ.FOOD] + ' vs non-food ' + nonFoodNeedSum.toFixed(2));

{
	const noFood = Econ.createColony(0, 'no-food', 0, syntheticMap({ [Econ.FOOD]: 0 }));
	const fullFood = Econ.createColony(1, 'full-food', 0, syntheticMap({ [Econ.FOOD]: 1 }));
	const startPop = noFood.pop;
	Econ.advanceColony(noFood, 160);
	Econ.advanceColony(fullFood, 160);
	ok(noFood.comfort < Econ.FAMINE_COMFORT && noFood.starving,
		'a colony with food ease 0 enters famine',
		'comfort ' + noFood.comfort.toFixed(3));
	ok(noFood.pop <= Econ.POP_FLOOR + 1e-9 && noFood.pop < startPop,
		'a colony with food ease 0 starves to the pop floor',
		'pop ' + noFood.pop.toFixed(3));
	ok(fullFood.comfort > 0.85 && !fullFood.starving && fullFood.pop > 40,
		'a colony with food ease 1 grows into a city',
		'pop ' + fullFood.pop.toFixed(1) + ' comfort ' + fullFood.comfort.toFixed(2));
	ok(Econ.isAbandoned(noFood),
		'a food-zero colony is abandoned after 20 years at the pop floor',
		'starveFor ' + noFood.starveFor.toFixed(1));

	/* Verify the transposed table from 31c6d5a (rare=20, food=0.2) would fail this test. */
	const savedFood = Econ.NEED[Econ.FOOD];
	const savedRare = Econ.NEED[Econ.RARE];
	Econ.NEED[Econ.FOOD] = savedRare;
	Econ.NEED[Econ.RARE] = savedFood;
	const transposed = Econ.createColony(2, 'transposed', 0, syntheticMap({ [Econ.FOOD]: 0 }));
	Econ.advanceColony(transposed, 40);
	const transposedStarvedOnFood = transposed.comfort < Econ.FAMINE_COMFORT;
	Econ.NEED[Econ.FOOD] = savedFood;
	Econ.NEED[Econ.RARE] = savedRare;
	ok(!transposedStarvedOnFood,
		'regression guard: a transposed NEED table fails to starve on food ease 0',
		'transposed comfort ' + transposed.comfort.toFixed(3));
}

/* --- §4 logistic growth, capital decay, warehouse cap -------------------- */

{
	/* Logistic toward K, never above K. */
	const c = Econ.createColony(0, 'logistic', 0, syntheticMap({ [Econ.FOOD]: 0.9 }));
	let everAboveK = false;
	let prevPop = c.pop;
	let monotonic = true;
	for (let y = 1; y <= 500; y++) {
		Econ.advanceColony(c, y);
		const K = Econ.carryingCapacity(c);
		if (c.pop > K + 1e-9) everAboveK = true;
		if (c.pop + 1e-9 < prevPop) monotonic = false;
		prevPop = c.pop;
	}
	const finalK = Econ.carryingCapacity(c);
	ok(!everAboveK, 'population never exceeds carrying capacity K',
		'pop ' + c.pop.toFixed(2) + ' K ' + finalK.toFixed(2));
	ok(monotonic && Math.abs(c.pop - finalK) / finalK < 0.02,
		'population converges logistically to K',
		'pop ' + c.pop.toFixed(2) + ' K ' + finalK.toFixed(2));

	/* Capital grows only from surplus and decays at 1 %/y down to CAPITAL_FLOOR. */
	const zeroMap = Econ.createMap();
	zeroMap.noJitter = true;
	zeroMap.score = 0.8; // capital starts at 1 + 5*0.8 = 5.0
	const barren = Econ.createColony(0, 'zero-surplus', 0, zeroMap);
	const cap0 = barren.capital;
	Econ.advanceColony(barren, 1);
	const expected1y = cap0 * Math.pow(1 - Econ.CAPITAL_DECAY * Econ.BASE_DT, 4);
	ok(Math.abs(barren.capital - expected1y) < 1e-12,
		'capital decays at 1 %/y when there is no surplus',
		barren.capital.toFixed(6) + ' vs ' + expected1y.toFixed(6));
	Econ.advanceColony(barren, 1000);
	ok(barren.capital === Econ.CAPITAL_FLOOR,
		'capital respects CAPITAL_FLOOR = 0.1',
		barren.capital.toFixed(4));

	/* Warehouse cap holds even when seeded with huge stock or run for centuries. */
	const richColony = Econ.createColony(0, 'warehouse', 0, syntheticMap({ [Econ.FOOD]: 1 }));
	for (let r = 0; r < Econ.ALL; r++) richColony.stock[r] = 1e7;
	Econ.advanceColony(richColony, 300);
	let capClean = true;
	for (let r = 0; r < Econ.ALL; r++) {
		const maxStock = Econ.warehouseCap(r, richColony.pop);
		if (richColony.stock[r] > maxStock + 1e-9) capClean = false;
	}
	ok(capClean, 'all 10 goods obey the warehouse cap (150·need_annual + 50)');
}

/* --- §4 determinism of chunking & coarse flag ---------------------------- */

{
	const w7 = world(7);
	Econ.resourceMapFor(w7, 3, 7, mapA);
	const oneChunk = Econ.createColony(3, 'one', 0, mapA);
	const fineChunks = Econ.createColony(3, 'fine', 0, mapA);
	const tenChunks = Econ.createColony(3, 'ten', 0, mapA);

	Econ.advanceColony(oneChunk, 100);
	for (let i = 1; i <= 400; i++) Econ.advanceColony(fineChunks, i * 0.25);
	for (let i = 1; i <= 10; i++) Econ.advanceColony(tenChunks, i * 10);

	let stocksEqual = true;
	for (let r = 0; r < Econ.ALL; r++) {
		if (oneChunk.stock[r] !== fineChunks.stock[r] ||
			oneChunk.stock[r] !== tenChunks.stock[r]) {
			stocksEqual = false;
		}
	}
	ok(oneChunk.pop === fineChunks.pop &&
		oneChunk.capital === fineChunks.capital &&
		oneChunk.comfort === fineChunks.comfort &&
		stocksEqual,
		'one 100 y advance equals 400 × 0.25 y advances and 10 × 10 y advances');
	ok(oneChunk.coarse === false && fineChunks.coarse === false,
		'100 y advance is not coarse');

	const longJump = Econ.createColony(3, 'long', 0, mapA);
	Econ.advanceColony(longJump, 2000);
	ok(longJump.coarse === true, 'a 2 000 y advance flags coarse');
}

/* --- §4 & §12 events: stages ascend, famine/recovery alternate ----------- */

{
	const m = syntheticMap({ [Econ.FOOD]: 0.9 }, 0.05); // pop starts at 1.45k (outpost)
	const c = Econ.createColony(0, 'events', 0, m);
	const stages = [];
	const transitions = [];
	function onEvent(kind, colony, year, detail) {
		if (kind === Econ.EVENT_STAGE) stages.push(detail);
		else if (kind === Econ.EVENT_FAMINE) transitions.push('famine');
		else if (kind === Econ.EVENT_RECOVERY) transitions.push('recovery');
	}
	/* Grow from outpost (1.45k) through settlement (2k), town (10k), city (40k). */
	Econ.advanceColony(c, 220, onEvent);
	ok(stages.length === 3 &&
		stages[0] === Econ.STAGE_SETTLEMENT &&
		stages[1] === Econ.STAGE_TOWN &&
		stages[2] === Econ.STAGE_CITY,
		'stage crossings ascend 1 → 2 → 3 in order',
		stages.join(' -> '));

	/* Induce famine, then restore food and recover: stage must not repeat and
	 * famine/recovery must enter and lift in strict alternating order. */
	c.ease[Econ.FOOD] = 0;
	c.stock[Econ.FOOD] = 0;
	Econ.advanceColony(c, 260, onEvent);
	c.ease[Econ.FOOD] = 0.95;
	Econ.advanceColony(c, 340, onEvent);
	c.ease[Econ.FOOD] = 0;
	c.stock[Econ.FOOD] = 0;
	Econ.advanceColony(c, 360, onEvent);
	c.ease[Econ.FOOD] = 0.95;
	Econ.advanceColony(c, 420, onEvent);

	ok(stages.length === 3, 'stage crossings never repeat after famine and recovery',
		'count ' + stages.length);
	ok(transitions.length === 4 &&
		transitions[0] === 'famine' &&
		transitions[1] === 'recovery' &&
		transitions[2] === 'famine' &&
		transitions[3] === 'recovery',
		'famine enters and lifts in strict alternating order',
		transitions.join(' -> '));
}

/* --- §5, §6, §7, §8 sim wiring, trade, migrants, seeding, abandonment ---- */

{
	const sim = new Sim(7);
	ok(sim.colonies.length === sim.portCount && sim.portCount === Sim.INITIAL_PORTS,
		'boot creates one colony per initial port',
		'colonies ' + sim.colonies.length + ' ports ' + sim.portCount);

	/* One colony per planet invariant: seeding an occupied planet returns it. */
	const p0Planet = sim.portPlanet[0];
	const existing = sim.colonyAt(p0Planet);
	const dup = sim.seedColony(p0Planet);
	ok(dup === existing && sim.portCount === Sim.INITIAL_PORTS,
		'seedColony on an occupied planet returns the existing colony without duplicating');

	/* Find a free habitable planet and a free barren planet (super, hab ~ 0.03). */
	let freeHabitable = -1;
	let freeBarren = -1;
	for (let p = 0; p < Sim.PLANETS; p++) {
		if (sim.planetState[p] !== 0) continue;
		if (sim.planetType[p] === World.TYPE_TERRAN && freeHabitable < 0) freeHabitable = p;
		if (sim.planetType[p] === World.TYPE_SUPER && freeBarren < 0) freeBarren = p;
	}
	ok(freeHabitable >= 0 && freeBarren >= 0,
		'found free habitable and barren planets for seeding test',
		'habitable ' + freeHabitable + ' barren ' + freeBarren);

	Econ.resourceMapFor(sim.world, freeBarren, sim.seed, mapA);
	const seededBarren = sim.seedColony(freeBarren);
	ok(seededBarren !== null &&
		Math.abs(seededBarren.pop - (1 + 9 * mapA.score)) < 1e-12 &&
		Math.abs(seededBarren.capital - (1 + 5 * mapA.score)) < 1e-12 &&
		seededBarren.stage === Econ.STAGE_OUTPOST,
		'seedColony on a free planet founds an outpost with the site score',
		'pop ' + seededBarren.pop.toFixed(2) + ' score ' + mapA.score.toFixed(2));

	/* Step 200 colony years (200 sim minutes): the barren outpost must starve and
	 * be abandoned, freeing its planet, while every remaining colony is synced. */
	sim.step(200);
	ok(sim.colonyAt(freeBarren) === null && sim.planetState[freeBarren] === 0,
		'seeded outpost on a barren planet is abandoned within 200 y and frees the planet',
		'abandonEvents ' + sim.abandonEvents);

	let allSynced = true;
	let mappingClean = true;
	for (let p = 0; p < sim.portCount; p++) {
		const col = sim.colonies[p];
		if (!col || col.idx !== p || sim.colonyOn[col.planet] !== p) mappingClean = false;
		if (Math.abs(col.lastY - sim.econY()) > Sim.TICK_MINUTES) allSynced = false;
	}
	ok(mappingClean, 'port ↔ planet ↔ colony indices stay 1:1 after abandonment');
	ok(allSynced, 'all colonies advance on TICK and stay synced to sim time');

	/* Trade rules (§7): two-year guard and shortfall / (1 + dist/220) pick. */
	const tradeSim = new Sim(7);
	const home = 0;
	const src = tradeSim.colonies[home];
	const good = Econ.BULK;
	src.ease[Econ.BULK] = 1.0;
	src.ease[Econ.GOODS] = 0.1;
	const guard = Econ.GUARD_YEARS * src.pop * Econ.NEED[good];
	/* Give src 10 t above the two-year guard (< SHIP_CAPACITY = 24 t). */
	src.stock[good] = guard + 10;
	src.stock[Econ.GOODS] = 0;

	/* Configure the nearest-four partners with controlled shortfalls. */
	const base = home * Sim.MAX_LINKS;
	const qNear = tradeSim.partners[base];
	const qFar = tradeSim.partners[base + 1];
	for (let k = 0; k < tradeSim.partnerCount[home]; k++) {
		const q = tradeSim.partners[base + k];
		const col = tradeSim.colonies[q];
		col.stock[good] = Econ.GUARD_YEARS * col.pop * Econ.NEED[good] + 50;
	}
	/* Equal shortfall per distance test: give qFar a much larger shortfall so it
	 * wins by shortfall / (1 + dist/220). */
	tradeSim.colonies[qNear].pop = 5;
	tradeSim.colonies[qNear].stock[good] = 25; // shortfall = 2*5*3 - 25 = 5
	tradeSim.colonies[qFar].pop = 20;
	tradeSim.colonies[qFar].stock[good] = 0;   // shortfall = 2*20*3 = 120
	const picked = tradeSim.pickExportDest(home, good, tradeSim.t);
	ok(picked === qFar,
		'pickExportDest chooses greatest shortfall / (1 + distance/220)',
		'picked ' + picked + ' expected ' + qFar);

	tradeSim.load(home, tradeSim.t);
	ok(tradeSim.shipState[home] === 1 &&
		tradeSim.shipTarget[home] === qFar &&
		tradeSim.shipGood[home] === good &&
		Math.abs(tradeSim.shipAmount[home] - 10) < 1e-9 &&
		Math.abs(src.stock[good] - guard) < 1e-9,
		'load takes at most stock above the two-year guard and never dips below it',
		'loaded ' + tradeSim.shipAmount[home].toFixed(2) + ' left ' + src.stock[good].toFixed(2) + ' guard ' + guard.toFixed(2));

	/* Migrants run (§5): moves people and not tons; comfort < 0.6 receives none. */
	const migSim = new Sim(7);
	const mHome = 0;
	const mSrc = migSim.colonies[mHome];
	mSrc.comfort = 0.85;
	mSrc.pop = 15;
	migSim.portMigrants[mHome] = 3;
	const mBase = mHome * Sim.MAX_LINKS;
	const mPartner0 = migSim.partners[mBase];
	const mPartner1 = migSim.partners[mBase + 1];
	for (let k = 0; k < migSim.partnerCount[mHome]; k++) {
		const q = migSim.partners[mBase + k];
		migSim.colonies[q].comfort = 0.3; // misery attracts no migrants
	}
	migSim.colonies[mPartner1].comfort = 0.8;
	migSim.colonies[mPartner1].pop = 5;
	const migDest = migSim.pickMigrantDest(mHome);
	ok(migDest === mPartner1,
		'pickMigrantDest skips partners below 0.6 comfort and picks eligible habitat*(1-fill)',
		'picked ' + migDest + ' expected ' + mPartner1);

	const dstCol = migSim.colonies[mPartner1];
	const dstStockBefore = Float64Array.from(dstCol.stock);
	const dstPopBefore = dstCol.pop;
	const srcPopBefore = mSrc.pop;
	const sent = migSim.dispatchMigrants(mHome, migSim.t);
	ok(sent && migSim.shipGood[mHome] === Econ.MIGRANTS &&
		Math.abs(mSrc.pop - (srcPopBefore - 3)) < 1e-9,
		'dispatchMigrants embarks people from the source colony');
	migSim.arrive(mHome, migSim.shipArrive[mHome]);
	let stockUntouched = true;
	for (let r = 0; r < Econ.ALL; r++) {
		if (dstCol.stock[r] !== dstStockBefore[r]) stockUntouched = false;
	}
	ok(Math.abs(dstCol.pop - (dstPopBefore + 3)) < 1e-9 && stockUntouched,
		'migrants arrival adds people and never changes destination stock',
		'pop ' + dstPopBefore + ' -> ' + dstCol.pop);

	/* Route re-arm survival over 3 000 sim minutes: every port still has a live
	 * ship event (either flying or queued to load on the heap). */
	const longSim = new Sim(7);
	longSim.step(3000);
	let liveShips = 0;
	for (let p = 0; p < longSim.portCount; p++) {
		let hasEvent = false;
		for (let i = 0; i < longSim.events.size; i++) {
			const k = longSim.events.kind[i];
			if ((k === 0 || k === 1) && longSim.events.ref[i] === p) {
				hasEvent = true;
				break;
			}
		}
		if (hasEvent) liveShips++;
	}
	ok(liveShips === longSim.portCount && longSim.portCount > 0,
		'no ship route re-arm is ever lost on the event heap',
		liveShips + '/' + longSim.portCount);
}

/* --- §12 cost & 5 000 y NaN-free sweep ----------------------------------- */

const w = world(7);
const mapRuns = 20000;
const tMap0 = process.hrtime.bigint();
for (let i = 0; i < mapRuns; i++) Econ.resourceMapFor(w, i % World.PLANETS, 7, mapA);
const perMapMs = Number(process.hrtime.bigint() - tMap0) / 1e6 / mapRuns;
ok(perMapMs < 0.05, 'map cost under 50 µs', perMapMs.toFixed(4) + ' ms');

const benchColonies = [];
for (let p = 0; p < World.PLANETS; p++) {
	const m = Econ.resourceMapFor(w, p, 7, Econ.createMap());
	benchColonies.push(Econ.createColony(p, 'P' + p, 0, m));
}
/* 5 000 colony years across all 26 planets in 3-year ticks (1 667 ticks). */
const ticks = 1667;
const tAdv0 = process.hrtime.bigint();
for (let t = 1; t <= ticks; t++) {
	const toY = t * 3;
	for (let p = 0; p < World.PLANETS; p++) {
		Econ.advanceColony(benchColonies[p], toY);
	}
}
const advTotalMs = Number(process.hrtime.bigint() - tAdv0) / 1e6;
const perTickUs = (advTotalMs * 1000) / ticks;
const perColonyYearUs = (advTotalMs * 1000) / (ticks * 3 * World.PLANETS);

let finiteClean = true;
for (let p = 0; p < World.PLANETS; p++) {
	const c = benchColonies[p];
	if (!Number.isFinite(c.pop) || !Number.isFinite(c.capital) ||
		!Number.isFinite(c.comfort) || c.pop < Econ.POP_FLOOR) {
		finiteClean = false;
	}
	for (let r = 0; r < Econ.ALL; r++) {
		if (!Number.isFinite(c.stock[r]) || c.stock[r] < 0) finiteClean = false;
	}
}
ok(finiteClean, 'no NaN or negative stock over 5 000 y across 26 colonies');
ok(perTickUs < 500, '26-colony tick advance under 500 µs', perTickUs.toFixed(1) + ' µs');

console.log('colony bench: ' + (checks - failed) + '/' + checks + ' checks');
console.log('  jitter max ' + jitterMax.toFixed(4) +
	' · map ' + (perMapMs * 1000).toFixed(1) + ' µs' +
	' · advance ' + perColonyYearUs.toFixed(2) + ' µs/colony-y' +
	' (' + perTickUs.toFixed(1) + ' µs/tick for 26 colonies)');
if (failed > 0) process.exitCode = 1;
else console.log('COLONY BENCH OK');
