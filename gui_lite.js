/*
 * Lite profile: a viewer setting for slow devices, battery play and test
 * sessions. A career whose seed nobody pinned starts on a saved opening (no
 * seat search), the trade backdrop over static planets holds one still frame,
 * and sound and postcards stay off. Rules, physics and the run state are never
 * touched: a lite run and a full run of the same seed are the same run.
 *
 * `?lite=1` / `?lite=0` set it for the tab and stay in the address; only the
 * checkbox stores the choice (and drops the address override).
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

const LITE_STORAGE = 'gravity.lite';
const liteModeEl = $('liteMode');

function readStoredLite() {
	try { return root.localStorage.getItem(LITE_STORAGE) === '1'; }
	catch (err) { return false; }
}

let liteParam = new URLSearchParams(location.search).get('lite');
if (liteParam !== '1' && liteParam !== '0') liteParam = null;
let liteMode = liteParam === null ? readStoredLite() : liteParam === '1';

/* saved openings a career on this roster and these scales can be seated from */
function liteRecords(universe, seats) {
	return savedMapList().filter(record => record.kind === 'start' &&
		record.universe === universe && record.seats.length === seats &&
		!Array.isArray(record.gravity) &&
		(record.gs ?? 1) === gravityScale && (record.fs ?? 1) === forceScale);
}

function liteSeeds(universe, seats) {
	const seeds = new Set(liteRecords(universe, seats).map(record => record.seed >>> 0));
	return Array.from(seeds).sort((a, b) => a - b);
}

/* YOU plus the difficulty's rival careers, unless the scoreboard pins a count */
function liteSeats(level) {
	if (game.playerCount > 0) return game.playerCount;
	const spec = GravityBot.LEVELS[level] || GravityBot.LEVELS[BOT_NORMAL];
	return 1 + spec.careerCount;
}

/* the boot's unpinned seed: a saved one for the roster the address asks for */
function liteBootSeed(params) {
	const universe = Number(params.get('universe')) || PLANET_CAREER_DEFAULT;
	const players = Number(params.get('players'));
	const seats = Number.isInteger(players) && players > 0 ? players : liteSeats(params.get('bot') || game.bot);
	const seeds = liteSeeds(universe, seats);
	return seeds.length ? seeds[Math.floor(Math.random() * seeds.length)] : randomSeed();
}

/* `new seed`: a lite career cycles the saved openings of its roster; Shift, a
 * roster with none, or any other rule rolls a world for the live planner */
function newRunSeed(fresh) {
	if (!liteMode || fresh || !careerRule()) return randomSeed();
	const universe = game.planetUniverse > 0 ? game.planetUniverse : planetUniverseDefault(game.rule);
	const seeds = liteSeeds(universe, playerCountShown());
	if (!seeds.length) return randomSeed();
	let next = seeds[0];
	for (let i = 0; i < seeds.length; i++) {
		if (seeds[i] > game.seed) {
			next = seeds[i];
			break;
		}
	}
	return next === game.seed ? randomSeed() : next;
}

/* arms the saved opening of this run's world; `applySeats` still checks
 * every field of it against the live run before it replaces the search */
function liteArmOpening(seed) {
	if (!liteMode || GravityMaps.armed() || PlanetGravity.armed()) return;
	const records = liteRecords(planetCount, 1 + bot.count);
	for (let i = 0; i < records.length; i++) {
		if ((records[i].seed >>> 0) !== (seed >>> 0)) continue;
		GravityMaps.arm(records[i]);
		return;
	}
}

/* moving ports are gravity bodies, so only a planet field may hold still */
function syncStillBackdrop() {
	scene.setStill(liteMode && mode === MODE_PLANETS);
}

function applyLite() {
	if (liteModeEl) liteModeEl.checked = liteMode;
	syncStillBackdrop();
	/* the stored sound choice stays as it is; lite only holds it off */
	sound.setEnabled(soundEnabled && !liteMode);
	refreshSoundToggle();
	if (root.PhotoDeck) root.PhotoDeck.setEnabled(!liteMode);
	gameNewSeedBtn.title = liteMode
		? 'next saved career opening for this roster (shift: any random world)'
		: 'random world';
}

if (liteModeEl) liteModeEl.addEventListener('change', () => {
	liteMode = liteModeEl.checked;
	liteParam = null;
	try { root.localStorage.setItem(LITE_STORAGE, liteMode ? '1' : '0'); }
	catch (err) { /* the profile still applies to this tab */ }
	applyLite();
	syncSeedUrl(true);
});
