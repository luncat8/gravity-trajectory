/* Active dwell rows must preserve entry order, re-entry and sliced trace logs. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
const simPath = require.resolve('../gravity_sim.js');
let clock = 0;
const context = {
	module: { exports: {} }, require: createRequire(simPath),
	performance: { now: () => clock++ }
};
vm.runInNewContext(fs.readFileSync(simPath, 'utf8'), context, { filename: simPath });
const Sim = context.module.exports;

function run(sliced, masked, overflow) {
	const sim = new Sim(1000, 600);
	const px = Float64Array.of(100, 110, 120);
	const py = Float64Array.of(100, 100, 100);
	const radii = new Float64Array(3);
	const rx = new Float64Array(3).fill(8);
	const cos = new Float64Array(3).fill(1);
	const sin = new Float64Array(3);
	sim.setPlanets(3, px, py, radii, rx, rx, cos, sin);
	if (masked) sim.setPlanetMask(Uint8Array.of(1, 0, 1));
	sim.setField(0, radii, radii, () => {}, true);
	const openBuffer = sim.predOpenPlanets;
	const logBuffer = sim.predLogDwell;
	const sequence = [100, 105, 110, 115, 120, 150, 110, 100, 150];
	const steps = overflow ? 900 : 270;
	const expected = [];
	const inside = new Uint8Array(3);
	const open = new Int32Array(3).fill(-1);
	let step = 0;

	function membership(x, p) {
		return !(masked && p === 1) && (x - px[p]) ** 2 + 25 <= 64;
	}

	function enter(p, at) {
		if (expected.length >= Sim.PRED_LOG_MAX) return;
		open[p] = expected.length;
		expected.push({ planet: p, step: at, dwell: 0 });
	}

	for (let p = 0; p < 3; p++) {
		inside[p] = membership(100, p) ? 1 : 0;
		if (inside[p]) enter(p, 0);
	}
	sim.probe.x = 100;
	sim.probe.y = 105;
	sim.routeBeginAt(sim.probe, 0, 0, steps * Sim.DT, steps + 2);
	sim.advance = state => {
		step++;
		state.x = sequence[Math.floor(step / 3) % sequence.length];
		state.y = 105;
		/* Independent full scan: the old log law, not the active-row list. */
		for (let p = 0; p < 3; p++) {
			const now = membership(state.x, p);
			if (open[p] >= 0) {
				if (now) expected[open[p]].dwell++;
				else open[p] = -1;
			}
			if (now && !inside[p]) enter(p, step);
			inside[p] = now ? 1 : 0;
		}
	};

	function compare() {
		assert.strictEqual(sim.predLogCount, expected.length);
		for (let i = 0; i < expected.length; i++) {
			assert.strictEqual(sim.predLogPlanet[i], expected[i].planet, 'entry order');
			assert.strictEqual(sim.predLogStep[i], expected[i].step, 'entry step');
			assert.strictEqual(sim.predLogDwell[i], expected[i].dwell, 'dwell steps');
		}
		const active = Array.from(sim.predOpenPlanets.subarray(0, sim.predOpenCount));
		assert.strictEqual(new Set(active).size, active.length, 'no duplicate active planets');
		assert.deepStrictEqual(active.sort(), Array.from(open.keys()).filter(p => open[p] >= 0));
	}

	while (!sim.routeStep(sliced ? 1 : 1e9)) compare();
	compare();
	assert.strictEqual(sim.predSteps, steps);
	assert.strictEqual(sim.predReason, Sim.END_TIME);
	assert.strictEqual(sim.predOpenPlanets, openBuffer, 'active buffer reused across slices');
	assert.strictEqual(sim.predLogDwell, logBuffer);
	if (overflow) assert.strictEqual(sim.predLogCount, Sim.PRED_LOG_MAX, 'fixture fills log');

	/* Restart outside every system: no open rows from the previous trace. */
	sim.probe.x = 150;
	sim.routeBeginAt(sim.probe, 0, 0, 1, 120);
	assert.strictEqual(sim.predOpenCount, 0);
	assert.strictEqual(sim.predLogCount, 0);
	assert.ok(Array.from(sim.predLogOpen).every(row => row === -1));
}

for (const sliced of [false, true]) {
	for (const masked of [false, true]) {
		for (const overflow of [false, true]) run(sliced, masked, overflow);
	}
}

/* A trace without planet systems still collides with gravity bodies. */
{
	const sim = new Sim(1000, 600);
	sim.setField(1, Float64Array.of(10), Float64Array.of(0), (t, x, y) => {
		x[0] = 200;
		y[0] = 100;
	}, false);
	sim.probe.x = 180;
	sim.probe.y = 100;
	sim.probe.vx = 120;
	sim.probe.vy = 0;
	sim.fillStep(0);
	sim.routeBeginAt(sim.probe, 0, 0, 1, 120);
	sim.routeDrain(1e9);
	assert.strictEqual(sim.predReason, Sim.END_IMPACT);
	assert.strictEqual(sim.predBody, 0);
	assert.strictEqual(sim.predLogCount, 0);
	assert.strictEqual(sim.predOpenCount, 0);
}

console.log('ROUTE LOG OK · overlap, re-entry, mask, overflow, slices, reset and body-only impact');
