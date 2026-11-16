/*
 * Saved maps (0.7.8): the registry, the seat plan it replaces, and the exact
 * run state.
 *
 * 1. `saved_maps.js` is well-formed and its records are unique.
 * 2. A record seats a career headlessly, and its plan still passes the
 *    fairness rule. (That it is still the plan the search returns is
 *    `make_saved_maps.js --check`, slow tier.)
 * 3. `fileText` writes a file that loads back to the same records in a fresh
 *    JS context — the save action's only format — and the committed registry
 *    is exactly that text.
 * 4. A page booted on `?map=` is the page its seed link boots, minus the
 *    search: seated from the record, and the same run frame for frame, at the
 *    record's orbit rate or the one the address asks for.
 * 5. An exact state captured at rest and restored into a second page continues
 *    identically: both pages are driven with the same frames and their captured
 *    states must still be equal.
 *
 * Run: node experiments/saved_map_test.js
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

/* --- 2. a record seats a career, and its plan is fair -------------------- */

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
	GravityMaps.arm(record);
	const seats = GravityMaps.applySeats(galaxy, world.trade.world, world.trade,
		world.mask, record.universe, record.seats.length, sourceSim);
	assert.ok(seats, record.name + ': the record was accepted');
	assert.deepStrictEqual(seats, record.seats, record.name + ': saved seats are used');
	assert.deepStrictEqual(galaxy.mapSeats, record.seats, record.name + ': galaxy seats');
	const stats = planCheck(world.trade.world, world.trade, world.mask, record.universe,
		galaxy.mapSeats);
	assert.strictEqual(stats.missing, 0, record.name + ': every company has a site');
	assert.ok(stats.distinct, record.name + ': distinct sites');
	assert.ok(stats.exitOk, record.name + ': every site can launch again');
	const ratio = stats.minPay / stats.maxPay;
	assert.ok(ratio >= 0.55, record.name + ': weakest/best ' + ratio.toFixed(2));
}
console.log('seat plans: ' + MAPS.filter(r => r.kind === 'start').length +
	' records seat a career, each fair');

/* --- 3. the file round-trips -------------------------------------------- */

const text = GravityMaps.fileText(MAPS);
const sandbox = vm.createContext({});
vm.runInContext(text, sandbox, { filename: 'saved_maps.js' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.SAVED_MAPS)),
	JSON.parse(JSON.stringify(MAPS)), 'fileText reloads to the same records');
assert.strictEqual(fs.readFileSync(path.join(root, 'saved_maps.js'), 'utf8'), text,
	'saved_maps.js is the text a save writes: regenerate it, never edit it by hand');
console.log('file text: ' + Buffer.byteLength(text) + ' bytes');

/* --- 4. a page booted on a saved map ------------------------------------ */

/* one frame at a time until the run has real progress and every company is on
 * the ground with no barrel waiting: the only moment an exact state can be
 * saved, and a full flight into the run. Returns the frames it took. */
function stepToRest(env, maxFrames, minStep, minFlights) {
	for (let i = 0; i < maxFrames; i++) {
		env.runFrames(1, 16.0);
		const game = env.context.GravityScene.game;
		if (game.clockSteps < minStep || game.career.flights < minFlights) continue;
		if (env.context.careerAtRest() === '') return i + 1;
	}
	return -1;
}

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

/* the seats come from the record, not from a search that agrees with it: a
 * record with its seat order reversed seats the run reversed. On a page that
 * has not planned this world yet, because the planner keeps its first answer. */
const reversed = Object.assign({}, start, { seats: start.seats.slice().reverse() });
const lab = loadPage({ search: '?mode=lab&seed=' + start.seed });
assert.ok(lab.context.startMapRecord(reversed), 'a record starts a career from the lab');
assert.deepStrictEqual(plain(lab.context.GravityScene.game.galaxy.mapSeats), reversed.seats,
	'the run is seated from the record, not searched');

/* the seed link plans the same run: the captured state at boot, the same after
 * a bot has flown both through a flight, and the page's random stream the
 * helpers draw from */
const runState = env => JSON.stringify(
	env.context.GravityMaps.captureState(env.context.mapRunInfo()));
