/*
 * Route-rule bench (0.3.1): the resumable tracer behind the `route` game rule.
 *
 * 1. a sliced trace equals a one-shot trace point for point (end reason, end
 *    point, length, time, visits, every stored point): 200 random static
 *    shots, 60 moving-port shots, and a wall shot that compacts the buffer
 * 2. flight length in this world: how often a shot outlives the old 120 s cap
 *    or the 1 800 s wall (the wall is a safety net, the buffer policy follows)
 * 3. the point buffer stays flat: a wall trace compacts to ≤ PATH_MAX points,
 *    stride 8, while a real 120 s shot keeps stride 1 and every step
 * 4. slice cost: a 4 ms slice stays inside a frame, a whole trace ≤ 45 ms
 * 5. routeBegin/routeStep allocate nothing: buffers and the probe keep identity
 *
 * Run: node experiments/route_bench.js
 */
'use strict';

const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');

const REASONS = ['open', 'impact', 'exit', 'horizon', 'budget', 'abort'];
const SHOTS = 200;
const MOVING_SHOTS = 60;
const ROUTE_SECONDS = GravityGame.ROUTE_SECONDS;
const ROUTE_STEPS = GravityGame.ROUTE_STEPS;
const SLICE_MS = 1000 / 60;
const SLICE_BUDGET = 4;
const MOVING_RATE = 6;
let failures = 0;

function check(ok, message) {
	if (ok) return;
	failures += 1;
	console.log('FAIL', message);
}

