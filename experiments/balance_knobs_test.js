/*
 * Experimental career balance knobs (0.7.42):
 *   - `pads ×` (`padScale` / `ps`, 0.25..4, default 1)
 *   - `rot ×`  (`rotScale` / `rs`, 0..3,    default 1)
 *   - `pay ×`  (`payScale` / `ys`, 0.25..3, default 1)
 *
 * Run: node experiments/balance_knobs_test.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitSim = require(path.join(root, 'orbit_sim.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));
const CareerReplay = require(path.join(root, 'career_replay.js'));
require(path.join(root, 'career_actions.js'));
const CareerActions = globalThis.CareerActions;
const { loadPage, mapSearch } = require('./dom_stub.js');

/* Pre-0.7.42 SHA-256 of GravityMaps.captureState(mapRunInfo()) at clockSteps=600
 * on `mapSearch(3) + '&you=bot&rate=1'` (`50 × 25 ms` frames). Re-pinned in
 * 0.7.43: the stretched gravity draw (MAX 5) changed map 3's field; the knobs
 * code is untouched, so ×1.00 must still reproduce this state bit-for-bit. */
const PRE_0742_STEP600_SHA256 =
	'74374e45d26cfe4ce4eecf4bf925040bb5704dbeeea96488116ee2293c703f18';

let failures = 0;

function check(name, fn) {
	try {
		GravityGame.setSpaceWearScale(1);
		GravityGame.setPadScale(1);
		GravityGame.setRotScale(1);
		GravityGame.setPayScale(1);
		GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
		fn();
		console.log('ok - ' + name);
	} catch (err) {
		failures += 1;
		console.error('FAIL - ' + name + ': ' + err.message);
		if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
	} finally {
		GravityGame.setSpaceWearScale(1);
		GravityGame.setPadScale(1);
		GravityGame.setRotScale(1);
		GravityGame.setPayScale(1);
		GravityGame.setHarvestMode(GravityGame.HARVEST_ENTRY);
	}
}

function makeWorld(seed) {
	const mask = new Uint8Array(OrbitWorld.PLANETS);
	mask.fill(1, 0, 13);
	const trade = new OrbitSim(seed);
	trade.setPlanetMask(mask);
	trade.step(420);
	trade.setPlanetLimit(13);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
	for (let p = 0; p < 13; p++) strength[p] = 1;
	const fill = (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) { ox[i] = trade.planetX[i]; oy[i] = trade.planetY[i]; }
	};
	sim.setField(OrbitWorld.PLANETS, trade.planetR, strength, fill, true);
	sim.setPlanets(OrbitWorld.PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.bodyCount = 13;
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, 13);
	GravityGame.applyMarketSpecials(market, trade.world);
	GravityGame.bindRun(market, galaxy, trade.world);
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, mask, 13);
	GravityGame.startCareer(career, sim, seed, trade, null, galaxy);
	return { seed, mask, trade, sim, galaxy, market, career };
}

/* --- 1. Default ×1.00 zero-drift identity -------------------------------- */

check('default ×1.00 career run matches pre-0.7.42 600-step state bit-for-bit', () => {
	const page = loadPage({ search: mapSearch(3) + '&you=bot&rate=1' });
	page.runFrames(50, 25);
	assert.strictEqual(page.context.GravityScene.game.clockSteps, 600);
	const state = page.context.GravityMaps.captureState(page.context.mapRunInfo());
	const sha = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
	assert.strictEqual(sha, PRE_0742_STEP600_SHA256,
		'default ×1.00 diverged from pre-0.7.42 career baseline');
	const searchParams = new URLSearchParams(page.context.location.search);
	assert.ok(!searchParams.has('ps') && !searchParams.has('rs') && !searchParams.has('ys'),
		'default ×1.00 omits ps/rs/ys from URL');

	const explicit = loadPage({ search: mapSearch(3) + '&you=bot&rate=1&ps=1&rs=1&ys=1' });
	explicit.runFrames(50, 25);
	const explicitState = explicit.context.GravityMaps.captureState(explicit.context.mapRunInfo());
	assert.strictEqual(JSON.stringify(explicitState), JSON.stringify(state),
		'explicit ps=1&rs=1&ys=1 matches omitted defaults bit-for-bit');
});

/* --- 2. pads × (padScale / ps) ------------------------------------------- */

