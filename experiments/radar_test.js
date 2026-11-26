/*
 * Radar (0.7.49): the HQ facility that reveals every ship's landing.
 *   - the build gate: at the HQ, career open, the purse covers it; once;
 *     a restart is a new company with no radar
 *   - the gift entry (`radar`, 6 cr) draws once per company, grants the flag
 *     past the build gate, and keeps the money identity
 *   - the reveal: one record per ship (own first), a flying ship's ghost
 *     matching its own `predictFlight` (parity), parked ships at rest;
 *     memoised per career, so a static sky predicts once
 *   - the bot: a radar rival de-prioritises a destination another ship is
 *     about to take; without radar the score is exactly what it was
 *
 * Run: node experiments/radar_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitSim = require(path.join(root, 'orbit_sim.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));
const { loadPage, mapSearch } = require('./dom_stub.js');

const STARTER = OrbitTech.starterGrant().purse;
let failures = 0;

function check(name, fn) {
	try {
		fn();
		console.log('ok - ' + name);
	} catch (err) {
		failures += 1;
		console.error('FAIL - ' + name + ': ' + err.message);
		if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
	}
}

function makeWorld(seed) {
	const mask = new Uint8Array(OrbitWorld.PLANETS);
	mask.fill(1, 0, 13);
	const trade = new OrbitSim(seed);
	trade.setPlanetMask(mask);
	trade.step(420);
	trade.setPlanetLimit(13);
	return { seed, mask, trade, sims: [] };
}

/* every company flies its own sim over the same (static) field, as on the page */
function makeSim(w) {
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
	for (let p = 0; p < 13; p++) strength[p] = 1;
	const fill = (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) { ox[i] = w.trade.planetX[i]; oy[i] = w.trade.planetY[i]; }
	};
	sim.setField(OrbitWorld.PLANETS, w.trade.planetR, strength, fill, true);
	sim.setPlanets(OrbitWorld.PLANETS, w.trade.planetX, w.trade.planetY, w.trade.planetR,
		w.trade.orbitRX, w.trade.orbitRY, w.trade.orbitTiltCos, w.trade.orbitTiltSin);
	sim.setPlanetMask(w.mask);
	sim.bodyCount = 13;
	/* a page sim is stepped every frame before anything launches, so its
	 * step planet table is current; a bare test sim launches cold and
	 * `spawn` reads that table — throw the same warm-up flights at it */
	for (let i = 0; i < 3; i++) {
		sim.launch(0, 0, 1);
		sim.predictFlight(GravitySim.BUDGET_MS);
		sim.clear();
	}
	w.sims.push(sim);
	return sim;
}

function startOne(w, seed, isBot, galaxy) {
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, w.mask, 13);
	GravityGame.startCareer(career, makeSim(w), seed, w.trade, null, galaxy,
		undefined, undefined, isBot);
	return career;
}

/* a direct shot at the nearest planet that the radar's own budget can see
 * end to end: targets by distance, fast speeds first (fewest trace steps),
 * the real landing and the ghost both verified on the sim before the career
 * launch is committed — deterministic on the static field */
function launchShot(career, sim) {
	const at = career.at >= 0 ? career.at : 0;
	const targets = [];
	for (let p = 0; p < 13; p++) {
		if (p === at || !w_.mask[p]) continue;
		targets.push(p);
	}
	const dist = p => Math.hypot(w_.trade.planetX[p] - w_.trade.planetX[at],
		w_.trade.planetY[p] - w_.trade.planetY[at]);
	targets.sort((x, y) => dist(x) - dist(y));
	const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
	for (const target of targets) {
		const angle = Math.atan2(w_.trade.planetY[target] - w_.trade.planetY[at],
			w_.trade.planetX[target] - w_.trade.planetX[at]);
		for (const speed of [120, 100, 80, 60]) {
			sim.launch(at, angle, speed);
			for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) {
				sim.stepOne();
			}
			const real = sim.endReason === GravitySim.END_IMPACT &&
				sim.endBody === target;
			sim.clear();
			if (!real) continue;
			sim.launch(at, angle, speed);
			sim.predictFlight(GravityGame.RADAR_BUDGET_MS);
			const ghost = sim.predReason === GravitySim.END_IMPACT &&
				sim.predBody === target;
			sim.clear();
			if (!ghost) continue;
			sim.launch(at, angle, speed);
			GravityGame.careerBeginFlight(career, sim, 0);
			return target;
		}
	}
	throw new Error('no verified shot from P' + at);
}

/* fly the ship's sim to its real landing, as the frame loop would */
function flyToImpact(sim) {
	const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
	for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) {
		sim.stepOne();
	}
	return sim.endReason === GravitySim.END_IMPACT ? sim.endBody : -1;
}

let w_ = null;

