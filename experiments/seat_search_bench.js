/*
 * Worst atomic seat-search unit cost (0.7.47 WS4 responsiveness).
 *
 * `createSeatSearch.step(eps)` runs exactly one atomic walk unit per call
 * (the clock check sits after the unit), so timing each call times that unit.
 * Fixtures span the walk shapes: floor+wide, wide-only, roomy worlds, a
 * cramped roster, and the background tiers behind `advanceTier`. The report
 * prints per-band worsts against the page's CAREER_SEARCH_FRAME_MS slice.
 *
 * Run: node experiments/seat_search_bench.js            (asserts 30 ms)
 *      BUDGET_MS=0 node experiments/seat_search_bench.js (report only)
 *      BUDGET_MS=8 node experiments/seat_search_bench.js (assert p-slice)
 */
'use strict';

const assert = require('assert');
const Trade = require('../orbit_sim.js');
const Sim = require('../gravity_sim.js');
const Game = require('../gravity_game.js');

/* mirrors CAREER_SEARCH_FRAME_MS in gui_game.js */
const FRAME_MS = 8;
/* Default assert: no unit regresses into the old 100 ms+ class (the cap is
 * 30 ms because the pinned family sort drifts 16-25 ms with GC). The page's
 * frame slice stays 8 ms (p99 is ≤ 6 ms); the honest tail above it is
 * structural — one first-install raster fill per walk (~10-12 ms, paid once
 * during the sync phase), one whole-array family sort at diversify on
 * 18k-set walks (pinned order: chunk-merge sorting moved saved maps), and
 * rare full-horizon trajectory bursts (~1 trajectory per overshoot). */
const BUDGET_MS = Number(process.env.BUDGET_MS || 30);
const EPS = 1e-6;

