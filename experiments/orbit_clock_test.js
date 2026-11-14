/* The background orbit clock is also moving-port gravity time. Pin the shared
 * field, truthful controls, stable URL units and independent economy clocks.
 * Run: node experiments/orbit_clock_test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadPage } = require('./dom_stub.js');
const Sim = require('../gravity_sim.js');

const query = env => new URL(env.context.location.href).searchParams;
const snapshot = sim => Array.from(sim.predX.slice(0, sim.predCount));

/* Raw speed and the displayed multiple must not mix when a URL is reopened. */
const lab = loadPage({ search: '?mode=lab&seed=7&src=ports' });
lab.runFrames(1, 0);
assert.strictEqual(lab.context.OrbitScene.trade.speed, 0.5);
assert.strictEqual(lab.elements.get('tradeSpeedLabel').textContent, '×1');
assert.strictEqual(query(lab).get('speed'), null);
const reopened = loadPage({ search: new URL(lab.context.location.href).search });
reopened.runFrames(1, 0);
assert.strictEqual(reopened.context.OrbitScene.trade.speed, 0.5);
assert.strictEqual(reopened.context.GravityScene.sim.fieldRate, 0.5);
lab.setValue('tradeSpeed', 2);
lab.runFrames(1, 0);
assert.strictEqual(lab.elements.get('tradeSpeedLabel').textContent, '×4');
assert.strictEqual(query(lab).get('speed'), '2');
assert.strictEqual(lab.context.GravityScene.sim.fieldRate, 2);
const fast = loadPage({ search: new URL(lab.context.location.href).search });
fast.runFrames(1, 0);
assert.strictEqual(fast.context.OrbitScene.trade.speed, 2);
assert.strictEqual(fast.elements.get('tradeSpeedLabel').textContent, '×4');
assert.strictEqual(fast.context.GravityScene.sim.fieldRate, 2);
const slow = loadPage({ search: '?mode=lab&seed=7&src=ports' });
slow.runFrames(1, 0);

/* Same ports and strengths at t0; only the rate at which gravity moves differs. */
const slowSim = slow.context.GravityScene.sim;
const fastSim = fast.context.GravityScene.sim;
slowSim.fieldT = fastSim.fieldT;
slowSim.refreshField();
assert.strictEqual(slowSim.fieldT, fastSim.fieldT);
assert.deepStrictEqual(Array.from(slowSim.strength), Array.from(fastSim.strength));
slowSim.predict(0, 0.4, 180);
fastSim.predict(0, 0.4, 180);
assert.notDeepStrictEqual(snapshot(slowSim), snapshot(fastSim),
	'orbit rate must change a moving-port prediction');
slowSim.launch(0, 0.4, 180);
fastSim.launch(0, 0.4, 180);
for (let i = 0; i < 120; i++) {
	if (slowSim.status === Sim.STATUS_FLYING) slowSim.stepOne();
	if (fastSim.status === Sim.STATUS_FLYING) fastSim.stepOne();
}
assert.notStrictEqual(slowSim.cargo.x, fastSim.cargo.x);
assert.notStrictEqual(slowSim.cargo.y, fastSim.cargo.y);
assert.ok(Math.abs(slowSim.flightFieldT - slowSim.fieldT - slowSim.flightTime * 0.5) < 1e-9);
assert.ok(Math.abs(fastSim.flightFieldT - fastSim.fieldT - fastSim.flightTime * 2) < 1e-9);
const orbit = fast.context.OrbitScene.sim;
fastSim.fillStep(fastSim.flightFieldT);
assert.strictEqual(fastSim.stepX[0], orbit.portX(0, fastSim.flightFieldT));
assert.strictEqual(fastSim.stepY[0], orbit.portY(0, fastSim.flightFieldT));

