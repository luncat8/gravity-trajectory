/*
 * Saved maps on the page: save the current career's opening or its exact state
 * (append to the registry and download `saved_maps.js`), load a saved map at
 * boot or from the run panel, and report what happened in the career notice.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

const mapSaveBtn = $('mapSave');
const mapSaveRunBtn = $('mapSaveRun');
const mapLoadBtn = $('mapLoad');
const mapLoadRunBtn = $('mapLoadRun');
const mapNoteEl = $('mapNote');
const mapPickEl = $('mapPick');

/* the registry is `saved_maps.js`, a data script the page loads first; a save
 * appends here and downloads the regenerated file over it */
function savedMapList() {
	if (typeof SAVED_MAPS !== 'undefined' && Array.isArray(SAVED_MAPS)) return SAVED_MAPS;
	return (globalThis.SAVED_MAPS = []);
}

function mapNotice(text) {
	if (mapNoteEl) mapNoteEl.textContent = text;
	careerNotice(text);
	refreshMapsUi();
}

/* The picker lists the registry in its own order, so an index is the record:
 * `random` (the empty value) keeps the buttons' old behaviour, and a picked
 * record is what a load button uses. It is rebuilt in place and keeps the
 * player's choice, because every notice refreshes this panel. */
function mapPickOption(record, index) {
	const label = index + ' · ' + record.name + (record.kind === 'run' ? ' · run' : '');
	const option = document.createElement('option');
	option.value = String(index);
	option.textContent = label;
	return option;
}

let mapPickSignature = '';

function refreshMapPick() {
	if (!mapPickEl) return;
	const records = savedMapList();
	const keep = mapPickEl.value;
	/* every notice refreshes this panel: rebuild the list only when the registry
	 * itself changed, so an open dropdown is not closed under the pointer */
	const signature = records.length + '|' +
		records.map(record => record.name + ':' + record.kind).join('|');
	if (signature !== mapPickSignature) {
		mapPickSignature = signature;
		while (mapPickEl.firstChild) mapPickEl.removeChild(mapPickEl.firstChild);
		const random = document.createElement('option');
		random.value = '';
		random.textContent = 'random';
		mapPickEl.appendChild(random);
		for (let i = 0; i < records.length; i++) mapPickEl.appendChild(mapPickOption(records[i], i));
	}
	mapPickEl.value = keep !== '' && records[Number(keep)] ? keep : '';
	mapPickEl.disabled = records.length === 0;
	mapPickEl.title = records.length
		? 'load the picked saved map, or a random one'
		: 'saved_maps.js has no map to load';
}

/* the record the picker names, of `kind` when one is given */
function mapPickedRecord(kind) {
	if (!mapPickEl || mapPickEl.value === '') return null;
	const record = savedMapList()[Number(mapPickEl.value)];
	if (!record || (kind && record.kind !== kind)) return null;
	return record;
}

function refreshMapsUi() {
	const records = savedMapList();
	const starts = GravityMaps.hasKind(records, 'start');
	const runs = GravityMaps.hasKind(records, 'run');
	if (mapLoadBtn) mapLoadBtn.disabled = !starts;
	if (mapLoadRunBtn) mapLoadRunBtn.disabled = !runs;
	if (mapSaveBtn) mapSaveBtn.title = 'append this career opening to saved_maps.js and download it';
	if (mapSaveRunBtn) {
		mapSaveRunBtn.title = 'append an exact snapshot of this run to saved_maps.js and download it';
	}
	refreshMapPick();
}

/* the run's start fields plus the live objects a snapshot needs */
function mapRunInfo() {
	const sims = [cargoSim];
	const rivals = [];
	for (let i = 0; i < bot.count; i++) {
		rivals.push(bot.rivals[i]);
		sims.push(bot.rivals[i].sim);
	}
	return {
		seed: game.seed,
		universe: planetCount,
		mask: planetMask,
		galaxy: game.galaxy,
		rule: game.rule,
		bot: game.bot,
		player: game.player,
		cheat: game.cheat,
		rate: scene.trade.speed,
		gs: gravityScale,
		fs: forceScale,
		ws: spaceWearScale,
		ht: harvestTick,
		game: game,
		market: game.market,
		trade: tradeSim,
		cargo: cargoSim,
		sims: sims,
		rivals: rivals,
		planner: bot.careerPlayer,
		slots: slotTypes,
		clockSteps: game.clockSteps,
		paused: careerPaused,
		/* page scalars that decide the next frame, not the world: the leftover
		 * step accumulator and whether the bot still owes a between-flight
		 * refresh. A continuation must not replay either from scratch. */
		page: { playAcc: playAcc, sync: playerBotSyncNeeded }
	};
}

