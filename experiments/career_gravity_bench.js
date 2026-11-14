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
 * PAIRED=1 prints one purse line per rival-game, so two runs can be diffed game
 * by game; SEATS=0 / HQWELL=0 drop the page's two career-start steps.
 * Run: node experiments/career_gravity_bench.js (SEEDS=1-20 SECONDS=400 TRACE=1)
 */
'use strict';

const path = require('path');
const fs = require('fs');
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
/* SPECIAL=0 switches the 0.5.11 special planets off for the A/B: the run must
 * then reproduce the historical 12-seed totals bit for bit */
const SPECIAL = process.env.SPECIAL !== '0';
GravityGame.setSpecialPlanets(SPECIAL);
/* POLITICS=0 switches the 0.5.12 political clock off; the run with it off has
 * to reproduce the 0.5.11 totals, with it on it reports rot and rebellions */
const POLITICS = process.env.POLITICS !== '0';
GravityGame.setPolitics(POLITICS);
/* SEATS=0 seats every company with the standalone HQ picker instead of the
 * page's one planned fair map (`prepareCareerStarts`), HQWELL=0 leaves the
 * world seed's gravity on the HQ. Both are on because the page does both: an
 * HQ is traced at g 1 for the seat search and then pinned at g 1
 * (`startCareerRun`), so a company can never open inside a deep well. The
 * historical totals were measured with SEATS=0 HQWELL=0. */
const SEATS = process.env.SEATS !== '0';
const HQWELL = process.env.HQWELL !== '0';
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
	GravityGame.applyMarketSpecials(market, SPECIAL ? trade.world : null);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	/* the political clock is run-wide: bind before any career joins */
	GravityGame.bindRun(market, galaxy, POLITICS ? trade.world : null);
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
	if (SEATS) GravityGame.prepareCareerStarts(galaxy, trade.world, trade, mask,
		UNIVERSE, 1 + bot.count, gravity);
	const player = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(player, mask, UNIVERSE);
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	bot.startCareers(galaxy, seed, trade);
	/* the home the seat search traced at g 1 is pinned at g 1 for the run */
	if (HQWELL) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const hq = galaxy.actors[i].hq;
			if (hq < 0) continue;
			strength[hq] = 1;
			bot.strength[hq] = 1;
		}
	}
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
/* PAIRED=1 prints one machine-readable purse line per rival-game, so two runs
 * can be diffed game by game (the purse total alone swings too much to decide) */
const PAIRED = process.env.PAIRED === '1';
/* STATS=1 prints the per-company economy table of plan 0.6.10 §5 and saves it
 * to experiments/logs/0.6.10-map-statistics.txt; without it the bench output
 * is byte-identical to before */
const STATS = process.env.STATS === '1';
const totals = { flights: 0, earned: 0, pads: 0, dead: 0, reach: 0, stuck: 0,
	actors: 0, purse: 0, burns: 0, priced: 0, rescues: 0, noShots: 0, sits: 0,
	drops: 0, evacs: 0, fuelBought: 0, fuelProduced: 0, fuelSpent: 0, fuelTopUps: 0,
	rebel: 0, seized: 0, patients: 0, rot: 0, bribes: 0, arrests: 0,
	medicTrips: 0, delivered: 0 };
