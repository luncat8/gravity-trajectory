/*
 * Diagnostic: career rival careers on the GUI's default 13-planet universe with
 * per-planet gravity strengths, reported from the decision log the HUD prints.
 * Run: node experiments/career_gui_repro.js (SEEDS=279588 STEPS=12000 MASK=13)
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const DT = GravitySim.DT;
const RATE = 1;
const PLANETS = OrbitWorld.PLANETS;
const SEEDS = (process.env.SEEDS || '279588').split(',').map(Number);
const STEPS = Number(process.env.STEPS || 12000);
const COUNT = Number(process.env.MASK || 13);
const LEVEL = process.env.LEVEL || 'normal';
const TRACE = process.env.TRACE === '1';

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const gravity = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	gravity.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const mask = new Uint8Array(PLANETS);
	for (let i = 0; i < COUNT; i++) mask[i] = 1;
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	for (let p = 0; p < PLANETS; p++) strength[p] = mask[p] ? GravityGame.planetGravity(seed, p) : 0;
	gravity.setField(PLANETS, trade.planetR, strength, function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	gravity.fieldT = trade.t;
	gravity.fieldRate = RATE;
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, COUNT);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const playerLedger = GravityGame.createLedger();
	const player = GravityGame.createCareer(playerLedger);
	GravityGame.setCareerUniverse(player, mask, COUNT);
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	strength[player.hq] = 1;
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, LEVEL, GravityGame.PLAYER_USER,
		[GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT]);
	bot.setPlanetMask(mask, COUNT);
	for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
	bot.startCareers(galaxy, seed, trade);
	return { trade, gravity, market, galaxy, player, bot, strength };
}

for (const seed of SEEDS) {
	const w = makeWorld(seed);
	const hqStr = w.bot.rivals.slice(0, w.bot.count).map(r =>
		'P' + r.career.hq + ' str ' + w.strength[r.career.hq].toFixed(2));
	console.log('seed', seed, 'planets', COUNT, 'level', LEVEL,
		'player HQ P' + w.player.hq + ' str ' + w.strength[w.player.hq].toFixed(2),
		'rivals', hqStr.join(' '));
	for (let step = 1; step <= STEPS; step++) {
		GravityGame.careerAdvance(w.player, RATE, 1);
		w.bot.stepCareer(step, w.market, w.trade, RATE);
		w.trade.advanceTo(w.trade.t + DT * RATE);
	}
	const rows = w.bot.rivals.slice(0, w.bot.count).map((r, i) => ({
		i, at: r.career.at, purse: +r.career.ledger.purse.toFixed(2),
		pads: r.career.padCount, flights: r.career.flights,
		ended: r.career.ended, idle: r.idleTries, wait: r.waitTries
	}));
	console.log('  after', (STEPS * DT).toFixed(1), 's', JSON.stringify(rows));
	const text = w.bot.decisionLog(STEPS, 'repro · seed ' + seed).split('\n');
	console.log(text.slice(TRACE ? 0 : Math.max(0, text.length - 24)).join('\n'));
}
