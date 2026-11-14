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
	const padSec = GravitySim.padSeconds(gameSec);
	const padMin = GravitySim.padMinutes(gameSec);
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
		const after = Math.min(pad.battery.capacity,
			OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, padMin) +
			OrbitTech.solarCharge(pad.panel, career.light[i], padSec));
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
	careerWaitBtn.disabled = busy || ended || turret.pending ||
		activeSim().status === STATUS_FLYING;
	careerWaitBtn.classList.toggle('on', busy);
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

/* the wait preview names the pace and the world rate, so a change of either
 * repaints just the button and its line — the drawer needs no rebuilding.
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
	launchState = -1;
	dirty = true;
	refreshGameUi();
}


/* ── career actions ── build, bulk, part, accept and drop, wait easing, evacuate, act */
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
	careerNotice('built ' + item.id + ' on ' + planetName(planet) + ' · −' +
		(before - career.ledger.purse).toFixed(2));
	careerChanged();
}

function careerBulk(career, kind, item) {
	const cost = GravityGame.bulkUpgradeCost(career, kind, item);
	if (!GravityGame.bulkUpgrade(career, kind, item)) {
		careerNotice('cannot fit ' + item.id + ' on every pad · ' + costText(cost));
		return;
	}
	careerNotice('every ' + kind + ' now ' + item.id + ' · −' + cost.toFixed(2));
	careerChanged();
}

function careerPart(career, kind, item) {
	const name = item === null ? 'no engine' : item.id;
	if (!GravityGame.installPart(career, kind, item)) {
		const reason = GravityGame.partRefusal(career, kind, item);
		careerNotice('cannot fit ' + name + (reason ? ' · ' + reason : ''));
		return;
	}
	const dv = OrbitTech.shipDeltaV(career.ship, career.ship.cargoTons);
	careerNotice('fitted ' + name + ' · ship ' + career.ship.mass.toFixed(1) + ' t' +
		(dv > 0 ? ' · Δv ' + dv.toFixed(1) + ' px/s' : '') +
		(career.ship.obs.fitted ? '' : ' · no observation device: visits pay nothing'));
	careerChanged();
}

function careerFuelAction(career, produce) {
	const kg = GravityGame.FUEL_BUY_STEP;
	const got = produce ? GravityGame.produceFuel(career, career.at, kg) : GravityGame.buyFuel(career, kg);
	if (got <= 0) {
		careerNotice(produce ? 'conversion needs your own pad, unreserved charge and a usable tank'
			: 'fuel purchase needs a usable tank and purse');
		return;
	}
	careerNotice((produce ? 'converted ' : 'bought ') + got.toFixed(1) + ' kg fuel · ' +
		(produce ? (got / GravityGame.FUEL_KG_PER_KWH).toFixed(2) + ' kWh'
			: costText(got * GravityGame.fuelPrice(career))));
	careerChanged();
}

function careerAccept(career, index) {
	if (!GravityGame.acceptTask(career, index)) {
		careerNotice('cannot take that delivery');
		return;
	}
	const task = career.tasks[index];
	careerNotice(task.state === GravityGame.TASK_LOADED
		? 'contract accepted · cargo loaded at ' + planetName(task.from)
		: 'contract accepted · load at ' + planetName(task.from));
	careerChanged();
}

function careerDrop(career) {
	if (career.contract < 0) return;
	GravityGame.dropContract(career);
	/* a freed slot is offered again at once instead of after the next landing */
	GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
	careerNotice('contract dropped');
	careerChanged();
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
	careerWaitBtn.textContent = 'waiting · ' + pct + ' %';
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
	careerWaitInfoEl.textContent = 'fast-forward · ' + (CAREER_WAIT_SEC * p).toFixed(1) +
		' / ' + CAREER_WAIT_SEC + ' s · clock +' +
		Math.round(GravitySim.gameSeconds(careerWaitAnim.done)) + ' s' + padNote;
}

/* the whole settled result lands exactly on the old instant wait */
function careerWaitFinish() {
	const anim = careerWaitAnim;
	careerWaitAnim = null;
	const career = anim.career;
	if (pauseOnLanding) setCareerPaused(true, anim.slot);
	const pad = career.pads[anim.planet];
	const after = pad.catapult === null ? 0 : pad.chargeKwh;
	const gain = after - anim.before;
	GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
	GravityGame.checkEnded(career);
	cargoSim.predCount = 0;
	careerNotice('clock +' + Math.round(GravitySim.gameSeconds(anim.steps)) + ' s · ' +
		planetName(anim.planet) + ' pad ' +
		(gain > 0.005 ? '+' + gain.toFixed(2) + ' kWh'
			: pad.catapult === null ? 'has no catapult' : 'already full'));
	careerWaitBtn.classList.remove('on');
	careerChanged();
}