function galaxyFixture(seed) {
	const w = makeWorld(seed);
	w_ = w;
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, w.mask, 13);
	GravityGame.applyMarketSpecials(market, w.trade.world);
	GravityGame.bindRun(market, galaxy, w.trade.world);
	const careers = [];
	for (let i = 0; i < 3; i++) {
		careers.push(startOne(w, seed + i, i > 0, galaxy));
	}
	return { w, galaxy, market, careers };
}

const poolRadar = GravityGame.GIFT_POOL.find(e => e.id === 'radar');

check('pool: the radar entry is the facility, priced at RADAR_COST, drawn once', () => {
	assert.ok(poolRadar && poolRadar.kind === 'radar' && poolRadar.value === GravityGame.RADAR_COST);
	assert.strictEqual(poolRadar.value, 6);
	let draws = 0;
	for (let seed = 1; seed <= 600; seed++) {
		for (const budget of [6, 8, 12, 20]) {
			const draw = GravityGame.drawGifts(budget, seed);
			const again = GravityGame.drawGifts(budget, seed);
			assert.deepStrictEqual(draw.drawn.map(e => e.id), again.drawn.map(e => e.id));
			const radars = draw.drawn.filter(e => e.kind === 'radar').length;
			assert.ok(radars <= 1, 'a radar is never drawn twice');
			draws += radars;
			const spent = draw.drawn.reduce((s, e) => s + e.value, 0);
			assert.ok(Math.abs(spent + draw.cash - budget) < 1e-9);
		}
	}
	assert.ok(draws > 200, 'the radar entry competes in the draw (' + draws + ')');
});

check('gift: the radar grant is the flag plus the spend, the identity holds', () => {
	let granted = 0;
	for (let seed = 1; seed <= 300 && granted < 6; seed++) {
		const draw = GravityGame.drawGifts(20, seed);
		if (!draw.drawn.some(e => e.kind === 'radar')) continue;
		GravityGame.setStartGifts(20, 0, 0);
		const w = makeWorld(seed);
		w_ = w;
		const career = startOne(w, seed, true);
		GravityGame.setStartGifts(0, 0, 0);
		assert.strictEqual(career.radar, true, 'the flag is granted');
		assert.ok(career.giftDrawn.includes('radar'));
		assert.ok(career.buildSpent >= GravityGame.RADAR_COST, 'the spend landed in property');
		const out = {};
		GravityGame.careerStats(out, career);
		assert.ok(Math.abs(career.ledger.purse - (STARTER + out.gift + out.profit -
			out.property - out.science)) < 1e-9, 'money identity');
		assert.ok(GravityGame.giftText(career).includes('radar'));
		granted += 1;
	}
	assert.ok(granted >= 4, 'radar grants found (' + granted + ')');
});

check('build gate: at the HQ for 6 cr, once; away, broke, in flight or ended refuses', () => {
	const w = makeWorld(42);
	w_ = w;
	const career = startOne(w, 42, false);
	assert.strictEqual(career.ledger.purse, STARTER);
	assert.strictEqual(career.radar, false);
	assert.strictEqual(GravityGame.canBuildRadar(career), true, 'at the HQ with the purse');
	assert.strictEqual(GravityGame.buildRadar(career), true);
	assert.strictEqual(career.ledger.purse, STARTER - GravityGame.RADAR_COST);
	assert.ok(Math.abs(career.buildSpent - GravityGame.RADAR_COST) < 1e-9);
	assert.strictEqual(career.radar, true);
	assert.strictEqual(GravityGame.canBuildRadar(career), false, 'no second build');
	/* a restart is a new company */
	GravityGame.resetCareer(career, 42, w.trade, null, undefined, w.sims[0]);
	assert.strictEqual(career.radar, false);
	/* away from the HQ */
	career.at = (career.hq + 1) % 13;
	assert.strictEqual(GravityGame.canBuildRadar(career), false);
	career.at = career.hq;
	/* too poor */
	career.ledger.purse = GravityGame.RADAR_COST - 0.01;
	assert.strictEqual(GravityGame.canBuildRadar(career), false);
	/* no HQ yet (space start) */
	career.ledger.purse = 10;
	career.hq = -1;
	assert.strictEqual(GravityGame.canBuildRadar(career), false);
	/* ended */
	career.hq = career.at;
	career.ended = GravityGame.CAREER_COMPLETE;
	assert.strictEqual(GravityGame.canBuildRadar(career), false);
	career.ended = GravityGame.CAREER_OPEN;
	/* the communism cheat builds free, like any other build */
	career.cheat = GravityGame.CHEAT_COMMUNISM;
	career.ledger.purse = 0;
	assert.strictEqual(GravityGame.buildRadar(career), true);
	assert.strictEqual(career.ledger.purse, 0);
	assert.strictEqual(career.radar, true, 'the flag is the whole machine');
	career.cheat = null;
});

