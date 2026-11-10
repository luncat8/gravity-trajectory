/*
 * A difficulty switch in the middle of a career flight: the flight that is
 * already in the air keeps its ship, its trail and its landing, the map keeps
 * its companies, purses and pads, and only the rival controllers re-skill — the
 * next departure is planned at the new level instead of the world rebuilding.
 *
 * Run: node experiments/career_level_probe.js
 */
'use strict';

const assert = require('assert');
const { loadPage } = require('./dom_stub.js');

const env = loadPage({ search: '?mode=career&seed=7' });
env.runFrames(6, 16);
const ui = env.elements;
const scene = env.context.GravityScene;
const game = scene.game;
const bot = scene.bot;

/* the career clock is paused on a landing: let the companies fly */
assert.ok(scene.careerPaused(), 'a career landing should pause by default');
scene.setCareerPaused(false);

const snap = () => ({
	seed: game.seed,
	clock: game.clockSteps,
	slot: scene.activeSlot(),
	rivals: bot.count,
	hqs: [0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).hq : -1),
	purses: [0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).ledger.purse : -1),
	pads: [0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).pads.length : -1)
});

/* let the first rival get airborne: the switch must not touch a flight */
scene.setCareerPaused(false);
let flying = -1;
for (let f = 0; f < 400 && flying < 0; f++) {
	env.runFrames(1, 50);
	for (let r = 0; r < bot.count; r++) {
		if (bot.rivals[r].sim.status === env.context.GravitySim.STATUS_FLYING) {
			flying = r;
			break;
		}
	}
}
assert.ok(flying >= 0, 'no rival took off inside 400 frames, so there is no mid-flight switch to probe');
const rival = bot.rivals[flying];
const rivalCareer = scene.slotCareer(flying + 1);
assert.ok(rivalCareer, 'the flying rival has no company');
const rivalSim = rival.sim;
const trailBefore = rivalSim.trailCount;
const purseBefore = rivalCareer.ledger.purse;
const padBefore = rivalCareer.pads[rivalCareer.hq].chargeKwh;
const before = snap();
const levelBefore = bot.level;

/* the switch itself: no world rebuild, no lost flight */
const started = Date.now();
env.choose('botHard');
const elapsed = Date.now() - started;
const after = snap();

assert.strictEqual(bot.level, 'hard', 'the level did not change');
assert.notStrictEqual(bot.level, levelBefore, 'the probe started on hard already');
assert.ok(elapsed < 250, 'the mid-flight switch took ' + elapsed + ' ms');
assert.strictEqual(after.seed, before.seed, 'a mid-flight switch reset the seed');
assert.strictEqual(after.slot, before.slot, 'a mid-flight switch moved the selected player');
assert.strictEqual(after.rivals, before.rivals, 'a mid-flight switch resized the roster');
assert.deepStrictEqual(after.hqs, before.hqs, 'a mid-flight switch moved a company HQ');
assert.deepStrictEqual(after.pads, before.pads, 'a mid-flight switch rebuilt a pad network');
assert.deepStrictEqual(after.purses, before.purses, 'a mid-flight switch reset a purse');
assert.strictEqual(rivalSim.status, env.context.GravitySim.STATUS_FLYING,
	'the switch ended the flight that was in the air');
assert.strictEqual(rivalCareer.ledger.purse, purseBefore, 'the switch charged a purse');
assert.strictEqual(rivalCareer.pads[rivalCareer.hq].chargeKwh, padBefore,
	'the switch refilled or drained a pad');

/* the same ship keeps flying and lands; the clock never walks back */
env.runFrames(8, 50);
assert.ok(rivalSim.trailCount > trailBefore,
	'the flying rival stopped recording its trail after the switch');
assert.ok(game.clockSteps >= after.clock, 'the career clock went backwards');

/* the next departure is planned at the new level, and its log says so */
let replanned = false;
for (let f = 0; f < 600 && !replanned; f++) {
	env.runFrames(1, 50);
	replanned = /level · hard/.test(bot.trace.join('\n'));
}
assert.ok(replanned, 'the bot log never mentions the new level: ' + bot.trace.slice(-4).join(' | '));

/* a refused level never poisons the live one: `off` is a roster reset, so it
 * restarts — the seed and companies come back with it, not from the switch */
const easy = Date.now();
env.choose('botEasy');
const easyMs = Date.now() - easy;
assert.strictEqual(bot.level, 'easy', 'the level did not return to easy');
assert.strictEqual(game.seed, before.seed, 'a second switch reset the seed');
assert.deepStrictEqual([0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).hq : -1), before.hqs,
	'a second switch moved a company HQ');

/* and the scoreboard follows the switch without asking for a restart */
assert.strictEqual(ui.get('botHard').checked, false, 'the hard radio stayed checked');
assert.strictEqual(ui.get('botEasy').checked, true, 'the easy radio did not light');

console.log('career mid-flight level switch: hard in ' + elapsed + ' ms, easy back in ' +
	easyMs + ' ms · flight kept (' + rivalSim.trailCount + ' trail points) · ' +
	before.rivals + ' companies kept');
console.log('CAREER LEVEL PROBE OK');
