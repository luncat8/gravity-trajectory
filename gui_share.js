/*
 * Link and share plumbing: copy the replay or bot url, load state from the link and the search params, and the copy-only decision history.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function copyUrlText(text, btn, label) {
	hideCopyText();
	const fallback = () => {
		gameLinkEl.value = text;
		gameLinkEl.hidden = false;
		gameLinkEl.focus();
		gameLinkEl.select();
	};
	const clipboard = navigator.clipboard;
	if (!clipboard) { fallback(); return; }
	clipboard.writeText(text).then(() => {
		btn.textContent = 'copied ✓';
		setTimeout(() => { btn.textContent = label; }, 1600);
	}, fallback);
}

function hideCopyText() {
	gameLinkEl.hidden = true;
	gameLinkEl.value = '';
}

function copyLink() {
	if (careerRule()) {
		copyCareerActions();
		return;
	}
	if (routeRule() && (armed || aiming)) predictShot();
	const slot = activeSlotIndex();
	if (slot > 0) {
		const hash = bot.rivalLink(game.seed, scene.trade.speed, slot - 1,
			game.gravityScale, game.forceScale, game.spaceWearScale, game.harvestTick);
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
		gravityScale: game.gravityScale,
		forceScale: game.forceScale,
		spaceWearScale: game.spaceWearScale,
		padScale: game.padScale,
		rotScale: game.rotScale,
		payScale: game.payScale,
		harvestTick: game.harvestTick,
		giftAll: game.giftAll,
		giftBot: game.giftBot,
		giftHuman: game.giftHuman,
		shots: game.shots,
		visited: routeRule() ? routePlan.visits : cargoSim.visitedCount,
		steps: scoreSteps(),
		length: routeRule() ? routePlan.length : undefined
	});
	copyUrlText(url, gameCopyBtn, 'copy replay');
}

function rivalCopyIndex() {
	const slot = activeSlotIndex();
	return slot > 0 ? slot - 1 : 0;
}

function copyBotLink() {
	if (careerRule() || bot.count === 0) return;
	const rIdx = rivalCopyIndex();
	if (bot.rivals[rIdx].shots.length === 0) return;
	const hash = bot.rivalLink(game.seed, scene.trade.speed, rIdx, game.gravityScale, game.forceScale,
		game.spaceWearScale, game.harvestTick);
	if (!hash) return;
	const url = location.href.split('#')[0] + '#' + hash;
	copyUrlText(url, botCopyBtn, 'copy rival');
}

function selectedBotActors() {
	const actors = [];
	if (slotIsBot(0)) actors.push(GravityBot.PLAYER_INDEX);
	for (let i = 0; i < bot.count; i++) {
		if (slotIsBot(i + 1)) actors.push(i);
	}
	return actors;
}

function botLogHeader(actors) {
	const names = actors.map(i => i === GravityBot.PLAYER_INDEX ? 'YOU' : 'R' + (i + 1));
	return game.rule + ' · ' + game.bot + ' · ' + bot.count + ' rivals · seed ' +
		game.seed + ' · t+ ' + (game.clockSteps * DT).toFixed(1) +
		' s (step ' + game.clockSteps + ') · sky ×' + scene.trade.rate +
		' · g ×' + gravityScale.toFixed(2) + ' · force ×' + forceScale.toFixed(2) +
		(careerRule() ? ' · space wear ×' + spaceWearScale.toFixed(2) +
			' · pads ×' + padScale.toFixed(2) + ' · rot ×' + rotScale.toFixed(2) +
			' · pay ×' + payScale.toFixed(2) : '') +
		' · ' + (cargoSim.fieldStatic ? 'planets · static · lists on' : 'ports · moving · lists off') +
		(careerRule() && careerPaused ? ' · world clock paused' : '') +
		' · checked bots: ' + (names.length ? names.join(', ') : 'none');
}

const CAREER_SHARED_ACTIONS = new Set(['playerCount', 'universe', 'source', 'gravity', 'scales', 'difficulty']);

function careerLogRow(step, name, event, detail) {
	return '[' + step + ' · t+' + (step * DT).toFixed(1) + 's] ' + name + ' ' + event +
		(detail ? ' · ' + detail : '');
}

function careerLogEvent(entry) {
	const [step, slot, event, detail, a, b] = entry;
	let motion = '';
	if (event === 'fire') motion = ' · angle ' + b.toFixed(3);
	if (event === 'burn') motion = ' · angle ' + b.toFixed(3) + ' · flight step ' + a;
	if (event === 'land' && b !== END_IMPACT) motion = ' · ' + (b === END_EXIT ? 'left the map' : 'flight limit');
	return careerLogRow(step, slotName(slot), event, detail + motion);
}

function careerLogAction(entry) {
	const { step, slot, type, act, ...args } = entry;
	const detail = Object.entries(args).map(([key, value]) => key + '=' + value).join(' ');
	return careerLogRow(step, CAREER_SHARED_ACTIONS.has(type) ? 'world' : slotName(slot), act || type, detail);
}

function careerLogText(actors) {
	const slots = actors.map(index => index === GravityBot.PLAYER_INDEX ? 0 : index + 1);
	const start = careerRecording.record.start;
	const first = start.state.clock.clockSteps;
	const lines = [
		'gravity cargo · career actions and bot decisions',
		'career · ' + start.bot + ' · ' + (start.seats.length - 1) + ' rivals · seed ' + start.seed +
			' · steps ' + first + '–' + game.clockSteps + (careerPaused ? ' · world clock paused' : ''),
		'checked players: ' + slots.map(slotName).join(', ')
	];
	if (careerRecording.restored) lines.push('restored run · earlier history was not recorded');
	lines.push('opening · mask ' + start.state.mask + ' · rate ' + start.rate +
		' · ' + (start.source === MODE_PLANETS ? 'planets' : 'ports') +
		' · g/f/w/p/r/y ' + start.gs + '/' + start.fs + '/' + start.ws + '/' +
			(start.ps ?? 1) + '/' + (start.rs ?? 1) + '/' + (start.ys ?? 1) +
		(start.ht ? ' · stay-pay' : '') + (start.state.market.permanentCorruption ? ' · entrenched corruption' : '') +
		(start.cheat ? ' · ' + start.cheat : ''));
	for (const slot of slots) {
		if (slot >= start.seats.length) continue;
		const controller = start.state.run.slots[slot] === PLAYER_BOT ? 'bot' : 'human';
		lines.push(careerLogRow(first, slotName(slot), careerRecording.restored ? 'resume' : 'start',
			'HQ P' + start.seats[slot] + ' · ' + controller));
	}
	const entries = careerHistory.filter(entry => Array.isArray(entry) ? slots.includes(entry[1])
		: (slots.includes(entry.slot) || CAREER_SHARED_ACTIONS.has(entry.type)) &&
			entry.type !== 'fireQueued' && entry.type !== 'bookTrace');
	entries.sort((a, b) => (a.step ?? a[0]) - (b.step ?? b[0]));
	for (const entry of entries) lines.push(Array.isArray(entry) ? careerLogEvent(entry) : careerLogAction(entry));
	lines.push('', 'Current state:');
	for (const state of bot.traceHeaders(game.clockSteps, actors)) lines.push(state);
	return lines.join('\n');
}

function copyBotLog() {
	if (!game.on || replay.on || careerActionReplay.active) return;
	const actors = selectedBotActors();
	if (!actors.length) return;
	const text = careerRule() ? careerLogText(actors) : bot.decisionLog(game.clockSteps, botLogHeader(actors), actors);
	copyUrlText(text, botLogBtn, 'copy bot log');
}

function loadLink(hash = location.hash) {
	if (!GravityGame.isGameLink(hash)) return false;
	const params = new URLSearchParams(String(hash).replace(/^#/, ''));
	const movieText = params.get('replay');
	if (movieText !== null) {
		const movie = CareerReplay.decode(movieText);
		loadingUrl = true;
		const ok = Boolean(movie && startCareerReplay(movie, true));
		loadingUrl = false;
		if (!ok) {
			linkNote = 'invalid career replay';
			refreshGameUi();
			return false;
		}
		syncSeedUrl(true);
		return true;
	}
	const link = GravityGame.decodeLink(hash);
	if (!link) {
		linkNote = game.on ? 'invalid game link' : 'invalid link · back to lab';
		refreshGameUi();
		return false;
	}
	loadingUrl = true;
	clearMapField();
	scene.setSpeed(link.rate);
	setExperimentScales(link.gravityScale, link.forceScale, link.harvestTick,
		link.spaceWearScale, link.padScale, link.rotScale, link.payScale);
	setGiftBudgets(link.giftAll, link.giftBot, link.giftHuman);
	startGame(link.seed, true, link.rule, link.bot, link.player, link.cheat);
	if (link.shots.length > 0) startReplay(link.shots, link.end, link.length);
	loadingUrl = false;
	syncSeedUrl(true);
	return true;
}

/* `universe=` and `players=` are the two numbers the scoreboard edits, and a
 * url that carries them boots the map it describes (`syncSeedUrl` writes both
 * from the live state). Each is refused when out of range, like a bad seed. */
