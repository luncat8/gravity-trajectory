/*
 * Planet universe and world attach: universe size and per-planet strengths, protected planets and pads, attaching the sim to the trade world, the mode/bot/score radios, seed url, play mode and player count.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function planetUniverseDefault(rule) {
	return rule === RULE_CAREER ? PLANET_CAREER_DEFAULT : PLANET_DEFAULT;
}

/* a uniform draw over the run's in-play planets */
function randomActivePlanet() {
	let pick = Math.floor(Math.random() * planetCount);
	for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
		if (!planetMask[i]) continue;
		if (pick === 0) return i;
		pick -= 1;
	}
	return -1;
}

function activePlanetExtent() {
	let count = PLANET_UNIVERSE_MAX;
	while (count > 0 && !planetMask[count - 1]) count--;
	return count;
}

function initPlanetUniverse(n) {
	const count = Math.max(PLANET_UNIVERSE_MIN, Math.min(n, PLANET_UNIVERSE_MAX));
	planetMask.fill(0);
	for (let i = 0; i < count; i++) planetMask[i] = 1;
	planetCount = count;
}

/* inactive planets carry no gravity: the field and every bot sim skip them */
function syncPlanetStrengths() {
	for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
		planetStrength[i] = planetMask[i] ? planetBaseStrength[i] : 0;
	}
	bot.strength.set(planetStrength);
}

/* push the current subset into the career, market, field, scene and bot */
function applyPlanetUniverse() {
	/* the trade world follows the run's subset: a 13-planet career does not
	 * keep colonies alive on the 13 worlds the player cannot see */
	tradeSim.setPlanetMask(planetMask);
	tradeSim.setPlanetLimit(activePlanetExtent());
	GravityGame.setCareerUniverse(game.career, planetMask, planetCount);
	GravityGame.applyMarketUniverse(game.market, planetMask, planetCount);
	/* specials are a career economy rule; tour/money/route keep the plain market */
	GravityGame.applyMarketSpecials(game.market, careerRule() ? tradeSim.world : null);
	/* the political arrays only act on a bound run: careers in one galaxy */
	GravityGame.bindRun(game.market, careerRule() ? game.galaxy : null, tradeSim.world);
	cargoSim.setPlanetMask(planetMask);
	helperProbe.setPlanetMask(planetMask);
	if (scene.setPlanetMask) scene.setPlanetMask(planetMask);
	if (bot.setPlanetMask) bot.setPlanetMask(planetMask, planetCount);
	syncPlanetStrengths();
	applyMode();
	refreshPlanetUniverseUi();
}

/* every planet a player calls home, or the ship currently sits on, is kept */
function isProtectedPlanet(planet) {
	if (game.career.hq === planet || game.career.at === planet) return true;
	if (cargoSim.landedBody === planet) return true;
	if (planet === game.career.capitalPlanet || planet === game.career.arfPlanet) return true;
	const galaxy = game.galaxy;
	if (!galaxy) return false;
	for (let i = 0; i < galaxy.actors.length; i++) {
		const actor = galaxy.actors[i];
		if (actor.hq === planet || actor.at === planet) return true;
	}
	return false;
}

/* a removed planet loses its pads (no refund) so re-adding it starts fresh */
function clearPlanetPads(planet) {
	const actors = game.galaxy ? game.galaxy.actors : [game.career];
	for (let i = 0; i < actors.length; i++) {
		const career = actors[i];
		const pad = career.pads[planet];
		if (!pad) continue;
		if (pad.catapult !== null) {
			career.padCount = career.padCount > 0 ? career.padCount - 1 : 0;
		}
		pad.catapult = null;
		pad.panel = null;
		pad.battery = null;
		pad.chargeKwh = 0;
		pad.reservedKwh = 0;
	}
	if (game.career.commercialPlanet === planet) game.career.commercialPlanet = -1;
	if (game.galaxy) GravityGame.refreshNetwork(game.galaxy);
}

/* Grow or shrink the active subset by the requested amount, refusing to touch
 * a protected planet. Career rival expansion may nominate its planned HQ as
 * the first added world; ordinary size edits keep their random selection. */
