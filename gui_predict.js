/*
 * Prediction readouts: the predicted gain, profit, rate and tick notes beside the aim line, the experiment panel scales and the hover label.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* the rule's landing facts for the aim preview, read by the readouts */
const predLanding = { cash: 0, credit: 0, leg: GravityGame.LEG_NONE };

/* The primary launch repairs first when that combined action is affordable.
 * The dropdown can still fly the current condition without repair. */
function previewStartCondition(career, sim, origin, speed) {
	if (sim.status === STATUS_FLYING || career.ship.condition >= 1 ||
		playerIsBot() || replay.on || careerWaitBusy() || career.ended !== GravityGame.CAREER_OPEN) {
		return career.ship.condition;
	}
	return sim.canFire(origin, speed) && GravityGame.repairLaunchBlock(career, sim, origin, speed) === ''
		? 1 : career.ship.condition;
}

function previewWearNote(sim) {
	if (!careerRule() || sim.predCount < 2 || sim.routeActive ||
		sim.predReason === GravitySim.END_OPEN || sim.predReason === END_TRUNCATED) return '';
	const career = playerCareer();
	const flying = sim.status === STATUS_FLYING;
	const speed = flying ? 0 : aimSpeed;
	const dv = flying && (burnAiming || burnArmed) ? burnDv : 0;
	const condition = previewStartCondition(career, sim, aimBody, speed);
	const landed = sim.predReason === END_IMPACT && sim.predBody >= 0;
	const end = GravityGame.forecastCondition(career, condition, sim.predSteps, speed, dv, landed);
	if (end <= 0) {
		const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, dv);
		return reportUntil <= sim.predSteps && career.ship.obs.fitted
			? ' · ⚠ worn out in flight · reports stop'
			: ' · ⚠ 0% condition · repair needed';
	}
	if (!flying && condition > career.ship.condition &&
		GravityGame.forecastCondition(career, career.ship.condition, sim.predSteps, speed, 0, landed) <= 0) {
		return ' · ⚠ launch-only: 0% condition';
	}
	return '';
}

function refreshPredGain() {
	const sim = activeSim();
	if (!game.on || routeRule() || sim.predCount < 2) {
		predGain = 0;
		return;
	}
	const career = careerRule() ? playerCareer() : null;
	const flying = sim.status === STATUS_FLYING;
	const origin = flying ? sim.origin : aimBody;
	const speed = flying ? 0 : aimSpeed;
	const dv = flying && (burnAiming || burnArmed) ? burnDv : 0;
	const condition = career ? previewStartCondition(career, sim, origin, speed) : 0;
	const reportUntil = career ? GravityGame.forecastReportUntil(career, condition, speed, dv) : undefined;
	let gain = GravityGame.estimateProfit(game.market, game.clockSteps, sim,
		career ? career.ledger : slotLedger(activeSlotIndex()), reportUntil);
	if (career && sim.predReason === END_IMPACT && sim.predBody >= 0) {
		/* the same landing table the helper scans and the bots price with:
		 * a taken delivery or medical quest pays here, not only on the pad */
		const flown = flying ? sim.flightLength : 0;
		/* a load that is already flying survived its launch */
		const launchSpeed = sim.status === STATUS_FLYING ? 0 : aimSpeed;
		GravityGame.careerLandingFacts(predLanding, career, origin, sim.predBody,
			flown, sim.predLength, sim.predSteps, game.clockSteps, gain, launchSpeed);
		gain = predLanding.cash;
	}
	predGain = gain;
}

/* the shot on the pad would break the fragile load aboard (0.6.3): legal to
 * fire, but the delivery it carries is void */
function aimBreaksFragile() {
	if (!careerRule() || !(aiming || armed)) return false;
	const career = playerCareer();
	return career.contract >= 0 &&
		GravityGame.fragileBreaks(career.tasks[career.contract], aimSpeed);
}

