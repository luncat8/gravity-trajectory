/*
 * Periodic FFT gravity for the `&fft=1` torus (0.8.0): the shipped 3D
 * Plummer kernel evaluated in the plane, minimum-image — one nearest image
 * per body, never an infinite lattice sum and never a 2D log potential.
 * Static bodies deposit mass with CIC onto a power-of-two grid; one forward
 * transform of rho multiplied by three cached kernel spectra (kAx, kAy,
 * kPhi) and three inverse transforms solve acceleration and potential
 * together. Softening spans ~6-15 cells, so CIC needs no P3M near-field.
 *
 * Contract (experiments/fft_test.js is the independent oracle):
 *  - cells index as y * gridX + x, origin at index zero, no fftshift;
 *  - forward FFT unnormalized with negative exponential, inverse positive,
 *    dividing by gridX * gridY exactly once across the 2-D pass;
 *  - d = sample - source: K_a(d) = -d / (|d|^2 + e^2)^{3/2},
 *    K_phi(d) = -1 / sqrt(|d|^2 + e^2); at exactly +-L/2 the tied axis
 *    component averages to zero while its squared distance stays in the
 *    denominator, which keeps the discrete force odd and self-force zero;
 *  - every kernel's Fourier DC bin is removed after the transform: a
 *    uniform field must not accelerate, and phi reads relative to its grid
 *    mean (kPhi's real-space origin is kept — only the DC bin goes);
 *  - PERIODIC_STRENGTH scales deposited mass exactly once; MU * gravityScale
 *    multiplies at sample/paint time, so the g field slider never re-solves.
 */
