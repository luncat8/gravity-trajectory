/*
 * Two players, one career map: a hand-flown rival company must aim, price and
 * fire with its OWN purse, battery and landing — and the auto-helper scans must
 * work from that company's planet, not from YOU's.
 *
 * Run: node experiments/multiplayer_career_test.js
 */
'use strict';

const assert = require('assert');
const { loadPage } = require('./dom_stub.js');

const env = loadPage({ search: '?mode=career&seed=1' });
env.runFrames(4, 16);
const ui = env.elements;
const scene = env.context.GravityScene;
const game = scene.game;
const you = scene.career;

function launchButton() {
	return { text: ui.get('launch').textContent, disabled: ui.get('launch').disabled };
}

/* hand R1 to the keyboard: the company keeps its map, purse and pads */
env.toggle('rivalBot1');
env.runFrames(2, 16);
env.click('scoreRival1');
env.runFrames(2, 16);
assert.strictEqual(scene.activeSlot(), 1, 'R1 was not selected');
const rival = scene.bot.rivals[0];
assert.ok(!scene.bot.isRivalBot(0), 'R1 is still bot controlled');
const rivalCareer = rival.career;
assert.ok(rivalCareer.hq !== you.hq, 'R1 and YOU share an HQ, so the fixture proves nothing');
assert.strictEqual(rivalCareer.launchBook.entries.length, 0, 'fixture has a seeded launch book');

/* the page reads the selected player: its landing, its energy, its purse */
rivalCareer.sim = rival.sim;
scene.setCareerPaused(false);
const hq = rivalCareer.hq;
const pad = rivalCareer.pads[hq];
const padKwh = pad.chargeKwh;
const speed = 60;
env.dragAim(hq, 0.9, speed);
env.runFrames(3, 16);
const aim = scene.aimState();
assert.ok(Math.abs(aim.speed - speed) < 1, 'the drag did not keep its speed');
assert.ok(aim.ceiling > 0 && aim.ceiling < 250,
	'the drag ceiling is not R1 own rail: ' + aim.ceiling);

const armed = launchButton();
assert.ok(!armed.disabled, 'R1 cannot launch from its own charged rail: ' + armed.text);
assert.ok(armed.text.indexOf('R1 · launch') === 0, 'launch label is not R1: ' + armed.text);
assert.ok(/kWh/.test(armed.text) && !/· [0-9]\.[0-9][0-9]$/.test(armed.text),
	'R1 is quoted a cash fee on its own EMC: ' + armed.text);

/* firing spends R1's pad and R1's career, and never YOU's */
const youFlights = you.flights;
const youPurse = you.ledger.purse;
const youPad = you.pads[you.hq].chargeKwh;
env.click('launch');
let frames = 0;
while (rivalCareer.flights === 0 && frames < 900) {
	env.runFrames(1, 16);
	frames += 1;
}
assert.strictEqual(rivalCareer.flights, 1, 'the queued R1 launch never fired');
for (let i = 0; i < 9000 && rival.sim.status === 1; i++) env.runFrames(1, 16);
assert.strictEqual(you.flights, youFlights, 'R1 launch counted as a YOU flight');
assert.ok(Math.abs(you.ledger.purse - youPurse) < 1e-9, 'R1 launch spent YOU money');
assert.ok(Math.abs(you.pads[you.hq].chargeKwh - youPad) < 1e-9, 'R1 launch drained YOU pad');
assert.ok(pad.chargeKwh < padKwh - 1e-9, 'R1 own pad charge was not spent');
assert.strictEqual(rival.shots.length, 1, 'the R1 shot was not recorded on R1');
assert.strictEqual(game.shots.length, 0, 'the R1 shot leaked into the YOUR shot list');

/* the auto-helper prices scans from the selected company's landing */
const landing = rivalCareer.at;
assert.ok(landing >= 0, 'R1 did not land (' + rival.sim.endReason + ')');
assert.notStrictEqual(landing, you.at, 'fixture landed R1 on YOU planet');
assert.ok(!ui.get('helperProfit').disabled, 'best profit is refused to a landed R1');
const title = ui.get('helperProfit').title;
assert.ok(title.indexOf('scan 34 aims from P' + landing) >= 0,
	'the profit scan names another company planet: ' + title);

env.click('helperProfit');
let scanFrames = 0;
while (ui.get('helperStop').hidden !== true && scanFrames < 1800) {
	env.runFrames(1, 16);
	scanFrames += 1;
}
assert.ok(scanFrames < 1800, 'the profit scan never finished');
const found = scene.aimState();
assert.ok(found.armed, 'the profit scan armed nothing after a real landing');
assert.strictEqual(found.body, landing, 'the scan armed a shot from another company pad');
assert.ok(rivalCareer.launchBook.entries.length > 0,
	'the scan did not save its traces to R1 launch book');
assert.strictEqual(you.launchBook.entries.length, 0, 'R1 scan wrote into YOU launch book');
assert.ok(ui.get('careerMsg').textContent.length > 0, 'the scan did not report a find');

/* Switching during a scan must not apply R1's candidates to YOU. */
env.click('helperProfit');
assert.strictEqual(ui.get('helperStop').hidden, false, 'scan did not start');
env.click('scorePlayer');
assert.strictEqual(ui.get('helperStop').hidden, true, 'slot switch did not cancel scan');

/* switching back restores YOU's own gate: no R1 pad is usable from P3 */
env.click('scorePlayer');
env.runFrames(2, 16);
assert.strictEqual(scene.activeSlot(), 0, 'YOU was not selected again');
scene.setCareerPaused(false);
env.dragAim(you.hq, 0.9, speed);
env.runFrames(3, 16);
const back = launchButton();
assert.ok(back.text.indexOf('R1 ') !== 0, 'YOU launch label still says R1: ' + back.text);
assert.ok(!back.disabled, 'YOU cannot launch from its own pad after the round trip');
assert.strictEqual(scene.aimState().body, you.hq, 'YOU aim is not on YOU HQ');

console.log('MULTIPLAYER CAREER OK · R1 fired from P' + hq + ' → P' + landing +
	' · helpers scanned from the selected company');
