/* Search reports are read-only; slice sizes and report polling cannot choose HQs. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const Trade = require('../orbit_sim.js');
const Sim = require('../gravity_sim.js');
const gamePath = require.resolve('../gravity_game.js');
/* a fresh module instance per fixture (its own caches and a fake clock): the
 * core and its parts run as browser scripts in one context */
const sources = [gamePath].concat(require(gamePath).PARTS.map(part => path.join(path.dirname(gamePath), part)))
	.map(file => [file, fs.readFileSync(file, 'utf8')]);
const gameRequire = createRequire(gamePath);

function fixture() {
	let clock = 0;
	const context = vm.createContext({ performance: { now: () => clock++ } });
	for (const name of ['GravitySim', 'OrbitWorld', 'OrbitEcon', 'OrbitTech', 'OrbitScience', 'PlanetGravity']) {
		context[name] = gameRequire('./' + name.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()) + '.js');
	}
	for (const [file, source] of sources) vm.runInContext(source, context, { filename: file });
	const Game = context.GravityGame;
	const trade = new Trade(1);
	trade.advanceTo(420);
	const sim = new Sim(Trade.WORLD_W, Trade.WORLD_H);
	sim.setPlanets(Trade.PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const mask = new Uint8Array(Trade.PLANETS);
	mask.fill(1, 0, 13);
	sim.setPlanetMask(mask);
	return Game.createSeatSearch(trade.world, trade, mask, 13, 3, sim);
}

function readOnly(search) {
	const before = JSON.stringify(search.step(0));
	for (let i = 0; i < 5; i++) {
		assert.strictEqual(JSON.stringify(search.step(0)), before, 'step(0) must not advance work');
		assert.strictEqual(JSON.stringify(search.step(-1)), before, 'negative budget must not advance work');
	}
}

const whole = fixture();
assert.strictEqual(whole.step(0).progress, 0, 'reading a fresh search does not probe light planets');
assert.strictEqual(whole.bestPlan(), null);
assert.strictEqual(whole.advanceTier(), false, 'cannot skip an unfinished tier');
readOnly(whole);
const completed = whole.step(Infinity);
assert.strictEqual(completed.done, true);
assert.ok(whole.bestPlan(), 'fixture must produce a plan');
readOnly(whole);

function drain(poll) {
	const search = fixture();
	let units = 0;
	while (true) {
		if (poll) readOnly(search);
		const out = search.step(1);
		units++;
		assert.ok(units < 10000, 'bounded tier completion');
		if (out.done) break;
		assert.strictEqual(search.bestPlan(), null, 'unfinished tier is display-only');
		assert.strictEqual(search.bestHomes(), null);
	}
	assert.strictEqual(JSON.stringify(search.step(0)), JSON.stringify(completed), 'same final report');
	assert.strictEqual(JSON.stringify(search.bestPlan()), JSON.stringify(whole.bestPlan()), 'same HQs and pay');
	const homes = search.bestHomes();
	homes[0] = -1;
	assert.notStrictEqual(search.bestHomes()[0], -1, 'readout does not expose mutable homes');
	return units;
}

const units = drain(false);
assert.strictEqual(drain(true), units, 'H polling does not consume search units');
console.log('SEAT SEARCH OK · read-only reports, completed-tier commits, deterministic slices · ' + units + ' units');
