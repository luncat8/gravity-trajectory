/*
 * H's pure facts, slots, topics, one-step arithmetic and copy validator.
 *
 * Reads live state and rule parameters from GravityGame, OrbitTech, OrbitEcon
 * and GravitySim into one frozen snapshot per check. No DOM, no random draws,
 * no state mutation, and no literal numbers or item ids in authored copy.
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js') : root.GravitySim;
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js') : root.OrbitEcon;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js') : root.OrbitTech;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js') : root.GravityGame;

	const EPS = 1e-9;
	const CENT = 100;
	const MONEY_DP = 2;
	const MASS_DP = 1;
	const H_META_ID = 'what-now';
	const H_META_ASK = 'what should I do?';
	const CHIP_CAP = 6;
	const EXCHANGE_CAP = 3;

	const LAUNCH_GATE_ORDER = Object.freeze([
		'arrest', 'space', 'wrong-planet', 'worn', 'no-rail', 'cap', 'fee'
	]);

	function money(value) {
		return Number(value).toFixed(MONEY_DP);
	}

	function cost(value) {
		return Math.abs(value) <= EPS ? 'free' : money(value);
	}

	function tenths(value) {
		return Number(value).toFixed(MASS_DP);
	}

	function trimmed(value) {
		return String(Number(Number(value).toFixed(MONEY_DP)));
	}

	function whole(value) {
		return String(Math.round(value));
	}

	function planetLabel(index) {
		return index >= 0 ? 'P' + index : 'in space';
	}

	function ownerLabel(owner, selfIndex) {
		if (owner === selfIndex) return 'you';
		if (owner === GravityGame.OWNER_CAPITAL) return 'the Empire';
		if (owner === GravityGame.OWNER_REBEL) return 'rebels';
		if (owner < 0) return 'commercial';
		return owner === 0 ? 'YOU' : 'R' + owner;
	}

	function shortfall(need, have) {
		const diff = need - have;
		return diff > 0 ? money(diff) : money(0);
	}

	function findReason(snapshot, id) {
		const list = snapshot.reasons;
		for (let i = 0; i < list.length; i++) {
			if (list[i].id === id) return list[i];
		}
		return null;
	}

	function hasReason(snapshot, id) {
		return findReason(snapshot, id) !== null;
	}

	function reasonFact(id) {
		return Object.freeze({
			test(snapshot) {
				return hasReason(snapshot, id);
			},
			why(snapshot) {
				const reason = findReason(snapshot, id);
				return reason ? GravityGame.formatLaunchReason(reason) : '';
			}
		});
	}

	function careerPrice(career, amount) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : amount;
	}

	/* Next buildable catapult on `pad`: lowest known stock rung above fitted,
	 * else lowest researched prototype that upgrades it (mirrors gui_shop). */
	function nextBuildablePad(career, pad) {
		const table = OrbitTech.CATAPULTS;
		const cur = pad.catapult;
		const tier = cur ? cur.tier : 0;
		for (let i = 0; i < table.length; i++) {
			if (table[i].tier <= tier) continue;
			if (GravityGame.gearKnown(career, table[i])) {
				return { item: table[i], tierIndex: i, protoId: '' };
			}
		}
		const protos = GravityGame.prototypesOf(career, OrbitTech.KIND_CATAPULT) || [];
		let best = null;
		for (let i = 0; i < protos.length; i++) {
			const item = protos[i];
			const fits = cur === null || OrbitTech.upgrades(pad, OrbitTech.KIND_CATAPULT, item);
			if (!fits) continue;
			if (!best || item.tier < best.tier ||
				(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
		}
		return best ? { item: best, tierIndex: -1, protoId: best.id } : null;
	}

	function firstLockedPadId(career, pad) {
		const table = OrbitTech.CATAPULTS;
		const tier = pad.catapult ? pad.catapult.tier : 0;
		for (let i = 0; i < table.length; i++) {
			if (table[i].tier > tier && !GravityGame.gearKnown(career, table[i])) {
				return table[i].id;
			}
		}
		return '';
	}

	function snapshotReasons(career, sim, armed, aimBody, aimSpeed) {
		if (!career || !sim || career.ended !== GravityGame.CAREER_OPEN) return [];
		if (sim.status === GravitySim.STATUS_FLYING) return [];
		if (career.at < 0) {
			return GravityGame.launchReasons(career, sim, career.hq, GravitySim.SPEED_MIN, false);
		}
		const planet = armed && aimBody >= 0 ? aimBody : career.at;
		const speed = armed && aimBody >= 0 ? aimSpeed : GravitySim.SPEED_MIN;
		return GravityGame.launchReasons(career, sim, planet, speed, false);
	}

	function freezeReasons(raw) {
		const list = [];
		for (let i = 0; i < raw.length; i++) {
			const r = raw[i];
			list.push(Object.freeze({
				id: r.id,
				need: r.need,
				have: r.have,
				repair: r.repair === true
			}));
		}
		return Object.freeze(list);
	}

	function boardSummary(career, clockSteps) {
		const tasks = career.tasks;
		const sportSlot = GravityGame.COMPETE_SLOT;
		const sport = tasks[sportSlot];
		const sportOpen = Boolean(sport && sport.kind === GravityGame.TASK_COMPETE);
		const active = career.contract >= 0 ? tasks[career.contract] : null;
		const contractOpen = Boolean(active && active.kind !== GravityGame.TASK_NONE);
		let contractTarget = -1;
		if (contractOpen) {
			if (active.kind === GravityGame.TASK_MEDIC) {
				contractTarget = active.aboard > 0 ? career.capitalPlanet : active.to;
			} else {
				contractTarget = active.state === GravityGame.TASK_LOADED ? active.to : active.from;
			}
		}
		let offeredCount = 0;
		let offeredTopReward = 0;
		for (let i = 0; i < tasks.length; i++) {
			if (i === sportSlot) continue;
			const t = tasks[i];
			if (!t || t.kind === GravityGame.TASK_NONE || t.state !== GravityGame.TASK_OFFERED) continue;
			offeredCount += 1;
			if (t.reward > offeredTopReward) offeredTopReward = t.reward;
		}
		return {
			sportOpen: sportOpen,
			sportPlanet: sportOpen ? sport.planet : -1,
			sportMinLength: sportOpen ? sport.minLength : 0,
			sportReward: sportOpen ? sport.reward : 0,
			sportLeftSec: sportOpen
				? Math.max(0, Math.round((sport.deadline - clockSteps) * GravitySim.DT)) : 0,
			contractOpen: contractOpen,
			contractTarget: contractTarget,
			contractReward: contractOpen ? active.reward : 0,
			offeredCount: offeredCount,
			offeredTopReward: offeredTopReward
		};
	}

	function baseSnapshot(rule, second, flying, waitLocked, obsRecord, commercialPad) {
		return {
			rule: rule,
			careerMode: false,
			ended: GravityGame.CAREER_OPEN,
			endedTag: '',
			flying: flying,
			waitLocked: waitLocked,
			second: second,
			planet: -1,
			hq: -1,
			capitalPlanet: -1,
			arfPlanet: -1,
			index: 0,
			purse: 0,
			stranded: false,
			evacFee: 0,
			evacCost: 0,
			evacSeconds: 0,
			reasons: Object.freeze([]),
			feeNeed: 0,
			armed: false,
			armedHere: false,
			aimBody: -1,
			aimSpeed: GravitySim.SPEED_MIN,
			speedMin: GravitySim.SPEED_MIN,
			waitSec: GravitySim.WAIT_SEC,
			arrested: false,
			arrestLeftSec: 0,
			arrestSeconds: OrbitEcon.ARREST_SECONDS,
			shipMass: 0,
			condition: 1,
			conditionPct: CENT,
			shipUsable: true,
			repairCost: 0,
			repairFullCost: 0,
			wearSpacePct: 0,
			wearLandingPct: 0,
			obsId: obsRecord ? obsRecord.id : '',
			obsFitted: false,
			reportsActive: false,
			padCount: 0,
			planetCount: 0,
			ownPadHere: false,
			ownPadId: '',
			ownPanelId: '',
			ownBatteryId: '',
			padOwner: GravityGame.OWNER_COMMERCIAL,
			claimOwner: GravityGame.OWNER_COMMERCIAL,
			railName: '',
			railReady: false,
			speedCap: 0,
			padLift: 0,
			padCharge: 0,
			padCapacity: 0,
			ownFreeKwh: 0,
			waitGainKwh: 0,
			minFee: 0,
			commercialPadId: commercialPad.catapult.id,
			commercialBase: 0,
			commercialKwh: 0,
			commercialSelected: false,
			commercialLift: 0,
			commercialMinFee: 0,
			taxPerKwh: 0,
			buildable: false,
			seized: false,
			rebel: false,
			nextPadId: '',
			nextPadCost: 0,
			nextPadCap: 0,
			nextPadTier: -1,
			nextPadProto: '',
			lockedPadId: '',
			hasEngine: false,
			engineId: '',
			tankId: '',
			fuelCap: 0,
			fuelKg: 0,
			fuelRoom: 0,
			fuelPrice: 0,
			fuelKgPerKwh: GravityGame.FUEL_KG_PER_KWH,
			fuelStep: GravityGame.FUEL_BUY_STEP,
			fuelStepCost: 0,
			fuelStepKwh: 0,
			produceKg: 0,
			produceKwh: 0,
			buyKg: 0,
			buyCost: 0,
			shipDv: 0,
			corruption: 0,
			corruptionPct: 0,
			rebelStart: OrbitEcon.REBEL_START,
			bribeCoef: OrbitEcon.BRIBE_VALUE_COEF,
			bribeWindow: false,
			bribeRefusal: 'not landed there',
			bribeAmount: 0,
			bribeRot: 0,
			bribeAfterPct: 0,
			bribeArrestPct: 0,
			sportOpen: false,
			sportPlanet: -1,
			sportMinLength: 0,
			sportReward: 0,
			sportLeftSec: 0,
			contractOpen: false,
			contractTarget: -1,
			contractReward: 0,
			offeredCount: 0,
			offeredTopReward: 0
		};
	}

	function buildSnapshot(input) {
		const opts = input || {};
		const rule = opts.rule || 'lab';
		const clockSteps = opts.clockSteps || 0;
		const second = opts.gameOn ? Math.floor(clockSteps * GravitySim.DT) : 0;
		const career = rule === GravityGame.RULE_CAREER ? opts.career || null : null;
		const sim = opts.sim || null;
		const flying = Boolean(sim && sim.status === GravitySim.STATUS_FLYING);
		const waitLocked = Boolean(opts.waitLocked);
		const obsRecord = OrbitTech.OBS.find(item => item.fitted) || OrbitTech.OBS[0];
		const commercialPad = GravityGame.COMMERCIAL_PAD;
		const snap = baseSnapshot(rule, second, flying, waitLocked, obsRecord, commercialPad);
		if (!career) return Object.freeze(snap);

		const speedMin = snap.speedMin;
		const speedMax = GravitySim.SPEED_MAX;
		const market = opts.market || career.market || null;
		const galaxy = opts.galaxy || career.galaxy || null;
		const at = career.at;
		const landed = at >= 0 && !flying;
		const armed = Boolean(opts.armed);
		const aimBody = armed ? opts.aimBody : -1;
		const aimSpeed = armed ? opts.aimSpeed : speedMin;
		const forceScale = sim ? sim.forceScale : career.forceScale;
		const ship = career.ship;
		const purse = career.ledger.purse;

		const reasons = freezeReasons(snapshotReasons(career, sim, armed, aimBody, aimSpeed));
		let feeNeed = 0;
		for (let i = 0; i < reasons.length; i++) {
			if (reasons[i].id === 'fee') feeNeed = reasons[i].need;
		}

		const ended = career.ended;
		const arrested = Boolean(career.arrested);
		const shipUsable = GravityGame.careerShipUsable(career);
		const obsFitted = Boolean(ship.obs && ship.obs.fitted);
		const oneSecSteps = GravitySim.stepsForGameSeconds(1);

		const ownPad = at >= 0 ? career.pads[at] : null;
		const ownPadHere = Boolean(ownPad && ownPad.catapult !== null);
		const activePad = at >= 0 ? GravityGame.padAt(career, at) : null;
		const rawLift = at >= 0 ? GravityGame.padLift(career, at, forceScale) : 0;
		const ownFreeKwh = ownPadHere ? Math.max(0, ownPad.chargeKwh - ownPad.reservedKwh) : 0;

		const rawCommLift = OrbitTech.speedLimit(commercialPad.battery.capacity,
			ship.mass, commercialPad.catapult, forceScale);
		const commEnergy = OrbitTech.launchEnergy(ship.mass, commercialPad.catapult, speedMin);
		const commercialBase = careerPrice(career, GravityGame.COMMERCIAL_BASE);
		const commercialKwh = careerPrice(career, GravityGame.COMMERCIAL_KWH);

		const buildable = Boolean(at >= 0 && GravityGame.planetBuildable(career, at));
		const seized = Boolean(at >= 0 && GravityGame.rebelRail(career, at));
		const canBuildHere = at >= 0 && (ownPadHere ? at !== career.capitalPlanet && !seized : buildable);
		const nextPad = canBuildHere ? nextBuildablePad(career, ownPad) : null;
		const nextBattery = ownPadHere ? ownPad.battery : OrbitTech.BATTERIES[0];
		const rawNextCap = nextPad
			? OrbitTech.speedLimit(nextBattery.capacity, ship.mass, nextPad.item, forceScale) : 0;

		const hasEngine = ship.engine !== null;
		const fuelCap = ship.tank ? ship.tank.fuelCap : 0;
		const canUseFuel = ended === GravityGame.CAREER_OPEN && hasEngine && fuelCap > 0;
		const fuelRoom = Math.max(0, fuelCap - ship.fuelKg);
		const fuelPrice = GravityGame.fuelPrice(career);
		const fuelRate = snap.fuelKgPerKwh;
		const fuelStep = snap.fuelStep;
		const produceMax = canUseFuel
			? Math.min(Math.floor(fuelRoom), Math.floor(ownFreeKwh * fuelRate + EPS)) : 0;
		const produceKg = Math.min(fuelStep, produceMax);
		const buyMax = !canUseFuel ? 0
			: fuelPrice > 0 ? Math.min(fuelRoom, Math.max(0, purse) / fuelPrice) : fuelRoom;
		const buyKg = Math.min(fuelStep, buyMax);

		const corruption = at >= 0 && market ? market.corruption[at] : 0;
		const bribeRefusal = at >= 0 && market
			? GravityGame.bribeRefusal(career, market, at) : 'not landed there';
		const bribeAmount = at >= 0 && market && bribeRefusal === ''
			? GravityGame.bribeAmount(market, at, clockSteps) : 0;
		const bribeRot = OrbitEcon.bribeCorruption(bribeAmount);
		const bribeAfter = OrbitEcon.clampCorruption(corruption + bribeRot);

		return Object.freeze(Object.assign(snap, {
			careerMode: true,
			ended: ended,
			endedTag: ended === GravityGame.CAREER_BROKE ? 'broke'
				: ended === GravityGame.CAREER_COMPLETE ? 'complete' : '',
			planet: at,
			hq: career.hq,
			capitalPlanet: career.capitalPlanet,
			arfPlanet: career.arfPlanet,
			index: career.index,
			purse: purse,
			stranded: Boolean(career.stranded),
			evacFee: careerPrice(career, GravityGame.CAREER.evacFee),
			evacCost: GravityGame.evacuationCost(career),
			evacSeconds: GravityGame.evacuationSeconds(career),
			reasons: reasons,
			feeNeed: feeNeed,
			armed: armed,
			armedHere: landed && armed && aimBody === at,
			aimBody: aimBody,
			aimSpeed: aimSpeed,
			arrested: arrested,
			arrestLeftSec: arrested
				? Math.max(0, Math.round((career.arrestUntilStep - clockSteps) * GravitySim.DT)) : 0,
			shipMass: ship.mass,
			condition: ship.condition,
			conditionPct: Math.round(ship.condition * CENT),
			shipUsable: shipUsable,
			repairCost: GravityGame.repairCost(career),
			repairFullCost: careerPrice(career, GravityGame.WEAR_REPAIR_COST),
			wearSpacePct: GravityGame.spaceWear(career, oneSecSteps) * CENT,
			wearLandingPct: GravityGame.landingWear(career) * CENT,
			obsId: obsFitted ? ship.obs.id : snap.obsId,
			obsFitted: obsFitted,
			reportsActive: obsFitted && shipUsable,
			padCount: career.padCount,
			planetCount: opts.planetCount || career.planetCount,
			ownPadHere: ownPadHere,
			ownPadId: ownPadHere ? ownPad.catapult.id : '',
			ownPanelId: ownPadHere ? ownPad.panel.id : '',
			ownBatteryId: ownPadHere ? ownPad.battery.id : '',
			padOwner: at >= 0 ? GravityGame.padOwner(career, at) : GravityGame.OWNER_COMMERCIAL,
			claimOwner: at >= 0 && galaxy ? GravityGame.claimOwner(galaxy, at) : GravityGame.OWNER_COMMERCIAL,
			railName: at >= 0 ? GravityGame.railOwnerText(career, at) : '',
			railReady: Boolean(landed && sim && sim.canLaunchFrom(at)),
			speedCap: landed && sim ? sim.speedLimit(at) : 0,
			padLift: rawLift > speedMax ? speedMax : rawLift,
			padCharge: activePad ? activePad.chargeKwh : 0,
			padCapacity: activePad && activePad.battery ? activePad.battery.capacity : 0,
			ownFreeKwh: ownFreeKwh,
			waitGainKwh: ownPadHere
				? OrbitTech.solarCharge(ownPad.panel, career.light[at], GravitySim.WAIT_PAD_SEC) : 0,
			minFee: at >= 0 ? GravityGame.launchFee(career, at, speedMin) : 0,
			commercialBase: commercialBase,
			commercialKwh: commercialKwh,
			commercialSelected: at >= 0 && career.commercialPlanet === at,
			commercialLift: rawCommLift > speedMax ? speedMax : rawCommLift,
			commercialMinFee: commercialBase + commercialKwh * commEnergy,
			taxPerKwh: careerPrice(career, GravityGame.CAREER.taxPerKwh),
			buildable: buildable,
			seized: seized,
			rebel: Boolean(at >= 0 && market && market.rebel[at]),
			nextPadId: nextPad ? nextPad.item.id : '',
			nextPadCost: nextPad ? careerPrice(career, nextPad.item.buildCost) : 0,
			nextPadCap: rawNextCap > speedMax ? speedMax : rawNextCap,
			nextPadTier: nextPad ? nextPad.tierIndex : -1,
			nextPadProto: nextPad ? nextPad.protoId : '',
			lockedPadId: canBuildHere && !nextPad ? firstLockedPadId(career, ownPad) : '',
			hasEngine: hasEngine,
			engineId: hasEngine ? ship.engine.id : '',
			tankId: ship.tank ? ship.tank.id : '',
			fuelCap: fuelCap,
			fuelKg: ship.fuelKg,
			fuelRoom: fuelRoom,
			fuelPrice: fuelPrice,
			fuelStepCost: fuelStep * fuelPrice,
			fuelStepKwh: fuelRate > 0 ? fuelStep / fuelRate : 0,
			produceKg: produceKg,
			produceKwh: fuelRate > 0 ? produceKg / fuelRate : 0,
			buyKg: buyKg,
			buyCost: buyKg * fuelPrice,
			shipDv: hasEngine && fuelCap > 0 ? OrbitTech.shipDeltaV(ship, ship.cargoTons) : 0,
			corruption: corruption,
			corruptionPct: Math.round(corruption),
			bribeWindow: Boolean(at >= 0 && market && GravityGame.bribeWindowOpen(market, at)),
			bribeRefusal: bribeRefusal,
			bribeAmount: bribeAmount,
			bribeRot: bribeRot,
			bribeAfterPct: Math.round(bribeAfter),
			bribeArrestPct: career.capitalPlanet >= 0
				? Math.round(OrbitEcon.arrestChance(bribeAfter) * CENT) : 0
		}, boardSummary(career, clockSteps)));
	}

	function canPay(purse, amount) {
		return purse + EPS >= amount;
	}

	function landedOpen(s) {
		return s.careerMode && s.ended === GravityGame.CAREER_OPEN &&
			!s.flying && !s.arrested && s.planet >= 0;
	}

	function padUndercharged(s) {
		return landedOpen(s) && s.speedCap + EPS < s.speedMin && s.padLift + EPS >= s.speedMin;
	}

	function padUnderpowered(s) {
		return landedOpen(s) && s.padLift + EPS < s.speedMin;
	}

	function commercialOption(s) {
		return landedOpen(s) && s.planet !== s.capitalPlanet && !s.commercialSelected &&
			s.padOwner !== GravityGame.OWNER_COMMERCIAL && s.commercialLift + EPS >= s.speedMin &&
			(hasReason(s, 'no-rail') || hasReason(s, 'cap'));
	}

	function fuelReady(s) {
		return s.careerMode && s.ended === GravityGame.CAREER_OPEN && s.hasEngine && s.fuelCap > 0;
	}

	function fuelNeed(s) {
		return landedOpen(s) && fuelReady(s) && s.fuelRoom > EPS;
	}

	function bribeOpen(s) {
		return landedOpen(s) && s.bribeRefusal === '' && s.bribeAmount > 0;
	}

	function politicalPlanet(s) {
		return landedOpen(s) && s.planet !== s.capitalPlanet && s.planet !== s.arfPlanet;
	}

	/* Fact registry: every predicate reads snapshot only; no digit literals in `why`. */
	const HH_FACTS = Object.freeze({
		arrest: reasonFact('arrest'),
		space: reasonFact('space'),
		'wrong-planet': reasonFact('wrong-planet'),
		worn: reasonFact('worn'),
		'no-rail': reasonFact('no-rail'),
		cap: reasonFact('cap'),
		fee: reasonFact('fee'),
		'career-mode': Object.freeze({
			test: s => s.careerMode,
			why: s => 'mode ' + s.rule + ' has no career base'
		}),
		'career-open': Object.freeze({
			test: s => s.careerMode && s.ended === GravityGame.CAREER_OPEN && !s.arrested,
			why: s => s.arrested ? GravityGame.formatLaunchReason(findReason(s, 'arrest'))
				: 'career ' + (s.endedTag || 'closed')
		}),
		ended: Object.freeze({
			test: s => s.careerMode && s.ended !== GravityGame.CAREER_OPEN,
			why: s => 'career ' + s.endedTag
		}),
		flying: Object.freeze({
			test: s => s.careerMode && s.flying,
			why: () => 'ship in flight'
		}),
		'landed-open': Object.freeze({
			test: landedOpen,
			why: () => 'land on a planet first'
		}),
		'launch-blocked': Object.freeze({
			test: s => s.careerMode && s.ended === GravityGame.CAREER_OPEN && s.reasons.length > 0,
			why: s => s.reasons.length ? GravityGame.formatLaunchReason(s.reasons[s.reasons.length - s.reasons.length]) : ''
		}),
		'ship-worn': Object.freeze({
			test: s => s.careerMode && s.condition < 1,
			why: () => 'the ship is as new'
		}),
		'ship-unusable': Object.freeze({
			test: s => s.careerMode && !s.shipUsable,
			why: () => GravityGame.WORN_OUT_BLOCK
		}),
		'can-offer-repair': Object.freeze({
			test: s => landedOpen(s) && s.condition < 1,
			why: () => 'the ship is as new'
		}),
		'can-repair': Object.freeze({
			test: s => landedOpen(s) && canPay(s.purse, s.repairCost),
			why: s => 'short ' + shortfall(s.repairCost, s.purse) + ' (purse ' + money(s.purse) + ')'
		}),
		'repair-short': Object.freeze({
			test: s => landedOpen(s) && s.condition < 1 && !canPay(s.purse, s.repairCost),
			why: s => 'short ' + shortfall(s.repairCost, s.purse)
		}),
		'reports-active': Object.freeze({
			test: s => s.reportsActive,
			why: s => !s.obsFitted
				? s.obsId + ' not fitted · visits pay nothing'
				: 'hull at ' + whole(s.conditionPct) + '% · visits pay nothing until repaired'
		}),
		'at-capital': Object.freeze({
			test: s => landedOpen(s) && s.planet === s.capitalPlanet,
			why: () => 'the Empire owns this planet'
		}),
		'own-pad-here': Object.freeze({
			test: s => s.ownPadHere,
			why: () => 'you own no pad here'
		}),
		'own-pad-any': Object.freeze({
			test: s => s.padCount > 0,
			why: () => 'you own no pad anywhere'
		}),
		'own-pad-charging': Object.freeze({
			test: s => landedOpen(s) && s.ownPadHere && s.padCharge + EPS < s.padCapacity,
			why: () => 'pad battery is full'
		}),
		'can-offer-wait': Object.freeze({
			test: s => landedOpen(s) && s.ownPadHere && s.padCharge + EPS < s.padCapacity,
			why: () => 'pad battery is full'
		}),
		'can-wait': Object.freeze({
			test: s => landedOpen(s) && s.ownPadHere && s.padCharge + EPS < s.padCapacity && !s.waitLocked,
			why: () => 'clock busy'
		}),
		'pad-undercharged': Object.freeze({
			test: padUndercharged,
			why: s => 'charge ' + money(s.padCharge) + '/' + money(s.padCapacity) + ' kWh'
		}),
		'pad-underpowered': Object.freeze({
			test: padUnderpowered,
			why: s => 'rail caps at ' + whole(s.padLift) + ' px/s'
		}),
		'can-offer-build': Object.freeze({
			test: s => landedOpen(s) && s.nextPadId !== '',
			why: () => 'no buildable rail here'
		}),
		'can-build-pad': Object.freeze({
			test: s => landedOpen(s) && s.nextPadId !== '' && canPay(s.purse, s.nextPadCost),
			why: s => 'short ' + shortfall(s.nextPadCost, s.purse) + ' (purse ' + money(s.purse) + ')'
		}),
		'build-short': Object.freeze({
			test: s => landedOpen(s) && s.nextPadId !== '' && !canPay(s.purse, s.nextPadCost),
			why: s => 'short ' + shortfall(s.nextPadCost, s.purse)
		}),
		'pad-locked-science': Object.freeze({
			test: s => landedOpen(s) && s.nextPadId === '' && s.lockedPadId !== '',
			why: s => s.lockedPadId + ' needs science'
		}),
		'pad-blocked-seized': Object.freeze({
			test: s => landedOpen(s) && !s.ownPadHere && s.seized,
			why: () => 'seized planet · no building here'
		}),
		'pad-blocked-owner': Object.freeze({
			test: s => landedOpen(s) && !s.ownPadHere && !s.buildable &&
				!s.seized && s.planet !== s.capitalPlanet,
			why: s => ownerLabel(s.claimOwner, s.index) + ' already owns this planet'
		}),
		'pad-topic-open': Object.freeze({
			test: s => landedOpen(s) && s.planet !== s.capitalPlanet &&
				(!s.ownPadHere || s.nextPadId !== '' || s.lockedPadId !== '' ||
					s.padCharge + EPS < s.padCapacity || hasReason(s, 'no-rail') || hasReason(s, 'cap')),
			why: () => 'pad ready'
		}),
		'pad-short': Object.freeze({
			test: s => landedOpen(s) && (
				(s.nextPadId !== '' && !canPay(s.purse, s.nextPadCost)) ||
				(!s.ownPadHere && !canPay(s.purse, s.minFee)) ||
				(padUnderpowered(s) && s.stranded && !canPay(s.purse, s.evacFee))),
			why: s => 'purse ' + money(s.purse)
		}),
		'can-offer-evac': Object.freeze({
			test: s => s.careerMode && s.ended === GravityGame.CAREER_OPEN &&
				!s.flying && !s.arrested && s.stranded,
			why: () => 'nothing to evacuate'
		}),
		'can-evac': Object.freeze({
			test: s => s.careerMode && s.ended === GravityGame.CAREER_OPEN &&
				!s.flying && !s.arrested && s.stranded,
			why: () => 'nothing to evacuate'
		}),
		'evac-short': Object.freeze({
			test: s => s.careerMode && s.ended === GravityGame.CAREER_OPEN &&
				!s.flying && !s.arrested && s.stranded && !canPay(s.purse, s.evacFee),
			why: s => 'reduced fare ' + cost(s.evacCost) + ' · takes ' + whole(s.evacSeconds) + ' s'
		}),
		'can-slower-shot': Object.freeze({
			test: s => landedOpen(s) && hasReason(s, 'cap') && s.armedHere &&
				s.speedCap + EPS >= s.speedMin,
			why: s => 'cap below ' + whole(s.speedMin) + ' px/s'
		}),
		'can-offer-commercial': Object.freeze({
			test: commercialOption,
			why: () => 'commercial rail unavailable'
		}),
		'can-pay-commercial': Object.freeze({
			test: s => commercialOption(s) && canPay(s.purse, s.commercialMinFee),
			why: s => 'short ' + shortfall(s.commercialMinFee, s.purse) + ' (purse ' + money(s.purse) + ')'
		}),
		'commercial-available': Object.freeze({
			test: s => landedOpen(s) && s.planet !== s.capitalPlanet,
			why: () => 'no commercial rail here'
		}),
		'leave-short': Object.freeze({
			test: s => landedOpen(s) && (
				hasReason(s, 'fee') ||
				(hasReason(s, 'worn') && !canPay(s.purse, s.repairCost)) ||
				((hasReason(s, 'no-rail') || padUnderpowered(s)) && (
					(s.nextPadId !== '' && !canPay(s.purse, s.nextPadCost)) ||
					(s.stranded && !canPay(s.purse, s.evacFee))))),
			why: s => 'purse ' + money(s.purse)
		}),
		'fuel-ready': Object.freeze({
			test: fuelReady,
			why: () => 'needs an impulse engine and a fuel tank'
		}),
		'fuel-full': Object.freeze({
			test: s => fuelReady(s) && s.fuelRoom <= EPS,
			why: () => 'tank is full'
		}),
		'fuel-need': Object.freeze({
			test: fuelNeed,
			why: s => !fuelReady(s) ? 'needs an impulse engine and a fuel tank' : 'tank is full'
		}),
		'can-produce-fuel': Object.freeze({
			test: s => fuelNeed(s) && s.produceKg > 0,
			why: s => !s.ownPadHere ? 'you own no pad here' : 'no unreserved charge on your own pad'
		}),
		'can-buy-fuel': Object.freeze({
			test: s => fuelNeed(s) && s.buyKg > EPS,
			why: s => 'purse ' + money(s.purse) + ' cannot buy fuel at ' + money(s.fuelPrice) + '/kg'
		}),
		'fuel-buy-short': Object.freeze({
			test: s => fuelNeed(s) && !(s.buyKg > EPS) && s.produceKg <= 0,
			why: s => 'purse ' + money(s.purse)
		}),
		'bribe-topic-open': Object.freeze({
			test: politicalPlanet,
			why: s => s.bribeRefusal
		}),
		'bribe-open': Object.freeze({
			test: bribeOpen,
			why: s => s.bribeRefusal !== '' ? s.bribeRefusal
				: 'visit value is ' + money(s.bribeAmount) + ' · wait for it to grow'
		}),
		'bribe-waiting': Object.freeze({
			test: s => politicalPlanet(s) && s.bribeRefusal === '' && !(s.bribeAmount > 0),
			why: s => 'visit value is ' + money(s.bribeAmount)
		}),
		'bribe-taken': Object.freeze({
			test: s => politicalPlanet(s) && !s.bribeWindow && !s.rebel,
			why: s => s.bribeRefusal
		}),
		'bribe-rebel': Object.freeze({
			test: s => politicalPlanet(s) && s.rebel,
			why: s => s.bribeRefusal
		}),
		'sport-open': Object.freeze({
			test: s => s.careerMode && s.sportOpen,
			why: () => 'nothing on the board now'
		}),
		/* One-step on-planet arithmetic predicates (never recommendations). */
		'step-slower-fee': Object.freeze({
			test: s => landedOpen(s) && hasReason(s, 'fee') && s.armedHere &&
				s.aimSpeed > s.speedMin + EPS && s.railReady &&
				s.speedCap + EPS >= s.speedMin && canPay(s.purse, s.minFee),
			why: () => ''
		}),
		'step-commercial-pad': Object.freeze({
			test: s => (hasReason(s, 'no-rail') || padUndercharged(s)) &&
				commercialOption(s) && canPay(s.purse, s.commercialMinFee),
			why: () => ''
		}),
		'step-bribe-repair': Object.freeze({
			test: s => bribeOpen(s) && s.condition < 1 &&
				!canPay(s.purse, s.repairCost) && canPay(s.purse + s.bribeAmount, s.repairCost),
			why: () => ''
		}),
		'step-bribe-fee': Object.freeze({
			test: s => bribeOpen(s) && hasReason(s, 'fee') &&
				!canPay(s.purse, s.feeNeed) && canPay(s.purse + s.bribeAmount, s.feeNeed),
			why: () => ''
		}),
		'step-bribe-build': Object.freeze({
			test: s => bribeOpen(s) && s.nextPadId !== '' &&
				!canPay(s.purse, s.nextPadCost) && canPay(s.purse + s.bribeAmount, s.nextPadCost),
			why: () => ''
		}),
		'step-bribe-evac': Object.freeze({
			test: s => bribeOpen(s) && s.stranded &&
				!canPay(s.purse, s.evacFee) && canPay(s.purse + s.bribeAmount, s.evacFee),
			why: () => ''
		}),
		'step-charge-fuel': Object.freeze({
			test: s => fuelNeed(s) && !(s.buyKg > EPS) && s.produceKg > 0,
			why: () => ''
		})
	});

	/* Named slots: every live number, rate, constant and item id enters prose here. */
	const H_SLOTS = Object.freeze({
		ruleName: s => s.rule,
		endedTag: s => s.endedTag || 'closed',
		planetTag: s => planetLabel(s.planet),
		hqTag: s => planetLabel(s.hq),
		purse: s => money(s.purse),
		evacCost: s => cost(s.evacCost),
		evacFee: s => cost(s.evacFee),
		evacSeconds: s => whole(s.evacSeconds) + ' s',
		arrestWhy: s => HH_FACTS.arrest.why(s) || 'under arrest',
		arrestLeft: s => whole(s.arrestLeftSec) + ' s',
		arrestSeconds: s => whole(s.arrestSeconds) + ' s',
		wornWhy: s => HH_FACTS.worn.why(s) || GravityGame.WORN_OUT_BLOCK,
		feeShort: s => shortfall(s.feeNeed, s.purse),
		feeNeed: s => money(s.feeNeed),
		shipMass: s => tenths(s.shipMass) + ' t',
		conditionPct: s => whole(s.conditionPct) + '%',
		repairCost: s => cost(s.repairCost),
		repairFullCost: s => cost(s.repairFullCost),
		wearSpacePct: s => trimmed(s.wearSpacePct) + '%',
		wearLandingPct: s => trimmed(s.wearLandingPct) + '%',
		obsId: s => s.obsId,
		padCount: s => whole(s.padCount),
		planetCount: s => whole(s.planetCount),
		ownPadId: s => s.ownPadId,
		ownPanelId: s => s.ownPanelId,
		ownBatteryId: s => s.ownBatteryId,
		claimOwnerTag: s => ownerLabel(s.claimOwner, s.index),
		railName: s => s.railName,
		speedMin: s => whole(s.speedMin) + ' px/s',
		speedCap: s => whole(s.speedCap) + ' px/s',
		padLift: s => whole(s.padLift) + ' px/s',
		padCharge: s => money(s.padCharge),
		padCapacity: s => money(s.padCapacity) + ' kWh',
		ownFreeKwh: s => money(s.ownFreeKwh) + ' kWh',
		waitSec: s => whole(s.waitSec) + ' s',
		waitGainKwh: s => money(s.waitGainKwh) + ' kWh',
		minFee: s => cost(s.minFee),
		commercialPadId: s => s.commercialPadId,
		commercialBase: s => cost(s.commercialBase),
		commercialKwh: s => cost(s.commercialKwh),
		commercialLift: s => whole(s.commercialLift) + ' px/s',
		commercialMinFee: s => cost(s.commercialMinFee),
		taxPerKwh: s => cost(s.taxPerKwh),
		nextPadId: s => s.nextPadId,
		nextPadCost: s => cost(s.nextPadCost),
		nextPadCap: s => whole(s.nextPadCap) + ' px/s',
		lockedPadId: s => s.lockedPadId,
		engineId: s => s.engineId || 'no engine',
		tankId: s => s.tankId || 'no tank',
		fuelGauge: s => tenths(s.fuelKg) + ' / ' + whole(s.fuelCap) + ' kg',
		fuelPrice: s => s.fuelPrice <= EPS ? 'free' : money(s.fuelPrice) + '/kg',
		fuelKgPerKwh: s => trimmed(s.fuelKgPerKwh) + ' kg/kWh',
		fuelStep: s => trimmed(s.fuelStep) + ' kg',
		fuelStepCost: s => cost(s.fuelStepCost),
		fuelStepKwh: s => money(s.fuelStepKwh) + ' kWh',
		produceKg: s => whole(s.produceKg) + ' kg',
		produceKwh: s => money(s.produceKwh) + ' kWh',
		produceBtnKg: s => {
			const kg = s.produceKg > 0 ? s.produceKg : Math.max(1, Math.min(s.fuelStep, Math.ceil(s.fuelRoom)));
			return whole(kg) + ' kg';
		},
		produceBtnKwh: s => {
			const kg = s.produceKg > 0 ? s.produceKg : Math.max(1, Math.min(s.fuelStep, Math.ceil(s.fuelRoom)));
			return money(s.fuelKgPerKwh > 0 ? kg / s.fuelKgPerKwh : 0) + ' kWh';
		},
		buyKg: s => (s.buyKg > EPS && s.buyKg + EPS < s.fuelStep ? tenths(s.buyKg) : whole(s.buyKg)) + ' kg',
		buyCost: s => cost(s.buyCost),
		buyBtnKg: s => {
			const kg = s.buyKg > EPS ? s.buyKg : Math.min(s.fuelStep, s.fuelRoom);
			return (kg > EPS && kg + EPS < s.fuelStep ? tenths(kg) : whole(kg)) + ' kg';
		},
		buyBtnCost: s => {
			const kg = s.buyKg > EPS ? s.buyKg : Math.min(s.fuelStep, s.fuelRoom);
			return cost(kg * s.fuelPrice);
		},
		shipDv: s => tenths(s.shipDv) + ' px/s',
		corruptionPct: s => whole(s.corruptionPct) + '%',
		rebelStart: s => whole(s.rebelStart) + '%',
		bribeCoef: s => trimmed(s.bribeCoef),
		bribeAmount: s => money(s.bribeAmount),
		afterBribePurse: s => money(s.purse + s.bribeAmount),
		bribeRot: s => money(s.bribeRot),
		bribeAfterPct: s => whole(s.bribeAfterPct) + '%',
		bribeArrestPct: s => whole(s.bribeArrestPct) + '%',
		sportPlanetTag: s => planetLabel(s.sportPlanet),
		sportMinLength: s => whole(s.sportMinLength) + ' px',
		sportReward: s => money(s.sportReward),
		sportLeft: s => whole(s.sportLeftSec) + ' s',
		contractSummary: s => s.contractOpen
			? 'active to ' + planetLabel(s.contractTarget) + ' for +' + money(s.contractReward)
			: s.offeredCount > 0
			? whole(s.offeredCount) + ' offered, up to +' + money(s.offeredTopReward)
			: 'none offered now'
	});

	/* Verified CTA metadata: gui_comms maps each id to its real page handler. */
	const H_ACTIONS = Object.freeze({
		'slower-shot': Object.freeze({
			id: 'slower-shot',
			label: 'aim {speedCap}',
			when: 'can-slower-shot',
			enabled: 'can-slower-shot',
			costly: false
		}),
		repair: Object.freeze({
			id: 'repair',
			label: 'repair · {repairCost}',
			when: 'can-offer-repair',
			enabled: 'can-repair',
			costly: true
		}),
		commercial: Object.freeze({
			id: 'commercial',
			label: 'commercial {commercialPadId} · {commercialMinFee}',
			when: 'can-offer-commercial',
			enabled: 'can-pay-commercial',
			costly: true
		}),
		'build-pad': Object.freeze({
			id: 'build-pad',
			label: 'build {nextPadId} · {nextPadCost}',
			when: 'can-offer-build',
			enabled: 'can-build-pad',
			costly: true
		}),
		wait: Object.freeze({
			id: 'wait',
			label: 'wait · {waitSec}',
			when: 'can-offer-wait',
			enabled: 'can-wait',
			costly: false
		}),
		evac: Object.freeze({
			id: 'evac',
			label: 'evacuate · {evacCost}',
			when: 'can-offer-evac',
			enabled: 'can-evac',
			costly: true
		}),
		'produce-fuel': Object.freeze({
			id: 'produce-fuel',
			label: 'charge → fuel +{produceBtnKg} · {produceBtnKwh}',
			when: 'fuel-need',
			enabled: 'can-produce-fuel',
			costly: false
		}),
		'buy-fuel': Object.freeze({
			id: 'buy-fuel',
			label: 'buy fuel +{buyBtnKg} · {buyBtnCost}',
			when: 'fuel-need',
			enabled: 'can-buy-fuel',
			costly: true
		}),
		bribe: Object.freeze({
			id: 'bribe',
			label: 'bribe rulers · +{bribeAmount}',
			when: 'bribe-topic-open',
			enabled: 'bribe-open',
			costly: false
		})
	});

	/* Replacement gates evaluated before a topic's lines (first true wins). */
	const H_STEPS = Object.freeze({
		'non-career': Object.freeze({
			id: 'non-career',
			when: { not: 'career-mode' },
			lines: Object.freeze([
				Object.freeze({ text: 'H covers career ships and pads; mode {ruleName} has no base purse or pad network.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'career-ended': Object.freeze({
			id: 'career-ended',
			when: 'ended',
			lines: Object.freeze([
				Object.freeze({ text: 'Career closed ({endedTag}) · purse {purse} · pads {padCount}/{planetCount}.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'at-arrest': Object.freeze({
			id: 'at-arrest',
			when: 'arrest',
			lines: Object.freeze([
				Object.freeze({ text: '{arrestWhy} ({arrestLeft} left on {planetTag}). Planning and shop actions resume when the transport releases the ship.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'in-flight': Object.freeze({
			id: 'in-flight',
			when: 'flying',
			lines: Object.freeze([
				Object.freeze({ text: 'Ship is in flight · condition {conditionPct} · purse {purse}. Land before refitting, refuelling or building.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'at-space': Object.freeze({
			id: 'at-space',
			when: 'space',
			lines: Object.freeze([
				Object.freeze({
					text: 'Ship is stranded in space · purse {purse}. Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					note: Object.freeze({ fact: 'can-evac', invert: true })
				})
			]),
			actions: Object.freeze(['evac']),
			ref: Object.freeze(['money']),
			refWhen: 'evac-short'
		})
	});

	/* Bounded one-step arithmetic over actions present on the current planet. */
	const H_LOOKAHEAD = Object.freeze({
		'slower-fee': Object.freeze({
			when: 'step-slower-fee',
			text: 'At min speed ({speedMin}), launch fee is {minFee} (fits purse {purse}).'
		}),
		'commercial-pad': Object.freeze({
			when: 'step-commercial-pad',
			text: 'Commercial {commercialPadId} here lifts to {commercialLift} from {commercialMinFee} (fits purse {purse}).'
		}),
		'bribe-repair': Object.freeze({
			when: 'step-bribe-repair',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering repair {repairCost} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-fee': Object.freeze({
			when: 'step-bribe-fee',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering launch {feeNeed} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-build': Object.freeze({
			when: 'step-bribe-build',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering {nextPadId} {nextPadCost} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-evac': Object.freeze({
			when: 'step-bribe-evac',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering the full evacuation fare {evacFee} (one per visit, +{bribeRot} rot).'
		}),
		'charge-fuel': Object.freeze({
			when: 'step-charge-fuel',
			text: 'Own pad holds {ownFreeKwh} unreserved: converts +{produceKg} ({produceKwh}) with no purse cost.'
		})
	});

	const H_TOPICS = Object.freeze({
		leave: Object.freeze({
			id: 'leave',
			ask: 'why is launch blocked?',
			rank: 0,
			when: 'launch-blocked',
			includeReasons: true,
			steps: Object.freeze(['non-career', 'career-ended', 'in-flight']),
			lines: Object.freeze([
				Object.freeze({
					text: 'No launch blocker is active on {planetTag} ({railName}, cap {speedCap}, min fee {minFee}, purse {purse}).',
					when: Object.freeze({ not: 'launch-blocked' })
				}),
				Object.freeze({
					text: 'Transport releases in {arrestLeft} on {planetTag}.',
					when: 'arrest'
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: Object.freeze({ all: Object.freeze(['space', 'can-offer-evac']) }),
					note: Object.freeze({ fact: 'can-evac', invert: true })
				}),
				Object.freeze({
					text: 'Condition {conditionPct} · full repair {repairCost} · purse {purse}.',
					when: Object.freeze({ all: Object.freeze(['landed-open', 'worn']) }),
					note: Object.freeze({ fact: 'can-repair', invert: true })
				}),
				Object.freeze({
					text: 'Rail {railName} holds {padCharge}/{padCapacity} (lifts to {padLift} when charged).',
					when: 'pad-undercharged'
				}),
				Object.freeze({
					text: 'Wait {waitSec} adds +{waitGainKwh} solar charge.',
					when: Object.freeze({ all: Object.freeze(['pad-undercharged', 'own-pad-here']) })
				}),
				Object.freeze({
					text: 'Rail {railName} caps at {padLift} for a {shipMass} ship (min launch {speedMin}).',
					when: 'pad-underpowered'
				}),
				Object.freeze({
					text: 'Build {nextPadId}: {nextPadCost} (lifts to {nextPadCap}).',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ any: Object.freeze(['no-rail', 'pad-underpowered']) }),
						'can-offer-build'
					]) }),
					note: Object.freeze({ fact: 'can-build-pad', invert: true })
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ any: Object.freeze(['no-rail', 'pad-underpowered']) }),
						'can-offer-evac'
					]) }),
					note: Object.freeze({ fact: 'can-evac', invert: true })
				}),
				Object.freeze({
					text: 'Rail {railName} fires up to {speedCap}; lower the aimed speed to fit.',
					when: 'can-slower-shot'
				}),
				Object.freeze({
					text: 'Short {feeShort} on {railName} (purse {purse}).',
					when: Object.freeze({ all: Object.freeze(['landed-open', 'fee']) })
				})
			]),
			lookAhead: Object.freeze([
				'slower-fee', 'commercial-pad',
				Object.freeze(['bribe-repair', 'bribe-fee', 'bribe-build', 'bribe-evac'])
			]),
			ref: Object.freeze(['money']),
			refWhen: 'leave-short',
			chips: Object.freeze(['repair', 'pad', 'money']),
			actions: Object.freeze([
				'slower-shot',
				'repair',
				'commercial',
				Object.freeze({ id: 'build-pad', when: Object.freeze({ any: Object.freeze(['no-rail', 'cap', 'fee']) }) }),
				Object.freeze({ id: 'wait', when: Object.freeze({ all: Object.freeze(['own-pad-charging', Object.freeze({ any: Object.freeze(['no-rail', 'cap']) })]) }) }),
				Object.freeze({ id: 'evac', when: Object.freeze({ any: Object.freeze(['space', 'no-rail', 'cap', 'fee']) }) })
			])
		}),

		repair: Object.freeze({
			id: 'repair',
			ask: 'ship condition and repair',
			rank: 5,
			when: Object.freeze({ all: Object.freeze(['landed-open', 'ship-worn']) }),
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({ text: 'Condition {conditionPct} · ship {shipMass} · purse {purse}.' }),
				Object.freeze({
					text: '{wornWhy}. Impulse burns and {obsId} reports stay off until repaired.',
					when: 'ship-unusable'
				}),
				Object.freeze({
					text: 'Full repair on any planet: {repairCost} ({repairFullCost} for full hull).',
					when: 'ship-worn',
					note: Object.freeze({ fact: 'can-repair', invert: true })
				}),
				Object.freeze({
					text: 'Hull is as new ({repairFullCost} for full hull).',
					when: Object.freeze({ not: 'ship-worn' })
				}),
				Object.freeze({
					text: 'Wear runs at {wearSpacePct}/s in space and {wearLandingPct} per landing.'
				})
			]),
			lookAhead: Object.freeze(['bribe-repair']),
			ref: Object.freeze(['money']),
			refWhen: 'repair-short',
			chips: Object.freeze(['leave', 'money']),
			actions: Object.freeze(['repair'])
		}),

		pad: Object.freeze({
			id: 'pad',
			ask: 'pad and rail',
			rank: 6,
			when: 'pad-topic-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: '{planetTag} · {railName} · cap {speedCap} (full {padLift}, min {speedMin}) · purse {purse}.'
				}),
				Object.freeze({
					text: 'The Empire owns {planetTag}: launches are free and charged; no building or claims here.',
					when: 'at-capital'
				}),
				Object.freeze({
					text: 'Own pad: {ownPadId} · {ownPanelId} · {ownBatteryId} · {padCharge}/{padCapacity}.',
					when: 'own-pad-here'
				}),
				Object.freeze({
					text: 'Wait {waitSec} adds +{waitGainKwh} solar charge.',
					when: 'own-pad-charging'
				}),
				Object.freeze({
					text: 'You own no pad on {planetTag} (pads {padCount}/{planetCount}); standing min fee is {minFee}.',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ not: 'own-pad-here' }),
						Object.freeze({ not: 'at-capital' })
					]) })
				}),
				Object.freeze({
					text: 'Commercial {commercialPadId}: {commercialBase} + {commercialKwh}/kWh (from {commercialMinFee}, lifts to {commercialLift}).',
					when: Object.freeze({ all: Object.freeze(['commercial-available', Object.freeze({ not: 'own-pad-here' })]) })
				}),
				Object.freeze({
					text: 'Build {nextPadId} on {planetTag}: {nextPadCost} (lifts {shipMass} to {nextPadCap}).',
					when: 'can-offer-build',
					note: Object.freeze({ fact: 'can-build-pad', invert: true })
				}),
				Object.freeze({
					text: 'Next rail {lockedPadId} needs science first.',
					when: 'pad-locked-science'
				}),
				Object.freeze({
					text: 'Seized planet: no building here; commercial fee applies.',
					when: 'pad-blocked-seized'
				}),
				Object.freeze({
					text: 'Claimed by {claimOwnerTag}: no building here; use the standing rail or commercial {commercialPadId}.',
					when: 'pad-blocked-owner'
				}),
				Object.freeze({
					text: 'Guest launches on your rails pay you {taxPerKwh}/kWh × rail tier; fuel purchases pay no owner.',
					when: Object.freeze({ not: 'at-capital' })
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: 'can-offer-evac',
					note: Object.freeze({ fact: 'can-evac', invert: true })
				})
			]),
			lookAhead: Object.freeze([
				'commercial-pad',
				Object.freeze(['bribe-build', 'bribe-evac'])
			]),
			ref: Object.freeze(['money']),
			refWhen: 'pad-short',
			chips: Object.freeze(['leave', 'fuel', 'money']),
			actions: Object.freeze(['build-pad', 'wait', 'commercial', 'evac'])
		}),

		money: Object.freeze({
			id: 'money',
			ask: 'no money',
			rank: 10,
			when: 'landed-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({ text: 'Money can be earned (purse {purse}):' }),
				Object.freeze({
					text: '· flying past planets with a working {obsId}',
					note: Object.freeze({ fact: 'reports-active', invert: true })
				}),
				Object.freeze({
					text: '· taking the rulers’ offer on {planetTag}: +{bribeAmount} (one per visit until you leave {planetTag}; +{bribeRot} rot)',
					when: 'bribe-open'
				}),
				Object.freeze({
					text: '· waiting on {planetTag} for visit value to grow (rulers’ offer is +{bribeAmount} now, one per visit)',
					when: 'bribe-waiting'
				}),
				Object.freeze({
					text: '· rulers’ offer on {planetTag}: already taken this visit (resets after another planet)',
					when: 'bribe-taken'
				}),
				Object.freeze({
					text: '· winning the sport slot on {sportPlanetTag}: land ≥ {sportMinLength} for +{sportReward} ({sportLeft} left)',
					when: 'sport-open'
				}),
				Object.freeze({
					text: '· winning the sport slot',
					when: Object.freeze({ not: 'sport-open' }),
					note: Object.freeze({ text: 'nothing on the board now', when: Object.freeze({ not: 'sport-open' }) })
				}),
				Object.freeze({
					text: '· guest launches on your rails ({taxPerKwh}/kWh × rail tier · pads {padCount}/{planetCount})',
					when: 'own-pad-any'
				}),
				Object.freeze({
					text: '· guest launches on your rails ({taxPerKwh}/kWh × rail tier)',
					when: Object.freeze({ not: 'own-pad-any' }),
					note: Object.freeze({ fact: 'own-pad-any', invert: true })
				}),
				Object.freeze({
					text: '· completing a contract leg ({contractSummary})'
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null,
			chips: Object.freeze(['bribe', 'pad', 'repair']),
			actions: Object.freeze([])
		}),

		fuel: Object.freeze({
			id: 'fuel',
			ask: 'fuel and tank',
			rank: 12,
			when: 'landed-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: 'Tank {fuelGauge} ({engineId} · {tankId} · Δv {shipDv}) · purse {purse}.',
					when: 'fuel-ready'
				}),
				Object.freeze({
					text: 'Tank {fuelGauge} ({engineId} · {tankId}) · purse {purse}. Fit an impulse engine and a fuel tank under ship refit first.',
					when: Object.freeze({ not: 'fuel-ready' })
				}),
				Object.freeze({
					text: 'Rate: {fuelPrice} on any planet ({fuelStep} = {fuelStepCost}), or {fuelKgPerKwh} from own pad charge ({fuelStep} = {fuelStepKwh}).'
				}),
				Object.freeze({
					text: 'Tanks never refill for free, and fuel purchases pay no pad owner.'
				}),
				Object.freeze({
					text: 'Tank is full.',
					when: 'fuel-full'
				}),
				Object.freeze({
					text: 'Own pad converts +{produceKg} ({produceKwh} of {ownFreeKwh} unreserved).',
					when: 'can-produce-fuel'
				}),
				Object.freeze({
					text: 'Own pad conversion',
					when: Object.freeze({ all: Object.freeze(['fuel-need', Object.freeze({ not: 'can-produce-fuel' })]) }),
					note: Object.freeze({ fact: 'can-produce-fuel', invert: true })
				}),
				Object.freeze({
					text: 'Purse buys +{buyKg} for {buyCost}.',
					when: 'can-buy-fuel'
				}),
				Object.freeze({
					text: 'Fuel purchase',
					when: Object.freeze({ all: Object.freeze(['fuel-need', Object.freeze({ not: 'can-buy-fuel' })]) }),
					note: Object.freeze({ fact: 'can-buy-fuel', invert: true })
				})
			]),
			lookAhead: Object.freeze(['charge-fuel']),
			ref: Object.freeze(['money']),
			refWhen: 'fuel-buy-short',
			chips: Object.freeze(['pad', 'money']),
			actions: Object.freeze(['produce-fuel', 'buy-fuel'])
		}),

		bribe: Object.freeze({
			id: 'bribe',
			ask: 'bribe and its rot',
			rank: 14,
			when: 'bribe-topic-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: '{planetTag} corruption {corruptionPct} · purse {purse}.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: 'Rulers pay visit value × {bribeCoef}, one per visit until you land on another planet.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: 'Current offer: +{bribeAmount} · adds +{bribeRot} rot (to {bribeAfterPct}) and takes back this landing’s report so the world keeps rotting.',
					when: 'bribe-open'
				}),
				Object.freeze({
					text: 'Current offer: +{bribeAmount} · wait while landed for visit value to grow.',
					when: 'bribe-waiting'
				}),
				Object.freeze({
					text: 'Already taken on this visit; opens again after visiting another planet.',
					when: 'bribe-taken'
				}),
				Object.freeze({
					text: 'Rebels hold {planetTag}; rulers make no offer here.',
					when: 'bribe-rebel'
				}),
				Object.freeze({
					text: 'Above {rebelStart} rot, taking a bribe rolls arrest ({bribeArrestPct} at {bribeAfterPct}): {arrestSeconds} Capital transport and rebellion risk.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: '{planetTag} makes no bribe offers.',
					when: Object.freeze({ not: 'bribe-topic-open' })
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze(['money']),
			refWhen: null,
			chips: Object.freeze(['money']),
			actions: Object.freeze(['bribe'])
		})
	});

	function evalWhen(expr, snapshot) {
		if (expr === null || expr === undefined) return true;
		if (typeof expr === 'string') {
			const fact = HH_FACTS[expr];
			return fact ? Boolean(fact.test(snapshot)) : false;
		}
		if (expr.not !== undefined) return !evalWhen(expr.not, snapshot);
		if (expr.all) {
			for (let i = 0; i < expr.all.length; i++) {
				if (!evalWhen(expr.all[i], snapshot)) return false;
			}
			return true;
		}
		if (expr.any) {
			for (let i = 0; i < expr.any.length; i++) {
				if (evalWhen(expr.any[i], snapshot)) return true;
			}
			return false;
		}
		return false;
	}

	function fillSlots(template, snapshot) {
		return template.replace(/\{([a-zA-Z]+)\}/g, (match, name) => {
			const reader = H_SLOTS[name];
			if (!reader) throw new Error('unknown H slot: ' + name);
			return String(reader(snapshot));
		});
	}

	function renderLine(entry, snapshot) {
		if (entry.when !== undefined && !evalWhen(entry.when, snapshot)) return '';
		let text = fillSlots(entry.text, snapshot);
		const note = entry.note;
		if (!note) return text;
		if (note.fact) {
			const fact = HH_FACTS[note.fact];
			const holds = fact ? Boolean(fact.test(snapshot)) : false;
			const show = note.invert ? !holds : holds;
			if (!show) return text;
			const why = fact ? fact.why(snapshot) : '';
			return why ? text.replace(/\.$/, '') + ' — ' + why + (text.endsWith('.') ? '.' : '') : text;
		}
		if (note.when === undefined || evalWhen(note.when, snapshot)) {
			const extra = fillSlots(note.text, snapshot);
			if (extra) return text.replace(/\.$/, '') + ' — ' + extra + (text.endsWith('.') ? '.' : '');
		}
		return text;
	}

	function pushLookAhead(out, entries, snapshot) {
		if (!entries) return;
		for (let i = 0; i < entries.length; i++) {
			const item = entries[i];
			if (Array.isArray(item)) {
				for (let j = 0; j < item.length; j++) {
					const rule = H_LOOKAHEAD[item[j]];
					if (!rule || !evalWhen(rule.when, snapshot)) continue;
					out.push(fillSlots(rule.text, snapshot));
					break;
				}
				continue;
			}
			const rule = H_LOOKAHEAD[item];
			if (rule && evalWhen(rule.when, snapshot)) out.push(fillSlots(rule.text, snapshot));
		}
	}

	function appendTopicLines(out, topic, snapshot, seenRefs) {
		if (topic.includeReasons && snapshot.reasons.length > 0) {
			for (let i = 0; i < snapshot.reasons.length; i++) {
				const fact = HH_FACTS[snapshot.reasons[i].id];
				const line = fact ? fact.why(snapshot) : '';
				if (!line) continue;
				out.push(i === 0 ? line : 'Also blocked: ' + line);
			}
		}
		for (let i = 0; i < topic.lines.length; i++) {
			const line = renderLine(topic.lines[i], snapshot);
			if (line) out.push(line);
		}
		pushLookAhead(out, topic.lookAhead, snapshot);
		if (!topic.ref || !topic.ref.length) return;
		if (topic.refWhen === null || !evalWhen(topic.refWhen, snapshot)) return;
		for (let i = 0; i < topic.ref.length; i++) {
			const refId = topic.ref[i];
			if (seenRefs[refId]) continue;
			const refTopic = H_TOPICS[refId];
			if (!refTopic) continue;
			seenRefs[refId] = true;
			appendTopicLines(out, refTopic, snapshot, seenRefs);
		}
	}

	function resolveActions(entries, snapshot) {
		const out = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const id = typeof entry === 'string' ? entry : entry.id;
			if (typeof entry === 'object' && entry.when !== undefined && !evalWhen(entry.when, snapshot)) continue;
			const spec = H_ACTIONS[id];
			if (!spec || !evalWhen(spec.when, snapshot)) continue;
			const enabled = evalWhen(spec.enabled, snapshot);
			const fact = HH_FACTS[spec.enabled];
			out.push(Object.freeze({
				id: spec.id,
				label: fillSlots(spec.label, snapshot),
				enabled: enabled,
				costly: Boolean(spec.costly && !enabled),
				why: enabled || !fact ? '' : fact.why(snapshot)
			}));
		}
		return Object.freeze(out);
	}

	/* Top live finding for `what should I do?`; bribes are never nominated. */
	function topTopicId(snapshot) {
		if (!snapshot.careerMode || snapshot.ended !== GravityGame.CAREER_OPEN || snapshot.flying) {
			return 'leave';
		}
		if (snapshot.reasons.length > 0) return 'leave';
		if (HH_FACTS['ship-worn'].test(snapshot)) return 'repair';
		if (HH_FACTS['own-pad-charging'].test(snapshot)) return 'pad';
		if (HH_FACTS['fuel-need'].test(snapshot)) return 'fuel';
		return 'money';
	}

	function chipList(snapshot, asked) {
		const seen = asked || Object.create(null);
		const candidates = [];
		const ids = Object.keys(H_TOPICS);
		for (let i = 0; i < ids.length; i++) {
			const topic = H_TOPICS[ids[i]];
			if (!evalWhen(topic.when, snapshot)) continue;
			candidates.push(topic);
		}
		candidates.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			const aSeen = seen[a.id] ? 1 : 0;
			const bSeen = seen[b.id] ? 1 : 0;
			return aSeen - bSeen;
		});
		const out = [Object.freeze({ id: H_META_ID, ask: H_META_ASK })];
		const added = Object.create(null);
		added[H_META_ID] = true;
		for (let i = 0; i < candidates.length && out.length < CHIP_CAP; i++) {
			const topic = candidates[i];
			if (added[topic.id]) continue;
			added[topic.id] = true;
			out.push(Object.freeze({ id: topic.id, ask: topic.ask }));
		}
		return Object.freeze(out);
	}

	function firstMatchingStep(stepIds, snapshot) {
		if (!stepIds) return null;
		for (let i = 0; i < stepIds.length; i++) {
			const step = H_STEPS[stepIds[i]];
			if (step && evalWhen(step.when, snapshot)) return step;
		}
		return null;
	}

	function renderTopic(id, snapshot, asked) {
		const meta = id === H_META_ID || !id;
		const resolvedId = meta ? topTopicId(snapshot) : id;
		const topic = H_TOPICS[resolvedId] || H_TOPICS.leave;
		const question = meta ? H_META_ASK : topic.ask;
		const lines = [];
		const seenRefs = Object.create(null);
		seenRefs[topic.id] = true;
		const step = firstMatchingStep(topic.steps, snapshot);
		let actionIds = topic.actions;
		if (step) {
			appendTopicLines(lines, step, snapshot, seenRefs);
			actionIds = step.actions;
		} else {
			appendTopicLines(lines, topic, snapshot, seenRefs);
		}
		return Object.freeze({
			id: meta ? H_META_ID : topic.id,
			resolvedId: topic.id,
			question: question,
			text: [...new Set(lines)].join('\n'),
			actions: resolveActions(actionIds, snapshot),
			chips: chipList(snapshot, asked)
		});
	}

	/* --- static copy & schema validator -------------------------------- */

	function checkWhen(expr, where, errors) {
		if (expr === null || expr === undefined) return;
		if (typeof expr === 'string') {
			if (!HH_FACTS[expr]) errors.push(where + ': unknown fact ' + expr);
			return;
		}
		if (typeof expr !== 'object') {
			errors.push(where + ': invalid when expression');
			return;
		}
		const keys = Object.keys(expr);
		if (keys.length !== 1) {
			errors.push(where + ': combinator must have one key');
			return;
		}
		if (expr.not !== undefined) return checkWhen(expr.not, where + '.not', errors);
		const list = expr.all || expr.any;
		if (!Array.isArray(list) || list.length === 0) {
			errors.push(where + ': unknown or empty combinator ' + keys[0]);
			return;
		}
		for (let i = 0; i < list.length; i++) checkWhen(list[i], where + '[' + i + ']', errors);
	}

	function checkTemplate(text, where, errors) {
		if (typeof text !== 'string' || text.length === 0) {
			errors.push(where + ': empty copy string');
			return;
		}
		if (/[0-9]/.test(text)) errors.push(where + ': digit literal in copy: ' + text);
		const stripped = text.replace(/\{([a-zA-Z]+)\}/g, (match, name) => {
			if (!H_SLOTS[name]) errors.push(where + ': unknown slot {' + name + '}');
			return '';
		});
		if (stripped.includes('{') || stripped.includes('}')) {
			errors.push(where + ': malformed slot brace in ' + text);
		}
	}

	function checkLines(lines, where, errors) {
		for (let i = 0; i < lines.length; i++) {
			const entry = lines[i];
			const tag = where + '.lines[' + i + ']';
			checkTemplate(entry.text, tag, errors);
			if (entry.when !== undefined) checkWhen(entry.when, tag + '.when', errors);
			if (!entry.note) continue;
			if (entry.note.fact !== undefined) {
				if (!HH_FACTS[entry.note.fact]) {
					errors.push(tag + '.note: unknown fact ' + entry.note.fact);
				}
			} else {
				checkTemplate(entry.note.text, tag + '.note', errors);
				if (entry.note.when !== undefined) checkWhen(entry.note.when, tag + '.note.when', errors);
			}
		}
	}

	function checkRefCycle(id, visiting, done, errors) {
		if (done[id]) return;
		if (visiting[id]) {
			errors.push('ref cycle through topic ' + id);
			return;
		}
		visiting[id] = true;
		const topic = H_TOPICS[id];
		const refs = topic && topic.ref ? topic.ref : [];
		for (let i = 0; i < refs.length; i++) {
			if (H_TOPICS[refs[i]]) checkRefCycle(refs[i], visiting, done, errors);
		}
		visiting[id] = false;
		done[id] = true;
	}

	function validateCopy() {
		const errors = [];
		checkTemplate(H_META_ASK, 'H_META_ASK', errors);
		for (let i = 0; i < LAUNCH_GATE_ORDER.length; i++) {
			const gate = LAUNCH_GATE_ORDER[i];
			if (!HH_FACTS[gate]) errors.push('missing launch-gate fact ' + gate);
		}
		for (const key of Object.keys(HH_FACTS)) {
			const fact = HH_FACTS[key];
			if (typeof fact.test !== 'function') errors.push('HH_FACTS.' + key + ': missing test');
			if (typeof fact.why !== 'function') errors.push('HH_FACTS.' + key + ': missing why');
			else if (/[0-9]/.test(String(fact.why))) {
				errors.push('HH_FACTS.' + key + '.why: digit literal');
			}
		}
		for (const slot of Object.keys(H_SLOTS)) {
			if (/[0-9]/.test(slot)) errors.push('H_SLOTS.' + slot + ': digit in slot name');
			if (typeof H_SLOTS[slot] !== 'function') errors.push('H_SLOTS.' + slot + ': not a function');
		}
		for (const id of Object.keys(H_ACTIONS)) {
			const act = H_ACTIONS[id];
			checkTemplate(act.label, 'H_ACTIONS.' + id + '.label', errors);
			checkWhen(act.when, 'H_ACTIONS.' + id + '.when', errors);
			checkWhen(act.enabled, 'H_ACTIONS.' + id + '.enabled', errors);
		}
		for (const id of Object.keys(H_STEPS)) {
			const step = H_STEPS[id];
			checkWhen(step.when, 'H_STEPS.' + id + '.when', errors);
			checkLines(step.lines, 'H_STEPS.' + id, errors);
			for (const act of step.actions) {
				if (!H_ACTIONS[act]) errors.push('H_STEPS.' + id + ': unknown action ' + act);
			}
			for (const ref of step.ref) {
				if (!H_TOPICS[ref]) errors.push('H_STEPS.' + id + ': unknown ref ' + ref);
			}
			if (step.refWhen !== null) checkWhen(step.refWhen, 'H_STEPS.' + id + '.refWhen', errors);
		}
		for (const id of Object.keys(H_LOOKAHEAD)) {
			const rule = H_LOOKAHEAD[id];
			checkWhen(rule.when, 'H_LOOKAHEAD.' + id + '.when', errors);
			checkTemplate(rule.text, 'H_LOOKAHEAD.' + id + '.text', errors);
		}
		const visiting = Object.create(null);
		const done = Object.create(null);
		for (const id of Object.keys(H_TOPICS)) {
			const topic = H_TOPICS[id];
			const tag = 'H_TOPICS.' + id;
			if (!Number.isInteger(topic.rank)) errors.push(tag + ': rank must be integer');
			checkTemplate(topic.ask, tag + '.ask', errors);
			checkWhen(topic.when, tag + '.when', errors);
			checkLines(topic.lines, tag, errors);
			for (const stepId of topic.steps) {
				if (!H_STEPS[stepId]) errors.push(tag + ': unknown step ' + stepId);
			}
			for (const entry of topic.lookAhead) {
				const list = Array.isArray(entry) ? entry : [entry];
				for (const key of list) {
					if (!H_LOOKAHEAD[key]) errors.push(tag + ': unknown lookAhead ' + key);
				}
			}
			for (const refId of topic.ref) {
				if (!H_TOPICS[refId]) errors.push(tag + ': unknown ref ' + refId);
			}
			if (topic.refWhen !== null) checkWhen(topic.refWhen, tag + '.refWhen', errors);
			for (const chipId of topic.chips) {
				if (!H_TOPICS[chipId]) errors.push(tag + ': unknown chip ' + chipId);
			}
			for (let a = 0; a < topic.actions.length; a++) {
				const entry = topic.actions[a];
				const actId = typeof entry === 'string' ? entry : entry.id;
				if (!H_ACTIONS[actId]) errors.push(tag + ': unknown action ' + actId);
				if (typeof entry === 'object' && entry.when !== undefined) {
					checkWhen(entry.when, tag + '.actions[' + a + '].when', errors);
				}
				if (actId === 'bribe' && id !== 'bribe') {
					errors.push(tag + ': bribe must never be ranked in another topic’s actions');
				}
			}
			checkRefCycle(id, visiting, done, errors);
		}
		return errors;
	}

	const CommsCopy = Object.freeze({
		H_META_ID,
		H_META_ASK,
		CHIP_CAP,
		EXCHANGE_CAP,
		LAUNCH_GATE_ORDER,
		HH_FACTS,
		H_SLOTS,
		H_ACTIONS,
		H_STEPS,
		H_LOOKAHEAD,
		H_TOPICS,
		buildSnapshot,
		evalWhen,
		fillSlots,
		topTopicId,
		chipList,
		renderTopic,
		validateCopy
	});

	if (typeof module !== 'undefined' && module.exports) module.exports = CommsCopy;
	else root.CommsCopy = CommsCopy;
})(typeof globalThis !== 'undefined' ? globalThis : this);
