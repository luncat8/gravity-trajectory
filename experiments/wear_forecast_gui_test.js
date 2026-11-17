/* Career wear preview, ageing control, sharing and deferred landing. */
'use strict';
const assert = require('assert');
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');

const env = loadPage({ search: '?mode=career&seed=3&bot=off' });
const ctx = env.context;
const ui = env.elements;
const scene = ctx.GravityScene;
const Game = ctx.GravityGame;
const Sim = ctx.GravitySim;
const career = scene.career;
const sim = scene.sim;
const origin = career.hq;
career.ledger.purse = 100;
assert.strictEqual(ui.get('expWear').disabled, false);
assert.strictEqual(ui.get('expWear').value, '1');
assert.strictEqual(Game.spaceWearScaleOf(), 1);

/* Fix the exit price so these checks isolate the condition preview. */
const realDeparture = scene.bot.careerDeparture;
scene.bot.careerDeparture = () => ({ ok: true, cost: 0, source: 'own',
	speed: 30, physical: true, builds: false, canBuildStarter: true });
const speed = Math.min(60, sim.speedLimit(origin));
assert.ok(speed >= Sim.SPEED_MIN);
vm.runInContext('aiming = false; armed = true; aimBody = ' + origin + '; aimSpeed = ' + speed + ';', ctx);
let body = (origin + 1) % 13;
while (!career.planetMask[body] || body === career.capitalPlanet || body === career.arfPlanet) body = (body + 1) % 13;
sim.predBody = body;
sim.predReason = Sim.END_IMPACT;
sim.predCount = 2;
sim.predLogCount = 1;
sim.predLogPlanet[0] = body;
sim.predLogStep[0] = 60;
sim.predLength = 500;
sim.routeActive = false;
function render(steps) {
	sim.predSteps = steps;
	sim.predTime = steps * Sim.DT;
	ctx.refreshPredGain();
	ctx.refreshAimLabel();
	ctx.updateLiveHud();
	return ui.get('aimReadout').textContent;
}

/* The main button repairs; launch-only warns separately about today's ship. */
Game.setShipCondition(career, 0.15);
let label = render(1200);
assert.match(label, /launch-only: 0% condition/, label);
assert.ok(!label.includes('reports stop'), 'repair-and-launch should use a new ship');
/* Insufficient repair money changes the preview back to the unrepaired ship. */
career.ledger.purse = 0;
label = render(2400);
assert.match(label, /worn out in flight · reports stop/, label);

/* A fresh ship may wear out in space, or only at touchdown. */
career.ledger.purse = 100;
Game.setShipCondition(career, 1);
env.setValue('expWear', 3);
assert.strictEqual(Game.spaceWearScaleOf(), 3);
assert.strictEqual(ui.get('expWearLabel').textContent, '×3.00');
label = render(6000);
assert.match(label, /worn out in flight · reports stop/, label);
label = render(3600);
assert.match(label, /0% condition · repair needed/, label);
label = render(120);
assert.ok(!label.includes('⚠'), label);

/* A saved trajectory is re-priced and the visible list refreshes on a knob edit. */
sim.predLogStep[0] = 4500;
render(6000);
ctx.saveTrace(sim, origin, Game.angleUnits(0), Game.speedUnits(speed));
const entry = career.launchBook.entries[0];
assert.ok(entry, 'trace did not join the launch book');
const highNet = ctx.storedMoney(entry).net;
const highHtml = ui.get('careerLaunchList').innerHTML;
env.setValue('expWear', 0);
const lowNet = ctx.storedMoney(entry).net;
assert.ok(lowNet > highNet, 'saved-shot price did not react to space wear');
assert.notStrictEqual(ui.get('careerLaunchList').innerHTML, highHtml,
	'the visible list must refresh even while the world clock is paused');
assert.ok(Math.abs(ctx.traceMoney(sim, origin, speed).net - lowNet) < 1e-9,
	'fresh and saved shots must have the same price');

/* Deduplication cannot hide the same aim after a book reset or new field. */
const book = career.launchBook;
ctx.recordArmedTrace();
const savedVersion = book.version;
ctx.recordArmedTrace();
assert.strictEqual(book.version, savedVersion, 'an unchanged armed trace should not be saved every frame');
Game.resetLaunchBook(book);
ctx.recordArmedTrace();
assert.strictEqual(book.entries.length, 1, 'the same aim must return after a reset');
const oldTag = book.tag;
const oldGravity = sim.strength[body];
sim.strength[body] = oldGravity + 0.1;
assert.notStrictEqual(ctx.pageBookTag(), oldTag);
ctx.recordArmedTrace();
assert.strictEqual(book.tag, oldTag, 'a field edit must leave the old book visibly stale');
ctx.dropStaleBook();
ctx.recordArmedTrace();
assert.strictEqual(book.entries.length, 0, 'an explicit clear must not immediately re-save the armed aim');
sim.predBody = origin;
ctx.saveTrace(sim, origin, Game.angleUnits(0.3), Game.speedUnits(speed));
sim.predBody = body;
ctx.recordArmedTrace();
assert.strictEqual(book.entries.length, 1, 'adding another shot must not resurrect the cleared aim');
assert.strictEqual(book.entries[0].angleU, Game.angleUnits(0.3));
vm.runInContext('aimAngle += 0.1;', ctx);
ctx.recordArmedTrace();
assert.strictEqual(book.tag, ctx.pageBookTag(), 'a new aim must save in the cleared field');
sim.strength[body] = oldGravity;
Game.resetLaunchBook(book);
ctx.recordArmedTrace();

