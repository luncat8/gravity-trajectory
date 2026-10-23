/*
 * Bot competitor & planet-profit market benchmark (0.3.2 + 0.3.3).
 *
 * 1. per-planet growing profit curve, estimateProfit === stepHarvest parity,
 *    and 4-archetype balance sweep (lazy/casual go broke; blind loses to
 *    profit-aware rivals; smart wins by routing near long-unvisited planets)
 * 2. difficulty ladder across tour and money; route checks same-start
 *    prefix monotonicity and aggregate search gains, plus rivalLink replay
 * 3. sliced stepJob vs synchronous chooseSync exact identity + zero allocation
 * 4. decision latency & per-slice wall budget
 * 5. contested race cross-cadence replay invariance (144 Hz, jitter, x16, skip)
 *
 * Run: node experiments/bot_bench.js
 */
'use strict';

const path = require('path');
const { performance } = require('perf_hooks');
const root = path.join(__dirname, '..');
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));
const { loadPage } = require('./dom_stub.js');

const PLANETS = Sim.PLANETS;
const DT = GravitySim.DT;
const END_IMPACT = GravitySim.END_IMPACT;
const END_EXIT = GravitySim.END_EXIT;
const STATUS_FLYING = GravitySim.STATUS_FLYING;
const SEEDS = [7, 31, 42, 913];

let failures = 0;

function check(ok, message) {
	if (ok) return;
	failures += 1;
	console.log('FAIL:', message);
}

const worldCache = new Map();
function buildStaticWorld(seed) {
	let trade = worldCache.get(seed);
	if (!trade) {
		trade = new Sim(seed);
		trade.advanceTo(420);
		worldCache.set(seed, trade);
	}
	const sim = new GravitySim(Sim.WORLD_W, Sim.WORLD_H);
	const strength = new Float64Array(PLANETS).fill(1);
	const fillPlanets = function (t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	};
	sim.setPlanets(
		PLANETS,
		trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY,
		trade.orbitTiltCos, trade.orbitTiltSin
	);
	sim.setField(PLANETS, trade.planetR, strength, fillPlanets, true);
	return { trade, sim, strength, fillPlanets };
}