check('reveal: one record per ship, own first; flying ships land, parked ships rest', () => {
	const f = galaxyFixture(42);
	const [a, b, c] = f.careers;
	const out = [];
	assert.strictEqual(GravityGame.radarShips(out, a, f.w.trade), 0, 'no radar, no reveal');
	assert.strictEqual(a.radar, false);
	assert.strictEqual(GravityGame.buildRadar(a), true);
	assert.strictEqual(GravityGame.radarShips(out, a, f.w.trade), 3, 'every ship');
	assert.strictEqual(out[0].career, a, 'the own ship first');
	const landing = launchShot(b, b.sim);
	assert.strictEqual(b.sim.status, GravitySim.STATUS_FLYING);
	GravityGame.radarShips(out, a, f.w.trade);
	const fly = out[1];
	assert.strictEqual(fly.career, b);
	assert.ok(fly.predCount >= 2, 'a flying ship yields a predicted path');
	assert.strictEqual(fly.body, b.sim.predBody, 'the ghost lands where the ship lands');
	assert.strictEqual(fly.body, landing, 'the verified shot landed at the target');
	assert.ok(fly.tLand > 0,
		'the ghost carries the real landing time (' + fly.tLand.toFixed(1) + ' s)');
	assert.strictEqual(fly.landStep, b.sim.liveSteps + b.sim.predSteps);
	/* parity: the ship's own (full-budget) prediction of the same flight */
	b.sim.predictFlight(GravitySim.BUDGET_MS);
	assert.strictEqual(b.sim.predBody, landing);
	assert.strictEqual(b.sim.predSteps, fly.landStep - b.sim.liveSteps,
		'the ghost matches the ship\'s own predictFlight');
	assert.strictEqual(fly.predX, b.sim.predX, 'the buffers are reused, never copied');
	/* the parked third company rests at its HQ */
	const parked = out[2];
	assert.strictEqual(parked.career, c);
	assert.strictEqual(parked.predCount, 0);
	assert.strictEqual(parked.tLand, 0);
	assert.strictEqual(parked.x, f.w.trade.planetX[c.hq]);
	assert.strictEqual(parked.y, f.w.trade.planetY[c.hq]);
	/* the own ship flying is in the reveal with its own +N s */
	const nearestA = launchShot(a, a.sim);
	GravityGame.radarShips(out, a, f.w.trade);
	assert.strictEqual(out[0].career, a);
	assert.ok(out[0].tLand > 0, 'the own ship carries its own +N s');
	assert.strictEqual(out[0].body, nearestA);
});

check('memo: a static sky predicts once per flight state; a step or a burn re-predicts', () => {
	const w = makeWorld(42);
	w_ = w;
	const career = startOne(w, 42, false);
	assert.strictEqual(GravityGame.buildRadar(career), true);
	launchShot(career, career.sim);
	const out = [];
	let predictions = 0;
	const ship = career.sim;
	const own = ship.predictFlight.bind(ship);
	ship.predictFlight = budget => { predictions += 1; return own(budget); };
	GravityGame.radarShips(out, career, w.trade);
	assert.strictEqual(predictions, 1);
	GravityGame.radarShips(out, career, w.trade);
	GravityGame.radarShips(out, career, w.trade);
	assert.strictEqual(predictions, 1, 'the memo holds while nothing moved');
	ship.stepOne();
	GravityGame.radarShips(out, career, w.trade);
	assert.strictEqual(predictions, 2, 'a flown step re-predicts');
	/* the impulse burn changes the velocity without a step: the memo's
	 * velocity guard is what keeps the ghost honest through it */
	ship.cargo.vx += 0.5;
	ship.cargo.vy -= 0.5;
	GravityGame.radarShips(out, career, w.trade);
	assert.strictEqual(predictions, 3, 'a burn re-predicts');
	/* `keep === sim` must neither overwrite the sim nor mark the stamp clean */
	ship.stepOne();
	GravityGame.radarShips(out, career, w.trade, ship);
	assert.strictEqual(predictions, 3, 'keep skips re-prediction');
	GravityGame.radarShips(out, career, w.trade);
	assert.strictEqual(predictions, 4, 'dropping keep predicts the unstamped step');
});

