/*
 * Two-leg contract valuation (0.7.40): cached impact ways per (origin → goal),
 * pair slots, the post-landing rail cap, hasFeasibleLeg and careerLegPlan.
 *
 * Part of GravityGame: gravity_game.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const GravitySim = node ? require('./gravity_sim.js') : root.GravitySim;
	const OrbitEcon = node ? require('./orbit_econ.js') : root.OrbitEcon;
	const OrbitTech = node ? require('./orbit_tech.js') : root.OrbitTech;
	const {
		CAP_SECONDS, estScratch, BOOK_LOG_MAX, angleUnits, angleOf, speedUnits, speedOf,
		FRAGILE_SPEED, visitReports, walkProfitLog, CAREER, COMPETE_SLOT, BOARD_SIZE, TASK_DELIVERY,
		TASK_COMPETE, TASK_MEDIC, TASK_OFFERED, TASK_ACCEPTED, LEG_NONE, LEG_LOAD, LEG_DELIVER,
		LEG_MEDICS, LEG_PATIENTS, LEG_CREDIT, OWNER_COMMERCIAL, OWNER_CAPITAL, CAPITAL_VISIT_PAY,
		CAPITAL_REFUND, OWNER_REBEL, commercialPadAt, padAt, padOwner, commercialFee, launchFee,
		careerPadSeconds, careerPadMinutes, forecastCondition, forecastReportUntil,
		forecastRepairReserve, forecastWearCost, repairCost, medicLoad, canAccept,
		careerLandingFacts, LEG_PAIR_SLOTS, LEG_PAIR_WAYS, LEG_SCAN_ALL_SPEEDS,
		LEG_SCAN_CIRCLE_SPEEDS, LEG_SCAN_CIRCLE_ANGLES, LEG_SCAN_FAN_HALF, LEG_SCAN_FAN_STEP,
		LEG_SCAN_FINE_HALF, LEG_SCAN_FINE_STEP, LEG_SCAN_FINE_SPEEDS, leg1VisitScratch,
		legFactsScratch, legDepScratch1, legDepScratch2, prepareLegProbe, legFieldTag,
		careerRefundEscrow, careerArrivalMass, careerArrivalCharge, checkExitSpeed, careerDeparture,
		launchBookTag, bookReady
	} = GravityGame;

	function makeLegTraceSlot() {
		return {
			valid: false, origin: -1, angleU: 0, speedU: 0, body: -1,
			steps: 0, time: 0, length: 0,
			logPlanet: new Int16Array(BOOK_LOG_MAX),
			logStep: new Int32Array(BOOK_LOG_MAX),
			logDwell: new Int32Array(BOOK_LOG_MAX),
			logCount: 0
		};
	}

	const legPairSlots = new Array(LEG_PAIR_SLOTS);
	for (let i = 0; i < LEG_PAIR_SLOTS; i++) {
		const ways = new Array(LEG_PAIR_WAYS);
		for (let w = 0; w < LEG_PAIR_WAYS; w++) ways[w] = makeLegTraceSlot();
		legPairSlots[i] = { valid: false, tag: 0, origin: -1, goal: -1, count: 0, ways: ways };
	}
	let legPairHand = 0;

	function storeLegWay(way, probe, origin, angleU, speedU) {
		way.valid = true;
		way.origin = origin;
		way.angleU = angleU;
		way.speedU = speedU;
		way.body = probe.predBody;
		way.steps = probe.predSteps;
		way.time = probe.predTime;
		way.length = probe.predLength;
		const count = probe.predLogCount < BOOK_LOG_MAX ? probe.predLogCount : BOOK_LOG_MAX;
		way.logCount = count;
		for (let i = 0; i < count; i++) {
			way.logPlanet[i] = probe.predLogPlanet[i];
			way.logStep[i] = probe.predLogStep[i];
			way.logDwell[i] = probe.predLogDwell[i];
		}
	}

	/* Keep up to 6 diverse impact ways for (origin → goal):
	 *   0: minimum launch speed (heaviest loaded cargo / weakest rail)
	 *   1: fastest fragile-safe (speed <= FRAGILE_SPEED)
	 *   2: longest flyby path fragile-safe (speed <= FRAGILE_SPEED)
	 *   3: fastest overall (tightest deadline)
	 *   4: fastest medium-rail (speed <= 230)
	 *   5: longest flyby path overall (richest harvest) */
	function considerLegHit(ways, probe, origin, goal, angleU, speedU) {
		const speed = speedOf(speedU);
		const angle = angleOf(angleU);
		probe.predictFast(origin, angle, speed, CAP_SECONDS);
		if (probe.predReason !== GravitySim.END_IMPACT || probe.predBody !== goal) return false;
		const steps = probe.predSteps;
		const length = probe.predLength;
		const fragile = speed <= FRAGILE_SPEED + 1e-9;
		const medium = speed <= 230 + 1e-9;

		const w0 = !ways[0].valid || speedU < ways[0].speedU ||
			(speedU === ways[0].speedU && steps < ways[0].steps);
		const w1 = fragile && (!ways[1].valid || steps < ways[1].steps ||
			(steps === ways[1].steps && speedU < ways[1].speedU));
		const w2 = fragile && (!ways[2].valid || length > ways[2].length);
		const w3 = !ways[3].valid || steps < ways[3].steps ||
			(steps === ways[3].steps && speedU < ways[3].speedU);
		const w4 = medium && (!ways[4].valid || steps < ways[4].steps);
		const w5 = !ways[5].valid || length > ways[5].length;
		if (!w0 && !w1 && !w2 && !w3 && !w4 && !w5) return true;

		probe.predict(origin, angle, speed, CAP_SECONDS);
		if (probe.predReason !== GravitySim.END_IMPACT || probe.predBody !== goal) return false;
		if (w0) storeLegWay(ways[0], probe, origin, angleU, speedU);
		if (w1) storeLegWay(ways[1], probe, origin, angleU, speedU);
		if (w2) storeLegWay(ways[2], probe, origin, angleU, speedU);
		if (w3) storeLegWay(ways[3], probe, origin, angleU, speedU);
		if (w4) storeLegWay(ways[4], probe, origin, angleU, speedU);
		if (w5) storeLegWay(ways[5], probe, origin, angleU, speedU);
		return true;
	}

	function lookupLegPairSlot(sourceSim, origin, goal, fieldTime) {
		const probe = prepareLegProbe(sourceSim);
		if (!probe || !probe.planetActive(origin) || !probe.planetActive(goal) || origin === goal) {
			return null;
		}
		if (!probe.fieldStatic && fieldTime !== undefined) {
			probe.fieldT = fieldTime;
			probe.refreshField();
		}
		const tag = legFieldTag(probe, probe.fieldT);
		for (let i = 0; i < LEG_PAIR_SLOTS; i++) {
			const s = legPairSlots[i];
			if (s.valid && s.tag === tag && s.origin === origin && s.goal === goal) return s;
		}

		const slot = legPairSlots[legPairHand];
		legPairHand = (legPairHand + 1) % LEG_PAIR_SLOTS;
		slot.valid = true;
		slot.tag = tag;
		slot.origin = origin;
		slot.goal = goal;
		slot.count = 0;
		const ways = slot.ways;
		for (let w = 0; w < LEG_PAIR_WAYS; w++) ways[w].valid = false;

		const tau = Math.PI * 2;
		const dx = probe.planetX[goal] - probe.planetX[origin];
		const dy = probe.planetY[goal] - probe.planetY[origin];
		const bearing = Math.atan2(dy, dx);
		let anyHit = false;

		for (let s = 0; s < LEG_SCAN_ALL_SPEEDS.length; s++) {
			const speedU = speedUnits(LEG_SCAN_ALL_SPEEDS[s]);
			for (let k = -LEG_SCAN_FAN_HALF; k <= LEG_SCAN_FAN_HALF; k++) {
				const angleU = angleUnits(bearing + k * LEG_SCAN_FAN_STEP);
				if (considerLegHit(ways, probe, origin, goal, angleU, speedU)) anyHit = true;
			}
		}
		for (let s = 0; s < LEG_SCAN_CIRCLE_SPEEDS.length; s++) {
			const speedU = speedUnits(LEG_SCAN_CIRCLE_SPEEDS[s]);
			for (let a = 0; a < LEG_SCAN_CIRCLE_ANGLES; a++) {
				const angleU = angleUnits((a + 0.5) / LEG_SCAN_CIRCLE_ANGLES * tau);
				if (considerLegHit(ways, probe, origin, goal, angleU, speedU)) anyHit = true;
			}
		}
		if (!anyHit) {
			for (let s = 0; s < LEG_SCAN_FINE_SPEEDS.length; s++) {
				const speedU = speedUnits(LEG_SCAN_FINE_SPEEDS[s]);
				for (let k = -LEG_SCAN_FINE_HALF; k <= LEG_SCAN_FINE_HALF; k++) {
					const angleU = angleUnits(bearing + k * LEG_SCAN_FINE_STEP);
					if (considerLegHit(ways, probe, origin, goal, angleU, speedU)) anyHit = true;
				}
			}
		}
		for (let w = 0; w < LEG_PAIR_WAYS; w++) {
			if (ways[w].valid) slot.count += 1;
		}
		return slot;
	}

	function postLandingRailCap(career, planet, mass, forceScale, flightSeconds) {
		const pad = padAt(career, planet, false);
		const owner = padOwner(career, planet, false);
		let charge = pad.battery.capacity;
		if (owner === career.index) {
			const botCharge = careerArrivalCharge(career, planet, flightSeconds);
			const raw = Math.max(0, pad.chargeKwh - pad.reservedKwh);
			const leaked = OrbitTech.batteryLeak(raw, careerPadMinutes(flightSeconds));
			const gained = OrbitTech.solarCharge(pad.panel, career.light[planet],
				careerPadSeconds(flightSeconds));
			const exact = Math.max(0, Math.min(pad.battery.capacity, raw - leaked + gained) - pad.reservedKwh);
			charge = exact < botCharge ? exact : botCharge;
		} else if (owner >= 0) {
			charge = Math.max(0, pad.chargeKwh - pad.reservedKwh);
		}
		return OrbitTech.speedLimit(charge, mass, pad.catapult, forceScale);
	}

	function currentPadCapForMass(career, planet, mass, forceScale) {
		const pad = padAt(career, planet, true);
		const owner = padOwner(career, planet, true);
		const charge = owner === OWNER_COMMERCIAL || owner === OWNER_CAPITAL || owner === OWNER_REBEL
			? pad.battery.capacity : Math.max(0, pad.chargeKwh - pad.reservedKwh);
		return OrbitTech.speedLimit(charge, mass, pad.catapult, forceScale);
	}

	function copyLeg2Candidate(dst, src, visitPay2, reward2, cash2, fee2, wear2, exit2, net2, legKind, commercial) {
		dst.origin = src.origin;
		dst.angleU = src.angleU;
		dst.speedU = src.speedU;
		dst.body = src.body;
		dst.steps = src.steps;
		dst.time = src.time;
		dst.length = src.length;
		dst.visitPay = visitPay2;
		dst.reward = reward2;
		dst.cash = cash2;
		dst.fee = fee2;
		dst.wear = wear2;
		dst.exit = exit2;
		dst.net = net2;
		dst.leg = legKind;
		dst.commercial = commercial;
		const count = src.logCount < BOOK_LOG_MAX ? src.logCount : BOOK_LOG_MAX;
		dst.logCount = count;
		for (let i = 0; i < count; i++) {
			dst.logPlanet[i] = src.logPlanet[i];
			dst.logStep[i] = src.logStep[i];
			dst.logDwell[i] = src.logDwell ? src.logDwell[i] : 0;
		}
	}

	/* Quick non-mutating check used by board acceptance to ensure a pickup's
	 * loaded second leg (from → to) physically exists before deadline. */
	function hasFeasibleLeg(career, sim, from, to, loadedMass, fragile, remainingSteps) {
		const slot = lookupLegPairSlot(sim, from, to);
		if (!slot || slot.count === 0) return false;
		const pad = padAt(career, from, false);
		const owner = padOwner(career, from, false);
		const charge = owner === OWNER_COMMERCIAL || owner === OWNER_CAPITAL || owner === OWNER_REBEL
			? pad.battery.capacity
			: owner === career.index ? pad.battery.capacity
			: Math.max(0, pad.chargeKwh - pad.reservedKwh);
		let cap = OrbitTech.speedLimit(charge, loadedMass, pad.catapult, sim.forceScale);
		const commPad = commercialPadAt(career, from);
		const commCap = OrbitTech.speedLimit(commPad.battery.capacity, loadedMass,
			commPad.catapult, sim.forceScale);
		if (commCap > cap) cap = commCap;
		if (fragile && cap > FRAGILE_SPEED) cap = FRAGILE_SPEED;
		if (cap + 1e-9 < GravitySim.SPEED_MIN) return false;
		for (let w = 0; w < LEG_PAIR_WAYS; w++) {
			const way = slot.ways[w];
			if (!way.valid) continue;
			if (speedOf(way.speedU) > cap + 1e-9) continue;
			if (remainingSteps !== undefined && way.steps > remainingSteps) continue;
			return true;
		}
		return false;
	}

	function resetLegPlanOut(out, slot, prospective) {
		out.feasible = false;
		out.hasSecond = false;
		out.slot = slot;
		out.prospective = prospective;
		out.leg1Leg = LEG_NONE;
		out.leg1Cash = 0;
		out.leg1Fee = 0;
		out.leg1Wear = 0;
		out.leg1Exit = Infinity;
		out.leg1Net = -Infinity;
		out.credit = 0;
		out.total = -Infinity;
		out.purseDelta = -Infinity;
		out.leg2.origin = -1;
		out.leg2.body = -1;
		out.leg2.net = -Infinity;
		out.leg2.logCount = 0;
		out.leg2.commercial = false;
		return out;
	}

	/*
	 * Zero-allocation two-leg contract evaluator shared by UI helpers (`quest scan`,
	 * `plan quest`, `moneyFacts`) and `GravityBot`.
	 *
	 * `leg1` holds `{ origin, body, speed, flownLen, length, steps, visitPay,
	 * bribe, condition, burnDv, fee, logPlanet, logStep, logDwell, logCount }`.
	 * `opts` optionally passes `{ slot, seekClaim, exitSpeedFn }`.
	 */
	function careerLegPlan(out, career, market, sim, leg1, runStep, opts) {
		const explicitSlot = opts && Number.isInteger(opts.slot) ? opts.slot : -1;
		const prospective = explicitSlot >= 0 && career.contract < 0 &&
			career.tasks[explicitSlot] && career.tasks[explicitSlot].state === TASK_OFFERED;
		const slot = prospective ? explicitSlot : career.contract;
		resetLegPlanOut(out, slot, prospective);
		if (!career || !sim || leg1.body < 0 || !sim.planetActive(leg1.body)) return out;

		const origin = leg1.origin;
		const body = leg1.body;
		const speed1 = leg1.speed || 0;
		const flownLen = leg1.flownLen || 0;
		const length1 = leg1.length || 0;
		const steps1 = leg1.steps || 0;
		const visitPay1 = leg1.visitPay || 0;
		const bribe1 = leg1.bribe || 0;
		const burnDv1 = leg1.burnDv || 0;
		const cond0 = leg1.condition === undefined ? career.ship.condition : leg1.condition;
		const repair0 = cond0 > career.ship.condition + 1e-9 ? repairCost(career) : 0;
		const seekClaim = Boolean(opts && opts.seekClaim);
		const exitSpeedFn = opts && opts.exitSpeedFn ? opts.exitSpeedFn : null;

		let leg1Mass = career.ship.mass;
		let acceptRefund = 0;
		const task = slot >= 0 && slot < BOARD_SIZE ? career.tasks[slot] : null;
		let effectiveDeadline = task ? task.deadline : 0;

		if (prospective && task) {
			if (!canAccept(career, slot)) return out;
			if (origin === career.capitalPlanet) acceptRefund = CAPITAL_REFUND;
			if (task.kind === TASK_MEDIC) {
				leg1Mass = OrbitTech.shipMass(career.ship, task.medics);
				const nowStep = market ? Math.max(0, market.politicsStep) : runStep;
				const span = Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
				if (nowStep + span > effectiveDeadline) effectiveDeadline = nowStep + span;
			} else if (task.kind === TASK_DELIVERY && origin === task.from) {
				leg1Mass = OrbitTech.shipMass(career.ship, task.tons);
			}
			if (speed1 > 0 && leg1Mass > career.ship.mass + 1e-9) {
				const postAcceptCap1 = currentPadCapForMass(career, origin, leg1Mass, sim.forceScale);
				if (speed1 > postAcceptCap1 + 1e-9) return out;
			}
		}

		const fee1 = leg1.fee !== undefined ? leg1.fee
			: speed1 > 0 ? launchFee(career, origin, speed1, leg1Mass) : 0;
		const arrival1 = forecastCondition(career, cond0, steps1, speed1, burnDv1, true);
		const wear1 = forecastWearCost(career, cond0, steps1, speed1, burnDv1, true);
		const mandatoryRepair1 = forecastRepairReserve(career, arrival1);
		if (career.ledger.purse + acceptRefund - repair0 - fee1 < -1e-9) return out;

		let cash1 = visitPay1 + bribe1;
		let credit1 = 0;
		let leg1Kind = LEG_NONE;
		let twoLegStop = false;
		let goal2 = -1;
		let tons2 = 0;
		let fragile2 = false;
		let reward2 = 0;
		let leg2Kind = LEG_NONE;
		let endMass2 = OrbitTech.shipMass(career.ship, 0);

		if (prospective && task) {
			if (runStep + steps1 > effectiveDeadline) return out;
			const compete = career.tasks[COMPETE_SLOT];
			if (compete.kind === TASK_COMPETE && compete.state === TASK_ACCEPTED &&
				origin === compete.planet && flownLen + length1 >= compete.minLength &&
				!(career.flying && career.flightStartStep < compete.startsAt)) {
				const launchStep = !career.flying && runStep < compete.startsAt
					? compete.startsAt : runStep;
				if (launchStep + steps1 <= compete.deadline) cash1 += compete.reward;
			}
			if (task.kind === TASK_DELIVERY && origin === task.from) {
				if (body !== task.to || (task.fragile && speed1 > FRAGILE_SPEED + 1e-9)) return out;
				cash1 += task.reward;
				leg1Kind = LEG_DELIVER;
			} else if (task.kind === TASK_DELIVERY) {
				if (body !== task.from) return out;
				twoLegStop = true;
				leg1Kind = LEG_LOAD;
				goal2 = task.to;
				tons2 = task.tons;
				fragile2 = task.fragile === true;
				reward2 = task.reward;
				leg2Kind = LEG_DELIVER;
			} else if (task.kind === TASK_MEDIC) {
				if (body !== task.to) return out;
				const picked = market
					? Math.min(task.medics, market.patients[body], career.ship.hold.capacity) : task.medics;
				if (!(picked > 0) || career.capitalPlanet < 0) return out;
				twoLegStop = true;
				leg1Kind = LEG_MEDICS;
				goal2 = career.capitalPlanet;
				tons2 = picked;
				fragile2 = false;
				reward2 = picked * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
				leg2Kind = LEG_PATIENTS;
				const left = market && market.patients[body] > picked ? market.patients[body] - picked : 0;
				endMass2 = OrbitTech.shipMass(career.ship, medicLoad(career, left));
			} else {
				return out;
			}
		} else {
			careerLandingFacts(legFactsScratch, career, origin, body, flownLen, length1,
				steps1, runStep, visitPay1, speed1);
			cash1 = legFactsScratch.cash + bribe1;
			credit1 = legFactsScratch.credit;
			leg1Kind = legFactsScratch.leg;
			if (career.contract >= 0 && task) {
				if (task.kind === TASK_DELIVERY && task.state === TASK_ACCEPTED && body === task.from) {
					if (runStep + steps1 > effectiveDeadline) {
						/* Pickup reached after deadline: contract already expired. */
						return out;
					}
					twoLegStop = true;
					goal2 = task.to;
					tons2 = task.tons;
					fragile2 = task.fragile === true;
					reward2 = task.reward;
					leg2Kind = LEG_DELIVER;
				} else if (task.kind === TASK_MEDIC && task.aboard === 0 && body === task.to) {
					if (runStep + steps1 > effectiveDeadline) return out;
					const picked = market
						? Math.min(task.medics, market.patients[body], career.ship.hold.capacity) : task.medics;
					if (!(picked > 0) || career.capitalPlanet < 0) return out;
					twoLegStop = true;
					goal2 = career.capitalPlanet;
					tons2 = picked;
					fragile2 = false;
					reward2 = picked * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
					leg2Kind = LEG_PATIENTS;
					const left = market && market.patients[body] > picked ? market.patients[body] - picked : 0;
					endMass2 = OrbitTech.shipMass(career.ship, medicLoad(career, left));
				}
			}
		}

		out.leg1Leg = leg1Kind;
		out.leg1Cash = cash1;
		out.leg1Fee = fee1;
		out.leg1Wear = wear1;

		/* --- 1. Single-leg (completes contract, sport, or non-two-leg hop) --- */
		if (!twoLegStop) {
			let releasedEscrow = 0;
			const contractTask = !prospective && career.contract >= 0 ? career.tasks[career.contract] : null;
			if (contractTask && contractTask.capitalRefund > 0) {
				const patientsRemain = leg1Kind === LEG_PATIENTS && market &&
					market.patients[contractTask.to] > contractTask.aboard;
				if (leg1Kind === LEG_DELIVER || (leg1Kind === LEG_PATIENTS && !patientsRemain)) {
					releasedEscrow += contractTask.capitalRefund;
				}
			}
			const compete1 = career.tasks[COMPETE_SLOT];
			if (compete1.kind === TASK_COMPETE && compete1.state === TASK_ACCEPTED &&
				compete1.capitalRefund > 0 && origin === compete1.planet &&
				!(career.flying && career.flightStartStep < compete1.startsAt)) {
				releasedEscrow += compete1.capitalRefund;
			}
			const escrow1 = Math.max(0, careerRefundEscrow(career) - releasedEscrow);
			if (escrow1 > 0 && career.ledger.purse + acceptRefund - repair0 - fee1 - mandatoryRepair1 - escrow1 < -1e-9) {
				return out;
			}
			const avail1 = career.ledger.purse + acceptRefund - repair0 + cash1 - fee1 - mandatoryRepair1 - escrow1;
			const mass1 = prospective ? endMass2 : careerArrivalMass(career, body);
			const dep1 = careerDeparture(legDepScratch1, career, body, avail1, mass1, sim,
				arrival1 === 0 ? 1 : arrival1, seekClaim, true,
				GravitySim.gameSeconds(steps1), exitSpeedFn);
			if (!dep1.ok || avail1 + 1e-9 < dep1.cost) return out;
			out.feasible = true;
			out.hasSecond = false;
			out.leg1Exit = dep1.cost;
			out.leg1Net = cash1 - fee1 - dep1.cost - wear1 + (prospective ? acceptRefund : 0);
			out.credit = credit1;
			out.total = out.leg1Net + credit1;
			out.purseDelta = acceptRefund - repair0 + cash1 - fee1 - mandatoryRepair1;
			return out;
		}

		/* --- 2. Two-leg intermediate stop (`origin → body = stop1 → goal2`) --- */
		const step2 = runStep + steps1;
		const postMass = OrbitTech.shipMass(career.ship, tons2);
		const postCond = arrival1 === 0 ? 1 : arrival1;
		const taskEscrow = !prospective && task && task.capitalRefund > 0 ? task.capitalRefund : 0;
		const otherEscrow = Math.max(0, careerRefundEscrow(career) - taskEscrow);
		if (otherEscrow > 0 && career.ledger.purse + acceptRefund - repair0 - fee1 - mandatoryRepair1 - otherEscrow < -1e-9) {
			return out;
		}
		const postPurse = career.ledger.purse + acceptRefund - repair0 + cash1 - fee1 - mandatoryRepair1;
		const flightSec1 = GravitySim.gameSeconds(steps1);
		const defaultCap2 = postLandingRailCap(career, body, postMass, sim.forceScale, flightSec1);
		const commPad2 = commercialPadAt(career, body);
		const commCap2 = OrbitTech.speedLimit(commPad2.battery.capacity, postMass,
			commPad2.catapult, sim.forceScale);
		let maxCap2 = commCap2 > defaultCap2 ? commCap2 : defaultCap2;
		if (fragile2 && maxCap2 > FRAGILE_SPEED) maxCap2 = FRAGILE_SPEED;
		if (maxCap2 + 1e-9 < GravitySim.SPEED_MIN) return out;

		/* Advance market visit scratch through leg 1 so leg 2 never double-counts a flyby. */
		if (market) {
			estScratch.set(market.lastVisitStep);
			if (leg1.logPlanet && leg1.logStep && leg1.logCount > 0) {
				const reportUntil1 = forecastReportUntil(career, cond0, speed1, burnDv1);
				walkProfitLog(market, runStep, leg1.logPlanet, leg1.logStep, leg1.logCount,
					career.ledger, reportUntil1, undefined, leg1.logDwell);
			} else if (visitReports(career.ledger, market, body) &&
				body !== market.capitalPlanet && body !== market.arfPlanet) {
				estScratch[body] = step2;
			}
			leg1VisitScratch.set(estScratch);
		}

		const fieldTime2 = sim.fieldStatic ? sim.fieldT : sim.fieldT + flightSec1 * sim.fieldRate;
		const pairSlot = lookupLegPairSlot(sim, body, goal2, fieldTime2);
		const bookTag = sim.fieldStatic ? launchBookTag(sim.fieldStatic, sim.gravityScale,
			sim.forceScale, sim.strength, sim.bodyCount) : 0;
		const bookEntries = career.launchBook && bookReady(career.launchBook, bookTag)
			? career.launchBook.entries : null;
		const bookLen = bookEntries ? bookEntries.length : 0;
		const pairLen = pairSlot ? LEG_PAIR_WAYS : 0;
		const totalCands = bookLen + pairLen;

		/* Medical multi-trip: if patients remain on the rebel world after leg 2,
		 * the Capital refund stays locked on the continuing medical contract. */
		const medicContinues = task && task.kind === TASK_MEDIC && market &&
			market.patients[body] > tons2;
		const endEscrow = otherEscrow + (medicContinues ? (taskEscrow + acceptRefund) : 0);

		let bestLeg2Net = -Infinity;
		let bestSteps2 = Infinity;
		let bestMandatory2 = 0;

		for (let idx = 0; idx < totalCands; idx++) {
			let cand;
			if (idx < bookLen) {
				cand = bookEntries[idx];
				if (cand.origin !== body || cand.body !== goal2) continue;
			} else {
				cand = pairSlot.ways[idx - bookLen];
				if (!cand.valid) continue;
			}
			const speed2 = speedOf(cand.speedU);
			if (speed2 > maxCap2 + 1e-9) continue;
			if (fragile2 && speed2 > FRAGILE_SPEED + 1e-9) continue;
			if (step2 + cand.steps > effectiveDeadline) continue;

			const needsCommercial = speed2 > defaultCap2 + 1e-9;
			const fee2 = needsCommercial
				? commercialFee(career, body, speed2, postMass)
				: launchFee(career, body, speed2, postMass, false);
			if (postPurse - fee2 - otherEscrow < -1e-9) continue;

			const arrival2 = forecastCondition(career, postCond, cand.steps, speed2, 0, true);
			const wear2 = forecastWearCost(career, postCond, cand.steps, speed2, 0, true);
			const mandatory2 = forecastRepairReserve(career, arrival2);

			let visitPay2 = 0;
			if (market) {
				estScratch.set(leg1VisitScratch);
				const reportUntil2 = forecastReportUntil(career, postCond, speed2, 0);
				visitPay2 = walkProfitLog(market, step2, cand.logPlanet, cand.logStep,
					cand.logCount, career.ledger, reportUntil2, undefined, cand.logDwell);
			}
			let cash2 = visitPay2 + reward2;
			const compete = career.tasks[COMPETE_SLOT];
			if (compete.kind === TASK_COMPETE && compete.state === TASK_ACCEPTED &&
				body === compete.planet && cand.length >= compete.minLength) {
				const launchStep = step2 < compete.startsAt ? compete.startsAt : step2;
				if (launchStep + cand.steps <= compete.deadline) cash2 += compete.reward;
			}

			const avail2 = postPurse - fee2 + cash2 - mandatory2 - endEscrow;
			if (avail2 < -1e-9) continue;
			const dep2 = careerDeparture(legDepScratch2, career, goal2, avail2, endMass2, sim,
				arrival2 === 0 ? 1 : arrival2, false, true,
				flightSec1 + GravitySim.gameSeconds(cand.steps), exitSpeedFn);
			if (!dep2.ok || avail2 + 1e-9 < dep2.cost) continue;

			/* Prefer a shot that fires directly on stop1's default post-landing rail
			 * over one that requires toggling the commercial override menu. */
			const net2 = cash2 - fee2 - dep2.cost - wear2;
			const better = !needsCommercial && out.leg2.commercial
				? net2 >= bestLeg2Net - 0.05
				: needsCommercial && !out.leg2.commercial && out.hasSecond
				? net2 > bestLeg2Net + 0.05
				: net2 > bestLeg2Net + 1e-12 ||
					(Math.abs(net2 - bestLeg2Net) <= 1e-12 && cand.steps < bestSteps2);
			if (!better) continue;

			bestLeg2Net = net2;
			bestSteps2 = cand.steps;
			bestMandatory2 = mandatory2;
			out.hasSecond = true;
			copyLeg2Candidate(out.leg2, cand, visitPay2, reward2, cash2, fee2, wear2,
				dep2.cost, net2, leg2Kind, needsCommercial);
		}

		if (!out.hasSecond) {
			/* No single-flight `body → goal2` shot exists on the standing rail.
			 * Check whether a multi-hop relay (or affordable pad build on `body`)
			 * can still lift `postMass` safely inside the deadline; otherwise
			 * `body` is a gravity/fragile/deadline trap (`feasible = false`). */
			const depRelay = careerDeparture(legDepScratch1, career, body,
				postPurse - otherEscrow, postMass, sim, postCond, seekClaim, true,
				flightSec1, exitSpeedFn);
			if (!depRelay.ok || postPurse - otherEscrow + 1e-9 < depRelay.cost) return out;
			if (fragile2) {
				const kitCap = depRelay.catapult && depRelay.battery
					? OrbitTech.speedLimit(depRelay.battery.capacity, postMass,
						depRelay.catapult, sim.forceScale)
					: maxCap2;
				const fragCap = kitCap < FRAGILE_SPEED ? kitCap : FRAGILE_SPEED;
				if (checkExitSpeed(exitSpeedFn, sim, body, fragCap) <= 0) return out;
			}
			const dx = sim.planetX[goal2] - sim.planetX[body];
			const dy = sim.planetY[goal2] - sim.planetY[body];
			const spanPx = Math.max(0, Math.hypot(dx, dy) - sim.planetR[body] - sim.planetR[goal2]);
			const topSpeed = fragile2 ? FRAGILE_SPEED : GravitySim.SPEED_MAX;
			const minSteps2 = Math.max(2, Math.ceil(spanPx / (topSpeed * GravitySim.DT)));
			if (step2 + minSteps2 > effectiveDeadline) return out;
			const goalEntry = goal2 === career.capitalPlanet ? CAPITAL_VISIT_PAY : 0;
			const relayAvail2 = postPurse - depRelay.cost + goalEntry + reward2 - endEscrow;
			if (relayAvail2 < -1e-9) return out;
			const depGoal = careerDeparture(legDepScratch2, career, goal2, relayAvail2,
				endMass2, sim, postCond, false, true, flightSec1, exitSpeedFn);
			if (!depGoal.ok || relayAvail2 + 1e-9 < depGoal.cost) return out;

			out.feasible = true;
			out.hasSecond = false;
			out.leg1Exit = depRelay.cost;
			out.leg1Net = cash1 - fee1 - depRelay.cost - wear1 + (prospective ? acceptRefund : 0);
			out.credit = prospective ? reward2 * LEG_CREDIT : credit1;
			out.total = out.leg1Net + out.credit;
			out.purseDelta = acceptRefund - repair0 + cash1 - fee1 - mandatoryRepair1;
			return out;
		}

		/* Also compute standalone leg-1 exit cost so callers that display or
		 * subtract `leg1Exit` can cancel it cleanly (`leg1Net + credit === total`). */
		const dep1 = careerDeparture(legDepScratch1, career, body, postPurse - otherEscrow,
			postMass, sim, postCond, seekClaim, true, flightSec1, exitSpeedFn);
		const exit1 = dep1.ok ? dep1.cost : out.leg2.fee;
		const step1Net = cash1 - fee1 - wear1 + (prospective ? acceptRefund : 0);

		out.feasible = true;
		out.leg1Exit = exit1;
		out.leg1Net = step1Net - exit1;
		out.total = step1Net + out.leg2.net;
		out.credit = out.leg2.net + exit1;
		out.purseDelta = acceptRefund - repair0 + cash1 - fee1 - mandatoryRepair1 +
			out.leg2.cash - out.leg2.fee - bestMandatory2;
		return out;
	}

	Object.assign(GravityGame, {
		hasFeasibleLeg, careerLegPlan
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
