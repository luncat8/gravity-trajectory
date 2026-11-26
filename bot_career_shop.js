/*
 * Career shopping between flights: contract and medic valuation and accept,
 * upgrades, pad gear, repair, holds, recovery and evacuation, bribes.
 * not here: fuel for a burn → bot_career_burn.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_shop.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitWorld, OrbitTech, OrbitEcon, CAREER_REACH_VALUE,
		CAREER_MEDIC_VALUE, CAREER_BRIBE_ROT, CAREER_BRIBE_PAY, CAREER_RIVAL_GAP,
		CAREER_PURSE_RESERVE, careerRefundEscrow, CAREER_MIN_SCORE, CAREER_SIT_TRIES, signed,
		careerTraceIndex, careerNextItem, careerPrice
	} = inner;

	/* pad gear is bought for what it earns, not only for the next departure: a
	 * rung has to pay its price back inside this much pad time on the pad it
	 * upgrades, measured against the money that pad's last launch made */
	const CAREER_PAD_HORIZON = 2400;
	/* Game steps, not shopping passes, before revisiting an unreachable board. */
	const CAREER_ACCEPT_HOLD = Math.round(30 / GravitySim.DT);
	/* how likely this rival is to take the rulers' money when it lands; the
	 * human decides for themselves, so the roll belongs to the bot's persona */
	const CAREER_BRIBE_PRONE = 0.5;
	/* pads after which the contract board is worth the 1.5 t hold */
	const CAREER_HOLD_PADS = 2;
	const CAREER_LOADED_SPEED = 75;
	/* a rival services its ship early, so it rarely flies down to 0 */
	const CAREER_REPAIR_AT = 0.7;

	/* ── contract valuation & accept ── net reward, delivery and medic value, accept, defer */

	/* A delivery starting here doesn't pay another fine for getting here;
	 * any quest accepted at the Capital also collects the immediate refund. */
	function careerNetReward(career, task) {
		const entries = Number(task.from === career.capitalPlanet && task.from !== career.at) +
			Number(task.to === career.capitalPlanet);
		const refund = career.capitalPlanet >= 0 && career.at === career.capitalPlanet
			? GravityGame.CAPITAL_REFUND : 0;
		return task.reward + refund + entries * GravityGame.CAPITAL_VISIT_PAY;
	}

	function minSpanSteps(sim, from, to, topSpeed) {
		if (!sim || from < 0 || to < 0 || from === to || !sim.planetX || !sim.planetY) return 0;
		const dx = sim.planetX[to] - sim.planetX[from];
		const dy = sim.planetY[to] - sim.planetY[from];
		const r = sim.planetR ? sim.planetR[from] + sim.planetR[to] : 0;
		const span = Math.max(0, Math.hypot(dx, dy) - r);
		return Math.max(2, Math.ceil(span / (topSpeed * GravitySim.DT)));
	}

	/* The pickup has to launch the loaded ship. Don't take a job whose
	 * reward cannot even pay that ticket, or whose delivery is a dead end. */
	GravityBot.prototype.careerDeliveryNet = function (career, task, hold, budget, sim, step = this.worldStep, slot = -1) {
		const min1 = career.at >= 0 && career.at !== task.from
			? minSpanSteps(sim, career.at, task.from, GravitySim.SPEED_MAX) : 0;
		const min2 = minSpanSteps(sim, task.from, task.to,
			task.fragile ? GravityGame.FRAGILE_SPEED : GravitySim.SPEED_MAX);
		if (Number.isFinite(task.deadline) && step + min1 + min2 > task.deadline) return -Infinity;
		const refund = career.capitalPlanet >= 0 && career.at === career.capitalPlanet
			? GravityGame.CAPITAL_REFUND : 0;
		if (slot >= 0 && hold === career.ship.hold && budget === career.ledger.purse &&
			career.contract < 0 && career.at >= 0 && career.at !== task.from) {
			const depart1 = this.careerDeparture(career, career.at, budget + refund,
				career.ship.mass, sim);
			if (!depart1.ok) return -Infinity;
			const inp = this.careerLegInput;
			inp.origin = career.at;
			inp.body = task.from;
			inp.speed = 0;
			inp.flownLen = 0;
			inp.length = 0;
			inp.steps = min1;
			inp.visitPay = task.from === career.capitalPlanet ? GravityGame.CAPITAL_VISIT_PAY : 0;
			inp.bribe = 0;
			inp.condition = career.ship.condition;
			inp.burnDv = 0;
			inp.fee = depart1.cost;
			inp.logPlanet = null;
			inp.logStep = null;
			inp.logDwell = null;
			inp.logCount = 0;
			this.careerLegOpts.slot = slot;
			this.careerLegOpts.seekClaim = false;
			this.careerLegOpts.exitSpeedFn = this.careerExitFn;
			GravityGame.careerLegPlan(this.careerLeg, career, career.market, this.exitProbe,
				inp, step, this.careerLegOpts);
			inp.condition = undefined;
			if (!this.careerLeg.feasible) return -Infinity;
			if (this.careerLeg.hasSecond) {
				return this.careerLeg.total > 0 ? this.careerLeg.total : -Infinity;
			}
			const relayNet = careerNetReward(career, task) - depart1.cost - this.careerLeg.leg1Exit;
			return relayNet > 0 ? relayNet : -Infinity;
		}
		const purse = budget + refund;
		const dry = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, hold, 0);
		const loaded = this.careerDeparture(career, task.from, purse, dry + task.tons, sim);
		const net = careerNetReward(career, task) - loaded.cost;
		if (!loaded.ok || net <= 0) return -Infinity;
		if (task.fragile && loaded.speed > GravityGame.FRAGILE_SPEED &&
			!this.careerExitSpeed(task.from, GravityGame.FRAGILE_SPEED)) return -Infinity;
		return this.careerDeparture(career, task.to, budget + net, dry, sim).ok ? net : -Infinity;
	};

	GravityBot.prototype.careerMedicNet = function (career, planet, patients, hold, budget, sim, step = this.worldStep, slot = -1) {
		const medics = Math.min(Math.floor(hold.capacity / 2), patients);
		if (medics < 1 || career.capitalPlanet < 0) return -Infinity;
		const purse = budget + GravityGame.CAPITAL_REFUND;
		const loadedMass = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, hold, medics);
		const out = this.careerDeparture(career, career.capitalPlanet, purse, loadedMass, sim);
		if (!out.ok) return -Infinity;
		const outCost = out.cost;
		if (slot === GravityGame.MEDIC_SLOT && career.at === career.capitalPlanet &&
			hold === career.ship.hold && budget === career.ledger.purse && career.contract < 0) {
			const min1 = minSpanSteps(sim, career.capitalPlanet, planet, GravitySim.SPEED_MAX);
			const inp = this.careerLegInput;
			inp.origin = career.capitalPlanet;
			inp.body = planet;
			inp.speed = 0;
			inp.flownLen = 0;
			inp.length = 0;
			inp.steps = min1;
			inp.visitPay = 0;
			inp.bribe = 0;
			inp.condition = career.ship.condition;
			inp.burnDv = 0;
			inp.fee = outCost;
			inp.logPlanet = null;
			inp.logStep = null;
			inp.logDwell = null;
			inp.logCount = 0;
			this.careerLegOpts.slot = slot;
			this.careerLegOpts.seekClaim = false;
			this.careerLegOpts.exitSpeedFn = this.careerExitFn;
			GravityGame.careerLegPlan(this.careerLeg, career, career.market, this.exitProbe,
				inp, step, this.careerLegOpts);
			inp.condition = undefined;
			if (!this.careerLeg.feasible) return -Infinity;
			if (this.careerLeg.hasSecond) {
				return this.careerLeg.total > 0 ? this.careerLeg.total : -Infinity;
			}
		}
		const back = this.careerDeparture(career, planet, purse - outCost, loadedMass, sim);
		if (!back.ok) return -Infinity;
		const backCost = back.cost;
		const tripPay = medics * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
		const net = tripPay + GravityGame.CAPITAL_REFUND + GravityGame.CAPITAL_VISIT_PAY -
			outCost - backCost;
		return net > 0 ? net : -Infinity;
	};

	GravityBot.prototype.careerAccept = function (career, step = this.worldStep, sim = this.probe) {
		if (career.contract >= 0 || step < career.acceptAfterStep) return false;
		if (career.ship.colonyKit && GravityGame.emptyInPlay(career) > 0) return false;
		let best = -1;
		let bestScore = -Infinity;
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			if (i === GravityGame.COMPETE_SLOT || !GravityGame.canAccept(career, i)) continue;
			const task = career.tasks[i];
			const net = task.kind === GravityGame.TASK_DELIVERY
				? this.careerDeliveryNet(career, task, career.ship.hold, career.ledger.purse, sim, step, i)
				: task.kind === GravityGame.TASK_MEDIC
				? this.careerMedicNet(career, task.to, task.patients, career.ship.hold, career.ledger.purse, sim, step, i)
				: task.reward;
			if (!Number.isFinite(net)) continue;
			const loadTons = task.kind === GravityGame.TASK_MEDIC ? task.medics : task.tons;
			let score = net - loadTons * 0.02;
			if (task.kind === GravityGame.TASK_MEDIC) score += CAREER_MEDIC_VALUE;
			if (task.from === career.at) score += 0.75;
			if (career.pads[task.from].catapult !== null) score += 0.25;
			if (career.pads[task.to].catapult !== null) score += 0.5;
			if (score > bestScore) {
				bestScore = score;
				best = i;
			}
		}
		/* A medical offer can only be signed at the Capital: keep the contract
		 * slot free when flying to the Capital for it beats the local board. */
		const medic = career.tasks[GravityGame.MEDIC_SLOT];
		if (career.at >= 0 && career.at !== career.capitalPlanet &&
			medic.kind === GravityGame.TASK_MEDIC && medic.medics > 0) {
			const depart = this.careerDeparture(career, career.at, career.ledger.purse,
				career.ship.mass, sim);
			const departOk = depart.ok;
			const departCost = depart.cost;
			const afterDepart = career.ledger.purse - departCost;
			if (departOk && afterDepart + 1e-9 >= GravityGame.CAPITAL_REFUND) {
				const medicNet = this.careerMedicNet(career, medic.to, medic.patients,
					career.ship.hold, afterDepart, sim) - departCost;
				if (Number.isFinite(medicNet)) {
					const medicScore = medicNet - medic.medics * 0.02 + CAREER_MEDIC_VALUE - 1.5;
					if (medicScore > bestScore) return false;
				}
			}
		}
		if (best < 0 || !GravityGame.acceptTask(career, best)) return false;
		const task = career.tasks[best];
		this.traceAdd(careerTraceIndex(career), 'contract', 'P' + task.from + '→P' + task.to +
			' · reward ' + task.reward.toFixed(2) + ' · best board score ' + signed(bestScore), step);
		return true;
	};

	GravityBot.prototype.careerDeferContract = function (career, step, why) {
		GravityGame.dropContract(career);
		career.acceptAfterStep = step + CAREER_ACCEPT_HOLD;
		this.traceAdd(careerTraceIndex(career), 'drop contract', why, step);
	};

	/* ── upgrades & pad gear ── careerUpgrade, refill wait, pad records, careerPadGear, gear offers */

	/* Raise the pad's full-battery cap, not its accidentally low current charge. */
	GravityBot.prototype.careerUpgrade = function (career, sim, wantedSpeed, reserve, step = this.worldStep) {
		const planet = career.at;
		if (planet < 0) return false;
		const pad = career.pads[planet];
		if (pad.catapult === null) return false;
		let upgraded = false;
		for (let n = 0; n < 8; n++) {
			const fullLimit = OrbitTech.speedLimit(pad.battery.capacity,
				career.ship.mass, pad.catapult, sim.forceScale);
			if (fullLimit >= wantedSpeed) break;
			const forceLimit = OrbitTech.maxSpeed(career.ship.mass, pad.catapult, sim.forceScale);
			let kind = forceLimit < wantedSpeed ? OrbitTech.KIND_CATAPULT : OrbitTech.KIND_BATTERY;
			let table = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.CATAPULTS : OrbitTech.BATTERIES;
			let item = careerNextItem(career, kind, table, pad[kind]);
			if (!item) {
				kind = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.KIND_BATTERY : OrbitTech.KIND_CATAPULT;
				table = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.CATAPULTS : OrbitTech.BATTERIES;
				item = careerNextItem(career, kind, table, pad[kind]);
			}
			const needed = fullLimit < GravitySim.SPEED_MIN;
			if (!this.careerBuyGear(career, planet, kind, item, needed ? 0 : reserve, step,
				needed ? 'restore minimum lift' : 'lift loaded contract')) break;
			upgraded = true;
		}
		return upgraded;
	};

	/* pad seconds a pad's panel needs to replace the energy a shot spent */
	GravityBot.prototype.careerRefillWait = function (career, planet, panel, energy) {
		const power = panel.power * career.light[planet] / 3600;
		return energy > 0 && power > 0 ? energy / power : 0;
	};

	/* the pad's last launch, re-priced by the launch book: money, flight time
	 * and the speed that bought it */
	GravityBot.prototype.careerPadRecord = function (career) {
		const book = career.launchBook;
		const tag = this.careerBookTag();
		if (!GravityGame.bookReady(book, tag)) return null;
		let best = null;
		for (let i = 0; i < book.entries.length; i++) {
			const entry = book.entries[i];
			if (entry.origin !== career.at) continue;
			if (!best || entry.score > best.score) best = entry;
		}
		return best && best.money > 0 ? best : null;
	};

	/*
	 * Pad gear sized by money per pad second. A panel shortens the recharge
	 * half of the launch cycle, a battery lifts the pad's speed ceiling (it
	 * keeps the charge the pad holds, so only its capacity is bought), an EMC
	 * adds reach — and an EMC is only worth its price together with the battery
	 * that can fill it. Each rung is priced against the last launch from this
	 * pad, so gear that cannot pay itself back inside CAREER_PAD_HORIZON stays
	 * in the shop.
	 */
	GravityBot.prototype.careerPadGear = function (career, runStep) {
		const planet = career.at;
		if (career.ended !== GravityGame.CAREER_OPEN || planet < 0) return false;
		const pad = career.pads[planet];
		if (pad.catapult === null) return false;
		if (GravityGame.padOwner(career, planet) !== career.index) return false;
		const record = this.careerPadRecord(career);
		if (!record) return false;
		const mass = career.ship.mass;
		const scale = career.forceScale;
		const free = pad.chargeKwh - pad.reservedKwh;
		/* the launch cycle is priced on the pad clock: the flight's pad
		 * seconds plus the pad seconds the panel needs to replace the shot */
		const flownSec = GravityGame.careerPadSeconds(GravitySim.gameSeconds(record.steps));
		const speed = GravityGame.speedOf(record.speedU);
		const energy = OrbitTech.launchEnergy(mass, pad.catapult, speed);
		const missed = energy > free ? energy - free : 0;
		const cycle = flownSec + this.careerRefillWait(career, planet, pad.panel, missed);
		if (!(cycle > 0)) return false;
		const money = record.money;
		const yieldNow = money / cycle;
		const capNow = OrbitTech.speedLimit(pad.battery.capacity, mass, pad.catapult, scale);
		const reachNow = this.careerReach(planet, capNow);
		const best = this.careerGear;
		best.value = 0;
		best.rate = 0;
		best.cost = 0;
		best.kind = '';
		best.item = null;
		best.mate = null;
		best.label = '';

		const panel = careerNextItem(career, OrbitTech.KIND_PANEL, OrbitTech.PANELS, pad.panel);
		if (panel && GravityGame.gearKnown(career, panel)) {
			const refill = this.careerRefillWait(career, planet, panel, missed);
			this.careerGearOffer(career, money / (flownSec + refill) - yieldNow,
				careerPrice(career, panel), OrbitTech.KIND_PANEL, panel, null, panel.id);
		}

		/* a battery keeps the charge the pad holds: the cycle buys reach and the
		 * energy headroom of a bigger tank, never a free fill */
		const battery = careerNextItem(career, OrbitTech.KIND_BATTERY, OrbitTech.BATTERIES,
			pad.battery);
		if (battery && GravityGame.gearKnown(career, battery)) {
			const cap = OrbitTech.speedLimit(battery.capacity, mass, pad.catapult, scale);
			const reach = this.careerReach(planet, cap);
			this.careerGearOffer(career, Math.max(0, reach - reachNow) * CAREER_REACH_VALUE / cycle,
				careerPrice(career, battery), OrbitTech.KIND_BATTERY, battery, null, battery.id);
		}

		const catapult = careerNextItem(career, OrbitTech.KIND_CATAPULT, OrbitTech.CATAPULTS,
			pad.catapult);
		if (catapult && GravityGame.gearKnown(career, catapult)) {
			/* the rail is only as fast as the battery behind it: price the pair */
			const forceCap = OrbitTech.maxSpeed(mass, catapult, scale);
			let mate = pad.battery;
			let mateCost = 0;
			for (let i = 0; i < OrbitTech.BATTERIES.length; i++) {
				const item = OrbitTech.BATTERIES[i];
				if (item.tier <= pad.battery.tier || !GravityGame.gearKnown(career, item)) continue;
				mate = item;
				mateCost = careerPrice(career, item);
				if (OrbitTech.speedLimit(item.capacity, mass, catapult, scale) + 1e-9 >= forceCap) break;
			}
			const cap = OrbitTech.speedLimit(mate.capacity, mass, catapult, scale);
			const reach = this.careerReach(planet, cap);
			const shot = OrbitTech.launchEnergy(mass, catapult, speed < cap ? speed : cap);
			/* the mate keeps the charge this pad holds, so the panel replaces the
			 * whole shot, exactly as the standing rail's cycle does */
			const refill = this.careerRefillWait(career, planet, pad.panel, Math.max(0, shot - free));
			this.careerGearOffer(career,
				(money + Math.max(0, reach - reachNow) * CAREER_REACH_VALUE) /
				(flownSec + refill) - yieldNow, careerPrice(career, catapult) + mateCost,
				OrbitTech.KIND_CATAPULT, catapult, mate === pad.battery ? null : mate,
				catapult.id + (mate === pad.battery ? '' : '+' + mate.id));
		}

		/* the rung must pay for itself inside the horizon and leave a launch
		 * fee in the purse: gear never spends the company's way off the pad */
		if (!best.label || best.value < best.cost) return false;
		if (!this.careerBuyGear(career, planet, best.kind, best.item, CAREER_PURSE_RESERVE)) {
			return false;
		}
		/* a rail is only as good as the battery that fills it: fit the mate too */
		if (best.mate) {
			this.careerBuyGear(career, planet, OrbitTech.KIND_BATTERY, best.mate,
				CAREER_PURSE_RESERVE);
		}
		this.careerPadGearBought += 1;
		this.traceAdd(careerTraceIndex(career), 'gear', 'P' + planet + ' ' + best.label +
			' · ' + best.cost.toFixed(2) + ' · yield +' + (best.rate * 60).toFixed(2) + '/min' +
			(best.rate > 0 ? ' · payback ' + (best.cost / best.rate).toFixed(0) + ' s' : ''),
			runStep || 0);
		return true;
	};

	/* keep the rung worth the most money inside CAREER_PAD_HORIZON that the
	 * purse can still pay for with the launch reserve intact */
	GravityBot.prototype.careerGearOffer = function (career, rate, cost, kind, item, mate, label) {
		const best = this.careerGear;
		if (cost + CAREER_PURSE_RESERVE + careerRefundEscrow(career) > career.ledger.purse + 1e-9) return;
		const value = (rate > 0 ? rate : 0) * CAREER_PAD_HORIZON * GravityGame.padScaleOf();
		if (value <= best.value) return;
		best.value = value;
		best.rate = rate;
		best.cost = cost;
		best.kind = kind;
		best.item = item;
		best.mate = mate;
		best.label = label;
	};

	/* ── repair, holds & pads ── repair, hold choice, buying a pad */

	/* Keep a launch in reserve for optional service. A worn-out ship has to
	 * spend its last coin on repairs before it can use any rail. */
	GravityBot.prototype.careerRepair = function (career, runStep) {
		const condition = career.ship.condition;
		if (condition > CAREER_REPAIR_AT) return false;
		const cost = GravityGame.repairCost(career);
		const reserve = condition > 0 ? CAREER_PURSE_RESERVE + careerRefundEscrow(career) : 0;
		if (career.ledger.purse + 1e-9 < cost + reserve) return false;
		if (!GravityGame.repairCareer(career)) return false;
		this.traceAdd(careerTraceIndex(career), 'repair', 'P' + career.at + ' · cond ' +
			Math.round(condition * 100) + ' % → 100 % · −' + cost.toFixed(2), runStep);
		return true;
	};

	/*
	 * A hold buys the contract board, so it waits until the company has a board
	 * to use: CAREER_HOLD_PADS pads, or an actual local delivery that already
	 * carries the hold and pays more than it costs. The weight is the reason —
	 * 1.5 t is 15 % of a dry ship, and every launch, fee and tax carries it.
	 */
	GravityBot.prototype.careerWantHold = function (career, sim) {
		const hold = OrbitTech.HOLDS[1];
		const price = careerPrice(career, hold);
		const budget = career.ledger.purse - price;
		if (career.padCount >= CAREER_HOLD_PADS &&
			budget >= CAREER_PURSE_RESERVE + careerPrice(career, OrbitTech.CATAPULTS[0])) return true;
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind !== GravityGame.TASK_DELIVERY || task.state !== GravityGame.TASK_OFFERED) continue;
			if (task.from !== career.at || task.tons > hold.capacity) continue;
			if (this.careerDeliveryNet(career, task, hold, budget, sim) > price) return true;
		}
		if (career.at === career.capitalPlanet && career.market) {
			const market = career.market;
			for (let p = 0; p < OrbitWorld.PLANETS; p++) {
				if (!market.rebel[p] || !market.patients[p] || !GravityGame.planetInPlay(career, p)) continue;
				if (this.careerMedicNet(career, p, market.patients[p], hold, budget, sim) > price) return true;
			}
		}
		return false;
	};

	/* The 1.5 t must not strand the ship: a kit priced for the dry hull can
	 * sit right at its limit on a heavy world, so the heavier hull has to
	 * leave where it stands on the rails already there. */
	GravityBot.prototype.careerHoldLeaves = function (career, sim) {
		const hold = OrbitTech.HOLDS[1];
		const mass = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, hold, 0);
		const cash = career.ledger.purse - careerPrice(career, hold) - careerRefundEscrow(career);
		const exit = this.careerDeparture(career, career.at, cash, mass, sim);
		return exit.ok && !exit.builds;
	};

	/* Install exactly the kit the exit probe priced, even when just its
	 * battery is missing. A fresh rail comes with BAT-1 (and its charge). */
	GravityBot.prototype.careerBuyPad = function (career, planet, exit, reserve, step, why) {
		if (!exit.builds) return false;
		const cat = exit.catapult;
		const bat = exit.battery;
		const pad = career.pads[planet];
		if (pad.catapult !== cat && !this.careerBuyGear(career, planet, OrbitTech.KIND_CATAPULT,
			cat, reserve, step, why)) return false;
		return pad.battery === bat || this.careerBuyGear(career, planet, OrbitTech.KIND_BATTERY,
			bat, reserve, step, why);
	};

	/* ── between flights ── careerBetweenFlights */

	/* Buy a colonization kit when surplus endgame capital covers the hold,
	 * the kit, launching the loaded ship from here, and post-founding exit on
	 * a reachable uninhabited world (0.7.44). */
	const CAREER_KIT_ANGLES = 32;
	const CAREER_KIT_FRACTIONS = [0.6, 0.8, 1];

	GravityBot.prototype.careerColonyKitShop = function (career, sim, runStep) {
		if (career.ended !== GravityGame.CAREER_OPEN || career.ship.colonyKit ||
			career.contract >= 0 || career.at < 0) return 0;
		const at = career.at;
		if (GravityGame.emptyWorld(career, at)) return 0;
		if (at !== career.hq && at !== career.capitalPlanet &&
			career.pads[at].catapult === null) return 0;
		const kitCost = careerPrice(career, OrbitTech.COLONY_KIT);
		const needHold = career.ship.hold.capacity >= OrbitTech.COLONY_KIT.mass
			? career.ship.hold : OrbitTech.HOLDS[2];
		const holdCost = needHold === career.ship.hold || career.owned[needHold.id]
			? 0 : careerPrice(career, needHold);
		const keepBase = CAREER_PURSE_RESERVE + GravityGame.repairCost(career) +
			careerRefundEscrow(career);
		const cashAfterBuy = career.ledger.purse - kitCost - holdCost - keepBase;
		if (cashAfterBuy < 0 || GravityGame.emptyInPlay(career) <= 0) return 0;
		const dryMass = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, needHold, 0);
		const loadedMass = dryMass + OrbitTech.COLONY_KIT.mass;
		const here = this.careerDeparture(career, at, cashAfterBuy, loadedMass, sim);
		if (!here.ok || cashAfterBuy + 1e-9 < here.cost) return 0;
		/* Snapshot `here` scalars before `post` reuses `this.careerExit`. */
		const hereBuilds = here.builds;
		const hereCatapult = here.catapult;
		const hereBattery = here.battery;
		const hereCost = here.cost;
		const cashAtDest = cashAfterBuy - hereCost;
		let exitableMask = 0;
		let minPostCost = Infinity;
		const exitable = [];
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (!GravityGame.planetInPlay(career, p) || !GravityGame.emptyWorld(career, p)) continue;
			if (this.careerContested(career, p)) continue;
			const post = this.careerDeparture(career, p, cashAtDest, dryMass, sim,
				1, true, true, 0, true);
			if (!post.ok || cashAtDest + 1e-9 < post.cost) continue;
			exitable.push(p);
			exitableMask += 1;
			if (post.cost < minPostCost) minPostCost = post.cost;
		}
		if (!exitableMask) return 0;
		const standingPad = GravityGame.padAt(career, at);
		const availKwh = standingPad.battery
			? Math.max(0, standingPad.chargeKwh - standingPad.reservedKwh) : 0;
		const launchCap = hereBuilds
			? OrbitTech.speedLimit(hereBattery.capacity, loadedMass, hereCatapult, sim.forceScale)
			: OrbitTech.speedLimit(availKwh, loadedMass, standingPad.catapult, sim.forceScale);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		this.prepareCareerExitProbe(sim);
		const probe = this.exitProbe;
		const maxU = GravitySim.SPEED_MAX * GravityGame.SPEED_STEPS;
		const probeReachable = cap => {
			const capU = Math.min(maxU,
				Math.floor(cap * GravityGame.SPEED_STEPS + 1e-9));
			if (capU < minU) return -1;
			for (let f = 0; f < CAREER_KIT_FRACTIONS.length; f++) {
				const speedU = Math.max(minU, Math.min(capU,
					Math.round(capU * CAREER_KIT_FRACTIONS[f])));
				const speed = GravityGame.speedOf(speedU);
				for (let a = 0; a < CAREER_KIT_ANGLES; a++) {
					const angle = GravityGame.angleOf(
						GravityGame.angleUnits((a + 0.5) / CAREER_KIT_ANGLES * Math.PI * 2));
					probe.predictFast(at, angle, speed, GravityGame.CAP_SECONDS);
					if (probe.predReason !== GravitySim.END_IMPACT || probe.predBody < 0) continue;
					if (exitable.indexOf(probe.predBody) >= 0) return probe.predBody;
				}
			}
			return -1;
		};
		let reachable = probeReachable(launchCap);
		let actions = 0;
		if (reachable < 0 && !hereBuilds && GravityGame.planetBuildable(career, at) &&
			standingPad.catapult) {
			const padReserve = keepBase + kitCost + holdCost + minPostCost;
			for (let i = 0; i < OrbitTech.CATAPULTS.length && reachable < 0; i++) {
				const rail = OrbitTech.CATAPULTS[i];
				if (rail.tier <= standingPad.catapult.tier || !GravityGame.gearKnown(career, rail)) continue;
				if (cashAfterBuy - careerPrice(career, rail) + 1e-9 < minPostCost) break;
				const hit = probeReachable(OrbitTech.speedLimit(availKwh, loadedMass, rail, sim.forceScale));
				if (hit < 0) continue;
				if (this.careerBuyGear(career, at, OrbitTech.KIND_CATAPULT, rail,
					padReserve, runStep, 'lift colony kit')) {
					reachable = hit;
					actions += 1;
				}
			}
		}
		if (reachable < 0) return actions;
		if (hereBuilds) {
			const padReserve = keepBase + kitCost + holdCost + minPostCost;
			const offer = { builds: true, catapult: hereCatapult, battery: hereBattery, cost: hereCost };
			if (!this.careerBuyPad(career, at, offer, padReserve, runStep, 'lift colony kit')) {
				return 0;
			}
			actions += 1;
		}
		if (needHold !== career.ship.hold) {
			if (!GravityGame.installPart(career, OrbitTech.KIND_HOLD, needHold)) return actions;
			this.traceAdd(careerTraceIndex(career), 'gear', 'P' + at + ' ' +
				needHold.id + ' · ' + needHold.capacity + ' t', runStep);
			actions += 1;
		}
		if (!GravityGame.buyColonyKit(career)) return actions;
		this.traceAdd(careerTraceIndex(career), 'gear', 'P' + at + ' ' +
			OrbitTech.COLONY_KIT.id + ' · → P' + reachable, runStep);
		return actions + 1;
	};

	GravityBot.prototype.careerBetweenFlights = function (career, sim, runStep = this.worldStep) {
		if (career.ended !== GravityGame.CAREER_OPEN) return 0;
		/* transport trips own the ship and the clock until arrival */
		if (career.arrested || career.evacuating) return 0;
		let actions = 0;
		if (career.at < 0) {
			if (this.careerRecover(career, sim, runStep, 'lost in space')) return 1;
			return 0;
		}
		if (career.ship.colonyKit && GravityGame.emptyWorld(career, career.at) &&
			GravityGame.foundColony(career, this.tradeSim, runStep)) {
			GravityGame.refreshBoard(career, this.tradeSim, runStep);
			this.traceAdd(careerTraceIndex(career), 'found colony',
				'P' + career.at + ' · colony founded', runStep);
			actions++;
		}
		/* Mandatory service first. An affordable exit kit comes before an
		 * optional repair, contract or evacuation, just as the fan priced it. */
		if (!GravityGame.careerShipUsable(career)) {
			if (!this.careerRepair(career, runStep)) return 0;
			actions++;
		}
		const at = career.at;
		const departure = this.careerPadOffer(career, at,
			career.ledger.purse - careerRefundEscrow(career), sim);
		if (this.careerBuyPad(career, at, departure, 0, runStep,
			career.pads[at].catapult ? 'affordable exit' : 'claim an exitable landing')) actions++;
		if (GravityGame.padLift(career, at, sim.forceScale) + 1e-9 < GravitySim.SPEED_MIN) {
			if (career.contract >= 0) {
				this.careerDeferContract(career, runStep, 'load cannot lift');
				actions++;
			} else if (this.careerRecover(career, sim, runStep, 'no affordable rail can lift')) return actions + 1;
		}
		if (this.careerRepair(career, runStep)) actions += 1;

		const researchBase = GravityGame.evacTarget(career);
		if (this.careerUseResearch && career.at >= 0 && career.at === researchBase) {
			let part;
			while ((part = this.careerResearch(career, sim, CAREER_PURSE_RESERVE))) {
				this.traceAdd(careerTraceIndex(career), 'research', part + ' · HQ gear', runStep);
				actions += 1;
			}
		}
		if (career.contract < 0 && GravityGame.emptyInPlay(career) > 0 &&
			this.careerNextPad(career, career.ledger.purse, sim) < 0) {
			actions += this.careerColonyKitShop(career, sim, runStep);
		}
		if (this.careerAccept(career, runStep, sim)) actions += 1;
		if (this.careerBribe(career, sim, runStep)) actions += 1;

		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED) {
				if (this.careerUpgrade(career, sim, CAREER_LOADED_SPEED, CAREER_PURSE_RESERVE, runStep)) {
					actions += 1;
				}
				if (GravityGame.padLift(career, career.at) + 1e-9 < GravitySim.SPEED_MIN) {
					this.careerDeferContract(career, runStep, 'upgraded rail still cannot lift');
					actions += 1;
				}
			}
		}

		/* At most one remote claim per shop. Before the first flight, keep the
		 * first landing's EMC money at hand rather than claiming a remote site
		 * and then having to pay the commercial rail under the ship. */
		const reserve = CAREER_PURSE_RESERVE + GravityGame.repairCost(career) +
			careerRefundEscrow(career) +
			(career.flights === 0 ? careerPrice(career, OrbitTech.CATAPULTS[0]) : 0);
		if (career.ended === GravityGame.CAREER_OPEN && career.ledger.purse >= reserve) {
			const here = this.careerDeparture(career, career.at, career.ledger.purse, career.ship.mass, sim);
			const keep = reserve + here.cost;
			const cash = career.ledger.purse - keep;
			if (here.ok && cash >= 0) {
				const planet = this.careerNextPad(career, cash, sim);
				if (planet >= 0) {
					const kit = this.careerPadOffer(career, planet, cash, sim);
					if (this.careerBuyPad(career, planet, kit, keep, runStep, 'expand network')) actions += 1;
				}
			}
		}
		/* the hold is fitted wherever the ship stands, but only once the network
		 * can use a board: 1.5 t is 15 % of a dry ship and taxes every launch.
		 * It follows the claim, so one pass can buy a pad and then kit out. */
		if (career.at >= 0 && career.ship.hold === OrbitTech.HOLDS[0] &&
			career.ledger.purse + 1e-9 >= careerPrice(career, OrbitTech.HOLDS[1]) +
				CAREER_PURSE_RESERVE + careerRefundEscrow(career) && this.careerWantHold(career, sim) &&
			this.careerHoldLeaves(career, sim) &&
			GravityGame.installPart(career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[1])) {
			this.traceAdd(careerTraceIndex(career), 'gear', 'P' + career.at + ' ' +
				OrbitTech.HOLDS[1].id + ' · ' + OrbitTech.HOLDS[1].capacity + ' t', runStep);
			actions += 1;
		}
		/* the standing pad earns by the launch: size its rail, battery and panel
		 * for the money per pad second, never for the next rescue alone */
		if (career.ended === GravityGame.CAREER_OPEN && this.careerPadGear(career, runStep)) {
			actions += 1;
		}
		actions += this.careerColonyKitShop(career, sim, runStep);
		return actions;
	};

	/* ── recovery & bribes ── evacuation label, recovery, bribe proneness and offers, waiting */

	function evacTargetLabel(career) {
		const target = GravityGame.evacTarget(career);
		return career.hq >= 0 ? 'HQ P' + target : 'Capital P' + target;
	}

	GravityBot.prototype.careerRecover = function (career, sim, step, why) {
		const from = career.at;
		const paid = GravityGame.evacuationCost(career);
		if (!career.stranded || !GravityGame.evacuate(career, sim, paid, step)) return false;
		this.traceAdd(careerTraceIndex(career), 'evac',
			(from < 0 ? 'space' : 'P' + from) + ' → ' + evacTargetLabel(career) +
			' · ' + why + ' · ' + paid.toFixed(2) + ' paid', step);
		return true;
	};

	/*
	 * Bribes (0.5.12, repriced 0.5.13). Rulers pay the visit value — what the
	 * landing collected plus what regrew while the ship sat — multiplied by 2.
	 * The rot the bribe adds is what can end in the Capital transport; a seed-derived
	 * persona decides whether a company takes it. Never on its own rail (rot on
	 * the company's own pad hurts its colony), never below the small-bribe
	 * floor, never on the Capital, A.R.F. or a rebellious planet — the rule
	 * refuses those anyway.
	 */
	GravityBot.prototype.careerBribeProne = function (index) {
		return OrbitWorld.hash01(GravityGame.rivalSeed(this.seed >>> 0, index), 7, 0x39) <
			CAREER_BRIBE_PRONE;
	};

	/* another company's queued launch is leaving from this planet: the rulers
	 * have a reason to pay before that visitor collects instead */
	GravityBot.prototype.careerRivalQueued = function (planet, self) {
		for (let i = 0; i < this.count; i++) {
			const r = this.rivals[i];
			if (r === self || !r.turret || r.turret.origin !== planet) continue;
			return true;
		}
		return false;
	};

	GravityBot.prototype.careerTryRecovery = function (r, runStep) {
		const career = r.career;
		if (career.recoverySteps < 0) {
			if (career.at >= 0 && !GravityGame.careerShipUsable(career)) this.careerRepair(career, runStep);
			return false;
		}
		this.careerBribe(career, r.sim, runStep);
		r.readyStep = runStep + CAREER_RIVAL_GAP;
		return true;
	};

	GravityBot.prototype.careerBribe = function (career, sim, runStep) {
		const market = career.market;
		const planet = career.at;
		if (!market || !career.bribeProne || planet < 0) return false;
		if (GravityGame.padOwner(career, planet) === career.index) return false;
		const amount = GravityGame.bribeAmount(market, planet, runStep);
		if (amount < OrbitEcon.BRIBE_MIN) return false;
		if (amount < CAREER_BRIBE_PAY && market.corruption[planet] < CAREER_BRIBE_ROT &&
			!this.careerRivalQueued(planet, career)) return false;
		const result = GravityGame.acceptBribe(career, market, sim, planet, runStep);
		if (!result.ok) return false;
		this.traceAdd(careerTraceIndex(career), 'bribe', 'P' + planet + ' paid +' +
			result.amount.toFixed(2) + ' · rot ' + result.corruption.toFixed(1) +
			(result.arrested ? ' · ARRESTED' : ''), runStep);
		return true;
	};

	/*
	 * Patience: a losing flight that cannot claim a pad only burns the pad
	 * charge and the purse. Sitting the gap out lets the pads recharge, the
	 * board rotate and the visit profits grow, and the next plan is priced in
	 * that richer world. A padless landing that can pay for its own starter EMC
	 * is progress, so it is flown; after CAREER_SIT_TRIES skips the least bad
	 * shot is taken anyway, so a company can never sit forever.
	 */
	GravityBot.prototype.careerShouldWait = function (plan, tries) {
		if (plan.builds) return false;
		if (plan.score >= CAREER_MIN_SCORE) return false;
		return tries < CAREER_SIT_TRIES;
	};
	GravityBot.CAREER_REPAIR_AT = CAREER_REPAIR_AT;
	GravityBot.CAREER_PAD_HORIZON = CAREER_PAD_HORIZON;

	Object.assign(inner, {
		evacTargetLabel
	});
});