check('bot: a radar rival avoids a taken destination; without radar it scores unchanged', () => {
	const f = galaxyFixture(5);
	const [a, b] = f.careers;
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	assert.strictEqual(bot.careerRadarAvoid(a, b.hq, 0, 10), 0, 'no radar, no penalty');
	assert.strictEqual(GravityGame.buildRadar(a), true);
	/* b's ship flies a verified shot: the ghost lands inside the horizon */
	const landing = launchShot(b, b.sim);
	assert.ok(GravityGame.claimOwner(f.galaxy, landing) < 0,
		'the fixture landing starts unclaimed');
	const out = [];
	GravityGame.radarShips(out, a, f.w.trade);
	const fly = out.find(r => r.career === b);
	assert.ok(fly && fly.body === landing && fly.tLand > 0, 'the predicted landing is known');
	/* the landing-time race: a shot that arrives later concedes the landing,
	 * a shot that arrives first beats the rival and gains the same fraction */
	const rivalTime = fly.tLand;
	assert.strictEqual(bot.careerRadarAvoid(a, landing, 0, 10, rivalTime * 2),
		GravityGame.RADAR_AVOID * 10, 'a slower shot concedes the landing');
	assert.strictEqual(bot.careerRadarAvoid(a, landing, 0, 10, rivalTime * 0.5),
		-GravityGame.RADAR_BEAT * 10, 'a faster shot beats the rival');
	/* b parked on a planet makes that planet stale for a radar reader: land
	 * the ship (the real end-of-flight path) and read the sit branch */
	assert.strictEqual(flyToImpact(b.sim), landing);
	GravityGame.careerEndFlight(b, b.sim, f.w.trade, 120);
	assert.strictEqual(b.at, landing);
	assert.strictEqual(b.flying, false);
	assert.strictEqual(bot.careerRadarAvoid(a, landing, 1, 10, 0),
		GravityGame.RADAR_AVOID * 10, 'a ship sitting there is hot');
	/* a rail another company owns is captured ground */
	let claimPlanet = -1;
	for (let p = 0; p < 13 && claimPlanet < 0; p++) {
		if (p === a.hq || p === b.hq || p === landing) continue;
		if (GravityGame.planetBuildable(b, p)) claimPlanet = p;
	}
	assert.ok(claimPlanet >= 0, 'the fixture has a buildable planet');
	assert.strictEqual(GravityGame.claimOwner(f.galaxy, claimPlanet),
		GravityGame.OWNER_COMMERCIAL, 'the fixture planet starts unclaimed');
	b.ledger.purse += 20;
	assert.strictEqual(GravityGame.buildGear(b, claimPlanet, OrbitTech.KIND_CATAPULT,
		OrbitTech.CATAPULTS[0]), true, 'the rival builds its rail');
	assert.strictEqual(bot.careerRadarAvoid(a, claimPlanet, 2, 10, 0),
		GravityGame.RADAR_AVOID * 10, 'captured ground is hot');
	/* a quiet planet with nobody on it and no predicted landing stays cheap */
	let quiet = -1;
	for (let p = 0; p < 13 && quiet < 0; p++) {
		if (p === a.hq || p === b.hq || p === landing || p === claimPlanet) continue;
		if (GravityGame.claimOwner(f.galaxy, p) >= 0) continue;
		if (!bot.careerRadarHot(a, 3)[p]) quiet = p;
	}
	assert.ok(quiet >= 0, 'a quiet planet exists');
	assert.strictEqual(bot.careerRadarAvoid(a, quiet, 3, 10, 0), 0);
	/* the score through careerScoreFacts shifts with radar and not without:
	 * b (the reader) scores a landing where a sits */
	bot.attachWorld(f.w.trade);
	bot.setPlanetMask(f.w.mask, 13);
	bot.bindSim(b.sim);
	const args = [b, b.at, f.market, 120, 0, 0, a.hq, 5, 300, 360, 100, 0, 0.9, 5];
	b.radar = false;
	const plain = bot.careerScoreFacts(...args);
	assert.ok(Number.isFinite(plain), 'the destination scores without radar (' +
		bot.careerEval.reject + ')');
	b.radar = true;
	const avoided = bot.careerScoreFacts(...args);
	assert.ok(Number.isFinite(avoided));
	assert.ok(Math.abs(avoided - plain * (1 - GravityGame.RADAR_AVOID)) < 1e-9,
		'radar gives up a fraction of the same landing (' + plain.toFixed(2) +
		' → ' + avoided.toFixed(2) + ')');
	/* headless careerPlayer: b's radar sees a's live flight via exitProbe
	 * without anyone calling predictFlight on a.sim or touching a.sim.predCount */
	bot.attachCareerPlayer(a, a.sim);
	const playerLanding = launchShot(a, a.sim);
	a.sim.predCount = 0;
	a.sim.predReason = GravitySim.END_OPEN;
	a.sim.predBody = -1;
	assert.strictEqual(bot.careerRadarHot(b, 4)[playerLanding], 1,
		'radar rival reads careerPlayer live flight without GUI predictFlight');
	assert.strictEqual(a.sim.predCount, 0, 'careerPlayer buffers stay untouched');
});