/* 1. economy curve, estimateProfit parity, and 4-archetype balance */
function benchEconomy() {
	const m = GravityGame.createMarket();
	const p0 = GravityGame.planetProfit(m, 0, 0);
	check(Math.abs(p0 - 0.25) < 1e-12, 'initial planet profit expected 0.25, got ' + p0);
	m.lastVisitStep[0] = 600;
	check(GravityGame.planetProfit(m, 0, 600) === 0, 'freshly visited planet must pay 0');
	const after8s = GravityGame.planetProfit(m, 0, 600 + 8 * 120);
	const after80s = GravityGame.planetProfit(m, 0, 600 + 80 * 120);
	const after200s = GravityGame.planetProfit(m, 0, 600 + 200 * 120);
	check(Math.abs(after8s - 0.05) < 1e-12, '8s unvisited profit expected 0.05, got ' + after8s);
	check(Math.abs(after80s - 0.50) < 1e-12, '80s unvisited profit expected 0.50, got ' + after80s);
	check(Math.abs(after200s - GravityGame.MONEY.cap) < 1e-12, 'cap profit expected 0.75, got ' + after200s);

	/* exact parity between estimateProfit (from predictFast) and live stepHarvest */
	const { sim } = buildStaticWorld(31);
	let worstDiff = 0;
	let checked = 0;
	let runStep = 360;
	const baseMarket = GravityGame.createMarket();
	for (let i = 0; i < PLANETS; i++) baseMarket.lastVisitStep[i] = -i * 400;

	for (let origin = 0; origin < PLANETS; origin += 2) {
		for (let a = 0; a < 16; a++) {
			const angleU = GravityGame.angleUnits((a + 0.35) / 16 * Math.PI * 2);
			const speedU = GravityGame.speedUnits(110 + (a % 4) * 45);
			const angle = GravityGame.angleOf(angleU);
			const speed = GravityGame.speedOf(speedU);

			const mEst = GravityGame.createMarket();
			mEst.lastVisitStep.set(baseMarket.lastVisitStep);
			sim.clear();
			sim.predictFast(origin, angle, speed, 45);
			const est = GravityGame.estimateProfit(mEst, runStep, sim);

			const mLive = GravityGame.createMarket();
			mLive.lastVisitStep.set(baseMarket.lastVisitStep);
			const ledger = GravityGame.createLedger();
			sim.clear();
			sim.stepLimit = Math.round(45 / DT);
			sim.limitReason = GravitySim.END_TIME;
			sim.launch(origin, angle, speed);
			GravityGame.beginFlight(ledger, sim);
			let step = runStep;
			while (sim.status === STATUS_FLYING) {
				step += 1;
				sim.stepOne();
				GravityGame.stepHarvest(ledger, mLive, sim, step);
			}
			const earned = GravityGame.endFlight(ledger);
			const diff = Math.abs(est - earned);
			check(Number.isFinite(diff), 'non-finite diff');
			if (diff > worstDiff) worstDiff = diff;
			checked += 1;
		}
	}
	check(worstDiff < 1e-12, 'estimateProfit vs live stepHarvest drift ' + worstDiff);
	console.log('1a. market curve & parity:', checked, 'flights, max |estimateProfit - stepHarvest| =',
		worstDiff.toExponential(1));

	/* 4 player archetypes vs normal rival in money (10 shots) and tour */
	function runArchetype(seed, ruleName, style, withRival) {
		const { trade, sim } = buildStaticWorld(seed);
		const probe = new GravitySim(Sim.WORLD_W, Sim.WORLD_H);
		const strength = new Float64Array(PLANETS).fill(1);
		const fill = function (t, outX, outY, count) {
			for (let i = 0; i < count; i++) {
				outX[i] = trade.planetX[i];
				outY[i] = trade.planetY[i];
			}
		};
		probe.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
		probe.setField(PLANETS, trade.planetR, strength, fill, true);

		const bot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
		bot.attachWorld(trade);
		bot.reset(seed, ruleName, withRival ? GravityGame.BOT_NORMAL : GravityGame.BOT_OFF);

		const market = GravityGame.createMarket();
		const ledger = GravityGame.createLedger();
		const rSpec = GravityGame.RULES[ruleName];
		let step = 0;
		let shots = 0;
		let doneSteps = -1;
		let origin = seed % PLANETS;

		while (ledger.purse >= GravityGame.MONEY.cost && shots < (rSpec.maxShots || 16)) {
			if (rSpec.stopOnTour && doneSteps >= 0) break;
			const angles = style === 'lazy' ? 18 : style === 'casual' ? 24 : 36;
			const speeds = style === 'lazy' ? [130, 190]
				: style === 'casual' ? [110, 160, 210]
				: [85, 125, 165, 215, 265];
			const horizon = style === 'lazy' ? 10 : style === 'casual' ? 14 : 48;

			let best = null;
			for (let a = 0; a < angles; a++) {
				const angleU = GravityGame.angleUnits((a + 0.5) / angles * Math.PI * 2);
				const angle = GravityGame.angleOf(angleU);
				for (let s = 0; s < speeds.length; s++) {
					const speedU = GravityGame.speedUnits(speeds[s]);
					const speed = GravityGame.speedOf(speedU);
					probe.visited.set(sim.visited);
					probe.predictFast(origin, angle, speed, horizon);
					if (probe.predReason === END_EXIT) continue;
					const lands = probe.predReason === END_IMPACT && probe.predBody !== origin;
					const completes = rSpec.stopOnTour &&
						(sim.visitedCount + probe.predNewVisits >= PLANETS);
					if (!lands && !completes) continue;
					const profit = GravityGame.estimateProfit(market, step, probe);
					let score = 0;
					if (style === 'lazy') {
						score = -probe.predTime;
					} else if (style === 'casual') {
						score = (probe.predNewVisits <= 2 ? probe.predNewVisits * 6 : -10) - probe.predTime * 0.5;
					} else if (style === 'blindTour') {
						score = probe.predNewVisits * 12 - probe.predTime * 0.25;
					} else {
						const solvent = ledger.purse - 1 + profit >= 1 || completes ? 0 : -300;
						score = solvent + (completes ? 500 : 0) +
							profit * (ruleName === 'money' ? 32 : 20) +
							probe.predNewVisits * (ruleName === 'money' ? 2 : 12) - probe.predTime * 0.14;
					}
					if (!best || score > best.score) best = { angleU, speedU, score };
				}
			}
			if (!best) break;
			shots += 1;
			sim.stepLimit = rSpec.capSteps;
			sim.limitReason = GravitySim.END_TIME;
			sim.launch(origin, GravityGame.angleOf(best.angleU), GravityGame.speedOf(best.speedU));
			GravityGame.beginFlight(ledger, sim);
			while (sim.status === STATUS_FLYING) {
				bot.prepareStep(step, market, rSpec.capSteps, 1e9, true);
				step += 1;
				sim.stepOne();
				GravityGame.stepHarvest(ledger, market, sim, step);
				if (rSpec.stopOnTour && sim.visitedCount === PLANETS && doneSteps < 0) doneSteps = step;
				bot.stepOne(step, market);
			}
			GravityGame.endFlight(ledger);
			if (sim.landedBody >= 0) origin = sim.landedBody;
		}
		if (withRival && ((ledger.purse < 1 && !(rSpec.stopOnTour && doneSteps >= 0)) ||
			(rSpec.maxShots > 0 && shots >= rSpec.maxShots))) {
			step = bot.settle(step, market, rSpec.capSteps);
		}
		return {
			purse: ledger.purse,
			visited: sim.visitedCount,
			shots,
			steps: doneSteps >= 0 ? doneSteps : step,
			rival: withRival ? bot.actorSummary(0) : null
		};
	}

	let lazyBroke = 0;
	let casualBroke = 0;
	let blindLostMoney = 0;
	let smartWonMoney = 0;
	let smartFinishedTour = 0;
	for (const seed of SEEDS) {
		const lazy = runArchetype(seed, 'tour', 'lazy', false);
		const casual = runArchetype(seed, 'tour', 'casual', false);
		const blindM = runArchetype(seed, 'money', 'blindTour', true);
		const smartM = runArchetype(seed, 'money', 'smart', true);
		const smartT = runArchetype(seed, 'tour', 'smart', false);
		if (lazy.purse < 1 && lazy.visited < PLANETS) lazyBroke += 1;
		if (casual.purse < 1 && casual.visited < PLANETS) casualBroke += 1;
		if (GravityGame.compareScores('money', blindM, blindM.rival) < 0) blindLostMoney += 1;
		if (GravityGame.compareScores('money', smartM, smartM.rival) > 0) smartWonMoney += 1;
		if (smartT.visited === PLANETS) smartFinishedTour += 1;
	}
	check(lazyBroke === SEEDS.length, 'lazy archetype should go broke on all seeds: ' + lazyBroke);
	check(casualBroke >= 3, 'casual short-hop archetype should go broke on >=3/4 seeds: ' + casualBroke);
	check(blindLostMoney >= 3, 'profit-blind player should lose money mode to normal rival: ' + blindLostMoney);
	check(smartWonMoney >= 3, 'profit-aware smart player should beat normal rival in money mode: ' + smartWonMoney);
	check(smartFinishedTour === SEEDS.length, 'smart player should complete 26/26 tour on all seeds: ' + smartFinishedTour);
	console.log('1b. balance (4 seeds): lazy broke ' + lazyBroke + '/4 · casual broke ' + casualBroke +
		'/4 · blind lost money ' + blindLostMoney + '/4 · smart won money ' + smartWonMoney +
		'/4 · smart 26/26 tour ' + smartFinishedTour + '/4');
}

