/* Starter-rail margin versus physical commercial departure. */
'use strict';

const assert = require('assert');
const World = require('../orbit_world.js');
const Trade = require('../orbit_sim.js');
const Sim = require('../gravity_sim.js');
const Game = require('../gravity_game.js');
const Tech = require('../orbit_tech.js');

const mask = new Uint8Array(World.PLANETS);
mask.fill(1, 0, 13);
const trade = new Trade(1);
trade.setPlanetMask(mask);
trade.setPlanetLimit(13);
trade.step(420);
const sim = new Sim(World.WORLD_W, World.WORLD_H);
const strength = new Float64Array(World.PLANETS).fill(1);
sim.setPlanets(World.PLANETS, trade.planetX, trade.planetY, trade.planetR,
	trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
sim.setPlanetMask(mask);
sim.setField(World.PLANETS, trade.planetR, strength, (t, x, y, count) => {
	for (let i = 0; i < count; i++) { x[i] = trade.planetX[i]; y[i] = trade.planetY[i]; }
}, true);
const galaxy = Game.createGalaxy();
Game.resetGalaxy(galaxy, 1);
const career = Game.createCareer(Game.createLedger());
Game.setCareerUniverse(career, mask, 13);
Game.startCareer(career, sim, 1, trade, null, galaxy);
let planet = -1;
for (let p = 0; p < 13; p++) {
	if (p !== career.hq && p !== career.capitalPlanet && Game.planetBuildable(career, p)) {
		planet = p;
		break;
	}
}
assert.ok(planet >= 0);
const out = Game.createDepartureOut();
const starterCost = Tech.CATAPULTS[0].buildCost;
const departure = exit => Game.careerDeparture(out, career, planet, starterCost,
	career.ship.mass, sim, 1, true, true, 0, (p, cap) => exit * cap);
const full = departure(1);
assert.ok(!full.starterCanExit && !full.canBuildStarter);
assert.ok(!full.ok || !full.builds || full.catapult !== Tech.CATAPULTS[0] ||
	full.battery !== Tech.BATTERIES[0], 'must not build a full-power-only starter');
const existing = Game.careerDeparture(out, career, career.capitalPlanet, 100, career.ship.mass,
	sim, 1, false, true, 0, (p, cap) => cap);
assert.ok(existing.ok && existing.source === 'capital' && !existing.builds,
	'an existing rail can still depart at full power');
const margin = departure(0.75);
assert.ok(margin.starterCanExit && margin.canBuildStarter);
assert.ok(margin.ok && margin.builds && margin.catapult === Tech.CATAPULTS[0] &&
	margin.battery === Tech.BATTERIES[0], 'must permit a margin-safe starter');
assert.ok(!Game.exitSpeedHasMargin(0, 100));
assert.ok(Game.exitSpeedHasMargin(75, 100));
assert.ok(!Game.exitSpeedHasMargin(85, 100));
console.log('CAREER EXIT MARGIN OK');
