/*
 * Career controller, burns and fuel: launch with a burn, burn pricing, fuel
 * offers and purchase, rescue burns, the ready shot, race entry, open fans.
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
		TAU, CAREER_ENERGY_WAIT_COST, CAREER_RIVAL_GAP, CAREER_PURSE_RESERVE, careerRefundEscrow,
		CAREER_BURN_AT, CAREER_BURN_PRICE_MARGIN, CAREER_RESCUE_ANGLES,
		CAREER_RESCUE_SPEED_FRACTION, CAREER_MIN_SCORE, PRED_LOG_MAX, signed, careerTraceIndex,
		careerCargoSpeed
	} = GravityBot;

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
			const bearing = Math.atan2(live.planetY[target] - live.planetY[origin],
				live.planetX[target] - live.planetX[origin]);
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

	Object.assign(GravityBot, {
		copyCareerPlan
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
