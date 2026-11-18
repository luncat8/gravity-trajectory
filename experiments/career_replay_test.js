/* Whole-career recordings, single-bot logs, and the Helper's visible call UI. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const LZString = require('../vendor/lz-string.min.js');
const { loadPage, mapSearch } = require('./dom_stub.js');

function get(env, expression) {
	return vm.runInContext(expression, env.context);
}

function decodeCopy(env) {
	const text = env.clipboardText;
	const payload = text.startsWith('gravity-career:') ? text.slice('gravity-career:'.length)
		: new URLSearchParams(new URL(text).hash.slice(1)).get('replay');
	const movie = env.context.CareerReplay.decode(payload);
	assert(movie, 'copy must contain a valid career recording');
	return movie;
}

function visitFrames(codec, movie) {
	let current = codec.copy(movie.start);
	const snapshots = [codec.copy(current)];
	for (const frame of movie.frames) {
		current = codec.apply(current, frame.d);
		snapshots.push(codec.copy(current));
	}
	return snapshots;
}

/* The import must not be nested in runBox, which is hidden in lab mode. */
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /id="botLogText"[^>]*><\/textarea>\s*<\/div>\s*<\/div>\s*<details id="replayImport"/);

function openCopy(text) {
	if (!text.startsWith('gravity-career:')) {
		return loadPage({ search: '?mode=lab&seed=42', hash: new URL(text).hash });
	}
	const env = loadPage({ search: '?mode=lab&seed=42' });
	assert.strictEqual(env.elements.get('runBox').hidden, true);
	assert.strictEqual(env.elements.get('replayImport').hidden, false, 'import is available in lab mode');
	env.elements.get('replayInput').value = text;
	env.click('replayLoad');
	assert.strictEqual(env.elements.get('replayLoadNote').textContent, 'replay opened');
	return env;
}

/* Even immediate actions while the shared clock is paused must not collapse. */
const live = loadPage({ search: mapSearch(42) });
const initialPurse = get(live, 'game.money.purse');
get(live, 'setCareerPaused(false); setCareerPaused(true)');
assert.strictEqual(get(live, 'careerPaused'), true);
get(live, 'setSource(MODE_PORTS); setSource(MODE_PLANETS)');
const actionData = { act: 'build', kind: 'battery', tier: '1' };
live.context.careerAct(actionData);
live.context.careerAct({ act: 'build', kind: 'panel', tier: '1' });
assert(get(live, 'game.money.purse') < initialPurse, 'same-step purchases succeed');
live.click('gameCopy');
const actionsText = get(live, 'gameLinkEl.value');
assert(actionsText.startsWith('GRAVITY_ACTIONS:'), 'gameCopy copies minimal player actions');
const actionsData = live.context.CareerActions.decode(actionsText);
assert(actionsData && actionsData.seed === 42 && Array.isArray(actionsData.actions), 'actions payload decodes');
live.click('careerSaveCopy');
let movie = decodeCopy(live);
let snapshots = visitFrames(live.context.CareerReplay, movie);
assert(snapshots.some(s => s.state.slotPaused[0]), 'pause belongs in the recording');
assert(snapshots.some(s => !s.state.slotPaused[0]), 'same-step resume is not lost');
assert(snapshots.some(s => s.source === 1), 'same-step source change is not lost');
assert.strictEqual(snapshots.at(-1).source, 0);
const spent = snapshots.map(s => s.state.careers[0].ledger.purse);
assert(spent.some(p => p < initialPurse && p > Math.min(...spent)), 'first purchase is not lost');
assert.strictEqual(Math.min(...spent), get(live, 'game.money.purse'));

/* Two immediate planet-count edits are both visible in the timeline. */
const universeEdits = loadPage({ search: mapSearch(42) });
const planetInput = universeEdits.elements.get('planetCountInput');
planetInput.value = '14';
universeEdits.fireElement(planetInput, 'change');
planetInput.value = '13';
universeEdits.fireElement(planetInput, 'change');
universeEdits.click('careerSaveCopy');
const universeStates = visitFrames(universeEdits.context.CareerReplay, decodeCopy(universeEdits));
assert(universeStates.some(s => s.universe === 14), 'expanded universe is recorded');
assert.strictEqual(universeStates.at(-1).universe, 13, 'subsequent shrink is recorded');