function readUniverseParam(params) {
	if (!params.has('universe')) return true;
	const count = Number(params.get('universe'));
	if (!Number.isInteger(count) || count < PLANET_UNIVERSE_MIN || count > PLANET_UNIVERSE_MAX) {
		return false;
	}
	/* the scoreboard's number, which `startGame` keeps across a restart */
	game.planetUniverse = count;
	initPlanetUniverse(count);
	return true;
}

function readPlayersParam(params, rule) {
	if (!params.has('players') || rule !== RULE_CAREER) return true;
	const count = Number(params.get('players'));
	if (!Number.isInteger(count) || count < 1 || count > MAX_PLAYERS) return false;
	game.playerCount = count;
	return true;
}

/* 0.7.47 WS5: a career address may name its start mode; anything else is
 * refused rather than silently falling back to a mode the link did not ask for. */
function readStartParam(params, rule) {
	if (!params.has('start') || rule !== RULE_CAREER) return true;
	const mode = params.get('start');
	if (!GravityGame.START_MODES[mode]) return false;
	game.startMode = mode;
	return true;
}

/* start-gift budgets `ga`/`gb`/`gh`: whole cr in 0..GIFT.budgetMax, absent = 0 */
function readUrlGifts(params) {
	const out = [0, 0, 0];
	const keys = ['ga', 'gb', 'gh'];
	for (let i = 0; i < keys.length; i++) {
		if (!params.has(keys[i])) continue;
		const value = Number(params.get(keys[i]));
		if (!Number.isInteger(value) || value < 0 || value > GravityGame.GIFT.budgetMax) return null;
		out[i] = value;
	}
	return out;
}

