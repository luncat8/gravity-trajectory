/* 0.8.0 step 2 — GravitySim periodic torus integration (headless).
 * Hooks the shipped GravityFFT solver into GravitySim: topology + lazy static
 * snapshots, invalidation, direct moving-source law, wrap kinematics, min-image
 * impact/visits/drift, solve counters, and live/full/sliced prediction
 * agreement across a seam. Classic (periodic off) physics is untouched — see
 * classic_physics_test.js for the byte fingerprints.
 *
 * Independent of the solver oracle in fft_test.js: here we exercise the sim
 * wrapper, not the FFT itself. Run: node experiments/periodic_sim_test.js */
'use strict';

const assert = require('assert');
const Sim = require('../gravity_sim.js');
const GravityFFT = require('../gravity_fft.js');

const FULL = 1e9; // effectively unbounded route budget

function makePeriodicSim(W, H, planets) {
	const sim = new Sim(W, H);
	const count = planets.length;
	const px = new Float64Array(count);
	const py = new Float64Array(count);
	const pr = new Float64Array(count);
	const rx = new Float64Array(count);
	const ry = new Float64Array(count);
	const cos = new Float64Array(count);
	const sin = new Float64Array(count);
	const strength = new Float64Array(Sim.MAX_BODIES);
	for (let i = 0; i < count; i++) {
		const p = planets[i];
		px[i] = p.x; py[i] = p.y; pr[i] = p.r;
		rx[i] = p.rx === undefined ? 40 : p.rx;
		ry[i] = p.ry === undefined ? 40 : p.ry;
		cos[i] = 1; sin[i] = 0;
		strength[i] = p.s === undefined ? 1 : p.s;
	}
	sim.setPlanets(count, px, py, pr, rx, ry, cos, sin);
	const fill = (t, x, y, c) => { for (let i = 0; i < c; i++) { x[i] = px[i]; y[i] = py[i]; } };
	sim.setField(count, pr, strength, fill, true);
	sim.setPeriodic(true);
	sim.setScales(1, 1);
	return sim;
}

function close(a, b, eps) { return Math.abs(a - b) <= eps; }

let passed = 0;
function check(name, fn) {
	fn();
	passed += 1;
	console.log('  ok   ' + name);
}

/* ── wrap kinematics: a body crossing x=W appears at x≈0, path length does not jump by W ── */
check('wrap kinematics across a seam', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [{ x: 800, y: 500, r: 20, s: 1 }]);
	sim.horizon = 20;
	sim.stepLimit = Math.ceil(20 / Sim.DT) + 2;
	sim.limitReason = Sim.END_TIME;
	sim.launch(0, 0, 150);
	/* place the cargo one px from the right seam, moving right */
	sim.cargo.x = W - 1;
	sim.cargo.y = H / 2;
	sim.cargo.vx = 200;
	sim.cargo.vy = 0;
	sim.flightLength = 0;
	sim.stepOne();
	const vxAfter = sim.cargo.vx, vyAfter = sim.cargo.vy;
	const expectedLen = Math.hypot(vxAfter, vyAfter) * Sim.DT;
	assert.ok(close(sim.flightLength, expectedLen, 1e-9),
		'seam step length is the pre-wrap step, not ~W (got ' + sim.flightLength + ')');
	assert.ok(sim.cargo.x < 10, 'cargo wrapped to x≈0 (got ' + sim.cargo.x + ')');
	assert.ok(close(sim.cargo.vy, 0, 1e-9), 'vy unchanged by wrap');
	assert.strictEqual(sim.outside(sim.cargo.x, sim.cargo.y), false, 'no END_EXIT on a torus');
});

/* ── live / full / sliced prediction agree across a seam ──
 * The prediction path is stored in Float32 (predX/predY) for memory, so we
 * compare the true float64 integration state via spawn()/advance() wrappers
 * rather than the Float32-stored arrays. */
const origAdvanceRef = Sim.prototype.advance;
const origSpawnRef = Sim.prototype.spawn;
let captureSink = null; // {x:[], y:[]} when capturing, else null
Sim.prototype.advance = function (state, dt) {
	const r = origAdvanceRef.call(this, state, dt);
	if (captureSink) { captureSink.x.push(state.x); captureSink.y.push(state.y); }
	return r;
};
Sim.prototype.spawn = function (state, origin, angle, speed, t0) {
	const r = origSpawnRef.call(this, state, origin, angle, speed, t0);
	if (captureSink) { captureSink.x.push(state.x); captureSink.y.push(state.y); }
	return r;
};

