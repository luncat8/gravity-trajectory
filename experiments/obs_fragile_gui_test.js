/*
 * Observation device (0.6.1) and fragile load (0.6.3) on the page: the report
 * row, the observer refit, the go-quiet row and its help topic, the quiet
 * pill, the fragile board row, the pad line, the aim note and the lost load.
 * Run: node experiments/obs_fragile_gui_test.js
 */
'use strict';

const { loadPage } = require('./dom_stub.js');

function check(ok, message) {
	if (!ok) throw new Error(message);
}

const env = loadPage({ search: '?rule=career&seed=42&rate=1', clipboard: false });
env.runFrames(2, 16.0);
const ui = env.elements;
const context = env.context;
const Game = context.GravityGame;
const Tech = context.OrbitTech;
const scene = context.GravityScene;
const career = scene.career;
const game = scene.game;
const market = game.market;

function drawerHtml() {
	return ui.get('careerPad').innerHTML + ui.get('careerShop').innerHTML;
}

function act(data) {
	env.fireElement(ui.get('careerBox'), 'click', { target: { dataset: data } });
}

function normalPlanet(exclude) {
	for (let p = 0; p < context.OrbitWorld.PLANETS; p++) {
		if (career.planetMask && career.planetMask[p] !== 1) continue;
		if (p === exclude || p === career.hq) continue;
		if (p === career.capitalPlanet || p === career.arfPlanet) continue;
		return p;
	}
	throw new Error('no normal planet in play');
}

function land(planet) {
	Game.placeShip(career, scene.sim, planet);
	context.refreshCareerPanel();
}

function hud() {
	env.advance(600);
	env.runFrames(2, 16.0);
}

/* --- the device is on the ship from the start --------------------------- */

check(career.ship.obs === Tech.OBS[1], 'the career does not start with OBS-1');
hud();
check(!ui.get('flightReportRow').hidden, 'the flight HUD hides the report row in career');
check(ui.get('flightReport').textContent === 'OBS-1',
	'the report row does not name the device: ' + ui.get('flightReport').textContent);
let shop = ui.get('careerShop').innerHTML;
check(shop.includes('observer') && shop.includes('back OBS-0'),
	'the ship refit has no observer row with a way back: ' + shop);

/* --- go quiet: only above the line, only with the device ----------------- */

const planet = normalPlanet();
market.corruption[planet] = 50;
land(planet);
check(!drawerHtml().includes('data-act="quiet"'), 'go quiet is offered at 50% rot');
market.corruption[planet] = 80;
context.refreshCareerPanel();
let html = drawerHtml();
check(html.includes('data-act="quiet"') && html.includes('go quiet · ' + 'P' + planet),
	'go quiet is not offered at 80% rot: ' + html);
check(/data-help="politics"[^>]*><span class="careerBtns"><button class="miniBtn" data-act="quiet"/.test(html),
	'the go-quiet row carries no help topic');
check(/data-help="politics"[^>]*><span class="careerBtns"><button class="miniBtn" data-act="bribe"/.test(html),
	'the bribe row carries no help topic');

/* the help drawer previews the topic while the pointer is on the row */
const row = { dataset: { help: 'politics' } };
env.fireElement(ui.get('careerBox'), 'pointerover', { target: { closest: () => row } });
check(scene.helpOpen(), 'the bribe row does not open the help drawer');
check(ui.get('helpRuleName').textContent === 'corruption · bribes · reports',
	'the drawer shows the wrong topic: ' + ui.get('helpRuleName').textContent);
check(ui.get('helpDetail').textContent.includes('go quiet') &&
	ui.get('helpDetail').textContent.includes(Game.QUIET_MIN + '%'),
	'the topic does not explain the device: ' + ui.get('helpDetail').textContent);
env.fireElement(ui.get('careerBox'), 'pointerover', { target: { closest: () => null } });
check(!scene.helpOpen(), 'the drawer stays open off the row');
check(ui.get('helpRuleName').textContent.indexOf('career') === 0,
	'the drawer does not fall back to the rule: ' + ui.get('helpRuleName').textContent);

act({ act: 'quiet' });
check(market.quiet[planet] === 1, 'the click did not silence the planet');
check(career.ship.obs === Tech.OBS[0], 'the device stayed on the ship');
check(ui.get('careerMsg').textContent.includes('went quiet'),
	'no notice: ' + ui.get('careerMsg').textContent);
