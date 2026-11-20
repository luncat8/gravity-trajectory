/*
 * The map generator helper (0.7.35): the seeded field it designs against, the
 * roster it draws, the launch tiers it colours with, and the registry it saves.
 *
 * 1. `planet_gravity.js` is the draw `gravity_game.js` shipped: same values on
 *    every seed, still on the 0.05 grid inside the range, and the game's
 *    re-export is the same function.
 * 2. A roster normalises onto that grid and inside that range; a draw is
 *    deterministic per seed, keeps the roster's order and never leaves a row's
 *    margin.
 * 3. The launch tier is the rail's speed limit: `MapGen.tierLimits` is exactly
 *    where `launchSpeed` meets a cap, so the colour boundaries are the tables'.
 * 4. The saved maps' distribution is the game's own draw (not a copy of it).
 * 5. `map_fields.js` round-trips: `fieldsText` loads back through node's module
 *    path and through the page's `root.MAP_FIELDS` path.
 * 6. The helper page loads only files that exist and only calls what the
 *    modules export — a rename in `map_gen.js` breaks the page, not the browser.
 *
 * Run: node experiments/map_gen_test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const PlanetGravity = require(path.join(root, 'planet_gravity.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const MapGen = require(path.join(root, 'map_gen.js'));
const MAPS = require(path.join(root, 'saved_maps.js'));
const FIELDS = require(path.join(root, 'map_fields.js'));

const PLANETS = OrbitWorld.PLANETS;
const page = fs.readFileSync(path.join(root, 'map-generator-helper.htm'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gridOf = g => Math.round(g * PlanetGravity.STEPS);

/* --- 1. the field ------------------------------------------------------- */

/* the draw as it was written inside gravity_game.js, so a move has to keep it */
function historicalGravity(seed, planet) {
	const u = OrbitWorld.hash01(seed, planet, 0xce);
	let g = -1 + (u * 91 - 0.5) / 20;
	if (g > 0.6 && g < 2.8) {
		const wave = Math.sin(Math.PI * (g - 0.6) / (2.8 - 0.6));
		g -= 0.3 * wave * wave;
	}
	g = Math.round(g * 20) / 20;
	return g === 0 ? 0 : Math.max(-1, Math.min(3.5, g));
}

const values = new Set();
for (let seed = 0; seed < 300; seed++) {
	for (let planet = 0; planet < PLANETS; planet++) {
		const g = PlanetGravity.gravity(seed, planet);
		assert.strictEqual(g, historicalGravity(seed, planet),
			'the draw moved at seed ' + seed + ' planet ' + planet);
		assert.ok(g >= PlanetGravity.MIN && g <= PlanetGravity.MAX, 'gravity out of range');
		assert.strictEqual(g, gridOf(g) / PlanetGravity.STEPS, 'gravity off the 0.05 grid');
		assert.ok(!Object.is(g, -0), 'gravity must not carry a negative zero');
		values.add(g);
	}
}
assert.strictEqual(values.size, 91, 'the draw spans every grid value');
assert.strictEqual(PlanetGravity.CHOICES, PlanetGravity.MAX * PlanetGravity.STEPS -
	PlanetGravity.MIN * PlanetGravity.STEPS + 1, 'the choice count follows the range');
assert.strictEqual(GravityGame.planetGravity, PlanetGravity.gravity,
	'the game re-exports the one draw');
assert.strictEqual(GravityGame.PLANET_GRAVITY_MIN, PlanetGravity.MIN);
assert.strictEqual(GravityGame.PLANET_GRAVITY_MAX, PlanetGravity.MAX);
assert.strictEqual(GravityGame.PLANET_GRAVITY_STEPS, PlanetGravity.STEPS);
assert.strictEqual(PlanetGravity.snap(1.234), 1.25, 'snap rounds to the grid');
assert.strictEqual(PlanetGravity.snap(-9), PlanetGravity.MIN, 'snap clamps low');
assert.strictEqual(PlanetGravity.snap(9), PlanetGravity.MAX, 'snap clamps high');
assert.strictEqual(PlanetGravity.snap(-0.001), 0, 'snap folds the negative zero');
assert.strictEqual(PlanetGravity.snap(NaN), 0, 'snap has a value for a non-number');

