/*
 * Auto helpers and player switches: a scan belongs to the player that started
 * it, a human player's trajectory exists only while that player is selected, a
 * bot box flip takes effect on the spot, and a difficulty switch re-skills the
 * live controllers instead of rebuilding the run.
 *
 * Run: node experiments/helper_multiplayer_test.js
 */
'use strict';

const assert = require('assert');
const { loadPage } = require('./dom_stub.js');

function helperState(ui) {
	const read = id => ui.get(id).hidden ? 'hidden' : ui.get(id).disabled ? 'off' : 'on';
	return ['helperScan', 'helperFocus', 'helperTweak', 'helperProfit'].map(read).join(',');
}

/* one scenario per fresh page: the page's rng is pinned by the stub, so every
 * press plays the same scan */

/* --- 1. a bot box flip enables the helpers on the spot -------------------- */
{
	const env = loadPage({ search: '?mode=career&seed=1' });
	env.runFrames(6, 16);
	const ui = env.elements;
	const scene = env.context.GravityScene;
	env.click('playerCountUp');
	env.runFrames(3, 16);
	env.click('scoreRival1');
	env.runFrames(2, 16);
	assert.strictEqual(scene.activeSlot(), 1, 'R1 was not selected');
	assert.strictEqual(helperState(ui), 'off,off,off,off', 'a bot slot offered the helpers');
	env.toggle('rivalBot1');
	env.runFrames(2, 16);
	assert.strictEqual(helperState(ui), 'on,off,off,on',
		'unchecking bot did not enable the helpers until another player was selected: ' +
		helperState(ui));
	/* the same flip on YOU's own row */
	env.click('scorePlayer');
	env.runFrames(2, 16);
	env.toggle('playerBot');
	env.runFrames(2, 16);
	assert.strictEqual(helperState(ui), 'off,off,off,off', 'YOU=bot still offered the helpers');
	env.toggle('playerBot');
	env.runFrames(2, 16);
	assert.strictEqual(helperState(ui), 'on,off,off,on',
		'YOU=user did not restore the helpers: ' + helperState(ui));
	console.log('bot box flip: helpers follow the selected player at once');
}

/* --- 2. the tweak works wherever a shot is armed -------------------------- */
{
	const env = loadPage({ search: '?mode=career&seed=1' });
	env.runFrames(6, 16);
	const ui = env.elements;
	const scene = env.context.GravityScene;
	env.click('helperScan');
	env.runFrames(30, 16);
	assert.ok(scene.aimState().armed, 'the career scan armed nothing');
	assert.strictEqual(helperState(ui).split(',')[2], 'on',
		'tweak best stayed disabled with an armed career shot: ' + helperState(ui));
	const before = scene.aimState();
	env.click('helperTweak');
	env.runFrames(40, 16);
	assert.ok(ui.get('helperStop').hidden, 'the tweak never finished');
	const after = scene.aimState();
	assert.ok(after.armed && after.body === before.body,
		'the tweak lost the armed shot: ' + JSON.stringify(after));
	console.log('tweak: works on an armed career shot from ' + scene.career.at);
}

/* --- 3. one human trajectory at a time ------------------------------------ */
{
	const env = loadPage({ search: '?mode=route&seed=1' });
	env.runFrames(8, 16);
	const ui = env.elements;
	const scene = env.context.GravityScene;
	/* hand R1 to the keyboard first: outside a career that restarts the run, so
	 * both players start from a clean plan */
	env.toggle('rivalBot1');
	env.runFrames(4, 16);
	assert.strictEqual(scene.slotType(1), 'user', 'R1 is not a keyboard player');
	env.click('scoreRival1');
	env.runFrames(3, 16);
	assert.strictEqual(scene.activeSlot(), 1, 'R1 was not selected');
	/* R1 plans, then YOU plans, then R1 plans again: each switch leaves exactly
	 * one human trajectory on the canvas */
	env.click('helperScan');
	env.runFrames(80, 16);
	const rival = scene.bot.rivals[0];
	assert.ok(rival.sim.predCount >= 2, 'R1 plan is not traced');
	env.click('scorePlayer');
	env.runFrames(8, 16);
	assert.strictEqual(rival.sim.predCount, 0,
		'R1 human trajectory stayed drawn while YOU was selected');
	env.click('helperScan');
	env.runFrames(80, 16);
	assert.ok(scene.sim.predCount >= 2, 'YOU plan is not traced');
	env.click('scoreRival1');
	env.runFrames(8, 16);
	assert.ok(rival.sim.predCount >= 2, 'R1 plan did not come back after the switch');
	assert.strictEqual(scene.sim.predCount, 0,
		'YOU human trajectory stayed drawn while R1 was selected');
	env.click('helperScan');
	env.runFrames(80, 16);
	assert.ok(rival.sim.predCount >= 2, 'R1 second scan armed nothing');
	assert.strictEqual(scene.sim.predCount, 0, 'R1 second scan traced YOU trajectory too');
	console.log('player switch: one human trajectory, saved plan restored');
}