function capturePredict(sim, mode) {
	captureSink = { x: [], y: [] };
	let reason;
	if (mode === 'full') {
		sim.clear();
		sim.predict(0, 0, 300, FULL);
		reason = sim.predReason;
	} else if (mode === 'sliced') {
		sim.clear();
		sim.routeBegin(0, 0, 300, sim.horizon);
		let guard = 0;
		while (!sim.routeStep(8) && guard++ < 5000) { /* drain */ }
		reason = sim.predReason;
	} else { // live
		sim.clear();
		sim.stepLimit = Math.ceil(sim.horizon / Sim.DT) + 2;
		sim.limitReason = Sim.END_TIME;
		sim.launch(0, 0, 300);
		let g = 0;
		while (sim.status === Sim.STATUS_FLYING && g++ < 50000) sim.stepOne();
		reason = sim.endReason;
	}
	const out = { x: captureSink.x, y: captureSink.y, reason: reason };
	captureSink = null;
	return out;
}

check('live vs full vs sliced prediction agree across a seam', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [
		{ x: 800, y: 500, r: 20, s: 1 },
		{ x: 400, y: 800, r: 25, s: -1 }
	]);
	sim.horizon = 20;

	const full = capturePredict(sim, 'full');
	const sliced = capturePredict(sim, 'sliced');
	const live = capturePredict(sim, 'live');

	/* all three agree point-for-point in float64 */
	assert.strictEqual(full.x.length, sliced.x.length, 'full vs sliced length');
	assert.strictEqual(full.x.length, live.x.length, 'full vs live length');
	assert.strictEqual(sliced.reason, full.reason, 'sliced vs full end reason');
	assert.strictEqual(live.reason, full.reason, 'live vs full end reason');
	let maxDiff = 0;
	for (let i = 0; i < full.x.length; i++) {
		maxDiff = Math.max(maxDiff,
			Math.abs(full.x[i] - sliced.x[i]), Math.abs(full.y[i] - sliced.y[i]),
			Math.abs(full.x[i] - live.x[i]), Math.abs(full.y[i] - live.y[i]));
	}
	assert.ok(maxDiff < 1e-9, 'prediction paths diverge by ' + maxDiff);

	/* the path actually wraps: a step jumps from high x to low x */
	let seam = false;
	for (let i = 1; i < full.x.length; i++) {
		if (full.x[i - 1] - full.x[i] > W / 2) { seam = true; break; }
	}
	assert.ok(seam, 'trajectory crosses the seam');
});

/* ── spawn origin wraps: shot from a core at x=10 toward the left starts at x≈W−gap ── */
check('spawn origin wraps to the far edge', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [{ x: 10, y: 500, r: 20 }]);
	const st = { x: 0, y: 0, vx: 0, vy: 0 };
	sim.spawn(st, 0, Math.PI, 300, 0); // aim left (ca = -1)
	assert.strictEqual(st.vx, -300, 'launch velocity unchanged by wrap');
	const gap = sim.planetR[0] + 8; // SPAWN_GAP = 8 in gravity_sim.js
	/* rawSpawn = 10 - gap (negative) → wrapped to W - gap + 10; min-image dx from core = -gap */
	const mi = GravityFFT.minImage(st.x - sim.planetX[0], W);
	assert.ok(close(mi, -gap, 1e-9), 'spawn lands one gap from the core on the far side');
});

/* ── impact / stepInsideAt see bodies across the seam ── */
check('impact and stepInsideAt span the seam', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [{ x: 10, y: 500, r: 20 }]);
	const hit = sim.impact(W - 5, 500); // near right edge, min-image close to planet at x=10
	assert.strictEqual(hit, 0, 'periodic impact reaches across the seam');
	sim.periodic = false;
	const hitClassic = sim.impact(W - 5, 500);
	assert.strictEqual(hitClassic, Sim.NO_BODY, 'classic impact does not wrap');
	sim.periodic = true;

	const inside = new Uint8Array(Sim.MAX_BODIES);
	const entered = new Int32Array(Sim.MAX_BODIES);
	const n = sim.stepInsideAt(W - 5, 500, inside, entered);
	assert.strictEqual(n, 1, 'stepInsideAt marks the seam-straddling system');
	assert.strictEqual(inside[0], 1, 'system 0 is inside across the seam');
});

/* ── drift across a seam matches the min-image oracle (small, not ~W) ── */
check('fieldDrift across the seam is the min-image distance', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [
		{ x: 800, y: 500, r: 20 },
		{ x: 400, y: 300, r: 25, s: -1 }
	]);
	sim.predict(0, 0, 150, FULL); // snapshot predBodyX/Y == bodyX/Y (static)
	assert.strictEqual(sim.fieldDrift(), 0, 'unchanged static positions drift 0');

	const base = sim.predBodyX[0];
	const moved = base + W - 3; // 3 px short of a full wrap → min-image = -3
	sim.bodyX[0] = moved;
	const expected = Math.abs(GravityFFT.minImage(moved - base, W));
	assert.ok(close(sim.fieldDrift(), expected, 1e-9), 'periodic drift is the min-image oracle');

	sim.periodic = false;
	const classicDrift = sim.fieldDrift();
	assert.ok(classicDrift > W - 50, 'non-periodic drift counts the ~W jump (' + classicDrift.toFixed(1) + ')');
	sim.periodic = true;
});

