/* Sparse careers re-fly the opening and inputs, and verify the selected history. */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

function get(env, expression) {
	return vm.runInContext(expression, env.context);
}

function capture(env) {
	env.click('gameCopy');
	const text = env.clipboardText;
	assert(text.startsWith('GRAVITY_ACTIONS:'), 'primary copy is the sparse recording');
	assert(!/"state"|"careers"|"pads"|"market"|"frames"/.test(text), 'no world snapshots');
	assert.strictEqual(env.elements.get('gameLink').hidden, true, 'successful copy does not show text');
	return { text, data: env.context.CareerActions.decode(text) };
}

function open(text, expectedNote = 'replay opened') {
	const env = loadPage({ search: '?mode=lab&seed=7' });
	env.elements.get('replayInput').value = text;
	env.click('replayLoad');
	assert.strictEqual(env.elements.get('replayLoadNote').textContent, expectedNote);
	return env;
}

function until(env, condition, ms = 16, limit = 1500) {
	for (let i = 0; i < limit && !get(env, condition); i++) env.runFrames(1, ms);
	assert(get(env, condition), condition);
}

function verify(text, live, slot, ms = 35) {
	const env = open(text);
	assert.strictEqual(get(env, 'game.clockSteps'), 0);
	assert.strictEqual(get(env, 'activeSlotIndex()'), slot < get(env, 'slotCount()') ? slot : 0);
	assert.strictEqual(env.elements.get('careerReplayHint').hidden, false);
	until(env, '!careerActionReplay.active', ms);
	assert.strictEqual(get(env, 'activeSlotIndex()'), slot);
	assert.strictEqual(get(env, 'careerActionReplay.skipped'), 0, env.elements.get('careerMsg').textContent);
	assert.match(env.elements.get('careerMsg').textContent, /history matches/);
	assert.strictEqual(get(env, 'game.clockSteps'), get(live, 'game.clockSteps'));
	assert.strictEqual(get(env, 'careerPaused'), true);
	assert.strictEqual(get(env, 'tradeSim.t'), get(live, 'tradeSim.t'), 'same sky, independent of playback cadence');
	for (const field of ['run.shots', 'careers', 'market', 'mask', 'field']) {
		const expression = 'JSON.stringify(careerRecordingSnapshot().state.' + field + ')';
		assert.strictEqual(get(env, expression), get(live, expression), field + ' must match');
	}
	assert.strictEqual(get(env, 'JSON.stringify(cargoSim.cargo)'), get(live, 'JSON.stringify(cargoSim.cargo)'));
	return env;
}

function queue(env, angle, speed) {
	get(env, `aimBody = playerCareer().at; aimAngle = ${angle}; aimSpeed = ${speed}; armed = true; launchShot()`);
}

/* The click and the actual fire are different events, with no trajectory dump. */
const live = loadPage({ search: mapSearch(42) });
queue(live, 1.1, 50);
until(live, 'cargoSim.status === STATUS_FLYING');
const first = capture(live);
assert(first.text.length < 1200, 'a quick recording stays pasteable: ' + first.text.length);
assert.strictEqual(first.data.seed, 42);
assert.strictEqual(first.data.actions[0].type, 'launch');
const actualFire = first.data.actions.find(a => a.type === 'fireQueued');
assert(actualFire, 'actual firing is recorded');
assert.strictEqual(first.data.events[0][2], 'fire');
assert(actualFire.step > first.data.actions[0].step, 'barrel delayed the real launch');
verify(first.text, live, 0);

/* A real stranded landing and evacuation keep their exact result at another pace. */
until(live, 'game.career.flights === 1 && cargoSim.status !== STATUS_FLYING');
assert(get(live, 'game.career.stranded'));
assert(get(live, "playIndex = PLAY_SPEEDS.indexOf(1); careerAct({act:'evac'})"));
until(live, '!game.career.evacuating', 27);
assert.strictEqual(get(live, 'game.career.at'), get(live, 'game.career.hq'));
const evacuated = capture(live);
assert(evacuated.data.actions.some(a => a.act === 'evac' && a.steps === 1440));
verify(evacuated.text, live, 0, 43);

