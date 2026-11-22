/*
 * Career drawer: tab selection and refresh, the settlement wait with its eased fast-forward, planet pick and notice, build/bulk/part/accept/drop, evacuate and act.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* exact net kWh, board ageing and visit-profit growth one wait will settle, in
 * the clocks the player reads: the game seconds the clock gains (WAIT_SEC), the
 * real seconds the fast-forward takes (CAREER_WAIT_SEC) and the pad seconds of
 * sunlight the panels are charged for */
function waitSettlement(career) {
	const steps = GravitySim.stepsForGameSeconds(GravitySim.WAIT_SEC);
	const gameSec = Math.round(GravitySim.gameSeconds(steps));
	const padSec = GravitySim.padSeconds(DT);
	const padMin = GravitySim.padMinutes(DT);
	/* what the same span costs to watch instead of fast-forwarding */
	const watchSec = GravitySim.wallSeconds(steps, playPace());
	const nextStep = game.clockSteps + steps;
	const here = career.at >= 0 ? career.at : career.hq;
	let hereGain = 0;
	let totalGain = 0;
	let chargingPads = 0;
	for (let i = 0; i < career.pads.length; i++) {
		const pad = career.pads[i];
		if (pad.catapult === null) continue;
		const leak = -pad.battery.leak * padMin;
		const sun = OrbitTech.solarCharge(pad.panel, career.light[i], padSec);
		const gainSteps = leak === 0 ? steps : Math.expm1(leak * steps) / Math.expm1(leak);
		const after = Math.min(pad.battery.capacity, pad.chargeKwh * Math.exp(leak * steps) + sun * gainSteps);
		const gain = after > pad.chargeKwh ? after - pad.chargeKwh : 0;
		if (i === here) hereGain = gain;
		if (gain > 0.005) {
			totalGain += gain;
			chargingPads += 1;
		}
	}
	let rotating = 0;
	for (let i = 0; i < career.tasks.length; i++) {
		const task = career.tasks[i];
		if (task.kind !== GravityGame.TASK_NONE && nextStep > task.deadline) rotating += 1;
	}
	const dropsContract = career.contract >= 0 &&
		nextStep > career.tasks[career.contract].deadline;
	let profitGain = 0;
	let growingPlanets = 0;
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		const d = GravityGame.planetProfit(game.market, i, nextStep) -
			GravityGame.planetProfit(game.market, i, game.clockSteps);
		if (d > 1e-6) {
			profitGain += d;
			growingPlanets += 1;
		}
	}
	return {
		steps,
		gameSec,
		padMin,
		watchSec,
		here,
		hereHasPad: career.pads[here].catapult !== null,
		hereGain,
		totalGain,
		chargingPads,
		rotating,
		dropsContract,
		profitGain,
		growingPlanets
	};
}

/* another human shares the clock: a wait may not fast-forward past their ship or hold */
function otherHumanPlays() {
	for (let s = 0; s < slotCount(); s++) {
		if (s !== activeSlotIndex() && !slotIsBot(s)) return true;
	}
	return false;
}

/* real seconds as the player reads them: one decimal below 10 s, whole above */
function realSecText(sec) {
	return sec >= 10 ? String(Math.round(sec)) : String(Math.round(sec * 10) / 10);
}