function setPlanetUniverseSize(next, preferredPlanet) {
	if (replay.on || careerInputLocked()) return false;
	careerRecordingMark();
	const count = Math.max(PLANET_UNIVERSE_MIN, Math.min(next, PLANET_UNIVERSE_MAX));
	if (count === planetCount) return false;
	if (count > planetCount) {
		const need = count - planetCount;
		const free = [];
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (!planetMask[i]) free.push(i);
		}
		if (free.length < need) return false;
		let fixed = 0;
		const preferred = free.indexOf(preferredPlanet);
		if (preferred >= 0 && need > 0) {
			const swap = free[0];
			free[0] = free[preferred];
			free[preferred] = swap;
			fixed = 1;
		}
		for (let k = 0; k < need; k++) {
			if (k >= fixed) {
				const j = k + Math.floor(Math.random() * (free.length - k));
				const swap = free[k];
				free[k] = free[j];
				free[j] = swap;
			}
			planetMask[free[k]] = 1;
		}
	} else {
		const need = planetCount - count;
		const removable = [];
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (!planetMask[i]) continue;
			if (isProtectedPlanet(i)) continue;
			removable.push(i);
		}
		if (removable.length < need) return false;
		for (let k = 0; k < need; k++) {
			const j = k + Math.floor(Math.random() * (removable.length - k));
			const swap = removable[k];
			removable[k] = removable[j];
			removable[j] = swap;
			const pick = removable[k];
			planetMask[pick] = 0;
			clearPlanetPads(pick);
		}
	}
	planetCount = count;
	game.planetUniverse = count;
	cancelHelperForChange('planet count');
	applyPlanetUniverse();
	return true;
}

/* planets in play that no actor calls home — a new player needs one */
function freePlanetCount() {
	const galaxy = game.galaxy;
	let free = 0;
	for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
		if (!planetMask[i]) continue;
		let used = false;
		if (galaxy) {
			for (let a = 0; a < galaxy.actors.length; a++) {
				if (galaxy.actors[a].hq === i) { used = true; break; }
			}
		}
		if (!used) free += 1;
	}
	return free;
}
/* Rebuild strengths from the world seed without consuming the trade random stream. */
function attachWorld() {
	cargoSim.setPlanets(
		PLANETS,
		tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
		tradeSim.orbitRX, tradeSim.orbitRY,
		tradeSim.orbitTiltCos, tradeSim.orbitTiltSin
	);
	bot.attachWorld(tradeSim);
	for (let p = 0; p < PLANETS; p++) {
		planetBaseStrength[p] = GravityGame.planetGravity(tradeSim.seed, p);
		portPlanetStrength[p] = planetBaseStrength[p];
	}
	syncPlanetStrengths();
	cancelAim();
	hoverBody = -1;
	hoverPlanet = -1;
	refreshHoverLabel();
	setSelected(-1);
	applyMode();
	if (routeRule()) bot.useField(cargoSim, mode);
	helperAttachWorld();
	helperUpdateUi();
	applyExperiment();
}

function syncModeRadios() {
	const current = game.on ? game.rule : PLAY_LAB;
	for (let i = 0; i < modeEls.length; i++) {
		const el = modeEls[i][1];
		if (el) el.checked = modeEls[i][0] === current;
	}
}

function syncBotRadios() {
	if (botOffEl) botOffEl.checked = game.bot === BOT_OFF;
	if (botEasyEl) botEasyEl.checked = game.bot === BOT_EASY;
	if (botNormalEl) botNormalEl.checked = game.bot === BOT_NORMAL;
	if (botHardEl) botHardEl.checked = game.bot === BOT_HARD;
}

/* every row is a player: the bot box always flips that player between the
 * keyboard and the bot, a click always selects it for the page to watch, and
 * the hatch marks each human whose pause still holds the shared clock */
function syncScoreControls() {
	const active = activeSlotIndex();
	const watchingCareer = replay.on && replay.career;
	const pausable = pauseAllowed() || watchingCareer;
	for (let s = 0; s < scoreRowEls.length; s++) {
		const row = scoreRowEls[s];
		const box = scoreBotEls[s];
		const isBot = slotTypes[s] === PLAYER_BOT;
		const isUser = !isBot;
		const isActive = active === s;
		const isPaused = pausable && isUser && slotPaused[s];
		if (box) {
			box.checked = isBot;
			box.disabled = replay.on || careerActionReplay.active;
		}
		if (!row) continue;
		if (s > 0) row.hidden = s - 1 >= bot.count;
		row.classList.toggle('locked', replay.on && !watchingCareer);
		row.classList.toggle('isUser', isUser);
		row.classList.toggle('isActive', isActive);
		row.classList.toggle('isPaused', isPaused);
		/* a row stays in the tab order whenever a click on it would select */
		row.tabIndex = replay.on && !watchingCareer ? -1 : 0;
		row.title = watchingCareer ? 'View ' + slotName(s) + ' in the career replay' : (isBot
			? slotName(s) + ' · bot controlled (uncheck bot to play it by hand)'
			: isActive
			? slotName(s) + ' · you fly this player'
			: 'Click to view and fly ' + slotName(s)) +
			(isPaused ? ' · paused, holds the clock' : '');
	}
}