/* ── solve counters: refresh/spawn/predict/scales never solve; strength/count/field do ── */
check('solve counters: lazy solve, no solve on refresh/slider', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [
		{ x: 300, y: 400, r: 20 },
		{ x: 1200, y: 700, r: 25, s: -1 }
	]);
	const out = { ax: 0, ay: 0 };

	let before = GravityFFT.solves;
	sim.refreshField();
	assert.strictEqual(GravityFFT.solves, before, 'refreshField does not solve');

	const st = { x: 100, y: 100, vx: 10, vy: 0 };
	sim.advance(st, Sim.DT); // first touch → solve
	assert.strictEqual(GravityFFT.solves, before + 1, 'first advance solves once');

	before = GravityFFT.solves;
	for (let i = 0; i < 6; i++) { sim.fieldAt(100 + i, 100, out); sim.advance(st, Sim.DT); }
	assert.strictEqual(GravityFFT.solves, before, 'repeated sample/advance does not re-solve');

	before = GravityFFT.solves;
	sim.setScales(2, 1); // slider change applies at sample time, no re-solve
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before, 'g field slider does not re-solve');
	sim.setScales(1, 1);

	/* setStrength changed → one re-solve on next sample */
	before = GravityFFT.solves;
	assert.strictEqual(sim.setStrength(0, 0.5), true, 'strength change reported');
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before + 1, 'setStrength re-solves once');

	before = GravityFFT.solves;
	assert.strictEqual(sim.setStrength(0, 0.5), false, 'unchanged strength reports false');
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before, 'unchanged strength does not re-solve');

	/* setCount / setField / resetField invalidate → re-solve */
	before = GravityFFT.solves;
	sim.setCount(sim.bodyCount + 1);
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before + 1, 'setCount re-solves');

	before = GravityFFT.solves;
	sim.setField(sim.bodyCount, sim.bodyR, sim.strength,
		(t, x, y, c) => { for (let i = 0; i < c; i++) { x[i] = sim.planetX[i]; y[i] = sim.planetY[i]; } }, true);
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before + 1, 'setField re-solves');

	before = GravityFFT.solves;
	sim.resetField();
	sim.fieldAt(100, 100, out);
	assert.strictEqual(GravityFFT.solves, before + 1, 'resetField re-solves');
});

/* ── snapshot adoption: a probe reuses a live grid (no re-solve, no mutation) ── */
check('snapshot adoption shares a live grid without mutating it', function () {
	const W = 1600, H = 1000;
	const planets = [{ x: 300, y: 400, r: 20 }, { x: 1200, y: 700, r: 25, s: -1 }];
	const live = makePeriodicSim(W, H, planets);
	live.fieldAt(100, 100, { ax: 0, ay: 0 }); // solve once
	const liveRev = live.periodicGrid().revision;
	const solvesAfterLive = GravityFFT.solves;

	const probe = makePeriodicSim(W, H, planets);
	probe.setPeriodic(true, live); // adopt the live snapshot
	const outLive = { ax: 0, ay: 0 };
	const outProbe = { ax: 0, ay: 0 };
	live.fieldAt(777, 333, outLive);
	probe.fieldAt(777, 333, outProbe);
	assert.strictEqual(GravityFFT.solves, solvesAfterLive, 'adopting probe does not solve');
	assert.strictEqual(probe.periodicGrid(), live.periodicGrid(), 'probe shares the live snapshot object');
	assert.ok(close(outLive.ax, outProbe.ax, 1e-12) && close(outLive.ay, outProbe.ay, 1e-12),
		'adopted sample equals the live sample');

	/* a probe strength edit stops adoption and re-solves its own field, while
	 * the live snapshot is left untouched (immutable) */
	const liveRevBefore = live.periodicGrid().revision;
	probe.setStrength(0, -1);
	probe.fieldAt(777, 333, outProbe);
	assert.notStrictEqual(probe.periodicGrid(), live.periodicGrid(), 'probe no longer borrows after its own edit');
	assert.strictEqual(live.periodicGrid().revision, liveRevBefore, 'live snapshot revision unchanged by probe edit');
	assert.strictEqual(liveRev, liveRevBefore, 'live grid never mutated');
});

