/* Seeded opening distribution, not a reachability or play-balance benchmark.
 * Run: node experiments/colony_distribution.js [seed count] */
'use strict';
const World = require('../orbit_world.js');
const Trade = require('../orbit_sim.js');
const Gravity = require('../planet_gravity.js');
const Game = require('../gravity_game.js');

const seeds = Math.max(1, Math.floor(Number(process.argv[2]) || 1000));
const mask = new Uint8Array(World.PLANETS);
mask.fill(1, 0, 16);
const bins = [0, 0, 0];
const heavyMaps = [0, 0, 0, 0];
const missing = {};
let compositionPasses = 0;
for (let seed = 1; seed <= seeds; seed++) {
	const world = new Trade(seed).world;
	const market = Game.createMarket();
	Game.deriveEmptyWorlds(market, mask, 16, world);
	let heavy = 0;
	for (let p = 0; p < 16; p++) {
		if (!market.empty[p]) continue;
		const g = Gravity.emptyGravity(seed, p);
		bins[g < 2 ? 0 : g < 3.5 ? 1 : 2]++;
		if (g >= 2) heavy++;
	}
	heavyMaps[heavy]++;
	const comp = Game.startComposition(world, mask, 16, 3, null, 'planet');
	if (comp.ok) compositionPasses++;
	for (const reason of comp.missing) missing[reason] = (missing[reason] || 0) + 1;
}
console.log(JSON.stringify({ seeds, colonyGravityBins: { '1.5..<2': bins[0], '2..<3.5': bins[1],
	'3.5..5': bins[2] }, mapsByHeavyColonies: heavyMaps, compositionPasses, missing }, null, 2));
