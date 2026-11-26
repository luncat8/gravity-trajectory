/*
 * Contracts: standard, deep, fragile and tourist deliveries, medics and
 * Capital escrow, the task board, accept/drop/finish, payouts, landing facts.
 * not here: the sport race → game_sport.js; departure solvency → game_departure.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_contracts.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitEcon, OrbitTech, CAREER, COMPETE_SLOT,
		MEDIC_SLOT, BOARD_SIZE, TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_MEDIC, TASK_OFFERED,
		TASK_ACCEPTED, TASK_LOADED, LEG_NONE, LEG_LOAD, LEG_DELIVER, LEG_MEDICS, LEG_PATIENTS,
		LEG_CREDIT, CAREER_OPEN, SALT_TASK, CAPITAL_REFUND, specialPlanetsOn, clearTask, price,
		draw01, round2, careerShipUsable, refitShip, repairCost, planetInPlay, colonyInPlay,
		commercialPadAt, padAt, padOwner, commercialFee, fragileBreaks, sportStateOf, syncSportSlot,
		syncSportMirrors, announceSport, expireSport, emptyWorld, careerGravity
	} = inner;

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
	const CARGO_TONS = [4, 8, 16, 24];
	const COMPETE_ENTRY = 0.5;
	const LEG_COMPETE = 5;
	/* tourist-delivery bias: A.R.F. destinations and Capital resort origins and
	 * destinations each weigh 2x an ordinary endpoint (0.5.11) */
	const TOURIST_CHANCE = 0.35;

	/* --- contracts ----------------------------------------------------- */

	function planetDistance(trade, a, b) {
		const dx = trade.planetX[a] - trade.planetX[b];
		const dy = trade.planetY[a] - trade.planetY[b];
		return Math.sqrt(dx * dx + dy * dy);
	}

	/* a uniform in-play SETTLED planet other than `exclude` (the tourist's free
	 * endpoint): nobody visits an uninhabited world */
	function otherActivePlanet(career, exclude) {
		let span = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!planetInPlay(career, i) || i === exclude || emptyWorld(career, i)) continue;
			span += 1;
		}
		if (span < 1) return -1;
		let pick = Math.floor(draw01(career, SALT_TASK) * span);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!planetInPlay(career, i) || i === exclude || emptyWorld(career, i)) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	/*
	 * Tourist delivery (0.5.11): a TASK_DELIVERY of MIGRANTS flagged tourist.
	 * One deterministic draw picks the special endpoint role, each offered at
	 * TOURIST_WEIGHT (2x an ordinary endpoint): to the A.R.F. world, to the
	 * Capital resort, or from the Capital resort. The other endpoint is a
	 * uniform in-play planet. Reward stays positive and capped like freight.
	 */
	function makeTouristDelivery(career, trade, step, task) {
		const capital = career.capitalPlanet;
		const arf = career.arfPlanet;
		const role = Math.floor(draw01(career, SALT_TASK) * 3);
		let from;
		let to;
		if (role === 0) {
			to = arf;
			from = otherActivePlanet(career, arf);
		} else if (role === 1) {
			to = capital;
			from = otherActivePlanet(career, capital);
		} else {
			from = capital;
			to = otherActivePlanet(career, capital);
		}
		if (from < 0 || to < 0 || from === to) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		const dist = Math.min(planetDistance(trade, from, to), CAREER.deliveryDistPx);
		/* tourists are not market goods: a mid scarcity keeps the pay between
		 * the freight floor and ceiling */
		const pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * 1.5 *
			(1 + dist / CAREER.deliveryDistPx);
		/* the deep-origin bonus rides every delivery kind: the rule is the
		 * load and the well, not the good */
		task.deep = deepOrigin(career, from, tons);
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = true;
		task.tons = tons;
		task.from = from;
		task.to = to;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax) * (task.deep ? 1 + DEEP_BONUS : 1));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/* deep-origin delivery (0.6.2): a load of DEEP_TONS or more out of a well
	 * at DEEP_G or deeper — the job an EMC-3 is built for. The well is the
	 * career readout: a colony founded in an empty heavy world keeps its well. */
	function deepOrigin(career, planet, tons) {
		return tons >= DEEP_TONS && careerGravity(career, planet) >= DEEP_G;
	}

	/* the note on a deep-origin row, naming the rail that lifts it; one helper
	 * so the board, the aim line and the bot price and print the same offer */
	function deepText(task) {
		return task.deep ? 'needs EMC-3+ at P' + task.from : '';
	}

	/* delivery: a colony with a real export to the colony short of that good
	 * (else the lowest supply); pays by tons, scarcity and distance, capped
	 * below the evacuation fee */
	function makeDelivery(career, trade, step, task) {
		/* the tourist branch is gated off entirely for the SPECIAL=0 A/B, so the
		 * ordinary delivery stream is then bit-identical to the historical one */
		if (specialPlanetsOn() && career.capitalPlanet >= 0 &&
			draw01(career, SALT_TASK) < TOURIST_CHANCE &&
			makeTouristDelivery(career, trade, step, task)) return true;
		const colonies = trade.colonies;
		const count = colonies.length;
		if (count < 2) return false;
		const first = Math.floor(draw01(career, SALT_TASK) * count);
		let src = null;
		let good = -1;
		for (let k = 0; k < count && good < 0; k++) {
			const colony = colonies[(first + k) % count];
			if (!colonyInPlay(career, colony)) continue;
			src = colony;
			good = OrbitEcon.bestExport(colony);
		}
		if (good < 0 || !src) return false;
		let dst = null;
		let bestShort = 0;
		let lowSupply = 2;
		for (let k = 0; k < count; k++) {
			const colony = colonies[k];
			if (!colonyInPlay(career, colony)) continue;
			if (colony === src) continue;
			const short = OrbitEcon.goodShortfall(colony, good);
			const supply = OrbitEcon.marketSupply(colony, good);
			const better = bestShort > 0 ? short > bestShort : short > 0 || supply < lowSupply;
			if (!better) continue;
			dst = colony;
			bestShort = short;
			lowSupply = supply;
		}
		if (!dst) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		/* fragile load (0.6.3): only from a light planet, only a small load; the
		 * draw is spent only where the offer is possible, so every other board
		 * keeps its stream */
		const light = careerGravity(career, src.planet) <= FRAGILE_G;
		task.fragile = light && tons <= FRAGILE_TONS &&
			draw01(career, SALT_TASK) < FRAGILE_CHANCE;
		/* deep-origin (0.6.2): a heavy load out of a deep well is the one job
		 * an EMC-3 is built for; no draw — it is a property of the load roll
		 * and the origin's gravity */
		task.deep = deepOrigin(career, src.planet, tons);
		const scarcity = 1 - OrbitEcon.marketSupply(dst, good);
		const dist = Math.min(planetDistance(trade, src.planet, dst.planet), CAREER.deliveryDistPx);
		let pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * (1 + scarcity) *
			(1 + dist / CAREER.deliveryDistPx);
		if (task.fragile) pay *= FRAGILE_PAY;
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = good;
		task.tourist = false;
		task.tons = tons;
		task.from = src.planet;
		task.to = dst.planet;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax) * (task.deep ? 1 + DEEP_BONUS : 1));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/*
	 * The medical quest (0.5.12, repriced 0.5.23): a rebellious planet's
	 * patients have to reach the Capital. Half the hold rides out as medics,
	 * the same number rides back as patients, and the planet is quelled once
	 * its last patient lands. An offer stands on the board only while the
	 * landed company has a hold and can afford the mission's rail fees.
	 */
	function medicAffordable(career, planet, medics) {
		if (!career || career.ended !== CAREER_OPEN || career.capitalPlanet < 0 ||
			career.at < 0 || planet < 0 || medics < 1) return false;
		const loadedMass = OrbitTech.shipMass(career.ship, medics);
		const rebelPad = commercialPadAt(career, planet);
		if (!rebelPad || !rebelPad.catapult || !rebelPad.battery) return false;
		if (OrbitTech.speedLimit(rebelPad.battery.capacity, loadedMass,
			rebelPad.catapult, career.forceScale) + 1e-9 < GravitySim.SPEED_MIN) return false;
		const repairNeed = careerShipUsable(career) ? 0 : repairCost(career);
		const rebelFee = commercialFee(career, planet, GravitySim.SPEED_MIN, loadedMass);
		if (career.at === career.capitalPlanet) {
			return career.ledger.purse + CAPITAL_REFUND - repairNeed + 1e-9 >= rebelFee;
		}
		const emptyMass = OrbitTech.shipMass(career.ship, 0);
		const ownPad = career.pads[career.at];
		const ownLifts = ownPad && ownPad.catapult &&
			OrbitTech.speedLimit(ownPad.battery.capacity, emptyMass,
				ownPad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN;
		let depart = 0;
		if (!ownLifts) {
			const commRail = commercialPadAt(career, career.at);
			const commOk = commRail && OrbitTech.speedLimit(commRail.battery.capacity,
				emptyMass, commRail.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN;
			depart = commOk ? commercialFee(career, career.at, GravitySim.SPEED_MIN, emptyMass) : Infinity;
			const owner = padOwner(career, career.at, false);
			if (owner >= 0 && owner !== career.index) {
				const hostPad = padAt(career, career.at, false);
				if (hostPad && OrbitTech.speedLimit(hostPad.battery.capacity, emptyMass,
					hostPad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN) {
					const tax = price(career, CAREER.taxPerKwh *
						OrbitTech.launchEnergy(emptyMass, hostPad.catapult, GravitySim.SPEED_MIN) *
						hostPad.catapult.tier);
					if (tax < depart) depart = tax;
				}
			}
			if (!Number.isFinite(depart)) return false;
		}
		return career.ledger.purse - depart - repairNeed + 1e-9 >= Math.max(CAPITAL_REFUND, rebelFee);
	}

	function medicPlanet(career, market) {
		let best = -1;
		let most = 0;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (!market.rebel[p] || !market.patients[p]) continue;
			if (!planetInPlay(career, p)) continue;
			const medics = medicLoad(career, market.patients[p]);
			if (!medicAffordable(career, p, medics)) continue;
			if (market.patients[p] <= most) continue;
			best = p;
			most = market.patients[p];
		}
		return best;
	}

	function makeMedic(career, market, step, task) {
		if (career.arrested) return false;
		const planet = medicPlanet(career, market);
		if (planet < 0 || career.capitalPlanet < 0) return false;
		const medics = medicLoad(career, market.patients[planet]);
		if (medics < 1) return false;
		task.kind = TASK_MEDIC;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = false;
		task.tons = 0;
		task.from = career.capitalPlanet;
		task.to = planet;
		task.planet = planet;
		task.patients = market.patients[planet];
		task.medics = medics;
		task.aboard = 0;
		task.minLength = 0;
		task.reward = round2(task.patients * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		task.deep = false;
		task.capitalRefund = 0;
		/* two trips with the standard hold, one with a big one */
		task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
		return true;
	}

	/* PRNG-free refresh of MEDIC_SLOT while landed; never runs in flight */
	function refreshMedicSlot(career, market, step) {
		if (!career || career.flying || !market || !market.galaxy) return;
		const medic = career.tasks[MEDIC_SLOT];
		if (medic.kind === TASK_MEDIC) {
			if (career.contract === MEDIC_SLOT) {
				if (medic.aboard === 0 && !market.patients[medic.to]) dropContract(career);
				return;
			}
			const patients = market.rebel[medic.to] ? market.patients[medic.to] : 0;
			const medics = medicLoad(career, patients);
			if (!patients || !medicAffordable(career, medic.to, medics)) {
				clearTask(medic);
			} else {
				medic.patients = patients;
				medic.medics = medics;
				medic.reward = round2(patients * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
			}
		}
		if (medic.kind === TASK_NONE) makeMedic(career, market, step, medic);
	}

	function refreshCareerMedic(career) {
		if (career && !career.flying && career.market) {
			refreshMedicSlot(career, career.market, Math.max(0, career.market.politicsStep));
		}
	}

	/* half the hold rides as medics: no new ship stat, no full-hold dead end */
	function medicLoad(career, patients) {
		const free = career.ship.hold.capacity - (career.ship.colonyKit ? OrbitTech.COLONY_KIT.mass : 0);
		const half = Math.floor(free / 2);
		return Math.min(half, patients);
	}

	function loadMedics(career, task, patients) {
		task.medics = medicLoad(career, patients);
		task.aboard = 0;
		career.ship.cargoTons = task.medics;
		refitShip(career);
		return task.medics;
	}

	function grantCapitalRefund(career, task) {
		if (career.capitalPlanet < 0 || career.at !== career.capitalPlanet) return 0;
		task.capitalRefund = CAPITAL_REFUND;
		career.ledger.purse += CAPITAL_REFUND;
		career.earned += CAPITAL_REFUND;
		inner.checkEnded(career);
		return CAPITAL_REFUND;
	}

	function clawbackTaskRefund(career, task) {
		const refund = task.capitalRefund;
		if (!(refund > 0)) return 0;
		task.capitalRefund = 0;
		career.ledger.purse -= refund;
		career.earned -= refund;
		inner.checkEnded(career);
		return refund;
	}

	function finishContract(career) {
		if (career.contract < 0) return;
		const task = career.tasks[career.contract];
		task.capitalRefund = 0;
		clearTask(task);
		career.contract = -1;
		career.ship.cargoTons = 0;
		refitShip(career);
		refreshCareerMedic(career);
	}

	function dropTask(career, index) {
		if (index < 0 || index >= BOARD_SIZE) return false;
		const task = career.tasks[index];
		if (task.kind === TASK_NONE) return false;
		if (index === COMPETE_SLOT) {
			if (task.state !== TASK_ACCEPTED) return false;
			clawbackTaskRefund(career, task);
			/* the stake stays in the pool; the company may pay in again while
			 * the window is open, so the mirror keeps showing the shared offer */
			const sport = sportStateOf(career);
			sport.enteredMask &= ~(1 << career.index);
			task.state = TASK_OFFERED;
			syncSportSlot(career, sport);
			return true;
		}
		if (career.contract !== index) return false;
		clawbackTaskRefund(career, task);
		clearTask(task);
		career.contract = -1;
		career.ship.cargoTons = 0;
		refitShip(career);
		return true;
	}

	function dropContract(career) {
		if (career.contract < 0) return false;
		return dropTask(career, career.contract);
	}

	/* drops expired offers (and an expired contract with its cargo), refills the
	 * board; the shared sport event expires, announces and syncs here first —
	 * one galaxy-wide event, whoever's refresh sees it first */
	function refreshBoard(career, trade, step) {
		expireSport(career, step);
		announceSport(career, trade, step);
		syncSportMirrors(career);
		for (let i = 0; i < BOARD_SIZE; i++) {
			if (i === COMPETE_SLOT) continue; /* the shared event settles itself */
			const task = career.tasks[i];
			if (task.kind === TASK_NONE || step <= task.deadline) continue;
			if (i === career.contract) dropContract(career);
			else {
				clawbackTaskRefund(career, task);
				clearTask(task);
			}
		}
		for (let i = 0; i < CAREER.deliverySlots; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE) makeDelivery(career, trade, step, task);
		}
		refreshMedicSlot(career, career.market, step);
	}

	function canAccept(career, index) {
		if (!career || career.ended !== CAREER_OPEN || career.flying ||
			career.evacuating || career.arrested) return false;
		if (index < 0 || index >= BOARD_SIZE) return false;
		const task = career.tasks[index];
		if (task.state !== TASK_OFFERED) return false;
		if (task.kind === TASK_COMPETE) {
			if (career.at < 0) return false;
			const sport = sportStateOf(career);
			if (sport.kind !== TASK_COMPETE) return false;
			/* entry stays open to the deadline; the shared clock gates it when
			 * the career has one (headless boards settle on their next refresh) */
			const step = career.market ? Math.max(0, career.market.politicsStep) : 0;
			if (step >= sport.deadline) return false;
			const atCapital = career.capitalPlanet >= 0 && career.at === career.capitalPlanet;
			return career.ledger.purse + (atCapital ? CAPITAL_REFUND : 0) + 1e-9 >= COMPETE_ENTRY;
		}
		if (career.contract >= 0) return false;
		if (task.kind === TASK_MEDIC) {
			return career.capitalPlanet >= 0 && career.at === career.capitalPlanet &&
				task.medics > 0 && task.patients > 0 &&
				medicAffordable(career, task.to, task.medics);
		}
		return task.kind === TASK_DELIVERY && career.ship.hold.capacity - (career.ship.colonyKit ? OrbitTech.COLONY_KIT.mass : 0) >= task.tons;
	}

	/*
	 * Where the open work wants the ship next, nearest leg first: the taken
	 * contract's next stop (or the Capital to take a standing medical mission),
	 * then the competition planet. Bots route to the first entry, scans aim at
	 * all of them, and neither knows or cares which contract kind it is. One
	 * scratch list — read it before calling again.
	 */
	const goalBodies = [];
	function careerGoalBodies(career) {
		goalBodies.length = 0;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.kind === TASK_MEDIC) goalBodies.push(task.aboard > 0 ? career.capitalPlanet : task.to);
			else goalBodies.push(task.state === TASK_LOADED ? task.to : task.from);
		} else if (career.tasks[MEDIC_SLOT].kind === TASK_MEDIC && career.capitalPlanet >= 0) {
			goalBodies.push(career.capitalPlanet);
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_COMPETE) goalBodies.push(compete.planet);
		return goalBodies;
	}

	function loadCargo(career, task) {
		task.state = TASK_LOADED;
		career.ship.cargoTons = task.tons;
		refitShip(career);
	}

	/* one contract at a time; cargo loads at once when the ship already sits at
	 * the origin, and any work accepted at the Capital refunds its entry fee */
	function acceptTask(career, index) {
		if (!canAccept(career, index)) return false;
		const task = career.tasks[index];
		if (task.kind === TASK_COMPETE) {
			/* entering the shared race: the stake goes from the purse into the
			 * pool and every board's mirror shows the grown prize at once */
			const sport = sportStateOf(career);
			career.ledger.purse -= COMPETE_ENTRY;
			career.stakeSpent += COMPETE_ENTRY;
			sport.pool = round2(sport.pool + COMPETE_ENTRY);
			sport.enteredMask |= 1 << career.index;
			task.state = TASK_ACCEPTED;
			syncSportMirrors(career);
			grantCapitalRefund(career, task);
			refreshCareerMedic(career);
			return true;
		}
		career.contract = index;
		if (task.kind === TASK_MEDIC) {
			/* taken at the Capital, so the medics board at once with a full window */
			const nowStep = career.market ? Math.max(0, career.market.politicsStep) : 0;
			const span = Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
			if (nowStep + span > task.deadline) task.deadline = nowStep + span;
			task.state = TASK_LOADED;
			loadMedics(career, task, task.patients);
			grantCapitalRefund(career, task);
			return true;
		}
		task.state = TASK_ACCEPTED;
		if (career.at === task.from) loadCargo(career, task);
		grantCapitalRefund(career, task);
		refreshCareerMedic(career);
		return true;
	}

	/*
	 * One factor table for a landing: `cash` is what the purse takes at once,
	 * `credit` what a leg that only advances a contract is worth, `leg` which
	 * leg it is. The aim readout, the launch list, the helper scans and the
	 * rival bots all price a shot through this, so the same landing can never
	 * be worth one thing to the aim line and another to the bot.
	 * `out` is caller scratch, so nothing is allocated per candidate.
	 * `speed` is the launch speed of a shot still on the pad (a fragile load
	 * is priced by it); a flight already under way passes none.
	 */
	function careerLandingFacts(out, career, origin, body, flownLen, length, steps, runStep, visitPay, speed) {
		out.cash = visitPay;
		out.credit = 0;
		out.leg = LEG_NONE;
		/* a contract that runs out before the landing pays nothing: the board
		 * drops it before the ship arrives */
		if (career.contract >= 0 && runStep + steps <= career.tasks[career.contract].deadline) {
			const task = career.tasks[career.contract];
			if (task.kind === TASK_MEDIC) {
				/* patients pay at the Capital, medics only have to reach the rebellion */
				if (task.aboard > 0 && body === career.capitalPlanet) {
					out.cash += task.aboard * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
					out.leg = LEG_PATIENTS;
				} else if (task.aboard === 0 && body === task.to) {
					out.credit += task.reward * LEG_CREDIT;
					out.leg = LEG_MEDICS;
				}
			} else if (task.state === TASK_LOADED && body === task.to) {
				/* a shot that breaks the fragile load delivers nothing: the aim
				 * line prices the void before the click */
				if (!fragileBreaks(task, speed)) {
					out.cash += task.reward;
					out.leg = LEG_DELIVER;
				}
			} else if (task.state === TASK_ACCEPTED && body === task.from) {
				out.credit += task.reward * LEG_CREDIT;
				out.leg = LEG_LOAD;
			}
		} else if (career.contract < 0 && origin !== career.capitalPlanet &&
			body === career.capitalPlanet) {
			const medic = career.tasks[MEDIC_SLOT];
			if (medic.kind === TASK_MEDIC && medic.medics > 0 &&
				runStep + steps <= medic.deadline &&
				medicAffordable(career, medic.to, medic.medics)) {
				const tripPay = medic.medics * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
				out.credit += (CAPITAL_REFUND + tripPay) * LEG_CREDIT;
				out.leg = LEG_MEDICS;
			}
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_COMPETE && origin === compete.planet &&
			(flownLen || 0) + length >= compete.minLength &&
			!(career.flying && career.flightStartStep < compete.startsAt)) {
			/* the barrel hold puts an on-pad launch at the gun; a flight
			 * already in space keeps its actual launch stamp */
			const launchStep = !career.flying && runStep < compete.startsAt
				? compete.startsAt : runStep;
			if (launchStep + steps <= compete.deadline) {
				if (compete.state === TASK_ACCEPTED) {
					out.cash += compete.reward;
					if (out.leg === LEG_NONE) out.leg = LEG_COMPETE;
				} else if (origin === career.capitalPlanet) {
					/* entering at the Capital before this shot nets the refund
					 * less the stake, and the win would pay the pool on top */
					out.credit += (CAPITAL_REFUND - COMPETE_ENTRY) * LEG_CREDIT;
				}
			}
		}
		return out;
	}

	Object.assign(GravityGame, {
		DEEP_G, DEEP_TONS, DEEP_BONUS, deepOrigin, deepText, TOURIST_CHANCE, FRAGILE_G, FRAGILE_TONS,
		FRAGILE_PAY, CARGO_TONS, COMPETE_ENTRY, LEG_COMPETE, careerLandingFacts, careerGoalBodies,
		refreshBoard, refreshMedicSlot, medicAffordable, medicPlanet, canAccept, acceptTask,
		dropTask, dropContract, medicLoad
	});
	Object.assign(inner, {
		refreshMedicSlot, refreshCareerMedic, medicLoad, loadMedics, clawbackTaskRefund,
		finishContract, dropContract, refreshBoard, canAccept, loadCargo, careerLandingFacts
	});
});
