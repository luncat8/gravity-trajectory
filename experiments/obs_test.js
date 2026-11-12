/*
 * Observation device (0.6.1): the visit law's single reporting test, the
 * quiet planet, and goQuiet uninstall. Run: node experiments/obs_test.js
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

/* fit OBS-1 on the ship and own it */
function fitObs(w) {
	const career = w.career;
	assert.ok(Game.installPart(career, Tech.KIND_OBS, Tech.OBS[1]),
		'install OBS-1');
	assert.strictEqual(career.ship.obs, Tech.OBS[1]);
	assert.strictEqual(career.ship.obs.fitted, true);
}

check('OBS-1 adds mass to the ship, OBS-0 does not', () => {
	const w = setup(3);
	const ship = { hold: Tech.HOLDS[0], engine: null, tank: Tech.TANKS[0],
		obs: Tech.OBS[0], cargoTons: 0 };
	const withDevice = Tech.shipMass(ship, 0);
	ship.obs = Tech.OBS[1];
	assert.ok(Tech.shipMass(ship, 0) > withDevice, 'OBS-1 adds mass');
	assert.strictEqual(Tech.OBS[1].mass, 0.4);
	assert.ok(Math.abs(Tech.shipMass(ship, 0) - (withDevice + 0.4)) < 1e-9);
});

check('a visit with the device fitted pays and decays rot', () => {
	const w = setup(5);
	fitObs(w);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.corruption[planet] = 10;
	w.market.lastVisitStep[planet] = -1e9;
	const pay = Game.harvestPlanet(ledger, w.market, planet, 100, w.career);
	assert.ok(pay > 0, 'a reporting visit pays');
	assert.ok(w.market.corruption[planet] < 10, 'a reporting visit decays rot');
	assert.strictEqual(w.market.visitPay[planet], pay);
});

check('a visit without the device pays 0 and does not decay rot', () => {
	const w = setup(7);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.corruption[planet] = 10;
	w.market.lastVisitStep[planet] = -1e9;
	const pay = Game.harvestPlanet(ledger, w.market, planet, 100, w.career);
	assert.strictEqual(pay, 0, 'a non-reporting visit pays 0');
	assert.strictEqual(w.market.visitPay[planet], 0, 'visitPay is 0');
	assert.strictEqual(w.market.corruption[planet], 10, 'no rot decay without the device');
});

check('a quiet planet pays 0 and decays no rot even with the device fitted', () => {
	const w = setup(11);
	fitObs(w);
	const planet = normalPlanet(w);
	const ledger = w.career.ledger;
	w.market.quiet[planet] = 1;
	w.market.corruption[planet] = 80;
	w.market.lastVisitStep[planet] = -1e9;
	const pay = Game.harvestPlanet(ledger, w.market, planet, 100, w.career);
	assert.strictEqual(pay, 0, 'a quiet planet pays 0');
	assert.strictEqual(w.market.visitPay[planet], 0, 'visitPay 0 on quiet');
	assert.strictEqual(w.market.corruption[planet], 80, 'no rot decay on quiet');
	/* neighbours are unaffected */
	const other = (planet + 1) % UNIVERSE;
	w.market.corruption[other] = 80;
	Game.harvestPlanet(ledger, w.market, other, 101, w.career);
	assert.ok(w.market.corruption[other] < 80, 'a neighbour still reports and decays');
});

check('the bribe on a quiet planet keeps growing (value x rot x 4)', () => {
	const w = setup(13);
	fitObs(w);
	const planet = normalPlanet(w);
	const career = w.career;
	career.at = planet;
	w.market.lastVisitStep[planet] = 100;
	w.market.visitPay[planet] = 0; /* quiet: nothing collected */
	w.market.corruption[planet] = 50;
	/* let value regrow, then bribe = grown x rot x 4 */
	const grown = Game.planetProfit(w.market, planet, 200);
	const result = Game.acceptBribe(career, w.market, w.sim, planet, 200);
	assert.ok(result.ok, 'bribe on quiet world: ' + result.reason);
	assert.ok(result.amount > 0, 'a quiet world still owes a bribe: ' + result.amount);
	assert.ok(Math.abs(result.amount - grown * (50 / 100) * 4) < 1e-9,
		'bribe is grown x rot x 4: ' + result.amount);
});

