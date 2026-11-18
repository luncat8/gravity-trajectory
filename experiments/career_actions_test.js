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

/* Opening settings, same-step purchases and a human-to-bot handover survive
 * even when the importing page has a different roster and settings. */
const handover = loadPage({ search: mapSearch(42) });
get(handover, "careerAct({act:'build',kind:'battery',tier:'1'}); careerAct({act:'build',kind:'panel',tier:'1'});");
get(handover, 'setSlotType(0, PLAYER_BOT)');
handover.runFrames(250, 16);
get(handover, 'setSlotType(0, PLAYER_USER)');
const handoverStep = get(handover, 'game.clockSteps');
assert(handoverStep > 0);
get(handover, 'setSlotType(0, PLAYER_BOT)');
handover.runFrames(50, 16);
handover.click('gameCopy');
const handoverText = get(handover, 'gameLinkEl.value');
const record = handover.context.CareerActions.decode(handoverText);
assert.strictEqual(record.players[0], 'user', 'opening controller, not current controller');
assert.strictEqual(record.actions.filter(a => a.type === 'controller').length, 3);
const otherPage = loadPage({ search: mapSearch(42) });
get(otherPage, 'game.playerCount = 1; game.planetUniverse = 20; setExperimentScales(2, 2, true, 2)');
otherPage.elements.get('replayInput').value = handoverText;
otherPage.click('replayLoad');
assert.strictEqual(otherPage.elements.get('replayLoadNote').textContent, 'replay opened');
for (let i = 0; i < 2000 && get(otherPage, 'careerActionReplay.active'); i++) otherPage.runFrames(1, 16);
assert.strictEqual(get(otherPage, 'careerActionReplay.active'), false, 'replay stops at its captured step');
assert.strictEqual(get(otherPage, 'game.clockSteps'), record.steps);
assert.strictEqual(get(otherPage, 'careerPaused'), true);
assert.strictEqual(get(otherPage, 'careerActionReplay.skipped'), 0);
assert.match(otherPage.elements.get('careerMsg').textContent, /selected flights match/);
assert.strictEqual(get(otherPage, 'playerCountShown()'), 3);
assert.strictEqual(get(otherPage, 'planetCount'), record.universe);
assert.strictEqual(get(otherPage, 'game.career.ledger.purse'), get(handover, 'game.career.ledger.purse'));
assert.strictEqual(get(otherPage, 'game.career.pads[game.career.hq].battery.id'),
	get(handover, 'game.career.pads[game.career.hq].battery.id'));
assert.strictEqual(get(otherPage, 'JSON.stringify(game.shots)'), get(handover, 'JSON.stringify(game.shots)'));

/* Bot-only runs still advance to the copied step. */
const bots = loadPage({ search: mapSearch(42) });
get(bots, 'setSlotType(0, PLAYER_BOT); startGame(game.seed, true, game.rule, game.bot, PLAYER_BOT)');
bots.runFrames(100, 16);
bots.click('gameCopy');
const botsRecord = bots.context.CareerActions.decode(get(bots, 'gameLinkEl.value'));
assert.strictEqual(botsRecord.actions.length, 0);
const botsReplay = loadPage({ search: mapSearch(42) });
botsReplay.elements.get('replayInput').value = get(bots, 'gameLinkEl.value');
botsReplay.click('replayLoad');
for (let i = 0; i < 1000 && get(botsReplay, 'careerActionReplay.active'); i++) botsReplay.runFrames(1, 16);
assert.strictEqual(get(botsReplay, 'game.clockSteps'), botsRecord.steps);
assert.strictEqual(get(botsReplay, 'careerPaused'), true);
console.log('CAREER REPLAY OK · opening roster, purchases, handovers and bot-only runs');

/* Eased waits are part of the history, including the actions after the wait. */
const waitLive = loadPage({ search: mapSearch(42) });
get(waitLive, "careerAct({act:'wait'})");
for (let i = 0; i < 400 && get(waitLive, 'careerWaitBusy()'); i++) waitLive.runFrames(1, 16);
assert.strictEqual(get(waitLive, 'careerWaitBusy()'), false);
get(waitLive, "careerAct({act:'build',kind:'battery',tier:'1'})");
waitLive.click('gameCopy');
const waitCopy = get(waitLive, 'gameLinkEl.value');
const waitRun = loadPage({ search: mapSearch(42) });
waitRun.elements.get('replayInput').value = waitCopy;
waitRun.click('replayLoad');
for (let i = 0; i < 800 && get(waitRun, 'careerActionReplay.active'); i++) waitRun.runFrames(1, 16);
assert.strictEqual(get(waitRun, 'careerActionReplay.active'), false, 'wait replay finishes');
assert.strictEqual(get(waitRun, 'game.clockSteps'), get(waitLive, 'game.clockSteps'));
assert.strictEqual(get(waitRun, 'game.career.ledger.purse'), get(waitLive, 'game.career.ledger.purse'));

/* Selected rival launches are retained for investigation and checked on replay. */
const rival = loadPage({ search: mapSearch(42) });
get(rival, 'setSlotType(0, PLAYER_BOT); selectSlot(1)');
rival.runFrames(250, 16);
rival.click('gameCopy');
const rivalCopy = get(rival, 'gameLinkEl.value');
const rivalRecord = rival.context.CareerActions.decode(rivalCopy);
assert(rivalRecord.flights.length > 0, 'selected rival has actual launches');
assert(rivalRecord.flights.every(flight => flight.slot === 1));
const rivalReplay = loadPage({ search: mapSearch(42) });
rivalReplay.elements.get('replayInput').value = rivalCopy;
rivalReplay.click('replayLoad');
for (let i = 0; i < 1000 && get(rivalReplay, 'careerActionReplay.active'); i++) rivalReplay.runFrames(1, 16);
assert.strictEqual(get(rivalReplay, 'activeSlotIndex()'), 1);
assert.match(rivalReplay.elements.get('careerMsg').textContent, /selected flights match/);

/* A differing observed trajectory is reported, not silently called verified. */
const altered = JSON.parse(JSON.stringify(rivalRecord));
altered.flights[0].speed += 1;
const diverged = loadPage({ search: mapSearch(42) });
diverged.elements.get('replayInput').value = diverged.context.CareerActions.encode(altered);
diverged.click('replayLoad');
for (let i = 0; i < 1000 && get(diverged, 'careerActionReplay.active'); i++) diverged.runFrames(1, 16);
assert.match(diverged.elements.get('careerMsg').textContent, /selected flights differ/);

/* Cancelled barrel queues reserve and release charge at their original steps. */
const cancelled = loadPage({ search: mapSearch(42) });
get(cancelled, 'aimBody = playerCareer().at; aimAngle = 1.1; aimSpeed = 50; armed = true; launchShot(); cancelTurret()');
assert.strictEqual(get(cancelled, "careerActionLog.map(x => x.type).join(',')"), 'launch,cancelLaunch');
cancelled.click('gameCopy');
const cancelledReplay = loadPage({ search: mapSearch(42) });
cancelledReplay.elements.get('replayInput').value = get(cancelled, 'gameLinkEl.value');
cancelledReplay.click('replayLoad');
cancelledReplay.runFrames(2, 16);
assert.strictEqual(get(cancelledReplay, 'careerActionReplay.skipped'), 0);
assert.strictEqual(get(cancelledReplay, 'slotTurrets[0].pending'), false);
assert.strictEqual(get(cancelledReplay, 'game.clockSteps'), 0);
