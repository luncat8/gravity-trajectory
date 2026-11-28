/*
 * Career impulse decisions: burn facts, score and plan, the in-flight burn,
 * the space-start opening burn, burn launch pricing, fuel offer/commit/top-up,
 * and the rescue burn.
 * not here: the shot without a burn → bot_career_plan.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_burn.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitTech, PLANETS, END_IMPACT, TAU, CAREER_ENERGY_WAIT_COST,
		CAREER_RIVAL_GAP, CAREER_PURSE_RESERVE, careerRefundEscrow, CAREER_BURN_ANGLES,
		CAREER_BURN_FRACTIONS, CAREER_BURN_REFINE, CAREER_BURN_AT, CAREER_BURN_PRICE_TOP,
		CAREER_BURN_PRICE_MARGIN, CAREER_RESCUE_ANGLES, CAREER_MIN_SCORE, PRED_LOG_MAX, signed,
		careerTraceIndex, careerAimOffer, advancesCareerLeg, careerCargoSpeed
	} = inner;

	const CAREER_BURN_EVERY = 120;
	const CAREER_BURN_TAIL = 12;
	const CAREER_BURNS_MAX = 2;
	const CAREER_RESCUE_SPEED_FRACTION = 0.6;

	/* ── burn search ── burn offers, facts, score and the two-stage careerBurnPlan */

	/* the shortlist spans every fan pass of one careerNextShot, so it is reset
	 * by the caller as well as on a new world step */
	GravityBot.prototype.careerBurnTopReset = function () {
		this.careerBurnTop.count = 0;
	};

	GravityBot.prototype.careerBurnOffer = function (score, angleU, speedU, book) {
		careerAimOffer(this.careerBurnTop, CAREER_BURN_PRICE_TOP, score, angleU, speedU, book);
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
		const coastEmpty = coastLands && GravityGame.emptyWorld(career, this.probe.predBody) &&
			!career.ship.colonyKit;
		const onTarget = requiredBody < 0 || (coastLands && this.probe.predBody === requiredBody);
		if (rescueOnly && onTarget && !coastEmpty) return null;
		let coastScore = -Infinity;
		if (onTarget) {
			coastScore = this.careerScoreFlight(career, sim.origin, market, runStep,
				sim.flightLength, fee, 0, priorWear, 0, prefixSim);
		}
		best.coastScore = coastScore;

		const target = requiredBody >= 0 ? requiredBody : this.careerTarget(career);
		let targetAngle = 0;
		if (target >= 0) {
			let dx = sim.planetX[target] - sim.cargo.x;
			let dy = sim.planetY[target] - sim.cargo.y;
			if (sim.periodic) {
				dx = GravitySim.minImage(dx, sim.worldW);
				dy = GravitySim.minImage(dy, sim.worldH);
			}
			targetAngle = Math.atan2(dy, dx);
		}
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

	/* ── space-start opening burn ── careerSpaceOpenPlan */

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
		this.probe.setPeriodic(sim.periodic, sim);
		if (this.probe.bodyCount !== sim.bodyCount || this.probe.fillField !== sim.fillField ||
			this.probe.fieldStatic !== sim.fieldStatic || this.probe.strength !== sim.strength) {
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
			for (let p = 0; p < sim.planetCount; p++) {
				if (!sim.planetActive(p)) continue;
				let dx = sim.planetX[p] - sim.cargo.x;
				let dy = sim.planetY[p] - sim.cargo.y;
				if (sim.periodic) {
					dx = GravitySim.minImage(dx, sim.worldW);
					dy = GravitySim.minImage(dy, sim.worldH);
				}
				offer(GravityGame.angleUnits(Math.atan2(dy, dx)), rungs[r]);
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

	/* ── in-flight burn ── careerFlightBurn */

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

	/* ── burn launch pricing ── burn sim binding, careerBurnLaunch, probe restore, careerPriceBurn, plan copy */

	/* Mirror the live field into the one scratch flight shared by pre-launch
	 * burn searches. It has no rail, because every candidate is already snapped
	 * to the live pad's cap and the live sim prices its battery energy. */
	GravityBot.prototype.careerBindBurnSim = function (r) {
		const src = this.burnShotSim;
		const live = r.sim;
		src.fieldT = live.fieldT;
		src.fieldRate = live.fieldRate;
		src.setScales(live.gravityScale, live.forceScale);
		src.setPeriodic(live.periodic, live);
		if (src.bodyCount !== live.bodyCount || src.bodyR !== live.bodyR ||
			src.strength !== live.strength || src.fillField !== live.fillField ||
			src.fieldStatic !== live.fieldStatic) {
			src.setField(live.bodyCount, live.bodyR, live.strength,
				live.fillField, live.fieldStatic);
		}
		src.setPlanetMask(live.planetMask);
		src.setLaunchNetwork(null, r.career.ship);
		return src;
	};

	/* Launch one candidate in the scratch sim and fly it to the nudge window. */
	GravityBot.prototype.careerBurnLaunch = function (r, src, origin, angleU, speedU) {
		const live = r.sim;
		src.clear();
		src.visited.set(live.visited);
		src.visitedCount = live.visitedCount;
		src.landedBody = live.landedBody;
		src.stepStale = true;
		src.stepLimit = GravityGame.CAP_STEPS;
		src.limitReason = GravitySim.END_TIME;
		src.launch(origin, GravityGame.angleOf(angleU), GravityGame.speedOf(speedU));
		const prefix = this.careerBurnPrefix;
		prefix.sim = src;
		prefix.count = 0;
		prefix.open.fill(-1);
		src.predInside.fill(0);
		src.markSystemsAt(src.cargo.x, src.cargo.y, src.predInside);
		/* spawn-inside rows open at step 0, so the stay-pay trail survives the burn join */
		for (let p = 0; p < src.planetCount && prefix.count < PRED_LOG_MAX; p++) {
			if (!src.predInside[p]) continue;
			prefix.planet[prefix.count] = p;
			prefix.step[prefix.count] = 0;
			prefix.dwell[prefix.count] = 0;
			prefix.open[p] = prefix.count;
			prefix.count += 1;
		}
		for (let s = 0; s < CAREER_BURN_AT && src.status === GravitySim.STATUS_FLYING; s++) {
			src.stepOne();
			const entered = src.stepInsideAt(src.cargo.x, src.cargo.y, src.predInside, src.predEntered);
			for (let p = 0; p < src.planetCount; p++) {
				const row = prefix.open[p];
				if (row < 0) continue;
				if (src.predInside[p]) prefix.dwell[row] += 1;
				else prefix.open[p] = -1;
			}
			for (let i = 0; i < entered && prefix.count < PRED_LOG_MAX; i++) {
				const p = src.predEntered[i];
				prefix.planet[prefix.count] = p;
				prefix.step[prefix.count] = src.liveSteps;
				prefix.dwell[prefix.count] = 0;
				prefix.open[p] = prefix.count;
				prefix.count += 1;
			}
		}
	};

	/* traceFromCargo borrows the shared probe's field and visit state. */
	GravityBot.prototype.careerRestoreBurnProbe = function (r) {
		const live = r.sim;
		this.probe.fieldRate = live.fieldRate;
		this.probe.setScales(live.gravityScale, live.forceScale);
		this.probe.visited.set(live.visited);
		this.probe.visitedCount = live.visitedCount;
	};

	/*
	 * Re-price the fan's best few shots as flights with one burn. The flying
	 * controller nudges at step CAREER_BURN_AT with the same careerBurnPlan, so
	 * the queued shot should be chosen and scored by the landing that burn
	 * reaches. `fee` gates the burn's solvency check (already paid mid-flight,
	 * still unpaid here). The search uses the fuel actually on board; a separate
	 * committed-launch forecast may temporarily model an affordable top-up.
	 */
	GravityBot.prototype.careerPriceBurn = function (r, plan, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const top = this.careerBurnTop;
		if (!plan || !ship.engine || !ship.tank || !(ship.tank.fuelCap > 0) ||
			top.count === 0) return;
		const src = this.careerBindBurnSim(r);
		const live = r.sim;
		const origin = plan.origin;
		const ballistic = plan.score;
		const shot = this.careerBurnShot;
		let bestScore = ballistic;
		let found = false;
		for (let i = 0; i < top.count; i++) {
			const angleU = top.angleU[i];
			const speedU = top.speedU[i];
			const speed = GravityGame.speedOf(speedU);
			if (speed > live.speedLimit(origin) + 1e-9) continue;
			this.careerBurnLaunch(r, src, origin, angleU, speedU);
			this.careerScan.burn += 1;
			if (src.status !== GravitySim.STATUS_FLYING) continue;
			const fee = GravityGame.launchFee(career, origin, speed);
			const burn = this.careerBurnPlan(career, src, market, runStep, false, fee);
			if (!burn) continue;
			const energy = live.launchEnergy(origin, speed);
			const wait = GravityGame.padOwner(career, origin) === career.index
				? this.careerEnergyWait(career, origin, energy) : 0;
			const score = burn.score - fee - energy * wait * CAREER_ENERGY_WAIT_COST;
			if (!(score > bestScore + this.careerBurnPriceMargin)) continue;
			bestScore = score;
			found = true;
			shot.body = burn.body;
			shot.angleU = angleU;
			shot.speedU = speedU;
			shot.score = score;
			shot.burnGain = score - ballistic;
			shot.taskPay = burn.taskPay;
			shot.cashNet = burn.cashNet;
			shot.leg = burn.leg;
			shot.bribe = burn.bribe;
			shot.padValue = burn.padValue;
			shot.fee = fee;
			shot.energy = energy;
			shot.wait = wait;
			shot.exitCost = burn.exitCost;
			shot.exitSource = burn.exitSource;
			shot.builds = burn.builds;
			shot.fromBook = top.book[i] === 1;
			shot.fuelKg = burn.fuelKg;
			shot.steps = CAREER_BURN_AT + burn.steps;
		}
		this.careerRestoreBurnProbe(r);
		if (!found) return;
		this.careerBurnPrices += 1;
		plan.angleU = shot.angleU;
		plan.speedU = shot.speedU;
		plan.angle = GravityGame.angleOf(shot.angleU);
		plan.speed = GravityGame.speedOf(shot.speedU);
		plan.body = shot.body;
		plan.score = shot.score;
		/* the tank fuel is a money term, so the plan's score identity holds */
		const fuelCost = shot.fuelKg * GravityGame.fuelPrice(career);
		plan.taskPay = shot.taskPay - fuelCost;
		plan.cashNet = shot.cashNet - fuelCost;
		plan.leg = shot.leg;
		plan.bribe = shot.bribe;
		plan.fuelKg = shot.fuelKg;
		plan.padValue = shot.padValue;
		plan.fee = shot.fee;
		plan.energy = shot.energy;
		plan.wait = shot.wait;
		plan.exitCost = shot.exitCost;
		plan.exitSource = shot.exitSource;
		plan.builds = shot.builds;
		plan.fromBook = shot.fromBook;
		plan.steps = shot.steps;
		plan.burnGain = shot.burnGain;
		plan.burnBody = shot.body;
		this.traceAdd(r.index, 'burn price', 'P' + origin + '→P' + shot.body +
			' · ' + signed(shot.burnGain) + ' over ballistic · fuel ' +
			shot.fuelKg.toFixed(1) + ' kg · ' + top.count + ' shots priced', runStep);
	};

	/* Copy a complete plan without allocating in the launch path. */
	function copyCareerPlan(from, to) {
		to.origin = from.origin;
		to.body = from.body;
		to.angleU = from.angleU;
		to.speedU = from.speedU;
		to.angle = from.angle;
		to.speed = from.speed;
		to.score = from.score;
		to.taskPay = from.taskPay;
		to.cashNet = from.cashNet;
		to.leg = from.leg;
		to.bribe = from.bribe;
		to.padValue = from.padValue;
		to.energy = from.energy;
		to.wait = from.wait;
		to.fee = from.fee;
		to.exitCost = from.exitCost;
		to.exitSource = from.exitSource;
		to.fromBook = from.fromBook;
		to.builds = from.builds;
		to.length = from.length;
		to.steps = from.steps;
		to.burnGain = from.burnGain;
		to.burnBody = from.burnBody;
		to.fuelKg = from.fuelKg;
		to.fuelProducedKg = from.fuelProducedKg;
		to.fuelBoughtKg = from.fuelBoughtKg;
	}

	/* ── fuel ── fuel offer, price plan, commit and prepare */

	/* Whole kilograms keep the bot's forecast and transaction identical. The
	 * current launch fee is always reserved; easy/normal also keep the next fee. */
	GravityBot.prototype.careerFuelOffer = function (career, planet, sim) {
		const quote = this.careerFuelQuote;
		quote.kg = 0;
		quote.produceKg = 0;
		quote.buyKg = 0;
		const ship = career.ship;
		if (career.ended !== GravityGame.CAREER_OPEN || planet < 0 || !ship.engine || !ship.tank) return quote;
		const room = Math.max(0, Math.floor(ship.tank.fuelCap - ship.fuelKg + 1e-9));
		if (room <= 0) return quote;
		const pad = career.pads[planet];
		if (pad.catapult !== null) {
			/* Keep a full-cap departure firable after conversion; the shortlist may
			 * still pick a faster shot than the baseline plan. The world's force
			 * scale widens the cap but never the energy it stores, so it must
			 * come from the live sim — career.forceScale is unset for the player
			 * career and would size the reserve for a weaker rail than fires */
			const forceScale = sim ? sim.forceScale : career.forceScale;
			const cap = OrbitTech.speedLimit(pad.battery.capacity, ship.mass, pad.catapult, forceScale);
			const launchKwh = OrbitTech.launchEnergy(ship.mass, pad.catapult, cap);
			const free = Math.max(0, pad.chargeKwh - pad.reservedKwh - launchKwh);
			quote.produceKg = Math.min(room, Math.floor(free * GravityGame.FUEL_KG_PER_KWH + 1e-9));
		}
		const reserve = GravityGame.launchFee(career, planet, GravityGame.padLift(career, planet)) +
			careerRefundEscrow(career) + (this.level === 'hard' ? 0 : CAREER_PURSE_RESERVE);
		const cash = Math.max(0, career.ledger.purse - reserve);
		const price = GravityGame.fuelPrice(career);
		quote.buyKg = Math.min(room - quote.produceKg,
			price > 0 ? Math.floor(cash / price + 1e-9) : room - quote.produceKg);
		quote.kg = quote.produceKg + quote.buyKg;
		return quote;
	};

	/* Price only the fuel the winning burn needs. Conversion has the replacement
	 * opportunity cost plus recharge wait; purchase is already in the burn score. */
	GravityBot.prototype.careerFuelPricePlan = function (career, plan, quote, planet) {
		const need = Math.max(0, Math.ceil(plan.fuelKg - career.ship.fuelKg - 1e-9));
		if (need > quote.kg) return false;
		const produced = Math.min(quote.produceKg, need);
		const bought = need - produced;
		const kwh = produced / GravityGame.FUEL_KG_PER_KWH;
		const wait = this.careerEnergyWait(career, planet, kwh, career.pads[planet]);
		const cost = produced * GravityGame.fuelPrice(career);
		plan.fuelProducedKg = produced;
		plan.fuelBoughtKg = bought;
		plan.taskPay -= cost;
		plan.cashNet -= cost;
		plan.wait += wait;
		plan.score -= cost + plan.energy * wait * CAREER_ENERGY_WAIT_COST;
		return true;
	};

	GravityBot.prototype.careerCommitFuel = function (r, plan, runStep) {
		const career = r.career;
		const produced = plan.fuelProducedKg;
		const bought = plan.fuelBoughtKg;
		if (produced + bought <= 0) return true;
		const got = GravityGame.produceFuel(career, plan.origin, produced) +
			GravityGame.buyFuel(career, bought);
		plan.fuelProducedKg = 0;
		plan.fuelBoughtKg = 0;
		if (got !== produced + bought) {
			this.traceAdd(r.index, 'no shot', 'fuel quote changed · got ' + got + ' of ' +
				(produced + bought) + ' kg · retry in ' + (CAREER_RIVAL_GAP * GravitySim.DT).toFixed(1) + ' s', runStep);
			return false;
		}
		this.careerFuelTopUps += 1;
		this.traceAdd(r.index, 'fuel', '+' + got + ' kg · ' + produced + ' from battery · ' +
			bought + ' bought · ' + (bought * GravityGame.fuelPrice(career)).toFixed(2) +
			' · tank ' + career.ship.fuelKg.toFixed(1) + ' kg', runStep);
		return true;
	};

	/* One scratch forecast, after the sit decision: never stock fuel just to idle. */
	GravityBot.prototype.careerPrepareFuel = function (r, plan, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const quote = this.careerFuelOffer(career, plan.origin, r.sim);
		if (quote.kg <= 0 || plan.fuelProducedKg + plan.fuelBoughtKg > 0) return false;
		const saved = this.careerSparePlan;
		copyCareerPlan(plan, saved);
		const fuel0 = ship.fuelKg;
		this.careerBurnOffer(plan.score - plan.burnGain, plan.angleU, plan.speedU, plan.fromBook);
		ship.fuelKg = fuel0 + quote.kg;
		this.careerPriceBurn(r, plan, market, runStep);
		ship.fuelKg = fuel0;
		if (!this.careerFuelPricePlan(career, plan, quote, plan.origin) ||
			plan.score <= saved.score + this.careerBurnPriceMargin || plan.score <= CAREER_MIN_SCORE) {
			copyCareerPlan(saved, plan);
			return false;
		}
		if (!this.careerCommitFuel(r, plan, runStep)) {
			copyCareerPlan(saved, plan);
			return false;
		}
		return true;
	};

	/* ── rescue burn ── offer angle and careerRescueBurn */

	GravityBot.prototype.careerRescueOfferAngle = function (rawAngle) {
		const angles = this.careerRescueAngles;
		const angleU = GravityGame.angleUnits(rawAngle);
		for (let i = 0; i < angles.count; i++) {
			if (angles.angleU[i] === angleU) return;
		}
		angles.angleU[angles.count] = angleU;
		angles.count += 1;
	};

	/*
	 * Dead-end launch pricing: the ballistic fan had no finite plan, so try a
	 * bounded ring of launch aims and choose the best one-burn landing that
	 * beats sitting still. The current rail — including a commercial fallback —
	 * stays selected; only the caller may clear it when this returns null.
	 */
	GravityBot.prototype.careerRescueBurn = function (r, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const live = r.sim;
		const origin = career.at;
		if (origin < 0 || career.ended !== GravityGame.CAREER_OPEN || !ship.engine ||
			!ship.tank || !(ship.tank.fuelCap > 0) || !live.canLaunchFrom(origin)) return null;
		const capU = Math.floor(careerCargoSpeed(career, live.speedLimit(origin)) * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		if (capU < minU) return null;

		const rungs = this.careerRescueRungs;
		rungs[0] = capU;
		rungs[1] = Math.max(minU, Math.round(capU * CAREER_RESCUE_SPEED_FRACTION));
		const rungCount = rungs[1] === rungs[0] ? 1 : 2;
		const angles = this.careerRescueAngles;
		angles.count = 0;
		const ringStep = TAU / CAREER_RESCUE_ANGLES;
		for (let a = 0; a < CAREER_RESCUE_ANGLES; a++) {
			this.careerRescueOfferAngle((a + 0.5) * ringStep);
		}
		const target = career.contract >= 0 ? this.careerTarget(career) : -1;
		if (target >= 0 && target !== origin) {
			let dx = live.planetX[target] - live.planetX[origin];
			let dy = live.planetY[target] - live.planetY[origin];
			if (live.periodic) {
				dx = GravitySim.minImage(dx, live.worldW);
				dy = GravitySim.minImage(dy, live.worldH);
			}
			const bearing = Math.atan2(dy, dx);
			this.careerRescueOfferAngle(bearing);
			this.careerRescueOfferAngle(bearing + Math.PI);
		}

		this.careerBurnTopReset();
		const src = this.careerBindBurnSim(r);
		const shot = this.careerBurnShot;
		const fuel0 = ship.fuelKg;
		const quote = this.careerFuelOffer(career, origin, r.sim);
		ship.fuelKg = fuel0 + quote.kg;
		let bestScore = 0;
		let found = false;
		for (let s = 0; s < rungCount; s++) {
			const speedU = rungs[s];
			const speed = GravityGame.speedOf(speedU);
			if (!GravityGame.careerCanFire(career, live, origin, speed)) continue;
			const fee = GravityGame.launchFee(career, origin, speed);
			const energy = live.launchEnergy(origin, speed);
			const wait = GravityGame.padOwner(career, origin) === career.index
				? this.careerEnergyWait(career, origin, energy) : 0;
			for (let a = 0; a < angles.count; a++) {
				if (this.careerShotBusy(career, origin, angles.angleU[a], speedU)) continue;
				this.careerScan.rescue += 1;
				this.careerBurnLaunch(r, src, origin, angles.angleU[a], speedU);
				if (src.status !== GravitySim.STATUS_FLYING) continue;
				const burn = this.careerBurnPlan(career, src, market, runStep, false, fee);
				if (!burn) continue;
				const score = burn.score - fee - energy * wait * CAREER_ENERGY_WAIT_COST;
				if (!(score > CAREER_BURN_PRICE_MARGIN)) continue;
				if (!(score > bestScore + 1e-12)) continue;
				bestScore = score;
				found = true;
				shot.body = burn.body;
				shot.angleU = angles.angleU[a];
				shot.speedU = speedU;
				shot.score = score;
				shot.burnGain = score;
				shot.taskPay = burn.taskPay;
				shot.cashNet = burn.cashNet;
				shot.leg = burn.leg;
				shot.padValue = burn.padValue;
				shot.fee = fee;
				shot.energy = energy;
				shot.wait = wait;
				shot.exitCost = burn.exitCost;
				shot.exitSource = burn.exitSource;
				shot.builds = burn.builds;
				shot.fromBook = false;
				shot.fuelKg = burn.fuelKg;
				shot.steps = CAREER_BURN_AT + burn.steps;
			}
		}
		this.careerRestoreBurnProbe(r);
		ship.fuelKg = fuel0;
		if (!found) return null;

		const best = this.careerBest;
		best.origin = origin;
		best.body = shot.body;
		best.angleU = shot.angleU;
		best.speedU = shot.speedU;
		best.angle = GravityGame.angleOf(shot.angleU);
		best.speed = GravityGame.speedOf(shot.speedU);
		best.score = shot.score;
		/* the tank fuel is a money term, so the plan's score identity holds */
		const fuelCost = shot.fuelKg * GravityGame.fuelPrice(career);
		best.taskPay = shot.taskPay - fuelCost;
		best.cashNet = shot.cashNet - fuelCost;
		best.leg = shot.leg;
		best.fuelKg = shot.fuelKg;
		best.fuelProducedKg = 0;
		best.fuelBoughtKg = 0;
		best.padValue = shot.padValue;
		best.fee = shot.fee;
		best.energy = shot.energy;
		best.wait = shot.wait;
		best.exitCost = shot.exitCost;
		best.exitSource = shot.exitSource;
		best.builds = shot.builds;
		best.length = 0;
		best.steps = shot.steps;
		best.fromBook = false;
		best.burnGain = shot.burnGain;
		best.burnBody = shot.body;
		if (!this.careerFuelPricePlan(career, best, quote, origin) ||
			best.score <= CAREER_BURN_PRICE_MARGIN) return null;
		this.careerBurnRescues += 1;
		this.traceAdd(r.index, 'burn rescue', 'P' + origin + '→P' + shot.body +
			' · ' + signed(shot.burnGain) + ' over sit · fuel ' +
			shot.fuelKg.toFixed(1) + ' kg · ' + this.careerScan.rescue +
			' shots priced', runStep);
		return best;
	};

	Object.assign(inner, {
		copyCareerPlan
	});
});
