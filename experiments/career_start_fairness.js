/*
 * Career map fairness: the planned HQs must admit a distinct, buildable,
 * exit-safe first landing for every company, with comparable positive pay.
 * Rows come from the final HQ-pinned field. An independent profit-window
 * matcher checks the seats; it must not maximize only the weakest payout,
 * because an unnecessarily rich winner can make a fair map look unfair.
 *
 * The default run also asserts the heavy-world share of the drawn field: over
 * SHARE_SEEDS, between 2 and 4 of every 10 drawn non-HQ planets (the Capital
 * and the A.R.F. hold g 1.00 by law) cannot be left by the starter rail
 * (EMC-1 + BAT-1, dry ship) in the final HQ-pinned field.
 *
 * MATRIX=1 runs every roster the page can start (COUNTS × SEATS); ALT=1 adds
 * the independent alternative-HQ oracle, ASSERT=1 the roster contract: a plan
 * whenever the universe has a seat per company, every seed fair from 20 worlds
 * up (a tier-0 plan that misses the band is re-measured through the completed
 * search ladder — the T1/T2 work budgets the page reaches with search-more —
 * under the same independent checkOpening verification), and on a cramped
 * universe an exit-safe (fair) opening wherever the oracle finds one, within
 * the plan-time budget (MEAN_MS per cell, tier-0 plans only).
 *
 * Run: node experiments/career_start_fairness.js        (SEEDS=1-8 COUNT=13 SEATS=3)
 *      MATRIX=1 node experiments/career_start_fairness.js  (roster matrix, SEEDS=1-12)
 *      MATRIX=1 ALT=1 ASSERT=1 node experiments/career_start_fairness.js
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');
const GravityBot = require('../gravity_bot.js');
const OrbitTech = require('../orbit_tech.js');
const PlanetGravity = require('../planet_gravity.js');

const P = OrbitWorld.PLANETS;

function parseRange(value) {
	const parts = String(value).split('-').map(Number);
	const from = parts[0];
	const to = parts.length > 1 ? parts[1] : from;
	const out = [];
	for (let seed = from; seed <= to; seed++) out.push(seed);
	return out;
}

function parseList(value) {
	return String(value).split(',').flatMap(part => parseRange(part.trim()));
}

const MATRIX = process.env.MATRIX === '1';
const SEEDS = parseRange(process.env.SEEDS || (MATRIX ? '1-12' : '1-8'));
const COUNT = Number(process.env.COUNT || 16);
const SEATS = Number(process.env.SEATS || 3);
const FAIR_RATIO = Number(process.env.RATIO || 0.55);
const COUNTS = process.env.COUNTS ? parseList(process.env.COUNTS)
	: (process.env.COUNT ? [COUNT] : [10, 16, 24, 26, 48]);
const SEATS_LIST = process.env.SEATS ? parseList(process.env.SEATS) : [2, 3, 4, 5, 6];
const ALT = MATRIX && process.env.ALT !== '0';
const ALT_LIMIT = Number(process.env.ALT_LIMIT || 1000);
/* Physics knobs under test: GS scales every well's pull, FS scales the rail
 * force cap. Both are passed through the shared sim, so the planner and the
 * independent oracle price the same field. */
const GS = Number(process.env.GS || 1);
const FS = Number(process.env.FS || 1);
/* ECONOMY knob: the age every planet starts with. A larger INIT_SEC lifts the
 * first-arrival floor, which compresses the weakest/best opening ratio. */
const INIT_SEC = Number(process.env.INIT_SEC || 0);
if (INIT_SEC > 0) GravityGame.MONEY.initSec = INIT_SEC;
/* SPREAD=1 ranks candidate HQ sets by their separation before the pay proxy:
 * far-apart HQs own separate clusters, so their openings do not compete. */
const SPREAD = process.env.SPREAD === '1';

function spreadOf(world, homes) {
	let min = Infinity;
	for (let i = 0; i < homes.length; i++) {
		for (let j = i + 1; j < homes.length; j++) {
			const dx = world.trade.planetX[homes[i]] - world.trade.planetX[homes[j]];
			const dy = world.trade.planetY[homes[i]] - world.trade.planetY[homes[j]];
			const d2 = dx * dx + dy * dy;
			if (d2 < min) min = d2;
		}
	}
	return Math.sqrt(min);
}
const ASSERT = process.env.ASSERT === '1';
const MEAN_MS = Number(process.env.MEAN_MS || 4000);
const SHARE_SEEDS = parseRange(process.env.SHARE_SEEDS || '1-12');
const SHARE_MIN = 0.2;
const SHARE_MAX = 0.4;
const STARTER_CAP = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
	OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], FS);

function makeWorld(seed, count) {
	const mask = new Uint8Array(P);
	mask.fill(1, 0, count);
	const trade = new OrbitSim(seed);
	const market = GravityGame.createMarket();
	GravityGame.deriveEmptyWorlds(market, mask, count, trade.world);
	trade.setPlanetMask(mask);
	trade.setEmptyMask(market.empty, market.heavy);
	trade.advanceTo(420);
	trade.setPlanetLimit(count);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.setScales(GS, FS);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	return { seed, mask, market, trade, sim, galaxy };
}

