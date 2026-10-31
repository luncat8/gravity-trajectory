/*
 * Replay: start and stop a recorded run, replay each shot's aim, the route verdict, skip.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/*
 * The shot's money as a 2.5 s text card in the postcard slot. A landing
 * card arriving this frame keeps its moment; a still-open entry card holds
 * the slot and the toast follows it (a newer card then drops it).
 */
function moneyToastFor(slot, sim, m, shotCount) {
	if (!root.PhotoDeck) return;
	if (slot === 0 && sim.endReason === END_IMPACT && sim.endBody >= 0 &&
		photoLanded[sim.endBody] !== 1) return;
	const parts = [];
	if (m.shotVisits === 1) {
		parts.push('P' + m.lastPlanet + ' +' + m.shotGain.toFixed(2));
	} else if (m.shotVisits > 1) {
		parts.push(m.shotVisits + ' visits +' + m.shotGain.toFixed(2));
	} else {
		parts.push('no harvest');
	}
	if (careerRule()) {
		const career = game.career;
		if (career.lastFee > 0) parts.push('EMC fee −' + career.lastFee.toFixed(2));
		else parts.push('pad −' + career.lastEnergy.toFixed(2) + ' kWh');
		if (career.lastFuel > 0) parts.push('fuel −' + career.lastFuel.toFixed(1) + ' kg');
		if (career.lastReward > 0) parts.push('task +' + career.lastReward.toFixed(2));
	} else {
		parts.push('cost −' + MONEY.cost.toFixed(2));
	}
	parts.push('purse ' + m.purse.toFixed(2));
	const who = slot === 0 ? 'purse' : slotName(slot) + ' purse';
	root.PhotoDeck.toast(who + ' · shot ' + shotCount,
		signedMoney(m.last), parts.join(' · '));
}

function startReplay(shots, end, length) {
	sound.reset();
	soundFlightSim = null;
	clearBurnAim();
	replay.on = true;
	replay.shots = shots;
	replay.end = end;
	replay.length = length === undefined ? null : length;
	replay.route = routeRule();
	replay.index = 0;
	replay.speed = REPLAY_DEFAULT;
	replay.verdict = '';
	replay.activeShot = null;
	replay.burnIndex = 0;
	if (replay.route) {
		const shot = shots[0];
		replay.phase = PHASE_AIM;
		replay.until = Infinity;
		setSource(shot.src);
		bot.useField(cargoSim, mode);
		if (routeOccupiedBy(shot.origin) >= 0) {
			finishRouteReplay('desync · ' + planetName(shot.origin) + ' is occupied');
			return;
		}
		setShotAim(shot);
		armed = true;
		dirty = true;
		refreshGameUi();
		return;
	}
	replay.phase = PHASE_GAP;
	replay.until = performance.now() + REPLAY_GAP_MS;
	refreshGameUi();
}

function stopReplay() {
	replay.on = false;
	replay.route = false;
	replay.length = null;
	replay.verdict = '';
	replay.activeShot = null;
	replay.burnIndex = 0;
}

function routeVerdictText() {
	if (!routePlan.ready) return 'differs · plan did not land or leave the map';
	const length = Math.round(routePlan.length);
	if (!replay.end) return 'planned ' + length + ' px';
	const lengthOk = replay.length === null || replay.length === length;
	if (lengthOk && replay.end.visited === routePlan.visits &&
		replay.end.steps === routePlan.steps) {
		return 'verified ✓ · ' + length + ' px';
	}
	return 'differs · recorded ' +
		(replay.length === null ? '—' : replay.length + ' px') + ' · ' +
		(replay.end.steps * DT).toFixed(2) + ' s';
}

function finishRouteReplay(problem) {
	if (!problem) {
		syncRoutePlan();
		if (routePlan.ready) {
			bot.seedPlayerRoutePlan(replay.shots[0], routePlan.length,
				routePlan.steps, routePlan.visits, routePlan.reason, routePlan.body);
			routeBotVersion = bot.player.routeVersion;
		}
	}
	replay.on = false;
	replay.verdict = problem || routeVerdictText();
	armed = !problem;
	refreshGameUi();
}

/* gap → aim the next shot (or finish) → fire; a flight hands back through endGameFlight */
function advanceReplay(now) {
	if (replay.phase === PHASE_AIM) {
		const shot = replay.shots[replay.index++];
		replay.activeShot = shot;
		replay.burnIndex = 0;
		setShotAim(shot);
		replay.phase = PHASE_FLY;
		fire(shot.abort);
		return;
	}
	if (replay.index >= replay.shots.length) {
		finishReplay('');
		return;
	}
	aimReplayShot(replay.shots[replay.index], now);
}

function aimReplayShot(shot, now) {
	setSource(shot.src);
	if (!cargoSim.canLaunchFrom(shot.origin)) {
		finishReplay('desync · shot ' + (replay.index + 1) + ' from ' + planetName(shot.origin));
		return;
	}
	setShotAim(shot);
	armed = true;
	dirty = true;
	replay.phase = PHASE_AIM;
	replay.until = now + REPLAY_AIM_MS / REPLAY_SPEEDS[replay.speed];
	hudAt = -Infinity;
}

function setShotAim(shot) {
	aimBody = shot.origin;
	aimAngle = GravityGame.angleOf(shot.angle);
	aimSpeed = GravityGame.speedOf(shot.speed);
	placeGripFromSpeed();
}

function finishReplay(problem) {
	replay.on = false;
	replay.activeShot = null;
	replay.burnIndex = 0;
	replay.verdict = problem || verdictText(replay.end);
	armed = false;
	refreshGameUi();
}

function verdictText(end) {
	if (!end) return 'replayed ' + replay.shots.length + ' shots';
	/* the purse is re-derived by the replay itself, not carried by the link */
	if (end.visited === cargoSim.visitedCount && end.steps === scoreSteps()) {
		return 'verified ✓ · purse ' + game.money.purse.toFixed(2);
	}
	return 'differs · recorded ' + end.visited + ' / ' + PLANETS + ' · ' +
		(end.steps * DT).toFixed(2) + ' s';
}

function skipReplay() {
	if (routeRule() && replay.on) {
		predictShot();
		finishRouteReplay();
		return;
	}
	const now = performance.now();
	const capSteps = ruleSpec().capSteps;
	playAcc = 0;
	while (replay.on) {
		if (cargoSim.status === STATUS_FLYING) {
			while (cargoSim.status === STATUS_FLYING) {
				bot.prepareStep(game.clockSteps, game.market, capSteps, 1e9, true);
				advanceGameOneStep();
			}
			tradeSim.advanceTo(cargoSim.flightFieldT);
			endGameFlight();
		} else {
			advanceReplay(now);
		}
	}
}