/* A sliced helper cannot mix candidate scores or paths from different settings. */
const candidate = { origin, angleU: Game.angleUnits(0), speedU: Game.speedUnits(speed) };
function beginHelper() {
	ctx.helperRun([candidate], 'test');
	assert.strictEqual(vm.runInContext('helperState.active', ctx), true);
}
beginHelper();
env.setValue('expWear', 0.25);
assert.strictEqual(vm.runInContext('helperState.active', ctx), false);
assert.match(ui.get('careerMsg').textContent, /space wear changed · scan again/);
beginHelper();
env.setValue('expGravity', 0.9);
assert.strictEqual(vm.runInContext('helperState.active', ctx), false);
assert.match(ui.get('careerMsg').textContent, /gravity or force changed · scan again/);
env.setValue('expGravity', 1);
beginHelper();
env.setValue('expForce', 1.1);
assert.strictEqual(vm.runInContext('helperState.active', ctx), false);
env.setValue('expForce', 1);
beginHelper();
env.toggle('expHarvest');
assert.strictEqual(vm.runInContext('helperState.active', ctx), false);
assert.match(ui.get('careerMsg').textContent, /stay-pay changed · scan again/);
assert.match(ui.get('careerLaunchList').innerHTML, /≥ticks/, 'the list must identify entry-only estimates');
env.toggle('expHarvest');
assert.ok(!ui.get('careerLaunchList').innerHTML.includes('≥ticks'));

/* Untargeted scans must price maintenance even when all reports still pay. */
sim.predLogStep[0] = 60;
render(1200);
env.setValue('expWear', 0);
const noSpaceWearScore = ctx.helperScore(sim, candidate);
env.setValue('expWear', 1);
const normalWearScore = ctx.helperScore(sim, candidate);
assert.ok(Math.abs(noSpaceWearScore - normalWearScore - 6) < 1e-8,
	'10 seconds of space wear should cost 0.20 credits at 30 score per credit');

/* Even at 0%, the default repair-and-launch uses a usable future ship. */
scene.bot.careerDeparture = realDeparture;
Game.setShipCondition(career, 0);
career.ledger.purse = 100;
sim.predBody = origin;
sim.predLogStep[0] = 60;
label = render(1200);
assert.strictEqual(scene.bot.careerDeparture(career, origin, 100, career.ship.mass, sim).reason, 'ship worn out');
assert.ok(ctx.predictedCareerEconomics(sim).launchable, 'full repair must restore the predicted exit');
assert.ok(ctx.traceMoney(sim, origin, speed).visit > 0, 'a repaired observation device must report');
assert.ok(!label.includes('no exit'), label);
assert.strictEqual(ctx.launchBlock(career, entry, speed), '', 'the list must allow repair-and-launch at 0%');
vm.runInContext('armed = false;', ctx);
ctx.useBookEntry(0);
assert.ok(scene.aimState().armed, 'a repairable saved shot must arm from the list');
career.ledger.purse = 0;
assert.match(ctx.launchBlock(career, entry, speed), /repair \+ fee/, 'the list must still enforce the repair purse');
/* A free repair is still a repair: communism changes prices, not condition. */
career.cheat = Game.CHEAT_COMMUNISM;
career.ledger.purse = 0;
assert.strictEqual(Game.repairCost(career), 0);
assert.ok(ctx.predictedCareerEconomics(sim).launchable);
career.cheat = null;
career.ledger.purse = 100;
scene.bot.careerDeparture = () => ({ ok: true, cost: 0, source: 'own',
	speed: 30, physical: true, builds: false, canBuildStarter: true });
sim.predBody = body;

/* A slider at zero only removes the space portion, and applies immediately. */
env.setValue('expWear', 0);
Game.setShipCondition(career, 1);
career.flying = true;
Game.careerAdvance(career, 3600);
assert.strictEqual(career.ship.condition, 1);
career.flying = false;
assert.ok(Game.launchWear(career, speed) > 0);
assert.ok(Game.landingWear(career) > 0);

