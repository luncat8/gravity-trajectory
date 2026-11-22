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
	const MAX = 5;
	const STEPS = 20;
	const CHOICES = (MAX - MIN) * STEPS + 1;

	/* The draw's body: the hash lands on the -1 … 3.5 grid, and the heavy tail
	 * from `BIAS_END` up is stretched to `MAX`. Every world drawn below it keeps
	 * the value it always had, so the light worlds (and the openings planned on
	 * them) stay put while the heaviest reach +5. A uniform draw to +5 redraws
	 * every planet and cost the default career two fair seeds. */
	const BODY_MAX = 3.5;
	const BODY_CHOICES = (BODY_MAX - MIN) * STEPS + 1;

	/* The bias: between these values a sine wave pushes the drawn gravity down
	 * by up to `STRENGTH`, so the middle of the grid (the worlds a starter rail
	 * cannot leave) is thinner than a uniform draw would make it. */
	const BIAS_START = 0.6;
	const BIAS_END = 2.8;
	const BIAS_STRENGTH = 0.3;

	/* One optional designed field (`map_fields.js`), armed for a single seed so
	 * every reader (`gravity_game.js`, `gui_world.js`, the seat planner) sees it
	 * without changing its call sites, and another seed never reads it. */
	let armedField = null;
	let armedSeed = 0;
	let armedTag = 0;

	/* snap any value to the field's grid and range: the one way a designed or
	 * rolled gravity becomes a value the game can actually hold */
	function snap(value) {
		if (!Number.isFinite(value)) return 0;
		const g = Math.round(value * STEPS) / STEPS;
		return g === 0 ? 0 : Math.max(MIN, Math.min(MAX, g));
	}

	function fieldTag(values) {
		if (!values || !(values.length > 0)) return 0;
		let hash = 0x811c9dc5;
		hash = Math.imul(hash ^ values.length, 0x01000193);
		for (let i = 0; i < values.length; i++) {
			const step = Math.round(snap(values[i]) * STEPS) + 1024;
			hash = Math.imul(hash ^ step, 0x01000193);
		}
		return (hash >>> 0) || 1;
	}

	function arm(values, seed) {
		if (!values || !(Array.isArray(values) || ArrayBuffer.isView(values)) || values.length === 0) {
			disarm();
			return null;
		}
		const copy = new Float64Array(values.length);
		for (let i = 0; i < values.length; i++) copy[i] = snap(values[i]);
		armedField = copy;
		armedSeed = seed >>> 0;
		armedTag = fieldTag(copy);
		return armed();
	}

	function disarm() {
		armedField = null;
		armedSeed = 0;
		armedTag = 0;
	}

	function armed() {
		if (!armedField) return null;
		return { values: armedField, seed: armedSeed, tag: armedTag };
	}

	function gravity(seed, planet) {
		if (armedField && (seed >>> 0) === armedSeed && planet >= 0 && planet < armedField.length) {
			return armedField[planet];
		}
		const u = OrbitWorld.hash01(seed, planet, SALT_GRAVITY);
		let g = MIN + (u * BODY_CHOICES - 0.5) / STEPS;
		if (g > BIAS_START && g < BIAS_END) {
			const wave = Math.sin(Math.PI * (g - BIAS_START) / (BIAS_END - BIAS_START));
			g -= BIAS_STRENGTH * wave * wave;
		} else if (g >= BIAS_END) {
			g = BIAS_END + (g - BIAS_END) * (MAX - BIAS_END) / (BODY_MAX - BIAS_END);
		}
		g = Math.round(g * STEPS) / STEPS;
		/* `=== 0` also folds the negative zero a rounded tiny value can carry */
		return g === 0 ? 0 : Math.max(MIN, Math.min(MAX, g));
	}

	const PlanetGravity = {
		SALT_GRAVITY, MIN, MAX, STEPS, CHOICES, BODY_MAX,
		BIAS_START, BIAS_END, BIAS_STRENGTH,
		gravity, snap, fieldTag, arm, disarm, armed
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = PlanetGravity;
	else root.PlanetGravity = PlanetGravity;
})(typeof globalThis !== 'undefined' ? globalThis : this);
