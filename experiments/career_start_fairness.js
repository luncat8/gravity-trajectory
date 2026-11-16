/*
 * Career map fairness: the planned HQs must admit a distinct, buildable,
 * exit-safe first landing for every company, with comparable positive pay.
 * Rows come from the final HQ-pinned field. An independent profit-window
 * matcher checks the seats; it must not maximize only the weakest payout,
 * because an unnecessarily rich winner can make a fair map look unfair.
 *
 * Run: node experiments/career_start_fairness.js (SEEDS=1-8 COUNT=13 SEATS=3)
 */
'use strict';

const assert = require('assert');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');
const GravityGame = require('../gravity_game.js');

const P = OrbitWorld.PLANETS;

function parseRange(value) {
	const parts = String(value).split('-').map(Number);
	const from = parts[0];
	const to = parts.length > 1 ? parts[1] : from;
	const out = [];
	for (let seed = from; seed <= to; seed++) out.push(seed);
	return out;
}

const SEEDS = parseRange(process.env.SEEDS || '1-8');
const COUNT = Number(process.env.COUNT || 13);
const SEATS = Number(process.env.SEATS || 3);
const FAIR_RATIO = Number(process.env.RATIO || 0.55);

function makeWorld(seed) {
	const mask = new Uint8Array(P);
	mask.fill(1, 0, COUNT);
	const trade = new OrbitSim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(P, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	return { seed, mask, trade, sim, galaxy };
}

function freeSites(mask, homes) {
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const sites = [];
	for (let site = 0; site < P; site++) {
		if (mask[site] && !occupied[site]) sites.push(site);
	}
	return sites;
}

function buildableSite(world, site) {
	if (GravityGame.specialPlanets() && site === world.trade.world.capitalPlanet) return false;
	const strength = GravityGame.specialPlanets() && site === world.trade.world.arfPlanet
		? 1 : GravityGame.planetGravity(world.seed, site);
	return strength <= 1.5;
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
		assert.ok(buildableSite(world, site),
			'seed ' + world.seed + ': first pad is too heavy or is the Capital');
	}
	const actual = describe(rows, homes, sites);
	assert.ok(Math.abs(actual.min - stats.minPay) < 1e-8 &&
		Math.abs(actual.max - stats.maxPay) < 1e-8 &&
		Math.abs(actual.sum - stats.sumPay) < 1e-8,
		'seed ' + world.seed + ': game score differs from its traced sites');
	return actual;
}

function planWorld(seed) {
	const world = makeWorld(seed);
	const started = Date.now();
	const homes = GravityGame.prepareCareerStarts(world.galaxy, world.trade.world,
		world.trade, world.mask, COUNT, SEATS, world.sim);
	const ms = Date.now() - started;
	assert.ok(homes && homes.length === SEATS, 'seed ' + seed + ': no planned seats');
	assert.strictEqual(new Set(homes).size, SEATS, 'seed ' + seed + ': duplicate HQ');
	return { world, homes, ms };
}

function checkOpening(world, homes, ms) {
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const rows = GravityGame.careerOpenings(world.trade.world, world.trade,
		world.mask, COUNT, occupied, world.sim);
	const sites = freeSites(world.mask, homes);
	/* targetPay is every reachable non-HQ site; sitePay has already filtered out
	 * heavy/Capital sites and landings from which an EMC-1 cannot leave. Use
	 * the former for buildability so a dead end does not masquerade as a shortage. */
	const buildable = sites.filter(site => buildableSite(world, site));
	const built = matchSites({ sitePay: rows.targetPay }, homes, buildable,
		-Infinity, Infinity, false) !== null;
	const safe = matchSites(rows, homes, sites, -Infinity, Infinity, true);
	const best = safe ? bestRatioAssignment(rows, homes, sites) : null;
	const witness = best || (safe ? describe(rows, homes, safe) : null);
	const ratio = best ? best.ratio : 0;
	const exact = GravityGame.openingGroupStats(world.trade.world, world.trade,
		world.mask, COUNT, occupied, homes, world.sim);
	const game = checkGameWitness(world, homes, rows, exact);
	if (game) {
		assert.ok(ratio + 1e-9 >= game.ratio,
			'seed ' + world.seed + ': independent best band missed the game assignment');
	}
	const exitable = safe !== null;
	const fair = exitable && ratio >= FAIR_RATIO && exact.distinct && exact.exitOk &&
		exact.missing === 0 && game && game.ratio >= FAIR_RATIO;
	return { seed: world.seed, homes, witness, ratio, game, built, exitable, fair: !!fair, ms };
}

checkMatcherFixtures();
const samples = [];
for (const seed of SEEDS) {
	const plan = planWorld(seed);
	const sample = checkOpening(plan.world, plan.homes, plan.ms);
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
		(sample.game && !sample.fair ? ' · FAIR BAND MISSED' : '') +
		' · ' + sample.ms + 'ms');
}

/* Seed 10 has no fair opening. A refused map still seats distinct HQs, and
 * the bounded exact walk must not hold up a career for all 220 sets. */
if (process.env.REFUSED_SEED) {
	const seed = Number(process.env.REFUSED_SEED);
	const plan = planWorld(seed);
	const sample = checkOpening(plan.world, plan.homes, plan.ms);
	assert.ok(!sample.fair, 'seed ' + seed + ': the supposedly refused plan is fair');
	assert.ok(plan.ms < 12000, 'seed ' + seed + ': a refused walk must stop before all 220 sets (' +
		plan.ms + ' ms)');
	console.log('refused world: seed ' + seed + ' · seats ' + plan.homes.join(',') +
		' · ' + (sample.exitable ? 'best safe ratio ' + sample.ratio.toFixed(2)
			: sample.built ? 'buildable but no exit-safe assignment' : 'no distinct buildable site') +
		' · ' + plan.ms + ' ms');
}

const buildable = samples.filter(row => row.built).length;
const exitable = samples.filter(row => row.exitable).length;
const fair = samples.filter(row => row.fair).length;
const worst = samples.reduce((low, row) => row.ratio < low ? row.ratio : low, Infinity);
console.log('\n' + samples.length + ' seeds · every seat buildable ' + buildable + '/' + samples.length +
	' · every site exitable ' + exitable + '/' + samples.length +
	' · within ' + FAIR_RATIO + ' band ' + fair + '/' + samples.length +
	' · weakest ' + (Number.isFinite(worst) ? (worst * 100).toFixed(0) + '%' : '-'));

assert.strictEqual(buildable, samples.length,
	'every planned map must give each company its own buildable site');
assert.strictEqual(exitable, samples.length,
	'every planned first landing must be able to launch again');
assert.strictEqual(fair, samples.length,
	'every planned map must keep the weakest opening within the fair band');
