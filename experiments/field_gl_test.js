/* The real WebGL shader against the exact CPU reference. The node tests run a stub GL, so
 * only a browser compiles the GLSL; this reads the framebuffer back and compares it with
 * zoneAt/sampleZone (potential) and sampleColor (field), then composites the translucent
 * zone canvas over the page colour the way the browser does.
 * CHROME_PATH=/path/to/chromium [PUPPETEER_DIR=/dir/of/puppeteer-core] node experiments/field_gl_test.js */
'use strict';

const assert = require('assert');
const path = require('path');

const chrome = process.env.CHROME_PATH || '';
if (!chrome) {
	console.log('FIELD GL TEST SKIPPED — set CHROME_PATH to a Chromium binary');
	process.exit(0);
}
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (error) {
	if (!process.env.PUPPETEER_DIR) throw error;
	puppeteer = require(path.join(process.env.PUPPETEER_DIR, 'puppeteer-core'));
}

const CSS_W = 320;
const CSS_H = 200;
/* GL rounds and the reference rounds the colour too, so a couple of levels of slack */
const TOLERANCE = { shader: 2, composite: 3 };
const SIM_MU = 400000;
const SIM_SOFT2 = 3600;

/* runs in the page: one mode through the real shader, read back and compared */
function compareInPage(mode, cssW, cssH, MU, SOFT2) {
	const bodies = [[60, 60, 3.2], [140, 70, 1.4], [240, 60, -0.9], [100, 150, 0.6], [200, 140, 2.2], [270, 160, -0.3]];
	const sim = {
		bodyCount: bodies.length,
		bodyX: Float64Array.from(bodies, b => b[0]),
		bodyY: Float64Array.from(bodies, b => b[1]),
		strength: Float64Array.from(bodies, b => b[2]),
		gravityScale: 1
	};
	const view = { dpr: 1, scale: 1, offX: 0, offY: 0 };
	const canvas = document.createElement('canvas');
	const field = GravityField.create(canvas);
	field.setMode(mode);
	field.render(sim, view, cssW, cssH, false);
	const info = { mode, backend: field.backend(), div: field.scaleDiv(), w: canvas.width, h: canvas.height };
	if (info.backend !== 'webgl' || info.div !== 1) return info;

	const { w, h } = info;
	const gl = canvas.getContext('webgl');
	const read = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, read);
	/* GL rows run bottom to top, premultiplied */
	const at = (x, y) => ((h - 1 - y) * w + x) * 4;
	const worst = { diff: 0 };
	const note = (diff, x, y, got, want) => {
		if (diff > worst.diff) Object.assign(worst, { diff, x, y, got: Array.from(got), want: Array.from(want) });
	};

	if (mode === 'field') {
		const hue = { hue: 0, light: 0, r: 0, g: 0, b: 0 };
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let ax = 0;
				let ay = 0;
				for (let i = 0; i < bodies.length; i++) {
					const dx = sim.bodyX[i] - (x + 0.5);
					const dy = sim.bodyY[i] - (y + 0.5);
					const r2 = dx * dx + dy * dy + SOFT2;
					const k = MU * sim.strength[i] / (r2 * Math.sqrt(r2));
					ax += dx * k;
					ay += dy * k;
				}
				GravityField.sampleColor(ax, ay, hue);
				const o = at(x, y);
				const got = [read[o], read[o + 1], read[o + 2], read[o + 3]];
				const want = [hue.r, hue.g, hue.b, 255];
				note(Math.max(...got.map((v, i) => Math.abs(v - want[i]))), x, y, got, want);
			}
		}
		return Object.assign(info, { worst });
	}

	const c = { zone: 0, alpha: 0, a: 0, r: 0, g: 0, b: 0 };
	const backdrop = document.createElement('canvas');
	backdrop.width = w;
	backdrop.height = h;
	const bctx = backdrop.getContext('2d');
	bctx.fillStyle = 'rgb(2, 6, 12)';
	bctx.fillRect(0, 0, w, h);
	bctx.drawImage(canvas, 0, 0);
	const over = bctx.getImageData(0, 0, w, h).data;
	const lit = { blue: 0, green: 0, red: 0, clear: 0 };
	const blend = { diff: 0 };
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = at(x, y);
			GravityField.sampleZone(GravityField.zoneAt(sim, x + 0.5, y + 0.5), c);
			const got = [read[o], read[o + 1], read[o + 2], read[o + 3]];
			const want = [c.r * c.alpha, c.g * c.alpha, c.b * c.alpha, c.alpha * 255];
			note(Math.max(...got.map((v, i) => Math.abs(v - want[i]))), x, y, got, want);
			/* source over the page colour: premultiplied colour plus the backdrop's share */
			const p = (y * w + x) * 4;
			const page = [2, 6, 12];
			const shown = [0, 1, 2].map(i => want[i] + page[i] * (1 - c.alpha));
			const gotShown = [over[p], over[p + 1], over[p + 2]];
			const d = Math.max(...gotShown.map((v, i) => Math.abs(v - shown[i])));
			if (d > blend.diff) Object.assign(blend, { diff: d, x, y, got: gotShown, want: shown });
			if (c.alpha < 0.1) lit.clear += 1;
			else if (c.zone < 0) lit.blue += 1;
			else if (c.g > c.r + 40 && c.g > c.b + 40) lit.green += 1;
			else if (c.r > c.g + 60 && c.r > c.b + 60) lit.red += 1;
		}
	}
	return Object.assign(info, { worst, blend, lit });
}

(async () => {
	let browser;
	try {
		browser = await puppeteer.launch({
			executablePath: chrome,
			headless: 'shell',
			args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
				'--ignore-gpu-blocklist']
		});
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(String(error)));
		page.on('console', message => {
			if (message.type() === 'error') errors.push(message.text());
		});
		await page.goto('about:blank');
		await page.addScriptTag({ path: path.join(__dirname, '..', 'gravity_field.js') });

		const zone = await page.evaluate(compareInPage, 'potential', CSS_W, CSS_H, SIM_MU, SIM_SOFT2);
		assert.strictEqual(zone.backend, 'webgl', 'the zone shader compiled and drew: ' + JSON.stringify(zone));
		assert.ok(zone.worst.diff <= TOLERANCE.shader,
			'shader differs from zoneAt/sampleZone by ' + zone.worst.diff + ': ' + JSON.stringify(zone.worst));
		assert.ok(zone.blend.diff <= TOLERANCE.composite,
			'translucent canvas over the page colour is off by ' + zone.blend.diff + ': ' + JSON.stringify(zone.blend));
		assert.ok(zone.lit.blue > 200 && zone.lit.green > 2000 && zone.lit.red > 500 && zone.lit.clear > 5000,
			'blue, green, red and clear all show: ' + JSON.stringify(zone.lit));

		const field = await page.evaluate(compareInPage, 'field', CSS_W, CSS_H, SIM_MU, SIM_SOFT2);
		assert.strictEqual(field.backend, 'webgl', 'the field shader drew: ' + JSON.stringify(field));
		assert.ok(field.worst.diff <= TOLERANCE.shader,
			'field shader differs from sampleColor by ' + field.worst.diff + ': ' + JSON.stringify(field.worst));

		assert.deepStrictEqual(errors, [], 'no page errors');
		console.log('FIELD GL OK · zone shader max diff ' + zone.worst.diff + ', over page ' + zone.blend.diff +
			' · field shader max diff ' + field.worst.diff + ' · ' + JSON.stringify(zone.lit));
	} finally {
		if (browser) await browser.close();
	}
})().catch(error => {
	console.error(error);
	process.exit(1);
});
