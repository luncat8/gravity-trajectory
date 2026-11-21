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

/* the registries are `saved_maps.js` and `map_fields.js`, data scripts the page
 * loads first; a save appends to `SAVED_MAPS` and downloads the regenerated file */
function savedMapList() {
	if (typeof SAVED_MAPS !== 'undefined' && Array.isArray(SAVED_MAPS)) return SAVED_MAPS;
	return (globalThis.SAVED_MAPS = []);
}

function savedFieldList() {
	if (typeof MAP_FIELDS !== 'undefined' && Array.isArray(MAP_FIELDS)) return MAP_FIELDS;
	return (globalThis.MAP_FIELDS = []);
}

let activeFieldMap = '';

function clearMapField() {
	activeFieldMap = '';
	PlanetGravity.disarm();
}

function activeFieldMapName() {
	const field = PlanetGravity.armed();
	const seed = game.on ? game.seed : tradeSim.seed;
	if (!field || field.seed !== (seed >>> 0)) return '';
	return activeFieldMap;
}

function sameRecordField(a, b) {
	const tagA = a && Array.isArray(a.gravity) ? PlanetGravity.fieldTag(a.gravity) : 0;
	const tagB = b && Array.isArray(b.gravity) ? PlanetGravity.fieldTag(b.gravity) : 0;
	return tagA === tagB;
}

function fieldParamKey(record) {
	if (!record || !Array.isArray(record.gravity) || !record.gravity.length) return '';
	const seed = record.seed >>> 0;
	const tag = PlanetGravity.fieldTag(record.gravity);
	if (record.name) {
		const named = savedMapParam(String(record.name));
		if (named && (named.seed >>> 0) === seed && Array.isArray(named.gravity) &&
			PlanetGravity.fieldTag(named.gravity) === tag) {
			return String(record.name);
		}
	}
	const maps = savedMapList();
	for (let i = 0; i < maps.length; i++) {
		if ((maps[i].seed >>> 0) === seed && Array.isArray(maps[i].gravity) &&
			PlanetGravity.fieldTag(maps[i].gravity) === tag) {
			const name = maps[i].name ? String(maps[i].name) : '';
			return name && savedMapParam(name) === maps[i] ? name : String(i);
		}
	}
	const fields = savedFieldList();
	for (let i = 0; i < fields.length; i++) {
		if ((fields[i].seed >>> 0) === seed && Array.isArray(fields[i].gravity) &&
			PlanetGravity.fieldTag(fields[i].gravity) === tag) {
			const name = fields[i].name ? String(fields[i].name) : '';
			return name && savedMapParam(name) === fields[i] ? name : 'field:' + i;
		}
	}
	return '';
}

function recordOptionKey(record) {
	const mapIdx = savedMapList().indexOf(record);
	if (mapIdx >= 0) return String(mapIdx);
	const fieldIdx = savedFieldList().indexOf(record);
	if (fieldIdx >= 0) return 'field:' + fieldIdx;
	return '';
}

function recordByOptionKey(value) {
	if (value === '' || value === null || value === undefined) return null;
	const text = String(value);
	if (text.startsWith('field:')) {
		const idx = Number(text.slice(6));
		return Number.isInteger(idx) ? savedFieldList()[idx] || null : null;
	}
	const idx = Number(text);
	return Number.isInteger(idx) ? savedMapList()[idx] || null : null;
}

function matchesLoadKind(record, kind) {
	if (!record) return false;
	if (!kind) return true;
	if (kind === 'start') return record.kind === 'start' || record.kind === 'field';
	return record.kind === kind;
}

function mapNotice(text) {
	if (mapNoteEl) mapNoteEl.textContent = text;
	careerNotice(text);
	refreshMapsUi();
}

/* The picker lists `saved_maps.js` in its own order followed by any designed
 * fields in `map_fields.js`: `random` (the empty value) keeps the buttons' old
 * behaviour, and a picked record is what a load button uses. */