/* Static planet gravity does not acquire a cosmetic dependency. */
const staticSlow = loadPage({ search: '?mode=lab&seed=7' });
const staticFast = loadPage({ search: '?mode=lab&seed=7&speed=2' });
staticSlow.runFrames(1, 0);
staticFast.runFrames(1, 0);
const staticSlowSim = staticSlow.context.GravityScene.sim;
const staticFastSim = staticFast.context.GravityScene.sim;
staticSlowSim.fieldT = staticFastSim.fieldT;
staticSlowSim.predict(0, 0.4, 180);
staticFastSim.predict(0, 0.4, 180);
assert.ok(Math.abs(staticSlowSim.predLength - staticFastSim.predLength) < 1e-9);
assert.strictEqual(staticSlowSim.predSteps, staticFastSim.predSteps);
assert.strictEqual(staticSlowSim.predBody, staticFastSim.predBody);
for (let i = 0; i < staticSlowSim.predCount; i++) {
	assert.ok(Math.abs(staticSlowSim.predX[i] - staticFastSim.predX[i]) < 1e-9);
	assert.ok(Math.abs(staticSlowSim.predY[i] - staticFastSim.predY[i]) < 1e-9);
}

/* Pause freezes the shared orbit/gravity clock, not an airborne ship. */
reopened.choose('srcPorts');
reopened.runFrames(1, 0);
const free = reopened.context.GravityScene.sim;
free.launch(0, 0.4, 180);
reopened.runFrames(2, 16);
reopened.click('tradePause');
const pausedT = reopened.context.OrbitScene.sim.t;
const pausedSteps = free.liveSteps;
reopened.runFrames(4, 16);
assert.strictEqual(reopened.context.OrbitScene.sim.t, pausedT);
assert.strictEqual(free.fieldRate, 0);
assert.ok(free.liveSteps > pausedSteps);
assert.match(reopened.elements.get('tradePause').title, /gravity.*flight clock/i);
reopened.click('tradePause');
reopened.runFrames(2, 16);
assert.ok(reopened.context.OrbitScene.sim.t > pausedT);
assert.strictEqual(free.fieldRate, 0.5);

/* The warning is visible without hover, described by the input, and still
 * available on the wrapping label when a shared run disables the input. */
const hint = reopened.elements.get('tradeRateHint');
assert.match(hint.textContent, /Moving ports.*gravity.*trajectories/);
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /id="tradeSpeed"[^>]*aria-describedby="tradeRateHint"/);
assert.match(reopened.elements.get('tradeRateControl').title, /gravity strength/);
const career = loadPage({ search: '?mode=career&seed=42&rate=1&bot=off' });
career.runFrames(1, 0);
const cui = career.elements;
const cs = career.context.GravityScene;
assert.strictEqual(cui.get('tradeSpeedLabel').textContent, '×2');
assert(cui.get('tradeSpeed').disabled && cui.get('tradePause').disabled);
assert.match(cui.get('tradeRateControl').title, /Locked in career.*game clock/);
assert.match(cui.get('tradeRateHint').textContent, /Locked in career/);
assert.match(cui.get('tradePause').title, /gravity follow the game clock/);

/* A linked non-default rate applies equally to flight, idle time and wait;
 * the pad and political clocks still advance in game seconds only. */
const careerOrbit = career.context.OrbitScene.sim;
const idleT = careerOrbit.t;
const idleStep = cs.game.clockSteps;
career.toggle('careerPauseLand');
career.runFrames(30, 16);
const idleSec = Sim.gameSeconds(cs.game.clockSteps - idleStep);
assert.ok(idleSec > 0);
assert.ok(Math.abs(careerOrbit.t - idleT - idleSec) < 1e-9);
career.toggle('careerPauseLand');
const waitT = careerOrbit.t;
const waitStep = cs.game.clockSteps;
const waitSteps = cs.waitSettlement().steps;
career.click('careerWait');
for (let i = 0; i < 160 && cui.get('careerWait').textContent.startsWith('waiting'); i++) {
	career.runFrames(1, 16);
}
assert.strictEqual(cs.game.clockSteps - waitStep, waitSteps);
assert.ok(Math.abs(careerOrbit.t - waitT - Sim.gameSeconds(waitSteps)) < 1e-9);
assert.strictEqual(cs.sim.fieldRate, 1);
const politicsSeconds = career.context.GravityGame.politicsSeconds;
assert.strictEqual(politicsSeconds(cs.game.market, waitStep + waitSteps) -
	politicsSeconds(cs.game.market, waitStep), Sim.gameSeconds(waitSteps));

console.log('ORBIT CLOCK OK — shared moving gravity, stable URLs, explicit locks, independent game time');