/* --- 2. the roster ------------------------------------------------------ */

assert.deepStrictEqual(MapGen.normaliseRows(null), [], 'no roster, no rows');
const roster = MapGen.normaliseRows([
	{ g: 1.234, m: 0.4, count: 2 },
	{ g: 9, m: 9, count: -3.7 },
	{ g: 'x', m: 'y', count: 1.9 },
	{ g: 0, m: 0, count: 1000 }
]);
assert.deepStrictEqual(roster[0], { g: 1.25, m: 0.4, count: 2 }, 'a row snaps and keeps its margin');
assert.strictEqual(roster[1].g, PlanetGravity.MAX, 'a gravity beyond the field is clamped');
assert.strictEqual(roster[1].count, 0, 'a negative count is none');
assert.deepStrictEqual(roster[2], { g: 0, m: 0, count: 1 }, 'a junk row falls back');
assert.strictEqual(roster[3].count, PLANETS, 'a count cannot exceed the field');

const design = [
	{ g: -0.5, m: 0.5, count: 3 },
	{ g: 1, m: 0.5, count: 2 },
	{ g: 3, m: 0.5, count: 1 }
];
assert.strictEqual(MapGen.rosterSize(MapGen.normaliseRows(design)), 6);
const drawnA = MapGen.drawField(design, 99);
const drawnB = MapGen.drawField(design, 99);
const drawnC = MapGen.drawField(design, 100);
assert.deepStrictEqual(drawnA, drawnB, 'a draw repeats for its seed');
assert.notDeepStrictEqual(drawnA, drawnC, 'a new seed is a new field');
assert.strictEqual(drawnA.length, 6, 'the draw makes the roster size');
drawnA.forEach((g, i) => {
	assert.strictEqual(g, gridOf(g) / PlanetGravity.STEPS, 'a drawn gravity is on the grid');
	const row = design[i < 3 ? 0 : i < 5 ? 1 : 2];
	assert.ok(g >= row.g - row.m - 1e-9 && g <= row.g + row.m + 1e-9,
		'a draw stays inside its row margin');
});
assert.deepStrictEqual(MapGen.drawField([{ g: 2, m: 0, count: 2 }], 5), [2, 2],
	'a zero margin draws its gravity exactly');

/* --- 3. the launch tiers ------------------------------------------------ */

for (const mass of [OrbitTech.SHIP_DRY_MASS, 19.5, 38]) {
	const caps = MapGen.railCaps(mass);
	assert.strictEqual(caps.length, 2);
	assert.ok(caps[0] < caps[1], 'the second rail is the faster one');
	const limits = MapGen.tierLimits(caps);
	for (let i = 0; i < 2; i++) {
		assert.ok(Math.abs(MapGen.launchSpeed(limits[i]) - caps[i]) < 1e-6,
			'a tier limit is where the rail stalls');
	}
	let previous = 0;
	for (let step = 0; step <= PlanetGravity.CHOICES; step++) {
		const tier = MapGen.tierOf(PlanetGravity.MIN + step / PlanetGravity.STEPS, caps);
		assert.ok(tier >= previous, 'a heavier well never needs a slower rail');
		previous = tier;
	}
	assert.strictEqual(MapGen.tierOf(0, caps), 0, 'no well needs no rail');
	assert.strictEqual(MapGen.tierOf(-1, caps), 0, 'a pushing world needs no rail');
	const topTier = MapGen.launchSpeed(PlanetGravity.MAX) > caps[1] ? 3 : 2;
	assert.strictEqual(MapGen.tierOf(PlanetGravity.MAX, caps), topTier,
		'the top of the field is the second rail or beyond');
}
/* a heavier ship is never easier to launch, at the same well */
const dryCaps = MapGen.railCaps(OrbitTech.SHIP_DRY_MASS);
const heavyCaps = MapGen.railCaps(38);
for (let step = 1; step <= PlanetGravity.CHOICES; step++) {
	const g = PlanetGravity.MIN + step / PlanetGravity.STEPS;
	assert.ok(MapGen.tierOf(g, heavyCaps) >= MapGen.tierOf(g, dryCaps),
		'a loaded ship must not be easier to launch at g ' + g.toFixed(2));
}
/* the note's own observation, on the dry ship: green to about g 1, heavy at 3.5 */
assert.strictEqual(MapGen.tierOf(0.9, dryCaps), 1, 'g 0.9 leaves on the starter rail');
assert.strictEqual(MapGen.tierOf(1.5, dryCaps), 2, 'g 1.5 needs the second rail');