function isSpecial(world, planet) {
	return GravityGame.specialPlanets() &&
		(planet === world.trade.world.capitalPlanet || planet === world.trade.world.arfPlanet);
}

/* Drawn planets of the final field the starter rail cannot leave, by the
 * bot's own departure probe (sixteen bearings × two tiers: 75 % of the cap,
 * then the cap — 0.7.47). */
let exitBot = null;
function blockedPlanets(world, homes, count) {
	if (!exitBot) exitBot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const trade = world.trade;
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setScales(GS, FS);
	const pinned = new Uint8Array(P);
	for (const home of homes) pinned[home] = 1;
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	for (let planet = 0; planet < P; planet++) {
		if (!world.mask[planet]) strength[planet] = 0;
		else if (!pinned[planet] && !isSpecial(world, planet)) {
			strength[planet] = world.market && world.market.empty[planet] === 1
				? PlanetGravity.emptyGravity(world.seed, planet)
				: GravityGame.planetGravity(world.seed, planet);
		}
	}
	sim.setField(P, trade.planetR, strength, (t, outX, outY, n) => {
		for (let i = 0; i < n; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
	}, true);
	sim.fieldT = trade.t;
	sim.fieldRate = 1;
	sim.setPlanetMask(world.mask);
	exitBot.attachWorld(trade);
	exitBot.setScales(GS, FS);
	exitBot.setPlanetMask(world.mask, count);
	exitBot.prepareCareerExitProbe(sim);
	let drawn = 0, blocked = 0;
	for (let planet = 0; planet < count; planet++) {
		if (pinned[planet] || isSpecial(world, planet)) continue;
		if (world.market && world.market.empty[planet] === 1) continue;
		drawn += 1;
		if (!(exitBot.careerExitSpeed(planet, STARTER_CAP) > 0)) blocked += 1;
	}
	return { drawn, blocked };
}

function freeSites(mask, homes, market) {
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const sites = [];
	for (let site = 0; site < P; site++) {
		if (mask[site] && !occupied[site] && !(market && market.empty[site] === 1)) {
			sites.push(site);
		}
	}
	return sites;
}

/* Independent 0.7.47 margin mirror: a first landing counts only where the
 * starter rail (EMC-1 + BAT-1, dry ship) clears 75 % of its cap over
 * sixteen bearings. The probe flies the field the first flight sees — pass
 * `homes` to pin the planned HQs at g 1.00 (the game's traces do exactly
 * that; a drawn-heavy HQ well can block a 75 % escape), specials held, the
 * rest drawn — and caches per world + pin set. Without homes the drawn
 * field is probed (pre-plan site pools). A Capital never lands first. */
const siteProbeSessions = new WeakMap();
function buildableSite(world, site, homes) {
	if (GravityGame.specialPlanets() && site === world.trade.world.capitalPlanet) return false;
	if (world.market && world.market.empty[site] === 1) return false;
	const pinKey = homes && homes.length ? homes.join(',') : '';
	let session = siteProbeSessions.get(world);
	if (!session) {
		const trade = world.trade;
		const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
		sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
		sim.setScales(GS, FS);
		const base = new Float64Array(GravitySim.MAX_BODIES);
		for (let planet = 0; planet < P; planet++) {
			if (!world.mask[planet]) base[planet] = 0;
			else if (GravityGame.specialPlanets() && (planet === world.trade.world.capitalPlanet ||
				planet === world.trade.world.arfPlanet)) base[planet] = 1;
			else if (world.market && world.market.empty[planet] === 1) {
				base[planet] = PlanetGravity.emptyGravity(world.seed, planet);
			} else base[planet] = GravityGame.planetGravity(world.seed, planet);
		}
		const strength = base.slice();
		sim.setField(P, trade.planetR, strength, (t, outX, outY, n) => {
			for (let i = 0; i < n; i++) { outX[i] = trade.planetX[i]; outY[i] = trade.planetY[i]; }
		}, true);
		sim.fieldT = trade.t;
		sim.fieldRate = 1;
		sim.setPlanetMask(world.mask);
		sim.stepLimit = GravityGame.CAP_STEPS;
		session = { sim, base, strength, pinKey: null, cache: new Map() };
		siteProbeSessions.set(world, session);
	}
	let cache = session.cache.get(pinKey);
	if (!cache) {
		cache = new Int8Array(P).fill(-1);
		session.cache.set(pinKey, cache);
	}
	if (cache[site] >= 0) return cache[site] === 1;
	if (session.pinKey !== pinKey) {
		session.strength.set(session.base);
		if (homes) for (const home of homes) session.strength[home] = 1;
		session.sim.setField(P, world.trade.planetR, session.strength, (t, outX, outY, n) => {
			for (let i = 0; i < n; i++) { outX[i] = world.trade.planetX[i]; outY[i] = world.trade.planetY[i]; }
		}, true);
		session.pinKey = pinKey;
	}
	const sim = session.sim;
	const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
		OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], FS);
	const steps = GravityGame.SPEED_STEPS;
	const minU = GravitySim.SPEED_MIN * steps;
	let capU = Math.floor(cap * steps + 1e-9);
	const maxU = GravitySim.SPEED_MAX * steps;
	if (capU > maxU) capU = maxU;
	let ok = false;
	if (capU >= minU) {
		tier: for (let f = 0; f < 2; f++) {
			const speedU = f === 0 ? Math.max(minU, Math.round(capU * 0.75)) : capU;
			const speed = speedU / steps;
			for (let a = 0; a < 16; a++) {
				const angle = GravityGame.angleOf(GravityGame.angleUnits(
					(a + 0.5) / 16 * Math.PI * 2));
				sim.predictFast(site, angle, speed, GravityGame.CAP_SECONDS);
				if (sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0 &&
					sim.predBody !== site) { ok = f === 0; break tier; }
			}
		}
	}
	cache[site] = ok ? 1 : 0;
	return ok;
}

