/*
 * Cheat panel: +10 cr, communism (all free) and test mode (stock upgrades).
 *
 * 1. +10 cr adds to the shared purse; communism flips `career.cheat`, zeroes
 *    the core price wrappers and tags the run; off restores honest prices.
 * 2. Test mode applies the endgame fit to the live career and the flagged
 *    career never completes; unchecking re-opens completion, so the fully
 *    paved career honestly completes on the next step.
 * 3. A replay of a cheated run re-applies the recorded cheat and credit
 *    actions at their steps and lands on the same careers snapshot.
 * 4. Restarts carry the panel intent through the single-slot reset: communism
 *    (starter purse), test alone (the endgame package), both (communism reset
 *    plus the re-applied fit).
 * 5. A seed url `&cheat=` adopts into the boxes; outside career the career
 *    boxes lock and the credit button still works.
 *
 * Run: node experiments/cheat_panel_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const get = (env, expr) => vm.runInContext(expr, env.context);

function topCatapult(env) {
	return get(env, 'OrbitTech.CATAPULTS[4]');
}

/* --- 1. live career: credit, communism, test mode, honest completion ----- */
{
	const env = loadPage({ search: mapSearch(42) });
	const ui = env.elements;
	env.runFrames(2, 16);
	assert(ui.has('cheatPanel') && ui.has('cheatCr') && ui.has('cheatCommunism') && ui.has('cheatTest'));
	assert.strictEqual(ui.get('cheatCommunism').disabled, false, 'career run keeps the boxes live');
	assert.strictEqual(get(env, 'game.career.cheat'), null, 'an honest boot stays honest');

	const purse0 = get(env, 'game.money.purse');
	env.click('cheatCr');
	assert.strictEqual(get(env, 'game.money.purse'), purse0 + 10, '+10 cr lands in the purse');

	env.toggle('cheatCommunism');
	assert.strictEqual(get(env, 'game.career.cheat'), 'communism');
	assert.strictEqual(get(env, 'game.cheat'), 'communism');
	assert.strictEqual(get(env, 'GravityGame.bulkUpgradeCost(game.career, "catapult", OrbitTech.CATAPULTS[4])'), 0,
		'communism prices everything 0');
	env.runFrames(1, 16);
	assert.match(ui.get('scoreRuleTag').textContent, /communism/);
	env.toggle('cheatCommunism');
	assert.strictEqual(get(env, 'game.career.cheat'), null);
	assert.ok(get(env, 'GravityGame.bulkUpgradeCost(game.career, "catapult", OrbitTech.CATAPULTS[4])') > 0);

	env.toggle('cheatTest');
	assert.strictEqual(get(env, 'game.career.cheat'), 'endgame', 'test mode alone holds the endgame flag');
	assert.strictEqual(get(env, 'game.career.pads[game.career.hq].catapult'), topCatapult(env));
	assert.strictEqual(get(env, 'game.career.ship.hold'), get(env, 'OrbitTech.HOLDS[2]'));
	assert.strictEqual(get(env, 'game.career.ship.engine'), get(env, 'OrbitTech.ENGINES[2]'));
	assert.strictEqual(get(env, 'game.career.ship.tank'), get(env, 'OrbitTech.TANKS[3]'));
	assert.ok(get(env, 'game.career.owned["IMP-3"]'), 'every stock part is owned');
	assert.strictEqual(get(env, 'game.career.ship.mass'), get(env, 'OrbitTech.shipMass(game.career.ship, 0)'),
		'the fit is refitted into the ship stats');
	env.runFrames(1, 16);
	assert.match(ui.get('scoreRuleTag').textContent, /endgame/);
	env.click('careerClock');
	env.runFrames(30, 16);
	assert.strictEqual(get(env, 'game.career.ended'), get(env, 'GravityGame.CAREER_OPEN'),
		'a cheat career never completes');
	env.click('careerClock');
	env.toggle('cheatTest');
	assert.strictEqual(get(env, 'game.career.cheat'), null, 'unchecking drops the flag, the pads stay');
	const paved = get(env, 'game.career.planetCount - GravityGame.capitalCovered(game.career)' +
		' - game.market.empty.reduce((n, v) => n + v, 0)');
	assert.strictEqual(get(env, 'game.career.padCount'), paved,
		'the installed rails stay; the empty worlds stay completion ground (career_bench)');
}

