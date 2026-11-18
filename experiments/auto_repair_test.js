/* Auto-repair on landing: the checkbox, the purse gate (repair + one cheap
 * way off, the whole purse at 0 % condition) and the endGameFlight hook.
 * Run: node experiments/auto_repair_test.js */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const env = loadPage({ search: mapSearch(42) });
const scene = env.context.GravityScene;
const ui = env.elements;
const Game = env.context.GravityGame;
const career = scene.career;
env.runFrames(2, 16);

/* the checkbox ships checked, sits in the footer and is exposed read-only */
assert.strictEqual(scene.autoRepair(), true, 'auto-repair must default to on');
assert.strictEqual(ui.get('careerAutoRepair').checked, true);

/* a worn ship landed with a healthy purse is serviced at once */
career.ledger.purse = 100;
Game.setShipCondition(career, 0.5);
career.flying = false;
career.at = career.hq;
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 1, 'the landed ship must be repaired');
assert.strictEqual(career.repairs, 1);
assert.ok(Math.abs(career.ledger.purse - 99) < 1e-9, 'repair 1.00 from 50 %: ' + career.ledger.purse);
assert.match(ui.get('careerMsg').textContent, /repaired · −1\.00/);

/* not enough money: the repair is skipped, the notice says so */
Game.setShipCondition(career, 0.5);
career.ledger.purse = 0.99;
const spent = career.maintenanceSpent;
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 0.5, 'an unaffordable repair must not happen');
assert.strictEqual(career.maintenanceSpent, spent);
assert.match(ui.get('careerMsg').textContent, /auto-repair skipped/);

/* enough for the repair but not for the repair plus one way off: still held back */
Game.setShipCondition(career, 0.5);
const reserve = Game.commercialMinFee();
career.ledger.purse = 1 + reserve - 0.01;
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 0.5, 'the launch reserve must survive the service');
assert.match(ui.get('careerMsg').textContent, /auto-repair skipped/);
/* exactly enough: repair proceeds */
Game.setShipCondition(career, 0.5);
career.ledger.purse = 1 + reserve;
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 1, 'the reserve is a floor, not a wall');

/* at 0 % condition nothing flies before the repair anyway: whole purse may serve */
Game.setShipCondition(career, 0);
career.ledger.purse = Game.repairCost(career);
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 1, 'a dead ship is repaired even with an empty reserve');
assert.ok(career.ledger.purse < 1e-9);

/* unchecked: touchdown leaves the ship alone and says nothing */
env.toggle('careerAutoRepair');
assert.strictEqual(scene.autoRepair(), false);
assert.strictEqual(ui.get('careerAutoRepair').checked, false);
career.ledger.purse = 100;
Game.setShipCondition(career, 0.5);
const repairs = career.repairs;
ui.get('careerMsg').textContent = '';
env.context.autoRepairOnLanding();
assert.strictEqual(career.ship.condition, 0.5, 'the checkbox must gate the service');
assert.strictEqual(career.repairs, repairs);
env.toggle('careerAutoRepair');
assert.strictEqual(scene.autoRepair(), true);

/* the real flight hook: launch flown to its end repairs on touchdown */
career.ledger.purse = 100;
Game.setShipCondition(career, 1);
env.dragAim(career.hq, 0.65, Math.min(72, scene.speedCeiling(career.hq)));
env.runFrames(2, 16);
env.click('launch');
for (let i = 0; i < 400 && scene.sim.status !== env.context.GravitySim.STATUS_FLYING; i++) env.runFrames(1, 16);
assert.strictEqual(scene.sim.status, env.context.GravitySim.STATUS_FLYING);
let frames = 0;
while (scene.sim.status === env.context.GravitySim.STATUS_FLYING && frames++ < 1200) env.runFrames(1, 40);
assert.notStrictEqual(scene.sim.status, env.context.GravitySim.STATUS_FLYING, 'flight never ended');
assert.ok(career.at >= 0, 'test flight must land; got at = ' + career.at);
assert.strictEqual(career.ship.condition, 1, 'landing must auto-repair; condition ' + career.ship.condition);
assert.ok(career.repairs >= 1);
console.log('auto repair: checkbox, purse gate, reserve and the landing hook passed');
