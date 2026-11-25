/*
 * Politics (0.5.12): rot growth, the per-epoch rebellion roll, arrests, seized
 * planets and rails, bribes, going quiet, uninstall refusals, pacification.
 * Owns the politics on/off switch.
 *
 * Part of GravityGame: gravity_game.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const GravitySim = node ? require('./gravity_sim.js') : root.GravitySim;
	const OrbitWorld = node ? require('./orbit_world.js') : root.OrbitWorld;
	const OrbitEcon = node ? require('./orbit_econ.js') : root.OrbitEcon;
	const OrbitTech = node ? require('./orbit_tech.js') : root.OrbitTech;
	const {
		BRIBE_OPEN, QUIET_MIN, politicsSeconds, planetProfitUnscaledAt, planetProfit, visitReports,
		TASK_MEDIC, CAREER_OPEN, SALT_POLITICS, SALT_ARREST, COMMERCIAL_PAD, setCommercial,
		refreshNetwork, padLift, refitShip, rotScaleOf, refreshMedicSlot, refreshCareerMedic,
		dropContract
	} = GravityGame;

	/* politics is a property of the shared market; the A/B switch freezes the
	 * whole clock (POLITICS=0 reproduces the 0.5.11 economy) */
	let politics = true;
	function setPolitics(on) {
		politics = Boolean(on);
		return politics;
	}
	function politicsOn() {
		return politics;
	}

	/* --- politics: rot, bribes, arrest, rebellion (0.5.12) ---------------- */

	/*
	 * The career clock every political rate is priced in: game seconds. `advancePolitics`
	 * runs once per step from GravityBot.stepCareer, so the GUI and the
	 * benches share one clock. It raises rot on every world nobody visited
	 * lately, copies the rot into the trade colonies, retires finished
	 * arrests, and rolls one rebellion per planet per epoch — never per step.
	 */
	function raiseCorruption(market, planet, amount) {
		const before = market.corruption[planet];
		const after = OrbitEcon.clampCorruption(before + amount);
		market.corruption[planet] = after;
		if (market.permanentCorruption) {
			market.corruptionFloor[planet] = Math.min(after,
				market.corruptionFloor[planet] + (after - before) * 0.1);
		}
	}

	function advancePolitics(market, trade, runStep) {
		const galaxy = market.galaxy;
		if (!politics || !galaxy || runStep === market.politicsStep) return 0;
		const previousStep = Math.max(0, market.politicsStep);
		market.politicsStep = runStep;
		const seconds = politicsSeconds(market, runStep);
		const dtSec = seconds - market.politicsSec;
		market.politicsSec = seconds;
		if (trade && trade.setCorruption && trade.corruption !== market.corruption) {
			trade.setCorruption(market.corruption);
		}
		const epoch = Math.floor(seconds / OrbitEcon.REBEL_CHECK_SECONDS);
		let seized = 0;
		const count = market.planetCount || OrbitWorld.PLANETS;
		for (let p = 0; p < count; p++) {
			if (market.planetMask && market.planetMask[p] !== 1) continue;
			if (p === market.capitalPlanet || p === market.arfPlanet) continue;
			let occupied = false;
			let reporting = false;
			for (let i = 0; i < galaxy.actors.length; i++) {
				const actor = galaxy.actors[i];
				if (actor.at !== p || actor.flying || actor.arrested) continue;
				occupied = true;
				if (visitReports(actor.ledger, market, p)) reporting = true;
			}
			/* a ship sitting on the world ages both clocks: its report grows
			 * stale at half speed and the neglect clock catches up with it */
			if (dtSec > 0 && occupied) {
				const aged = (runStep - previousStep) * 0.5;
				market.lastVisitStep[p] += aged;
				market.reportStep[p] += aged;
				market.reportPrev[p] += aged;
			}
			if (!market.rebel[p] && dtSec > 0 && reporting) {
				market.corruption[p] = Math.max(market.corruptionFloor[p],
					market.corruption[p] - OrbitEcon.CORRUPTION_REPORT_RATE * rotScaleOf() * dtSec);
			} else if (!market.rebel[p] && dtSec > 0) {
				const rate = OrbitEcon.passiveCorruptionRate(
					planetProfitUnscaledAt(market, p, runStep, market.reportStep[p])) * rotScaleOf();
				if (rate > 0) raiseCorruption(market, p, rate * dtSec);
			}
			if (market.rebel[p] || runStep < market.rebelCooldownStep[p]) continue;
			if (epoch <= market.lastCheckEpoch[p]) continue;
			/* a clean planet saves its epoch roll for when rot crosses the line */
			if (market.corruption[p] <= OrbitEcon.REBEL_START) continue;
			market.lastCheckEpoch[p] = epoch;
			if (!rebellionRoll(market, p, epoch, market.corruption[p])) continue;
			seizePlanet(market, galaxy, p, runStep);
			seized += 1;
		}
		retireArrests(galaxy, runStep);
		return seized;
	}

	/* one deterministic roll per planet per epoch: no wall time, no Math.random */
	function rebellionRoll(market, planet, epoch, corruption) {
		const chance = OrbitEcon.rebellionChance(corruption);
		if (chance <= 0) return false;
		const key = OrbitWorld.hashBits(market.politicsSeed, planet, SALT_POLITICS);
		const roll = OrbitWorld.hashBits(key, epoch, SALT_ARREST) / 4294967296;
		return roll < chance;
	}

	/* the arrested career waits for its slow transport, then is free again */
	function retireArrests(galaxy, runStep) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			if (!career.arrested || runStep < career.arrestUntilStep) continue;
			career.arrested = false;
			career.arrestUntilStep = 0;
		}
	}

	/*
	 * Seizure: every player rail on the planet becomes one commercial rail the
	 * rebels run, with the best tiers that stood there. The former owners lose
	 * the pad (and the claim), the planet can never be built on again, and a
	 * rebellion plants the patients the medical quest has to ferry out.
	 */
	function seizePlanet(market, galaxy, planet, runStep) {
		market.rebel[planet] = 1;
		market.seized[planet] = 1;
		market.rebelSinceStep[planet] = runStep;
		market.patients[planet] = OrbitEcon.MEDIC_PATIENTS;
		market.rebelCooldownStep[planet] = 0;
		market.rebelPads[planet] = seizedPad(galaxy, planet);
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			clearPad(career, planet);
		}
		refreshNetwork(galaxy);
		for (let i = 0; i < galaxy.actors.length; i++) {
			refreshMedicSlot(galaxy.actors[i], market, runStep);
		}
		return market.rebelPads[planet];
	}

	/* the seized rail: the strongest former player pad, else the commercial one */
	function seizedPad(galaxy, planet) {
		let catapult = COMMERCIAL_PAD.catapult;
		let panel = COMMERCIAL_PAD.panel;
		let battery = COMMERCIAL_PAD.battery;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= catapult.tier) continue;
			catapult = pad.catapult;
			panel = pad.panel;
			battery = pad.battery;
		}
		/* rebels keep their rail charged, so a seized planet is never a trap */
		return { catapult: catapult, panel: panel, battery: battery,
			chargeKwh: battery.capacity, reservedKwh: 0 };
	}

	function clearPad(career, planet) {
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return;
		career.padCount = career.padCount > 0 ? career.padCount - 1 : 0;
		pad.catapult = null;
		pad.panel = null;
		pad.battery = null;
		pad.chargeKwh = 0;
		pad.reservedKwh = 0;
		if (career.at === planet) {
			career.stranded = padLift(career, planet) + 1e-9 < GravitySim.SPEED_MIN;
		}
	}

	/* a medical mission ends for some other reason: unload and drop it */
	function clearMedicalCargo(career) {
		if (career.contract < 0) return false;
		const task = career.tasks[career.contract];
		if (task.kind !== TASK_MEDIC) return false;
		dropContract(career);
		return true;
	}

	/*
	 * The bribe (0.5.12, repriced 0.5.13): the local rulers pay for the visit's
	 * silence — twice the visit value (what the landing collected plus what
	 * regrew while the ship sits). Corruption governs the arrest risk rather
	 * than reducing the offer on lightly corrupted worlds. The purse
	 * and the bribe stats grow, and the rot grows with the money. One bribe per
	 * visit, and a rot-rich planet may arrest the briber and ship them to the
	 * Capital instead of paying.
	 *
	 * A bribe buys the silence of a report, so it takes that report back: the
	 * rot clock returns to the step standing before the landing (0.7.16). A
	 * bribed world therefore rots exactly like the same world left alone —
	 * plus the bribe's own increment — never like the world the ship reported
	 * to and calmed.
	 */
	const BRIBE = { ok: false, amount: 0, corruption: 0, arrested: false, reason: '' };

	/* A separate marker keeps the window closed while the value clock moves. */
	function bribeWindowOpen(market, planet) {
		return market.bribeVisitStep[planet] === BRIBE_OPEN;
	}

	function bribeRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet || career.flying) return 'not landed there';
		if (planet === market.capitalPlanet) return 'the Empire does not deal';
		if (planet === market.arfPlanet) return 'A.R.F. takes no bribes';
		if (market.rebel[planet]) return 'rebels hold the planet';
		if (!bribeWindowOpen(market, planet)) return 'already bribed this visit';
		return '';
	}

	/*
	 * The visit value is what the landing collected plus what regrew while the
	 * ship sits. The bribe is twice that value; corruption still rises and can
	 * trigger an arrest, regardless of how the offer is priced.
	 */
	function bribeAmount(market, planet, runStep) {
		const grown = planetProfit(market, planet, runStep);
		const collected = market.visitPay[planet] > 0 ? market.visitPay[planet] : 0;
		return OrbitEcon.bribeValue(collected + grown);
	}

	function acceptBribe(career, market, sim, planet, runStep) {
		BRIBE.ok = false;
		BRIBE.arrested = false;
		BRIBE.amount = 0;
		BRIBE.corruption = market ? market.corruption[planet] : 0;
		BRIBE.reason = bribeRefusal(career, market, planet);
		if (BRIBE.reason !== '') return BRIBE;
		const amount = bribeAmount(market, planet, runStep);
		if (!(amount > 0)) {
			BRIBE.reason = 'the rulers owe nothing yet';
			return BRIBE;
		}
		BRIBE.ok = true;
		BRIBE.amount = amount;
		career.ledger.purse += amount;
		career.bribes += 1;
		career.bribeIncome += amount;
		GravityGame.checkEnded(career);
		refreshCareerMedic(career);
		if (!visitReports(career.ledger, market, planet)) {
			/* an unreported value is cashed by the bribe, once: it regrows from here */
			market.lastVisitStep[planet] = runStep;
			market.stamp += 1;
		}
		/* the rulers bought this visit's silence: the Capital never hears the
		 * report, so the world keeps rotting from where it stood before the
		 * landing. An unreported visit stamped no report, so this is a no-op
		 * there — the bribe then stands on the rot clock as the last report. */
		market.reportStep[planet] = market.reportPrev[planet];
		market.bribeVisitStep[planet] = runStep;
		raiseCorruption(market, planet, OrbitEcon.bribeCorruption(amount));
		BRIBE.corruption = market.corruption[planet];
		market.politicsSerial += 1;
		const roll = OrbitWorld.hashBits(market.politicsSeed, market.politicsSerial, SALT_ARREST) /
			4294967296;
		if (roll >= OrbitEcon.arrestChance(BRIBE.corruption)) return BRIBE;
		arrestCareer(career, market, sim, runStep);
		BRIBE.arrested = true;
		return BRIBE;
	}

	/*
	 * Go quiet (0.6.1): the ship's observation device is taken off while it
	 * stands on a rotten planet. The planet stops reporting for every company
	 * until its rot is quelled; the device goes to the owned shelf and refits
	 * anywhere, but refitting it does not un-silence the planet.
	 */
	function quietRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet || career.flying) return 'not landed there';
		if (planet === market.capitalPlanet || planet === market.arfPlanet) return 'nothing to silence here';
		if (market.quiet[planet]) return 'already quiet';
		if (!career.ship.obs.fitted) return 'no observation device fitted';
		if (market.corruption[planet] <= QUIET_MIN) {
			return 'the rulers only dare above ' + QUIET_MIN + '% corruption';
		}
		return '';
	}

	function goQuiet(career, market, planet) {
		if (quietRefusal(career, market, planet) !== '') return false;
		market.quiet[planet] = 1;
		market.stamp += 1;
		career.ship.obs = OrbitTech.OBS[0];
		refitShip(career);
		return true;
	}

	/*
	 * The plain `back OBS-0` refit is an uninstall too (0.7.50): the device
	 * only leaves the ship where the rulers are rotten enough to want it
	 * gone — above QUIET_MIN% corruption, or on a rebel world (a seized planet frees the device at any rot),
	 * minus the planet-wide silence. Fitting the device stays open anywhere.
	 */
	function uninstallRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet || career.flying) return 'not landed there';
		if (!career.ship.obs.fitted) return 'no observation device fitted';
		if (market.corruption[planet] <= QUIET_MIN && !market.rebel[planet]) {
			return 'the rulers only dare above ' + QUIET_MIN + '% corruption or on a rebel world';
		}
		return '';
	}

	/* the Capital's slow transport: no fee, no reward, no medics, no planning.
	 * ARREST_SECONDS is game seconds like every political span */
	function arrestCareer(career, market, sim, runStep) {
		const capital = career.capitalPlanet;
		if (capital < 0) return false;
		career.arrestUntilStep = runStep +
			Math.round(OrbitEcon.ARREST_SECONDS / GravitySim.DT);
		career.arrested = true;
		career.arrests += 1;
		clearMedicalCargo(career);
		setCommercial(career, -1);
		GravityGame.placeShip(career, sim, capital);
		career.stranded = false;
		return true;
	}

	/* quelled: no more 4x visits and no more patients, but the rail stays
	 * commercial and the planet stays unbuildable for good */
	function pacifyPlanet(market, planet, runStep) {
		market.rebel[planet] = 0;
		market.patients[planet] = 0;
		market.rebelSinceStep[planet] = 0;
		/* a quelled world may not fall again for two epochs, as it always did */
		market.rebelCooldownStep[planet] = runStep +
			Math.round(OrbitEcon.REBEL_CHECK_SECONDS * 2 / GravitySim.DT);
		market.corruptionFloor[planet] = OrbitEcon.CORRUPTION_TRADITION;
		market.corruption[planet] = market.corruption[planet] > OrbitEcon.PACIFY_CORRUPTION_MAX
			? OrbitEcon.PACIFY_CORRUPTION_MAX : market.corruption[planet];
		/* a quelled world reports again: the quiet state is burnt down with the rot */
		market.quiet[planet] = 0;
		if (market.galaxy && market.galaxy.actors) {
			for (let i = 0; i < market.galaxy.actors.length; i++) {
				refreshMedicSlot(market.galaxy.actors[i], market, runStep);
			}
		}
	}

	Object.assign(GravityGame, {
		setPolitics, politicsOn, advancePolitics, seizePlanet, clearPad, clearMedicalCargo, BRIBE,
		bribeWindowOpen, bribeRefusal, bribeAmount, acceptBribe, quietRefusal, goQuiet,
		uninstallRefusal, arrestCareer, pacifyPlanet
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
