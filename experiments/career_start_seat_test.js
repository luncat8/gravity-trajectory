/*
 * Career start seats (0.5.22): the page plans one fair HQ set for the whole run
 * and every starting HQ carries a standard gravity well, so no company opens
 * inside a well it cannot leave. `career_gravity_bench` mirrors both (SEATS /
 * HQWELL); this is the page side of that contract, checked on the vm stub.
 *
 * Why it exists: the seat search scores a candidate home with its own strength
 * pinned to 1 (`openingTraceHome`), so a fixture — or a page change — that leaves
 * the world seed's gravity on an HQ measures a world the game cannot produce:
 * 10 of 60 rival-games opened in wells up to g 3.1 and never flew.
 *
 * Run: node experiments/career_start_seat_test.js (SEEDS=1-3)
 */
'use strict';

const assert = require('assert');
const { loadPage } = require('./dom_stub.js');

const parseSeeds = value => {
	const [from, to] = value.split('-');
	if (to === undefined) return [Number(from)];
	const list = [];
	for (let seed = Number(from); seed <= Number(to); seed++) list.push(seed);
	return list;
};
const SEEDS = parseSeeds(process.env.SEEDS || '1-3');

for (const seed of SEEDS) {
	const env = loadPage({ search: '?rule=career&seed=' + seed + '&rate=1' });
	env.runFrames(2, 16.0);
	const scene = env.context.GravityScene;
	const sim = scene.sim;
	const seats = scene.game.galaxy.mapSeats;
	assert.ok(seats && seats.length >= 1 + scene.bot.count,
		'seed ' + seed + ': the run has no planned HQ set');
	const careers = [scene.career];
	for (let i = 0; i < scene.bot.count; i++) careers.push(scene.bot.rivals[i].career);
	for (let i = 0; i < careers.length; i++) {
		const career = careers[i];
		const who = 'seed ' + seed + ' ' + (i === 0 ? 'YOU' : 'R' + i);
		assert.strictEqual(career.hq, seats[i], who + ' does not sit on its planned seat');
		assert.strictEqual(sim.strength[career.hq], 1,
			who + ' opens in a g ' + sim.strength[career.hq].toFixed(2) + ' well');
	}
	const homes = careers.map((c, i) => (i === 0 ? 'YOU' : 'R' + i) + ' P' + c.hq).join(' ');
	console.log('seed ' + seed + ' · seats ' + seats.join(',') + ' · ' + homes + ' · every HQ g 1.00');
}

console.log('CAREER START SEATS OK · ' + SEEDS.length + ' seeds');
