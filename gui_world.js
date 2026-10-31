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
	GravityGame.setCareerUniverse(game.career, planetMask, planetCount);
	GravityGame.applyMarketUniverse(game.market, planetMask, planetCount);
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

/* grow or shrink the active subset by the requested amount, one random
 * planet per step, refusing to touch a protected planet */
function setPlanetUniverseSize(next) {
	const count = Math.max(PLANET_UNIVERSE_MIN, Math.min(next, PLANET_UNIVERSE_MAX));
	if (count === planetCount) return false;
	if (count > planetCount) {
		const need = count - planetCount;
		const free = [];
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (!planetMask[i]) free.push(i);
		}
		if (free.length < need) return false;
		for (let k = 0; k < need; k++) {
			const j = k + Math.floor(Math.random() * (free.length - k));
			const swap = free[k];
			free[k] = free[j];
			free[j] = swap;
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

function syncScoreControls(flightLock) {
	const active = activeSlotIndex();
	for (let s = 0; s < scoreRowEls.length; s++) {
		const row = scoreRowEls[s];
		const box = scoreBotEls[s];
		const isBot = slotTypes[s] === PLAYER_BOT;
		const isUser = !isBot;
		const isActive = isUser && active === s;
		if (box) {
			box.checked = isBot;
			box.disabled = replay.on || careerRule();
		}
		if (!row) continue;
		if (s > 0) row.hidden = s - 1 >= bot.count;
		row.classList.toggle('locked', replay.on);
		row.classList.toggle('isUser', isUser);
		row.classList.toggle('isActive', isActive);
		row.tabIndex = isUser && !flightLock ? 0 : -1;
		row.title = isBot
			? slotName(s) + ' · bot controlled (uncheck bot to play manually)'
			: isActive
			? slotName(s) + ' · active user'
			: 'Click to play as ' + slotName(s);
	}
}

function randomSeed() {
	return 1 + Math.floor(Math.random() * SEED_RANGE);
}

/* A fresh page gets a new world unless the address pins one. Replay hashes
 * keep their recorded seed; an ordinary query seed wins over a stale mode. */
function startupSeed() {
	if (GravityGame.isGameLink(location.hash)) {
		const link = GravityGame.decodeLink(location.hash);
		if (link) return link.seed;
	}
	const value = new URLSearchParams(location.search).get('seed');
	if (value !== null) {
		const seed = Number(value);
		if (Number.isInteger(seed) && seed >= 1 && seed <= 0xffffffff) return seed;
	}
	return randomSeed();
}

/* Keep the address shareable without navigating or overwriting a replay hash. */
function syncSeedUrl(keepReplay = false) {
	if (loadingUrl) return;
	const params = new URLSearchParams(location.search);
	params.set('seed', String(game.on ? game.seed : tradeSim.seed));
	params.set('mode', game.on ? game.rule : PLAY_LAB);
	params.delete('game');
	params.delete('rule');
	params.delete('source');
	if (mode === MODE_PORTS) params.set('src', 'ports');
	else params.delete('src');
	params.delete('player');
	if (game.on && game.player === PLAYER_BOT) params.set('you', PLAYER_BOT);
	else params.delete('you');
	if (game.on && game.bot !== BOT_NORMAL) params.set('bot', game.bot);
	else params.delete('bot');
	if (game.on && game.cheat) params.set('cheat', game.cheat);
	else params.delete('cheat');
	if (game.on && game.fixedRate) {
		params.set('rate', String(scene.trade.speed));
		params.delete('speed');
	} else {
		params.delete('rate');
		if (scene.trade.speed !== 0.5) params.set('speed', String(scene.trade.speed));
		else params.delete('speed');
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