function predictedCareerEconomics(sim) {
	const out = aimEconomics;
	out.state = aimBreaksFragile() ? 2 : 0;
	out.launchable = true;
	out.fee = 0;
	out.fuel = 0;
	out.repair = 0;
	out.wear = 0;
	out.exit = 0;
	out.net = predGain;
	out.gain = predGain;
	out.source = '';
	out.speed = 0;
	out.tier = 0;
	out.own = false;
	if (!careerRule() || sim.predCount < 2 || sim.predReason !== END_IMPACT ||
		sim.predBody < 0) return out;
	const career = playerCareer();
	const origin = sim.status === STATUS_FLYING ? sim.origin
		: aimBody >= 0 ? aimBody : career.at;
	const fee = sim.status === STATUS_FLYING ? 0
		: GravityGame.launchFee(career, origin, aimSpeed);
	const ship = career.ship;
	const flying = sim.status === STATUS_FLYING;
	const speed = flying ? 0 : aimSpeed;
	const dv = flying && (burnAiming || burnArmed) ? burnDv : 0;
	const condition = previewStartCondition(career, sim, origin, speed);
	const arrival = GravityGame.forecastCondition(career, condition, sim.predSteps, speed, dv, true);
	out.repair = condition > ship.condition ? GravityGame.repairCost(career) : 0;
	out.wear = GravityGame.forecastWearCost(career, condition, sim.predSteps, speed, dv, true);
	out.fuel = dv > 0 ? OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg) * GravityGame.fuelPrice(career) : 0;
	const mandatoryRepair = GravityGame.forecastRepairReserve(career, arrival);
	const cash = career.ledger.purse + predGain - fee - out.repair - mandatoryRepair;
	const mass = bot.careerArrivalMass(career, sim.predBody);
	const departure = bot.careerDeparture(career, sim.predBody, cash, mass, activeCareerSim(),
		arrival === 0 ? 1 : arrival);
	out.fee = fee;
	out.exit = departure.cost;
	out.source = departure.source;
	out.speed = departure.speed;
	const destinationPad = GravityGame.padAt(career, sim.predBody);
	out.tier = destinationPad.catapult.tier + 1;
	out.own = career.pads[sim.predBody].catapult !== null;
	out.launchable = career.ledger.purse + 1e-9 >= fee + out.repair && cash >= -1e-9 && departure.ok;
	out.net = predGain - fee - out.fuel - out.repair - out.wear - (departure.ok ? departure.cost : 0);
	out.state = !out.launchable || aimBreaksFragile() ? 2 : out.net > 1e-9 ? 1 : 0;
	return out;
}

function predProfitText(sim, economics) {
	if (careerRule()) {
		const money = economics || predictedCareerEconomics(sim);
		if (!money.launchable) return signedMoney(predGain) + ' · no exit';
		return signedMoney(money.net);
	}
	return signedMoney(predGain);
}

function predRateText(sim) {
	const rate = sim.predTime > 1e-6 ? predGain / sim.predTime : 0;
	return '+' + rate.toFixed(2) + '/s';
}

/* While aiming in career at the pickup planet of an accepted delivery that
 * is not yet loaded, note the cargo that will be picked up and whether a
 * starter EMC-1 there can lift the newly loaded ship. Returns '' when there
 * is nothing to report. `postMass` is the ship once the cargo is aboard. */
function careerPickupNote(career, planet) {
	if (!career || career.contract < 0) return '';
	const task = career.tasks[career.contract];
	if (task.state !== GravityGame.TASK_ACCEPTED || task.from !== planet) return '';
	const postMass = career.ship.mass + task.tons;
	const pad = career.pads[planet];
	let cap;
	if (pad.catapult === null || pad.catapult.id !== OrbitTech.CATAPULTS[0].id) {
		/* a starter EMC-1 with a fresh BAT-1 at full charge */
		cap = padCapMass(OrbitTech.CATAPULTS[0], OrbitTech.BATTERIES[0], postMass);
	} else {
		cap = padCapMass(pad.catapult, pad.battery, postMass);
	}
	return ' · loads ' + task.tons + ' t → ' + planetName(task.to) +
		' · EMC-1: ' + Math.round(cap) + ' px/s';
}

