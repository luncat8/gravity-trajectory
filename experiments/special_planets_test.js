'use strict';

const assert = require('assert');
const World = require('../orbit_world.js');
const Game = require('../gravity_game.js');
const Sim = require('../orbit_sim.js');
const GravitySim = require('../gravity_sim.js');

for (let seed = 1; seed <= 100; seed++) {
	const trade = new Sim(seed);
	const world = trade.world;
	assert.notStrictEqual(world.capitalPlanet, world.arfPlanet);
	assert.ok(world.capitalPlanet < 4 && world.arfPlanet < 4);
	assert.strictEqual(World.planetKind(world, world.capitalPlanet), World.KIND_CAPITAL);
	assert.strictEqual(World.planetKind(world, world.arfPlanet), World.KIND_ARF);
	const market = Game.createMarket();
	Game.resetMarket(market);
	Game.applyMarketSpecials(market, world);
	assert.strictEqual(Game.planetProfit(market, world.capitalPlanet, 500), -3);
	assert.strictEqual(Game.planetProfit(market, world.arfPlanet, 500), 0);
	const career = Game.createCareer(Game.createLedger());
	const sim = new GravitySim(World.WORLD_W, World.WORLD_H);
	Game.startCareer(career, sim, seed, trade, null);
	assert.notStrictEqual(career.hq, world.capitalPlanet);
	assert.strictEqual(Game.padAt(career, world.capitalPlanet), Game.CAPITAL_PAD);
	assert.strictEqual(Game.padOwner(career, world.capitalPlanet), Game.OWNER_CAPITAL);
	assert.strictEqual(Game.exitCostAt(career, world.capitalPlanet), 0);
	assert.strictEqual(Game.planetBuildable(career, world.capitalPlanet), false);
}
console.log('SPECIAL PLANETS OK');
