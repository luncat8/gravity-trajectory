/*
 * Adding a live career rival enables one pre-generated planet. That planet must
 * be selected as a real starter HQ, not randomly: its exact first-flight fan
 * needs a free, non-heavy landing where EMC-1 can be built and launched again,
 * at pay comparable to the opening map.
 *
 * Run: node experiments/career_expansion_start_test.js (SEEDS=1,8 ADDS=2)
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');

const P = OrbitWorld.PLANETS;
const START_COUNT = 13;
const START_PLAYERS = 3;
const ADDS = Number(process.env.ADDS || 2);
const SEEDS = String(process.env.SEEDS || '1,8').split(',').map(Number);

function makeRun(seed) {
	const mask = new Uint8Array(P);
	mask.fill(1, 0, START_COUNT);
	const trade = new OrbitSim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const seats = GravityGame.prepareCareerStarts(galaxy, trade.world, trade,
		mask, START_COUNT, START_PLAYERS, sim);
	assert.strictEqual(seats.length, START_PLAYERS);
	const market = GravityGame.createMarket();
	GravityGame.applyMarketUniverse(market, mask, START_COUNT);
	GravityGame.applyMarketSpecials(market, trade.world);
	GravityGame.bindRun(market, galaxy, trade.world);
	for (let i = 0; i < seats.length; i++) {
		const career = GravityGame.createCareer(GravityGame.createLedger());
		GravityGame.setCareerUniverse(career, mask, START_COUNT);
		GravityGame.startCareer(career, sim,
			i === 0 ? seed : GravityGame.rivalSeed(seed, i - 1),
			trade, null, galaxy, seats[i]);
	}
	return { seed, count: START_COUNT, mask, trade, sim, galaxy };
}

for (const seed of SEEDS) {
	const run = makeRun(seed);
	for (let add = 0; add < ADDS; add++) {
		const plan = GravityGame.planCareerExpansion(run.galaxy, run.trade.world,
			run.trade, run.mask, run.count, run.sim);
		assert.ok(plan, 'seed ' + seed + ': no planned expansion HQ');
		assert.strictEqual(run.mask[plan.planet], 0,
			'seed ' + seed + ': planned HQ was already active');
		assert.ok(plan.sites > 0 && plan.landing >= 0,
			'seed ' + seed + ': planned HQ has no safe first landing');
		assert.ok(plan.pay > 0.01,
			'seed ' + seed + ': first flight is not profitable');

		/* Independently read the selected row from the exact final field. */
		const trialMask = new Uint8Array(run.mask);
		trialMask[plan.planet] = 1;
		const homes = new Uint8Array(P);
		for (const actor of run.galaxy.actors) homes[actor.hq] = 1;
		homes[plan.planet] = 1;
		GravityGame.openingPrepare(run.trade.world, run.trade, trialMask,
			run.count + 1, homes, run.sim);
		const track = GravityGame.openingTracks(run.trade.world, trialMask, homes,
			plan.planet, 8, 4, true);
		const route = plan.planet * P + plan.landing;
		assert.ok(Number.isFinite(track.sitePay[route]),
			'seed ' + seed + ': selected landing was not in the exact fan');
		assert.strictEqual(track.exitOk[route], 1,
			'seed ' + seed + ': selected landing cannot launch EMC-1');

		run.mask[plan.planet] = 1;
		run.count += 1;
		run.sim.setPlanetMask(run.mask);
		for (const actor of run.galaxy.actors) {
			GravityGame.setCareerUniverse(actor, run.mask, run.count);
		}
		const rival = GravityGame.createCareer(GravityGame.createLedger());
		GravityGame.setCareerUniverse(rival, run.mask, run.count);
		GravityGame.startCareer(rival, run.sim,
			GravityGame.rivalSeed(seed, run.galaxy.actors.length - 1),
			run.trade, null, run.galaxy, plan.planet);
		assert.strictEqual(rival.hq, plan.planet);
		console.log('seed ' + seed + ' add ' + (add + 1) + ' · HQ P' + plan.planet +
			' → P' + plan.landing + ' · pay ' + plan.pay.toFixed(2) +
			' vs target ' + plan.targetPay.toFixed(2) + ' · safe sites ' + plan.sites);
	}
}

console.log('career expansion starts passed for ' + (SEEDS.length * ADDS) + ' added rivals');
