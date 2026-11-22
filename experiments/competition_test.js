/*
 * Sport competitions (0.7.41 plan): the shared timed event on `galaxy.sport`
 * (a solo career keeps its own record on `career.sport`), the mirrored board
 * slot, the 0.50 entry stake feeding the pool, the barrel hold at the event
 * planet until the gun, and the settle rules: a pre-gun launch cannot win, a
 * qualifying flight pays the pool and closes the event, a drop or expiry
 * forfeits the stake. Headless, node-only.
 * Run: node experiments/competition_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityMaps = require(path.join(root, 'saved_map.js'));
const OrbitEcon = require(path.join(root, 'orbit_econ.js'));

const UNIVERSE = 13;
const CAREER = GravityGame.CAREER;
const ENTRY = GravityGame.COMPETE_ENTRY;

let failures = 0;
function check(name, fn) {
	try { fn(); console.log('ok - ' + name); }
	catch (e) { failures++; console.log('FAIL - ' + name + ': ' + e.message); }
}
function finish() {
	if (failures > 0) { console.log(failures + ' failure(s)'); process.exit(1); }
	console.log('COMPETITION OK · shared event, stake pool, gun hold and settle rules');
}

function universe() {
	const mask = new Uint8Array(OrbitWorld.PLANETS).fill(1);
	for (let p = UNIVERSE; p < OrbitWorld.PLANETS; p++) mask[p] = 0;
	return mask;
}

/* a shared world: every career created here joins the one galaxy */
function makeWorld(seed) {
	const trade = new Sim(seed);
	const market = GravityGame.createMarket();
	const mask = universe();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
	GravityGame.applyMarketSpecials(market, trade.world);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, seed);
	GravityGame.bindRun(market, galaxy, trade.world);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	armField(seed, trade, mask, sim);
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, mask, UNIVERSE);
	GravityGame.startCareer(career, sim, seed, trade, null, galaxy);
	sim.bodyCount = UNIVERSE;
	return { trade, market, galaxy, sim, career, step: 0 };
}

/* arm the gravity field a launch needs: the page does this in startGame */
function armField(seed, trade, mask, sim) {
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
	for (let p = 0; p < OrbitWorld.PLANETS; p++) {
		strength[p] = mask[p] ? GravityGame.planetGravity(seed, p) : 0;
	}
	if (GravityGame.specialPlanets()) {
		if (trade.world.capitalPlanet >= 0) strength[trade.world.capitalPlanet] = 1;
		if (trade.world.arfPlanet >= 0) strength[trade.world.arfPlanet] = 1;
	}
	const fill = (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) { ox[i] = trade.planetX[i]; oy[i] = trade.planetY[i]; }
	};
	sim.setField(OrbitWorld.PLANETS, trade.planetR, strength, fill, true);
	sim.fieldT = trade.t;
}

/* a second company on an existing shared world */
function addRival(w, seed) {
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	armField(seed, w.trade, universe(), sim);
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, universe(), UNIVERSE);
	GravityGame.startCareer(career, sim, seed, w.trade, null, w.galaxy);
	sim.bodyCount = UNIVERSE;
	return { sim, career };
}

/* seed a live event by hand: deterministic, no announce draw in the test */
function seedEvent(sport, planet, minLength, pool, startsAt, deadline) {
	sport.kind = GravityGame.TASK_COMPETE;
	sport.discipline = GravityGame.SPORT_LENGTH;
	sport.planet = planet;
	sport.minLength = minLength;
	sport.baseReward = sport.pool = pool;
	sport.startsAt = startsAt;
	sport.deadline = deadline;
	sport.enteredMask = 0;
	sport.attemptedMask = 0;
	sport.winner = -1;
}

