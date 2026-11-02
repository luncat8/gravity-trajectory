/* Gravity zone ("potential") view, planet profit+gravity cards, and view cycling.
 * Run: node experiments/gravity_view_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const GravitySim = require('../gravity_sim.js');
const GravityField = require('../gravity_field.js');
const { loadPage } = require('./dom_stub.js');

/* Z sums each body's signed g spread over a bump: a lone body reads its own g. */
const sim = new GravitySim(1000, 1000);
const radius = new Float64Array([10, 10]);
const strength = new Float64Array([1, -1]);
sim.setField(2, radius, strength, (t, x, y) => {
	x[0] = 300; y[0] = 300; x[1] = 700; y[1] = 300;
}, true);
const pull = GravityField.zoneAt(sim, 300, 300);
const push = GravityField.zoneAt(sim, 700, 300);
assert.ok(Math.abs(pull - 1) < 0.01 && Math.abs(push + 1) < 0.01,
	'a body reads its own g at its centre: ' + pull + ' / ' + push);
assert.ok(Math.abs(GravityField.zoneAt(sim, 300, 300 + GravityField.ZONE_R) - 0.25) < 0.01,
	'one spread radius out the bump is a quarter of the centre');
assert.ok(Math.abs(GravityField.zoneAt(sim, 500, 300)) < 0.1, 'between distant bodies it fades out');
sim.setScales(2, 1);
assert.ok(Math.abs(GravityField.zoneAt(sim, 300, 300) - 2 * pull) < 1e-9, 'the world multiplier scales every zone');
sim.setScales(1, 1);

/* Palette: negative blue, near zero clear, positive green, heavy red; alpha = |Z|. */
const colour = { zone: 0, alpha: 0, a: 0, r: 0, g: 0, b: 0 };
const zone = z => GravityField.sampleZone(z, colour);
const label = () => colour.r + '/' + colour.g + '/' + colour.b + '/' + colour.a;
zone(-1);
assert.ok(colour.b > colour.g && colour.b > colour.r && colour.a === 255, 'negative gravity is blue: ' + label());
zone(1.2);
assert.ok(colour.g > colour.r + 40 && colour.g > colour.b + 40 && colour.a === 255,
	'positive gravity is green, not red or blue: ' + label());
zone(3);
assert.ok(colour.r > colour.g + 60 && colour.r > colour.b + 60, 'a heavy planet is red: ' + label());
zone(GravityField.HEAVY_G);
assert.deepStrictEqual([colour.r, colour.g, colour.b], [255, 72, 56], 'red is solid from the heavy line');
zone(1.5);
assert.ok(colour.r > 240 && colour.g > 190 && colour.b < 100, 'green reaches red through amber: ' + label());
zone(0);
assert.strictEqual(colour.a, 0, 'zero gravity is fully transparent');
for (const z of [-0.8, -0.5, -0.1, 0.1, 0.3, 0.75, 1, 1.7, -2.5, 6]) {
	zone(z);
	assert.strictEqual(colour.a, Math.round(Math.min(1, Math.abs(z)) * 255), 'alpha is |Z| up to 1 at ' + z);
}
/* smooth: premultiplied colour never jumps, not at the sign flip nor where alpha saturates */
let prev = null;
let maxStep = 0;
for (let z = -2; z <= 6; z += 0.001) {
	zone(z);
	const now = [colour.r * colour.a / 255, colour.g * colour.a / 255, colour.b * colour.a / 255];
	if (prev) maxStep = Math.max(maxStep, ...now.map((v, i) => Math.abs(v - prev[i])));
	prev = now;
}
assert.ok(maxStep < 1.5, 'palette steps at most ' + maxStep.toFixed(2) + ' levels per 0.001 of Z');

