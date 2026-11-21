'use strict';
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const data = {
	v: 3, seed: 999064, rate: 0.5, bot: 'normal', players: ['user', 'bot', 'bot'],
	mask: '1'.repeat(13) + '0'.repeat(35), seats: [1, 3, 12], targetPay: 1.4672744835753886,
	g: 1, f: 1, w: 1, h: false, source: 0, corruption: false, steps: 11145, watch: 0,
	actions: [
		{ step: 0, slot: 0, type: 'launch', origin: 1, angle: 5.692968222703228, speed: 53.74609375 },
		{ step: 11, slot: 0, type: 'fireQueued' },
		{ step: 3167, slot: 0, type: 'act', act: 'build', kind: 'catapult', tier: 0, planet: 8 },
		{ step: 3167, slot: 0, type: 'act', act: 'repair' },
		{ step: 3167, slot: 0, type: 'controller', player: 'bot' },
		{ step: 3717, slot: 1, type: 'controller', player: 'user' },
		{ step: 3747, slot: 2, type: 'controller', player: 'user' },
		{ step: 3747, slot: 0, type: 'act', act: 'build', kind: 'panel', tier: 1, planet: 8 },
		{ step: 3747, slot: 0, type: 'act', act: 'build', kind: 'battery', tier: 1, planet: 8 },
		{ step: 3747, slot: 0, type: 'controller', player: 'user' },
		{ step: 3747, slot: 1, type: 'controller', player: 'bot' },
		{ step: 3747, slot: 2, type: 'controller', player: 'bot' },
		{ step: 3747, slot: 0, type: 'launch', origin: 8, angle: 2.136673450488476, speed: 64.9814453125 },
		{ step: 3756, slot: 0, type: 'fireQueued' },
		{ step: 8629, slot: 0, type: 'act', act: 'part', kind: 'tank', tier: 1 },
		{ step: 8629, slot: 0, type: 'launch', origin: 8, angle: 1.6832083564071412, speed: 61.6279296875 },
		{ step: 8717, slot: 0, type: 'fireQueued' },
		{ step: 11145, slot: 0, type: 'act', act: 'part', kind: 'tank', tier: 0 },
		{ step: 11145, slot: 0, type: 'act', act: 'part', kind: 'hold', tier: 0 }
	],
	events: []
};

const env = loadPage({ search: '?mode=lab&seed=7' });
const run = code => vm.runInContext(code, env.context);
const el = id => env.elements.get(id);
el('replayInput').value = env.context.CareerActions.encode(data);
env.click('replayLoad');

const advance = run(`end => {
	while (game.clockSteps < end && careerActionReplay.active) {
		const previous = game.clockSteps;
		const steps = Math.min(160, end - previous);
		playAcc = 0;
		stepGame(performance.now(), (steps + 0.25) * DT / playScale());
		if (previous === game.clockSteps) throw new Error('clock stalled at ' + previous);
	}
}`);
advance(3167);
console.log('after landing at 3167:');
console.log('  careerMsg:', JSON.stringify(el('careerMsg').textContent));
console.log('  activeSlot:', run('activeSlotIndex()'));
console.log('  career.at:', run('playerCareer().at'));
console.log('  career.purse:', run('playerCareer().ledger.purse'));
console.log('  pad8 catapult:', run('JSON.stringify(playerCareer().pads[8].catapult)'));
console.log('  pad8 panel:', run('JSON.stringify(playerCareer().pads[8].panel)'));
console.log('  pad8 battery:', run('JSON.stringify(playerCareer().pads[8].battery)'));
console.log('  planetBuildable(career,8):', run('GravityGame.planetBuildable(playerCareer(), 8)'));
console.log('  claimOwner(8):', run('GravityGame.claimOwner(game.galaxy, 8)'));
console.log('  career.index:', run('playerCareer().index'));
console.log('  skipped:', run('careerActionReplay.skipped'));