/* fake a landing: the flight already flew, only the settle runs */
function land(w, who, from, startStep, length, landStep) {
	const sim = who.sim;
	sim.launch(from, 0, 100);
	GravityGame.careerBeginFlight(who.career, sim, startStep);
	sim.endReason = GravitySim.END_IMPACT;
	sim.endBody = from;
	sim.flightLength = length;
	GravityGame.careerEndFlight(who.career, sim, w.trade, landStep);
}

/* --- 1. the announcement ------------------------------------------------- */

check('a fresh galaxy announces its first event on the first board refresh', () => {
	const w = makeWorld(23);
	const sport = w.galaxy.sport;
	const mirror = w.career.tasks[GravityGame.COMPETE_SLOT];
	/* the career start refreshes at step 0, so the first event is already live */
	assert.strictEqual(sport.kind, GravityGame.TASK_COMPETE, 'start announced no event');
	assert.strictEqual(sport.startsAt, Math.round(GravityGame.ANNOUNCE_SEC / GravitySim.DT),
		'the gun is one announce window after the start');
	/* a fresh idle schedule announces at the refresh step, not at 0 */
	sport.kind = GravityGame.TASK_NONE;
	sport.nextAt = 0;
	GravityGame.refreshBoard(w.career, w.trade, 10);
	assert.strictEqual(sport.kind, GravityGame.TASK_COMPETE, 'no event announced');
	assert.strictEqual(mirror.kind, GravityGame.TASK_COMPETE, 'the board did not mirror');
	assert.strictEqual(mirror.reward, sport.pool, 'the mirror shows the pool');
	assert.strictEqual(mirror.startsAt, sport.startsAt, 'the mirror shows the gun');
	assert.strictEqual(mirror.deadline, sport.deadline, 'the mirror shows the deadline');
	assert.strictEqual(sport.startsAt, 10 + Math.round(GravityGame.ANNOUNCE_SEC / GravitySim.DT),
		'the gun is one announce window out');
	assert.strictEqual(sport.deadline,
		sport.startsAt + Math.round(CAREER.competeSec / GravitySim.DT), 'the deadline span');
	assert.ok(sport.minLength >= CAREER.competeMinPx &&
		sport.minLength <= CAREER.competeMinPx + CAREER.competeSpanPx, 'length band');
	assert.strictEqual(sport.minLength % 50, 0, 'lengths round to 50 px');
	assert.ok(sport.baseReward >= CAREER.competeBase, 'the base reward');
	assert.strictEqual(sport.pool, sport.baseReward, 'the pool starts as the purse');
	assert.ok(sport.planet === -1 ||
		(w.trade.colonies.some(c => c.planet === sport.planet) &&
			universe()[sport.planet] === 1),
		'the planet is a colony inside the universe or none');
	assert.strictEqual(GravityGame.sportMirrorStale(w.career), false,
		'a fresh mirror is not stale');
});

check('the same seed announces the same event: planet, length and purse', () => {
	const fields = seed => {
		const w = makeWorld(seed);
		GravityGame.placeShip(w.career, w.sim, w.career.hq);
		GravityGame.refreshBoard(w.career, w.trade, 0);
		const s = w.galaxy.sport;
		return [s.planet, s.minLength, s.baseReward, s.startsAt, s.deadline].join(':');
	};
	assert.strictEqual(fields(7), fields(7), 'seed parity');
	assert.notStrictEqual(fields(7), fields(8), 'seeds diverge');
});

/* --- 2. entries and the pool --------------------------------------------- */

