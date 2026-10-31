/* Seeded planet gravity, URL/replay state and the simplified help/controls.
 * Run: node experiments/gravity_seed_test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Game = require('../gravity_game.js');
const Sim = require('../gravity_sim.js');
const { loadPage } = require('./dom_stub.js');

const PLANETS = 26;
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const paramsOf = page => new URL(page.context.location.href).searchParams;
const fieldOf = page => Array.from(page.context.GravityScene.sim.strength);

/* The draw is independent per planet, deterministic, and spans the requested range. */
const values = new Set();
let zeroSeed = 0;
for (let seed = 1; seed <= 200; seed++) {
	for (let p = 0; p < PLANETS; p++) {
		const g = Game.planetGravity(seed, p);
		assert.ok(g >= Game.PLANET_GRAVITY_MIN && g <= Game.PLANET_GRAVITY_MAX,
			'out-of-range gravity');
		assert.ok(Math.abs(g * 20 - Math.round(g * 20)) < 1e-9, 'gravity is not on the 0.05 grid');
		assert.strictEqual(g, Game.planetGravity(seed, p));
		values.add(g);
		if (g === 0 && !zeroSeed) zeroSeed = seed;
	}
}
assert.ok(values.has(-1) && values.has(0) && values.has(3.5) &&
	!values.has(5) && values.size === 91);
assert.ok(zeroSeed > 0);
assert.ok(/id="gravity"[^>]*max="5"/.test(html));
assert.ok(/id="expGravity"[^>]*max="9"/.test(html));
assert.strictEqual(Sim.STRENGTH_MAX, 5);
assert.ok(!html.includes('id="gameSeed"') && !html.includes('id="cargoHint"'));

/* Seedless startup draws a fresh world; an explicit query or replay seed pins it. */
const randomA = loadPage({ random: () => 0.25 });
const randomB = loadPage({ random: () => 0.75 });
assert.strictEqual(randomA.context.GravityScene.game.seed || randomA.context.OrbitScene.sim.seed, 250000);
assert.strictEqual(randomB.context.GravityScene.game.seed || randomB.context.OrbitScene.sim.seed, 750000);
assert.strictEqual(paramsOf(randomA).get('seed'), '250000');
const pinned = loadPage({ search: '?mode=career&seed=42', random: () => 0.9 });
assert.strictEqual(pinned.context.GravityScene.game.seed, 42);
const invalidSeed = loadPage({ search: '?seed=bad', random: () => 0.5 });
assert.strictEqual(invalidSeed.context.OrbitScene.sim.seed, 500000);
const replayPinned = loadPage({ search: '?seed=99', hash: '#game=1&seed=19&rate=1', random: () => 0.1 });
assert.strictEqual(replayPinned.context.GravityScene.game.seed, 19);

/* A lab seed in the address regenerates the requested world without entering a game. */
const lab = loadPage({ search: '?mode=lab&seed=27&view=field&other=kept' });
const labScene = lab.context.GravityScene;
assert.strictEqual(labScene.playMode(), 'lab');
assert.strictEqual(lab.context.OrbitScene.sim.seed, 27);
assert.strictEqual(labScene.viewMode(), 'field');
for (let p = 0; p < PLANETS; p++) assert.strictEqual(labScene.sim.strength[p], Game.planetGravity(27, p));
assert.strictEqual(paramsOf(lab).get('other'), 'kept');
assert.ok(!lab.elements.get('clear').hidden);
lab.dragAim(5, 1.2, 100);
lab.setValue('gravity', 9);
assert.strictEqual(labScene.sim.strength[5], 5, 'manual gravity must clamp at 5');
lab.dragAim(4, 1.2, 100);
lab.setValue('gravity', 0);
assert.strictEqual(labScene.sim.strength[4], 0);
const edited = fieldOf(lab);
assert.ok(labScene.setPlanetUniverseSize(4));
assert.ok(labScene.setPlanetUniverseSize(PLANETS));
assert.deepStrictEqual(fieldOf(lab), edited);
assert.deepStrictEqual(Array.from(labScene.bot.probe.strength), edited);
lab.choose('srcPorts');
const labTrade = lab.context.OrbitScene.sim;
for (let port = 0; port < labTrade.portCount; port++) {
	assert.strictEqual(labScene.sim.strength[port], Game.planetGravity(27, labTrade.portPlanet[port]));
}

