/*
 * Career tech tree: part tables, ship mass, launch energy, planet-gear
 * (catapult / solar / battery) economics and the per-item "copy spec" balance
 * line. Pure functions of static tables — no DOM, no simulation state, safe
 * under node. Guarded module.exports like gravity_game.js.
 *
 * Units: mass in tons, force in kN, energy in kWh, power in W, time in s.
 * Launch energy model: E = k * m * v^2 / efficiency, with k tuned in the
 * balance bench so EMC-1 barely lifts a light ship and stalls with cargo.
 *
 * Economic model (revised): catapult, solar panel and battery are planet
 * equipment, built once per planet and shared by every visitor. They do NOT
 * add to ship mass. A planet without a built catapult cannot be launched from
 * — the player must call an expensive evacuation. Ship parts (hold, engine,
 * tank) add to ship mass and are installed/uninstalled at HQ.
 */
(function (root) {
	'use strict';

	var SHIP_DRY_MASS = 10.0;
	/* kWh per (t * (m/s)^2). So a 10 t dry ship at 100 m/s needs ~0.75 kWh
	 * (inside one BAT-1 charge), while a 38 t loaded ship needs ~2.85 kWh
	 * (blocked on EMC-1's 1.2 kWh shot). */
	var KWH_PER_KNT2 = 7.5e-6;
	var G0 = 9.81; // m/s^2, for the impulse rocket equation

	/* --- planet gear (built per planet, no ship mass) ------------------ */

	var CATAPULTS = [
		{ id: 'EMC-1', tier: 1, maxForce: 45, efficiency: 0.62, buildCost: 3.00,
			padMass: 0.0, chargeTime: 120, energyPerShot: 1.2 },
		{ id: 'EMC-2', tier: 2, maxForce: 90, efficiency: 0.71, buildCost: 6.00,
			padMass: 0.0, chargeTime: 90, energyPerShot: 2.1 },
		{ id: 'EMC-3', tier: 3, maxForce: 135, efficiency: 0.80, buildCost: 10.00,
			padMass: 0.0, chargeTime: 60, energyPerShot: 3.4 },
		{ id: 'EMC-4', tier: 4, maxForce: 165, efficiency: 0.85, buildCost: 15.00,
			padMass: 0.0, chargeTime: 40, energyPerShot: 5.0 },
		{ id: 'EMC-5', tier: 5, maxForce: 180, efficiency: 0.88, buildCost: 20.00,
			padMass: 0.0, chargeTime: 30, energyPerShot: 6.5 }
	];

	var PANELS = [
		{ id: 'SP-1', tier: 1, power: 60, mass: 0.0, buildCost: 1.50 },
		{ id: 'SP-2', tier: 2, power: 140, mass: 0.0, buildCost: 3.50 },
		{ id: 'SP-3', tier: 3, power: 260, mass: 0.0, buildCost: 7.00 },
		{ id: 'SP-4', tier: 4, power: 420, mass: 0.0, buildCost: 12.00 }
	];

	var BATTERIES = [
		{ id: 'BAT-1', tier: 1, capacity: 1.5, leak: 0.001, mass: 0.4, buildCost: 1.00 },
		{ id: 'BAT-2', tier: 2, capacity: 3.0, leak: 0.0008, mass: 0.7, buildCost: 2.50 },
		{ id: 'BAT-3', tier: 3, capacity: 6.0, leak: 0.0006, mass: 1.2, buildCost: 5.00 },
		{ id: 'BAT-4', tier: 4, capacity: 10.0, leak: 0.0004, mass: 1.8, buildCost: 9.00 },
		{ id: 'BAT-5', tier: 5, capacity: 16.0, leak: 0.0003, mass: 2.8, buildCost: 15.00 }
	];

	/* --- ship parts (add mass, installed at HQ) ------------------------ */

	var HOLDS = [
		{ id: 'HOLD-0', tier: 0, capacity: 0, emptyMass: 0.0, buildCost: 0.00 },
		{ id: 'HOLD-8', tier: 1, capacity: 8, emptyMass: 1.5, buildCost: 2.00 },
		{ id: 'HOLD-24', tier: 2, capacity: 24, emptyMass: 4.0, buildCost: 5.00 }
	];

	var ENGINES = [
		{ id: 'IMP-1', tier: 1, thrust: 12, isp: 260, mass: 1.0, buildCost: 4.00 },
		{ id: 'IMP-2', tier: 2, thrust: 24, isp: 290, mass: 1.6, buildCost: 8.00 },
		{ id: 'IMP-3', tier: 3, thrust: 40, isp: 330, mass: 2.5, buildCost: 14.00 }
	];

	var TANKS = [
		{ id: 'FT-0', tier: 0, fuelCap: 0, emptyMass: 0.0, buildCost: 0.00 },
		{ id: 'FT-1', tier: 1, fuelCap: 40, emptyMass: 0.5, buildCost: 1.50 },
		{ id: 'FT-2', tier: 2, fuelCap: 90, emptyMass: 0.9, buildCost: 3.50 },
		{ id: 'FT-3', tier: 3, fuelCap: 160, emptyMass: 1.4, buildCost: 7.00 }
	];

	var HELPERS = [
		{ id: 'HELP-0', tier: 0, candidates: 0, horizon: 0, buildCost: 0.00 },
		{ id: 'HELP-1', tier: 1, candidates: 28, horizon: 60, buildCost: 1.00 },
		{ id: 'HELP-2', tier: 2, candidates: 144, horizon: 240, buildCost: 4.00 }
	];

	var TABLES = {
		catapult: CATAPULTS, panel: PANELS, battery: BATTERIES,
		hold: HOLDS, engine: ENGINES, tank: TANKS, helper: HELPERS
	};

	function find(table, id) {
		var i;
		for (i = 0; i < table.length; i++) {
			if (table[i].id === id) return table[i];
		}
		return null;
	}

	function catapult(id) { return find(CATAPULTS, id || 'EMC-1'); }
	function panel(id) { return find(PANELS, id || 'SP-1'); }
	function battery(id) { return find(BATTERIES, id || 'BAT-1'); }
	function hold(id) { return find(HOLDS, id || 'HOLD-0'); }
	function engine(id) { return id ? find(ENGINES, id) : null; }
	function tank(id) { return find(TANKS, id || 'FT-0'); }

	/* Total ship mass: dry + installed ship parts + cargo tons. Planet gear
	 * (catapult / panel / battery) does NOT add to ship mass. */
	function shipMass(parts, cargoTons) {
		var m = SHIP_DRY_MASS;
		if (parts.hold) m += hold(parts.hold).emptyMass;
		if (parts.engine) m += engine(parts.engine).mass;
		if (parts.tank) m += tank(parts.tank).emptyMass;
		if (cargoTons) m += cargoTons;
		return m;
	}

	/* Energy needed for a catapult launch of `mass` tons at `speed` m/s. */
	function launchEnergy(mass, catapultId, speed) {
		var c = catapult(catapultId);
		return KWH_PER_KNT2 * mass * speed * speed / c.efficiency;
	}

	/* Can the pad launch right now from its stored charge? */
	function canLaunch(chargeKwh, mass, catapultId, speed) {
		return chargeKwh >= launchEnergy(mass, catapultId, speed);
	}

	/* Solar energy added over dt seconds at planet light (0..1): W*s -> kWh. */
	function solarCharge(panelId, light, dtSec) {
		var p = panel(panelId);
		return p.power * light * dtSec / 3600000;
	}

	/* Battery charge after leak over dt years (colony years per 0.2.0 clock). */
	function batteryLeak(batteryId, chargeKwh, dtYears) {
		var b = battery(batteryId);
		return chargeKwh * Math.exp(-b.leak * dtYears);
	}

	/* Impulse delta-v from burning fuelKg with the installed engine. */
	function impulseDeltaV(fuelKg, engineId, shipMassT) {
		var e = engine(engineId);
		if (!e || fuelKg <= 0 || shipMassT <= 0) return 0;
		return G0 * e.isp * Math.log((shipMassT + fuelKg) / shipMassT);
	}

	/* --- planet-gear economics ----------------------------------------- */

	/* Build cost of a single piece of planet gear. */
	function gearBuildCost(kind, id) {
		var t = find(TABLES[kind], id);
		return t ? t.buildCost : 0;
	}

	/* Cost to apply the `toId` tier to every already-built facility of `kind`
	 * across `planets`. A planet counts as built when its gear slot is non-null
	 * and differs from `toId`. Returns the total purse cost. */
	function bulkUpgradeCost(planets, kind, toId) {
		var total = 0;
		var i, p, cur;
		for (i = 0; i < planets.length; i++) {
			p = planets[i];
			cur = p[kind];
			if (cur && cur !== toId) {
				total += gearBuildCost(kind, toId);
			}
		}
		return total;
	}

	/* Pure bulk upgrade: returns { planets, cost }. Does not mutate input. */
	function applyBulkUpgrade(planets, kind, toId) {
		var out = [];
		var i, p, cp;
		var cost = bulkUpgradeCost(planets, kind, toId);
		for (i = 0; i < planets.length; i++) {
			p = planets[i];
			cp = {};
			cp.catapult = p.catapult;
			cp.panel = p.panel;
			cp.battery = p.battery;
			cp.chargeKwh = p.chargeKwh;
			if (p[kind] && p[kind] !== toId) cp[kind] = toId;
			out.push(cp);
		}
		return { planets: out, cost: cost };
	}

	/* --- starter grant ------------------------------------------------- */

	function starterGrant() {
		return {
			purse: 3.00,
			ship: { hold: 'HOLD-0', engine: null, tank: 'FT-0' },
			startPlanet: { catapult: 'EMC-1', panel: 'SP-1', battery: 'BAT-1',
				chargeKwh: 1.5 }
		};
	}

	/* Clipboard line for balance feedback: tech: KIND ID { key: value, ... }.
	 * Paste into chat: "this item needs price up / mass down". */
	function copySpec(kind, id) {
		if (!TABLES[kind]) return '';
		var t = find(TABLES[kind], id);
		var k, out, first;
		if (!t) return '';
		out = 'tech: ' + kind.toUpperCase() + ' ' + id + ' {';
		first = true;
		for (k in t) {
			if (k === 'id') continue;
			if (!first) out += ', ';
			out += k + ': ' + t[k];
			first = false;
		}
		out += ' }';
		return out;
	}

	var OrbitTech = {
		CATAPULTS: CATAPULTS, PANELS: PANELS, BATTERIES: BATTERIES,
		HOLDS: HOLDS, ENGINES: ENGINES, TANKS: TANKS, HELPERS: HELPERS,
		find: find,
		shipMass: shipMass, launchEnergy: launchEnergy,
		canLaunch: canLaunch, solarCharge: solarCharge,
		batteryLeak: batteryLeak, impulseDeltaV: impulseDeltaV,
		gearBuildCost: gearBuildCost,
		bulkUpgradeCost: bulkUpgradeCost,
		applyBulkUpgrade: applyBulkUpgrade,
		copySpec: copySpec, starterGrant: starterGrant
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = OrbitTech;
	} else {
		root.OrbitTech = OrbitTech;
	}
})();
