/* Seed 999064: an owned rail can fire even though both departures returned to P8. */
'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadPage } = require('./dom_stub.js');

/* The reported replay without its unused book traces. It was recorded under
 * the 0.7.42 `+3.5` draw; `gravity` pins that field (P4 and P10 are heavier
 * under the 0.7.43 stretch, which sends the first shot home). */
const data = {
	v: 3, seed: 999064, rate: 0.5, bot: 'normal', players: ['user', 'bot', 'bot'],
	mask: '1'.repeat(13) + '0'.repeat(35), seats: [1, 3, 12], targetPay: 1.4672744835753886,
	gravity: [1, 1, 1, 1, 3.35, 1.1, 2.7, 0.95, 1.2, 0.4, 3.15, 1.25, 1],
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
		{ step: 11145, slot: 0, type: 'act', act: 'part', kind: 'tank', tier: 0 }
	],
	events: [
		[11, 0, 'fire', 'P1 · v53.7 · purse 6.00', 1, 5.692968222703228, 53.74609375],
		[3167, 0, 'land', 'P8 · purse 7.48 · 1 pads', 8, 1, 3156],
		[3167, 0, 'ready', 'shop done · next try in 8.0 s'],
		[3756, 0, 'fire', 'P8 · v65.0 · purse 0.90', 8, 2.136673450488476, 64.9814453125],
		[8629, 0, 'land', 'P8 · purse 1.73 · 2 pads', 8, 1, 4873],
		[8717, 0, 'fire', 'P8 · v61.6 · purse 1.12', 8, 1.6832083564071412, 61.6279296875],
		[11145, 0, 'land', 'P8 · purse 1.51 · 2 pads', 8, 1, 2428]
	]
};

const env = loadPage({ search: '?mode=lab&seed=7' });
const run = code => vm.runInContext(code, env.context);
const el = id => env.elements.get(id);
const Game = env.context.GravityGame;
const Sim = env.context.GravitySim;
/* This file exercises the tow/evac mechanics, not roster fairness: the
 * replay's pinned field fails the 0.7.47 composition law, and H's WS3
 * roster call would outrank the tow call under test. Pin the roster report
 * fair; roster fairness is covered by the frozen facts and the fairness runs. */
run('rosterFairnessReport = function () { return { ok: true, planets: planetCount, players: playerCountShown() }; }');
el('replayInput').value = env.context.CareerActions.encode(data);
env.click('replayLoad');
assert.equal(el('replayLoadNote').textContent, 'replay opened');
const advance = run(`end => {
	while (game.clockSteps < end && careerActionReplay.active) {
		const previous = game.clockSteps;
		const steps = Math.min(160, end - previous);
		playAcc = 0;
		stepGame(performance.now(), (steps + 0.25) * DT / playScale());
		if (previous === game.clockSteps) throw new Error('clock stalled at ' + previous);
	}
}`);
const { career, sim } = env.context.GravityScene;
advance(8629);
run('commsTick()');
assert.equal(Game.returnLandingVisit(career).count, 1);
assert.equal(env.context.CommsCopy.returnTowVisit(career), null, 'one return is not enough to call');
assert(el('commsBadge').hidden && el('launchMenuBtn').hidden, 'playback is not interactive');
advance(data.steps);
run('commsTick()');
assert.match(el('careerMsg').textContent, /step 11145 · YOU history matches \(7 events\)/);
assert.equal(career.at, 8);
assert.equal(career.stranded, false);
assert(Game.careerCanFire(career, sim, 8, Sim.SPEED_MIN), 'the standing rail can still launch');
const quote = 'evacuate · 1.51 · ' + Math.round(Game.evacuationSeconds(career)) + ' s';
assert.equal(el('launch').textContent, quote, 'tow is primary while no other launch action is ready');
assert.equal(el('launch').disabled, false);
assert.equal(el('launchMenuBtn').hidden, false);
env.click('launchMenuBtn');
assert.equal(el('launchMenu').hidden, false);
assert.equal(el('launchEvac').textContent, quote);
assert.equal(el('launchEvac').disabled, false);