/* Zero strengths survive a shrink/expand instead of being mistaken for inactive planets. */
const roster = loadPage({ search: '?mode=tour&seed=' + zeroSeed + '&bot=off' });
const rosterScene = roster.context.GravityScene;
const initial = fieldOf(roster);
const zeroPlanet = initial.indexOf(0);
assert.ok(zeroPlanet >= 0);
assert.ok(rosterScene.setPlanetUniverseSize(4));
const mask = rosterScene.game.market.planetMask;
for (let p = 0; p < PLANETS; p++) {
	assert.strictEqual(rosterScene.bot.probe.strength[p], mask[p] ? initial[p] : 0);
}
roster.choose('srcPorts');
const trade = roster.context.OrbitScene.sim;
for (let port = 0; port < trade.portCount; port++) {
	const p = trade.portPlanet[port];
	assert.strictEqual(rosterScene.sim.strength[port], mask[p] ? initial[p] : 0);
}
assert.ok(rosterScene.setPlanetUniverseSize(PLANETS));
roster.choose('srcPlanets');
assert.deepStrictEqual(fieldOf(roster), initial);
assert.strictEqual(rosterScene.sim.strength[zeroPlanet], 0);
assert.deepStrictEqual(Array.from(rosterScene.bot.probe.strength), initial);

/* Every career player, probe and planet/port view sees the player's original HQ at 1. */
for (const seed of [1, 7, 31, 42, 913]) {
	const career = loadPage({ search: '?mode=career&seed=' + seed });
	const scene = career.context.GravityScene;
	const hq = scene.career.hq;
	const active = scene.game.market.planetMask;
	const saved = fieldOf(career);
	assert.strictEqual(saved[hq], 1);
	for (let p = 0; p < PLANETS; p++) {
		const expected = active[p] ? (p === hq ? 1 : Game.planetGravity(seed, p)) : 0;
		assert.strictEqual(saved[p], expected);
		assert.strictEqual(scene.bot.probe.strength[p], expected);
		assert.strictEqual(scene.bot.player.sim.strength[p], expected);
		for (const rival of scene.bot.rivals) assert.strictEqual(rival.sim.strength[p], expected);
	}
	career.click('gameRestart');
	assert.strictEqual(scene.career.hq, hq);
	assert.deepStrictEqual(fieldOf(career), saved);
	career.choose('srcPorts');
	const orbit = career.context.OrbitScene.sim;
	for (let port = 0; port < orbit.portCount; port++) {
		const p = orbit.portPlanet[port];
		assert.strictEqual(scene.sim.strength[port], saved[p]);
	}
}

/* Starting a new career while ports are selected also updates the HQ field. */
const portCareer = loadPage({ search: '?mode=career&seed=42&src=ports' });
vm.runInContext('Math.random = () => 0.5', portCareer.context);
portCareer.click('gameNewSeed');
const pcScene = portCareer.context.GravityScene;
const pcTrade = portCareer.context.OrbitScene.sim;
const pcMask = pcScene.game.market.planetMask;
assert.strictEqual(pcScene.bot.probe.strength[pcScene.career.hq], 1);
for (let port = 0; port < pcTrade.portCount; port++) {
	const p = pcTrade.portPlanet[port];
	const expected = pcMask[p] ? (p === pcScene.career.hq ? 1 : Game.planetGravity(pcScene.game.seed, p)) : 0;
	assert.strictEqual(pcScene.sim.strength[port], expected);
}

/* New seeds and mode changes replace stale replay URLs while preserving other query parameters. */
const nav = loadPage({ search: '?mode=career&seed=42&view=field&other=kept' });
vm.runInContext('Math.random = () => 0.123456', nav.context);
nav.click('gameNewSeed');
assert.strictEqual(nav.context.GravityScene.game.seed, 123456);
assert.strictEqual(paramsOf(nav).get('seed'), '123456');
assert.strictEqual(paramsOf(nav).get('mode'), 'career');
assert.strictEqual(paramsOf(nav).get('view'), 'field');
assert.strictEqual(paramsOf(nav).get('other'), 'kept');
const reloaded = loadPage({ search: new URL(nav.context.location.href).search });
assert.strictEqual(reloaded.context.GravityScene.playMode(), 'career');
assert.strictEqual(reloaded.context.GravityScene.career.hq, nav.context.GravityScene.career.hq);
assert.deepStrictEqual(fieldOf(reloaded), fieldOf(nav));
nav.choose('modeLab');
assert.strictEqual(paramsOf(nav).get('mode'), 'lab');
assert.strictEqual(paramsOf(nav).get('seed'), '123456');
assert.strictEqual(loadPage({ search: new URL(nav.context.location.href).search }).context.GravityScene.playMode(), 'lab');
const anchor = loadPage({ search: '?mode=lab&seed=42&other=kept', hash: '#notes' });
anchor.choose('modeTour');
assert.strictEqual(anchor.context.location.hash, '#notes');
assert.strictEqual(paramsOf(anchor).get('other'), 'kept');