function refreshCareerWaitUi(career, ended) {
	const busy = careerWaitBusy();
	careerWaitBtn.disabled = replay.on || careerActionReplay.active || busy || ended || turret.pending ||
		activeSim().status === STATUS_FLYING;
	careerWaitBtn.classList.toggle('on', busy);
	if (replay.on) {
		careerWaitBtn.title = 'The career recording is read-only';
		if (careerWaitInfoEl) careerWaitInfoEl.hidden = true;
		return;
	}
	if (!busy) careerWaitBtn.textContent = 'wait · ' + GravitySim.WAIT_SEC + ' s';
	if (!busy && otherHumanPlays()) {
		careerWaitBtn.textContent = 'wait · resume time';
		careerWaitBtn.title = 'Release this player’s pause; all players must resume before time advances';
		if (careerWaitInfoEl) careerWaitInfoEl.hidden = true;
		return;
	}
	/* the running fast-forward keeps its own live progress line */
	if (busy) return;
	if (ended) {
		if (careerWaitInfoEl) {
			careerWaitInfoEl.textContent = '';
			careerWaitInfoEl.hidden = true;
		}
		careerWaitBtn.title = 'career has ended';
		return;
	}
	const s = waitSettlement(career);
	const hereName = planetName(s.here);
	const padShort = s.hereGain > 0.005
		? hereName + ' +' + s.hereGain.toFixed(2) + ' kWh' +
			(s.chargingPads > 1 ? ' (+' + s.totalGain.toFixed(2) + ' all)' : '')
		: s.totalGain > 0.005
		? s.chargingPads + (s.chargingPads === 1 ? ' pad +' : ' pads +') + s.totalGain.toFixed(2) + ' kWh'
		: s.hereHasPad ? hereName + ' full' : hereName + ' no pad';
	const boardShort = s.dropsContract ? 'drops contract!'
		: 'board −' + s.gameSec + ' s' + (s.rotating > 0 ? ' (' + s.rotating + ' exp)' : '');
	const profitShort = s.profitGain > 0.005 ? 'visits +' + s.profitGain.toFixed(2) : 'visits max';
	const line = 'wait → ' + padShort + ' · ' + boardShort + ' · ' + profitShort;
	const padFull = s.hereHasPad
		? (s.hereGain > 0.005
			? hereName + ' +' + s.hereGain.toFixed(2) + ' kWh' +
				(s.chargingPads > 1 ? ' (' + s.chargingPads + ' pads +' + s.totalGain.toFixed(2) + ' kWh)' : '')
			: hereName + ' full (solar +' + waitGain(career, s.here) + ' kWh)' +
				(s.totalGain > 0.005 ? ' · ' + s.chargingPads +
					(s.chargingPads === 1 ? ' pad +' : ' pads +') + s.totalGain.toFixed(2) + ' kWh' : ''))
		: hereName + ' has no pad' + (s.totalGain > 0.005
			? ' · ' + s.chargingPads + (s.chargingPads === 1 ? ' pad +' : ' pads +') +
				s.totalGain.toFixed(2) + ' kWh' : '');
	const boardFull = s.dropsContract
		? 'drops active contract!'
		: 'board −' + s.gameSec + ' s' + (s.rotating > 0
			? ' (' + s.rotating + (s.rotating === 1 ? ' offer rotates)' : ' offers rotate)') : '');
	const profitFull = s.profitGain > 0.005
		? 'planet visits +' + s.profitGain.toFixed(2) + ' (' + s.growingPlanets + ' growing)'
		: 'planet visits at cap';
	/* the tooltip says what the press costs in real time, what it moves the
	 * game clock, and what watching the same span at this pace would cost */
	const title = 'fast-forward ' + CAREER_WAIT_SEC + ' s of real time: the clock runs ' +
		s.gameSec + ' s (' + realSecText(s.watchSec) + ' s to watch at ' + paceTag() +
		'): ' + padFull + ' · ' + boardFull + ' · ' + profitFull;
	careerWaitBtn.title = title;
	if (careerWaitInfoEl) {
		careerWaitInfoEl.hidden = false;
		careerWaitInfoEl.textContent = line;
		careerWaitInfoEl.title = title;
		careerWaitInfoEl.className = s.dropsContract ? 'careerLine warn' : 'careerLine dim';
	}
}

/* the wait preview names the pace, so a change repaints just the button
 * and its line — the drawer needs no rebuilding.
 * Only a preview that is on screen: `startGame` resets the pace before the
 * career it is starting has any pads. */
