/*
 * Medical-offer probe: why the rivals fly so few medical missions.
 *
 * The 0.5.13 worklog blamed the single MEDIC_SLOT offer. This probe counts the
 * four gates a mission has to pass instead: a rebel with patients, a hold big
 * enough to lift a medic (makeMedic refuses the offer outright at hold 0), the
 * rival standing on the Capital with no contract, and the flight itself.
 * `at-capital` separates the two reasons a rival can miss the offer: it never
 * lands on the Capital at all, or it is always under contract when it does.
 * The careers are seated and their HQ wells pinned like the page and like
 * `career_gravity_bench` (SEATS / HQWELL), so a dead-on-arrival company does
 * not count as a company that ignored the mission.
 * Run: node experiments/medic_offer_probe.js  (SEEDS=1-6 SECONDS=1200)
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
const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SECONDS = Number(process.env.SECONDS || 1200);
const parseSeeds = value => {
	const [from, to] = value.split('-');
	if (to === undefined) return [Number(from)];
	const list = [];
	for (let seed = Number(from); seed <= Number(to); seed++) list.push(seed);
	return list;
};
const SEEDS = parseSeeds(process.env.SEEDS || '1-6');
const mask = new Uint8Array(PLANETS);
mask.fill(1, 0, UNIVERSE);

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
	gravity.fieldRate = 1;
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
	GravityGame.applyMarketSpecials(market, trade.world);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	GravityGame.bindRun(market, galaxy, trade.world);
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, 'normal', GravityGame.PLAYER_USER,
		[GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT]);
	bot.setPlanetMask(mask, UNIVERSE);
	for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
	GravityGame.prepareCareerStarts(galaxy, trade.world, trade, mask, UNIVERSE,
		1 + bot.count, gravity);
	const player = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(player, mask, UNIVERSE);
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	bot.startCareers(galaxy, seed, trade);
	for (let i = 0; i < galaxy.actors.length; i++) {
		const hq = galaxy.actors[i].hq;
		if (hq < 0) continue;
		strength[hq] = 1;
		bot.strength[hq] = 1;
	}
	return { trade, market, bot };
}

const steps = Math.round(SECONDS / DT);
const totals = { games: 0, rebels: 0, offers: 0, blockedHold: 0, atCapital: 0,
	capitalVisits: 0, freeAtCapital: 0, offerFreeAtCapital: 0,
	accepts: 0, boardings: 0, patients: 0, unfinished: 0 };
for (const seed of SEEDS) {
	const w = makeWorld(seed);
	const count = w.bot.count;
	const rows = [];
	for (let i = 0; i < count; i++) {
		rows.push({ offers: 0, blockedHold: 0, atCapital: 0, capitalVisits: 0,
			freeAtCapital: 0, offerFreeAtCapital: 0, accepts: 0, boardings: 0,
			held: 0, kind: GravityGame.TASK_NONE, to: -1, wasAt: -1 });
	}
	let rebels = 0;
	let wasRebel = new Uint8Array(PLANETS);
	for (let step = 1; step <= steps; step++) {
		w.bot.stepCareer(step, w.market, w.trade, 1);
		w.trade.advanceTo(w.trade.t + DT);
		for (let p = 0; p < PLANETS; p++) {
			if (w.market.rebel[p] && !wasRebel[p]) rebels += 1;
			wasRebel[p] = w.market.rebel[p];
		}
		for (let i = 0; i < count; i++) {
			const row = rows[i];
			const career = w.bot.rivals[i].career;
			const offer = career.tasks[GravityGame.MEDIC_SLOT];
			const taken = career.contract >= 0 ? career.tasks[career.contract] : null;
			/* a rebel with patients is the raw demand; the offer needs a hold */
			if (offer.kind === GravityGame.TASK_MEDIC) row.offers += DT;
			else if (mostPatients(w.market) && GravityGame.medicLoad(career, mostPatients(w.market)) < 1) {
				row.blockedHold += DT;
			}
			const atCapital = career.at >= 0 && career.at === career.capitalPlanet;
			if (atCapital) {
				row.atCapital += DT;
				if (row.wasAt !== career.at) row.capitalVisits += 1;
			}
			row.wasAt = career.at;
			if (atCapital && career.contract < 0) {
				row.freeAtCapital += DT;
				/* the only second in which the offer can be taken */
				if (offer.kind === GravityGame.TASK_MEDIC) row.offerFreeAtCapital += DT;
			}
			if (taken && taken.kind === GravityGame.TASK_MEDIC) {
				if (row.kind !== GravityGame.TASK_MEDIC) {
					row.kind = GravityGame.TASK_MEDIC;
					row.to = taken.to;
					row.held = step;
					row.accepts += 1;
				}
				if (taken.aboard > 0 && row.boardings === 0) row.boardings += 1;
			} else if (row.kind === GravityGame.TASK_MEDIC) {
				row.kind = GravityGame.TASK_NONE;
				row.held = 0;
			}
		}
	}
	for (let i = 0; i < count; i++) {
		const row = rows[i];
		const career = w.bot.rivals[i].career;
		totals.games += 1;
		totals.offers += row.offers;
		totals.blockedHold += row.blockedHold;
		totals.atCapital += row.atCapital;
		totals.capitalVisits += row.capitalVisits;
		totals.freeAtCapital += row.freeAtCapital;
		totals.offerFreeAtCapital += row.offerFreeAtCapital;
		totals.accepts += row.accepts;
		totals.boardings += row.boardings;
		totals.patients += career.patientsDelivered;
		if (row.kind === GravityGame.TASK_MEDIC) totals.unfinished += 1;
	}
	totals.rebels += rebels;
	console.log('seed ' + seed + ' · rebels ' + rebels +
		' · R ' + rows.map((r, i) => 'hold ' + w.bot.rivals[i].career.ship.hold.capacity +
			' offer ' + r.offers.toFixed(0) + 's accept ' + r.accepts +
			' cap ' + r.atCapital.toFixed(0) + 's/' + r.capitalVisits +
			' board ' + r.boardings).join(' | '));
}

/* the rebellion the board would offer: the one with the most patients */
function mostPatients(market) {
	let most = 0;
	for (let p = 0; p < PLANETS; p++) {
		if (market.rebel[p] && market.patients[p] > most) most = market.patients[p];
	}
	return most;
}

console.log(SECONDS + ' s · ' + SEEDS.length + ' seeds · ' + totals.games + ' rival-games');
console.log('rebellions ' + totals.rebels + ' · offer-seconds ' + totals.offers.toFixed(0) +
	' · demand without a hold ' + totals.blockedHold.toFixed(0) + 's' +
	' · at-capital ' + totals.atCapital.toFixed(0) + 's (' + totals.capitalVisits + ' visits)' +
	' · free-at-capital ' + totals.freeAtCapital.toFixed(0) + 's' +
	' · offer and free at capital ' + totals.offerFreeAtCapital.toFixed(0) + 's');
console.log('accepts ' + totals.accepts + ' · boardings ' + totals.boardings +
	' · patients home ' + totals.patients + ' · missions still open at the end ' + totals.unfinished);
