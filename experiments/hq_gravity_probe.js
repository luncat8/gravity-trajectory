/*
 * HQ gravity probe: for every planet of a 13-planet career universe, does the
 * starter rail (EMC-1 + BAT-1, dry 10 t ship) reach another system? Printed as
 * the share of planets that escape, grouped by gravity strength, so the HQ
 * picker can keep its candidates out of the wells where a career is dead on
 * arrival. Run: node experiments/hq_gravity_probe.js (SEEDS=40 STEP=0.25)
 */
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SEEDS = Number(process.env.SEEDS || 40);
const STEP = Number(process.env.STEP || 0.25);
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);
const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);

/* the starter rail's fastest shot for a dry ship */
const STARTER_CAP = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
	OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], 1);

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	for (let p = 0; p < PLANETS; p++) {
		strength[p] = mask[p] ? GravityGame.planetGravity(trade.seed, p) : 0;
	}
	sim.setField(PLANETS, trade.planetR, strength, function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	sim.fieldT = trade.t;
	sim.fieldRate = 1;
	sim.setPlanetMask(mask);
	bot.attachWorld(trade);
	bot.setPlanetMask(mask, UNIVERSE);
	return { trade, sim, strength };
}

const buckets = new Map();
let total = 0;
let blocked = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
	const world = makeWorld(seed);
	for (let p = 0; p < UNIVERSE; p++) {
		const real = world.strength[p];
		for (let g = -1; g <= 3.5 + 1e-9; g += STEP) {
			world.strength[p] = g;
			bot.prepareCareerExitProbe(world.sim);
			const speed = bot.careerExitSpeed(p, STARTER_CAP);
			const key = g.toFixed(2);
			let row = buckets.get(key);
			if (!row) buckets.set(key, row = { n: 0, ok: 0 });
			row.n += 1;
			if (speed > 0) row.ok += 1;
			else blocked += 1;
			total += 1;
		}
		world.strength[p] = real;
	}
}
const keys = [...buckets.keys()].sort((a, b) => Number(a) - Number(b));
console.log('starter cap ' + STARTER_CAP.toFixed(1) + ' px/s · ' + SEEDS + ' seeds · ' +
	UNIVERSE + ' planets · blocked ' + blocked + '/' + total);
for (const key of keys) {
	const row = buckets.get(key);
	if (Number(key) < -1 || Number(key) > 2.5) continue;
	console.log('  g ' + key + '  reach ' + (100 * row.ok / row.n).toFixed(0).padStart(3) + '%  n ' + row.n);
}