check('page: the predicted box exists, the facility gates it, the build ticks it', () => {
	const page = loadPage({ search: mapSearch(42) });
	const label = page.elements.get('predViewLabel');
	const box = page.elements.get('predView');
	assert.ok(label && box, 'the view-bar checkbox exists');
	assert.strictEqual(label.hidden, false, 'career page shows the predicted checkbox');
	assert.strictEqual(box.disabled, true, 'locked without the facility');
	assert.ok(vm.runInContext('careerPadEl.innerHTML', page.context).includes('build radar'),
		'the HQ pad block offers the build');
	const purseBefore = vm.runInContext('game.career.ledger.purse', page.context);
	assert.strictEqual(purseBefore, STARTER);
	page.toggle('predView');
	page.runFrames(2, 16);
	assert.strictEqual(page.context.GravityScene.predRivals(), true, 'the toggle is the view');
	assert.strictEqual(page.calls.texts.filter(t => t === 'landed').length, 0,
		'the reveal draws nothing without the facility');
	assert.strictEqual(vm.runInContext('careerAct({ act: \'radar\' })', page.context), true);
	assert.strictEqual(vm.runInContext('game.career.radar', page.context), true);
	assert.strictEqual(vm.runInContext('game.career.ledger.purse', page.context),
		STARTER - GravityGame.RADAR_COST);
	assert.strictEqual(box.disabled, false, 'the facility unlocks the view');
	assert.strictEqual(box.checked, true, 'the build ticks the predicted box');
	assert.ok(vm.runInContext('careerPadEl.innerHTML', page.context).includes('radar at HQ'),
		'the pad block names the facility once built');
	assert.ok(vm.runInContext('careerMsgEl.textContent', page.context).includes('radar built at HQ'));
	/* a fresh page keeps the paint window on this frame's texts: the build
	 * alone turns the reveal on - three parked companies label themselves
	 * landed with no checkbox touched */
	const fresh = loadPage({ search: mapSearch(42) });
	assert.strictEqual(vm.runInContext('careerAct({ act: \'radar\' })', fresh.context), true);
	fresh.runFrames(1, 16);
	assert.ok(fresh.calls.texts.includes('landed'), 'parked ships label themselves landed');
	assert.strictEqual(fresh.calls.texts.filter(t => t === 'landed').length, 3,
		'every parked company is labelled');
	/* restoring a run that already owns radar also turns predView on */
	fresh.toggle('predView');
	assert.strictEqual(fresh.elements.get('predView').checked, false);
	vm.runInContext('applyRunRecord(GravityMaps.runRecord(mapRunInfo()))', fresh.context);
	assert.strictEqual(fresh.elements.get('predView').checked, true,
		'restoring a run with radar ticks the predicted box');
	/* a rival slot with no radar locks the box for that company */
	const slot = vm.runInContext('bot.count', page.context);
	assert.ok(slot >= 1);
	vm.runInContext(`selectSlot(1)`, page.context);
	assert.strictEqual(box.disabled, true, 'a company without radar keeps the box dark');
	vm.runInContext('selectSlot(0)', page.context);
	assert.strictEqual(box.disabled, false);
	/* trails: their own checkbox, every mode */
	assert.strictEqual(page.context.GravityScene.trailRivals(), true, 'trails start on');
	page.toggle('trailView');
	assert.strictEqual(page.context.GravityScene.trailRivals(), false);
	page.toggle('trailView');
	const lab = loadPage({});
	assert.strictEqual(lab.elements.get('predViewLabel').hidden, false,
		'the predicted box works outside career too');
	assert.strictEqual(lab.elements.get('predView').disabled, false,
		'no facility gate outside career');
	assert.strictEqual(lab.elements.get('trailView').checked, true,
		'the trails box starts on in the lab too');
});