check('two companies entered put two stakes in the pool', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.hq);
	const rival = addRival(w, 24);
	GravityGame.placeShip(rival.career, rival.sim, host.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	const hostBase = host.ledger.purse;
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT), 'host entry refused');
	assert.ok(Math.abs(host.ledger.purse - (hostBase - ENTRY)) < 1e-9, 'host stake');
	assert.ok(Math.abs(sport.pool - 3) < 1e-9, 'one stake in the pool');
	const rivalBase = rival.career.ledger.purse;
	assert.ok(GravityGame.acceptTask(rival.career, GravityGame.COMPETE_SLOT), 'rival entry refused');
	assert.ok(Math.abs(rival.career.ledger.purse - (rivalBase - ENTRY)) < 1e-9, 'rival stake');
	assert.ok(Math.abs(sport.pool - 3.5) < 1e-9, 'two stakes in the pool');
	assert.strictEqual(sport.enteredMask, 3, 'both companies entered');
	assert.strictEqual(w.career.tasks[GravityGame.COMPETE_SLOT].reward, 3.5,
		'the mirrored purse follows the pool');
	/* both actors keep their own mirrored slot in step */
	for (const career of w.galaxy.actors) {
		assert.strictEqual(career.tasks[GravityGame.COMPETE_SLOT].pool === undefined, true,
			'the mirror stays a view');
		assert.strictEqual(career.tasks[GravityGame.COMPETE_SLOT].reward, 3.5,
			'every actor sees the pool');
	}
});

check('the barrel waits for the gun at the event planet and fires now elsewhere', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	assert.strictEqual(GravityGame.sportHoldStep(host, host.hq, 5), 50,
		'the barrel holds until the gun');
	const other = (host.hq + 1) % UNIVERSE;
	assert.strictEqual(GravityGame.sportHoldStep(host, other, 5), 5,
		'away from the event planet nothing holds');
	assert.strictEqual(GravityGame.sportHoldStep(host, host.hq, 50), 50,
		'at the gun the barrel fires');
	assert.strictEqual(GravityGame.sportHoldStep(host, host.hq, 51), 51,
		'after the gun the barrel fires');
});

/* --- 3. the settle rules -------------------------------------------------- */

check('a flight launched before the gun cannot win', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	const purse = host.ledger.purse;
	land(w, w, host.hq, 5, 3000, 40);
	assert.strictEqual(host.competitions, 0, 'a pre-gun flight wins nothing');
	assert.strictEqual(sport.kind, GravityGame.TASK_COMPETE, 'the event stays open');
	assert.strictEqual(sport.winner, -1, 'no winner recorded');
	assert.ok(Math.abs(host.ledger.purse - purse) < 1e-9, 'the purse did not move');
	assert.strictEqual(host.tasks[GravityGame.COMPETE_SLOT].state, GravityGame.TASK_ACCEPTED,
		'the entry survives a lost attempt');
	/* after the gun the same length wins */
	land(w, w, host.hq, 60, 3000, 90);
	assert.strictEqual(host.competitions, 1, 'the post-gun flight wins');
	assert.strictEqual(sport.kind, GravityGame.TASK_NONE, 'the win closed the event');
});

