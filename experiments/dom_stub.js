/*
 * Headless page for node: runs index.html's classic scripts in a vm with a stub
 * DOM/canvas that records text paints, and drives frames, events, the URL hash
 * and the clipboard. Script order, element tags and initial attributes are read
 * from index.html, so the stub follows the page without a hand-kept list.
 * Used by dom_smoke.js and game_bench.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
const SOURCES = SCRIPTS.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const PAGE_URL = 'file:///gravity-trajectory/index.html';

function parseElements() {
	const list = [];
	for (const match of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
		const attrs = match[2];
		const id = /\bid="([^"]+)"/.exec(attrs);
		if (!id) continue;
		const value = /\bvalue="([^"]*)"/.exec(attrs);
		list.push({
			id: id[1],
			tagName: match[1].toUpperCase(),
			value: value ? value[1] : '',
			checked: /\bchecked\b/.test(attrs),
			disabled: /\bdisabled\b/.test(attrs),
			hidden: /\shidden\b/.test(attrs)
		});
	}
	return list;
}
const ELEMENTS = parseElements();

function makeClassList() {
	const names = new Set();
	return {
		toggle(name, force) {
			const on = force === undefined ? !names.has(name) : Boolean(force);
			if (on) names.add(name);
			else names.delete(name);
			return on;
		},
		add(name) { names.add(name); },
		remove(name) { names.delete(name); },
		contains(name) { return names.has(name); }
	};
}

function makePaint(calls) {
	return {
		fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineCap: 'butt',
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
}

function makeElement(spec, paint) {
	return {
		id: spec.id,
		tagName: spec.tagName,
		style: { setProperty() {} },
		textContent: '',
		title: '',
		value: spec.value,
		checked: spec.checked,
		disabled: spec.disabled,
		hidden: spec.hidden,
		className: '',
		width: 0,
		height: 0,
		listeners: {},
		classList: makeClassList(),
		addEventListener(type, fn) {
			(this.listeners[type] || (this.listeners[type] = [])).push(fn);
		},
		getContext() { return paint; },
		getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; },
		appendChild() {},
		setPointerCapture() {},
		focus() {},
		select() {}
	};
}

/*
 * options.hash: initial location hash ('' for none)
 * options.clipboard: false removes navigator.clipboard (insecure-context fallback)
 */
function loadPage(options = {}) {
	const calls = { fillText: 0, stroke: 0, fill: 0, texts: [] };
	const paint = makePaint(calls);
	const elements = new Map();
	for (const spec of ELEMENTS) elements.set(spec.id, makeElement(spec, paint));

	const windowListeners = {};
	const location = { hash: options.hash || '', href: PAGE_URL + (options.hash || '') };
	const env = { clipboardText: null };
	let now = 1000;
	let rafQueue = [];
	const clipboard = {
		writeText(text) {
			env.clipboardText = String(text);
			return Promise.resolve();
		}
	};
	const context = {
		console: console,
		performance: { now: () => now },
		requestAnimationFrame(fn) { rafQueue.push(fn); },
		setTimeout() { return 0; },
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
					style: { setProperty() {} },
					getContext() { return paint; }
				};
			}
		},
		location: location,
		navigator: options.clipboard === false ? {} : { clipboard: clipboard },
		URLSearchParams: URLSearchParams,
		innerWidth: 1280,
		innerHeight: 800,
		devicePixelRatio: 1
	};
	context.window = context;
	vm.createContext(context);
	SCRIPTS.forEach((file, i) => vm.runInContext(SOURCES[i], context, { filename: file }));

	function fire(listeners, type, event) {
		for (const fn of listeners[type] || []) fn(event);
	}

	return Object.assign(env, {
		context,
		elements,
		calls,
		fireWindow(type, event) { fire(windowListeners, type, event); },
		fireElement(element, type, event) { fire(element.listeners, type, event || {}); },
		click(id) { fire(elements.get(id).listeners, 'click', {}); },
		/* change event for radios/checkboxes and input event for ranges, like a user edit */
		choose(id) {
			const element = elements.get(id);
			element.checked = true;
			fire(element.listeners, 'change', {});
		},
		toggle(id) {
			const element = elements.get(id);
			element.checked = !element.checked;
			fire(element.listeners, 'change', {});
		},
		setValue(id, value) {
			const element = elements.get(id);
			element.value = String(value);
			fire(element.listeners, 'input', {});
		},
		setHash(hash) {
			location.hash = hash;
			location.href = PAGE_URL + hash;
			fire(windowListeners, 'hashchange', {});
		},
		planetScreen(index) {
			const view = context.OrbitScene.view;
			const sim = context.OrbitScene.sim;
			return { x: sim.planetX[index] * view.scale + view.offX, y: sim.planetY[index] * view.scale + view.offY };
		},
		/* a real pointer drag from a planet to the grip of (angle, speed) */
		dragAim(planet, angle, speed) {
			const origin = env.planetScreen(planet);
			const canvas = elements.get('c');
			const reach = context.GravityScene.sim.gripLength(speed) * context.OrbitScene.view.scale;
			const gripX = origin.x + Math.cos(angle) * reach;
			const gripY = origin.y + Math.sin(angle) * reach;
			fire(windowListeners, 'pointerdown', { button: 0, clientX: origin.x, clientY: origin.y, target: canvas, shiftKey: false });
			fire(windowListeners, 'pointermove', { clientX: gripX, clientY: gripY, target: canvas, shiftKey: false });
			fire(windowListeners, 'pointerup', { clientX: gripX, clientY: gripY, target: canvas, shiftKey: false });
		},
		/* stepMs: number, or function(frameIndex) for variable cadence */
		runFrames(count, stepMs) {
			for (let i = 0; i < count; i++) {
				now += typeof stepMs === 'function' ? stepMs(i) : stepMs || 16.7;
				const queue = rafQueue;
				rafQueue = [];
				for (const fn of queue) fn(now);
			}
		},
		now() { return now; },
		advance(ms) { now += ms; }
	});
}

module.exports = { loadPage, SCRIPTS, PAGE_URL };