/* The human's purchases, saved aim and first flight remain after the handover.
 * Copied decisions are observations from the real run, not new predictions. */
const handover = loadPage({ search: mapSearch(42) });
get(handover, `careerAct({act:'build',kind:'battery',tier:1});
	careerAct({act:'build',kind:'battery',tier:4}); // refused
	careerAct({act:'build',kind:'panel',tier:1});
	careerAct({act:'careerTab',tab:'shots'});`);
const home = get(handover, 'game.career.hq');
handover.dragAim(home, 0.3, 60);
handover.runFrames(3, 16);
queue(handover, 0.3, 50);
until(handover, 'game.career.flights === 1 && cargoSim.status !== STATUS_FLYING');
get(handover, "careerAct({act:'repair'}); setSlotType(1, PLAYER_USER); setSlotType(2, PLAYER_USER); setSlotType(0, PLAYER_BOT)");
const handoverStep = get(handover, 'game.clockSteps');
assert(handoverStep > 0);
get(handover, 'pauseOnLanding = false; setCareerPaused(false, 1); setCareerPaused(false, 2); playIndex = PLAY_MAX_INDEX');
until(handover, `careerHistory.some(x => x[1] === 0 && x[2] === 'fire' && x[0] > ${handoverStep})`, 28);
const record = capture(handover);
assert.strictEqual(record.data.players[0], 'user', 'original controller, not current');
assert.deepStrictEqual(Array.from(record.data.actions.filter(a => a.act === 'build'), a => a.kind), ['battery', 'panel']);
assert(record.data.events.some(e => e[1] === 0 && e[2] === 'land' && e[0] === handoverStep));
assert(record.data.events.some(e => e[2] === 'plan' && /score.*fee/.test(e[3])));
assert(record.data.events.some(e => e[2] === 'queue' && e[3].includes('barrel in')));
assert(record.data.events.every(e => e[1] === 0), 'only the selected row gets detailed observations');
handover.click('botLog');
const log = handover.clipboardText;
assert.match(log, /checked players: YOU/);
assert.match(log, /\[0 .*\] YOU start · HQ P\d+ · human/);
assert.match(log, /YOU build · kind=battery/);
assert.match(log, /YOU launch.*\n.*YOU fire/);
assert.match(log, /YOU land .*[\s\S]*YOU controller · player=bot[\s\S]*YOU plan/);
assert.doesNotMatch(log, /\] R[12] /);
assert.strictEqual(handover.elements.get('gameLink').hidden, true);
verify(record.text, handover, 0, 87);

/* A different player can fly by hand without disappearing from the replay
 * when another row is selected. This also checks moving gravity at a different FPS. */
const crews = loadPage({ search: mapSearch(7) });
get(crews, 'setSource(MODE_PORTS); setSlotType(1, PLAYER_USER); selectSlot(1); setCareerPaused(false, 0)');
queue(crews, 0.4, 58);
until(crews, 'bot.rivals[0].shots.length > 0');
crews.runFrames(60, 16);
get(crews, 'selectSlot(0)');
const shared = capture(crews);
assert(shared.data.actions.some(a => a.slot === 1 && a.type === 'launch'));
assert(shared.data.events.every(e => e[1] === 0));
verify(shared.text, crews, 0, 62);
get(crews, 'selectSlot(1)');
const rival = capture(crews);
assert(rival.data.events.some(e => e[1] === 1 && e[2] === 'fire'));
verify(rival.text, crews, 1, 27);

/* A mid-flight burn must be applied at the same world and flight step. */
const impulse = loadPage({ search: mapSearch(42) + '&cheat=communism' });
get(impulse, `careerAct({act:'part',kind:'engine',tier:1});
	careerAct({act:'part',kind:'tank',tier:2}); careerAct({act:'buyFuel'})`);
assert(get(impulse, 'flightRefuel()'));
queue(impulse, 1.1, 50);
until(impulse, 'cargoSim.status === STATUS_FLYING');
impulse.runFrames(6, 16);
assert(get(impulse, 'burnArmed = true; burnAngle = 1.2; burnDv = cargoSim.burnLimit() * 0.3; executeBurn()'));
impulse.runFrames(17, 16);
const burned = capture(impulse);
assert(burned.data.actions.some(a => a.type === 'refuel'));
const burn = burned.data.events.find(e => e[2] === 'burn');
assert(burn && burn[3].includes('manual') && burn[4] > 0);
verify(burned.text, impulse, 0, 72);