check('predicted: the box shows every rival, hover or press reveals one without it', () => {
	const page = loadPage({ search: mapSearch(42) });
	assert.strictEqual(vm.runInContext('careerAct({ act: \'radar\' })', page.context), true);
	assert.strictEqual(page.elements.get('predView').checked, true,
		'the build ticks the box');
	page.toggle('predView');
	/* the own ship and one rival fly verified shots; the third stays parked */
	const fly = (index, avoidTarget = -1) => vm.runInContext(`(() => {
		const r = game.career.galaxy.actors[${index}];
		const sim = r.sim;
		const at = r.at >= 0 ? r.at : 0;
		const mask = r.planetMask || game.career.planetMask;
		const px = tradeSim.planetX;
		const py = tradeSim.planetY;
		const n = (mask && mask.length) || (sim.bodyCount || px.length);
		const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
		const targets = [];
		for (let p = 0; p < n && p < px.length; p++) {
			if (p === at || p === ${avoidTarget} || (mask && mask[p] !== 1)) continue;
			targets.push(p);
		}
		targets.sort((a, b) => Math.hypot(px[a] - px[at], py[a] - py[at]) -
			Math.hypot(px[b] - px[at], py[b] - py[at]));
		for (const target of targets) {
			const angle = Math.atan2(py[target] - py[at], px[target] - px[at]);
			for (const speed of [120, 100, 80, 60]) {
				sim.launch(at, angle, speed);
				for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) sim.stepOne();
				const real = sim.endReason === GravitySim.END_IMPACT && sim.endBody === target;
				sim.clear();
				if (!real) continue;
				sim.launch(at, angle, speed);
				sim.predictFlight(GravityGame.RADAR_BUDGET_MS);
				const ghost = sim.predReason === GravitySim.END_IMPACT && sim.predBody === target;
				sim.clear();
				if (!ghost) continue;
				sim.launch(at, angle, speed);
				GravityGame.careerBeginFlight(r, sim, 0);
				return target;
			}
		}
		return -1;
	})()`, page.context);
	const ownTarget = fly(0);
	assert.ok(ownTarget >= 0, 'the own ship finds a verified shot');
	assert.ok(fly(1, ownTarget) >= 0, 'the rival finds a verified shot');
	const plates = () => page.calls.texts.filter(t => /^\+\d+ s$/.test(t)).length;
	const rest = () => page.calls.texts.filter(t => t === 'landed').length;
	const paint = () => {
		page.calls.texts.length = 0;
		page.calls.textXY.length = 0;
		page.runFrames(1, 16);
	};
	const rivalSim = vm.runInContext('game.career.galaxy.actors[1].sim', page.context);
	const rival2At = vm.runInContext('game.career.galaxy.actors[2].at', page.context);
	const move = pos => page.fireWindow('pointermove',
		{ clientX: pos.x, clientY: pos.y, target: page.elements.get('c'), shiftKey: false });
	/* the box off: the own +N s always draws, the parked third keeps landed */
	paint();
	assert.strictEqual(plates(), 1, 'the own +N s always draws: ' + JSON.stringify(page.calls.texts));
	assert.strictEqual(rest(), 1, 'the parked third company keeps landed: ' + JSON.stringify(page.calls.texts));
	/* hover the flying rival: its plate joins */
	move(page.shipScreen(rivalSim));
	paint();
	assert.strictEqual(plates(), 2, 'hover reveals the rival: ' + JSON.stringify(page.calls.texts));
	/* hovering another ship keeps the first hidden - the reveal is per ship */
	move(page.planetScreen(rival2At));
	paint();
	assert.strictEqual(plates(), 1, 'the reveal follows the pointer: ' + JSON.stringify(page.calls.texts));
	/* press: pointerdown on the ship reveals it until release */
	const at1 = page.shipScreen(rivalSim);
	page.fireWindow('pointerdown',
		{ button: 0, clientX: at1.x, clientY: at1.y, target: page.elements.get('c'), shiftKey: false });
	paint();
	assert.strictEqual(plates(), 2, 'press reveals the rival: ' + JSON.stringify(page.calls.texts));
	page.fireWindow('pointerup',
		{ clientX: at1.x, clientY: at1.y, target: page.elements.get('c'), shiftKey: false });
	paint();
	assert.strictEqual(plates(), 1, 'release hides it again: ' + JSON.stringify(page.calls.texts));
	/* messy view with the box off changes nothing: clean render is out of
	 * the reveal's business (0.7.51) */
	page.toggle('careerClean');
	paint();
	assert.strictEqual(plates(), 1, 'clean off is not a show-all key anymore: ' + JSON.stringify(page.calls.texts));
	assert.strictEqual(rest(), 1);
	page.toggle('careerClean');
	/* the box on: both flying ships draw at once, no hover needed */
	page.toggle('predView');
	paint();
	assert.strictEqual(plates(), 2, 'the predicted box draws every ship: ' + JSON.stringify(page.calls.texts));
	assert.strictEqual(rest(), 1, 'the parked third keeps landed with the box on');
	/* the rival's time mark sits on the landing point it belongs to (0.7.51),
	 * not above the ship's current location */
	const mark = vm.runInContext(`(() => {
		const own = activeSim();
		const record = radarOut.slice(0, radarOutCount)
			.find(r => r.predCount >= 2 && r.sim !== own);
		if (!record) return null;
		const last = record.predCount - 1;
		const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
		return {
			text: '+' + Math.max(0, Math.round(record.tLand)) + ' s',
			markX: clamp(record.predX[last] * view.scale + view.offX, 22, window.innerWidth - 30),
			markY: clamp(record.predY[last] * view.scale + view.offY - 18, 4, window.innerHeight - 14),
			shipX: record.x * view.scale + view.offX,
			shipY: record.y * view.scale + view.offY - 18
		};
	})()`, page.context);
	assert.ok(mark, 'the rival record is pooled');
	const drawn = page.calls.textXY.filter((xy, i) => /^\+\d+ s$/.test(page.calls.texts[i]));
	assert.ok(Math.hypot(mark.markX - mark.shipX, mark.markY - mark.shipY) > 30,
		'the fixture flies the ship away from its landing');
	assert.ok(drawn.some(([x, y]) =>
			Math.abs(x - mark.markX) <= 3 && Math.abs(y - mark.markY) <= 3),
		'the rival +N s plate sits on the landing point: ' + JSON.stringify({ drawn, mark }));
	assert.ok(!drawn.some(([x, y]) =>
			Math.abs(x - mark.shipX) <= 3 && Math.abs(y - mark.shipY) <= 3),
		'no plate hangs above the ship anymore: ' + JSON.stringify({ drawn, mark }));
	/* and it rules in the messy view too - the box works in every state */
	page.toggle('careerClean');
	paint();
	assert.strictEqual(plates(), 2, 'the box shows every ship with clean render off');
	page.toggle('careerClean');
});