/* The legend key is the same palette: clear in the middle, blue and red at its ends. */
const key = GravityField.legendGradient(-1, 3.5);
assert.ok(/^linear-gradient\(90deg, rgba\(42, 116, 255, 1\.000\) 0\.00%/.test(key), 'key starts blue: ' + key.slice(0, 60));
assert.ok(key.includes('rgba(72, 235, 139, 0.000) 22.22%'), 'key is clear at g = 0');
assert.ok(/rgba\(255, 72, 56, 1\.000\) 66\.67%/.test(key), 'key is red at the heavy line');

/* The 1/4-res fallback uses the same palette as the reference sampler. */
const w = 160, hgt = 100;
const view = { dpr: 1, scale: 0.8, offX: 0, offY: 0 };
const pixels = new Uint8ClampedArray(w * hgt * 4);
GravityField.renderBuffer(pixels, w, hgt, sim, view, 640, 400, 'potential');
let maxDiff = 0;
for (let y = 0; y < hgt; y++) {
	for (let x = 0; x < w; x++) {
		const wx = (2 - view.offX) / view.scale + x * (4 / view.scale);
		const wy = (2 - view.offY) / view.scale + y * (4 / view.scale);
		zone(GravityField.zoneAt(sim, wx, wy));
		const p = (y * w + x) * 4;
		maxDiff = Math.max(maxDiff, Math.abs(pixels[p] - colour.r), Math.abs(pixels[p + 1] - colour.g),
			Math.abs(pixels[p + 2] - colour.b), Math.abs(pixels[p + 3] - colour.a));
	}
}
assert.ok(maxDiff <= 1, 'zone raster differs from reference by ' + maxDiff);
sim.setScales(0, 1);
GravityField.renderBuffer(pixels, w, hgt, sim, view, 640, 400, 'potential');
assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 0), 'zero gravity collapses the zone map to transparent');
sim.setScales(1, 1);
GravityField.renderBuffer(pixels, w, hgt, sim, view, 640, 400, 'field');
assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 255), 'the direction field stays opaque');

/* GUI: URL, radio, legend, f cycle, and renderer mode stay in sync. */
const env = loadPage({ search: '?mode=career&seed=42&view=potential' });
env.runFrames(2, 16);
const scene = env.context.GravityScene;
const ui = env.elements;
assert.strictEqual(scene.viewMode(), 'potential');
assert.ok(ui.get('viewPotential').checked);
assert.ok(!ui.get('potentialLegend').hidden);
assert.ok(!ui.get('f').hidden);
assert.strictEqual(env.context.OrbitScene.backdropVisible(), false);
assert.strictEqual(scene.fieldRenderer().mode(), 'potential');
assert.match(ui.get('viewTag').textContent, /^potential · /);
assert.ok(ui.get('zoneBar').style.backgroundImage.startsWith('linear-gradient(90deg, rgba(42, 116, 255'),
	'legend bar is painted from the zone palette');
env.fireWindow('keydown', { code: 'KeyF', key: 'f', target: { tagName: 'BODY' } });
assert.strictEqual(scene.viewMode(), 'space');
assert.ok(ui.get('potentialLegend').hidden);
env.fireWindow('keydown', { code: 'KeyF', key: 'f', target: { tagName: 'BODY' } });
assert.strictEqual(scene.viewMode(), 'field');
env.fireWindow('keydown', { code: 'KeyF', key: 'f', target: { tagName: 'BODY' } });
assert.strictEqual(scene.viewMode(), 'potential');
env.choose('viewSpace');
assert.strictEqual(scene.viewMode(), 'space');
env.choose('viewPotential');
assert.strictEqual(scene.viewMode(), 'potential');

/* the page raster of a seed with repelling, pulling and heavy planets: every zone colour
 * shows, most of the map stays clear, and red marks heavy planets instead of washing it */
const zoneEnv = loadPage({ search: '?mode=career&seed=61&view=potential' });
zoneEnv.runFrames(3, 16);
const zonePix = zoneEnv.context.GravityScene.fieldRenderer().pixels();
const seen = { blue: 0, green: 0, red: 0, clear: 0 };
for (let i = 0; i < zonePix.length; i += 4) {
	const r = zonePix[i], g = zonePix[i + 1], b = zonePix[i + 2], a = zonePix[i + 3];
	if (a < 26) seen.clear += 1;
	if (a < 128) continue;
	if (b > r + 40 && b > g) seen.blue += 1;
	else if (g > r + 40 && g > b + 40) seen.green += 1;
	else if (r > g + 60 && r > b + 60) seen.red += 1;
}
const zoneTotal = zonePix.length / 4;
assert.ok(seen.blue > 200 && seen.green > 2000 && seen.red > 500,
	'blue, green and red zones all show: ' + JSON.stringify(seen));