function lightBeforeCount(world, count) {
	let total = 0;
	for (let site = 0; site < count; site++) {
		if (buildableSite(world, site)) total += 1;
	}
	return total;
}

/* Kuhn matching inside a pay window. The site's holder is the only state;
 * reconstructing the witness afterwards avoids sharing the game's matcher. */
function matchSites(rows, homes, sites, floor, ceiling, exitOnly) {
	const holder = new Int16Array(P).fill(-1);
	const seen = new Uint8Array(P);
	function augment(seat) {
		const row = homes[seat] * P;
		for (const site of sites) {
			if (seen[site]) continue;
			const pay = rows.sitePay[row + site];
			if (!Number.isFinite(pay) || pay < floor || pay > ceiling) continue;
			if (exitOnly && rows.exitOk[row + site] !== 1) continue;
			seen[site] = 1;
			if (holder[site] >= 0 && !augment(holder[site])) continue;
			holder[site] = seat;
			return true;
		}
		return false;
	}
	for (let seat = 0; seat < homes.length; seat++) {
		seen.fill(0);
		if (!augment(seat)) return null;
	}
	const assigned = new Int16Array(homes.length).fill(-1);
	for (const site of sites) {
		if (holder[site] >= 0) assigned[holder[site]] = site;
	}
	return assigned;
}

function describe(rows, homes, sites) {
	let min = Infinity, max = -Infinity, sum = 0;
	for (let seat = 0; seat < homes.length; seat++) {
		const pay = rows.sitePay[homes[seat] * P + sites[seat]];
		if (pay < min) min = pay;
		if (pay > max) max = pay;
		sum += pay;
	}
	return { sites, min, max, sum, ratio: max > 0.01 ? min / max : 0 };
}

/* For every possible positive minimum, find the smallest maximum admitting
 * a distinct exit-safe matching. One of these windows contains the best ratio,
 * even when the highest-minimum matching has a much richer winner. */
function bestRatioAssignment(rows, homes, sites) {
	const pays = [];
	for (const home of homes) {
		for (const site of sites) {
			const row = home * P + site;
			const pay = rows.sitePay[row];
			if (rows.exitOk[row] === 1 && Number.isFinite(pay) && pay > 0) pays.push(pay);
		}
	}
	pays.sort((a, b) => a - b);
	const values = [];
	for (const pay of pays) {
		if (values.length === 0 || pay !== values[values.length - 1]) values.push(pay);
	}
	let best = null;
	for (let floor = 0; floor < values.length; floor++) {
		let low = floor, high = values.length - 1;
		let witness = null;
		while (low <= high) {
			const mid = (low + high) >> 1;
			const found = matchSites(rows, homes, sites, values[floor], values[mid], true);
			if (found) {
				witness = found;
				high = mid - 1;
			} else low = mid + 1;
		}
		if (!witness) continue;
		const candidate = describe(rows, homes, witness);
		if (candidate.max <= 0.01) continue;
		if (!best || candidate.ratio > best.ratio + 1e-12 ||
			(Math.abs(candidate.ratio - best.ratio) <= 1e-12 && candidate.min > best.min)) {
			best = candidate;
		}
	}
	return best;
}

function checkMatcherFixtures() {
	const mask = new Uint8Array(P);
	mask.fill(1, 0, 5);
	const homes = [0, 1];
	const sites = freeSites(mask, homes);
	const rows = {
		sitePay: new Float64Array(P * P).fill(-Infinity),
		targetPay: new Float64Array(P * P).fill(-Infinity),
		exitOk: new Uint8Array(P * P)
	};
	function offer(home, site, pay) {
		rows.sitePay[home * P + site] = pay;
		rows.targetPay[home * P + site] = pay;
		rows.exitOk[home * P + site] = 1;
	}
	offer(0, 2, 8);
	offer(0, 3, 3);
	offer(1, 2, 7);
	offer(1, 4, 3.1);
	const fair = bestRatioAssignment(rows, homes, sites);
	assert.deepStrictEqual(Array.from(fair.sites), [3, 4],
		'a cheaper distinct pair beats the highest-minimum but lopsided pair');
	assert.ok(fair.ratio > 0.9);
	rows.exitOk[0 * P + 3] = 0;
	assert.strictEqual(matchSites(rows, homes, sites, 3, 3.1, true), null,
		'a non-exitable site cannot complete a matching inside the pay window');
	assert.ok(bestRatioAssignment(rows, homes, sites).ratio < 0.55,
		'a non-exitable site cannot close the pay band');
	rows.exitOk[0 * P + 2] = 0;
	assert.ok(matchSites({ sitePay: rows.targetPay }, homes, sites,
		-Infinity, Infinity, false), 'a first landing is buildable even when the rail cannot leave it');
	assert.strictEqual(matchSites(rows, homes, sites, -Infinity, Infinity, true), null,
		'buildable does not imply an exit-safe first landing');
	rows.exitOk[0 * P + 3] = 1;
	rows.exitOk[0 * P + 2] = 1;
	mask[4] = 0;
	assert.ok(bestRatioAssignment(rows, homes, freeSites(mask, homes)).ratio < 0.55,
		'an inactive site cannot close the pay band');
	mask[4] = 1;
	rows.sitePay.fill(-Infinity);
	offer(0, 2, 3);
	offer(1, 2, 4);
	assert.strictEqual(matchSites(rows, homes, sites, -Infinity, Infinity, true), null,
		'two companies cannot claim one site');
	rows.sitePay.fill(-Infinity);
	offer(0, 2, 0);
	offer(1, 3, 0);
	assert.ok(matchSites(rows, homes, sites, -Infinity, Infinity, true),
		'a distinct zero-pay opening still exists');
	assert.strictEqual(bestRatioAssignment(rows, homes, sites), null,
		'zero pay is not a fair opening');
}

