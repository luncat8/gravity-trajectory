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
 * `--check` re-plans every start map already in `saved_maps.js` and fails when
 * the search no longer returns it: a record that outlived a change to the search
 * seats a run no seed link starts, and the page tests on `?map=` would keep
 * passing on it.
 *
 * Run: node experiments/make_saved_maps.js            (writes saved_maps.js)
 *      SEEDS=1-16 node experiments/make_saved_maps.js  (how far to sample)
 *      node experiments/make_saved_maps.js --check     (the registry against the search)
 *      FIELDS=1 node experiments/make_saved_maps.js    (plan seats into map_fields.js)
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
const PlanetGravity = require(path.join(root, 'planet_gravity.js'));
const MapGen = require(path.join(root, 'map_gen.js'));

const PLANETS = OrbitWorld.PLANETS;
const START_MINUTES = 420;
const CHECK = process.argv.includes('--check');

const parseSeeds = value => {
	const [from, to] = value.split('-');
	if (to === undefined) return [Number(from)];
	const list = [];
	for (let seed = Number(from); seed <= Number(to); seed++) list.push(seed);
	return list;
};
const SEEDS = parseSeeds(process.env.SEEDS || '1-12');

/* One entry per record wanted; `from` spreads the sampled configs over different
 * seeds so "load a random map" really is different worlds, and the career
 * default (13 worlds, YOU + two rivals) gets two. `seeds` names its worlds
 * instead of sampling them. `?map=<index>` counts from the top, so a new entry
 * goes last. */