check('pads × scales live recharge + leak, waitSettlement, shop/comms wait kWh, and bot payback', () => {
	const page = loadPage({ search: mapSearch(3) + '&bot=off' });
	const ctx = page.context;
	const career = ctx.GravityScene.career;
	const hq = career.hq;
	const pad = career.pads[hq];
	/* fit leaky BAT-3 at 2 kWh so both leak and solar scale together and gain > 0 */
	pad.battery = OrbitTech.BATTERIES[2];
	pad.panel = OrbitTech.PANELS[0];
	pad.chargeKwh = 2;
	const waitSteps = GravitySim.stepsForGameSeconds(GravitySim.WAIT_SEC);
	const commsOpts = {
		gameOn: true, rule: 'career', career, sim: ctx.GravityScene.sim,
		market: ctx.GravityScene.game.market
	};

	const settle1 = vm.runInContext('waitSettlement(game.career)', ctx);
	const shopGain1 = vm.runInContext('panelWaitKwh(game.career, game.career.hq, game.career.pads[game.career.hq].panel)', ctx);
	const commsGain1 = ctx.CommsCopy.buildSnapshot(commsOpts).waitGainKwh;
	for (let s = 0; s < waitSteps; s++) ctx.GravityGame.careerAdvance(career, 1);
	assert.ok(settle1.hereGain > 0 && Math.abs(pad.chargeKwh - (2 + settle1.hereGain)) < 1e-8,
		'×1.00 waitSettlement matches step-by-step careerAdvance');

	pad.chargeKwh = 2;
	page.setValue('expPads', 2);
	assert.strictEqual(ctx.GravityGame.padScaleOf(), 2);
	assert.strictEqual(page.elements.get('expPadsLabel').textContent, '×2.00');
	assert.ok(page.elements.get('expTag').textContent.includes('pads ×2.00'),
		'expTag shows non-1 pads ×');
	const settle2 = vm.runInContext('waitSettlement(game.career)', ctx);
	const shopGain2 = vm.runInContext('panelWaitKwh(game.career, game.career.hq, game.career.pads[game.career.hq].panel)', ctx);
	const commsGain2 = ctx.CommsCopy.buildSnapshot(commsOpts).waitGainKwh;
	assert.ok(Math.abs(shopGain2 - 2 * shopGain1) < 1e-9, 'shop panelWaitKwh doubles at pads ×2');
	assert.ok(Math.abs(commsGain2 - 2 * commsGain1) < 1e-9, 'comms waitGainKwh doubles at pads ×2');
	for (let s = 0; s < waitSteps; s++) ctx.GravityGame.careerAdvance(career, 1);
	assert.ok(settle2.hereGain > settle1.hereGain &&
		Math.abs(pad.chargeKwh - (2 + settle2.hereGain)) < 1e-8,
		'×2.00 waitSettlement matches step-by-step careerAdvance');

	const bot = new GravityBot();
	GravityGame.setPadScale(1);
	const waitFactor1 = bot.careerEnergyWait(career, hq, 50, pad);
	GravityGame.setPadScale(2);
	const waitFactor2 = bot.careerEnergyWait(career, hq, 50, pad);
	assert.ok(Math.abs(waitFactor2 - waitFactor1 * 0.5) < 1e-9,
		'bot careerEnergyWait halves when pads × doubles');

	career.ledger.purse = 20;
	GravityGame.setPadScale(1);
	bot.careerGear.value = 0;
	bot.careerGearOffer(career, 0.002, 2, OrbitTech.KIND_PANEL, OrbitTech.PANELS[1], null, 'SOL-2');
	const val1 = bot.careerGear.value;
	GravityGame.setPadScale(2);
	bot.careerGear.value = 0;
	bot.careerGearOffer(career, 0.001, 2, OrbitTech.KIND_PANEL, OrbitTech.PANELS[1], null, 'SOL-2');
	assert.ok(Math.abs(bot.careerGear.value - val1) < 1e-9,
		'CAREER_PAD_HORIZON scales with padScale so per-game-hour payback stays invariant');
});

/* --- 3. rot × (rotScale / rs) -------------------------------------------- */