check('stacking: overlapping +N s plates stack by landing planet in arrival order', () => {
	const page = loadPage({ search: mapSearch(42) });
	assert.strictEqual(vm.runInContext('careerAct({ act: \'radar\' })', page.context), true);
	/* find one planet that all three companies can reach with verified shots at
	 * distinct arrival times, plus a second planet for the cross-planet check */
	const setup = vm.runInContext(`(() => {
		const actors = game.career.galaxy.actors;
		const mask = game.career.planetMask;
		const px = tradeSim.planetX;
		const py = tradeSim.planetY;
		const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
		const active = [];
		for (let p = 0; p < px.length; p++) if (!mask || mask[p] === 1) active.push(p);
		function shotFromTo(sim, from, target, usedSteps) {
			const base = Math.atan2(py[target] - py[from], px[target] - px[from]);
			for (const off of [0, 0.08, -0.08, 0.16, -0.16]) {
				const angle = base + off;
				for (const speed of [130, 110, 95, 80, 68, 56]) {
					sim.launch(from, angle, speed);
					for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) sim.stepOne();
					const real = sim.endReason === GravitySim.END_IMPACT && sim.endBody === target;
					sim.clear();
					if (!real) continue;
					sim.launch(from, angle, speed);
					sim.predictFlight(GravityGame.RADAR_BUDGET_MS);
					const ok = sim.predReason === GravitySim.END_IMPACT &&
						sim.predBody === target && !usedSteps.has(Math.round(sim.predSteps * GravitySim.DT));
					const sec = Math.round(sim.predSteps * GravitySim.DT);
					sim.clear();
					if (ok && sec > 0) return { from, angle, speed, sec };
				}
			}
			return null;
		}
		for (const target of active) {
			const others = active.filter(p => p !== target && !game.market.empty[p])
				.sort((a, b) => Math.hypot(px[a] - px[target], py[a] - py[target]) -
					Math.hypot(px[b] - px[target], py[b] - py[target]));
			const plans = [];
			const used = new Set();
			for (let i = 0; i < 3 && i < others.length; i++) {
				const found = shotFromTo(actors[i].sim, others[i], target, used);
				if (!found) break;
				used.add(found.sec);
				plans.push(found);
			}
			if (plans.length < 3) continue;
			let altTarget = -1;
			let altPlan = null;
			for (const cand of others.slice(3)) {
				const found = shotFromTo(actors[2].sim, plans[2].from, cand, new Set());
				if (found) { altTarget = cand; altPlan = found; break; }
			}
			if (altTarget < 0) continue;
			for (let i = 0; i < 3; i++) {
				GravityGame.placeShip(actors[i], actors[i].sim, plans[i].from);
				actors[i].sim.launch(plans[i].from, plans[i].angle, plans[i].speed);
				GravityGame.careerBeginFlight(actors[i], actors[i].sim, 0);
			}
			return { target, altTarget, plans, altPlan };
		}
		return null;
	})()`, page.context);
	assert.ok(setup, 'three ships launch toward one shared landing planet');

	const paint = () => {
		page.calls.texts.length = 0;
		page.calls.textXY.length = 0;
		page.runFrames(1, 16);
	};
	const timePlates = () => {
		const out = [];
		for (let i = 0; i < page.calls.texts.length; i++) {
			const m = /^\+(\d+) s$/.exec(page.calls.texts[i]);
			if (m) out.push({ text: page.calls.texts[i], sec: Number(m[1]),
				x: page.calls.textXY[i][0], y: page.calls.textXY[i][1] });
		}
		return out;
	};
	const baseMark = idx => vm.runInContext(`(() => {
		const r = radarOut[${idx}];
		const last = r.predCount - 1;
		const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
		return {
			x: clamp(r.predX[last] * view.scale + view.offX, 22, window.innerWidth - 30),
			y: clamp(r.predY[last] * view.scale + view.offY - 18, 4, window.innerHeight - 14),
			tLand: r.tLand
		};
	})()`, page.context);

	/* 1. predicted OFF: hidden rivals never push the own ship's +N s plate */
	page.toggle('predView');
	paint();
	let drawn = timePlates();
	assert.strictEqual(drawn.length, 1, 'only own plate draws with box off');
	const ownBase = baseMark(0);
	assert.ok(Math.abs(drawn[0].y - ownBase.y) <= 1,
		'hidden rivals do not shift the own plate: ' + JSON.stringify({ drawn, ownBase }));

	/* 2. hover one rival: the two visible plates on the planet stack */
	const rival1Sim = vm.runInContext('game.career.galaxy.actors[1].sim', page.context);
	page.fireWindow('pointermove', {
		clientX: page.shipScreen(rival1Sim).x,
		clientY: page.shipScreen(rival1Sim).y,
		target: page.elements.get('c'), shiftKey: false
	});
	paint();
	drawn = timePlates();
	assert.strictEqual(drawn.length, 2, 'hover adds the hovered rival');
	assert.ok(Math.abs(drawn[0].y - drawn[1].y) >= 16 || Math.abs(drawn[0].x - drawn[1].x) >= 46,
		'hovered pair does not overlap: ' + JSON.stringify(drawn));
	page.fireWindow('pointermove', { clientX: 2, clientY: 2, target: page.elements.get('c'), shiftKey: false });

	/* 3. predicted ON: all three plates on the same planet stack in arrival order */
	page.toggle('predView');
	paint();
	drawn = timePlates();
	assert.strictEqual(drawn.length, 3, 'all three flying ships draw +N s');
	for (let i = 0; i < drawn.length; i++) {
		for (let j = i + 1; j < drawn.length; j++) {
			const noOverlap = Math.abs(drawn[i].x - drawn[j].x) >= 46 ||
				Math.abs(drawn[i].y - drawn[j].y) >= 16;
			assert.ok(noOverlap, 'plates on one planet never overlap: ' + JSON.stringify(drawn));
		}
	}
	/* earliest arrival keeps its landing-point slot; later arrivals step above */
	assert.ok(drawn[0].sec <= drawn[1].sec && drawn[1].sec <= drawn[2].sec,
		'plates draw in ascending arrival order: ' + JSON.stringify(drawn));
	assert.ok(drawn[2].y < drawn[1].y && drawn[1].y < drawn[0].y,
		'later arrivals stack upward above earlier ones: ' + JSON.stringify(drawn));

	/* 4. top-edge fallback: when the planet sits at the top of the viewport,
	 * the stack steps downward instead of collapsing onto y = 4 */
	const savedOffY = vm.runInContext('view.offY', page.context);
	vm.runInContext(`(() => {
		const r = radarOut[0];
		const last = r.predCount - 1;
		view.offY = 22 - r.predY[last] * view.scale;
	})()`, page.context);
	paint();
	drawn = timePlates();
	assert.strictEqual(drawn.length, 3);
	for (let i = 0; i < drawn.length; i++) {
		for (let j = i + 1; j < drawn.length; j++) {
			const noOverlap = Math.abs(drawn[i].x - drawn[j].x) >= 46 ||
				Math.abs(drawn[i].y - drawn[j].y) >= 16;
			assert.ok(noOverlap, 'top-edge fallback keeps plates separate: ' + JSON.stringify(drawn));
		}
	}
	vm.runInContext(`view.offY = ${savedOffY}`, page.context);

	/* 5. by landing planet: a ship aimed at a different planet sits on its own
	 * landing point and does not join the first planet's stack */
	vm.runInContext(`(() => {
		const a2 = game.career.galaxy.actors[2];
		const plan = ${JSON.stringify(setup.altPlan)};
		GravityGame.placeShip(a2, a2.sim, plan.from);
		a2.sim.launch(plan.from, plan.angle, plan.speed);
		GravityGame.careerBeginFlight(a2, a2.sim, 0);
	})()`, page.context);
	paint();
	drawn = timePlates();
	assert.strictEqual(drawn.length, 3);
	const altBase = baseMark(2);
	assert.ok(drawn.some(p => Math.abs(p.x - altBase.x) <= 1 && Math.abs(p.y - altBase.y) <= 1),
		'a ship on another planet keeps its own unstacked landing plate: ' +
		JSON.stringify({ drawn, altBase }));
});

if (failures > 0) {
	console.error(failures + ' failure(s)');
	process.exit(1);
}
console.log('RADAR OK · gate, gift, reveal, memo, bot avoid, page');