check('a qualifying flight pays the pool to the winner and closes it for everyone', () => {
	const w = makeWorld(23);
	const host = w.career;
	const rival = addRival(w, 24);
	/* the event sits at the rival's home rail so the winner pays no guest tax */
	GravityGame.placeShip(host, w.sim, rival.career.hq);
	GravityGame.placeShip(rival.career, rival.sim, rival.career.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, rival.career.hq, 300, 2.5, 0, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	assert.ok(GravityGame.acceptTask(rival.career, GravityGame.COMPETE_SLOT));
	const rivalBase = rival.career.ledger.purse;
	land(w, rival, rival.career.hq, 6, 400, 30);
	assert.strictEqual(rival.career.competitions, 1, 'the win counted');
	assert.ok(Math.abs(rival.career.ledger.purse - (rivalBase + 3.5)) < 1e-9,
		'the pool paid out');
	assert.strictEqual(sport.winner, w.galaxy.actors.indexOf(rival.career),
		'the winner is recorded');
	assert.strictEqual(sport.kind, GravityGame.TASK_NONE, 'the event closed');
	assert.ok(sport.nextAt > 30, 'the next event is scheduled');
	assert.strictEqual(sport.pool, 0, 'the pool emptied');
	assert.strictEqual(sport.enteredMask, 0, 'the entries cleared');
	for (const career of w.galaxy.actors) {
		assert.strictEqual(career.tasks[GravityGame.COMPETE_SLOT].kind, GravityGame.TASK_NONE,
			'every mirror closed');
	}
	assert.strictEqual(GravityGame.sportHoldStep(host, host.hq, 31), 31,
		'no hold without a live event');
});

check('a too-short or too-late flight cannot win', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.5, 0, 500);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	const purse = host.ledger.purse;
	land(w, w, host.hq, 6, 299, 30);
	assert.strictEqual(host.competitions, 0, 'a short flight wins nothing');
	assert.strictEqual(sport.kind, GravityGame.TASK_COMPETE, 'the event outlives a loss');
	assert.ok(Math.abs(host.ledger.purse - purse) < 1e-9, 'no payout');
	/* landing after the deadline wins nothing and the board refresh on the
	 * landing settles the expiry: the stake is gone */
	land(w, w, host.hq, 31, 4000, 501);
	assert.strictEqual(host.competitions, 0, 'a late flight wins nothing');
	assert.strictEqual(sport.kind, GravityGame.TASK_NONE, 'a late landing meets the expiry');
	assert.strictEqual(sport.pool, 0, 'the expired pool emptied');
});

/* --- 4. forfeits and the capital refund ----------------------------------- */

check('a drop before the gun forfeits the stake and claws the capital refund back', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.capitalPlanet);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.capitalPlanet, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	const base = host.ledger.purse;
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	assert.ok(Math.abs(host.ledger.purse - (base + 3 - ENTRY)) < 1e-9,
		'the capital refund minus the stake');
	assert.ok(GravityGame.dropTask(host, GravityGame.COMPETE_SLOT));
	assert.ok(Math.abs(host.ledger.purse - (base - ENTRY)) < 1e-9,
		'the drop claws the refund, never the stake');
	assert.strictEqual(host.stakeSpent, ENTRY, 'the stake is spent');
	assert.ok(Math.abs(sport.pool - 3) < 1e-9, 'the stake stays in the pool');
	assert.strictEqual(host.tasks[GravityGame.COMPETE_SLOT].state, GravityGame.TASK_OFFERED,
		'the shared offer reopens');
	assert.strictEqual(sport.enteredMask, 0, 'the entry cleared');
});

check('an expired event forfeits every stake and schedules the next one', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.capitalPlanet);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.capitalPlanet, 300, 2.5, 0, 500);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	const purse = host.ledger.purse;
	GravityGame.refreshBoard(host, w.trade, 501);
	assert.strictEqual(sport.kind, GravityGame.TASK_NONE, 'the event expired');
	assert.strictEqual(sport.pool, 0, 'the pool emptied');
	/* the entry sat at the capital: the refund came with the accept and the
	 * no-show pays it back, so the net loss is exactly the stake */
	assert.ok(Math.abs(host.ledger.purse - (purse - 3)) < 1e-9, 'a no-show pays the refund back');
	assert.strictEqual(host.stakeSpent, ENTRY, 'the stake stays spent');
	assert.ok(sport.nextAt > 501, 'the schedule moved on');
	assert.strictEqual(host.tasks[GravityGame.COMPETE_SLOT].kind, GravityGame.TASK_NONE,
		'the mirror closed');
});

/* --- 5. saves -------------------------------------------------------------- */