check('rot ×0 freezes passive corruption and reporting decay while bribes and rebel checks stay live', () => {
	const w = makeWorld(7);
	let target = 0;
	while (target === w.career.capitalPlanet || target === w.career.arfPlanet || target === w.career.hq) {
		target++;
	}
	w.market.lastVisitStep[target] = -500000;
	w.market.reportStep[target] = -500000;
	w.market.corruption[target] = 25;
	w.market.corruptionFloor[target] = 0;

	GravityGame.setRotScale(0);
	GravityGame.advancePolitics(w.market, w.trade, 0);
	GravityGame.advancePolitics(w.market, w.trade, 7200);
	assert.strictEqual(w.market.corruption[target], 25,
		'rot ×0 freezes passive neglect corruption growth');

	GravityGame.placeShip(w.career, w.sim, target);
	GravityGame.advancePolitics(w.market, w.trade, 14400);
	assert.strictEqual(w.market.corruption[target], 25,
		'rot ×0 freezes reporting corruption decay');

	w.market.corruption[target] = 30;
	w.market.visitPay[target] = 1.5;
	const bribe = GravityGame.acceptBribe(w.career, w.market, w.sim, target, 14400);
	assert.strictEqual(bribe.ok, true, 'bribe accepted at rot ×0: ' + bribe.reason);
	assert.ok(w.market.corruption[target] > 30, 'bribe still raises corruption at rot ×0');

	/* move ship off target and test 60 s rebellion check epoch at rot ×0 */
	GravityGame.placeShip(w.career, w.sim, w.career.hq);
	w.market.corruption[target] = 98;
	let rebelled = false;
	for (let k = 1; k <= 40 && !rebelled; k++) {
		GravityGame.advancePolitics(w.market, w.trade, 14400 + k * 7200);
		if (w.market.rebel[target] === 1) rebelled = true;
	}
	assert.strictEqual(rebelled, true,
		'60 s rebellion check still triggers on high-corruption world at rot ×0');
});

check('rot ×2 doubles passive corruption growth and reporting decay rates', () => {
	const w1 = makeWorld(11);
	const w2 = makeWorld(11);
	let p = 0;
	while (p === w1.career.capitalPlanet || p === w1.career.arfPlanet || p === w1.career.hq) p++;
	for (const w of [w1, w2]) {
		w.market.lastVisitStep[p] = -500000;
		w.market.reportStep[p] = -500000;
		w.market.corruption[p] = 20;
		GravityGame.advancePolitics(w.market, w.trade, 0);
	}
	GravityGame.setRotScale(1);
	GravityGame.advancePolitics(w1.market, w1.trade, 1200);
	GravityGame.setRotScale(2);
	GravityGame.advancePolitics(w2.market, w2.trade, 1200);
	const gain1 = w1.market.corruption[p] - 20;
	const gain2 = w2.market.corruption[p] - 20;
	assert.ok(gain1 > 0 && Math.abs(gain2 - 2 * gain1) < 1e-9,
		'rot ×2 doubles passive corruption growth');

	w1.market.corruption[p] = 50;
	w2.market.corruption[p] = 50;
	GravityGame.placeShip(w1.career, w1.sim, p);
	GravityGame.placeShip(w2.career, w2.sim, p);
	GravityGame.setRotScale(1);
	GravityGame.advancePolitics(w1.market, w1.trade, 2400);
	GravityGame.setRotScale(2);
	GravityGame.advancePolitics(w2.market, w2.trade, 2400);
	const drop1 = 50 - w1.market.corruption[p];
	const drop2 = 50 - w2.market.corruption[p];
	assert.ok(drop1 > 0 && Math.abs(drop2 - 2 * drop1) < 1e-9,
		'rot ×2 doubles reporting corruption decay');
});

/* --- 4. pay × (payScale / ys), orthogonality, non-career & seatPlanKey ---- */