/* An exact game assignment is a witness too: its sites and money must exist
 * in the independently matched final-field rows, not just in the score. */
function checkGameWitness(world, homes, rows, stats) {
	if (!stats.assign || !stats.exitOk || stats.missing > 0) return null;
	const sites = stats.assign.sites;
	const available = freeSites(world.mask, homes);
	const seen = new Set();
	for (let seat = 0; seat < homes.length; seat++) {
		const site = sites[seat];
		const row = homes[seat] * P + site;
		assert.ok(available.includes(site) && !seen.has(site),
			'seed ' + world.seed + ': game assignment reuses a site or an HQ');
		seen.add(site);
		assert.ok(Number.isFinite(rows.sitePay[row]) && rows.exitOk[row] === 1,
			'seed ' + world.seed + ': game assignment is not an exit-safe traced landing');
		assert.ok(buildableSite(world, site, homes),
			'seed ' + world.seed + ': first pad is not margin-exitable or is the Capital');
	}
	const actual = describe(rows, homes, sites);
	assert.ok(Math.abs(actual.min - stats.minPay) < 1e-8 &&
		Math.abs(actual.max - stats.maxPay) < 1e-8 &&
		Math.abs(actual.sum - stats.sumPay) < 1e-8,
		'seed ' + world.seed + ': game score differs from its traced sites');
	return actual;
}

function planWorld(seed, count, seats, allowMissing) {
	const world = makeWorld(seed, count);
	const started = Date.now();
	const homes = GravityGame.prepareCareerStarts(world.galaxy, world.trade.world,
		world.trade, world.mask, count, seats, world.sim);
	const ms = Date.now() - started;
	if (!allowMissing) {
		assert.ok(homes && homes.length === seats, 'seed ' + seed + ': no planned seats');
		assert.strictEqual(new Set(homes).size, seats, 'seed ' + seed + ': duplicate HQ');
	}
	return { world, homes, ms };
}

/* The page reaches the T1/T2 ladder with search-more; the 20-world contract
 * was sized against that ladder, so a tier-0 plan that misses the band is
 * re-measured through the completed tiers under the same independent
 * checkOpening verification. Tier-0 plan time stays its own assert. */
function ladderSample(world, count, seats) {
	const search = GravityGame.createSeatSearch(world.trade.world, world.trade,
		world.mask, count, seats, world.sim);
	const started = Date.now();
	search.step(Infinity);
	while (search.canAdvanceTier()) {
		search.advanceTier();
		search.step(Infinity);
	}
	const ms = Date.now() - started;
	const homes = search.bestHomes();
	if (!homes) return null;
	const sample = checkOpening(world, homes, ms, count);
	return { sample, tier: search.tier, ms };
}

function checkOpening(world, homes, ms, count) {
	const lightBefore = lightBeforeCount(world, count);
	if (!homes || homes.length === 0) {
		return { seed: world.seed, homes: [], witness: null, ratio: 0, game: null,
			built: false, exitable: false, fair: false, ms, lightBefore, lightAfter: 0,
			noPlan: true };
	}
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const rows = GravityGame.careerOpenings(world.trade.world, world.trade,
		world.mask, count, occupied, world.sim);
	const sites = freeSites(world.mask, homes, world.market);
	/* targetPay is every reachable non-HQ site; sitePay has already filtered
	 * out Capital sites and landings from which an EMC-1 cannot leave with
	 * margin. Use the former for buildability so a dead end does not
	 * masquerade as a shortage. */
	const buildable = sites.filter(site => buildableSite(world, site, homes));
	const built = matchSites({ sitePay: rows.targetPay }, homes, buildable,
		-Infinity, Infinity, false) !== null;
	const safe = matchSites(rows, homes, sites, -Infinity, Infinity, true);
	const best = safe ? bestRatioAssignment(rows, homes, sites) : null;
	const witness = best || (safe ? describe(rows, homes, safe) : null);
	const ratio = best ? best.ratio : 0;
	const exact = GravityGame.openingGroupStats(world.trade.world, world.trade,
		world.mask, count, occupied, homes, world.sim, true);
	const game = checkGameWitness(world, homes, rows, exact);
	if (game) {
		assert.ok(ratio + 1e-9 >= game.ratio,
			'seed ' + world.seed + ': independent best band missed the game assignment');
	}
	const exitable = safe !== null;
	const fair = exitable && ratio >= FAIR_RATIO && exact.distinct && exact.exitOk &&
		exact.missing === 0 && game && game.ratio >= FAIR_RATIO;
	return { seed: world.seed, homes, witness, ratio, game, built, exitable, fair: !!fair, ms,
		lightBefore, lightAfter: buildable.length, noPlan: false };
}

