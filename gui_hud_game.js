/*
 * Game HUD: score value and meta, the player and rival summaries with their tags, the flat game readout refresh.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* control locks and button states; runs on game state changes, not per frame */
function refreshGameUi() {
	const route = routeRule();
	const career = careerRule();
	const anyFlying = clockDriverFlying();
	const activeFlying = activeSim().status === STATUS_FLYING;
	const flightLock = game.on && (career
		? activeFlying || turret.pending || replay.on
		: anyFlying || replay.on);
	const activeSlotNow = activeSlotIndex();
	/* "run" matches the run box: the rule itself is named in its caption */
	modeTagEl.textContent = linkNote || (game.on
		? activeSlotNow > 0 && !playerIsBot()
			? (route ? 'run · planner · ' : 'run · ') + slotName(activeSlotNow)
			: route ? 'run · planner · no launch'
			: career ? 'career · world clock'
			: 'run · clock runs in flight'
		: 'lab · free clock');
	if (goalRoleEl) {
		goalRoleEl.textContent = career ? 'catapult network · pads & tasks'
			: route ? 'one plan · longest trajectory'
			: game.on ? (moneyRule() ? 'ten launches · visit profit' : 'visit every system')
			: 'one ship · gravity only';
	}
	runBoxEl.hidden = !game.on;
	if (careerBoxEl) careerBoxEl.hidden = !career;
	if (careerHudEl) careerHudEl.hidden = !career;
	if (careerCleanLabelEl) careerCleanLabelEl.hidden = !career;
	if (gameHudEl) gameHudEl.hidden = !career;
	if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
	refreshCareerClockUi();
	if (rivalGroupEl) rivalGroupEl.hidden = !game.on || RULES[game.rule].solo;
	syncModeRadios();
	if (scoreHudEl) scoreHudEl.hidden = !game.on;
	if (bodyGroupEl) bodyGroupEl.hidden = game.on;
	if (horizonGroupEl) horizonGroupEl.hidden = route;
	if (playbackGroupEl) playbackGroupEl.hidden = route;
	if (flightRowEl) flightRowEl.hidden = route;
	srcPlanetsEl.disabled = flightLock;
	srcPortsEl.disabled = flightLock;
	/* a flight locks the rule; lab stays reachable as the way out */
	for (let i = 0; i < modeEls.length; i++) {
		if (modeEls[i][1]) modeEls[i][1].disabled = flightLock && modeEls[i][0] !== PLAY_LAB;
	}
	if (botOffEl) botOffEl.disabled = flightLock;
	if (botEasyEl) botEasyEl.disabled = flightLock;
	if (botNormalEl) botNormalEl.disabled = flightLock;
	if (botHardEl) botHardEl.disabled = flightLock;
	syncScoreControls(flightLock);
	let anyShots = game.shots.length > 0;
	for (let i = 0; i < bot.count && !anyShots; i++) {
		if (bot.rivals[i].shots.length > 0) anyShots = true;
	}
	/* the scales define the world a link re-flies, so a flown run locks them;
	 * career has no shot replay and stays tunable while it runs */
	const experimentLock = game.on && (career ? replay.on : replay.on || anyShots);
	if (expGravityEl) expGravityEl.disabled = experimentLock;
	if (expForceEl) expForceEl.disabled = experimentLock;
	/* the stay-pay only exists in career: outside it the box is off and dim */
	if (expHarvestEl) expHarvestEl.disabled = experimentLock || !career;
	scene.lockSpeed(game.on && (route || game.fixedRate || anyShots || replay.on));
	clearButton.hidden = game.on && !route;
	clearButton.textContent = route ? 'clear plan' : 'clear';
	clearButton.disabled = route && (replay.on || playerIsBot());
	gameCopyBtn.disabled = flightLock;
	if (botCopyBtn) {
		const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
		botCopyBtn.hidden = game.bot === BOT_OFF;
		botCopyBtn.disabled = flightLock || bot.count === 0 ||
			bot.rivals[rIdx].shots.length === 0;
	}
	if (botLogBtn) {
		const hasBots = game.on && (bot.count > 0 || playerIsBot());
		botLogBtn.hidden = !hasBots;
		if (!hasBots) hideBotLog();
	}
	if (rivalRowEl) rivalRowEl.hidden = game.bot === BOT_OFF;
	if (purseRowEl) purseRowEl.hidden = route;
	if (predProfitRowEl) predProfitRowEl.hidden = !game.on || route;
	if (visitLabelEl) visitLabelEl.textContent = route ? 'route score' : 'systems visited';
	if (predVisitLabelEl) predVisitLabelEl.textContent = route ? 'plan end' : 'pred visits';
	horizonSlider.disabled = route;

	replaySpeedBtn.hidden = !replay.on || replay.route;
	replaySkipBtn.hidden = !replay.on;
	replaySpeedBtn.textContent = '×' + REPLAY_SPEEDS[replay.speed];
	replayRowEl.hidden = !replay.on && replay.verdict === '';
	refreshPlaybackUi();
	refreshRouteBestUi();
	refreshCareerPanel();
	helperUpdateUi();
	updateLiveHud();
	measureHudRects();
	reserveTradeFooter();
	hudAt = -Infinity;
}