/* bot summaries power the score rows; in route they expose the current plan */
function benchScoreSummary() {
	const { trade } = buildStaticWorld(42);
	const bot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
	bot.attachWorld(trade);
	for (const rule of ['tour', 'route', 'money']) {
		bot.reset(42, rule, GravityGame.BOT_EASY);
		check(bot.rule === rule && bot.count === 1, 'bot did not bind to ' + rule);
	}
	bot.reset(42, GravityGame.RULE_ROUTE, GravityGame.BOT_EASY, GravityGame.PLAYER_BOT);
	const rival = bot.rivals[0];
	const player = bot.player;
	check(bot.routeOccupiedBy(rival.routeOrigin, true) === 0 &&
		bot.routeOccupiedBy(player.routeOrigin, true) === GravityBot.PLAYER_INDEX &&
		rival.routeOrigin !== player.routeOrigin,
		'route bot actors do not claim distinct start planets');

	let ticks = 0;
	while (!rival.routeReady && ticks < 500) {
		bot.tickRoute(3);
		ticks += 1;
	}
	let summary = bot.actorSummary(0);
	check(summary.ready && summary.origin === rival.routeOrigin &&
		summary.length === rival.routeLength && summary.steps === rival.routeSteps &&
		summary.shots === 1 && rival.sim.status !== STATUS_FLYING,
		'route score does not expose the rival current traced plan');

	bot.settle(0, GravityGame.createMarket(), GravityGame.RULES.route.capSteps);
	summary = bot.actorSummary(0);
	const playerSummary = bot.actorSummary(GravityBot.PLAYER_INDEX);
	check(summary.ready && summary.done && summary.length > 1000 &&
		playerSummary.ready && playerSummary.done && playerSummary.length > 0 &&
		playerSummary.shots === 1 && player.sim.status !== STATUS_FLYING,
		'route rivals/YOU-bot did not settle to one finished plan each');
	check(GravityGame.compareScores('route',
		{ length: 100, visited: 0, purse: 0, shots: 1, steps: 999 },
		{ length: 99, visited: 26, purse: 99, shots: 1, steps: 1 }) > 0 &&
		GravityGame.compareScores('route',
			{ length: 100.4, visited: 0, purse: 0, shots: 1, steps: 999 },
			{ length: 100, visited: 26, purse: 99, shots: 1, steps: 1 }) === 0,
		'route comparison is not trajectory length only');
	console.log('rule-aware bots: tour, route, money · route plans rival',
		summary.length.toFixed(1), 'px · YOU-bot', playerSummary.length.toFixed(1),
		'px · no route flights');
}

