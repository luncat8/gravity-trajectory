/*
 * Career shot search: target and launch-book lookup, the coarse fan and its
 * refinement, and careerPlan.
 * not here: impulse burns → bot_career_burn.js; scoring → bot_career_score.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_plan.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, PLAYER_INDEX, END_IMPACT, END_TIME, TAU, CAREER_REFINE_SEEDS,
		CAREER_PURSE_RESERVE
	} = inner;

	/* Career is a solo economic controller, not another shared-market rival. */
	const CAREER_ANGLES = 32;
	const CAREER_FALLBACK_SCALE = 2.25;
	const CAREER_HORIZON = 45;
	const CAREER_REFINE_HORIZON = 90;
	const CAREER_REFINE_OFFSETS = [-1 / 4, -1 / 12, 1 / 12, 1 / 4];
	const CAREER_SPEED_FRACTIONS = [0.38, 0.55, 0.72, 0.86, 1];
	const CAREER_TARGET_OFFSETS = 4;
	const CAREER_TARGET_STEP = 0.035;
	/* Only a high-scoring AND profitable book shot can skip the fan. */
	const CAREER_BOOK_ENOUGH = 6;
	const CAREER_BOOK_EXPLORE_EVERY = 4;
	const CAREER_BOOK_MIN_NET = CAREER_PURSE_RESERVE;

	GravityBot.prototype.careerTarget = function (career) {
		/* the rule names the next leg of whatever contract is open, so the
		 * bot never has to know which kind it is flying */
		const goals = GravityGame.careerGoalBodies(career);
		if (career.contract >= 0) return goals[0];
		for (let i = 0; i < goals.length; i++) {
			const planet = goals[i];
			if (planet !== career.at &&
				(planet === career.capitalPlanet || career.pads[planet].catapult !== null)) return planet;
		}
		return -1;
	};

	/* the world a stored trajectory was traced in (`career.launchBook`) */
	GravityBot.prototype.careerBookTag = function () {
		const probe = this.probe;
		return GravityGame.launchBookTag(probe.fieldStatic, probe.gravityScale,
			probe.forceScale, probe.strength, probe.bodyCount);
	};

	/* copy the finished trace out of the probe, so the next candidate cannot
	 * overwrite the winner before it is saved */
	GravityBot.prototype.careerLogStore = function (probe) {
		const count = probe.predLogCount;
		const logPlanet = this.careerLogPlanet;
		const logStep = this.careerLogStep;
		const logDwell = this.careerLogDwell;
		for (let i = 0; i < count; i++) {
			logPlanet[i] = probe.predLogPlanet[i];
			logStep[i] = probe.predLogStep[i];
			logDwell[i] = probe.predLogDwell[i];
		}
		this.careerLogCount = count;
	};

	GravityBot.prototype.careerTakeBest = function (origin, angleU, speedU, score, body, length, steps) {
		const best = this.careerBest;
		best.origin = origin;
		best.body = body;
		best.angleU = angleU;
		best.speedU = speedU;
		best.angle = GravityGame.angleOf(angleU);
		best.speed = GravityGame.speedOf(speedU);
		best.score = score;
		best.taskPay = this.careerEval.taskPay;
		best.cashNet = this.careerEval.cashNet;
		best.leg = this.careerEval.leg;
		best.bribe = this.careerEval.bribe;
		best.padValue = this.careerEval.padValue;
		best.energy = this.careerEval.energy;
		best.wait = this.careerEval.wait;
		best.fee = this.careerEval.fee;
		best.exitCost = this.careerEval.exitCost;
		best.exitSource = this.careerEval.exitSource;
		best.builds = this.careerEval.builds;
		best.length = length;
		best.steps = steps;
	};

	/* the fan winner joins the book, so the next plan can score it for free */
	GravityBot.prototype.careerSaveBest = function (career, tag) {
		if (this.careerLogCount === 0 || this.careerBest.origin < 0) return;
		const best = this.careerBest;
		GravityGame.recordLaunch(career.launchBook, tag, {
			origin: best.origin, angleU: best.angleU, speedU: best.speedU,
			body: best.body, steps: best.steps, time: best.steps * GravitySim.DT,
			length: best.length, score: best.score, money: best.taskPay,
			logPlanet: this.careerLogPlanet, logStep: this.careerLogStep,
			logDwell: this.careerLogDwell,
			logCount: this.careerLogCount
		});
	};

	/* Plan only from the rail the ship stands on (own, rival or commercial);
	 * every snapped speed is <= its live cap. */
	GravityBot.prototype.careerScanReset = function (runStep) {
		const scan = this.careerScan;
		if (scan.step === runStep) return;
		scan.step = runStep;
		scan.tried = 0;
		scan.impacts = 0;
		scan.finite = 0;
		scan.bounce = 0;
		scan.exit = 0;
		scan.noImpact = 0;
		scan.book = 0;
		scan.busy = 0;
		scan.burn = 0;
		scan.rescue = 0;
		this.careerBurnTopReset();
	};

	function careerAimOffer(top, limit, score, angleU, speedU, book) {
		if (!Number.isFinite(score)) return;
		for (let i = 0; i < top.count; i++) {
			if (top.angleU[i] === angleU && top.speedU[i] === speedU) return;
		}
		let slot = top.count < limit ? top.count : -1;
		if (slot < 0) {
			if (score <= top.score[limit - 1] + 1e-12) return;
			slot = limit - 1;
		}
		while (slot > 0 && score > top.score[slot - 1] + 1e-12) {
			top.score[slot] = top.score[slot - 1];
			top.angleU[slot] = top.angleU[slot - 1];
			top.speedU[slot] = top.speedU[slot - 1];
			top.book[slot] = top.book[slot - 1];
			slot -= 1;
		}
		top.score[slot] = score;
		top.angleU[slot] = angleU;
		top.speedU[slot] = speedU;
		top.book[slot] = book ? 1 : 0;
		if (top.count < limit) top.count += 1;
	}

	function advancesCareerLeg(leg) {
		return leg === GravityGame.LEG_LOAD || leg === GravityGame.LEG_DELIVER ||
			leg === GravityGame.LEG_MEDICS || leg === GravityGame.LEG_PATIENTS;
	}

	function careerCargoSpeed(career, limit) {
		const task = career.contract >= 0 ? career.tasks[career.contract] : null;
		return task && GravityGame.fragileBreaks(task, limit) ? GravityGame.FRAGILE_SPEED : limit;
	}

	GravityBot.prototype.careerFanShot = function (career, sim, market, runStep, angleU, speedU, horizon, requiredBody) {
		const origin = career.at;
		const scan = this.careerScan;
		if (this.careerShotBusy(career, origin, angleU, speedU)) {
			scan.busy += 1;
			return null;
		}
		const speed = GravityGame.speedOf(speedU);
		const probe = this.probe;
		probe.visited.set(sim.visited);
		probe.visitedCount = sim.visitedCount;
		probe.predictFast(origin, GravityGame.angleOf(angleU), speed, horizon);
		scan.tried += 1;
		if (probe.predReason === END_IMPACT && probe.predBody >= 0) scan.impacts += 1;
		if (requiredBody >= 0 && probe.predBody !== requiredBody) return -Infinity;
		const score = this.careerScoreProbe(career, sim, origin, speed, market, runStep);
		if (!Number.isFinite(score)) {
			const reject = this.careerEval.reject;
			if (reject === 'bounce') scan.bounce += 1;
			else if (reject === 'exit' || reject === 'fee' || reject === 'unlaunchable') scan.exit += 1;
			else scan.noImpact += 1;
			return -Infinity;
		}
		if (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg)) return -Infinity;
		scan.finite += 1;
		this.careerBurnOffer(score, angleU, speedU, false);
		const best = this.careerBest;
		const better = score > best.score + 1e-12 ||
			(Math.abs(score - best.score) <= 1e-12 &&
				(angleU < best.angleU || (angleU === best.angleU && speedU < best.speedU)));
		if (better) {
			this.careerTakeBest(origin, angleU, speedU, score, probe.predBody, probe.predLength, probe.predSteps);
			this.careerLogStore(probe);
			best.fromBook = false;
		}
		return score;
	};

	GravityBot.prototype.careerRefineFan = function (career, sim, market, runStep, horizon,
		angleCount, capU, minU, requiredBody, extend) {
		const top = this.careerRefineTop;
		const spacing = TAU / angleCount;
		for (let i = 0; i < top.count; i++) {
			const angleU = top.angleU[i];
			const angle = GravityGame.angleOf(angleU);
			const speedU = top.speedU[i];
			for (let j = 0; j < CAREER_REFINE_OFFSETS.length; j++) {
				const nearby = GravityGame.angleUnits(angle + spacing * CAREER_REFINE_OFFSETS[j]);
				if (nearby !== angleU) this.careerFanShot(career, sim, market, runStep, nearby, speedU, horizon, requiredBody);
			}
			/* Re-fly the centre at two nearby speeds. The live cap is still the law. */
			const slower = Math.max(minU, Math.round(speedU * 0.94));
			const faster = Math.min(capU, Math.round(speedU * 1.06));
			if (slower < speedU) this.careerFanShot(career, sim, market, runStep, angleU, slower, horizon, requiredBody);
			if (faster > speedU) this.careerFanShot(career, sim, market, runStep, angleU, faster, horizon, requiredBody);
			if (extend) this.careerFanShot(career, sim, market, runStep, angleU, speedU, horizon, requiredBody);
		}
	};

	GravityBot.prototype.careerPlan = function (career, sim, market, runStep, fallback, angles, relaxed) {
		const best = this.careerBest;
		const scan = this.careerScan;
		this.careerScanReset(runStep);
		best.origin = -1;
		best.score = -Infinity;
		best.exitCost = Infinity;
		best.exitSource = '';
		best.builds = false;
		best.fromBook = false;
		best.burnGain = 0;
		best.burnBody = -1;
		best.fuelKg = 0;
		best.fuelProducedKg = 0;
		best.fuelBoughtKg = 0;
		best.bribe = 0;
		if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
			!sim.canLaunchFrom(career.at)) return null;
		const origin = career.at;
		const limit = careerCargoSpeed(career, sim.speedLimit(origin));
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		if (capU < minU) return null;

		this.probe.fieldT = sim.fieldT;
		this.probe.fieldRate = sim.fieldRate;
		this.careerPlans += 1;
		const target = this.careerTarget(career);
		const requiredBody = career.contract >= 0 && !relaxed ? target : -1;
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.planetY[origin],
				sim.planetX[target] - sim.planetX[origin]) : 0;
		const fan = angles > 0 ? angles : CAREER_ANGLES;
		const horizon = fallback ? GravityGame.CAP_SECONDS : CAREER_HORIZON;
		const extra = target >= 0 && target !== origin ? CAREER_TARGET_OFFSETS * 2 + 1 : 0;
		let previousSpeedU = -1;
		let bookNet = -Infinity;
		this.careerLogCount = 0;

		/* the book first: entries traced from this pad re-price from their visit
		 * log alone, so not one trace is spent on them */
		const book = career.launchBook;
		const tag = this.careerBookTag();
		if (GravityGame.bookReady(book, tag)) {
			for (let i = 0; i < book.entries.length; i++) {
				const entry = book.entries[i];
				if (entry.origin !== origin || entry.speedU > capU || entry.speedU < minU) continue;
				if (requiredBody >= 0 && entry.body !== requiredBody) continue;
				if (this.careerShotBusy(career, origin, entry.angleU, entry.speedU)) {
					scan.busy += 1;
					continue;
				}
				scan.book += 1;
				const score = this.careerScoreStored(career, sim, market, runStep, entry);
				if (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg)) continue;
				this.careerBurnOffer(score, entry.angleU, entry.speedU, true);
				if (!(score > best.score + 1e-12)) continue;
				this.careerTakeBest(entry.origin, entry.angleU, entry.speedU, score,
					entry.body, entry.length, entry.steps);
				best.fromBook = true;
				bookNet = this.careerEval.cashNet - best.exitCost;
			}
		}
		/* Even a paying shuttle must compete with fresh harvest periodically.
		 * Use completed flights, not planner calls: fallback scans and actors
		 * sharing this controller must not spend each other's exploration turn. */
		const explore = career.flights % CAREER_BOOK_EXPLORE_EVERY === CAREER_BOOK_EXPLORE_EVERY - 1;
		if (!explore && best.score >= CAREER_BOOK_ENOUGH && bookNet >= CAREER_BOOK_MIN_NET) return best;

		const level = career === this.careerPlayer.career ? this.specFor(PLAYER_INDEX) : this.spec();
		const refines = level.careerRefines;
		const top = this.careerRefineTop;
		top.count = 0;
		const angleCount = fallback ? Math.round(fan * CAREER_FALLBACK_SCALE) : fan;
		/* every rung, the top of the rail included: a cap only reachable through
		 * the fallback fan or the book was never planned for */
		const speedCount = CAREER_SPEED_FRACTIONS.length;
		for (let s = 0; s < speedCount; s++) {
			let speedU = Math.round(limit * CAREER_SPEED_FRACTIONS[s] * GravityGame.SPEED_STEPS);
			if (speedU > capU) speedU = capU;
			if (speedU < minU) speedU = minU;
			if (speedU > capU || speedU === previousSpeedU) continue;
			previousSpeedU = speedU;
			for (let a = 0; a < angleCount + extra; a++) {
				const angle = a < angleCount ? (a + 0.5) / angleCount * TAU
					: targetAngle + (a - angleCount - CAREER_TARGET_OFFSETS) * CAREER_TARGET_STEP;
				const angleU = GravityGame.angleUnits(angle);
				const score = this.careerFanShot(career, sim, market, runStep, angleU, speedU, horizon, requiredBody);
				if (!refines || score === null) continue;
				let rank = score;
				const probe = this.probe;
				/* An unfinished multi-visit trace is a search seed, not a payable shot.
				 * Rows are time-ordered: the leading step-0 (spawn-inside) rows
				 * are not visits made in flight, so they do not count here. */
				const unfinished = !fallback && probe.predReason === END_TIME;
				let seedVisits = probe.predLogCount;
				if (unfinished) {
					let spawn = 0;
					while (spawn < seedVisits && probe.predLogStep[spawn] === 0) spawn++;
					seedVisits -= spawn;
				}
				if (unfinished && seedVisits >= 2) {
					const speed = GravityGame.speedOf(speedU);
					const condition = career.ship.condition;
					const until = GravityGame.forecastReportUntil(career, condition, speed, 0);
					rank = GravityGame.estimateProfit(market, runStep, probe, career.ledger, until) -
						GravityGame.launchFee(career, origin, speed) -
						GravityGame.forecastWearCost(career, condition, probe.predSteps, speed, 0, false);
				}
				careerAimOffer(top, refines, rank, angleU, speedU, false);
			}
		}
		/* Don't trade a funded first claim for a speculative harvest. */
		if (top.count && (career.flights > 0 || !best.builds)) {
			const reach = fallback || refines === CAREER_REFINE_SEEDS ? GravityGame.CAP_SECONDS : CAREER_REFINE_HORIZON;
			this.careerRefineFan(career, sim, market, runStep, reach, angleCount, capU, minU, requiredBody, !fallback);
		}
		if (best.origin >= 0) this.careerSaveBest(career, tag);
		return best.origin >= 0 ? best : null;
	};
	GravityBot.CAREER_BOOK_ENOUGH = CAREER_BOOK_ENOUGH;

	Object.assign(inner, {
		careerAimOffer, advancesCareerLeg, careerCargoSpeed
	});
});