function mapPickOption(record, value, prefix) {
	const suffix = record.kind === 'run' ? ' · run'
		: record.kind === 'field' ? ' · field' : '';
	const option = document.createElement('option');
	option.value = value;
	option.textContent = prefix + ' · ' + record.name + suffix;
	return option;
}

let mapPickSignature = '';

function refreshMapPick() {
	if (!mapPickEl) return;
	const records = savedMapList();
	const fields = savedFieldList();
	const total = records.length + fields.length;
	const keep = mapPickEl.value;
	/* every notice refreshes this panel: rebuild the list only when the registry
	 * itself changed, so an open dropdown is not closed under the pointer */
	const signature = records.length + '|' +
		records.map(record => record.name + ':' + record.kind).join('|') + '||' +
		fields.length + '|' +
		fields.map(record => record.name + ':' + record.kind).join('|');
	if (signature !== mapPickSignature) {
		mapPickSignature = signature;
		while (mapPickEl.firstChild) mapPickEl.removeChild(mapPickEl.firstChild);
		const random = document.createElement('option');
		random.value = '';
		random.textContent = 'random';
		mapPickEl.appendChild(random);
		for (let i = 0; i < records.length; i++) {
			mapPickEl.appendChild(mapPickOption(records[i], String(i), String(i)));
		}
		for (let i = 0; i < fields.length; i++) {
			mapPickEl.appendChild(mapPickOption(fields[i], 'field:' + i, 'f' + i));
		}
	}
	mapPickEl.value = recordByOptionKey(keep) ? keep : '';
	mapPickEl.disabled = total === 0;
	mapPickEl.title = total
		? 'load the picked saved map, or a random one'
		: 'saved_maps.js has no map to load';
}

/* the record the picker names, of `kind` when one is given */
function mapPickedRecord(kind) {
	if (!mapPickEl || mapPickEl.value === '') return null;
	const record = recordByOptionKey(mapPickEl.value);
	if (!matchesLoadKind(record, kind)) return null;
	return record;
}

function refreshMapsUi() {
	const records = savedMapList();
	const fields = savedFieldList();
	const starts = GravityMaps.hasKind(records, 'start') ||
		GravityMaps.hasKind(records, 'field') ||
		GravityMaps.hasKind(fields, 'field');
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
	if (!sameRecordField(a, b)) return false;
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
		if ((record.kind === 'start' || record.kind === 'field') && mapSameStart(records[i], record)) return i;
		if (record.kind === 'run' && records[i].name === record.name && sameRecordField(records[i], record)) return i;
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
	if (record.kind === 'field' && !activeFieldMap) {
		activeFieldMap = fieldParamKey(savedMapList()[index]);
		syncSeedUrl();
	}
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

const FIELD_FAIR_MIN_RATIO = 0.55;

function planFieldOpening(record, wantedSeats, gs, fs) {
	if (!Number.isInteger(record.universe) ||
		record.universe < PLANET_UNIVERSE_MIN || record.universe > PLANET_UNIVERSE_MAX ||
		!Array.isArray(record.gravity) || record.gravity.length < record.universe) {
		return null;
	}
	const mask = new Uint8Array(PLANETS);
	mask.fill(1, 0, record.universe);
	const sim = new OrbitSim(record.seed);
	sim.setPlanetMask(mask);
	sim.step(420);
	sim.setPlanetLimit(record.universe);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, record.seed);
	const probe = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	probe.setScales(gs, fs);
	const homes = GravityGame.prepareCareerStarts(
		galaxy, sim.world, sim, mask, record.universe, wantedSeats, probe);
	if (!homes) return null;
	const forced = new Uint8Array(PLANETS);
	for (let i = 0; i < homes.length; i++) forced[homes[i]] = 1;
	const stats = GravityGame.openingGroupStats(
		sim.world, sim, mask, record.universe, forced, homes, probe);
	const ratio = stats.maxPay > 0 ? stats.minPay / stats.maxPay : 0;
	if (stats.missing !== 0 || !stats.distinct || !stats.exitOk || ratio < FIELD_FAIR_MIN_RATIO) {
		return null;
	}
	return homes;
}

