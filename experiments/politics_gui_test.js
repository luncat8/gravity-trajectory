/*
 * Politics GUI bench (0.5.12): the page binds the shared market to the run, the
 * planet pill shows rot and a rebellion, the pad block offers the bribe and the
 * medical mission, the bribe click pays and rots, an arrest freezes planning
 * and the clock shows the transport.
 * Run: node experiments/politics_gui_test.js
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
const scene = context.GravityScene;
const career = scene.career;
const game = scene.game;
const market = game.market;
const trade = scene.tradeSim;

/* a button's enabled state, whatever the order of its attributes */
function bribeDisabled(html) {
	const tag = /<button[^>]*data-act="bribe"[^>]*>/.exec(html);
	return !tag || /\bdisabled\b/.test(tag[0]);
}

function drawerHtml() {
	return ui.get('careerPad').innerHTML + ui.get('careerShop').innerHTML;
}

function act(data) {
	env.fireElement(ui.get('careerBox'), 'click', { target: { dataset: data } });
}

function normalPlanet(exclude) {
	for (let p = 0; p < context.OrbitWorld.PLANETS; p++) {
		if (career.planetMask && career.planetMask[p] !== 1) continue;
		if (p === exclude) continue;
		if (p === career.capitalPlanet || p === career.arfPlanet) continue;
		return p;
	}
	throw new Error('no normal planet in play');
}

function land(planet) {
	Game.placeShip(career, scene.sim, planet);
	context.refreshCareerPanel();
}

/* --- the run is bound --------------------------------------------------- */

check(market.galaxy === game.galaxy, 'the market is not bound to the career galaxy');
check(game.galaxy.market === market, 'the galaxy does not carry the market');
check(career.market === market, 'the player career has no market');
check(context.GravityGame.politicsOn(), 'politics is off by default');

/* --- the planet pill: rot and rebellion -------------------------------- */

const pill = normalPlanet();
market.corruption[pill] = 45;
market.lastVisitStep[pill] += 1000000;
env.calls.texts.length = 0;
env.runFrames(1, 16.0);
check(env.calls.texts.includes('rot 45%'),
	'the planet pill does not show rot: ' + env.calls.texts.join(' '));
market.rebel[pill] = 1;
market.seized[pill] = 1;
market.rebelSinceStep[pill] = 0;
market.patients[pill] = 8;
market.rebelPads[pill] = { catapult: context.OrbitTech.CATAPULTS[2],
	panel: context.OrbitTech.PANELS[1], battery: context.OrbitTech.BATTERIES[1],
	chargeKwh: context.OrbitTech.BATTERIES[1].capacity, reservedKwh: 0 };
env.calls.texts.length = 0;
env.runFrames(1, 16.0);
check(env.calls.texts.includes('REBELLION'),
	'the planet pill does not show the rebellion: ' + env.calls.texts.join(' '));
market.rebel[pill] = 0;
market.seized[pill] = 0;
market.patients[pill] = 0;
market.rebelPads[pill] = null;
market.corruption[pill] = 0;

/* --- the pad block: corruption, the bribe and the aim gate -------------- */

const planet = normalPlanet();
land(planet);
Game.placeShip(career, scene.sim, planet);
market.lastVisitStep[planet] = game.clockSteps;
market.visitPay[planet] = 2;
market.corruption[planet] = 25;
context.refreshCareerPanel();
let html = drawerHtml();
check(html.includes('corruption 25%'), 'the pad block hides corruption: ' + html);
check(html.includes('data-act="bribe"'), 'the pad block has no bribe button');
check(html.includes('+2.00'), 'the bribe button does not price the visit: ' + html);
const purse = career.ledger.purse;
act({ act: 'bribe' });
check(career.bribes === 1, 'the bribe click did nothing');
check(Math.abs(career.ledger.purse - (purse + 2)) < 1e-9,
	'the bribe did not pay the rot-scaled visit: ' + career.ledger.purse);
check(Math.abs(market.corruption[planet] - (25 + context.OrbitEcon.bribeCorruption(2))) < 1e-9,
	'the bribe did not rot the planet: ' + market.corruption[planet]);
html = drawerHtml();
check(html.includes('bribed this visit'), 'the drawer does not mark the visit as bribed: ' + html);
check(!career.arrested, 'a 25% planet arrested the briber');

/* --- the bribe button is a state, not a price (0.5.18) ------------------ */