/* The trade event heap can grow beyond its initial capacity. */
const grownQueue = loadPage({ search: mapSearch(42) });
get(grownQueue, 'tradeSim.events.grow()');
grownQueue.click('careerSaveCopy');
const grownMovie = decodeCopy(grownQueue);
assert.strictEqual(visitFrames(grownQueue.context.CareerReplay, grownMovie).at(-1)
	.state.tradeEvents.time.d.length, 512);
const grownReplay = openCopy(grownQueue.clipboardText);
grownReplay.click('replaySkip');
assert.strictEqual(get(grownReplay, 'tradeSim.events.time.length'), 512);
assert.strictEqual(get(grownReplay, 'tradeSim.events.size'), get(grownQueue, 'tradeSim.events.size'));

/* Switch controllers, add/remove a player, and change live career settings. */
live.click('careerClock');
get(live, 'setSlotType(0, PLAYER_BOT)');
live.setValue('expWear', 0.75);
live.toggle('expHarvest');
live.runFrames(300, 16);
assert(get(live, 'game.shots.length > 0'), 'YOU bot launched');
assert(get(live, 'bot.rivals.some(r => r.shots.length > 0)'), 'rival launched in the shared world');
assert(get(live, 'cargoSim.status === STATUS_FLYING'), 'copy while in flight');
get(live, 'setPlayerCount(1); setPlayerCount(-1); setPlayerCount(1)');
live.runFrames(90, 16);
get(live, 'selectSlot(3)');
live.click('botCopy');
const lateRivalCopy = live.clipboardText;
assert.strictEqual(decodeCopy(live).watch, 3, 'copy rival follows the selected company');
const lateRival = openCopy(lateRivalCopy);
assert.strictEqual(get(lateRival, 'activeSlotIndex()'), 0, 'late rival has not joined yet');
lateRival.click('replaySkip');
assert.strictEqual(get(lateRival, 'activeSlotIndex()'), 3, 'follow the rival when it joins');
get(live, 'selectSlot(0); setSlotType(1, PLAYER_USER)');
get(live, 'setPlayerCount(-1)');
live.runFrames(2, 16);
live.click('careerSaveCopy');
movie = decodeCopy(live);
snapshots = visitFrames(live.context.CareerReplay, movie);
assert(snapshots.some(s => s.state.ships.length === 4), 'record an added company');
assert.strictEqual(snapshots.at(-1).state.ships.length, 3, 'record a removed company');
assert(snapshots.some(s => s.state.run.slots[0] === 'bot'), 'human to bot is recorded');
assert(snapshots.some(s => s.state.run.slots[1] === 'user'), 'bot to human is recorded');
assert.strictEqual(snapshots.at(-1).ws, 0.75);
assert.strictEqual(snapshots.at(-1).ht, true);
assert(snapshots.some(s => s.state.ships.some(ship => ship.status === 1)), 'flight state captured');
assert(snapshots.at(-1).state.run.shots.length > 0);
assert(snapshots.at(-1).state.rivals.some(r => r.shots.length > 0));
const text = live.clipboardText;
const watching = openCopy(text);
assert.strictEqual(get(watching, 'replay.career'), true);
assert.strictEqual(get(watching, 'careerRecording.index'), 0);
assert.strictEqual(watching.elements.get('botCopy').hidden, true, 'career shares use the compact replay or full save');
assert.match(watching.elements.get('shareHint').textContent, /human inputs/);
watching.click('replaySpeed');
assert.strictEqual(get(watching, 'REPLAY_SPEEDS[replay.speed]'), 4);
watching.runFrames(3, 16);
assert(get(watching, 'careerRecording.elapsed > 0'));
watching.click('replaySkip');
assert.strictEqual(get(watching, 'careerRecording.finished'), true);
assert.strictEqual(get(watching, 'JSON.stringify(careerRecording.current)'),
	get(live, 'JSON.stringify(careerRecording.previous)'), 'skip reaches the complete final state');
assert.strictEqual(get(watching, 'JSON.stringify(Array.from(planetBaseStrength))'),
	get(live, 'JSON.stringify(Array.from(planetBaseStrength))'), 'expanded planet gravity is restored');
