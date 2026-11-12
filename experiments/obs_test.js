/*
 * Observation device (0.6.1): the visit law's single reporting test, the
 * unreported value a bribe cashes, the quiet planet and the go-quiet action.
 * Run: node experiments/obs_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Econ = require(path.join(root, 'orbit_econ.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const Tech = require(path.join(root, 'orbit_tech.js'));

const DT = GravitySim.DT;
const PLANETS = World.PLANETS;
const UNIVERSE = 26;

function universe() {
	const mask = new Uint8Array(PLANETS);
	mask.fill(1, 0, UNIVERSE);
	return mask;
}

function setup(seed) {
	const trade = new Sim(seed);
	const market = Game.createMarket();
	const mask = universe();
	Game.resetMarket(market);
	Game.applyMarketUniverse(market, mask, UNIVERSE);
	Game.applyMarketSpecials(market, trade.world);
	const galaxy = Game.createGalaxy();
	Game.resetGalaxy(galaxy, seed);
	Game.bindRun(market, galaxy, trade.world);
	const sim = new GravitySim(World.WORLD_W, World.WORLD_H);
	const career = Game.createCareer(Game.createLedger());
	Game.setCareerUniverse(career, mask, UNIVERSE);
	Game.startCareer(career, sim, seed, trade, null, galaxy);
	sim.bodyCount = UNIVERSE;
	return { trade, world: trade.world, market, galaxy, sim, career };
}

function normalPlanet(w) {
	for (let p = 0; p < UNIVERSE; p++) {
		if (p !== w.market.capitalPlanet && p !== w.market.arfPlanet) return p;
	}
	throw new Error('no normal planet');
}

let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log('ok - ' + name); }

const AGED = -1e9;

function unfit(w) {
	assert.ok(Game.installPart(w.career, Tech.KIND_OBS, Tech.OBS[0]), 'unfit to OBS-0');
}

check('every career starts with OBS-1 fitted and owned; the starter mass is unchanged', () => {
	const w = setup(3);
	const career = w.career;
	assert.strictEqual(career.ship.obs, Tech.OBS[1]);
	assert.ok(career.owned[Tech.OBS[1].id] && career.owned[Tech.OBS[0].id], 'both records owned');
	assert.strictEqual(career.ledger.reports, true);
	assert.strictEqual(career.ship.mass, Tech.SHIP_DRY_MASS);
	assert.strictEqual(Tech.SHIP_DRY_MASS, 10);
	const purse = career.ledger.purse;
	unfit(w);
	assert.strictEqual(career.ledger.purse, purse, 'the way back is free');
	assert.strictEqual(career.ledger.reports, false);
	assert.ok(Math.abs(career.ship.mass - (Tech.SHIP_DRY_MASS - Tech.OBS[1].mass)) < 1e-9,
		'the device leaves the ship: ' + career.ship.mass);
	assert.ok(Math.abs(Tech.refitMass(career.ship, Tech.KIND_OBS, Tech.OBS[1], 0) - Tech.SHIP_DRY_MASS) < 1e-9,
		'the refit preview prices the device');
	assert.ok(Math.abs(Tech.refitMass(career.ship, Tech.KIND_HOLD, Tech.HOLDS[1], 0) -
		(Tech.HULL_MASS + Tech.HOLDS[1].emptyMass)) < 1e-9, 'another refit keeps the empty obs slot');
});

check('a visit with the device fitted pays, clears the value and decays rot', () => {
	const w = setup(5);
	const planet = normalPlanet(w);
	w.market.corruption[planet] = 10;
	w.market.lastVisitStep[planet] = AGED;
	const pay = Game.harvestPlanet(w.career.ledger, w.market, planet, 100);
	assert.ok(pay > 0, 'a reporting visit pays');
	assert.strictEqual(w.market.lastVisitStep[planet], 100, 'and stamps the value clock');
	assert.strictEqual(w.market.visitPay[planet], pay);
	assert.ok(w.market.corruption[planet] < 10, 'and decays rot');
});

check('a visit without the device pays 0, clears nothing and decays no rot', () => {
	const w = setup(7);
	unfit(w);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.corruption[planet] = 10;
	w.market.lastVisitStep[planet] = AGED;
	w.market.bribeVisitStep[planet] = AGED;
	const stamp = w.market.stamp;
	const purse = ledger.purse;
	assert.strictEqual(Game.harvestPlanet(ledger, w.market, planet, 100), 0);
	assert.strictEqual(ledger.purse, purse);
	assert.strictEqual(ledger.shotVisits, 1, 'it is still an encounter');
	assert.strictEqual(w.market.visitPay[planet], 0);
	assert.strictEqual(w.market.lastVisitStep[planet], AGED, 'the value keeps growing');
	assert.strictEqual(w.market.stamp, stamp, 'no rival plan is invalidated by a non-event');
	assert.strictEqual(w.market.corruption[planet], 10, 'no rot decay');
	assert.ok(Game.bribeWindowOpen(w.market, planet), 'the landing still opens the bribe window');
	/* the next reporting ship collects everything that was left */
	const rival = Game.createLedger();
	assert.ok(Game.harvestPlanet(rival, w.market, planet, 101) > 0, 'a rival collects the uncleared value');
});

