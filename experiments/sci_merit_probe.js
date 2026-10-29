/*
 * Science fee surfaces (0.4.34 spec merit). Prints what the career research
 * panel costs over the whole slider grid of every family, so a balance change
 * can be compared against experiments/logs/0.4.34-sci-merit.txt.
 * Deterministic, node-only. Run: node experiments/sci_merit_probe.js
 */
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const OrbitScience = require(path.join(root, 'orbit_science.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));

/* mirrors SCIENCE_AXES in gravity_gui.js */
const RANGES = {
	engine: [[4, 60], [0.2, 3.6]],
	catapult: [[10, 230], [0.5, 0.98]],
	tank: [[20, 220], [0.15, 1.9]],
	battery: [[1, 22], [0.0001, 0.0012]]
};
/* the slider defaults of gravity_gui.js and the bot's R&D targets */
const DEFAULTS = [
	['engine', [26, 1.8]], ['catapult', [100, 0.76]],
	['tank', [100, 1.0]], ['battery', [6, 0.0005]]
];
const BOT = [['catapult', [52, 0.67]], ['tank', [50, 0.45]], ['engine', [16, 0.85]]];

function techHull() {
	const h = OrbitScience.createHull();
	for (const spec of GravityGame.SCIENCE_FAMILIES) {
		for (const item of spec.table) {
			if (item.tier > 0) OrbitScience.acceptHull(h, spec.kind, spec.params(item), item.id);
		}
	}
	return h;
}

function surface(h, family) {
	const ranges = RANGES[family];
	const costs = [];
	for (let i = 0; i <= 40; i++) {
		for (let j = 0; j <= 40; j++) {
			const x = ranges[0][0] + (ranges[0][1] - ranges[0][0]) * i / 40;
			const y = ranges[1][0] + (ranges[1][1] - ranges[1][0]) * j / 40;
			const c = OrbitScience.previewHull(h, family, [x, y]).cost;
			if (Number.isFinite(c)) costs.push(c);
		}
	}
	costs.sort((a, b) => a - b);
	const at = p => costs[Math.floor((costs.length - 1) * p)];
	const share = v => Math.round(costs.filter(c => c <= v).length / costs.length * 100) + '%';
	console.log('  ' + family.padEnd(9) +
		'min ' + at(0).toFixed(2).padStart(6) + ' p25 ' + at(0.25).toFixed(2).padStart(6) +
		' med ' + at(0.5).toFixed(2).padStart(6) + ' p75 ' + at(0.75).toFixed(2).padStart(6) +
		' max ' + at(1).toFixed(2).padStart(6) +
		' | <=2 ' + share(2).padStart(4) + ' <=6 ' + share(6).padStart(4) + ' <=20 ' + share(20).padStart(4));
}

const h = techHull();
console.log('fee surface over the slider grid (41x41)');
for (const family of GravityGame.SCIENCE_KINDS) surface(h, family);

console.log('\npar, slider default and bot R&D fees');
for (const [family, params] of DEFAULTS.concat(BOT)) {
	const p = OrbitScience.previewHull(h, family, params);
	console.log('  ' + family.padEnd(9) + JSON.stringify(params).padEnd(16) +
		'dist ' + p.dist.toFixed(3) + ' frontier ' + p.frontier.toFixed(3) +
		' merit ' + p.merit.toFixed(3) + ' fee ' + p.cost.toFixed(3));
}

console.log('\nworse is cheaper: one axis swept, the other on par');
for (const [family, base, worse] of [
	['battery', [6, 0.0006], [6, 0.0012]],
	['catapult', [135, 0.80], [135, 0.60]],
	['engine', [24, 1.6], [24, 3.2]],
	['tank', [90, 0.9], [90, 1.8]]
]) {
	const a = OrbitScience.previewHull(h, family, base);
	const b = OrbitScience.previewHull(h, family, worse);
	console.log('  ' + family.padEnd(9) + JSON.stringify(base) + ' fee ' + a.cost.toFixed(3) +
		' -> ' + JSON.stringify(worse) + ' fee ' + b.cost.toFixed(3) +
		' (x' + (b.cost / a.cost).toFixed(3) + ')');
}