/* Mode-specific help is separate from one shared set of controls. */
const help = loadPage();
const ui = help.elements;
const sharedHelp = ui.get('helpControls').textContent;
assert.match(sharedHelp, /Drag from a planet or pad/);
assert.match(sharedHelp, /Shift/);
help.fireElement(ui.get('modeRoute'), 'pointerenter', { pointerType: 'mouse' });
assert.strictEqual(ui.get('helpModeTitle').textContent, 'route · longest trajectory');
assert.strictEqual(ui.get('helpControls').textContent, sharedHelp);
assert.match(ui.get('helpDetail').textContent, /No launch is needed/);
assert.match(ui.get('helpModeControls').textContent, /Use best/);
help.fireElement(ui.get('modeCareer'), 'pointerenter', { pointerType: 'mouse' });
assert.strictEqual(ui.get('helpModeTitle').textContent, 'career · catapult network');
assert.strictEqual(ui.get('helpControls').textContent, sharedHelp);
assert.match(ui.get('helpDetail').textContent, /HQ \(g = 1\)/);
assert.match(ui.get('helpModeControls').textContent, /Space \/ P/);
assert.ok(!ui.get('helpModeControls').textContent.includes('Drag from a planet'));
help.choose('modeTour');
assert.strictEqual(ui.get('helpModeTitle').textContent, 'tour');
assert.ok(ui.get('clear').hidden, 'flown games must not show an abort button');
help.choose('modeRoute');
assert.ok(!ui.get('clear').hidden && ui.get('clear').textContent === 'clear plan');
help.choose('modeLab');
assert.ok(!ui.get('clear').hidden && ui.get('clear').textContent === 'clear');

/* ×9 affects the simulation and survives a copied replay even with conflicting search params. */
const run = loadPage({ search: '?mode=tour&seed=19&bot=off&view=field' });
const runScene = run.context.GravityScene;
const acceleration = {};
runScene.sim.fieldAt(400, 400, acceleration);
const ax = acceleration.ax;
const ay = acceleration.ay;
run.setValue('expGravity', 9);
runScene.sim.fieldAt(400, 400, acceleration);
assert.ok(Math.abs(acceleration.ax - ax * 9) < 1e-9);
assert.ok(Math.abs(acceleration.ay - ay * 9) < 1e-9);
assert.strictEqual(runScene.bot.probe.gravityScale, 9);
assert.strictEqual(run.elements.get('expGravityLabel').textContent, '×9.00');
assert.strictEqual(Game.decodeLink('#game=1&seed=19&rate=1&gs=9').gravityScale, 9);
assert.strictEqual(Game.decodeLink('#game=1&seed=19&rate=1&gs=9.01'), null);
run.dragAim(0, 0.5, 220);
run.runFrames(2, 16.7);
run.click('launch');
assert.strictEqual(runScene.sim.status, Sim.STATUS_FLYING);
run.click('clear');
assert.strictEqual(runScene.sim.status, Sim.STATUS_FLYING);
for (let i = 0; i < 3; i++) run.click('playFaster');
for (let i = 0; i < 2000 && runScene.sim.status === Sim.STATUS_FLYING; i++) run.runFrames(1, 16.7);
assert.strictEqual(runScene.sim.status, Sim.STATUS_ENDED);
run.click('gameCopy');
const link = new URL(run.clipboardText);
assert.match(link.hash, /&gs=9/);
const replay = loadPage({ search: '?mode=career&seed=99&view=field', hash: link.hash });
assert.strictEqual(replay.context.GravityScene.playMode(), 'tour');
assert.strictEqual(replay.context.GravityScene.game.seed, 19);
assert.strictEqual(replay.context.GravityScene.sim.gravityScale, 9);
assert.strictEqual(replay.context.GravityScene.viewMode(), 'field');
assert.strictEqual(paramsOf(replay).get('seed'), '19');
replay.click('replaySkip');
replay.runFrames(2, 16.7);
assert.match(replay.elements.get('replayReadout').textContent, /^verified ✓/);
assert.strictEqual(replay.context.GravityScene.sim.cargo.x, runScene.sim.cargo.x);
assert.strictEqual(replay.context.GravityScene.sim.cargo.y, runScene.sim.cargo.y);
vm.runInContext('Math.random = () => 0.5', replay.context);
replay.click('gameNewSeed');
assert.strictEqual(replay.context.location.hash, '');
assert.strictEqual(paramsOf(replay).get('seed'), '500000');

console.log('SEEDED GRAVITY / URL / HELP OK');