function refreshCareerWaitPreview() {
	if (!careerRule() || careerWaitBtn.hidden || careerWaitBusy()) return;
	const career = activeCareer();
	if (!career) return;
	refreshCareerWaitUi(career, career.ended !== GravityGame.CAREER_OPEN);
}

/* one row per career tab: the pad and the shop, the saved shots, research */
const careerUpgradesTabEl = $('careerUpgradesTab');
const careerUpgradesEl = $('careerUpgrades');
const careerShotsTabEl = $('careerShotsTab');
const careerShotsEl = $('careerShots');
const careerScienceTabEl = $('careerScienceTab');
const careerSciencePanelEl = $('careerSciencePanel');
let careerTab = 'upgrades';
const careerTabs = [
	{ name: 'upgrades', button: careerUpgradesTabEl, panel: careerUpgradesEl },
	{ name: 'shots', button: careerShotsTabEl, panel: careerShotsEl },
	{ name: 'science', button: careerScienceTabEl, panel: careerSciencePanelEl }
];

function refreshCareerTabs() {
	for (let i = 0; i < careerTabs.length; i++) {
		const tab = careerTabs[i];
		if (!tab.button || !tab.panel) continue;
		const on = tab.name === careerTab;
		tab.panel.hidden = !on;
		tab.button.classList.toggle('on', on);
		tab.button.setAttribute('aria-selected', on ? 'true' : 'false');
		tab.button.tabIndex = on ? 0 : -1;
	}
}

function careerSelectTab(tab) {
	for (let i = 0; i < careerTabs.length; i++) {
		if (careerTabs[i].name !== tab) continue;
		careerTab = tab;
		refreshCareerTabs();
		return;
	}
}

function refreshCareerPanel() {
	if (!careerBoxEl) return;
	const replayHint = $('careerReplayHint');
	if (replayHint) replayHint.hidden = !(replay.on && replay.career) && !careerActionReplay.active;
	refreshCareerTabs();
	/* the wait button sits in the game bar, so it follows the rule */
	careerWaitBtn.hidden = !careerRule();
	if (careerWaitInfoEl && !careerRule()) careerWaitInfoEl.hidden = true;
	if (!careerRule()) {
		careerPadEl.innerHTML = '';
		careerShopEl.innerHTML = '';
		if (careerScienceEl) careerScienceEl.innerHTML = '';
		careerTaskEl.innerHTML = '';
		refreshLaunchList(true);
		if (careerWaitInfoEl) {
			careerWaitInfoEl.textContent = '';
			careerWaitInfoEl.hidden = true;
		}
		careerNotice('');
		return;
	}
	const career = activeCareer();
	if (careerTagEl) careerTagEl.textContent = careerTagText();
	fillCareerPlanets(career);
	careerPadEl.innerHTML = padBlockHtml(career);
	careerTaskEl.innerHTML = taskBlockHtml(career);
	refreshLaunchList(true);
	careerShopEl.innerHTML = shopBlockHtml(career);
	if (careerScienceEl) careerScienceEl.innerHTML = scienceBlockHtml(career);
	const ended = career.ended !== GravityGame.CAREER_OPEN;
	refreshCareerWaitUi(career, ended);
	launchState = -1;
	updateLiveHud();
}

/* any career edit can change the armed shot, the clock and the board */
function careerChanged() {
	clampArmedToPad();
	commsInvalidate();
	launchState = -1;
	dirty = true;
	refreshGameUi();
	careerRecordingCapture(true);
}