check('the event survives the save-shape round-trip', () => {
	const w = makeWorld(23);
	const sport = w.galaxy.sport;
	seedEvent(sport, w.career.hq, 300, 2.5, 50, 10000);
	sport.winner = 0;
	GravityGame.refreshBoard(w.career, w.trade, 5);
	const shapes = GravityMaps.runStateShapes();
	assert.ok(shapes.galaxy.sport, 'the save shape keeps the event');
	assert.deepStrictEqual(Object.keys(shapes.galaxy.sport).sort(), Object.keys(sport).sort(),
		'the shape keeps every event field a live record carries');
	assert.deepStrictEqual(JSON.parse(JSON.stringify(shapes.galaxy.sport)),
		shapes.galaxy.sport, 'a packed event survives the JSON round-trip');
	assert.deepStrictEqual(Object.keys(shapes.career.sport).sort(), Object.keys(w.career.sport).sort(),
		'the career shape keeps the solo record');
	assert.ok('stakeSpent' in shapes.career && 'flightStartStep' in shapes.career,
		'the career shape keeps the sport fields');
});

check('a stale mirror is detectable and a refresh heals it', () => {
	const w = makeWorld(23);
	const sport = w.galaxy.sport;
	seedEvent(sport, w.career.hq, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(w.career, w.trade, 5);
	const mirror = w.career.tasks[GravityGame.COMPETE_SLOT];
	mirror.reward = 9;
	assert.strictEqual(GravityGame.sportMirrorStale(w.career), true, 'the drift is seen');
	GravityGame.refreshBoard(w.career, w.trade, 5);
	assert.strictEqual(mirror.reward, 2.5, 'the refresh healed the mirror');
	assert.strictEqual(GravityGame.sportMirrorStale(w.career), false, 'fresh again');
});

/* --- 6. forecast, escrow, bot solvency & GUI barrel gates (review) ------- */

check('mid-flight careerLandingFacts never credits pool to a pre-gun launch', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.hq);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.5, 50, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT));
	w.sim.launch(host.hq, 0, 80);
	GravityGame.careerBeginFlight(host, w.sim, 10);
	host.flying = true;
	const facts = { cash: 0, credit: 0, leg: 0 };
	GravityGame.careerLandingFacts(facts, host, host.hq, (host.hq + 1) % UNIVERSE,
		200, 200, 30, 60, 0, 80);
	assert.strictEqual(facts.cash, 0, 'pre-gun flight in space cannot forecast pool');
	host.flightStartStep = 50;
	GravityGame.careerLandingFacts(facts, host, host.hq, (host.hq + 1) % UNIVERSE,
		200, 200, 30, 60, 0, 80);
	assert.ok(Math.abs(facts.cash - sport.pool) < 1e-9, 'post-gun flight forecasts pool');
});

check('single-leg careerLegPlan preserves contract escrow when only sport completes', () => {
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.capitalPlanet);
	/* fit hold so a delivery can be accepted at the Capital alongside sport */
	host.ship.hold = OrbitTech.HOLDS[1];
	const deliv = host.tasks[0];
	deliv.kind = GravityGame.TASK_DELIVERY;
	deliv.state = GravityGame.TASK_OFFERED;
	deliv.from = (host.hq + 1) % UNIVERSE;
	deliv.to = (host.hq + 2) % UNIVERSE;
	deliv.tons = 4;
	deliv.reward = 2;
	deliv.deadline = 10000;
	const sport = w.galaxy.sport;
	seedEvent(sport, host.hq, 300, 2.0, 0, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	assert.ok(GravityGame.acceptTask(host, 0), 'accepted delivery at Capital');
	assert.ok(GravityGame.acceptTask(host, GravityGame.COMPETE_SLOT), 'accepted sport at Capital');
	assert.strictEqual(GravityGame.careerRefundEscrow(host), 6, 'both refunds in escrow');
	GravityGame.placeShip(host, w.sim, host.hq);
	host.ledger.purse = 2.5;
	w.sim.setPlanets(OrbitWorld.PLANETS, w.trade.planetX, w.trade.planetY, w.trade.planetR,
		w.trade.orbitRX, w.trade.orbitRY, w.trade.orbitTiltCos, w.trade.orbitTiltSin);
	w.sim.setPlanetMask(universe());
	const out = GravityGame.createLegPlan();
	const opts = { exitSpeedFn: () => 60 };
	/* landing back on owned HQ has exit cost 0, isolating the remaining +3 delivery escrow */
	GravityGame.careerLegPlan(out, host, w.market, w.sim, {
		origin: host.hq, body: host.hq, speed: 60, steps: 40, length: 400, visitPay: 0, fee: 0
	}, 10, opts);
	assert.strictEqual(out.feasible, false,
		'purse 2.5 < remaining 3.0 delivery escrow must reject hop');
	host.ledger.purse = 3.5;
	GravityGame.careerLegPlan(out, host, w.market, w.sim, {
		origin: host.hq, body: host.hq, speed: 60, steps: 40, length: 400, visitPay: 0, fee: 0
	}, 10, opts);
	assert.strictEqual(out.feasible, true,
		'purse 3.5 >= remaining 3.0 delivery escrow allows hop');
});

