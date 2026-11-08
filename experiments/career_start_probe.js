/*
 * Career start probe: what does each company's very first flight look like?
 *
 * For a 13-planet career universe with YOU plus two rivals, print each
 * company's HQ, the best first flight the bot's own planner finds (profit and
 * landing), and how many of the planets that first flight can reach are light
 * enough for a fresh starter rail (EMC-1 + BAT-1) to leave again — i.e. how
 * many places the company can claim a new EMC on flight one and still fly on.
 *
 * This is the fairness the map generator is judged by: two companies on one
 * seed should open with comparable money and a comparable chance to build.
 *
 * Run: node experiments/career_start_probe.js (SEEDS=1-12 TRACE=1)
 */
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const RATE = 1;
const TRACE = process.env.TRACE === '1';
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

const EXIT_CACHE = 32;
const EXIT_ANGLES = 8;
const EXIT_FRACTIONS = [0, 1 / 3, 2 / 3, 1];
const TAU = Math.PI * 2;

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const gravity = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	gravity.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
	for (let p = 0; p < PLANETS; p++) {
		strength[p] = mask[p] ? GravityGame.planetGravity(seed, p) : 0;
	}
	gravity.setField(PLANETS, trade.planetR, strength, function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	gravity.fieldT = trade.t;
	gravity.fieldRate = RATE;
	gravity.setPlanetMask(mask);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
	GravityGame.applyMarketSpecials(market, trade.world);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	GravityGame.bindRun(market, galaxy, trade.world);
	const player = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(player, mask, UNIVERSE);
	/* the page pins every home to a standard well (gui_game startCareerRun) */
	GravityGame.startCareer(player, gravity, seed, trade, null, galaxy);
	strength[player.hq] = 1;
	gravity.setField(PLANETS, trade.planetR, strength, gravity.fillField, true);
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.setSpecialPlanets = null;
	bot.attachWorld(trade);
	bot.reset(seed, GravityGame.RULE_CAREER, 'normal', GravityGame.PLAYER_USER,
		[GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT]);
	bot.setPlanetMask(mask, UNIVERSE);
	for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
	bot.startCareers(galaxy, seed, trade);
	for (let i = 0; i < galaxy.actors.length; i++) {
		const hq = galaxy.actors[i].hq;
		strength[hq] = 1;
	}
	for (let p = 0; p < PLANETS; p++) bot.strength[p] = strength[p];
	gravity.setField(PLANETS, trade.planetR, strength, gravity.fillField, true);
	bot.useField(gravity, GravityGame.SRC_PLANETS);
	return { seed, trade, gravity, market, galaxy, player, bot, strength };
}

/* the starter rail's fastest shot for the dry ship at home gravity */
const STARTER_CAP = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
	OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], 1);

/* planets the starter rail can land on from `planet`, and which of those a
 * fresh starter rail could leave again (the site a new EMC may be built on) */
function openingSites(bot, sim, planet, strength) {
	const sites = [];
	const seen = new Uint8Array(PLANETS);
	for (let f = 0; f < EXIT_FRACTIONS.length; f++) {
		const speed = EXIT_FRACTIONS[f] === 1 ? STARTER_CAP
			: GravitySim.SPEED_MIN + (STARTER_CAP - GravitySim.SPEED_MIN) * EXIT_FRACTIONS[f];
		for (let a = 0; a < EXIT_ANGLES; a++) {
			const angle = (a + 0.5) / EXIT_ANGLES * TAU;
			sim.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
			if (sim.predReason !== GravitySim.END_IMPACT || sim.predBody < 0) continue;
			const body = sim.predBody;
			if (body === planet || seen[body]) continue;
			seen[body] = 1;
			sites.push({ planet: body, gravity: strength[body] });
		}
	}
	return sites;
}

function report(name, world, career, sim) {
	botPrepare(world.bot, sim);
	GravityGame.placeShip(career, sim, career.hq);
	sim.setLaunchNetwork(career.launchPads, career.ship);
	const plan = world.bot.careerPlan(career, sim, world.market, 0);
	const sites = openingSites(world.bot, sim, career.hq, world.strength);
	const light = sites.filter(s => s.gravity <= GravityGame.HQ_GRAVITY_MAX).length;
	const heavy = sites.filter(s => s.gravity > 1.5).length;
	return {
		name: name,
		hq: career.hq,
		hqG: world.strength[career.hq],
		light: light,
		heavy: heavy,
		reach: sites.length,
		profit: plan ? plan.score : -Infinity,
		dest: plan ? plan.body : -1,
		destG: plan && plan.body >= 0 ? world.strength[plan.body] : NaN,
		taskPay: plan ? plan.taskPay : 0,
		builds: plan ? plan.builds : false
	};
}

function botPrepare(bot, sim) {
	bot.prepareCareerExitProbe(sim);
}

const totals = { rows: 0, profitSpread: 0, lightShort: 0 };
for (const seed of SEEDS) {
	const world = makeWorld(seed);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, world.trade.planetX, world.trade.planetY, world.trade.planetR,
		world.trade.orbitRX, world.trade.orbitRY,
		world.trade.orbitTiltCos, world.trade.orbitTiltSin);
	sim.setField(PLANETS, world.trade.planetR, world.strength, world.gravity.fillField, true);
	sim.fieldT = world.trade.t;
	sim.fieldRate = RATE;
	sim.setPlanetMask(mask);
	sim.stepLimit = GravityGame.CAP_STEPS;
	const names = ['YOU', 'R1', 'R2'];
	const rows = [];
	for (let i = 0; i < world.galaxy.actors.length; i++) {
		rows.push(report(names[i] || ('R' + i), world, world.galaxy.actors[i], sim));
	}
	const profits = rows.map(r => r.profit).filter(Number.isFinite);
	const spread = profits.length > 1 ? Math.max(...profits) - Math.min(...profits) : 0;
	const minLight = Math.min(...rows.map(r => r.light));
	totals.rows += rows.length;
	totals.profitSpread += spread;
	if (minLight < 1) totals.lightShort += 1;
	const line = rows.map(r => r.name + ' P' + r.hq + ' g' + r.hqG.toFixed(2) +
		' · light ' + r.light + '/' + r.reach + ' · profit ' +
		(Number.isFinite(r.profit) ? r.profit.toFixed(2) : '—') +
		(r.dest >= 0 ? ' → P' + r.dest + ' g' + r.destG.toFixed(2) : '') +
		(r.builds ? ' +EMC' : '')).join(' | ');
	console.log('seed ' + seed + ' · spread ' + spread.toFixed(2) + ' · ' + line);
	if (TRACE) {
		for (const r of rows) {
			console.log('    ' + r.name + ' HQ P' + r.hq + ' heavy ' + r.heavy +
				' reach ' + r.reach + ' lite ' + r.light + ' dest P' + r.dest +
				' destG ' + (Number.isFinite(r.destG) ? r.destG.toFixed(2) : '-') +
				' pay ' + r.taskPay.toFixed(2) + ' builds ' + r.builds);
		}
	}
}
console.log('mean profit spread ' + (totals.profitSpread / SEEDS.length).toFixed(2) +
	' · seeds where a company has no starter-exitable first landing ' + totals.lightShort +
	' / ' + SEEDS.length + ' · ' + totals.rows + ' companies');
