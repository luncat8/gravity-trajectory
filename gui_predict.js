/*
 * Prediction readouts: the predicted gain, profit, rate and tick notes beside the aim line, the experiment panel scales and the hover label.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function refreshPredGain() {
	const sim = activeSim();
	if (!game.on || routeRule() || sim.predCount < 2) {
		predGain = 0;
		return;
	}
	let gain = GravityGame.estimateProfit(game.market, game.clockSteps, sim);
	if (careerRule() && sim.predReason === END_IMPACT && sim.predBody >= 0) {
		const career = game.career;
		const endStep = game.clockSteps + sim.predSteps;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED &&
				sim.predBody === task.to && endStep <= task.deadline) {
				gain += task.reward;
			}
		}
		const compete = career.tasks[GravityGame.COMPETE_SLOT];
		const origin = sim.status === STATUS_FLYING ? sim.origin : aimBody;
		const len = (sim.status === STATUS_FLYING ? sim.flightLength : 0) + sim.predLength;
		if (compete && compete.kind === GravityGame.TASK_COMPETE &&
			origin === compete.planet && len >= compete.minLength &&
			endStep <= compete.deadline) {
			gain += compete.reward;
		}
	}
	predGain = gain;
}

function predictedCareerEconomics(sim) {
	const out = aimEconomics;
	out.state = 0;
	out.launchable = true;
	out.fee = 0;
	out.exit = 0;
	out.net = predGain;
	out.gain = predGain;
	out.source = '';
	out.speed = 0;
	out.tier = 0;
	out.own = false;
	if (!careerRule() || sim.predCount < 2 || sim.predReason !== END_IMPACT ||
		sim.predBody < 0) return out;
	const career = game.career;
	const origin = sim.status === STATUS_FLYING ? sim.origin
		: aimBody >= 0 ? aimBody : career.at;
	const fee = sim.status === STATUS_FLYING ? 0
		: GravityGame.launchFee(career, origin, aimSpeed);
	const cash = career.ledger.purse + predGain - fee;
	const mass = bot.careerArrivalMass(career, sim.predBody);
	const departure = bot.careerDeparture(career, sim.predBody, cash, mass, cargoSim);
	out.fee = fee;
	out.exit = departure.cost;
	out.source = departure.source;
	out.speed = departure.speed;
	const destinationPad = GravityGame.padAt(career, sim.predBody);
	out.tier = destinationPad.catapult.tier + 1;
	out.own = career.pads[sim.predBody].catapult !== null;
	out.launchable = career.ledger.purse + 1e-9 >= fee && departure.ok;
	out.net = predGain - fee - (departure.ok ? departure.cost : 0);
	out.state = !out.launchable ? 2 : out.net > 1e-9 ? 1 : 0;
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

/* The traced estimate prices the entry rule only; with the stay-pay on, a
 * shot pays at least that (0.4.30-plan-harvest-ticks.md). */
function predTickNote() {
	return harvestTick && careerRule() ? ' · ≥ticks' : '';
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
		const ship = game.career.ship;
		const usedKg = OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg);
		const economics = sim.predCount >= 2 && careerRule()
			? predictedCareerEconomics(sim) : null;
		if (economics) aimGuidance = economics.state;
		const visitNote = sim.predCount >= 2
			? ' · ' + predProfitText(sim, economics) + ' · ' + predRateText(sim) +
				' · ' + sim.predTime.toFixed(1) + ' s · +' + sim.predNewVisits +
				' (' + sim.predVisits + ' sys)' + predTickNote()
			: '';
		aimLabel = 'Δv ' + burnDv.toFixed(1) + ' px/s · ' + deg.toFixed(1) + '° · −' +
			usedKg.toFixed(1) + ' kg' + (fine ? ' · fine' : '') + visitNote;
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
				sim.predNewVisits + ' (' + sim.predVisits + ' sys)' + predTickNote()
		: '';
	aimLabel = Math.round(aimSpeed) + ' px/s · ' + deg.toFixed(1) + '°' +
		(fine ? ' · fine' : '') +
		(ceiling < SPEED_MAX - 1e-9 ? ' · max ' + Math.round(ceiling) : '') + visitNote +
		(careerRule() ? careerPickupNote(game.career, aimBody) : '');
}

/* the drag maps all of GRIP_MAX onto SPEED_MIN…this planet's real ceiling:
 * a weak rail or a drained career battery shrinks the range instead of
 * letting the player aim a shot the pad then refuses to fire */
function speedCeiling(planet) {
	const limit = careerRule() && planet >= 0 ? cargoSim.speedLimit(planet) : SPEED_MAX;
	if (limit < SPEED_MIN) return SPEED_MIN;
	return limit > SPEED_MAX ? SPEED_MAX : limit;
}

/* experimental panel: one world, so the player sim, the auto helpers and
 * every rival bot must predict and fly with the same two multipliers; the
 * stay-pay is a career rule, so it is off for the other three */
function applyExperiment() {
	cargoSim.setScales(gravityScale, forceScale);
	helperProbe.setScales(gravityScale, forceScale);
	bot.setScales(gravityScale, forceScale);
	if (game.career) game.career.forceScale = forceScale;
	GravityGame.setHarvestMode(harvestTick && careerRule()
		? GravityGame.HARVEST_TICK : GravityGame.HARVEST_ENTRY);
}

