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
	srcPlanetsEl.disabled = flightLock;
	srcPortsEl.disabled = flightLock;
	/* a flight locks the rule; lab stays reachable as the way out */
	for (let i = 0; i < modeEls.length; i++) {
		if (modeEls[i][1]) modeEls[i][1].disabled = flightLock && modeEls[i][0] !== PLAY_LAB;
	}
	if (botOffEl) botOffEl.disabled = false;
	if (botEasyEl) botEasyEl.disabled = false;
	if (botNormalEl) botNormalEl.disabled = false;
	if (botHardEl) botHardEl.disabled = false;
	syncScoreControls();
	refreshStatsStrip();
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
	reserveGameFooter();
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
		visited: careerRule() ? activeCareer().padCount : cargoSim.visitedCount,
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

/* career map-statistics strip (0.6.10 §4): six game-clock plots drawn from
 * galaxy.stats as one svg string each, the way the science tab builds its
 * cost plot. Rebuilt only when a sample lands or the block thins; closed
 * or outside career, the refresh is two cheap guards and no per-frame work. */
let statsStripKey = '';
let statsStripStats = null;

function statsCompanyColour(slot) {
	return slot === 0 ? MINT : RIVAL_COLOURS[(slot - 1) % RIVAL_COLOURS.length];
}

/* samples are near-uniform on the clock, so index spacing is the x axis */
function statsPlotSvg(label, rows, count) {
	const left = STATS_PLOT.left;
	const top = STATS_PLOT.top;
	const width = STATS_PLOT.width - STATS_PLOT.left - STATS_PLOT.right;
	const height = STATS_PLOT.height - STATS_PLOT.top - STATS_PLOT.bottom;
	let lo = 0;
	let hi = 0;
	for (let r = 0; r < rows.length; r++) {
		const values = rows[r].values;
		for (let i = 0; i < count; i++) {
			if (values[i] < lo) lo = values[i];
			if (values[i] > hi) hi = values[i];
		}
	}
	if (hi - lo < 1e-9) hi = lo + 1;
	const span = count > 1 ? count - 1 : 1;
	let html = '<svg class="statsSvg" viewBox="0 0 ' + STATS_PLOT.width + ' ' +
		STATS_PLOT.height + '" role="img" aria-label="' + label + ' over time">';
	for (let r = 0; r < rows.length; r++) {
		const values = rows[r].values;
		let points = '';
		for (let i = 0; i < count; i++) {
			if (i > 0) points += ' ';
			points += (left + i / span * width).toFixed(1) + ',' +
				(top + (hi - values[i]) / (hi - lo) * height).toFixed(1);
		}
		if (points) html += '<polyline class="statsLine" stroke="' + rows[r].colour +
			'" points="' + points + '"/>';
	}
	if (lo < 0) {
		const y = top + hi / (hi - lo) * height;
		html += '<line class="statsZero" x1="' + left + '" y1="' + y.toFixed(1) +
			'" x2="' + (left + width) + '" y2="' + y.toFixed(1) + '"/>';
	}
	return html + '<rect class="statsFrame" x="' + left + '" y="' + top +
		'" width="' + width + '" height="' + height + '"/></svg>';
}

/* the note's «average per time»: sample i lands at (i+1)/count of the clock */
function statsRateRow(values, count, seconds) {
	const out = new Array(count);
	for (let i = 0; i < count; i++) {
		const t = seconds * (i + 1) / count;
		out[i] = t > 0 ? values[i] / t : 0;
	}
	return out;
}

function statsMeanRow(rows, count) {
	const out = new Array(count);
	for (let i = 0; i < count; i++) {
		let sum = 0;
		for (let r = 0; r < rows.length; r++) sum += rows[r][i];
		out[i] = rows.length > 0 ? sum / rows.length : 0;
	}
	return out;
}

function statsSigned(value, digits) {
	return (value < 0 ? '' : '+') + value.toFixed(digits);
}

function statsPlotHtml(label, parts, title, rows, count) {
	return '<div class="statsPlot"><div class="statsCaption"' +
		(title ? ' title="' + title + '"' : '') + '><b>' + label + '</b> ' +
		parts.join(' · ') + '</div>' + statsPlotSvg(label, rows, count) + '</div>';
}

/* captions print the live getters, so the strip reads as a table of what
 * careerStats returns now; the lines behind them are the sampled history */
