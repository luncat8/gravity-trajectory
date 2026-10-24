/*
 * Career tech tree: planet gear (EM catapult / solar panel / battery), ship
 * parts (cargo hold / impulse engine / fuel tank / auto-helpers), ship mass,
 * the catapult launch model and the per-item "copy spec" balance line. Pure
 * functions of static tables — no DOM, no simulation state, node-safe.
 *
 * Planet gear is built once per planet and shared by every visitor; it never
 * adds to ship mass. Only ship parts and cargo do. Every API takes table
 * records (not ids), so the hot path never searches a table; `find` turns an
 * id from a link or a cheat into its record.
 *
 * Units: mass t, force kN, energy kWh, panel power kW, speed px/s of the
 * gravity sim, time s. Launch model:
 *   energy  = KWH_PER_T_V2 · m · v² / efficiency   (drawn from the pad battery)
 *   v_max   = sqrt(2 · maxForce / m · RAIL_M)        (force cap of the rail)
 * so EMC-1 + BAT-1 lifts a 10 t ship to ~92 px/s (the weak end of the
 * 80–120 px/s landing band) and stalls a 38 t load below 50 px/s, while EMC-5
 * reaches the sim's top speed with a dry ship. The optional `forceScale`
 * argument multiplies only the rail force cap; launch energy is unchanged.
 */
