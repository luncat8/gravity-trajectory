/*
 * Headless smoke test: loads the page scripts in a vm with a stub DOM/canvas,
 * runs frames, aims a shot, edits gravity, checks the clocks stay separate and
 * walks through game mode (frozen clock, locks, abort, replay link).
 * Run: node experiments/dom_smoke.js
 */
'use strict';

const { loadPage } = require('./dom_stub.js');

const env = loadPage();

const scene = env.context.OrbitScene;
if (!scene || !scene.sim || !scene.view) throw new Error('OrbitScene missing');
const sim = scene.sim;
const view = scene.view;
const ui = env.elements;

env.runFrames(4);
if (ui.get('tradeClock').textContent !== 't+ 07:00') {
	throw new Error('trade clock did not start at 07:00: ' + ui.get('tradeClock').textContent);
}
console.log('trade start', ui.get('tradeClock').textContent,
	'ports', ui.get('tradePorts').textContent, 'colonies', ui.get('tradeColonies').textContent);

/* the split modules are loaded in the page and the world carries its traits */
const pageWorld = env.context.OrbitWorld;
const pageEcon = env.context.OrbitEcon;
if (!pageWorld || !pageEcon) throw new Error('orbit_world/orbit_econ not loaded by index.html');
if (sim.planetType.length !== pageWorld.PLANETS) throw new Error('planet types missing');
for (let i = 0; i < pageWorld.PLANETS; i++) {
	if (!(sim.planetHabitat[i] > 0)) throw new Error('planet habitat missing at ' + i);
	if (!(sim.planetLight[i] > 0)) throw new Error('planet light missing at ' + i);
}
const typeCount = new Array(pageWorld.TYPE_COUNT).fill(0);
for (let i = 0; i < pageWorld.PLANETS; i++) typeCount[sim.planetType[i]] += 1;
console.log('world traits:', pageWorld.TYPE_NAMES.map((name, i) => name + ' ' + typeCount[i]).join(', '),
	'| Z', sim.metal.toFixed(4), 'L', sim.lum.toFixed(2), 'belts', sim.beltCount);
if (typeCount.every(n => n === 0)) throw new Error('no planet types drawn');

/* photo deck: type slugs, captions and file candidates for user art */
const pagePhoto = env.context.PhotoDeck;
if (!pagePhoto || pagePhoto.SLUGS.length !== pageWorld.TYPE_COUNT) {
	throw new Error('photo deck missing or type table mismatch');
}
if (pagePhoto.candidates('space', pageWorld.TYPE_TERRAN, 4)[0] !== 'photos/space/terran-2.jpg') {
	throw new Error('photo candidate order: ' + pagePhoto.candidates('space', pageWorld.TYPE_TERRAN, 4));
}
if (!pagePhoto.candidates('landed', pageWorld.TYPE_GAS, 5).includes('photos/landed/gas.png')) {
	throw new Error('landed png fallback missing');
}
if (!pagePhoto.captionFor('landed', pageWorld.TYPE_GAS).includes('platform')) {
	throw new Error('gas giant must land on an air platform caption');
}
if (!pagePhoto.needsCompact(880, 800) || pagePhoto.needsCompact(1280, 800)) {
	throw new Error('photo compact breakpoint');
}
console.log('photo deck:', pagePhoto.LABELS.join(', '), '· candidates', pagePhoto.candidates('space', 1, 4).join(' '));

/* colonies are wired into the sim and advanced to t+07:00 (step 2) */
if (sim.colonies.length !== sim.portCount || sim.portCount < pageWorld.INITIAL_PORTS) {
	throw new Error('colonies not wired to ports: ' + sim.colonies.length + ' vs ' + sim.portCount);
}
const stageCounts = [0, 0, 0, 0];
for (let p = 0; p < sim.portCount; p++) {
	const c = sim.colonies[p];
	if (!c || sim.colonyAt(c.planet) !== c) throw new Error('colony lookup mismatch at port ' + p);
	if (!(c.pop >= pageEcon.POP_FLOOR && c.comfort > 0 && c.lastY >= 420)) {
		throw new Error('colony did not advance to t+07:00 at port ' + p);
	}
	stageCounts[c.stage] += 1;
}
console.log('colonies at t+07:00:', sim.portCount,
	'stages', pageEcon.STAGE_NAMES.map((s, i) => s + ' ' + stageCounts[i]).join(', '),
	'log entries', sim.log.length);

function screenOfPlanet(index) {
	return {
		x: sim.planetX[index] * view.scale + view.offX,
		y: sim.planetY[index] * view.scale + view.offY
	};
}

const planet = 0;
const p0 = screenOfPlanet(planet);
const canvas = ui.get('c');
env.fireWindow('pointerdown', {
	button: 0, clientX: p0.x, clientY: p0.y, target: canvas, shiftKey: false
});
let moved = 0;
for (let i = 1; i <= 12; i++) {
	moved = i * 14;
	env.fireWindow('pointermove', {
		clientX: p0.x + moved, clientY: p0.y - moved * 0.3,
		target: canvas, shiftKey: false
	});
}
env.fireWindow('pointerup', {
	clientX: p0.x + moved, clientY: p0.y - moved * 0.3,
	target: canvas, shiftKey: false
});
env.runFrames(3);
console.log('after drag: status', ui.get('cargoStatus').textContent,
	'aim', ui.get('aimReadout').textContent,
	'path', ui.get('pathReadout').textContent,
	'calc', ui.get('calcReadout').textContent,
	'launch disabled', ui.get('launch').disabled);
if (ui.get('launch').disabled) throw new Error('launch stayed disabled after arming');
if (ui.get('pathReadout').textContent === '—') throw new Error('no predicted path');
if (!/^\d+ px$/.test(ui.get('lengthReadout').textContent)) {
	throw new Error('no trajectory length: ' + ui.get('lengthReadout').textContent);
}
console.log('trajectory length', ui.get('lengthReadout').textContent,
	'time to end', ui.get('pathReadout').textContent);

/* press without drag on another planet: selects it, keeps the armed shot */
const armedPath = ui.get('pathReadout').textContent;
const armedLength = ui.get('lengthReadout').textContent;
const other = screenOfPlanet(1);
env.fireWindow('pointerdown', {
	button: 0, clientX: other.x, clientY: other.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: other.x + 2, clientY: other.y + 1, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: other.x + 2, clientY: other.y + 1, target: canvas, shiftKey: false
});
env.runFrames(3);
console.log('after click (no drag): status', ui.get('cargoStatus').textContent,
	'path', ui.get('pathReadout').textContent,
	'launch disabled', ui.get('launch').disabled);
if (ui.get('launch').disabled) throw new Error('click without drag disarmed the shot');
if (ui.get('pathReadout').textContent !== armedPath ||
	ui.get('lengthReadout').textContent !== armedLength) {
	throw new Error('click without drag deleted the old trajectory');
}

env.fireElement(ui.get('launch'), 'click', {});
env.runFrames(5);
console.log('after launch: status', ui.get('cargoStatus').textContent,
	'flight', ui.get('cargoFlight').textContent);
if (!pagePhoto.visible()) throw new Error('space photo card did not appear on a new system');
let photoPlanet = -1;
for (let i = 0; i < pageWorld.PLANETS; i++) {
	if (env.context.GravityScene.sim.visited[i] === 1 &&
		ui.get('photoTitle').textContent === pagePhoto.titleFor(i, sim.planetType[i])) {
		photoPlanet = i;
		break;
	}
}
if (photoPlanet < 0) {
	throw new Error('space photo title is not a visited planet: ' + ui.get('photoTitle').textContent);
}
if (!ui.get('photoKicker').textContent.startsWith('from space')) {
	throw new Error('space photo kicker: ' + ui.get('photoKicker').textContent);
}

/* shift fine aim: drag a second shot with reduced sensitivity */
const p1 = screenOfPlanet(planet);
env.fireWindow('pointerdown', {
	button: 0, clientX: p1.x, clientY: p1.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: p1.x + 80, clientY: p1.y, target: canvas, shiftKey: false
});
const beforeFine = ui.get('aimReadout').textContent;
env.fireWindow('pointermove', {
	clientX: p1.x + 160, clientY: p1.y, target: canvas, shiftKey: true
});
env.fireWindow('pointerup', {
	clientX: p1.x + 160, clientY: p1.y, target: canvas, shiftKey: true
});
env.runFrames(2);
console.log('fine aim:', beforeFine, '->', ui.get('aimReadout').textContent);