check('goQuiet uninstalls the device and silences a high-rot planet', () => {
	const w = setup(17);
	fitObs(w);
	const planet = normalPlanet(w);
	const career = w.career;
	career.at = planet;
	w.market.corruption[planet] = 80;
	assert.strictEqual(career.ship.obs, Tech.OBS[1], 'device fitted before');
	assert.ok(Game.goQuiet(career, planet), 'goQuiet accepted');
	assert.strictEqual(w.market.quiet[planet], 1, 'planet is quiet');
	assert.strictEqual(career.ship.obs, Tech.OBS[0], 'device uninstalled onto the ship');
	assert.strictEqual(career.ship.obs.fitted, false);
	/* the part stays owned: can be refitted anywhere */
	assert.ok(career.owned[Tech.OBS[1].id], 'OBS-1 remains owned');
});

check('goQuiet is refused below QUIET_MIN, without the device, and on special planets', () => {
	const w = setup(19);
	const planet = normalPlanet(w);
	const career = w.career;
	career.at = planet;
	w.market.corruption[planet] = 50;
	assert.ok(!Game.goQuiet(career, planet), 'below QUIET_MIN refused');
	fitObs(w);
	w.market.corruption[planet] = 80;
	assert.ok(Game.goQuiet(career, planet), 'goQuiet works');
	assert.ok(!Game.goQuiet(career, planet), 'already quiet refused');
	/* without the device */
	const w2 = setup(21);
	const p2 = normalPlanet(w2);
	w2.career.at = p2;
	w2.market.corruption[p2] = 80;
	assert.ok(!Game.goQuiet(w2.career, p2), 'no device, refused');
	/* Capital / A.R.F. */
	assert.ok(!Game.goQuiet(w.career, w.market.capitalPlanet), 'capital refused');
	assert.ok(!Game.goQuiet(w.career, w.market.arfPlanet), 'arf refused');
});

check('refitting OBS-1 on a quiet planet changes nothing until the rot is quelled', () => {
	const w = setup(23);
	fitObs(w);
	const planet = normalPlanet(w);
	const career = w.career;
	career.at = planet;
	w.market.corruption[planet] = 80;
	Game.goQuiet(career, planet);
	assert.strictEqual(w.market.quiet[planet], 1);
	/* refitting OBS-1 again does not un-quiet */
	assert.ok(Game.installPart(career, Tech.KIND_OBS, Tech.OBS[1]), 'refit OBS-1');
	assert.strictEqual(w.market.quiet[planet], 1, 'still quiet after refit');
	/* pacification clears quiet */
	Game.pacifyPlanet(w.market, planet, 300);
	assert.strictEqual(w.market.quiet[planet], 0, 'pacification clears quiet');
});

	check('reporting is career-scoped: the player reports only with the device fitted; rivals always report', () => {
		const w = setup(29);
		const planet = normalPlanet(w);
		const career = w.career;
		/* player without the device: no report (visit pays nothing, clears no rot) */
		assert.strictEqual(Game.reporting(career, w.market, planet), false, 'no device => no report');
		w.market.quiet[planet] = 1;
		assert.strictEqual(Game.reporting(career, w.market, planet), false, 'quiet => no report');
		w.market.quiet[planet] = 0;
		/* with OBS-1 fitted: reports again */
		fitObs(w);
		assert.strictEqual(Game.reporting(career, w.market, planet), true, 'device fitted => reports');
		/* a rival (index > 0) reports even without a device */
		const rival = Game.createCareer(Game.createLedger());
		rival.index = 1; rival.market = w.market;
		assert.strictEqual(Game.reporting(rival, w.market, planet), true, 'rival reports');
	});

console.log('OBS OK · ' + checks + ' groups');
