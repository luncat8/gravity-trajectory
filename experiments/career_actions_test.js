/* Minimal player-actions copy (copy actions): the GRAVITY_ACTIONS payload
 * carries only the inputs of the run, and loading it replays them at the
 * steps they happened on. No world snapshot is copied or applied. */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

function get(env, expression) {
	return vm.runInContext(expression, env.context);
}

/* A real launch, through the same EMC click path the page uses. */
const live = loadPage({ search: mapSearch(42) });
const at = get(live, 'playerCareer().at');
get(live, `(() => {
	aiming = false;
	armAiming = false;
	burnAiming = false;
	armed = true;
	aimBody = ${at};
	aimAngle = 1.1;
	aimSpeed = 50;
})()`);
get(live, 'launchShot()');
for (let i = 0; i < 900 && get(live, 'game.shots.length') === 0; i++) live.runFrames(1, 16.0);
assert.strictEqual(get(live, 'game.shots.length'), 1, 'the queued shot fired');
assert.strictEqual(get(live, 'cargoSim.status'), get(live, 'STATUS_FLYING'));
const liveSteps = get(live, 'game.clockSteps');
live.runFrames(300, 16.0);

/* the log recorded exactly what the human did, nothing of the world */
const logged = get(live, 'JSON.stringify(careerActionLog)');
assert.match(logged, /"type":"launch"/, 'the launch is in the action log: ' + logged);
assert.strictEqual(get(live, 'careerActionLog.filter(a => a.type === "launch").length'), 1);

live.click('gameCopy');
const actionsText = get(live, 'gameLinkEl.value');
assert(actionsText.startsWith('GRAVITY_ACTIONS:'), 'gameCopy copies the actions payload');
assert(actionsText.length < 1500, 'the actions payload stays chat-pasteable: ' + actionsText.length + ' chars');
const actions = live.context.CareerActions.decode(actionsText);
assert(actions && actions.seed === 42, 'actions payload round-trips');
assert.strictEqual(actions.actions.length, 1);
assert.strictEqual(actions.actions[0].type, 'launch');
assert.strictEqual(actions.actions[0].origin, at);
assert.strictEqual(actions.cheat, undefined, 'no cheat leaks into a plain run');
console.log('actions payload:', actionsText.length, 'chars ·', JSON.stringify(actions.actions));

/* A shop action is logged with its args. */
const shopEnv = loadPage({ search: mapSearch(42) });
get(shopEnv, 'playerCareer().ledger.purse = 100');
shopEnv.context.careerAct({ act: 'build', kind: 'battery', tier: '1' });
const shopLog = get(shopEnv, 'JSON.stringify(careerActionLog)');
assert.match(shopLog, /"type":"act"/, 'shop clicks are logged: ' + shopLog);
assert.match(shopLog, /"act":"build"/, 'the act keeps its args: ' + shopLog);

/* Loading the payload into a fresh run replays the inputs by itself. */
const fresh = loadPage({ search: mapSearch(42) });
fresh.elements.get('replayInput').value = actionsText;
fresh.click('replayLoad');
assert.strictEqual(fresh.elements.get('replayLoadNote').textContent, 'replay opened',
	fresh.elements.get('replayLoadNote').textContent);
assert.strictEqual(get(fresh, 'careerActionReplay.pending.length'), 1);
assert.strictEqual(get(fresh, 'game.shots.length'), 0, 'the recorded shot has not fired yet');
for (let i = 0; i < 900 && get(fresh, 'game.shots.length') === 0; i++) fresh.runFrames(1, 16.0);
assert.strictEqual(get(fresh, 'game.shots.length'), 1, 'the recorded launch replayed on its own');
assert.strictEqual(get(fresh, 'careerActionReplay.applied'), 1, 'applied count');
assert.strictEqual(get(fresh, 'careerActionReplay.skipped'), 0, 'nothing skipped');
assert.strictEqual(get(fresh, 'game.clockSteps'), liveSteps, 'the launch flies on the very same step');
fresh.runFrames(300, 16.0);
assert.strictEqual(get(fresh, 'game.clockSteps'), get(live, 'game.clockSteps'), 'clocks agree');
assert.strictEqual(get(fresh, 'playerCareer().ledger.purse'), get(live, 'playerCareer().ledger.purse'),
	'purse identical after the same flight');
assert.strictEqual(get(fresh, 'playerCareer().flights'), get(live, 'playerCareer().flights'));
console.log('fresh replay matches the live run at step', liveSteps);

/* The pasted payload carries no world snapshot: only the action list. */
assert.ok(!/"careers"|"pads"|"market"/.test(actionsText), 'no world state in the payload');
console.log('CAREER ACTIONS OK · minimal payload, auto-replay, identical worlds');