/* Evaluate one candidate HQ set with cached per-home tracks: check distinct
 * buildable landings first (no exit probes) before paying for exit checks. */
function evaluateOracleSet(world, count, homes) {
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const sites = freeSites(world.mask, homes, world.market);
	const buildable = sites.filter(site => buildableSite(world, site, homes));
	if (buildable.length < homes.length) return { built: false, exitable: false, ratio: 0 };
	GravityGame.openingPrepare(world.trade.world, world.trade, world.mask, count,
		occupied, world.sim);
	const landPay = new Float64Array(P * P).fill(-Infinity);
	for (const home of homes) {
		const track = GravityGame.openingTracks(world.trade.world, world.mask,
			occupied, home, 8, 4, false);
		landPay.set(track.sitePay.subarray(home * P, (home + 1) * P), home * P);
	}
	if (!matchSites({ sitePay: landPay }, homes, buildable, -Infinity, Infinity, false)) {
		return { built: false, exitable: false, ratio: 0 };
	}
	const sitePay = new Float64Array(P * P).fill(-Infinity);
	const exitOk = new Uint8Array(P * P);
	for (const home of homes) {
		const track = GravityGame.openingTracks(world.trade.world, world.mask,
			occupied, home, 8, 4, true);
		sitePay.set(track.sitePay.subarray(home * P, (home + 1) * P), home * P);
		exitOk.set(track.exitOk.subarray(home * P, (home + 1) * P), home * P);
	}
	const rows = { sitePay, exitOk };
	const safe = matchSites(rows, homes, sites, -Infinity, Infinity, true);
	if (!safe) return { built: true, exitable: false, ratio: 0 };
	const best = bestRatioAssignment(rows, homes, sites);
	return { built: true, exitable: true, ratio: best ? best.ratio : 0 };
}

/* Search whether an alternative HQ set exists before changing the opening
 * contract. Exhaustive for count <= 13 (pruning sets that consume too many
 * light sites); heavy-preferring ranked sample for larger universes. */
function findBetterHqSet(world, count, seats) {
	const candidates = [];
	const lightFlags = new Uint8Array(P);
	let lightBefore = 0;
	for (let i = 0; i < count; i++) {
		if (GravityGame.specialPlanets() && i === world.trade.world.capitalPlanet) continue;
		if (world.market && world.market.empty[i] === 1) continue;
		candidates.push(i);
		if (buildableSite(world, i)) {
			lightFlags[i] = 1;
			lightBefore += 1;
		}
	}
	if (candidates.length < 2 * seats || lightBefore < seats) {
		return { built: false, exitable: false, ratio: 0, set: null, exhaustive: true,
			note: lightBefore < seats ? 'light ' + lightBefore + '<' + seats
				: 'nonCap ' + candidates.length + '<' + (2 * seats) };
	}
	const unpinned = GravityGame.careerOpenings(world.trade.world, world.trade,
		world.mask, count, null, world.sim);
	const heavy = candidates.filter(c => !lightFlags[c])
		.sort((a, b) => unpinned.buildPay[b] - unpinned.buildPay[a]);
	const light = candidates.filter(c => lightFlags[c])
		.sort((a, b) => unpinned.buildPay[b] - unpinned.buildPay[a]);
	const exhaustive = candidates.length <= 12;
	let pool;
	if (exhaustive) {
		pool = heavy.concat(light);
	} else {
		/* Pinning heavy worlds creates g 1.00 HQs without removing light build
		 * sites, so mix top heavy planets with top light ones. */
		const keepHeavy = heavy.slice(0, Math.min(heavy.length, Math.max(seats + 2, 9)));
		const keepLight = light.slice(0, Math.max(0, 18 - keepHeavy.length));
		pool = keepHeavy.concat(keepLight);
	}
	const maxLightHQs = lightBefore - seats;
	const sets = [];
	const cur = [];
	function generate(start, lightUsed) {
		if (!exhaustive && sets.length >= 20000) return;
		if (cur.length === seats) {
			const occupied = new Uint8Array(P);
			for (const home of cur) occupied[home] = 1;
			const stats = GravityGame.openingGroupStatsFromRows(world.mask, unpinned, cur, occupied);
			const ratio = stats.distinct && stats.maxPay > 0.01 ? stats.minPay / stats.maxPay : -1;
			sets.push({ homes: cur.slice(), distinct: stats.distinct, minPay: stats.minPay,
				ratio, spread: SPREAD ? spreadOf(world, cur) : 0 });
			return;
		}
		const need = seats - cur.length;
		for (let i = start; i <= pool.length - need; i++) {
			const candidate = pool[i];
			const nextLight = lightUsed + (lightFlags[candidate] ? 1 : 0);
			if (nextLight > maxLightHQs) continue;
			cur.push(candidate);
			generate(i + 1, nextLight);
			cur.pop();
		}
	}
	generate(0, 0);
	sets.sort((a, b) => {
		if (a.distinct !== b.distinct) return a.distinct ? -1 : 1;
		if (SPREAD && a.spread !== b.spread) return b.spread - a.spread;
		const aFair = a.ratio >= FAIR_RATIO;
		const bFair = b.ratio >= FAIR_RATIO;
		if (aFair !== bFair) return aFair ? -1 : 1;
		return b.ratio - a.ratio || b.minPay - a.minPay;
	});
	let best = { built: false, exitable: false, ratio: 0, set: null, exhaustive };
	const limit = exhaustive ? sets.length : Math.min(sets.length, ALT_LIMIT);
	let fairSets = 0, firstFair = -1;
	for (let i = 0; i < limit; i++) {
		const res = evaluateOracleSet(world, count, sets[i].homes);
		if (res.exitable && res.ratio >= FAIR_RATIO) {
			fairSets += 1;
			if (firstFair < 0) firstFair = i;
		}
		if (res.ratio > best.ratio || (!best.set && res.exitable) || (!best.built && res.built)) {
			best = { ...res, set: sets[i].homes, exhaustive };
			if (best.exitable && best.ratio >= FAIR_RATIO) break;
		}
	}
	return { ...best, fairSets, firstFair, tested: firstFair >= 0 ? firstFair + 1 : limit };
}