assert.strictEqual(get(watching, 'JSON.stringify(Array.from(portPlanetStrength))'),
	get(live, 'JSON.stringify(Array.from(portPlanetStrength))'));
assert.strictEqual(get(watching, 'game.clockSteps'), get(live, 'game.clockSteps'));
assert.strictEqual(get(watching, 'game.money.purse'), get(live, 'game.money.purse'));
assert.strictEqual(get(watching, 'JSON.stringify(cargoSim.cargo)'), get(live, 'JSON.stringify(cargoSim.cargo)'));
assert.strictEqual(get(watching, 'JSON.stringify(bot.rivals.slice(0, bot.count).map(r => r.shots))'),
	get(live, 'JSON.stringify(bot.rivals.slice(0, bot.count).map(r => r.shots))'));
for (const key of ['clock', 'trade', 'tradeEvents', 'market', 'galaxy', 'careers', 'rivals', 'ships', 'run']) {
	assert.strictEqual(get(watching, 'JSON.stringify(careerRecordingSnapshot().state.' + key + ')'),
		get(live, 'JSON.stringify(careerRecording.previous.state.' + key + ')'), key + ' restores the live state');
}
assert.strictEqual(watching.elements.get('replayAgain').hidden, false);
get(watching, 'selectSlot(1)');
assert.strictEqual(get(watching, 'activeSlotIndex()'), 1, 'can inspect a different company');
assert.strictEqual(watching.elements.get('scoreRival1').tabIndex, 0, 'replay rows remain keyboard selectable');
assert.strictEqual(watching.elements.get('rivalBot1').disabled, true);
assert.strictEqual(watching.elements.get('playerCountUp').disabled, true);
assert.strictEqual(watching.elements.get('planetCountInput').disabled, true);
assert.strictEqual(watching.elements.get('careerWait').disabled, true);
assert.strictEqual(watching.elements.get('careerReplayHint').hidden, false);
watching.click('botCopy');
assert.strictEqual(decodeCopy(watching).watch, 1, 'a replay can be shared with a different focus');
watching.click('careerSaveCopy');
assert.strictEqual(JSON.stringify(decodeCopy(watching)), JSON.stringify(movie),
	'a forwarded replay preserves the entire decoded payload');
const frozen = get(watching, 'JSON.stringify(careerRecordingSnapshot().state)');
get(watching, `setSlotType(1, PLAYER_BOT); setPlayerCount(1); setCareerPaused(true); careerAct(${JSON.stringify(actionData)}); toggleCommercialRail(false)`);
assert.strictEqual(get(watching, 'JSON.stringify(careerRecordingSnapshot().state)'), frozen, 'playback rejects changes');
watching.click('replayAgain');
assert.strictEqual(get(watching, 'careerRecording.index'), 0);
assert.strictEqual(get(watching, 'careerRecording.finished'), false);

/* Outside career, copy rival still follows the selected rival's shot list. */
const tour = loadPage({ search: '?mode=tour&seed=42&bot=hard&rate=1' });
get(tour, `bot.rivals[0].shots.push(GravityGame.createShot(0, 1, 0,
	GravityGame.speedUnits(60), GravityGame.NO_ABORT));
	bot.rivals[1].shots.push(GravityGame.createShot(0, 2, 0,
	GravityGame.speedUnits(60), GravityGame.NO_ABORT));`);
for (const slot of [0, 1, 2]) {
	get(tour, 'selectSlot(' + slot + ')');
	tour.click('botCopy');
	const link = tour.context.GravityGame.decodeLink(new URL(tour.clipboardText).hash);
	assert.strictEqual(link.shots[0].origin, slot === 2 ? 2 : 1, 'copy follows ' + slot);
}

