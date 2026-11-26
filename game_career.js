/*
 * A company's life: create, reset and start (planet, space and Capital
 * starts), join the galaxy, placement, map statistics, the endgame cheat,
 * checkEnded and liquidation.
 * not here: the career tables and enums → gravity_game.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_career.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitTech, OrbitScience, STATS_SAMPLES, RULES, CHEAT_ENDGAME, CAREER,
		BOARD_SIZE, TASK_NONE, TASK_OFFERED, CAREER_OPEN, SALT_HQ, COMMERCIAL_PAD, specialPlanetsOn,
		clearTask, careerShipUsable, refitShip, repairCost, rebelRail, planetProfit, resetLedger,
		openFlight, planetInPlay, createLaunchBook, resetLaunchBook, createSportRecord,
		setCommercial, refreshNetwork, syncCareerNetwork, returnLandingVisits, hqMask, pickHq,
		syncSportSlot, refreshBoard, clearPad, fitPad, ownPart, newPrototypes, seedScience,
		giftBudget, grantStartGifts
	} = inner;

	const START_PLANET = 'planet';
	const START_SPACE = 'space';
	const START_CAPITAL = 'capital';
	const SPACE_START_FUEL_KG = OrbitTech.TANKS[1].fuelCap;
	const SPACE_START_BONUS = 15;
	const CAPITAL_START_BONUS = 10;
	const SPACE_START_OFFSET_PX = 22;
	const CAREER_BROKE = 1;
	const CAREER_COMPLETE = 2;

	/* ── records & creation ── pad and task records, joinGalaxy, createCareer, pad sunlight */

	/* `reservedKwh` is the charge queued launches have already claimed */
	function createPad() {
		return { catapult: null, panel: null, battery: null, chargeKwh: 0, reservedKwh: 0 };
	}

	function createTask() {
		return { kind: TASK_NONE, state: TASK_OFFERED, good: 0, tons: 0, from: -1, to: -1,
			planet: -1, minLength: 0, reward: 0, deadline: 0, startsAt: 0, tourist: false,
			fragile: false, deep: false, medics: 0, patients: 0, aboard: 0, capitalRefund: 0 };
	}

	function joinGalaxy(career, galaxy) {
		career.galaxy = galaxy;
		career.market = galaxy.market || career.market || null;
		career.index = galaxy.actors.indexOf(career);
		if (career.index < 0) {
			career.index = galaxy.actors.length;
			galaxy.actors.push(career);
			if (galaxy.stats) {
				/* four stat series per company — profit, property, science, flown.
				 * a company joining mid-run backfills its past at its starting
				 * values, so its line starts flat instead of inheriting the
				 * history a removed company left in a reused series */
				while (galaxy.stats.series.length < 2 + galaxy.actors.length * 4) {
					galaxy.stats.series.push(new Float32Array(STATS_SAMPLES));
				}
				careerStats(sampleCareerOut, career);
				const base = 2 + career.index * 4;
				for (let s = 0; s < galaxy.stats.count; s++) {
					galaxy.stats.series[base][s] = sampleCareerOut.profit;
					galaxy.stats.series[base + 1][s] = sampleCareerOut.property;
					galaxy.stats.series[base + 2][s] = sampleCareerOut.science;
					galaxy.stats.series[base + 3][s] = sampleCareerOut.flown;
				}
			}
		}
		refreshNetwork(galaxy);
		/* a company joining mid-run mirrors the live event at once */
		syncSportSlot(career, galaxy.sport);
	}

	/* `ledger` is the purse shared with the page's score rows; pads and ship
	 * are the objects a GravitySim gates on (setLaunchNetwork) */
	function createCareer(ledger) {
		const pads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) pads.push(createPad());
		const launchPads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) launchPads.push(COMMERCIAL_PAD);
		const tasks = [];
		for (let i = 0; i < BOARD_SIZE; i++) tasks.push(createTask());
		return {
			ledger: ledger,
			seed: 0,
			cheat: null,
			galaxy: null,
			index: 0,
			/* the vessel's sim, set at startCareer — the radar reveal predicts
			 * through it; live references like these are never saved */
			sim: null,
			radar: false,
			radarStamp: { steps: -1, t0: -1, vx: 0, vy: 0 },
			/* the run's active planet subset; null = every planet in play */
			planetMask: null,
			planetCount: OrbitWorld.PLANETS,
			hq: -1,
			at: -1,
			flying: false,
			stranded: false,
			/* the last launch broke a fragile load (the notice the HUD prints) */
			fragileLost: false,
			commercialPlanet: -1,
			commercialPads: null,
			capitalPlanet: -1,
			arfPlanet: -1,
			launchBook: createLaunchBook(),
			pads: pads,
			launchPads: launchPads,
			padCount: 0,
			light: new Float64Array(OrbitWorld.PLANETS),
			ship: {
				hold: OrbitTech.HOLDS[0], engine: null, tank: OrbitTech.TANKS[0],
				obs: OrbitTech.OBS[1],
				cargoTons: 0, fuelKg: 0, mass: 0,
				colonyKit: false,
				condition: 1
			},
			/* 1 flagship; a bought ship wears WEAR_FLEET times faster */
			wearScale: 1,
			repairs: 0,
			maintenanceSpent: 0,
			owned: {},
			science: OrbitScience.createHull(),
			prototypes: newPrototypes(),
			research: 0,
			tasks: tasks,
			contract: -1,
			serial: 0,
			flights: 0,
			burns: 0,
			evacuations: 0,
			evacuationSpent: 0,
			delivered: 0,
			competitions: 0,
			/* the 0.50 race stakes this company paid into the shared pool, so the
			 * purse identity and the map statistics keep balancing */
			stakeSpent: 0,
			/* the world step this company's current flight launched at (the race
			 * judges it against `startsAt`, so the stamp rides on the career) */
			flightStartStep: 0,
			/* solo fallback event: headless careers without a galaxy race here */
			sport: createSportRecord(),
			earned: 0,
			taxPaid: 0,
			taxEarned: 0,
			lastEnergy: 0,
			lastFee: 0,
			lastReward: 0,
			lastFuel: 0,
			fuelBoughtKg: 0,
			fuelProducedKg: 0,
			fuelSpent: 0,
			lastResearch: 0,
			forceScale: 1,
			ended: CAREER_OPEN,
			recoverySteps: -1,
			recoveryEpisode: 0,
			market: null,
			arrested: false,
			arrestUntilStep: 0,
			evacuating: false,
			evacUntilStep: 0,
			evacStartStep: 0,
			evacFromX: 0,
			evacFromY: 0,
			evacToX: 0,
			evacToY: 0,
			evacDurationSteps: 0,
			evacLastPaid: 0,
			evacLastSteps: 0,
			evacFrom: -1,
			arrests: 0,
			bribes: 0,
			bribeIncome: 0,
			patientsDelivered: 0,
	medicTrips: 0,
	/* where the run's money came from and where it went:
	 * visitIncome + earned + bribeIncome + taxEarned is what flying brought in;
	 * feesPaid + fuelSpent + evacuations + stakeSpent is what flying cost;
	 * buildSpent and sciSpent are where profit was put.
	 * purse = starter purse + profit − property − science */
		visitIncome: 0,
		flownPx: 0,
		feesPaid: 0,
		buildSpent: 0,
		sciSpent: 0,
		giftCredit: 0,
		giftCash: 0,
		giftDrawn: []
		};
	}

	/* pad sunlight: orbit light above a floor so no world is dead, star brightness a mild modifier */
	function fillLight(career, world) {
		const lumNorm = OrbitWorld.clamp01(Math.sqrt(world.lum) / 1.5);
		const star = 0.5 + 0.5 * lumNorm;
		const mask = career.planetMask;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) {
				career.light[i] = 0;
				continue;
			}
			career.light[i] = (CAREER.lightFloor + (1 - CAREER.lightFloor) * world.planetLight[i]) * star;
		}
	}

	/* ── map statistics ── careerStats, mapStats, thinning, sampling */

	/* the career's money, where it came from and where it went:
	 * income − running = profit; property and science are where profit went.
	 * purse = starter purse + gift + profit − property − science.
	 * fills the caller-owned row without allocating */
	function careerStats(out, career) {
		out.gift = career.giftCredit;
		out.income = career.visitIncome + career.earned + career.bribeIncome + career.taxEarned;
		out.running = career.feesPaid + career.fuelSpent + career.maintenanceSpent +
			career.evacuationSpent + career.stakeSpent;
		out.profit = out.income - out.running;
		out.property = career.buildSpent;
		out.science = career.sciSpent;
		out.flown = career.flownPx;
	}

	/* map-wide numbers: rot is the corruption visits clear, standing the
	 * visit value lying unharvested on the in-play planets this step */
	function mapStats(out, market, step) {
		var rot = 0;
		var standing = 0;
		for (var p = 0; p < OrbitWorld.PLANETS; p++) {
			if (market.planetMask && market.planetMask[p] !== 1) continue;
			rot += market.corruption[p];
			var pay = planetProfit(market, p, step);
			if (pay > 0) standing += pay;
		}
		out.rot = rot;
		out.standing = standing;
	}

	/* thin a stats block in place when it fills: keep every second sample,
	 * halve the count and double the interval, so the whole run stays on
	 * the plot at one sample per STATS_SEC … 16 s */
	function thinStats(stats) {
		var n = stats.series.length;
		for (var s = 0; s < n; s++) {
			var arr = stats.series[s];
			var w = 0;
			for (var r = 0; r < stats.count; r += 2) arr[w++] = arr[r];
		}
		stats.count = stats.count / 2;
		stats.every *= 2;
	}

	/* sampler scratch: the getters fill a caller-owned row, so one sample
	 * step costs no allocation even with the full 17-company roster */
	const sampleMapOut = { rot: 0, standing: 0 };
	const sampleCareerOut = { gift: 0, income: 0, running: 0, profit: 0, property: 0, science: 0, flown: 0 };

	/* write one stats sample at `step`: rot/standing for the map and
	 * profit/property/science/flown for every company in the galaxy.
	 * returns at once on any step that is not a sample step */
	function sampleStats(galaxy, market, step) {
		if (!galaxy) return;
		var stats = galaxy.stats;
		if (!stats) return;
		if (step < stats.nextStep) return;
		if (stats.count >= STATS_SAMPLES) thinStats(stats);
		var count = stats.count;
		mapStats(sampleMapOut, market, step);
		stats.series[0][count] = sampleMapOut.rot;
		stats.series[1][count] = sampleMapOut.standing;
		for (var i = 0; i < galaxy.actors.length; i++) {
			careerStats(sampleCareerOut, galaxy.actors[i]);
			var base = 2 + i * 4;
			stats.series[base][count] = sampleCareerOut.profit;
			stats.series[base + 1][count] = sampleCareerOut.property;
			stats.series[base + 2][count] = sampleCareerOut.science;
			stats.series[base + 3][count] = sampleCareerOut.flown;
		}
		stats.count = count + 1;
		stats.nextStep = step + stats.every;
	}

	/* ── reset & endgame cheat ── resetCareer, fitEndgame */

	function resetCareer(career, seed, trade, cheat, homePlanet, sim) {
		const grant = OrbitTech.starterGrant();
		career.seed = seed >>> 0;
		career.cheat = cheat || null;
		resetLedger(career.ledger, cheat === CHEAT_ENDGAME ? CAREER.endgamePurse : grant.purse);
		career.ledger.fee = 0;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			pad.catapult = null;
			pad.panel = null;
			pad.battery = null;
			pad.chargeKwh = 0;
			pad.reservedKwh = 0;
		}
		career.padCount = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) career.launchPads[i] = COMMERCIAL_PAD;
		fillLight(career, trade.world);
		career.hq = homePlanet === undefined ? pickHq(career.seed, trade.world, hqMask(career),
			career.planetMask, career.planetCount, trade, sim) : homePlanet;
		career.at = career.hq;
		returnLandingVisits.delete(career);
		career.flying = false;
		career.stranded = false;
		career.fragileLost = false;
		/* a restart is a new company: no radar, and no stale reveal memo */
		career.radar = false;
		career.radarStamp.steps = -1;
		career.radarStamp.t0 = -1;
		career.commercialPlanet = -1;
		career.commercialPads = null;
		career.capitalPlanet = specialPlanetsOn() ? trade.world.capitalPlanet : -1;
		career.arfPlanet = specialPlanetsOn() ? trade.world.arfPlanet : -1;
		resetLaunchBook(career.launchBook);
		career.ship.hold = grant.ship.hold;
		career.ship.engine = grant.ship.engine;
		career.ship.tank = grant.ship.tank;
		career.ship.obs = grant.ship.obs;
		career.ship.cargoTons = 0;
		career.ship.colonyKit = false;
		career.ship.fuelKg = career.cheat === CHEAT_ENDGAME ? career.ship.tank.fuelCap : 0;
		career.ship.condition = 1;
		career.wearScale = 1;
		career.repairs = 0;
		career.maintenanceSpent = 0;
		career.owned = {};
		career.prototypes = newPrototypes();
		seedScience(career);
		career.research = 0;
		career.lastResearch = 0;
		/* the starter fit is owned from the start, so every refit is reversible */
		ownPart(career, career.ship.hold);
		ownPart(career, career.ship.tank);
		ownPart(career, OrbitTech.OBS[0]);
		ownPart(career, career.ship.obs);
		if (career.hq >= 0) {
			fitPad(career, career.hq, grant.pad.catapult, grant.pad.panel, grant.pad.battery);
		}
		if (career.cheat === CHEAT_ENDGAME) fitEndgame(career);
		refitShip(career);
		for (let i = 0; i < BOARD_SIZE; i++) clearTask(career.tasks[i]);
		career.contract = -1;
		/* Optional planner state in full saves (absent means no cooldown/intent). */
		career.acceptAfterStep = 0;
		career.plannedLanding = -1;
		career.serial = 0;
		career.flights = 0;
		career.burns = 0;
		career.evacuations = 0;
		career.evacuationSpent = 0;
		career.delivered = 0;
		career.competitions = 0;
		career.stakeSpent = 0;
		career.flightStartStep = 0;
		career.sport = createSportRecord();
		career.earned = 0;
		career.taxPaid = 0;
		career.taxEarned = 0;
		career.lastEnergy = 0;
		career.lastFee = 0;
		career.lastReward = 0;
		career.lastFuel = 0;
		career.fuelBoughtKg = 0;
		career.fuelProducedKg = 0;
		career.fuelSpent = 0;
		career.forceScale = 1;
		career.ended = CAREER_OPEN;
		career.recoverySteps = -1;
		career.arrested = false;
		career.arrestUntilStep = 0;
		career.evacuating = false;
		career.evacUntilStep = 0;
		career.evacStartStep = 0;
		career.evacFromX = career.evacFromY = 0;
		career.evacToX = career.evacToY = 0;
		career.evacDurationSteps = 0;
		career.evacLastPaid = 0;
		career.evacLastSteps = 0;
		career.evacFrom = -1;
		career.arrests = 0;
		career.bribes = 0;
		career.bribeIncome = 0;
		career.patientsDelivered = 0;
		career.medicTrips = 0;
		career.visitIncome = 0;
		career.flownPx = 0;
		career.feesPaid = 0;
		career.buildSpent = 0;
		career.sciSpent = 0;
		career.giftCredit = 0;
		career.giftCash = 0;
		career.giftDrawn = [];
		refreshBoard(career, trade, 0);
	}

	function topTier(table) {
		return table[table.length - 1];
	}

	/* endgame cheat: every pad at top tier, every ship part owned and the ship fully fitted */
	function fitEndgame(career) {
		for (let i = 0; i < career.pads.length; i++) {
			if (career.planetMask && career.planetMask[i] === 0) continue;
			if (i === career.capitalPlanet) continue;
			if (rebelRail(career, i)) continue;
			fitPad(career, i, topTier(OrbitTech.CATAPULTS), topTier(OrbitTech.PANELS),
				topTier(OrbitTech.BATTERIES));
		}
		for (let k = 0; k < OrbitTech.PART_KINDS.length; k++) {
			const table = OrbitTech.TABLES[OrbitTech.PART_KINDS[k]];
			for (let i = 0; i < table.length; i++) ownPart(career, table[i]);
		}
		career.ship.hold = topTier(OrbitTech.HOLDS);
		career.ship.engine = topTier(OrbitTech.ENGINES);
		career.ship.tank = topTier(OrbitTech.TANKS);
	}

	/* ── placement & starts ── evacuation clear, placeShip, space spawns, startCareer */

	function clearEvacuation(career, sim) {
		career.evacuating = false;
		career.evacUntilStep = 0;
		career.evacDurationSteps = 0;
		career.evacStartStep = 0;
		career.evacFromX = career.evacFromY = career.evacToX = career.evacToY = 0;
		career.evacFrom = -1;
		if (sim && sim.evacuationTrip === career) sim.evacuationTrip = null;
	}

	/* places the idle vessel on a planet and syncs the sim's landed base */
	function placeShip(career, sim, planet) {
		clearEvacuation(career, sim);
		returnLandingVisits.delete(career);
		career.at = planet;
		career.plannedLanding = -1;
		career.flying = false;
		setCommercial(career, -1);
		if (planet < 0) {
			career.stranded = true;
			sim.relocate(GravitySim.NO_BODY);
			return;
		}
		career.stranded = career.pads[planet].catapult === null &&
			planet !== career.capitalPlanet;
		sim.relocate(planet);
	}

	/* Deterministic spawn near the world centre for a space start: all companies
	 * share one central cluster with a small per-company offset, pushed clear of
	 * any active planet disc so no ship collides on frame zero. */
	function spaceSpawnClear(world, mask, x, y, padPx) {
		if (!world || !world.planetX) return true;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (mask && mask[p] === 0) continue;
			const dx = x - world.planetX[p];
			const dy = y - world.planetY[p];
			const r = (world.planetR[p] || 10) + padPx;
			if (dx * dx + dy * dy < r * r) return false;
		}
		return true;
	}

	function spaceSpawnAt(world, mask, seed, index) {
		let cx = OrbitWorld.WORLD_W * 0.5;
		let cy = OrbitWorld.WORLD_H * 0.5;
		const baseTurn = (OrbitWorld.hashBits(seed >>> 0, 0, SALT_HQ) & 0xffff) / 65536 * Math.PI * 2;
		for (let k = 0; k < 24 && !spaceSpawnClear(world, mask, cx, cy, 42); k++) {
			const ang = baseTurn + (k + 1) * 2.399963229728653;
			const rad = 28 + k * 14;
			cx = OrbitWorld.WORLD_W * 0.5 + Math.cos(ang) * rad;
			cy = OrbitWorld.WORLD_H * 0.5 + Math.sin(ang) * rad;
		}
		const idx = Math.max(0, Math.floor(index || 0));
		const ang = baseTurn + idx * 2.399963229728653;
		const rad = SPACE_START_OFFSET_PX + (idx % 3) * 6;
		let x = cx + Math.cos(ang) * rad;
		let y = cy + Math.sin(ang) * rad;
		for (let k = 0; k < 16 && !spaceSpawnClear(world, mask, x, y, 22); k++) {
			const nudge = rad + (k + 1) * 12;
			x = cx + Math.cos(ang + k * 0.35) * nudge;
			y = cy + Math.sin(ang + k * 0.35) * nudge;
		}
		return { x: x, y: y };
	}

	function openSpaceStartFlight(career, sim, pos) {
		clearEvacuation(career, sim);
		returnLandingVisits.delete(career);
		setCommercial(career, -1);
		career.at = -1;
		career.plannedLanding = -1;
		career.flying = true;
		career.stranded = false;
		sim.relocate(GravitySim.NO_BODY);
		sim.cargo.x = pos.x;
		sim.cargo.y = pos.y;
		sim.cargo.vx = 0;
		sim.cargo.vy = 0;
		sim.status = GravitySim.STATUS_FLYING;
		sim.origin = GravitySim.NO_BODY;
		sim.angle = 0;
		sim.speed = 0;
		sim.flightTime = 0;
		sim.flightLength = 0;
		sim.flightFieldT = sim.fieldT;
		sim.liveSteps = 0;
		sim.acc = 0;
		sim.stepLimit = RULES.career.capSteps;
		sim.limitReason = GravitySim.END_TIME;
		sim.endReason = GravitySim.END_OPEN;
		sim.endBody = GravitySim.NO_BODY;
		sim.visited.fill(0);
		sim.visitedCount = 0;
		sim.visitStep = 0;
		sim.trailCount = 0;
		sim.trailStride = 2;
		sim.addVisits(sim.markSystemsAt(pos.x, pos.y, sim.visited));
		sim.recordTrail();
		openFlight(career.ledger, sim, 0);
	}

	/* a career begins with the vessel on HQ and the sim gating on the network;
	 * every career in one run joins the same galaxy, so pads are shared ground */
	/* `isBot` picks the company's start-gift budget (bot or human) */
	function startCareer(career, sim, seed, trade, cheat, galaxy, homePlanet, startMode, isBot) {
		const mode = startMode === START_SPACE || startMode === START_CAPITAL
			? startMode : START_PLANET;
		career.galaxy = galaxy || null;
		career.market = galaxy && galaxy.market ? galaxy.market : null;
		let plannedHome = mode === START_PLANET ? homePlanet : -1;
		if (plannedHome === undefined && galaxy && galaxy.mapSeats &&
			galaxy.actors.length < galaxy.mapSeats.length) {
			plannedHome = galaxy.mapSeats[galaxy.actors.length];
		}
		resetCareer(career, seed, trade, cheat, plannedHome, sim);
		if (career.cheat !== CHEAT_ENDGAME) grantStartGifts(career, giftBudget(isBot === true));
		career.forceScale = sim.forceScale;
		if (galaxy) joinGalaxy(career, galaxy);
		else syncCareerNetwork(career);
		sim.attachCareer(career);
		/* the reveal predicts each company through its own sim (never saved) */
		career.sim = sim;
		if (mode === START_SPACE) {
			if (career.cheat !== CHEAT_ENDGAME) {
				career.ledger.purse += SPACE_START_BONUS;
				career.ship.engine = OrbitTech.ENGINES[0];
				career.ship.tank = OrbitTech.TANKS[1];
				ownPart(career, career.ship.engine);
				ownPart(career, career.ship.tank);
				career.ship.fuelKg = SPACE_START_FUEL_KG;
				refitShip(career);
			}
			const spawnSeed = galaxy && Number.isFinite(galaxy.seed) ? galaxy.seed : seed;
			const spawnIndex = galaxy ? career.index : 0;
			openSpaceStartFlight(career, sim,
				spaceSpawnAt(trade.world, career.planetMask, spawnSeed, spawnIndex));
			return;
		}
		if (mode === START_CAPITAL) {
			if (career.cheat !== CHEAT_ENDGAME) {
				career.ledger.purse += CAPITAL_START_BONUS;
			}
			const cap = career.capitalPlanet >= 0 ? career.capitalPlanet
				: (trade.world && trade.world.capitalPlanet >= 0 ? trade.world.capitalPlanet : 0);
			placeShip(career, sim, cap);
			refreshBoard(career, trade, 0);
			return;
		}
		placeShip(career, sim, career.hq);
	}

	/* ── end ── covered planets, checkEnded, liquidateCareer */

	/* the Capital's fixed imperial rail counts as covered, so "a catapult on
	 * every active planet" stays winnable even though nobody can build there */
	function capitalCovered(career) {
		return career.capitalPlanet >= 0 && planetInPlay(career, career.capitalPlanet) ? 1 : 0;
	}

	/* a seized planet is covered by the rebel rail for good: nobody may build
	 * there, so the completion count must not ask for a catapult on it */
	function coveredPlanets(career) {
		let covered = capitalCovered(career);
		const market = career.market;
		if (!market) return covered;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (market.seized[p] && planetInPlay(career, p)) covered += 1;
		}
		return covered;
	}

	const ENDGAME_WARNING_STEPS = Math.round(120 / GravitySim.DT);

	function checkEnded(career) {
		if (career.ended !== CAREER_OPEN) return career.ended;
		if (career.evacuating || career.flying) {
			career.recoverySteps = -1;
			return CAREER_OPEN;
		}
		const purse = career.ledger.purse;
		if (purse < -1e-9 || (!careerShipUsable(career) && purse + 1e-9 < repairCost(career))) {
			if (career.recoverySteps < 0) {
				career.recoverySteps = 0;
				career.recoveryEpisode++;
			}
			return CAREER_OPEN;
		}
		career.recoverySteps = -1;
		if (career.cheat === null && career.padCount >= career.planetCount - coveredPlanets(career)) {
			career.ended = CAREER_COMPLETE;
		}
		return career.ended;
	}

	function liquidateCareer(career) {
		career.ended = CAREER_BROKE;
		const pads = career.galaxy ? career.galaxy.commercialPads :
			(career.commercialPads = Array(OrbitWorld.PLANETS).fill(null));
		for (let p = 0; p < career.pads.length; p++) {
			const pad = career.pads[p];
			if (!pad.catapult) continue;
			const rail = pads[p];
			if (!rail || pad.catapult.tier > rail.catapult.tier ||
				(pad.catapult.tier === rail.catapult.tier && pad.battery.capacity > rail.battery.capacity)) {
				pads[p] = { catapult: pad.catapult, panel: pad.panel, battery: pad.battery,
					chargeKwh: pad.battery.capacity, reservedKwh: 0, commercial: true };
			}
			clearPad(career, p);
		}
		syncCareerNetwork(career);
	}

	Object.assign(GravityGame, {
		coveredPlanets, careerStats, mapStats, sampleStats, START_PLANET, START_SPACE, START_CAPITAL,
		SPACE_START_FUEL_KG, SPACE_START_BONUS, CAPITAL_START_BONUS, spaceSpawnAt, CAREER_BROKE,
		CAREER_COMPLETE, createCareer, resetCareer, startCareer, checkEnded, placeShip,
		ENDGAME_WARNING_STEPS, capitalCovered, joinGalaxy
	});
	Object.assign(inner, {
		placeShip, checkEnded, liquidateCareer
	});
});
