/*
 * Fragile load (0.6.3): a loaded fragile contract dies on a launch harder than
 * FRAGILE_SPEED; the offer gate, the launch void and the aim-line void.
 * Run: node experiments/fragile_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const World = require(path.join(root, 'orbit_world.js'));
const Game = require(path.join(root, 'gravity_game.js'));
const Tech = require(path.join(root, 'orbit_tech.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));

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

function accelOf(speed) { return speed * speed / (2 * Tech.RAIL_M); }

const GENTLE = Math.floor(Game.FRAGILE_SPEED);
const HARD = Math.ceil(Game.FRAGILE_SPEED) + 1;

/* a fragile delivery in slot 0 from the planet under the ship; accepted there, so it is loaded */
function fragileCareer(w) {
	const career = w.career;
	const planet = normalPlanet(w);
	career.at = planet;
	assert.ok(Game.installPart(career, Tech.KIND_HOLD, Tech.HOLDS[1]));
	const task = career.tasks[0];
	task.kind = Game.TASK_DELIVERY;
	task.state = Game.TASK_OFFERED;
	task.fragile = true;
	task.tons = 4;
	task.from = planet;
	task.to = (planet + 1) % UNIVERSE;
	task.planet = -1;
	task.minLength = 0;
	task.reward = 3.00;
	task.deadline = 100000;
	assert.ok(Game.acceptTask(career, 0), 'accept');
	assert.strictEqual(task.state, Game.TASK_LOADED);
	assert.strictEqual(career.ship.cargoTons, task.tons, 'cargo loaded');
	w.sim.markSystemsAt = function () {}; /* the field is not needed to fire */
	w.sim.origin = planet;
	return { career, planet, task };
}

check('the limit is one acceleration, read as one launch speed', () => {
	assert.ok(Math.abs(accelOf(Game.FRAGILE_SPEED) - Game.FRAGILE_ACCEL) < 1e-12);
	assert.ok(GravitySim.SPEED_MIN < Game.FRAGILE_SPEED, 'the slowest shot is always gentle');
	const loaded = { fragile: true, state: Game.TASK_LOADED };
	assert.strictEqual(Game.fragileBreaks(loaded, Game.FRAGILE_SPEED), false, 'at the limit survives');
	assert.strictEqual(Game.fragileBreaks(loaded, GENTLE), false);
	assert.strictEqual(Game.fragileBreaks(loaded, HARD), true);
	assert.strictEqual(Game.fragileBreaks({ fragile: true, state: Game.TASK_ACCEPTED }, 320), false,
		'nothing aboard yet: the flight to the pickup may be hard');
	assert.strictEqual(Game.fragileBreaks({ fragile: false, state: Game.TASK_LOADED }, 320), false,
		'a solid load never voids');
});

check('the limit prices force: EMC-1 at full force is gentle on a loaded ship, EMC-2 is not', () => {
	const ship = { hold: Tech.HOLDS[1], engine: Tech.ENGINES[0], tank: Tech.TANKS[1],
		obs: Tech.OBS[1], cargoTons: 8 };
	const mass = Tech.shipMass(ship, ship.cargoTons);
	const top1 = Tech.maxSpeed(mass, Tech.CATAPULTS[0]);
	const top2 = Tech.maxSpeed(mass, Tech.CATAPULTS[1]);
	console.log('   mass ' + mass.toFixed(1) + ' t · limit ' + Game.FRAGILE_SPEED.toFixed(1) +
		' px/s · EMC-1 force cap ' + top1.toFixed(0) + ' px/s (' + accelOf(top1).toFixed(2) +
		' m/s^2) · EMC-2 force cap ' + top2.toFixed(0) + ' px/s (' + accelOf(top2).toFixed(2) + ' m/s^2)');
	assert.ok(top1 <= Game.FRAGILE_SPEED, 'EMC-1 cannot break it on a loaded ship');
	assert.ok(top2 > Game.FRAGILE_SPEED, 'EMC-2 at full force breaks it');
});

