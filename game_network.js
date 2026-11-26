/*
 * Catapult network: the galaxy, turrets, pads and their owners, claims,
 * commercial and guest fees, exit cost, rail text, and launch reasons.
 * not here: building and fitting pads → game_build.js; seizure → game_politics.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_network.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitTech, STATS_SAMPLES, FRAGILE_SPEED, CAREER, SPORT_LENGTH,
		TASK_NONE, TASK_LOADED, COMMERCIAL_PAD, OWNER_COMMERCIAL, OWNER_CAPITAL, CAPITAL_PAD,
		OWNER_REBEL, OWNER_EMPTY, price, careerShipUsable, repairCost, evacuationCost,
		evacuationSeconds, rebelRail, emptyWorld
	} = inner;

const STATS_SEC = 2;
const STATS_EVERY = Math.round(STATS_SEC / GravitySim.DT);
	const WORN_OUT_BLOCK = 'ship worn out — repair before launch';
	const SALT_TURRET = 0xcc;
	const SALT_RIVAL = 0xcd;
	const TAU = Math.PI * 2;

	/*
	 * The commercial EMC-1 is the fallback pad of every planet: a neutral
	 * operator keeps it fully charged and charges for the shot by its energy —
	 * a base fee plus a rate per kWh, so a light hop is cheaper than a loaded
	 * one. It is one immutable record — nothing drains or upgrades it.
	 */
	const COMMERCIAL_BASE = 2.00;
	const COMMERCIAL_KWH = 2.50;

	/* an uninhabited world has no infrastructure at all: this record stands in
	 * for the missing pad so every reader of `padAt` sees `catapult === null`
	 * and the launch network refuses the rail there (0.7.44) */
	const EMPTY_PAD = { catapult: null, panel: null, battery: null, chargeKwh: 0, reservedKwh: 0 };

	/* --- EMC network ------------------------------------------------------- */

	/*
	 * A galaxy is the shared map of one career run: every actor (you and each
	 * rival player) owns pads, and `launchPads[planet]` is the EMC each actor
	 * actually fires from — its own, else the best rival EMC standing there,
	 * else the commercial one. Sim, bots and benches read that array, so the
	 * launch gate never has to know who owns what.
	 */
	function createGalaxy() {
		return {
			seed: 0,
			actors: [],
			commercialPads: Array(OrbitWorld.PLANETS).fill(null),
			mapSeats: null,
			/* safe first-flight pay the initial seating was balanced around; live
			 * expansion uses the same target when choosing a new rival's world */
			openingTargetPay: NaN,
			period: new Float64Array(OrbitWorld.PLANETS),
			phase: new Float64Array(OrbitWorld.PLANETS),
			/* the one galaxy-wide competition event every board mirrors */
			sport: createSportRecord(),
			sportSerial: 0
		};
	}

	/* the shared race record (0.7.41): announced at a colonized planet, `startsAt`
	 * is the starting gun, the pool grows by one stake per entrant and the first
	 * qualifying flight launched at or after the gun takes it all. `GALAXY_SKIP`
	 * does not list it, so SavedMap runs and CareerReplay frames carry it. */
	function createSportRecord() {
		return {
			kind: TASK_NONE, serial: 0, discipline: SPORT_LENGTH, planet: -1,
			minLength: 0, startsAt: 0, deadline: 0, baseReward: 0, pool: 0,
			enteredMask: 0, attemptedMask: 0, winner: -1, nextAt: 0
		};
	}

	/* seeded turret: each planet's EMC turns once per 2…5 s of in-game career time, so
	 * a queued launch fires when the barrel lines up with the player's aim */
	function resetGalaxy(galaxy, seed) {
		galaxy.seed = seed >>> 0;
		galaxy.actors.length = 0;
		galaxy.commercialPads.fill(null);
		galaxy.mapSeats = null;
		galaxy.openingTargetPay = NaN;
		galaxy.sport = createSportRecord();
		galaxy.sportSerial = 0;
		galaxy.stats = {
			every: STATS_EVERY,
			count: 0,
			nextStep: STATS_EVERY,
			series: [
				new Float32Array(STATS_SAMPLES), /* map rot */
				new Float32Array(STATS_SAMPLES)  /* map standing */
			]
		};
	for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			galaxy.period[p] = CAREER.turretMinSec + CAREER.turretSpanSec *
				(OrbitWorld.hashBits(galaxy.seed, p, SALT_TURRET) / 4294967296);
			galaxy.phase[p] = TAU * (OrbitWorld.hashBits(galaxy.seed,
				p + OrbitWorld.DEFAULT_PLANETS, SALT_TURRET) / 4294967296);
		}
	}

	function turretPeriod(galaxy, planet) {
		return galaxy.period[planet];
	}

	/* barrel direction (radians) of the planet's EMC after `seconds` of flight time */
	function turretAngle(galaxy, planet, seconds) {
		return galaxy.phase[planet] + seconds / galaxy.period[planet] * TAU;
	}

	/* actor index of the best foreign EMC on `planet`, -1 when only the commercial one stands there */
	function foreignOwner(galaxy, self, planet) {
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			if (actor === self) continue;
			const pad = actor.pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* the pad `career` fires from on `planet`: the commercial EMC-1 stands on
	 * every planet and wins whenever it is the chosen rail, else your own EMC,
	 * else the best rival EMC, else the commercial one again. Ignore the
	 * one-shot override when forecasting the rail after a landing. */
	function commercialPadAt(career, planet) {
		const pads = career.galaxy ? career.galaxy.commercialPads : career.commercialPads;
		return rebelRail(career, planet) || (pads && pads[planet]) || COMMERCIAL_PAD;
	}

	function padAt(career, planet, useCommercial = true) {
		if (planet === career.capitalPlanet) return CAPITAL_PAD;
		const rebel = rebelRail(career, planet);
		if (rebel) return rebel;
		if (emptyWorld(career, planet)) return EMPTY_PAD;
		if (useCommercial && career.commercialPlanet === planet) return commercialPadAt(career, planet);
		if (career.pads[planet].catapult !== null) return career.pads[planet];
		if (!career.galaxy) return commercialPadAt(career, planet);
		const owner = foreignOwner(career.galaxy, career, planet);
		return owner === OWNER_COMMERCIAL ? commercialPadAt(career, planet) : career.galaxy.actors[owner].pads[planet];
	}

	/* owner index of that pad, -1 for the neutral commercial EMC, -2 for the
	 * fixed imperial rail on the Capital, -4 for an uninhabited world's no-pad */
	function padOwner(career, planet, useCommercial = true) {
		if (planet === career.capitalPlanet) return OWNER_CAPITAL;
		const market = career.market;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		/* a quelled rebellion leaves its rail commercial for good */
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		if (emptyWorld(career, planet)) return OWNER_EMPTY;
		if (useCommercial && career.commercialPlanet === planet) return OWNER_COMMERCIAL;
		if (career.pads[planet].catapult !== null) return career.index;
		if (!career.galaxy) return OWNER_COMMERCIAL;
		return foreignOwner(career.galaxy, career, planet);
	}

	/* choose (planet >= 0) or drop (-1) the commercial rail for the next launch;
	 * it never claims the planet and never blocks building your own EMC there */
	function setCommercial(career, planet) {
		/* the Capital rail is imperial and a rebellious planet runs its own */
		if (planet >= 0 && (planet === career.capitalPlanet || emptyWorld(career, planet))) return;
		if (planet >= 0 && rebelRail(career, planet)) return;
		career.commercialPlanet = planet;
		syncCareerNetwork(career);
	}

	/* planet claim: the highest rail there wins, ties keep the older actor; the
	 * Capital is always the Empire's, never a player claim */
	function claimOwner(galaxy, planet) {
		const market = galaxy.market || (galaxy.actors.length > 0 ? galaxy.actors[0].market : null);
		if (market && market.empty[planet]) return OWNER_EMPTY;
		if (galaxy.actors.length > 0 && galaxy.actors[0].capitalPlanet === planet) return OWNER_CAPITAL;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* a build anywhere changes what every actor may fire from, so refresh all */
	function refreshNetwork(galaxy) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			for (let p = 0; p < OrbitWorld.PLANETS; p++) actor.launchPads[p] = padAt(actor, p);
		}
	}

	/* a solo career has no galaxy: its own launchPads must still mirror padAt */
	function syncCareerNetwork(career) {
		if (career.galaxy) {
			refreshNetwork(career.galaxy);
			return;
		}
		for (let p = 0; p < OrbitWorld.PLANETS; p++) career.launchPads[p] = padAt(career, p);
	}

	/*
	 * What the commercial rail charges for a shot of `speed`: a base fee plus
	 * the energy the shot burns, priced on the rail that stands on the planet
	 * (a seized rebel rail keeps the ordinary commercial price). 0 under the
	 * `communism` cheat. `mass` prices an exit for a ship other than the one
	 * aboard (a delivery's arrival); the live fee prices the ship as loaded.
	 */
	function commercialFee(career, planet, speed, mass) {
		const pad = commercialPadAt(career, planet);
		const shipMass = mass === undefined ? career.ship.mass : mass;
		const energy = OrbitTech.launchEnergy(shipMass, pad.catapult, speed);
		return price(career, COMMERCIAL_BASE + COMMERCIAL_KWH * energy);
	}

	/* the cheapest commercial shot there is — a dry starter ship at the minimum
	 * speed on the starter rail: the honest "one way off any planet" price.
	 * Undiscounted; callers apply the cheat wrapper. */
	function commercialMinFee() {
		return COMMERCIAL_BASE + COMMERCIAL_KWH *
			OrbitTech.launchEnergy(OrbitTech.SHIP_DRY_MASS, COMMERCIAL_PAD.catapult, GravitySim.SPEED_MIN);
	}

	/* money the EMC owner charges for a launch at `speed`; 0 on your own pad
	 * and on the Capital's free imperial rail. `mass` and `useCommercial`
	 * price a forecast post-landing launch without mutating live ship state. */
	function launchFee(career, planet, speed, mass, useCommercial) {
		const comm = useCommercial === undefined ? true : useCommercial;
		const owner = padOwner(career, planet, comm);
		if (owner === career.index || owner === OWNER_CAPITAL) return 0;
		const shipMass = mass === undefined ? career.ship.mass : mass;
		if (owner === OWNER_COMMERCIAL || owner === OWNER_REBEL) {
			return commercialFee(career, planet, speed, shipMass);
		}
		/* no rail stands on an uninhabited world, so there is no fee — and no
		 * launch: callers read this as an unusable rail */
		if (owner === OWNER_EMPTY) return Infinity;
		const pad = padAt(career, planet, comm);
		return price(career, CAREER.taxPerKwh *
			OrbitTech.launchEnergy(shipMass, pad.catapult, speed) * pad.catapult.tier);
	}

	/*
	 * Cheapest way off `planet` with a ship of `mass`: your own EMC is free, the
	 * commercial rail charges its fee at the slowest firable shot while it can
	 * lift the ship, a rival rail its usage tax at the slowest firable shot,
	 * and a build or an evacuation is the fallback. Infinity when nothing can
	 * leave.
	 */
	function exitCostAt(career, planet, mass) {
		if (planet < 0) return price(career, CAREER.evacFee);
		if (planet === career.capitalPlanet) return 0;
		if (career.pads[planet].catapult !== null) return 0;
		/* an uninhabited world offers no rail and no build: the tow is it */
		if (emptyWorld(career, planet)) return price(career, CAREER.evacFee);
		const rail = commercialPadAt(career, planet);
		const lift = OrbitTech.speedLimit(rail.battery.capacity,
			mass, rail.catapult, career.forceScale);
		const commercial = lift + 1e-9 >= GravitySim.SPEED_MIN
			? commercialFee(career, planet, GravitySim.SPEED_MIN, mass) : Infinity;
		let foreign = Infinity;
		const owner = padOwner(career, planet);
		if (owner !== OWNER_COMMERCIAL && owner !== OWNER_REBEL && owner !== career.index) {
			const pad = padAt(career, planet);
			const railLift = OrbitTech.speedLimit(pad.battery.capacity,
				mass, pad.catapult, career.forceScale);
			if (railLift + 1e-9 >= GravitySim.SPEED_MIN) {
				foreign = price(career, CAREER.taxPerKwh *
					OrbitTech.launchEnergy(mass, pad.catapult, GravitySim.SPEED_MIN) *
					pad.catapult.tier);
			}
		}
		const build = price(career, OrbitTech.CATAPULTS[0].buildCost);
		const evac = price(career, CAREER.evacFee);
		return Math.min(commercial, foreign, build, evac);
	}

	function exitCost(career) {
		return exitCostAt(career, career.at, career.ship.mass);
	}

	/* who owns the rail on `planet`, named as the page and the bot log read it */
	function railOwnerText(career, planet) {
		const owner = padOwner(career, planet);
		const tier = padAt(career, planet).catapult ? padAt(career, planet).catapult.tier : 1;
		if (owner === career.index) return 'own EMC-' + tier;
		if (owner === OWNER_CAPITAL) return 'imperial EMC-3';
		if (owner === OWNER_REBEL) return 'rebel EMC-' + tier;
		if (owner === OWNER_COMMERCIAL && rebelRail(career, planet)) {
			return 'seized EMC-' + tier;
		}
		if (owner === OWNER_COMMERCIAL) return 'commercial EMC-' + tier;
		if (owner === OWNER_EMPTY) return 'no rail · uninhabited';
		return (owner === 0 ? 'YOU' : 'R' + owner) + ' rail';
	}

	/*
	 * The live numbers behind every launch gate: the rail under the ship, its
	 * charge and the speed that buys, the fee and the purse. The launch list
	 * and the bot decision log both print this line, so a player and a rival
	 * never read two different stories about the same pad.
	 */
	function railText(career, sim, planet) {
		if (planet < 0) {
			return 'ship in space · evac ' + evacuationCost(career).toFixed(2) +
			' · ' + Math.round(evacuationSeconds(career)) + ' s · purse ' +
			career.ledger.purse.toFixed(2);
		}
		if (emptyWorld(career, planet)) {
			return 'P' + planet + ' · uninhabited · no EMC · exit ' +
				exitCostAt(career, planet, career.ship.mass).toFixed(2) +
				' · purse ' + career.ledger.purse.toFixed(2);
		}
		const pad = padAt(career, planet);
		const exit = exitCostAt(career, planet, career.ship.mass);
		return 'P' + planet + ' · ' + railOwnerText(career, planet) + ' · ' +
			pad.chargeKwh.toFixed(2) + '/' + pad.battery.capacity.toFixed(2) + ' kWh → ' +
			sim.speedLimit(planet).toFixed(0) + ' px/s (min ' + GravitySim.SPEED_MIN + ') · fee ' +
			launchFee(career, planet, GravitySim.SPEED_MIN).toFixed(2) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · exit ' +
			(Number.isFinite(exit) ? exit.toFixed(2) : 'impossible');
	}

	/* fragile load (0.6.3): a loaded fragile contract dies on a launch harder
	 * than FRAGILE_SPEED, whatever the rail; a gentle shot on any rail is safe */
	function fragileBreaks(task, speed) {
		return task.fragile && task.state === TASK_LOADED && speed > FRAGILE_SPEED + 1e-9;
	}

	/*
	 * The launch gates as structured reasons, in the ladder order the launch
	 * list prints: arrest, ship in space, wrong planet, worn out, no rail,
	 * speed cap, purse. launchReasons is every closed gate (the headline and
	 * the blockers under it); launchReason is the first, null when the shot
	 * fires. Ship-state gates (arrest, worn) report even behind a position
	 * gate; planet gates (no rail, cap, fee) need the ship on the planet, and
	 * no rail closes cap and fee. formatLaunchReason spells one reason in the
	 * words the list prints, and launchBlock is that spelling of the first
	 * reason — one writer, one order.
	 */
	function recordLaunchReason(out, reason, firstOnly) {
		if (firstOnly) return reason;
		out.push(reason);
		return null;
	}

	/* The same ordered checker serves the list (all reasons) and old callers
	 * (first only). The latter avoids allocating an array on the launch path. */
	function scanLaunchReasons(career, sim, planet, speed, repaired, firstOnly) {
		const out = firstOnly ? null : [];
		let first;
		if (career.arrested) {
			first = recordLaunchReason(out, { id: 'arrest', need: null, have: null }, firstOnly);
			if (first) return first;
		}
		if (career.at < 0) {
			first = recordLaunchReason(out, { id: 'space', need: null, have: null }, firstOnly);
			if (first) return first;
			if (!repaired && !careerShipUsable(career)) {
				first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
				if (first) return first;
			}
			return out;
		}
		if (career.at !== planet) {
			first = recordLaunchReason(out,
				{ id: 'wrong-planet', need: planet, have: career.at }, firstOnly);
			if (first) return first;
			if (!repaired && !careerShipUsable(career)) {
				first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
				if (first) return first;
			}
			return out;
		}
		if (!repaired && !careerShipUsable(career)) {
			first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
			if (first) return first;
		}
		if (!sim.canLaunchFrom(planet)) {
			first = recordLaunchReason(out, { id: 'no-rail', need: null, have: null }, firstOnly);
			if (first) return first;
			return out;
		}
		const cap = sim.speedLimit(planet);
		if (speed > cap + 1e-9) {
			first = recordLaunchReason(out, { id: 'cap', need: cap, have: speed }, firstOnly);
			if (first) return first;
		}
		const fee = launchFee(career, planet, speed);
		const cost = repaired ? fee + repairCost(career) : fee;
		if (career.ledger.purse + 1e-9 < cost) {
			first = recordLaunchReason(out,
				{ id: 'fee', need: cost, have: career.ledger.purse, repair: repaired }, firstOnly);
			if (first) return first;
		}
		return out;
	}

	function launchReasons(career, sim, planet, speed, repaired) {
		return scanLaunchReasons(career, sim, planet, speed, repaired, false);
	}

	function launchReason(career, sim, planet, speed, repaired) {
		return scanLaunchReasons(career, sim, planet, speed, repaired, true);
	}

	function formatLaunchReason(reason) {
		if (!reason) return '';
		if (reason.id === 'arrest') return 'under arrest · Capital transport';
		if (reason.id === 'space') return 'ship in space';
		if (reason.id === 'wrong-planet') return 'shot leaves from P' + reason.need;
		if (reason.id === 'worn') return WORN_OUT_BLOCK;
		if (reason.id === 'no-rail') return 'no rail under the ship';
		if (reason.id === 'cap') {
			return 'cap ' + reason.need.toFixed(0) + ' < ' + reason.have.toFixed(0) + ' px/s';
		}
		return (reason.repair ? 'repair + fee ' : 'fee ') + reason.need.toFixed(2) +
			' > purse ' + reason.have.toFixed(2);
	}

	/* the one reason a shot at `speed` cannot leave `planet` now, in the words
	 * the launch list prints under a row and the bot log puts on a "no shot"
	 * line. '' means firable. */
	function launchBlock(career, sim, planet, speed, repaired) {
		return formatLaunchReason(launchReason(career, sim, planet, speed, repaired));
	}

	function railBlock(career, sim, planet, speed) {
		return launchBlock(career, sim, planet, speed, false);
	}

	/* the same gate for a shot fired right after a full repair: the wear gate
	 * is lifted and the purse must cover the repair as well as the fee */
	function repairLaunchBlock(career, sim, planet, speed) {
		return launchBlock(career, sim, planet, speed, true);
	}

	/* the rail gate plus the purse, spelled by the same facts the list prints */
	function careerCanFire(career, sim, planet, speed) {
		return railBlock(career, sim, planet, speed) === '';
	}

	/* full-battery speed cap of the pad `career` fires from on `planet` */
	function padLift(career, planet, forceScale) {
		const pad = padAt(career, planet);
		/* no rail stands on an uninhabited world: zero lift keeps it out of
		 * every bot target list */
		if (pad.catapult === null) return 0;
		const cap = OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
			pad.catapult, forceScale === undefined ? career.forceScale : forceScale);
		return cap;
	}

	/* deterministic rival seed: own task board, HQ and science hull per player */
	function rivalSeed(seed, index) {
		return OrbitWorld.hashBits(seed >>> 0, index + 1, SALT_RIVAL);
	}

	/* Live advice only: compact replays rebuild the streak from their landings. */
	const returnLandingVisits = new WeakMap();

	function returnLandingVisit(career) {
		const visit = returnLandingVisits.get(career);
		return visit && visit.planet === career.at ? visit : null;
	}

	Object.assign(GravityGame, {
		COMMERCIAL_BASE, COMMERCIAL_KWH, EMPTY_PAD, commercialFee, commercialMinFee, commercialPadAt,
		createGalaxy, resetGalaxy, rivalSeed, turretPeriod, turretAngle, padAt, padOwner, claimOwner,
		refreshNetwork, setCommercial, launchFee, exitCost, exitCostAt, careerCanFire, padLift,
		railOwnerText, railText, launchBlock, railBlock, repairLaunchBlock, fragileBreaks,
		launchReason, launchReasons, formatLaunchReason, WORN_OUT_BLOCK, returnLandingVisit
	});
	Object.assign(inner, {
		createSportRecord, commercialPadAt, padAt, padOwner, setCommercial, claimOwner,
		refreshNetwork, syncCareerNetwork, commercialFee, launchFee, fragileBreaks, padLift,
		returnLandingVisits, returnLandingVisit
	});
});
