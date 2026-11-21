/*
 * The exact stay-pay trace price (0.7.39-plan-harvest-ticks.md): estimateProfit
 * and estimateProfitLog match a live harvest to 1e-12 under HARVEST_ENTRY and
 * HARVEST_TICK — spawn lumps, Capital/A.R.F., rebels, quiet worlds and a
 * mid-dwell reportUntil — the launch book re-prices its dwell trail and
 * round-trips the bookTrace tuple and a run record, a stay drip never bumps
 * market.stamp, and routeStep / stepHarvest keep the heap flat.
 * Run: node experiments/harvest_ticks_test.js
 */
'use strict';

/* the heap checks sample retained memory after a forced collection; without
 * one V8's own timing decides the verdict, so re-run with --expose-gc */
if (!global.gc) {
	const child = require('child_process').spawnSync(process.execPath,
		['--expose-gc', __filename], { stdio: 'inherit' });
	process.exit(child.status === null ? 1 : child.status);
}

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const { loadPage, mapSearch } = require('./dom_stub.js');

const PLANETS = Sim.PLANETS;
const DT = GravitySim.DT;
const STATUS_FLYING = GravitySim.STATUS_FLYING;
const RUN_STEP = 360;
const HORIZON = 45;

let checks = 0;
function check(ok, message) {
	checks += 1;
	assert.ok(ok, message);
}

/* --- a static world: a live harvest and its priced prediction differ only
 * by the rule the market is set to ------------------------------------- */

function buildStaticWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(Sim.WORLD_W, Sim.WORLD_H);
	const strength = new Float64Array(PLANETS).fill(1);
	const fillPlanets = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	};
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setField(PLANETS, trade.planetR, strength, fillPlanets, true);
	return sim;
}

const worldSim = buildStaticWorld(31);
const baseMarket = GravityGame.createMarket();
for (let p = 0; p < PLANETS; p++) baseMarket.lastVisitStep[p] = -p * 400;
/* planet 13 rebels with a fly-by ramp the pricing must follow step by step */
baseMarket.lastVisitStep[13] = RUN_STEP - 120;

function fillMarket(decors) {
	const market = GravityGame.createMarket();
	market.lastVisitStep.set(baseMarket.lastVisitStep);
	if (decors) {
		market.capitalPlanet = 4;
		market.arfPlanet = 9;
		market.rebel[13] = 1;
		market.rebelSinceStep[13] = 100;
		market.quiet[7] = 1;
	}
	return market;
}

/* one live flight plus its finished trace, priced both ways */
function flight(mode, origin, angle, speed, decors, cut) {
	const market = fillMarket(decors);
	const ledger = GravityGame.createLedger();
	worldSim.clear();
	worldSim.stepLimit = Math.round(HORIZON / DT);
	worldSim.limitReason = GravitySim.END_TIME;
	worldSim.launch(origin, angle, speed);
	GravityGame.beginFlight(ledger, worldSim);
	GravityGame.setHarvestMode(mode);
	let step = RUN_STEP;
	while (worldSim.status === STATUS_FLYING) {
		step += 1;
		worldSim.stepOne();
		if (cut !== undefined && step - RUN_STEP >= cut) ledger.reports = false;
		GravityGame.stepHarvest(ledger, market, worldSim, step);
	}
	const earned = GravityGame.endFlight(ledger);

	worldSim.clear();
	worldSim.predictFast(origin, angle, speed, HORIZON);
	const est = GravityGame.estimateProfit(fillMarket(decors), RUN_STEP, worldSim,
		undefined, cut);
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	return { est: est, earned: earned, logCount: worldSim.predLogCount };
}

/* --- 1. |estimateProfit − stepHarvest| < 1e-12, both rules -------------- */

