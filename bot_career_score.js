/*
 * Career shot scoring: score facts, radar heat and avoidance, contested pads,
 * flight scoring and stored scores.
 * not here: searching for the shot → bot_career_plan.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_score.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitTech, OrbitEcon, STATUS_FLYING, END_IMPACT,
		CAREER_ENERGY_WAIT_COST, CAREER_MEDIC_VALUE, CAREER_BRIBE_ROT, CAREER_BRIBE_PAY,
		careerRefundEscrow, careerFee
	} = inner;

	/* game seconds one press of `wait` moves the clock; the pads see
	 * SUN_SEC_PER_GAME_SEC times as much sunlight */
	const CAREER_WAIT_SECONDS = GravitySim.WAIT_SEC;
	const CAREER_BUILT_PAD_VALUE = 2.5;
	/* a rival or rebel rail: a landing, a usage tax, and no claim on the planet */
	const CAREER_FOREIGN_PAD_VALUE = 1;
	/* a target another company is already queued for is worth this much less:
	 * the first to queue harvests the landing, the second lands on a paid visit */
	const CAREER_CONTESTED_COST = 2;
	/* once a colonization kit is aboard, delivering it to an exitable empty
	 * world outranks routine visits while still pricing post-founding exit */
	const CAREER_FOUND_BONUS = 10;

	GravityBot.prototype.careerEnergyWait = function (career, planet, energy, sourcePad) {
		if (!(energy > 0)) return 0;
		const pad = sourcePad || GravityGame.padAt(career, planet);
		const gain = OrbitTech.solarCharge(pad.panel, career.light[planet],
			GravityGame.careerPadSeconds(CAREER_WAIT_SECONDS));
		return gain > 0 ? energy / gain : Infinity;
	};

	/*
	 * What the rulers would pay for this landing's silence, or 0. The offer is
	 * twice the visit value — the value the landing reports, or, with a dead
	 * device or a quiet planet, what accrued unreported — so a worn-out
	 * observation device costs the visit but not the bribe. Only a company with
	 * the bribe-taking persona prices it, and never on the Capital, A.R.F., a
	 * rebel planet or its own rail: the same gates `careerBribe` applies when
	 * the ship actually stands there, so the score cannot promise money the
	 * landing will refuse.
	 */
	GravityBot.prototype.careerBribeOffer = function (career, market, body, value) {
		if (!career.bribeProne || body < 0 || !(value > 0)) return 0;
		if (body === market.capitalPlanet || body === market.arfPlanet) return 0;
		if (market.rebel[body]) return 0;
		if (GravityGame.padOwner(career, body, false) === career.index) return 0;
		const amount = OrbitEcon.bribeValue(value);
		if (amount < OrbitEcon.BRIBE_MIN) return 0;
		return amount >= CAREER_BRIBE_PAY || market.corruption[body] >= CAREER_BRIBE_ROT
			? amount : 0;
	};

	/*
	 * Landing + harvest + contract + solvency value of one trace. Only the
	 * facts differ between a fresh probe and a stored trajectory, so both feed
	 * this: `visitPay` is the harvest, `length`/`steps` the path and arrival,
	 * `landingValue` is what the landing's own visit is worth before the bribe.
	 */
	GravityBot.prototype.careerScoreFacts = function (career, origin, market, runStep,
		flownLen, fee, body, visitPay, length, steps, speed, wearCost, arrivalCondition,
		landingValue) {
		this.careerEval.reject = '';
		if (GravityGame.emptyWorld(career, body) && !career.ship.colonyKit) {
			this.careerEval.reject = 'uninhabited';
			return -Infinity;
		}
		this.careerEval.builds = false;
		this.careerEval.exitCost = Infinity;
		this.careerEval.exitSource = '';
		this.careerEval.legPlan = -Infinity;
		this.careerEval.leg2Feasible = true;
		/* the rule's one landing table: cash for the purse, credit for the leg */
		GravityGame.careerLandingFacts(this.careerEval, career, origin, body,
			flownLen, length, steps, runStep, visitPay, speed);
		/* a bribe is cash in the purse before the next launch, so it also
		 * widens what the exit can afford */
		const bribe = this.careerBribeOffer(career, market, body, landingValue || 0);
		this.careerEval.cash += bribe;
		this.careerEval.bribe = bribe;
		const cashPay = this.careerEval.cash;

		const launchFee = fee || 0;
		const wear = wearCost || 0;
		const cashNet = cashPay - launchFee - wear;
		this.careerEval.cashNet = cashNet;

		/* Two-leg contract stop (`LEG_LOAD` at `task.from`, or `LEG_MEDICS` at
		 * `task.to` before patients board): verify and price the real second leg
		 * through `careerLegPlan` instead of the flat `LEG_CREDIT` discount. */
		let twoLegChecked = false;
		let twoLegVerified = false;
		if (career.contract >= 0 && body >= 0) {
			const cTask = career.tasks[career.contract];
			if ((cTask.kind === GravityGame.TASK_DELIVERY &&
				cTask.state === GravityGame.TASK_ACCEPTED && body === cTask.from) ||
				(cTask.kind === GravityGame.TASK_MEDIC && cTask.aboard === 0 && body === cTask.to)) {
				twoLegChecked = true;
				const inp = this.careerLegInput;
				inp.origin = origin;
				inp.body = body;
				inp.speed = speed || 0;
				inp.flownLen = flownLen || 0;
				inp.length = length;
				inp.steps = steps;
				inp.visitPay = visitPay;
				inp.bribe = bribe;
				if (inp.condition === undefined) inp.condition = career.ship.condition;
				if (inp.burnDv === undefined) inp.burnDv = 0;
				inp.fee = launchFee;
				this.careerLegOpts.slot = -1;
				this.careerLegOpts.seekClaim = false;
				this.careerLegOpts.exitSpeedFn = this.careerExitFn;
				this.prepareCareerExitProbe(this.probe);
				GravityGame.careerLegPlan(this.careerLeg, career, market, this.exitProbe,
					inp, runStep, this.careerLegOpts);
				inp.condition = undefined;
				inp.burnDv = 0;
				inp.logPlanet = null;
				inp.logStep = null;
				inp.logDwell = null;
				inp.logCount = 0;
				this.careerEval.legPlan = this.careerLeg.total;
				this.careerEval.leg2Feasible = this.careerLeg.feasible;
				if (!this.careerLeg.feasible) {
					this.careerEval.credit = 0;
					this.careerEval.leg = GravityGame.LEG_NONE;
					this.careerEval.reject = 'leg2';
					return -Infinity;
				}
				twoLegVerified = this.careerLeg.hasSecond;
			}
		}

		/* A return can collect flybys and competitions, but it buys no new
		 * ground. Don't burn the charge on an excursion that won't pay for itself. */
		if (body === origin && cashNet <= 1e-9) {
			this.careerEval.reject = 'bounce';
			return -Infinity;
		}
		if (career.ledger.purse + 1e-9 < launchFee) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		/* A dead ship must be repaired before it can take any departure. */
		const mandatoryRepair = GravityGame.forecastRepairReserve(career, arrivalCondition);
		const completesEscrow = this.careerEval.leg === GravityGame.LEG_DELIVER ||
			this.careerEval.leg === GravityGame.LEG_PATIENTS ||
			this.careerEval.leg === GravityGame.LEG_COMPETE;
		const contractEscrow = twoLegVerified && career.contract >= 0
			? (career.tasks[career.contract].capitalRefund || 0) : 0;
		const escrow = completesEscrow ? 0 : Math.max(0, careerRefundEscrow(career) - contractEscrow);
		const exitCash = career.ledger.purse + cashPay - launchFee - mandatoryRepair - escrow;
		if (escrow > 0 && career.ledger.purse - launchFee - mandatoryRepair - escrow < -1e-9) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		/* Other companies can harvest the projected visits before we do. A
		 * fixed entry fine must be covered by cash or this landing's payout. */
		if (landingValue < 0 && exitCash - visitPay + landingValue < -1e-9) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		const foundsColony = GravityGame.emptyWorld(career, body) && career.ship.colonyKit;
		const arrivalMass = this.careerArrivalMass(career, body) -
			(foundsColony ? OrbitTech.COLONY_KIT.mass : 0);
		const contested = this.careerContested(career, body);
		const departure = this.careerDeparture(career, body, exitCash, arrivalMass, this.probe,
			arrivalCondition === 0 ? 1 : arrivalCondition, !contested, true,
			GravitySim.gameSeconds(steps), foundsColony);
		if (!departure.ok || exitCash + 1e-9 < departure.cost) {
			this.careerEval.reject = departure.physical ? 'exit' : 'unlaunchable';
			return -Infinity;
		}
		if (twoLegChecked && twoLegVerified) {
			this.careerEval.credit = this.careerLeg.leg2.net + departure.cost;
		}
		let taskPay = this.careerEval.cash + this.careerEval.credit;
		if (this.careerEval.leg === GravityGame.LEG_MEDICS && body === career.capitalPlanet) {
			taskPay += CAREER_MEDIC_VALUE;
		}
		const own = career.pads[body];
		const claim = !contested && !own.catapult && departure.builds;
		let padValue;
		if (body === origin) padValue = -departure.cost;
		else if (foundsColony) {
			padValue = CAREER_FOUND_BONUS +
				(claim ? this.careerClaimValue(career, body, -1, departure, arrivalMass)
					: -departure.cost);
		} else if (own.catapult) padValue = CAREER_BUILT_PAD_VALUE + (own.catapult.tier - 1) * 0.1 - departure.cost;
		else if (claim) padValue = this.careerClaimValue(career, body, -1, departure, arrivalMass);
		else {
			/* A commercial ticket, rival rail or imperial rail buys no property. */
			const owner = GravityGame.padOwner(career, body, false);
			padValue = (owner >= 0 || owner === GravityGame.OWNER_REBEL ? CAREER_FOREIGN_PAD_VALUE : 0) - departure.cost;
		}
		/* A shared visit is missed harvest, not lost property: only ground the
		 * landing could have taken loses its worth to the other ship. Charging
		 * the contest on an own rail made a company refuse to go home, which is
		 * exactly the pad it can always launch from. */
		if (contested && !own.catapult && body !== career.capitalPlanet) {
			padValue -= CAREER_CONTESTED_COST;
		}
		padValue -= wear;
		this.careerEval.builds = claim || (own.catapult !== null && departure.builds);
		this.careerEval.exitCost = departure.cost;
		this.careerEval.exitSource = departure.source;
		this.careerEval.taskPay = taskPay;
		this.careerEval.padValue = padValue;
		return taskPay + padValue -
			this.careerRadarAvoid(career, body, runStep, taskPay + padValue,
				GravitySim.gameSeconds(steps));
	};

	/* the planets another ship's predicted trajectory lands on, with the
	 * earliest rival landing time on each, once per scanned company and world
	 * step; the shared radar memo keeps the per-ship predictions themselves
	 * cheap. No horizon cap: the reveal's landing time is the whole signal. */
	GravityBot.prototype.careerRadarHot = function (career, runStep) {
		if (this.radarHotStep === runStep && this.radarHotCareer === career) {
			return this.radarHot;
		}
		this.radarHotStep = runStep;
		this.radarHotCareer = career;
		const hot = this.radarHot;
		const when = this.radarHotTime;
		hot.fill(0);
		when.fill(0);
		const actors = career.galaxy ? career.galaxy.actors : null;
		for (let i = 0; actors && i < actors.length; i++) {
			const other = actors[i];
			if (other === career || !other.sim) continue;
			let sim = other.sim;
			if (other === this.careerPlayer.career) {
				/* trace the player's coasting ship on exitProbe: never mutate
				 * cargoSim's burn/aim buffers, and never depend on GUI frames */
				if (sim.status !== STATUS_FLYING || other.evacuating) continue;
				this.prepareCareerExitProbe(sim);
				this.exitProbe.traceFromCargo(sim, 0, 0, GravityGame.RADAR_BUDGET_MS, false);
				sim = this.exitProbe;
			} else if (!GravityGame.radarPredict(other, null)) {
				continue;
			}
			if (sim.predReason !== END_IMPACT || sim.predBody < 0) continue;
			const body = sim.predBody;
			/* the earliest rival landing on a planet is the one to beat */
			const t = sim.predSteps * GravitySim.DT;
			if (when[body] <= 0 || t < when[body]) when[body] = t;
			hot[body] = 1;
		}
		return hot;
	};

	/* radar (0.7.49): what a radar company's launch scoring adds — the
	 * landing-time race the reveal makes visible. A destination another ship
	 * is heading to is taken: this company concedes a fraction of the landing's
	 * value, unless its own shot lands there first (`myTime` < the rival's
	 * landing time), in which case it beats the rival and gains the same
	 * fraction. A planet a ship sits on, or a rail another company owns, is
	 * stale or captured ground and always concedes. Without radar the score is
	 * exactly what it was. */
	GravityBot.prototype.careerRadarAvoid = function (career, body, runStep, score, myTime) {
		if (!career.radar || body < 0 || !(score > 0) || !career.galaxy) return 0;
		const owner = GravityGame.claimOwner(career.galaxy, body);
		if (owner >= 0 && owner !== career.index) return GravityGame.RADAR_AVOID * score;
		if (this.careerRadarHot(career, runStep)[body]) {
			const rival = this.radarHotTime[body];
			if (myTime > 0 && rival > 0 && myTime < rival) {
				return -GravityGame.RADAR_BEAT * score;
			}
			return GravityGame.RADAR_AVOID * score;
		}
		const actors = career.galaxy.actors;
		for (let i = 0; i < actors.length; i++) {
			const other = actors[i];
			if (other !== career && !other.flying && other.at === body) {
				return GravityGame.RADAR_AVOID * score;
			}
		}
		return 0;
	};

	/* A claimed trajectory, not a speculative fan winner. Remains contested
	 * while the barrel turns AND while the ship is in transit. */
	GravityBot.prototype.careerContested = function (career, body) {
		if (!career.galaxy || body === career.at) return false;
		const actors = career.galaxy.actors;
		for (let i = 0; i < actors.length; i++) {
			const other = actors[i];
			if (other !== career && other.plannedLanding === body) return true;
		}
		return false;
	};

	function sameCareerAim(shot, origin, angleU, speedU) {
		return shot && shot.origin === origin && GravityGame.angleUnits(shot.angle) === angleU &&
			GravityGame.speedUnits(shot.speed) === speedU;
	}

	/* A finite destination penalty does not stop two ships sharing one barrel
	 * from firing the exact same aim. The follower would find the whole path paid. */
	GravityBot.prototype.careerShotBusy = function (career, origin, angleU, speedU) {
		if (!career.galaxy) return false;
		const player = this.careerPlayer;
		for (let i = -1; i < this.count; i++) {
			const actor = i < 0 ? player : this.rivals[i];
			const other = actor.career;
			if (!other || other === career || other.galaxy !== career.galaxy) continue;
			if (other.flying) {
				if (!other.lastFuel && sameCareerAim(actor.sim, origin, angleU, speedU)) return true;
				continue;
			}
			if (other.plannedLanding < 0) continue;
			const queued = i < 0 && this.playerType === GravityGame.PLAYER_BOT ? player.plan : actor.turret;
			if (sameCareerAim(queued, origin, angleU, speedU)) return true;
		}
		return false;
	};

	/* Price a scratch launch and its continuation against one market history.
	 * The burn follows the prefix's last harvest, even if it exhausts the ship. */
	GravityBot.prototype.careerBurnVisitPay = function (career, market, runStep, sim, reportUntil) {
		const prefix = this.careerBurnPrefix;
		const probe = this.probe;
		const offset = sim.liveSteps;
		const hasPrefix = prefix.sim === sim;
		let count = 0;
		if (hasPrefix) {
			for (let i = 0; i < prefix.count; i++) {
				prefix.joinedPlanet[count] = prefix.planet[i];
				prefix.joinedStep[count] = prefix.step[i];
				prefix.joinedDwell[count] = prefix.dwell[i];
				count += 1;
			}
		}
		for (let i = 0; i < probe.predLogCount; i++) {
			if (probe.predLogStep[i] === 0) {
				/* still inside from the prefix: its open row continues, so the
				 * dwell joins that row instead of planting a phantom entry */
				if (!hasPrefix) continue;
				const row = prefix.open[probe.predLogPlanet[i]];
				if (row >= 0 && row < count) prefix.joinedDwell[row] += probe.predLogDwell[i];
				continue;
			}
			if (count >= prefix.joinedPlanet.length) break;
			prefix.joinedPlanet[count] = probe.predLogPlanet[i];
			prefix.joinedStep[count] = offset + probe.predLogStep[i];
			prefix.joinedDwell[count] = probe.predLogDwell[i];
			count += 1;
		}
		const until = career.ship.obs.fitted
			? offset + Math.max(1, Math.ceil(reportUntil)) : 0;
		return GravityGame.estimateProfitLog(market, runStep,
			prefix.joinedPlanet, prefix.joinedStep, count, career.ledger, until,
			this.careerLanding, prefix.joinedDwell);
	};

	/* Score reports before failure and the eventual service. A scratch launch
	 * has a prefix; a live ship has already paid and harvested that prefix. */
	GravityBot.prototype.careerScoreFlight = function (career, origin, market, runStep,
		flownLen, fee, speed, priorWear, burnDv, prefixSim) {
		const probe = this.probe;
		if (probe.predReason !== END_IMPACT || probe.predBody < 0) {
			this.careerEval.reject = 'noImpact';
			return -Infinity;
		}
		const condition = Math.max(0, career.ship.condition - (priorWear || 0));
		const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, burnDv);
		const arrival = GravityGame.forecastCondition(career, condition, probe.predSteps, speed, burnDv, true);
		const wear = careerFee(career, (career.ship.condition - arrival) * GravityGame.WEAR_REPAIR_COST);
		/* the landing's own visit value, reported or not: the bribe cashes it */
		const landing = this.careerLanding;
		landing.body = probe.predBody;
		landing.value = 0;
		const visitPay = prefixSim
			? this.careerBurnVisitPay(career, market, runStep, prefixSim, reportUntil)
			: GravityGame.estimateProfit(market, runStep, probe, career.ledger, reportUntil, landing);
		this.careerLegInput.condition = condition;
		this.careerLegInput.burnDv = burnDv || 0;
		if (!prefixSim) {
			this.careerLegInput.logPlanet = probe.predLogPlanet;
			this.careerLegInput.logStep = probe.predLogStep;
			this.careerLegInput.logDwell = probe.predLogDwell;
			this.careerLegInput.logCount = probe.predLogCount;
		}
		const continuationStep = runStep + (prefixSim ? prefixSim.liveSteps : 0);
		const launchSpeed = prefixSim ? prefixSim.speed : speed;
		const res = this.careerScoreFacts(career, origin, market, continuationStep, flownLen, fee,
			probe.predBody, visitPay, probe.predLength, probe.predSteps, launchSpeed, wear,
			arrival, landing.value);
		this.careerLegInput.condition = undefined;
		this.careerLegInput.burnDv = 0;
		this.careerLegInput.logPlanet = null;
		this.careerLegInput.logStep = null;
		this.careerLegInput.logDwell = null;
		this.careerLegInput.logCount = 0;
		return res;
	};

	/* pad energy, the recharge wait it costs and the EMC fee of one shot */
	GravityBot.prototype.careerScoreTail = function (career, sim, origin, speed, base, fee) {
		const energy = sim.launchEnergy(origin, speed);
		/* only your own battery needs recharge time; a foreign or commercial
		 * rail is paid in money (the fee), not in waiting */
		const wait = GravityGame.padOwner(career, origin) === career.index
			? this.careerEnergyWait(career, origin, energy) : 0;
		this.careerEval.energy = energy;
		this.careerEval.wait = wait;
		this.careerEval.fee = fee;
		return base - energy * wait * CAREER_ENERGY_WAIT_COST - fee;
	};

	/* Scores the trace already in `probe`; `careerEval` exposes its money terms. */
	GravityBot.prototype.careerScoreProbe = function (career, sim, origin, speed, market, runStep) {
		this.prepareCareerExitProbe(sim);
		const fee = GravityGame.launchFee(career, origin, speed);
		const base = this.careerScoreFlight(career, origin, market, runStep, 0, fee, speed);
		if (!Number.isFinite(base)) return -Infinity;
		return this.careerScoreTail(career, sim, origin, speed, base, fee);
	};

	/* The same score for a stored trajectory: its visit log re-prices exactly at
	 * the live market, so the book needs no trace (its CPU saving). */
	GravityBot.prototype.careerScoreStored = function (career, sim, market, runStep, entry) {
		this.prepareCareerExitProbe(sim);
		const speed = GravityGame.speedOf(entry.speedU);
		const fee = GravityGame.launchFee(career, entry.origin, speed);
		const condition = career.ship.condition;
		const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, 0);
		const landing = this.careerLanding;
		landing.body = entry.body;
		landing.value = 0;
		const visitPay = GravityGame.estimateProfitLog(market, runStep,
			entry.logPlanet, entry.logStep, entry.logCount, career.ledger, reportUntil, landing,
			entry.logDwell);
		const arrival = GravityGame.forecastCondition(career, condition, entry.steps, speed, 0, true);
		const wear = GravityGame.forecastWearCost(career, condition, entry.steps, speed, 0, true);
		this.careerLegInput.logPlanet = entry.logPlanet;
		this.careerLegInput.logStep = entry.logStep;
		this.careerLegInput.logDwell = entry.logDwell;
		this.careerLegInput.logCount = entry.logCount;
		const base = this.careerScoreFacts(career, entry.origin, market, runStep, 0, fee,
			entry.body, visitPay, entry.length, entry.steps, speed, wear, arrival, landing.value);
		if (!Number.isFinite(base)) return -Infinity;
		return this.careerScoreTail(career, sim, entry.origin, speed, base, fee);
	};
	GravityBot.CAREER_WAIT_SECONDS = CAREER_WAIT_SECONDS;
});