function mapsReady(what) {
	if (!game.on || !careerRule()) {
		mapNotice('a career run is needed to ' + what);
		return false;
	}
	if (!game.galaxy.mapSeats || game.galaxy.mapSeats.length === 0) {
		mapNotice('this run has no planned opening to ' + what);
		return false;
	}
	return true;
}

/* two records of the same world and seats are the same start map */
function mapSameStart(a, b) {
	if (a.seed !== b.seed || a.universe !== b.universe) return false;
	if (a.seats.length !== b.seats.length) return false;
	for (let i = 0; i < a.seats.length; i++) {
		if (a.seats[i] !== b.seats[i]) return false;
	}
	return a.gs === b.gs && a.fs === b.fs;
}

function mapAppend(record) {
	const records = savedMapList();
	for (let i = 0; i < records.length; i++) {
		if (records[i].kind !== record.kind) continue;
		if (record.kind === 'start' && mapSameStart(records[i], record)) return i;
		if (record.kind === 'run' && records[i].name === record.name) return i;
	}
	records.push(record);
	return records.length - 1;
}

function mapSaved(record, index) {
	const file = GravityMaps.download(savedMapList(), 'saved_maps.js');
	mapNotice((file ? 'downloaded' : 'recorded') + ' map ' + index + ' · ' + record.name);
	return record;
}

function saveStartMap() {
	if (!mapsReady('save its map')) return null;
	const record = GravityMaps.startRecord(mapRunInfo());
	const index = mapAppend(record);
	return mapSaved(record, index);
}

/* an exact state is captured at rest: a flying ship or a queued barrel is a
 * moment the page cannot rebuild from numbers alone */
function careerAtRest() {
	if (replay.on) return 'finish the replay first';
	if (cargoSim.status === GravitySim.STATUS_FLYING) return 'land the ship first';
	for (let i = 0; i < bot.count; i++) {
		if (bot.rivals[i].sim.status === GravitySim.STATUS_FLYING) return 'wait for the rivals to land';
	}
	for (let s = 0; s < slotCount(); s++) {
		if (slotTurrets[s].pending) return 'a queued launch is waiting';
	}
	return '';
}

function saveRunState() {
	if (!mapsReady('save its state')) return null;
	const why = careerAtRest();
	if (why) {
		mapNotice('cannot save: ' + why);
		return null;
	}
	const record = GravityMaps.runRecord(mapRunInfo());
	const index = mapAppend(record);
	return mapSaved(record, index);
}

/* the universe a saved run was played on: a mid-run rival can add a planet, so
 * the record carries the mask, not just its size */
function pendingUniverse() {
	const record = GravityMaps.armed();
	if (!record || !record.state || typeof record.state.mask !== 'string') return false;
	const mask = record.state.mask;
	planetMask.fill(0);
	let count = 0;
	for (let i = 0; i < PLANETS && i < mask.length; i++) {
		if (mask[i] !== '1') continue;
		planetMask[i] = 1;
		count += 1;
	}
	planetCount = count;
	refreshPlanetUniverseUi();
	return true;
}

function applyRunRecord(record) {
	const info = mapRunInfo();
	if (!GravityMaps.applyState(info, record)) return false;
	careerPaused = record.state.clock.paused === true;
	if (record.state.page) {
		playAcc = record.state.page.playAcc || 0;
		playerBotSyncNeeded = record.state.page.sync === true;
	}
	for (let s = 0; s < slotCount(); s++) slotPaused[s] = false;
	if (careerPaused) careerPauseNow = performance.now();
	if (scene.setFrozen) scene.setFrozen(careerPaused);
	/* the restored pads and HQs decide the field, not the fresh run's defaults */
	attachWorld();
	pinCareerStrengths();
	cargoSim.refreshField();
	syncPlanetGravity();
	cargoSim.fieldT = tradeSim.t;
	cargoSim.fieldRate = scene.trade.speed;
	dirty = true;
	refreshCareerClockUi();
	refreshGameUi();
	refreshSelected();
	return true;
}