/* --- 4. difficulty is a live skill switch --------------------------------- */
{
	const env = loadPage({ search: '?mode=tour&seed=7' });
	env.runFrames(6, 16);
	const scene = env.context.GravityScene;
	const game = scene.game;
	const before = { seed: game.seed, clock: game.clockSteps, purse: game.money.purse };
	const started = Date.now();
	env.choose('botHard');
	const elapsed = Date.now() - started;
	env.runFrames(4, 16);
	assert.strictEqual(scene.botLevel(), 'hard', 'the level did not change');
	assert.strictEqual(game.seed, before.seed, 'a difficulty switch reset the seed');
	assert.strictEqual(game.clockSteps, before.clock, 'a difficulty switch reset the clock');
	assert.strictEqual(game.money.purse, before.purse, 'a difficulty switch reset the purse');
	assert.strictEqual(scene.bot.count, 2, 'hard did not field two rivals');
	assert.ok(elapsed < 250, 'the difficulty switch took ' + elapsed + ' ms');
	/* a skill change reaches the decisions */
	const trace = scene.bot.trace.join('\n');
	assert.ok(/page level · hard/.test(trace), 'the level change is not in the bot log: ' + trace);
	console.log('difficulty: live switch in ' + elapsed + ' ms · seed and purse kept · ' +
		scene.bot.count + ' rivals');
}

/* --- 5. a career keeps its companies on a level switch -------------------- */
{
	const env = loadPage({ search: '?mode=career&seed=7' });
	env.runFrames(8, 16);
	const scene = env.context.GravityScene;
	const hqs = [0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).hq : -1);
	const purse = scene.career.ledger.purse;
	env.choose('botEasy');
	env.runFrames(4, 16);
	assert.strictEqual(scene.bot.level, 'easy', 'the career level did not change');
	assert.deepStrictEqual([0, 1, 2].map(s => scene.slotCareer(s) ? scene.slotCareer(s).hq : -1), hqs,
		'a difficulty switch moved or dropped a career company');
	assert.strictEqual(scene.career.ledger.purse, purse, 'a difficulty switch reset a purse');
	console.log('career: level switch keeps ' + scene.bot.count + ' rival companies');
}

/* --- 6. best profit never pays less on a second press --------------------- */
{
	const env = loadPage({ search: '?mode=career&seed=520383' });
	env.runFrames(6, 16);
	const ui = env.elements;
	const page = env.context;
	const scene = page.GravityScene;
	assert.ok(scene.careerPaused(), 'a career landing should pause by default');
	let previous = -Infinity;
	for (let press = 0; press < 6; press++) {
		env.click('helperProfit');
		let guard = 0;
		while (!ui.get('helperStop').hidden && guard < 2000) {
			env.runFrames(1, 16);
			guard += 1;
		}
		env.runFrames(2, 16);
		const aim = scene.aimState();
		assert.ok(aim.armed, 'press ' + (press + 1) + ' armed nothing');
		const net = page.predictedCareerEconomics(scene.activeSim()).net;
		assert.ok(net >= previous - 1e-9,
			'press ' + (press + 1) + ' paid less: ' + net.toFixed(3) + ' < ' + previous.toFixed(3));
		previous = net;
	}
	console.log('best profit: six paused presses, net ' + previous.toFixed(2) + ' never fell');
}

console.log('HELPER MULTIPLAYER OK');
