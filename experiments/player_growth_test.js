'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { loadPage } = require('./dom_stub.js');
const Game = require('../gravity_game.js');
const page = loadPage({ search: '?rule=career&seed=42&rate=1' });
const scene = page.context.GravityScene;
const career = scene.career;
const old = scene.game.galaxy.actors.slice();
const purse = career.ledger.purse;
const oldCount = scene.planetCount();
for (let n = 3; n < 17; n++) {
	const before = Array.from(scene.game.market.planetMask);
	scene.setPlayerCount(1);
	assert.strictEqual(scene.bot.count, n);
	assert.strictEqual(scene.planetCount(), oldCount + n - 2);
	assert.strictEqual(scene.game.galaxy.actors.length, n + 1);
	for (let i = 0; i < old.length; i++) assert.strictEqual(scene.game.galaxy.actors[i], old[i]);
	assert.strictEqual(career.ledger.purse, purse);
	const rival = scene.bot.rivals[n - 1];
	assert.strictEqual(before[rival.career.hq], 0);
	assert.strictEqual(scene.game.market.planetMask[rival.career.hq], 1);
	assert.strictEqual(scene.bot.strength[rival.career.hq], 1);
	assert.strictEqual(scene.sim.strength[rival.career.hq], 1);
	assert.strictEqual(new Set(scene.game.galaxy.actors.map(a => a.hq)).size, n + 1);
}
assert.ok(page.elements.get('playerCountUp').disabled);
page.runFrames(2, 16);
assert.strictEqual(page.elements.get('scoreRival16').hidden, false);
assert.ok(page.context.GravityScene.bot.rivals[15].career);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.strictEqual((html.match(/<template id="scoreRivalTemplate">/g) || []).length, 1);
assert.ok(!html.includes('id="scoreRival1"'), 'rival rows must come from the template');
const colours = Array.from(vm.runInContext('RIVAL_COLOURS', page.context));
const trails = Array.from(vm.runInContext('RIVAL_TRAILS', page.context));
assert.strictEqual(colours.length, 16);
assert.strictEqual(new Set(colours.concat('#8ef0c0')).size, 17);
assert.deepStrictEqual(colours.slice(0, 2), ['#b99aff', '#ff85a8']);
/* Guard perceptual separation as well as string uniqueness. */
function lab(hex) {
	const channels = hex.slice(1).match(/../g).map(value => {
		const c = parseInt(value, 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const [r, g, b] = channels;
	const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
	const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
	const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
	const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const palette = ['#8ef0c0', ...colours].map(lab);
for (let i = 0; i < palette.length; i++) {
	assert.ok(palette[i][0] >= 65, 'player colour should stay visible on the dark field');
	for (let j = 0; j < i; j++) {
		assert.ok(Math.hypot(...palette[i].map((v, k) => v - palette[j][k])) >= 25,
			'player colours should remain perceptually separated');
	}
}
for (let i = 1; i <= 16; i++) {
	const row = page.elements.get('scoreRival' + i);
	assert.strictEqual(row.style.getPropertyValue('--rival-colour'), colours[i - 1]);
	assert.strictEqual(page.elements.get('rivalScoreName' + i).textContent, 'R' + i);
	assert.strictEqual(page.elements.get('rivalBot' + i).attributes['aria-label'], 'bot controls R' + i);
	const rgb = colours[i - 1].slice(1).match(/../g).map(hex => parseInt(hex, 16));
	assert.ok(trails[i - 1].startsWith('rgba(' + rgb.join(', ') + ','));
}
const claims = vm.runInContext('claimLineHtml()', page.context);
assert.ok(claims.includes('R16 1'), 'the claim summary includes the last rival');
scene.selectSlot(16);
assert.strictEqual(vm.runInContext('slotName(16)', page.context), 'R16');
assert.ok(page.elements.get('scoreRival16').classList.contains('isActive'));
scene.selectSlot(0);
scene.setPlayerCount(-1);
assert.strictEqual(scene.bot.count, 15);
assert.strictEqual(scene.game.galaxy.actors.length, 16);
scene.setPlayerCount(1);
assert.strictEqual(scene.bot.count, 16);
assert.strictEqual(scene.game.galaxy.actors.length, 17);
page.click('gameRestart');
assert.strictEqual(scene.bot.count, 16);
assert.strictEqual(new Set(scene.game.galaxy.actors.map(a => a.hq)).size, 17);
assert.notStrictEqual(Game.launchMask([0], 1), Game.launchMask([32], 1));
assert.notStrictEqual(Game.launchMask([1], 1), Game.launchMask([33], 1));
console.log('PLAYER GROWTH OK');
for (const rule of ['tour', 'money', 'route']) {
	const env = loadPage({ search: '?rule=' + rule + '&seed=11&rate=1' });
	const g = env.context.GravityScene;
	const initialCount = g.bot.count;
	const initialSteps = g.game.clockSteps;
	const before = Array.from(g.game.market.planetMask);
	g.setPlayerCount(1);
	assert.strictEqual(g.bot.count, initialCount + 1, rule);
	const rival = g.bot.rivals[initialCount];
	assert.strictEqual(before[rival.basePlanet], 0, rule);
	assert.strictEqual(g.game.clockSteps, initialSteps, rule);
	if (rule === 'route') assert.strictEqual(rival.routeDone, false);
	env.runFrames(2, 16);
	g.setPlayerCount(-1);
	assert.strictEqual(g.bot.count, initialCount, rule);
}
const full = loadPage({ search: '?rule=career&seed=10&rate=1' });
const fg = full.context.GravityScene;
assert.ok(fg.setPlanetUniverseSize(48));
assert.strictEqual(fg.sim.planetCount, 48);
assert.strictEqual(fg.sim.bodyCount, 48);
assert.ok(full.elements.get('playerCountUp').disabled);
fg.sim.predict(47, 0, 100);
assert.ok(Number.isFinite(fg.sim.predX[0]));
console.log('MULTI-MODE AND 48-PLANET FIELD OK');
const restarted = loadPage({ search: '?rule=career&seed=42&rate=1' });
const rg = restarted.context.GravityScene;
for (let i = 0; i < 5; i++) rg.setPlayerCount(1);
restarted.click('gameRestart');
assert.strictEqual(rg.bot.count, 7);
assert.strictEqual(rg.game.galaxy.actors.length, 8);
assert.strictEqual(new Set(rg.game.galaxy.actors.map(a => a.hq)).size, 8);
for (const actor of rg.game.galaxy.actors) assert.strictEqual(rg.sim.strength[actor.hq], 1);
rg.selectSlot(7);
assert.strictEqual(rg.activeSlot(), 7);
rg.setSlotType(7, 'user');
assert.strictEqual(rg.bot.rivalTypes[6], 'user');
rg.setPlayerCount(-1);
assert.strictEqual(rg.activeSlot(), 0);
assert.strictEqual(rg.game.galaxy.actors.length, 7);
console.log('RESTART AND PLAYER SELECTION OK');