function scoreValue(summary) {
	if (routeRule()) {
		return summary.ready ? Math.round(summary.length) + ' px' : 'planning…';
	}
	if (moneyRule() || careerRule()) return summary.purse.toFixed(2) + ' purse';
	return summary.visited + ' / ' + planetCount + (summary.done ? ' ✓' : '');
}

function scoreMeta(summary) {
	const time = (summary.steps * DT).toFixed(1) + ' s';
	if (routeRule()) {
		if (!summary.ready) {
			return summary.origin >= 0
				? planetName(summary.origin) + ' · tracing one plan'
				: 'no finished plan yet';
		}
		const end = summary.reason === END_IMPACT
			? 'lands ' + planetName(summary.body)
			: 'leaves map';
		return planetName(summary.origin) + ' · ' + end + ' · ' + time +
			(summary.planning ? ' · still planning' : '');
	}
	if (moneyRule()) {
		return summary.visited + ' systems · ' + summary.shots + ' / ' +
			GravityGame.MONEY_SHOTS + ' shots · ' + time;
	}
	if (careerRule()) {
		const pads = summary.visited;
		return pads + (pads === 1 ? ' pad · ' : ' pads · ') +
			summary.shots + (summary.shots === 1 ? ' shot · ' : ' shots · ') + time;
	}
	const shots = summary.shots + (summary.shots === 1 ? ' shot' : ' shots');
	return shots + ' · ' + time + ' · purse ' + summary.purse.toFixed(2);
}

function rivalTagText() {
	if (careerRule()) {
		return bot.count === 1 ? '1 rival · flying' : bot.count + ' rivals · flying';
	}
	if (routeRule()) {
		if (bot.routeThinking()) {
			return 'planning ' + Math.round(bot.routeProgress() * 100) + ' %';
		}
		if (game.bot === BOT_OFF) return slotIsBot(0) ? 'your bot · ready' : 'solo';
		return game.bot === BOT_HARD ? '2 rivals · plans ready' : '1 rival · plan ready';
	}
	if (game.bot === BOT_OFF) return 'solo';
	if (bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
		return 'thinking ' + Math.round(bot.progress() * 100) + ' %';
	}
	if (game.bot === BOT_HARD) return '2 rivals · 1-ply';
	if (game.bot === BOT_NORMAL) return '1 rival · route';
	return '1 rival · greedy';
}

function playerSummary() {
	const isBot0 = slotIsBot(0);
	if (routeRule()) {
		return {
			visited: routePlan.visits,
			done: isBot0 ? bot.player.routeDone : routePlan.ready,
			steps: routePlan.steps,
			shots: routePlan.ready ? 1 : 0,
			length: routePlan.length,
			purse: game.money.purse,
			origin: routePlan.origin,
			reason: routePlan.reason,
			body: routePlan.body,
			ready: routePlan.ready,
			planning: isBot0 ? !bot.player.routeDone : cargoSim.routeActive
		};
	}
	const flyingLength = cargoSim.status === STATUS_FLYING ? cargoSim.flightLength : 0;
	return {
		visited: careerRule() ? game.career.padCount : cargoSim.visitedCount,
		done: game.doneSteps >= 0,
		steps: scoreSteps(),
		shots: game.shots.length,
		length: game.length + flyingLength,
		purse: game.money.purse,
		origin: cargoSim.landedBody,
		reason: cargoSim.endReason,
		body: cargoSim.endBody,
		ready: game.shots.length > 0,
		planning: false
	};
}

function rivalSummaryInfo(player) {
	if (bot.count === 0) return { text: '—', outcome: 0 };
	const slot = activeSlotIndex();
	const activeSummary = slot === 0 ? player : bot.actorSummary(slot - 1);
	let bestCmp = Infinity;
	if (slot !== 0) {
		bestCmp = GravityGame.compareScores(game.rule, activeSummary, player);
	}
	for (let i = 0; i < bot.count; i++) {
		if (slot === i + 1) continue;
		const cmp = GravityGame.compareScores(game.rule, activeSummary, bot.actorSummary(i));
		if (cmp < bestCmp) bestCmp = cmp;
	}
	const finished = runOver();
	if (finished) {
		return {
			text: bestCmp > 0 ? 'WIN' : bestCmp < 0 ? 'LOSS' : 'TIE',
			outcome: bestCmp
		};
	}
	if (!routeRule() && bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
		return { text: 'THINK ' + Math.round(bot.progress() * 100) + '%', outcome: 0 };
	}
	if (bestCmp > 0) return { text: 'AHEAD', outcome: 1 };
	if (bestCmp < 0) return { text: 'BEHIND', outcome: -1 };
	return { text: 'EVEN', outcome: 0 };
}