/* switch the ship's current planet onto or off the neutral commercial rail */
function toggleCommercialRail(selectOnly) {
	if (replay.on || careerInputLocked() || !careerRule() || careerWaitBusy() || activeSim().status === STATUS_FLYING) return false;
	const career = playerCareer();
	if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0) return false;
	if (career.commercialPlanet === career.at) {
		if (selectOnly) return false;
		if (armed && aimBody === career.at) {
			launchShot(); /* the armed shot is the action: the launch records itself at fire time */
			return true;
		}
		GravityGame.setCommercial(career, -1);
		careerNotice('standing rail on ' + planetName(career.at));
	} else {
		GravityGame.setCommercial(career, career.at);
		careerNotice('commercial ' + GravityGame.commercialPadAt(career, career.at).catapult.id +
			' · ' + planetName(career.at) + ' · drag to aim');
	}
	/* the drag range follows the newly selected rail's ceiling */
	if ((armed || aiming) && aimBody === career.at) {
		placeGripFromSpeed();
		dirty = true;
	}
	recordCareerAction('commercial', { on: career.commercialPlanet === career.at });
	launchState = -1;
	careerChanged();
	return true;
}


/* ── career actions ── build, bulk, part, accept and drop, wait easing, evacuate, act */
function recordCareerShop(act, kind, item, planet) {
	const tier = item ? tierIndex(TECH_TABLES[kind], item) : NO_TIER;
	const part = item && tier < 0 ? { item: item.id } : { tier: tier };
	recordCareerAction('act', { act: act, kind: kind, ...part, ...(planet === undefined ? {} : { planet }) });
}

function careerBuild(career, planet, kind, item) {
	const before = career.ledger.purse;
	if (kind === OrbitTech.KIND_CATAPULT && career.pads[planet].catapult === null &&
		!GravityGame.planetBuildable(career, planet)) {
		const owner = GravityGame.claimOwner(game.galaxy, planet);
		careerNotice(claimTag(owner) + ' already owns ' + planetName(planet) +
			' · use their EMC or the commercial rail (one player EMC per planet)');
		return;
	}
	if (!GravityGame.buildGear(career, planet, kind, item)) {
		careerNotice('cannot build ' + item.id + ' on ' + planetName(planet) + ' · ' +
			costText(careerCost(career, item.buildCost)) + ' and a free ' + kind + ' slot');
		return;
	}
	recordCareerShop('build', kind, item, planet);
	careerNotice('built ' + item.id + ' on ' + planetName(planet) + ' · −' +
		(before - career.ledger.purse).toFixed(2));
	careerChanged();
	return true;
}

function careerBulk(career, kind, item) {
	const cost = GravityGame.bulkUpgradeCost(career, kind, item);
	if (!GravityGame.bulkUpgrade(career, kind, item)) {
		careerNotice('cannot fit ' + item.id + ' on every pad · ' + costText(cost));
		return;
	}
	recordCareerShop('bulk', kind, item);
	careerNotice('every ' + kind + ' now ' + item.id + ' · −' + cost.toFixed(2));
	careerChanged();
	return true;
}

function careerPart(career, kind, item) {
	const name = item === null ? 'no engine' : item.id;
	if (!GravityGame.installPart(career, kind, item)) {
		const reason = GravityGame.partRefusal(career, kind, item);
		careerNotice('cannot fit ' + name + (reason ? ' · ' + reason : ''));
		return;
	}
	recordCareerShop('part', kind, item);
	const dv = OrbitTech.shipDeltaV(career.ship, career.ship.cargoTons);
	careerNotice('fitted ' + name + ' · ship ' + career.ship.mass.toFixed(1) + ' t' +
		(dv > 0 ? ' · Δv ' + dv.toFixed(1) + ' px/s' : '') +
		(career.ship.obs.fitted ? '' : ' · no observation device: visits pay nothing'));
	careerChanged();
	return true;
}

function careerFuelAction(career, produce) {
	const kg = GravityGame.FUEL_BUY_STEP;
	const got = produce ? GravityGame.produceFuel(career, career.at, kg) : GravityGame.buyFuel(career, kg);
	if (got <= 0) {
		careerNotice(produce ? 'conversion needs your own pad, unreserved charge and a usable tank'
			: 'fuel purchase needs a usable tank and purse');
		return;
	}
	recordCareerAction('act', { act: produce ? 'produceFuel' : 'buyFuel' });
	careerNotice((produce ? 'converted ' : 'bought ') + got.toFixed(1) + ' kg fuel · ' +
		(produce ? (got / GravityGame.FUEL_KG_PER_KWH).toFixed(2) + ' kWh'
			: costText(got * GravityGame.fuelPrice(career))));
	careerChanged();
	return true;
}