check('lazy borrowed grids follow source invalidation', function () {
	const planets = [{ x: 300, y: 400, r: 20 }];
	const live = makePeriodicSim(1600, 1000, planets);
	const probe = makePeriodicSim(1600, 1000, planets);
	probe.setPeriodic(true, live);
	const before = GravityFFT.solves;
	probe.fieldAt(100, 100, { ax: 0, ay: 0 });
	assert.strictEqual(GravityFFT.solves, before + 1);
	const old = live.periodicGrid();
	assert.strictEqual(probe.periodicGrid(), old);
	live.setStrength(0, 0.25);
	probe.fieldAt(100, 100, { ax: 0, ay: 0 });
	assert.strictEqual(GravityFFT.solves, before + 2);
	assert.notStrictEqual(live.periodicGrid(), old);
	assert.strictEqual(probe.periodicGrid(), live.periodicGrid());
	live.setPeriodic(false);
	assert.ok(live.padX > 0 && live.padY > 0);
});

/* ── moving source stays on the direct minimum-image sum (never solves a grid) ── */
check('moving periodic source uses the direct sum, no grid solve', function () {
	const W = 1600, H = 1000;
	const sim = makePeriodicSim(W, H, [{ x: 800, y: 500, r: 20 }]);
	sim.fieldStatic = false; // moving port field
	sim.refreshField();
	assert.strictEqual(sim.periodicGrid(), null, 'moving source exposes no static snapshot');
	const before = GravityFFT.solves;
	const out = { ax: 0, ay: 0 };
	sim.fieldAt(810, 500, out); // must not solve
	assert.strictEqual(GravityFFT.solves, before, 'moving field never solves');
	assert.ok(Number.isFinite(out.ax) && Number.isFinite(out.ay), 'moving field returns finite accel');

	/* moving periodic direct sum matches PERIODIC_STRENGTH (0.5) and zeroes
	 * tied force components at exact half-world separation */
	const classic = makePeriodicSim(W, H, [{ x: 800, y: 500, r: 20 }]);
	classic.setPeriodic(false);
	classic.fieldStatic = false;
	classic.refreshField();
	const outClassic = { ax: 0, ay: 0 };
	classic.fieldAt(810, 500, outClassic);
	assert.ok(close(out.ax, outClassic.ax * Sim.PERIODIC_STRENGTH, 1e-12),
		'moving periodic direct sum applies PERIODIC_STRENGTH');

	sim.fieldAt(0, 500, out); // dx = 800 - 0 -> minImage = -800 (exact half-world tie in X)
	assert.strictEqual(out.ax, 0, 'exact half-world X tie zeroes ax');
	sim.fieldAt(800, 0, out); // dy = 500 - 0 -> minImage = -500 (exact half-world tie in Y)
	assert.strictEqual(out.ay, 0, 'exact half-world Y tie zeroes ay');
	sim.fieldAt(0, 100, out); // tied in X, non-tied in Y: r2 keeps (W/2)^2 + dy^2 + SOFT2
	const expectedAy = Sim.MU * Sim.PERIODIC_STRENGTH * 400 /
		Math.pow(800 * 800 + 400 * 400 + Sim.SOFT2, 1.5);
	assert.strictEqual(out.ax, 0, 'diagonal half-world X tie zeroes ax');
	assert.ok(close(out.ay, expectedAy, 1e-12), 'half-world tie keeps (L/2)^2 in r2');

	/* invalidateField refreshes shared-array borrowers without severing periodicSource_ */
	const sharedStrength = new Float64Array(Sim.MAX_BODIES);
	sharedStrength[0] = 1;
	const rootSim = makePeriodicSim(W, H, [{ x: 400, y: 400, r: 20 }]);
	rootSim.setField(1, rootSim.bodyR, sharedStrength, rootSim.fillField, true);
	const childSim = makePeriodicSim(W, H, [{ x: 400, y: 400, r: 20 }]);
	childSim.setPeriodic(true, rootSim);
	childSim.setField(1, rootSim.bodyR, sharedStrength, rootSim.fillField, true);
	childSim.fieldAt(420, 400, out);
	const snap1 = rootSim.periodicGrid();
	assert.strictEqual(childSim.periodicGrid(), snap1);
	sharedStrength[0] = 2;
	rootSim.invalidateField();
	const solvesBefore = GravityFFT.solves;
	childSim.fieldAt(420, 400, out);
	assert.strictEqual(GravityFFT.solves, solvesBefore + 1, 'shared-array invalidation solves once');
	assert.notStrictEqual(rootSim.periodicGrid(), snap1);
	assert.strictEqual(childSim.periodicGrid(), rootSim.periodicGrid(),
		'child automatically adopts refreshed root snapshot');
});

console.log('PERIODIC SIM OK · ' + passed + ' checks · topology, snapshots, wrap, min-image, counters, adoption');
