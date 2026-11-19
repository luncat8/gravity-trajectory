/* H's call key, dismissal, snapshot and non-pausing card. */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const env = loadPage({ search: mapSearch(1) + '&rate=1' });
env.runFrames(2, 16);
const context = env.context;
const ui = env.elements;
const get = expression => vm.runInContext(expression, context);
const run = expression => vm.runInContext(expression, context);
const gateIds = get('Array.from(CommsCopy.LAUNCH_GATE_ORDER).join(",")');
assert.strictEqual(gateIds, 'arrest,space,wrong-planet,worn,no-rail,cap,fee');
const factIds = get('Object.keys(HH_FACTS).sort().join(",")');
for (const id of gateIds.split(',')) {
	assert.ok(factIds.split(',').includes(id), 'missing gate fact ' + id);
}
for (const id of factIds.split(',')) {
	assert.strictEqual(get('typeof HH_FACTS[' + JSON.stringify(id) + '].test'), 'function');
	assert.strictEqual(get('typeof HH_FACTS[' + JSON.stringify(id) + '].why'), 'function');
}

const key = get("commsFindingKey({ id: 'fee', need: 3.04, have: 1, repair: false }, 2)");
assert.strictEqual(key, 'fee|P2|3.04|1|launch');
assert.notStrictEqual(get("commsFindingKey({ id: 'fee', need: 3.05, have: 1, repair: false }, 2)"), key,
	'a changed price is a new fact');
assert.notStrictEqual(get("commsFindingKey({ id: 'fee', need: 3.04, have: 2, repair: false }, 2)"), key,
	'a changed purse is a new fact');
assert.notStrictEqual(get("commsFindingKey({ id: 'fee', need: 3.04, have: 1, repair: false }, 3)"), key,
	'a different planet is a new fact');

run('playerCareer().ship.condition = 0; armed = false; commsTick()');
let state = get('commsState');
const wornKey = state.callKey;
assert.ok(wornKey.startsWith('worn|P'), wornKey);
assert.strictEqual(ui.get('commsBadge').hidden, false);
assert.strictEqual(ui.get('commsTag').textContent, context.GravityGame.WORN_OUT_BLOCK);
run('commsTick()');
assert.strictEqual(get('commsState.callKey'), wornKey, 'same fact stays called, not re-offered');

const before = get('game.clockSteps');
env.click('commsButton');
assert.strictEqual(ui.get('commsCard').hidden, false);
assert.strictEqual(get('Object.isFrozen(commsState.snapshot)'), true);
assert.strictEqual(get('Object.isFrozen(commsState.snapshot.reasons)'), true);
assert.strictEqual(ui.get('commsBadge').hidden, true, 'opening the card clears the badge');
assert.strictEqual(ui.get('commsAnswer').textContent.split('\n')[0], context.GravityGame.WORN_OUT_BLOCK);
assert.match(ui.get('commsStamp').textContent, /^checked \d+ s · P\d+$/);
assert.strictEqual(get('game.clockSteps'), before, 'opening H does not advance the game clock');
assert.strictEqual(get('commsState.callKey'), '', 'an open card is not also a call');
env.click('commsQuestion');
env.click('commsQuestion');
env.click('commsQuestion');
assert.strictEqual(get('commsState.exchanges.length'), 1,
	're-asking the same question refreshes it in place instead of stacking an identical copy');
env.click('commsFold');
assert.strictEqual(get('commsState.collapsed'), true);
env.click('commsFold');
assert.strictEqual(get('commsState.collapsed'), false);

run('commsDismiss()');
assert.strictEqual(ui.get('commsCard').hidden, true);
assert.strictEqual(get('commsState.dismissed[' + JSON.stringify(wornKey) + ']'), true);
run('commsTick()');
assert.strictEqual(get('commsState.callKey'), '', 'dismissal is remembered for this visit');

run("playerCareer().ship.condition = 1; playerCareer().ledger.purse = -1; " +
	"activeCareerSim().canLaunchFrom = () => true; activeCareerSim().speedLimit = () => 100; " +
	"armed = true; aimBody = playerCareer().at; aimSpeed = 50; commsInvalidate(); commsTick()");
assert.strictEqual(get('commsState.callKey'), '', 'different facts do not call twice in one game second');
run('game.clockSteps += Math.ceil(1 / GravitySim.DT); commsTick()');
const feeKey = get('commsState.callKey');
assert.ok(feeKey.startsWith('fee|P'), feeKey);
assert.notStrictEqual(feeKey, wornKey, 'a different gate calls once with a new fact key');

run("playerCareer().ledger.purse = -2; game.clockSteps += Math.ceil(1 / GravitySim.DT); " +
	'commsInvalidate(); commsTick()');
const changedFeeKey = get('commsState.callKey');
assert.ok(changedFeeKey.startsWith('fee|P'), changedFeeKey);
assert.notStrictEqual(changedFeeKey, feeKey, 'a changed live amount gets its own call');

/* A new fact discovered while the card is open waits until it closes. */
env.click('commsButton');
run("playerCareer().ledger.purse = -3; game.clockSteps += Math.ceil(1 / GravitySim.DT); " +
	'commsInvalidate(); commsTick()');
assert.strictEqual(get('commsState.callKey'), '', 'never calls over an open answer');
assert.match(ui.get('commsAnswer').textContent, /purse -3\.00/,
	'the open answer refreshes from a new immutable snapshot');
run('commsClose(); commsTick()');
assert.ok(get('commsState.callKey').startsWith('fee|P'), 'a pending fact may call after the card closes');