html = drawerHtml();
check(html.includes('· quiet · no reports'), 'the pad block does not say quiet: ' + html);
check(!html.includes('data-act="quiet"'), 'go quiet is offered twice');
check(html.includes('fit OBS-1'), 'the shelf device cannot be refitted: ' + html);
hud();
check(ui.get('flightReport').textContent.indexOf('none') === 0,
	'the report row does not warn: ' + ui.get('flightReport').textContent);

/* the pill: a quiet planet pays nothing and is tagged */
env.calls.texts.length = 0;
env.runFrames(2, 16.0);
check(env.calls.texts.includes('quiet · rot 80%'), 'the map does not tag the quiet planet');

/* refit: reports again elsewhere, the quiet planet stays quiet */
act({ act: 'part', kind: 'obs', tier: '1' });
check(career.ship.obs === Tech.OBS[1], 'the refit click did nothing: ' + ui.get('careerMsg').textContent);
check(market.quiet[planet] === 1, 'refitting un-silenced the planet');
check(!drawerHtml().includes('data-act="quiet"'), 'an already quiet planet offers go quiet');
act({ act: 'part', kind: 'obs', tier: '0' });
check(ui.get('careerMsg').textContent.includes('visits pay nothing'),
	'unfitting does not warn: ' + ui.get('careerMsg').textContent);
act({ act: 'part', kind: 'obs', tier: '1' });

/* --- fragile load ------------------------------------------------------- */

const limit = 'launch ≤ ' + Math.floor(Game.FRAGILE_SPEED) + ' px/s';
career.ship.hold = Tech.HOLDS[1];
career.contract = -1;
const from = career.hq;
const to = normalPlanet(planet);
land(from);
const task = career.tasks[0];
task.kind = Game.TASK_DELIVERY;
task.state = Game.TASK_OFFERED;
task.tourist = false;
task.fragile = true;
task.good = 0;
task.tons = 4;
task.from = from;
task.to = to;
task.reward = 3;
task.deadline = game.clockSteps + 100000;
context.refreshCareerPanel();
let board = ui.get('careerTasks').innerHTML;
check(board.includes('>fragile<') && board.includes(limit), 'the board row hides the limit: ' + board);
act({ act: 'accept', slot: '0' });
check(career.contract === 0 && task.state === Game.TASK_LOADED, 'the fragile load did not board');
html = drawerHtml();
check(html.includes('fragile load aboard') && html.includes(limit),
	'the pad block does not warn about the load: ' + html);

/* a strong rail: the aim note, the warn colour, and the lost load on launch */
career.pads[from].catapult = Tech.CATAPULTS[2];
career.pads[from].battery = Tech.BATTERIES[4];
career.pads[from].chargeKwh = Tech.BATTERIES[4].capacity;
context.refreshCareerPanel();
check(drawerHtml().includes('aim softer or it breaks'), 'a strong rail is not flagged: ' + drawerHtml());
const hard = Math.ceil(Game.FRAGILE_SPEED) + 20;
env.dragAim(from, -0.6, 60);
env.runFrames(3, 16.0);
check(scene.aimState().armed && scene.aimState().speed < Game.FRAGILE_SPEED, 'the gentle aim did not arm');
check(!ui.get('aimReadout').textContent.includes('fragile'), 'a gentle aim is flagged: ' + ui.get('aimReadout').textContent);
env.dragAim(from, -0.6, hard);
env.runFrames(3, 16.0);
check(scene.aimState().speed > Game.FRAGILE_SPEED, 'the hard aim did not arm: ' + scene.aimState().speed);
check(ui.get('aimReadout').textContent.includes('breaks the fragile load'),
	'the aim line does not price the void: ' + ui.get('aimReadout').textContent);
check(scene.aimGuidance() === 2, 'a breaking shot is not in the warn colour');
env.click('launch');
for (let i = 0; i < 400 && career.flights === 0; i++) env.runFrames(1, 16.0);
check(career.flights === 1, 'the hard shot did not fire');
check(career.contract === -1 && career.ship.cargoTons === 0, 'the hard launch kept the load');
check(ui.get('careerMsg').textContent.includes('fragile load lost'),
	'the loss is silent: ' + ui.get('careerMsg').textContent);

console.log('OBS + FRAGILE GUI OK · report row, observer refit, go quiet, help topic, pill, fragile rows and aim');
