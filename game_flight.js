/*
 * Career flights: begin, burn, advance and end, landing settlement, and the
 * evacuation ride.
 * not here: the evacuation fare → game_ship.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_flight.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitEcon, OrbitTech, CAREER, TASK_COMPETE, TASK_MEDIC, TASK_ACCEPTED,
		TASK_LOADED, CAREER_OPEN, OWNER_COMMERCIAL, OWNER_CAPITAL, OWNER_REBEL, releaseEnergy,
		round2, pay, careerShipUsable, setShipCondition, refitShip, careerPadSeconds,
		careerPadMinutes, launchWear, spaceWear, impulseWear, landingWear, careerWearAt, evacTarget,
		canEvacuate, evacuationCost, evacuationSecondsForPaid, openFlight, endFlight, padAt,
		padOwner, setCommercial, launchFee, fragileBreaks, returnLandingVisits, returnLandingVisit,
		sportStateOf, settleSport, refreshMedicSlot, loadMedics, finishContract, dropContract,
		refreshBoard, loadCargo, clearMedicalCargo, pacifyPlanet, placeShip, checkEnded,
		liquidateCareer
	} = inner;

	const ENDGAME_LIMIT_STEPS = Math.round(600 / GravitySim.DT);

	/* landing on `planet`: cargo pickup, delivery payout, competition payout */
	function settleLanding(career, sim, planet, step) {
		settleSport(career, sim, step);
		if (career.contract < 0) return;
		const task = career.tasks[career.contract];
		if (task.kind === TASK_MEDIC) return settleMedic(career, task, planet, step);
		if (task.state === TASK_ACCEPTED && planet === task.from) loadCargo(career, task);
		else if (task.state === TASK_LOADED && planet === task.to) {
			pay(career, task.reward);
			career.delivered += 1;
			finishContract(career);
		}
	}

	/* the medics go in at the Capital, the patients come out at the rebellion,
	 * the patients go out at the Capital — and the last one quells the planet */
	function settleMedic(career, task, planet, step) {
		const market = career.market;
		if (!market) return false;
		if (task.aboard === 0 && planet === task.to) {
			const picked = Math.min(task.medics, market.patients[task.to]);
			if (picked <= 0) {
				dropContract(career);
				return false;
			}
			task.aboard = picked;
			career.ship.cargoTons = picked;
			career.medicTrips += 1;
			refitShip(career);
			return true;
		}
		if (task.aboard === 0 || planet !== career.capitalPlanet) return false;
		const delivered = task.aboard;
		const left = market.patients[task.to] > delivered
			? market.patients[task.to] - delivered : 0;
		market.patients[task.to] = left;
		career.patientsDelivered += delivered;
		task.aboard = 0;
		career.ship.cargoTons = 0;
		refitShip(career);
		pay(career, delivered * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		if (left > 0) {
			task.patients = left;
			task.reward = round2(left * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
			loadMedics(career, task, left);
			task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
			if (market.galaxy && market.galaxy.actors) {
				for (let i = 0; i < market.galaxy.actors.length; i++) {
					refreshMedicSlot(market.galaxy.actors[i], market, step);
				}
			}
			return true;
		}
		pacifyPlanet(market, task.to, step);
		finishContract(career);
		return true;
	}

	/* --- flights ------------------------------------------------------- */

	/*
	 * Every EMC pad spends its own battery charge on the shot it fires, whether
	 * the launcher owns the rail or is only a guest on it. The neutral
	 * commercial EMC-1, kept charged by its operator, never runs dry and
	 * charges a flat fee instead. A rival-owned rail also charges its usage tax
	 * (the energy of the shot, paid to that player's purse). `runStep` is the
	 * world step of the launch: the race judges flights by it, so the stamp
	 * rides on the career and every replay or run snapshot carries it.
	 */
	function careerBeginFlight(career, sim, runStep) {
		const planet = sim.origin;
		const pad = padAt(career, planet);
		const owner = padOwner(career, planet);
		const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, sim.speed);
		/* the commercial, imperial and rebel rails are kept charged: they never drain */
		const freeRail = owner === OWNER_COMMERCIAL || owner === OWNER_CAPITAL ||
			owner === OWNER_REBEL;
		if (!freeRail) {
			pad.chargeKwh = pad.chargeKwh > energy ? pad.chargeKwh - energy : 0;
			releaseEnergy(pad, energy);
		}
	const fee = launchFee(career, planet, sim.speed);
	career.ledger.purse -= fee;
	career.feesPaid += fee;
	career.flightStartStep = runStep;
	/* the race is company-indexed; a fleet ship never enters one, so its
	 * launch must not mark the flagship's attempt (0.7.45) */
	const sport = sportStateOf(career);
	if (!career.fleetShip && sport.kind === TASK_COMPETE && planet === sport.planet &&
		(sport.enteredMask & (1 << career.index)) !== 0 && runStep >= sport.startsAt) {
		sport.attemptedMask |= 1 << career.index;
	}
		if (!freeRail && owner !== career.index) {
			const host = career.galaxy.actors[owner];
			host.ledger.purse += fee;
			host.taxEarned += fee;
			career.taxPaid += fee;
		}
		career.lastEnergy = freeRail ? 0 : energy;
		career.lastFee = fee;
		career.lastReward = 0;
		career.lastFuel = 0;
		/* fragile load (0.6.3): fired harder than the load survives voids the
		 * contract and drops the cargo; the rail still fires and the fee stands */
		career.fragileLost = career.contract >= 0 &&
			fragileBreaks(career.tasks[career.contract], sim.speed);
		if (career.fragileLost) dropContract(career);
		setShipCondition(career, career.ship.condition - launchWear(career, sim.speed));
		career.flights += 1;
		career.flying = true;
		openFlight(career.ledger, sim, 0);
	}

	/* spends tank fuel for an in-flight impulse burn at the current step boundary */
	function careerBurn(career, sim, angle, dv) {
		if (career.ended !== CAREER_OPEN || !careerShipUsable(career) ||
			!sim.canBurn(dv)) return false;
		const ship = career.ship;
		const used = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
		if (!(used > 0)) return false;
		if (!sim.burn(angle, dv)) return false;
		career.plannedLanding = -1;
		ship.fuelKg = ship.fuelKg > used ? ship.fuelKg - used : 0;
		career.burns += 1;
		career.lastFuel += used;
		/* by delivered Δv, not fuel mass: a heavy tank is not punished twice */
		setShipCondition(career, career.ship.condition -
			impulseWear(career, dv));
		return true;
	}

/* pads charge on the sun clock, never on the flight clock: the career sees
 * SUN_SEC_PER_GAME_SEC pad seconds of sunlight per game second, so a step
 * buys DT of sunlight against the battery's leak in pad minutes */
function careerAdvance(career, steps, flightStep) {
	if (career.ended !== CAREER_OPEN) return;
	checkEnded(career);
	if (career.recoverySteps >= 0) {
		career.recoverySteps += steps;
		if (career.recoverySteps >= ENDGAME_LIMIT_STEPS) {
			liquidateCareer(career);
			return;
		}
	}
	const padSec = careerPadSeconds(GravitySim.gameSeconds(steps));
	const padMin = careerPadMinutes(GravitySim.gameSeconds(steps));
	for (let i = 0; i < career.pads.length; i++) {
		const pad = career.pads[i];
		if (pad.catapult === null) continue;
		const charge = OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, padMin) +
			OrbitTech.solarCharge(pad.panel, career.light[i], padSec);
		pad.chargeKwh = charge < pad.battery.capacity ? charge : pad.battery.capacity;
	}
	careerAdvanceShip(career, steps, flightStep);
}