function statsStripHtml(galaxy, market, step) {
	const stats = galaxy.stats;
	const count = stats.count;
	const n = galaxy.actors.length;
	const seconds = step * DT;
	const careerRow = { income: 0, running: 0, profit: 0, property: 0, science: 0, flown: 0 };
	const mapRow = { rot: 0, standing: 0 };
	const profitParts = [];
	const propertyParts = [];
	const scienceParts = [];
	const flownParts = [];
	const profitData = [];
	const propertyData = [];
	const scienceData = [];
	const flownData = [];
	let allProfitRate = 0;
	let allFlownRate = 0;
	let visits = 0;
	let contracts = 0;
	let bribes = 0;
	let tax = 0;
	let fees = 0;
	let fuel = 0;
	let evac = 0;
	for (let i = 0; i < n; i++) {
		const career = galaxy.actors[i];
		GravityGame.careerStats(careerRow, career);
		const colour = statsCompanyColour(i);
		const name = '<span style="color:' + colour + '">' + slotName(i) + '</span>';
		const profitRate = seconds > 0 ? careerRow.profit / seconds : 0;
		const flownRate = seconds > 0 ? careerRow.flown / seconds : 0;
		profitParts.push(name + ' ' + statsSigned(profitRate, 2) + '/s');
		propertyParts.push(name + ' ' + careerRow.property.toFixed(2));
		scienceParts.push(name + ' ' + careerRow.science.toFixed(2));
		flownParts.push(name + ' ' + flownRate.toFixed(1) + ' px/s');
		allProfitRate += profitRate;
		allFlownRate += flownRate;
		visits += career.visitIncome;
		contracts += career.earned;
		bribes += career.bribeIncome;
		tax += career.taxEarned;
		fees += career.feesPaid;
		fuel += career.fuelSpent;
		evac += career.evacuations *
			(career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : GravityGame.CAREER.evacFee);
		const base = 2 + i * 4;
		profitData.push(statsRateRow(stats.series[base], count, seconds));
		propertyData.push(stats.series[base + 1]);
		scienceData.push(stats.series[base + 2]);
		flownData.push(statsRateRow(stats.series[base + 3], count, seconds));
	}
	const allName = '<span style="color:' + STATS_NEUTRAL + '">all</span>';
	if (n > 0) {
		profitParts.push(allName + ' ' + statsSigned(allProfitRate / n, 2) + '/s');
		flownParts.push(allName + ' ' + (allFlownRate / n).toFixed(1) + ' px/s');
	}
	GravityGame.mapStats(mapRow, market, step);
	const profitTitle = 'visits ' + visits.toFixed(1) + ' · contracts ' + contracts.toFixed(1) +
		' · bribes ' + bribes.toFixed(1) + ' · tax ' + tax.toFixed(1) +
		' · fees ' + fees.toFixed(1) + ' · fuel ' + fuel.toFixed(1) + ' · evac ' + evac.toFixed(1);
	const profitRows = profitData.map((values, i) => ({ colour: statsCompanyColour(i), values }));
	const propertyRows = propertyData.map((values, i) => ({ colour: statsCompanyColour(i), values }));
	const scienceRows = scienceData.map((values, i) => ({ colour: statsCompanyColour(i), values }));
	const flownRows = flownData.map((values, i) => ({ colour: statsCompanyColour(i), values }));
	if (n > 0) {
		profitRows.push({ colour: STATS_NEUTRAL, values: statsMeanRow(profitData, count) });
		flownRows.push({ colour: STATS_NEUTRAL, values: statsMeanRow(flownData, count) });
	}
	return statsPlotHtml(STATS_LABELS.profit, profitParts, profitTitle, profitRows, count) +
		statsPlotHtml(STATS_LABELS.property, propertyParts, '', propertyRows, count) +
		statsPlotHtml(STATS_LABELS.science, scienceParts, '', scienceRows, count) +
		statsPlotHtml(STATS_LABELS.flown, flownParts, '', flownRows, count) +
		statsPlotHtml(STATS_LABELS.rot, [String(Math.round(mapRow.rot))], '',
			[{ colour: STATS_NEUTRAL, values: stats.series[0] }], count) +
		statsPlotHtml(STATS_LABELS.standing, [mapRow.standing.toFixed(2)], '',
			[{ colour: STATS_NEUTRAL, values: stats.series[1] }], count);
}

function refreshStatsStrip() {
	if (!careerRule()) {
		if (!statsStripEl.hidden) statsStripEl.hidden = true;
		if (statsPlotsEl.innerHTML) {
			statsPlotsEl.innerHTML = '';
			statsStripKey = '';
			statsStripStats = null;
		}
		return;
	}
	if (statsStripEl.hidden) statsStripEl.hidden = false;
	if (!statsOpen) {
		if (statsPlotsEl.innerHTML) {
			statsPlotsEl.innerHTML = '';
			statsStripKey = '';
			statsStripStats = null;
		}
		return;
	}
	const galaxy = game.galaxy;
	const stats = galaxy.stats;
	if (!stats) return;
	const key = stats.count + '/' + stats.every + '/' + galaxy.actors.length;
	if (stats === statsStripStats && key === statsStripKey) return;
	statsStripStats = stats;
	statsStripKey = key;
	statsPlotsEl.innerHTML = statsStripHtml(galaxy, game.market, game.clockSteps);
}