/* A low purse does not take away a usable launch or the menu tow. */
run('armed = true; aimBody = 8; aimSpeed = SPEED_MIN; updateLiveHud()');
assert.equal(el('launchOnly').disabled, false);
assert.notEqual(el('launch').textContent, quote);
assert.equal(el('launchEvac').textContent, quote);
run('cancelAim(); updateLiveHud()');
assert.equal(el('launch').textContent, quote);

const evacSec = Math.round(Game.evacuationSeconds(career));
assert.match(el('commsCallReason').textContent, new RegExp('back to P8.*tow to HQ\\? 1\\.51 · ' + evacSec + ' s'));
env.click('commsAnswerCall');
assert.match(el('commsAnswer').textContent, new RegExp('HQ P1 for 1\\.51; it takes ' + evacSec + ' s'));
assert.match(el('commsCtas').innerHTML, new RegExp('data-comms-act="evac">evacuate · 1\\.51 · ' + evacSec + ' s'));
const purse = career.ledger.purse;
career.ledger.purse = 0;
run('commsInvalidate(); commsTick(); updateLiveHud()');
const freeSec = Game.CAREER.evacFreeSeconds;
assert.match(el('commsCtas').innerHTML, new RegExp('data-comms-act="evac">evacuate · free · ' + freeSec + ' s'));
assert.equal(el('launch').textContent, 'evacuate · free · ' + freeSec + ' s');
career.ledger.purse = purse;

env.click('commsClose');
run('selectSlot(1); commsTick(); selectSlot(0); commsTick()');
assert(el('commsBadge').hidden, 'answering H is enough for this visit, even after switching rows');
env.click('commsButton');
env.click('careerClock'); /* continue from the halted replay endpoint */
const tripSteps = Sim.stepsForGameSeconds(Game.evacuationSeconds(career));
const tripStart = run('game.clockSteps');
const fromX = sim.planetX[career.at];
const fromY = sim.planetY[career.at];
env.fireElement(el('commsCtas'), 'click', { target: { dataset: { commsAct: 'evac' } } });
assert.equal(career.ledger.purse, 0, 'partial fare is paid when the ride starts');
assert.equal(career.evacuationSpent, purse);
assert.equal(career.evacUntilStep - tripStart, tripSteps, 'duration is game steps, independent of playback pace');
assert.equal(career.at, -1, 'the ship is in transit, not at either endpoint');
assert(career.evacuating);
assert.equal(sim.evacuationTrip, career, 'the render layer receives the live trip');
assert.match(el('launch').textContent, /^evacuating/);
assert(el('launch').disabled && el('launchMenu').hidden);
assert.equal(run("commsRunAction('evac')"), false, 'a second tow cannot be purchased mid-trip');
const midpoint = tripStart + Math.floor(tripSteps / 2);
run(`game.clockSteps = ${midpoint}; GravityGame.advanceEvacuation(game.career, cargoSim, game.clockSteps)`);
assert(sim.cargo.x > Math.min(fromX, sim.planetX[career.hq]) &&
	sim.cargo.x < Math.max(fromX, sim.planetX[career.hq]), 'ship position interpolates along the route');
assert.notEqual(sim.cargo.y, fromY, 'movement is visible in both world coordinates');
run('game.clockSteps = game.career.evacUntilStep - 1; advanceCareerOneStep(); commsTick()');
assert.equal(career.at, career.hq, 'arrival occurs on the final world-clock step');
assert(!career.evacuating);
assert.equal(career.evacuationSpent, purse, 'the tow bills the quoted cash, not the full fare');
assert(career.ledger.purse >= 0);
assert.equal(career.evacuations, 1);
assert.equal(Game.returnLandingVisit(career), null);
assert(el('launchEvac').hidden && el('commsBadge').hidden);

console.log('CAREER EVACUATION OK · seed 999064 step 11145 · partial fare and one H call at P8');