/* gravity selection + repel setting */
const p2 = screenOfPlanet(planet);
env.fireWindow('pointerdown', {
	button: 0, clientX: p2.x, clientY: p2.y, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	button: 0, clientX: p2.x, clientY: p2.y, target: canvas, shiftKey: false
});
ui.get('gravity').value = '-1.5';
env.fireElement(ui.get('gravity'), 'input', {});
env.runFrames(2);
console.log('gravity edit:', ui.get('bodyTag').textContent,
	'slider', ui.get('gravityLabel').textContent);
if (!ui.get('bodyTag').textContent.includes('repel')) throw new Error('repel label missing');

/* relative trim while armed */
const p3 = screenOfPlanet(planet);
env.fireWindow('pointerdown', {
	button: 0, clientX: p3.x, clientY: p3.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: p3.x + 120, clientY: p3.y - 20, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: p3.x + 120, clientY: p3.y - 20, target: canvas, shiftKey: false
});
env.runFrames(2);
const speedBefore = ui.get('aimReadout').textContent;
ui.get('trim').value = '5';
env.fireElement(ui.get('trim'), 'input', {});
env.runFrames(2);
const speedAfter = ui.get('aimReadout').textContent;
ui.get('trim').value = '-5';
env.fireElement(ui.get('trim'), 'input', {});
env.runFrames(2);
const speedBack = ui.get('aimReadout').textContent;
env.fireElement(ui.get('trim'), 'change', {});
console.log('trim +5% / -5%:', speedBefore, '->', speedAfter, '->', speedBack,
	'target', ui.get('trimTarget').textContent,
	'thumb after release', ui.get('trim').value);
if (speedBefore === speedAfter) throw new Error('trim did not change the aim');
if (ui.get('trim').value !== '0') throw new Error('trim thumb did not spring back');

/* trade pause must not stop the experiment clock or cargo physics */
const beforeExp = ui.get('expClock').textContent;
const beforeTrade = ui.get('tradeClock').textContent;
env.fireElement(ui.get('tradePause'), 'click', {});
env.runFrames(50);
console.log('paused trade:', beforeTrade, '->', ui.get('tradeClock').textContent,
	'| exp:', beforeExp, '->', ui.get('expClock').textContent);
if (ui.get('tradeClock').textContent !== beforeTrade) throw new Error('trade moved while paused');
if (ui.get('expClock').textContent === beforeExp) throw new Error('experiment clock stopped');

env.fireElement(ui.get('clear'), 'click', {});
env.runFrames(2);
console.log('after clear:', ui.get('cargoStatus').textContent,
	'flight', ui.get('cargoFlight').textContent);

/* gravity positions = ports: centres move, so an armed trajectory updates */
env.fireElement(ui.get('tradePause'), 'click', {});
ui.get('tradeSpeed').value = '12';
env.fireElement(ui.get('tradeSpeed'), 'input', {});
ui.get('srcPorts').checked = true;
env.fireElement(ui.get('srcPorts'), 'change', {});
env.runFrames(2);
console.log('gravity source', ui.get('sourceTag').textContent);
if (ui.get('sourceTag').textContent !== 'ports · moving') {
	throw new Error('ports source not selected');
}
function screenOfPort(index) {
	return {
		x: sim.portX(index, sim.t) * view.scale + view.offX,
		y: sim.portY(index, sim.t) * view.scale + view.offY
	};
}
const sp = screenOfPort(0);
env.fireWindow('pointerdown', {
	button: 0, clientX: sp.x, clientY: sp.y, target: canvas, shiftKey: false
});
let portMoved = 0;
for (let i = 1; i <= 12; i++) {
	portMoved = i * 14;
	env.fireWindow('pointermove', {
		clientX: sp.x + portMoved, clientY: sp.y - portMoved * 0.3,
		target: canvas, shiftKey: false
	});
}
env.fireWindow('pointerup', {
	clientX: sp.x + portMoved, clientY: sp.y - portMoved * 0.3,
	target: canvas, shiftKey: false
});
env.runFrames(3);
console.log('ports drag: status', ui.get('cargoStatus').textContent,
	'selected', ui.get('bodyTag').textContent,
	'launch disabled', ui.get('launch').disabled);
if (ui.get('launch').disabled) throw new Error('drag from a port did not arm');
const portsPath0 = ui.get('pathReadout').textContent + '|' + ui.get('lengthReadout').textContent;
env.runFrames(90);
const portsPath1 = ui.get('pathReadout').textContent + '|' + ui.get('lengthReadout').textContent;
console.log('ports trajectory while centres move:', portsPath0, '->', portsPath1);
if (portsPath1 === portsPath0) {
	throw new Error('trajectory did not update while gravity centres moved');
}
if (ui.get('launch').disabled) throw new Error('ports shot disarmed while moving');

ui.get('srcPlanets').checked = true;
env.fireElement(ui.get('srcPlanets'), 'change', {});
env.runFrames(2);
console.log('gravity source back to', ui.get('sourceTag').textContent);
if (ui.get('sourceTag').textContent !== 'planets') {
	throw new Error('planets source not restored');
}

/* resize must re-share the camera and fold an open photo card to 256 px */
env.context.innerWidth = 1280;
env.context.innerHeight = 800;
pagePhoto.show('space', pageWorld.TYPE_ICE, 7);
if (ui.get('photoCard').classList.contains('compact')) {
	throw new Error('photo card compact on a wide screen');
}
env.context.innerWidth = 900;
env.context.innerHeight = 620;
env.fireWindow('resize', {});
env.runFrames(2);
if (!ui.get('photoCard').classList.contains('compact')) {
	throw new Error('photo card stayed wide on a small screen');
}
pagePhoto.hide();
env.context.innerWidth = 1280;
env.context.innerHeight = 800;
env.fireWindow('resize', {});
env.runFrames(2);
console.log('after resize scale', view.scale.toFixed(3), 'offX', view.offX.toFixed(1),
	'canvas', ui.get('g').width + 'x' + ui.get('g').height,
	'· photo compact fold OK');

/* secondary moons & belts: Kepler scaling, gravity sensitivity, zero sim impact */
const moons = scene.moons;
if (!moons || moons.count() < 120 || moons.tracks() < 15) {
	throw new Error('secondary moons and belts missing: ' + (moons && moons.count()));
}
for (let i = 1; i < moons.count(); i++) {
	if (moons.planet[i] !== moons.planet[i - 1]) continue;
	const ratioA = Math.pow(moons.a[i - 1] / moons.a[i], 1.5);
	const ratioW = Math.abs(moons.omega[i]) / Math.abs(moons.omega[i - 1]);
	if (Math.abs(ratioA - ratioW) > 1e-6) {
		throw new Error('moon omega violates Kepler third law');
	}
}
scene.planetG.fill(0);
const frozenX0 = moons.x[0];
const frozenY0 = moons.y[0];
moons.step(1.0);
if (moons.x[0] !== frozenX0 || moons.y[0] !== frozenY0) {
	throw new Error('moons moved when planet gravity was 0');
}
scene.planetG.fill(1);
moons.step(0.5);
if (moons.x[0] === frozenX0 && moons.y[0] === frozenY0) {
	throw new Error('moons stayed frozen when planet gravity returned to 1');
}
console.log('moons & belts:', moons.count(), 'points,', moons.tracks(), 'tracks · Kepler OK');