/* Preserve a manual launch, pause, and burn rather than only bot flights. */
const manual = loadPage({ search: mapSearch(42) });
const manualScene = manual.context.GravityScene;
const manualGame = manual.context.GravityGame;
const tech = manual.context.OrbitTech;
const pilot = manualScene.career;
pilot.ledger.purse = 30;
manualGame.installPart(pilot, tech.KIND_ENGINE, tech.ENGINES[1]);
manualGame.installPart(pilot, tech.KIND_TANK, tech.TANKS[2]);
pilot.ship.fuelKg = 90;
get(manual, 'careerRecordingCapture(true)');
manual.dragAim(pilot.hq, 0.65, Math.min(72, manualScene.speedCeiling(pilot.hq)));
manual.runFrames(2, 16);
manual.click('launch');
for (let i = 0; i < 900 && manualScene.sim.status !== manual.context.GravitySim.STATUS_FLYING; i++) {
	manual.runFrames(1, 16);
}
assert.strictEqual(manualScene.sim.status, manual.context.GravitySim.STATUS_FLYING);
manual.runFrames(4, 16);
manual.click('careerClock');
manual.dragBurn(-1.15, manualScene.sim.burnLimit() * 0.6);
const fuelBeforeBurn = pilot.ship.fuelKg;
manual.fireWindow('keydown', { code: 'Enter', key: 'Enter', target: { tagName: 'BODY' }, preventDefault() {} });
assert(pilot.ship.fuelKg < fuelBeforeBurn);
manual.click('careerSaveCopy');
const manualMovie = decodeCopy(manual);
const manualStates = visitFrames(manual.context.CareerReplay, manualMovie);
assert(manualStates.some(s => s.state.run.shots.length && s.state.run.shots[0].burns.length === 1),
	'manual burn is present in the timeline');
const manualReplay = openCopy(manual.clipboardText);
manualReplay.click('replaySkip');
assert.strictEqual(get(manualReplay, 'game.shots[0].burns.length'), 1);
assert.strictEqual(get(manualReplay, 'game.career.ship.fuelKg'), pilot.ship.fuelKg);
assert.strictEqual(get(manualReplay, 'JSON.stringify(cargoSim.cargo)'),
	get(manual, 'JSON.stringify(cargoSim.cargo)'));

/* Restoring a selected commercial rail and a ship lost in space. */
const special = loadPage({ search: mapSearch(42) });
special.context.careerAct({ act: 'sciAccept', kind: 'engine' });
assert.strictEqual(get(special, 'game.career.research'), 1);
assert.strictEqual(get(special, 'toggleCommercialRail(false)'), true);
special.click('careerSaveCopy');
let specialReplay = openCopy(special.clipboardText);
specialReplay.click('replaySkip');
assert.strictEqual(get(specialReplay, 'game.career.commercialPlanet'), get(special, 'game.career.at'));
assert.strictEqual(get(specialReplay, 'game.career.research'), 1, 'research is restored');
get(special, 'game.career.at = -1; game.career.stranded = true; game.career.flying = false; ' +
	'cargoSim.status = STATUS_ENDED; cargoSim.landedBody = -1');
special.click('careerSaveCopy');
specialReplay = openCopy(special.clipboardText);
specialReplay.click('replaySkip');
assert.strictEqual(get(specialReplay, 'replay.verdict'), '');
assert.strictEqual(get(specialReplay, 'game.career.at'), -1);
assert.strictEqual(get(specialReplay, 'game.career.stranded'), true);

/* A large copy is text rather than an unopenable URL, and the import accepts it. */
const longRun = loadPage({ search: mapSearch(42) });
get(longRun, 'setSlotType(0, PLAYER_BOT); playIndex = 7');
for (let i = 0; i < 5; i++) {
	longRun.runFrames(100, 16);
	longRun.click('careerSaveCopy');
	if (longRun.clipboardText.startsWith('gravity-career:')) break;
}
assert(longRun.clipboardText.startsWith('gravity-career:'), 'long recordings use the text fallback');
const longMovie = decodeCopy(longRun);
const longWatch = openCopy(longRun.clipboardText);
longWatch.click('replaySkip');
assert.strictEqual(get(longWatch, 'game.clockSteps'), get(longRun, 'game.clockSteps'));
assert.strictEqual(get(longWatch, 'careerRecording.index'), longMovie.frames.length);

/* file:// without clipboard permission still exposes a copyable recording. */
const fallback = loadPage({ search: mapSearch(42), clipboard: false });
fallback.click('careerSaveCopy');
assert.strictEqual(fallback.elements.get('gameLink').hidden, false);
const fallbackReplay = openCopy(fallback.elements.get('gameLink').value);
assert.strictEqual(get(fallbackReplay, 'replay.career'), true);
const noHistory = loadPage({ search: '?mode=lab&seed=42' });
noHistory.context.history.replaceState = () => { throw new Error('history not permitted'); };
noHistory.elements.get('replayInput').value = fallback.elements.get('gameLink').value;
noHistory.click('replayLoad');
assert.strictEqual(noHistory.elements.get('replayLoadNote').textContent, 'replay opened');
assert.strictEqual(get(noHistory, 'replay.career'), true, 'file viewers without history still import');