const origins = [0, 2, 4, 7, 9, 13, 17];
const cases = [
	{ name: 'plain', decors: false },
	{ name: 'specials', decors: true },
	{ name: 'device wears at 40', decors: false, cut: 40 },
	{ name: 'device wears mid-dwell', decors: true, cut: 3 }
];
const worst = [0, 0];
let dwellWins = 0;
for (const c of cases) {
	for (let m = 0; m < 2; m++) {
		const mode = m === 0 ? GravityGame.HARVEST_ENTRY : GravityGame.HARVEST_TICK;
		for (const origin of origins) {
			for (let a = 0; a < 8; a++) {
				const angle = (a + 0.42) / 8 * Math.PI * 2;
				const speed = 110 + (a % 4) * 45;
				const out = flight(mode, origin, angle, speed, c.decors, c.cut);
				check(Number.isFinite(out.est) && Number.isFinite(out.earned),
					c.name + ': non-finite price');
				const diff = Math.abs(out.est - out.earned);
				if (diff > worst[m]) worst[m] = diff;
			}
		}
	}
}
check(worst[0] < 1e-12, 'entry rule drifted ' + worst[0]);
check(worst[1] < 1e-12, 'tick rule drifted ' + worst[1]);
console.log('1. parity both rules: ' + (origins.length * 8 * cases.length) + ' flights per rule · entry ' +
	worst[0].toExponential(2) + ' · tick ' + worst[1].toExponential(2));

/* the tick rule must actually pay more than the entry rule somewhere, or the
 * sweep above would prove nothing about dwells */
GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
for (const origin of [0, 4, 13, 17]) {
	const e = flight(GravityGame.HARVEST_ENTRY, origin, 1.7, 155, false);
	const t = flight(GravityGame.HARVEST_TICK, origin, 1.7, 155, false);
	if (t.earned > e.earned + 1e-9) dwellWins += 1;
}
check(dwellWins > 0, 'no flight earned more under the stay-pay rule');
console.log('   stay-pay earned more on ' + dwellWins + '/4 probe flights');

/* --- 2. dwell structure: spawn rows, impact rows, non-negative dwell --- */

{
	const sim = worldSim;
	sim.clear();
	sim.predictFast(4, 2.2, 140, HORIZON);
	check(sim.predLogCount >= 1, 'a launch from the pad always opens a row');
	check(sim.predLogStep[0] === 0, 'the first rows are the spawn-inside systems');
	for (let i = 0; i < sim.predLogCount; i++) {
		check(sim.predLogDwell[i] >= 0, 'negative dwell at row ' + i);
		if (i > 0) check(sim.predLogStep[i] >= sim.predLogStep[i - 1], 'rows out of time order');
	}
	/* every impact logs the system it struck: the entry row when the port
	 * ellipse caught the ship first, the step-s row when the surface disc
	 * reaches past the ellipse */
	let impacts = 0;
	let misses = 0;
	for (let o = 0; o < 26 && impacts < 64; o += 2) {
		for (let a = 0; a < 16; a++) {
			sim.clear();
			sim.predictFast(o, (a + 0.31) / 16 * Math.PI * 2, 110 + (a % 4) * 45, HORIZON);
			if (sim.predReason !== GravitySim.END_IMPACT) continue;
			impacts += 1;
			let hit = false;
			for (let i = 0; i < sim.predLogCount; i++) {
				if (sim.predLogPlanet[i] === sim.predBody) hit = true;
			}
			if (!hit) misses += 1;
		}
	}
	check(impacts > 0 && misses === 0, misses + '/' + impacts + ' impacts lost their system row');
	console.log('2. structure: spawn row + ordered dwells · ' + impacts +
		' impacts all logged their system');
}

/* --- 3. pricing contracts: specials, gates, dwells, landing ------------ */

