/*
 * Career departure viability and seeded starter-rail calibration.
 * Run: node experiments/career_departure_test.js
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');
const OrbitTech = require('../orbit_tech.js');
const GravityBot = require('../gravity_bot.js');

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SEEDS = 100;
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);
const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
const histogram = {};
let blockedTotal = 0;
let inTargetRange = 0;
let upgradeResolved = 0;
let upgradeProbed = 0;
let fixture = null;

function makeSim(trade, strength) {
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.setField(PLANETS, trade.planetR, strength, (t, outX, outY, count) => {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	}, true);
	sim.setScales(1, 1);
	return sim;
}

function makeSeed(seed) {
	const trade = new OrbitSim(seed);
	trade.advanceTo(420);
	const strength = new Float64Array(PLANETS);
	for (let p = 0; p < UNIVERSE; p++) strength[p] = GravityGame.planetGravity(seed, p);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const careers = [];
	const sims = [];
	for (let actor = 0; actor < 3; actor++) {
		const sim = makeSim(trade, strength);
		const career = GravityGame.createCareer(GravityGame.createLedger());
		GravityGame.setCareerUniverse(career, mask, UNIVERSE);
		const actorSeed = actor === 0 ? seed : GravityGame.rivalSeed(seed, actor - 1);
		GravityGame.startCareer(career, sim, actorSeed, trade, null, galaxy);
		careers.push(career);
		sims.push(sim);
	}
	strength[careers[0].hq] = 1;
	bot.attachWorld(trade);
	bot.setPlanetMask(mask, UNIVERSE);
	bot.setScales(1, 1);
	bot.strength.set(strength);
	bot.probe.fieldT = trade.t;
	bot.probe.fieldRate = 1;
	return { trade, strength, careers, sims };
}

for (let seed = 1; seed <= SEEDS; seed++) {
	const world = makeSeed(seed);
	const player = world.careers[0];
	const hqs = world.careers.map(career => career.hq);
	assert.strictEqual(new Set(hqs).size, 3, 'career HQs must be distinct');
	assert.strictEqual(player.ship.mass, 10, 'calibration assumes the starter ship');
	let blocked = 0;
	for (let planet = 0; planet < UNIVERSE; planet++) {
		if (hqs.includes(planet)) continue;
		const departure = bot.careerDeparture(player, planet, player.ledger.purse,
			player.ship.mass, bot.probe);
		if (departure.starterCanExit) continue;
		blocked += 1;
		blockedTotal += 1;
		if (!fixture) fixture = { seed, planet };
		const upgraded = bot.careerDeparture(player, planet, 100, player.ship.mass, bot.probe);
		upgradeProbed += 1;
		if (upgraded.ok && upgraded.builds && upgraded.catapult.tier > 1) upgradeResolved += 1;
	}
	histogram[blocked] = (histogram[blocked] || 0) + 1;
	if (blocked >= 2 && blocked <= 4) inTargetRange += 1;
}

const meanBlocked = blockedTotal / SEEDS;
assert.ok(meanBlocked >= 2.5 && meanBlocked <= 3.5,
	'starter-blocked mean outside the 2–4 target: ' + meanBlocked.toFixed(2));
assert.ok(inTargetRange >= 70,
	'only ' + inTargetRange + '/' + SEEDS + ' seeds landed in the 2–4 target range');
assert.ok(upgradeResolved >= upgradeProbed * 0.8,
	'only ' + upgradeResolved + '/' + upgradeProbed + ' starter-blocked planets resolved with affordable EMC/battery gear');

/* An unaffordable blocked landing is rejected; buying the selected kit makes
 * the same planet a proven departure. */
const f = makeSeed(fixture.seed);
const player = f.careers[0];
const planet = fixture.planet;
const high = bot.careerDeparture(player, planet, 100, player.ship.mass, bot.probe);
assert.ok(high.ok && high.builds && high.catapult.tier > 1,
	'test fixture did not find an EMC upgrade route');
const upgradeCatapult = high.catapult;
const upgradeBattery = high.battery;
player.ledger.purse = 6;
const poor = bot.careerDeparture(player, planet, player.ledger.purse,
	player.ship.mass, bot.probe);
assert.ok(!poor.ok && !poor.starterCanExit,
	'a blocked destination must stay unavailable at the starter purse');
assert.strictEqual(bot.careerScoreFacts(player, player.hq, GravityGame.createMarket(),
	0, 0, 0, planet, 0, 100, 100), -Infinity,
	'career scoring accepted a landing the starter purse cannot leave');
const predictFast = bot.probe.predictFast;
bot.probe.predictFast = function () {
	this.predReason = GravitySim.END_IMPACT;
	this.predBody = planet;
	this.predSteps = 100;
	this.predTime = 1;
	this.predLength = 100;
	this.predLogCount = 0;
	this.predNewVisits = 0;
	this.predVisits = 0;
};
assert.strictEqual(bot.careerPlan(player, f.sims[0], GravityGame.createMarket(),
	0, false, 1), null,
	'the career search selected a repeatedly predicted dead-end planet');
bot.probe.predictFast = predictFast;

player.ledger.purse = 100;
player.at = planet;
f.sims[0].relocate(planet);
assert.ok(bot.careerBetweenFlights(player, f.sims[0]) > 0,
	'idle controller did not buy exit gear on the blocked landing');
assert.strictEqual(player.pads[planet].catapult, upgradeCatapult);
assert.strictEqual(player.pads[planet].battery, upgradeBattery);
const afterBuild = bot.careerDeparture(player, planet, player.ledger.purse,
	player.ship.mass, f.sims[0]);
assert.ok(afterBuild.ok && afterBuild.source === 'own' && !afterBuild.builds,
	'the selected EMC/battery kit did not unlock a safe departure');

console.log('career departure calibration:', {
	universe: UNIVERSE,
	actors: 3,
	freePlanets: 10,
	gravity: 'uniform −1…+3.5 in 0.05 steps; player HQ = 1',
	meanStarterBlocked: +meanBlocked.toFixed(2),
	seedsInTarget: inTargetRange + '/' + SEEDS,
	histogram: histogram,
	upgradeUnlocks: upgradeResolved + '/' + upgradeProbed,
	fixture: { seed: fixture.seed, planet, gravity: f.strength[planet] }
});
console.log('CAREER DEPARTURE OK');
