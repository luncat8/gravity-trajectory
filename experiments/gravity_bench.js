/*
 * Gravity cargo benchmark.
 *
 * 1. measures prediction cost over every planet / angle / speed in the grid
 * 2. checks that the live flight follows the predicted polyline exactly
 * 3. repeats parity with moving (port) bodies and measures how far a moving
 *    field prediction lands from a frozen-field one for the same shot
 * 4. repeats with a negative (repelling) field to catch NaN and runaway paths
 * 5. reports the background fast-forward cost
 *
 * Run: node experiments/gravity_bench.js
 */
'use strict';

const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');

const REASONS = ['open', 'impact', 'exit', 'horizon', 'budget'];
const SPEEDS = [40, 80, 120, 180, 240, 320];
const ANGLES = 36;
const MOVING_RATE = 6;

function makeWorld() {
	const sim = new Sim(7);
	sim.step(420);
	const gravity = new GravitySim(Sim.WORLD_W, Sim.WORLD_H);
	gravity.setPlanets(
		Sim.PLANETS,
		sim.planetX, sim.planetY, sim.planetR,
		sim.orbitRX, sim.orbitRY,
		sim.orbitTiltCos, sim.orbitTiltSin
	);
	const world = {
		sim, gravity,
		planetStrength: new Float64Array(Sim.PLANETS).fill(1),
		portStrength: new Float64Array(Sim.PORTS).fill(1),
		portRadius: new Float64Array(Sim.PORTS).fill(6)
	};
	world.fillPlanets = (t, outX, outY, count) => {
		for (let i = 0; i < count; i++) {
			outX[i] = sim.planetX[i];
			outY[i] = sim.planetY[i];
		}
	};
	/* mirrors the single-trig-pair fill in gravity_gui.js */
	world.fillPorts = (t, outX, outY, count) => {
		for (let p = 0; p < count; p++) {
			const planet = sim.portPlanet[p];
			const angle = sim.orbitPhase[planet] + sim.orbitOmega[planet] * t;
			const rx = sim.orbitRX[planet] * Math.cos(angle);
			const ry = sim.orbitRY[planet] * Math.sin(angle);
			outX[p] = sim.planetX[planet] +
				rx * sim.orbitTiltCos[planet] - ry * sim.orbitTiltSin[planet];
			outY[p] = sim.planetY[planet] +
				rx * sim.orbitTiltSin[planet] + ry * sim.orbitTiltCos[planet];
		}
	};
	usePlanets(world);
	return world;
}

function usePlanets(world) {
	world.gravity.fieldT = world.sim.t;
	world.gravity.fieldRate = 0;
	world.gravity.setField(Sim.PLANETS, world.sim.planetR,
		world.planetStrength, world.fillPlanets, true);
}

function usePorts(world, rate) {
	world.gravity.fieldT = world.sim.t;
	world.gravity.fieldRate = rate;
	world.gravity.setField(world.sim.portCount, world.portRadius,
		world.portStrength, world.fillPorts, false);
}

function predictionSweep(world) {
	const g = world.gravity;
	let worst = 0;
	let total = 0;
	let count = 0;
	const histogram = [0, 0, 0, 0, 0];
	const durations = [];
	for (let planet = 0; planet < Sim.PLANETS; planet++) {
		for (let a = 0; a < ANGLES; a++) {
			const angle = a / ANGLES * Math.PI * 2;
			for (const speed of SPEEDS) {
				g.predict(planet, angle, speed);
				count += 1;
				total += g.predMs;
				if (g.predMs > worst) worst = g.predMs;
				histogram[g.predReason] += 1;
				durations.push(g.predTime);
				const last = g.predCount - 1;
				const chord = Math.sqrt(
					(g.predX[last] - g.predX[0]) ** 2 + (g.predY[last] - g.predY[0]) ** 2);
				if (!Number.isFinite(g.predLength) || g.predLength < chord - 1e-3) {
					throw new Error('trajectory length below its chord');
				}
			}
		}
	}
	durations.sort((a, b) => a - b);
	const p95 = durations[Math.floor(durations.length * 0.95)];
	return {
		count, avg: total / count, worst, p95,
		histogram,
		avgTime: durations.reduce((sum, v) => sum + v, 0) / durations.length
	};
}