/* --- 2. a cheated run replays through the recorded actions --------------- */
{
	const live = loadPage({ search: mapSearch(42) });
	live.runFrames(2, 16);
	live.toggle('cheatCommunism');
	live.click('cheatCr');
	live.toggle('cheatTest');
	live.runFrames(2, 16);

	live.click('gameCopy');
	const data = live.context.CareerActions.decode(live.clipboardText);
	const cheats = data.actions.filter(a => a.type === 'cheat');
	const credits = data.actions.filter(a => a.type === 'credit');
	assert.strictEqual(cheats.length, 2, 'both toggles are recorded');
	assert.deepStrictEqual([cheats[0].communism, cheats[0].test], [true, false]);
	assert.deepStrictEqual([cheats[1].communism, cheats[1].test], [true, true]);
	assert.strictEqual(credits.length, 1);
	assert.strictEqual(credits[0].cr, 10);

	/* re-fly the recording and require the same careers snapshot */
	const env = loadPage({ search: '?mode=lab&seed=7' });
	env.elements.get('replayInput').value = live.clipboardText;
	env.click('replayLoad');
	for (let i = 0; i < 1500 && get(env, 'careerActionReplay.active'); i++) env.runFrames(1, 16);
	assert.strictEqual(get(env, 'careerActionReplay.active'), false);
	assert.strictEqual(get(env, 'careerActionReplay.skipped'), 0, env.elements.get('careerMsg').textContent);
	assert.strictEqual(get(env, 'JSON.stringify(careerRecordingSnapshot().state.careers)'),
		get(live, 'JSON.stringify(careerRecordingSnapshot().state.careers)'),
		'the replayed companies match the cheated live run');
	assert.strictEqual(get(env, 'game.career.cheat'), 'communism', 'both boxes resolve to communism');
	assert.strictEqual(get(env, 'game.career.pads[game.career.hq].catapult'), topCatapult(env));
	assert.strictEqual(get(env, 'game.money.purse'), get(live, 'game.money.purse'));
}

/* --- 3. restarts carry the panel intent ---------------------------------- */
{
	const env = loadPage({ search: mapSearch(42) });
	env.runFrames(2, 16);
	env.toggle('cheatCommunism');
	env.click('gameRestart');
	env.runFrames(2, 16);
	assert.strictEqual(get(env, 'game.career.cheat'), 'communism', 'a restart keeps communism');
	assert.strictEqual(get(env, 'game.career.ship.fuelKg'), 0,
		'a communism reset is not the endgame package');
	assert.strictEqual(get(env, 'GravityGame.bulkUpgradeCost(game.career, "catapult", OrbitTech.CATAPULTS[4])'), 0);
	assert.strictEqual(get(env, 'cheatCommunismEl.checked'), true, 'the box survives the restart');

	env.toggle('cheatCommunism');
	env.toggle('cheatTest');
	env.click('gameRestart');
	env.runFrames(2, 16);
	assert.strictEqual(get(env, 'game.career.cheat'), 'endgame');
	assert.strictEqual(get(env, 'game.money.purse'), get(env, 'GravityGame.CAREER.endgamePurse'),
		'test mode alone starts the endgame package (no gifts, purse 99)');
	assert.strictEqual(get(env, 'game.career.pads[game.career.hq].catapult'), topCatapult(env));

	env.toggle('cheatCommunism');
	env.click('gameRestart');
	env.runFrames(2, 16);
	assert.strictEqual(get(env, 'game.career.cheat'), 'communism', 'both boxes resolve to communism');
	assert.strictEqual(get(env, 'game.career.ship.fuelKg'), 0, 'the reset carried communism, not the package');
	assert.strictEqual(get(env, 'game.career.pads[game.career.hq].catapult'), topCatapult(env),
		'the panel re-applies the fit the single-slot reset could not carry');
	assert.ok(get(env, 'game.career.owned["IMP-3"]'));
}

/* --- 4. a seed url cheat adopts into the boxes --------------------------- */
{
	const env = loadPage({ search: mapSearch(42) + '&cheat=endgame' });
	assert.strictEqual(get(env, 'cheatTestEl.checked'), true, '&cheat=endgame checks test mode');
	assert.strictEqual(get(env, 'cheatCommunismEl.checked'), false);
	assert.strictEqual(get(env, 'game.career.cheat'), 'endgame');
	assert.strictEqual(get(env, 'game.money.purse'), get(env, 'GravityGame.CAREER.endgamePurse'));

	const communism = loadPage({ search: mapSearch(42) + '&cheat=communism' });
	assert.strictEqual(get(communism, 'cheatCommunismEl.checked'), true);
	assert.strictEqual(get(communism, 'cheatTestEl.checked'), false);
	assert.strictEqual(get(communism, 'game.career.cheat'), 'communism');
	assert.strictEqual(get(communism, 'game.career.ship.fuelKg'), 0);
}

/* --- 5. locks: career cheats only in a career, credit in every rule ------ */
{
	const lab = loadPage({ search: '?mode=lab&seed=5' });
	lab.runFrames(2, 16);
	assert.strictEqual(lab.elements.get('cheatCommunism').disabled, true, 'no career, no career cheats');
	assert.strictEqual(lab.elements.get('cheatTest').disabled, true);
	assert.strictEqual(lab.elements.get('cheatCr').disabled, false);
	const purse0 = get(lab, 'game.money.purse');
	lab.click('cheatCr');
	assert.strictEqual(get(lab, 'game.money.purse'), purse0 + 10, 'the credit button works outside career');
}

console.log('CHEAT PANEL OK · credit, communism, test mode, replay, restarts, adoption, locks');
