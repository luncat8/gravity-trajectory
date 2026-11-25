/*
 * Career numbers every other career part reads: the CAREER table, start modes,
 * task/leg/owner enums, PRNG salts, the commercial and Capital rails, the
 * special-planets switch, and the small record makers (pad, task, galaxy-free
 * helpers like price/canPay/draw01). No behaviour beyond those helpers.
 *
 * Part of GravityGame: gravity_game.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const OrbitWorld = node ? require('./orbit_world.js') : root.OrbitWorld;
	const OrbitTech = node ? require('./orbit_tech.js') : root.OrbitTech;
	const {
		CHEAT_COMMUNISM
	} = GravityGame;

	/* the `bribeVisitStep` marker of a visit that has not carried a bribe: far
	 * below any step a run holds, so it can never equal a visit stamp by
	 * accident and open the window shut, or shut one still open */
	const BRIBE_OPEN = -0x7fffffff;
	/* the observation device (0.6.1): above this rot the rulers let the ship's
	 * device be taken off on their planet, which silences it for every company */
	const QUIET_MIN = 75;
	/* fragile load (0.6.3): the launch acceleration m/s² the load survives.
	 * accel = speed² / (2 · RAIL_M), so the limit prices force, not the rail
	 * tier: EMC-1 at full force stays under it on a loaded ship, a stronger
	 * rail must be fired gently. FRAGILE_SPEED is the same limit in px/s. */
	const FRAGILE_ACCEL = 2.0;
	const FRAGILE_SPEED = Math.sqrt(2 * FRAGILE_ACCEL * OrbitTech.RAIL_M);
	/* offered only from planets this light and for loads this heavy at most
	 * (a gentle shot must be able to leave); pays FRAGILE_PAY × an ordinary
	 * delivery of the same tons and distance, still under CAREER.deliveryMax */
	const FRAGILE_G = 0.75;
	const FRAGILE_TONS = 8;
	const FRAGILE_PAY = 1.4;
	const FRAGILE_CHANCE = 0.25;
	/* deep-origin delivery (0.6.2): a heavy load out of a deep well is the
	 * job an EMC-3 is built for — an EMC-2 + BAT-2 lifts a HOLD-24
	 * (10 t + 24 t + 4 t hold = 38 t) off 43 % of g 2.0 planets and 13 % at
	 * g 2.5, an EMC-3 + BAT-3 off 100 % and 87 %. Offered with the note and
	 * paid DEEP_BONUS more than an ordinary delivery of the same tons. */
	const DEEP_G = 2.2;
	const DEEP_TONS = 16;
	const DEEP_BONUS = 0.6;

	/* --- career ------------------------------------------------------------ */

	/*
	 * Career: launching spends the pad's solar-charged battery. The purse grows
	 * from the shared visit market (the always-available "visit a long-unvisited
	 * planet" task), delivery contracts (land cargo on a planet, needs a hold)
	 * and route competitions (one flight from a planet at least `minLength`
	 * long). Every planet carries an EMC (electromagnetic catapult) and the
	 * planet is claimed by whoever owns the best rail on it: your own EMC
	 * launches for its battery energy alone, a rival player's EMC charges a
	 * usage tax that scales with the energy of the shot and pays that player,
	 * and the neutral commercial EMC-1 standing on every planet charges a fee
	 * that scales with the shot. So a padless planet is no longer a dead end,
	 * only an expensive one.
	 * A company has ten game minutes to recover from insolvency, or completes
	 * (a catapult on every planet; cheat runs never complete). Evacuation can
	 * use the remaining purse and trades time for any unpaid fare.
	 * Every `*Sec` below is flight seconds (`steps · DT`) — the clock the board,
	 * the barrels and the HUD read — never world minutes or real seconds.
	 */
	const CAREER = {
		evacFee: 6,
		evacFullSeconds: 12,
		evacFreeSeconds: 240,
		taxPerKwh: 1,
		endgamePurse: 99,
		hqMinLight: 0.5,
		lightFloor: 0.25,
		deliverySlots: 4,
		deliverySec: 240,
		competeSec: 180,
		competeEvery: 3,
		deliveryBase: 0.5,
		deliveryPerTon: 0.06,
		deliveryDistPx: 900,
		deliveryMax: 4.5,
		competeMinPx: 1500,
		competeSpanPx: 1500,
		competeBase: 2,
		competeSpan: 2,
		turretMinSec: 2,
		turretSpanSec: 3
	};
	const FUEL_KG_PER_KWH = 20;
	const FUEL_PRICE = 0.08;
	const FUEL_BUY_STEP = 10;
	const START_PLANET = 'planet';
	const START_SPACE = 'space';
	const START_CAPITAL = 'capital';
	const START_MODES = { planet: true, space: true, capital: true };
	const SPACE_START_FUEL_KG = OrbitTech.TANKS[1].fuelCap;
	const SPACE_START_BONUS = 15;
	const CAPITAL_START_BONUS = 10;
	const SPACE_START_OFFSET_PX = 22;
	const CARGO_TONS = [4, 8, 16, 24];
	const COMPETE_SLOT = CAREER.deliverySlots;
	const MEDIC_SLOT = CAREER.deliverySlots + 1;
	const BOARD_SIZE = CAREER.deliverySlots + 2;
	/* the shared race (0.7.41): one galaxy-wide event announced on a board
	 * refresh, `ANNOUNCE_SEC` of countdown before the starting gun, and a
	 * `COMPETE_ENTRY` stake every entrant pays into the prize pool */
	const ANNOUNCE_SEC = 45;
	const COMPETE_ENTRY = 0.5;
	const SPORT_LENGTH = 0;
	const TASK_NONE = 0;
	const TASK_DELIVERY = 1;
	const TASK_COMPETE = 2;
	const TASK_MEDIC = 3;
	const TASK_OFFERED = 0;
	const TASK_ACCEPTED = 1;
	const TASK_LOADED = 2;
	/* what a landing can complete: a contract leg or the competition. Both the
	 * money the purse takes (`cash`) and the progress that unlocks the rest of
	 * the payout (`credit`) are read off one table. */
	const LEG_NONE = 0;
	const LEG_LOAD = 1;
	const LEG_DELIVER = 2;
	const LEG_MEDICS = 3;
	const LEG_PATIENTS = 4;
	const LEG_COMPETE = 5;
	/* a leg that only advances a contract is worth its reward times this while
	 * the payout is still unrealized: loaded cargo is not yet money in the purse */
	const LEG_CREDIT = 0.35;
	const CAREER_OPEN = 0;
	const CAREER_BROKE = 1;
	const CAREER_COMPLETE = 2;
	const SALT_HQ = 0xca;
	const SALT_TASK = 0xcb;
	const SALT_TURRET = 0xcc;
	const SALT_RIVAL = 0xcd;
	const SALT_POLITICS = 0xce;
	const SALT_ARREST = 0xcf;
	const SALT_BRIBE = 0xd0;
	const SALT_GIFT = 0xd1;
	const TAU = Math.PI * 2;

	/*
	 * The commercial EMC-1 is the fallback pad of every planet: a neutral
	 * operator keeps it fully charged and charges for the shot by its energy —
	 * a base fee plus a rate per kWh, so a light hop is cheaper than a loaded
	 * one. It is one immutable record — nothing drains or upgrades it.
	 */
	const COMMERCIAL_BASE = 2.00;
	const COMMERCIAL_KWH = 2.50;
	const COMMERCIAL_PAD = {
		catapult: OrbitTech.CATAPULTS[0],
		panel: OrbitTech.PANELS[0],
		battery: OrbitTech.BATTERIES[0],
		chargeKwh: OrbitTech.BATTERIES[0].capacity,
		reservedKwh: 0
	};
	const OWNER_COMMERCIAL = -1;

	/*
	 * The Empire Capital's fixed imperial rail (0.5.11): one immutable EMC-3
	 * pad, always full, never reserved, free to launch from. Nobody owns or
	 * builds it; every actor's launchPads[capitalPlanet] points here. Like the
	 * commercial rail it never drains, but it claims the planet for the Empire
	 * and forbids building.
	 */
	const OWNER_CAPITAL = -2;
	const CAPITAL_PAD = {
		catapult: OrbitTech.CATAPULTS[2],
		panel: OrbitTech.PANELS[2],
		battery: OrbitTech.BATTERIES[2],
		chargeKwh: OrbitTech.BATTERIES[2].capacity,
		reservedKwh: 0
	};
	/* a fly-visit to the Capital pays this flat fee on each entry; A.R.F. pays 0 */
	const CAPITAL_VISIT_PAY = -3;
	/* accepting any quest or sport at the Capital refunds the entry fee at once;
	 * failing or removing that quest or sport deducts the refund back */
	const CAPITAL_REFUND = -CAPITAL_VISIT_PAY;
	/* tourist-delivery bias: A.R.F. destinations and Capital resort origins and
	 * destinations each weigh 2x an ordinary endpoint (0.5.11) */
	const TOURIST_CHANCE = 0.35;
	const TOURIST_WEIGHT = 2;

	/*
	 * Rebellious worlds (0.5.12). A rebellion seizes every player rail on its
	 * planet into one commercial rail the rebels run: the tiers survive, the
	 * fee is the ordinary commercial one, and the planet can never be claimed
	 * or built again. Until it is quelled, visits there pay a fly-by multiple
	 * that ramps from 1x toward 4x as the rebellion ages.
	 */
	const OWNER_REBEL = -3;

	/* specials are a property of the seeded world; the A/B switch turns their
	 * rules off without touching geometry (SPECIAL=0 reproduces the old economy) */
	let specialPlanets = true;
	function setSpecialPlanets(on) {
		specialPlanets = Boolean(on);
		return specialPlanets;
	}
	function specialPlanetsOn() {
		return specialPlanets;
	}

	/* `reservedKwh` is the charge queued launches have already claimed */
	function createPad() {
		return { catapult: null, panel: null, battery: null, chargeKwh: 0, reservedKwh: 0 };
	}

	/*
	 * A queued launch claims the energy of its shot from the pad battery before
	 * the barrel lines up, so whoever queued first gets the charge — the owner
	 * of the rail and a guest on it alike. The reservation lowers everyone's
	 * launch ceiling (GravitySim.speedLimit) until the shot fires or is
	 * cancelled, and the neutral commercial rail (kept charged by its operator)
	 * never reserves nor drains.
	 */
	function reserveEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh += energy;
	}

	function releaseEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh = pad.reservedKwh > energy ? pad.reservedKwh - energy : 0;
	}

	function createTask() {
		return { kind: TASK_NONE, state: TASK_OFFERED, good: 0, tons: 0, from: -1, to: -1,
			planet: -1, minLength: 0, reward: 0, deadline: 0, startsAt: 0, tourist: false,
			fragile: false, deep: false, medics: 0, patients: 0, aboard: 0, capitalRefund: 0 };
	}

	function clearTask(task) {
		task.kind = TASK_NONE;
		task.state = TASK_OFFERED;
		task.tourist = false;
		task.fragile = false;
		task.deep = false;
		task.medics = 0;
		task.patients = 0;
		task.aboard = 0;
		task.capitalRefund = 0;
		task.startsAt = 0;
	}

	function price(career, cost) {
		return career.cheat === CHEAT_COMMUNISM ? 0 : cost;
	}

	function canPay(career, cost) {
		return career.ledger.purse + 1e-9 >= price(career, cost);
	}

	function draw01(career, salt) {
		career.serial += 1;
		return OrbitWorld.hashBits(career.seed, career.serial, salt) / 4294967296;
	}

	Object.assign(GravityGame, {
		BRIBE_OPEN, QUIET_MIN, FRAGILE_ACCEL, FRAGILE_SPEED, FRAGILE_G, FRAGILE_TONS, FRAGILE_PAY,
		FRAGILE_CHANCE, DEEP_G, DEEP_TONS, DEEP_BONUS, CAREER, FUEL_KG_PER_KWH, FUEL_PRICE,
		FUEL_BUY_STEP, START_PLANET, START_SPACE, START_CAPITAL, START_MODES, SPACE_START_FUEL_KG,
		SPACE_START_BONUS, CAPITAL_START_BONUS, SPACE_START_OFFSET_PX, CARGO_TONS, COMPETE_SLOT,
		MEDIC_SLOT, BOARD_SIZE, ANNOUNCE_SEC, COMPETE_ENTRY, SPORT_LENGTH, TASK_NONE, TASK_DELIVERY,
		TASK_COMPETE, TASK_MEDIC, TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED, LEG_NONE, LEG_LOAD,
		LEG_DELIVER, LEG_MEDICS, LEG_PATIENTS, LEG_COMPETE, LEG_CREDIT, CAREER_OPEN, CAREER_BROKE,
		CAREER_COMPLETE, SALT_HQ, SALT_TASK, SALT_TURRET, SALT_RIVAL, SALT_POLITICS, SALT_ARREST,
		SALT_GIFT, TAU, COMMERCIAL_BASE, COMMERCIAL_KWH, COMMERCIAL_PAD, OWNER_COMMERCIAL,
		OWNER_CAPITAL, CAPITAL_PAD, CAPITAL_VISIT_PAY, CAPITAL_REFUND, TOURIST_CHANCE,
		TOURIST_WEIGHT, OWNER_REBEL, setSpecialPlanets, specialPlanetsOn,
		specialPlanets: specialPlanetsOn, createPad, reserveEnergy, releaseEnergy, createTask,
		clearTask, price, canPay, draw01
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
