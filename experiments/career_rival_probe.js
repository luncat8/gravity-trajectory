/* Diagnostic: run rival careers on the shared world clock and report long idle
 * streaks with the state that blocks them. Run: node experiments/career_rival_probe.js
 * SEEDS=7,31 STEPS=200000 IDLE=3600 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const DT = GravitySim.DT;
const RATE = 1;
const PLANETS = OrbitWorld.PLANETS;
const SEEDS = (process.env.SEEDS || '7,31,42,913').split(',').map(Number);
const STEPS = Number(process.env.STEPS || 200000);
const IDLE = Number(process.env.IDLE || 3600);
const LEVEL = process.env.LEVEL || 'normal';

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const gravity = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	gravity.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	gravity.setField(PLANETS, trade.planetR, strength, function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	gravity.fieldT = trade.t;
	gravity.fieldRate = RATE;
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const playerLedger = GravityGame.createLedger();
	const player = GravityGame.createCareer(playerLedger);
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, LEVEL, GravityGame.PLAYER_USER,
		[GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT]);
	bot.startCareers(galaxy, seed, trade);
	return { trade, gravity, market, galaxy, player, bot };
}

function state(w, i, step) {
	const r = w.bot.rivals[i];
	const c = r.career;
	const at = c.at;
	const pad = at >= 0 ? GravityGame.padAt(c, at) : null;
	return {
		step, t: +(step * DT).toFixed(1), rival: i, flights: c.flights,
		ended: c.ended, at, purse: +c.ledger.purse.toFixed(2), pads: c.padCount,
		stranded: c.stranded, commercial: c.commercialPlanet,
		owner: at >= 0 ? GravityGame.padOwner(c, at) : null,
		charge: pad ? +pad.chargeKwh.toFixed(3) : null,
		reserved: pad ? +pad.reservedKwh.toFixed(3) : null,
		cap: at >= 0 ? +r.sim.speedLimit(at).toFixed(1) : null,
		lift: at >= 0 ? +GravityGame.padLift(c, at).toFixed(1) : null,
		fee: at >= 0 ? +GravityGame.launchFee(c, at, GravitySim.SPEED_MIN).toFixed(2) : null,
		exit: at >= 0 ? +GravityGame.exitCostAt(c, at, c.ship.mass).toFixed(2) : null,
		readyIn: r.readyStep - step, idleTries: r.idleTries, waitTries: r.waitTries,
		turret: r.turret ? { fireIn: r.turret.fireAt - step, angle: r.turret.angle.toFixed(2) } : null,
		sim: r.sim.status, contract: c.contract,
		book: c.launchBook.entries.filter(e => e.origin === at).length
	};
}

for (const seed of SEEDS) {
	const w = makeWorld(seed);
	let lastFlights = w.bot.rivals.map(() => 0);
	const grounded = w.bot.rivals.map(() => 0);
	const longest = w.bot.rivals.map(() => 0);
	const reports = [];
	for (let step = 1; step <= STEPS; step++) {
		GravityGame.careerAdvance(w.player, RATE, 1);
		w.bot.stepCareer(step, w.market, w.trade, RATE);
		w.trade.advanceTo(w.trade.t + DT * RATE);
		for (let i = 0; i < w.bot.count; i++) {
			const r = w.bot.rivals[i];
			const c = r.career;
			if (c.flights !== lastFlights[i]) { lastFlights[i] = c.flights; grounded[i] = 0; }
			else if (r.sim.status !== GravitySim.STATUS_FLYING) grounded[i] += 1;
			else grounded[i] = 0;
			if (grounded[i] > longest[i]) longest[i] = grounded[i];
			if (grounded[i] === IDLE) reports.push(state(w, i, step));
		}
	}
	console.log('seed', seed, 'level', LEVEL, 'longest idle (s)',
		w.bot.rivals.slice(0, w.bot.count).map((r, i) => (longest[i] * DT).toFixed(1)).join(', '),
		'flights', lastFlights.slice(0, w.bot.count).join(','), 'idle reports', reports.length);
	for (const s of reports) console.log('  ', JSON.stringify(s));
	if (process.env.LOG) {
		const text = w.bot.decisionLog(STEPS, 'probe · seed ' + seed).split('\n');
		console.log(text.slice(0, Math.min(text.length, 14)).join('\n'));
		console.log('  ...');
		console.log(text.slice(-Math.min(text.length, 30)).join('\n'));
	}
}
