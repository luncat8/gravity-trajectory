/*
 * Career map fairness: every planned company needs its OWN free planet to land
 * on and build its first EMC, at a comparable profit, with a way back off it.
 *
 * The old generator scored each seat by its private best site, so three
 * companies could all "expect" the same planet — a map that looked even on
 * paper and was not in play. This checks the property directly: the planned
 * seats must admit a distinct-site assignment where every seat is buildable,
 * exitable, and within a fair profit band of the others.
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
/* the worst company may earn at most this share of the best company's opening */
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

/*
 * Independent check with the same algorithm the generator uses, so a
 * regression in `seatAssignment` shows up as a failing seed rather than as a
 * silently different score.
 */
function assignDistinct(rows, homes, mask) {
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const sites = [];
	for (let b = 0; b < P; b++) if (mask[b] && !occupied[b]) sites.push(b);
	const n = homes.length;
	const seatOfSite = new Int32Array(P).fill(-1);
	const siteOfSeat = new Int16Array(n).fill(-1);
	const seen = new Uint8Array(P);
	function augment(seat, floor) {
		const row = homes[seat] * P;
		for (const site of sites) {
			if (seen[site]) continue;
			const pay = rows.sitePay[row + site];
			if (!Number.isFinite(pay) || pay < floor) continue;
			seen[site] = 1;
			const holder = seatOfSite[site];
			if (holder < 0 || augment(holder, floor)) {
				seatOfSite[site] = seat;
				siteOfSeat[seat] = site;
				return true;
			}
		}
		return false;
	}
	function match(floor) {
		siteOfSeat.fill(-1);
		seatOfSite.fill(-1);
		for (let seat = 0; seat < n; seat++) {
			seen.fill(0);
			if (!augment(seat, floor)) return null;
		}
		return siteOfSeat.slice();
	}
	const any = match(-Infinity);
	if (!any) return null;
	const values = [];
	for (let seat = 0; seat < n; seat++) {
		for (const site of sites) {
			const pay = rows.sitePay[homes[seat] * P + site];
			if (Number.isFinite(pay)) values.push(pay);
		}
	}
	values.sort((a, b) => a - b);
	let low = 0;
	let high = values.length - 1;
	let best = any;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const found = match(values[mid]);
		if (found) {
			best = found;
			low = mid + 1;
		} else high = mid - 1;
	}
	const pays = [];
	for (let seat = 0; seat < n; seat++) pays.push(rows.sitePay[homes[seat] * P + best[seat]]);
	return {
		sites: best,
		min: Math.min(...pays),
		max: Math.max(...pays)
	};
}

const rows = [];
let failed = 0;
for (const seed of SEEDS) {
	const world = makeWorld(seed);
	const started = Date.now();
	const homes = GravityGame.prepareCareerStarts(world.galaxy, world.trade.world,
		world.trade, world.mask, COUNT, SEATS, world.sim);
	const ms = Date.now() - started;
	assert.ok(homes && homes.length === SEATS, 'seed ' + seed + ': no planned seats');
	assert.strictEqual(new Set(homes).size, SEATS, 'seed ' + seed + ': duplicate HQ');

	/* every seat is pinned to G = 1 in the final field, exactly as startCareer does */
	const occupied = new Uint8Array(P);
	for (const home of homes) occupied[home] = 1;
	const openings = GravityGame.careerOpenings(world.trade.world, world.trade,
		world.mask, COUNT, occupied, world.sim);
	const assignment = assignDistinct(openings, homes, world.mask);
	const built = assignment !== null;
	let exitable = false;
	if (built) {
		exitable = true;
		for (let seat = 0; seat < SEATS; seat++) {
			const site = assignment.sites[seat];
			if (site < 0 || openings.exitOk[homes[seat] * P + site] !== 1) exitable = false;
		}
	}
	const ratio = built && assignment.max > 0 ? assignment.min / assignment.max : 0;
	const fair = built && ratio >= FAIR_RATIO;
	if (!built || !exitable || !fair) failed += 1;
	rows.push({
		seed,
		homes: homes.join(','),
		sites: built ? Array.from(assignment.sites).join(',') : '-',
		min: built ? assignment.min : NaN,
		max: built ? assignment.max : NaN,
		ratio,
		built,
		exitable,
		fair,
		ms
	});
	console.log('seed ' + seed + ' · HQs ' + homes.join(',') +
		(built
			? ' → sites ' + Array.from(assignment.sites).join(',') +
				' · pay ' + assignment.min.toFixed(2) + '…' + assignment.max.toFixed(2) +
				' (weakest ' + (ratio * 100).toFixed(0) + '% of best)'
			: ' → NO distinct buildable site for every seat') +
		(exitable ? '' : ' · DEAD END') + ' · ' + ms + 'ms');
}

const buildable = rows.filter(row => row.built).length;
const exitable = rows.filter(row => row.exitable).length;
const fair = rows.filter(row => row.fair).length;
const worst = rows.reduce((low, row) => (Number.isFinite(row.ratio) && row.ratio < low ? row.ratio : low), Infinity);
console.log('\n' + rows.length + ' seeds · every seat buildable ' + buildable + '/' + rows.length +
	' · every site exitable ' + exitable + '/' + rows.length +
	' · within ' + FAIR_RATIO + ' band ' + fair + '/' + rows.length +
	' · weakest ' + (Number.isFinite(worst) ? (worst * 100).toFixed(0) + '%' : '-'));

assert.strictEqual(buildable, rows.length,
	'every planned map must give each company its own buildable site');
assert.strictEqual(exitable, rows.length,
	'every planned first landing must be able to launch again');
assert.strictEqual(fair, rows.length,
	'every planned map must keep the weakest opening within the fair band');
if (failed > 0) process.exitCode = 1;