function failReason(sample, alt) {
	let base;
	if (sample.noPlan) base = 'seed ' + sample.seed + ': no plan (light ' + sample.lightBefore + ')';
	else if (!sample.built) base = 'seed ' + sample.seed + ': no distinct site (light ' + sample.lightBefore + '->' + sample.lightAfter + ')';
	else if (!sample.exitable) base = 'seed ' + sample.seed + ': dead end';
	else if (!sample.game) base = 'seed ' + sample.seed + ': no verified game assignment';
	else base = 'seed ' + sample.seed + ': ratio ' + sample.game.ratio.toFixed(2);
	if (!ALT || !alt) return base;
	if (alt.sameHq) return base + ' [same HQ oracle ' + sample.ratio.toFixed(2) + ']';
	if (alt.exitable && alt.ratio >= FAIR_RATIO) {
		return base + ' [alt HQ ' + alt.set.join(',') + ' oracle ' + alt.ratio.toFixed(2) +
			' · fair ' + alt.fairSets + ' first@' + alt.firstFair + ']';
	}
	if (alt.note) return base + ' [' + alt.note + ']';
	if (alt.exitable) return base + ' [best alt exit ' + alt.ratio.toFixed(2) + ']';
	if (alt.built) return base + ' [alt built, dead end]';
	return base + (alt.exhaustive ? ' [0 built in all sets]' : ' [none in probe]');
}