/* 2. bot difficulty ladder across rules + rivalLink replay verification */
function benchLadder() {
	function runSoloBot(seed, ruleName, level) {
		const { trade } = buildStaticWorld(seed);
		const bot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
		bot.attachWorld(trade);
		bot.reset(seed, ruleName, level);
		const market = GravityGame.createMarket();
		const capSteps = GravityGame.RULES[ruleName].capSteps;
		bot.settle(0, market, capSteps);
		/* best rival summary (hard has 2 rivals) */
		let best = bot.actorSummary(0);
		for (let i = 1; i < bot.count; i++) {
			const cand = bot.actorSummary(i);
			if (GravityGame.compareScores(ruleName, cand, best) > 0) best = cand;
		}
		return { best, link: bot.rivalLink(seed, 2, 0), r0: bot.actorSummary(0) };
	}

	for (const ruleName of ['tour', 'route', 'money']) {
		let hardBeatsEasy = 0;
		let normalBeatsEasy = 0;
		let routeMonotonic = 0;
		let routeTotals = { easy: 0, normal: 0, hard: 0 };
		const summary = [];
		for (const seed of SEEDS) {
			const easy = runSoloBot(seed, ruleName, GravityGame.BOT_EASY);
			const normal = runSoloBot(seed, ruleName, GravityGame.BOT_NORMAL);
			const hard = runSoloBot(seed, ruleName, GravityGame.BOT_HARD);
			if (GravityGame.compareScores(ruleName, hard.best, easy.best) > 0) hardBeatsEasy += 1;
			if (GravityGame.compareScores(ruleName, normal.best, easy.best) > 0) normalBeatsEasy += 1;
			if (ruleName === 'route') {
				if (easy.r0.origin === normal.r0.origin && normal.r0.origin === hard.r0.origin &&
					normal.r0.length + 0.5 >= easy.r0.length &&
					hard.r0.length + 0.5 >= normal.r0.length) routeMonotonic += 1;
				routeTotals.easy += easy.r0.length;
				routeTotals.normal += normal.r0.length;
				routeTotals.hard += hard.best.length;
				summary.push('s' + seed + ' E:' + Math.round(easy.best.length) + 'px' +
					' N:' + Math.round(normal.best.length) + 'px' +
					' H:' + Math.round(hard.best.length) + 'px');
			} else {
				summary.push('s' + seed + ' E:' + easy.best.visited + '/$' + easy.best.purse.toFixed(1) +
					' N:' + normal.best.visited + '/$' + normal.best.purse.toFixed(1) +
					' H:' + hard.best.visited + '/$' + hard.best.purse.toFixed(1));
			}

			/* verify rivalLink replays cleanly on seed 7 */
			if (seed === 7) {
				const page = loadPage({ hash: '#' + normal.link });
				page.runFrames(1, 16.7);
				page.click('replaySkip');
				page.runFrames(1, 16.7);
				const verdict = page.elements.get('replayReadout').textContent;
				check(verdict.startsWith('verified ✓'),
					'rivalLink replay failed for ' + ruleName + ': ' + verdict);
			}
		}
		check(hardBeatsEasy >= 3, 'hard must beat easy on >=3/4 seeds in ' + ruleName + ' (' + hardBeatsEasy + ')');
		if (ruleName === 'route') {
			check(routeMonotonic === SEEDS.length,
				'route levels are not prefix-monotonic for the same start planet (' + routeMonotonic + '/4)');
			check(routeTotals.normal > routeTotals.easy && routeTotals.hard > routeTotals.normal,
				'route aggregate lengths do not improve with search depth: ' + JSON.stringify(routeTotals));
		} else {
			check(normalBeatsEasy >= 3, 'normal must beat easy on >=3/4 seeds in ' + ruleName + ' (' + normalBeatsEasy + ')');
		}
		console.log('2. ladder [' + ruleName + ']: hard>easy ' + hardBeatsEasy + '/4, normal>easy ' +
			normalBeatsEasy + '/4 · ' + summary.join(' | '));
	}
}