/* --- 4. the saved maps -------------------------------------------------- */

assert.ok(MAPS.length > 0, 'the registry has maps to compare against');
const saved = MapGen.savedMapFields(MAPS);
assert.strictEqual(saved.length, MAPS.length);
saved.forEach((entry, i) => {
	assert.strictEqual(entry.universe, MAPS[i].universe);
	assert.strictEqual(entry.values.length, entry.universe, 'one gravity per planet');
	for (let p = 0; p < entry.universe; p++) {
		assert.strictEqual(entry.values[p], GravityGame.planetGravity(MAPS[i].seed, p),
			'the saved map reads the game\'s own draw');
	}
});
/* the seed-map panel's draw: the game's own, one value per planet */
assert.deepStrictEqual(MapGen.originalDraw(42, 3),
	[0, 1, 2].map(p => GravityGame.planetGravity(42, p)), 'the original draw is the game\'s own');
assert.deepStrictEqual(MapGen.originalDraw(42, 0), [], 'no planets, no draw');
assert.strictEqual(MapGen.originalDraw(42, 999).length, PLANETS, 'a draw cannot exceed the field');
assert.deepStrictEqual(MapGen.originalDraw(42, 'junk'), [], 'a non-number universe draws nothing');
const bins = MapGen.addToBins(MapGen.emptyBins(), [0, 0.1, 3.4, 3.5]);
assert.strictEqual(bins.reduce((a, b) => a + b, 0), 4, 'every value lands in one bin');
assert.strictEqual(MapGen.binOf(-1), 0, 'the bottom of the field is the first bin');
assert.strictEqual(MapGen.binOf(3.5), MapGen.BIN_COUNT - 1, 'the top is the last bin');
assert.ok(MapGen.binLabel(0).startsWith('-1.00'), 'a bin says where it starts');
const baseline = MapGen.baselineShare(13);
assert.ok(Math.abs(baseline.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'the baseline is a share');
assert.ok(baseline[12] < baseline[8],
	'the generator thins the heavy middle (g 1.5-2.5), so the baseline is not uniform');
const stats = MapGen.fieldStats([-0.5, 0.5, 0.9, 1.5, 3.5], OrbitTech.SHIP_DRY_MASS);
assert.strictEqual(stats.n, 5);
assert.strictEqual(stats.tiers[0], 1, 'one pushing world');
assert.strictEqual(stats.tiers[1], 2, 'two worlds the starter rail leaves');
assert.strictEqual(stats.light, 4, 'four worlds at or below 1.5');
assert.deepStrictEqual(stats.caps, dryCaps);

/* --- 5. the registry ---------------------------------------------------- */

const record = MapGen.fieldRecord({
	name: 'test field', rows: design, values: drawnA, seed: 99, mass: 10, gap: 220
});
assert.strictEqual(record.kind, 'field');
assert.strictEqual(record.universe, drawnA.length);
assert.deepStrictEqual(record.gravity, drawnA);
assert.strictEqual(record.seed, 99);

function loadThroughModule(text) {
	const file = path.join(require('os').tmpdir(), 'map_fields_test_' + process.pid + '.js');
	fs.writeFileSync(file, text);
	try {
		delete require.cache[file];
		return require(file);
	} finally {
		fs.unlinkSync(file);
	}
}

function loadThroughRoot(text) {
	const sandbox = { globalThis: null };
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(text, sandbox);
	return sandbox.MAP_FIELDS;
}

/* a vm realm has its own prototypes, so compare plain JSON, as the other tests do */
const plain = value => JSON.stringify(value);
const text = MapGen.fieldsText([record]);
assert.strictEqual(plain(loadThroughModule(text)), plain([record]), 'the registry reloads under node');
assert.strictEqual(plain(loadThroughRoot(text)), plain([record]), 'the registry reloads as a page script');
assert.deepStrictEqual(FIELDS, [], 'the committed registry is the page\'s empty one');
assert.strictEqual(MapGen.fieldsText([]), fs.readFileSync(path.join(root, 'map_fields.js'), 'utf8'),
	'the committed map_fields.js is exactly what an empty registry writes');
assert.deepStrictEqual(MapGen.readFields([record, null, { gravity: [] }, { name: 'x' }]).length, 1,
	'a file is trusted only as far as it parses');
assert.strictEqual(MapGen.readFields([{ name: 'x', gravity: [1.234, 9] }])[0].gravity.join(','),
	'1.25,3.5', 'a hand-edited field is snapped and clamped');

/* --- 6. the page -------------------------------------------------------- */

const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
for (const file of scripts) {
	assert.ok(fs.existsSync(path.join(root, file)), 'the helper page loads a missing file: ' + file);
}
for (const file of ['planet_gravity.js', 'map_gen.js', 'saved_maps.js', 'map_fields.js']) {
	assert.ok(scripts.includes(file), 'the helper page must load ' + file);
}
assert.ok(html.indexOf('planet_gravity.js') < html.indexOf('gravity_game.js'),
	'index.html loads the field before the rules that re-export it');
assert.ok(/id="origGen"/.test(page), 'the helper page has the original seed map panel');
assert.ok(/<select id="mapPick"/.test(html), 'the saved-maps group has a picker');

/* every `MapGen.name` / `PlanetGravity.name` / `OrbitWorld.name` the page calls
 * must exist: the page is inline and untested in a browser, so a rename would
 * only show there */
const exported = { MapGen: MapGen, PlanetGravity: PlanetGravity, OrbitWorld: OrbitWorld };
for (const name of ['MapGen', 'PlanetGravity', 'OrbitWorld']) {
	const used = new Set([...page.matchAll(new RegExp('\\b' + name + '\\.([A-Za-z_$][A-Za-z0-9_$]*)', 'g'))]
		.map(match => match[1]));
	assert.ok(used.size > 0, 'the page uses ' + name);
	for (const property of used) {
		assert.ok(exported[name][property] !== undefined,
			'the page calls ' + name + '.' + property + ', which does not exist');
	}
}
/* inline scripts parse: a syntax error in the page is a blank page */
const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.ok(inline.length > 0, 'the helper page has its own script');
inline.forEach((code, i) => {
	new vm.Script(code, { filename: 'helper-inline-' + i + '.js' });
});

/* every id the page looks up must be in its own markup */
const ids = new Set([...page.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
for (const match of page.matchAll(/\$\('([^']+)'\)/g)) {
	assert.ok(ids.has(match[1]), 'the page asks for #' + match[1] + ', which it does not have');
}

console.log('map helper: field, roster, tiers, registry and page ok ·',
	saved.length, 'saved maps ·', values.size, 'grid values ·',
	dryCaps.map(cap => cap.toFixed(1)).join('/'), 'px/s dry');