check('bot careerRaceEntry refuses stake when remaining purse cannot cover rail fee', () => {
	const GravityBot = require(path.join(root, 'gravity_bot.js'));
	const w = makeWorld(23);
	const host = w.career;
	GravityGame.placeShip(host, w.sim, host.arfPlanet);
	const sport = w.galaxy.sport;
	seedEvent(sport, host.arfPlanet, 300, 3.0, 0, 10000);
	GravityGame.refreshBoard(host, w.trade, 5);
	const bot = new GravityBot();
	const plan = { origin: host.arfPlanet, body: host.hq, angle: 0, speed: 70,
		length: 500, steps: 40, fee: 1.4, cashNet: 0.2, exitCost: 0 };
	host.ledger.purse = 1.6;
	assert.strictEqual(bot.careerRaceEntry(host, w.sim, plan, 5), false,
		'1.60 - 0.50 stake < 1.40 fee must refuse entry');
	host.ledger.purse = 2.5;
	assert.strictEqual(bot.careerRaceEntry(host, w.sim, plan, 5), true,
		'2.50 - 0.50 stake covers 1.40 fee and enters');
});

check('GUI careerAct allows late race accept (re-floors barrel) and race drop (cancels barrel)', () => {
	const vm = require('vm');
	const { loadPage, mapSearch } = require('./dom_stub.js');
	const page = loadPage({ search: mapSearch(3) + '&bot=off' });
	const ctx = page.context;
	const career = ctx.GravityScene.career;
	const sport = ctx.GravityScene.game.galaxy.sport;
	seedEvent(sport, career.hq, 300, 3.0, 500, 5000);
	ctx.GravityGame.refreshBoard(career, ctx.tradeSim, ctx.GravityScene.game.clockSteps);
	vm.runInContext('aimBody = game.career.hq; aimAngle = 0.5; aimSpeed = 60; armed = true; queueTurretShot();', ctx);
	const beforeFireAt = vm.runInContext('turret.fireAt', ctx);
	assert.ok(beforeFireAt < 500, 'unentered shot queues before gun');
	ctx.careerAct({ act: 'accept', slot: String(GravityGame.COMPETE_SLOT) });
	assert.strictEqual(career.tasks[GravityGame.COMPETE_SLOT].state, GravityGame.TASK_ACCEPTED,
		'careerAct accepted COMPETE_SLOT while barrel pending');
	const heldFireAt = vm.runInContext('turret.fireAt', ctx);
	assert.ok(heldFireAt >= 500, 'late accept re-floored queued barrel to >= startsAt');
	ctx.careerAct({ act: 'drop', slot: String(GravityGame.COMPETE_SLOT) });
	assert.strictEqual(career.tasks[GravityGame.COMPETE_SLOT].state, GravityGame.TASK_OFFERED,
		'careerAct dropped COMPETE_SLOT while barrel held');
	assert.strictEqual(vm.runInContext('turret.pending', ctx), false,
		'dropping COMPETE_SLOT canceled the held barrel');
});

finish();