function randomSeed() {
	return 1 + Math.floor(Math.random() * SEED_RANGE);
}

/* A fresh page gets a new world unless the address pins one. Replay hashes
 * keep their recorded seed, a saved map brings its own, and an ordinary query
 * seed wins over a stale mode. */
function startupSeed() {
	if (GravityGame.isGameLink(location.hash)) {
		const link = GravityGame.decodeLink(location.hash);
		if (link) return link.seed;
	}
	const params = new URLSearchParams(location.search);
	const record = savedMapParam(params.get('map'));
	if (record) return record.seed;
	const value = params.get('seed');
	if (value !== null) {
		const seed = Number(value);
		if (Number.isInteger(seed) && seed >= 1 && seed <= 0xffffffff) return seed;
	}
	return randomSeed();
}

/* the universe a url should carry: the run's live subset, or the scoreboard
 * number a run that is about to start will keep */
function universeParam() {
	if (game.on) return planetCount;
	return game.planetUniverse > 0 ? game.planetUniverse : PLANET_DEFAULT;
}

/* Keep the address shareable without navigating or overwriting a replay hash.
 *
 * Every param the address names is one the boot already reads, and each is
 * written from the live state: a url that says `universe=8` boots the 8-world
 * map, and one that says `bot=off` boots without rivals. A param the page
 * does not read is dropped instead of kept, so a stale `you=bot` from a link
 * or `map=` from a saved map never outlives the state it described. `view`
 * is the one exception: it is read at boot and this editor does not know the
 * live view mode, so it is left alone. */
function syncSeedUrl(keepReplay = false) {
	if (loadingUrl) return;
	const params = new URLSearchParams(location.search);
	params.set('seed', String(game.on ? game.seed : tradeSim.seed));
	params.set('mode', game.on ? game.rule : PLAY_LAB);
	params.set('universe', String(universeParam()));
	params.delete('game');
	params.delete('rule');
	params.delete('source');
	if (mode === MODE_PORTS) params.set('src', 'ports');
	else params.delete('src');
	params.delete('player');
	const fieldMap = activeFieldMapName();
	if (fieldMap) params.set('map', fieldMap);
	else params.delete('map');
	if (game.on && game.player === PLAYER_BOT) params.set('you', PLAYER_BOT);
	else params.delete('you');
	if (game.on && game.bot !== BOT_NORMAL) params.set('bot', game.bot);
	else params.delete('bot');
	if (game.on && game.cheat) params.set('cheat', game.cheat);
	else params.delete('cheat');
	/* a career's roster is a game.playerCount the boot honors; other rules
	 * field their rivals from the level, so they carry no roster param */
	if (game.on && careerRule() && game.playerCount > 0) params.set('players', String(game.playerCount));
	else params.delete('players');
	if (game.on && game.fixedRate) {
		params.set('rate', String(scene.trade.speed));
		params.delete('speed');
	} else {
		/* Both URL keys carry raw speed, never the display multiplier. Writing
		 * the multiplier here doubled the orbit/gravity rate on every reload. */
		params.delete('rate');
		const speed = scene.trade.speed;
		if (speed === scene.trade.speedDefault) params.delete('speed');
		else params.set('speed', String(speed));
	}
	if (!keepReplay) {
		params.delete('shots');
		params.delete('end');
		params.delete('len');
	}
	const hash = keepReplay || !GravityGame.isGameLink(location.hash) ? location.hash : '';
	const base = location.href.split('#')[0].split('?')[0];
	try { root.history.replaceState(null, '', base + '?' + params.toString() + hash); }
	catch (e) { /* Some file:// viewers do not permit history updates. */ }
}
