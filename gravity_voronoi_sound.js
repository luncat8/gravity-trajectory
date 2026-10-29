/* Distance preset adapted from luncat8/experiment-sound-voronoi (MIT). */
(function (root) {
	'use strict';

	const MAX_ACTIVE = 20;
	const SLOTS = 24;
	const FREQ_SCALE = 280 * Math.pow(20 / 280, 0.54);
	const VOLUME_SCALE = 320 * Math.pow(22 / 320, 0.53);
	const ENV_SCALE = 300 * Math.pow(28 / 300, 0.06);

	function distanceFrequency(d) {
		return 10 * Math.pow(1000, Math.exp(-Math.max(0, d) / FREQ_SCALE));
	}
	function distanceVolume(d) {
		const u = Math.max(0, d) / VOLUME_SCALE;
		return 1 / (1 + u * u);
	}
	function envelopeDepth(d) {
		const t = Math.max(0, Math.min(1, (d - 20) / 8));
		return t * t * (3 - 2 * t);
	}
	function envelopeRate(d) {
		return 0.1 * Math.pow(300, Math.exp(-Math.max(0, d - 20) / ENV_SCALE));
	}

	/* Intersect the sites' perpendicular bisector with all Voronoi half-planes.
	 * The moving field is unbounded; a nonempty edge means the cells are adjacent. */
	function adjacent(sim, a, b) {
		const ax = sim.planetX[a], ay = sim.planetY[a];
		const bx = sim.planetX[b], by = sim.planetY[b];
		const nx = bx - ax, ny = by - ay;
		if (nx * nx + ny * ny < 1e-12) return false;
		const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
		const tx = -ny, ty = nx;
		let low = -Infinity, high = Infinity;
		for (let i = 0; i < sim.planetCount; i++) {
			if (i === a || i === b || (sim.planetMask && !sim.planetMask[i])) continue;
			const dx = sim.planetX[i] - ax, dy = sim.planetY[i] - ay;
			const coefficient = tx * dx + ty * dy;
			const limit = (dx * dx + dy * dy) * 0.5 - ((mx - ax) * dx + (my - ay) * dy);
			if (Math.abs(coefficient) < 1e-9) {
				if (limit < -1e-9) return false;
				continue;
			}
			const bound = limit / coefficient;
			if (coefficient > 0) high = Math.min(high, bound);
			else low = Math.max(low, bound);
			if (low >= high - 1e-9) return false;
		}
		return true;
	}

	function create(ctx, output) {
		const voices = [];
		const cells = new Int32Array(SLOTS).fill(-1);
		const levels = new Float64Array(SLOTS);
		const used = new Uint8Array(SLOTS);
		const selected = new Int32Array(MAX_ACTIVE);
		const distances = new Float64Array(MAX_ACTIVE);
		for (let i = 0; i < SLOTS; i++) {
			const osc = ctx.createOscillator();
			osc.type = 'triangle';
			const filter = ctx.createBiquadFilter();
			filter.type = 'lowpass'; filter.Q.value = 0.7;
			const env = ctx.createGain(); env.gain.value = 1;
			const level = ctx.createGain(); level.gain.value = 0;
			const pan = ctx.createStereoPanner();
			const lfo = ctx.createOscillator(); lfo.type = 'sine';
			const mod = ctx.createGain(); mod.gain.value = 0;
			osc.connect(filter); filter.connect(env); env.connect(level); level.connect(pan); pan.connect(output);
			lfo.connect(mod); mod.connect(env.gain);
			osc.start(); lfo.start();
			voices.push({ osc, filter, env, level, pan, lfo, mod });
		}

		function silence() {
			for (let i = 0; i < SLOTS; i++) voices[i].level.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
			cells.fill(-1);
			levels.fill(0);
		}

		function drive(param, value, now, fresh, time) {
			if (fresh) { param.cancelScheduledValues(now); param.setValueAtTime(value, now); }
			else param.setTargetAtTime(value, now, time);
		}

		function update(sim) {
			const x = sim.cargo.x, y = sim.cargo.y;
			let nearest = -1, nearestDistance = Infinity;
			for (let i = 0; i < sim.planetCount; i++) {
				if (sim.planetMask && !sim.planetMask[i]) continue;
				const dx = sim.planetX[i] - x, dy = sim.planetY[i] - y;
				const d = dx * dx + dy * dy;
				if (d < nearestDistance) { nearest = i; nearestDistance = d; }
			}
			if (nearest < 0) { silence(); return; }
			let count = 1;
			selected[0] = nearest; distances[0] = nearestDistance;
			for (let i = 0; i < sim.planetCount; i++) {
				if (i === nearest || (sim.planetMask && !sim.planetMask[i]) || !adjacent(sim, nearest, i)) continue;
				const dx = sim.planetX[i] - x, dy = sim.planetY[i] - y;
				const d = dx * dx + dy * dy;
				let pos = Math.min(count, MAX_ACTIVE - 1);
				if (count === MAX_ACTIVE && d >= distances[pos]) continue;
				while (pos > 1 && d < distances[pos - 1]) {
					selected[pos] = selected[pos - 1]; distances[pos] = distances[pos - 1]; pos--;
				}
				selected[pos] = i; distances[pos] = d;
				if (count < MAX_ACTIVE) count++;
			}
			used.fill(0);
			/* Reserve existing identities before assigning newcomers. */
			for (let k = 0; k < count; k++) {
				for (let i = 0; i < SLOTS; i++) if (cells[i] === selected[k]) used[i] = 1;
			}
			const now = ctx.currentTime;
			for (let k = 0; k < count; k++) {
				const cell = selected[k];
				let slot = cells.indexOf(cell);
				const fresh = slot < 0;
				if (fresh) {
					let quiet = Infinity;
					for (let i = 0; i < SLOTS; i++) {
						if (!used[i] && levels[i] < quiet) { quiet = levels[i]; slot = i; }
					}
					cells[slot] = cell; used[slot] = 1;
				}
				const voice = voices[slot];
				const d = Math.sqrt(distances[k]);
				const freq = distanceFrequency(d), depth = envelopeDepth(d);
				const dx = sim.planetX[cell] - x, dy = sim.planetY[cell] - y;
				let hx = sim.cargo.vx, hy = sim.cargo.vy;
				if (!Number.isFinite(hx) || !Number.isFinite(hy) || hx * hx + hy * hy < 1e-18) {
					hx = Math.cos(Number.isFinite(sim.angle) ? sim.angle : 0);
					hy = Math.sin(Number.isFinite(sim.angle) ? sim.angle : 0);
				}
				const h = Math.sqrt(hx * hx + hy * hy);
				const pan = d > 1e-3 ? 0.95 * (hx * dy - hy * dx) / (h * d) * Math.min(1, d / 20) : 0;
				const amp = 0.46 * distanceVolume(d);
				drive(voice.osc.frequency, freq, now, fresh, 0.035);
				drive(voice.filter.frequency, Math.max(90, Math.min(18000, freq * 4.5)), now, fresh, 0.06);
				drive(voice.pan.pan, pan, now, fresh, 0.045);
				drive(voice.lfo.frequency, envelopeRate(d), now, fresh, 0.055);
				drive(voice.env.gain, 1 - depth * 0.5, now, fresh, 0.045);
				drive(voice.mod.gain, depth * 0.5, now, fresh, 0.045);
				voice.level.gain.setTargetAtTime(amp, now, 0.04);
				levels[slot] = levels[slot] * 0.65 + amp * 0.35;
			}
			for (let i = 0; i < SLOTS; i++) {
				if (used[i]) continue;
				voices[i].level.gain.setTargetAtTime(0, now, 0.04);
				levels[i] *= 0.72;
				if (levels[i] < 1e-4) { cells[i] = -1; levels[i] = 0; }
			}
		}
		return { update, silence };
	}

	const api = { create, adjacent, distanceFrequency, distanceVolume, envelopeDepth, envelopeRate };
	root.GravityVoronoiSound = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