function careerAccept(career, index) {
	if (!GravityGame.acceptTask(career, index)) {
		careerNotice('cannot take that offer');
		return;
	}
	recordCareerAction('act', { act: 'accept', targetSlot: index });
	const task = career.tasks[index];
	const refund = task.capitalRefund > 0 ? ' · +' + task.capitalRefund.toFixed(2) + ' Capital refund' : '';
	if (task.kind === GravityGame.TASK_COMPETE) {
		/* entering while a shot is already queued on the race planet before the
		 * gun holds that barrel too: an entrant never fires before the start */
		reFloorTurretForRace(task);
		careerNotice('entered race at ' + planetName(task.planet) +
			' · −' + GravityGame.COMPETE_ENTRY.toFixed(2) + ' stake' + refund);
	} else {
		careerNotice((task.state === GravityGame.TASK_LOADED
			? 'contract accepted · cargo loaded at ' + planetName(task.from)
			: 'contract accepted · load at ' + planetName(task.from)) + refund);
	}
	careerChanged();
	return true;
}

function careerDrop(career, slot) {
	const index = Number.isInteger(slot) ? slot : career.contract;
	if (index < 0 || index >= GravityGame.BOARD_SIZE) return;
	const task = career.tasks[index];
	const clawback = task ? task.capitalRefund : 0;
	if (!GravityGame.dropTask(career, index)) return;
	recordCareerAction('act', index === GravityGame.COMPETE_SLOT
		? { act: 'drop', targetSlot: index } : { act: 'drop' });
	/* a freed slot is offered again at once instead of after the next landing */
	GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
	careerNotice((index === GravityGame.COMPETE_SLOT ? 'competition dropped' : 'contract dropped') +
		(clawback > 0 ? ' · −' + clawback.toFixed(2) + ' Capital refund' : ''));
	careerChanged();
	return true;
}

function careerWaitBusy() {
	return careerWaitAnim !== null;
}

/* cubic ease-in-out: the fast-forward starts gently, races, then settles */
function easeInOut(p) {
	const q = p < 0.5 ? 2 * p : 2 - 2 * p;
	return p < 0.5 ? q * q * q / 2 : 1 - q * q * q / 2;
}

function careerWaitProgress(p) {
	const pct = Math.round(p * 100);
	if (pct === careerWaitAnim.pct) return;
	careerWaitAnim.pct = pct;
	const evac = careerWaitAnim.kind === 'evac';
	careerWaitBtn.textContent = evac ? 'evacuating · ' + pct + ' %' : 'waiting · ' + pct + ' %';
	const career = careerWaitAnim.career;
	const pad = career.pads[careerWaitAnim.planet];
	if (pad && pad.catapult !== null) {
		const chargeEl = $('careerPadCharge');
		if (chargeEl) {
			chargeEl.textContent = pad.chargeKwh.toFixed(2) + ' / ' +
				pad.battery.capacity.toFixed(2) + ' kWh';
		}
		const barEl = $('careerPadBar');
		if (barEl && barEl.style) {
			const frac = pad.battery.capacity > 0 ? pad.chargeKwh / pad.battery.capacity : 0;
			barEl.style.width = Math.round(frac * 100) + '%';
		}
	}
	if (!careerWaitInfoEl) return;
	careerWaitInfoEl.hidden = false;
	careerWaitInfoEl.className = 'careerLine dim';
	/* the seconds are the eased real time the press costs, the clock is what it
	 * buys, and the % on the button is the same progress */
	const padNote = pad && pad.catapult !== null
		? ' · ' + planetName(careerWaitAnim.planet) + ' ' + pad.chargeKwh.toFixed(2) +
			' / ' + pad.battery.capacity.toFixed(2) + ' kWh'
		: '';
	if (evac) {
		careerWaitInfoEl.textContent = 'evacuation · ' +
			Math.round(careerWaitAnim.wallSeconds * p) + ' / ' +
			Math.round(careerWaitAnim.wallSeconds) + ' real s · cost ' +
			careerWaitAnim.cost.toFixed(2);
		return;
	}
	careerWaitInfoEl.textContent = 'fast-forward · ' + (CAREER_WAIT_SEC * p).toFixed(1) +
		' / ' + CAREER_WAIT_SEC + ' s · clock +' +
		Math.round(GravitySim.gameSeconds(careerWaitAnim.done)) + ' s' + padNote;
}