/* help shows only the selected rule and follows the rule radios while pressed */
const gScene = env.context.GravityScene;
function allHelpText() {
	return ui.get('helpRuleName').textContent + '|' + ui.get('helpGoal').textContent + '|' +
		ui.get('helpScore').textContent + '|' + ui.get('helpDetail').textContent + '|' +
		ui.get('helpControls').textContent;
}
env.fireElement(ui.get('helpBtn'), 'pointerenter', { pointerType: 'mouse' });
if (!gScene.helpOpen() || gScene.helpRule() !== 'tour') {
	throw new Error('help hover did not open on the selected tour rule');
}
env.fireElement(ui.get('helpBtn'), 'pointerleave', {});
if (gScene.helpOpen()) throw new Error('hover help did not close on leave');
gScene.setHelpOpen(true);
if (!gScene.helpOpen() || gScene.helpRule() !== 'tour' ||
	ui.get('helpRuleName').textContent !== 'tour' ||
	!ui.get('helpScore').textContent.startsWith('Most systems.') ||
	allHelpText().includes('Trajectory length only') ||
	allHelpText().includes('10-launch contract')) {
	throw new Error('tour help is not selected-rule-only: ' + allHelpText());
}
env.fireElement(ui.get('ruleRoute'), 'pointerenter', { pointerType: 'mouse' });
if (!gScene.helpOpen() || gScene.helpRule() !== 'route') {
	throw new Error('hovered route radio did not preview route help');
}
env.fireElement(ui.get('ruleRoute'), 'pointerleave', {});
if (!gScene.helpOpen() || gScene.helpRule() !== 'tour') {
	throw new Error('pinned help did not return to selected tour after radio hover');
}
env.fireElement(ui.get('ruleRoute'), 'pointerdown', { pointerType: 'mouse' });
if (!gScene.helpOpen() || gScene.helpRule() !== 'route' ||
	!ui.get('helpRuleName').textContent.startsWith('route') ||
	!ui.get('helpScore').textContent.startsWith('Trajectory length only') ||
	allHelpText().includes('Most systems.') ||
	allHelpText().includes('10-launch contract')) {
	throw new Error('pressed route radio did not show route help: ' + allHelpText());
}
env.fireElement(ui.get('ruleRoute'), 'pointerup', { pointerType: 'mouse' });
if (!gScene.helpOpen() || gScene.helpRule() !== 'tour') {
	throw new Error('pinned help did not return to the selected tour rule');
}
env.fireElement(ui.get('ruleMoney'), 'pointerdown', { pointerType: 'mouse' });
if (!gScene.helpOpen() || gScene.helpRule() !== 'money' ||
	!ui.get('helpScore').textContent.startsWith('Highest purse.')) {
	throw new Error('pressed money radio did not show money help: ' + allHelpText());
}
env.fireElement(ui.get('ruleMoney'), 'pointerup', { pointerType: 'mouse' });
env.fireElement(ui.get('helpClose'), 'click', {});
if (gScene.helpOpen()) throw new Error('help close failed');
console.log('help: selected tour only; pressed route/money radios preview their own goal + score');

/* 60 fps adaptive trajectory cadence vs sub-60 fps throttling */
env.fireElement(ui.get('clear'), 'click', {});
ui.get('srcPorts').checked = true;
env.fireElement(ui.get('srcPorts'), 'change', {});
env.runFrames(2, 16.0);
const base0 = screenOfPlanet(0);
env.fireWindow('pointerdown', {
	button: 0, clientX: base0.x, clientY: base0.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: base0.x + 110, clientY: base0.y + 40, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: base0.x + 110, clientY: base0.y + 40, target: canvas, shiftKey: false
});
let updates60 = 0;
let prevT = -1;
for (let i = 0; i < 30; i++) {
	env.runFrames(1, 16.0);
	if (gScene.sim.predFieldT !== prevT) {
		updates60 += 1;
		prevT = gScene.sim.predFieldT;
	}
}
if (updates60 !== 30 || gScene.autoInterval() !== 1) {
	throw new Error('did not update every frame at >=60 fps: ' + updates60);
}
let updatesSlow = 0;
for (let i = 0; i < 24; i++) {
	env.runFrames(1, 30.0);
	if (gScene.sim.predFieldT !== prevT) {
		updatesSlow += 1;
		prevT = gScene.sim.predFieldT;
	}
}
if (gScene.autoInterval() <= 1 || updatesSlow >= 20) {
	throw new Error('did not throttle auto recompute below 60 fps: ' + updatesSlow);
}
console.log('adaptive trajectory updates: 60fps', updates60 + '/30,',
	'33fps', updatesSlow + '/24 (interval ' + gScene.autoInterval() + ')');

/* grand tour: continue in flight until landed, persist visited, lock other planets */
env.fireElement(ui.get('clear'), 'click', {});
ui.get('srcPlanets').checked = true;
env.fireElement(ui.get('srcPlanets'), 'change', {});
ui.get('horizon').value = '5';
env.fireElement(ui.get('horizon'), 'input', {});
env.runFrames(2, 16.0);

let tour = null;
for (let p = 0; p < pageWorld.PLANETS && !tour; p++) {
	for (let a = 0; a < 90; a++) {
		const angle = (a / 90) * Math.PI * 2;
		gScene.sim.horizon = 60;
		gScene.sim.predict(p, angle, 135);
		if (gScene.sim.predReason === 1 && gScene.sim.predBody !== p &&
			gScene.sim.predVisits >= 5 && gScene.sim.predTime > 6.5) {
			tour = { p, angle, end: gScene.sim.predBody, visits: gScene.sim.predVisits };
			break;
		}
	}
}
gScene.sim.horizon = 5;
const tourOrigin = screenOfPlanet(tour.p);
const gripDist = gScene.sim.gripLength(135) * view.scale;
env.fireWindow('pointerdown', {
	button: 0, clientX: tourOrigin.x, clientY: tourOrigin.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: tourOrigin.x + Math.cos(tour.angle) * gripDist,
	clientY: tourOrigin.y + Math.sin(tour.angle) * gripDist,
	target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: tourOrigin.x + Math.cos(tour.angle) * gripDist,
	clientY: tourOrigin.y + Math.sin(tour.angle) * gripDist,
	target: canvas, shiftKey: false
});
env.runFrames(2, 16.0);
const cappedBefore = ui.get('pathReadout').textContent;
if (!cappedBefore.includes('time cap')) {
	throw new Error('expected 5s pre-launch cap, got: ' + cappedBefore);
}
env.fireElement(ui.get('launch'), 'click', {});
env.runFrames(2, 16.0);
const continuedInFlight = ui.get('pathReadout').textContent;
if (!continuedInFlight.includes('impact P' + tour.end)) {
	throw new Error('trajectory did not continue until landing in flight: ' + continuedInFlight);
}
while (gScene.sim.status === 1) env.runFrames(4, 16.0);
if (gScene.sim.landedBody !== tour.end) {
	throw new Error('landedBody mismatch: ' + gScene.sim.landedBody + ' vs ' + tour.end);
}
const visitedAfterHop1 = ui.get('visitReadout').textContent;

/* dragging from another planet is blocked and renders lock tooltip pointing to landed body */
const forbidden = tour.end === 0 ? 1 : 0;
const forbPt = screenOfPlanet(forbidden);
env.calls.texts.length = 0;
env.fireWindow('pointerdown', {
	button: 0, clientX: forbPt.x, clientY: forbPt.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: forbPt.x + 90, clientY: forbPt.y - 30, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: forbPt.x + 90, clientY: forbPt.y - 30, target: canvas, shiftKey: false
});
env.runFrames(2, 16.0);
if (!ui.get('launch').disabled) {
	throw new Error('forbidden non-landed planet was allowed to arm a shot');
}
if (!env.calls.texts.some(t => t.includes('launch not allowed') && t.includes('P' + tour.end))) {
	throw new Error('blocked launch tooltip not drawn');
}
if (!pagePhoto.visible()) throw new Error('landing photo card missing');
if (!ui.get('photoKicker').textContent.startsWith('landed')) {
	throw new Error('landing photo kicker: ' + ui.get('photoKicker').textContent);
}
if (!ui.get('photoTitle').textContent.startsWith('P' + tour.end)) {
	throw new Error('landing photo is for ' + ui.get('photoTitle').textContent + ', landed P' + tour.end);
}
if (ui.get('photoCaption').textContent === '') throw new Error('landing photo has no caption');
env.click('photoClose');
if (pagePhoto.visible()) throw new Error('photo card did not close');
console.log('photo cards: space P' + photoPlanet, '-> landed', ui.get('photoTitle').textContent);

/* dragging from landed planet arms next hop and keeps prior visited markings */
const landPt = screenOfPlanet(tour.end);
env.fireWindow('pointerdown', {
	button: 0, clientX: landPt.x, clientY: landPt.y, target: canvas, shiftKey: false
});
env.fireWindow('pointermove', {
	clientX: landPt.x + 90, clientY: landPt.y - 35, target: canvas, shiftKey: false
});
env.fireWindow('pointerup', {
	clientX: landPt.x + 90, clientY: landPt.y - 35, target: canvas, shiftKey: false
});
env.runFrames(2, 16.0);
if (ui.get('launch').disabled) {
	throw new Error('launch from landed body failed to arm');
}
if (ui.get('visitReadout').textContent !== visitedAfterHop1) {
	throw new Error('visited count was lost when staging next hop');
}
console.log('grand tour verified:', cappedBefore, '->', continuedInFlight,
	'| visited', visitedAfterHop1, '| next base P' + tour.end);