check('pay × scales normal & rebel payouts, preserves Capital/A.R.F., and stays orthogonal to rot', () => {
	const w = makeWorld(19);
	let normal = 0;
	while (normal === w.career.capitalPlanet || normal === w.career.arfPlanet || normal === w.career.hq) {
		normal++;
	}
	let rebel = normal + 1;
	while (rebel === w.career.capitalPlanet || rebel === w.career.arfPlanet) rebel++;
	w.market.lastVisitStep[normal] = -500000;
	w.market.reportStep[normal] = -500000;
	w.market.lastVisitStep[rebel] = -500000;
	w.market.rebel[rebel] = 1;
	w.market.rebelSinceStep[rebel] = -500000;

	GravityGame.setPayScale(1);
	const baseNormal = GravityGame.planetProfit(w.market, normal, 100);
	const baseRebel = GravityGame.planetProfit(w.market, rebel, 100);
	GravityGame.setPayScale(2.5);
	assert.ok(Math.abs(GravityGame.planetProfit(w.market, normal, 100) - 2.5 * baseNormal) < 1e-9,
		'normal planet payout scales by pay ×2.5');
	assert.ok(Math.abs(GravityGame.planetProfit(w.market, rebel, 100) - 2.5 * baseRebel) < 1e-9,
		'rebel fly-by payout scales by pay ×2.5');
	assert.strictEqual(GravityGame.planetProfit(w.market, w.career.capitalPlanet, 100),
		GravityGame.CAPITAL_VISIT_PAY, 'Capital −3.00 entry fine is unchanged by pay ×');
	assert.strictEqual(GravityGame.planetProfit(w.market, w.career.arfPlanet, 100), 0,
		'A.R.F. 0.00 payout is unchanged by pay ×');

	GravityGame.setPayScale(1);
	const wLowPay = makeWorld(19);
	const wBasePay = makeWorld(19);
	wLowPay.market.lastVisitStep[normal] = -500000;
	wLowPay.market.reportStep[normal] = -500000;
	wBasePay.market.lastVisitStep[normal] = -500000;
	wBasePay.market.reportStep[normal] = -500000;
	GravityGame.advancePolitics(wLowPay.market, wLowPay.trade, 0);
	GravityGame.advancePolitics(wBasePay.market, wBasePay.trade, 0);
	GravityGame.setPayScale(0.25);
	assert.ok(GravityGame.planetProfit(wLowPay.market, normal, 100) <= 1.000001,
		'scaled payout at pay ×0.25 is at or below 1.00');
	GravityGame.advancePolitics(wLowPay.market, wLowPay.trade, 2400);
	GravityGame.setPayScale(1);
	GravityGame.advancePolitics(wBasePay.market, wBasePay.trade, 2400);
	assert.ok(wBasePay.market.corruption[normal] > 0, 'passive neglect corruption rose');
	assert.strictEqual(wLowPay.market.corruption[normal], wBasePay.market.corruption[normal],
		'passive neglect rot is strictly independent of pay ×');

	/* seatPlanKey separates padScale and payScale from ×1 cached openings */
	GravityGame.setPadScale(1);
	GravityGame.setPayScale(1);
	GravityGame.rememberSeatPlan(w.galaxy, w.trade.world, w.trade, w.mask, 13, 1,
		w.sim, [9], 1.5);
	GravityGame.setPayScale(0.25);
	const g2 = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(g2, w.seed);
	const seatsLowPay = GravityGame.prepareCareerStarts(g2, w.trade.world, w.trade, w.mask, 13, 1, w.sim);
	assert.ok(Array.isArray(seatsLowPay) && g2.openingTargetPay !== 1.5,
		'prepareCareerStarts does not reuse ×1 seatPlanKey cache at pay ×0.25');
});

check('pay × is inactive outside career, updates launchBook storedMoney, and extends PROFIT_STRINGS', () => {
	const page = loadPage({ search: mapSearch(3) + '&bot=off' });
	const ctx = page.context;
	assert.strictEqual(vm.runInContext('PROFIT_STRINGS[4800]', ctx), '+48.00',
		'PROFIT_STRINGS covers max rebel × payMax (+48.00)');

	const career = ctx.GravityScene.career;
	let dest = 0;
	while (dest === career.hq || dest === career.capitalPlanet || dest === career.arfPlanet) dest++;
	const entry = {
		origin: career.hq, body: dest, angleU: 0, speedU: 100, steps: 60, length: 300,
		logCount: 1, logPlanet: [dest], logStep: [30], logDwell: [10]
	};
	const visit1 = vm.runInContext('storedMoney', ctx)(entry).visit;
	page.setValue('expPay', 2);
	const visit2 = vm.runInContext('storedMoney', ctx)(entry).visit;
	assert.ok(visit1 > 0 && Math.abs(visit2 - 2 * visit1) < 1e-9,
		'storedMoney re-prices launchBook entry immediately on pay ×2');

	page.choose('modeMoney');
	assert.strictEqual(ctx.GravityGame.payScaleOf(), 1, 'money mode resets active payScale to 1');
	assert.strictEqual(page.elements.get('expPay').disabled, true, 'expPay disabled outside career');
	page.choose('modeCareer');
	assert.strictEqual(ctx.GravityGame.payScaleOf(), 2, 'returning to career restores payScale = 2');
});

/* --- 5. Links, URLs, SavedMap & deterministic replays -------------------- */