check('a gentle launch keeps the contract on any rail', () => {
	const w = setup(41);
	const { career, planet, task } = fragileCareer(w);
	career.ledger.purse = 99;
	assert.ok(Game.buildGear(career, planet, Tech.KIND_CATAPULT, Tech.CATAPULTS[1]), 'own EMC-2 here');
	w.sim.speed = GENTLE;
	Game.careerBeginFlight(career, w.sim);
	assert.strictEqual(career.fragileLost, false);
	assert.strictEqual(career.contract, 0, 'contract still alive');
	assert.strictEqual(career.ship.cargoTons, task.tons);
});

check('a hard launch voids the loaded contract and drops the cargo; the rail still fires', () => {
	const w = setup(43);
	const { career } = fragileCareer(w);
	w.sim.speed = HARD;
	Game.careerBeginFlight(career, w.sim);
	assert.strictEqual(career.fragileLost, true);
	assert.strictEqual(career.flights, 1);
	assert.strictEqual(career.contract, -1, 'contract dropped');
	assert.strictEqual(career.ship.cargoTons, 0, 'cargo dropped');
	assert.strictEqual(career.tasks[0].fragile, false, 'the cleared slot forgets the flag');
	/* the flag is the last launch only */
	w.sim.speed = HARD;
	Game.careerBeginFlight(career, w.sim);
	assert.strictEqual(career.fragileLost, false);
});

check('a hard flight to the pickup breaks nothing', () => {
	const w = setup(47);
	const { career, task } = fragileCareer(w);
	task.state = Game.TASK_ACCEPTED;
	career.ship.cargoTons = 0;
	w.sim.speed = HARD;
	Game.careerBeginFlight(career, w.sim);
	assert.strictEqual(career.fragileLost, false);
	assert.strictEqual(career.contract, 0);
});

check('the landing table carries no reward for a shot that breaks the load', () => {
	const w = setup(53);
	const { career, planet, task } = fragileCareer(w);
	const out = { cash: 0, credit: 0, leg: 0 };
	Game.careerLandingFacts(out, career, planet, task.to, 0, 500, 100, 0, 0.25, GENTLE);
	assert.strictEqual(out.leg, Game.LEG_DELIVER);
	assert.ok(Math.abs(out.cash - (0.25 + task.reward)) < 1e-9, 'gentle: visit + reward, got ' + out.cash);
	Game.careerLandingFacts(out, career, planet, task.to, 0, 500, 100, 0, 0.25, HARD);
	assert.strictEqual(out.leg, Game.LEG_NONE);
	assert.strictEqual(out.cash, 0.25, 'hard: the visit only');
});

check('offered only from light planets and small loads, at 1.4x under the cap', () => {
	let fragile = 0;
	let offers = 0;
	const span = Math.round(Game.CAREER.deliverySec / DT) + 1;
	for (let seed = 1; seed <= 12; seed++) {
		const w = setup(seed);
		for (let round = 0; round < 12; round++) {
			Game.refreshBoard(w.career, w.trade, round * span);
			for (let i = 0; i < Game.CAREER.deliverySlots; i++) {
				const task = w.career.tasks[i];
				if (task.kind !== Game.TASK_DELIVERY) continue;
				offers += 1;
				if (!task.fragile) continue;
				fragile += 1;
				assert.ok(!task.tourist, 'tourists are not fragile freight');
				assert.ok(Game.planetGravity(w.career.seed, task.from) <= Game.FRAGILE_G,
					'seed ' + seed + ' offers a fragile load from g ' + Game.planetGravity(w.career.seed, task.from));
				assert.ok(task.tons <= Game.FRAGILE_TONS, 'fragile load of ' + task.tons + ' t');
				assert.ok(task.reward <= Game.CAREER.deliveryMax);
			}
		}
	}
	console.log('   ' + fragile + ' fragile of ' + offers + ' delivery offers over seeds 1-12');
	assert.ok(fragile > 0, 'no fragile offer in 12 seeds');
	assert.ok(fragile < offers / 4, 'fragile freight must stay the rare job');
});

console.log('FRAGILE OK · ' + checks + ' groups');
