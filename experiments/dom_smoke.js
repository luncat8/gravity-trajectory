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
	const calls = { fillText: 0, stroke: 0, fill: 0 };
	const paint = {
		fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
		font: '', textAlign: '', textBaseline: '',
		beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
		ellipse() {}, closePath() {}, strokeRect() {}, fillRect() {},
		clearRect() {}, drawImage() {}, setTransform() {}, save() {},
		restore() {}, translate() {}, scale() {}, setLineDash() {},
		fillText() { calls.fillText += 1; },
		stroke() { calls.stroke += 1; },
		fill() { calls.fill += 1; },
		measureText(text) { return { width: String(text).length * 6.5 }; },
		createLinearGradient() { return { addColorStop() {} }; },
		createRadialGradient() { return { addColorStop() {} }; }
	};
	const elements = new Map();
	const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
	for (const id of ids) {
		const checked = html.includes('id="' + id + '" type="checkbox" checked') ||
			html.includes('id="' + id + '" checked');
		const valueMatch = html.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"'));
		const isCanvas = id === 'c' || id === 'g';
		elements.set(id, {
			id: id,
			tagName: isCanvas ? 'CANVAS' : id === 'tradePause' || id === 'launch' ||
				id === 'clear' ? 'BUTTON' : id === 'gravity' || id === 'trim' ||
				id === 'tradeSpeed' ? 'INPUT' : 'DIV',
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

/* the econ scratch is ready for the colony wiring (step 2) */
if (!sim.mapOut || sim.mapOut.ease.length !== pageEcon.ALL) throw new Error('map scratch missing');
pageEcon.resourceMapFor(sim.world, 0, sim.seed, sim.mapOut);
if (!(sim.mapOut.score > 0)) throw new Error('resource map produced no score');
console.log('map at planet 0: score', sim.mapOut.score.toFixed(2),
	'food', sim.mapOut.ease[pageEcon.FOOD].toFixed(2),
	'rare', sim.mapOut.ease[pageEcon.RARE].toFixed(2));

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
console.log('gravity edit:', ui.get('planetTag').textContent,
	'slider', ui.get('gravityLabel').textContent);
if (!ui.get('planetTag').textContent.includes('repel')) throw new Error('repel label missing');

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

/* resize must re-share the camera */
env.context.innerWidth = 900;
env.context.innerHeight = 620;
env.fireWindow('resize', {});
env.runFrames(2);
console.log('after resize scale', view.scale.toFixed(3), 'offX', view.offX.toFixed(1),
	'canvas', ui.get('g').width + 'x' + ui.get('g').height);
console.log('paint calls', env.calls);
console.log('SMOKE OK');