function runCell(count, seats, seeds) {
	let builtN = 0, exitN = 0, fairN = 0, sameHqN = 0, altFairN = 0, altExitN = 0;
	let worst = Infinity, sumMs = 0, maxMs = 0;
	let minBefore = Infinity, maxBefore = -Infinity;
	let minAfter = Infinity, maxAfter = -Infinity;
	let firstFail = '';
	let composN = 0, assertedN = 0;
	let addHeavies = 0, addPlanets = 0;
	let ladderN = 0, ladderMs = 0;
	const broken = [];
	const settledCount = count - GravityGame.emptyCountFor(count);
	const nonCap = settledCount - (GravityGame.specialPlanets() ? 1 : 0);
	const cellCompos = settledCount < 2 * seats + 4;
	for (const seed of seeds) {
		const plan = planWorld(seed, count, seats, true);
		const missingPlan = !plan.homes || plan.homes.length !== seats;
		if (nonCap >= seats && (missingPlan || new Set(plan.homes).size !== seats)) {
			broken.push('seed ' + seed + ': no plan for ' + seats + ' seats on ' + nonCap + ' homes');
		}
		const compos = GravityGame.startComposition(plan.world.trade.world,
			plan.world.mask, count, seats, plan.world.sim, 'planet');
		if (compos.additional > 0) {
			addHeavies += Math.max(0, compos.heavies - 2);
			addPlanets += compos.additional;
		}
		const composOk = !cellCompos && compos.ok;
		if (!composOk) composN += 1;
		else assertedN += 1;
		const sample = checkOpening(plan.world, missingPlan ? null : plan.homes, plan.ms, count);
		sumMs += sample.ms;
		if (sample.ms > maxMs) maxMs = sample.ms;
		if (sample.lightBefore < minBefore) minBefore = sample.lightBefore;
		if (sample.lightBefore > maxBefore) maxBefore = sample.lightBefore;
		if (sample.lightAfter < minAfter) minAfter = sample.lightAfter;
		if (sample.lightAfter > maxAfter) maxAfter = sample.lightAfter;
		if (sample.built) builtN += 1;
		if (sample.exitable) exitN += 1;
		if (sample.fair) fairN += 1;
		const chosenRatio = sample.game ? sample.game.ratio : 0;
		if (chosenRatio < worst) worst = chosenRatio;

		const sameHqFair = sample.exitable && sample.ratio >= FAIR_RATIO;
		if (sameHqFair) sameHqN += 1;
		let alt = null;
		if (ALT) {
			if (sameHqFair) {
				altFairN += 1;
				altExitN += 1;
				alt = { sameHq: true };
			} else {
				alt = findBetterHqSet(plan.world, count, seats);
				if (alt.exitable || sample.exitable) altExitN += 1;
				if (alt.exitable && alt.ratio >= FAIR_RATIO) altFairN += 1;
			}
		}
		if (!composOk) {
			if (!firstFail) firstFail = 'seed ' + seed + ': compos [' + compos.missing.join(',') + ']';
		} else if (!sample.fair && !firstFail) {
			firstFail = failReason(sample, alt);
		}
			if (composOk) {
				if (!sample.fair && settledCount >= 20) {
					const ladder = ladderSample(plan.world, count, seats);
					if (ladder && ladder.sample.fair) {
						ladderN += 1;
						ladderMs += ladder.sample.ms;
					} else {
						broken.push(failReason(sample, alt) +
							(ladder ? ' [ladder T' + ladder.tier + ' ' +
								ladder.sample.ratio.toFixed(2) + ']' : ''));
					}
				}
				if (settledCount < 20 && alt && !alt.sameHq) {
				if (alt.exitable && !sample.exitable) broken.push(failReason(sample, alt) + ' (oracle exits)');
				if (alt.exitable && alt.ratio >= FAIR_RATIO && !sample.fair) {
					broken.push(failReason(sample, alt) + ' (oracle fair)');
				}
			}
		}
	}
	if (sumMs / seeds.length > MEAN_MS) {
		broken.push('plan time ' + Math.round(sumMs / seeds.length) + ' ms mean > ' + MEAN_MS);
	}
	const n = seeds.length;
	const col = (k) => (k + '/' + n).padStart(5);
	const addShare = addPlanets > 0 ? (10 * addHeavies / addPlanets).toFixed(1) + '/10' : '   -';
	const line =
		('C=' + count).padEnd(5) + ' ' + ('S=' + seats).padEnd(4) +
		' | built ' + col(builtN) +
		' · exit ' + col(exitN) +
		' · fair ' + col(fairN) +
		' · worst ' + (Number.isFinite(worst) ? (worst * 100).toFixed(0) + '%' : '-').padStart(4) +
		' · light ' + (minBefore + '..' + maxBefore + '->' + minAfter + '..' + maxAfter).padEnd(13) +
		' · addH ' + addShare.padStart(6) +
		' · ms ' + (Math.round(sumMs / n) + '/' + maxMs).padEnd(9) +
		(ALT ? ' | sameHQ ' + col(sameHqN) + ' · altExit ' + col(altExitN) + ' · altFair ' + col(altFairN) : '') +
		(composN ? ' | compos ' + composN + '/' + n : '') +
		(ladderN ? ' | ladder ' + col(ladderN) + ' ' + Math.round(ladderMs / ladderN) + 'ms' : '') +
		(firstFail ? ' | ' + firstFail : '');
	console.log(line);
	return { count, seats, builtN, exitN, fairN, sameHqN, altExitN, altFairN, worst, n, broken, composN, assertedN, ladderN };
}

function runMatrix() {
	console.log('career opening matrix · seeds ' + SEEDS[0] + '-' + SEEDS[SEEDS.length - 1] +
		' · ratio >= ' + FAIR_RATIO + (ALT ? ' · alt HQ check (limit ' + ALT_LIMIT + ', exhaustive <=13)' : ''));
	const t0 = Date.now();
	const cells = [];
	for (const count of COUNTS) {
		for (const seats of SEATS_LIST) cells.push(runCell(count, seats, SEEDS));
	}
	const fullGame = cells.filter(c => c.fairN === c.n).length;
	const fullSameHq = cells.filter(c => c.sameHqN === c.n).length;
	const fullAltFair = cells.filter(c => c.altFairN === c.n).length;
	const fullAltExit = cells.filter(c => c.altExitN === c.n).length;
	const ladderCells = cells.filter(c => c.ladderN > 0).length;
	console.log('\n' + cells.length + ' cells · game fair ' + fullGame + '/' + cells.length +
		(ALT ? ' · sameHQ oracle fair ' + fullSameHq + '/' + cells.length +
			' · alt HQ exitable ' + fullAltExit + '/' + cells.length +
			' · alt HQ fair ' + fullAltFair + '/' + cells.length : '') +
		(ladderCells ? ' · ladder-rescued ' + ladderCells + '/' + cells.length : '') +
		' · ' + Math.round((Date.now() - t0) / 1000) + ' s');
	if (!ASSERT) return;
	const broken = [];
	for (const cell of cells) {
		for (const why of cell.broken) broken.push('C=' + cell.count + ' S=' + cell.seats + ' ' + why);
	}
	for (const why of broken) console.log('FAIL ' + why);
	assert.strictEqual(broken.length, 0, broken.length + ' roster contract failures');
	console.log('ROSTER CONTRACT OK');
}