env.click('commsButton');
env.fireWindow('keydown', { code: 'Escape', target: { tagName: 'BODY' } });
assert.strictEqual(ui.get('commsCard').hidden, true, 'Escape closes the non-modal card');

run('armed = false; playerCareer().ship.condition = 1; commsTick()');
assert.strictEqual(get('commsState.callKey'), '', 'a cleared gate quiets the icon on the same tick');
assert.strictEqual(ui.get('commsBadge').hidden, true);

/* Planet changes reset transcript and per-visit dismissals. */
run("playerCareer().at = (playerCareer().at + 1) % 13; commsTick()");
assert.strictEqual(get('commsState.exchanges.length'), 0);
assert.strictEqual(get('Object.keys(commsState.dismissed).length'), 0);

run('playerCareer().ship.condition = 0; replay.on = true; commsTick()');
assert.strictEqual(get('commsState.callKey'), '', 'no call during replay');
run('replay.on = false; playerCareer().ledger.purse = 0; playerCareer().at = -1; ' +
	'playerCareer().stranded = true; game.clockSteps += Math.ceil(1 / GravitySim.DT); commsTick()');
assert.ok(get('commsState.callKey').startsWith('space|P-1|'),
	'a lost-in-space situation raises the radio call');
assert.strictEqual(ui.get('commsBadge').hidden, false);
assert.ok(ui.get('commsButton').attributes['aria-label'].includes('open radio assistant'),
	'the always-visible entry point identifies itself as radio');
env.click('commsButton');
assert.strictEqual(ui.get('commsCard').hidden, false, 'the H radio button opens the dialog manually');
assert.ok(ui.get('commsAnswer').textContent.includes('Evacuate to HQ'),
	ui.get('commsAnswer').textContent);


/* No pad by itself is ordinary travel, but an unaffordable standing rail is
 * still a useful call even before the player arms a shot. */
const visitor = loadPage({ search: mapSearch(42) });
const visit = expression => vm.runInContext(expression, visitor.context);
visit(`(() => {
	const career = playerCareer();
	const other = Array.from(planetMask).findIndex((on, p) => on && p !== career.hq &&
		p !== career.capitalPlanet && p !== career.arfPlanet);
	GravityGame.placeShip(career, activeCareerSim(), other);
	career.stranded = false;
	career.ledger.purse = 100;
	armed = false;
})()`);
assert.strictEqual(visit('commsActiveFinding(playerCareer())'), null, 'affordable visitor does not trigger a call');
visit('playerCareer().ledger.purse = -100');
assert.strictEqual(visit('commsActiveFinding(playerCareer()).id'), 'fee', 'unaffordable rail calls even before aiming');

/* Settle flight outcomes directly to exercise the repeat-call lifecycle. */
visit('playerCareer().ledger.purse = 100; commsTick()');
const land = visit(`planet => {
	const career = playerCareer();
	const sim = activeCareerSim();
	sim.origin = career.at;
	sim.endBody = planet;
	sim.endReason = planet >= 0 ? GravitySim.END_IMPACT : GravitySim.END_EXIT;
	sim.status = STATUS_ENDED;
	game.clockSteps += Math.ceil(1 / DT);
	GravityGame.careerEndFlight(career, sim, tradeSim, game.clockSteps);
	commsTick();
}`);
const here = visit('playerCareer().at');
land(here);
assert.strictEqual(visit('commsState.callKey'), '', 'first return is quiet');
land(here);
assert.strictEqual(visit('commsState.callReason.id'), 'return-tow');
visitor.click('commsDismissCall');
land(here);
assert.strictEqual(visit('commsState.callKey'), '', 'further loops do not repeat a dismissed tow offer');
land(visit('playerCareer().hq'));
assert.strictEqual(visit('GravityGame.returnLandingVisit(playerCareer())'), null);
land(here);
land(here);
assert.strictEqual(visit('commsState.callKey'), '', 'an intervening departure resets the count');
land(here);
assert.strictEqual(visit('commsState.callReason.id'), 'return-tow', 'a later visit can call again');
land(-1);
assert.strictEqual(visit('GravityGame.returnLandingVisit(playerCareer())'), null, 'an exit is not a return');
assert.strictEqual(visit('commsState.callReason.id'), 'space');

const ending = loadPage({ search: mapSearch(1) + '&rate=1' });
const endgame = code => vm.runInContext(code, ending.context);
ending.runFrames(2, 16);
endgame(`playerCareer().ledger.purse = -1;
	GravityGame.careerAdvance(playerCareer(), GravityGame.ENDGAME_WARNING_STEPS - 1);
	game.clockSteps += GravityGame.ENDGAME_WARNING_STEPS - 1;
	commsTick()`);
assert.notStrictEqual(endgame('commsState.callReason?.id'), 'endgame-warning');
endgame('advanceCareerOneStep(); commsTick()');
assert.strictEqual(endgame('commsState.callReason.id'), 'endgame-warning');
assert.match(ending.elements.get('commsCallReason').textContent, /480 game seconds/);
ending.click('commsButton');
assert.match(ending.elements.get('commsAnswer').textContent, /factories will become commercial/);
endgame(`GravityGame.careerAdvance(playerCareer(),
	GravityGame.ENDGAME_LIMIT_STEPS - GravityGame.ENDGAME_WARNING_STEPS - 1);
	advanceCareerOneStep(); commsTick()`);
assert.strictEqual(endgame('playerCareer().ended'), ending.context.GravityGame.CAREER_BROKE);
assert.match(ending.elements.get('commsAnswer').textContent, /Career over/);

console.log('COMMS CALL OK');
