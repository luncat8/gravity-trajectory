/*
 * Fragile load (0.6.3): the load dies on launch acceleration above FRAGILE_ACCEL,
 * the offer gate, canAccept refusal, and the aim-line void. Run: node experiments/fragile_test.js
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
	career.ledger.purse = 99; /* afford any pad/part in these tests */
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

/* fit an EMC on a planet and give the career a fragile delivery contract */
	function fragileCareer(w, catapult) {
		const career = w.career;
		const planet = normalPlanet(w);
		const to = (planet + 1) % UNIVERSE;
		career.at = planet;
		Game.buildGear(career, planet, 'catapult', catapult);
		Game.installPart(career, Tech.KIND_HOLD, Tech.HOLDS[1]);
		/* place a fragile delivery offer on the first slot and accept it */
		const task = career.tasks[0];
		task.kind = Game.TASK_DELIVERY;
		task.state = Game.TASK_OFFERED;
		task.fragile = true;
		task.tons = 4;
		task.from = planet;
		task.to = to;
		task.planet = -1;
		task.minLength = 0;
		task.reward = 3.00;
		task.deadline = 1000;
		assert.ok(Game.canAccept(career, 0), 'fragile offer accepted');
		assert.ok(Game.acceptTask(career, 0), 'accept');
		assert.strictEqual(career.ship.cargoTons, task.tons, 'cargo loaded');
		return { career, planet, task };
	}

check('fragileBlock voids a shot above the acceleration limit and passes a gentle one', () => {
	const w = setup(31);
	const career = w.career;
	const planet = normalPlanet(w);
	const task = { fragile: true, tons: 4 };
	assert.strictEqual(Game.fragileBlock(career, task, planet, GravitySim.SPEED_MIN), '',
		'SPEED_MIN is gentle (' + accelOf(GravitySim.SPEED_MIN).toFixed(3) + ' m/s^2)');
	assert.strictEqual(Game.fragileBlock(career, task, planet, 200), 'fragile load lost',
		'200 px/s breaks it (' + accelOf(200).toFixed(3) + ' m/s^2)');
	assert.strictEqual(Game.fragileBlock(career, { fragile: false, tons: 4 }, planet, 320), '',
		'a solid load never voids');
});

	check('the limit prices force: EMC-1 force cap is gentle on a loaded ship, EMC-2 force cap over', () => {
		const w = setup(37);
		const career = w.career;
		const ship = { hold: Tech.HOLDS[1], engine: Tech.ENGINES[0], tank: Tech.TANKS[1],
			obs: Tech.OBS[0], cargoTons: 8 };
		career.ship = ship;
		career.ship.mass = Tech.shipMass(career.ship, career.ship.cargoTons);
		const mass = career.ship.mass;
		/* force-limited top speed of each rail on this loaded ship (maxSpeed ignores battery energy) */
		const top1 = Tech.maxSpeed(mass, Tech.CATAPULTS[0], career.forceScale);
		const top2 = Tech.maxSpeed(mass, Tech.CATAPULTS[1], career.forceScale);
		console.log('   mass ' + mass.toFixed(1) + ' t · EMC-1 force cap ' + top1.toFixed(0) +
			' px/s (' + accelOf(top1).toFixed(2) + ' m/s^2) · EMC-2 force cap ' +
			top2.toFixed(0) + ' px/s (' + accelOf(top2).toFixed(2) + ' m/s^2)');
		assert.ok(accelOf(top1) <= Game.FRAGILE_ACCEL, 'EMC-1 force cap is gentle on a loaded ship');
		assert.ok(accelOf(top2) > Game.FRAGILE_ACCEL, 'EMC-2 force cap breaks a loaded ship');
		/* a gentle SPEED_MIN shot is safe on either rail */
		assert.ok(accelOf(GravitySim.SPEED_MIN) <= Game.FRAGILE_ACCEL, 'the slowest shot is safe');
	});

	check('a gentle fragile launch keeps the contract; a hard one voids it and drops the cargo', () => {
		const w = setup(41);
		const { career, planet, task } = fragileCareer(w, Tech.CATAPULTS[0]);
		assert.strictEqual(career.ship.cargoTons, task.tons, 'cargo loaded');
		const slot = career.tasks.indexOf(task);
		w.sim.origin = planet;
		w.sim.speed = GravitySim.SPEED_MIN;
		w.sim.markSystemsAt = function () {}; /* the field is not needed for the void test */
		Game.careerBeginFlight(career, w.sim);
		assert.strictEqual(career.fragileLost, false, 'gentle launch keeps the load');
		assert.strictEqual(career.contract, slot, 'contract still alive');
	});

	check('a fragile load fired above the limit voids the contract and drops the cargo', () => {
		const w = setup(43);
		const { career, planet, task } = fragileCareer(w, Tech.CATAPULTS[1]);
		assert.strictEqual(career.ship.cargoTons, task.tons, 'cargo loaded');
		const slot = career.tasks.indexOf(task);
		w.sim.origin = planet;
		w.sim.speed = 200;
		w.sim.markSystemsAt = function () {}; /* the field is not needed for the void test */
		Game.careerBeginFlight(career, w.sim);
		assert.strictEqual(career.fragileLost, true, 'hard launch voids the load');
		assert.strictEqual(career.contract, -1, 'contract dropped');
		assert.strictEqual(career.ship.cargoTons, 0, 'cargo dropped');
	});

	check('canAccept refuses a fragile offer when no gentle launch exists from here', () => {
		const w = setup(47);
		const career = w.career;
		const planet = normalPlanet(w);
		career.at = planet;
		Game.installPart(career, Tech.KIND_HOLD, Tech.HOLDS[1]);
		/* no own pad and a ship so heavy the commercial EMC-1 cannot reach SPEED_MIN */
		career.ship.mass = 500;
		const commercialLift = Tech.speedLimit(Tech.BATTERIES[0].capacity, 500,
			Tech.CATAPULTS[0], career.forceScale);
		assert.ok(commercialLift + 1e-9 < GravitySim.SPEED_MIN,
			'commercial cannot lift 500 t (lift ' + commercialLift.toFixed(1) + ' px/s)');
		const task = career.tasks[0];
		task.kind = Game.TASK_DELIVERY;
		task.state = Game.TASK_OFFERED;
		task.fragile = true;
		task.tons = 4;
		task.from = planet;
		task.to = (planet + 1) % UNIVERSE;
		task.reward = 3.00;
		task.deadline = 1000;
		assert.strictEqual(Game.canAccept(career, 0), false, 'fragile offer refused: no gentle launch');
		/* the same ship can still take a non-fragile load */
		task.fragile = false;
		assert.strictEqual(Game.canAccept(career, 0), true, 'non-fragile offer accepted');
	});

check('fragile reward math: 1.4x an ordinary delivery, still under the cap', () => {
	const tons = 8;
	const dist = 100;
	const basePay = Game.CAREER.deliveryBase + tons * Game.CAREER.deliveryPerTon * (1 + 0.5) *
		(1 + dist / Game.CAREER.deliveryDistPx);
	const fragilePay = basePay * Game.FRAGILE_PAY;
	const reward = Math.round(Math.min(fragilePay, Game.CAREER.deliveryMax) * 100) / 100;
	assert.ok(reward > 0 && reward <= Game.CAREER.deliveryMax,
		'fragile reward ' + reward + ' within (0, ' + Game.CAREER.deliveryMax + ']');
	assert.ok(fragilePay > basePay, 'fragile pays more than ordinary');
});

console.log('FRAGILE OK · ' + checks + ' groups');