function runDefault() {
	const samples = [];
	const settledCount = COUNT - GravityGame.emptyCountFor(COUNT);
	const cellCompos = settledCount < 2 * SEATS + 4;
	for (const seed of SEEDS) {
		const plan = planWorld(seed, COUNT, SEATS, false);
		const sample = checkOpening(plan.world, plan.homes, plan.ms, COUNT);
		const compos = GravityGame.startComposition(plan.world.trade.world,
			plan.world.mask, COUNT, SEATS, plan.world.sim, 'planet');
		sample.compos = compos;
		sample.composOk = !cellCompos && compos.ok;
		samples.push(sample);
		const shown = sample.game || sample.witness;
		const shownRatio = sample.game ? sample.game.ratio : sample.ratio;
		console.log('seed ' + seed + ' · HQs ' + sample.homes.join(',') +
			(shown
				? ' → ' + (sample.game ? 'chosen' : 'oracle') + ' sites ' +
					Array.from(shown.sites).join(',') +
					' · pay ' + shown.min.toFixed(2) + '…' + shown.max.toFixed(2) +
					' (weakest ' + (shownRatio * 100).toFixed(0) + '% of best' +
					(sample.game && sample.ratio > shownRatio + 0.005
						? ', oracle ' + (sample.ratio * 100).toFixed(0) + '%' : '') + ')'
				: ' → NO distinct exit-safe site for every seat') +
			(sample.built && !sample.exitable ? ' · DEAD END' : '') +
			(sample.exitable && !sample.game ? ' · NO VERIFIED GAME ASSIGNMENT' : '') +
			(!sample.composOk ? ' · compos [' + compos.missing.join(',') + ']'
				: (sample.game && !sample.fair ? ' · FAIR BAND MISSED' : '')) +
			' · ' + sample.ms + 'ms');
	}

	/* Seed 10 has no fair opening. A refused map still seats distinct HQs, and
	 * the bounded exact walk must not hold up a career for all 220 sets. */
	if (process.env.REFUSED_SEED) {
		const seed = Number(process.env.REFUSED_SEED);
		const plan = planWorld(seed, COUNT, SEATS, false);
		const sample = checkOpening(plan.world, plan.homes, plan.ms, COUNT);
		assert.ok(!sample.fair, 'seed ' + seed + ': the supposedly refused plan is fair');
		assert.ok(plan.ms < 12000, 'seed ' + seed + ': a refused walk must stop before all 220 sets (' +
			plan.ms + ' ms)');
		console.log('refused world: seed ' + seed + ' · seats ' + plan.homes.join(',') +
			' · ' + (sample.exitable ? 'best safe ratio ' + sample.ratio.toFixed(2)
				: sample.built ? 'buildable but no exit-safe assignment' : 'no distinct buildable site') +
			' · ' + plan.ms + ' ms');
	}

	/* the share is a property of the drawn field, so it reads every share seed
	 * whether or not that world seats fairly */
	let drawn = 0, blocked = 0;
	for (const seed of SHARE_SEEDS) {
		const known = samples.find(row => row.seed === seed);
		const plan = known ? null : planWorld(seed, COUNT, SEATS, true);
		const world = known ? makeWorld(seed, COUNT) : plan.world;
		const share = blockedPlanets(world, known ? known.homes : plan.homes || [], COUNT);
		drawn += share.drawn;
		blocked += share.blocked;
	}
	console.log('starter cannot leave ' + blocked + '/' + drawn + ' drawn non-HQ planets (' +
		(10 * blocked / drawn).toFixed(1) + ' of 10) over seeds ' +
		SHARE_SEEDS[0] + '-' + SHARE_SEEDS[SHARE_SEEDS.length - 1]);

	const buildable = samples.filter(row => row.built).length;
	const exitable = samples.filter(row => row.exitable).length;
	const fair = samples.filter(row => row.fair).length;
	const asserted = samples.filter(row => row.composOk);
	const assertedBuildable = asserted.filter(row => row.built).length;
	const assertedExitable = asserted.filter(row => row.exitable).length;
	const assertedFair = asserted.filter(row => row.fair).length;
	const composSkipped = samples.length - asserted.length;
	const worst = samples.reduce((low, row) => row.ratio < low ? row.ratio : low, Infinity);
	console.log('\n' + samples.length + ' seeds · every seat buildable ' + buildable + '/' + samples.length +
		' · every site exitable ' + exitable + '/' + samples.length +
		' · within ' + FAIR_RATIO + ' band ' + fair + '/' + samples.length +
		(composSkipped ? ' (compos ' + assertedFair + '/' + asserted.length +
			', skipped ' + composSkipped + ')' : '') +
		' · weakest ' + (Number.isFinite(worst) ? (worst * 100).toFixed(0) + '%' : '-'));

	assert.strictEqual(assertedBuildable, asserted.length,
		'every composition-valid planned map must give each company its own buildable site');
	assert.strictEqual(assertedExitable, asserted.length,
		'every composition-valid planned first landing must be able to launch again');
	assert.strictEqual(assertedFair, asserted.length,
		'every composition-valid planned map must keep the weakest opening within the fair band');
	assert.ok(blocked >= SHARE_MIN * drawn && blocked <= SHARE_MAX * drawn,
		'between 2 and 4 of every 10 drawn planets must hold the starter rail (' +
		(10 * blocked / drawn).toFixed(1) + ' of 10)');
}

checkMatcherFixtures();
if (MATRIX) runMatrix();
else runDefault();