/* the bribe is once per visit: the closed visit offers no button */
check(!drawerHtml().includes('data-act="bribe"'),
	'the pad block still offers a bribe after the bribe: ' + drawerHtml());
/* a new visit opens it again: the harvest clears the marker the drawer reads */
Game.harvestPlanet(career.ledger, market, planet, game.clockSteps);
check(Game.bribeWindowOpen(market, planet), 'a visit does not reopen the bribe window');
market.visitPay[planet] = 2;
context.refreshCareerPanel();
html = drawerHtml();
check(html.includes('data-act="bribe"') && !bribeDisabled(html),
	'a new visit does not reopen the bribe: ' + html);
/* a clean world keeps the button and simply prices it at nothing */
const fresh = normalPlanet(planet);
market.corruption[fresh] = 0;
land(fresh);
market.lastVisitStep[fresh] = game.clockSteps;
market.visitPay[fresh] = 2;
context.refreshCareerPanel();
html = drawerHtml();
check(html.includes('data-act="bribe"'), 'a clean world hides the bribe button: ' + html);
check(html.includes('+0.00'), 'a clean world does not price the bribe at nothing: ' + html);
check(bribeDisabled(html), 'a clean world offers an enabled bribe');
check(html.includes('nothing to take yet'), 'a clean world does not explain why: ' + html);
/* the Capital and the A.R.F. world take no bribes at all */
Game.placeShip(career, scene.sim, career.capitalPlanet);
context.refreshCareerPanel();
check(!drawerHtml().includes('data-act="bribe"'), 'the Capital offers a bribe');
Game.placeShip(career, scene.sim, career.arfPlanet);
context.refreshCareerPanel();
check(!drawerHtml().includes('data-act="bribe"'), 'the A.R.F. offers a bribe');
land(planet);

/* --- arrest: the clock, the gate and the drawer ------------------------ */

const arrestPlanet = normalPlanet(planet);
market.lastVisitStep[arrestPlanet] = game.clockSteps;
market.visitPay[arrestPlanet] = 1;
market.corruption[arrestPlanet] = 100;
Game.placeShip(career, scene.sim, arrestPlanet);
let arrested = false;
for (let i = 0; i < 40 && !arrested; i++) {
	market.corruption[arrestPlanet] = 100;
	market.lastVisitStep[arrestPlanet] = game.clockSteps + i;
	Game.placeShip(career, scene.sim, arrestPlanet);
	const result = Game.acceptBribe(career, market, scene.sim, arrestPlanet, game.clockSteps);
	arrested = result.arrested;
	if (!result.ok) throw new Error('bribe refused: ' + result.reason);
}
check(arrested, 'no arrest in 40 bribes at 100% rot');
check(career.at === career.capitalPlanet, 'the arrest did not ship the career to the Capital');
check(scene.sim.landedBody === career.capitalPlanet, 'the sim did not follow the arrest');
context.refreshCareerPanel();
env.runFrames(1, 16.0);
check(drawerHtml().includes('under arrest'), 'the drawer hides the arrest: ' + drawerHtml());
check(ui.get('gameClock').textContent.includes('ARREST'),
	'the clock does not show the arrest: ' + ui.get('gameClock').textContent);
check(Game.railBlock(career, scene.sim, career.at, 100).indexOf('arrest') >= 0,
	'the launch gate allows a launch under arrest');
act({ act: 'bribe' });
check(ui.get('careerMsg').textContent.indexOf('under arrest') >= 0,
	'the bribe click is not refused under arrest: ' + ui.get('careerMsg').textContent);
career.arrested = false;
career.arrestUntilStep = 0;

/* --- the medical mission on the task board ----------------------------- */

const rebelPlanet = normalPlanet();
market.rebel[rebelPlanet] = 1;
market.seized[rebelPlanet] = 1;
market.rebelSinceStep[rebelPlanet] = 0;
market.patients[rebelPlanet] = context.OrbitEcon.MEDIC_PATIENTS;
market.rebelPads[rebelPlanet] = { catapult: context.OrbitTech.CATAPULTS[1],
	panel: context.OrbitTech.PANELS[1], battery: context.OrbitTech.BATTERIES[1],
	chargeKwh: context.OrbitTech.BATTERIES[1].capacity, reservedKwh: 0 };
