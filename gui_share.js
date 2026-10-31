/*
 * Link and share plumbing: copy the replay or bot url, load state from the link and the search params, and the bot decision log panel.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function copyUrlText(url, btn, label) {
	gameLinkEl.value = url;
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		showLink();
		return;
	}
	clipboard.writeText(url).then(() => {
		btn.textContent = 'copied ✓';
		setTimeout(() => {
			btn.textContent = label;
		}, 1600);
	}, showLink);
}

function copyLink() {
	if (routeRule() && (armed || aiming)) predictShot();
	const slot = activeSlotIndex();
	if (slot > 0) {
		const hash = bot.rivalLink(game.seed, scene.trade.speed, slot - 1,
			gravityScale, forceScale);
		if (!hash) return;
		copyUrlText(location.href.split('#')[0] + '#' + hash, gameCopyBtn, 'copy replay');
		return;
	}
	const url = location.href.split('#')[0] + '#' + GravityGame.encodeLink({
		seed: game.seed,
		rate: scene.trade.speed,
		rule: game.rule,
		bot: game.bot,
		player: game.player,
		cheat: game.cheat,
		gravityScale: gravityScale,
		forceScale: forceScale,
		harvestTick: harvestTick,
		shots: game.shots,
		visited: routeRule() ? routePlan.visits : cargoSim.visitedCount,
		steps: scoreSteps(),
		length: routeRule() ? routePlan.length : undefined
	});
	copyUrlText(url, gameCopyBtn, 'copy replay');
}

function copyBotLink() {
	if (bot.count === 0) return;
	const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
	if (bot.rivals[rIdx].shots.length === 0) return;
	const hash = bot.rivalLink(game.seed, scene.trade.speed, rIdx, gravityScale, forceScale);
	if (!hash) return;
	const url = location.href.split('#')[0] + '#' + hash;
	copyUrlText(url, botCopyBtn, 'copy rival');
}

function showLink() {
	gameLinkEl.hidden = false;
	gameLinkEl.focus();
	gameLinkEl.select();
}

/* --- rival decisions: a copyable log and a read-only snapshot -------- */

function botLogHeader() {
	return game.rule + ' · ' + game.bot + ' · ' + bot.count + ' rivals · seed ' +
		game.seed + ' · t+ ' + (game.clockSteps * DT).toFixed(1) +
		' s (step ' + game.clockSteps + ') · ×' + scene.trade.speed +
		' · g ×' + gravityScale.toFixed(2) + ' · force ×' + forceScale.toFixed(2) +
		' · ' + (cargoSim.fieldStatic ? 'planets · static · lists on' : 'ports · moving · lists off') +
		(careerRule() && careerPaused ? ' · world clock paused' : '');
}

function hideBotLog() {
	if (!botLogBoxEl) return;
	botLogBoxEl.hidden = true;
	if (botLogTextEl) botLogTextEl.value = '';
}

/* without a clipboard the panel is the copy source: select the whole log */
function showBotLog() {
	if (!botLogTextEl || !botLogBoxEl) return;
	botLogBoxEl.hidden = false;
	botLogTextEl.focus();
	botLogTextEl.select();
}

function copyBotLog() {
	if (!game.on || !botLogBtn || !botLogTextEl || !botLogBoxEl) return;
	const text = bot.decisionLog(game.clockSteps, botLogHeader());
	botLogTextEl.value = text;
	botLogBoxEl.hidden = false;
	if (botLogBoxEl.scrollIntoView) botLogBoxEl.scrollIntoView({ block: 'nearest' });
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		showBotLog();
		return;
	}
	clipboard.writeText(text).then(() => {
		botLogBtn.textContent = 'copied ✓';
		setTimeout(() => { botLogBtn.textContent = 'copy bot log'; }, 1600);
	}, showBotLog);
}

function loadLink() {
	if (!GravityGame.isGameLink(location.hash)) return false;
	const link = GravityGame.decodeLink(location.hash);
	if (!link) {
		linkNote = game.on ? 'invalid game link' : 'invalid link · back to lab';
		refreshGameUi();
		return false;
	}
	loadingUrl = true;
	scene.setSpeed(link.rate);
	setExperimentScales(link.gravityScale, link.forceScale, link.harvestTick);
	startGame(link.seed, true, link.rule, link.bot, link.player, link.cheat);
	if (link.shots.length > 0) startReplay(link.shots, link.end, link.length);
	loadingUrl = false;
	syncSeedUrl(true);
	return true;
}

