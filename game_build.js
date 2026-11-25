/*
 * Building: pad fit, known gear, buildGear and bulk upgrades, parts, and
 * the HQ radar.
 * not here: research and prototypes → game_science.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_build.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitTech, CHEAT_COMMUNISM, CAREER_OPEN, OWNER_COMMERCIAL, price, canPay,
		refitShip, rebelRail, claimOwner, syncCareerNetwork, refreshCareerMedic, uninstallRefusal
	} = inner;

	function fitPad(career, planet, catapult, panel, battery) {
		const pad = career.pads[planet];
		if (pad.catapult === null) career.padCount += 1;
		pad.catapult = catapult;
		pad.panel = panel;
		pad.battery = battery;
		pad.chargeKwh = battery.capacity;
	}

	/* --- radar (0.7.49): the HQ facility that reveals every ship's landing --
	 * The HQ sees the whole map and broadcasts to the ship, so one build
	 * covers every company flight: a ghost on each ship's predicted
	 * trajectory with the time to its next landing. It is a boolean company
	 * flag plus the spend — no pad, no ship slot. The reveal is each ship's
	 * own `predictFlight`, so a ghost matches what that ship will actually
	 * do. Cost sits between EMC-1 (3.04) and EMC-2 (7.83), so a company
	 * builds EMC-1 before radar. */
	const RADAR_COST = 6;
	/* per-ship prediction cap, the aim-trace class, so the reveal never
	 * stalls a frame: a fixed CPU budget in real milliseconds (the same
	 * class as the aim trace), and a memo so parked skies and other ships'
	 * frames cost nothing. A trace the budget truncates (a long coast) shows
	 * its partial path with no landing ghost, exactly like the live flight
	 * prediction the page already draws at its own budget. */
	const RADAR_BUDGET_MS = 6;
	/* the landing-time race the reveal makes visible: a destination another
	 * ship is heading to is taken, so a radar company concedes this fraction
	 * of the landing's value — unless its own shot lands there first, in which
	 * case it beats the rival and gains the same fraction */
	const RADAR_AVOID = 0.25;
	const RADAR_BEAT = RADAR_AVOID;

	/* pure build gate: at the HQ, career open, the purse covers it */
	function canBuildRadar(career) {
		return career.ended === CAREER_OPEN && career.hq >= 0 &&
			career.at === career.hq && canPay(career, RADAR_COST);
	}

	/* the facility itself: money into property, the flag is the whole machine */
	function buildRadar(career) {
		if (career.radar || !canBuildRadar(career)) return false;
		career.ledger.purse -= price(career, RADAR_COST);
		career.buildSpent += price(career, RADAR_COST);
		career.radar = true;
		return true;
	}

	/* predict one ship for the reveal, memoised on the career; false when it
	 * is parked (or on the tow). The trace reads only flight state —
	 * flightFieldT is a function of liveSteps, the cargo carries the rest —
	 * so a static sky never re-predicts, and the one flight-state change a
	 * step does not carry (an impulse burn) invalidates the memo through
	 * its velocity alone. `keep` is a sim whose buffers someone else
	 * maintains this frame (the page's active aim or flight trace): read
	 * them, never re-predict over them. */
	function radarPredict(career, keep) {
		const sim = career.sim;
		if (!sim) return false;
		const stamp = career.radarStamp;
		if (sim.status !== GravitySim.STATUS_FLYING || career.evacuating) {
			stamp.steps = -1;
			return false;
		}
		if (keep === sim) return true;
		if (stamp.steps !== sim.liveSteps || stamp.t0 !== sim.flightFieldT ||
			stamp.vx !== sim.cargo.vx || stamp.vy !== sim.cargo.vy) {
			sim.predictFlight(RADAR_BUDGET_MS);
			stamp.steps = sim.liveSteps;
			stamp.t0 = sim.flightFieldT;
			stamp.vx = sim.cargo.vx;
			stamp.vy = sim.cargo.vy;
		}
		return true;
	}

	/* one pooled record per ship; the pool grows only when a company joins */
	const radarRecordPool = [];

	function radarFill(out, count, career, world, keep) {
		const sim = career.sim;
		if (!sim) return count;
		if (radarRecordPool.length <= count) {
			radarRecordPool.push({ career: null, sim: null, x: 0, y: 0,
				predX: null, predY: null, predCount: 0, landStep: -1, tLand: 0, body: -1 });
		}
		const record = radarRecordPool[count];
		out[count] = record;
		if (!radarPredict(career, keep)) {
			const parked = career.at >= 0 && !career.evacuating;
			record.career = career;
			record.sim = sim;
			record.x = parked ? world.planetX[career.at] : sim.cargo.x;
			record.y = parked ? world.planetY[career.at] : sim.cargo.y;
			record.predX = null;
			record.predY = null;
			record.predCount = 0;
			record.landStep = -1;
			record.tLand = 0;
			record.body = -1;
			return count + 1;
		}
		const landed = sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0;
		record.career = career;
		record.sim = sim;
		record.x = sim.cargo.x;
		record.y = sim.cargo.y;
		/* the sim's own buffers, reused — never copied per frame */
		record.predX = sim.predX;
		record.predY = sim.predY;
		record.predCount = sim.predCount;
		record.landStep = landed ? sim.liveSteps + sim.predSteps : -1;
		record.tLand = landed ? sim.predSteps * GravitySim.DT : 0;
		record.body = landed ? sim.predBody : -1;
		return count + 1;
	}

	/* the reveal: one record per ship the company's HQ sees — its own ship
	 * first, then the galaxy's — into the caller-owned array; the count.
	 * Global by design (no range limit), landing trajectories only. */
	function radarShips(out, humanCareer, world, keep) {
		if (!humanCareer || !humanCareer.radar) return 0;
		let count = radarFill(out, 0, humanCareer, world, keep);
		const actors = humanCareer.galaxy ? humanCareer.galaxy.actors : null;
		for (let i = 0; actors && i < actors.length; i++) {
			if (actors[i] !== humanCareer) {
				count = radarFill(out, count, actors[i], world, keep);
			}
		}
		return count;
	}

	function ownPart(career, item) {
		if (item !== null) career.owned[item.id] = true;
	}

	/* --- building ------------------------------------------------------ */

	/* stock (table) gear is only buildable when it is known: EMC tiers 1-2
	 * start known, panels/batteries/engines/tanks all do, but higher EMCs
	 * (3/4/5) must be unlocked via science — a researched prototype at or
	 * above their rung proves the rung and the stock tier joins the shop;
	 * the invention itself carries its own build cost either way. The
	 * communism cheat unlocks every tier. */
	function gearKnown(career, item) {
		if (!item) return false;
		if (career.cheat === CHEAT_COMMUNISM) return true;
		if (career.owned[item.id]) return true;
		if (career.knownGear && career.knownGear[item.id]) return true;
		return false;
	}

	/* planet ownership: a planet can hold at most one player-owned EMC (plus
	 * the neutral commercial EMC-1 and the evacuate option). Building your
	 * own EMC on a planet that already carries another player's rail is
	 * forbidden — claim the planet by landing on an unclaimed one first. */
	/* a rebel planet: seized ground that never becomes buildable again */
	function planetSeized(career, planet) {
		const market = career.market;
		return market !== null && market.seized[planet] === 1;
	}

	function planetBuildable(career, planet) {
		if (planet === career.capitalPlanet) return false;
		/* a seized planet is the rebels' ground, quelled or not */
		if (rebelRail(career, planet)) return false;
		if (!career.galaxy) return true;
		const owner = claimOwner(career.galaxy, planet);
		return owner === OWNER_COMMERCIAL || owner === career.index;
	}

	/* a battery is storage, not energy: a bought one keeps the charge already in
	 * the pad, clamped to its new capacity. Only a fresh pad (fitPad) starts
	 * charged, because there is no earlier charge to keep. */
	function chargeAfterBattery(pad, battery) {
		pad.chargeKwh = Math.min(pad.chargeKwh, battery.capacity);
	}

	/* a first catapult brings a starter panel and battery (charged) with it;
	 * a panel or battery needs a pad to sit on */
	function buildGear(career, planet, kind, item) {
		if (career.ended !== CAREER_OPEN) return false;
		if (planet === career.capitalPlanet) return false;
		if (rebelRail(career, planet)) return false;
		const pad = career.pads[planet];
		const fresh = kind === OrbitTech.KIND_CATAPULT && pad.catapult === null;
		if (fresh && !planetBuildable(career, planet)) return false;
		if (!fresh && !OrbitTech.upgrades(pad, kind, item)) return false;
		if (!gearKnown(career, item)) return false;
		if (!canPay(career, item.buildCost)) return false;
		career.ledger.purse -= price(career, item.buildCost);
		career.buildSpent += price(career, item.buildCost);
		if (fresh) {
			fitPad(career, planet, item, OrbitTech.PANELS[0], OrbitTech.BATTERIES[0]);
		} else {
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) chargeAfterBattery(pad, item);
		}
		if (planet === career.at) {
			/* a fresh rail rescues stranding only when it can actually lift
			 * the ship; a pad too weak for the current load leaves the
			 * vessel stranded until an upgrade or evacuation */
			career.stranded = !(OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
				pad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN);
		}
		/* a fresh own rail replaces a commercial choice made for the same planet */
		if (fresh && career.commercialPlanet === planet) career.commercialPlanet = -1;
		syncCareerNetwork(career);
		inner.checkEnded(career);
		refreshCareerMedic(career);
		return true;
	}

	function bulkUpgradeCost(career, kind, item) {
		return price(career, OrbitTech.bulkUpgradeCost(career.pads, kind, item));
	}

	/* applies `item` to every already-built facility of `kind` at once */
	function bulkUpgrade(career, kind, item) {
		if (!gearKnown(career, item)) return false;
		const cost = bulkUpgradeCost(career, kind, item);
		if (career.ledger.purse + 1e-9 < cost) return false;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (!OrbitTech.upgrades(pad, kind, item)) continue;
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) chargeAfterBattery(pad, item);
		}
		career.ledger.purse -= cost;
		career.buildSpent += cost;
		syncCareerNetwork(career);
		refreshCareerMedic(career);
		return true;
	}

	/*
	 * A ship part is refitted wherever the vessel stands: any planet is a yard,
	 * so the player never has to find HQ to fit an engine. A bought part stays
	 * owned, so swapping back to a lighter owned tier is free; only the engine
	 * has a `null` = none step. The reason the shop prints comes from
	 * partRefusal, never from a second copy of these gates.
	 */
	function partRefusal(career, kind, item) {
		if (!career || career.at < 0) return 'land on a planet to refit';
		if (career.ship[kind] === item) return 'already fitted';
		if (item === null) {
			return kind === OrbitTech.KIND_ENGINE ? '' : 'a ' + kind + ' slot cannot be empty';
		}
		if (kind === OrbitTech.KIND_HOLD && item.capacity < career.ship.cargoTons) {
			return 'drop the ' + career.ship.cargoTons + ' t cargo first';
		}
		if (kind === OrbitTech.KIND_OBS && !item.fitted && career.market && career.market.galaxy) {
			const refusal = uninstallRefusal(career, career.market, career.at);
			if (refusal !== '') return refusal;
		}
		if (!career.owned[item.id] && !canPay(career, item.buildCost)) return 'purse too small';
		return '';
	}

	function installPart(career, kind, item) {
		if (partRefusal(career, kind, item) !== '') return false;
		if (item !== null && !career.owned[item.id]) {
			career.ledger.purse -= price(career, item.buildCost);
			career.buildSpent += price(career, item.buildCost);
			ownPart(career, item);
		}
		career.ship[kind] = item;
		career.ship.fuelKg = Math.min(career.ship.fuelKg, career.ship.tank.fuelCap);
		refitShip(career);
		refreshCareerMedic(career);
		return true;
	}

	Object.assign(GravityGame, {
		RADAR_COST, RADAR_BUDGET_MS, RADAR_AVOID, RADAR_BEAT, canBuildRadar, buildRadar,
		radarPredict, radarShips, gearKnown, planetBuildable, planetSeized, buildGear,
		bulkUpgradeCost, bulkUpgrade, installPart, partRefusal
	});
	Object.assign(inner, {
		fitPad, RADAR_COST, ownPart, gearKnown, planetBuildable
	});
});
