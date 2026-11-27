/* Periodic FFT solver checks (0.8.0 plan §Validation, solver part):
 * round-trip, impulse and single-mode transforms on small square and
 * rectangular grids; signed CIC mass conservation, periodic translations,
 * uniform-background zero acceleration, self-force and half-world ties;
 * an independent wrapped-direct oracle with vector error bounds (ordinary
 * samples) plus finiteness / symmetry / bounded-jump strip tests at the
 * half-world cuts; mean-zero potential with signed-palette polarity and a
 * finite-difference -grad(phi) cross-check. No game hook.
 * Run: node experiments/fft_test.js
 */
'use strict';

const assert = require('assert');
const FFT = require('../gravity_fft.js');

const MU = FFT.MU;
const PS = FFT.PERIODIC_STRENGTH;
const SOFT = FFT.SOFT;
const SOFT2 = SOFT * SOFT;
/* reference acceleration: one unit well at its softening scale */
const A_REF = MU * PS / SOFT2;

function lcg(seed) {
	let s = seed >>> 0;
	return function () {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/* ── helpers: geometry, oracle, samples ── */

function cellSize(gridX, gridY, W, H) {
	return { cw: W / gridX, ch: H / gridY };
}

/* independent wrapped direct sum: minimum image per component, the tied
 * component at exactly +-L/2 averages to zero while (L/2)^2 stays in the
 * denominator, d = sample - source with K_a(d) = -d / (|d|^2+e^2)^{3/2} */
function directField(bodies, x, y, W, H) {
	let ax = 0;
	let ay = 0;
	for (let i = 0; i < bodies.length; i++) {
		const b = bodies[i];
		let dx = x - b.x;
		let dy = y - b.y;
		dx -= W * Math.round(dx / W);
		dy -= H * Math.round(dy / H);
		const tieX = Math.abs(dx) === W / 2;
		const tieY = Math.abs(dy) === H / 2;
		const inv = 1 / (dx * dx + dy * dy + SOFT2);
		const f = MU * PS * b.s * inv * Math.sqrt(inv);
		if (!tieX) ax -= dx * f;
		if (!tieY) ay -= dy * f;
	}
	return { ax: ax, ay: ay };
}

function nearestBody(bodies, x, y, W, H) {
	let best = Infinity;
	for (let i = 0; i < bodies.length; i++) {
		const b = bodies[i];
		let dx = x - b.x;
		let dy = y - b.y;
		dx -= W * Math.round(dx / W);
		dy -= H * Math.round(dy / H);
		const d = Math.sqrt(dx * dx + dy * dy);
		if (d < best) best = d;
	}
	return best;
}

/* a sample sits in a two-cell strip around some body's half-world cut */
function inCutStrip(bodies, x, y, W, H, cw, ch) {
	for (let i = 0; i < bodies.length; i++) {
		const b = bodies[i];
		let dx = x - b.x;
		let dy = y - b.y;
		dx -= W * Math.round(dx / W);
		dy -= H * Math.round(dy / H);
		if (W / 2 - Math.abs(dx) <= 2 * cw) return true;
		if (H / 2 - Math.abs(dy) <= 2 * ch) return true;
	}
	return false;
}

function strengthSum(bodies) {
	let sum = 0;
	for (let i = 0; i < bodies.length; i++) sum += Math.abs(bodies[i].s);
	return sum;
}

function solveOn(bodies, W, H, gridX, gridY) {
	const n = bodies.length;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	const ss = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		xs[i] = bodies[i].x;
		ys[i] = bodies[i].y;
		ss[i] = bodies[i].s;
	}
	return FFT.solve(gridX, gridY, W, H, xs, ys, ss, n);
}

const outField = { ax: 0, ay: 0 };

function gridField(snap, x, y) {
	snap.sample(x, y, 1, outField);
	return { ax: outField.ax, ay: outField.ay };
}

/* ── 1. grid parameterisation and helpers ── */

assert.strictEqual(FFT.isPow2(256), true);
assert.strictEqual(FFT.isPow2(512), true);
assert.strictEqual(FFT.isPow2(300), false);
assert.strictEqual(FFT.isPow2(1), false);
const g1 = FFT.gridFor(1600, 1000);
assert.deepStrictEqual(g1, { gridX: 256, gridY: 256 });
assert.ok(1600 / g1.gridX <= FFT.CELL_MAX_PX && 1000 / g1.gridY <= FFT.CELL_MAX_PX);
const g2 = FFT.gridFor(4800, 1000);
assert.deepStrictEqual(g2, { gridX: 512, gridY: 256 });
assert.ok(4800 / g2.gridX <= FFT.CELL_MAX_PX && 1000 / g2.gridY <= FFT.CELL_MAX_PX);
assert.strictEqual(FFT.wrap(-0.1, 1600), 1599.9);
assert.strictEqual(FFT.wrap(1600, 1600), 0);
assert.strictEqual(FFT.wrap(0, 1600), 0);
assert.strictEqual(FFT.minImage(799, 1600), 799);
assert.strictEqual(Math.abs(FFT.minImage(800, 1600)), 800);
assert.strictEqual(Math.abs(FFT.minImage(-800, 1600)), 800);
assert.strictEqual(FFT.minImage(-799, 1600), -799);
assert.throws(() => FFT.fft2d(new Float64Array(2 * 6 * 4), 6, 4, false));
assert.throws(() => FFT.solve(6, 4, 1600, 1000,
	new Float64Array(1), new Float64Array(1), new Float64Array(1), 1));

/* ── 2. FFT round-trip on small square and rectangular grids ── */

function roundTrip(gx, gy, seed) {
	const n = gx * gy;
	const data = new Float64Array(n << 1);
	const backup = new Float64Array(n << 1);
	const rand = lcg(seed);
	for (let i = 0; i < n << 1; i++) data[i] = rand() * 2 - 1;
	backup.set(data);
	FFT.fft2d(data, gx, gy, false);
	FFT.fft2d(data, gx, gy, true);
	let worst = 0;
	for (let i = 0; i < n << 1; i++) {
		const e = Math.abs(data[i] - backup[i]);
		if (e > worst) worst = e;
	}
	assert.ok(worst < 1e-12, 'round-trip ' + gx + 'x' + gy + ' worst ' + worst);
}
roundTrip(8, 8, 1);
roundTrip(8, 4, 2);
roundTrip(4, 8, 3);
roundTrip(16, 2, 4);

/* ── 3. single-mode transform: normalisation, axis order and sign ── */

function singleMode(gx, gy, kx, ky) {
	const n = gx * gy;
	const data = new Float64Array(n << 1);
	for (let y = 0; y < gy; y++) {
		for (let x = 0; x < gx; x++) {
			const angle = 2 * Math.PI * (kx * x / gx + ky * y / gy);
			const i = (y * gx + x) << 1;
			data[i] = Math.cos(angle);
			data[i + 1] = Math.sin(angle);
		}
	}
	FFT.fft2d(data, gx, gy, false);
	const peak = (ky * gx + kx) << 1;
	assert.ok(Math.abs(Math.hypot(data[peak], data[peak + 1]) - n) < 1e-9,
		'single-mode ' + gx + 'x' + gy + ' (' + kx + ',' + ky + ') peak');
	for (let i = 0; i < n; i++) {
		if (i === ky * gx + kx) continue;
		const mag = Math.hypot(data[i << 1], data[(i << 1) + 1]);
		assert.ok(mag < 1e-9, 'single-mode leak at ' + i + ': ' + mag);
	}
}
singleMode(8, 8, 3, 5);
singleMode(8, 4, 3, 1);
singleMode(4, 8, 1, 3);
singleMode(16, 2, 5, 1);

/* ── 4. impulse convolution equals the kernel (shifted, wrapped) ── */

{
	const W = 1600;
	const H = 1000;
	const gx = 64;
	const gy = 32;
	const cx = 10;
	const cy = 7;
	const s = 1.7;
	const snap = solveOn([{ x: cx * (W / gx), y: cy * (H / gy), s: s }], W, H, gx, gy);
	const k = FFT.buildKernels(gx, gy, W, H);
	const mass = s * PS;
	/* the solver zeroes the phi kernel's DC bin, so the impulse potential is
	 * the wrapped kernel minus its grid mean (mean-zero phi by construction) */
	let phiMean = 0;
	for (let i = 0; i < gx * gy; i++) phiMean += k.phi[i];
	phiMean /= gx * gy;
	for (let iy = 0; iy < gy; iy++) {
		for (let ix = 0; ix < gx; ix++) {
			const kx = ((ix - cx) % gx + gx) % gx;
			const ky = ((iy - cy) % gy + gy) % gy;
			const ki = ky * gx + kx;
			const i = iy * gx + ix;
			assert.ok(Math.abs(snap.ax[i] - mass * k.ax[ki]) < 1e-9 * mass * A_REF / PS,
				'impulse ax at ' + i);
			assert.ok(Math.abs(snap.ay[i] - mass * k.ay[ki]) < 1e-9 * mass * A_REF / PS,
				'impulse ay at ' + i);
			assert.ok(Math.abs(snap.phi[i] - mass * (k.phi[ki] - phiMean)) < 1e-9 * mass / SOFT,
				'impulse phi at ' + i);
		}
	}
	/* sampled at the source cell centre it reads MU * the grid value */
	const g = gridField(snap, cx * (W / gx), cy * (H / gy));
	assert.ok(Math.abs(g.ax) < 1e-6 * A_REF, 'impulse self sample ' + g.ax);
}

/* ── 5. direct circular convolution through fft2d matches the loop ── */

{
	const gx = 8;
	const gy = 4;
	const n = gx * gy;
	const rho = new Float64Array(n);
	const ker = new Float64Array(n);
	const rand = lcg(9);
	for (let i = 0; i < n; i++) {
		rho[i] = rand() * 2 - 1;
		ker[i] = rand() * 2 - 1;
	}
	const expected = new Float64Array(n);
	for (let ny = 0; ny < gy; ny++) {
		for (let nx = 0; nx < gx; nx++) {
			let sum = 0;
			for (let my = 0; my < gy; my++) {
				for (let mx = 0; mx < gx; mx++) {
					const ky = ((ny - my) % gy + gy) % gy;
					const kx = ((nx - mx) % gx + gx) % gx;
					sum += rho[my * gx + mx] * ker[ky * gx + kx];
				}
			}
			expected[ny * gx + nx] = sum;
		}
	}
	const fr = new Float64Array(n << 1);
	const fk = new Float64Array(n << 1);
	for (let i = 0; i < n; i++) {
		fr[i << 1] = rho[i];
		fk[i << 1] = ker[i];
	}
	FFT.fft2d(fr, gx, gy, false);
	FFT.fft2d(fk, gx, gy, false);
	for (let i = 0; i < n; i++) {
		const a = i << 1;
		const r0 = fr[a];
		const r1 = fr[a + 1];
		const k0 = fk[a];
		const k1 = fk[a + 1];
		fr[a] = r0 * k0 - r1 * k1;
		fr[a + 1] = r0 * k1 + r1 * k0;
	}
	FFT.fft2d(fr, gx, gy, true);
	for (let i = 0; i < n; i++) {
		assert.ok(Math.abs(fr[i << 1] - expected[i]) < 1e-10,
			'circular convolution at ' + i + ': ' + fr[i << 1] + ' vs ' + expected[i]);
		assert.ok(Math.abs(fr[(i << 1) + 1]) < 1e-10, 'conv imag at ' + i);
	}
}

/* ── 6. CIC mass conservation: signed and zero-sum ── */

{
	const W = 1600;
	const H = 1000;
	const gx = 256;
	const gy = 256;
	const rand = lcg(11);
	const rho = new Float64Array(gx * gy);
	let total = 0;
	for (let i = 0; i < 400; i++) {
		const x = rand() * W;
		const y = rand() * H;
		const s = rand() * 6 - 1.5;
		FFT.deposit(rho, gx, gy, W, H, x, y, s);
		total += s;
	}
	/* some masses outside the world still conserve through the wrap */
	FFT.deposit(rho, gx, gy, W, H, -12.5, H + 3.25, 0.75);
	FFT.deposit(rho, gx, gy, W, H, W + 40, -7, -0.25);
	total += 0.5;
	let sum = 0;
	for (let i = 0; i < rho.length; i++) sum += rho[i];
	assert.ok(Math.abs(sum - total) < 1e-9 * Math.max(1, Math.abs(total)),
		'CIC conservation ' + sum + ' vs ' + total);

	const zero = new Float64Array(gx * gy);
	let mag = 0;
	for (let i = 0; i < 200; i++) {
		const s = rand() * 4 - 2;
		FFT.deposit(zero, gx, gy, W, H, rand() * W, rand() * H, s);
		FFT.deposit(zero, gx, gy, W, H, rand() * W, rand() * H, -s);
		mag += 2 * Math.abs(s);
	}
	let zsum = 0;
	for (let i = 0; i < zero.length; i++) zsum += zero[i];
	assert.ok(Math.abs(zsum) < 1e-9 * mag, 'zero-sum CIC ' + zsum);
}

/* ── 7. kernel signs, ties, oddness and DC ── */

{
	const W = 1600;
	const H = 1000;
	const gx = 256;
	const gy = 256;
	const k = FFT.buildKernels(gx, gy, W, H);
	const halfX = gx >> 1;
	const halfY = gy >> 1;
	const dx = W / gx;
	const dy = H / gy;
	for (let iy = 0; iy < gy; iy++) {
		/* complete Nyquist column: tied x-component is zero, y keeps (W/2)^2 */
		const i = iy * gx + halfX;
		assert.strictEqual(k.ax[i], 0, 'nyquist column ax');
		if (iy !== halfY) {
			const cy = iy <= halfY ? iy * dy : iy * dy - H;
			const expect = -cy / Math.pow((W / 2) * (W / 2) + cy * cy + SOFT2, 1.5);
			/* solver uses inv*sqrt(inv) where the oracle uses pow(...,1.5):
			 * a few ULPs of relative difference, not 1e-18 */
			assert.ok(Math.abs(k.ay[i] - expect) < 8e-16 * Math.abs(expect) + 1e-300,
				'nyquist column ay ' + k.ay[i] + ' vs ' + expect);
			assert.notStrictEqual(k.ay[i], 0, 'nyquist column ay not zeroed');
		}
	}
	for (let ix = 0; ix < gx; ix++) {
		/* complete Nyquist row: tied y-component is zero, x keeps (H/2)^2 */
		const i = halfY * gx + ix;
		assert.strictEqual(k.ay[i], 0, 'nyquist row ay');
		if (ix !== halfX) {
			const cx = ix <= halfX ? ix * dx : ix * dx - W;
			const expect = -cx / Math.pow(cx * cx + (H / 2) * (H / 2) + SOFT2, 1.5);
			assert.ok(Math.abs(k.ax[i] - expect) < 8e-16 * Math.abs(expect) + 1e-300,
				'nyquist row ax');
			assert.notStrictEqual(k.ax[i], 0, 'nyquist row ax not zeroed');
		}
	}
	/* origin already zero for force (as -0: it is -0*fall, a real zero),
	 * phi keeps its self value */
	assert.ok(k.ax[0] === 0, 'origin ax zero');
	assert.ok(k.ay[0] === 0, 'origin ay zero');
	assert.ok(k.phi[0] < 0 && Math.abs(k.phi[0] + 1 / SOFT) < 1e-15);
	/* positive source pulls a point on its +x side back toward -x */
	assert.ok(k.ax[1] < 0, 'sign: source left of sample attracts leftward');
	assert.ok(k.ay[gx] < 0, 'sign: source above sample attracts upward');
	/* odd force / even potential under full-cell negation, all cells */
	let sumAx = 0;
	let sumAy = 0;
	for (let iy = 0; iy < gy; iy++) {
		for (let ix = 0; ix < gx; ix++) {
			const i = iy * gx + ix;
			const j = ((gy - iy) % gy) * gx + ((gx - ix) % gx);
			assert.ok(Math.abs(k.ax[i] + k.ax[j]) <= 1e-300 + 1e-18 * Math.abs(k.ax[i]),
				'odd ax ' + i);
			assert.ok(Math.abs(k.ay[i] + k.ay[j]) <= 1e-300 + 1e-18 * Math.abs(k.ay[i]),
				'odd ay ' + i);
			assert.ok(Math.abs(k.phi[i] - k.phi[j]) <= 1e-18 * Math.abs(k.phi[i]),
				'even phi ' + i);
			sumAx += k.ax[i];
			sumAy += k.ay[i];
		}
	}
	/* DC: the real-space sums are ~0 by oddness; spectra zero them exactly */
	let scale = 0;
	for (let i = 0; i < k.ax.length; i++) scale = Math.max(scale, Math.abs(k.ax[i]));
	assert.ok(Math.abs(sumAx) < 1e-12 * gx * gy * scale, 'kernel DC ax ' + sumAx);
	assert.ok(Math.abs(sumAy) < 1e-12 * gx * gy * scale, 'kernel DC ay ' + sumAy);
}

/* ── 8. uniform background, self-force, periodic translations ── */

{
	const W = 1600;
	const H = 1000;
	const gx = 32;
	const gy = 16;
	/* a body at every cell centre deposits a constant rho: DC-zeroed kernels
	 * must give zero acceleration everywhere */
	const bodies = [];
	for (let iy = 0; iy < gy; iy++) {
		for (let ix = 0; ix < gx; ix++) {
			bodies.push({ x: ix * (W / gx), y: iy * (H / gy), s: 1 });
		}
	}
	const snap = solveOn(bodies, W, H, gx, gy);
	const rand = lcg(13);
	let worst = 0;
	for (let i = 0; i < 40; i++) {
		const g = gridField(snap, rand() * W, rand() * H);
		worst = Math.max(worst, Math.hypot(g.ax, g.ay));
	}
	assert.ok(worst < 1e-6 * A_REF, 'uniform background ' + worst);

	/* self-force: sample exactly at an off-centre body's position */
	const self = solveOn([{ x: 333.3, y: 222.2, s: 2.5 }], W, H, gx, gy);
	const sg = gridField(self, 333.3, 222.2);
	assert.ok(Math.hypot(sg.ax, sg.ay) < 1e-9 * A_REF, 'self-force ' + sg.ax + ',' + sg.ay);

	/* periodic translation: the seam wraps the sample and the deposit */
	const one = solveOn([{ x: 400, y: 300, s: 1.2 }, { x: 1200, y: 700, s: -0.8 }],
		W, H, gx, gy);
	const a = gridField(one, 12.5, 777.75);
	const b = gridField(one, 12.5 + W, 777.75);
	const c = gridField(one, 12.5, 777.75 - H);
	assert.ok(Math.hypot(a.ax - b.ax, a.ay - b.ay) < 1e-9 * Math.max(A_REF, Math.hypot(a.ax, a.ay)),
		'seam sample x');
	assert.ok(Math.hypot(a.ax - c.ax, a.ay - c.ay) < 1e-9 * Math.max(A_REF, Math.hypot(a.ax, a.ay)),
		'seam sample y');
	const shifted = solveOn([{ x: 400 + 3 * (W / gx), y: 300, s: 1.2 },
		{ x: 1200 + 3 * (W / gx), y: 700, s: -0.8 }], W, H, gx, gy);
	const d = gridField(shifted, 12.5 + 3 * (W / gx), 777.75);
	assert.ok(Math.hypot(a.ax - d.ax, a.ay - d.ay) < 1e-9 * Math.max(A_REF, Math.hypot(a.ax, a.ay)),
		'whole-cell translation');
	const rho = new Float64Array(gx * gy);
	FFT.deposit(rho, gx, gy, W, H, 111.5, 222.25, 1.5);
	const rho2 = new Float64Array(gx * gy);
	FFT.deposit(rho2, gx, gy, W, H, 111.5 + W, 222.25 - H, 1.5);
	for (let i = 0; i < rho.length; i++) {
		assert.strictEqual(rho2[i], rho[i], 'deposit wrap identical at ' + i);
	}
}

/* ── 9. direct oracle: ordinary bounds and cut-strip tests ── */

function oracleCase(name, bodies, W, H, gridX, gridY) {
	const snap = solveOn(bodies, W, H, gridX, gridY);
	const { cw, ch } = cellSize(gridX, gridY, W, H);
	const boundStrip = MU * PS * strengthSum(bodies) / SOFT2;
	const rand = lcg(0xbeef + gridX + bodies.length);
	const samples = [];
	/* deterministic scattered */
	for (let i = 0; i < 160; i++) samples.push({ x: rand() * W, y: rand() * H });
	/* cell-adjacent: floor / weight transitions of the gather */
	for (let i = 1; i <= 8; i++) {
		samples.push({ x: i * 37 * cw + 0.999999 * cw, y: (i * 53 % 250) * ch });
		samples.push({ x: i * 41 * cw + 1e-9 * cw, y: (i * 67 % 250) * ch + 0.5 * ch });
	}
	/* seam-adjacent: the world wrap itself is not a cut */
	samples.push({ x: 0.01, y: 500 });
	samples.push({ x: W - 0.01, y: 500 });
	samples.push({ x: 800, y: 0.01 });
	samples.push({ x: 800, y: H - 0.01 });
	samples.push({ x: 0.01, y: 0.01 });
	samples.push({ x: W - 0.01, y: H - 0.01 });
	/* radial approach to the first body: inside and outside 2*SOFT */
	const anchor = bodies[0];
	for (const r of [0, 0.3 * SOFT, 0.7 * SOFT, 1.4 * SOFT, 1.9 * SOFT, 2.5 * SOFT]) {
		for (let a = 0; a < 4; a++) {
			const ang = a * Math.PI / 2 + 0.3;
			samples.push({ x: anchor.x + r * Math.cos(ang), y: anchor.y + r * Math.sin(ang) });
		}
	}
	/* cancellation: midpoints of opposite-signed pairs */
	for (let i = 0; i + 1 < bodies.length && samples.length < 400; i++) {
		if (bodies[i].s * bodies[i + 1].s >= 0) continue;
		samples.push({ x: (bodies[i].x + bodies[i + 1].x) / 2,
			y: (bodies[i].y + bodies[i + 1].y) / 2 });
	}
	/* strip samples: around each body's x- and y-cuts, inside +-2 cells */
	for (let i = 0; i < bodies.length; i++) {
		const b = bodies[i];
		for (const frac of [-1.75, -0.5, 0, 0.5, 1.75]) {
			samples.push({ x: FFT.wrap(b.x + W / 2 + frac * cw, W), y: b.y });
			samples.push({ x: b.x, y: FFT.wrap(b.y + H / 2 + frac * ch, H) });
		}
	}

	let ordinary = 0;
	let inside = 0;
	let stripped = 0;
	let maxOutsideRatio = 0;
	let maxInsideRatio = 0;
	for (const p of samples) {
		const x = FFT.wrap(p.x, W);
		const y = FFT.wrap(p.y, H);
		const g = gridField(snap, x, y);
		const d = directField(bodies, x, y, W, H);
		assert.ok(Number.isFinite(g.ax) && Number.isFinite(g.ay),
			name + ' grid finite at ' + x + ',' + y);
		assert.ok(Number.isFinite(d.ax) && Number.isFinite(d.ay),
			name + ' direct finite at ' + x + ',' + y);
		if (inCutStrip(bodies, x, y, W, H, cw, ch)) {
			/* strips: finiteness (above), magnitude, symmetry and jump */
			stripped += 1;
			const mag = Math.hypot(g.ax, g.ay);
			assert.ok(mag <= boundStrip * (1 + 1e-9),
				name + ' strip magnitude ' + mag + ' > ' + boundStrip);
			const dmag = Math.hypot(d.ax, d.ay);
			assert.ok(dmag <= boundStrip * (1 + 1e-9),
				name + ' strip direct magnitude ' + dmag);
			/* mirror about the nearest body's x- or y-cut */
			let best = 0;
			let bestD = Infinity;
			let axis = 'x';
			for (const b of bodies) {
				let dx = x - b.x;
				let dy = y - b.y;
				dx -= W * Math.round(dx / W);
				dy -= H * Math.round(dy / H);
				const gapX = W / 2 - Math.abs(dx);
				const gapY = H / 2 - Math.abs(dy);
				if (gapX < bestD) { bestD = gapX; best = bodies.indexOf(b); axis = 'x'; }
				if (gapY < bestD) { bestD = gapY; best = bodies.indexOf(b); axis = 'y'; }
			}
			const b = bodies[best];
			/* A sample sitting exactly on the cut is a fixed point of the
			 * reflection; 2*b - p in floats lands 1 ulp off the tie and the
			 * oracle's zero-at-tie convention would see the full jump, so
			 * snap the mirror back onto the sample. */
			let bdx = x - b.x;
			bdx -= W * Math.round(bdx / W);
			let bdy = y - b.y;
			bdy -= H * Math.round(bdy / H);
			const mx = axis === 'x'
				? (Math.abs(bdx) === W / 2 ? x : FFT.wrap(2 * b.x - x, W))
				: x;
			const my = axis === 'y'
				? (Math.abs(bdy) === H / 2 ? y : FFT.wrap(2 * b.y - y, H))
				: y;
			const gm = gridField(snap, mx, my);
			const dm = directField(bodies, mx, my, W, H);
			if (axis === 'x') {
				/* x-component antisymmetric, y-component symmetric about the cut */
				assert.ok(Math.abs(g.ax + gm.ax) <= boundStrip * (1 + 1e-9),
					name + ' strip grid x-symmetry');
				assert.ok(Math.abs(g.ay - gm.ay) <= boundStrip * (1 + 1e-9),
					name + ' strip grid y-symmetry');
				/* exactness concerns the nearest body's own pull: the other
				 * bodies form a smooth background across the cut, so compare
				 * the field with and without them rather than to zero */
				const rest = [];
				for (let i = 0; i < bodies.length; i++) if (i !== best) rest.push(bodies[i]);
				const restD = directField(rest, x, y, W, H);
				const restM = directField(rest, mx, my, W, H);
				assert.ok(Math.abs((d.ax + dm.ax) - (restD.ax + restM.ax)) <= 1e-6 * boundStrip + 1e-9,
					name + ' strip direct x-symmetry ' + d.ax + ' + ' + dm.ax +
					' vs rest ' + restD.ax + ' + ' + restM.ax);
				assert.ok(Math.abs((d.ay - dm.ay) - (restD.ay - restM.ay)) <= 1e-6 * boundStrip + 1e-9,
					name + ' strip direct y-symmetry');
			} else {
				assert.ok(Math.abs(g.ay + gm.ay) <= boundStrip * (1 + 1e-9),
					name + ' strip grid y-symmetry');
				assert.ok(Math.abs(g.ax - gm.ax) <= boundStrip * (1 + 1e-9),
					name + ' strip grid x-symmetry');
				const restY = [];
				for (let i = 0; i < bodies.length; i++) if (i !== best) restY.push(bodies[i]);
				const restDY = directField(restY, x, y, W, H);
				const restMY = directField(restY, mx, my, W, H);
				assert.ok(Math.abs((d.ay + dm.ay) - (restDY.ay + restMY.ay)) <= 1e-6 * boundStrip + 1e-9,
					name + ' strip direct y-symmetry ' + d.ay + ' + ' + dm.ay);
				assert.ok(Math.abs((d.ax - dm.ax) - (restDY.ax - restMY.ax)) <= 1e-6 * boundStrip + 1e-9,
					name + ' strip direct x-symmetry');
			}
			/* bounded jump: a pair straddling the mirror point stays under the bound */
			const jx = axis === 'x' ? FFT.wrap(mx + 0.75 * cw, W) : x;
			const jy = axis === 'y' ? FFT.wrap(my + 0.75 * ch, H) : y;
			const gj = gridField(snap, jx, jy);
			const jump = Math.hypot(gj.ax - g.ax, gj.ay - g.ay);
			assert.ok(jump <= 2 * boundStrip * (1 + 1e-9),
				name + ' strip jump ' + jump + ' > ' + 2 * boundStrip);
			continue;
		}
		const near = nearestBody(bodies, x, y, W, H);
		const err = Math.hypot(g.ax - d.ax, g.ay - d.ay);
		const ref = Math.hypot(d.ax, d.ay);
		if (near < 2 * SOFT) {
			inside += 1;
			const lim = 0.10 * ref + 0.01 * A_REF;
			assert.ok(err <= lim,
				name + ' inside-2eps err ' + err + ' > ' + lim +
				' at ' + x + ',' + y + ' near ' + near);
			maxInsideRatio = Math.max(maxInsideRatio, err / lim);
		} else {
			ordinary += 1;
			const lim = 0.05 * ref + 0.01 * A_REF;
			assert.ok(err <= lim,
				name + ' ordinary err ' + err + ' > ' + lim +
				' at ' + x + ',' + y + ' near ' + near);
			maxOutsideRatio = Math.max(maxOutsideRatio, err / lim);
		}
	}
	/* Dense configs (the 192 lattice, spacing < 2ε) admit no outside-2ε
	 * point at all: every non-strip sample takes the inside bound instead,
	 * so demand a healthy count from either side. Sparse configs deliver
	 * ordinary samples; if misclassification emptied ordinary for one,
	 * its inside count stays under 40 and fails here. */
	assert.ok(ordinary > 40 || inside > 40,
		name + ' ordinary samples ' + ordinary + ', inside ' + inside);
	assert.ok(inside > 8, name + ' inside samples ' + inside);
	assert.ok(stripped >= bodies.length * 8, name + ' strip samples ' + stripped);
	return { ordinary: ordinary, inside: inside, stripped: stripped,
		maxOutsideRatio: maxOutsideRatio, maxInsideRatio: maxInsideRatio };
}

/* bodies: single positive, single negative, asymmetric 8-body, 192 lattice */
const singlePos = [{ x: 400, y: 300, s: 1.5 }];
const singleNeg = [{ x: 1200, y: 700, s: -2 }];
const eight = [
	{ x: 150, y: 120, s: 1.5 },
	{ x: 640, y: 95, s: -1 },
	{ x: 1310, y: 210, s: 3 },
	{ x: 260, y: 700, s: 0.5 },
	{ x: 900, y: 520, s: -2 },
	{ x: 1450, y: 830, s: 4 },
	{ x: 520, y: 950, s: 1 },
	{ x: 1080, y: 940, s: -0.5 }
];
function lattice192(seed) {
	const W = 1600;
	const H = 1000;
	const rand = lcg(seed);
	const bodies = [];
	for (let row = 0; row < 12; row++) {
		for (let col = 0; col < 16; col++) {
			/* plan: jitter = ±1 px (not ±1 cell) around the lattice centre */
			const x = (col + 0.5) * 100 + (rand() * 2 - 1);
			const y = (row + 0.5) * (H / 12) + (rand() * 2 - 1);
			const s = Math.round((rand() * 6 - 1) * 20) / 20;
			bodies.push({ x: FFT.wrap(x, W), y: FFT.wrap(y, H), s: s === 0 ? 0.05 : s });
		}
	}
	return bodies;
}

const stats = {};
stats.singlePos256 = oracleCase('single+ 256', singlePos, 1600, 1000, 256, 256);
stats.singleNeg256 = oracleCase('single- 256', singleNeg, 1600, 1000, 256, 256);
stats.eight256 = oracleCase('eight 256', eight, 1600, 1000, 256, 256);
stats.eight512 = oracleCase('eight 512x256', eight, 1600, 1000, 512, 256);
const lattice = lattice192(42);
assert.strictEqual(new Set(lattice.map(b => b.x.toFixed(6) + ',' + b.y.toFixed(6))).size, 192,
	'192 unique lattice positions');
stats.lattice256 = oracleCase('lattice192 256', lattice, 1600, 1000, 256, 256);
stats.lattice512 = oracleCase('lattice192 512x256', lattice, 1600, 1000, 512, 256);

/* ── 10. potential: mean-zero, polarity, finite-difference vs acceleration ── */

{
	const W = 1600;
	const H = 1000;
	const gx = 256;
	const gy = 256;
	/* mean-zero on a signed field */
	const snap = solveOn(eight, W, H, gx, gy);
	let sum = 0;
	let absSum = 0;
	let maxAbs = 0;
	for (let i = 0; i < snap.phi.length; i++) {
		sum += snap.phi[i];
		absSum += Math.abs(snap.phi[i]);
		maxAbs = Math.max(maxAbs, Math.abs(snap.phi[i]));
	}
	assert.ok(Math.abs(sum) < 1e-9 * absSum, 'phi mean-zero ' + sum + ' / ' + absSum);

	/* signed-palette polarity: attraction (positive mass) reads negative phi
	 * at the source, repulsion reads positive, and the mean-zero gauge puts
	 * the far side on the opposite sign */
	const pos = solveOn([{ x: 400, y: 300, s: 2 }], W, H, gx, gy);
	const posAt = pos.samplePhi(400, 300, 1);
	const posFar = pos.samplePhi(1300, 850, 1);
	assert.ok(posAt < 0, 'positive mass phi at source ' + posAt);
	assert.ok(posFar > 0, 'positive mass phi far ' + posFar);
	const neg = solveOn([{ x: 400, y: 300, s: -2 }], W, H, gx, gy);
	assert.ok(neg.samplePhi(400, 300, 1) > 0, 'negative mass phi at source');
	assert.ok(neg.samplePhi(1300, 850, 1) < 0, 'negative mass phi far');

	/* finite-difference -grad(phi) vs the acceleration grid, away from cuts */
	const { cw, ch } = cellSize(gx, gy, W, H);
	let checked = 0;
	let worst = 0;
	for (let iy = 2; iy < gy - 2; iy += 3) {
		for (let ix = 2; ix < gx - 2; ix += 3) {
			const x = ix * cw;
			const y = iy * ch;
			if (inCutStrip(eight, x, y, W, H, cw, ch)) continue;
			const fdx = -(snap.phi[iy * gx + ((ix + 1) % gx)] -
				snap.phi[iy * gx + ((ix + gx - 1) % gx)]) / (2 * cw);
			const fdy = -(snap.phi[((iy + 1) % gy) * gx + ix] -
				snap.phi[((iy + gy - 1) % gy) * gx + ix]) / (2 * ch);
			const g = gridField(snap, x, y);
			const err = Math.hypot(MU * fdx - g.ax, MU * fdy - g.ay);
			const ref = Math.hypot(g.ax, g.ay);
			const lim = 0.05 * ref + 0.02 * A_REF;
			assert.ok(err <= lim, 'fd-grad at ' + x + ',' + y + ': ' + err + ' > ' + lim);
			worst = Math.max(worst, err / lim);
			checked += 1;
		}
	}
	assert.ok(checked > 300, 'fd samples ' + checked);
	stats.fdWorst = worst;
}

console.log('fft_test ok; oracle ' +
	Object.keys(stats).map(k => k + '=' + JSON.stringify(stats[k])).join(' '));
