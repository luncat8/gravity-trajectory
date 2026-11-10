/* Run: node experiments/multiplayer_impulse_test.js
 * The manual impulse loop belongs to the selected player's ship: another
 * player's coasting drive ship must neither take over the launch row nor be
 * burnable, and a hand-flown rival burns its own tank into its own shot.
 * Its scoreboard row reads like YOU's, without a bot controller's schedule. */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const env = loadPage({ search: '?mode=career&seed=42&rate=1' });
const scene = env.context.GravityScene;
const ui = env.elements;
const game = env.context.GravityGame;
const tech = env.context.OrbitTech;
const FLYING = env.context.GravitySim.STATUS_FLYING;
const run = code => vm.runInContext(code, env.context);
const enter = () => env.fireWindow('keydown', {
	code: 'Enter', key: 'Enter', target: { tagName: 'BODY' }, preventDefault() {}
});

function fitDrive(career) {
	career.ledger.purse = 30;
	game.installPart(career, tech.KIND_ENGINE, tech.ENGINES[1]);
	game.installPart(career, tech.KIND_TANK, tech.TANKS[2]);
	career.ship.fuelKg = 90;
}

/* aim from the selected player's HQ and queue the shot */
function queueShot(career) {
	env.dragAim(career.hq, 0.65, Math.min(72, scene.speedCeiling(career.hq)));
	env.runFrames(2, 16);
	env.click('launch');
}

/* a landing re-holds its player, which would freeze the other barrel */
function flyUntil(sim) {
	for (let i = 0; i < 1200 && sim.status !== FLYING; i++) {
		if (scene.careerPaused()) {
			scene.setCareerPaused(false, 0);
			scene.setCareerPaused(false, 1);
		}
		env.runFrames(1, 16);
	}
	assert.strictEqual(sim.status, FLYING);
}

env.runFrames(2, 16);
scene.setSlotType(1, 'user');
const you = scene.career;
const rival = scene.bot.rivals[0];
fitDrive(you);
fitDrive(rival.career);

scene.setCareerPaused(false, 1);
queueShot(you);
flyUntil(scene.sim);
env.runFrames(4, 16);
assert(ui.get('launch').textContent.startsWith('coasting'), 'YOU coast with a drive');
/* the state note is a controller's schedule: only a bot row carries one */
const metaParts = id => ui.get(id).textContent.split(' · ').length;
assert.strictEqual(metaParts('rivalMeta1'), metaParts('playerScoreMeta'),
	'a hand-flown rival row reads like YOU: ' + ui.get('rivalMeta1').textContent);
assert(metaParts('rivalMeta2') > metaParts('playerScoreMeta'), 'a bot row keeps its live state');

/* the other player takes the page while YOU coast */
scene.selectSlot(1);
env.runFrames(2, 16);
assert(!ui.get('launch').textContent.startsWith('coasting'),
	'the launch row answers for the selected player: ' + ui.get('launch').textContent);
queueShot(rival.career);
assert(run('slotTurrets[1].pending'), 'a landed player launches while another drive ship coasts');
scene.setCareerPaused(true);
assert(scene.careerPaused() && !scene.burnPaused(), 'another player\'s ship is not offered for a burn');
scene.setCareerPaused(false);

/* YOU still own the burn of YOUR ship */
scene.selectSlot(0);
env.click('careerClock');
assert(scene.burnPaused(), 'the selected coasting drive ship pauses into the burn aim');
env.click('careerClock');
scene.selectSlot(1);

/* a hand-flown rival burns its own tank, recorded in its own shot */
flyUntil(rival.sim);
env.runFrames(4, 16);
assert(ui.get('launch').textContent.startsWith('coasting'), 'the rival coasts with a drive');
env.click('careerClock');
assert(scene.slotPaused(1) && scene.burnPaused());
env.dragBurn(-1.15, rival.sim.burnLimit() * 0.6, rival.sim);
assert(scene.burnState().armed, 'a drag from the rival ship arms its burn');
const fuel = [you.ship.fuelKg, rival.career.ship.fuelKg];
const burnStep = rival.sim.liveSteps;
enter();
assert.strictEqual(you.ship.fuelKg, fuel[0], 'the burn never spends another company\'s tank');
assert(rival.career.ship.fuelKg < fuel[1], 'the burn spends the rival\'s own fuel');
const rivalShot = rival.shots[rival.shots.length - 1];
assert.strictEqual(rivalShot.burns.length, 1);
assert.strictEqual(rivalShot.burns[0].step, burnStep);
assert.strictEqual(scene.game.shots[scene.game.shots.length - 1].burns.length, 0);
assert(!scene.slotPaused(1) && !scene.burnState().armed, 'the burn resumes its own player');
console.log('multiplayer impulse: launch row, burn gate and a hand-flown rival burn passed');