/* 3 & 4. sliced stepJob vs chooseSync identity, zero allocation, and slice timing */
function benchSlicesAndPerf() {
	const { trade } = buildStaticWorld(42);
	let checks = 0;
	let worstSliceMs = 0;
	const decisionMs = { easy: 0, normal: 0, hard: 0 };

	for (const level of [GravityGame.BOT_EASY, GravityGame.BOT_NORMAL, GravityGame.BOT_HARD]) {
		const syncBot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
		const sliceBot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
		syncBot.attachWorld(trade);
		sliceBot.attachWorld(trade);

		for (const ruleName of ['tour', 'money']) {
			syncBot.reset(42, ruleName, level);
			sliceBot.reset(42, ruleName, level);
			const market = GravityGame.createMarket();
			for (let p = 0; p < PLANETS; p++) market.lastVisitStep[p] = -(p * 310);

			const t0 = performance.now();
			const want = syncBot.chooseSync(0, 480, market);
			decisionMs[level] = Math.max(decisionMs[level], performance.now() - t0);

			/* run sliceBot 1 candidate at a time first to torture-test state resumption */
			sliceBot.beginJob(0, 480, market);
			let guard = 0;
			while (!sliceBot.stepJob(100, 1) && guard++ < 5000) {}
			const got = sliceBot.rivals[0];
			check(got.planOrigin === want.origin &&
				got.planAngleU === want.angle &&
				got.planSpeedU === want.speed,
				'1-candidate slice mismatch in ' + level + '/' + ruleName);
			checks += 1;

			/* measure production 24-candidate / 3 ms slices */
			sliceBot.reset(42, ruleName, level);
			sliceBot.beginJob(0, 480, market);
			while (sliceBot.thinking()) {
				const st = performance.now();
				sliceBot.stepJob(3, GravityBot.SLICE_CANDIDATES);
				const dt = performance.now() - st;
				if (dt > worstSliceMs) worstSliceMs = dt;
			}
		}
	}

	/* buffer identity preservation across an entire hard race */
	const allocBot = new GravityBot(Sim.WORLD_W, Sim.WORLD_H);
	allocBot.attachWorld(trade);
	allocBot.reset(31, 'money', GravityGame.BOT_HARD);
	const refs = [
		allocBot.probe, allocBot.probe.predLogPlanet, allocBot.probe.predLogStep,
		allocBot.rivals[0].sim, allocBot.rivals[1].sim,
		allocBot.rivals[0].ledger.inside, allocBot.lookMarket.lastVisitStep,
		allocBot.savedVisited, allocBot.topScore, allocBot.topAngleU
	];
	const market = GravityGame.createMarket();
	allocBot.settle(0, market, GravityGame.CAP_STEPS);
	const afterRefs = [
		allocBot.probe, allocBot.probe.predLogPlanet, allocBot.probe.predLogStep,
		allocBot.rivals[0].sim, allocBot.rivals[1].sim,
		allocBot.rivals[0].ledger.inside, allocBot.lookMarket.lastVisitStep,
		allocBot.savedVisited, allocBot.topScore, allocBot.topAngleU
	];
	for (let i = 0; i < refs.length; i++) {
		check(refs[i] === afterRefs[i], 'bot reallocated buffer #' + i);
	}
	check(worstSliceMs < 10, 'worst bot slice exceeded 10 ms: ' + worstSliceMs.toFixed(2));
	console.log('3 & 4. slices & perf:', checks, 'exact 1-cand === sync matches · buffers 0-alloc ·',
		'full decision easy/normal/hard =',
		decisionMs.easy.toFixed(2) + '/' + decisionMs.normal.toFixed(2) + '/' + decisionMs.hard.toFixed(2) +
		' ms · worst 64-cand slice ' + worstSliceMs.toFixed(2) + ' ms');
}