/* Settle the board and any evacuation before the next input at this step. */
function careerWaitFinish() {
	const anim = careerWaitAnim;
	careerWaitAnim = null;
	const career = anim.career;
	if (pauseOnLanding && !careerActionReplay.active) setCareerPaused(true, anim.slot);
	if (anim.kind === 'evac') {
		GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
		const purseBefore = career.ledger.purse;
		const done = GravityGame.evacuate(career, anim.sim, anim.cost);
		const paid = purseBefore - career.ledger.purse;
		careerWaitBtn.classList.remove('on');
		careerNotice(done ? 'evacuated to HQ ' + planetName(career.hq) + ' · paid ' +
			paid.toFixed(2) + ' · ' + Math.round(anim.wallSeconds) + ' real s' : 'evacuation failed');
		careerChanged();
		return;
	}
	const pad = career.pads[anim.planet];
	const after = pad.catapult === null ? 0 : pad.chargeKwh;
	const gain = after - anim.before;
	GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
	GravityGame.checkEnded(career);
	cargoSim.predCount = 0;
	careerNotice('clock +' + Math.round(GravitySim.gameSeconds(anim.steps)) + ' s · ' +
		planetName(anim.planet) + ' pad ' +
		(gain > 0.005 ? '+' + gain.toFixed(2) + ' kWh'
			: gain < -0.005 ? '−' + (-gain).toFixed(2) + ' kWh'
			: pad.catapult === null ? 'has no catapult' : 'already full'));
	careerWaitBtn.classList.remove('on');
	careerChanged();
}

/* Easing schedules the work; it never changes the order of world steps. */
function careerWaitTick(now) {
	const anim = careerWaitAnim;
	if (anim === null) return;
	if (careerPaused) {
		anim.last = now;
		return;
	}
	const dt = now - anim.last;
	anim.last = now;
	if (dt > 0) anim.credit += dt < WAIT_FRAME_MS ? dt : WAIT_FRAME_MS;
	const durationMs = anim.durationMs || CAREER_WAIT_MS;
	const p = anim.credit < durationMs ? anim.credit / durationMs : 1;
	const steps = p < 1 ? Math.min(anim.steps - 1, Math.round(easeInOut(p) * anim.steps)) : anim.steps;
	while (anim.done < steps) {
		advanceCareerOneStep();
		anim.done++;
		if (anim.done === anim.steps) break;
		applyCareerActionsDue();
	}
	cargoSim.predCount = 0;
	if (anim.done < anim.steps) careerWaitProgress(p);
	else careerWaitFinish();
}

