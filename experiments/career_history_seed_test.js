/* Reported seed: at step 35922 YOU's five flights used to leave only one plan. */
'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const ENDPOINT = 35922;
const OPENING = '?rule=career&seed=671241&bot=normal&players=3';
const get = (env, code) => vm.runInContext(code, env.context);

/* Exercise the game's frame batching without rendering thousands of frames. */
function runToEndpoint(env, slices) {
	const advance = get(env, `(limit) => {
		playAcc = 0;
		const steps = Math.min(limit, ${ENDPOINT} - game.clockSteps);
		stepGame(performance.now(), (steps + 0.25) * DT / playScale());
		return game.clockSteps;
	}`);
	let step = get(env, 'game.clockSteps');
	for (let i = 0; step < ENDPOINT; i++) {
		const after = advance(slices[i % slices.length]);
		assert(after > step, 'clock stalled at ' + step);
		step = after;
	}
	assert.equal(step, ENDPOINT);
}

for (const handover of [false, true]) {
	const live = loadPage({ search: OPENING + (handover ? '' : '&player=bot') });
	if (handover) {
		get(live, 'aimBody = playerCareer().at; aimAngle = 0.3; aimSpeed = 50; armed = true; launchShot()');
		const landed = 'game.career.flights === 1 && cargoSim.status !== STATUS_FLYING';
		for (let i = 0; i < 1800 && !get(live, landed); i++) live.runFrames(1, 16);
		assert(get(live, landed));
		live.toggle('playerBot');
	}
	runToEndpoint(live, [8, 15, 11]);
	/* Choose only YOU at copy time, after the rivals have been active. */
	get(live, 'setSlotType(1, PLAYER_USER); setSlotType(2, PLAYER_USER)');
	live.click('botLog');
	const log = live.clipboardText;
	assert.match(log, /seed 671241 .*35922/);
	assert.match(log, /checked players: YOU\n/);
	assert.doesNotMatch(log, /\] R[12] /);
	const flights = get(live, 'game.career.flights');
	assert(flights > 1);
	assert.equal((log.match(/\] YOU fire /g) || []).length, flights);
	assert.match(log, /YOU plan .*score.*fee/);
	if (handover) {
		assert.match(log, /YOU start · HQ P\d+ · human[\s\S]*YOU launch [\s\S]*YOU fire [\s\S]*YOU land [\s\S]*YOU controller · player=bot/);
	} else {
		assert(flights >= 5);
		assert.match(log, /YOU start · HQ P\d+ · bot[\s\S]*YOU ready · shop done[\s\S]*YOU queue [\s\S]*YOU gear · P\d+ EMC-1/);
	}

	live.click('gameCopy');
	const text = live.clipboardText;
	const data = live.context.CareerActions.decode(text);
	assert.equal(data.steps, ENDPOINT);
	assert.equal(data.events.filter(e => e[2] === 'fire').length, flights);
	assert.equal(data.events.filter(e => e[2] === 'land').length,
		flights - Number(get(live, 'cargoSim.status === STATUS_FLYING')));

	const replay = loadPage({ search: '?mode=lab&seed=7' });
	replay.elements.get('replayInput').value = text;
	replay.click('replayLoad');
	assert.equal(replay.elements.get('replayLoadNote').textContent, 'replay opened');
	runToEndpoint(replay, [33, 240, 77]);
	assert.match(replay.elements.get('careerMsg').textContent, /history matches/);
	assert.equal(get(replay, 'tradeSim.t'), get(live, 'tradeSim.t'));
	for (const key of ['run.shots', 'careers', 'market', 'rivals']) {
		const state = 'JSON.stringify(careerRecordingSnapshot().state.' + key + ')';
		assert.equal(get(replay, state), get(live, state), key);
	}
	console.log('CAREER HISTORY OK · 671241 step ' + ENDPOINT + ' · ' + (handover ? 'human to bot' : 'bot opening') +
		' · ' + flights + ' flights · ' + data.events.length + ' events matched · ' + text.length + ' chars');
}

/* Genuine dead end (heavy gravity + weak rail): YOU logs `no shot … retry` and replays cleanly. */
const stuck = loadPage({ search: mapSearch(1) + '&you=bot' });
get(stuck, 'setExperimentScales(9, 0.25, false, 1)');
for (let i = 0; i < 20; i++) {
	get(stuck, 'playAcc = 0; stepGame(performance.now(), (60 + 0.25) * DT / playScale())');
}
get(stuck, 'setSlotType(1, PLAYER_USER); setSlotType(2, PLAYER_USER)');
stuck.click('botLog');
assert.match(stuck.clipboardText, /YOU no shot .*retry/);
stuck.click('gameCopy');
const stuckText = stuck.clipboardText;
const stuckData = stuck.context.CareerActions.decode(stuckText);
assert(stuckData.events.some(e => e[1] === 0 && e[2] === 'no shot'), 'compact replay records YOU no shot');
const stuckReplay = loadPage({ search: '?mode=lab&seed=7' });
stuckReplay.elements.get('replayInput').value = stuckText;
stuckReplay.click('replayLoad');
assert.equal(stuckReplay.elements.get('replayLoadNote').textContent, 'replay opened');
while (get(stuckReplay, 'game.clockSteps < ' + stuckData.steps + ' && careerActionReplay.active')) {
	get(stuckReplay, 'playAcc = 0; stepGame(performance.now(), (80 + 0.25) * DT / playScale())');
}
assert.match(stuckReplay.elements.get('careerMsg').textContent, /history matches/);
console.log('CAREER HISTORY NO-SHOT OK · YOU no shot logged and replayed');