function refreshAimLabel() {
	const sim = activeSim();
	aimGuidance = 0;
	if (burnAiming || burnArmed) {
		const deg = ((-burnAngle * 180 / Math.PI) % 360 + 360) % 360;
		const ship = playerCareer().ship;
		const usedKg = OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg);
		const economics = sim.predCount >= 2 && careerRule()
			? predictedCareerEconomics(sim) : null;
		if (economics) aimGuidance = economics.state;
		const visitNote = sim.predCount >= 2
			? ' · ' + predProfitText(sim, economics) + ' · ' + predRateText(sim) +
				' · ' + sim.predTime.toFixed(1) + ' s · +' + sim.predNewVisits +
				' (' + sim.predVisits + ' sys)'
			: '';
		aimLabel = 'Δv ' + burnDv.toFixed(1) + ' px/s · ' + deg.toFixed(1) + '° · −' +
			usedKg.toFixed(1) + ' kg / ' + costText(usedKg * GravityGame.fuelPrice(playerCareer())) +
			(fine ? ' · fine' : '') + visitNote + previewWearNote(sim);
		return;
	}
	if (!aiming && !armed) {
		aimLabel = '';
		return;
	}
	const deg = ((-aimAngle * 180 / Math.PI) % 360 + 360) % 360;
	const ceiling = aimBody >= 0 ? speedCeiling(aimBody) : SPEED_MAX;
	const economics = sim.predCount >= 2 && careerRule()
		? predictedCareerEconomics(sim) : null;
	if (economics) aimGuidance = economics.state;
	const visitNote = sim.predCount >= 2
		? routeRule()
			? ' · ' + Math.round(sim.predLength) + ' px · ' +
				sim.predTime.toFixed(1) + ' s' +
				(sim.routeActive ? ' · tracing' : '')
			: (game.on ? ' · ' + predProfitText(sim, economics) + ' · ' + predRateText(sim) : '') +
				' · ' + sim.predTime.toFixed(1) + ' s · +' +
				sim.predNewVisits + ' (' + sim.predVisits + ' sys)'
		: '';
	aimLabel = Math.round(aimSpeed) + ' px/s · ' + deg.toFixed(1) + '°' +
		(fine ? ' · fine' : '') +
		(ceiling < SPEED_MAX - 1e-9 ? ' · max ' + Math.round(ceiling) : '') + visitNote +
		(careerRule() ? careerPickupNote(playerCareer(), aimBody) : '') +
		(aimBreaksFragile() ? ' · breaks the fragile load · ' + fragileLimitText() : '') +
		previewWearNote(sim);
}

/* the drag maps all of GRIP_MAX onto SPEED_MIN…this planet's real ceiling:
 * a weak rail or a drained career battery shrinks the range instead of
 * letting the player aim a shot the pad then refuses to fire */
function speedCeiling(planet) {
	const limit = careerRule() && planet >= 0 ? activeCareerSim().speedLimit(planet) : SPEED_MAX;
	if (limit < SPEED_MIN) return SPEED_MIN;
	return limit > SPEED_MAX ? SPEED_MAX : limit;
}

/* One world: all ships and predictions use the same experimental settings. */
function applyExperiment() {
	cargoSim.setScales(gravityScale, forceScale);
	helperProbe.setScales(gravityScale, forceScale);
	bot.setScales(gravityScale, forceScale);
	/* every company prices its own pads with the panel's force multiplier */
	for (let s = 0; s < slotCount(); s++) {
		const career = slotCareer(s);
		if (career) career.forceScale = forceScale;
	}
	const career = careerRule();
	GravityGame.setSpaceWearScale(spaceWearScale);
	GravityGame.setPadScale(padScale);
	GravityGame.setRotScale(rotScale);
	GravityGame.setPayScale(career ? payScale : 1);
	const careerTicks = harvestTick && career;
	GravityGame.setHarvestMode(careerTicks
		? GravityGame.HARVEST_TICK : GravityGame.HARVEST_ENTRY);
	game.gravityScale = gravityScale;
	game.forceScale = forceScale;
	game.spaceWearScale = spaceWearScale;
	game.padScale = padScale;
	game.rotScale = rotScale;
	game.payScale = payScale;
	game.harvestTick = careerTicks;
}