function loadSearchParams() {
	const search = location.search || '';
	if (!search || search === '?') return false;
	const params = new URLSearchParams(search);
	const viewParam = params.get('view');
	if (VIEW_MODES.includes(viewParam)) setViewMode(viewParam);
	const hasGameHint = params.has('mode') || params.has('game') || params.has('rule') ||
		params.has('seed') || params.has('rate') || params.has('bot') || params.has('src') ||
		params.has('source') || params.has('player') || params.has('you') || params.has('shots');
	if (!hasGameHint) return false;
	const modeParam = params.get('mode');
	const gameParam = params.get('game');
	const modeRule = modeParam && RULES[modeParam] ? modeParam : null;
	const shouldGame = modeParam === 'game' || gameParam === '1' || modeRule !== null ||
		params.has('rule') || params.has('seed') || params.has('rate') || params.has('bot');
	const seedStr = params.get('seed');
	const seedNum = seedStr !== null ? Number(seedStr) : tradeSim.seed;
	if (seedStr !== null && (!Number.isInteger(seedNum) || seedNum < 1 || seedNum > 0xffffffff)) return false;
	const rateStr = params.get('rate');
	const speedStr = rateStr !== null ? rateStr : params.get('speed');
	const rateNum = speedStr !== null ? Number(speedStr) : scene.trade.speed;
	if (speedStr !== null && (!Number.isFinite(rateNum) || rateNum < 0.5 || rateNum > 12)) return false;
	const sourceStr = params.get('src') || params.get('source');
	if (modeParam === PLAY_LAB) {
		loadingUrl = true;
		stopGame();
		if (seedNum !== tradeSim.seed) {
			scene.reset(seedNum);
			clearCargo();
			attachWorld();
		}
		if (sourceStr === 'ports' || sourceStr === 'port') setSource(MODE_PORTS);
		else if (sourceStr === 'planets' || sourceStr === 'planet') setSource(MODE_PLANETS);
		if (speedStr !== null) scene.setSpeed(rateNum);
		loadingUrl = false;
		syncSeedUrl(true);
		return true;
	}
	if (!shouldGame) return false;
	let ruleStr = params.get('rule');
	const botStr = params.get('bot');
	const playerStr = params.get('player') || params.get('you');
	if (ruleStr !== null && !RULES[ruleStr]) return false;
	if (!ruleStr && modeRule) ruleStr = modeRule;
	if (!ruleStr) ruleStr = RULE_TOUR;
	if (botStr !== null && !(botStr in GravityGame.BOTS)) return false;
	if (playerStr !== null && !(playerStr in GravityGame.PLAYER_TYPES)) return false;
	const cheatStr = params.get('cheat');
	if (cheatStr !== null && !(ruleStr === RULE_CAREER && GravityGame.CHEATS[cheatStr])) return false;
	loadingUrl = true;
	if (speedStr !== null) scene.setSpeed(rateNum);
	startGame(seedNum, rateStr !== null, ruleStr, botStr || undefined, playerStr || undefined,
		cheatStr || undefined);
	if (sourceStr === 'ports' || sourceStr === 'port') setSource(MODE_PORTS);
	else if (sourceStr === 'planets' || sourceStr === 'planet') setSource(MODE_PLANETS);
	const shotsParam = params.get('shots');
	const endParam = params.get('end');
	const lenParam = params.get('len');
	if (shotsParam) {
		const fakeHash = '#game=1&seed=' + seedNum + '&rate=' + rateNum +
			'&rule=' + ruleStr + (botStr ? '&bot=' + botStr : '') +
			'&shots=' + shotsParam + (endParam ? '&end=' + endParam : '') + (lenParam ? '&len=' + lenParam : '');
		const link = GravityGame.decodeLink(fakeHash);
		if (link && link.shots.length > 0) startReplay(link.shots, link.end, link.length);
	}
	loadingUrl = false;
	syncSeedUrl(true);
	return true;
}