check('links, URL search params, SavedMap, CareerActions and CareerReplay round-trip ps/rs/ys', () => {
	const link = GravityGame.encodeLink({
		seed: 42, rate: 1, rule: GravityGame.RULE_CAREER, bot: GravityGame.BOT_NORMAL,
		player: GravityGame.PLAYER_USER, cheat: null,
		gravityScale: 1, forceScale: 1, spaceWearScale: 1.5,
		padScale: 2.25, rotScale: 0, payScale: 0.5, harvestTick: true, shots: []
	});
	assert.ok(link.includes('&ps=2.25') && link.includes('&rs=0') && link.includes('&ys=0.5'),
		'encodeLink emits ps, rs, ys');
	const decoded = GravityGame.decodeLink('#' + link);
	assert.strictEqual(decoded.padScale, 2.25);
	assert.strictEqual(decoded.rotScale, 0);
	assert.strictEqual(decoded.payScale, 0.5);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career&ps=0.1'), null);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career&rs=-0.1'), null);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career&ys=3.5'), null);

	const page = loadPage({ search: mapSearch(3) + '&ps=1.5&rs=0.5&ys=2' });
	const ctx = page.context;
	assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.GravityScene.experimentScales())), {
		gravity: 1, force: 1, spaceWear: 1, pad: 1.5, rot: 0.5, pay: 2, harvestTick: false
	});
	const bootSearch = ctx.location.search;
	assert.ok(bootSearch.includes('ps=1.5') &&
		bootSearch.includes('rs=0.5') &&
		bootSearch.includes('ys=2'), 'syncSeedUrl writes ps, rs, ys');

	const runRec = ctx.GravityMaps.runRecord(ctx.mapRunInfo());
	assert.strictEqual(runRec.ps, 1.5);
	assert.strictEqual(runRec.rs, 0.5);
	assert.strictEqual(runRec.ys, 2);

	page.runFrames(20, 25);
	page.setValue('expPads', 2.5);
	page.setValue('expRot', 0);
	page.setValue('expPay', 0.75);
	page.runFrames(20, 25);

	page.click('gameCopy');
	const actionsText = page.clipboardText;
	const actionsData = CareerActions.decode(actionsText);
	assert.ok(actionsData && actionsData.p === 1.5 && actionsData.r === 0.5 && actionsData.y === 2,
		'CareerActions opening records initial p/r/y');
	assert.ok(actionsData.actions.some(a => a.type === 'scales' && a.y === 0.75),
		'CareerActions records mid-run scales action with p/r/y');

	page.click('careerSaveCopy');
	const movieRaw = page.clipboardText;
	const movieEncoded = movieRaw.startsWith(CareerReplay.PREFIX)
		? movieRaw.slice(CareerReplay.PREFIX.length)
		: new URLSearchParams(movieRaw.split('#')[1]).get('replay');
	const movie = CareerReplay.decode(movieEncoded);
	let latestSnap = CareerReplay.copy(movie.start);
	for (const frame of movie.frames) latestSnap = CareerReplay.apply(latestSnap, frame.d);
	assert.ok(movie && movie.start.ps === 1.5 && latestSnap.ps === 2.5 &&
		latestSnap.rs === 0 && latestSnap.ys === 0.75,
		'CareerReplay encodes start and latest frame ps/rs/ys');
	const legacy = JSON.parse(JSON.stringify(movie));
	delete legacy.start.ps;
	delete legacy.start.rs;
	delete legacy.start.ys;
	assert.ok(CareerReplay.decode(CareerReplay.encode(legacy)),
		'CareerReplay accepts legacy v3 snapshots without ps/rs/ys');

	const replayPage = loadPage({ search: mapSearch(3) });
	replayPage.elements.get('replayInput').value = actionsText;
	replayPage.click('replayLoad');
	for (let i = 0; i < 60 && vm.runInContext('careerActionReplay.active', replayPage.context); i++) {
		replayPage.runFrames(2, 25);
	}
	assert.strictEqual(vm.runInContext('careerActionReplay.active', replayPage.context), false);
	const note = replayPage.elements.get('careerMsg').textContent;
	assert.ok(note.includes('history matches'),
		'CareerActions replay with mid-run ps/rs/ys changes reproduces exact history: ' + note);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(replayPage.context.GravityScene.experimentScales())), {
		gravity: 1, force: 1, spaceWear: 1, pad: 2.5, rot: 0, pay: 0.75, harvestTick: false
	});
});

if (failures > 0) {
	console.error(failures + ' failure(s)');
	process.exit(1);
}
console.log('BALANCE KNOBS OK · pads ×, rot ×, pay ×, links, saves and replays');