function refreshExperimentUi() {
	const gravityText = '×' + gravityScale.toFixed(2);
	const forceText = '×' + forceScale.toFixed(2);
	const career = careerRule();
	const careerTicks = harvestTick && career;
	if (expGravityLabelEl) expGravityLabelEl.textContent = gravityText;
	if (expForceLabelEl) expForceLabelEl.textContent = forceText;
	if (expWearLabelEl) expWearLabelEl.textContent = '×' + spaceWearScale.toFixed(2);
	if (expPadsLabelEl) expPadsLabelEl.textContent = '×' + padScale.toFixed(2);
	if (expRotLabelEl) expRotLabelEl.textContent = '×' + rotScale.toFixed(2);
	if (expPayLabelEl) expPayLabelEl.textContent = '×' + payScale.toFixed(2);
	if (expHarvestEl) expHarvestEl.checked = careerTicks;
	if (expTagEl) {
		expTagEl.textContent = 'g ' + gravityText + ' · force ' + forceText +
			(career ? ' · wear ×' + spaceWearScale.toFixed(2) +
				(padScale !== 1 ? ' · pads ×' + padScale.toFixed(2) : '') +
				(rotScale !== 1 ? ' · rot ×' + rotScale.toFixed(2) : '') +
				(payScale !== 1 ? ' · pay ×' + payScale.toFixed(2) : '') : '') +
			(careerTicks ? ' · ticks' : '');
	}
}

/* one entry point for the sliders and for a link that carries the scales */
function setExperimentScales(nextGravity, nextForce, nextHarvest, nextWear, nextPad, nextRot, nextPay) {
	const gVal = Math.round(nextGravity * 100) / 100;
	const fVal = Math.round(nextForce * 100) / 100;
	const hVal = nextHarvest === true;
	const wVal = nextWear === undefined ? spaceWearScale : Math.round(nextWear * 100) / 100;
	const pVal = nextPad === undefined ? padScale : Math.round(nextPad * 100) / 100;
	const rVal = nextRot === undefined ? rotScale : Math.round(nextRot * 100) / 100;
	const yVal = nextPay === undefined ? payScale : Math.round(nextPay * 100) / 100;
	if (careerRule() && game.on && careerRecording.record &&
		(gVal !== gravityScale || fVal !== forceScale || hVal !== harvestTick ||
		wVal !== spaceWearScale || pVal !== padScale || rVal !== rotScale || yVal !== payScale)) {
		recordCareerAction('scales', { g: gVal, f: fVal, h: hVal, w: wVal, p: pVal, r: rVal, y: yVal });
	}
	careerRecordingMark();
	gravityScale = gVal;
	forceScale = fVal;
	spaceWearScale = wVal;
	padScale = pVal;
	rotScale = rVal;
	payScale = yVal;
	harvestTick = hVal;
	if (expGravityEl) expGravityEl.value = String(gravityScale);
	if (expForceEl) expForceEl.value = String(forceScale);
	if (expWearEl) expWearEl.value = String(spaceWearScale);
	if (expPadsEl) expPadsEl.value = String(padScale);
	if (expRotEl) expRotEl.value = String(rotScale);
	if (expPayEl) expPayEl.value = String(payScale);
	applyExperiment();
	refreshExperimentUi();
}

/* The stay-pay changes what a flight earns, so it is world state like the
 * scales: flipping it mid-career only changes the steps still to fly. The
 * box is dark outside career, where it springs back if anything ticks it. */
function onHarvestChange() {
	if (careerInputLocked()) return;
	const next = Boolean(expHarvestEl && expHarvestEl.checked) && careerRule();
	if (next !== harvestTick) cancelHelperForChange('stay-pay');
	if (next !== harvestTick) {
		recordCareerAction('scales', {
			g: gravityScale, f: forceScale, h: next,
			w: spaceWearScale, p: padScale, r: rotScale, y: payScale
		});
	}
	harvestTick = next;
	careerRecordingMark();
	applyExperiment();
	refreshExperimentUi();
	syncSeedUrl();
	if (careerRule()) refreshLaunchList(true);
	dirty = true;
	hudAt = -Infinity;
	careerRecordingCapture(true);
}

