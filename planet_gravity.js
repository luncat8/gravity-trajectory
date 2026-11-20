/*
 * The seeded planet gravity field: one hash draw per planet on a fixed 0.05
 * grid, softened through the middle band so moderate positive wells are the
 * common case and the tails stay rare.
 *
 * It lives here alone because three very different readers need the same draw
 * and must never disagree: `gravity_game.js` (the career rules, the seat search
 * and the field), the map-generator helper page (the design tool, which shows
 * the distribution this function produces) and the node benches.
 * `gravity_game.js` re-exports the constants and the function under its
 * historical names.
 */
(function (root) {
	'use strict';

	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;

	/* the draw's salt in the seed hash: fixed, it is the field's identity */
	const SALT_GRAVITY = 0xce;

	/* The field's range and resolution. `STEPS` is draws per unit of gravity,
	 * so the grid is 1/20 = 0.05 and `CHOICES` counts the reachable values. */
	const MIN = -1;
	const MAX = 3.5;
	const STEPS = 20;
	const CHOICES = (MAX - MIN) * STEPS + 1;

	/* The bias: between these values a sine wave pushes the drawn gravity down
	 * by up to `STRENGTH`, so the middle of the grid (the worlds a starter rail
	 * cannot leave) is thinner than a uniform draw would make it. */
	const BIAS_START = 0.6;
	const BIAS_END = 2.8;
	const BIAS_STRENGTH = 0.3;

	let activeField = null;

	function gravity(seed, planet) {
		if (activeField && (seed >>> 0) === activeField.seed &&
			Number.isInteger(planet) && planet >= 0 && planet < activeField.values.length) {
			return activeField.values[planet];
		}
		return seededGravity(seed, planet);
	}

	function seededGravity(seed, planet) {
		const u = OrbitWorld.hash01(seed, planet, SALT_GRAVITY);
		let g = MIN + (u * CHOICES - 0.5) / STEPS;
		if (g > BIAS_START && g < BIAS_END) {
			const wave = Math.sin(Math.PI * (g - BIAS_START) / (BIAS_END - BIAS_START));
			g -= BIAS_STRENGTH * wave * wave;
		}
		g = Math.round(g * STEPS) / STEPS;
		/* `=== 0` also folds the negative zero a rounded tiny value can carry */
		return g === 0 ? 0 : Math.max(MIN, Math.min(MAX, g));
	}

	/* snap any value to the field's grid and range: the one way a designed or
	 * rolled gravity becomes a value the game can actually hold */
	function snap(value) {
		if (!Number.isFinite(value)) return 0;
		const g = Math.round(value * STEPS) / STEPS;
		return g === 0 ? 0 : Math.max(MIN, Math.min(MAX, g));
	}

	/* The exact grid-index sequence is a collision-free identity for all opening
	 * caches; it also distinguishes a short field from a longer one. */
	function arm(values, seed) {
		if (!values || !Number.isInteger(values.length) || values.length < 1 ||
			values.length > OrbitWorld.PLANETS || !Number.isFinite(seed)) {
			throw new RangeError('invalid planet gravity field');
		}
		const copy = new Float64Array(values.length);
		let tag = '';
		for (let i = 0; i < values.length; i++) {
			if (!Number.isFinite(values[i])) throw new RangeError('invalid planet gravity value');
			copy[i] = snap(values[i]);
			tag += Math.round((copy[i] - MIN) * STEPS).toString(16).padStart(2, '0');
		}
		activeField = { values: copy, seed: seed >>> 0, tag: tag };
	}

	function disarm() {
		activeField = null;
	}

	function armed() {
		if (!activeField) return null;
		return { values: Array.from(activeField.values), seed: activeField.seed, tag: activeField.tag };
	}

	function tagForSeed(seed) {
		return activeField && (seed >>> 0) === activeField.seed ? activeField.tag : '';
	}

	const PlanetGravity = {
		SALT_GRAVITY, MIN, MAX, STEPS, CHOICES,
		BIAS_START, BIAS_END, BIAS_STRENGTH,
		gravity, seededGravity, snap, arm, disarm, armed, tagForSeed
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = PlanetGravity;
	else root.PlanetGravity = PlanetGravity;
})(typeof globalThis !== 'undefined' ? globalThis : this);
