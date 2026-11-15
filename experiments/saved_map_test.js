/*
 * Saved maps (0.7.8): the registry, the seat plan it replaces, and the exact
 * run state.
 *
 * 1. `saved_maps.js` is well-formed and its records are unique.
 * 2. A record seats a career headlessly without the opening search, and the
 *    plan is the one the page would have found (checked on the fairness rule).
 * 3. `fileText` writes a file that loads back to the same records in a fresh
 *    JS context — the save action's only format.
 * 4. A page booted on `?map=` reports the saved seats, fast (the search is the
 *    ~33 s part of a career boot).
 * 5. An exact state captured at rest and restored into a second page continues
 *    identically: both pages are driven with the same frames and their captured
 *    states must still be equal.
 *
 * Run: node experiments/saved_map_test.js            (PLANNED=1 adds the 40 s
 *      planned-boot comparison per record)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityMaps = require(path.join(root, 'saved_map.js'));
const MAPS = require(path.join(root, 'saved_maps.js'));
const { loadPage } = require('./dom_stub.js');

const PLANNED = process.env.PLANNED === '1';
const PLANETS = OrbitWorld.PLANETS;

/* --- 1. the registry ---------------------------------------------------- */

assert.ok(Array.isArray(MAPS), 'saved_maps.js exports a list');
assert.ok(MAPS.length > 0, 'saved_maps.js has at least one map');
const seen = new Set();
for (const record of MAPS) {
	assert.strictEqual(record.v, 1, 'record format version');
	assert.ok(record.kind === 'start' || record.kind === 'run', 'record kind');
	assert.ok(Number.isInteger(record.seed) && record.seed >= 1, record.name + ': seed');
	assert.ok(Number.isInteger(record.universe) && record.universe >= 4 &&
		record.universe <= PLANETS, record.name + ': universe');
	assert.ok(Array.isArray(record.seats) && record.seats.length >= 2,
		record.name + ': seats');
	for (const seat of record.seats) {
		assert.ok(Number.isInteger(seat) && seat >= 0 && seat < record.universe,
			record.name + ': seat ' + seat + ' inside the universe');
	}
	assert.ok(record.seats.length <= record.universe, record.name + ': seats fit');
	const key = record.kind + ':' + record.seed + ':' + record.universe + ':' +
		record.seats.join(',');
	assert.ok(!seen.has(key), 'duplicate record ' + key);
	seen.add(key);
	assert.ok(GravityGame.RULES[record.rule], record.name + ': rule');
	assert.ok(record.bot in GravityGame.BOTS, record.name + ': bot level');
	assert.ok(record.player in GravityGame.PLAYER_TYPES, record.name + ': player type');
	assert.ok(record.gs > 0 && record.fs > 0 && record.ws > 0, record.name + ': scales');
}
console.log('registry: ' + MAPS.length + ' maps');

/* --- 2. the plan is injected, not searched ------------------------------ */

function maskedTrade(seed, universe) {
	const mask = new Uint8Array(PLANETS);
	mask.fill(1, 0, universe);
	const trade = new Sim(seed);
	trade.setPlanetMask(mask);
	trade.step(420);
	trade.setPlanetLimit(universe);
	return { trade: trade, mask: mask };
}

function planCheck(world, trade, mask, universe, homes) {
	const forced = new Uint8Array(PLANETS);
	for (let i = 0; i < homes.length; i++) forced[homes[i]] = 1;
	return GravityGame.openingGroupStats(world, trade, mask, universe, forced, homes);
}

for (const record of MAPS) {
	if (record.kind !== 'start') continue;
	const world = maskedTrade(record.seed, record.universe);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, record.seed);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, world.mask, record.universe);
	GravityGame.applyMarketSpecials(market, world.trade.world);
	const sourceSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const started = Date.now();
	GravityMaps.arm(record);
	const seats = GravityMaps.applySeats(galaxy, world.trade.world, world.trade,
		world.mask, record.universe, record.seats.length, sourceSim);
	const ms = Date.now() - started;
	assert.ok(seats, record.name + ': the record was accepted');
	assert.deepStrictEqual(seats, record.seats, record.name + ': saved seats are used');
	assert.deepStrictEqual(galaxy.mapSeats, record.seats, record.name + ': galaxy seats');
	/* a seat search is ~35 s on this world; a loose cap keeps the check
	 * meaningful on a loaded machine and still proves the fan did not run */
	assert.ok(ms < 10000, record.name + ': injection took ' + ms + ' ms, not a search');
	const stats = planCheck(world.trade.world, world.trade, world.mask, record.universe,
		galaxy.mapSeats);
	assert.strictEqual(stats.missing, 0, record.name + ': every company has a site');
	assert.ok(stats.distinct, record.name + ': distinct sites');
	assert.ok(stats.exitOk, record.name + ': every site can launch again');
	const ratio = stats.minPay / stats.maxPay;
	assert.ok(ratio >= 0.55, record.name + ': weakest/best ' + ratio.toFixed(2));
}
console.log('plan injection: ' + MAPS.filter(r => r.kind === 'start').length + ' records, no search');

/* --- 3. the file round-trips -------------------------------------------- */