function startMapRecord(record) {
	if (!record || !RULES[record.rule]) {
		mapNotice('no saved map to load');
		return false;
	}
	if (!record.seats || record.seats.length === 0) {
		mapNotice('saved map has no seats');
		return false;
	}
	GravityMaps.arm(record);
	if (record.rate) scene.setSpeed(record.rate);
	setExperimentScales(record.gs, record.fs, record.ht, record.ws);
	game.playerCount = record.seats.length;
	game.planetUniverse = record.universe;
	startGame(record.seed, true, record.rule, record.bot, record.player, record.cheat);
	if (record.kind !== 'run') {
		mapNotice('loaded ' + record.name);
		return true;
	}
	if (!applyRunRecord(record)) {
		mapNotice('saved run could not be restored · fresh start');
		return false;
	}
	mapNotice('loaded ' + record.name);
	careerRecordingReset(true);
	return true;
}

/* the picked record when it is what the button loads, otherwise a random one */
function loadSavedMap(kind) {
	const picked = mapPickedRecord(kind);
	const record = picked || GravityMaps.pick(savedMapList(), kind, Math.random);
	if (!record) {
		mapNotice('saved_maps.js has no ' + kind + ' map');
		return false;
	}
	const loaded = startMapRecord(record);
	if (loaded && mapPickEl) mapPickEl.value = String(savedMapList().indexOf(record));
	return loaded;
}

/* the record `?map=<index>` or `?map=<name>` names */
function savedMapParam(text) {
	if (text === null) return null;
	const records = savedMapList();
	const index = Number(text);
	if (Number.isInteger(index) && index >= 0 && index < records.length) return records[index];
	let record = null;
	for (let i = 0; i < records.length; i++) {
		if (records[i].name === text) record = records[i];
	}
	return record;
}

/* `?map=`: the boot path page tests and players use.
 *
 * The record proves the seats, not the run: what the url names wins over the
 * record the way it wins over a seed link's level. `syncSeedUrl` writes every
 * one of these from the live state, so `?map=3` becomes `?seed=4&mode=career
 * …&universe=26` a moment after it boots, and a reload of that address is the
 * run the record seated (no map, no search — the plan is cached per key).
 * Only `rule` cannot move: the plan was proven on the career's opening rule. */
function loadSavedMapParam(params) {
	const record = savedMapParam(params.get('map'));
	if (!record) return false;
	const options = {};
	/* who flies YOU and how fast the orbit clock runs, as on a seed link */
	const player = params.get('you') || params.get('player');
	if (player && GravityGame.PLAYER_TYPES[player]) options.player = player;
	const rate = Number(params.get('rate'));
	if (rate >= GravityGame.RATE_MIN && rate <= GravityGame.RATE_MAX) options.rate = rate;
	const bot = params.get('bot');
	if (bot && bot in GravityGame.BOTS) options.bot = bot;
	const cheat = params.get('cheat');
	if (cheat && GravityGame.CHEATS[cheat]) options.cheat = cheat;
	/* a roster or a universe in the url is the record's, not the address's: the
	 * seats were proven on that world for that many companies. `syncSeedUrl`
	 * writes the two back into the address at boot, so the url says what the run
	 * is instead of keeping a number nothing read. */
	return startMapRecord(Object.assign({}, record, options));
}

if (mapSaveBtn) mapSaveBtn.addEventListener('click', saveStartMap);
if (mapSaveRunBtn) mapSaveRunBtn.addEventListener('click', saveRunState);
if (mapLoadBtn) mapLoadBtn.addEventListener('click', () => loadSavedMap('start'));
if (mapLoadRunBtn) mapLoadRunBtn.addEventListener('click', () => loadSavedMap('run'));
refreshMapsUi();
