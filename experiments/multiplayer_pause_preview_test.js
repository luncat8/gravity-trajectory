/* Run: node experiments/multiplayer_pause_preview_test.js */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');
const env = loadPage({ search: '?mode=career&seed=1' });
const scene = env.context.GravityScene;
const run = code => vm.runInContext(code, env.context);
/* the scoreboard rows (YOU, R1, R2) that carry the pause hatch, as '110' */
const SCORE_ROWS = ['scorePlayer', 'scoreRival1', 'scoreRival2'];
const marks = () => SCORE_ROWS.map(id => Number(env.elements.get(id).classList.contains('isPaused'))).join('');
scene.setSlotType(1, 'user');
assert(scene.slotPaused(0) && scene.slotPaused(1));
assert.strictEqual(marks(), '110', 'every holding human is marked, a bot row never');
scene.setCareerPaused(false);
assert(scene.careerPaused(), 'one release must not release another player');
assert.strictEqual(marks(), '010', 'a release clears only its own row');
assert(!/paused/.test(env.elements.get('scorePlayer').title));
assert(/paused/.test(env.elements.get('scoreRival1').title), 'the row title names the hold');
scene.selectSlot(1);
assert.strictEqual(env.elements.get('careerClock').textContent, '▶ time');
scene.setCareerPaused(false);
assert(!scene.careerPaused());
assert.strictEqual(marks(), '000', 'a running clock leaves no row marked');
scene.setCareerPaused(true);
scene.selectSlot(0);
assert.strictEqual(env.elements.get('careerClock').textContent, '❚❚ time');
/* the game-bar button and Space never run the full UI refresh: the row must follow anyway */
env.click('careerClock');
assert.strictEqual(marks(), '110');
env.fireWindow('keydown', { code: 'Space', key: ' ', target: { tagName: 'BODY' }, preventDefault() {} });
assert.strictEqual(marks(), '010');
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
assert.strictEqual(marks(), '000');
run('endUserRivalFlight(0);');
assert(scene.slotPaused(1) && scene.careerPaused(), 'rival landing holds the clock');
assert.strictEqual(marks(), '010', 'a landing marks its own row');
scene.setSlotType(1, 'bot');
assert(!scene.slotPaused(1) && !scene.careerPaused(), 'bots do not hold time');
assert.strictEqual(marks(), '000', 'a bot handover clears the mark');
scene.selectSlot(0);
scene.setCareerPaused(true);
assert.strictEqual(marks(), '100');
scene.setPlayMode('tour');
assert(!scene.careerPaused());
assert.strictEqual(marks(), '000', 'a rule without a pause marks nobody');
assert(!run('toggleFlightPause()'));
console.log('multiplayer pause, scoreboard marks, queue ownership and restored career preview passed');
