/*
 * Career controller, planning: careerPlan over fans and the book, the one-burn
 * plan and its scoring, the space-start opening, and the in-flight burn.
 *
 * Part of GravityBot: gravity_bot.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityBot = node ? require('./gravity_bot.js') : root.GravityBot;
	const GravitySim = node ? require('./gravity_sim.js') : root.GravitySim;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const OrbitTech = node ? require('./orbit_tech.js') : root.OrbitTech;
	const {
		PLANETS, PLAYER_INDEX, END_IMPACT, END_TIME, TAU, CAREER_ANGLES, CAREER_FALLBACK_SCALE,
		CAREER_HORIZON, CAREER_REFINE_HORIZON, CAREER_REFINE_SEEDS, CAREER_SPEED_FRACTIONS,
		CAREER_TARGET_OFFSETS, CAREER_TARGET_STEP, CAREER_BURN_ANGLES, CAREER_BURN_FRACTIONS,
		CAREER_BURN_REFINE, CAREER_BURN_AT, CAREER_BURN_EVERY, CAREER_BURN_TAIL, CAREER_BURNS_MAX,
		CAREER_BOOK_ENOUGH, CAREER_BOOK_EXPLORE_EVERY, CAREER_BOOK_MIN_NET, signed,
		careerTraceIndex, careerAimOffer, advancesCareerLeg, careerCargoSpeed
	} = GravityBot;

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

	/* the winning burn's landing facts, kept so a launch can be priced from it */
	GravityBot.prototype.careerBurnFacts = function () {
		const best = this.careerBurnBest;
		const ev = this.careerEval;
		best.taskPay = ev.taskPay;
		best.cashNet = ev.cashNet;
		best.leg = ev.leg;
		best.bribe = ev.bribe;
		best.padValue = ev.padValue;
		best.builds = ev.builds;
		best.exitCost = ev.exitCost;
		best.exitSource = ev.exitSource;
	};

	/*
	 * Score of one burn candidate, or -Infinity when it is not worth flying:
	 * it must still land an active contract, land at all, and beat coasting by
	 * `careerBurnGain` after the fuel it burns. Leaves the winner's landing in
	 * `probe`.
	 */
	GravityBot.prototype.careerBurnScore = function (career, sim, market, runStep,
		angleU, dvU, requiredBody, coastScore, fee, priorWear, prefixSim) {
		const dv = GravityGame.speedOf(dvU);
		const ship = career.ship;
		this.probe.predictBurnFast(sim, GravityGame.angleOf(angleU), dv);
		if (requiredBody >= 0 && this.probe.predBody !== requiredBody) return -Infinity;
		const raw = this.careerScoreFlight(career, sim.origin, market, runStep,
			sim.flightLength, fee, 0, priorWear, dv, prefixSim);
		if (!Number.isFinite(raw) || (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg))) return -Infinity;
		const fuelKg = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
		const fuelCost = fuelKg * GravityGame.fuelPrice(career);
		if (this.probe.predBody === sim.origin && this.careerEval.cashNet <= fuelCost + 1e-9) return -Infinity;
		const score = raw - fuelCost;
		if (Number.isFinite(coastScore) && score <= coastScore + this.careerBurnGain) return -Infinity;
		return score;
	};

	/*
	 * Mid-flight course correction: a coarse ring at the two Δv rungs, then a
	 * fine fan around the coarse winner and the contract bearing. `rescueOnly`
	 * first traces the coast and gives up unless it would be lost, so a healthy
	 * flight pays one trace instead of a whole search.
	 */
	GravityBot.prototype.careerBurnPlan = function (career, sim, market, runStep,
		rescueOnly, fee) {
		const best = this.careerBurnBest;
		best.body = -1;
		best.score = -Infinity;
		best.taskPay = 0;
		best.bribe = 0;
		best.padValue = 0;
		best.builds = false;
		best.exitCost = Infinity;
		best.exitSource = '';
		if (career.ended !== GravityGame.CAREER_OPEN || sim.status !== GravitySim.STATUS_FLYING) {
			return null;
		}
		/* A live ship has already paid its prefix; a scratch launch has not. */
		const prefixSim = career.flying ? null : sim;
		const condition = prefixSim
			? GravityGame.forecastCondition(career, career.ship.condition, sim.liveSteps, sim.speed, 0, false)
			: career.ship.condition;
		if (condition <= 0) return null;
		const priorWear = career.ship.condition - condition;
		const limit = sim.burnLimit();
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		if (capU < 1) return null;

		const requiredBody = career.contract >= 0 ? this.careerTarget(career) : -1;
		this.probe.predictBurnFast(sim, 0, 0);
		const coastLands = this.probe.predReason === END_IMPACT && this.probe.predBody >= 0;
		const onTarget = requiredBody < 0 || (coastLands && this.probe.predBody === requiredBody);
		if (rescueOnly && onTarget) return null;
		let coastScore = -Infinity;
		if (onTarget) {
			coastScore = this.careerScoreFlight(career, sim.origin, market, runStep,
				sim.flightLength, fee, 0, priorWear, 0, prefixSim);
		}
		best.coastScore = coastScore;

		const target = requiredBody >= 0 ? requiredBody : this.careerTarget(career);
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.cargo.y, sim.planetX[target] - sim.cargo.x) : 0;
		const dvU = this.careerBurnRungs;
		let rungs = 0;
		for (let f = 0; f < CAREER_BURN_FRACTIONS.length; f++) {
			const rung = Math.max(1, Math.min(capU,
				Math.round(capU * CAREER_BURN_FRACTIONS[f])));
			if (rungs === 1 && rung === dvU[0]) continue;
			dvU[rungs] = rung;
			rungs += 1;
		}
		const ringStep = TAU / CAREER_BURN_ANGLES;
		let bestAngleU = -1;
		let bestScore = -Infinity;
		/* the contract bearing and its opposite are worth trying beside the ring */
		const aimed = target >= 0 ? 2 : 0;
		for (let r = 0; r < rungs; r++) {
			for (let a = 0; a < CAREER_BURN_ANGLES + aimed; a++) {
				const rawAngle = a < CAREER_BURN_ANGLES
					? (a + 0.5) * ringStep
					: targetAngle + (a - CAREER_BURN_ANGLES) * Math.PI;
				const angleU = GravityGame.angleUnits(rawAngle);
				const score = this.careerBurnScore(career, sim, market, runStep,
					angleU, dvU[r], requiredBody, coastScore, fee, priorWear, prefixSim);
				if (!(score > bestScore + 1e-12)) continue;
				bestScore = score;
				bestAngleU = angleU;
				best.body = this.probe.predBody;
				best.score = score;
				best.angleU = angleU;
				best.dvU = dvU[r];
				best.steps = this.probe.predSteps;
				this.careerBurnFacts();
			}
		}
		if (bestAngleU < 0) return null;

		/* refine around the winner: a narrower fan, at both Δv rungs */
		const refineStep = ringStep / (CAREER_BURN_REFINE + 1);
		for (let r = 0; r < rungs; r++) {
			for (let k = -CAREER_BURN_REFINE; k <= CAREER_BURN_REFINE; k++) {
				const angleU = GravityGame.angleUnits(
					GravityGame.angleOf(bestAngleU) + k * refineStep);
				const score = this.careerBurnScore(career, sim, market, runStep,
					angleU, dvU[r], requiredBody, coastScore, fee, priorWear, prefixSim);
				if (!(score > best.score + 1e-12)) continue;
				best.body = this.probe.predBody;
				best.score = score;
				best.angleU = angleU;
				best.dvU = dvU[r];
				best.steps = this.probe.predSteps;
				this.careerBurnFacts();
			}
		}
		best.angle = GravityGame.angleOf(best.angleU);
		best.dv = GravityGame.speedOf(best.dvU);
		best.fuelKg = OrbitTech.impulseFuel(best.dv, career.ship.engine,
			career.ship.mass, career.ship.fuelKg);
		return best;
	};

	const CAREER_SPACE_OPEN_ANGLES = 32;
	const CAREER_SPACE_OPEN_FRACTIONS = [0.25, 0.5, 0.75, 1];
	const CAREER_SPACE_OPEN_REFINE = 4;

	/* Full-parity space-start opening (0.7.47 WS5): fan the granted impulse kit
	 * from the spawn state over a 32-bearing ring plus direct planet bearings,
	 * refine around the winner, and score reachable landings with the bot's own
	 * mid-flight evaluator. */
	GravityBot.prototype.careerSpaceOpenPlan = function (career, sim, market, runStep) {
		const best = this.careerBurnBest;
		best.body = -1;
		best.score = -Infinity;
		best.taskPay = 0;
		best.bribe = 0;
		best.padValue = 0;
		best.builds = false;
		best.exitCost = Infinity;
		best.exitSource = '';
		if (career.ended !== GravityGame.CAREER_OPEN || sim.status !== GravitySim.STATUS_FLYING) {
			return null;
		}
		this.probe.fieldT = sim.fieldT;
		this.probe.fieldRate = sim.fieldRate;
		this.probe.setScales(sim.gravityScale, sim.forceScale);
		if (this.probe.bodyCount !== sim.bodyCount || this.probe.fillField !== sim.fillField ||
			this.probe.fieldStatic !== sim.fieldStatic) {
			this.probe.setField(sim.bodyCount, sim.bodyR, sim.strength,
				sim.fillField, sim.fieldStatic);
		}
		this.prepareCareerExitProbe(sim);

		const limit = sim.burnLimit();
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		if (capU < 1) return null;

		this.probe.predictBurnFast(sim, 0, 0);
		let coastScore = -Infinity;
		if (this.probe.predReason === END_IMPACT && this.probe.predBody >= 0) {
			coastScore = this.careerScoreFlight(career, sim.origin, market, runStep,
				sim.flightLength, 0, 0, 0, 0, null);
		}
		best.coastScore = coastScore;

		const rungs = [];
		for (let f = 0; f < CAREER_SPACE_OPEN_FRACTIONS.length; f++) {
			const rung = Math.max(1, Math.min(capU,
				Math.round(capU * CAREER_SPACE_OPEN_FRACTIONS[f])));
			if (rungs.length === 0 || rungs[rungs.length - 1] !== rung) rungs.push(rung);
		}

		const ringStep = TAU / CAREER_SPACE_OPEN_ANGLES;
		let bestAngleU = -1;
		const offer = (angleU, dvU) => {
			const score = this.careerBurnScore(career, sim, market, runStep,
				angleU, dvU, -1, coastScore, 0, 0, null);
			if (!(score > best.score + 1e-12)) return;
			bestAngleU = angleU;
			best.body = this.probe.predBody;
			best.score = score;
			best.angleU = angleU;
			best.dvU = dvU;
			best.steps = this.probe.predSteps;
			this.careerBurnFacts();
		};

		for (let r = 0; r < rungs.length; r++) {
			for (let a = 0; a < CAREER_SPACE_OPEN_ANGLES; a++) {
				offer(GravityGame.angleUnits((a + 0.5) * ringStep), rungs[r]);
			}
			for (let p = 0; p < PLANETS; p++) {
				if (this.probe.planetMask && this.probe.planetMask[p] === 0) continue;
				const ang = Math.atan2(sim.planetY[p] - sim.cargo.y,
					sim.planetX[p] - sim.cargo.x);
				offer(GravityGame.angleUnits(ang), rungs[r]);
			}
		}
		if (bestAngleU < 0) return null;

		const refineStep = ringStep / (CAREER_SPACE_OPEN_REFINE + 1);
		const centerAngle = GravityGame.angleOf(bestAngleU);
		for (let r = 0; r < rungs.length; r++) {
			for (let k = -CAREER_SPACE_OPEN_REFINE; k <= CAREER_SPACE_OPEN_REFINE; k++) {
				offer(GravityGame.angleUnits(centerAngle + k * refineStep), rungs[r]);
			}
		}
		best.angle = GravityGame.angleOf(best.angleU);
		best.dv = GravityGame.speedOf(best.dvU);
		best.fuelKg = OrbitTech.impulseFuel(best.dv, career.ship.engine,
			career.ship.mass, career.ship.fuelKg);
		return best;
	};

	/*
	 * One flight's impulse use. The first window is the nudge that re-targets
	 * the whole flight; later windows only rescue a coast that would be lost.
	 * `state` is the flying actor (a rival or the page's own bot actor) and
	 * self-resets when the sim's step counter starts over on a new launch.
	 */
	GravityBot.prototype.careerFlightBurn = function (career, sim, market, runStep, state) {
		if (sim.status !== GravitySim.STATUS_FLYING) return null;
		if (state.burnStep > sim.liveSteps) {
			state.burn = 0;
			state.burnTries = 0;
			state.burnNext = CAREER_BURN_AT;
		}
		state.burnStep = sim.liveSteps;
		const ship = career.ship;
		if (career.ended !== GravityGame.CAREER_OPEN || !ship.engine || !(ship.fuelKg > 0)) {
			return null;
		}
		const who = careerTraceIndex(career);
		if (career.hq < 0 && sim.origin < 0 && state.burn === 0 && state.burnTries === 0) {
			state.burnTries = 1;
			state.burnNext = sim.liveSteps + CAREER_BURN_EVERY;
			const openPlan = this.careerSpaceOpenPlan(career, sim, market, runStep);
			if (!openPlan) {
				this.traceAdd(who, 'coast', 'no space opening burn found', runStep);
				return null;
			}
			if (!GravityGame.careerBurn(career, sim, openPlan.angle, openPlan.dv)) return null;
			state.burn = 1;
			career.plannedLanding = openPlan.body;
			this.careerBurnsPlanned += 1;
			this.traceCareerBurn(career, sim, openPlan.angle, openPlan.dv, runStep,
				'space open → P' + openPlan.body + ' · score ' + signed(openPlan.score));
			return openPlan;
		}
		if (state.burn >= CAREER_BURNS_MAX || sim.liveSteps < state.burnNext) return null;
		if (sim.liveSteps > sim.stepLimit - CAREER_BURN_TAIL) return null;
		const nudge = state.burn === 0;
		state.burnTries += 1;
		state.burnNext = sim.liveSteps + CAREER_BURN_EVERY;
		const plan = this.careerBurnPlan(career, sim, market, runStep, !nudge);
		if (!plan) {
			if (state.burnTries === 1) this.traceAdd(who, 'coast', 'no improving burn found', runStep);
			return null;
		}
		if (!GravityGame.careerBurn(career, sim, plan.angle, plan.dv)) return null;
		state.burn += 1;
		career.plannedLanding = plan.body;
		this.careerBurnsPlanned += 1;
		this.traceCareerBurn(career, sim, plan.angle, plan.dv, runStep,
			'→ P' + plan.body + ' · score ' + signed(plan.score) +
			' vs coast ' + signed(plan.coastScore));
		return plan;
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);
