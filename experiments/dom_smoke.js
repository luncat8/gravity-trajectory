/*
 * Headless smoke test: loads the page scripts in a vm with a stub DOM/canvas,
 * runs frames, aims a shot, edits gravity and checks the clocks stay separate.
 * Run: node experiments/dom_smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function makeContext() {
	const calls = { fillText: 0, stroke: 0, fill: 0, texts: [] };
	const paint = {
		fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
		font: '', textAlign: '', textBaseline: '',
		beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
		ellipse() {}, closePath() {}, strokeRect() {}, fillRect() {},
		clearRect() {}, drawImage() {}, setTransform() {}, save() {},
		restore() {}, translate() {}, scale() {}, setLineDash() {},
		fillText(text) {
			calls.fillText += 1;
			if (calls.texts.length < 64) calls.texts.push(String(text));
		},
		stroke() { calls.stroke += 1; },
		fill() { calls.fill += 1; },
		measureText(text) { return { width: String(text).length * 6.5 }; },
		createLinearGradient() { return { addColorStop() {} }; },
		createRadialGradient() { return { addColorStop() {} }; }
	};
	const elements = new Map();
	const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
	for (const id of ids) {
		const checked = new RegExp('id="' + id + '"[^>]*\\bchecked\\b').test(html);
		const valueMatch = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"'));
		const isCanvas = id === 'c' || id === 'g';
		elements.set(id, {
			id: id,
			tagName: isCanvas ? 'CANVAS' : id === 'tradePause' || id === 'launch' ||
				id === 'clear' ? 'BUTTON' : id === 'gravity' || id === 'trim' ||
				id === 'tradeSpeed' || id === 'horizon' || id === 'srcPlanets' ||
				id === 'srcPorts' ? 'INPUT' : 'DIV',
			style: {},
			textContent: '',
			value: valueMatch ? valueMatch[1] : '',
			checked: checked,
			disabled: false,
			className: '',
			listeners: {},
			classList: { toggle() {}, add() {}, remove() {} },
			addEventListener(type, fn) {
				(this.listeners[type] || (this.listeners[type] = [])).push(fn);
			},
			getContext() { return paint; },
			getBoundingClientRect() {
				return { left: 0, top: 0, width: 1280, height: 800 };
			},
			appendChild() {},
			setPointerCapture() {}
		});
	}

	const windowListeners = {};
	let now = 1000;
	let rafQueue = [];
	const context = {
		console: console,
		Math: Math,
		Float64Array: Float64Array,
		Uint8Array: Uint8Array,
		Uint32Array: Uint32Array,
		Infinity: Infinity,
		performance: { now: () => now },
		requestAnimationFrame(fn) { rafQueue.push(fn); },
		addEventListener(type, fn) {
			(windowListeners[type] || (windowListeners[type] = [])).push(fn);
		},
		document: {
			getElementById(id) { return elements.get(id) || null; },
			createElement(tag) {
				return {
					tagName: String(tag).toUpperCase(),
					width: 0,
					height: 0,
					style: {},
					getContext() { return paint; }
				};
			}
		},
		innerWidth: 1280,
		innerHeight: 800,
		devicePixelRatio: 1
	};
	context.window = context;
	return {
		context,
		elements,
		windowListeners,
		paint,
		calls,
		fireWindow(type, event) {
			const list = windowListeners[type] || [];
			for (const fn of list) fn(event);
		},
		fireElement(element, type, event) {
			const list = element.listeners[type] || [];
			for (const fn of list) fn(event);
		},
		runFrames(count, stepMs) {
			for (let i = 0; i < count; i++) {
				now += stepMs || 16.7;
				const queue = rafQueue;
				rafQueue = [];
				for (const fn of queue) fn(now);
			}
		},
		now() { return now; },
		advance(ms) { now += ms; }
	};
}

const env = makeContext();
vm.createContext(env.context);
for (const file of ['exec_queue.js', 'orbit_world.js', 'orbit_econ.js', 'orbit_sim.js',
	'orbit_view.js', 'gravity_sim.js', 'gravity_gui.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), env.context, { filename: file });
}

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

/* resize must re-share the camera */
env.context.innerWidth = 900;
env.context.innerHeight = 620;
env.fireWindow('resize', {});
env.runFrames(2);
console.log('after resize scale', view.scale.toFixed(3), 'offX', view.offX.toFixed(1),
	'canvas', ui.get('g').width + 'x' + ui.get('g').height);

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
env.fireElement(ui.get('helpBtn'), 'click', {});
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

console.log('paint calls', {
	fillText: env.calls.fillText,
	stroke: env.calls.stroke,
	fill: env.calls.fill
});
console.log('SMOKE OK');