/* game mode: seeded world, clock frozen between flights, locks, abort, replay link */
function check(ok, message) {
	if (!ok) throw new Error(message);
}
const pageGame = env.context.GravityGame;
const pageSim = env.context.GravitySim;
const game = gScene.game;
const cargo = gScene.sim;

function findShot(accept) {
	const keep = cargo.horizon;
	cargo.horizon = 60;
	for (let p = 0; p < pageWorld.PLANETS; p++) {
		for (let a = 0; a < 72; a++) {
			for (const speed of [120, 160, 200]) {
				const angle = a / 72 * Math.PI * 2;
				cargo.predict(p, angle, speed);
				if (!accept(cargo, p)) continue;
				cargo.horizon = keep;
				return { p, angle, speed };
			}
		}
	}
	throw new Error('no shot matched');
}

function dragShot(shot) {
	env.dragAim(shot.p, shot.angle, shot.speed);
	env.runFrames(2, 16.0);
}

env.choose('modeGame');
env.calls.texts.length = 0;
env.runFrames(1, 16.0);
check(ui.get('rivalTag').textContent.startsWith('thinking '),
	'rival did not show sliced thinking tag: ' + ui.get('rivalTag').textContent);
check(env.calls.texts.includes('+0.25') && env.calls.texts.includes('R1'),
	'canvas did not draw +0.25 planet profit pills and R1 tag: ' + env.calls.texts.join(' '));
env.runFrames(8, 16.0);
check(ui.get('modeTag').textContent === 'game · clock runs in flight', 'game mode tag: ' + ui.get('modeTag').textContent);
check(!ui.get('gameBox').hidden && game.on && game.seed === 7, 'game box / seed');
check(!ui.get('scoreHud').hidden, 'game scoreboard should be visible above the trade HUD');
check(ui.get('scoreRuleTag').textContent.startsWith('tour ·'), 'tour scoreboard rule label');
check(!ui.get('scoreRival1').hidden && ui.get('scoreRival2').hidden,
	'normal difficulty should show only R1');
check(gScene.botLevel() === 'normal' && !ui.get('rivalRow').hidden, 'default normal rival not active');
check(ui.get('rivalTag').textContent === '1 rival · route', 'rival tag after idle pre-think: ' + ui.get('rivalTag').textContent);
check(sim.t === 420 && ui.get('tradeClock').textContent === 't+ 07:00', 'world not rebuilt at t+07:00: ' + sim.t);
check(ui.get('expClock').textContent === 'game + 00:00.0', 'game clock: ' + ui.get('expClock').textContent);
check(ui.get('gamePurse').textContent === '3.00', 'purse stat: ' + ui.get('gamePurse').textContent);
check(ui.get('tradePause').disabled && ui.get('gravity').disabled, 'pause / gravity not locked');
check(ui.get('clear').textContent === 'abort' && ui.get('clear').disabled, 'abort button state');
check(!ui.get('tradeSpeed').disabled, 'rate locked before the first shot');
env.setValue('tradeSpeed', 2);
const idleMoonX = scene.moons.x[0];
env.runFrames(120, 16.0);
check(sim.t === 420 && scene.moons.x[0] === idleMoonX, 'world moved while no cargo flies');
console.log('game idle: trade', ui.get('tradeClock').textContent, '· clock', ui.get('expClock').textContent,
	'· seed', ui.get('gameSeed').textContent, '· rival', ui.get('rivalReadout').textContent);

/* playback changes only the pace of the flight; physics steps stay identical */
check(gScene.playScale() === 1 && ui.get('playTag').textContent === '×1', 'playback default');
env.click('playFaster');
env.click('playFaster');
check(gScene.playScale() === 4 && ui.get('playTag').textContent === '×4', 'playback 4x: ' + ui.get('playTag').textContent);
env.click('playSlower');
check(gScene.playScale() === 2, 'playback 2x');
env.click('playSlower');
env.click('playSlower');
check(gScene.playScale() === 0.5, 'playback 0.5x');
check(ui.get('playSlower').disabled === false, 'slower disabled too early');
env.click('playSlower');
check(ui.get('playSlower').disabled, 'slower not disabled at 0.25x');
env.click('playReset');
check(gScene.playScale() === 1 && !ui.get('playFaster').disabled, 'playback reset');

const longShot = findShot((g, p) => g.predTime > 4 && g.predReason !== pageSim.END_EXIT);
dragShot(longShot);
check(!ui.get('launch').disabled, 'game shot did not arm');
check(ui.get('launch').textContent === 'launch · 1.00', 'launch fee label: ' + ui.get('launch').textContent);
check(/· \+\d+\.\d{2}$/.test(ui.get('predVisitReadout').textContent),
	'predVisitReadout missing predicted profit: ' + ui.get('predVisitReadout').textContent);
env.click('launch');
env.runFrames(30, 16.0);
const shot0 = game.shots[0];
check(cargo.status === pageSim.STATUS_FLYING, 'game flight ended too early');
check(cargo.angle === pageGame.angleOf(shot0.angle) && cargo.speed === pageGame.speedOf(shot0.speed),
	'launch inputs not on the aim grid');
check(sim.t === cargo.flightFieldT && sim.t > 420, 'trade clock not locked to the flight clock');
check(ui.get('tradeSpeed').disabled && ui.get('srcPorts').disabled && ui.get('launch').disabled,
	'flight locks missing');
check(!ui.get('clear').disabled && ui.get('cargoStatus').textContent === 'in flight · clock runs',
	'flight state: ' + ui.get('cargoStatus').textContent);
check(scene.moons.x[0] !== idleMoonX, 'moons frozen during flight');
const abortSteps = cargo.liveSteps;
env.click('clear');
env.runFrames(3, 16.0);
check(shot0.abort === abortSteps && cargo.endReason === pageSim.END_ABORT && game.steps === abortSteps,
	'abort not recorded at step ' + abortSteps);
check(ui.get('cargoStatus').textContent === 'aborted · clock paused', 'status ' + ui.get('cargoStatus').textContent);
/* money: the aborted shot paid its 1.00 launch cost and kept any non-launch
   planets harvested before abort; the toast waits behind the entry postcard */
const MINUS = '\u2212';
const purse1 = game.money.purse;
const net1 = purse1 - pageGame.MONEY.purse0;
check(purse1 >= 2.0, 'abort purse dropped below 2.00: ' + purse1);
check(ui.get('gamePurse').textContent === purse1.toFixed(2) + ' · last ' +
	(net1 < 0 ? MINUS : '+') + Math.abs(net1).toFixed(2),
	'purse stat after abort: ' + ui.get('gamePurse').textContent);
check(pagePhoto.toastQueued(), 'money toast not queued behind the entry card');
pagePhoto.hide();
check(pagePhoto.visible() && ui.get('photoTitle').textContent ===
	(net1 < 0 ? MINUS : '+') + Math.abs(net1).toFixed(2) &&
	ui.get('photoKicker').textContent === 'purse · shot 1' &&
	ui.get('photoCaption').textContent.includes('purse ' + purse1.toFixed(2)),
	'money toast: ' + ui.get('photoKicker').textContent + ' / ' +
	ui.get('photoTitle').textContent + ' / ' + ui.get('photoCaption').textContent);
console.log('money after abort: purse', purse1.toFixed(2), '· toast',
	ui.get('photoCaption').textContent);
const pausedT = sim.t;
env.runFrames(60, 16.0);
check(sim.t === pausedT, 'world moved after the flight ended');
console.log('game flight: aborted at step', abortSteps, '· trade t+', (sim.t - 420).toFixed(3),
	'min · clock', ui.get('expClock').textContent);

const landShot = findShot((g, p) => g.predReason === pageSim.END_IMPACT && g.predBody !== p && g.predTime < 8);
dragShot(landShot);
env.click('playFaster');
env.click('playFaster');
env.click('launch');
for (let i = 0; i < 2000 && cargo.status === pageSim.STATUS_FLYING; i++) env.runFrames(1, 16.0);
env.calls.texts.length = 0;
env.runFrames(2, 16.0);
const profitLabels = env.calls.texts.filter(t => /^\+\d+\.\d{2}$/.test(t));
check(profitLabels.includes('+0.00') && profitLabels.some(t => Number(t) > 0.25),
	'canvas planet-profit labels did not reset on visit and grow over game time: ' + profitLabels.join(' '));
