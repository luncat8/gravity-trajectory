/*
 * Generate `saved_maps.js`: one proven career opening per configuration.
 *
 * The page plans its opening seats by tracing every candidate HQ, which costs
 * seconds per career boot. The plan is a pure function of the world, so a map
 * this script accepts is exactly what `prepareCareerStarts` would compute —
 * stored as data so tests and the page can start from it without the search.
 *
 * A generated map is accepted by the page's own rule: every company gets a
 * distinct first-landing site, every site can launch again, and the weakest
 * opening pays at least OPENING_FAIR_RATIO of the best.
 *
 * Run: node experiments/make_saved_maps.js            (writes saved_maps.js)
 *      SEEDS=1-16 node experiments/make_saved_maps.js  (how far to sample)
 *      node experiments/make_saved_maps.js --check     (validate, do not write)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityMaps = require(path.join(root, 'saved_map.js'));

const PLANETS = OrbitWorld.PLANETS;
const START_MINUTES = 420;
const WRITE = process.argv.indexOf('--check') < 0;

const parseSeeds = value => {
	const [from, to] = value.split('-');
	if (to === undefined) return [Number(from)];
	const list = [];
	for (let seed = Number(from); seed <= Number(to); seed++) list.push(seed);
	return list;
};
const SEEDS = parseSeeds(process.env.SEEDS || '1-12');

/* One entry per record wanted; `from` spreads the configs over different seeds
 * so "load a random map" really is different worlds, and the career default
 * (13 worlds, YOU + two rivals) gets two. */
const CONFIGS = [
	{ universe: 13, seats: 3, want: 2, from: 1, note: 'career default' },
	{ universe: 13, seats: 2, want: 1, from: 3, note: 'YOU + one rival' },
	{ universe: 26, seats: 3, want: 1, from: 4, note: 'the old 26-world subset' },
	{ universe: 8, seats: 2, want: 1, from: 2, note: 'the small universe' },
	{ universe: 26, seats: 4, want: 1, from: 5, note: 'four companies on 26' }
];

function tradeWorld(seed, universe) {
	const mask = new Uint8Array(PLANETS);
	mask.fill(1, 0, universe);
	const trade = new Sim(seed);
	trade.setPlanetMask(mask);
	trade.step(START_MINUTES);
	trade.setPlanetLimit(universe);
	return { trade: trade, mask: mask };
}

/* the page's own acceptance test, re-run on the plan it returns */
function accepted(world, trade, mask, universe, homes, sourceSim) {
	const forced = new Uint8Array(PLANETS);
	for (let i = 0; i < homes.length; i++) forced[homes[i]] = 1;
	const stats = GravityGame.openingGroupStats(world, trade, mask, universe, forced,
		homes, sourceSim);
	const ratio = stats.maxPay > 0 ? stats.minPay / stats.maxPay : 0;
	const ok = stats.missing === 0 && stats.distinct && stats.exitOk && ratio >= 0.55;
	return { ok: ok, ratio: ratio, sites: stats.minSites, missing: stats.missing,
		distinct: stats.distinct, exitOk: stats.exitOk };
}

function planFor(seed, universe, seats) {
	const world = tradeWorld(seed, universe);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, world.mask, universe);
	GravityGame.applyMarketSpecials(market, world.trade.world);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	/* the page hands in its cargo sim, whose scales are 1 unless an experiment
	 * changed them; a plan is only valid for the field it was proven on */
	const sourceSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const t0 = Date.now();
	const homes = GravityGame.prepareCareerStarts(galaxy, world.trade.world, world.trade,
		world.mask, universe, seats, sourceSim);
	const ms = Date.now() - t0;
	if (!homes) return null;
	const check = accepted(world.trade.world, world.trade, world.mask, universe, homes, sourceSim);
	return {
		seed: seed,
		universe: universe,
		seats: homes,
		targetPay: galaxy.openingTargetPay,
		check: check,
		ms: ms,
		world: world
	};
}

function recordFor(plan, note) {
	const info = {
		seed: plan.seed,
		universe: plan.universe,
		galaxy: { mapSeats: plan.seats, openingTargetPay: plan.targetPay },
		rule: GravityGame.RULE_CAREER,
		bot: GravityGame.BOT_NORMAL,
		player: GravityGame.PLAYER_USER,
		cheat: null,
		rate: 1,
		gs: 1, fs: 1, ws: 1, ht: false
	};
	const record = GravityMaps.startRecord(info);
	record.note = note;
	record.stats = {
		weakest: Math.round(plan.check.ratio * 100) / 100,
		sites: plan.check.sites
	};
	return record;
}

const records = [];
for (const config of CONFIGS) {
	let found = 0;
	const order = SEEDS.filter(seed => seed >= config.from).concat(
		SEEDS.filter(seed => seed < config.from));
	for (const seed of order) {
		if (found >= config.want) break;
		const plan = planFor(seed, config.universe, config.seats);
		const label = config.universe + ' planets · ' + config.seats + ' seats';
		if (!plan || !plan.check.ok) {
			console.log('skip seed ' + seed + ' · ' + label + ' · ' +
				(plan ? 'ratio ' + plan.check.ratio.toFixed(2) +
					' sites ' + plan.check.sites : 'no plan'));
			continue;
		}
		records.push(recordFor(plan, config.note));
		found += 1;
		console.log('keep seed ' + seed + ' · ' + label + ' · seats ' +
			plan.seats.join(',') + ' · ratio ' + plan.check.ratio.toFixed(2) +
			' · sites ' + plan.check.sites + ' · ' + plan.ms + ' ms');
	}
	if (found < config.want) {
		console.error('only ' + found + '/' + config.want + ' maps for ' + config.universe +
			' planets · ' + config.seats + ' seats in seeds ' + SEEDS[0] + '-' +
			SEEDS[SEEDS.length - 1]);
		if (WRITE) process.exitCode = 1;
	}
}

console.log(records.length + ' maps');
if (!WRITE) process.exit(process.exitCode || 0);
const file = path.join(root, 'saved_maps.js');
fs.writeFileSync(file, GravityMaps.fileText(records));
console.log('wrote ' + path.relative(root, file) + ' (' + fs.statSync(file).size + ' bytes)');