function applyCareerScaleChange(label) {
	recordCareerAction('scales', {
		g: gravityScale, f: forceScale, h: harvestTick,
		w: spaceWearScale, p: padScale, r: rotScale, y: payScale
	});
	careerRecordingMark();
	cancelHelperForChange(label);
	applyExperiment();
	refreshExperimentUi();
	syncSeedUrl();
	refreshCareerPanel();
	refreshLaunchList(true);
	dirty = true;
	hudAt = -Infinity;
	careerRecordingCapture(true);
}

/* Ageing affects every company and any active preview, not the field itself. */
function onWearInput() {
	if (!careerRule() || careerInputLocked()) return;
	const next = Math.round(Number(expWearEl.value) * 100) / 100;
	if (next === spaceWearScale) return;
	spaceWearScale = next;
	applyCareerScaleChange('space wear');
}

function onPadsInput() {
	if (!careerRule() || careerInputLocked()) return;
	const next = Math.round(Number(expPadsEl.value) * 100) / 100;
	if (next === padScale) return;
	padScale = next;
	applyCareerScaleChange('pads');
}

function onRotInput() {
	if (!careerRule() || careerInputLocked()) return;
	const next = Math.round(Number(expRotEl.value) * 100) / 100;
	if (next === rotScale) return;
	rotScale = next;
	applyCareerScaleChange('rot');
}

function onPayInput() {
	if (!careerRule() || careerInputLocked()) return;
	const next = Math.round(Number(expPayEl.value) * 100) / 100;
	if (next === payScale) return;
	payScale = next;
	applyCareerScaleChange('pay');
}

/* a pad can lose its ceiling while a shot is armed (drained battery, lowered
 * force slider): keep the aim inside what can fire, and put the grip dot back
 * on the new drag range so the dot still shows the armed speed */
function clampArmedToPad() {
	if (!armed || aimBody < 0) return;
	const ceiling = speedCeiling(aimBody);
	if (ceiling === aimCeiling && aimSpeed <= ceiling) return;
	aimSpeed = aimSpeed > ceiling ? ceiling : aimSpeed;
	placeGripFromSpeed();
	dirty = true;
}

function onExperimentInput() {
	if (careerInputLocked()) return;
	const nextGravity = Math.round(Number(expGravityEl.value) * 100) / 100;
	const nextForce = Math.round(Number(expForceEl.value) * 100) / 100;
	if (nextGravity !== gravityScale || nextForce !== forceScale) {
		experimentTouched = true;
		cancelHelperForChange('gravity or force');
	}
	setExperimentScales(nextGravity, nextForce, harvestTick);
	syncSeedUrl();
	clampArmedToPad();
	/* the drawer prints the pad's cap: re-render it or the number goes stale */
	if (careerRule()) refreshCareerPanel();
	dirty = true;
	hudAt = -Infinity;
	careerRecordingCapture(true);
}

/* the route planner scores traced plans, so its world must not change under
 * a half-finished trace: restart the contest on release, like a field switch */
function onExperimentChange() {
	if (!experimentTouched) return;
	experimentTouched = false;
	if (game.on && routeRule()) {
		startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
	}
}

function refreshHoverLabel() {
	if (hoverBody < 0 || hoverBody >= cargoSim.bodyCount) {
		hoverLabel = '';
		return;
	}
	hoverLabel = bodyName(hoverBody) + ' · g ' + strengthText(hoverBody) +
		(cargoSim.strength[hoverBody] < 0 ? ' repel' : '');
}


/* ── rules & gating ── rule spec, player/money/career rules, blocked pad and destination notes, career clock */
function fieldChanged() {
	const sim = activeSim();
	if (armed || aiming || sim.status === STATUS_FLYING) dirty = true;
	else sim.predCount = 0;
	hudAt = -Infinity;
}

function ruleSpec() {
	return RULES[game.rule];
}

function routeRule() {
	return game.on && game.rule === RULE_ROUTE;
}

function playerIsBot() {
	return slotIsBot(activeSlotIndex());
}