const mapRun = loadPage({ search: '?map=0&you=bot' });
const seedStart = Date.now();
const seedRun = loadPage({
	search: '?rule=career&seed=' + start.seed + '&rate=' + start.rate + '&you=bot'
});
const seedMs = Date.now() - seedStart;
const bootState = runState(mapRun);
assert.strictEqual(bootState, runState(seedRun), '?map=0 boots the run its seed link plans');
const flown = stepToRest(seedRun, 6000, 400, 1);
assert.ok(flown > 0, 'the seed-link run flew a flight and came to rest');
mapRun.runFrames(flown, 16.0);
assert.strictEqual(runState(mapRun), runState(seedRun),
	'both boots fly the same run for ' + flown + ' frames');
assert.strictEqual(mapRun.context.Math.random(), seedRun.context.Math.random(),
	'both boots leave the page the same random stream');

/* the address still sets the orbit rate, as on a seed link: `&rate=0.5` is the
 * clock a seed link without `rate=` runs, and the form most page tests boot.
 * At boot the rate is the only thing in the run state that it changes. */
const slow = loadPage({ search: '?map=0&rate=0.5&you=bot' });
assert.strictEqual(slow.context.OrbitScene.trade.speed, 0.5, 'rate= sets the orbit rate of a map boot');
const slowState = JSON.parse(runState(slow));
assert.strictEqual(slowState.ships[0].fieldRate, 0.5, 'rate= reaches the ship');
slowState.ships[0].fieldRate = start.rate;
assert.strictEqual(JSON.stringify(slowState), bootState, 'rate= changes the rate and nothing else');
console.log('page boot: ?map=0 in ' + bootMs + ' ms · its seed link in ' + seedMs +
	' ms · same run after ' + flown + ' frames · rate= honoured');

/* the address after any boot says what the page is: `?map=` is a way in, not a
 * state, so it is gone by the time the page has started and every param it
 * leaves behind is one that boots the same run. `?map=0` sat on a page whose
 * universe and roster the record had changed and the address never said so. */
const runOf = page => {
	const scene = page.context.GravityScene;
	const seats = scene.game.galaxy.mapSeats;
	return [scene.game.seed, scene.game.rule, scene.game.bot, scene.game.player,
		scene.game.cheat, scene.planetCount(), scene.bot.count + 1,
		seats ? seats.join(',') : '-', scene.career.hq,
		page.context.OrbitScene.trade.speed].join('|');
};
function theAddressIsTheRun(search, label) {
	const page = loadPage({ search: search });
	const url = new URL(page.context.location.href);
	assert.strictEqual(url.searchParams.get('map'), null, label + ': the address keeps no map');
	assert.strictEqual(url.searchParams.get('universe'), String(page.context.GravityScene.planetCount()),
		label + ': the address names the universe the run has');
	assert.strictEqual(url.searchParams.get('players'), String(page.context.GravityScene.bot.count + 1),
		label + ': the address names the roster the run has');
	/* a reload runs the same world, seats and clock: no second search, so the
	 * same plan, and no `map=` to carry a local file into the next address */
	assert.strictEqual(runOf(loadPage({ search: url.search })), runOf(page),
		label + ': the address it wrote boots the same run');
	return page;
}
theAddressIsTheRun('?map=0', 'default map');
theAddressIsTheRun('?map=0&rate=0.5&you=bot', 'map at another clock');
/* a 26-world record and a 2-seat one: both are worlds no level default reaches */
theAddressIsTheRun('?map=' + MAPS.findIndex(r => r.kind === 'start' && r.universe === 26 &&
	r.seats.length === 3), '26-world map');
theAddressIsTheRun('?map=' + MAPS.findIndex(r => r.kind === 'start' &&
	r.seats.length === 2), '2-seat map');
console.log('address: map, universe and roster of the run, reloaded the same');

/* --- 5. exact run state ------------------------------------------------- */

const search = '?map=0&you=bot';
const pageA = loadPage({ search: search, random: () => 0.5 });
const frames = stepToRest(pageA, 6000, 400, 1);
assert.ok(frames > 0, 'page A reached a rest point to save from');
const save = pageA.context.GravityMaps.runRecord(pageA.context.mapRunInfo());
assert.strictEqual(save.kind, 'run');
assert.ok(save.state.careers[0].flights > 0, 'the saved run has flown a flight');
assert.ok(save.state.careers[0].ledger.purse !== 6, 'the saved run has traded');
const savedPurse = pageA.context.GravityScene.game.career.ledger.purse;
const savedStep = pageA.context.GravityScene.game.clockSteps;

const pageB = loadPage({ search: search, random: () => 0.5 });
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