function parityRun(g, origins, angleCount, speeds, label) {
	let cases = 0;
	let maxError = 0;
	let worstCase = '';
	for (const origin of origins) {
		for (let a = 0; a < angleCount; a++) {
			const angle = a / angleCount * Math.PI * 2;
			for (const speed of speeds) {
				g.clear();
				g.predict(origin, angle, speed);
				const points = g.predCount;
				const reason = g.predReason;
				const hitBody = g.predBody;
				const expectedVisits = g.predVisits;
				g.launch(origin, angle, speed);
				let error = 0;
				const mid = points >> 1;
				for (let i = 1; i < points; i++) {
					g.step(GravitySim.DT);
					const ref = i <= mid ? i : i - mid;
					const dx = g.cargo.x - g.predX[ref];
					const dy = g.cargo.y - g.predY[ref];
					const dev = Math.sqrt(dx * dx + dy * dy);
					if (dev > error) error = dev;
					if (i === mid && g.status === GravitySim.STATUS_FLYING) {
						g.predictFlight(GravitySim.BUDGET_MS);
					}
				}
				if (error > maxError) {
					maxError = error;
					worstCase = label + origin + ' a' + a + ' v' + speed;
				}
				if ((reason === GravitySim.END_IMPACT || reason === GravitySim.END_EXIT) &&
					g.status !== GravitySim.STATUS_ENDED) {
					throw new Error('live flight did not end with the prediction');
				}
				if (reason === GravitySim.END_IMPACT && g.endBody !== hitBody) {
					throw new Error('impact body mismatch in ' + worstCase);
				}
				if ((reason === GravitySim.END_IMPACT || reason === GravitySim.END_EXIT) &&
					g.visitedCount !== expectedVisits) {
					throw new Error('system visit parity mismatch: ' +
						g.visitedCount + ' vs ' + expectedVisits);
				}
				cases += 1;
			}
		}
	}
	g.clear();
	return { cases, maxError, worstCase };
}

function parityCheck(world) {
	const origins = [];
	for (let planet = 0; planet < Sim.PLANETS; planet += 3) origins.push(planet);
	return parityRun(world.gravity, origins, 8, [60, 150, 260], 'P');
}

function movingTests(world) {
	const g = world.gravity;
	usePorts(world, MOVING_RATE);
	const origins = [];
	for (let port = 0; port < world.sim.portCount; port += 3) origins.push(port);
	const parity = parityRun(g, origins, 6, [90, 220], 'port ');

	/* same shot, moving vs frozen field: end points must actually separate */
	let divergence = 0;
	let worst = 0;
	let total = 0;
	let runs = 0;
	for (let port = 0; port < world.sim.portCount; port += 2) {
		for (let a = 0; a < 12; a++) {
			const angle = a / 12 * Math.PI * 2;
			for (const speed of [120, 240]) {
				g.fieldRate = MOVING_RATE;
				g.predict(port, angle, speed);
				total += g.predMs;
				if (g.predMs > worst) worst = g.predMs;
				runs += 1;
				const endX = g.predX[g.predCount - 1];
				const endY = g.predY[g.predCount - 1];
				g.fieldRate = 0;
				g.predict(port, angle, speed);
				const dx = endX - g.predX[g.predCount - 1];
				const dy = endY - g.predY[g.predCount - 1];
				const gap = Math.sqrt(dx * dx + dy * dy);
				if (gap > divergence) divergence = gap;
			}
		}
	}
	g.fieldRate = MOVING_RATE;
	return { parity, divergence, worst, avg: total / runs, runs };
}

/* experimental scales: a free fall step is exactly linear in the gravity
 * multiplier, and a halved field still predicts exactly what it flies */
function scaleDrop() {
	const sim = new GravitySim(1000, 1000);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	const radius = new Float64Array(1).fill(10);
	const fill = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = 500;
			outY[i] = 500;
		}
	};
	sim.setField(1, radius, strength, fill, true);
	sim.fillStep(0);
	function fall(scale) {
		sim.setScales(scale, 1);
		const state = { x: 100, y: 500, vx: 0, vy: 0 };
		/* one fixed step: a single acceleration, so the pull is exactly linear */
		sim.advance(state, GravitySim.DT);
		return state.vx;
	}
	const one = fall(1);
	const half = fall(0.5);
	const double = fall(2);
	const zero = fall(0);
	sim.setScales(1, 1);
	if (!(one > 0)) throw new Error('gravity scale: no pull');
	if (zero !== 0) throw new Error('gravity scale 0 pulled the cargo');
	if (Math.abs(half / one - 0.5) > 1e-9 || Math.abs(double / one - 2) > 1e-9) {
		throw new Error('gravity scale is not linear: ' + one + ' / ' + half + ' / ' + double);
	}
	return { one, half, double, zero };
}

function scaleParity(world) {
	const g = world.gravity;
	usePlanets(world);
	g.setScales(0.5, 1);
	const parity = parityRun(g, [0, 7, 14, 21], 6, [90, 180], 'scaled ');
	g.setScales(1, 1);
	return parity;
}

