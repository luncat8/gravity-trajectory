/*
 * Career shot execution: race entry, the next shot, recharge and sit, stuck
 * handling, turret launch, and landing.
 * not here: planning the shot → bot_career_plan.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_shot.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitTech, END_TIME, TAU, CAREER_RIVAL_GAP, CAREER_PURSE_RESERVE,
		CAREER_SIT_TRIES, signed, careerTraceIndex, careerNextItem, careerPrice, advancesCareerLeg,
		careerCargoSpeed, copyCareerPlan
	} = inner;

	/* no shot and no affordable departure for this many tries = a dead end */
	const CAREER_STUCK_TRIES = 4;
	/* The horizon a panel is priced over: a starter panel cannot open an
	 * interplanetary shot inside the ordinary sit budget, and that is exactly
	 * the pad worth refitting. */
	const CAREER_RECHARGE_TRIES = 8;
	/* patient companies: sit out this much world time, but never more than
	 * CAREER_SIT_TRIES times in a row */
	const CAREER_SIT_GAP = Math.round(30 / GravitySim.DT);

	/*
	 * One search for the next shot, shared by a rival company and by the bot
	 * flying the page's own company: the fan from the standing pad, the
	 * commercial rail when that pad is drained, and the recovery a company
	 * needs when no trajectory exists at all.
	 */
	GravityBot.prototype.careerReadyShot = function (r, plan, market, runStep, priced) {
		r.idleTries = 0;
		if (priced) this.careerPriceBurn(r, plan, market, runStep);
		return plan;
	};

	/*
	 * Enter the shared race once the shot is committed (past sit and fuel prep)
	 * and starts on the race planet inside the window: the entry pays for
	 * itself while the pool still covers the stake with the entered rivals to
	 * split it, and only when the remaining purse still covers the rail fee and
	 * arrival departure. The queued shot then holds on the barrel until the gun.
	 */
	GravityBot.prototype.careerRaceEntry = function (career, sim, plan, runStep) {
		const sport = GravityGame.sportStateOf(career);
		if (sport.kind !== GravityGame.TASK_COMPETE ||
			(sport.enteredMask & (1 << career.index)) !== 0 ||
			plan.origin !== sport.planet || plan.length < sport.minLength) return false;
		if (sim && !sim.fieldStatic && runStep < sport.startsAt) return false;
		const holdStep = runStep < sport.startsAt ? sport.startsAt : runStep;
		const period = GravityGame.turretPeriod(career.galaxy, plan.origin);
		const gun = GravityGame.turretAngle(career.galaxy, plan.origin, holdStep * GravitySim.DT);
		let delta = plan.angle - gun;
		delta -= Math.floor(delta / TAU) * TAU;
		const wait = delta < 0.02 ? 0 : delta / TAU * period;
		const fireAt = holdStep + Math.ceil(wait / GravitySim.DT);
		if (fireAt + plan.steps > sport.deadline) return false;
		const atCapital = career.capitalPlanet >= 0 && plan.origin === career.capitalPlanet;
		const afterStake = career.ledger.purse + (atCapital ? GravityGame.CAPITAL_REFUND : 0) -
			GravityGame.COMPETE_ENTRY;
		const escrow = GravityGame.careerRefundEscrow(career);
		const fee = plan.fee || 0;
		if (afterStake - fee - escrow < -1e-9) return false;
		if (afterStake + (plan.cashNet || 0) - escrow < (plan.exitCost || 0) - 1e-9) return false;
		let entered = 0;
		for (let mask = sport.enteredMask & ~(1 << career.index); mask; mask &= mask - 1) entered += 1;
		if (sport.pool / (1 + entered) - GravityGame.COMPETE_ENTRY <= 0) return false;
		if (!GravityGame.acceptTask(career, GravityGame.COMPETE_SLOT)) return false;
		this.traceAdd(careerTraceIndex(career), 'sport', 'entered at P' + sport.planet +
			' · −' + GravityGame.COMPETE_ENTRY.toFixed(2) + ' stake · pool +' +
			sport.pool.toFixed(2), runStep);
		return true;
	};

	GravityBot.prototype.careerOpenFan = function (r, market, runStep, angles) {
		const career = r.career;
		const sim = r.sim;
		const target = this.careerTarget(career);
		const plan = this.careerPlan(career, sim, market, runStep, true, angles, true);
		if (!plan) return null;
		/* A relaxed fan that lands on neither the pickup nor the delivery is a
		 * reposition, not a leg. A true bounce leaves the ship and the contract
		 * where they were, so it cannot justify another search from this pad. */
		if (plan.body !== plan.origin && plan.body !== target) {
			this.traceAdd(r.index, 'open fan', 'contract wants P' + target +
				' · next best is P' + plan.body, runStep);
			return plan;
		}
		this.careerDeferContract(career, runStep, 'no reachable leg from this pad');
		this.careerBurnTopReset();
		return this.careerPlan(career, sim, market, runStep, true, angles);
	};

	GravityBot.prototype.careerNextShot = function (r, market, trade, runStep) {
		const career = r.career;
		const sim = r.sim;
		const who = r.index;
		const baseAngles = this.spec().careerAngles;
		const angles = this.count > 2
			? Math.max(8, Math.floor(baseAngles * Math.sqrt(2 / this.count))) : baseAngles;
		if (career.at < 0 || career.arrested) return null;
		this.careerScanReset(runStep);
		this.careerBurnTopReset();
		let plan = this.careerPlan(career, sim, market, runStep, false, angles);
		if (!plan) plan = this.careerPlan(career, sim, market, runStep, true, angles);
		else if (this.careerShouldWait(plan, 0) ||
			(career.padCount === 1 && career.contract < 0 && !plan.builds)) {
			/* Before settling for a shuttle on opening day, or a losing sit,
			 * give the longer fan one chance to find a paying land-and-claim. */
			const first = this.careerSparePlan;
			copyCareerPlan(plan, first);
			const wider = this.careerPlan(career, sim, market, runStep, true, angles);
			if (wider && wider.score > first.score) plan = wider;
			else copyCareerPlan(first, plan);
		}
		if (plan) return this.careerReadyShot(r, plan, market, runStep, true);
		if (career.contract >= 0) {
			const open = this.careerOpenFan(r, market, runStep, angles);
			if (open) return this.careerReadyShot(r, open, market, runStep, true);
			/* the board this job came from has no leg from here: dropping it is
			 * the only thing that stops the next search from re-winning the same
			 * unpayable route back. leave the fresh board for the cooldown. */
			if (career.contract >= 0) {
				this.careerDeferContract(career, runStep, 'no reachable leg from this pad');
				GravityGame.refreshBoard(career, trade, runStep);
			}
		}
		/* the own pad is only charging: a wait is cheaper than the commercial fee */
		if (this.careerRechargeSit(r, runStep)) return null;
		/* no shot from the standing rail (drained battery, weak pad): the
		 * commercial EMC-1 is always charged, so try once more on it */
		let fallbackFee = 0;
		let rescued = false;
		/* a seized planet keeps the rebel rail: swapping in a commercial EMC-1
		 * would invent a pad the planet does not have */
		if (career.commercialPlanet !== career.at &&
			!GravityGame.emptyWorld(career, career.at) &&
			!GravityGame.planetSeized(career, career.at) &&
			GravityGame.padOwner(career, career.at) !== GravityGame.OWNER_COMMERCIAL) {
			GravityGame.setCommercial(career, career.at);
			fallbackFee = GravityGame.launchFee(career, career.at, GravitySim.SPEED_MIN);
			if (GravityGame.padLift(career, career.at) + 1e-9 >= GravitySim.SPEED_MIN &&
				career.ledger.purse + 1e-9 >= fallbackFee) {
				plan = this.careerPlan(career, sim, market, runStep, false, angles);
				if (!plan) plan = this.careerPlan(career, sim, market, runStep, true, angles);
			}
			if (!plan && career.contract >= 0 && career.ledger.purse + 1e-9 >= fallbackFee) {
				plan = this.careerOpenFan(r, market, runStep, angles);
			}
			if (!plan) {
				plan = this.careerRescueBurn(r, market, runStep);
				rescued = plan !== null;
			}
			/* A routine ticket that loses cash is not a reason to leave a pad
			 * that can recharge, even after the ordinary sit budget ran out. */
			if (plan && !rescued && plan.cashNet < 0 && !plan.builds && !advancesCareerLeg(plan.leg)) {
				GravityGame.setCommercial(career, -1);
				if (this.careerRechargeSit(r, runStep, plan.fee)) return null;
				GravityGame.setCommercial(career, career.at);
			}
			/* a rescued launch must keep the rail whose fee it was priced on */
			if (!plan) GravityGame.setCommercial(career, -1);
			this.traceAdd(who, 'commercial', (plan ? 'found a shot' : 'still no shot') +
				' · fee ' + fallbackFee.toFixed(2) +
				' · purse ' + career.ledger.purse.toFixed(2), runStep);
			if (plan) return this.careerReadyShot(r, plan, market, runStep, !rescued);
		}
		if (!plan) {
			plan = this.careerRescueBurn(r, market, runStep);
			if (plan) return this.careerReadyShot(r, plan, market, runStep, false);
		}
		this.careerNoShot(r, trade, runStep);
		return null;
	};

	/* Accumulate the live leak-then-sun update over N game steps. Solar input
	 * leaks too; treating the whole wait as one charging step overquotes it. */
	function careerChargeAfter(pad, panel, light, steps, ignoreReserve) {
		const minutes = GravityGame.careerPadMinutes(GravitySim.DT);
		const decay = pad.battery.leak * minutes;
		const sunSteps = decay ? Math.expm1(-decay * steps) / Math.expm1(-decay) : steps;
		const next = OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, minutes * steps) +
			OrbitTech.solarCharge(panel, light, GravityGame.careerPadSeconds(GravitySim.DT) * sunSteps);
		return Math.max(0, Math.min(next, pad.battery.capacity) -
			(ignoreReserve ? 0 : pad.reservedKwh));
	}

	/* Sample at the times we would actually retry. A higher speed ceiling
	 * doesn't guarantee that the exit fan's new set of rungs hits a planet.
	 * `ignoreReserve` asks what the pad holds, not what is left after promises:
	 * only the panel-shop's sunk-cost question needs that reading. */
	GravityBot.prototype.careerRechargeExit = function (r, pad, panel, gap, tries, ignoreReserve) {
		const career = r.career;
		const at = career.at;
		const source = this.departureSourceSim || this.probe;
		/* For a *sit*, only a charge that beats the live rail is a gain: an
		 * already-full pad has nothing to wait for. The panel shop asks a
		 * different question (what would this pad fly if it were refitted),
		 * so it must not apply the live-rail floor. */
		const now = ignoreReserve ? 0 : careerCargoSpeed(career, r.sim.speedLimit(at));
		for (let i = 1; i <= tries; i++) {
			const free = careerChargeAfter(pad, panel, career.light[at], gap * i, ignoreReserve);
			const cap = careerCargoSpeed(career, OrbitTech.speedLimit(free,
				career.ship.mass, pad.catapult, source.forceScale));
			if (Math.min(GravitySim.SPEED_MAX, cap) <= now + 1e-9) continue;
			const speed = this.careerExitSpeed(at, cap);
			if (speed && GravityGame.launchFee(career, at, speed) <= career.ledger.purse + 1e-9) return true;
		}
		return false;
	};

	/* A rail whose *live* charge cannot leave the pad is the pad the panel
	 * shop exists for: sunlight and its next panel can still open it, and that
	 * is cheaper than the tow. Only a label and a plan-reason need this
	 * distinction; the sit budget itself is the ordinary one. */
	GravityBot.prototype.careerRailBlocked = function (r) {
		const career = r.career;
		const at = career.at;
		const pad = at < 0 ? null : GravityGame.padAt(career, at);
		if (!pad || pad.catapult === null) return false;
		if (GravityGame.padOwner(career, at) !== career.index) return false;
		this.prepareCareerExitProbe(r.sim);
		return this.careerExitSpeed(at, careerCargoSpeed(career, r.sim.speedLimit(at))) === 0;
	};

	/* Only invest when ordinary sunlight can't get us off this pad in time.
	 * Keep the launch reserve and don't buy a panel to solve a weak rail.
	 * Owned rails only: a guest cannot refit the host's pad. */
	GravityBot.prototype.careerRechargePanel = function (r, pad, gap, tries, runStep) {
		const career = r.career;
		const at = career.at;
		if (pad !== career.pads[at] || GravityGame.padOwner(career, at) !== career.index) return false;
		/* One decision per patience cycle: a sit that already chose a panel
		 * does not re-shop on every retry. */
		if (r.panelTried) return false;
		const panel = careerNextItem(career, OrbitTech.KIND_PANEL, OrbitTech.PANELS, pad.panel);
		if (!panel || !GravityGame.gearKnown(career, panel)) return false;
		const cost = careerPrice(career, panel);
		const fallback = GravityGame.canEvacuate(career) ? GravityGame.evacuationCost(career) : CAREER_PURSE_RESERVE;
		/* Too poor to try: the pad's own wait is what makes the panel
		 * affordable, so this refusal must not spend the cycle. */
		if (cost >= fallback || career.ledger.purse + 1e-9 < cost + CAREER_PURSE_RESERVE) return false;
		if (this.careerExitSpeed(at, careerCargoSpeed(career, r.sim.speedLimit(at)))) return false;
		/* Engaged from here: the cycle's one shop decision is spent whether a
		 * panel is bought or the forecast refuses it. The forecast must still
		 * see an exit — a panel is never bought on a promise sunlight cannot
		 * keep. A backlog of promised charge is no reason to refuse: the panel
		 * is exactly what makes that promise safe. */
		r.panelTried = true;
		if (!this.careerRechargeExit(r, pad, panel, gap, CAREER_RECHARGE_TRIES, true)) return false;
		return this.careerBuyGear(career, at, OrbitTech.KIND_PANEL, panel, CAREER_PURSE_RESERVE,
			runStep, 'recharge a blocked exit');
	};

	/* No payable plan. Prefer a short recharge on a real panel (ours or a
	 * host's) to a commercial ticket, but only if it can buy a better exit. */
	GravityBot.prototype.careerRechargeSit = function (r, runStep, losingFee = 0) {
		const career = r.career;
		const at = career.at;
		if (at < 0 || !GravityGame.careerShipUsable(career) || GravityGame.padOwner(career, at) < 0) return false;
		const pad = GravityGame.padAt(career, at);
		if (!losingFee && r.waitTries >= CAREER_SIT_TRIES) return false;
		const tries = losingFee ? CAREER_SIT_TRIES : CAREER_SIT_TRIES - r.waitTries;
		const gap = CAREER_SIT_GAP + (r.gapPhase || 0);
		/* Fully promised: the pad's whole charge belongs to a launch that has
		 * not flown, so waiting cannot free any of it and no shop decision
		 * should spend the promise. Zero charge with no promise is still worth
		 * a wait. */
		if (pad.reservedKwh > 0 && pad.chargeKwh <= pad.reservedKwh + 1e-9) return false;
		this.prepareCareerExitProbe(r.sim);
		/* A panel answers the same exit question with a better answer (and it
		 * is the cure for a rail whose own panel is too weak), so it is asked
		 * before the resident forecast fills the exit cache with a 0. */
		/* A commercial wait is a decision not to buy a ticket, not a decision
		 * about the pad: the fare path never shops for a panel, because the
		 * money it is protecting is exactly the money a panel would spend. */
		const panel = losingFee ? false : this.careerRechargePanel(r, pad, gap, tries, runStep);
		if (!panel && !this.careerRechargeExit(r, pad, pad.panel, gap, tries)) return false;
		r.waitTries = Math.min(CAREER_SIT_TRIES, r.waitTries + 1);
		this.careerBetweenFlights(career, r.sim, runStep);
		r.readyStep = runStep + gap;
		const why = losingFee ? 'wait instead of losing a ' + losingFee.toFixed(2) + ' commercial ticket'
			: this.careerRailBlocked(r) ? 'blocked rail' : 'drained pad';
		const count = r.waitTries + '/' + CAREER_SIT_TRIES;
		this.traceAdd(r.index, 'sit', why + ' · charge ' + pad.chargeKwh.toFixed(2) +
			' kWh · sit ' + count + ' · retry in ' +
			((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s', runStep);
		return true;
	};

	/* A blocked owned rail with patience left: the ordinary recharge wait
	 * (sunlight, or the next panel) is the way out, not the tow. Past the budget
	 * it is a dead end and the evacuation may run. */

	/* nothing flies from here: fly home out of a dead end after a couple of
	 * tries, drop a contract whose target no trajectory reaches, then shop again */
	GravityBot.prototype.careerNoShot = function (r, trade, runStep) {
		const career = r.career;
		const sim = r.sim;
		const why = this.careerNoPlanWhy(career, sim);
		let recovery = '';
		r.idleTries += 1;
		/* All fans failed, including the commercial fallback and any recharge
		 * wait. A physical exit into another unaffordable landing isn't a way
		 * out, even on the Capital where the origin rail itself is free. */
		if (r.idleTries >= CAREER_STUCK_TRIES && GravityGame.canEvacuate(career) &&
			GravityGame.evacuate(career, sim, GravityGame.evacuationCost(career), runStep)) {
			recovery = 'evacuation started';
		} else if (career.contract >= 0 && r.idleTries >= 3) {
			this.careerDeferContract(career, runStep, 'no payable flight');
			GravityGame.refreshBoard(career, trade, runStep);
			recovery = 'dropped the unreachable contract';
		}
		this.careerBetweenFlights(career, sim, runStep);
		if (career.evacuating) recovery = 'evacuation started';
		/* Dropping a job changes the search, not the ship's ability to leave.
		 * Resetting here lets repeated board churn postpone the tow forever. */
		if (career.evacuating) r.idleTries = 0;
		const gap = recovery ? 1 : CAREER_RIVAL_GAP + (r.gapPhase || 0);
		r.readyStep = runStep + gap;
		this.traceAdd(r.index, 'no shot', why + ' · idle ' + r.idleTries +
			(recovery ? ' · ' + recovery : '') + ' · ' +
			(gap === 1 ? 'retry next step' :
				'retry in ' + (gap * GravitySim.DT).toFixed(1) + ' s'), runStep);
	};

	/* a company that cannot afford an EMC build where it stands sits out a few
	 * turns: a pad that charges while it waits is worth more than a cheap hop */
	GravityBot.prototype.careerSit = function (r, plan, runStep) {
		if (!this.careerShouldWait(plan, r.waitTries)) {
			r.waitTries = 0;
			return false;
		}
		r.waitTries += 1;
		/* the commercial choice bought one attempt only: a sit must not leave the
		 * company paying its fee again after its own pad charged */
		GravityGame.setCommercial(r.career, -1);
		this.careerBetweenFlights(r.career, r.sim, runStep);
		r.readyStep = runStep + CAREER_SIT_GAP + (r.gapPhase || 0);
		this.traceAdd(r.index, 'sit', 'score ' + signed(plan.score) +
			' · no EMC build · sit ' + r.waitTries + '/' + CAREER_SIT_TRIES +
			' · retry in ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s', runStep);
		return true;
	};

	GravityBot.prototype.careerLaunch = function (r, market, trade, fieldRate, runStep) {
		const career = r.career;
		const sim = r.sim;
		const who = r.index;
		let shot = null;
		if (r.turret) {
			/* a queued shot waits for the EMC barrel to turn to the aim on the same
		 * in-game clock the player's turret uses; guest or owner of the pad does
		 * not matter, the rail that fires spends its own charge */
			if (runStep < r.turret.fireAt) return false;
			if (GravityGame.padAt(career, r.turret.origin) !== r.turret.pad) {
				this.careerDropQueue(r);
				return false;
			}
			shot = r.turret;
			r.turret = null;
		} else {
			const plan = this.careerNextShot(r, market, trade, runStep);
			if (!plan) return false;
			this.traceCareerPlan(who, plan, runStep);
			r.idleTries = 0;
			if (this.careerSit(r, plan, runStep)) return false;
			const requested = plan.fuelProducedKg + plan.fuelBoughtKg > 0;
			if (requested && !this.careerCommitFuel(r, plan, runStep)) {
				r.readyStep = runStep + CAREER_RIVAL_GAP;
				return false;
			}
			if (!requested) this.careerPrepareFuel(r, plan, market, runStep);
			this.careerRaceEntry(career, sim, plan, runStep);
			/* queue the shot: the first to queue claims the pad charge, then the
			 * barrel turns on the same in-game clock the player's turret uses —
			 * an entered race shot waits for the gun when it queues early */
			const period = GravityGame.turretPeriod(career.galaxy, plan.origin);
			const holdStep = GravityGame.sportHoldStep(career, plan.origin, runStep);
			const gun = GravityGame.turretAngle(career.galaxy, plan.origin, holdStep * GravitySim.DT);
			let delta = plan.angle - gun;
			delta -= Math.floor(delta / TAU) * TAU;
			const wait = delta < 0.02 ? 0 : delta / TAU * period;
			const pad = GravityGame.padAt(career, plan.origin);
			const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, plan.speed);
			GravityGame.reserveEnergy(pad, energy);
			career.plannedLanding = plan.body;
			r.turret = {
				origin: plan.origin,
				angle: plan.angle,
				speed: plan.speed,
				body: plan.body,
				score: plan.score,
				fireAt: holdStep + Math.ceil(wait / GravitySim.DT),
				pad: pad,
				energy: energy
			};
			this.traceCareerQueue(career, plan.origin, plan.angle, plan.speed, energy, r.turret.fireAt, runStep);
			return false;
		}
		/* fire the queued shot */
		const origin = shot.origin;
		const angle = shot.angle;
		const speed = shot.speed;
		sim.fieldT = trade.t;
		if (fieldRate !== undefined) sim.fieldRate = fieldRate;
		sim.stepLimit = GravityGame.CAP_STEPS;
		sim.limitReason = END_TIME;
	r.shots.push(GravityGame.createShot(GravityGame.SRC_PLANETS, origin,
		GravityGame.angleUnits(angle), GravityGame.speedUnits(speed), GravityGame.NO_ABORT));
	sim.launch(origin, angle, speed);
	GravityGame.careerBeginFlight(career, sim, runStep);
		r.basePlanet = origin;
		this.traceCareerFire(career, sim, runStep);
		return true;
	};

	GravityBot.prototype.careerLand = function (r, trade, runStep) {
		const career = r.career;
		GravityGame.careerEndFlight(career, r.sim, trade, runStep);
		r.basePlanet = career.at;
		r.readyStep = runStep + CAREER_RIVAL_GAP + r.gapPhase;
		r.idleTries = 0;
		r.waitTries = 0;
		r.panelTried = false;
		this.traceCareerLanding(career, r.sim, runStep);
		this.careerBetweenFlights(career, r.sim, runStep);
	};

	GravityBot.prototype.careerReady = function (index) {
		const career = this.rivals[index] ? this.rivals[index].career : null;
		return Boolean(career) && career.ended === GravityGame.CAREER_OPEN;
	};
	GravityBot.CAREER_SIT_GAP = CAREER_SIT_GAP;
});