function makeFixture(seed, count, seats) {
	const trade = new Trade(seed);
	trade.advanceTo(420);
	const sim = new Sim(Trade.WORLD_W, Trade.WORLD_H);
	sim.setPlanets(Trade.PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const mask = new Uint8Array(Trade.PLANETS);
	mask.fill(1, 0, count);
	sim.setPlanetMask(mask);
	return { trade, sim, mask, count, seats };
}

/* search-level progress → the walk band it belongs to; a jump across bands
 * inside one unit is itself information (set construction runs inside the
 * unit that leaves the light/cold band). Walk count mirrors startTier(). */
function bandOf(progress, walks) {
	const walkIdx = Math.min(walks - 1, Math.floor(progress * walks));
	const local = progress * walks - walkIdx;
	if (walks > 1 && progress >= 1) return 'tier done';
	if (local >= 1) return 'walk done';
	if (local <= 0.05) return 'light probes';
	if (local <= 0.15) return 'cold homes / set build';
	if (local <= 0.30) return 'pair traces / cold rows';
	if (local <= 0.35) return 'rank sets';
	if (local < 0.95) return 'exact proposals';
	if (local < 1) return 'repair / finalize';
	return 'walk end';
}

function quantile(sorted, q) {
	if (!sorted.length) return 0;
	const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
	return sorted[i];
}

function runTier(search, walks, label, samples) {
	let guard = 0;
	for (;;) {
		const before = search.step(0).progress;
		const t0 = performance.now();
		const out = search.step(EPS);
		const ms = performance.now() - t0;
		const walkIdx = Math.min(walks - 1, Math.floor(before * walks));
		const unit = {
			ms: ms,
			tier: label,
			from: before,
			to: out.progress,
			band: bandOf(before, walks),
			walk: walkIdx,
			jump: bandOf(before, walks) !== bandOf(out.progress, walks)
		};
		samples.push(unit);
		if (out.done) break;
		if (++guard > 500000) throw new Error('unit guard exceeded (' + label + ')');
	}
}

function reportFixture(name, seed, count, seats, tiers) {
	const fixture = makeFixture(seed, count, seats);
	const tSetup = performance.now();
	const search = Game.createSeatSearch(fixture.trade.world, fixture.trade,
		fixture.mask, count, seats, fixture.sim);
	const setupMs = performance.now() - tSetup;
	/* floor walk only for ≤4 companies on ≤26 worlds, mirroring startTier */
	const walks = seats <= 4 && count <= 26 ? 2 : 1;
	const samples = [];
	const t0 = performance.now();
	runTier(search, walks, 'tier0', samples);
	for (let tier = 1; tier < tiers; tier++) {
		if (!search.advanceTier()) break;
		runTier(search, walks, 'tier' + tier, samples);
	}
	const stepMs = performance.now() - t0;

	const times = samples.map(u => u.ms).sort((a, b) => a - b);
	const worst = samples.reduce((a, b) => (b.ms > a.ms ? b : a), samples[0]);
	const over8 = samples.filter(u => u.ms > FRAME_MS);
	const over4 = samples.filter(u => u.ms > FRAME_MS / 2);

	/* report-poll cost: what H pays per render */
	const pollT0 = performance.now();
	for (let i = 0; i < 200; i++) search.step(0);
	const pollUs = (performance.now() - pollT0) / 200 * 1000;

	console.log('\n' + name + '  (' + count + '/' + seats + ', seed ' + seed +
		(tiers > 1 ? ', ' + tiers + ' tiers' : '') + ')');
	console.log('  setup ' + setupMs.toFixed(2) + ' ms · ' + samples.length +
		' units · stepped ' + stepMs.toFixed(1) + ' ms · poll ' + pollUs.toFixed(1) + ' µs');
	console.log('  unit p50 ' + quantile(times, 0.5).toFixed(3) + ' ms · p99 ' +
		quantile(times, 0.99).toFixed(3) + ' ms · max ' + worst.ms.toFixed(3) +
		' ms · >' + FRAME_MS + ' ms: ' + over8.length + ' · >' + FRAME_MS / 2 +
		' ms: ' + over4.length);
	console.log('  worst: [' + worst.tier + '/' + worst.band + ' walk ' + worst.walk +
		'] ' + worst.ms.toFixed(3) + ' ms · progress ' +
		worst.from.toFixed(4) + ' → ' + worst.to.toFixed(4) +
		(worst.jump ? ' (crosses bands: set build runs inside this unit)' : ''));

	const bands = new Map();
	for (const u of samples) {
		const key = u.tier + '/' + u.band;
		const b = bands.get(key) || { n: 0, max: 0, sum: 0 };
		b.n += 1;
		b.sum += u.ms;
		if (u.ms > b.max) b.max = u.ms;
		bands.set(key, b);
	}
	const rows = [...bands.entries()].sort((a, b) => b[1].max - a[1].max);
	for (const [key, b] of rows.slice(0, 6)) {
		console.log('    ' + key.padEnd(34) + ' n=' + String(b.n).padStart(5) +
			' max ' + b.max.toFixed(3).padStart(8) + ' ms · mean ' +
			(b.sum / b.n).toFixed(3).padStart(7) + ' ms');
	}
	return { name, worst: worst.ms, over8: over8.length, units: samples.length };
}

const results = [];
results.push(reportFixture('ordinary career', 1, 13, 3, 1));
results.push(reportFixture('slow plan seed', 7, 13, 3, 3));
results.push(reportFixture('four seats floor+wide', 42, 13, 4, 1));
results.push(reportFixture('six seats wide only', 1, 13, 6, 1));
results.push(reportFixture('roomy world', 1, 20, 6, 1));
results.push(reportFixture('big world', 1, 48, 6, 1));
results.push(reportFixture('cramped roster', 1, 8, 6, 1));

const globalWorst = results.reduce((a, b) => (b.worst > a.worst ? b : a));
console.log('\nglobal worst unit ' + globalWorst.worst.toFixed(3) + ' ms (' +
	globalWorst.name + ') · ' + FRAME_MS + ' ms frame slice · units over slice: ' +
	results.reduce((s, r) => s + r.over8, 0));

if (BUDGET_MS > 0) {
	for (const r of results) {
		assert.ok(r.worst <= BUDGET_MS,
			r.name + ': worst unit ' + r.worst.toFixed(3) + ' ms > budget ' + BUDGET_MS + ' ms');
	}
	console.log('SEAT SEARCH BENCH OK · worst unit within ' + BUDGET_MS + ' ms');
} else {
	console.log('SEAT SEARCH BENCH · report only (set BUDGET_MS to assert)');
}