{
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	const market = fillMarket(true);
	const ledger = GravityGame.createLedger();
	const capital = 4;
	const arf = 9;
	const quiet = 7;
	const normal = 5;
	const dwells = new Int32Array([500]);
	const planets = new Int32Array([1]);
	const steps = new Int32Array([0]);
	planets[0] = capital;
	check(GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		undefined, undefined, dwells) === 0, 'a spawn-inside Capital pays nothing');
	planets[0] = arf;
	check(GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		undefined, undefined, dwells) === 0, 'a spawn-inside A.R.F. pays nothing');
	planets[0] = quiet;
	check(GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		undefined, undefined, dwells) === 0, 'a quiet spawn-inside pays nothing');

	/* a normal spawn row pays steps 1..dwell from the stored value, exactly
	 * as harvestStay would, stamping the walk in between */
	planets[0] = normal;
	steps[0] = 0;
	const dwell = 40;
	dwells[0] = dwell;
	let stamp = market.lastVisitStep[normal];
	let expected = 0;
	for (let s = 1; s <= dwell; s++) {
		const at = RUN_STEP + s;
		expected += GravityGame.planetProfitAt(market, normal, at, stamp);
		stamp = at;
	}
	const got = GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		undefined, undefined, dwells);
	check(Math.abs(got - expected) < 1e-12, 'spawn lump + drips: ' + got + ' vs ' + expected);

	/* the entry + drip window, cut mid-dwell by reportUntil */
	steps[0] = 10;
	dwells[0] = 30;
	const until = 15;
	stamp = market.lastVisitStep[normal];
	expected = GravityGame.planetProfitAt(market, normal, RUN_STEP + 10, stamp);
	stamp = RUN_STEP + 10;
	for (let s = 11; s < until; s++) {
		expected += GravityGame.planetProfitAt(market, normal, RUN_STEP + s, stamp);
		stamp = RUN_STEP + s;
	}
	const cutPrice = GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		until, undefined, dwells);
	check(Math.abs(cutPrice - expected) < 1e-12, 'mid-dwell wear-out: ' + cutPrice + ' vs ' + expected);

	/* dwells only bite under the tick rule; the entry rule and a missing
	 * dwell trail price the same entry-only sum */
	const entryPlanets = new Int32Array([normal]);
	const entrySteps = new Int32Array([10]);
	const entryDwells = new Int32Array([30]);
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	const entryOnly = GravityGame.estimateProfitLog(market, RUN_STEP, entryPlanets, entrySteps,
		1, ledger, undefined, undefined, entryDwells);
	check(entryOnly === GravityGame.estimateProfitLog(market, RUN_STEP, entryPlanets, entrySteps,
		1, ledger, undefined, undefined), 'the entry rule must ignore dwell trails');
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	check(GravityGame.estimateProfitLog(market, RUN_STEP, entryPlanets, entrySteps, 1, ledger,
		undefined, undefined) === entryOnly, 'a missing dwell trail prices the entry only');
	const tickPrice = GravityGame.estimateProfitLog(market, RUN_STEP, entryPlanets, entrySteps,
		1, ledger, undefined, undefined, entryDwells);
	check(tickPrice > entryOnly, 'the tick rule must add the drip steps');

	/* landing.value: an entry row still feeds the bribe landing when the
	 * device is already out; a spawn-inside row never does */
	const landing = { body: normal, value: -1 };
	GravityGame.estimateProfitLog(market, RUN_STEP, entryPlanets, entrySteps, 1, ledger,
		until - 5, landing, entryDwells);
	check(landing.value > 0, 'an unreported arrival still lands its value');
	const spawnLanding = { body: normal, value: -1 };
	steps[0] = 0;
	dwells[0] = 40;
	GravityGame.estimateProfitLog(market, RUN_STEP, planets, steps, 1, ledger,
		undefined, spawnLanding, dwells);
	check(spawnLanding.value === -1, 'a spawn-inside row never feeds the bribe landing');
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	console.log('3. contracts: spawn lump, specials, quiet, mid-dwell cut, entry-only fallback');
}

/* --- 4. the launch book re-prices its dwell trail ---------------------- */

