/*
 * Ship condition and upkeep: the wear law and its forecasts, repair, fuel
 * production and purchase, the evacuation fare, and the four balance knobs.
 * not here: wear on landing settlement → game_flight.js; evacuation ride → game_flight.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_ship.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const { GravitySim, OrbitTech, EXPERIMENT, CAREER, CAREER_OPEN, price } = inner;

	/* ship wear (0.7.2): condition 1 = new, 0 = worn out. Space wear is priced
	 * per game second of flight, never per orbit minute or playback pace. */
	const WEAR_SPACE = 0.01;
	const WEAR_LANDING = 0.1;
	/* EMC wear at WEAR_EMC_REF m/s² of rail acceleration, capped per launch */
	const WEAR_EMC = 0.1;
	const WEAR_EMC_REF = 2.0;
	const WEAR_EMC_MAX = 0.5;
	/* impulse wear per WEAR_IMP_DV px/s of delivered Δv */
	const WEAR_IMP = 0.1;
	const WEAR_IMP_DV = 200;
	/* a bought (non-flagship) ship wears this much faster */
	const WEAR_FLEET = 2;
	const WEAR_SCIENCE_MIN = 0.5;
	const WEAR_SCIENCE_STEP = 0.02;
	/* cr for a full 1.0 of condition */
	const WEAR_REPAIR_COST = 2;
	/* Repeated fixed-step subtraction must exhaust at the mathematical boundary. */
	const WEAR_EPS = 1e-10;
	let spaceWearScale = 1;
	let padScale = 1;
	let rotScale = 1;
	let payScale = 1;
	const FUEL_KG_PER_KWH = 20;
	const FUEL_PRICE = 0.08;

	function careerShipUsable(career) {
		return career.ship.condition > 0;
	}

	/* the one writer of condition, so the report flag is never stale: a ship
	 * that wears out between two harvests stops paying at the next visit */
	function setShipCondition(career, value) {
		career.ship.condition = value <= WEAR_EPS ? 0 : value > 1 ? 1 : value;
		career.ledger.reports = career.ship.obs.fitted && career.ship.condition > 0;
	}

	function refitShip(career) {
		career.ship.mass = OrbitTech.shipMass(career.ship, career.ship.cargoTons);
		setShipCondition(career, career.ship.condition);
	}

	/* accepted research hardens the ship down to WEAR_SCIENCE_MIN of the starter rate */
	function wearFactor(career) {
		const science = 1 - WEAR_SCIENCE_STEP * career.research;
		return career.wearScale * (science > WEAR_SCIENCE_MIN ? science : WEAR_SCIENCE_MIN);
	}

	/* The experimental knob changes space ageing, not launch, landing or burns. */
	function setSpaceWearScale(value) {
		if (!Number.isFinite(value)) return spaceWearScale;
		spaceWearScale = Math.max(EXPERIMENT.spaceWearMin, Math.min(EXPERIMENT.spaceWearMax, value));
		return spaceWearScale;
	}

	function spaceWearScaleOf() {
		return spaceWearScale;
	}

	function setPadScale(value) {
		if (!Number.isFinite(value)) return padScale;
		padScale = Math.max(EXPERIMENT.padMin, Math.min(EXPERIMENT.padMax, value));
		return padScale;
	}

	function padScaleOf() {
		return padScale;
	}

	function setRotScale(value) {
		if (!Number.isFinite(value)) return rotScale;
		rotScale = Math.max(EXPERIMENT.rotMin, Math.min(EXPERIMENT.rotMax, value));
		return rotScale;
	}

	function rotScaleOf() {
		return rotScale;
	}

	function setPayScale(value) {
		if (!Number.isFinite(value)) return payScale;
		payScale = Math.max(EXPERIMENT.payMin, Math.min(EXPERIMENT.payMax, value));
		return payScale;
	}

	function payScaleOf() {
		return payScale;
	}

	function careerPadSeconds(gameSec) {
		return GravitySim.padSeconds(gameSec) * padScale;
	}

	function careerPadMinutes(gameSec) {
		return GravitySim.padMinutes(gameSec) * padScale;
	}

	function careerWaitPadSeconds() {
		return GravitySim.WAIT_PAD_SEC * padScale;
	}

	function launchWear(career, speed) {
		return Math.min(WEAR_EMC_MAX, WEAR_EMC * OrbitTech.launchAccel(speed) /
			WEAR_EMC_REF * wearFactor(career));
	}

	function spaceWear(career, steps) {
		return WEAR_SPACE * spaceWearScale * GravitySim.gameSeconds(steps) * wearFactor(career);
	}

	function impulseWear(career, dv) {
		return WEAR_IMP * (dv / WEAR_IMP_DV) * wearFactor(career);
	}

	function landingWear(career) {
		return WEAR_LANDING * wearFactor(career);
	}

	/* The forecast starts at the current condition (or a planned full repair).
	 * Landing wear follows the final visit, so it does not shorten reporting. */
	function forecastCondition(career, condition, steps, speed, dv, landed) {
		const wear = launchWear(career, speed || 0) + impulseWear(career, dv || 0) +
			spaceWear(career, steps) + (landed ? landingWear(career) : 0);
		const remaining = condition - wear;
		return remaining <= WEAR_EPS ? 0 : remaining;
	}

	function forecastReportUntil(career, condition, speed, dv) {
		if (!career.ship.obs.fitted) return 0;
		const remaining = condition - launchWear(career, speed || 0) - impulseWear(career, dv || 0);
		if (remaining <= WEAR_EPS) return 0;
		const perStep = spaceWear(career, 1);
		return perStep > 0 ? (remaining - WEAR_EPS) / perStep : Infinity;
	}

	/* A fully worn ship must be repaired before it can take any exit. */
	function forecastRepairReserve(career, arrivalCondition) {
		return arrivalCondition === 0 ? price(career, WEAR_REPAIR_COST) : 0;
	}

	/* Incremental eventual service cost, not the cost of pre-existing wear. */
	function forecastWearCost(career, condition, steps, speed, dv, landed) {
		const end = forecastCondition(career, condition, steps, speed, dv, landed);
		return price(career, (condition - end) * WEAR_REPAIR_COST);
	}

	/* space-weather hook: the wear multiplier at a world point. No zones yet. */
	function careerWearAt(career, x, y) {
		return 1;
	}

	/* careerAdvance has no position, so it charges the base space wear; the
	 * flight loop calls this after stepOne for the weather's share of that step */
	function careerWeatherWear(career, sim) {
		const extra = careerWearAt(career, sim.cargo.x, sim.cargo.y) - 1;
		if (extra === 0 || !career.flying) return;
		setShipCondition(career, career.ship.condition -
			spaceWear(career, 1) * extra);
	}

	/* what the purse pays for a full repair, to the cent */
	function repairCost(career) {
		return price(career,
			Math.round(WEAR_REPAIR_COST * (1 - career.ship.condition) * 100) / 100);
	}

	/* full repair only, wherever the ship is landed: a service, not a claim */
	function repairCareer(career) {
		if (career.ended !== CAREER_OPEN || career.flying || career.at < 0) return false;
		if (career.ship.condition >= 1) return false;
		const cost = repairCost(career);
		if (career.ledger.purse + 1e-9 < cost) return false;
		career.ledger.purse -= cost;
		career.maintenanceSpent += cost;
		career.repairs += 1;
		setShipCondition(career, 1);
		inner.checkEnded(career);
		inner.refreshCareerMedic(career);
		return true;
	}

	function fuelPrice(career) {
		return price(career, FUEL_PRICE);
	}

	/* Both transactions need a landed, usable drive; a tank alone is not enough. */
	function fuelRequest(career, kg) {
		const ship = career.ship;
		if (career.ended !== CAREER_OPEN || career.at < 0 || !ship.engine || !ship.tank ||
			!Number.isFinite(kg) || kg <= 0 || inner.emptyWorld(career, career.at)) return 0;
		return Math.max(0, Math.min(kg, ship.tank.fuelCap - ship.fuelKg));
	}

	/* Only the career's own pad feeds the converter, never a guest/commercial rail. */
	function produceFuel(career, planet, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0 || planet !== career.at) return 0;
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return 0;
		const freeKwh = Math.max(0, pad.chargeKwh - pad.reservedKwh);
		amount = Math.min(Math.floor(amount), Math.floor(freeKwh * FUEL_KG_PER_KWH + 1e-9));
		if (amount <= 0) return 0;
		pad.chargeKwh -= amount / FUEL_KG_PER_KWH;
		career.ship.fuelKg += amount;
		career.fuelProducedKg += amount;
		return amount;
	}

	function buyFuel(career, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0) return 0;
		const unitPrice = fuelPrice(career);
		if (unitPrice > 0) amount = Math.min(amount, Math.max(0, career.ledger.purse) / unitPrice);
		if (amount <= 0) return 0;
		const cost = amount * unitPrice;
		career.ledger.purse = Math.max(0, career.ledger.purse - cost);
		career.ship.fuelKg += amount;
		career.fuelBoughtKg += amount;
		career.fuelSpent += cost;
		inner.checkEnded(career);
		inner.refreshCareerMedic(career);
		return amount;
	}

	function evacTarget(career) {
		if (!career) return -1;
		return career.hq >= 0 ? career.hq : career.capitalPlanet;
	}

	function canEvacuate(career) {
		const target = evacTarget(career);
		return target >= 0 && career.ended === CAREER_OPEN && !career.flying &&
			!career.arrested && !career.evacuating && career.at !== target;
	}

	function evacuationCost(career) {
		const fee = price(career, CAREER.evacFee);
		if (fee <= 0) return 0;
		return Math.min(fee, Math.max(0, career.ledger.purse));
	}

	function evacuationSecondsForPaid(career, paid) {
		const fee = price(career, CAREER.evacFee);
		if (fee <= 0) return CAREER.evacFreeSeconds;
		const fractionPaid = Math.min(1, Math.max(0, paid / fee));
		return CAREER.evacFreeSeconds -
			(CAREER.evacFreeSeconds - CAREER.evacFullSeconds) * fractionPaid;
	}

	function evacuationSeconds(career) {
		return evacuationSecondsForPaid(career, evacuationCost(career));
	}

	Object.assign(GravityGame, {
		FUEL_KG_PER_KWH, FUEL_PRICE, fuelPrice, produceFuel, buyFuel, WEAR_SPACE, WEAR_LANDING,
		WEAR_EMC, WEAR_EMC_REF, WEAR_EMC_MAX, WEAR_IMP, WEAR_IMP_DV, WEAR_FLEET, WEAR_SCIENCE_MIN,
		WEAR_SCIENCE_STEP, WEAR_REPAIR_COST, wearFactor, setSpaceWearScale, spaceWearScaleOf,
		setPadScale, padScaleOf, setRotScale, rotScaleOf, setPayScale, payScaleOf, careerPadSeconds,
		careerPadMinutes, careerWaitPadSeconds, launchWear, spaceWear, impulseWear, landingWear,
		forecastCondition, forecastReportUntil, forecastRepairReserve, forecastWearCost,
		careerShipUsable, setShipCondition, careerWearAt, careerWeatherWear, repairCost,
		repairCareer, evacTarget, canEvacuate, evacuationCost, evacuationSeconds
	});
	Object.assign(inner, {
		careerShipUsable, setShipCondition, refitShip, padScaleOf, rotScaleOf, payScaleOf,
		careerPadSeconds, careerPadMinutes, launchWear, spaceWear, impulseWear, landingWear,
		forecastCondition, forecastReportUntil, forecastRepairReserve, forecastWearCost,
		careerWearAt, repairCost, evacTarget, canEvacuate, evacuationCost, evacuationSecondsForPaid,
		evacuationSeconds
	});
});
