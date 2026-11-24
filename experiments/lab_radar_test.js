/*
 * The predicted overlay outside career (0.7.51): the `predicted` checkbox owns
 * other players' trajectories in every mode, no facility needed — a money run
 * with one bot rival: the box off draws nothing, on draws the rival's `+N s`
 * plate on its landing point, and hover reveals one ship with the box off.
 *
 * Run: node experiments/lab_radar_test.js
 */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const page = loadPage({});
const scene = page.context.GravityScene;
const Game = page.context.GravityGame;
scene.setPlayerCount(1);
scene.startGame(7, 1, Game.RULE_MONEY, Game.BOT_HARD, Game.PLAYER_USER);
assert.strictEqual(scene.bot.count, 1, 'one rival joins');
page.runFrames(2, 16);
assert.strictEqual(scene.predRivals(), false, 'predicted starts off');

/* a verified shot for one sim: direct aim, real impact, ghost parity */
const fly = index => vm.runInContext(`(() => {
	const sim = ${index === 0 ? 'cargoSim' : 'bot.rivals[0].sim'};
	const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
	for (let at = 0; at < planetCount; at++) {
		for (let p = 0; p < planetCount; p++) {
			if (p === at) continue;
			const angle = Math.atan2(tradeSim.planetY[p] - tradeSim.planetY[at],
				tradeSim.planetX[p] - tradeSim.planetX[at]);
			for (const speed of [120, 100, 80, 60]) {
				sim.launch(at, angle, speed);
				for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) sim.stepOne();
				const real = sim.endReason === GravitySim.END_IMPACT && sim.endBody === p;
				sim.clear();
				if (!real) continue;
				sim.launch(at, angle, speed);
				sim.predictFlight(GravityGame.RADAR_BUDGET_MS);
				const ghost = sim.predReason === GravitySim.END_IMPACT && sim.predBody === p;
				sim.clear();
				if (!ghost) continue;
				sim.launch(at, angle, speed);
				return { target: p, landed: at };
			}
		}
	}
	return null;
})()`, page.context);
const ownShot = fly(0);
assert.ok(ownShot, 'the own ship finds a verified shot');
const rivalShot = fly(1);
assert.ok(rivalShot, 'the rival ship finds a verified shot');

const plates = () => page.calls.texts.filter(t => /^\+\d+ s$/.test(t)).length;
const paint = () => {
	page.calls.texts.length = 0;
	page.runFrames(1, 16);
};
paint();
assert.strictEqual(plates(), 0, 'no predicted plates with the box off');
page.toggle('predView');
paint();
assert.strictEqual(plates(), 1, 'the rival +N s draws with the box on: ' +
	JSON.stringify(page.calls.texts));

/* hover the rival ship with the box off: only the hover reveals */
const rivalSim = vm.runInContext('bot.rivals[0].sim', page.context);
page.toggle('predView');
const move = pos => page.fireWindow('pointermove',
	{ clientX: pos.x, clientY: pos.y, target: page.elements.get('c'), shiftKey: false });
move(page.shipScreen(rivalSim));
paint();
assert.strictEqual(plates(), 1, 'hover reveals the lab rival with the box off: ' +
	JSON.stringify(page.calls.texts));
move({ x: 5, y: 5 });
paint();
assert.strictEqual(plates(), 0, 'the reveal follows the pointer in the lab too');

/* two lab rivals landing on the same planet stack their +N s plates */
scene.setPlayerCount(1);
scene.startGame(7, 1, Game.RULE_MONEY, Game.BOT_HARD, Game.PLAYER_USER);
assert.strictEqual(scene.bot.count, 2, 'two rivals join');
const pair = vm.runInContext(`(() => {
	const r0 = bot.rivals[0].sim;
	const r1 = bot.rivals[1].sim;
	const cap = Math.ceil(GravitySim.FLY_HORIZON / GravitySim.DT) + 2;
	function shot(sim, from, target, avoidSec) {
		const angle = Math.atan2(tradeSim.planetY[target] - tradeSim.planetY[from],
			tradeSim.planetX[target] - tradeSim.planetX[from]);
		for (const speed of [130, 110, 90, 72, 58]) {
			sim.launch(from, angle, speed);
			for (let s = 0; s < cap && sim.status === GravitySim.STATUS_FLYING; s++) sim.stepOne();
			const real = sim.endReason === GravitySim.END_IMPACT && sim.endBody === target;
			sim.clear();
			if (!real) continue;
			sim.launch(from, angle, speed);
			sim.predictFlight(GravityGame.RADAR_BUDGET_MS);
			const sec = Math.round(sim.predSteps * GravitySim.DT);
			const ok = sim.predReason === GravitySim.END_IMPACT &&
				sim.predBody === target && sec > 0 && sec !== avoidSec;
			sim.clear();
			if (ok) return { from, angle, speed, sec };
		}
		return null;
	}
	for (let target = 0; target < planetCount; target++) {
		let p0 = null;
		let p1 = null;
		for (let at = 0; at < planetCount && (!p0 || !p1); at++) {
			if (at === target) continue;
			if (!p0) p0 = shot(r0, at, target, -1);
			else p1 = shot(r1, at, target, p0.sec);
		}
		if (p0 && p1) {
			r0.launch(p0.from, p0.angle, p0.speed);
			r1.launch(p1.from, p1.angle, p1.speed);
			return { target, p0, p1 };
		}
	}
	return null;
})()`, page.context);
assert.ok(pair, 'both lab rivals launch to one shared planet');
page.toggle('predView');
page.calls.texts.length = 0;
page.calls.textXY.length = 0;
page.runFrames(1, 16);
const labDrawn = page.calls.textXY.filter((xy, i) => /^\+\d+ s$/.test(page.calls.texts[i]));
assert.strictEqual(labDrawn.length, 2, 'both rival +N s plates draw');
assert.ok(Math.abs(labDrawn[0][0] - labDrawn[1][0]) >= 46 ||
	Math.abs(labDrawn[0][1] - labDrawn[1][1]) >= 16,
	'lab rival plates on the same planet stack without overlapping: ' + JSON.stringify(labDrawn));
console.log('LAB RADAR OK · box, plate, hover, stack');