check('a quiet planet reports for nobody; its neighbours are unaffected', () => {
	const w = setup(11);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.quiet[planet] = 1;
	w.market.corruption[planet] = 80;
	w.market.lastVisitStep[planet] = AGED;
	assert.strictEqual(Game.harvestPlanet(ledger, w.market, planet, 100), 0, 'fitted ship, quiet planet');
	assert.strictEqual(Game.harvestPlanet(Game.createLedger(), w.market, planet, 100), 0, 'a rival too');
	assert.strictEqual(w.market.lastVisitStep[planet], AGED);
	assert.strictEqual(w.market.corruption[planet], 80);
	const other = (planet + 1) % UNIVERSE === w.market.capitalPlanet ||
		(planet + 1) % UNIVERSE === w.market.arfPlanet ? (planet + 3) % UNIVERSE : (planet + 1) % UNIVERSE;
	w.market.corruption[other] = 80;
	w.market.lastVisitStep[other] = AGED;
	assert.ok(Game.harvestPlanet(ledger, w.market, other, 101) > 0);
	assert.ok(w.market.corruption[other] < 80, 'a neighbour still reports and decays');
});

check('the Capital and A.R.F. are outside the law: no device does not dodge the Capital', () => {
	const w = setup(13);
	unfit(w);
	const ledger = w.career.ledger;
	const purse = ledger.purse;
	assert.strictEqual(Game.harvestPlanet(ledger, w.market, w.market.capitalPlanet, 50), Game.CAPITAL_VISIT_PAY);
	assert.strictEqual(ledger.purse, purse + Game.CAPITAL_VISIT_PAY);
	assert.strictEqual(Game.harvestPlanet(ledger, w.market, w.market.arfPlanet, 50), 0);
});

check('the estimate prices exactly what the entry will pay', () => {
	const w = setup(17);
	const a = normalPlanet(w);
	let b = a + 1;
	while (b === w.market.capitalPlanet || b === w.market.arfPlanet) b += 1;
	const planets = new Int32Array([a, b, a]);
	const steps = new Int32Array([40, 90, 400]);
	const fitted = w.career.ledger;
	const full = Game.estimateProfitLog(w.market, 0, planets, steps, 3, fitted);
	assert.ok(full > 0);
	assert.strictEqual(Game.estimateProfitLog(w.market, 0, planets, steps, 3), full, 'no ledger = a reporting ship');
	w.market.quiet[a] = 1;
	const onlyB = Game.estimateProfitLog(w.market, 0, planets, steps, 3, fitted);
	assert.strictEqual(onlyB, Game.planetProfitAt(w.market, b, 90, w.market.lastVisitStep[b]),
		'a quiet planet adds nothing: ' + onlyB);
	unfit(w);
	assert.strictEqual(Game.estimateProfitLog(w.market, 0, planets, steps, 3, fitted), 0, 'no device, no income');
	const withCapital = new Int32Array([w.market.capitalPlanet, b]);
	assert.strictEqual(Game.estimateProfitLog(w.market, 0, withCapital, steps, 2, fitted),
		Game.CAPITAL_VISIT_PAY, 'the Capital still charges');
	/* live parity on the same log */
	let live = 0;
	for (let i = 0; i < 2; i++) live += Game.harvestPlanet(fitted, w.market, withCapital[i], steps[i]);
	assert.strictEqual(live, Game.CAPITAL_VISIT_PAY);
});