const CONFIGS = [
	{ universe: 13, seats: 3, want: 2, from: 1, note: 'career default' },
	{ universe: 13, seats: 2, want: 1, from: 3, note: 'YOU + one rival' },
	{ universe: 26, seats: 3, want: 1, from: 4, note: 'the old 26-world subset' },
	{ universe: 8, seats: 2, want: 1, from: 2, note: 'the small universe' },
	{ universe: 26, seats: 4, want: 1, from: 5, note: 'four companies on 26' },
	{ universe: 13, seats: 3, seeds: [42, 7, 3, 520383], note: 'career default · a page-test world' },
	{ universe: 13, seats: 3, seeds: [93293], note: 'career default' }
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

function planFor(seed, universe, seats, gravityScale, forceScale) {
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
	sourceSim.setScales(gravityScale, forceScale);
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

/* the seeds a config tries in order, and how many of them it keeps */
function seedPlan(config) {
	if (config.seeds) return { order: config.seeds, want: config.seeds.length };
	return {
		order: SEEDS.filter(seed => seed >= config.from).concat(
			SEEDS.filter(seed => seed < config.from)),
		want: config.want
	};
}

function recordsFor(config) {
	const { order, want } = seedPlan(config);
	const label = config.universe + ' planets · ' + config.seats + ' seats';
	const records = [];
	for (const seed of order) {
		if (records.length >= want) break;
		const plan = planFor(seed, config.universe, config.seats, 1, 1);
		if (!plan || !plan.check.ok) {
			console.log('skip seed ' + seed + ' · ' + label + ' · ' +
				(plan ? 'ratio ' + plan.check.ratio.toFixed(2) +
					' sites ' + plan.check.sites : 'no plan'));
			continue;
		}
		records.push(recordFor(plan, config.note));
		console.log('keep seed ' + seed + ' · ' + label + ' · seats ' +
			plan.seats.join(',') + ' · ratio ' + plan.check.ratio.toFixed(2) +
			' · sites ' + plan.check.sites + ' · ' + plan.ms + ' ms');
	}
	if (records.length < want) {
		console.error('only ' + records.length + '/' + want + ' maps for ' + label +
			' in seeds ' + order.join(','));
	}
	return records;
}

function resolveFieldsPath(spec) {
	if (!spec || spec === '0') return null;
	if (spec === '1') return path.join(root, 'map_fields.js');
	return path.resolve(spec);
}

function loadArrayModule(file) {
	delete require.cache[require.resolve(file)];
	return require(file);
}

function planForRecord(record, seatsWanted) {
	const gs = record.gs === undefined ? 1 : record.gs;
	const fs = record.fs === undefined ? 1 : record.fs;
	try {
		if (record.kind === 'field' && Array.isArray(record.gravity)) {
			PlanetGravity.arm(record.gravity, record.seed);
		} else {
			PlanetGravity.disarm();
		}
		return planFor(record.seed, record.universe, seatsWanted, gs, fs);
	} finally {
		PlanetGravity.disarm();
	}
}

function generate() {
	PlanetGravity.disarm();
	const records = CONFIGS.flatMap(config => recordsFor(config));
	const wanted = CONFIGS.reduce((sum, config) => sum + seedPlan(config).want, 0);
	console.log(records.length + ' maps');
	/* a short registry would move every later `?map=<index>`: the file stays as it is */
	if (records.length < wanted) return 1;
	const file = path.join(root, 'saved_maps.js');
	fs.writeFileSync(file, GravityMaps.fileText(records));
	console.log('wrote ' + path.relative(root, file) + ' (' + fs.statSync(file).size + ' bytes)');
	return 0;
}

function generateFields(fieldsFile) {
	const records = MapGen.readFields(loadArrayModule(fieldsFile));
	const out = [];
	let failed = false;
	for (const record of records) {
		const seats = Array.isArray(record.seats) && record.seats.length > 0
			? record.seats.length
			: Math.max(1, Math.floor(Number(process.env.SEATS) || 3));
		const plan = planForRecord(record, seats);
		if (!plan || !plan.check.ok) {
			failed = true;
			console.error('FAIL  ' + record.name + ' · no fair opening (' +
				(plan ? 'ratio ' + plan.check.ratio.toFixed(2) +
					' sites ' + plan.check.sites +
					' exit ' + plan.check.exitOk : 'no plan') + ')');
			continue;
		}
		out.push(MapGen.fieldRecord(Object.assign({}, record, {
			seats: plan.seats,
			targetPay: plan.targetPay,
			rule: record.rule || GravityGame.RULE_CAREER,
			bot: record.bot || GravityGame.BOT_NORMAL,
			player: record.player || GravityGame.PLAYER_USER,
			cheat: record.cheat || null,
			rate: record.rate === undefined ? 1 : record.rate,
			gs: record.gs === undefined ? 1 : record.gs,
			fs: record.fs === undefined ? 1 : record.fs,
			ws: record.ws === undefined ? 1 : record.ws,
			ht: record.ht === true,
			stats: {
				weakest: Math.round(plan.check.ratio * 100) / 100,
				sites: plan.check.sites
			}
		})));
		console.log('keep  ' + record.name + ' · seed ' + record.seed +
			' · seats ' + plan.seats.join(',') +
			' · ratio ' + plan.check.ratio.toFixed(2) +
			' · sites ' + plan.check.sites + ' · ' + plan.ms + ' ms');
	}
	if (failed) return 1;
	fs.writeFileSync(fieldsFile, MapGen.fieldsText(out));
	console.log('wrote ' + path.relative(root, fieldsFile) +
		' (' + fs.statSync(fieldsFile).size + ' bytes)');
	return 0;
}

/* what a record stores, and what the search returns now when that differs */
function checkLine(record, plan, same) {
	const seats = Array.isArray(record.seats) ? record.seats.join(',') : 'none';
	const stored = record.name + ' · seats ' + seats + ' · pay ' + record.targetPay;
	if (same) return 'ok    ' + stored + ' · ' + plan.ms + ' ms';
	const now = plan ? 'seats ' + plan.seats.join(',') + ' · pay ' + plan.targetPay : 'no plan';
	return 'FAIL  ' + stored + ' · stale, the search now returns ' + now;
}

function verifyRecord(record) {
	if (!Array.isArray(record.seats) || record.seats.length === 0) {
		console.log('FAIL  ' + record.name + ' · field has no seats');
		return false;
	}
	const plan = planForRecord(record, record.seats.length);
	const same = plan !== null && plan.check.ok &&
		plan.seats.join() === record.seats.join() &&
		plan.targetPay === record.targetPay;
	console.log(checkLine(record, plan, same));
	return same;
}

function check(fieldsFile) {
	let stale = 0;
	if (fieldsFile) {
		for (const record of MapGen.readFields(loadArrayModule(fieldsFile))) {
			if (!verifyRecord(record)) stale += 1;
		}
		if (stale > 0) {
			console.error('FIELD MAPS CHECK FAILED (' + stale + ' stale): regenerate with ' +
				'FIELDS=1 node experiments/make_saved_maps.js');
		}
		return stale > 0 ? 1 : 0;
	}
	for (const record of loadArrayModule(path.join(root, 'saved_maps.js'))) {
		if (record.kind !== 'start' && record.kind !== 'field') continue;
		if (!verifyRecord(record)) stale += 1;
	}
	const defaultFields = path.join(root, 'map_fields.js');
	if (fs.existsSync(defaultFields)) {
		for (const record of MapGen.readFields(loadArrayModule(defaultFields))) {
			if (!Array.isArray(record.seats) || record.seats.length === 0) continue;
			if (!verifyRecord(record)) stale += 1;
		}
	}
	if (stale > 0) {
		console.error('SAVED MAPS CHECK FAILED (' + stale + ' stale): regenerate with ' +
			'node experiments/make_saved_maps.js, then rerun the page tests that boot on ?map=');
	}
	return stale > 0 ? 1 : 0;
}

const fieldsFile = resolveFieldsPath(process.env.FIELDS);
process.exitCode = CHECK
	? check(fieldsFile)
	: fieldsFile ? generateFields(fieldsFile) : generate();