/* 5. contested race cross-cadence replay invariance */
function raceFingerprint(page) {
	const sc = page.context.GravityScene;
	const g = sc.game;
	const b = sc.bot;
	const parts = [
		sc.sim.cargo.x, sc.sim.cargo.y, sc.sim.visitedCount, g.steps, g.clockSteps,
		g.money.purse.toFixed(6), Array.from(g.market.lastVisitStep).join(',')
	];
	for (let i = 0; i < b.count; i++) {
		const r = b.rivals[i];
		parts.push(r.sim.visitedCount, r.steps, r.shots.length, r.ledger.purse.toFixed(6));
	}
	return parts.join('|');
}

function benchContestedReplay() {
	const page = loadPage({ hash: '#game=1&seed=31&rate=3&rule=money&bot=hard' });
	const sc = page.context.GravityScene;
	const cargo = sc.sim;
	page.runFrames(4, 16.7);
	for (let i = 0; i < 3; i++) page.click('playFaster');

	for (let shotIdx = 0; shotIdx < 3; shotIdx++) {
		const origin = cargo.landedBody >= 0 ? cargo.landedBody : 0;
		const keepH = cargo.horizon;
		cargo.horizon = 16;
		let pick = null;
		for (let a = 0; a < 24; a++) {
			const angle = (a + 0.4) / 24 * Math.PI * 2;
			for (const speed of [120, 175, 230]) {
				cargo.predict(origin, angle, speed);
				if (cargo.predReason === END_IMPACT && cargo.predBody !== origin) {
					const gain = GravityGame.estimateProfit(sc.game.market, sc.game.clockSteps, cargo);
					const score = gain * 20 + cargo.predNewVisits;
					if (!pick || score > pick.score) pick = { origin, angle, speed, score };
				}
			}
		}
		cargo.horizon = keepH;
		page.dragAim(pick.origin, pick.angle, pick.speed);
		page.runFrames(2, 16.7);
		page.click('launch');
		let guard = 0;
		while (cargo.status === STATUS_FLYING && guard++ < 5000) page.runFrames(1, 16.7);
	}
	page.runFrames(2, 16.7);
	page.click('gameCopy');
	const link = page.clipboardText;
	check(link.includes('&rule=money&bot=hard&shots='), 'contested link missing rule/bot: ' + link);
	const expected = raceFingerprint(page);

	function runReplay(mode) {
		const rp = loadPage({ hash: link.slice(link.indexOf('#')) });
		if (mode === 'skip') {
			rp.runFrames(1, 16.7);
			rp.click('replaySkip');
		} else if (mode === '144hz') {
			rp.click('replaySpeed');
			rp.click('replaySpeed');
			let g = 0;
			while (rp.context.GravityScene.replay.on && g++ < 50000) rp.runFrames(1, 1000 / 144);
		} else {
			rp.click('replaySpeed');
			let g = 0;
			while (rp.context.GravityScene.replay.on && g++ < 50000) {
				rp.runFrames(1, 5 + (g % 7) * 6.1);
			}
		}
		rp.runFrames(1, 16.7);
		return {
			fp: raceFingerprint(rp),
			verdict: rp.elements.get('replayReadout').textContent
		};
	}

	for (const mode of ['144hz', 'jitter', 'skip']) {
		const got = runReplay(mode);
		check(got.fp === expected, 'contested replay ' + mode + ' diverged:\n  ' + got.fp + '\n  ' + expected);
		check(got.verdict.startsWith('verified ✓'), 'contested replay ' + mode + ' verdict: ' + got.verdict);
	}
	console.log('5. contested race replay (money + hard 2 rivals): 60 Hz === 144 Hz x16 === jitter === skip ·',
		link.slice(link.indexOf('#')));
}

benchEconomy();
benchScoreSummary();
benchLadder();
benchSlicesAndPerf();
benchContestedReplay();

if (failures > 0) {
	console.error('BOT BENCH FAILED (' + failures + ' failures)');
	process.exit(1);
}
console.log('BOT BENCH OK');