const text = GravityMaps.fileText(MAPS);
const sandbox = vm.createContext({});
vm.runInContext(text, sandbox, { filename: 'saved_maps.js' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.SAVED_MAPS)),
	JSON.parse(JSON.stringify(MAPS)), 'fileText reloads to the same records');
fs.writeFileSync(path.join(root, 'saved_maps.js'), text);
console.log('file text: ' + text.length + ' bytes');

/* --- 4. a page booted on a saved map ------------------------------------ */

const start = MAPS[0];
const bootStart = Date.now();
const page = loadPage({ search: '?map=0', random: () => 0.5 });
const bootMs = Date.now() - bootStart;
const scene = page.context.GravityScene;
/* the page runs in a vm realm, so compare plain JSON, not prototypes */
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepStrictEqual(plain(scene.game.galaxy.mapSeats), start.seats,
	'?map=0 seats the run from the record');
assert.strictEqual(plain(scene.game.galaxy.openingTargetPay), start.targetPay,
	'?map=0 keeps the record pay target');
for (let i = 0; i < start.seats.length; i++) {
	const career = scene.game.galaxy.actors[i];
	assert.strictEqual(career.hq, start.seats[i], 'company ' + i + ' on its saved seat');
	assert.strictEqual(scene.sim.strength[career.hq], 1, 'company ' + i + ' HQ well g 1');
}
assert.ok(bootMs < 15000, 'saved-map boot took ' + bootMs + ' ms');
console.log('page boot: ?map=0 in ' + bootMs + ' ms (a planned career boot is ~33 s here)');

if (PLANNED) {
	const planned = loadPage({ search: '?rule=career&seed=' + start.seed + '&rate=1' });
	assert.deepStrictEqual(plain(planned.context.GravityScene.game.galaxy.mapSeats), start.seats,
		'the saved plan is the plan the page computes for that seed');
	console.log('planned boot: same seats as the record');
}

/* --- 5. exact run state ------------------------------------------------- */

/* one frame at a time until the run has real progress and every company is on
 * the ground with no barrel waiting: the save action refuses a flight in the
 * air, so the test saves where it can */
function stepToRest(env, maxFrames, minStep, minFlights) {
	for (let i = 0; i < maxFrames; i++) {
		env.runFrames(1, 16.0);
		const game = env.context.GravityScene.game;
		if (game.clockSteps < minStep || game.career.flights < minFlights) continue;
		if (env.context.careerAtRest() === '') return i + 1;
	}
	return -1;
}

/* playback ×8 keeps the frames (and the test) short; the saved state does not
 * care how fast the wall clock fed the fixed steps */
const search = '?map=0&you=bot&rate=1';
const pageA = loadPage({ search: search, random: () => 0.5 });
pageA.context.OrbitScene.setSpeed(8);
const frames = stepToRest(pageA, 6000, 400, 1);
assert.ok(frames > 0, 'page A reached a rest point to save from');
const save = pageA.context.GravityMaps.runRecord(pageA.context.mapRunInfo());
assert.strictEqual(save.kind, 'run');
assert.ok(save.state.careers[0].flights > 0, 'the saved run has flown a flight');
assert.ok(save.state.careers[0].ledger.purse !== 6, 'the saved run has traded');
const savedPurse = pageA.context.GravityScene.game.career.ledger.purse;
const savedStep = pageA.context.GravityScene.game.clockSteps;

const pageB = loadPage({ search: search, random: () => 0.5 });
pageB.context.OrbitScene.setSpeed(8);
pageB.context.GravityMaps.arm(save);
assert.ok(pageB.context.applyRunRecord(save), 'the run state is restored');
assert.strictEqual(pageB.context.GravityScene.game.career.ledger.purse, savedPurse,
	'restored purse');
assert.strictEqual(pageB.context.GravityScene.game.clockSteps, savedStep, 'restored clock');
const sameAtRestore = JSON.stringify(pageB.context.GravityMaps.captureState(
	pageB.context.mapRunInfo())) === JSON.stringify(save.state);
assert.ok(sameAtRestore, 'the restored page is the saved state');

/* the page clock feeds the frame pace: page B has run fewer frames than A at
 * the save point, so move its clock to A's and re-anchor the frame timer (the
 * page's own `lastFrame`); otherwise B's first frame would be a 0.1 s catch-up */
const ahead = pageA.now() - pageB.now();
if (ahead > 0) pageB.advance(ahead);
vm.runInContext('lastFrame = performance.now();', pageB.context);

const runFrames = 240;
pageA.runFrames(runFrames, 16.0);
pageB.runFrames(runFrames, 16.0);
const a = JSON.stringify(pageA.context.GravityMaps.captureState(pageA.context.mapRunInfo()));
const b = JSON.stringify(pageB.context.GravityMaps.captureState(pageB.context.mapRunInfo()));
if (a !== b) {
	let at = 0;
	while (at < a.length && a[at] === b[at]) at += 1;
	assert.fail('restored run diverged after ' + runFrames + ' frames near: ' +
		a.slice(Math.max(0, at - 120), at + 120) + ' | ' +
		b.slice(Math.max(0, at - 120), at + 120));
}
console.log('exact state: saved at frame ' + frames + ', restored, ' + runFrames +
	' frames identical · purse ' + savedPurse.toFixed(2) + ' · step ' + savedStep);

console.log('SAVED MAPS OK');