career.contract = -1;
career.ship.hold = context.OrbitTech.HOLDS[1];
career.ship.cargoTons = 0;
Game.placeShip(career, scene.sim, career.capitalPlanet);
Game.refreshBoard(career, trade, game.clockSteps);
context.refreshCareerPanel();
const board = ui.get('careerTasks').innerHTML;
check(board.includes('medical'), 'the task board has no medical row: ' + board);
check(board.includes('data-act="accept" data-slot="' + Game.MEDIC_SLOT + '"'),
	'the medical row has no accept: ' + board);
check(board.includes('patients ' + context.OrbitEcon.MEDIC_PATIENTS),
	'the medical row hides the patients: ' + board);
act({ act: 'accept', slot: String(Game.MEDIC_SLOT) });
check(career.contract === Game.MEDIC_SLOT, 'the medical accept did nothing');
check(career.ship.cargoTons === Math.floor(career.ship.hold.capacity / 2),
	'the medics did not board: ' + career.ship.cargoTons);
html = drawerHtml();
check(html.includes('medical · ') && html.includes('medics →'),
	'the pad block hides the medical cargo: ' + html);
context.refreshCareerPanel();
check(ui.get('careerTasks').innerHTML.includes('medics →'),
	'the task row hides the medics aboard: ' + ui.get('careerTasks').innerHTML);
/* the trip out swaps medics for patients and the row follows */
Game.settleMedic(career, career.tasks[Game.MEDIC_SLOT], rebelPlanet, game.clockSteps);
context.refreshCareerPanel();
check(ui.get('careerTasks').innerHTML.includes('patients →'),
	'the task row hides the patients aboard: ' + ui.get('careerTasks').innerHTML);
/* the trip home pays and, after the last patient, the planet is quelled */
Game.settleMedic(career, career.tasks[Game.MEDIC_SLOT], career.capitalPlanet,
	game.clockSteps);
context.refreshCareerPanel();
check(ui.get('careerTasks').innerHTML.includes('medical'),
	'the medical offer left the board while patients remain');
Game.settleMedic(career, career.tasks[Game.MEDIC_SLOT], rebelPlanet, game.clockSteps);
Game.settleMedic(career, career.tasks[Game.MEDIC_SLOT], career.capitalPlanet,
	game.clockSteps);
check(market.rebel[rebelPlanet] === 0, 'the second trip did not quell the planet');
check(career.contract < 0, 'the medical contract survived the quelling');

/* --- the sitting bribe keeps its price (0.7.x) -------------------------- */

/* the law prices the bribe from the live visit value, so a button rebuilt at
 * touchdown must not keep that price while the clock runs and the pad block is
 * not re-rendered: the row would send the player away from a bribe that grew */
const sitting = normalPlanet();
land(sitting);
market.lastVisitStep[sitting] = game.clockSteps;
market.visitPay[sitting] = 1.5;
market.corruption[sitting] = 60;
context.refreshCareerPanel();
/* the stub keeps a panel's markup as a string, so stand in for the node the
 * real page's parsers would make of it; the per-frame HUD then re-prices it */
const bribeNode = { id: 'careerBribe', textContent: /bribe rulers · \+[\d.]+/.exec(drawerHtml())[0],
	disabled: false };
ui.set('careerBribe', bribeNode);
const stale = bribeNode.textContent;
for (let i = 0; i < 600; i++) {
	Game.careerAdvance(career, 1, 1);
	game.clockSteps += 1;
}
context.refreshFuelHud(career);
const law = 'bribe rulers · +' + Game.bribeAmount(market, sitting, game.clockSteps).toFixed(2);
check(stale !== law, 'the fixture did not grow the bribe: ' + stale);
check(bribeNode.textContent === law,
	'the bribe button went stale: shows ' + bribeNode.textContent + ', law pays ' + law);

/* --- the pad plate steps aside for the profit pill (0.7.x) -------------- */

/* the plate used to sit under the planet, on the pill that prints the visit
 * value — the one number a sitting player is watching */
const view = context.OrbitScene.view;
const sim = context.OrbitScene.sim;
const sx = sim.planetX[sitting] * view.scale + view.offX;
const sy = sim.planetY[sitting] * view.scale + view.offY;
const radius = sim.planetR[sitting] * view.scale + 8;
check(context.overPill(sitting, sx - 100, sy - 9 + radius, 200, 18),
	'the below-slot plate is not over the pill: the fixture no longer covers it');
check(!context.overPill(sitting, sx - 100, sy - 9 - radius - 18, 200, 18),
	'the above-slot plate is over the pill too');

console.log('POLITICS GUI OK · bribe, arrest, medical board and pills');