env.click('playReset');
check(gScene.playScale() === 1, 'playback did not reset after the flight');
check(cargo.status === pageSim.STATUS_ENDED && game.shots.length === 2, 'second game flight did not end');
check(game.steps === abortSteps + cargo.liveSteps, 'game steps do not add up');
/* a landing card owns the slot this frame, so no money toast is queued */
check(!pagePhoto.toastQueued() && pagePhoto.visible(), 'landing card vs money toast');
const endX = cargo.cargo.x;
const endY = cargo.cargo.y;
const endT = sim.t;
const endVisited = cargo.visitedCount;
const endSteps = gScene.scoreSteps();
const endPurse = game.money.purse;
check(ui.get('gameScore').textContent.startsWith(endVisited + ' / 26'),
	'player score does not lead with systems: ' + ui.get('gameScore').textContent);
check(ui.get('playerScoreMeta').textContent.endsWith('purse ' + endPurse.toFixed(2)),
	'player score details have no purse: ' + ui.get('playerScoreMeta').textContent);
check(ui.get('rivalScore1').textContent !== '—' && ui.get('rivalMeta1').textContent.includes('purse '),
	'R1 score row not populated: ' + ui.get('rivalScore1').textContent + ' · ' + ui.get('rivalMeta1').textContent);
console.log('game score:', ui.get('gameScore').textContent, '· R1', ui.get('rivalScore1').textContent,
	'·', ui.get('cargoStatus').textContent,
	'· watched at ×4 then reset');

env.click('gameCopy');
const link = env.clipboardText || '';
check(link.startsWith(env.context.location.href.split('#')[0] + '#game=1&seed=7&rate=2&bot=normal&shots='), 'link: ' + link);
const decoded = pageGame.decodeLink(link.slice(link.indexOf('#')));
check(decoded && decoded.bot === 'normal' && decoded.shots.length === 2 &&
	decoded.shots[0].abort === abortSteps &&
	decoded.end.visited === endVisited && decoded.end.steps === endSteps, 'link does not carry the run');
console.log('replay link:', link.slice(link.indexOf('#')));

/* copy rival exports Rival 1's own solo trajectory and verifies */
check(!ui.get('botCopy').disabled, 'copy rival disabled after rival launched');
env.click('botCopy');
const rLink = env.clipboardText || '';
check(rLink.includes('#game=1&seed=7&rate=2&shots='), 'rival link malformed: ' + rLink);

env.setHash(link.slice(link.indexOf('#')));
env.runFrames(2, 16.0);
check(gScene.replay.on && ui.get('cargoStatus').textContent.startsWith('replay'), 'link did not start a replay');
check(!ui.get('replaySkip').hidden && ui.get('tradeSpeed').disabled, 'replay controls');
env.click('replaySkip');
env.runFrames(2, 16.0);
check(ui.get('replayReadout').textContent === 'verified ✓ · purse ' +
	game.money.purse.toFixed(2), 'replay verdict: ' + ui.get('replayReadout').textContent);
check(Math.abs(game.money.purse - endPurse) < 1e-9, 'replay purse differs: ' +
	game.money.purse + ' vs ' + endPurse);
check(cargo.cargo.x === endX && cargo.cargo.y === endY && sim.t === endT, 'replayed end state differs');
check(game.shots.length === 2 && !ui.get('replayRow').hidden, 'replay did not hand over the run');
console.log('replay verdict:', ui.get('replayReadout').textContent, '· cargo end identical, trade t identical');

/* money: a purse below the launch fee refuses launches and ends the run */
game.money.purse = 0.4;
env.runFrames(8, 16.0);
check(ui.get('launch').disabled && ui.get('launch').textContent === 'purse 0.40 · need 1.00',
	'broke launch button: ' + ui.get('launch').textContent);
check(ui.get('cargoStatus').textContent === 'purse empty · run over',
	'broke status: ' + ui.get('cargoStatus').textContent);
check(ui.get('gamePurse').classList.contains('loss'), 'broke purse not marked as loss');
env.dragAim(0, 1.2, 150);
env.runFrames(2, 16.0);
env.click('launch');
check(game.shots.length === 2, 'a broke run accepted a launch');
console.log('broke run: launch refused,', ui.get('launch').textContent);

/* route rule: one traced plan per player; longest finished trajectory leads */
env.choose('ruleRoute');
env.runFrames(2, 16.0);
check(game.on && gScene.rule() === 'route' && game.shots.length === 0, 'rule switch did not restart the run');
check(ui.get('ruleTag').textContent === 'route · longest one plan', 'rule tag: ' + ui.get('ruleTag').textContent);
check(ui.get('scoreRuleTag').textContent === 'route · longest one plan', 'route scoreboard label');
check(ui.get('launch').disabled && ui.get('launch').textContent.includes('no launch'),
	'route still offers a launch: ' + ui.get('launch').textContent);
check(ui.get('purseRow').hidden && ui.get('visitLabel').textContent === 'route score',
	'route HUD still foregrounds purse/systems');
for (let i = 0; i < 1000 && !gScene.bot.rivals[0].routeDone; i++) env.runFrames(1, 16.0);
check(gScene.bot.rivals[0].routeDone && gScene.bot.rivals[0].routeReady,
	'route rival never finished planning');
const occupied = gScene.bot.rivals[0].routeOrigin;
check(occupied >= 0 && gScene.routeOccupiedBy(occupied) === 0,
	'route rival origin is not reported occupied');
env.calls.texts.length = 0;
env.dragAim(occupied, 0.35, 180);
env.runFrames(2, 16.0);
check(game.shots.length === 0 && !gScene.routePlan().ready,
	'occupied route start accepted a player plan');
check(env.calls.texts.some(t => t.includes('occupied by R1') &&
	t.includes('choose another start planet')),
	'occupied route tip missing: ' + env.calls.texts.join(' | '));

const routeShot = findShot((g, p) => p !== occupied &&
	(g.predReason === pageSim.END_IMPACT || g.predReason === pageSim.END_EXIT) &&
	g.predTime > 5);
dragShot(routeShot);
for (let i = 0; i < 200 && !gScene.routePlan().ready; i++) env.runFrames(1, 16.0);
env.runFrames(2, 16.0);
const routePlan = gScene.routePlan();
const routeTime = cargo.predTime;
const routePoints = cargo.predCount;
check(routePlan.ready && routePlan.origin === routeShot.p && routePlan.length > 0,
	'route plan did not become the player entry');
check(cargo.status !== pageSim.STATUS_FLYING && sim.t === 420,
	'route planner flew a ship or advanced the world clock');
check(game.shots.length === 1 && game.shots[0].origin === routeShot.p,
	'route did not record exactly one plan');
check(cargo.routeMaxSteps === pageGame.ROUTE_STEPS + 2 && !cargo.routeActive,
	'route preview is not the full safety horizon: ' + cargo.routeMaxSteps);
check(routePoints > 100, 'route preview has too few points');

/* a shorter adjustment cannot overwrite the saved best; restore exact snapped inputs */
const savedBestLength = routePlan.length;
const savedBestShot = Object.assign({}, game.shots[0]);
check(gScene.routeBest().ready && gScene.routeBest().origin === routeShot.p &&
	gScene.routeBest().length === savedBestLength && !ui.get('routeBest').disabled,
	'finished route plan was not saved as best');
const shorterRouteShot = findShot((g, p) => p === routeShot.p &&
	(g.predReason === pageSim.END_IMPACT || g.predReason === pageSim.END_EXIT) &&
	g.predLength < savedBestLength - 1);
dragShot(shorterRouteShot);
for (let i = 0; i < 200 && !gScene.routePlan().ready; i++) env.runFrames(1, 16.0);
check(gScene.routePlan().ready && gScene.routePlan().length < savedBestLength &&
	gScene.routeBest().length === savedBestLength &&
	gScene.routeBest().angleU === savedBestShot.angle &&
	gScene.routeBest().speedU === savedBestShot.speed,
	'a weaker route adjustment overwrote the saved best');