/* Reject malformed payloads without resetting the current career. */
const codec = live.context.CareerReplay;
const target = loadPage({ search: mapSearch(7) });
const seed = get(target, 'game.seed');
const initialSteps = get(target, 'game.clockSteps');
for (const bad of ['', 'not a replay', 'gravity-career:garbage', '#game=1&replay=bad']) {
	target.elements.get('replayInput').value = bad;
	target.click('replayLoad');
	assert.strictEqual(target.elements.get('replayLoadNote').textContent, 'not a valid replay');
	assert.strictEqual(get(target, 'game.seed'), seed);
	assert.strictEqual(get(target, 'game.clockSteps'), initialSteps);
}
const corrupted = JSON.parse(JSON.stringify(movie));
corrupted.start.state.mask = '';
assert.strictEqual(codec.valid(corrupted), false);
assert.strictEqual(codec.decode(LZString.compressToEncodedURIComponent(JSON.stringify(corrupted))), null);
const badPatch = JSON.parse(JSON.stringify(movie));
badPatch.frames.push({ t: 1e9, d: [1, [['__proto__', [0, {}]]]] });
assert.strictEqual(codec.valid(badPatch), false, 'reject unsafe patch paths');
const badCareer = JSON.parse(JSON.stringify(movie));
badCareer.start.state.careers[0].pads = null;
assert.strictEqual(codec.valid(badCareer), false, 'reject incomplete career state');
target.elements.get('replayInput').value = 'gravity-career:' + codec.encode(badCareer);
target.click('replayLoad');
assert.strictEqual(target.elements.get('replayLoadNote').textContent, 'not a valid replay');
assert.strictEqual(get(target, 'game.seed'), seed, 'invalid state does not replace a live run');
const badType = JSON.parse(JSON.stringify(movie));
badType.start.state.tradeEvents.time.a = 'NotATypedArray';
assert.strictEqual(codec.valid(badType), false, 'reject unknown packed array types');
const badQueue = JSON.parse(JSON.stringify(movie));
badQueue.start.state.tradeEvents.ref.d.pop();
assert.strictEqual(codec.valid(badQueue), false, 'reject mismatched event heap arrays');
for (const field of ['trade', 'tradeEvents', 'market', 'galaxy']) {
	const incomplete = JSON.parse(JSON.stringify(movie));
	incomplete.start.state[field] = {};
	target.elements.get('replayInput').value = 'gravity-career:' + codec.encode(incomplete);
	target.click('replayLoad');
	assert.strictEqual(target.elements.get('replayLoadNote').textContent, 'not a valid replay', field);
	assert.strictEqual(get(target, 'game.seed'), seed, field + ' must not replace the live game');
}

/* Checked slots, including YOU, define the log; retain history for a quiet bot. */
const logs = loadPage({ search: mapSearch(42) });
get(logs, `setSlotType(0, PLAYER_BOT);
	const actors = [game.career, bot.rivals[0].career, bot.rivals[1].career];
	const actorSims = [cargoSim, bot.rivals[0].sim, bot.rivals[1].sim];
	for (let i = 0; i < actors.length; i++) {
		const career = actors[i];
		career.ledger.purse = 100; career.ship.condition = 0;
		if (!bot.careerRepair(career, 0)) throw new Error('repair fixture');
		bot.careerBetweenFlights(career, actorSims[i], 0);
		const planet = Array.from(planetMask).findIndex((active, p) => active &&
			p !== career.capitalPlanet && p !== career.arfPlanet && p !== career.hq &&
			GravityGame.padOwner(career, p) !== career.index);
		GravityGame.placeShip(career, actorSims[i], planet);
		career.bribeProne = true;
		career.market.visitPay[planet] = 100;
		career.market.bribeVisitStep[planet] = -0x7fffffff;
		career.market.corruption[planet] = 0;
		if (!bot.careerBribe(career, actorSims[i], 0)) throw new Error('bribe fixture');
	}`);