function refreshExperimentUi() {
	const gravityText = '×' + gravityScale.toFixed(2);
	const forceText = '×' + forceScale.toFixed(2);
	if (expGravityLabelEl) expGravityLabelEl.textContent = gravityText;
	if (expForceLabelEl) expForceLabelEl.textContent = forceText;
	if (expHarvestEl) expHarvestEl.checked = harvestTick;
	if (expTagEl) {
		expTagEl.textContent = 'g ' + gravityText + ' · force ' + forceText +
			(harvestTick ? ' · ticks' : '');
	}
}

/* one entry point for the sliders and for a link that carries the scales */
function setExperimentScales(nextGravity, nextForce, nextHarvest) {
	gravityScale = Math.round(nextGravity * 100) / 100;
	forceScale = Math.round(nextForce * 100) / 100;
	harvestTick = nextHarvest === true;
	if (expGravityEl) expGravityEl.value = String(gravityScale);
	if (expForceEl) expForceEl.value = String(forceScale);
	applyExperiment();
	refreshExperimentUi();
}

/* The stay-pay changes what a flight earns, so it is world state like the
 * scales: flipping it mid-career only changes the steps still to fly. The
 * box is dark outside career, where it springs back if anything ticks it. */
function onHarvestChange() {
	harvestTick = Boolean(expHarvestEl && expHarvestEl.checked) && careerRule();
	applyExperiment();
	refreshExperimentUi();
	dirty = true;
	hudAt = -Infinity;
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
	const nextGravity = Math.round(Number(expGravityEl.value) * 100) / 100;
	const nextForce = Math.round(Number(expForceEl.value) * 100) / 100;
	if (nextGravity !== gravityScale || nextForce !== forceScale) experimentTouched = true;
	setExperimentScales(nextGravity, nextForce, harvestTick);
	clampArmedToPad();
	/* the drawer prints the pad's cap: re-render it or the number goes stale */
	if (careerRule()) refreshCareerPanel();
	dirty = true;
	hudAt = -Infinity;
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
	if (careerRule()) return game.career.ended !== GravityGame.CAREER_OPEN;
	return slotLedger(slot).purse < MONEY.cost;
}

function careerOverText() {
	const career = game.career;
	if (career.ended === GravityGame.CAREER_BROKE) return 'broke · career over';
	if (career.ended === GravityGame.CAREER_COMPLETE) return 'catapult network complete';
	if (!career.stranded) return '';
	if (career.at < 0) return 'lost in space · evacuate';
	/* no own EMC here, but a standing rail (commercial or a rival's) that
	 * can lift the ship is a launch button, not a dead end */
	if (GravityGame.padLift(career, career.at) + 1e-9 >= GravitySim.SPEED_MIN) return '';
	/* short enough for the launch button, which must not wrap */
	return 'stranded · build or evacuate';
}

/* the career clock button mirrors the pause; both career time controls
 * live in the trade bar and only show in career runs */
function refreshCareerClockUi() {
	const career = careerRule();
	if (careerClockBtn) {
		careerClockBtn.hidden = !career;
		careerClockBtn.textContent = careerPaused ? '▶ time' : '❚❚ time';
		careerClockBtn.classList.toggle('on', career && careerPaused);
		careerClockBtn.title = careerPaused
			? 'career world clock is paused — click to run time (pads charge, rivals fly, visit profits grow)'
			: 'career world clock is running — click to pause time and aim in peace';
	}
	if (careerPauseLandLabelEl) careerPauseLandLabelEl.hidden = !career;
	if (careerPauseLandEl) careerPauseLandEl.checked = pauseOnLanding;
}

function setCareerPaused(next) {
	if (careerPaused === next) return;
	careerPaused = next;
	playAcc = 0;
	if (next) careerPauseNow = performance.now();
	if (scene.setFrozen) scene.setFrozen(careerRule() && next);
	refreshCareerClockUi();
	hudAt = -Infinity;
}

/* why the armed shot cannot fire from its pad right now ('' when it can) */
function careerPadNote() {
	if (!careerRule() || !armed || aimBody < 0) return '';
	const career = game.career;
	const fee = GravityGame.launchFee(career, aimBody, aimSpeed);
	if (fee > 0 && career.ledger.purse + 1e-9 < fee) {
		return 'EMC fee ' + fee.toFixed(2) + ' · purse ' + career.ledger.purse.toFixed(2);
	}
	if (cargoSim.canFire(aimBody, aimSpeed)) return '';
	return 'pad ' + cargoSim.pads[aimBody].chargeKwh.toFixed(2) + ' kWh · shot ' +
		cargoSim.launchEnergy(aimBody, aimSpeed).toFixed(2) + ' · max ' +
		Math.round(cargoSim.speedLimit(aimBody)) + ' px/s';
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
	if (!routeRule()) return true;
	const sim = activeSim();
	return !sim.routeActive &&
		Math.abs(sim.fieldT - sim.routeT0) > ROUTE_FIELD_DELTA;
}

function startAimTrace(budgetMs) {
	const sim = activeSim();
	if (routeRule()) {
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
	if (routeRule()) {
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
	if (careerRule() && rivalFlying(true)) return true;
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
	const slot = activeSlotIndex();
	const sim = slotSim(slot);
	if (replay.on || sim.status === STATUS_FLYING || slotIsBot(slot)) return true;
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

const scoreRowEls = [$('scorePlayer'), $('scoreRival1'), $('scoreRival2')];
const MAX_PLAYERS = scoreRowEls.length;