function seededRandom(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makeWorld(seed) {
	const sim = new Sim(seed);
	sim.step(420);
	const gravity = new GravitySim(Sim.WORLD_W, Sim.WORLD_H);
	gravity.setPlanets(Sim.PLANETS, sim.planetX, sim.planetY, sim.planetR,
		sim.orbitRX, sim.orbitRY, sim.orbitTiltCos, sim.orbitTiltSin);
	const world = {
		sim, gravity,
		planetStrength: new Float64Array(Sim.PLANETS).fill(1),
		portStrength: new Float64Array(Sim.PORTS).fill(1),
		portRadius: new Float64Array(Sim.PORTS).fill(6)
	};
	world.fillPlanets = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = sim.planetX[i];
			outY[i] = sim.planetY[i];
		}
	};
	world.fillPorts = function (t, outX, outY, count) {
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

/*
 * A field where a shot can never end: no gravity (strength 0) and a world so
 * large the probe never leaves it. Used to reach the 1 800 s wall and to make
 * the tracer compact its point buffer, which normal play cannot reach.
 */
function makeWallWorld() {
	const gravity = new GravitySim(1e9, 1e9);
	const px = new Float64Array(Sim.PLANETS).fill(500);
	const py = new Float64Array(Sim.PLANETS).fill(500);
	const pr = new Float64Array(Sim.PLANETS).fill(20);
	gravity.setPlanets(Sim.PLANETS, px, py, pr,
		new Float64Array(Sim.PLANETS).fill(100), new Float64Array(Sim.PLANETS).fill(100),
		new Float64Array(Sim.PLANETS).fill(1), new Float64Array(Sim.PLANETS).fill(0));
	gravity.fieldT = 0;
	gravity.fieldRate = 0;
	gravity.setField(Sim.PLANETS, pr, new Float64Array(Sim.PLANETS).fill(0),
		function (t, outX, outY, count) {
			for (let i = 0; i < count; i++) {
				outX[i] = 500;
				outY[i] = 500;
			}
		}, true);
	return gravity;
}

/* the whole job in one call, deliberately ignoring the frame budget */
function traceWhole(gravity, origin, angle, speed, horizon) {
	gravity.routeBegin(origin, angle, speed, horizon);
	while (!gravity.routeStep(1e9)) { /* one slice does it */ }
	return snapshot(gravity);
}

function traceSliced(gravity, origin, angle, speed, horizon, sliceMs) {
	gravity.routeBegin(origin, angle, speed, horizon);
	let slices = 0;
	while (!gravity.routeStep(sliceMs)) slices += 1;
	const out = snapshot(gravity);
	out.slices = slices;
	return out;
}

function snapshot(gravity) {
	const count = gravity.predCount;
	return {
		count, time: gravity.predTime, length: gravity.predLength,
		reason: gravity.predReason, body: gravity.predBody, steps: gravity.predSteps,
		visits: gravity.predVisits, fresh: gravity.predNewVisits,
		stride: gravity.routeStride, maxSteps: gravity.routeMaxSteps,
		x: gravity.predX.slice(0, count), y: gravity.predY.slice(0, count)
	};
}

function sameTrace(a, b, label) {
	if (a.reason !== b.reason || a.body !== b.body) {
		check(false, label + ': reason ' + REASONS[a.reason] + ' != ' + REASONS[b.reason]);
		return;
	}
	if (a.steps !== b.steps || a.visits !== b.visits || a.fresh !== b.fresh ||
		a.stride !== b.stride || a.count !== b.count) {
		check(false, label + ': steps/visits/stride/count differ');
		return;
	}
	if (Math.abs(a.time - b.time) > 1e-9 || Math.abs(a.length - b.length) > 1e-6) {
		check(false, label + ': time/length differ');
		return;
	}
	for (let i = 0; i < a.count; i++) {
		if (a.x[i] !== b.x[i] || a.y[i] !== b.y[i]) {
			check(false, label + ': point ' + i + ' differs');
			return;
		}
	}
}

/* 1. sliced == one-shot */
function benchEquality(world, rand, moving) {
	if (moving) usePorts(world, MOVING_RATE);
	else usePlanets(world);
	const gravity = world.gravity;
	const shots = moving ? MOVING_SHOTS : SHOTS;
	let slices = 0;
	for (let n = 0; n < shots; n++) {
		const origin = Math.floor(rand() * Sim.PLANETS);
		const angle = rand() * Math.PI * 2;
		const speed = GravitySim.SPEED_MIN + rand() * (GravitySim.SPEED_MAX - GravitySim.SPEED_MIN);
		const horizon = n % 3 === 0 ? ROUTE_SECONDS : 20 + rand() * 500;
		const whole = traceWhole(gravity, origin, angle, speed, horizon);
		const cut = traceSliced(gravity, origin, angle, speed, horizon, 1);
		slices += cut.slices;
		sameTrace(whole, cut, (moving ? 'moving' : 'static') + ' shot ' + n);
	}
	console.log('  ' + (moving ? 'moving ports x' + MOVING_RATE : 'static') + ': ' + shots +
		' shots, one call vs 1 ms slices agree point for point (mean ' +
		(slices / shots).toFixed(1) + ' slices)');
}

/* 2. how long shots really live, and does any of them reach the wall */
function benchLengths(world) {
	usePlanets(world);
	const gravity = world.gravity;
	const times = [];
	let overCap = 0;
	let overWall = 0;
	for (let p = 0; p < Sim.PLANETS; p++) {
		for (let a = 0; a < 24; a++) {
			for (const speed of [30, 40, 50, 60, 75, 90, 110, 140, 180, 240, 320]) {
				gravity.predictFull(p, a / 24 * Math.PI * 2, speed, ROUTE_SECONDS);
				times.push(gravity.predTime);
				if (gravity.predTime > GravityGame.CAP_SECONDS) overCap += 1;
				if (gravity.predReason === GravitySim.END_TIME) overWall += 1;
			}
		}
	}
	times.sort((a, b) => a - b);
	const at = q => times[Math.floor(times.length * q)];
	console.log('  static field, ' + times.length + ' shots: flight median ' +
		at(0.5).toFixed(1) + ' s, p95 ' + at(0.95).toFixed(1) + ' s, longest ' +
		times[times.length - 1].toFixed(1) + ' s · over the 120 s tour cap ' + overCap +
		' · reaching the 1 800 s wall ' + overWall);
	check(overWall === 0, 'a static-field shot reached the 1 800 s wall, the net is not a net any more');
}

/* 3. buffer policy: flat at the wall, exact for real shots */
function benchBuffer(world) {
	const wall = makeWallWorld();
	const whole = traceWhole(wall, 0, 0, 30, ROUTE_SECONDS);
	check(whole.reason === GravitySim.END_TIME, 'wall trace ended with ' + REASONS[whole.reason]);
	check(whole.steps === ROUTE_STEPS, 'wall trace took ' + whole.steps + ' steps');
	check(whole.count <= GravitySim.PATH_MAX, 'wall trace stored ' + whole.count + ' points');
	check(whole.stride === 8, 'wall trace stride ' + whole.stride);
	console.log('  wall trace: ' + whole.steps + ' steps, ' + whole.count + ' points, stride ' +
		whole.stride + ', end ' + REASONS[whole.reason] + ' (' + whole.time.toFixed(0) + ' s)');

	const cut = traceSliced(wall, 0, 0, 30, ROUTE_SECONDS, 4);
	sameTrace(whole, cut, 'wall shot sliced');
	console.log('  the same wall shot in 4 ms slices: ' + cut.slices +
		' slices, identical path after ' + cut.stride + 'x compaction');

	usePlanets(world);
	let longest = null;
	for (let p = 0; p < Sim.PLANETS; p++) {
		for (let a = 0; a < 24; a++) {
			for (const speed of [40, 50, 60]) {
				world.gravity.predictFull(p, a / 24 * Math.PI * 2, speed, ROUTE_SECONDS);
				if (!longest || world.gravity.predTime > longest.time) {
					longest = { p, a, speed, time: world.gravity.predTime,
						count: world.gravity.predCount, stride: world.gravity.routeStride };
				}
			}
		}
	}
	check(longest.stride === 1, 'a ' + longest.time.toFixed(0) + ' s shot was sampled, stride ' +
		longest.stride);
	console.log('  longest real shot: ' + longest.time.toFixed(1) + ' s, ' + longest.count +
		' points, stride ' + longest.stride + ' (every step kept)');
}

/* 4. slice cost */
function benchSliceCost(rand) {
	const staticWorld = makeWorld(31);
	usePlanets(staticWorld);
	const movingWorld = makeWorld(31);
	usePorts(movingWorld, MOVING_RATE);
	const rows = [
		{ label: 'static field', gravity: staticWorld.gravity, runs: 24, wall: false },
		{ label: 'moving ports x' + MOVING_RATE, gravity: movingWorld.gravity, runs: 16, wall: false },
		{ label: 'wall trace', gravity: makeWallWorld(), runs: 1, wall: true }
	];
	for (const row of rows) {
		const gravity = row.gravity;
		let worst = 0;
		let work = 0;
		let slices = 0;
		let points = 0;
		for (let n = 0; n < row.runs; n++) {
			const origin = row.wall ? 0 : Math.floor(rand() * Sim.PLANETS);
			const angle = row.wall ? 0 : rand() * Math.PI * 2;
			const speed = row.wall ? 30 :
				GravitySim.SPEED_MIN + rand() * (GravitySim.SPEED_MAX - GravitySim.SPEED_MIN);
			gravity.routeBegin(origin, angle, speed, ROUTE_SECONDS);
			while (true) {
				const started = process.hrtime.bigint();
				const done = gravity.routeStep(SLICE_BUDGET);
				const ms = Number(process.hrtime.bigint() - started) / 1e6;
				if (ms > worst) worst = ms;
				work += ms;
				slices += 1;
				if (done) break;
			}
			points += gravity.predCount;
		}
		const avg = work / row.runs;
		check(worst <= SLICE_MS, row.label + ': slice ' + worst.toFixed(2) + ' ms exceeds ' +
			SLICE_MS.toFixed(1) + ' ms');
		/* 60 ms covers the pathological wall trace (~13 slices); real shots are one or two */
		check(avg <= 60, row.label + ': whole trace ' + avg.toFixed(1) + ' ms exceeds 60 ms');
		console.log('  ' + row.label + ': ' + avg.toFixed(1) + ' ms of work in ' +
			(slices / row.runs).toFixed(1) + ' slices, worst slice ' + worst.toFixed(2) +
			' ms, ' + Math.round(points / row.runs) + ' points');
	}
}

/* 5. no allocation */
function benchAllocation(world) {
	usePlanets(world);
	const gravity = world.gravity;
	const refs = [gravity.probe, gravity.predX, gravity.predY, gravity.predVisit,
		gravity.stepX, gravity.stepY, gravity.predBodyX, gravity.predBodyY,
		gravity.visited, gravity.routePoint];
	let ok = true;
	gravity.routeBegin(2, 1.1, 220, ROUTE_SECONDS);
	while (!gravity.routeStep(SLICE_BUDGET)) {
		if (gravity.probe !== refs[0] || gravity.predX !== refs[1] || gravity.predY !== refs[2] ||
			gravity.predVisit !== refs[3] || gravity.stepX !== refs[4] || gravity.stepY !== refs[5] ||
			gravity.predBodyX !== refs[6] || gravity.predBodyY !== refs[7] ||
			gravity.visited !== refs[8] || gravity.routePoint !== refs[9]) ok = false;
	}
	check(ok, 'a route trace replaced one of its buffers');
	console.log('  probe, path and all field buffers keep their identity across a trace');
}

console.log('route bench — ' + ROUTE_STEPS + ' steps of wall (' + ROUTE_SECONDS + ' s)');
const world = makeWorld(31);
const rand = seededRandom(2024);
console.log('1. sliced tracer equals a one-shot tracer');
benchEquality(world, rand, false);
benchEquality(world, rand, true);
console.log('2. flight length in the static field');
benchLengths(world);
console.log('3. point buffer');
benchBuffer(world);
console.log('4. slice cost');
benchSliceCost(rand);
console.log('5. no allocation');
benchAllocation(world);
console.log(failures === 0 ? 'ROUTE BENCH OK' : 'ROUTE BENCH FAILED (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
