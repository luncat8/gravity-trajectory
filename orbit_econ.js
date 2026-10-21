/*
 * The colony economy's pure laws (0.2.0-plan-colony-economy.md).
 *
 * Two tiers on one record. Inside the system three goods move between planet
 * ports (bulk, goods, migrants); between systems seven goods are averaged, never
 * flown (rare, exotic, antimatter, food, fabricators, info, colonists). Every
 * colony has one ease array of ALL_TEN, so a single pass covers both tiers; the
 * intra/inter split is only how the rules read.
 *
 * Everything here is a pure function of (world traits, planet index, seed) plus
 * the colony record — no DOM, no canvas, no random state at run time. Arrays are
 * preallocated per colony; `advanceColony` uses module scratch and allocates
 * nothing.
 */
(function (root) {
	'use strict';

	const World = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;

	/* --- §1 the goods ------------------------------------------------------ */

	const INTRA = 3;
	const BULK = 0, GOODS = 1, MIGRANTS = 2;
	const RARE = 3, EXOTIC = 4, ANTIMATTER = 5, FOOD = 6, FABRICATORS = 7,
		INFO = 8, COLONISTS = 9;
	const ALL = 10;
	const INTER = ALL - INTRA;

	const KIND_INTRA = 0, KIND_INTER = 1;

	const GOODS_TABLE = [
		{ id: 'bulk', label: 'bulk cargo', kind: KIND_INTRA, color: '#8aa6bd' },
		{ id: 'goods', label: 'finished goods', kind: KIND_INTRA, color: '#6fd3a0' },
		{ id: 'migrants', label: 'migrants', kind: KIND_INTRA, color: '#ffd479' },
		{ id: 'rare', label: 'rare elements', kind: KIND_INTER, color: '#67e0ff' },
		{ id: 'exotic', label: 'exotic chemicals', kind: KIND_INTER, color: '#c58bff' },
		{ id: 'antimatter', label: 'antimatter', kind: KIND_INTER, color: '#ff7a9c' },
		{ id: 'food', label: 'food & biotech', kind: KIND_INTER, color: '#ffb26b' },
		{ id: 'fabricators', label: 'fab cores', kind: KIND_INTER, color: '#9fb6ff' },
		{ id: 'info', label: 'info & software', kind: KIND_INTER, color: '#7ee8d0' },
		{ id: 'colonists', label: 'colonists', kind: KIND_INTER, color: '#ffe9a8' }
	];

	/*
	 * Production at ease 1 and driver 1, t per colony year (§4 step 1). Migrants
	 * and colonists are flows (§5): no rate, they move as people. Intra bulk and
	 * goods are scaled 1/4 alongside their needs so food stays the dominant term
	 * in comfort while keeping the same per-capita self-sufficiency thresholds.
	 */
	const RATE = new Float64Array([
		300, 225, 0,
		800, 800, 400, 2000, 600, 600, 0
	]);

	/* What 1k persons eat, burn or wear per year (§4 step 2). Food dominates. */
	const NEED = new Float64Array([
		3, 1.5, 0,
		0.2, 0.2, 0.05, 20, 0.5, 1.0, 0
	]);

	/* Driver kinds (§4 step 1) — a flat enum keeps the step one switch. */
	const DRIVER_POP_40 = 0, DRIVER_POP_50 = 1, DRIVER_POP_100 = 2,
		DRIVER_CAPITAL = 3, DRIVER_CAPITAL2 = 4, DRIVER_NONE = 5;
	const DRIVER = new Uint8Array([
		DRIVER_POP_40, DRIVER_POP_40, DRIVER_NONE,
		DRIVER_CAPITAL, DRIVER_CAPITAL, DRIVER_CAPITAL2, DRIVER_POP_50,
		DRIVER_CAPITAL, DRIVER_POP_100, DRIVER_NONE
	]);

	/* §4: the growth law's constants. */
	const BASE_DT = 0.25;            // colony years per integration step
	const MAX_STEPS = 2048;          // a longer span coarsens and flags itself
	const G_MAX = 1 / 40;            // logistic rate per year, fully fed
	const FAMINE_RATE = 0.04;        // per year at comfort below the band
	const FAMINE_COMFORT = 0.4;
	const FAMINE_RECOVERY = 0.45;    // hysteresis band prevents 0.40 chatter
	const POP_FLOOR = 0.05;          // k persons; a colony never reaches zero
	const CAPITAL_FLOOR = 0.1;
	const CAPITAL_GAIN = 0.02;       // per tonne of surplus per year
	const CAPITAL_DECAY = 0.01;      // per year
	const STOCK_YEARS = 150;         // warehouse size in years of need
	const STOCK_BASE = 50;           // t of slack on top of that
	const ABANDON_YEARS = 20;        // consecutive years at the pop floor with comfort < 0.4

	/* §4 step 7: the ladder. Only town and city may sponsor an expansion. */
	const STAGE_OUTPOST = 0, STAGE_SETTLEMENT = 1, STAGE_TOWN = 2, STAGE_CITY = 3;
	const STAGE_NAMES = ['outpost', 'settlement', 'town', 'city'];
	const STAGE_MIN_POP = new Float64Array([0, 2, 10, 40]);   // k persons
	const STAGE_SPONSORS = new Uint8Array([0, 0, 1, 1]);

	/* Step-level transitions emitted to an optional advanceColony callback. */
	const EVENT_STAGE = 0, EVENT_FAMINE = 1, EVENT_RECOVERY = 2;

	/* §6: the market tags. No money in this stage. */
	const TAG_SURPLUS = 0, TAG_FAIR = 1, TAG_SCARCE = 2;
	const TAG_NAMES = ['surplus', 'fair', 'scarce'];
	const SURPLUS_SUPPLY = 0.72;
	const SCARCE_SUPPLY = 0.42;

	/* §7: a port never gives away its own two-year need. */
	const GUARD_YEARS = 2;

	/* --- §3 the resource map ----------------------------------------------- */

	function clamp01(v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	function createMap() {
		return { planetKey: 0, ease: new Float64Array(ALL), score: 0, metalRich: 0, lumNorm: 0 };
	}

	/*
	 * The system aggregates (§3): every star-level ease reads these.
	 * `out` of length 6: metalRich, lumNorm, rockyFrac, giantFrac, beltFrac,
	 * terranFrac — the caller passes a Float64Array(6).
	 */
	function systemFractions(world, out) {
		let rocky = 0, giants = 0, terran = 0;
		for (let i = 0; i < world.planetCount; i++) {
			const type = world.planetType[i];
			if (type === World.TYPE_ROCK || type === World.TYPE_SUPER
				|| type === World.TYPE_DWARF) rocky++;
			else if (type === World.TYPE_MINI || type === World.TYPE_GAS
				|| type === World.TYPE_ICE) giants++;
			if (type === World.TYPE_TERRAN) terran++;
		}
		const belts = world.beltCount;
		const beltTwice = belts * 2;
		const planets = world.planetCount;
		out[0] = clamp01(world.metal / 0.030);
		/* sqrt, not linear: the eye of the range is where life is comfortable. */
		out[1] = clamp01(Math.sqrt(world.lum) / LUM_FULL);
		out[2] = clamp01((rocky + beltTwice) / (planets + beltTwice));
		out[3] = clamp01(giants / planets);
		out[4] = clamp01(belts / 2);
		out[5] = clamp01(terran / TERRAN_FULL);
		return out;
	}

	const FRACTIONS = new Float64Array(6);
	/* Saturating count: four terran worlds already make a life-rich system. */
	const TERRAN_FULL = 4;
	/* A 2.25 L sun already reads as the top of the light scale. */
	const LUM_FULL = 1.5;

	/*
	 * Ease for one colony. The four geology goods come off the star (the system
	 * owns its metals, giants and light); food and colonists come off the world
	 * the colony stands on — people farm and multiply where they live, not where
	 * the star is. Breaking the split there is what makes a terran site a farm
	 * and a barren rock in the same system a camp.
	 */
	function writeInterEase(map, world, planet, fractions, seed) {
		const metalRich = fractions[0], lumNorm = fractions[1], rockyFrac = fractions[2],
			giantFrac = fractions[3], beltFrac = fractions[4], terranFrac = fractions[5];
		const habitat = world.planetHabitat[planet];
		const ease = map.ease;
		ease[RARE] = 0.15 + 0.85 * metalRich * (0.35 + 0.65 * rockyFrac);
		ease[EXOTIC] = 0.10 + 0.55 * giantFrac + 0.20 * beltFrac + 0.15 * lumNorm;
		ease[ANTIMATTER] = 0.05 + 0.95 * lumNorm;
		ease[FOOD] = 0.05 + habitat * (0.60 + 0.20 * lumNorm + 0.15 * terranFrac);
		ease[FABRICATORS] = 0.20 + 0.50 * ease[RARE] + 0.30 * lumNorm;
		ease[INFO] = 0.30;               // culture is population, not geography
		ease[COLONISTS] = 0.10 + 0.70 * habitat + 0.20 * terranFrac;
		map.metalRich = metalRich;
		map.lumNorm = lumNorm;
		jitter(map, seed, 0x50, RARE, ALL);
	}

	/* Planet-level ease, written into map.ease[BULK…MIGRANTS]. */
	function writeIntraEase(map, world, planet, seed) {
		const type = world.planetType[planet];
		const metal = world.planetMetal[planet];
		const habitat = world.planetHabitat[planet];
		const rockWeight = World.TYPE_ROCK_WEIGHT[type];
		const ease = map.ease;
		ease[BULK] = 0.10 + 0.90 * clamp01(metal) * (0.40 + 0.60 * rockWeight);
		ease[GOODS] = 0.20 + 0.50 * ease[BULK] + 0.30 * habitat;
		ease[MIGRANTS] = 0.10 + 0.80 * habitat;
		jitter(map, seed, 0xA0, BULK, INTRA);
	}

	/*
	 * The stable jitter (§3): ±0.06 off the identity key, so the same seed and
	 * planet reproduce the same map in every session.
	 */
	function jitter(map, seed, salt, from, to) {
		if (map.noJitter) return;
		const ease = map.ease;
		const key = World.hashBits(seed, salt, map.planetKey);
		for (let r = from; r < to; r++) {
			const draw = World.hashBits(key, r, salt) / 4294967296;
			ease[r] = clamp01(ease[r] + (draw - 0.5) * 0.12);
		}
	}

	/*
	 * `resourceMapFor(world, planet, seed, out)` — the planet's colony map. The
	 * founding score mixes the two tiers (§3): the system's star terms carry half
	 * of it, the planet's own habitat and rock the other half, so a barren rock
	 * in a rich system is a mining camp and a terran world in a poor one is a
	 * farm — both viable, neither free.
	 */
	function resourceMapFor(world, planet, seed, out, jitterOn) {
		out.noJitter = jitterOn === false;
		out.planetKey = planet >>> 0;
		systemFractions(world, FRACTIONS);
		writeInterEase(out, world, planet, FRACTIONS, seed);
		writeIntraEase(out, world, planet, seed);
		out.score = clamp01(0.35 * out.ease[FOOD] + 0.15 * out.ease[RARE]
			+ 0.10 * out.ease[FABRICATORS] + 0.25 * out.ease[MIGRANTS]
			+ 0.15 * out.ease[BULK]);
		return out;
	}

	/* --- §4 the colony record ---------------------------------------------- */

	function createColony(planet, name, foundedY, map) {
		return {
			planet: planet | 0,
			name: String(name || ''),
			map: map,
			ease: map.ease,
			foundedY: foundedY,
			lastY: foundedY,
			pop: 1 + 9 * map.score,        // k persons
			capital: 1 + 5 * map.score,    // industrial points
			stock: new Float64Array(ALL),  // t
			comfort: 1,
			coarse: false,
			stage: STAGE_OUTPOST,
			starving: false,
			starveFor: 0,                  // consecutive starving years
			advances: 0,
			idx: -1
		};
	}

	/* §4 step 7: the ladder a population sits on. */
	function stageFor(pop) {
		if (pop >= STAGE_MIN_POP[STAGE_CITY]) return STAGE_CITY;
		if (pop >= STAGE_MIN_POP[STAGE_TOWN]) return STAGE_TOWN;
		if (pop >= STAGE_MIN_POP[STAGE_SETTLEMENT]) return STAGE_SETTLEMENT;
		return STAGE_OUTPOST;
	}

	function warehouseCap(r, pop) {
		return STOCK_YEARS * pop * NEED[r] + STOCK_BASE;
	}

	function carryingCapacity(colony) {
		return 40 * (0.4 + 0.6 * colony.ease[FOOD]) * (1 + clamp01(colony.capital / 25));
	}

	function isAbandoned(colony) {
		return colony.pop <= POP_FLOOR && colony.starveFor >= ABANDON_YEARS;
	}

	/* --- §6 the market readout ---------------------------------------------- */

	function marketSupply(colony, r) {
		const needAnnual = colony.pop * NEED[r];
		const cap = 2 * needAnnual + 50;
		const stockNorm = cap > 0 ? clamp01(colony.stock[r] / cap) : 0;
		return clamp01(0.6 * colony.ease[r] + 0.4 * stockNorm);
	}

	function marketTag(colony, r) {
		const supply = marketSupply(colony, r);
		if (supply >= SURPLUS_SUPPLY) return TAG_SURPLUS;
		if (supply <= SCARCE_SUPPLY) return TAG_SCARCE;
		return TAG_FAIR;
	}

	function goodShortfall(colony, r) {
		const guard = GUARD_YEARS * colony.pop * NEED[r];
		return colony.stock[r] < guard ? guard - colony.stock[r] : 0;
	}

	/* The best export: the highest supply with stock above the two-year guard. */
	function bestExport(colony) {
		let best = -1;
		let bestSupply = 0;
		for (let r = 0; r < INTRA; r++) {
			if (!(NEED[r] > 0)) continue;
			if (colony.stock[r] <= GUARD_YEARS * colony.pop * NEED[r]) continue;
			const supply = marketSupply(colony, r);
			if (best < 0 || supply > bestSupply) {
				best = r;
				bestSupply = supply;
			}
		}
		return best;
	}

	/* The worst import: the lowest supply with a real shortfall against the guard. */
	function bestImport(colony) {
		let worst = -1;
		let worstSupply = 1;
		for (let r = 0; r < INTRA; r++) {
			if (!(NEED[r] > 0)) continue;
			if (colony.stock[r] >= GUARD_YEARS * colony.pop * NEED[r]) continue;
			const supply = marketSupply(colony, r);
			if (worst < 0 || supply < worstSupply) {
				worst = r;
				worstSupply = supply;
			}
		}
		return worst;
	}

	/* Readout helpers (event cadence, never per frame). */
	function formatPop(pop) {
		if (pop >= 1000) return (pop / 1000).toPrecision(3) + 'M';
		if (pop >= 100) return Math.round(pop) + 'k';
		return pop.toFixed(1) + 'k';
	}

	function easeBar(v) {
		const filled = Math.round(v * 5);
		let s = '';
		for (let i = 0; i < 5; i++) s += i < filled ? '█' : '░';
		return s;
	}

	const Econ = {
		INTRA, INTER, ALL, KIND_INTRA, KIND_INTER,
		BULK, GOODS, MIGRANTS, RARE, EXOTIC, ANTIMATTER, FOOD, FABRICATORS, INFO, COLONISTS,
		GOODS_TABLE, RATE, NEED, DRIVER,
		DRIVER_POP_40, DRIVER_POP_50, DRIVER_POP_100, DRIVER_CAPITAL, DRIVER_CAPITAL2, DRIVER_NONE,
		BASE_DT, MAX_STEPS, G_MAX, FAMINE_RATE, FAMINE_COMFORT, FAMINE_RECOVERY,
		POP_FLOOR, CAPITAL_FLOOR, CAPITAL_GAIN, CAPITAL_DECAY,
		STOCK_YEARS, STOCK_BASE, ABANDON_YEARS,
		STAGE_OUTPOST, STAGE_SETTLEMENT, STAGE_TOWN, STAGE_CITY, STAGE_NAMES,
		STAGE_MIN_POP, STAGE_SPONSORS,
		EVENT_STAGE, EVENT_FAMINE, EVENT_RECOVERY,
		TAG_SURPLUS, TAG_FAIR, TAG_SCARCE, TAG_NAMES, SURPLUS_SUPPLY, SCARCE_SUPPLY, GUARD_YEARS,
		clamp01, createMap, systemFractions, resourceMapFor,
		createColony, advanceColony, stageFor, warehouseCap, carryingCapacity, isAbandoned,
		marketSupply, marketTag, goodShortfall, bestExport, bestImport,
		formatPop, easeBar
	};

	/*
	 * §4: the growth law. Fixed step while the span allows; a span over
	 * MAX_STEPS·BASE_DT coarsens to span/MAX_STEPS and flags `coarse`. Same
	 * (record, span) → same result, chunking included. Module scratch keeps the
	 * step allocation-free.
	 */
	const PROD = new Float64Array(ALL);

	function advanceColony(colony, toY, onEvent) {
		const span = toY - colony.lastY;
		if (!(span > 0)) return colony;
		let steps = Math.ceil(span / BASE_DT);
		const coarse = steps > MAX_STEPS;
		if (coarse) steps = MAX_STEPS;
		const dt = coarse ? span / MAX_STEPS : BASE_DT;
		const startY = colony.lastY;
		const ease = colony.ease;
		const stock = colony.stock;
		let pop = colony.pop;
		let capital = colony.capital;
		let comfort = 1;
		let stage = colony.stage;
		let starving = colony.starving;
		let starveFor = colony.starveFor;

		for (let s = 0; s < steps; s++) {
			let shortfallSum = 0, needSum = 0, surplusSum = 0;
			const popDriver = clamp01(pop / 40);
			const pop50 = clamp01(pop / 50);
			const pop100 = clamp01(pop / 100);
			const cap = clamp01(capital / 25);
			for (let r = 0; r < ALL; r++) {
				const need = pop * NEED[r] * dt;
				let driver;
				switch (DRIVER[r]) {
					case DRIVER_POP_40: driver = popDriver; break;
					case DRIVER_POP_50: driver = pop50; break;
					case DRIVER_POP_100: driver = pop100; break;
					case DRIVER_CAPITAL: driver = cap; break;
					case DRIVER_CAPITAL2: driver = cap * cap; break;
					default: driver = 0;
				}
				const prod = driver > 0 ? ease[r] * RATE[r] * driver * dt : 0;
				PROD[r] = prod;
				const have = stock[r] + prod;
				const take = have < need ? have : need;
				let left = have - take;
				const capStock = STOCK_YEARS * pop * NEED[r] + STOCK_BASE;
				if (left > capStock) left = capStock;
				stock[r] = left;
				const short = need - take;
				shortfallSum += short;
				needSum += need;
				if (prod > need) surplusSum += prod - need;
			}
			comfort = needSum > 0 ? 1 - shortfallSum / needSum : 1;

			const K = 40 * (0.4 + 0.6 * ease[FOOD]) * (1 + cap);
			let dPop = G_MAX * comfort * (1 - pop / K) * pop * dt;
			const stepY = startY + (s + 1) * dt;
			if (comfort < FAMINE_COMFORT) {
				dPop -= FAMINE_RATE * pop * dt;
				if (!starving) {
					starving = true;
					colony.pop = pop;
					colony.comfort = comfort;
					colony.starving = true;
					if (onEvent) onEvent(EVENT_FAMINE, colony, stepY, comfort);
				}
			} else if (starving && comfort >= FAMINE_RECOVERY) {
				starving = false;
				colony.pop = pop;
				colony.comfort = comfort;
				colony.starving = false;
				if (onEvent) onEvent(EVENT_RECOVERY, colony, stepY, comfort);
			}
			pop += dPop;
			if (dPop > 0 && pop > K) pop = K;
			if (pop <= POP_FLOOR) {
				pop = POP_FLOOR;
				if (starving) starveFor += dt;
				else starveFor = 0;
			} else {
				starveFor = 0;
			}
			if (!starving) {
				const nextStage = stageFor(pop);
				while (stage < nextStage) {
					stage++;
					colony.pop = pop;
					colony.comfort = comfort;
					colony.stage = stage;
					if (onEvent) onEvent(EVENT_STAGE, colony, stepY, stage);
				}
			}

			/* surplusSum is already scaled by dt (tons produced − needed in this step) */
			capital += CAPITAL_GAIN * comfort * surplusSum - CAPITAL_DECAY * capital * dt;
			if (capital < CAPITAL_FLOOR) capital = CAPITAL_FLOOR;
		}

		colony.pop = pop;
		colony.capital = capital;
		colony.comfort = comfort;
		colony.starving = starving;
		colony.starveFor = starveFor;
		colony.stage = stage;
		colony.coarse = coarse;
		colony.lastY = toY;
		colony.advances++;
		return colony;
	}

	if (typeof module !== 'undefined' && module.exports) module.exports = Econ;
	else root.OrbitEcon = Econ;
})(typeof globalThis !== 'undefined' ? globalThis : this);
