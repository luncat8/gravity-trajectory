/*
 * Can a company leave where it lands: the shared leg probe, exit speed per
 * field, arrival mass and charge, refund escrow, and careerDeparture, the
 * solvency check every planner and the board share.
 * not here: two-leg quest planning → game_legs.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_departure.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitTech, SPEED_STEPS, CAP_SECONDS, BOOK_LOG_MAX, CAREER,
		MEDIC_SLOT, BOARD_SIZE, TASK_NONE, TASK_MEDIC, TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED,
		LEG_NONE, OWNER_COMMERCIAL, OWNER_CAPITAL, OWNER_REBEL, price, careerShipUsable,
		careerPadSeconds, padAt, padOwner, commercialPadAt, commercialFee, exitSpeedHasMargin,
		medicLoad, gearKnown, planetBuildable
	} = inner;

	/* --- two-leg contract valuation & shared departure solvency ---------- */

	const LEG_EXIT_ANGLES = 8;
	const LEG_EXIT_FRACTIONS = [0.35, 0.65, 0.85, 1];
	const LEG_EXIT_WAYS = 4;

	let legProbe = null;
	let legSourceSim = null;
	const legMaskSnap = new Uint8Array(GravitySim.MAX_BODIES);
	let legMaskWasNull = true;
	const legStrengthSnap = new Float64Array(GravitySim.MAX_BODIES);
	const legExitCacheStamp = new Uint32Array(OrbitWorld.PLANETS * LEG_EXIT_WAYS);
	const legExitCacheCap = new Int32Array(OrbitWorld.PLANETS * LEG_EXIT_WAYS);
	legExitCacheCap.fill(-1);
	const legExitCacheSpeed = new Float64Array(OrbitWorld.PLANETS * LEG_EXIT_WAYS);

	function createDepartureOut() {
		return {
			ok: false, physical: false, builds: false,
			canBuildStarter: false, starterCanExit: false,
			cost: Infinity, speed: 0, source: '',
			catapult: null, battery: null, reason: ''
		};
	}

	const legDepScratch1 = createDepartureOut();

	function createLegPlan() {
		return {
			feasible: true,
			hasSecond: false,
			slot: -1,
			prospective: false,
			leg1Leg: LEG_NONE,
			leg1Cash: 0,
			leg1Fee: 0,
			leg1Wear: 0,
			leg1Exit: 0,
			leg1Net: 0,
			credit: 0,
			total: 0,
			purseDelta: 0,
			leg2: {
				origin: -1,
				angleU: 0,
				speedU: 0,
				body: -1,
				steps: 0,
				time: 0,
				length: 0,
				visitPay: 0,
				reward: 0,
				cash: 0,
				fee: 0,
				wear: 0,
				exit: 0,
				net: 0,
				leg: LEG_NONE,
				commercial: false,
				logPlanet: new Int16Array(BOOK_LOG_MAX),
				logStep: new Int32Array(BOOK_LOG_MAX),
				logDwell: new Int32Array(BOOK_LOG_MAX),
				logCount: 0
			}
		};
	}

	function legMaskDiffer(nextMask, cap) {
		if (!nextMask) return !legMaskWasNull;
		if (legMaskWasNull) return true;
		for (let i = 0; i < cap; i++) {
			if (legMaskSnap[i] !== nextMask[i]) return true;
		}
		return false;
	}

	function legStrengthsDiffer(a, b, count) {
		if (!a || !b) return a !== b;
		for (let i = 0; i < count; i++) {
			if (a[i] !== b[i]) return true;
		}
		return false;
	}

	function prepareLegProbe(sourceSim) {
		if (!sourceSim) return null;
		if (legProbe === null || legProbe.worldW !== sourceSim.worldW || legProbe.worldH !== sourceSim.worldH) {
			legProbe = new GravitySim(sourceSim.worldW, sourceSim.worldH);
			legSourceSim = null;
		}
		const cold = legSourceSim === null;
		legSourceSim = sourceSim;
		const periodicChanged = legProbe.periodic !== Boolean(sourceSim.periodic);
		legProbe.fieldT = sourceSim.fieldT;
		legProbe.fieldRate = sourceSim.fieldRate;
		legProbe.setScales(sourceSim.gravityScale, sourceSim.forceScale);
		if (sourceSim.periodic) legProbe.setPeriodic(true, sourceSim);
		else if (legProbe.periodic) legProbe.setPeriodic(false);
		const cap = sourceSim.planetCapacity !== undefined
			? sourceSim.planetCapacity : legProbe.planetCapacity;
		const planetsChanged = cold || periodicChanged ||
			legProbe.planetX !== sourceSim.planetX ||
			legProbe.planetY !== sourceSim.planetY ||
			legProbe.planetR !== sourceSim.planetR ||
			legProbe.planetCapacity !== cap;
		if (planetsChanged) {
			if (sourceSim.planetCapacity !== undefined) legProbe.planetCapacity = sourceSim.planetCapacity;
			if (sourceSim.planetX) legProbe.planetX = sourceSim.planetX;
			if (sourceSim.planetY) legProbe.planetY = sourceSim.planetY;
			if (sourceSim.planetR) legProbe.planetR = sourceSim.planetR;
			if (sourceSim.sysCos) legProbe.sysCos.set(sourceSim.sysCos);
			if (sourceSim.sysSin) legProbe.sysSin.set(sourceSim.sysSin);
			if (sourceSim.sysInvRX) legProbe.sysInvRX.set(sourceSim.sysInvRX);
			if (sourceSim.sysInvRY) legProbe.sysInvRY.set(sourceSim.sysInvRY);
			if (sourceSim.sysBoundR2) legProbe.sysBoundR2.set(sourceSim.sysBoundR2);
			if (sourceSim.planetMinX !== undefined) legProbe.planetMinX = sourceSim.planetMinX;
			if (sourceSim.planetMaxX !== undefined) legProbe.planetMaxX = sourceSim.planetMaxX;
			if (sourceSim.planetMinY !== undefined) legProbe.planetMinY = sourceSim.planetMinY;
			if (sourceSim.planetMaxY !== undefined) legProbe.planetMaxY = sourceSim.planetMaxY;
		}
		const maskDiff = cold || legMaskDiffer(sourceSim.planetMask, cap);
		if (planetsChanged || maskDiff) {
			if (!sourceSim.planetMask) legMaskWasNull = true;
			else {
				legMaskWasNull = false;
				for (let i = 0; i < cap; i++) legMaskSnap[i] = sourceSim.planetMask[i];
			}
			legProbe.setPlanetMask(sourceSim.planetMask);
		}
		let srcCount = sourceSim.bodyCount;
		if (sourceSim.bodyR && srcCount <= sourceSim.bodyR.length) {
			while (srcCount > 0 && sourceSim.bodyR[srcCount - 1] === 0) srcCount--;
		}
		let fieldDiff = cold || periodicChanged || legProbe.bodyCount !== srcCount ||
			legProbe.fieldStatic !== sourceSim.fieldStatic ||
			legStrengthsDiffer(legStrengthSnap, sourceSim.strength, srcCount);
		if (!fieldDiff && sourceSim.fillField &&
			(sourceSim.fillField !== legProbe.fillField || !sourceSim.fieldStatic || planetsChanged)) {
			sourceSim.fillField(sourceSim.fieldT, legProbe.velX, legProbe.velY, srcCount);
			for (let i = 0; i < srcCount; i++) {
				if (legProbe.bodyX[i] !== legProbe.velX[i] || legProbe.bodyY[i] !== legProbe.velY[i]) {
					fieldDiff = true;
					break;
				}
			}
		}
		if (fieldDiff || maskDiff) {
			for (let i = 0; i < srcCount; i++) legStrengthSnap[i] = sourceSim.strength[i];
			const sharedStrength = legProbe.periodic && legProbe.periodicSource_ &&
				!legStrengthsDiffer(legProbe.periodicSource_.strength, sourceSim.strength, srcCount)
				? legProbe.periodicSource_.strength : sourceSim.strength;
			legProbe.setField(srcCount, sourceSim.bodyR, sharedStrength,
				sourceSim.fillField, sourceSim.fieldStatic);
		} else if (!legProbe.fieldStatic) {
			legProbe.refreshField();
		}
		return legProbe;
	}

	function legFieldTag(sim, fieldTime) {
		let stamp = sim.fieldStatic ? 0x811c9dc5 : 0x9e3779b9;
		stamp = Math.imul(stamp ^ (sim.periodic ? 1 : 0), 0x01000193);
		stamp = Math.imul(stamp ^ Math.round(sim.worldW), 0x01000193);
		stamp = Math.imul(stamp ^ Math.round(sim.worldH), 0x01000193);
		if (sim.periodic && sim.fieldStatic) {
			const snap = sim.ensurePeriodicGrid();
			stamp = Math.imul(stamp ^ (snap ? snap.revision : 0), 0x01000193);
		}
		stamp = Math.imul(stamp ^ sim.bodyCount, 0x01000193);
		stamp = Math.imul(stamp ^ Math.round(sim.gravityScale * 100), 0x01000193);
		for (let i = 0; i < sim.bodyCount; i++) {
			stamp = Math.imul(stamp ^ (Math.round(sim.strength[i] * 100) + i * 31), 0x01000193);
		}
		for (let i = 0; i < sim.planetCapacity; i++) {
			const active = !sim.planetMask || sim.planetMask[i] === 1 ? 1 : 0;
			stamp = Math.imul(stamp ^ active, 0x01000193);
			if (active && sim.planetX && sim.planetY) {
				stamp = Math.imul(stamp ^ Math.round(sim.planetX[i]), 0x01000193);
				stamp = Math.imul(stamp ^ Math.round(sim.planetY[i]), 0x01000193);
			}
		}
		if (!sim.fieldStatic && sim.fieldRate !== 0) {
			const t = fieldTime === undefined ? sim.fieldT : fieldTime;
			stamp = Math.imul(stamp ^ Math.round(sim.fieldRate * 1000), 0x01000193);
			stamp = Math.imul(stamp ^ Math.round(t * 20), 0x01000193);
		}
		return (stamp >>> 0) || 1;
	}

	function legExitSpeed(sim, planet, cap) {
		const probe = prepareLegProbe(sim);
		if (!probe || !Number.isFinite(cap) || !probe.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
		let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		const stamp = legFieldTag(probe, probe.fieldT);
		const slot = planet * LEG_EXIT_WAYS + capU % LEG_EXIT_WAYS;
		if (legExitCacheCap[slot] === capU && legExitCacheStamp[slot] === stamp) {
			return legExitCacheSpeed[slot];
		}
		let found = 0;
		let previous = -1;
		const span = capU - minU;
		const tau = Math.PI * 2;
		for (let f = 0; f < LEG_EXIT_FRACTIONS.length; f++) {
			const speedU = f === LEG_EXIT_FRACTIONS.length - 1
				? capU : minU + Math.round(span * LEG_EXIT_FRACTIONS[f]);
			if (speedU === previous) continue;
			previous = speedU;
			const speed = speedU / SPEED_STEPS;
			for (let a = 0; a < LEG_EXIT_ANGLES; a++) {
				const angle = (a + 0.5) / LEG_EXIT_ANGLES * tau;
				probe.predictFast(planet, angle, speed, CAP_SECONDS);
				if (probe.predReason !== GravitySim.END_IMPACT ||
					probe.predBody < 0 || probe.predBody === planet) continue;
				found = speed;
				break;
			}
			if (found > 0) break;
		}
		legExitCacheCap[slot] = capU;
		legExitCacheStamp[slot] = stamp;
		legExitCacheSpeed[slot] = found;
		return found;
	}

	function careerRefundEscrow(career) {
		let held = 0;
		for (let i = 0; i < BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE || task.state === TASK_OFFERED) continue;
			if (task.capitalRefund > 0) held += task.capitalRefund;
		}
		return held;
	}

	function careerArrivalMass(career, planet) {
		let mass = career.ship.mass;
		if (career.contract < 0) {
			const medic = career.tasks[MEDIC_SLOT];
			if (planet === career.capitalPlanet && medic.kind === TASK_MEDIC && medic.medics > 0) {
				return OrbitTech.shipMass(career.ship, medic.medics);
			}
			return mass;
		}
		const task = career.tasks[career.contract];
		if (task.kind === TASK_MEDIC) {
			const market = career.market;
			if (task.aboard === 0 && planet === task.to) {
				const picked = market ? Math.min(task.medics, market.patients[task.to]) : task.medics;
				return OrbitTech.shipMass(career.ship, picked);
			}
			if (task.aboard > 0 && planet === career.capitalPlanet) {
				const left = market && market.patients[task.to] > task.aboard
					? market.patients[task.to] - task.aboard : 0;
				return OrbitTech.shipMass(career.ship, medicLoad(career, left));
			}
			return mass;
		}
		if (task.state === TASK_ACCEPTED && task.from === planet) mass += task.tons;
		else if (task.state === TASK_LOADED && task.to === planet) mass -= task.tons;
		return mass;
	}

	function careerArrivalCharge(career, planet, flightSeconds) {
		const pad = career.pads[planet];
		if (planet === career.at || !(flightSeconds > 0)) return pad.battery.capacity;
		const charge = Math.max(0, pad.chargeKwh - pad.reservedKwh);
		const gained = OrbitTech.solarCharge(pad.panel, career.light[planet],
			careerPadSeconds(flightSeconds));
		return Math.min(pad.battery.capacity, charge + gained) - pad.reservedKwh;
	}

	function checkExitSpeed(exitSpeedFn, sourceSim, planet, cap) {
		return exitSpeedFn ? exitSpeedFn(planet, cap) : legExitSpeed(sourceSim, planet, cap);
	}

	function careerDeparture(out, career, planet, cash, mass, sourceSim, condition,
		seekClaim, afterLanding, flightSeconds, exitSpeedFn, asFounded) {
		const res = out || legDepScratch1;
		res.ok = false;
		res.physical = false;
		res.builds = false;
		res.canBuildStarter = false;
		res.starterCanExit = false;
		res.cost = Infinity;
		res.speed = 0;
		res.source = '';
		res.catapult = null;
		res.battery = null;
		res.reason = 'no affordable exit trajectory';
		if (!sourceSim || !sourceSim.planetActive(planet)) {
			res.reason = 'planet is not active';
			return res;
		}
		const usable = condition === undefined ? careerShipUsable(career) : condition > 0;
		if (planet === career.at && !usable) {
			res.reason = 'ship worn out';
			return res;
		}
		const arrivalMass = Number.isFinite(mass) && mass > 0 ? mass : career.ship.mass;
		const available = cash === Infinity ? Infinity : Number.isFinite(cash) ? cash : -Infinity;
		const forceScale = sourceSim.forceScale;
		const own = career.pads[planet];
		const useComm = !afterLanding;
		/* `asFounded` prices the state a founding kit creates: the colony's
		 * commercial EMC-1 is the rail out and the ground is buildable. The
		 * aim readout and the bots' founding plans read it instead of flying
		 * the founded world in their heads. */
		const pad = asFounded ? commercialPadAt(career, planet)
			: padAt(career, planet, useComm);
		const owner = asFounded ? OWNER_COMMERCIAL : padOwner(career, planet, useComm);

		const buildable = asFounded || planetBuildable(career, planet);
		if (own.catapult === null && buildable) {
			const starterCap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
				arrivalMass, OrbitTech.CATAPULTS[0], forceScale);
			/* margin law: a starter rail is only worth building where it
			 * leaves with a quarter of its power in hand */
			res.starterCanExit = exitSpeedHasMargin(
				checkExitSpeed(exitSpeedFn, sourceSim, planet, starterCap), starterCap);
			res.canBuildStarter = res.starterCanExit &&
				available + 1e-9 >= price(career, OrbitTech.CATAPULTS[0].buildCost);
			if (res.starterCanExit) res.physical = true;
		}

		const secs = flightSeconds || 0;
		const charge = owner === career.index
			? careerArrivalCharge(career, planet, secs)
			: Math.max(0, pad.chargeKwh - pad.reservedKwh);
		const currentCap = OrbitTech.speedLimit(charge, arrivalMass, pad.catapult, forceScale);
		const currentSpeed = checkExitSpeed(exitSpeedFn, sourceSim, planet, currentCap);
		let bestCost = Infinity;
		if (currentSpeed > 0) {
			res.physical = true;
			const fee = owner === career.index || owner === OWNER_CAPITAL ? 0
				: owner === OWNER_COMMERCIAL || owner === OWNER_REBEL
				? commercialFee(career, planet, currentSpeed, arrivalMass)
				: price(career, CAREER.taxPerKwh *
					OrbitTech.launchEnergy(arrivalMass, pad.catapult, currentSpeed) * pad.catapult.tier);
			if (available + 1e-9 >= fee) {
				bestCost = fee;
				res.ok = true;
				res.cost = fee;
				res.speed = currentSpeed;
				res.source = owner === career.index ? 'own'
					: owner === OWNER_CAPITAL ? 'capital'
					: owner === OWNER_REBEL ? 'rebel'
					: owner === OWNER_COMMERCIAL ? 'commercial' : 'rival';
				res.catapult = pad.catapult;
				res.battery = pad.battery;
				res.reason = '';
			}
		}

		if (seekClaim && !own.catapult) bestCost = Infinity;
		if (bestCost === 0 || !buildable) return res;

		const catPrototypes = career.prototypes ? career.prototypes[OrbitTech.KIND_CATAPULT] : null;
		const batteryPrototypes = career.prototypes ? career.prototypes[OrbitTech.KIND_BATTERY] : null;
		const catCount = OrbitTech.CATAPULTS.length + (catPrototypes ? catPrototypes.length : 0);
		const batteryCount = OrbitTech.BATTERIES.length + (batteryPrototypes ? batteryPrototypes.length : 0);
		const currentBattery = own.catapult === null ? OrbitTech.BATTERIES[0] : own.battery;
		for (let ci = -1; ci < catCount; ci++) {
			let catapult;
			if (ci < 0) {
				if (own.catapult === null) continue;
				catapult = own.catapult;
			} else if (ci < OrbitTech.CATAPULTS.length) catapult = OrbitTech.CATAPULTS[ci];
			else catapult = catPrototypes[ci - OrbitTech.CATAPULTS.length];
			const buildCatapult = catapult !== own.catapult;
			if (own.catapult !== null && buildCatapult && catapult.tier <= own.catapult.tier) continue;
			if (buildCatapult && !gearKnown(career, catapult)) continue;
			const catCost = buildCatapult ? price(career, catapult.buildCost) : 0;
			if (available + 1e-9 < catCost) continue;
			for (let bi = -1; bi < batteryCount; bi++) {
				let battery;
				if (bi < 0) battery = currentBattery;
				else if (bi < OrbitTech.BATTERIES.length) battery = OrbitTech.BATTERIES[bi];
				else battery = batteryPrototypes[bi - OrbitTech.BATTERIES.length];
				const buildBattery = battery !== currentBattery;
				if (buildBattery && battery.tier <= currentBattery.tier) continue;
				if (buildBattery && !gearKnown(career, battery)) continue;
				if (!buildCatapult && !buildBattery) continue;
				/* A newly built starter must satisfy the margin, even if a
				 * full-power commercial rail can physically depart. */
				if (own.catapult === null && catapult === OrbitTech.CATAPULTS[0] &&
					battery === OrbitTech.BATTERIES[0] && !res.starterCanExit) continue;
				const totalCost = catCost + (buildBattery ? price(career, battery.buildCost) : 0);
				if (available + 1e-9 < totalCost || totalCost + 1e-9 >= bestCost) continue;
				const cap = OrbitTech.speedLimit(battery.capacity, arrivalMass, catapult, forceScale);
				const speed = checkExitSpeed(exitSpeedFn, sourceSim, planet, cap);
				if (speed <= 0) continue;
				res.physical = true;
				bestCost = totalCost;
				res.ok = true;
				res.builds = true;
				res.cost = totalCost;
				res.speed = speed;
				res.source = 'build';
				res.catapult = catapult;
				res.battery = battery;
				res.reason = '';
			}
		}
		if (!res.ok) {
			res.reason = res.physical
				? 'departure cost is unaffordable' : 'no launch trajectory within affordable gear';
		}
		return res;
	}

	Object.assign(GravityGame, {
		careerRefundEscrow, careerArrivalMass, careerArrivalCharge, createDepartureOut,
		careerDeparture, createLegPlan
	});
	Object.assign(inner, {
		createDepartureOut, legDepScratch1, prepareLegProbe, legFieldTag, careerRefundEscrow,
		careerArrivalMass, careerArrivalCharge, checkExitSpeed, careerDeparture
	});
});