/* A landing is settled at frame end: extra clock ticks must not wear it. */
env.setValue('expWear', 1);
Game.setShipCondition(career, 0.5);
career.flying = true;
sim.status = Sim.STATUS_ENDED;
for (let i = 0; i < 10; i++) ctx.advanceGameOneStep();
assert.strictEqual(career.ship.condition, 0.5, 'post-landing world ticks charged space wear');
career.flying = false;

/* Copying a career preserves non-default balance; reopening applies it. */
env.setValue('expWear', 0.75);
vm.runInContext('armed = false; aiming = false;', ctx);
ctx.copyLink();
const hash = new URL(env.clipboardText).hash;
assert.match(hash, /&ws=0\.75/);
assert.strictEqual(Game.decodeLink(hash).spaceWearScale, 0.75);
const reopened = loadPage({ search: '?mode=lab&seed=42', hash });
reopened.click('replaySkip');
assert.strictEqual(reopened.context.GravityGame.spaceWearScaleOf(), 0.75);
assert.strictEqual(reopened.elements.get('expWear').value, '0.75');
assert.strictEqual(reopened.elements.get('expWearLabel').textContent, '×0.75');
assert.strictEqual(reopened.elements.get('expWear').disabled, true, 'career playback locks the recorded scales');
reopened.click('gameRestart');
assert.strictEqual(reopened.elements.get('expWear').disabled, false, 'a new career unlocks them');
reopened.choose('modeLab');
assert.strictEqual(reopened.elements.get('expWear').disabled, true);
reopened.choose('modeCareer');
assert.strictEqual(reopened.elements.get('expWear').value, '0.75');
assert.strictEqual(reopened.elements.get('expWear').disabled, false);
reopened.setHash('#game=1&seed=3&rate=1&rule=career');
assert.strictEqual(reopened.context.GravityGame.spaceWearScaleOf(), 1, 'old links default to ×1');
assert.strictEqual(reopened.elements.get('expWear').value, '1');

/* In career, even when a rival is selected, copy includes the entire shared recording. */
const rivals = loadPage({ search: mapSearch(3) + '&rate=0.5' });
rivals.setValue('expWear', 1.5);
rivals.toggle('expHarvest');
const rivalsScene = rivals.context.GravityScene;
rivalsScene.selectSlot(1);
rivals.context.copyLink();
const rivalLink = new URL(rivals.clipboardText).hash;
assert.strictEqual(rivals.context.GravityGame.decodeLink(rivalLink).spaceWearScale, 1.5);
assert.strictEqual(rivals.context.GravityGame.decodeLink(rivalLink).harvestTick, true);
const rivalMovie = rivals.context.CareerReplay.decode(new URLSearchParams(rivalLink.slice(1)).get('replay'));
assert.strictEqual(rivalMovie.start.state.careers.length, 3);
assert.strictEqual(rivals.elements.get('botCopy').hidden, false, 'career can follow a rival');
rivals.context.copyBotLink();
const watchedLink = new URL(rivals.clipboardText).hash;
const watchedMovie = rivals.context.CareerReplay.decode(new URLSearchParams(watchedLink.slice(1)).get('replay'));
assert.strictEqual(watchedMovie.watch, 1);
assert.strictEqual(watchedMovie.start.state.careers.length, 3, 'the rival copy keeps the shared world');

/* A selected rival's preview must read its own observation device, not YOU's. */
const r = rivalsScene.bot.rivals[0];
const rivalGame = rivals.context.GravityGame;
const rivalSim = rivals.context.GravitySim;
const rivalCareer = r.career;
const visit = Array.from(rivalCareer.planetMask).findIndex((active, p) => active &&
	p !== rivalCareer.capitalPlanet && p !== rivalCareer.arfPlanet && !rivalsScene.game.market.quiet[p]);
assert.ok(visit >= 0);
r.sim.predCount = 2;
r.sim.predReason = rivalSim.END_EXIT;
r.sim.predSteps = 120;
r.sim.predLogCount = 1;
r.sim.predLogPlanet[0] = visit;
r.sim.predLogStep[0] = 60;
vm.runInContext('aimBody = ' + rivalCareer.hq + '; aimSpeed = 60;', rivals.context);
rivalCareer.ship.obs = rivals.context.OrbitTech.OBS[0];
rivalGame.setShipCondition(rivalCareer, 1);
rivals.context.refreshPredGain();
assert.strictEqual(rivalsScene.predGain(), 0, 'R1 must not borrow YOU’s fitted device');
rivalCareer.ship.obs = rivals.context.OrbitTech.OBS[1];
rivalGame.setShipCondition(rivalCareer, 1);
rivals.context.refreshPredGain();
assert.ok(rivalsScene.predGain() > 0, 'R1’s own fitted device should report');
console.log('WEAR FORECAST GUI OK · repair, saved shots, slider, multiplayer links, deferred landing');
