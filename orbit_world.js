/*
 * The trade world's geometry and natural traits.
 *
 * 26 static planet cores in a 1600x1000 field, flown inside a 2400x1500 play
 * area (the field plus a quarter of it on every side). Each core has a station
 * riding a fixed ellipse (closed form, so no motion is integrated) and the
 * traits the economy reads: type, metal, light, habitat. The station needs only
 * the ellipse; the colony economy needs the traits.
 *
 * Determinism: placement consumes the *caller's* random stream, in exactly the
 * order the simulation always drew it, so adding traits here cannot move a
 * planet or change which port makes which good. The traits themselves come from
 * a separate stream, derived from the seed, and are therefore stable across
 * reloads but independent of placement luck.
 */
(function (root) {
	'use strict';

	const PLANETS = 26;
	const INITIAL_PORTS = 8;
	const WORLD_W = 1600;
	const WORLD_H = 1000;
	/* The flight area is the planet field grown by half of itself on every side
	 * (1.5× in each dimension). Planets are placed and drawn inside the field;
	 * a ship may leave that framed canvas and keep flying until the area's own
	 * edge. This one ratio is the only place the area is defined: the sim's
	 * bounds, the bot's probes and the zoomed-out view all derive from it. */
	const AREA_SCALE = 1.5;
	const AREA_PAD_X = WORLD_W * (AREA_SCALE - 1) / 2;
	const AREA_PAD_Y = WORLD_H * (AREA_SCALE - 1) / 2;
	const AREA_W = WORLD_W + AREA_PAD_X * 2;
	const AREA_H = WORLD_H + AREA_PAD_Y * 2;
	const TAU = Math.PI * 2;

	/* Special-planet kinds (0.5.11): one A.R.F. world and one Empire Capital
	 * per seed, chosen among the first four planets so every legal universe
	 * (PLANET_UNIVERSE_MIN = 4) keeps both in play. */
	const KIND_NORMAL = 0, KIND_ARF = 1, KIND_CAPITAL = 2;
	const SPECIAL_COUNT = 4;
	const SALT_SPECIAL = 0x517e;

	/* Type indices are the economy's table order (orbit_econ.js reads them). */
	const TYPE_ROCK = 0, TYPE_TERRAN = 1, TYPE_SUPER = 2, TYPE_DWARF = 3,
		TYPE_MINI = 4, TYPE_GAS = 5, TYPE_ICE = 6;
	const TYPE_NAMES = ['rock', 'terran', 'super', 'dwarf', 'mini', 'gas', 'ice giant'];
	const TYPE_COUNT = TYPE_NAMES.length;

	/* Carrying habitat per type, before the light and luck factors (§2). */
	const TYPE_HABITAT = new Float64Array([0.35, 1.00, 0.04, 0.12, 0.16, 0.18, 0.20]);
	/* Mineable bulk per type — what `bulk` production multiplies (§3). */
	const TYPE_ROCK_WEIGHT = new Float64Array([1.00, 0.50, 0.90, 0.70, 0.50, 0.25, 0.30]);
	/* Metallicity per type, relative to solar (the system mean scales the Z). */
	const TYPE_METAL = new Float64Array([1.00, 0.65, 1.15, 0.85, 0.60, 0.30, 0.35]);

	/*
	 * Cumulative type weights per orbit band: inner worlds are hot rock, the
	 * middle band is where terran worlds live, the outer band is ice and gas.
	 * Flat cumulative tables keep the draw one compare chain (§2).
	 */
	const BAND_TYPES = new Float64Array([
		0.55, 0.55, 0.75, 0.85, 1.00, 1.00, 1.00,   // inner
		0.28, 0.62, 0.72, 0.76, 0.90, 0.96, 1.00,   // middle
		0.08, 0.10, 0.20, 0.23, 0.38, 0.72, 1.00    // outer
	]);

	function seedRandom(seed) {
		let a = seed >>> 0;
		return function () {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/* A 32-bit avalanche: the economy's stable jitter draws (§3). */
	function hash32(value) {
		let h = value >>> 0;
		h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
		h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
		h ^= h >>> 16;
		return h >>> 0;
	}

	/* An integer draw: chaining two hashes must not go through a float. */
	function hashBits(seed, a, b) {
		return hash32(seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77));
	}

	function hash01(seed, a, b) {
		return hashBits(seed, a, b) / 4294967296;
	}

	function clamp01(v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	/*
	 * Geometry: draws from `rand` in the historical order (positions, then the
	 * spaced initial planets, then the orbit of each planet). `seed` only keys
	 * the trait stream.
	 */
	function create(seed, rand) {
		const world = {
			seed: seed >>> 0,
			planetCount: PLANETS,
			planetX: new Float64Array(PLANETS),
			planetY: new Float64Array(PLANETS),
			planetR: new Float64Array(PLANETS),
			orbitRX: new Float64Array(PLANETS),
			orbitRY: new Float64Array(PLANETS),
			orbitPhase: new Float64Array(PLANETS),
			orbitOmega: new Float64Array(PLANETS),
			orbitTilt: new Float64Array(PLANETS),
			orbitTiltCos: new Float64Array(PLANETS),
			orbitTiltSin: new Float64Array(PLANETS),
			initialPlanets: new Uint8Array(PLANETS),
			planetType: new Uint8Array(PLANETS),
			planetMetal: new Float64Array(PLANETS),
			planetLight: new Float64Array(PLANETS),
			planetHabitat: new Float64Array(PLANETS),
			planetKind: new Uint8Array(PLANETS),
			capitalPlanet: -1,
			arfPlanet: -1,
			beltCount: 0,
			metal: 0,
			lum: 0
		};
		placePlanets(world, rand, INITIAL_PORTS);
		placeOrbits(world, rand);
		placeTraits(world);
		placeSpecials(world);
		return world;
	}

	/*
	 * The two specials are keyed off the seed alone (hashBits, never rand), so
	 * geometry and colony placement consume exactly the historical random
	 * stream and a replay of the same seed selects the same specials. Two
	 * distinct indices among the first four planets: the Capital takes the
	 * first draw, the A.R.F. world one of the remaining three.
	 */
	function placeSpecials(world) {
		const capital = hashBits(world.seed, 0, SALT_SPECIAL) % SPECIAL_COUNT;
		let arf = hashBits(world.seed, 1, SALT_SPECIAL) % (SPECIAL_COUNT - 1);
		if (arf >= capital) arf += 1;
		world.capitalPlanet = capital;
		world.arfPlanet = arf;
		world.planetKind[capital] = KIND_CAPITAL;
		world.planetKind[arf] = KIND_ARF;
	}

	function planetKind(world, planet) {
		return world.planetKind[planet];
	}

	function placePlanets(world, rand, initialPorts) {
		const x = world.planetX;
		const y = world.planetY;
		for (let i = 0; i < PLANETS; i++) {
			let placed = false;
			for (let attempt = 0; attempt < 300 && !placed; attempt++) {
				const px = 110 + rand() * (WORLD_W - 220);
				const py = 90 + rand() * (WORLD_H - 180);
				placed = true;
				for (let j = 0; j < i; j++) {
					const dx = px - x[j];
					const dy = py - y[j];
					if (dx * dx + dy * dy < 165 * 165) {
						placed = false;
						break;
					}
				}
				if (placed) {
					x[i] = px;
					y[i] = py;
				}
			}
			if (placed) continue;
			/* fallback keeps generation bounded: take the roomiest of a few samples */
			let bestX = 0;
			let bestY = 0;
			let bestGap = -1;
			for (let sample = 0; sample < 80; sample++) {
				const px = 110 + rand() * (WORLD_W - 220);
				const py = 90 + rand() * (WORLD_H - 180);
				let gap = Infinity;
				for (let j = 0; j < i; j++) {
					const dx = px - x[j];
					const dy = py - y[j];
					const d2 = dx * dx + dy * dy;
					if (d2 < gap) gap = d2;
				}
				if (gap > bestGap) {
					bestGap = gap;
					bestX = px;
					bestY = py;
				}
			}
			x[i] = bestX;
			y[i] = bestY;
		}

		/* initial stations spread over the field, never two on one planet */
		const initial = world.initialPlanets;
		let pick = Math.floor(rand() * PLANETS);
		for (let k = 0; k < initialPorts; k++) {
			initial[k] = pick;
			let best = -1;
			let bestGap = -1;
			for (let i = 0; i < PLANETS; i++) {
				if (containsBefore(initial, k, i)) continue;
				let gap = Infinity;
				for (let j = 0; j < k + 1; j++) {
					const other = initial[j];
					const dx = x[i] - x[other];
					const dy = y[i] - y[other];
					const d2 = dx * dx + dy * dy;
					if (d2 < gap) gap = d2;
				}
				if (gap > bestGap) {
					bestGap = gap;
					best = i;
				}
			}
			pick = best;
		}
	}

	function containsBefore(list, count, value) {
		for (let i = 0; i < count; i++) {
			if (list[i] === value) return true;
		}
		return false;
	}

	function placeOrbits(world, rand) {
		for (let i = 0; i < PLANETS; i++) {
			const room = Math.min(world.planetX[i], world.planetY[i],
				WORLD_W - world.planetX[i], WORLD_H - world.planetY[i]) - 24;
			const maxR = Math.max(58, Math.min(180, room));
			const tilt = rand() * Math.PI;
			const period = 160 + rand() * 240;
			world.planetR[i] = 6 + rand() * 5;
			world.orbitRX[i] = 46 + rand() * (maxR - 46);
			world.orbitRY[i] = 46 + rand() * (maxR - 46);
			world.orbitPhase[i] = rand() * TAU;
			world.orbitOmega[i] = (rand() < 0.5 ? -1 : 1) * TAU / period;
			world.orbitTilt[i] = tilt;
			world.orbitTiltCos[i] = Math.cos(tilt);
			world.orbitTiltSin[i] = Math.sin(tilt);
		}
	}

	/*
	 * Traits (§2): type by orbit band, then metal, light and habitat from the
	 * type. Light is inverse-square of the orbit, normalised so the innermost
	 * planet is 1 — a dim outer world cannot make food however terran it is.
	 */
	function placeTraits(world) {
		const rand = seedRandom(world.seed ^ 0x5eed1);
		let minMean = Infinity;
		let maxMean = -Infinity;
		for (let i = 0; i < PLANETS; i++) {
			const mean = (world.orbitRX[i] + world.orbitRY[i]) * 0.5;
			world.planetLight[i] = mean;   // scratch: the orbit mean
			if (mean < minMean) minMean = mean;
			if (mean > maxMean) maxMean = mean;
		}
		const span = maxMean - minMean;
		let metalSum = 0;
		for (let i = 0; i < PLANETS; i++) {
			const mean = world.planetLight[i];
			const band = span > 0 ? (mean - minMean) / span : 0.5;
			const row = band < 0.34 ? 0 : band < 0.68 ? 1 : 2;
			const draw = rand();
			const table = row * TYPE_COUNT;
			let type = TYPE_ROCK;
			for (let t = 0; t < TYPE_COUNT; t++) {
				if (draw < BAND_TYPES[table + t]) { type = t; break; }
			}
			world.planetType[i] = type;
			world.planetMetal[i] = TYPE_METAL[type] * (0.70 + 0.60 * rand());
			world.planetLight[i] = (minMean * minMean) / (mean * mean);
			const lightFit = clamp01(1 - Math.abs(Math.log2(world.planetLight[i])) / 3);
			world.planetHabitat[i] = clamp01(
				TYPE_HABITAT[type] * (0.55 + 0.45 * lightFit) * (0.85 + 0.3 * rand()));
			metalSum += world.planetMetal[i];
		}
		world.beltCount = rand() < 0.5 ? 0 : rand() < 0.75 ? 1 : 2;
		/* A K/M dwarf through an A star, log-uniform, sun = 1 L. */
		world.lum = 0.06 * Math.pow(10, 1.6 * rand());
		/* The system's metallicity Z: solar 0.020 scaled by the mean world. */
		world.metal = 0.020 * (metalSum / PLANETS) * (0.35 + 1.3 * rand());
	}

	/*
	 * Hand the world's arrays to a simulation record under its historical
	 * names, so every reader of `sim.planetX` keeps working unchanged.
	 */
	function attach(target, world) {
		target.world = world;
		target.planetCount = world.planetCount;
		target.planetX = world.planetX;
		target.planetY = world.planetY;
		target.planetR = world.planetR;
		target.orbitRX = world.orbitRX;
		target.orbitRY = world.orbitRY;
		target.orbitPhase = world.orbitPhase;
		target.orbitOmega = world.orbitOmega;
		target.orbitTilt = world.orbitTilt;
		target.orbitTiltCos = world.orbitTiltCos;
		target.orbitTiltSin = world.orbitTiltSin;
		target.initialPlanets = world.initialPlanets;
		target.planetType = world.planetType;
		target.planetMetal = world.planetMetal;
		target.planetLight = world.planetLight;
		target.planetHabitat = world.planetHabitat;
		target.planetKind = world.planetKind;
		target.capitalPlanet = world.capitalPlanet;
		target.arfPlanet = world.arfPlanet;
		target.beltCount = world.beltCount;
		target.metal = world.metal;
		target.lum = world.lum;
	}

	/* The station/trade port on planet `i` at trade time `t` — closed form. */
	function planetXAt(world, planet, time) {
		const angle = world.orbitPhase[planet] + world.orbitOmega[planet] * time;
		const rx = world.orbitRX[planet] * Math.cos(angle);
		const ry = world.orbitRY[planet] * Math.sin(angle);
		return world.planetX[planet] + rx * world.orbitTiltCos[planet]
			- ry * world.orbitTiltSin[planet];
	}

	function planetYAt(world, planet, time) {
		const angle = world.orbitPhase[planet] + world.orbitOmega[planet] * time;
		const rx = world.orbitRX[planet] * Math.cos(angle);
		const ry = world.orbitRY[planet] * Math.sin(angle);
		return world.planetY[planet] + rx * world.orbitTiltSin[planet]
			+ ry * world.orbitTiltCos[planet];
	}

	const OrbitWorld = {
		PLANETS, INITIAL_PORTS, WORLD_W, WORLD_H, TAU,
		AREA_SCALE, AREA_W, AREA_H, AREA_PAD_X, AREA_PAD_Y,
		KIND_NORMAL, KIND_ARF, KIND_CAPITAL, SPECIAL_COUNT,
		TYPE_ROCK, TYPE_TERRAN, TYPE_SUPER, TYPE_DWARF, TYPE_MINI, TYPE_GAS, TYPE_ICE,
		TYPE_NAMES, TYPE_COUNT, TYPE_HABITAT, TYPE_ROCK_WEIGHT,
		seedRandom, hashBits, hash01, clamp01,
		create, attach, planetKind, planetXAt, planetYAt
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = OrbitWorld;
	else root.OrbitWorld = OrbitWorld;
})(typeof globalThis !== 'undefined' ? globalThis : this);
