/*
 * Seeded-gravity career bench: the GUI's 13-planet universe with the world
 * seed's per-planet gravity and two rival careers on the shared clock. Reports
 * the rival companies' flights, purse, pads, dead pads (a pad whose starter
 * rail cannot reach another system) and the mean reach of the pads they own,
 * so a site-choice change can be compared on the same worlds.
 * ENGINE=1 fits every rival with an impulse engine + tank (the 400 s bench
 * never buys one by itself), NOBURNPRICE=1 disables launch pricing for the A/B.
 * Run: node experiments/career_gravity_bench.js (SEEDS=1-20 SECONDS=400 TRACE=1)
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

const DT = GravitySim.DT;
const RATE = 1;
const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SECONDS = Number(process.env.SECONDS || 400);
const TRACE = process.env.TRACE === '1';
const ENGINE = process.env.ENGINE === '1';
const NOBURNPRICE = process.env.NOBURNPRICE === '1';
const parseSeeds = value => {
	const [from, to] = value.split('-');
	if (to === undefined) return [Number(from)];
	const list = [];
	for (let seed = Number(from); seed <= Number(to); seed++) list.push(seed);
	return list;
};
const SEEDS = parseSeeds(process.env.SEEDS || '1-12');
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);
const STARTER_CAP = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
	OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], 1);

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const gravity = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	gravity.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	for (let p = 0; p < PLANETS; p++) strength[p] = mask[p] ? GravityGame.planetGravity(seed, p) : 0;
	gravity.setField(PLANETS, trade.planetR, strength, function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	gravity.fieldT = trade.t;
	gravity.fieldRate = RATE;
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const player = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(player, mask, UNIVERSE);
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	const bot = GravityBot.prototype && new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, 'normal', GravityGame.PLAYER_USER,
		[GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT]);
	bot.setPlanetMask(mask, UNIVERSE);
	for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
	bot.startCareers(galaxy, seed, trade);
	/* the drive is a late purchase: a short bench has to fit it explicitly
	 * before rival launch pricing can be measured at all */
	if (ENGINE) {
		for (let i = 0; i < bot.count; i++) {
			const ship = bot.rivals[i].career.ship;
			ship.engine = OrbitTech.ENGINES[2];
			ship.tank = OrbitTech.TANKS[3];
			bot.rivals[i].career.owned[ship.engine.id] = true;
			bot.rivals[i].career.owned[ship.tank.id] = true;
			ship.mass = OrbitTech.shipMass(ship, ship.cargoTons);
			ship.fuelKg = ship.tank.fuelCap;
		}
	}
	if (NOBURNPRICE) bot.careerPriceBurn = () => null;
	return { trade, gravity, market, galaxy, player, bot, strength };
}

/* a pad is dead when its own rail at a full battery cannot reach another
 * system: the EMC there earns nothing, whatever it cost to build */
function padReport(w, career) {
	const dead = [];
	let reachSum = 0;
	let pads = 0;
	w.bot.prepareCareerExitProbe(w.gravity);
	for (let p = 0; p < PLANETS; p++) {
		const pad = career.pads[p];
		if (pad.catapult === null) continue;
		pads += 1;
		const cap = OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
			pad.catapult, career.forceScale);
		const speed = w.bot.careerExitSpeed(p, cap);
		reachSum += w.bot.careerReach ? w.bot.careerReach(p, cap) : 0;
		if (speed <= 0) dead.push(p + '(g ' + w.strength[p].toFixed(1) + ')');
	}
	return { pads, dead, reach: pads > 0 ? reachSum / pads : 0 };
}

const steps = Math.round(SECONDS / DT);
const totals = { flights: 0, earned: 0, pads: 0, dead: 0, reach: 0, stuck: 0,
	actors: 0, burns: 0, priced: 0 };
for (const seed of SEEDS) {
	const w = makeWorld(seed);
	const hqRows = ['P' + w.player.hq + ' g' + w.strength[w.player.hq].toFixed(1)];
	for (const r of w.bot.rivals.slice(0, w.bot.count)) {
		hqRows.push('P' + r.career.hq + ' g' + w.strength[r.career.hq].toFixed(1));
	}
	for (let step = 1; step <= steps; step++) {
		GravityGame.careerAdvance(w.player, RATE, 1);
		w.bot.stepCareer(step, w.market, w.trade, RATE);
		w.trade.advanceTo(w.trade.t + DT * RATE);
	}
	const rows = [];
	for (let i = 0; i < w.bot.count; i++) {
		const r = w.bot.rivals[i];
		const pad = padReport(w, r.career);
		const stuck = r.career.flights === 0;
		totals.flights += r.career.flights;
		totals.earned += r.career.earned;
		totals.pads += pad.pads;
		totals.dead += pad.dead.length;
		totals.reach += pad.reach;
		totals.stuck += stuck ? 1 : 0;
		totals.actors += 1;
		rows.push('R' + (i + 1) + (stuck ? ' STUCK' : '') + ' · P' + r.career.at +
			' · purse ' + r.career.ledger.purse.toFixed(2) +
			' · earned ' + r.career.earned.toFixed(2) +
			' · ' + r.career.flights + ' flights · ' + pad.pads + ' pads' +
			' · reach ' + pad.reach.toFixed(1) +
			(pad.dead.length ? ' · dead ' + pad.dead.join(',') : ''));
	}
	totals.burns += w.bot.careerBurnsPlanned;
	totals.priced += w.bot.careerBurnPrices;
	console.log('seed ' + seed + ' · HQ ' + hqRows.join(' ') + (TRACE ? '\n  ' + rows.join('\n  ') : ' · ' + rows.join(' | ')));
	if (TRACE) {
		const text = w.bot.decisionLog(steps, 'bench · seed ' + seed).split('\n');
		console.log(text.slice(process.env.ALL ? 0 : Math.max(0, text.length - 16)).join('\n'));
	}
}
console.log('TOTAL rivals ' + totals.actors + ' · flights ' + totals.flights +
	' · earned ' + totals.earned.toFixed(2) + ' · pads ' + totals.pads +
	' · dead pads ' + totals.dead + ' · mean reach ' +
	(totals.actors > 0 ? (totals.reach / totals.actors).toFixed(2) : '0') +
	' · stuck ' + totals.stuck +
	(ENGINE ? ' · burns ' + totals.burns + ' · priced plans ' + totals.priced : ''));