/* one press starts the real-time fast-forward (CAREER_WAIT_SEC); only the end settles the board */
function waitCareer() {
	if (replay.on || !careerRule() || careerWaitBusy() || turret.pending ||
		activeSim().status === STATUS_FLYING) return;
	const career = activeCareer();
	if (career.ended !== GravityGame.CAREER_OPEN) return;
	setCareerPaused(false);
	/* Multiplayer waits use the shared step loop, preserving other ships and holds. */
	if (otherHumanPlays()) {
		careerNotice(careerPaused ? 'waiting for other players to resume' : 'world clock running');
		return;
	}
	const planet = career.at >= 0 ? career.at : career.hq;
	const pad = career.pads[planet];
	careerWaitAnim = {
		slot: activeSlotIndex(),
		career: career,
		planet: planet,
		before: pad.catapult === null ? 0 : pad.chargeKwh,
		steps: GravitySim.stepsForGameSeconds(GravitySim.WAIT_SEC),
		done: 0,
		pct: -1,
		credit: 0,
		last: performance.now()
	};
	recordCareerAction('act', { act: 'wait' });
	careerWaitBtn.disabled = true;
	careerWaitBtn.classList.add('on');
	careerWaitProgress(0);
	hudAt = -Infinity;
	return true;
}

function cancelCareerWait() {
	if (careerWaitAnim === null) return;
	careerWaitAnim = null;
	careerWaitBtn.classList.remove('on');
	careerWaitBtn.textContent = 'wait · ' + GravitySim.WAIT_SEC + ' s';
}

function careerEvacuate(recordedSteps) {
	const career = activeCareer();
	if (!GravityGame.canEvacuate(career)) {
		careerNotice('nothing to evacuate');
		return false;
	}
	const cost = GravityGame.evacuationCost(career);
	const durationSec = GravityGame.evacuationSeconds(career);
	/* The trip's duration is game time. Playback pace only changes how long it
	 * takes to watch those world-clock steps elapse. */
	const steps = recordedSteps ?? GravitySim.stepsForGameSeconds(durationSec);
	setLaunchMenu(false);
	setCareerPaused(false);
	cancelAim();
	if (!GravityGame.evacuate(career, activeSim(), cost, game.clockSteps, steps)) {
		careerNotice('evacuation failed');
		return false;
	}
	recordCareerAction('act', { act: 'evac', steps: steps });
	careerNotice('evacuation started · ' + cost.toFixed(2) + ' · ' +
		Math.round(durationSec) + ' game s');
	commsInvalidate();
	careerChanged();
	hudAt = -Infinity;
	return true;
}

function conditionText(career) {
	return Math.round(career.ship.condition * 100) + ' %';
}

/* full repair of the selected player's ship; true lets a caller chain the launch */
function careerRepair() {
	const career = activeCareer();
	const cost = GravityGame.repairCost(career);
	if (!GravityGame.repairCareer(career)) {
		careerNotice(career.ship.condition >= 1 ? 'ship is as new · nothing to repair'
			: career.at < 0 ? 'no repair in space · evacuate first'
			: purseTooSmall(career, cost)
			? 'repair ' + costText(cost) + ' · purse ' + career.ledger.purse.toFixed(2)
			: 'career over · restart for a new HQ');
		return false;
	}
	recordCareerAction('act', { act: 'repair' });
	careerNotice('repaired · −' + cost.toFixed(2) + ' · condition ' + conditionText(career));
	careerChanged();
	return true;
}

/* auto-repair on landing: the same service the repair button buys, paid on
 * touchdown while the purse covers it and keeps one cheap way off any planet
 * (the bot's reserve); at 0 % condition the whole purse may serve, since
 * nothing flies before the repair anyway. Off during any playback: the
 * recorded repair lands through the action log there. */
function autoRepairOnLanding() {
	if (!autoRepair || !careerRule() || replay.on || careerActionReplay.active || slotIsBot(0)) return;
	const career = game.career;
	if (!career || career.ended !== GravityGame.CAREER_OPEN || career.flying || career.at < 0) return;
	if (career.arrested || career.ship.condition >= 1) return;
	const cost = GravityGame.repairCost(career);
	const reserve = career.ship.condition > 0 ? GravityGame.commercialMinFee() : 0;
	if (career.ledger.purse + 1e-9 < cost + reserve) {
		careerNotice('auto-repair skipped · purse too small for the repair');
		return;
	}
	careerRepair();
}

/* (0.5.12) the rulers' bribe: money for the company, rot for the planet and
 * a chance of the Capital transport instead */