assert.ok(seen.red < zoneTotal / 4, 'red marks heavy planets, it does not wash the screen: ' + seen.red);
assert.ok(seen.clear > zoneTotal / 3, 'most of the map stays clear: ' + seen.clear);

/* the zoom switch: main frames the planet field, full the whole flight area */
const OrbitSim = require('../orbit_sim.js');
const sceneView = env.context.OrbitScene.view;
const mainScale = sceneView.scale;
assert.strictEqual(scene.frame(), 'main');
assert.ok(Math.abs(sceneView.scale - Math.min((1280 - 28) / OrbitSim.WORLD_W,
	(800 - 14 - 76) / OrbitSim.WORLD_H)) < 1e-9, 'main frame fits the planet field');
env.choose('viewZoomFull');
assert.strictEqual(scene.frame(), 'full');
assert.ok(ui.get('viewZoomFull').checked && !ui.get('viewZoomMain').checked, 'full radio checked');
const areaScale = Math.min((1280 - 28) / OrbitSim.AREA_W, (800 - 14 - 76) / OrbitSim.AREA_H);
assert.ok(Math.abs(sceneView.scale - areaScale) < 1e-9, 'full frame fits the flight area');
assert.ok(sceneView.scale < mainScale, 'full frame is zoomed out');
/* the field stays centred inside the area: its screen centre is the area centre */
const fieldMidX = (OrbitSim.WORLD_W / 2) * sceneView.scale + sceneView.offX;
const areaMidX = (OrbitSim.AREA_W / 2 - OrbitSim.AREA_PAD_X) * sceneView.scale + sceneView.offX;
assert.ok(Math.abs(fieldMidX - areaMidX) < 1e-9, 'field centred in the area');
env.fireWindow('keydown', { code: 'KeyZ', key: 'z', target: { tagName: 'BODY' } });
assert.strictEqual(scene.frame(), 'main');
assert.ok(Math.abs(sceneView.scale - mainScale) < 1e-9, 'z toggles back to main');
env.choose('viewZoomFull');

/* Planet cards print profit then gravity; EMC claims colour the border. */
env.calls.texts.length = 0;
env.calls.textColors.length = 0;
env.calls.gStrokeStyles.length = 0;
vm.runInContext('drawPlanetProfits()', env.context);
assert.ok(env.calls.texts.includes('+0.46'), 'visit profit line drawn');
assert.ok(env.calls.texts.some(t => /^g [+-]/.test(t)), 'gravity line drawn after profit');
const hq = scene.career.hq;
assert.strictEqual(env.context.GravityGame.claimOwner(scene.game.galaxy, hq), 0);
assert.ok(env.calls.gStrokeStyles.includes('#8ef0c0'), 'own EMC border uses player mint');
assert.ok(env.calls.gStrokeStyles.includes('#b99aff') || env.calls.gStrokeStyles.includes('#ff85a8'),
	'rival EMC border uses rival colour');
const heavyIndex = env.calls.texts.findIndex(t => t === 'g +3.00');
if (heavyIndex >= 0) assert.strictEqual(env.calls.textColors[heavyIndex], '#ff5f57');

/* Port-source cards read the parent port strength, not a stale planet value. */
env.choose('srcPorts');
env.runFrames(1, 16);
env.calls.texts.length = 0;
vm.runInContext('drawPlanetProfits()', env.context);
assert.ok(env.calls.texts.some(t => /^g [+-]/.test(t)), 'port-source planet card still prints gravity');

console.log('GRAVITY VIEW OK · zone raster parity max diff ' + maxDiff + ' · palette + legend + cards + owner borders + f cycle');
