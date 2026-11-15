/* Repeated paused profit searches must not discard their current winner. */
'use strict';
const assert = require('assert');
const { loadPage } = require('./dom_stub.js');
const env = loadPage({ search: '?mode=career&seed=520383' });
env.runFrames(4, 16);
const scene = env.context.GravityScene;
scene.setCareerPaused(true);
const clock = scene.game.clockSteps;
let best = -Infinity;
for (let n = 0; n < 8; n++) {
	env.click('helperProfit');
	let frames = 0;
	while (!env.elements.get('helperStop').hidden && frames++ < 1800) env.runFrames(1, 16);
	assert.ok(frames < 1800, 'scan timed out');
	const notice = env.elements.get('careerMsg').textContent;
	/* money prints a typographic minus (`−`), not a hyphen: folding it first
	 * keeps a negative winner readable instead of "missing profit" */
	const match = notice.match(/([+\u2212-]\d+\.\d+)/);
	assert.ok(match, 'missing profit in ' + notice);
	const value = Number(match[1].replace('\u2212', '-'));
	assert.ok(value >= best - 0.001, 'profit decreased: ' + best + ' to ' + value);
	assert.strictEqual(scene.game.clockSteps, clock, 'world moved during scan');
	best = value;
}
console.log('PROFIT MONOTONIC OK · ' + best);