(function (root) {
	'use strict';

	const MU = 400000;
	const SOFT = 60;
	const SOFT2 = SOFT * SOFT;
	/* the draft's «probably 2x less gravity»: applied to deposited mass
	 * exactly once; sample-time MU * gravityScale never includes it again */
	const PERIODIC_STRENGTH = 0.5;
	const GRID_X = 256;
	const GRID_Y = 256;
	/* cell ceiling in px — the grid doubles until dx and dy fit it:
	 * 256x256 on 1600x1000 (6.25 x 3.91 px), 512x256 on 4800x1000 (0.8.1) */
	const CELL_MAX_PX = 10;

	function isPow2(n) {
		return n >= 2 && (n & (n - 1)) === 0;
	}

	function checkGrid(gridX, gridY) {
		if (!isPow2(gridX) || !isPow2(gridY)) {
			throw new Error('GravityFFT: grid axes must be powers of two >= 2');
		}
	}

	/* smallest grid with at least GRID_X / GRID_Y cells whose cells fit
	 * CELL_MAX_PX, each axis rounded up to a power of two */
	function gridFor(worldW, worldH) {
		let gridX = GRID_X;
		let gridY = GRID_Y;
		while (worldW / gridX > CELL_MAX_PX) gridX *= 2;
		while (worldH / gridY > CELL_MAX_PX) gridY *= 2;
		return { gridX: gridX, gridY: gridY };
	}

	/* world-coordinate wrap into [0, L) */
	function wrap(v, L) {
		return v - L * Math.floor(v / L);
	}

	/* nearest image of the offset d in [-L/2, L/2]; a half-world tie lands
	 * on -L/2 with |d| === L/2, which callers test to zero that component */
	function minImage(d, L) {
		return d - L * Math.round(d / L);
	}

	function wrapIndex(i, n) {
		return ((i % n) + n) % n;
	}

	/* ── radix-2 complex FFT ── bit-reversal and twiddle tables cached per size, column scratch reused */

	const reverseCache = new Map();
	const twiddleCache = new Map();
	let colScratch = new Float64Array(0);

	function reverseTable(n) {
		let table = reverseCache.get(n);
		if (table) return table;
		table = new Uint32Array(n);
		const bits = Math.round(Math.log2(n));
		for (let i = 0; i < n; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) {
				if (i & (1 << b)) r |= 1 << (bits - 1 - b);
			}
			table[i] = r;
		}
		reverseCache.set(n, table);
		return table;
	}

	/* exp(-2pi i k / n) for k = 0 .. n/2 - 1; inverse uses the conjugate */
	function twiddleTable(n) {
		let table = twiddleCache.get(n);
		if (table) return table;
		const half = n >> 1;
		table = new Float64Array(half << 1);
		for (let k = 0; k < half; k++) {
			const angle = -2 * Math.PI * k / n;
			table[k << 1] = Math.cos(angle);
			table[(k << 1) + 1] = Math.sin(angle);
		}
		twiddleCache.set(n, table);
		return table;
	}

	/* one 1-D pass over interleaved [re, im] pairs starting at `off` */
	function fft1d(data, off, n, inverse) {
		const rev = reverseTable(n);
		for (let i = 0; i < n; i++) {
			const j = rev[i];
			if (j > i) {
				const a = off + (i << 1);
				const b = off + (j << 1);
				let t = data[a];
				data[a] = data[b];
				data[b] = t;
				t = data[a + 1];
				data[a + 1] = data[b + 1];
				data[b + 1] = t;
			}
		}
		const tw = twiddleTable(n);
		for (let len = 2; len <= n; len <<= 1) {
			const half = len >> 1;
			const step = n / len;
			for (let base = 0; base < n; base += len) {
				for (let j = 0; j < half; j++) {
					const k = j * step;
					const wr = tw[k << 1];
					const wi = inverse ? -tw[(k << 1) + 1] : tw[(k << 1) + 1];
					const a = off + ((base + j) << 1);
					const b = off + ((base + j + half) << 1);
					const xr = data[b] * wr - data[b + 1] * wi;
					const xi = data[b] * wi + data[b + 1] * wr;
					data[b] = data[a] - xr;
					data[b + 1] = data[a + 1] - xi;
					data[a] += xr;
					data[a + 1] += xi;
				}
			}
		}
		if (inverse) {
			const scale = 1 / n;
			for (let i = 0; i < n; i++) {
				data[off + (i << 1)] *= scale;
				data[off + (i << 1) + 1] *= scale;
			}
		}
	}

	/* 2-D transform of gridX x gridY interleaved complex data: rows, then
	 * columns through the shared scratch. Inverse scales rows by 1/gridX and
	 * columns by 1/gridY, so gridX * gridY is divided exactly once. */
	function fft2d(data, gridX, gridY, inverse) {
		checkGrid(gridX, gridY);
		for (let y = 0; y < gridY; y++) fft1d(data, (y * gridX) << 1, gridX, inverse);
		if (colScratch.length < gridY << 1) colScratch = new Float64Array(gridY << 1);
		for (let x = 0; x < gridX; x++) {
			const base = x << 1;
			const stride = gridX << 1;
			for (let y = 0; y < gridY; y++) {
				colScratch[y << 1] = data[base + y * stride];
				colScratch[(y << 1) + 1] = data[base + y * stride + 1];
			}
			fft1d(colScratch, 0, gridY, inverse);
			for (let y = 0; y < gridY; y++) {
				data[base + y * stride] = colScratch[y << 1];
				data[base + y * stride + 1] = colScratch[(y << 1) + 1];
			}
		}
	}

	/* ── unit kernels ── real-space builder for tests, spectra cached per geometry */

	function buildKernels(gridX, gridY, worldW, worldH) {
		checkGrid(gridX, gridY);
		const n = gridX * gridY;
		const dx = worldW / gridX;
		const dy = worldH / gridY;
		const halfX = gridX >> 1;
		const halfY = gridY >> 1;
		const ax = new Float64Array(n);
		const ay = new Float64Array(n);
		const phi = new Float64Array(n);
		for (let iy = 0; iy < gridY; iy++) {
			let cy = iy * dy;
			const tieY = iy === halfY;
			if (iy > halfY) cy -= worldH;
			for (let ix = 0; ix < gridX; ix++) {
				let cx = ix * dx;
				const tieX = ix === halfX;
				if (ix > halfX) cx -= worldW;
				const i = iy * gridX + ix;
				const inv = 1 / (cx * cx + cy * cy + SOFT2);
				const fall = inv * Math.sqrt(inv);
				ax[i] = tieX ? 0 : -cx * fall;
				ay[i] = tieY ? 0 : -cy * fall;
				phi[i] = -Math.sqrt(inv);
			}
		}
		return { ax: ax, ay: ay, phi: phi };
	}

	const kernelCache = new Map();
	const unitPhiMeanCache = new Map();

	function spectrumOf(real, gridX, gridY) {
		const n = gridX * gridY;
		const data = new Float64Array(n << 1);
		for (let i = 0; i < n; i++) data[i << 1] = real[i];
		fft2d(data, gridX, gridY, false);
		/* Fourier DC bin (index 0, no fftshift): zero after transforming —
		 * for kAx/kAy the real-space sum is already ~0 by oddness, this only
		 * removes float residue; for kPhi it mean-references the potential */
		data[0] = 0;
		data[1] = 0;
		return data;
	}

	function kernelSpectra(gridX, gridY, worldW, worldH) {
		const key = gridX + 'x' + gridY + '@' + worldW + 'x' + worldH + '/' + SOFT;
		let entry = kernelCache.get(key);
		if (entry) return entry;
		const real = buildKernels(gridX, gridY, worldW, worldH);
		const n = gridX * gridY;
		let sumInv = 0;
		for (let i = 0; i < n; i++) sumInv -= real.phi[i];
		const mean = sumInv / n;
		unitPhiMeanCache.set(key, mean);
		entry = {
			ax: spectrumOf(real.ax, gridX, gridY),
			ay: spectrumOf(real.ay, gridX, gridY),
			phi: spectrumOf(real.phi, gridX, gridY),
			unitPhiMean: mean
		};
		kernelCache.set(key, entry);
		return entry;
	}

	function unitPhiMean(worldW, worldH) {
		const grid = gridFor(worldW, worldH);
		const gridX = grid.gridX, gridY = grid.gridY;
		const key = gridX + 'x' + gridY + '@' + worldW + 'x' + worldH + '/' + SOFT;
		const cached = unitPhiMeanCache.get(key);
		if (cached !== undefined) return cached;
		const dx = worldW / gridX;
		const dy = worldH / gridY;
		const halfX = gridX >> 1;
		const halfY = gridY >> 1;
		let sumInv = 0;
		for (let iy = 0; iy < gridY; iy++) {
			let cy = iy * dy;
			if (iy > halfY) cy -= worldH;
			for (let ix = 0; ix < gridX; ix++) {
				let cx = ix * dx;
				if (ix > halfX) cx -= worldW;
				sumInv += 1 / Math.sqrt(cx * cx + cy * cy + SOFT2);
			}
		}
		const mean = sumInv / (gridX * gridY);
		unitPhiMeanCache.set(key, mean);
		return mean;
	}

	/* ── CIC ── deposit spreads mass to the four nearest cell centres, gather
	 * interpolates back; both wrap every neighbour, neither scales by cell area */

	function deposit(rho, gridX, gridY, worldW, worldH, x, y, mass) {
		const dx = worldW / gridX;
		const dy = worldH / gridY;
		/* wrap the coordinate into the world first: on a torus x and
		 * x + worldW must deposit bit-identically, and a body far outside
		 * keeps full precision in the cell weights */
		x -= worldW * Math.floor(x / worldW);
		y -= worldH * Math.floor(y / worldH);
		const tx = x / dx;
		const ty = y / dy;
		const ix0 = Math.floor(tx);
		const iy0 = Math.floor(ty);
		const wx = tx - ix0;
		const wy = ty - iy0;
		const i0 = wrapIndex(ix0, gridX);
		const i1 = wrapIndex(ix0 + 1, gridX);
		const j0 = wrapIndex(iy0, gridY);
		const j1 = wrapIndex(iy0 + 1, gridY);
		rho[j0 * gridX + i0] += mass * (1 - wx) * (1 - wy);
		rho[j0 * gridX + i1] += mass * wx * (1 - wy);
		rho[j1 * gridX + i0] += mass * (1 - wx) * wy;
		rho[j1 * gridX + i1] += mass * wx * wy;
	}

	function gather(grid, gridX, gridY, dx, dy, x, y) {
		/* same torus normalisation as deposit: sample(x) === sample(x + L) */
		const worldW = dx * gridX;
		const worldH = dy * gridY;
		x -= worldW * Math.floor(x / worldW);
		y -= worldH * Math.floor(y / worldH);
		const tx = x / dx;
		const ty = y / dy;
		const ix0 = Math.floor(tx);
		const iy0 = Math.floor(ty);
		const wx = tx - ix0;
		const wy = ty - iy0;
		const i0 = wrapIndex(ix0, gridX);
		const i1 = wrapIndex(ix0 + 1, gridX);
		const j0 = wrapIndex(iy0, gridY);
		const j1 = wrapIndex(iy0 + 1, gridY);
		return grid[j0 * gridX + i0] * (1 - wx) * (1 - wy) +
			grid[j0 * gridX + i1] * wx * (1 - wy) +
			grid[j1 * gridX + i0] * (1 - wx) * wy +
			grid[j1 * gridX + i1] * wx * wy;
	}

	/* ── solve ── one forward rho transform, one inverse per output grid;
	 * work buffers are module-level and grown once, outputs belong to the
	 * snapshot and are never rewritten, so matching sims can share them */

	let workReal = new Float64Array(0);
	let workRho = new Float64Array(0);
	let workMul = new Float64Array(0);
	let revisions = 0;

	function ensureWork(n) {
		if (workReal.length < n) workReal = new Float64Array(n);
		if (workRho.length < n << 1) workRho = new Float64Array(n << 1);
		if (workMul.length < n << 1) workMul = new Float64Array(n << 1);
	}

	function multiplyInverse(rho, kernel, out, gridX, gridY) {
		const n = gridX * gridY;
		for (let i = 0; i < n; i++) {
			const a = i << 1;
			const r0 = rho[a];
			const r1 = rho[a + 1];
			const k0 = kernel[a];
			const k1 = kernel[a + 1];
			workMul[a] = r0 * k0 - r1 * k1;
			workMul[a + 1] = r0 * k1 + r1 * k0;
		}
		fft2d(workMul, gridX, gridY, true);
		for (let i = 0; i < n; i++) out[i] = workMul[i << 1];
	}

	function makeSnapshot(gridX, gridY, worldW, worldH, ax, ay, phi) {
		const dx = worldW / gridX;
		const dy = worldH / gridY;
		const spanW = dx * gridX;
		const spanH = dy * gridY;
		const maskX = gridX - 1;
		const maskY = gridY - 1;
		return {
			gridX: gridX,
			gridY: gridY,
			worldW: worldW,
			worldH: worldH,
			dx: dx,
			dy: dy,
			ax: ax,
			ay: ay,
			phi: phi,
			revision: ++revisions,
			/* CIC gather scaled by MU * gravityScale; PERIODIC_STRENGTH is
			 * already inside the deposited mass */
			sample: function (x, y, scale, outField) {
				const xw = x - spanW * Math.floor(x / spanW);
				const yw = y - spanH * Math.floor(y / spanH);
				const tx = xw / dx;
				const ty = yw / dy;
				const ix0 = Math.floor(tx);
				const iy0 = Math.floor(ty);
				const wx = tx - ix0;
				const wy = ty - iy0;
				const ox = 1 - wx;
				const oy = 1 - wy;
				const i0 = ix0 & maskX;
				const i1 = (ix0 + 1) & maskX;
				const r0 = (iy0 & maskY) * gridX;
				const r1 = ((iy0 + 1) & maskY) * gridX;
				const c00 = r0 + i0;
				const c01 = r0 + i1;
				const c10 = r1 + i0;
				const c11 = r1 + i1;
				const s = MU * scale;
				outField.ax = s * (ax[c00] * ox * oy + ax[c01] * wx * oy +
					ax[c10] * ox * wy + ax[c11] * wx * wy);
				outField.ay = s * (ay[c00] * ox * oy + ay[c01] * wx * oy +
					ay[c10] * ox * wy + ay[c11] * wx * wy);
				return outField;
			},
			samplePhi: function (x, y, scale) {
				return MU * scale * gather(phi, gridX, gridY, dx, dy, x, y);
			}
		};
	}

	/* Solve the static field of `count` bodies at (xs[i], ys[i]) with signed
	 * strengths[i]. Returns a fresh immutable snapshot; geometry-keyed kernel
	 * spectra and the transform workspace are shared with every other solve. */
	function solve(gridX, gridY, worldW, worldH, xs, ys, strengths, count) {
		checkGrid(gridX, gridY);
		const n = gridX * gridY;
		ensureWork(n);
		workReal.fill(0, 0, n);
		for (let i = 0; i < count; i++) {
			const mass = strengths[i] * PERIODIC_STRENGTH;
			if (mass === 0) continue;
			deposit(workReal, gridX, gridY, worldW, worldH, xs[i], ys[i], mass);
		}
		for (let i = 0; i < n; i++) {
			workRho[i << 1] = workReal[i];
			workRho[(i << 1) + 1] = 0;
		}
		fft2d(workRho, gridX, gridY, false);
		const spec = kernelSpectra(gridX, gridY, worldW, worldH);
		const ax = new Float64Array(n);
		const ay = new Float64Array(n);
		const phi = new Float64Array(n);
		multiplyInverse(workRho, spec.ax, ax, gridX, gridY);
		multiplyInverse(workRho, spec.ay, ay, gridX, gridY);
		multiplyInverse(workRho, spec.phi, phi, gridX, gridY);
		GravityFFT.solves += 1;
		return makeSnapshot(gridX, gridY, worldW, worldH, ax, ay, phi);
	}

	const GravityFFT = {
		MU: MU,
		SOFT: SOFT,
		SOFT2: SOFT2,
		PERIODIC_STRENGTH: PERIODIC_STRENGTH,
		GRID_X: GRID_X,
		GRID_Y: GRID_Y,
		CELL_MAX_PX: CELL_MAX_PX,
		isPow2: isPow2,
		gridFor: gridFor,
		wrap: wrap,
		minImage: minImage,
		buildKernels: buildKernels,
		unitPhiMean: unitPhiMean,
		fft2d: fft2d,
		deposit: deposit,
		solve: solve,
		solves: 0
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityFFT;
	else root.GravityFFT = GravityFFT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
