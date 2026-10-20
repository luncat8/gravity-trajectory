/*
 * Gravity cargo benchmark.
 *
 * 1. measures prediction cost over every planet / angle / speed in the grid
 * 2. checks that the live flight follows the predicted polyline exactly
 * 3. repeats with a negative (repelling) field to catch NaN and runaway paths
 * 4. reports the background fast-forward cost
 *
 * Run: node experiments/gravity_bench.js
 */
'use strict';

const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');

const REASONS = ['open', 'impact', 'exit', 'horizon', 'budget'];
const SPEEDS = [40, 80, 120, 180, 240, 320];
const ANGLES = 36;

function makeWorld() {
	const sim = new Sim(7);
	sim.step(420);
	const gravity = new GravitySim(
		sim.planetX, sim.planetY, sim.planetR,
		Sim.PLANETS, Sim.WORLD_W, Sim.WORLD_H
	);
	return { sim, gravity };
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

function parityCheck(world) {
	const g = world.gravity;
	let cases = 0;
	let maxError = 0;
	let worstCase = '';
	for (let planet = 0; planet < Sim.PLANETS; planet += 3) {
		for (let a = 0; a < 8; a++) {
			const angle = a / 8 * Math.PI * 2;
			for (const speed of [60, 150, 260]) {
				g.predict(planet, angle, speed);
				const points = g.predCount;
				const reason = g.predReason;
				g.launch(planet, angle, speed);
				let error = 0;
				for (let i = 1; i < points; i++) {
					g.step(GravitySim.DT);
					const dx = g.cargo.x - g.predX[i];
					const dy = g.cargo.y - g.predY[i];
					const dev = Math.sqrt(dx * dx + dy * dy);
					if (dev > error) error = dev;
				}
				if (error > maxError) {
					maxError = error;
					worstCase = 'P' + planet + ' a' + a + ' v' + speed;
				}
				if ((reason === GravitySim.END_IMPACT || reason === GravitySim.END_EXIT) &&
					g.status !== GravitySim.STATUS_ENDED) {
					throw new Error('live flight did not end with the prediction');
				}
				if (reason === GravitySim.END_IMPACT &&
					g.endPlanet !== g.predPlanet) {
					throw new Error('impact planet mismatch in ' + worstCase);
				}
				cases += 1;
			}
		}
	}
	return { cases, maxError, worstCase };
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
const repel = repelSweep(world);

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
console.log('repel field: ' + repel.count + ' paths, finite bounds x ' +
	repel.minX.toFixed(1) + '…' + repel.maxX.toFixed(1) + ', y ' +
	repel.minY.toFixed(1) + '…' + repel.maxY.toFixed(1));
console.log('budget: ' + GravitySim.BUDGET_MS + ' ms cap, worst ' +
	sweep.worst.toFixed(3) + ' ms (' +
	(sweep.worst <= GravitySim.BUDGET_MS ? 'within budget' : 'OVER BUDGET') + ')');

if (sweep.worst > GravitySim.BUDGET_MS + 1) throw new Error('prediction over budget');
if (parity.maxError > 0.01) throw new Error('live flight diverged from prediction');
if (!Number.isFinite(repel.minX) || !Number.isFinite(repel.maxY)) {
	throw new Error('repel sweep produced non-finite bounds');
}
console.log('BENCH OK');