function repelSweep(world) {
	const g = world.gravity;
	g.resetField();
	g.strength.fill(-1.2);
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let count = 0;
	for (let planet = 0; planet < Sim.PLANETS; planet += 2) {
		for (let a = 0; a < 12; a++) {
			g.predict(planet, a / 12 * Math.PI * 2, 180);
			for (let i = 0; i < g.predCount; i++) {
				if (!Number.isFinite(g.predX[i]) || !Number.isFinite(g.predY[i])) {
					throw new Error('non-finite repel path');
				}
				if (g.predX[i] < minX) minX = g.predX[i];
				if (g.predX[i] > maxX) maxX = g.predX[i];
				if (g.predY[i] < minY) minY = g.predY[i];
				if (g.predY[i] > maxY) maxY = g.predY[i];
			}
			count += 1;
		}
	}
	g.resetField();
	return { count, minX, maxX, minY, maxY };
}

const started = process.hrtime.bigint();
const world = makeWorld();
const fastForwardMs = Number(process.hrtime.bigint() - started) / 1e6;

/* warm up before timing */
for (let i = 0; i < 30; i++) world.gravity.predict(0, i * 0.3, 200);

const sweep = predictionSweep(world);
const parity = parityCheck(world);
const moving = movingTests(world);
usePlanets(world);
const scaled = scaleParity(world);
const repel = repelSweep(world);
const drop = scaleDrop();

console.log('world: 26 planets, fast-forward to t+07:00 in ' + fastForwardMs.toFixed(2) + ' ms');
console.log('trade at t+07:00: ports ' + world.sim.portCount +
	', ships ' + world.sim.shipCount +
	', delivered ' + Math.round(world.sim.delivered) +
	', colonies ' + world.sim.coloniesBuilt);
console.log('');
console.log('prediction sweep: ' + sweep.count + ' runs (' + ANGLES + ' angles x ' +
	SPEEDS.length + ' speeds x 26 planets)');
console.log('  avg ' + sweep.avg.toFixed(3) + ' ms, p95 ' + sweep.p95.toFixed(2) +
	' s flight, worst ' + sweep.worst.toFixed(3) + ' ms');
console.log('  avg flight ' + sweep.avgTime.toFixed(2) + ' s');
console.log('  ends: ' + REASONS.map((name, i) => name + ' ' + sweep.histogram[i]).join(', '));
console.log('');
console.log('parity: ' + parity.cases + ' shots, worst live/predicted deviation ' +
	parity.maxError.toFixed(6) + ' px' + (parity.worstCase ? ' (' + parity.worstCase + ')' : ''));
console.log('moving ports at x' + MOVING_RATE + ': parity ' + moving.parity.cases +
	' shots, worst deviation ' + moving.parity.maxError.toFixed(6) + ' px' +
	(moving.parity.worstCase ? ' (' + moving.parity.worstCase + ')' : ''));
console.log('  moving vs frozen end point: max ' + moving.divergence.toFixed(1) + ' px apart');
console.log('  moving prediction: ' + moving.runs + ' runs, avg ' + moving.avg.toFixed(3) +
	' ms, worst ' + moving.worst.toFixed(3) + ' ms');
console.log('experimental gravity x0.5: parity ' + scaled.cases +
	' shots, worst deviation ' + scaled.maxError.toFixed(6) + ' px' +
	(scaled.worstCase ? ' (' + scaled.worstCase + ')' : ''));
console.log('experimental gravity: one-step pull x0 ' + drop.zero.toFixed(3) +
	' · x0.5 ' + drop.half.toFixed(3) + ' · x1 ' + drop.one.toFixed(3) +
	' · x2 ' + drop.double.toFixed(3));
console.log('repel field: ' + repel.count + ' paths, finite bounds x ' +
	repel.minX.toFixed(1) + '…' + repel.maxX.toFixed(1) + ', y ' +
	repel.minY.toFixed(1) + '…' + repel.maxY.toFixed(1));
console.log('budget: ' + GravitySim.BUDGET_MS + ' ms cap, worst ' +
	sweep.worst.toFixed(3) + ' ms (' +
	(sweep.worst <= GravitySim.BUDGET_MS ? 'within budget' : 'OVER BUDGET') + ')');

if (sweep.worst > GravitySim.BUDGET_MS + 1) throw new Error('prediction over budget');
if (moving.worst > GravitySim.BUDGET_MS + 2) throw new Error('moving prediction over budget');
if (parity.maxError > 0.01) throw new Error('live flight diverged from prediction');
if (moving.parity.maxError > 0.01) throw new Error('moving flight diverged from prediction');
if (scaled.maxError > 0.01) throw new Error('scaled flight diverged from prediction');
if (moving.divergence < 5) throw new Error('moving field barely changes the trajectory');
if (!Number.isFinite(repel.minX) || !Number.isFinite(repel.maxY)) {
	throw new Error('repel sweep produced non-finite bounds');
}
console.log('BENCH OK');
