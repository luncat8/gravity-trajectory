/*
 * Deterministic rival competitors (0.3.3).
 *
 * Rivals fly in the same seeded system on the exact integer step clock and
 * harvest from the shared planet-profit market (`GravityGame.stepHarvest`), so
 * planets drained by a rival drop to +0.00 on the canvas and push the player
 * toward long-unvisited systems. Candidate search runs as a sliced background
 * job with zero per-candidate allocations, and drains synchronously when a
 * step boundary requires an immediate launch or replay skip.
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js')
		: root.GravityGame;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;

	const PLANETS = OrbitWorld.PLANETS;
	const MAX_RIVALS = 2;
	const TOP_K = 4;
	const MAX_BOT_SHOTS = 16;
	const SLICE_CANDIDATES = 64;
	const LOOKAHEAD_SPEED = 175;
	const LOOKAHEAD_HORIZON = 12;
	const LOOKAHEAD_WEIGHT = 0.45;
	const STATUS_FLYING = GravitySim.STATUS_FLYING;
	const END_IMPACT = GravitySim.END_IMPACT;
	const END_EXIT = GravitySim.END_EXIT;
	const END_TIME = GravitySim.END_TIME;
	const MONEY = GravityGame.MONEY;

	const LEVELS = {
		off: {
			name: GravityGame.BOT_OFF,
			count: 0,
			angles: 0,
			speeds: [],
			horizon: 0,
			routeHorizon: 0,
			lookahead: 0,
			stageSteps: 0
		},
		easy: {
			name: GravityGame.BOT_EASY,
			count: 1,
			angles: 14,
			speeds: [140, 220],
			horizon: 12,
			routeHorizon: 16,
			lookahead: 0,
			stageSteps: 180
		},
		normal: {
			name: GravityGame.BOT_NORMAL,
			count: 1,
			angles: 24,
			speeds: [115, 175, 245],
			horizon: 18,
			routeHorizon: 24,
			lookahead: 0,
			stageSteps: 120
		},
		hard: {
			name: GravityGame.BOT_HARD,
			count: 2,
			angles: 32,
			speeds: [105, 160, 215, 275],
			horizon: 22,
			routeHorizon: 30,
			lookahead: 8,
			stageSteps: 60
		}
	};

	function createRival(worldW, worldH) {
		return {
			sim: new GravitySim(worldW, worldH),
			ledger: GravityGame.createLedger(),
			shots: [],
			steps: 0,
			doneSteps: -1,
			length: 0,
			basePlanet: 0,
			readyStep: 0,
			planReady: false,
			planStep: -1,
			planStamp: -1,
			planOrigin: 0,
			planAngleU: 0,
			planSpeedU: 0
		};
	}

	function GravityBot(worldW, worldH) {
		this.worldW = worldW;
		this.worldH = worldH;
		this.tradeSim = null;
		this.probe = new GravitySim(worldW, worldH);
		this.strength = new Float64Array(PLANETS).fill(1);
		this.rivals = [createRival(worldW, worldH), createRival(worldW, worldH)];

		this.level = GravityGame.BOT_OFF;
		this.rule = GravityGame.RULE_TOUR;
		this.seed = 1;
		this.count = 0;

		/* preallocated scratch buffers for 1-ply lookahead: zero per-candidate allocs */
		this.lookMarket = GravityGame.createMarket();
		this.savedVisited = new Uint8Array(GravitySim.MAX_BODIES);
		this.topScore = new Float64Array(TOP_K);
		this.topAngleU = new Int32Array(TOP_K);
		this.topSpeedU = new Int32Array(TOP_K);
		this.topBody = new Int32Array(TOP_K);
		this.topSteps = new Int32Array(TOP_K);
		this.topCount = 0;

		/* sliced search job state */
		this.jobActive = false;
		this.jobRival = -1;
		this.jobRunStep = 0;
		this.jobStamp = -1;
		this.jobMarket = null;
		this.jobOrigin = 0;
		this.jobPhase = 0;
		this.jobIndex = 0;
		this.jobPrimaryTotal = 0;
		this.jobLookTotal = 0;
		this.jobHorizon = 18;
		this.lookBest = 0;
		this.bestScore = -Infinity;
		this.bestAngleU = 0;
		this.bestSpeedU = 0;

		const self = this;
		this.fillPlanets = function (t, outX, outY, count) {
			const sim = self.tradeSim;
			for (let i = 0; i < count; i++) {
				outX[i] = sim.planetX[i];
				outY[i] = sim.planetY[i];
			}
		};
	}

	GravityBot.prototype.attachWorld = function (tradeSim) {
		this.tradeSim = tradeSim;
		this.strength.fill(1);
		this.bindSim(this.probe);
		for (let i = 0; i < MAX_RIVALS; i++) this.bindSim(this.rivals[i].sim);
	};

	GravityBot.prototype.bindSim = function (sim) {
		const trade = this.tradeSim;
		sim.setPlanets(
			PLANETS,
			trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY,
			trade.orbitTiltCos, trade.orbitTiltSin
		);
		sim.setField(PLANETS, trade.planetR, this.strength, this.fillPlanets, true);
	};

	GravityBot.prototype.spec = function () {
		return LEVELS[this.level] || LEVELS.off;
	};

	GravityBot.prototype.ruleSpec = function () {
		return GravityGame.RULES[this.rule] || GravityGame.RULES.tour;
	};

	GravityBot.prototype.reset = function (seed, rule, level) {
		this.seed = seed >>> 0;
		this.rule = GravityGame.RULES[rule] ? rule : GravityGame.RULE_TOUR;
		this.level = LEVELS[level] ? level : GravityGame.BOT_OFF;
		this.count = this.spec().count;
		this.jobActive = false;
		this.jobRival = -1;

		const base0 = (Math.imul(this.seed, 7) + 5) >>> 0;
		for (let i = 0; i < MAX_RIVALS; i++) {
			const r = this.rivals[i];
			r.sim.clear();
			GravityGame.resetLedger(r.ledger);
			r.shots.length = 0;
			r.steps = 0;
			r.doneSteps = -1;
			r.length = 0;
			r.basePlanet = (base0 + i * 13) % PLANETS;
			r.readyStep = 0;
			r.planReady = false;
			r.planStep = -1;
			r.planStamp = -1;
		}
	};

	GravityBot.prototype.rivalDone = function (rival) {
		const rSpec = this.ruleSpec();
		if (rSpec.stopOnTour && rival.doneSteps >= 0) return true;
		if (rSpec.maxShots > 0 && rival.shots.length >= rSpec.maxShots) return true;
		if (rival.shots.length >= MAX_BOT_SHOTS) return true;
		if (rival.sim.status !== STATUS_FLYING && rival.ledger.purse < MONEY.cost) return true;
		return false;
	};

	GravityBot.prototype.needsLaunch = function (rival, runStep) {
		return rival.sim.status !== STATUS_FLYING &&
			!this.rivalDone(rival) &&
			runStep >= rival.readyStep;
	};

	GravityBot.prototype.planValid = function (rival, runStep, market) {
		return rival.planReady &&
			rival.planStep === runStep &&
			rival.planStamp === market.stamp;
	};

	/* scores the probe result already sitting in `this.probe` */
	GravityBot.prototype.scoreProbe = function (rival, origin, market, baseStep) {
		const probe = this.probe;
		if (probe.predReason === END_EXIT) return -1e9;
		const profit = GravityGame.estimateProfit(market, baseStep, probe);
		const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
		const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
		const timeCap = probe.predReason === END_TIME ? 1 : 0;
		const newVisits = probe.predNewVisits;
		const rSpec = this.ruleSpec();
		const completes = rSpec.stopOnTour &&
			(rival.sim.visitedCount + newVisits >= PLANETS);
		const solvent = rival.ledger.purse - MONEY.cost + profit >= MONEY.cost || completes;

		let score = (solvent ? 0 : -400) + lands * 12 - samePad * 35 -
			(timeCap && !completes ? 250 : 0);
		if (this.rule === GravityGame.RULE_MONEY) {
			score += profit * 30 + newVisits * 2 - probe.predTime * 0.14;
		} else if (this.rule === GravityGame.RULE_ROUTE) {
			score += (completes ? 120 : 0) + newVisits * 18 +
				profit * 10 + probe.predLength * 0.015;
		} else {
			score += (completes ? 80 : 0) + newVisits * 11 +
				profit * 18 - probe.predTime * 0.16;
		}
		return score;
	};

	GravityBot.prototype.recordTopCandidate = function (score, angleU, speedU, body, steps) {
		let slot = -1;
		if (this.topCount < TOP_K) {
			slot = this.topCount;
			this.topCount += 1;
		} else {
			let worst = 0;
			for (let i = 1; i < TOP_K; i++) {
				if (this.topScore[i] < this.topScore[worst]) worst = i;
			}
			if (score <= this.topScore[worst]) return;
			slot = worst;
		}
		this.topScore[slot] = score;
		this.topAngleU[slot] = angleU;
		this.topSpeedU[slot] = speedU;
		this.topBody[slot] = body;
		this.topSteps[slot] = steps;
	};

	GravityBot.prototype.betterChoice = function (score, angleU, speedU) {
		if (score > this.bestScore) return true;
		if (score < this.bestScore) return false;
		if (angleU !== this.bestAngleU) return angleU < this.bestAngleU;
		return speedU < this.bestSpeedU;
	};

	GravityBot.prototype.beginJob = function (rivalIdx, runStep, market) {
		const rival = this.rivals[rivalIdx];
		const spec = this.spec();
		const origin = rival.sim.landedBody >= 0 ? rival.sim.landedBody : rival.basePlanet;
		this.jobActive = true;
		this.jobRival = rivalIdx;
		this.jobRunStep = runStep;
		this.jobStamp = market.stamp;
		this.jobMarket = market;
		this.jobOrigin = origin;
		this.jobPhase = 0;
		this.jobIndex = 0;
		this.jobPrimaryTotal = spec.angles * spec.speeds.length;
		this.jobLookTotal = 0;
		this.jobHorizon = this.rule === GravityGame.RULE_ROUTE ? spec.routeHorizon : spec.horizon;
		this.topCount = 0;
		this.bestScore = -Infinity;
		this.bestAngleU = 0;
		this.bestSpeedU = GravityGame.speedUnits(spec.speeds[0] || 150);
		this.savedVisited.set(rival.sim.visited);
		this.probe.visited.set(this.savedVisited);
		this.probe.visitedCount = rival.sim.visitedCount;
	};

	/* prepares `probe.visited` and `lookMarket` for top candidate `slot`'s 1-ply follow-up */
	GravityBot.prototype.prepareLookahead = function (slot) {
		const angle = GravityGame.angleOf(this.topAngleU[slot]);
		const speed = GravityGame.speedOf(this.topSpeedU[slot]);
		this.probe.visited.set(this.savedVisited);
		this.probe.predictFast(this.jobOrigin, angle, speed, this.jobHorizon);
		this.lookMarket.lastVisitStep.set(this.jobMarket.lastVisitStep);
		for (let i = 0; i < this.probe.predLogCount; i++) {
			const p = this.probe.predLogPlanet[i];
			this.lookMarket.lastVisitStep[p] = this.jobRunStep + this.probe.predLogStep[i];
		}
		for (let i = 0; i < PLANETS; i++) {
			if (this.probe.predVisit[i]) this.probe.visited[i] = 1;
		}
	};

	GravityBot.prototype.stepJob = function (budgetMs, maxCands) {
		if (!this.jobActive) return true;
		const spec = this.spec();
		const rival = this.rivals[this.jobRival];
		const started = performance.now();
		const capMs = budgetMs > 0 ? budgetMs : 3.5;
		const sliceCap = maxCands > 0 ? maxCands : SLICE_CANDIDATES;
		let evaluated = 0;

		while (this.jobPhase === 0 && this.jobIndex < this.jobPrimaryTotal) {
			if (evaluated > 0 && (evaluated >= sliceCap || performance.now() - started > capMs)) {
				return false;
			}
			const sCount = spec.speeds.length;
			const aIdx = (this.jobIndex / sCount) | 0;
			const sIdx = this.jobIndex - aIdx * sCount;
			this.jobIndex += 1;
			evaluated += 1;

			const rawAngle = (aIdx + 0.5) / spec.angles * Math.PI * 2;
			const angleU = GravityGame.angleUnits(rawAngle);
			const speedU = GravityGame.speedUnits(spec.speeds[sIdx]);
			const angle = GravityGame.angleOf(angleU);
			const speed = GravityGame.speedOf(speedU);

			this.probe.visited.set(this.savedVisited);
			this.probe.predictFast(this.jobOrigin, angle, speed, this.jobHorizon);
			const score = this.scoreProbe(rival, this.jobOrigin, this.jobMarket, this.jobRunStep);
			if (this.betterChoice(score, angleU, speedU)) {
				this.bestScore = score;
				this.bestAngleU = angleU;
				this.bestSpeedU = speedU;
			}
			if (spec.lookahead > 0 &&
				this.probe.predReason === END_IMPACT &&
				this.probe.predBody !== this.jobOrigin) {
				this.recordTopCandidate(score, angleU, speedU,
					this.probe.predBody, this.probe.predSteps);
			}
		}

		if (this.jobPhase === 0) {
			if (spec.lookahead > 0 && this.topCount > 0) {
				this.jobPhase = 1;
				this.jobIndex = 0;
				this.jobLookTotal = this.topCount * spec.lookahead;
			} else {
				return this.finishJob();
			}
		}

		const lookAngles = spec.lookahead;
		const speedU2 = GravityGame.speedUnits(LOOKAHEAD_SPEED);
		const speed2 = GravityGame.speedOf(speedU2);
		while (this.jobPhase === 1 && this.jobIndex < this.jobLookTotal) {
			if (evaluated > 0 && (evaluated >= sliceCap || performance.now() - started > capMs)) {
				return false;
			}
			const slot = (this.jobIndex / lookAngles) | 0;
			const lIdx = this.jobIndex - slot * lookAngles;
			if (lIdx === 0) {
				this.prepareLookahead(slot);
				this.lookBest = 0;
			}
			this.jobIndex += 1;
			evaluated += 1;

			const origin2 = this.topBody[slot];
			const step2 = this.jobRunStep + this.topSteps[slot];
			const angle2 = GravityGame.angleOf(GravityGame.angleUnits((lIdx + 0.5) / lookAngles * Math.PI * 2));
			this.probe.predictFast(origin2, angle2, speed2, LOOKAHEAD_HORIZON);
			if (this.probe.predReason !== END_EXIT) {
				const profit2 = GravityGame.estimateProfit(this.lookMarket, step2, this.probe);
				const gain2 = this.rule === GravityGame.RULE_MONEY
					? profit2 * 24
					: this.probe.predNewVisits * 8 + profit2 * 12;
				if (gain2 > this.lookBest) this.lookBest = gain2;
			}
			if (lIdx === lookAngles - 1) {
				const total = this.topScore[slot] + LOOKAHEAD_WEIGHT * this.lookBest;
				const aU = this.topAngleU[slot];
				const sU = this.topSpeedU[slot];
				if (this.betterChoice(total, aU, sU)) {
					this.bestScore = total;
					this.bestAngleU = aU;
					this.bestSpeedU = sU;
				}
			}
		}
		return this.finishJob();
	};

	GravityBot.prototype.finishJob = function () {
		const rival = this.rivals[this.jobRival];
		rival.planReady = true;
		rival.planStep = this.jobRunStep;
		rival.planStamp = this.jobStamp;
		rival.planOrigin = this.jobOrigin;
		rival.planAngleU = this.bestAngleU;
		rival.planSpeedU = this.bestSpeedU;
		this.jobActive = false;
		this.jobRival = -1;
		return true;
	};

	GravityBot.prototype.drainJob = function () {
		while (this.jobActive) this.stepJob(1e9, 1e9);
	};

	GravityBot.prototype.progress = function () {
		if (!this.jobActive) return 1;
		const spec = this.spec();
		const total = this.jobPrimaryTotal + (spec.lookahead > 0 ? TOP_K * spec.lookahead : 0);
		if (total <= 0) return 1;
		const done = this.jobPhase === 0 ? this.jobIndex : this.jobPrimaryTotal + this.jobIndex;
		return done / total;
	};

	GravityBot.prototype.thinking = function () {
		return this.jobActive;
	};

	/* background pre-thinking while the game clock is paused between flights */
	GravityBot.prototype.tickIdle = function (runStep, market, budgetMs) {
		if (this.count === 0) return true;
		if (this.jobActive) {
			const r = this.rivals[this.jobRival];
			if (this.jobRunStep === runStep && this.jobStamp === market.stamp &&
				this.needsLaunch(r, runStep)) {
				return this.stepJob(budgetMs, SLICE_CANDIDATES);
			}
			this.jobActive = false;
			this.jobRival = -1;
		}
		for (let i = 0; i < this.count; i++) {
			const rival = this.rivals[i];
			if (!this.needsLaunch(rival, runStep)) continue;
			if (this.planValid(rival, runStep, market)) continue;
			this.beginJob(i, runStep, market);
			return this.stepJob(budgetMs, SLICE_CANDIDATES);
		}
		return true;
	};

	GravityBot.prototype.launchRival = function (rival, capSteps) {
		const angle = GravityGame.angleOf(rival.planAngleU);
		const speed = GravityGame.speedOf(rival.planSpeedU);
		rival.sim.stepLimit = capSteps;
		rival.sim.limitReason = END_TIME;
		rival.shots.push(GravityGame.createShot(
			GravityGame.SRC_PLANETS, rival.planOrigin,
			rival.planAngleU, rival.planSpeedU, GravityGame.NO_ABORT
		));
		rival.sim.launch(rival.planOrigin, angle, speed);
		GravityGame.beginFlight(rival.ledger, rival.sim);
		rival.planReady = false;
	};

	/*
	 * Called before advancing `runStep` -> `runStep + 1`. Ensures any rival due
	 * to launch at `runStep` has finished its decision and launched. When `sync`
	 * is false, runs one slice and returns false while still thinking so live
	 * playback never stalls a frame; when `sync` is true, drains immediately.
	 */
	GravityBot.prototype.prepareStep = function (runStep, market, capSteps, budgetMs, sync) {
		if (this.count === 0) return true;
		for (let i = 0; i < this.count; i++) {
			const rival = this.rivals[i];
			if (!this.needsLaunch(rival, runStep)) continue;
			if (!this.planValid(rival, runStep, market)) {
				if (!this.jobActive || this.jobRival !== i ||
					this.jobRunStep !== runStep || this.jobStamp !== market.stamp) {
					this.beginJob(i, runStep, market);
				}
				if (sync) this.drainJob();
				else if (!this.stepJob(budgetMs, SLICE_CANDIDATES)) return false;
			}
			this.launchRival(rival, capSteps);
		}
		return true;
	};

	/* advances all flying rivals by one exact DT step at `runStep` */
	GravityBot.prototype.stepOne = function (runStep, market) {
		if (this.count === 0) return;
		const stage = this.spec().stageSteps;
		const stopOnTour = this.ruleSpec().stopOnTour;
		for (let i = 0; i < this.count; i++) {
			const rival = this.rivals[i];
			if (rival.sim.status !== STATUS_FLYING) continue;
			rival.sim.stepOne();
			rival.steps += 1;
			GravityGame.stepHarvest(rival.ledger, market, rival.sim, runStep);
			if (stopOnTour && rival.sim.visitedCount === PLANETS && rival.doneSteps < 0) {
				rival.doneSteps = rival.steps;
			}
			if (rival.sim.status !== STATUS_FLYING) {
				GravityGame.endFlight(rival.ledger);
				rival.length += rival.sim.flightLength;
				if (rival.sim.landedBody >= 0) rival.basePlanet = rival.sim.landedBody;
				rival.readyStep = runStep + stage;
			}
		}
	};

	/* synchronous decision helper for standalone benchmarks */
	GravityBot.prototype.chooseSync = function (rivalIdx, runStep, market) {
		this.beginJob(rivalIdx, runStep, market);
		this.drainJob();
		const r = this.rivals[rivalIdx];
		return { origin: r.planOrigin, angle: r.planAngleU, speed: r.planSpeedU };
	};

	/*
	 * When the player stalls out broke before completing the rule's goal, rivals
	 * finish their remaining launches synchronously so the final scoreboard
	 * reflects where their run actually ends.
	 */
	GravityBot.prototype.settle = function (startRunStep, market, capSteps) {
		if (this.count === 0) return startRunStep;
		let step = startRunStep;
		let guard = 0;
		while (guard < 250000) {
			guard += 1;
			this.prepareStep(step, market, capSteps, 1e9, true);
			let active = false;
			for (let i = 0; i < this.count; i++) {
				const r = this.rivals[i];
				if (r.sim.status === STATUS_FLYING || !this.rivalDone(r)) {
					active = true;
					break;
				}
			}
			if (!active) break;
			step += 1;
			this.stepOne(step, market);
		}
		return step;
	};

	GravityBot.prototype.scoreSteps = function (index) {
		const r = this.rivals[index];
		return r.doneSteps >= 0 ? r.doneSteps : r.steps;
	};

	GravityBot.prototype.actorSummary = function (index) {
		const r = this.rivals[index];
		return {
			purse: r.ledger.purse,
			visited: r.sim.visitedCount,
			length: r.length,
			shots: r.shots.length,
			steps: this.scoreSteps(index)
		};
	};

	GravityBot.prototype.rivalLink = function (seed, rate, index) {
		const r = this.rivals[index || 0];
		return GravityGame.encodeLink({
			seed: seed,
			rate: rate,
			rule: this.rule,
			bot: GravityGame.BOT_OFF,
			shots: r.shots,
			visited: r.sim.visitedCount,
			steps: this.scoreSteps(index || 0)
		});
	};

	GravityBot.LEVELS = LEVELS;
	GravityBot.MAX_RIVALS = MAX_RIVALS;
	GravityBot.SLICE_CANDIDATES = SLICE_CANDIDATES;

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityBot;
	else root.GravityBot = GravityBot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