function moneyRule() {
	return game.rule === RULE_MONEY;
}

function careerRule() {
	return game.on && game.rule === RULE_CAREER;
}

/* a flown slot stops when the purse cannot cover a launch; a career when it ended */
function slotBroke(slot) {
	if (careerRule()) return slotCareer(slot).ended !== GravityGame.CAREER_OPEN;
	return slotLedger(slot).purse < MONEY.cost;
}

function careerOverText() {
	const career = playerCareer();
	if (career.ended === GravityGame.CAREER_BROKE) return 'broke · career over';
	if (career.ended === GravityGame.CAREER_COMPLETE) return 'catapult network complete';
	if (career.evacuating) return 'evacuating to HQ';
	if (!career.stranded) return '';
	if (career.at < 0) return 'lost in space · evacuate';
	/* no own EMC here, but a standing rail (commercial or a rival's) that
	 * can lift the ship is a launch button, not a dead end */
	if (GravityGame.padLift(career, career.at) + 1e-9 >= GravitySim.SPEED_MIN) return '';
	/* short enough for the launch button, which must not wrap */
	return 'stranded · build or evacuate';
}

/* Each human holds its own pause; the shared clock runs only after all release. */
function pauseAllowed() {
	return game.on && ruleSpec().pause && !replay.on;
}

/* the auto-repair setting is a landing control: it shows only where a landing
 * can service the ship — the career, hand-flown, no replay */
function autoRepairShown() {
	return pauseAllowed() && !playerIsBot();
}

function otherPlayerPaused(slot) {
	for (let s = 0; s < slotCount(); s++) {
		if (s !== slot && !slotIsBot(s) && slotPaused[s]) return true;
	}
	return false;
}

function refreshCareerClockUi() {
	const allowed = pauseAllowed();
	const slot = activeSlotIndex();
	const held = allowed && slotPaused[slot];
	if (careerClockBtn) {
		careerClockBtn.hidden = !allowed;
		careerClockBtn.disabled = careerActionReplay.active || (slotIsBot(slot) && !careerActionReplay.halted);
		careerClockBtn.textContent = held || careerActionReplay.halted ? '▶ time' : '❚❚ time';
		careerClockBtn.classList.toggle('on', held);
		careerClockBtn.title = held ? 'Release this player’s pause (Space / P)'
			: careerPaused ? 'Waiting for other players; click to pause this player too'
			: 'Pause this player (Space / P)';
	}
	if (careerPauseLandLabelEl) careerPauseLandLabelEl.hidden = !allowed;
	if (careerPauseLandEl) careerPauseLandEl.checked = pauseOnLanding;
	/* the auto-repair label lives in the flight panel: setLaunchState owns its
	 * visibility (landed, hand-flown, career open), this only mirrors the value */
	if (careerAutoRepairEl) careerAutoRepairEl.checked = autoRepair;
}

function syncCareerPause() {
	const next = pauseAllowed() && !careerActionReplay.active &&
		(careerActionReplay.halted || otherPlayerPaused(-1));
	if (careerPaused !== next) {
		careerPaused = next;
		playAcc = 0;
		if (next) careerPauseNow = performance.now();
		if (scene.setFrozen) scene.setFrozen(next);
	}
	dirty = true;
	launchState = -1;
	refreshCareerClockUi();
	syncScoreControls();
	hudAt = -Infinity;
}

function setCareerPaused(next, slot = activeSlotIndex()) {
	if ((replay.on && replay.career) || careerInputLocked()) return;
	careerRecordingMark();
	if (!pauseAllowed()) return;
	slotPaused[slot] = Boolean(next) && !slotIsBot(slot);
	if (!next && slot === activeSlotIndex()) clearBurnAim();
	syncCareerPause();
	refreshAimLabel();
	careerRecordingCapture(true);
}