{
	const sim = worldSim;
	const ledger = GravityGame.createLedger();
	const career = GravityGame.createCareer(ledger);
	const book = career.launchBook;
	sim.clear();
	sim.predictFast(4, 1.1, 130, HORIZON);
	const trace = {
		origin: 4, angleU: GravityGame.angleUnits(1.1), speedU: GravityGame.speedUnits(130),
		body: sim.predBody, steps: sim.predSteps, time: sim.predTime, length: sim.predLength,
		score: 0, money: 0, logPlanet: sim.predLogPlanet, logStep: sim.predLogStep,
		logDwell: sim.predLogDwell, logCount: sim.predLogCount
	};
	const entry = GravityGame.recordLaunch(book, 0, trace);
	check(entry.logDwell instanceof Int32Array, 'a book entry owns its dwell trail');
	check(entry.logCount === sim.predLogCount, 'the book keeps every traced row');
	for (let i = 0; i < entry.logCount; i++) {
		check(entry.logDwell[i] === sim.predLogDwell[i], 'dwell ' + i + ' did not travel');
	}
	for (let m = 0; m < 2; m++) {
		const mode = m === 0 ? GravityGame.HARVEST_ENTRY : GravityGame.HARVEST_TICK;
		GravityGame.setHarvestMode(mode);
		const fresh = GravityGame.estimateProfit(fillMarket(false), RUN_STEP, sim, ledger);
		const stored = GravityGame.estimateProfitLog(fillMarket(false), RUN_STEP,
			entry.logPlanet, entry.logStep, entry.logCount, ledger, undefined, undefined,
			entry.logDwell);
		check(Math.abs(fresh - stored) < 1e-12,
			'mode ' + mode + ': stored entry ' + stored + ' vs fresh trace ' + fresh);
	}
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	/* a trace without a dwell trail (older callers) stores zeroes and prices
	 * the entry only */
	const bare = GravityGame.recordLaunch(book, 1, {
		origin: 4, angleU: GravityGame.angleUnits(2.2), speedU: GravityGame.speedUnits(130),
		body: sim.predBody, steps: sim.predSteps, time: sim.predTime, length: sim.predLength,
		score: 0, money: 0, logPlanet: sim.predLogPlanet, logStep: sim.predLogStep,
		logCount: sim.predLogCount
	});
	check(bare.logDwell instanceof Int32Array, 'a bare trace still allocates the trail');
	for (let i = 0; i < bare.logCount; i++) check(bare.logDwell[i] === 0, 'bare dwell ' + i);
	console.log('4. book re-price both rules: stored entry === fresh trace');
}

/* --- 5. a stay drip never bumps market.stamp --------------------------- */

{
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	const market = fillMarket(false);
	const ledger = GravityGame.createLedger();
	const sim = worldSim;
	sim.clear();
	sim.stepLimit = Math.round(HORIZON / DT);
	sim.limitReason = GravitySim.END_TIME;
	sim.launch(4, 2.7, 150);
	GravityGame.beginFlight(ledger, sim);
	const insideBefore = new Uint8Array(PLANETS);
	let step = RUN_STEP;
	let dripSteps = 0;
	let entrySteps = 0;
	while (sim.status === STATUS_FLYING) {
		step += 1;
		sim.stepOne();
		insideBefore.set(ledger.inside);
		const stampBefore = market.stamp;
		const gainBefore = ledger.shotGain;
		GravityGame.stepHarvest(ledger, market, sim, step);
		let flipped = false;
		for (let p = 0; p < PLANETS; p++) {
			if (insideBefore[p] !== ledger.inside[p]) flipped = true;
		}
		if (flipped) entrySteps += 1;
		else {
			check(market.stamp === stampBefore, 'a drip step bumped market.stamp at ' + step);
			if (ledger.shotGain > gainBefore + 1e-12) dripSteps += 1;
		}
	}
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	check(entrySteps > 0, 'the stamp probe flight never entered a system');
	check(dripSteps > 0, 'the stamp probe flight never stayed long enough to drip');
	console.log('5. stamp: ' + entrySteps + ' entry steps, ' + dripSteps +
		' drip steps, market.stamp untouched by drips');
}

/* --- 6. zero heap allocations in routeStep and stepHarvest ------------- */