(function (root) {
	'use strict';

	const SHIP_DRY_MASS = 10;
	const KWH_PER_T_V2 = 7.5e-6;
	const RAIL_M = 2800;
	const G0 = 9.81;

	/* --- planet gear --------------------------------------------------- */

	const CATAPULTS = [
		{ id: 'EMC-1', tier: 1, maxForce: 15, efficiency: 0.62, buildCost: 3.00 },
		{ id: 'EMC-2', tier: 2, maxForce: 90, efficiency: 0.71, buildCost: 6.00 },
		{ id: 'EMC-3', tier: 3, maxForce: 135, efficiency: 0.80, buildCost: 10.00 },
		{ id: 'EMC-4', tier: 4, maxForce: 165, efficiency: 0.85, buildCost: 15.00 },
		{ id: 'EMC-5', tier: 5, maxForce: 180, efficiency: 0.88, buildCost: 20.00 }
	];

	/* kW: SP-1 refills BAT-1 in ~90 flight-seconds of full sunlight at world rate ×1 */
	const PANELS = [
		{ id: 'SP-1', tier: 1, power: 1.0, buildCost: 1.50 },
		{ id: 'SP-2', tier: 2, power: 2.4, buildCost: 3.50 },
		{ id: 'SP-3', tier: 3, power: 4.5, buildCost: 7.00 },
		{ id: 'SP-4', tier: 4, power: 7.5, buildCost: 12.00 }
	];

	/* capacity kWh, leak fraction per colony year */
	const BATTERIES = [
		{ id: 'BAT-1', tier: 1, capacity: 1.5, leak: 0.001, buildCost: 1.00 },
		{ id: 'BAT-2', tier: 2, capacity: 3.0, leak: 0.0008, buildCost: 2.50 },
		{ id: 'BAT-3', tier: 3, capacity: 6.0, leak: 0.0006, buildCost: 5.00 },
		{ id: 'BAT-4', tier: 4, capacity: 10.0, leak: 0.0004, buildCost: 9.00 },
		{ id: 'BAT-5', tier: 5, capacity: 16.0, leak: 0.0003, buildCost: 15.00 }
	];

	/* --- ship parts (add mass, refitted at HQ) ------------------------- */

	const HOLDS = [
		{ id: 'HOLD-0', tier: 0, capacity: 0, emptyMass: 0.0, buildCost: 0.00 },
		{ id: 'HOLD-8', tier: 1, capacity: 8, emptyMass: 1.5, buildCost: 2.00 },
		{ id: 'HOLD-24', tier: 2, capacity: 24, emptyMass: 4.0, buildCost: 5.00 }
	];

	const ENGINES = [
		{ id: 'IMP-1', tier: 1, thrust: 12, isp: 260, mass: 1.0, buildCost: 4.00 },
		{ id: 'IMP-2', tier: 2, thrust: 24, isp: 290, mass: 1.6, buildCost: 8.00 },
		{ id: 'IMP-3', tier: 3, thrust: 40, isp: 330, mass: 2.5, buildCost: 14.00 }
	];

	const TANKS = [
		{ id: 'FT-0', tier: 0, fuelCap: 0, emptyMass: 0.0, buildCost: 0.00 },
		{ id: 'FT-1', tier: 1, fuelCap: 40, emptyMass: 0.5, buildCost: 1.50 },
		{ id: 'FT-2', tier: 2, fuelCap: 90, emptyMass: 0.9, buildCost: 3.50 },
		{ id: 'FT-3', tier: 3, fuelCap: 160, emptyMass: 1.4, buildCost: 7.00 }
	];

	const HELPERS = [
		{ id: 'HELP-0', tier: 0, candidates: 0, horizon: 0, buildCost: 0.00 },
		{ id: 'HELP-1', tier: 1, candidates: 28, horizon: 60, buildCost: 1.00 },
		{ id: 'HELP-2', tier: 2, candidates: 144, horizon: 240, buildCost: 4.00 }
	];

	const KIND_CATAPULT = 'catapult';
	const KIND_PANEL = 'panel';
	const KIND_BATTERY = 'battery';
	const KIND_HOLD = 'hold';
	const KIND_ENGINE = 'engine';
	const KIND_TANK = 'tank';
	const KIND_HELPER = 'helper';
	const TABLES = {
		catapult: CATAPULTS, panel: PANELS, battery: BATTERIES,
		hold: HOLDS, engine: ENGINES, tank: TANKS, helper: HELPERS
	};
	const GEAR_KINDS = [KIND_CATAPULT, KIND_PANEL, KIND_BATTERY];
	const PART_KINDS = [KIND_HOLD, KIND_ENGINE, KIND_TANK];

	function find(table, id) {
		for (let i = 0; i < table.length; i++) {
			if (table[i].id === id) return table[i];
		}
		return null;
	}

	function findKind(kind, id) {
		return TABLES[kind] ? find(TABLES[kind], id) : null;
	}

	/* --- ship ---------------------------------------------------------- */

	/* mass one part record adds to the hull: holds/tanks carry `emptyMass`,
	 * engines `mass`; the engine slot alone can hold `null` = no engine */
	function partMass(item) {
		if (item === null) return 0;
		return item.emptyMass === undefined ? item.mass : item.emptyMass;
	}

	/* ship with `item` fitted in `kind`, cargo and every other slot as they are;
	 * `kind` null leaves the whole fit as it is (the plain ship mass) */
	function refitMass(ship, kind, item, cargoTons) {
		let m = SHIP_DRY_MASS + cargoTons;
		if (kind !== KIND_HOLD) m += partMass(ship.hold);
		if (kind !== KIND_ENGINE) m += partMass(ship.engine);
		if (kind !== KIND_TANK) m += partMass(ship.tank);
		return m + partMass(item);
	}

	/* ship = { hold, engine, tank } records (engine may be null) */
	function shipMass(ship, cargoTons) {
		return refitMass(ship, null, null, cargoTons);
	}

	function launchEnergy(mass, catapult, speed) {
		return KWH_PER_T_V2 * mass * speed * speed / catapult.efficiency;
	}

	/* speed the rail reaches before its force cap, px/s; `forceScale` is the
	 * experimental settings multiplier (absent = the table value) */
	function maxSpeed(mass, catapult, forceScale) {
		const force = forceScale === undefined ? catapult.maxForce : catapult.maxForce * forceScale;
		return Math.sqrt(2 * force * RAIL_M / mass);
	}

	/* fastest launch the pad affords right now: min of the energy and force caps */
	function speedLimit(chargeKwh, mass, catapult, forceScale) {
		if (!catapult || chargeKwh <= 0) return 0;
		const byEnergy = Math.sqrt(chargeKwh * catapult.efficiency / (KWH_PER_T_V2 * mass));
		const byForce = maxSpeed(mass, catapult, forceScale);
		return byEnergy < byForce ? byEnergy : byForce;
	}

	function canLaunch(chargeKwh, mass, catapult, speed, forceScale) {
		return speed <= speedLimit(chargeKwh, mass, catapult, forceScale) + 1e-9;
	}

	/* kWh gained over dtSec seconds at relative light (0..1) */
	function solarCharge(panel, light, dtSec) {
		return panel.power * light * dtSec / 3600;
	}

	function batteryLeak(battery, chargeKwh, dtYears) {
		return chargeKwh * Math.exp(-battery.leak * dtYears);
	}

	/* impulse delta-v (m/s) from burning fuelKg with the installed engine */
	function impulseDeltaV(fuelKg, engine, shipMassT) {
		if (!engine || fuelKg <= 0 || shipMassT <= 0) return 0;
		return G0 * engine.isp * Math.log((shipMassT + fuelKg / 1000) / shipMassT);
	}

	/* Δv the tank's full fuel buys with the engine fitted after refitting
	 * `item` into `kind` (the whole current fit when kind is null) */
	function refitDeltaV(ship, kind, item, cargoTons) {
		const engine = kind === KIND_ENGINE ? item : ship.engine;
		const tank = kind === KIND_TANK ? item : ship.tank;
		if (engine === null || tank === null) return 0;
		return impulseDeltaV(tank.fuelCap, engine, refitMass(ship, kind, item, cargoTons));
	}

	function shipDeltaV(ship, cargoTons) {
		return refitDeltaV(ship, null, null, cargoTons);
	}

	/* --- planet-gear economics ----------------------------------------- */

	/* total to apply `item` to every pad whose `kind` slot is built and differs */
	/* planet gear only ever goes up a tier */
	function upgrades(pad, kind, item) {
		const cur = pad[kind];
		return cur !== null && cur.tier < item.tier;
	}

	function bulkUpgradeCost(pads, kind, item) {
		let total = 0;
		for (let i = 0; i < pads.length; i++) {
			if (upgrades(pads[i], kind, item)) total += item.buildCost;
		}
		return total;
	}

	function starterGrant() {
		return {
			purse: 6.00,
			ship: { hold: HOLDS[0], engine: null, tank: TANKS[0] },
			pad: { catapult: CATAPULTS[0], panel: PANELS[0], battery: BATTERIES[0] }
		};
	}

	/* balance feedback line: `tech: CATAPULT EMC-2 { tier: 2, maxForce: 90, … }` */
	function copySpec(kind, item) {
		if (!TABLES[kind] || !item) return '';
		const fields = [];
		for (const key in item) {
			if (key !== 'id') fields.push(key + ': ' + item[key]);
		}
		return 'tech: ' + kind.toUpperCase() + ' ' + item.id + ' { ' + fields.join(', ') + ' }';
	}

	const OrbitTech = {
		SHIP_DRY_MASS, KWH_PER_T_V2, RAIL_M,
		CATAPULTS, PANELS, BATTERIES, HOLDS, ENGINES, TANKS, HELPERS, TABLES,
		KIND_CATAPULT, KIND_PANEL, KIND_BATTERY, KIND_HOLD, KIND_ENGINE, KIND_TANK, KIND_HELPER,
		GEAR_KINDS, PART_KINDS,
		find, findKind,
		shipMass, partMass, refitMass, shipDeltaV, refitDeltaV,
		launchEnergy, maxSpeed, speedLimit, canLaunch,
		solarCharge, batteryLeak, impulseDeltaV,
		upgrades, bulkUpgradeCost, starterGrant, copySpec
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = OrbitTech;
	else root.OrbitTech = OrbitTech;
})(typeof globalThis !== 'undefined' ? globalThis : this);