const purses = [];
const statsLines = [];
/* TOTAL accumulators over every company of every seed */
let totProfit = 0, totProperty = 0, totScience = 0, totFlown = 0;
let totRot = 0, totStanding = 0, totVisits = 0, totContracts = 0;
let totBribes = 0, totTax = 0, nCompanies = 0;
for (const seed of SEEDS) {
	const w = makeWorld(seed);
	const hqRows = ['P' + w.player.hq + ' g' + w.strength[w.player.hq].toFixed(1)];
	for (const r of w.bot.rivals.slice(0, w.bot.count)) {
		hqRows.push('P' + r.career.hq + ' g' + w.strength[r.career.hq].toFixed(1));
	}
	for (let step = 1; step <= steps; step++) {
		GravityGame.careerAdvance(w.player, 1);
		w.bot.stepCareer(step, w.market, w.trade);
		w.trade.advanceTo(w.trade.t + DT * RATE);
	}
	const rows = [];
	for (let i = 0; i < w.bot.count; i++) {
		const r = w.bot.rivals[i];
		const pad = padReport(w, r.career);
		const stuck = r.career.flights === 0;
		totals.flights += r.career.flights;
		totals.earned += r.career.earned;
		totals.purse += r.career.ledger.purse;
		purses.push('PURSE seed ' + seed + ' R' + (i + 1) + ' ' + r.career.ledger.purse.toFixed(4));
		totals.pads += pad.pads;
		totals.dead += pad.dead.length;
		totals.reach += pad.reach;
		totals.stuck += stuck ? 1 : 0;
		totals.actors += 1;
		if (STATS) {
			const out = {};
			GravityGame.careerStats(out, r.career);
			totProfit += out.profit; totProperty += out.property;
			totScience += out.science; totFlown += out.flown;
			totVisits += r.career.visitIncome; totContracts += r.career.earned;
			totBribes += r.career.bribeIncome; totTax += r.career.taxEarned;
			const rate = out.profit / SECONDS;
			statsLines.push('STATS seed ' + seed + ' R' + (i + 1) +
				' · profit ' + rate.toFixed(3) + '/s' +
				' · property ' + out.property.toFixed(2) +
				' · science ' + out.science.toFixed(2) +
				' · flown ' + (out.flown / SECONDS).toFixed(1) + ' px/s');
		}
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
	if (STATS) {
		let allProfit = 0, allProperty = 0, allScience = 0, allFlown = 0;
		for (let i = 0; i < w.bot.count; i++) {
			const out = {};
			GravityGame.careerStats(out, w.bot.rivals[i].career);
			allProfit += out.profit; allProperty += out.property;
			allScience += out.science; allFlown += out.flown;
		}
		const map = {};
		GravityGame.mapStats(map, w.market, steps);
		totRot += map.rot; totStanding += map.standing;
		statsLines.push('STATS seed ' + seed + ' all · profit ' +
			(allProfit / w.bot.count / SECONDS).toFixed(3) + '/s' +
			' · property ' + allProperty.toFixed(2) +
			' · science ' + allScience.toFixed(2) +
			' · flown ' + (allFlown / w.bot.count / SECONDS).toFixed(1) + ' px/s' +
			' · rot ' + Math.round(map.rot) + ' · standing ' + map.standing.toFixed(2));
	}
	totals.rescues += w.bot.careerBurnRescues;
	totals.fuelTopUps += w.bot.careerFuelTopUps;
	/* politics readout: how much of the map the rebellion took, and what the
	 * companies paid for or were arrested for */
	let reb = 0;
	let seized = 0;
	let patients = 0;
	let rot = 0;
	for (let p = 0; p < UNIVERSE; p++) {
		if (w.market.rebel[p]) reb += 1;
		if (w.market.seized[p]) seized += 1;
		patients += w.market.patients[p];
		rot += w.market.corruption[p];
	}
	totals.rebel += reb;
	totals.seized += seized;
	totals.patients += patients;
	totals.rot += rot / UNIVERSE;
	for (let i = 0; i < w.bot.count; i++) {
		totals.bribes += w.bot.rivals[i].career.bribes;
		totals.arrests += w.bot.rivals[i].career.arrests;
		totals.delivered += w.bot.rivals[i].career.patientsDelivered;
		totals.medicTrips += w.bot.rivals[i].career.medicTrips;
	}
	totals.noShots += w.events.noShots;
		totals.sits += w.events.sits;
		totals.drops += w.events.drops;
		if (STATS) nCompanies += w.bot.count;
		console.log('seed ' + seed + ' · HQ ' + hqRows.join(' ') + (TRACE ? '\n  ' + rows.join('\n  ') : ' · ' + rows.join(' | ')));
		if (TRACE) {
			const text = w.bot.decisionLog(steps, 'bench · seed ' + seed).split('\n');
			console.log(text.slice(process.env.ALL ? 0 : Math.max(0, text.length - 16)).join('\n'));
		}
}
if (STATS) {
	const income = totVisits + totContracts + totBribes + totTax;
	statsLines.push('STATS TOTAL · profit ' +
		(totProfit / SECONDS / nCompanies).toFixed(3) + '/s' +
		' · property ' + (totProperty / nCompanies).toFixed(2) +
		' · science ' + (totScience / nCompanies).toFixed(2) +
		' · flown ' + (totFlown / SECONDS / nCompanies).toFixed(1) + ' px/s' +
		' · rot ' + Math.round(totRot / SEEDS.length) +
		' · standing ' + (totStanding / SEEDS.length).toFixed(2) +
		' · visits ' + (income > 0 ? (totVisits / income * 100).toFixed(0) : 0) + '%' +
		' · contracts ' + (income > 0 ? (totContracts / income * 100).toFixed(0) : 0) + '%' +
		' · bribes ' + (income > 0 ? (totBribes / income * 100).toFixed(0) : 0) + '%' +
		' · tax ' + (income > 0 ? (totTax / income * 100).toFixed(0) : 0) + '%');
	console.log(statsLines.join('\n'));
	fs.writeFileSync(path.join(root, 'experiments/logs/0.6.10-map-statistics.txt'),
		statsLines.join('\n') + '\n');
}
console.log('TOTAL rivals ' + totals.actors + ' · flights ' + totals.flights +
	' · earned ' + totals.earned.toFixed(2) + ' · purse ' + totals.purse.toFixed(2) +
	' · pads ' + totals.pads +
	' · dead pads ' + totals.dead + ' · mean reach ' +
	(totals.actors > 0 ? (totals.reach / totals.actors).toFixed(2) : '0') +
	' · stuck ' + totals.stuck +
	(ENGINE ? ' · burns ' + totals.burns + ' · priced plans ' + totals.priced +
		' · rescue plans ' + totals.rescues +
		' · fuel bought ' + totals.fuelBought.toFixed(1) + ' kg · produced ' + totals.fuelProduced.toFixed(1) +
		' kg · spend ' + totals.fuelSpent.toFixed(2) + ' · top-ups ' + totals.fuelTopUps : '') +
	(DEADEND ? ' · no-shot ' + totals.noShots + ' · sits ' + totals.sits +
		' · drops ' + totals.drops + ' · evac ' + totals.evacs : '') +
	(NORESCUE ? ' · NORESCUE' : '') + (NOFUEL ? ' · NOFUEL' : '') +
	(POLITICS ? ' · rebel ' + totals.rebel + ' · seized ' + totals.seized +
		' · patients ' + totals.patients + ' · mean rot ' +
		(totals.rot / SEEDS.length).toFixed(1) + ' · bribes ' + totals.bribes +
		' · arrests ' + totals.arrests + ' · medic trips ' + totals.medicTrips +
		' · patients home ' + totals.delivered : ' · POLITICS=0'));
if (PAIRED) console.log(purses.join('\n'));
if (GravityGame.FUEL_PRICE * OrbitTech.TANKS[1].fuelCap <= GravityGame.commercialMinFee()) {
	throw new Error('a full FT-1 must cost more than a commercial EMC launch');
}
if (ENGINE && DEADEND && !NORESCUE && !NOFUEL && totals.rescues <= 0) {
	throw new Error('the seeded dead-end fixture found no profitable fuel rescue');
}