env.click('routeBest');
env.runFrames(2, 16.0);
for (let i = 0; i < 200 && !gScene.routePlan().ready; i++) env.runFrames(1, 16.0);
check(gScene.routePlan().ready && gScene.routePlan().length === savedBestLength &&
	game.shots[0].origin === savedBestShot.origin && game.shots[0].angle === savedBestShot.angle &&
	game.shots[0].speed === savedBestShot.speed,
	'use best did not restore the exact route aim');
console.log('route best:', Math.round(gScene.routePlan().length) + ' px restored after',
	Math.round(shorterRouteShot.speed) + ' px/s weaker adjustment');

dragShot(routeShot);
for (let i = 0; i < 200 && cargo.routeActive; i++) env.runFrames(1, 16.0);
check(cargo.predTime === routeTime && cargo.predCount === routePoints && game.shots.length === 1,
	'route plan replacement is not repeatable/one-shot');
env.click('launch');
env.runFrames(10, 16.0);
check(cargo.status !== pageSim.STATUS_FLYING && game.shots.length === 1,
	'route launch button started a flight');
const routeScore = ui.get('gameScore').textContent;
check(routeScore === Math.round(routePlan.length) + ' px',
	'route score is not the one plan length: ' + routeScore);
check(!ui.get('scoreRival1').hidden && ui.get('rivalScore1').textContent.endsWith(' px'),
	'route rival score does not include plan length: ' + ui.get('rivalScore1').textContent);
check(Math.round(gScene.routeLength()) === Math.round(routePlan.length), 'route length mismatch');
check(ui.get('cargoStatus').textContent.startsWith('leader ·'),
	'route leader is not shown live: ' + ui.get('cargoStatus').textContent);
console.log('route planner:', routeScore, '· rival', ui.get('rivalScore1').textContent,
	'·', ui.get('cargoStatus').textContent, '· traced', routeTime.toFixed(1) + ' s in',
	routePoints, 'points · occupied P' + occupied + ' refused');

env.click('gameCopy');
const routeLink = env.clipboardText || '';
const routeDecoded = pageGame.decodeLink(routeLink.slice(routeLink.indexOf('#')));
check(routeLink.indexOf('&rule=route&') > 0 && routeDecoded && routeDecoded.shots.length === 1 &&
	routeDecoded.length === Math.round(routePlan.length),
	'route link does not carry one plan + length: ' + routeLink);
const routeEndX = cargo.predX[cargo.predCount - 1];
const routeEndY = cargo.predY[cargo.predCount - 1];
const routeSteps = gScene.scoreSteps();
env.setHash(routeLink.slice(routeLink.indexOf('#')));
env.runFrames(2, 16.0);
check(gScene.rule() === 'route' && gScene.replay.on && gScene.replay.route,
	'the link did not replay as a route plan');
check(ui.get('replaySpeed').hidden && ui.get('cargoStatus').textContent === 'replay · tracing plan',
	'route replay still presents flight playback controls/status');
env.click('replaySkip');
env.runFrames(2, 16.0);
check(ui.get('replayReadout').textContent === 'verified ✓ · ' + Math.round(routePlan.length) + ' px',
	'route replay verdict: ' + ui.get('replayReadout').textContent);
check(cargo.predX[cargo.predCount - 1] === routeEndX &&
	cargo.predY[cargo.predCount - 1] === routeEndY && sim.t === 420 &&
	gScene.scoreSteps() === routeSteps && cargo.status !== pageSim.STATUS_FLYING,
	'route replay did not retrace the same plan without flying');
console.log('route replay:', ui.get('replayReadout').textContent, '·', routeLink.slice(routeLink.indexOf('#')).length,
	'char link · world stayed at t+07:00');

/* best is scoped to the start planet and is invalidated by a fresh run */
dragShot(routeShot);
for (let i = 0; i < 200 && !gScene.routePlan().ready; i++) env.runFrames(1, 16.0);
check(gScene.routeBest().ready && gScene.routeBest().origin === routeShot.p,
	'manual route did not recreate its best after replay');
const otherRouteShot = findShot((g, p) => p !== occupied && p !== routeShot.p &&
	(g.predReason === pageSim.END_IMPACT || g.predReason === pageSim.END_EXIT) && g.predTime > 1);
env.dragAim(otherRouteShot.p, otherRouteShot.angle, otherRouteShot.speed);
check(!gScene.routeBest().ready && ui.get('routeBest').disabled,
	'changing the route start planet kept the old planet best');
env.runFrames(2, 16.0);
for (let i = 0; i < 200 && !gScene.routePlan().ready; i++) env.runFrames(1, 16.0);
check(gScene.routeBest().ready && gScene.routeBest().origin === otherRouteShot.p,
	'new route start did not get its own best');
env.click('gameRestart');
env.runFrames(2, 16.0);
check(!gScene.routeBest().ready && ui.get('routeBest').disabled && game.shots.length === 0,
	'restart did not clear the saved route best');

/* continuous mid-drag sweep: best is captured during pointermove without pointerup */
{
	const origin = env.planetScreen(routeShot.p);
	const reachBest = cargo.gripLength(routeShot.speed) * env.context.OrbitScene.view.scale;
	const reachShort = cargo.gripLength(shorterRouteShot.speed) * env.context.OrbitScene.view.scale;
	env.fireWindow('pointerdown', { button: 0, clientX: origin.x, clientY: origin.y, target: ui.get('c'), shiftKey: false });
	env.fireWindow('pointermove', {
		clientX: origin.x + Math.cos(routeShot.angle) * reachBest,
		clientY: origin.y + Math.sin(routeShot.angle) * reachBest,
		target: ui.get('c'),
		shiftKey: false
	});
	env.runFrames(1, 16.0);
	check(gScene.routeBest().ready && Math.round(gScene.routeBest().length) === Math.round(savedBestLength),
		'continuous drag did not capture best on single move frame');
	env.fireWindow('pointermove', {
		clientX: origin.x + Math.cos(shorterRouteShot.angle) * reachShort,
		clientY: origin.y + Math.sin(shorterRouteShot.angle) * reachShort,
		target: ui.get('c'),
		shiftKey: false
	});
	env.runFrames(1, 16.0);
	env.fireWindow('pointerup', {
		clientX: origin.x + Math.cos(shorterRouteShot.angle) * reachShort,
		clientY: origin.y + Math.sin(shorterRouteShot.angle) * reachShort,
		target: ui.get('c'),
		shiftKey: false
	});
	env.runFrames(1, 16.0);
	check(Math.round(gScene.routeBest().length) === Math.round(savedBestLength) &&
		ui.get('routeBest').classList.contains('on'),
		'use best did not stay armed and highlighted after sweeping past peak');
	env.click('clear');
	env.runFrames(1, 16.0);
	check(!gScene.routePlan().ready && gScene.routeBest().ready && !ui.get('routeBest').disabled,
		'clear plan discarded saved routeBest instead of keeping recovery button');
	env.click('routeBest');
	env.runFrames(2, 16.0);
	check(gScene.routePlan().ready && Math.round(gScene.routePlan().length) === Math.round(savedBestLength),
		'use best after clear plan did not restore peak trajectory');
	env.click('gameRestart');
	env.runFrames(2, 16.0);
}

/* Scoreboard: every player row has a bot checkbox; clicking user rows switches active user */
check(ui.get('scorePlayer').tagName === 'DIV' &&
	ui.get('scoreRival1').tagName === 'DIV' &&
	ui.get('scoreRival2').tagName === 'DIV',
	'player score rows must be DIV containers so row click does not toggle checkbox');
check(!ui.get('playerBot').checked && ui.get('rivalBot1').checked && ui.get('rivalBot2').checked,
	'default bot checkboxes should be YOU=unchecked, R1=checked, R2=checked');
env.click('scorePlayer');
check(!ui.get('playerBot').checked && gScene.activeSlot() === 0,
	'clicking YOU score row toggled bot instead of selecting user');

/* Multi-user switching on hard (3 players: YOU=user, R1=user, R2=bot) */
env.choose('botHard');
env.runFrames(2, 16.0);
env.toggle('rivalBot1');
env.runFrames(2, 16.0);
check(gScene.slotType(0) === 'user' && gScene.slotType(1) === 'user' && gScene.slotType(2) === 'bot',
	'unchecking rivalBot1 did not switch R1 to user');
check(gScene.activeSlot() === 0 && ui.get('scorePlayer').classList.contains('isActive') &&
	ui.get('scoreRival1').classList.contains('isUser') && !ui.get('scoreRival2').classList.contains('isUser'),
	'scoreboard active/user classes mismatch');