/* why the armed shot cannot fire from its pad right now ('' when it can) */
function careerPadNote() {
	if (!careerRule() || !armed || aimBody < 0) return '';
	const career = playerCareer();
	const fee = GravityGame.launchFee(career, aimBody, aimSpeed);
	if (fee > 0 && career.ledger.purse + 1e-9 < fee) {
		return 'EMC fee ' + fee.toFixed(2) + ' · purse ' + career.ledger.purse.toFixed(2);
	}
	const sim = activeCareerSim();
	if (sim.canFire(aimBody, aimSpeed)) return '';
	return 'pad ' + sim.pads[aimBody].chargeKwh.toFixed(2) + ' kWh · shot ' +
		sim.launchEnergy(aimBody, aimSpeed).toFixed(2) + ' · max ' +
		Math.round(sim.speedLimit(aimBody)) + ' px/s';
}

function routeOccupiedBy(planet) {
	if (!routeRule() || planet < 0) return -1;
	const slot = activeSlotIndex();
	for (let i = 0; i < bot.count; i++) {
		if (slot === i + 1) continue;
		if (bot.rivals[i].routeOrigin === planet) return i;
	}
	if (slot !== 0) {
		const p0Origin = slotIsBot(0) ? bot.player.routeOrigin : routePlan.origin;
		if (p0Origin === planet) return GravityBot.PLAYER_INDEX;
	}
	return -1;
}

function canAimFrom(planet) {
	if (planet < 0) return false;
	if (playerIsBot()) return false;
	if (routeRule()) return routeOccupiedBy(planet) < 0;
	return activeSim().canLaunchFrom(planet);
}

function showBlocked(planet, now) {
	blockedPlanet = planet;
	blockedUntil = now + 2600;
	blockedBy = routeOccupiedBy(planet);
	blockedKind = blockedBy >= 0 ? 1 : 0;
}


/* ── aim trace ── trace staleness, startAimTrace, predictShot, goal, flown and run locks */
/*
 * Route mode traces a shot to its end over several frames. The job survives
 * field ticks (it is a snapshot), so it is restarted only by an aim edit or
 * when the world has moved on enough for the snapshot to be misleading.
 */
function aimTraceStale(bodiesMoved) {
	if (!bodiesMoved) return false;
	if (!game.on || ruleSpec().horizon === null) return true;
	const sim = activeSim();
	return !sim.routeActive &&
		Math.abs(sim.fieldT - sim.routeT0) > ROUTE_FIELD_DELTA;
}

function startAimTrace(budgetMs) {
	const sim = activeSim();
	if (game.on && ruleSpec().horizon !== null) {
		sim.routeBegin(aimBody, aimAngle, aimSpeed, ruleSpec().horizon);
		if (!replay.on) sim.routeStep(ROUTE_STEP_MS);
	} else sim.predict(aimBody, aimAngle, aimSpeed, budgetMs);
	refreshPredGain();
	syncRoutePlan();
	rememberRouteBest();
}

/* a launch—and a copied route plan—always sees a finished path */
function predictShot() {
	const sim = activeSim();
	if (game.on && ruleSpec().horizon !== null) {
		sim.predictFull(aimBody, aimAngle, aimSpeed, ruleSpec().horizon);
	} else sim.predict(aimBody, aimAngle, aimSpeed);
	refreshPredGain();
	syncRoutePlan();
	rememberRouteBest();
}

function slotGoalDone(slot) {
	if (routeRule()) return false;
	const spec = ruleSpec();
	const sim = slotSim(slot);
	if (slot === 0) {
		if (spec.stopOnTour && game.doneSteps >= 0) return true;
		return spec.maxShots > 0 && game.shots.length >= spec.maxShots &&
			sim.status !== STATUS_FLYING;
	}
	const r = bot.rivals[slot - 1];
	if (spec.stopOnTour && r.doneSteps >= 0) return true;
	return spec.maxShots > 0 && r.shots.length >= spec.maxShots &&
		sim.status !== STATUS_FLYING;
}

function slotFlownDone(slot) {
	if (routeRule()) return false;
	return slotGoalDone(slot) || slotBroke(slot);
}

function playerGoalDone() {
	return slotGoalDone(activeSlotIndex());
}

function hasLiveUser() {
	const count = slotCount();
	for (let s = 0; s < count; s++) {
		if (!slotIsBot(s) && !slotFlownDone(s)) return true;
	}
	return false;
}

