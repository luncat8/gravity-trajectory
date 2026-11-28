/*
 * Tour and money rivals: the sliced candidate job, lookahead, launch and
 * stepping, settle, summaries and rival links.
 * not here: the route rule → bot_route.js; career rivals → bot_career_*.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_rivals.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravityGame, PLANETS, PLAYER_INDEX, TOP_K, STATUS_FLYING, END_IMPACT, END_EXIT, END_TIME,
		MONEY, END_OPEN, signed
	} = inner;

	const SLICE_CANDIDATES = 64;
	const LOOKAHEAD_SPEED = 175;
	const LOOKAHEAD_HORIZON = 12;
	const LOOKAHEAD_WEIGHT = 0.45;

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
		const targetWorlds = this.planetUniverseCount || this.probe.planetCapacity || PLANETS;
		const completes = rSpec.stopOnTour &&
			(rival.sim.visitedCount + newVisits >= targetWorlds);
		const solvent = rival.ledger.purse - MONEY.cost + profit >= MONEY.cost || completes;

		let score = (solvent ? 0 : -400) + lands * 12 - samePad * 35 -
			(timeCap && !completes ? 250 : 0);
		if (this.rule === GravityGame.RULE_MONEY) {
			score += profit * 30 + newVisits * 2 - probe.predTime * 0.14;
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
		const rival = this.actorAt(rivalIdx);
		const spec = this.specFor(rivalIdx);
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
		this.jobHorizon = spec.horizon;
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
			/* a spawn-inside row is not an encounter under the entry rule, so
			 * it must not stamp the follow-up's market either */
			if (this.probe.predLogStep[i] === 0) continue;
			const p = this.probe.predLogPlanet[i];
			this.lookMarket.lastVisitStep[p] = this.jobRunStep + this.probe.predLogStep[i];
		}
		const visitCap = this.probe.planetCount || PLANETS;
		for (let i = 0; i < visitCap; i++) {
			if (this.probe.predVisit[i]) this.probe.visited[i] = 1;
		}
	};

	GravityBot.prototype.stepJob = function (budgetMs, maxCands) {
		if (!this.jobActive) return true;
		const spec = this.specFor(this.jobRival);
		const rival = this.actorAt(this.jobRival);
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
		const who = this.jobRival;
		const rival = this.actorAt(who);
		this.traceAdd(who, 'plan', 'P' + this.jobOrigin + ' → angle ' +
			GravityGame.angleOf(this.bestAngleU).toFixed(2) + ' v' +
			GravityGame.speedOf(this.bestSpeedU).toFixed(0) + ' · score ' +
			signed(this.bestScore) + ' · ' + this.jobIndex + ' candidates', this.jobRunStep);
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
		const spec = this.specFor(this.jobRival);
		const total = this.jobPrimaryTotal + (spec.lookahead > 0 ? TOP_K * spec.lookahead : 0);
		if (total <= 0) return 1;
		const done = this.jobPhase === 0 ? this.jobIndex : this.jobPrimaryTotal + this.jobIndex;
		return done / total;
	};

	GravityBot.prototype.thinking = function () {
		return this.jobActive;
	};

	/*
	 * Mirrors the GUI player's flight state into the bot-controlled YOU actor.
	 * Call once at game start and after each GUI flight; the next tickPlayer()
	 * then searches from exactly the planet and purse the GUI will launch with.
	 */
	GravityBot.prototype.syncPlayer = function (sim, ledger, shots, steps, length, doneSteps, runStep) {
		const actor = this.player;
		actor.sim.visited.set(sim.visited);
		actor.sim.visitedCount = sim.visitedCount;
		actor.sim.landedBody = sim.landedBody;
		if (sim.landedBody >= 0) actor.basePlanet = sim.landedBody;
		actor.ledger.purse = ledger.purse;
		actor.shots.length = shots;
		actor.steps = steps;
		actor.length = length;
		actor.doneSteps = doneSteps;
		actor.readyStep = runStep;
		actor.planReady = false;
		actor.planStep = -1;
		actor.planStamp = -1;
		if (this.jobActive && this.jobRival === PLAYER_INDEX) {
			this.jobActive = false;
			this.jobRival = -1;
		}
	};

	GravityBot.prototype.tickPlayer = function (runStep, market, budgetMs) {
		if (this.playerType !== GravityGame.PLAYER_BOT ||
			this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER) return true;
		const actor = this.player;
		if (!this.needsLaunch(actor, runStep)) return true;
		if (this.planValid(actor, runStep, market)) return true;
		if (!this.jobActive || this.jobRival !== PLAYER_INDEX ||
			this.jobRunStep !== runStep || this.jobStamp !== market.stamp) {
			this.beginJob(PLAYER_INDEX, runStep, market);
		}
		return this.stepJob(budgetMs, SLICE_CANDIDATES);
	};

	GravityBot.prototype.playerPlanValid = function (runStep, market) {
		return this.playerType === GravityGame.PLAYER_BOT &&
			this.planValid(this.player, runStep, market);
	};

	/* background pre-thinking while the game clock is paused between flights */
	GravityBot.prototype.tickIdle = function (runStep, market, budgetMs) {
		this.worldStep = runStep;
		if (this.rule === GravityGame.RULE_ROUTE) return this.tickRoute(budgetMs);
		if (this.rule === GravityGame.RULE_CAREER) return true;
		if (this.count === 0) return true;
		if (this.jobActive) {
			const r = this.actorAt(this.jobRival);
			if (this.jobRunStep === runStep && this.jobStamp === market.stamp &&
				this.needsLaunch(r, runStep)) {
				return this.stepJob(budgetMs, SLICE_CANDIDATES);
			}
			this.jobActive = false;
			this.jobRival = -1;
		}
		for (let i = 0; i < this.count; i++) {
			if (!this.isRivalBot(i)) continue;
			const rival = this.rivals[i];
			if (!this.needsLaunch(rival, runStep)) continue;
			if (this.planValid(rival, runStep, market)) continue;
			this.beginJob(i, runStep, market);
			return this.stepJob(budgetMs, SLICE_CANDIDATES);
		}
		return true;
	};

	GravityBot.prototype.launchRival = function (rival, capSteps, runStep) {
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
		this.traceAdd(rival.index, 'launch', 'P' + rival.planOrigin + ' angle ' +
			angle.toFixed(2) + ' v' + speed.toFixed(0) + ' · purse ' +
			rival.ledger.purse.toFixed(2), runStep === undefined ? this.jobRunStep : runStep);
	};

	/*
	 * Called before advancing `runStep` -> `runStep + 1`. Ensures any rival due
	 * to launch at `runStep` has finished its decision and launched. When `sync`
	 * is false, runs one slice and returns false while still thinking so live
	 * playback never stalls a frame; when `sync` is true, drains immediately.
	 */
	GravityBot.prototype.prepareStep = function (runStep, market, capSteps, budgetMs, sync) {
		this.worldStep = runStep;
		if (this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER ||
			this.count === 0) return true;
		for (let i = 0; i < this.count; i++) {
			if (!this.isRivalBot(i)) continue;
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
			this.launchRival(rival, capSteps, runStep);
		}
		return true;
	};

	/* advances all flying rivals by one exact DT step at `runStep` */
	GravityBot.prototype.stepOne = function (runStep, market) {
		this.worldStep = runStep;
		if (this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER ||
			this.count === 0) return;
		const stage = this.spec().stageSteps;
		const stopOnTour = this.ruleSpec().stopOnTour;
		const targetWorlds = this.planetUniverseCount || this.probe.planetCapacity || PLANETS;
		for (let i = 0; i < this.count; i++) {
			const rival = this.rivals[i];
			if (rival.sim.status !== STATUS_FLYING) continue;
			rival.sim.stepOne();
			rival.steps += 1;
			GravityGame.stepHarvest(rival.ledger, market, rival.sim, runStep);
			if (stopOnTour && rival.sim.visitedCount === targetWorlds && rival.doneSteps < 0) {
				rival.doneSteps = rival.steps;
			}
			if (rival.sim.status !== STATUS_FLYING) {
				GravityGame.endFlight(rival.ledger);
				rival.length += rival.sim.flightLength;
				if (rival.sim.landedBody >= 0) rival.basePlanet = rival.sim.landedBody;
				if (this.isRivalBot(i)) rival.readyStep = runStep + stage;
				if (this.isRivalBot(i)) this.traceAdd(i, 'land',
					(rival.sim.endReason === END_IMPACT
						? 'P' + rival.sim.endBody : rival.sim.endReason === END_EXIT
							? 'left the map' : 'flight cap') +
					' · purse ' + rival.ledger.purse.toFixed(2) + ' · ' +
					rival.sim.visitedCount + ' systems · ' + this.rivalDoneWhy(rival), runStep);
			}
		}
	};

	/* synchronous decision helper for standalone benchmarks */
	GravityBot.prototype.chooseSync = function (rivalIdx, runStep, market) {
		this.beginJob(rivalIdx, runStep, market);
		this.drainJob();
		const r = this.actorAt(rivalIdx);
		return { origin: r.planOrigin, angle: r.planAngleU, speed: r.planSpeedU };
	};

	/*
	 * When the player stalls out broke before completing the rule's goal, rivals
	 * finish their remaining launches synchronously so the final scoreboard
	 * reflects where their run actually ends.
	 */
	GravityBot.prototype.settle = function (startRunStep, market, capSteps) {
		if (this.rule === GravityGame.RULE_CAREER) return startRunStep;
		if (this.rule === GravityGame.RULE_ROUTE) {
			while (!this.routeDone()) this.tickRoute(1e9);
			return startRunStep;
		}
		if (this.count === 0) return startRunStep;
		let step = startRunStep;
		let guard = 0;
		while (guard < 250000) {
			guard += 1;
			this.prepareStep(step, market, capSteps, 1e9, true);
			let active = false;
			for (let i = 0; i < this.count; i++) {
				const r = this.rivals[i];
				if (r.sim.status === STATUS_FLYING ||
					(this.isRivalBot(i) && !this.rivalDone(r))) {
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
		const r = this.actorAt(index);
		if (this.rule === GravityGame.RULE_ROUTE) return r.routeSteps;
		return r.doneSteps >= 0 ? r.doneSteps : r.steps;
	};

	GravityBot.prototype.actorSummary = function (index) {
		const r = this.actorAt(index);
		const isBot = index === PLAYER_INDEX
			? this.playerType === GravityGame.PLAYER_BOT
			: this.isRivalBot(index);
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			return {
				purse: r.ledger.purse,
				visited: career ? career.padCount : 0,
				done: career ? career.ended !== GravityGame.CAREER_OPEN : false,
				length: 0,
				shots: career ? career.flights : 0,
				steps: r.steps,
				origin: career ? career.at : -1,
				reason: END_OPEN,
				body: -1,
				ready: false,
				planning: false
			};
		}
		if (this.rule === GravityGame.RULE_ROUTE) {
			return {
				purse: r.ledger.purse,
				visited: r.routeReady ? r.routeVisits : 0,
				done: isBot ? r.routeDone : r.routeReady,
				length: r.routeReady ? r.routeLength : 0,
				shots: r.routeReady ? 1 : 0,
				steps: r.routeSteps,
				origin: r.routeOrigin,
				reason: r.routeReason,
				body: r.routeBody,
				ready: r.routeReady,
				planning: isBot ? !r.routeDone : r.sim.routeActive
			};
		}
		const flyingLength = r.sim.status === STATUS_FLYING ? r.sim.flightLength : 0;
		return {
			purse: r.ledger.purse,
			visited: r.sim.visitedCount,
			done: r.doneSteps >= 0,
			length: r.length + flyingLength,
			shots: r.shots.length,
			steps: this.scoreSteps(index),
			origin: r.sim.landedBody >= 0 ? r.sim.landedBody : r.basePlanet,
			reason: r.sim.endReason,
			body: r.sim.endBody,
			ready: r.shots.length > 0,
			planning: false
		};
	};

	GravityBot.prototype.rivalLink = function (seed, rate, index, gravityScale, forceScale, spaceWearScale, harvestTick) {
		const idx = index || 0;
		const r = this.actorAt(idx);
		const route = this.rule === GravityGame.RULE_ROUTE;
		return GravityGame.encodeLink({
			seed: seed,
			rate: rate,
			rule: this.rule,
			bot: GravityGame.BOT_OFF,
			player: GravityGame.PLAYER_USER,
			periodic: this.periodic,
			gravityScale: gravityScale,
			forceScale: forceScale,
			spaceWearScale: spaceWearScale,
			harvestTick: harvestTick,
			shots: r.shots,
			visited: route ? r.routeVisits : r.sim.visitedCount,
			steps: this.scoreSteps(idx),
			length: route ? r.routeLength : undefined
		});
	};
	GravityBot.SLICE_CANDIDATES = SLICE_CANDIDATES;
});
