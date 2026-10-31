/* Gravity potential view, planet profit+gravity cards, and view cycling.
 * Run: node experiments/gravity_view_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const GravitySim = require('../gravity_sim.js');
const GravityField = require('../gravity_field.js');
const { loadPage } = require('./dom_stub.js');

/* Signed Plummer potential matches the simulation's softened acceleration. */
const sim = new GravitySim(1000, 1000);
const radius = new Float64Array([10, 10]);
const strength = new Float64Array([1, -1]);
sim.setField(2, radius, strength, (t, x, y) => {
	x[0] = 300; y[0] = 300; x[1] = 700; y[1] = 300;
}, true);
const well = GravityField.potentialAt(sim, 300, 300);
const hill = GravityField.potentialAt(sim, 700, 300);
assert.ok(well < 0 && hill > 0, 'attractive well negative, repulsive hill positive');
const out = { ax: 0, ay: 0 };
sim.fieldAt(450, 380, out);
const h = 0.01;
const gx = (GravityField.potentialAt(sim, 450 + h, 380) - GravityField.potentialAt(sim, 450 - h, 380)) / (2 * h);
const gy = (GravityField.potentialAt(sim, 450, 380 + h) - GravityField.potentialAt(sim, 450, 380 - h)) / (2 * h);
assert.ok(Math.abs(gx + out.ax) < 1e-6 && Math.abs(gy + out.ay) < 1e-6, 'field = -grad potential');
const colour = { potential: 0, shade: 0, r: 0, g: 0, b: 0 };
GravityField.samplePotential(well, colour);
assert.ok(colour.b > colour.g && colour.b > colour.r, 'negative potential is blue');
GravityField.samplePotential(hill, colour);
assert.ok(colour.g > colour.r && colour.g > colour.b, 'positive potential is green');
GravityField.samplePotential(0, colour);
assert.deepStrictEqual([colour.r, colour.g, colour.b], [2, 6, 12], 'zero potential is dark space');

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
		GravityField.samplePotential(GravityField.potentialAt(sim, wx, wy), colour);
		const p = (y * w + x) * 4;
		maxDiff = Math.max(maxDiff, Math.abs(pixels[p] - colour.r),
			Math.abs(pixels[p + 1] - colour.g), Math.abs(pixels[p + 2] - colour.b));
	}
}
assert.ok(maxDiff <= 3, 'potential raster differs from reference by ' + maxDiff);
sim.setScales(0, 1);
GravityField.renderBuffer(pixels, w, hgt, sim, view, 640, 400, 'potential');
assert.ok(pixels.every((v, i) => v === (i % 4 === 3 ? 255 : [2, 6, 12][i % 4])),
	'zero gravity collapses potential to the dark base');
sim.setScales(1, 1);

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

console.log('GRAVITY VIEW OK · potential parity max diff ' + maxDiff + ' · cards + owner borders + f cycle');
