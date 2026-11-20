/*
 * The map generator helper's logic: a designed gravity roster turned into a
 * concrete field on the game's own grid, the launch tier of a well, and the
 * `map_fields.js` registry format.
 *
 * The page (`map-generator-helper.htm`) draws this and nothing else; every
 * number here comes from the shipped tables — `planet_gravity.js` for the
 * field, `orbit_sim.js` for the well, `orbit_tech.js` for the rails — so a
 * retuned EMC or a moved gravity ceiling recolours the design without an edit.
 */
(function (root) {
	'use strict';

	const PlanetGravity = typeof module !== 'undefined' && module.exports
		? require('./planet_gravity.js')
		: root.PlanetGravity;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;

	/* --- the launch model ------------------------------------------------ */

	/* A ship launches from the surface of a planet and typically has to reach
	 * the next system, not infinity: the well radius it starts at is a planet
	 * radius plus the spawn gap (`planetR` 6–11, `SPAWN_GAP` 8 in the sim), and
	 * a neighbour in the 1600×1000 field with 13–26 worlds sits about 220 px
	 * away (`placePlanets` keeps at least 165). The climb is the potential
	 * difference between the two, on the softened Plummer well the sim flies. */
	const SURFACE_R = 17;
	const NEIGHBOUR_GAP = 220;

	function wellDepth(radius) {
		return 1 / Math.sqrt(radius * radius + GravitySim.SOFT * GravitySim.SOFT);
	}

	/* px/s a launch needs to climb from the surface to `gap` in a well of
	 * strength `gravity`; 0 for a world that pushes out instead of holding */
	function launchSpeed(gravity, gap) {
		if (!(gravity > 0)) return 0;
		const climb = wellDepth(SURFACE_R) - wellDepth(gap === undefined ? NEIGHBOUR_GAP : gap);
		return Math.sqrt(Math.max(0, 2 * GravitySim.MU * gravity * climb));
	}

	/* the gravity a rail of `speed` px/s can just climb out of — the boundary a
	 * roster colour changes at, and the gradient the chart is shaded by */
	function gravityForSpeed(speed, gap) {
		const climb = wellDepth(SURFACE_R) - wellDepth(gap === undefined ? NEIGHBOUR_GAP : gap);
		if (!(climb > 0) || !(speed > 0)) return Infinity;
		return speed * speed / (2 * GravitySim.MU * climb);
	}

	function tierLimits(caps, gap) {
		return [gravityForSpeed(caps[0], gap), gravityForSpeed(caps[1], gap)];
	}

	/* the fastest launch each starter pad affords for a ship of `mass` tonnes */
	function railCaps(mass, forceScale) {
		const scale = forceScale === undefined ? 1 : forceScale;
		const caps = [];
		for (let i = 0; i < 2; i++) {
			caps.push(OrbitTech.speedLimit(OrbitTech.BATTERIES[i].capacity,
				mass, OrbitTech.CATAPULTS[i], scale));
		}
		return caps;
	}

	/* 0 = no well (nothing to escape), 1 = the first rail lifts it, 2 = the
	 * second one does, 3 = beyond both */
	function tierOf(gravity, caps, gap) {
		if (!(gravity > 0)) return 0;
		const speed = launchSpeed(gravity, gap);
		if (speed <= caps[0]) return 1;
		if (speed <= caps[1]) return 2;
		return 3;
	}

	/* --- the roster ------------------------------------------------------ */

	function clampNumber(value, lo, hi, fallback) {
		const n = Number(value);
		if (!Number.isFinite(n)) return fallback;
		return Math.min(hi, Math.max(lo, n));
	}

	/* one row per planet group: its gravity, the ± margin the draw may move in,
	 * and how many worlds it stands for. Values land on the game's grid. */
	function normaliseRows(rows) {
		const out = [];
		if (!Array.isArray(rows)) return out;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i] || {};
			out.push({
				g: PlanetGravity.snap(clampNumber(row.g, PlanetGravity.MIN, PlanetGravity.MAX, 0)),
				m: clampNumber(row.m, 0, PlanetGravity.MAX - PlanetGravity.MIN, 0),
				count: Math.max(0, Math.floor(clampNumber(row.count, 0, OrbitWorld.PLANETS, 0)))
			});
		}
		return out;
	}

	function rosterSize(rows) {
		let total = 0;
		for (let i = 0; i < rows.length; i++) total += rows[i].count;
		return total;
	}

	/* Planets in roster order, so the first row heads the field: the specials
	 * take the first four planets and the page draws the list left to right. */
	function drawField(rows, seed) {
		const list = normaliseRows(rows);
		const rand = OrbitWorld.seedRandom(seed >>> 0);
		const values = [];
		for (let i = 0; i < list.length; i++) {
			const row = list[i];
			for (let n = 0; n < row.count; n++) {
				values.push(PlanetGravity.snap(row.g + (rand() * 2 - 1) * row.m));
			}
		}
		return values;
	}

	/* The game's own draw for one seed: `gravity(seed, p)` for p in 0..n — the
	 * field a run of that universe plays, with no roster behind it. The helper's
	 * seed-map panel puts this on the line to debug the generator itself. */
	function originalDraw(seed, n) {
		const count = Math.floor(clampNumber(n, 0, OrbitWorld.PLANETS, 0));
		const values = [];
		for (let p = 0; p < count; p++) values.push(PlanetGravity.seededGravity(seed >>> 0, p));
		return values;
	}

	/* --- distributions --------------------------------------------------- */

	const BIN_WIDTH = 0.25;
	const BIN_COUNT = Math.round((PlanetGravity.MAX - PlanetGravity.MIN) / BIN_WIDTH);

	function emptyBins() {
		return new Array(BIN_COUNT).fill(0);
	}

	function binOf(gravity) {
		const index = Math.floor((gravity - PlanetGravity.MIN) / BIN_WIDTH);
		return index < 0 ? 0 : index >= BIN_COUNT ? BIN_COUNT - 1 : index;
	}

	function addToBins(bins, values) {
		for (let i = 0; i < values.length; i++) bins[binOf(values[i])] += 1;
		return bins;
	}

	function binLabel(index) {
		const lo = PlanetGravity.MIN + index * BIN_WIDTH;
		return lo.toFixed(2) + '…' + (lo + BIN_WIDTH).toFixed(2);
	}

	/* What the generator itself produces for a universe of `universe` planets:
	 * the real draw over `seeds` seeds, as a share per bin. This is the shape a
	 * roster has to be compared against, not a uniform rectangle. */
	function baselineShare(universe, seeds) {
		const bins = emptyBins();
		const count = seeds === undefined ? 120 : seeds;
		const planets = Math.max(1, Math.min(universe | 0, OrbitWorld.PLANETS));
		for (let seed = 1; seed <= count; seed++) {
			addToBins(bins, originalDraw(seed, planets));
		}
		const total = count * planets;
		for (let i = 0; i < BIN_COUNT; i++) bins[i] /= total;
		return bins;
	}

	/* what each saved map in the registry really carries, by seed */
	function savedMapFields(records) {
		const out = [];
		if (!Array.isArray(records)) return out;
		for (let i = 0; i < records.length; i++) {
			const record = records[i] || {};
			const universe = Math.floor(clampNumber(record.universe, 1, OrbitWorld.PLANETS, 0));
			if (!(universe > 0)) continue;
			out.push({
				name: record.name || 'map ' + i,
				seed: record.seed >>> 0,
				universe: universe,
				values: originalDraw(record.seed, universe)
			});
		}
		return out;
	}

	/* --- the field report ------------------------------------------------ */

	/* Planets a career needs under `OPENING_BUILD_GRAVITY_MAX` (1.5) to land its
	 * first flights on: fewer than one per company is a map nobody can open on. */
	const LIGHT_GRAVITY_MAX = 1.5;

	function fieldStats(values, mass, gap) {
		const caps = railCaps(mass || OrbitTech.SHIP_DRY_MASS);
		const tiers = [0, 0, 0, 0];
		let light = 0;
		for (let i = 0; i < values.length; i++) {
			tiers[tierOf(values[i], caps, gap)] += 1;
			if (values[i] <= LIGHT_GRAVITY_MAX) light += 1;
		}
		return { n: values.length, tiers: tiers, light: light, caps: caps };
	}

	/* --- the registry ---------------------------------------------------- */

	const FIELDS_HEADER = '/* Designed planet gravity fields: the map generator helper\'s roster, the\n' +
		' * concrete draw it made and the ship the colours were read at. Written by\n' +
		' * the helper page (`map-generator-helper.htm`) — edit by designing, not by\n' +
		' * hand. Loading is just this file being present beside the page. */\n';

	const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

	function valueText(value, depth) {
		const pad = '\t'.repeat(depth);
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
		if (typeof value === 'boolean') return String(value);
		if (typeof value === 'string') return JSON.stringify(value);
		if (Array.isArray(value)) {
			if (value.length === 0) return '[]';
			let numbers = true;
			for (let i = 0; i < value.length; i++) {
				if (typeof value[i] !== 'number') { numbers = false; break; }
			}
			if (numbers) return '[' + value.join(', ') + ']';
			const rows = [];
			for (let i = 0; i < value.length; i++) rows.push(pad + '\t' + valueText(value[i], depth + 1));
			return '[\n' + rows.join(',\n') + '\n' + pad + ']';
		}
		const keys = Object.keys(value);
		if (keys.length === 0) return '{}';
		const rows = [];
		for (let i = 0; i < keys.length; i++) {
			const key = IDENT.test(keys[i]) ? keys[i] : JSON.stringify(keys[i]);
			rows.push(pad + '\t' + key + ': ' + valueText(value[keys[i]], depth + 1));
		}
		return '{\n' + rows.join(',\n') + '\n' + pad + '}';
	}

	/* the whole registry as a data script, the shape `saved_maps.js` uses */
	function fieldsText(fields) {
		return FIELDS_HEADER +
			'(function (root) {\n' +
			'\t\'use strict\';\n' +
			'\tconst FIELDS = ' + valueText(fields || [], 1) + ';\n' +
			'\tif (typeof module !== \'undefined\' && module.exports) module.exports = FIELDS;\n' +
			'\telse root.MAP_FIELDS = FIELDS;\n' +
			'})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
	}

	/* a record in the registry keeps its list under `gravity`; the page hands a
	 * fresh design in as `values`. Either way the list is re-snapped here. */
	function fieldRecord(input) {
		const source = Array.isArray(input.values) ? input.values : input.gravity;
		const values = Array.isArray(source) ? source.map(PlanetGravity.snap) : [];
		return {
			v: 1,
			kind: 'field',
			name: String(input.name || 'field'),
			universe: values.length,
			mass: clampNumber(input.mass, 1, 200, OrbitTech.SHIP_DRY_MASS),
			gap: clampNumber(input.gap, 50, 1200, NEIGHBOUR_GAP),
			seed: input.seed >>> 0,
			rows: normaliseRows(input.rows),
			gravity: values,
			note: String(input.note || '')
		};
	}

	/* a file from disk (or a hand edit) is only trusted as far as it parses */
	function readFields(list) {
		const out = [];
		if (!Array.isArray(list)) return out;
		for (let i = 0; i < list.length; i++) {
			const record = list[i];
			if (!record || !Array.isArray(record.gravity) || record.gravity.length === 0) continue;
			out.push(fieldRecord(record));
		}
		return out;
	}

	const MapGen = {
		SURFACE_R, NEIGHBOUR_GAP, BIN_WIDTH, BIN_COUNT, LIGHT_GRAVITY_MAX,
		wellDepth, launchSpeed, gravityForSpeed, tierLimits, railCaps, tierOf,
		normaliseRows, rosterSize, drawField, originalDraw,
		emptyBins, binOf, addToBins, binLabel, baselineShare, savedMapFields,
		fieldStats, fieldsText, fieldRecord, readFields
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = MapGen;
	else root.MapGen = MapGen;
})(typeof globalThis !== 'undefined' ? globalThis : this);