for (let i = 0; i < 600 && gScene.bot.routeThinking(); i++) env.runFrames(1, 16.0);
const r2Occupied = gScene.bot.rivals[1].routeOrigin;
const youMultiShot = findShot((g, p) => p !== r2Occupied &&
	(g.predReason === pageSim.END_IMPACT || g.predReason === pageSim.END_EXIT) && g.predTime > 2);
dragShot(youMultiShot);
env.runFrames(2, 16.0);
const youMultiLen = gScene.routePlan().length;
check(youMultiLen > 0 && gScene.routeBest().origin === youMultiShot.p, 'YOU route plan in multi-user failed');

/* Pressing R1 row switches active user to R1; pressing R2 (bot) row does not switch */
env.click('scoreRival2');
check(gScene.activeSlot() === 0, 'clicking bot row R2 switched active user');
env.click('scoreRival1');
env.runFrames(1, 16.0);
check(gScene.activeSlot() === 1 && !ui.get('rivalBot1').checked &&
	ui.get('scoreRival1').classList.contains('isActive') &&
	!ui.get('scorePlayer').classList.contains('isActive'),
	'clicking user row R1 did not switch active user to R1');
check(gScene.routeOccupiedBy(youMultiShot.p) === gScene.bot.constructor.PLAYER_INDEX,
	'YOU planet was not marked occupied when playing as R1');
check(!gScene.routeBest().ready, 'R1 inherited YOU routeBest');
const r1MultiShot = findShot((g, p) => p !== r2Occupied && p !== youMultiShot.p &&
	(g.predReason === pageSim.END_IMPACT || g.predReason === pageSim.END_EXIT) && g.predTime > 2);
env.dragAim(r1MultiShot.p, r1MultiShot.angle, r1MultiShot.speed);
env.runFrames(2, 16.0);
check(gScene.routePlan().ready && gScene.routePlan().origin === r1MultiShot.p &&
	gScene.routeBest().origin === r1MultiShot.p,
	'R1 manual route plan was not recorded independently');
env.click('scorePlayer');
env.runFrames(1, 16.0);
check(gScene.activeSlot() === 0 && gScene.routePlan().origin === youMultiShot.p &&
	Math.round(gScene.routeBest().length) === Math.round(youMultiLen) &&
	gScene.routeOccupiedBy(r1MultiShot.p) === 0,
	'switching back to YOU did not preserve YOU plan/best or R1 occupation');
env.toggle('rivalBot1');
env.choose('botNormal');
env.runFrames(2, 16.0);
for (let i = 0; i < 600 && gScene.bot.routeThinking(); i++) env.runFrames(1, 16.0);

/* YOU can be a bot: the scoreboard checkbox plans in route mode, then auto-launches under tour */
check(!ui.get('playerBot').checked, 'YOU bot checkbox should start unchecked');
env.toggle('playerBot');
env.runFrames(2, 16.0);
check(gScene.playerType() === 'bot' && ui.get('playerBot').checked,
	'YOU=bot was not selected in the scoreboard');
check(!ui.get('playerBot').disabled, 'the YOU switch locked itself after switching to bot');
for (let i = 0; i < 1000 && (!gScene.routePlan().ready || cargo.predCount < 2 ||
	cargo.routeActive); i++) env.runFrames(1, 16.0);
check(gScene.routePlan().ready && game.shots.length === 1 && cargo.predCount >= 2,
	'bot-controlled YOU did not produce a visible route plan: plan=' +
	JSON.stringify(gScene.routePlan()) + ' playerActor=' +
	JSON.stringify({ origin: gScene.bot.player.routeOrigin, ready: gScene.bot.player.routeReady,
		done: gScene.bot.player.routeDone, version: gScene.bot.player.routeVersion }) +
	' shots=' + game.shots.length + ' pred=' + cargo.predCount);
check(gScene.routeOccupiedBy(gScene.routePlan().origin) < 0,
	'bot-controlled YOU claimed a rival route start');
const botRouteLength = gScene.routePlan().length;
env.click('gameCopy');
const botLink = env.clipboardText || '';
const botDecoded = pageGame.decodeLink(botLink.slice(botLink.indexOf('#')));
check(botDecoded && botDecoded.player === 'bot' && botDecoded.shots.length === 1,
	'YOU=bot route link: ' + botLink);
env.choose('ruleTour');
env.runFrames(2, 16.0);
for (let i = 0; i < 500 && game.shots.length === 0; i++) env.runFrames(1, 16.0);
check(gScene.rule() === 'tour' && gScene.playerType() === 'bot' && game.shots.length >= 1,
	'bot-controlled YOU did not auto-launch a tour shot');
check(ui.get('launch').disabled && ui.get('launch').textContent === 'bot controls YOU',
	'manual launch stayed available for bot-controlled YOU');
check(!ui.get('playerBot').disabled && !ui.get('scorePlayer').classList.contains('locked'),
	'the YOU switch is locked while the bot flies, so user control cannot be taken back');
console.log('YOU=bot: route planned', Math.round(botRouteLength) + ' px',
	'· tour auto-launched from P' + game.shots[0].origin);
env.toggle('playerBot');
env.runFrames(2, 16.0);
check(gScene.playerType() === 'user' && !ui.get('playerBot').checked, 'YOU=user was not restored');
check(!ui.get('playerBot').disabled && cargo.status !== pageSim.STATUS_FLYING,
	'taking control back mid-bot-flight did not restart the run as a user');

/* money rule + hard rivals (2 rivals on canvas) + solo toggle */
env.choose('ruleMoney');
env.choose('botHard');
env.calls.texts.length = 0;
env.runFrames(2, 16.0);
check(gScene.rule() === 'money' && gScene.botLevel() === 'hard', 'money/hard switch failed');
check(ui.get('ruleTag').textContent === 'money · 10 shots', 'money ruleTag: ' + ui.get('ruleTag').textContent);
check(ui.get('scoreRuleTag').textContent === 'money · 10 shots', 'money scoreboard rule label');
check(ui.get('gameScore').textContent === '3.00 purse' &&
	ui.get('playerScoreMeta').textContent.includes('0 / 10 shots'),
	'money score format: ' + ui.get('gameScore').textContent + ' · ' + ui.get('playerScoreMeta').textContent);
check(!ui.get('scoreRival1').hidden && !ui.get('scoreRival2').hidden &&
	ui.get('rivalScore1').textContent === '3.00 purse' &&
	ui.get('rivalScore2').textContent === '3.00 purse',
	'money rule did not show both bot scores');
check(env.calls.texts.includes('R1') && env.calls.texts.includes('R2'),
	'hard mode did not draw R1 and R2 tags: ' + env.calls.texts.join(' '));
env.choose('botOff');
env.runFrames(2, 16.0);
check(gScene.botLevel() === 'off' && ui.get('rivalRow').hidden && ui.get('scoreRival1').hidden &&
	ui.get('scoreRival2').hidden && ui.get('botCopy').hidden &&
	ui.get('rivalTag').textContent === 'solo', 'botOff UI state');
console.log('money & rivals UI:', ui.get('ruleTag').textContent, '· hard R1/R2 + solo verified');

env.choose('modeLab');
env.runFrames(2, 16.0);
check(ui.get('modeTag').textContent === 'lab · free clock' && ui.get('gameBox').hidden, 'back to lab');
check(ui.get('scoreHud').hidden, 'scoreboard should hide in lab mode');
check(!ui.get('tradePause').disabled && !ui.get('tradeSpeed').disabled, 'lab controls still locked');
const labT = sim.t;
env.runFrames(30, 16.0);
check(sim.t > labT, 'lab clock did not resume');

/* a challenge link (no shots) keeps its rate; without a clipboard the link field shows */
const challenge = loadPage({ hash: '#game=1&seed=42&rate=1', clipboard: false });
challenge.runFrames(2, 16.0);
const cui = challenge.elements;
check(challenge.context.GravityScene.game.seed === 42 && challenge.context.OrbitScene.sim.seed === 42, 'challenge seed');
check(cui.get('tradeSpeed').disabled && cui.get('gameSeed').textContent === 'seed 42 · ×1', 'challenge rate not fixed');
challenge.click('gameCopy');
check(!cui.get('gameLink').hidden && cui.get('gameLink').value.endsWith('#game=1&seed=42&rate=1'), 'copy fallback');
challenge.setHash('#game=1&seed=0&rate=1');
check(cui.get('modeTag').textContent === 'invalid game link', 'invalid link note');
console.log('challenge link: seed 42 ×1 locked · fallback field', cui.get('gameLink').value.slice(-24),
	'· invalid link noted');