function readUrlScale(params, name, min, max) {
	if (!params.has(name)) return 1;
	const value = Number(params.get(name));
	if (!Number.isFinite(value) || value < min || value > max) return null;
	return Math.round(value * 100) / 100;
}

function loadSearchParams() {
	const search = location.search || '';
	if (!search || search === '?') return false;
	const params = new URLSearchParams(search);
	const viewParam = params.get('view');
	if (VIEW_MODES.includes(viewParam)) setViewMode(viewParam);
	/* a saved map is a local file, not a shareable seed: it wins over the rest */
	if (params.has('map')) return loadSavedMapParam(params);
	const hasGameHint = params.has('mode') || params.has('game') || params.has('rule') ||
		params.has('seed') || params.has('rate') || params.has('bot') || params.has('src') ||
		params.has('source') || params.has('player') || params.has('you') || params.has('shots') ||
		params.has('universe') || params.has('players') || params.has('start') ||
		params.has('gs') || params.has('fs') || params.has('ws') ||
		params.has('ps') || params.has('rs') || params.has('ys') || params.has('ht') ||
		params.has('ga') || params.has('gb') || params.has('gh');
	if (!hasGameHint) return false;
	const exp = GravityGame.EXPERIMENT;
	const gsNum = readUrlScale(params, 'gs', exp.gravityMin, exp.gravityMax);
	const fsNum = readUrlScale(params, 'fs', exp.forceMin, exp.forceMax);
	const wsNum = readUrlScale(params, 'ws', exp.spaceWearMin, exp.spaceWearMax);
	const psNum = readUrlScale(params, 'ps', exp.padMin, exp.padMax);
	const rsNum = readUrlScale(params, 'rs', exp.rotMin, exp.rotMax);
	const ysNum = readUrlScale(params, 'ys', exp.payMin, exp.payMax);
	if (gsNum === null || fsNum === null || wsNum === null ||
		psNum === null || rsNum === null || ysNum === null) return false;
	const htStr = params.get('ht');
	if (htStr !== null && htStr !== '1' && htStr !== '0' && htStr !== 'true' && htStr !== 'false') {
		return false;
	}
	const htFlag = htStr === '1' || htStr === 'true';
	const gifts = readUrlGifts(params);
	if (!gifts) return false;
	const modeParam = params.get('mode');
	const gameParam = params.get('game');
	const modeRule = modeParam && RULES[modeParam] ? modeParam : null;
	const hasCareerScale = params.has('ht') || params.has('ws') ||
		params.has('ps') || params.has('rs') || params.has('ys') ||
		params.has('ga') || params.has('gb') || params.has('gh');
	const shouldGame = modeParam === 'game' || gameParam === '1' || modeRule !== null ||
		params.has('rule') || params.has('seed') || params.has('rate') || params.has('bot') ||
		hasCareerScale;
	const seedStr = params.get('seed');
	const seedNum = seedStr !== null ? Number(seedStr) : tradeSim.seed;
	if (seedStr !== null && (!Number.isInteger(seedNum) || seedNum < 1 || seedNum > 0xffffffff)) return false;
	const rateStr = params.get('rate');
	const speedStr = rateStr !== null ? rateStr : params.get('speed');
	const rateNum = speedStr !== null ? Number(speedStr) : scene.trade.speed;
	if (speedStr !== null && (!Number.isFinite(rateNum) || rateNum < 0.5 || rateNum > 12)) return false;
	const sourceStr = params.get('src') || params.get('source');
	if (!readUniverseParam(params)) return false;
	if (modeParam === PLAY_LAB || !shouldGame) {
		const hadField = Boolean(PlanetGravity.armed());
		loadingUrl = true;
		clearMapField();
		stopGame();
		setExperimentScales(gsNum, fsNum, false, wsNum, psNum, rsNum, ysNum);
		setGiftBudgets(gifts[0], gifts[1], gifts[2]);
		if (seedNum !== tradeSim.seed) {
			scene.reset(seedNum);
			clearCargo();
			attachWorld();
		} else if (hadField) {
			attachWorld();
			cargoSim.refreshField();
			syncPlanetGravity();
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
	if (!ruleStr && hasCareerScale) ruleStr = RULE_CAREER;
	if (!ruleStr) ruleStr = RULE_TOUR;
	if (botStr !== null && !(botStr in GravityGame.BOTS)) return false;
	if (playerStr !== null && !(playerStr in GravityGame.PLAYER_TYPES)) return false;
	const cheatStr = params.get('cheat');
	if (cheatStr !== null && !(ruleStr === RULE_CAREER && GravityGame.CHEATS[cheatStr])) return false;
	/* a roster the url names replaces whatever the previous run left set */
	if (params.has('players')) game.playerCount = 0;
	if (!readPlayersParam(params, ruleStr)) return false;
	if (!readStartParam(params, ruleStr)) return false;
	loadingUrl = true;
	clearMapField();
	if (speedStr !== null) scene.setSpeed(rateNum);
	setExperimentScales(gsNum, fsNum, ruleStr === RULE_CAREER && htFlag,
		wsNum, psNum, rsNum, ysNum);
	setGiftBudgets(gifts[0], gifts[1], gifts[2]);
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

/* Large careers copy as text when a browser address would be too long. */
function loadReplayText() {
	const input = $('replayInput');
	const note = $('replayLoadNote');
	if (!input) return;
	const text = input.value.trim();
	let ok = false;
	if (typeof CareerActions !== 'undefined' && text.startsWith(CareerActions.PREFIX)) {
		const data = CareerActions.decode(text);
		loadingUrl = true;
		ok = Boolean(data && startCareerActionsReplay(data));
		loadingUrl = false;
		if (ok) syncSeedUrl();
	} else if (text.startsWith(CareerReplay.PREFIX)) {
		const movie = CareerReplay.decode(text.slice(CareerReplay.PREFIX.length));
		loadingUrl = true;
		ok = Boolean(movie && startCareerReplay(movie, true));
		loadingUrl = false;
		if (ok) syncSeedUrl();
	} else {
		const at = text.indexOf('#');
		const hash = at >= 0 ? text.slice(at) : '#' + text.replace(/^#/, '');
		ok = loadLink(hash);
		if (ok && history.replaceState) {
			try { history.replaceState(null, '', location.href.split('#')[0] + hash); }
			catch (error) { /* Some file:// viewers do not permit history updates. */ }
			syncSeedUrl(true);
		}
	}
	if (note) note.textContent = ok ? 'replay opened' : 'not a valid replay';
}

const replayLoadButton = $('replayLoad');
if (replayLoadButton) replayLoadButton.addEventListener('click', loadReplayText);
$('careerSaveCopy').addEventListener('click', () => {
	if (careerRule()) copyCareerReplay();
});