function careerBribe() {
	const career = activeCareer();
	const planet = career.at;
	const result = GravityGame.acceptBribe(career, game.market, activeSim(), planet,
		game.clockSteps);
	if (!result.ok) {
		careerNotice(result.reason);
		return;
	}
	recordCareerAction('act', { act: 'bribe' });
	if (result.arrested) {
		cancelAim();
		cancelTurret();
	}
	careerNotice('bribed the rulers of ' + planetName(planet) + ' · +' +
		result.amount.toFixed(2) + ' · corruption ' + result.corruption.toFixed(1) + '%' +
		(result.arrested ? ' · ARRESTED · Capital transport' : ''));
	careerChanged();
	return true;
}

function careerQuiet() {
	const career = activeCareer();
	const planet = career.at;
	if (!GravityGame.goQuiet(career, game.market, planet)) {
		careerNotice(GravityGame.quietRefusal(career, game.market, planet));
		return;
	}
	recordCareerAction('act', { act: 'quiet' });
	careerNotice(planetName(planet) + ' went quiet · no reports there until it is quelled · ' +
		'the device is on the shelf, refit it to report elsewhere');
	careerChanged();
	return true;
}

/* every shop / board button carries data-act (and its args) */
function careerAct(data) {
	if (!careerRule() || careerInputLocked()) return;
	const act = data.act;
	if (act === 'careerTab') return careerSelectTab(data.tab);
	if (act === 'copy') return careerCopySpec(data);
	if (act === 'sciCopy') return careerCopyFrontier(data.family);
	if (act === 'sciFamily') return careerScienceFamily(data.family);
	if (act === 'bookDrop') return dropStaleBook();
	if (act === 'book') return useBookEntry(Number(data.entry));
	if (replay.on && replay.career) return;
	const career = activeCareer();
	/* balance tooling + science R&D stay available during flight, wait or turret spin */
	if (act === 'sciAccept') {
		if (career.ended !== GravityGame.CAREER_OPEN) {
			careerNotice('career over · restart for a new HQ');
			return;
		}
		return careerResearch();
	}
	/* the eased world clock owns the career for its 2 s */
	if (careerWaitBusy() || turret.pending || activeSim().status === STATUS_FLYING) return;
	if (act === 'wait') return waitCareer();
	if (career.arrested) {
		const left = Math.max(0, Math.round((career.arrestUntilStep - game.clockSteps) * DT));
		careerNotice('under arrest · the Capital transport lands in ' + left + ' s');
		return;
	}
	if (act === 'bribe') return careerBribe();
	if (act === 'quiet') return careerQuiet();
	if (act === 'evac') return careerEvacuate(data.steps);
	if (act === 'repair') return careerRepair();
	if (career.ended !== GravityGame.CAREER_OPEN) {
		careerNotice('career over · restart for a new HQ');
		return;
	}
	if (act === 'produceFuel') return careerFuelAction(career, true);
	if (act === 'buyFuel') return careerFuelAction(career, false);
	if (act === 'drop') return careerDrop(career, data.slot !== undefined ? Number(data.slot) : undefined);
	if (act === 'accept') return careerAccept(career, Number(data.slot));
	if (!data.item && Math.round(Number(data.tier)) === NO_TIER) {
		if (act === 'part') return careerPart(career, data.kind, null);
		return;
	}
	const item = shopRecord(data);
	if (!item) return;
	if (act === 'build') return careerBuild(career, Number.isInteger(data.planet) ? data.planet : careerPickPlanet(), data.kind, item);
	if (act === 'bulk') return careerBulk(career, data.kind, item);
	if (act === 'part') return careerPart(career, data.kind, item);
}

/* delegated click on the generated rows; data-* args live on the button */
function careerEventData(event) {
	let node = event && event.target;
	while (node) {
		if (node.dataset && node.dataset.act) return node.dataset;
		node = node.parentElement;
	}
	return null;
}
