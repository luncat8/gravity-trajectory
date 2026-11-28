/*
 * H's facts: the composition checklist, reason lookup, board summary, the
 * frozen snapshot (buildSnapshot), predicates, and the HH_FACTS and H_SLOTS
 * registries — together because a new live fact touches all three.
 * not here: authored topic copy → comms_topics.js
 *
 * Part of CommsCopy (load order: PARTS in comms_copy.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.CommsCopy.part('comms_facts.js', attach)
)(function (CommsCopy, inner) {
	'use strict';
	const {
		GravitySim, OrbitEcon, OrbitTech, GravityGame, EPS, CENT, RETURN_LANDINGS_FOR_TOW, money,
		cost, tenths, trimmed, whole, planetLabel, ownerLabel
	} = inner;

	/* ── composition checklist ── rows, text, checklist, missing text */

	/* The fair-start composition gate as rows, one per requirement, so the
	 * answer can list what this map is missing before what it already has.
	 * `report` is { planets, players, composition: startComposition(...) }. */
	function compositionRows(report) {
		const comp = report.composition;
		if (!comp || !Array.isArray(comp.missing)) return [];
		const missing = comp.missing;
		const settled = Number.isInteger(comp.settled) ? comp.settled : report.planets;
		const rows = [
			{ ok: !missing.includes('planets'), label: 'planets', have: settled, need: comp.minimal, min: true },
			{ ok: !missing.includes('light'), label: 'starter-accessible planets', have: comp.light, need: report.players, min: false }
		];
		if (GravityGame.specialPlanets()) {
			rows.push({ ok: !missing.includes('specials'), label: 'Capital and ARF on the map', have: -1, need: -1, min: false });
		}
		rows.push({ ok: !missing.includes('emc2'), label: 'EMC-2 heavy planets', have: comp.heavyEmc2, need: 1, min: true });
		rows.push({ ok: !missing.includes('emc3'), label: 'EMC-3 heavy planets', have: comp.heavyEmc3, need: 1, min: true });
		return rows;
	}

	function compositionRowText(row) {
		const mark = row.ok ? '✓ ' : '✗ ';
		if (row.need < 0) return mark + row.label;
		const count = row.min ? row.have + ' (at least ' + row.need + ')' : row.have + ' of ' + row.need;
		return mark + row.label + ': ' + count + (row.ok ? '' : ' · ' + (row.need - row.have) + ' more needed');
	}

	/* the multi-line checklist H answers with: missing first, then met */
	function compositionChecklist(report) {
		const rows = compositionRows(report);
		if (!rows.length) return '';
		const missing = rows.filter(row => !row.ok).map(compositionRowText);
		const met = rows.filter(row => row.ok).map(compositionRowText);
		const parts = [];
		if (missing.length) parts.push('Missing on this map:\n' + missing.join('\n'));
		if (met.length) parts.push((missing.length ? 'Already met:' : 'Map check, all met:') + '\n' + met.join('\n'));
		return parts.join('\n\n');
	}

	/* the one-line call banner: only the shortfalls */
	function compositionMissingText(report) {
		const rows = compositionRows(report).filter(row => !row.ok);
		if (!rows.length) return 'all composition requirements met';
		return 'missing ' + rows.map(row => row.need < 0 ? row.label
			: row.label + ' ' + row.have + '/' + row.need).join(' · ');
	}

	/* ── reasons & board ── shortfalls, reason lookup, buildable pads, board summary */

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

	/* ── snapshot ── return tow, baseSnapshot, buildSnapshot */

	function returnTowVisit(career) {
		if (!GravityGame.canEvacuate(career)) return null;
		const visit = GravityGame.returnLandingVisit(career);
		return visit && visit.count >= RETURN_LANDINGS_FOR_TOW ? visit : null;
	}

	function baseSnapshot(rule, second, flying, waitLocked, pace, obsRecord, commercialPad) {
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
			evacAvailable: false,
			returnTow: false,
			pace: pace,
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
			offeredTopReward: 0,
			/* 0.7.47 WS3/WS4: the live roster's fairness and the seat-search
			 * report, fed in by the page (opts.roster / opts.search) */
			rosterOk: true,
			rosterPlanets: 0,
			rosterCap: GravityGame.CLASSIC_PLANETS || 48,
			rosterPlayers: 0,
			rosterDetails: '',
			searchActive: false,
			searchTier: 0,
			searchWeakest: 0,
			searchUnmet: '',
			searchProgress: 0
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
		const snap = baseSnapshot(rule, second, flying, waitLocked, opts.pace || 1, obsRecord, commercialPad);
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
			evacAvailable: !flying && GravityGame.canEvacuate(career),
			returnTow: !flying && returnTowVisit(career) !== null,
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
				? OrbitTech.solarCharge(ownPad.panel, career.light[at],
					GravityGame.careerWaitPadSeconds()) : 0,
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
		}, boardSummary(career, clockSteps), {
			/* 0.7.47 WS3/WS4: the page feeds the live roster's fairness and the
			 * seat-search report in, so H can report them */
			rosterOk: opts.rosterOk !== false,
			rosterPlanets: opts.rosterPlanets || 0,
			rosterCap: opts.rosterCap || GravityGame.CLASSIC_PLANETS || 48,
			rosterPlayers: opts.rosterPlayers || 0,
			rosterDetails: opts.rosterDetails || '',
			searchActive: Boolean(opts.searchActive),
			searchTier: opts.searchTier || 0,
			searchWeakest: opts.searchWeakest || 0,
			searchUnmet: opts.searchUnmet || '',
			searchProgress: opts.searchProgress || 0,
			searchPay: opts.searchPay || '',
			searchHasBest: Boolean(opts.searchHasBest),
			searchDecision: opts.searchDecision || '',
			searchPlan: Boolean(opts.searchPlan),
			searchCanAdvance: Boolean(opts.searchCanAdvance)
		}));
	}

	/* ── predicates ── pay, landed, pad charge and power, commercial, fuel, bribe, politics */

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
		return landedOpen(s) && s.planet !== s.capitalPlanet &&
			s.padOwner !== GravityGame.OWNER_EMPTY && !s.commercialSelected &&
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
		return landedOpen(s) && s.planet !== s.capitalPlanet &&
			s.planet !== s.arfPlanet && s.padOwner !== GravityGame.OWNER_EMPTY;
	}

	/* ── fact & slot registries ── HH_FACTS, H_SLOTS */

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
				(padUnderpowered(s) && s.evacAvailable && !canPay(s.purse, s.evacFee))),
			why: s => 'purse ' + money(s.purse)
		}),
		'can-offer-evac': Object.freeze({
			test: s => s.evacAvailable,
			why: () => 'nothing to evacuate'
		}),
		'can-evac': Object.freeze({
			test: s => s.evacAvailable && !s.waitLocked,
			why: s => s.evacAvailable ? 'clock busy' : 'nothing to evacuate'
		}),
		'evac-short': Object.freeze({
			test: s => s.evacAvailable && !canPay(s.purse, s.evacFee),
			why: s => 'reduced fare ' + cost(s.evacCost) + ' · takes ' + H_SLOTS.evacSeconds(s)
		}),
		'return-tow': Object.freeze({
			test: s => s.returnTow,
			why: () => 'no recent return streak'
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
			test: s => landedOpen(s) && s.planet !== s.capitalPlanet &&
				s.padOwner !== GravityGame.OWNER_EMPTY,
			why: () => 'no commercial rail here'
		}),
		'leave-short': Object.freeze({
			test: s => landedOpen(s) && (
				hasReason(s, 'fee') ||
				(hasReason(s, 'worn') && !canPay(s.purse, s.repairCost)) ||
				((hasReason(s, 'no-rail') || padUnderpowered(s)) && (
					(s.nextPadId !== '' && !canPay(s.purse, s.nextPadCost)) ||
					(s.evacAvailable && !canPay(s.purse, s.evacFee))))),
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
			test: s => bribeOpen(s) && s.evacAvailable &&
				!canPay(s.purse, s.evacFee) && canPay(s.purse + s.bribeAmount, s.evacFee),
			why: () => ''
		}),
		'step-charge-fuel': Object.freeze({
			test: s => fuelNeed(s) && !(s.buyKg > EPS) && s.produceKg > 0,
			why: () => ''
		}),
		/* 0.7.47 WS3/WS4: the roster fairness and seat-search report */
		'roster-unfair': Object.freeze({
			test: s => s.careerMode && s.rosterOk === false,
			why: s => 'the ' + whole(s.rosterPlanets) + '-planet map does not meet the fair-start composition for ' +
				whole(s.rosterPlayers) + ' companies'
		}),
		'search-active': Object.freeze({
			test: s => s.searchActive,
			why: () => 'no search is running'
		}),
		'can-drop-player': Object.freeze({
			test: s => s.careerMode && s.rosterOk === false && s.rosterPlayers > 1,
			why: () => 'already one company'
		}),
		'can-add-planet': Object.freeze({
			test: s => s.careerMode && s.rosterOk === false && s.rosterPlanets > 0 &&
				s.rosterPlanets < (s.rosterCap || GravityGame.CLASSIC_PLANETS || 48),
			why: () => 'world is full'
		}),
		'search-has-plan': Object.freeze({
			test: s => s.searchActive && s.searchPlan,
			why: () => ''
		}),
		'search-can-start': Object.freeze({
			test: s => s.searchActive && (s.searchPlan ||
				(s.searchDecision === 'tier-end' && !s.searchCanAdvance)),
			why: s => s.searchUnmet ? 'still searching · ' + s.searchUnmet : 'nothing to start'
		}),

		'search-best': Object.freeze({
			test: s => s.searchActive && s.searchHasBest,
			why: () => ''
		}),
		'search-unmet': Object.freeze({
			test: s => s.searchActive && Boolean(s.searchUnmet),
			why: () => ''
		}),
		'search-running': Object.freeze({
			test: s => s.searchActive && !(s.searchDecision === 'tier-end' && !s.searchCanAdvance),
			why: () => ''
		}),
		'search-exhausted': Object.freeze({
			test: s => s.searchActive && s.searchDecision === 'tier-end' && !s.searchCanAdvance,
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
			: 'none offered now',
		/* 0.7.47 WS3/WS4 */
		rosterPlanets: s => whole(s.rosterPlanets),
		rosterPlayers: s => whole(s.rosterPlayers),
		rosterDetails: s => s.rosterDetails || 'Composition details unavailable.',
		searchTier: s => 'T' + whole(s.searchTier),
		searchWeakest: s => whole(s.searchWeakest) + '%',
		searchUnmet: s => s.searchUnmet || 'fair',
		searchProgress: s => whole(s.searchProgress) + '%',
		searchPass: s => whole(s.searchTier + 1),
		searchPay: s => s.searchPay || 'unavailable'
	});

	Object.assign(CommsCopy, {
		HH_FACTS, H_SLOTS, buildSnapshot, returnTowVisit, compositionRows, compositionChecklist,
		compositionMissingText
	});
	Object.assign(inner, {
		HH_FACTS, H_SLOTS
	});
});
