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
		/* the imperial Capital launches free: never a "blocked but affordable" case */
		if (planet === player.capitalPlanet) continue;
		const departure = bot.careerDeparture(player, planet, player.ledger.purse,
			player.ship.mass, bot.probe);
		if (departure.starterCanExit) continue;
		blocked += 1;
		assert.ok(!departure.ok,
			'seed ' + seed + ' P' + planet + ': starter-blocked planet became affordable at the starter purse');
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
assert.ok(meanBlocked >= 2 && meanBlocked <= 4,
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

/* --- 0.6.2: the guest fee scales with the rail tier; own rail stays free --- */
{
	const f2 = makeSeed(42);
	const guest = f2.careers[0];
	const host = f2.careers[1];
	const hqsAll = f2.careers.map(career => career.hq);
	let planet = -1;
	for (let p = 0; p < UNIVERSE; p++) {
		if (hqsAll.includes(p) || p === guest.capitalPlanet) continue;
		if (host.pads[p].catapult === null && guest.pads[p].catapult === null) { planet = p; break; }
	}
	assert.ok(planet >= 0, 'fixture needs an unclaimed planet');
	guest.at = planet;
	guest.stranded = true;
	f2.sims[0].relocate(planet);
	const speed = GravitySim.SPEED_MIN + 10;
	/* an EMC-1 host rail, then an EMC-3: the same shot costs a guest more on the stronger rail */
	host.ledger.purse = 100;
	assert.ok(GravityGame.buildGear(host, planet, 'catapult', OrbitTech.CATAPULTS[0]));
	const fee1 = GravityGame.launchFee(guest, planet, speed);
	host.pads[planet].catapult = OrbitTech.CATAPULTS[2];
	host.pads[planet].chargeKwh = OrbitTech.BATTERIES[2].capacity;
	const fee3 = GravityGame.launchFee(guest, planet, speed);
	assert.ok(fee3 > fee1,
		'EMC-3 guest tax (' + fee3.toFixed(2) + ') not above EMC-1 (' + fee1.toFixed(2) + ')');
	/* an owned rail costs the owner nothing at either tier */
	guest.pads[planet].catapult = OrbitTech.CATAPULTS[0];
	guest.pads[planet].panel = OrbitTech.PANELS[0];
	guest.pads[planet].battery = OrbitTech.BATTERIES[0];
	guest.pads[planet].chargeKwh = OrbitTech.BATTERIES[0].capacity;
	assert.strictEqual(GravityGame.launchFee(guest, planet, speed), 0,
		'an own rail must charge nothing');
	/* and the commercial rail charges its energy fee, not the guest tax */
	GravityGame.setCommercial(guest, planet);
	const min = GravityGame.commercialFee(guest, planet, GravitySim.SPEED_MIN);
	assert.ok(Math.abs(GravityGame.launchFee(guest, planet, GravitySim.SPEED_MIN) - min) < 1e-12,
		'commercial rail does not quote the commercial fee');
	GravityGame.setCommercial(guest, -1);
}

/* --- 0.6.2: the deep-origin offer is tagged by the shared helper only --- */
{
	let deepSeen = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const f = makeSeed(seed);
		const career = f.careers[0];
		for (let i = 0; i < career.tasks.length; i++) {
			const task = career.tasks[i];
			if (task.kind !== GravityGame.TASK_DELIVERY) continue;
			const isDeep = GravityGame.deepOrigin(career, task.from, task.tons);
			assert.strictEqual(task.deep, isDeep,
				'seed ' + seed + ' slot ' + i + ': deep=' + task.deep +
				' vs tons ' + task.tons + ' at g ' + GravityGame.planetGravity(career.seed, task.from));
			if (!task.deep) continue;
			deepSeen += 1;
			assert.ok(task.tons >= GravityGame.DEEP_TONS &&
				GravityGame.planetGravity(career.seed, task.from) >= GravityGame.DEEP_G);
			/* the note names the rail that lifts it, and only there */
			const note = GravityGame.deepText(task);
			assert.strictEqual(note, 'needs EMC-3+ at P' + task.from);
			/* the bonus sits on top of the ordinary capped reward */
			assert.ok(task.reward > 0 && task.reward <=
				Math.round(GravityGame.CAREER.deliveryMax * (1 + GravityGame.DEEP_BONUS) * 100) / 100);
		}
	}
	assert.ok(deepSeen > 0, 'no deep-origin offer in seeds 1-40 — the tag cannot regress unseen');
	/* boundary: below either bar the offer is ordinary, and the note is silent */
	const f3 = makeSeed(1);
	const career = f3.careers[0];
	let deepPlanet = -1, shallowPlanet = -1;
	for (let p = 0; p < UNIVERSE; p++) {
		const g = GravityGame.planetGravity(career.seed, p);
		if (g >= GravityGame.DEEP_G && deepPlanet < 0) deepPlanet = p;
		if (g < GravityGame.DEEP_G && shallowPlanet < 0) shallowPlanet = p;
	}
	assert.ok(deepPlanet >= 0 && shallowPlanet >= 0, 'fixture needs both a deep and a shallow planet');
	assert.ok(GravityGame.deepOrigin(career, deepPlanet, GravityGame.DEEP_TONS));
	assert.ok(!GravityGame.deepOrigin(career, deepPlanet, GravityGame.DEEP_TONS / 2));
	assert.ok(!GravityGame.deepOrigin(career, shallowPlanet, GravityGame.DEEP_TONS * 3));
	assert.strictEqual(GravityGame.deepText({ deep: false, from: deepPlanet }), '');
	console.log('deep-origin offers in seeds 1-40:', deepSeen);
}

console.log('career departure calibration:', {
	universe: UNIVERSE,
	actors: 3,
	freePlanets: 10,
	gravity: 'seeded −1…+3.5 in 0.05 steps; every HQ is a seeded shallow planet',
	meanStarterBlocked: +meanBlocked.toFixed(2),
	seedsInTarget: inTargetRange + '/' + SEEDS,
	histogram: histogram,
	upgradeUnlocks: upgradeResolved + '/' + upgradeProbed,
	fixture: { seed: fixture.seed, planet, gravity: f.strength[planet] }
});
console.log('CAREER DEPARTURE OK');