{
	const sim = worldSim;
	const refs = [sim.probe, sim.predLogPlanet, sim.predLogStep, sim.predLogDwell,
		sim.predLogOpen, sim.predVisit, sim.predEntered, sim.predInside, sim.predX, sim.predY];
	sim.clear();
	sim.predictFast(4, 1.9, 160, HORIZON); /* warm the JIT on the same path */
	let stable = true;
	global.gc();
	const before = process.memoryUsage().heapUsed;
	for (let i = 0; i < 20; i++) {
		sim.clear();
		sim.predictFast(4, 1.9, 160, HORIZON);
		if (sim.probe !== refs[0] || sim.predLogPlanet !== refs[1] || sim.predLogStep !== refs[2] ||
			sim.predLogDwell !== refs[3] || sim.predLogOpen !== refs[4] || sim.predVisit !== refs[5] ||
			sim.predEntered !== refs[6] || sim.predInside !== refs[7] || sim.predX !== refs[8] ||
			sim.predY !== refs[9]) stable = false;
	}
	global.gc();
	const routeGrown = process.memoryUsage().heapUsed - before;
	check(stable, 'a route trace replaced one of its buffers');
	check(routeGrown < 128 * 1024, 'routeStep retained ' + routeGrown + ' bytes over 20 traces');

	const market = fillMarket(false);
	const ledger = GravityGame.createLedger();
	sim.clear();
	sim.stepLimit = Math.round(HORIZON / DT);
	sim.limitReason = GravitySim.END_TIME;
	sim.launch(4, 1.9, 160);
	GravityGame.beginFlight(ledger, sim);
	const warmMarket = fillMarket(false);
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	let warm = 0;
	while (sim.status === STATUS_FLYING && warm < 10000) { /* warm-up flight */
		warm += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger, warmMarket, sim, RUN_STEP + warm);
	}
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	/* the sampled region holds only stepOne + stepHarvest, the plan's pair */
	const market2 = fillMarket(false);
	const ledger2 = GravityGame.createLedger();
	sim.clear();
	sim.stepLimit = Math.round(HORIZON / DT);
	sim.limitReason = GravitySim.END_TIME;
	sim.launch(4, 1.9, 160);
	GravityGame.beginFlight(ledger2, sim);
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	global.gc();
	const beforeSteps = process.memoryUsage().heapUsed;
	let step = RUN_STEP;
	while (sim.status === STATUS_FLYING) {
		step += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger2, market2, sim, step);
	}
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	global.gc();
	const stepGrown = process.memoryUsage().heapUsed - beforeSteps;
	console.log('6. heap: 20 traces +' + (step - RUN_STEP) + ' live tick steps · route ' +
		(routeGrown / 1024).toFixed(0) + ' kB · steps ' + (stepGrown / 1024).toFixed(0) + ' kB');
	check(stepGrown < 128 * 1024, 'stepHarvest retained ' + stepGrown + ' bytes over a flight');
}

/* --- 7. page round trip: bookTrace tuple and runRecord ----------------- */