/* the wear half of careerAdvance, split for the fleet step (0.7.45): a fleet
 * ship charges the shared pads once through its owner's careerAdvance and
 * takes only this space wear on its own context */
function careerAdvanceShip(career, steps, flightStep) {
	/* only space wears the ship: a landing, a pad wait or a held clock does not */
	if (!career.flying || flightStep === false) return;
	setShipCondition(career, career.ship.condition -
		spaceWear(career, steps));
}

	/* a landing settles contracts; a vessel that left the map or timed out is
	 * lost in space (at = -1) and only an evacuation brings it back */
	function careerEndFlight(career, sim, trade, step) {
		career.plannedLanding = -1;
		career.visitIncome += endFlight(career.ledger);
		career.flownPx += sim.flightLength;
		const landed = sim.endReason === GravitySim.END_IMPACT && sim.endBody >= 0;
		if (landed) settleLanding(career, sim, sim.endBody, step);
		/* after the settlement, so the landing that used the last of the ship
		 * still reports; an exit, timeout or abort is not a landing */
		if (landed) {
			setShipCondition(career, career.ship.condition - landingWear(career) *
				careerWearAt(career, sim.cargo.x, sim.cargo.y));
		}
	career.at = landed ? sim.endBody : -1;
	/* the "landed back where you launched" fact is the flagship's; a fleet
	 * ship must not overwrite it (0.7.45) */
	if (!career.fleetShip) {
		if (landed && sim.endBody === sim.origin && career.hq >= 0 &&
			sim.endBody !== career.hq) {
			const visit = returnLandingVisit(career);
			if (visit) visit.count += 1;
			else returnLandingVisits.set(career, { planet: sim.endBody, count: 1 });
		} else returnLandingVisits.delete(career);
	}
	career.flying = false;
	/* the commercial choice bought one launch; the next planet starts fresh */
	setCommercial(career, -1);
	/* the Capital's free imperial rail is a way off, so it never strands */
	career.stranded = !landed ||
		(career.pads[sim.endBody].catapult === null && sim.endBody !== career.capitalPlanet);
	/* a fleet ship owns no board and never ends the company: no refresh, and
	 * checkEnded refuses a swapped context anyway (0.7.45) */
	if (career.fleetShip) return CAREER_OPEN;
	refreshBoard(career, trade, step);
	return checkEnded(career);
}

	/* Evacuation is a paid, clock-driven ride, not a flight or an instant placeShip.
	 * Headless callers (bench/tests) omit runStep to complete synchronously. */
	function evacuate(career, sim, agreedCost, runStep, agreedSteps) {
		if (!canEvacuate(career) || !sim) return false;
		const target = evacTarget(career);
		clearMedicalCargo(career);
		returnLandingVisits.delete(career);
		const quoted = agreedCost === undefined ? evacuationCost(career) : agreedCost;
		const paid = Math.min(Math.max(0, quoted), Math.max(0, career.ledger.purse));
		const duration = agreedSteps === undefined
			? Math.max(1, Math.round(evacuationSecondsForPaid(career, paid) / GravitySim.DT))
			: Math.max(1, Math.round(agreedSteps));
		const hasPlanets = Boolean(sim.planetX && sim.planetY);
		career.evacLastPaid = paid;
		career.evacLastSteps = duration;
		career.ledger.purse -= paid;
		career.evacuations += 1;
		career.evacuationSpent += paid;
		if (!Number.isFinite(runStep)) {
			/* headless / unit-test path: arrive immediately so assertions see target */
			career.evacuating = false;
			career.evacStartStep = career.evacUntilStep = 0;
			career.evacDurationSteps = 0;
			career.evacFromX = career.evacFromY = career.evacToX = career.evacToY = 0;
			career.evacFrom = -1;
			placeShip(career, sim, target);
			checkEnded(career);
			return true;
		}
		const from = career.at >= 0 ? career.at : sim.landedBody;
		career.evacStartStep = Math.max(0, Math.round(runStep));
		career.evacDurationSteps = duration;
		career.evacUntilStep = career.evacStartStep + duration;
		career.evacFromX = career.at >= 0 && hasPlanets ? sim.planetX[career.at] : sim.cargo.x;
		career.evacFromY = career.at >= 0 && hasPlanets ? sim.planetY[career.at] : sim.cargo.y;
		career.evacToX = hasPlanets ? sim.planetX[target] : 0;
		career.evacToY = hasPlanets ? sim.planetY[target] : 0;
		career.evacFrom = from;
		career.evacuating = true;
		career.at = -1;
		career.flying = false;
		career.stranded = true;
		setCommercial(career, -1);
		sim.relocate(GravitySim.NO_BODY);
		sim.cargo.x = career.evacFromX;
		sim.cargo.y = career.evacFromY;
		sim.evacuationTrip = career;
		return true;
	}

	function advanceEvacuation(career, sim, runStep, trade) {
		if (!career.evacuating) return false;
		const elapsed = Math.max(0, Math.min(career.evacDurationSteps,
			Math.round(runStep) - career.evacStartStep));
		const progress = career.evacDurationSteps > 0 ? elapsed / career.evacDurationSteps : 1;
		if (sim) {
			sim.cargo.x = career.evacFromX +
				(career.evacToX - career.evacFromX) * progress;
			sim.cargo.y = career.evacFromY +
				(career.evacToY - career.evacFromY) * progress;
			sim.evacuationTrip = career;
		}
		if (runStep < career.evacUntilStep) return true;
		const toX = career.evacToX;
		const toY = career.evacToY;
		placeShip(career, sim, evacTarget(career));
		if (sim) {
			sim.cargo.x = toX;
			sim.cargo.y = toY;
		}
		if (trade) refreshBoard(career, trade, runStep);
		checkEnded(career);
		return false;
	}

	Object.assign(GravityGame, {
		ENDGAME_LIMIT_STEPS, advanceEvacuation, settleMedic, careerBeginFlight, careerBurn,
		careerAdvance, careerAdvanceShip, careerEndFlight, evacuate
	});
});