/* solo money run: a flight launched with the purse dipping below the fee must still land */
const soloEnv = loadPage({ hash: '#game=1&seed=31&rate=3&rule=money', clipboard: false });
soloEnv.runFrames(2, 16.7);
const soloScene = soloEnv.context.GravityScene;
const soloCargo = soloScene.sim;
check(soloScene.bot.count === 0 && soloEnv.elements.get('rivalRow').hidden, 'solo money run');
function cheapShot(p) {
	for (let a = 0; a < 72; a++) {
		const angle = a / 72 * Math.PI * 2;
		soloCargo.predict(p, angle, 250);
		if (soloCargo.predNewVisits <= 1 && soloCargo.predReason !== pageSim.END_OPEN && soloCargo.predTime > 1) return angle;
	}
	throw new Error('no cheap shot from P' + p);
}
let soloShots = 0;
while (soloScene.game.money.purse >= 1 && soloShots < 6) {
	const p = soloCargo.landedBody >= 0 ? soloCargo.landedBody : 5;
	soloEnv.dragAim(p, cheapShot(p), 250);
	soloEnv.runFrames(1, 16.7);
	soloEnv.click('launch');
	soloShots += 1;
	let frames = 0;
	for (; soloCargo.status === pageSim.STATUS_FLYING && frames < 3000; frames++) soloEnv.runFrames(1, 16.7);
	check(soloCargo.status === pageSim.STATUS_ENDED, 'solo flight ' + soloShots + ' stalled at step ' + soloCargo.liveSteps +
		' with purse ' + soloScene.game.money.purse.toFixed(2));
}
check(soloScene.game.money.purse < 1 && soloEnv.elements.get('cargoStatus').textContent === 'purse empty · run over',
	'solo broke status: ' + soloEnv.elements.get('cargoStatus').textContent);
console.log('solo money:', soloShots, 'shots · broke flight landed · purse', soloScene.game.money.purse.toFixed(2));

/* career via ?rule=career: ship on HQ, only its pad launches, a landing elsewhere strands */
const careerEnv = loadPage({ search: '?rule=career&seed=42&rate=1', clipboard: false });
careerEnv.runFrames(2, 16.0);
const kui = careerEnv.elements;
const kScene = careerEnv.context.GravityScene;
const kGame = careerEnv.context.GravityGame;
const kSim = careerEnv.context.GravitySim;
const career = kScene.career;
const kCargo = kScene.sim;
check(kScene.game.rule === 'career' && kScene.bot.level === 'off' && kScene.bot.count === 0 &&
	kScene.bot.playerType === 'user', 'career is solo: ' + kScene.bot.level + ' ' + kScene.bot.playerType);
check(career.at === career.hq && kCargo.landedBody === career.hq && career.padCount === 1, 'career start on HQ');
check(kui.get('cargoStatus').textContent === 'landed P' + career.hq + ' · clock paused',
	'career status: ' + kui.get('cargoStatus').textContent);
check(kui.get('ruleTag').textContent === 'career · 1 / 26 pads', 'career rule tag: ' + kui.get('ruleTag').textContent);
check(kui.get('rivalTag').textContent === 'solo' && kui.get('rivalRow').hidden, 'career hides rivals');
check(kui.get('gameScore').textContent === '6.00 purse', 'career score is the purse: ' + kui.get('gameScore').textContent);
const noPad = (career.hq + 3) % pageWorld.PLANETS;
careerEnv.dragAim(noPad, 0.7, 100);
careerEnv.runFrames(2, 16.0);
check(kui.get('launch').disabled && kCargo.status !== kSim.STATUS_FLYING, 'no catapult: drag from P' + noPad + ' must not arm');
const limit = kCargo.speedLimit(career.hq);
check(limit > 100 && limit < 125, 'HQ speed limit ' + limit);
careerEnv.dragAim(career.hq, 0.7, 200);
careerEnv.runFrames(2, 16.0);
check(kui.get('launch').disabled && kui.get('launch').textContent.startsWith('pad charge '),
	'over the limit the pad note shows: ' + kui.get('launch').textContent);
let landingShot = null;
for (let a = 0; a < 72 && !landingShot; a++) {
	const angle = a / 72 * Math.PI * 2;
	kCargo.predict(career.hq, angle, 100);
	if (kCargo.predReason === kSim.END_IMPACT && kCargo.predBody !== career.hq) landingShot = angle;
}
check(landingShot !== null, 'no landing shot from HQ at 100 px/s');
careerEnv.dragAim(career.hq, landingShot, 100);
careerEnv.runFrames(2, 16.0);
check(!kui.get('launch').disabled && kui.get('launch').textContent === 'launch',
	'career launch label: ' + kui.get('launch').textContent);
const charge0 = career.pads[career.hq].chargeKwh;
const purse0 = kScene.game.money.purse;
careerEnv.click('launch');
careerEnv.runFrames(2, 16.0);
check(kCargo.status === kSim.STATUS_FLYING && career.flights === 1, 'career flight did not start');
check(career.pads[career.hq].chargeKwh < charge0, 'launch did not draw the pad battery');
for (let i = 0; i < 400 && kCargo.status === kSim.STATUS_FLYING; i++) careerEnv.runFrames(1, 40.0);
check(kCargo.status === kSim.STATUS_ENDED && kCargo.endReason === kSim.END_IMPACT, 'career flight end ' + kCargo.endReason);
check(career.at === kCargo.endBody && career.stranded, 'landing without a catapult must strand');
check(kScene.game.money.purse >= purse0, 'no launch fee in career: ' + kScene.game.money.purse);
check(kui.get('cargoStatus').textContent === 'stranded · build a catapult or evacuate',
	'stranded status: ' + kui.get('cargoStatus').textContent);
check(kui.get('launch').disabled && kui.get('launch').textContent === 'stranded · build a catapult or evacuate',
	'stranded launch button: ' + kui.get('launch').textContent);
const strandedAt = career.at;
check(kGame.evacuate(career, kCargo) && career.at === career.hq && !career.stranded, 'evacuate home');
careerEnv.runFrames(8, 40.0);
check(kui.get('cargoStatus').textContent === 'landed P' + career.hq + ' · clock paused',
	'after evacuation: ' + kui.get('cargoStatus').textContent);
careerEnv.click('gameCopy');
check(kui.get('gameLink').value.endsWith('#game=1&seed=42&rate=1&rule=career'), 'career link ' + kui.get('gameLink').value);
careerEnv.choose('modeLab');
careerEnv.runFrames(2, 16.0);
check(kCargo.pads === null && kCargo.landedBody === career.hq && kCargo.canLaunchFrom(career.hq),
	'lab drops the launch network but keeps the landed ship');
const cheatEnv = loadPage({ hash: '#game=1&seed=42&rate=1&rule=career&cheat=endgame', clipboard: false });
cheatEnv.runFrames(2, 16.0);
const cheatCareer = cheatEnv.context.GravityScene.career;
check(cheatCareer.cheat === 'endgame' && cheatCareer.padCount === pageWorld.PLANETS &&
	cheatEnv.context.GravityScene.game.money.purse === kGame.CAREER.endgamePurse, 'endgame cheat link');
check(cheatEnv.elements.get('ruleTag').textContent === 'career · 26 / 26 pads · endgame',
	'cheat rule tag: ' + cheatEnv.elements.get('ruleTag').textContent);
cheatEnv.click('gameCopy');
check(cheatEnv.elements.get('gameLink').value.endsWith('&rule=career&cheat=endgame'), 'cheat survives the link');
const badCheat = loadPage({ hash: '#game=1&seed=42&rate=1&rule=tour&cheat=endgame', clipboard: false });
badCheat.runFrames(2, 16.0);
check(badCheat.elements.get('modeTag').textContent === 'invalid game link', 'cheat outside career rejected');
console.log('career:', 'HQ P' + career.hq, '· limit', limit.toFixed(0), 'px/s · stranded P' + strandedAt,
	'→ evacuated · endgame cheat link ok');

console.log('paint calls', {
	fillText: env.calls.fillText,
	stroke: env.calls.stroke,
	fill: env.calls.fill
});
console.log('SMOKE OK');
