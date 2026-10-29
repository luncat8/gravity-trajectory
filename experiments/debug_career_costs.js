/*
 * Career economy probe: which pad kit lifts which starter-blocked planet, and
 * what purse that kit needs — the numbers behind the EMC ladder floor (EMC-2
 * must cost more than the starter purse plus a first arrival's profit, or a
 * starter-blocked planet is a free rescue). Also sweeps seeds for any
 * starter-blocked planet that a kit under the starter purse can leave.
 * Run: node experiments/debug_career_costs.js
 */
'use strict';

const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');
const OrbitTech = require('../orbit_tech.js');
const GravityBot = require('../gravity_bot.js');

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);
const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);

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

/* every stock kit: fresh builds arrive with the starter panel and battery,
 * so a fresh catapult build costs the catapult alone */
function kitRows(career, planet) {
	const rows = [];
	for (const cat of OrbitTech.CATAPULTS) {
		for (const bat of OrbitTech.BATTERIES) {
			const cap = OrbitTech.speedLimit(bat.capacity, career.ship.mass, cat, career.forceScale);
			const speed = bot.careerExitSpeed(planet, cap);
			if (speed > 0) rows.push({ kit: cat.id + '+' + bat.id, cost: cat.buildCost + bat.buildCost, speed });
		}
	}
	return rows;
}

/* the fixture both career tests pin: seed 1, P3 */
const fixture = makeSeed(1);
const player = fixture.careers[0];
console.log('--- seed 1 · P3 · HQ P' + player.hq + ' · ship ' + player.ship.mass + ' t');
for (const row of kitRows(player, 3)) {
	console.log('   exits: ' + row.kit + ' cost ' + row.cost.toFixed(2) + ' speed ' + row.speed.toFixed(1));
}
for (const cash of [3, 5.5, 6, 7.74, 8, 100]) {
	const d = bot.careerDeparture(player, 3, cash, player.ship.mass, bot.probe);
	console.log('   cash ' + cash.toFixed(2) + ' -> ok ' + d.ok + ' cost ' +
		(Number.isFinite(d.cost) ? d.cost.toFixed(2) : '-') + ' ' +
		(d.catapult ? d.catapult.id + '+' + d.battery.id : d.source || d.reason));
}

/* the invariant sweep: every starter-blocked planet must stay blocked at the
 * starter purse (career_departure_test asserts the same per seed) */
const purse = OrbitTech.starterGrant().purse;
let blockedTotal = 0;
const resolvable = {};
for (let seed = 1; seed <= 100; seed++) {
	const world = makeSeed(seed);
	const p = world.careers[0];
	const hqs = world.careers.map(career => career.hq);
	for (let planet = 0; planet < UNIVERSE; planet++) {
		if (hqs.includes(planet)) continue;
		const d = bot.careerDeparture(p, planet, purse, p.ship.mass, bot.probe);
		if (d.starterCanExit) continue;
		blockedTotal += 1;
		if (d.ok) {
			const key = d.catapult.id + '+' + d.battery.id + ' cost ' + d.cost.toFixed(2);
			resolvable[key] = (resolvable[key] || 0) + 1;
		}
	}
}
console.log('--- starter purse ' + purse.toFixed(2) + ' · blocked planets ' + blockedTotal +
	' · resolvable at the starter purse ' + JSON.stringify(resolvable));