for (const [index, name] of [[get(logs, 'GravityBot.PLAYER_INDEX'), 'YOU'], [0, 'R1'], [1, 'R2']]) {
	const lines = get(logs, 'bot.traceByActor[' + index + '].map(entry => entry.line).join("\\n")');
	for (const event of ['repair', 'gear', 'bribe']) {
		assert.match(lines, new RegExp(name + ' ' + event), name + ' owns its ' + event + ' event');
	}
}
get(logs, `bot.traceAdd(GravityBot.PLAYER_INDEX, 'YOU-OLD', '', 0);
	bot.traceAdd(0, 'R1-OLD', '', 0); bot.traceAdd(1, 'R2-OLD', '', 0);
	for (let i = 0; i < 300; i++) bot.traceAdd(0, 'R1-NOISE-' + i, '', 0);`);
get(logs, 'setSlotType(0, PLAYER_USER); setSlotType(1, PLAYER_USER)');
logs.click('botLog');
assert.match(logs.clipboardText, /checked bots: R2/);
assert.match(logs.clipboardText, /R2-OLD/);
for (const event of ['repair', 'gear', 'bribe']) {
	assert.match(logs.clipboardText, new RegExp('R2 ' + event));
	assert.doesNotMatch(logs.clipboardText, new RegExp('(?:YOU|R1) ' + event));
}
assert.doesNotMatch(logs.clipboardText, /YOU-OLD|R1-NOISE|R1-OLD/);
get(logs, 'setSlotType(0, PLAYER_BOT)');
logs.click('botLog');
assert.match(logs.clipboardText, /checked bots: YOU, R2/);
assert.match(logs.clipboardText, /YOU-OLD/);
assert.match(logs.clipboardText, /R2-OLD/);
assert.doesNotMatch(logs.clipboardText, /R1-NOISE|R1-OLD/);

/* A truly blocked shot produces a visible call and opens the relevant answer. */
const calls = loadPage({ search: mapSearch(42) });
assert.match(calls.elements.get('commsButton').title, /radio assistant/i);
get(calls, `playerCareer().ship.condition = 0; armed = false; commsTick()`);
assert.strictEqual(get(calls, 'commsState.callReason.id'), 'worn');
assert.strictEqual(calls.elements.get('commsCall').hidden, false);
assert.match(calls.elements.get('commsCallReason').textContent, /worn/i);
calls.click('commsAnswerCall');
assert.strictEqual(get(calls, 'commsState.open'), true);
assert.match(calls.elements.get('commsAnswer').textContent, /repair/i);
assert.strictEqual(calls.elements.get('commsCall').hidden, true);

/* Landing without your own pad with money for the commercial rail is normal
 * travel, not a call; with an empty purse it is a stuck gate and H calls. */
const stranded = loadPage({ search: mapSearch(42) });
get(stranded, `(() => {
	const career = playerCareer();
	const sim = activeCareerSim();
	let planet = -1;
	for (let i = 0; i < planetMask.length; i++) {
		if (planetMask[i] && i !== career.hq && i !== career.capitalPlanet &&
			i !== career.arfPlanet && career.pads[i].catapult === null) { planet = i; break; }
	}
	GravityGame.placeShip(career, sim, planet);
	career.stranded = true;
	career.ledger.purse = 50;
	GravityGame.setShipCondition(career, 1);
	armed = false;
	commsTick();
})()`);
assert.strictEqual(get(stranded, 'commsState.callKey'), '',
	'an off-network landing you can afford is not a situation worth a call');
assert.strictEqual(stranded.elements.get('commsCall').hidden, true);
get(stranded, `(() => {
	const career = playerCareer();
	career.ledger.purse = 0.01;
	game.clockSteps += Math.ceil(1 / GravitySim.DT);
	commsInvalidate();
	commsTick();
})()`);
assert.ok(get(stranded, 'commsState.callKey').startsWith('fee|P'),
	'an unaffordable way off the planet raises the radio call');
assert.strictEqual(stranded.elements.get('commsCall').hidden, false);
stranded.click('commsAnswerCall');
assert.match(stranded.elements.get('commsAnswer').textContent, /purse/i,
	'the open answer names the shortfall');

console.log('CAREER REPLAY OK · shared timeline, long import, selected bot logs, Helper calls');