function startMapRecord(record) {
	const rule = record && (record.rule || (record.kind === 'field' ? RULE_CAREER : ''));
	if (!record || !RULES[rule]) {
		mapNotice('no saved map to load');
		return false;
	}
	const botLevel = record.bot && record.bot in GravityGame.BOTS ? record.bot : (game.bot || BOT_NORMAL);
	const player = record.player && GravityGame.PLAYER_TYPES[record.player] ? record.player : PLAYER_USER;
	const cheat = record.cheat || null;
	const gs = record.gs === undefined ? 1 : record.gs;
	const fs = record.fs === undefined ? 1 : record.fs;
	const ws = record.ws === undefined ? 1 : record.ws;
	const ht = record.ht === true;
	const hasSeats = Array.isArray(record.seats) && record.seats.length > 0;
	let plannedCount = hasSeats ? record.seats.length : 0;
	let plannedLive = false;
	if (!hasSeats) {
		if (record.kind !== 'field') {
			mapNotice('saved map has no seats');
			return false;
		}
		const prevField = PlanetGravity.armed();
		const prevMap = activeFieldMap;
		GravityMaps.applyField(record);
		const defaultPlayers = botLevel === BOT_OFF ? 1 : botLevel === BOT_EASY ? 2 : 3;
		const wanted = rule === RULE_CAREER
			? (Number.isInteger(record.players) && record.players >= 1 && record.players <= MAX_PLAYERS
				? record.players : defaultPlayers)
			: 1;
		const homes = rule === RULE_CAREER ? planFieldOpening(record, wanted, gs, fs) : [0];
		if (!homes) {
			if (prevField) PlanetGravity.arm(prevField.values, prevField.seed);
			else PlanetGravity.disarm();
			activeFieldMap = prevMap;
			mapNotice('no fair opening in this field');
			return false;
		}
		plannedCount = homes.length;
		plannedLive = rule === RULE_CAREER;
	} else {
		GravityMaps.applyField(record);
		GravityMaps.arm(record);
	}
	activeFieldMap = fieldParamKey(record);
	if (record.rate) scene.setSpeed(record.rate);
	setExperimentScales(gs, fs, ht, ws);
	game.playerCount = plannedCount;
	game.planetUniverse = record.universe;
	startGame(record.seed, true, rule, botLevel, player, cheat);
	if (record.kind !== 'run') {
		mapNotice('loaded ' + record.name + (plannedLive ? ' · saved map planned its opening' : ''));
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
	const pool = savedMapList().concat(savedFieldList()).filter(r => matchesLoadKind(r, kind));
	const record = picked || (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
	if (!record) {
		mapNotice('saved_maps.js has no ' + kind + ' map');
		return false;
	}
	const loaded = startMapRecord(record);
	if (loaded && mapPickEl) mapPickEl.value = recordOptionKey(record);
	return loaded;
}

/* the record `?map=<index>`, `?map=field:<index>`, or `?map=<name>` names */
function savedMapParam(text) {
	if (text === null) return null;
	if (String(text).startsWith('field:')) {
		const fIdx = Number(String(text).slice(6));
		const fields = savedFieldList();
		if (Number.isInteger(fIdx) && fIdx >= 0 && fIdx < fields.length) return fields[fIdx];
	}
	const records = savedMapList();
	const index = Number(text);
	if (Number.isInteger(index) && index >= 0 && index < records.length) return records[index];
	let record = null;
	for (let i = 0; i < records.length; i++) {
		if (records[i].name === text) record = records[i];
	}
	const fields = savedFieldList();
	for (let i = 0; i < fields.length; i++) {
		if (fields[i].name === text) record = fields[i];
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