{
	const page = loadPage({ search: mapSearch(3) });
	const ctx = page.context;
	const ui = page.elements;
	const Game = ctx.GravityGame;
	page.toggle('expHarvest');
	check(Game.harvestMode() === Game.HARVEST_TICK, 'the stay-pay toggle must arm the tick rule');
	const scene = ctx.GravityScene;
	const career = scene.career;
	const sim = scene.sim;
	const origin = career.hq;
	const speed = Math.min(60, sim.speedLimit(origin));
	/* a landing whose trace carries more than the spawn row and lingered
	 * long enough to accrue a dwell */
	let pick = null;
	for (let a = 0; a < 64 && !pick; a++) {
		const angle = (a + 0.4) / 64 * Math.PI * 2;
		sim.predictFast(origin, angle, speed, 45);
		let lingered = false;
		for (let i = 0; i < sim.predLogCount; i++) {
			if (sim.predLogDwell[i] > 0) lingered = true;
		}
		if (sim.predReason === GravitySim.END_IMPACT && sim.predLogCount >= 2 && lingered) {
			pick = { angle: angle, body: sim.predBody };
		}
	}
	check(pick, 'no landing trace with a visit row found');
	/* the armed aim's own finish path: the whole horizon, synchronously */
	const horizon = vm.runInContext('ruleSpec().horizon', ctx);
	sim.predictFull(origin, pick.angle, speed, horizon);
	check(sim.predReason === GravitySim.END_IMPACT && sim.predBody === pick.body,
		'predictFull must finish the armed trace');
	const traceRows = sim.predLogCount;
	const traceDwells = Array.from(sim.predLogDwell.subarray(0, traceRows));
	page.context.saveTrace(sim, origin, Game.angleUnits(pick.angle), Game.speedUnits(speed));
	const entry = career.launchBook.entries[career.launchBook.entries.length - 1];
	check(entry && entry.logCount === traceRows, 'the saved entry lost traced rows');
	check(Array.from(entry.logDwell.subarray(0, entry.logCount)).join() === traceDwells.join(),
		'the saved entry lost its dwell trail');
	const history = vm.runInContext('careerHistory', ctx);
	const tuples = history.filter(a => a.type === 'bookTrace');
	check(tuples.length >= 1, 'saveTrace recorded no bookTrace action');
	const tuple = tuples[tuples.length - 1].trace;
	check(tuple.length === 13, 'bookTrace tuple has ' + tuple.length + ' elements, want 13');
	check(tuple[12].length === tuple[11].length && tuple[12].join() === traceDwells.join(),
		'element 12 must be the dwell trail');
	/* the replay importer takes both the 13-tuple and the pre-trail 12-tuple */
	check(ctx.applyCareerBookTrace(tuple) === true, 'a 13-tuple must apply');
	check(ctx.applyCareerBookTrace(tuple.slice(0, 12)) === true, 'a legacy 12-tuple must apply');
	check(ctx.applyCareerBookTrace(tuple.slice(0, 11)) === false, 'an 11-tuple must be rejected');
	const shortDwell = tuple.slice(0, 12).concat([tuple[12].slice(0, -1)]);
	check(ctx.applyCareerBookTrace(shortDwell) === false, 'a mismatched dwell trail must be rejected');
	check(ctx.applyCareerBookTrace(tuple) === true, 'the full tuple must re-apply');

	/* a run record packs the trail generically and restores it on a new page */
	const save = ctx.GravityMaps.runRecord(ctx.mapRunInfo());
	const packed = save.state.careers[0].launchBook.entries[save.state.careers[0].launchBook.entries.length - 1];
	check(packed && packed.logDwell && packed.logDwell.a === 'Int32Array',
		'run record must pack logDwell as a typed array');
	check(packed.logDwell.d.slice(0, packed.logCount).join() === traceDwells.join(),
		'packed dwell trail differs from the live one');
	const page2 = loadPage({ search: mapSearch(3) });
	page2.toggle('expHarvest');
	page2.context.GravityMaps.arm(save);
	check(page2.context.applyRunRecord(save), 'the run state is restored');
	const back = page2.context.GravityScene.career.launchBook.entries[0];
	check(back && back.logCount === traceRows, 'restored entry lost its rows');
	check(Array.from(back.logDwell.subarray(0, back.logCount)).join() === traceDwells.join(),
		'restored entry lost its dwell trail');
	const moneyA = page.context.storedMoney(entry).net;
	const moneyB = page2.context.storedMoney(back).net;
	check(Math.abs(moneyA - moneyB) < 1e-9,
		'restored entry prices differently: ' + moneyA + ' vs ' + moneyB);
	vm.runInContext('refreshLaunchList(true)', ctx);
	check(!ui.get('careerLaunchList').innerHTML.includes('≥ticks') &&
		!page2.elements.get('careerLaunchList').innerHTML.includes('≥ticks'),
		'≥ticks must be gone from the launch list');

	/* 8. URL/link/seat-cache invariants for stay-pay (0.7.39 follow-ups) */
	check(page.context.GravityScene.game.harvestTick === true &&
		page.context.GravityScene.experimentScales().harvestTick === true,
		'live game.harvestTick must track the active stay-pay toggle');
	check(GravityGame.encodeLink(Object.assign({}, page.context.GravityScene.game, { rate: 1 }))
		.includes('&ht=1'), 'encodeLink(game) must emit &ht=1 when stay-pay is active in career');
	const mapHt = loadPage({ search: mapSearch(3) + '&ht=1' });
	check(mapHt.context.GravityScene.game.harvestTick === true &&
		mapHt.context.GravityGame.harvestMode() === GravityGame.HARVEST_TICK &&
		mapHt.elements.get('expHarvest').checked === true,
		'?map=...&ht=1 must boot directly in stay-pay mode');
	check(new URL(mapHt.context.location.href).searchParams.get('ht') === '1',
		'syncSeedUrl must write ht=1 into location.search');
	const mapReloaded = loadPage({ search: new URL(mapHt.context.location.href).search });
	check(mapReloaded.context.GravityScene.game.harvestTick === true &&
		mapReloaded.context.GravityGame.harvestMode() === GravityGame.HARVEST_TICK,
		'reloading the synced ?seed=...&mode=career&ht=1 URL must preserve stay-pay');
	const mapHtOff = loadPage({ search: mapSearch(3) + '&ht=0' });
	check(mapHtOff.context.GravityScene.game.harvestTick === false &&
		mapHtOff.context.GravityGame.harvestMode() === GravityGame.HARVEST_ENTRY,
		'?map=...&ht=0 must boot in entry mode');

	/* Seat fairness planning must ignore harvestMode so opening caches stay pure */
	const trade38 = new Sim(38);
	trade38.advanceTo(420);
	const maskA = new Uint8Array(PLANETS);
	for (let p = 0; p < 13; p++) maskA[p] = 1;
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	const seatsTick = GravityGame.prepareCareerStarts(GravityGame.createGalaxy(), trade38.world,
		trade38, maskA, 13, 3, buildStaticWorld(38));
	const trade39 = new Sim(39);
	trade39.advanceTo(420);
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	const seats39Tick = GravityGame.prepareCareerStarts(GravityGame.createGalaxy(), trade39.world,
		trade39, maskA, 13, 3, buildStaticWorld(39));
	/* Compare openingGroupStats directly against a fresh non-cached seed under HARVEST_ENTRY */
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	const forced39 = new Uint8Array(PLANETS);
	for (let i = 0; i < seats39Tick.length; i++) forced39[seats39Tick[i]] = 1;
	const statsEntry = GravityGame.openingGroupStats(trade39.world, trade39,
		maskA, 13, forced39, seats39Tick, buildStaticWorld(39));
	GravityGame.setHarvestMode(GravityGame.HARVEST_TICK);
	const trade40 = new Sim(40);
	trade40.advanceTo(420);
	const stats40Tick = Object.assign({}, GravityGame.openingGroupStats(trade40.world, trade40,
		maskA, 13, forced39, seats39Tick, buildStaticWorld(40)));
	GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	const stats40Entry = Object.assign({}, GravityGame.openingGroupStats(trade40.world, trade40,
		maskA, 13, forced39, seats39Tick, buildStaticWorld(40)));
	check(Array.isArray(seatsTick) && statsEntry.minPay >= 0 &&
		Math.abs(stats40Tick.minPay - stats40Entry.minPay) < 1e-12 &&
		Math.abs(stats40Tick.maxPay - stats40Entry.maxPay) < 1e-12,
		'openingGroupStats and prepareCareerStarts must not vary with harvestMode');
	console.log('7. page: 13-tuple + runRecord + ?map=&ht=1 + seat-cache round trip, stored price ' + moneyA.toFixed(4));
}

console.log('HARVEST TICKS OK · ' + checks + ' checks');
