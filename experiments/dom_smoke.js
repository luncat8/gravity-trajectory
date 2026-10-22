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

/* help drawer GUI + random(tourist, emperor’s emissary) goal */
const gScene = env.context.GravityScene;
const firstRole = gScene.passenger();
if (firstRole !== 'tourist' && firstRole !== 'emperor’s emissary') {
	throw new Error('unexpected initial passenger: ' + firstRole);
}
env.fireElement(ui.get('helpBtn'), 'pointerenter', { pointerType: 'mouse' });
if (!gScene.helpOpen()) throw new Error('help hover did not open');
env.fireElement(ui.get('helpBtn'), 'pointerleave', {});
if (gScene.helpOpen()) throw new Error('hover help did not close on leave');
env.fireElement(ui.get('helpBtn'), 'pointerenter', { pointerType: 'mouse' });
env.fireElement(ui.get('helpBtn'), 'click', {});
env.fireElement(ui.get('helpBtn'), 'pointerleave', {});
if (!gScene.helpOpen()) throw new Error('clicked help did not stay pinned');

if (!gScene.helpOpen()) throw new Error('help drawer did not open');
env.fireElement(ui.get('rerollGoal'), 'click', {});
const secondRole = gScene.passenger();
if (secondRole === firstRole ||
	(secondRole !== 'tourist' && secondRole !== 'emperor’s emissary') ||
	!ui.get('goalStory').textContent.includes(secondRole)) {
	throw new Error('goal reroll mismatch: ' + firstRole + ' -> ' + secondRole);
}
env.fireElement(ui.get('helpClose'), 'click', {});
if (gScene.helpOpen()) throw new Error('help drawer did not close');
console.log('help drawer roles:', firstRole, '->', secondRole);

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
check(ui.get('gameScore').textContent.endsWith('purse ' + endPurse.toFixed(2)),
	'score has no purse: ' + ui.get('gameScore').textContent);
console.log('game score:', ui.get('gameScore').textContent, '·', ui.get('cargoStatus').textContent,
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

/* route rule: no flight cap, and the run scores the length it flew */
env.choose('ruleRoute');
env.runFrames(2, 16.0);
check(game.on && gScene.rule() === 'route' && game.shots.length === 0, 'rule switch did not restart the run');
check(ui.get('ruleTag').textContent.startsWith('route ·'), 'rule tag: ' + ui.get('ruleTag').textContent);
const routeShot = findShot((g, p) => g.predReason === pageSim.END_IMPACT && g.predTime > 5);
dragShot(routeShot);
check(cargo.routeMaxSteps === pageGame.ROUTE_STEPS + 2 && !cargo.routeActive,
	'route preview is not the whole 1 800 s horizon: ' + cargo.routeMaxSteps);
const routeTime = cargo.predTime;
const routePoints = cargo.predCount;
check(cargo.predReason === pageSim.END_IMPACT && routePoints > 100, 'route preview did not finish');
dragShot(routeShot);
check(cargo.predTime === routeTime && cargo.predCount === routePoints, 'route preview is not repeatable');
env.click('launch');
check(cargo.stepLimit === pageGame.ROUTE_STEPS, 'route flight cap ' + cargo.stepLimit);
for (let i = 0; i < 4000 && cargo.status === pageSim.STATUS_FLYING; i++) env.runFrames(1, 16.0);
env.runFrames(2, 16.0);
check(cargo.status === pageSim.STATUS_ENDED, 'route flight did not end');
const routeScore = ui.get('gameScore').textContent;
check(routeScore.indexOf(' px · ') > 0, 'route score has no length: ' + routeScore);
check(Math.round(gScene.routeLength()) === Math.round(cargo.flightLength), 'route length not accumulated');
console.log('route rule:', routeScore, '·', ui.get('cargoStatus').textContent,
	'· traced', routeTime.toFixed(1) + ' s in', routePoints, 'points');

env.click('gameCopy');
const routeLink = env.clipboardText || '';
check(routeLink.indexOf('&rule=route&') > 0, 'route link: ' + routeLink);
const routeEndX = cargo.cargo.x;
const routeEndY = cargo.cargo.y;
const routeEndT = sim.t;
const routeSteps = gScene.scoreSteps();
env.setHash(routeLink.slice(routeLink.indexOf('#')));
env.runFrames(2, 16.0);
check(gScene.rule() === 'route' && gScene.replay.on, 'the link did not replay as a route run');
env.click('replaySkip');
env.runFrames(2, 16.0);
check(ui.get('replayReadout').textContent.startsWith('verified ✓'),
	'route replay verdict: ' + ui.get('replayReadout').textContent);
check(cargo.cargo.x === routeEndX && cargo.cargo.y === routeEndY && sim.t === routeEndT &&
	gScene.scoreSteps() === routeSteps, 'route replay end state differs');
console.log('route replay:', ui.get('replayReadout').textContent, '·', routeLink.slice(routeLink.indexOf('#')).length,
	'char link ·', gScene.rule(), 'rule');

/* money rule + hard rivals (2 rivals on canvas) + solo toggle */
env.choose('ruleMoney');
env.choose('botHard');
env.calls.texts.length = 0;
env.runFrames(2, 16.0);
check(gScene.rule() === 'money' && gScene.botLevel() === 'hard', 'money/hard switch failed');
check(ui.get('ruleTag').textContent === 'money · 10 shots', 'money ruleTag: ' + ui.get('ruleTag').textContent);
check(ui.get('gameScore').textContent.startsWith('0 / 10 shots · '),
	'money score format: ' + ui.get('gameScore').textContent);
check(env.calls.texts.includes('R1') && env.calls.texts.includes('R2'),
	'hard mode did not draw R1 and R2 tags: ' + env.calls.texts.join(' '));
env.choose('botOff');
env.runFrames(2, 16.0);
check(gScene.botLevel() === 'off' && ui.get('rivalRow').hidden && ui.get('botCopy').hidden &&
	ui.get('rivalTag').textContent === 'solo', 'botOff UI state');
console.log('money & rivals UI:', ui.get('ruleTag').textContent, '· hard R1/R2 + solo verified');

env.choose('modeLab');
env.runFrames(2, 16.0);
check(ui.get('modeTag').textContent === 'lab · free clock' && ui.get('gameBox').hidden, 'back to lab');
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

console.log('paint calls', {
	fillText: env.calls.fillText,
	stroke: env.calls.stroke,
	fill: env.calls.fill
});
console.log('SMOKE OK');
