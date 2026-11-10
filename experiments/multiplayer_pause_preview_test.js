/* Run: node experiments/multiplayer_pause_preview_test.js */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');
const env = loadPage({ search: '?mode=career&seed=1' });
const scene = env.context.GravityScene;
const run = code => vm.runInContext(code, env.context);
scene.setSlotType(1, 'user');
assert(scene.slotPaused(0) && scene.slotPaused(1));
scene.setCareerPaused(false);
assert(scene.careerPaused(), 'one release must not release another player');
scene.selectSlot(1);
assert.strictEqual(env.elements.get('careerClock').textContent, '▶ time');
scene.setCareerPaused(false);
assert(!scene.careerPaused());
scene.setCareerPaused(true);
scene.selectSlot(0);
assert.strictEqual(env.elements.get('careerClock').textContent, '❚❚ time');
const clock = scene.game.clockSteps;
env.runFrames(2, 16);
assert.strictEqual(scene.game.clockSteps, clock);
scene.waitCareer();
assert.strictEqual(scene.game.clockSteps, clock, 'wait must not bypass another hold');

// Real aim, selection change and full sliced trace completion.
scene.setCareerPaused(true);
env.dragAim(scene.career.hq, 0.65, Math.min(72, scene.speedCeiling(scene.career.hq)));
env.runFrames(1, 16);
scene.selectSlot(1);
scene.selectSlot(0);
env.runFrames(1, 16);
assert.strictEqual(scene.sim.routeHorizon, env.context.GravityGame.CAP_SECONDS);
for (let i = 0; i < 100 && scene.sim.routeActive; i++) env.runFrames(1, 16);
assert(!scene.sim.routeActive, 'restored preview must finish');
assert(scene.sim.predCount > 1);
assert.notStrictEqual(scene.sim.predReason, env.context.GravitySim.END_OPEN);

// Queue while the other player holds time, then switch and release.
env.click('launch');
assert(!scene.slotPaused(0) && scene.slotPaused(1));
assert(run('slotTurrets[0].pending'));
scene.selectSlot(1);
const shots = scene.game.shots.length;
env.runFrames(2, 16);
assert.strictEqual(scene.game.shots.length, shots);
scene.setCareerPaused(false);
// Advance to alignment directly: exercise ownership without a long simulation.
run('game.clockSteps = slotTurrets[0].fireAt; tickTurrets();');
assert.strictEqual(scene.activeSlot(), 1);
assert.strictEqual(scene.game.shots.length, shots + 1);
assert.strictEqual(scene.bot.rivals[0].shots.length, 0);
run('endUserRivalFlight(0);');
assert(scene.slotPaused(1) && scene.careerPaused(), 'rival landing holds the clock');
scene.setSlotType(1, 'bot');
assert(!scene.slotPaused(1) && !scene.careerPaused(), 'bots do not hold time');
scene.setPlayMode('tour');
assert(!scene.careerPaused());
assert(!run('toggleFlightPause()'));
console.log('multiplayer pause, queue ownership and restored career preview passed');
