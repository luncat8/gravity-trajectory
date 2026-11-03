/*
 * Seeded-gravity career bench: the GUI's 13-planet universe with the world
 * seed's per-planet gravity and two rival careers on the shared clock. Reports
 * the rival companies' flights, purse, pads, dead pads (a pad whose starter
 * rail cannot reach another system) and the mean reach of the pads they own,
 * so a site-choice change can be compared on the same worlds.
 * ENGINE=1 fits every rival with an impulse engine + tank (the 400 s bench
 * never buys one by itself), NOBURNPRICE=1 disables launch pricing for the A/B.
 * DEADEND=1 drains every HQ battery under a deep well; NORESCUE=1 is the
 * no-rescue A/B for that fixture.
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
const DEADEND = process.env.DEADEND === '1';
const NORESCUE = process.env.NORESCUE === '1';
const NOFUEL = process.env.NOFUEL === '1';
/* g=2 is already twice the shallow-HQ limit; stronger wells trap the one-burn
 * rescue as well and measure nothing */
const DEADEND_WELL = Number(process.env.DEADEND_WELL || 2);
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
	const events = { noShots: 0, sits: 0, drops: 0 };
	const addTrace = bot.traceAdd;
	bot.traceAdd = function (index, decision, detail, step) {
		if (decision === 'sit') events.sits += 1;
		if (decision === 'no shot') {
			events.noShots += 1;
			if (detail && detail.includes('dropped the unreachable contract')) events.drops += 1;
		}
		return addTrace.call(this, index, decision, detail, step);
	};
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
			/* Explicit bench grant: the stock 400 s run rarely buys a drive, so
			 * ENGINE=1 starts with a funded full tank to exercise burn pricing. */
			ship.fuelKg = NOFUEL ? 0 : ship.tank.fuelCap;
		}
	}
	if (NOFUEL) {
		bot.careerPrepareFuel = () => false;
		bot.careerFuelOffer = function () {
			const q = this.careerFuelQuote;
			q.kg = 0; q.produceKg = 0; q.buyKg = 0;
			return q;
		};
	}
	if (DEADEND) {
		/* own HQ rails stay dry and their wells stay deep, so only the
		 * commercial fallback can lift the ship and its ballistic fan dead-ends */
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			const hq = career.hq;
			strength[hq] = DEADEND_WELL;
			career.light[hq] = 0;
			career.pads[hq].chargeKwh = 0;
			career.pads[hq].reservedKwh = 0;
		}
		for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
		gravity.setField(PLANETS, trade.planetR, strength, gravity.fillField, true);
		bot.useField(gravity, GravityGame.SRC_PLANETS);
	}
	if (NOBURNPRICE) bot.careerPriceBurn = () => null;
	if (NORESCUE) bot.careerRescueBurn = () => null;
	return { trade, gravity, market, galaxy, player, bot, strength, events };
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
	actors: 0, burns: 0, priced: 0, rescues: 0, noShots: 0, sits: 0,
	drops: 0, evacs: 0, fuelBought: 0, fuelProduced: 0, fuelSpent: 0, fuelTopUps: 0 };
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
		totals.evacs += r.career.evacuations;
		totals.fuelBought += r.career.fuelBoughtKg;
		totals.fuelProduced += r.career.fuelProducedKg;
		totals.fuelSpent += r.career.fuelSpent;
		const ship = r.career.ship;
		if (ship.fuelKg < 0 || ship.fuelKg > ship.tank.fuelCap + 1e-9 || r.career.ledger.purse < -1e-9) {
			throw new Error('fuel/purse invariant broken: R' + (i + 1) + ' seed ' + seed);
		}
		for (const pad of r.career.pads) {
			if (pad.catapult && pad.chargeKwh + 1e-9 < pad.reservedKwh) {
				throw new Error('conversion ate reserved charge: R' + (i + 1) + ' seed ' + seed);
			}
		}
		rows.push('R' + (i + 1) + (stuck ? ' STUCK' : '') + ' · P' + r.career.at +
			' · purse ' + r.career.ledger.purse.toFixed(2) +
			' · earned ' + r.career.earned.toFixed(2) +
			' · ' + r.career.flights + ' flights · ' + pad.pads + ' pads' +
			' · reach ' + pad.reach.toFixed(1) +
			(pad.dead.length ? ' · dead ' + pad.dead.join(',') : ''));
	}
	totals.burns += w.bot.careerBurnsPlanned;
	totals.priced += w.bot.careerBurnPrices;
	totals.rescues += w.bot.careerBurnRescues;
	totals.fuelTopUps += w.bot.careerFuelTopUps;
	totals.noShots += w.events.noShots;
	totals.sits += w.events.sits;
	totals.drops += w.events.drops;
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
	(ENGINE ? ' · burns ' + totals.burns + ' · priced plans ' + totals.priced +
		' · rescue plans ' + totals.rescues +
		' · fuel bought ' + totals.fuelBought.toFixed(1) + ' kg · produced ' + totals.fuelProduced.toFixed(1) +
		' kg · spend ' + totals.fuelSpent.toFixed(2) + ' · top-ups ' + totals.fuelTopUps : '') +
	(DEADEND ? ' · no-shot ' + totals.noShots + ' · sits ' + totals.sits +
		' · drops ' + totals.drops + ' · evac ' + totals.evacs : '') +
	(NORESCUE ? ' · NORESCUE' : '') + (NOFUEL ? ' · NOFUEL' : ''));
if (GravityGame.FUEL_PRICE * OrbitTech.TANKS[1].fuelCap <= GravityGame.CAREER.commercialFee) {
	throw new Error('a full FT-1 must cost more than a commercial EMC launch');
}
if (ENGINE && DEADEND && !NORESCUE && !NOFUEL && totals.rescues <= 0) {
	throw new Error('the seeded dead-end fixture found no profitable fuel rescue');
}