/* An aligned queue may wait behind another player's hold. When the hold is
 * released at that exact step, refits before and after the fire keep their order. */
const held = loadPage({ search: mapSearch(42) });
get(held, `setSlotType(1, PLAYER_USER);
	aimBody = playerCareer().at; aimAngle = GravityGame.turretAngle(game.galaxy, aimBody, 0);
	aimSpeed = 50; armed = true; launchShot();
	careerAct({act:'sciAccept'});`);
assert.strictEqual(get(held, 'careerPaused'), true);
assert.strictEqual(get(held, 'slotTurrets[0].fireAt'), 0);
get(held, 'setCareerPaused(false, 1); stepGame(performance.now(), 0)');
assert.strictEqual(get(held, 'game.shots.length'), 1);
assert.strictEqual(get(held, 'game.clockSteps'), 0);
verify(capture(held).text, held, 0);

/* An eased wait advances the same world when the real frame durations change. */
const waiting = loadPage({ search: mapSearch(42) });
get(waiting, "careerAct({act:'wait'})");
until(waiting, '!careerWaitBusy()', 16);
get(waiting, "careerAct({act:'build',kind:'battery',tier:1}); selectSlot(1)");
const waitCopy = capture(waiting);
assert(waitCopy.data.events.some(e => e[2] === 'fire'), 'rivals can launch during the wait');
verify(waitCopy.text, waiting, 1, 68);

/* Shared edits include a non-default skill, settings, the actual changed
 * mask and the new company's chosen home, not a planner to run again. */
const expanded = loadPage({ search: mapSearch(42), randomSeed: 1 });
get(expanded, 'setCareerPaused(false)');
expanded.runFrames(36, 16);
expanded.choose('botHard');
expanded.setValue('expGravity', 1.01);
expanded.toggle('expHarvest');
const planetInput = expanded.elements.get('planetCountInput');
planetInput.value = '12';
expanded.fireElement(planetInput, 'change');
assert(get(expanded, 'setPlayerCount(1)'));
get(expanded, 'selectSlot(3)');
expanded.runFrames(110, 16);
const expansion = capture(expanded);
assert(expansion.data.actions.some(a => a.type === 'universe' && a.step > 0));
assert.strictEqual(expansion.data.actions.find(a => a.type === 'playerCount').planet, get(expanded, 'slotCareer(3).hq'));
assert(expansion.data.events.some(e => e[2] === 'start'));
verify(expansion.text, expanded, 3);

/* Report divergence instead of calling a mismatched history verified. */
const wrong = JSON.parse(JSON.stringify(record.data));
const changed = wrong.events.find(e => e[2] === 'fire');
changed[6] += 1;
const diverged = open(handover.context.CareerActions.encode(wrong));
until(diverged, '!careerActionReplay.active', 80);
assert.match(diverged.elements.get('careerMsg').textContent, new RegExp('history differs at step ' + changed[0]));
wrong.events[0][1] = 1;
assert.strictEqual(get(open(handover.context.CareerActions.encode(wrong), 'not a valid replay'), 'game.on'), false);

/* Cancelling a barrel queue is a shared mutation even when zero time passed. */
const cancelled = loadPage({ search: mapSearch(42) });
queue(cancelled, 1.1, 50);
get(cancelled, 'cancelTurret()');
const cancelCopy = capture(cancelled);
assert.strictEqual(cancelCopy.data.actions.map(x => x.type).join(','), 'launch,cancelLaunch');
assert(cancelCopy.data.events.length === 0);
const cancelReplay = verify(cancelCopy.text, cancelled, 0);
assert.strictEqual(get(cancelReplay, 'slotTurrets[0].pending'), false);
assert.strictEqual(get(cancelReplay, 'game.clockSteps'), 0);

console.log('CAREER ACTIONS OK · ' + first.text.length + ' chars for a first launch, ' + record.text.length +
	' chars for the handover · exact steps, human and bot history, shared inputs and waits');