check('on a quiet planet the bribe is the whole unreported value x rot x 4, and it cashes it', () => {
	const w = setup(19);
	const planet = normalPlanet(w);
	const career = w.career;
	w.market.quiet[planet] = 1;
	w.market.corruption[planet] = 40;
	w.market.lastVisitStep[planet] = 0;
	/* two quiet landings: neither clears, so the base is everything since step 0 */
	Game.harvestPlanet(career.ledger, w.market, planet, 2000);
	Game.harvestPlanet(career.ledger, w.market, planet, 6000);
	career.at = planet;
	const value = Game.planetProfit(w.market, planet, 6000);
	const purse = career.ledger.purse;
	const result = Game.acceptBribe(career, w.market, w.sim, planet, 6000);
	assert.ok(result.ok, result.reason);
	assert.ok(Math.abs(result.amount - value * 0.4 * 4) < 1e-9, 'bribe ' + result.amount + ' for value ' + value);
	assert.ok(Math.abs(career.ledger.purse - purse - result.amount) < 1e-9);
	assert.strictEqual(Game.bribeWindowOpen(w.market, planet), false, 'one bribe per visit');
	assert.strictEqual(Game.planetProfit(w.market, planet, 6000), 0, 'the bribe cashed the value');
	/* landing again at once owes nothing: no farm */
	Game.harvestPlanet(career.ledger, w.market, planet, 6001);
	assert.ok(Game.bribeWindowOpen(w.market, planet));
	assert.ok(Game.bribeAmount(w.market, planet, 6001) < 0.01, 'a re-landing finds the value spent');
	/* a reporting planet keeps its law: the bribe does not clear what the visit paid for */
	const other = planet + 1 === w.market.capitalPlanet || planet + 1 === w.market.arfPlanet ? planet + 3 : planet + 1;
	w.market.corruption[other] = 40;
	Game.harvestPlanet(career.ledger, w.market, other, 7000);
	career.at = other;
	const stamped = w.market.lastVisitStep[other];
	assert.ok(Game.acceptBribe(career, w.market, w.sim, other, 7100).ok);
	assert.strictEqual(w.market.lastVisitStep[other], stamped, 'a reported visit is not re-stamped by its bribe');
});

check('go quiet takes the device off, silences the planet and names every refusal', () => {
	const w = setup(23);
	const planet = normalPlanet(w);
	const career = w.career;
	const market = w.market;
	assert.strictEqual(Game.quietRefusal(career, market, planet), 'not landed there');
	career.at = planet;
	market.corruption[planet] = Game.QUIET_MIN;
	assert.ok(Game.quietRefusal(career, market, planet).includes(Game.QUIET_MIN + '%'), 'at the line is not above it');
	assert.strictEqual(Game.goQuiet(career, market, planet), false);
	market.corruption[planet] = 80;
	unfit(w);
	assert.strictEqual(Game.quietRefusal(career, market, planet), 'no observation device fitted');
	assert.ok(Game.installPart(career, Tech.KIND_OBS, Tech.OBS[1]));
	market.rebel[planet] = 1;
	assert.strictEqual(Game.quietRefusal(career, market, planet), 'rebels hold the planet');
	market.rebel[planet] = 0;
	const stamp = market.stamp;
	assert.strictEqual(Game.goQuiet(career, market, planet), true);
	assert.strictEqual(market.quiet[planet], 1);
	assert.ok(market.stamp > stamp, 'rival plans see the planet go dark');
	assert.strictEqual(career.ship.obs, Tech.OBS[0], 'the device is on the shelf');
	assert.strictEqual(career.ledger.reports, false);
	assert.ok(career.owned[Tech.OBS[1].id], 'and stays owned');
	assert.strictEqual(Game.quietRefusal(career, market, planet), 'already quiet');
	career.at = market.capitalPlanet;
	assert.strictEqual(Game.quietRefusal(career, market, market.capitalPlanet), 'nothing to silence here');
	career.at = market.arfPlanet;
	assert.strictEqual(Game.quietRefusal(career, market, market.arfPlanet), 'nothing to silence here');
});

check('refitting the device does not un-silence the planet; quelling the rot does', () => {
	const w = setup(29);
	const planet = normalPlanet(w);
	const career = w.career;
	career.at = planet;
	w.market.corruption[planet] = 80;
	assert.ok(Game.goQuiet(career, w.market, planet));
	assert.ok(Game.installPart(career, Tech.KIND_OBS, Tech.OBS[1]), 'refit OBS-1');
	assert.strictEqual(career.ledger.reports, true);
	w.market.lastVisitStep[planet] = AGED;
	assert.strictEqual(Game.harvestPlanet(career.ledger, w.market, planet, 100), 0, 'still quiet after refit');
	Game.pacifyPlanet(w.market, planet, 300);
	assert.strictEqual(w.market.quiet[planet], 0, 'pacification clears quiet');
	assert.ok(Game.harvestPlanet(career.ledger, w.market, planet, 400) > 0, 'and the planet reports again');
});

console.log('OBS OK · ' + checks + ' groups');