/* the world advances in eased chunks each frame: the trade planets visibly
 * race, pads charge and the board ages exactly as one instant wait did.
 * Each frame credits at most WAIT_FRAME_MS toward the wait, so below
 * ~50 fps the real-time run stretches past CAREER_WAIT_SEC and every frame
 * keeps a bounded step chunk — slow machines slow down instead of freezing. */
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
	const p = anim.credit < CAREER_WAIT_MS ? anim.credit / CAREER_WAIT_MS : 1;
	const eased = easeInOut(p);
	const steps = Math.round(eased * anim.steps);
	tradeSim.advanceTo(anim.startT + GravitySim.tradeMinutes(GravitySim.WAIT_SEC) * eased);
	cargoSim.fieldT = tradeSim.t;
	if (steps > anim.done) {
		/* recharge from the start snapshot, so the eased chunks land on the
		 * exact single-call result (leak is exponential, solar is linear) */
		const pads = anim.career.pads;
		for (let i = 0; i < pads.length; i++) pads[i].chargeKwh = anim.charges[i];
		GravityGame.careerAdvance(anim.career, steps);
		/* the rival companies live the same fast-forwarded steps: they
		 * charge, launch, fly and harvest while you wait */
		for (let s = anim.done + 1; s <= steps; s++) {
			bot.stepCareer(anim.startClock + s, game.market, tradeSim, scene.trade.speed);
		}
		game.clockSteps = anim.startClock + steps;
		anim.done = steps;
		cargoSim.predCount = 0;
	}
	if (p < 1) careerWaitProgress(p);
	else careerWaitFinish();
}

/* one press starts the real-time fast-forward (CAREER_WAIT_SEC); only the end settles the board */
function waitCareer() {
	if (!careerRule() || careerWaitBusy() || turret.pending ||
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
		charges: Float64Array.from(career.pads, p => p.chargeKwh),
		steps: GravitySim.stepsForGameSeconds(GravitySim.WAIT_SEC),
		done: 0,
		pct: -1,
		credit: 0,
		last: performance.now(),
		startClock: game.clockSteps,
		startT: tradeSim.t
	};
	careerWaitBtn.disabled = true;
	careerWaitBtn.classList.add('on');
	careerWaitProgress(0);
	hudAt = -Infinity;
}

function cancelCareerWait() {
	if (careerWaitAnim === null) return;
	careerWaitAnim = null;
	careerWaitBtn.classList.remove('on');
	careerWaitBtn.textContent = 'wait · ' + GravitySim.WAIT_SEC + ' s';
}

function careerEvacuate() {
	const career = activeCareer();
	if (!GravityGame.evacuate(career, activeSim())) {
		careerNotice('nothing to evacuate');
		return;
	}
	cancelAim();
	careerNotice('evacuated to HQ ' + planetName(career.hq));
	careerChanged();
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
	if (result.arrested) {
		cancelAim();
		cancelTurret();
	}
	careerNotice('bribed the rulers of ' + planetName(planet) + ' · +' +
		result.amount.toFixed(2) + ' · corruption ' + result.corruption.toFixed(1) + '%' +
		(result.arrested ? ' · ARRESTED · Capital transport' : ''));
	careerChanged();
}

function careerQuiet() {
	const career = activeCareer();
	const planet = career.at;
	if (!GravityGame.goQuiet(career, game.market, planet)) {
		careerNotice(GravityGame.quietRefusal(career, game.market, planet));
		return;
	}
	careerNotice(planetName(planet) + ' went quiet · no reports there until it is quelled · ' +
		'the device is on the shelf, refit it to report elsewhere');
	careerChanged();
}

/* every shop / board button carries data-act (and its args) */
function careerAct(data) {
	if (!careerRule()) return;
	const act = data.act;
	if (act === 'careerTab') return careerSelectTab(data.tab);
	if (act === 'bookDrop') return dropStaleBook();
	const career = activeCareer();
	/* balance tooling + science R&D stay available during flight, wait or turret spin */
	if (act === 'copy') return careerCopySpec(data);
	if (act === 'sciCopy') return careerCopyFrontier(data.family);
	if (act === 'sciFamily') return careerScienceFamily(data.family);
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
	if (career.arrested && act !== 'evac') {
		const left = Math.max(0, Math.round((career.arrestUntilStep - game.clockSteps) * DT));
		careerNotice('under arrest · the Capital transport lands in ' + left + ' s');
		return;
	}
	if (act === 'bribe') return careerBribe();
	if (act === 'quiet') return careerQuiet();
	if (act === 'evac') return careerEvacuate();
	if (act === 'book') return useBookEntry(Number(data.entry));
	if (career.ended !== GravityGame.CAREER_OPEN) {
		careerNotice('career over · restart for a new HQ');
		return;
	}
	if (act === 'produceFuel') return careerFuelAction(career, true);
	if (act === 'buyFuel') return careerFuelAction(career, false);
	if (act === 'drop') return careerDrop(career);
	if (act === 'accept') return careerAccept(career, Number(data.slot));
	if (!data.item && Math.round(Number(data.tier)) === NO_TIER) {
		if (act === 'part') careerPart(career, data.kind, null);
		return;
	}
	const item = shopRecord(data);
	if (!item) return;
	if (act === 'build') careerBuild(career, careerPickPlanet(), data.kind, item);
	else if (act === 'bulk') careerBulk(career, data.kind, item);
	else if (act === 'part') careerPart(career, data.kind, item);
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