function rivalFlying(wantBot) {
	for (let i = 0; i < bot.count; i++) {
		if (bot.isRivalBot(i) === wantBot && bot.rivals[i].sim.status === STATUS_FLYING) return true;
	}
	return false;
}

/* A human flight always drives the clock, even after its run was decided
 * mid-air (26th system, purse below the fee), so it still reaches its end.
 * Bot flights drive it only once no human can still act. */
function clockDriverFlying() {
	const slot0Flying = cargoSim.status === STATUS_FLYING;
	if (replay.on) return slot0Flying;
	/* career rivals fly on the same clock, so their flights drive it too */
	if (careerRule()) return slot0Flying || rivalFlying(true) || rivalFlying(false);
	if (slot0Flying && !slotIsBot(0)) return true;
	if (rivalFlying(false)) return true;
	if (hasLiveUser()) return false;
	if (slot0Flying) return true;
	return slotFlownDone(0) && rivalFlying(true);
}

function runOver() {
	if (routeRule()) return false;
	if (!game.on || replay.on || clockDriverFlying()) return false;
	return !hasLiveUser() && slotFlownDone(0);
}

/* Manual aim closes during a flight/replay, when a bot controls the active
 * slot, and in the flown rules after the goal is met or purse cannot launch. */
function gameLocked() {
	if (!game.on) return false;
	if (careerWaitBusy()) return true;
	/* 0.7.47 WS4: a career still deciding its opening seat has no career
	 * record yet — that counts as locked so panels hold during planning */
	if (typeof GravityScene !== 'undefined' && GravityScene.careerPlanning()) return true;
	const slot = activeSlotIndex();
	const sim = slotSim(slot);
	if (replay.on || careerInputLocked() || sim.status === STATUS_FLYING ||
		(careerRule() && slotCareer(slot) && slotCareer(slot).evacuating) || slotIsBot(slot)) return true;
	if (routeRule()) return false;
	return slotFlownDone(slot);
}

function flownRunLocked() {
	return game.on && !routeRule() && slotFlownDone(activeSlotIndex());
}

function gameSteps() {
	return cargoSim.status === STATUS_FLYING ? game.steps + cargoSim.liveSteps : game.steps;
}

function scoreSteps() {
	if (routeRule()) return routePlan.steps;
	return ruleSpec().stopOnTour && game.doneSteps >= 0 ? game.doneSteps : gameSteps();
}

/* --- planet universe ------------------------------------------------- */

const MAX_PLAYERS = GravityBot.MAX_RIVALS + 1;
const scoreRowEls = [$('scorePlayer')];
const scoreRowsEl = $('scoreRows');
const scoreRivalTemplate = $('scoreRivalTemplate');
for (let i = 1; i < MAX_PLAYERS; i++) {
	const fragment = scoreRivalTemplate.content.cloneNode(true);
	const row = fragment.querySelector('[data-score="row"]');
	const name = fragment.querySelector('[data-score="name"]');
	const label = fragment.querySelector('[data-score="label"]');
	const box = fragment.querySelector('[data-score="bot"]');
	const value = fragment.querySelector('[data-score="value"]');
	const meta = fragment.querySelector('[data-score="meta"]');
	const tag = RIVAL_TAGS[i - 1];
	row.id = 'scoreRival' + i;
	name.id = 'rivalScoreName' + i;
	name.textContent = tag;
	label.id = 'scoreBotLabel' + i;
	label.title = 'switch ' + tag + ' between user and bot';
	box.id = 'rivalBot' + i;
	box.setAttribute('aria-label', 'bot controls ' + tag);
	value.id = 'rivalScore' + i;
	meta.id = 'rivalMeta' + i;
	row.style.setProperty('--rival-colour', RIVAL_COLOURS[i - 1]);
	row.style.setProperty('--rival-active-bg', rivalRgba(RIVAL_COLOURS[i - 1], 0.12));
	row.style.setProperty('--rival-active-border', rivalRgba(RIVAL_COLOURS[i - 1], 0.36));
	scoreRowsEl.appendChild(fragment);
	scoreRowEls.push(row);
}
