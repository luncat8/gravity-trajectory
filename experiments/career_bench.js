/*
 * Career mode bench (0.4.x): catapult launch model, knowledge hull, solar /
 * battery, bulk planet-gear upgrades, and a headless career run on the real
 * gravity sim: pad gating, energy draw and recharge, stranding, evacuation,
 * building, contracts, competitions, cheats, link codec, end conditions.
 * Deterministic, node-only. Run: node experiments/career_bench.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const OrbitScience = require(path.join(root, 'orbit_science.js'));
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));

globalThis.performance = globalThis.performance || { now: () => Date.now() };

const PLANETS = OrbitWorld.PLANETS;
const EMC = OrbitTech.CATAPULTS;
const SP = OrbitTech.PANELS;
const BAT = OrbitTech.BATTERIES;
const HOLD = OrbitTech.HOLDS;
const CAREER = GravityGame.CAREER;
let failures = 0;

function check(name, fn) {
	try {
		fn();
		console.log('ok - ' + name);
	} catch (e) {
		failures++;
		console.log('FAIL - ' + name + ': ' + e.message);
	}
}

function dry() {
	return OrbitTech.shipMass({ hold: HOLD[0], engine: null, tank: OrbitTech.TANKS[0] }, 0);
}

/* --- §1 launch model ---------------------------------------------------- */

check('dry ship launchable by weak EMC-1 from a full BAT-1 in the 85-95 px/s band', () => {
	const limit = OrbitTech.speedLimit(BAT[0].capacity, dry(), EMC[0]);
	assert.ok(limit > 85 && limit < 95, 'speed limit ' + limit);
	assert.ok(OrbitTech.canLaunch(BAT[0].capacity, dry(), EMC[0], 90));
	assert.ok(!OrbitTech.canLaunch(BAT[0].capacity, dry(), EMC[0], 100));
	assert.ok(OrbitTech.launchEnergy(dry(), EMC[0], 90) <= BAT[0].capacity);
});

check('24 t cargo + HOLD-24 stalls below 50 on EMC-1 / BAT-1, flies on EMC-5 / BAT-5', () => {
	const mass = OrbitTech.shipMass({ hold: HOLD[2], engine: null, tank: OrbitTech.TANKS[0] }, 24);
	assert.strictEqual(mass, 38);
	assert.ok(OrbitTech.speedLimit(BAT[0].capacity, mass, EMC[0]) < 50, 'loaded EMC-1 limit');
	assert.ok(!OrbitTech.canLaunch(BAT[0].capacity, mass, EMC[0], 100));
	assert.ok(OrbitTech.canLaunch(BAT[4].capacity, mass, EMC[4], 100));
});

check('rail force caps speed even with a huge battery; efficiency cuts energy', () => {
	const m = dry();
	assert.ok(Math.abs(OrbitTech.speedLimit(1000, m, EMC[0]) - OrbitTech.maxSpeed(m, EMC[0])) < 1e-9);
	assert.ok(OrbitTech.maxSpeed(m, EMC[0]) < OrbitTech.maxSpeed(m, EMC[4]));
	assert.ok(OrbitTech.launchEnergy(m, EMC[4], 90) < OrbitTech.launchEnergy(m, EMC[0], 90));
	assert.strictEqual(OrbitTech.speedLimit(1, m, null), 0);
	assert.strictEqual(OrbitTech.speedLimit(0, m, EMC[0]), 0);
});

check('impulse delta-v needs engine + fuel, grows with fuel', () => {
	const dv = OrbitTech.impulseDeltaV(1000, OrbitTech.ENGINES[1], 20);
	assert.ok(dv > 0 && dv < 200, 'dv ' + dv);
	assert.ok(OrbitTech.impulseDeltaV(2000, OrbitTech.ENGINES[1], 20) > dv);
	assert.strictEqual(OrbitTech.impulseDeltaV(0, OrbitTech.ENGINES[1], 20), 0);
	assert.strictEqual(OrbitTech.impulseDeltaV(10, null, 20), 0);
});

/* --- §2 knowledge hull -------------------------------------------------- */

check('1D hull: segment, interior cheap, exterior costs k*dist', () => {
	const fam = 'test1d';
	OrbitScience.accept(fam, [0], 'zero');
	OrbitScience.accept(fam, [10], 'ten');
	const inside = OrbitScience.preview(fam, [5]);
	assert.ok(inside.inside && Math.abs(inside.dist) < 1e-6);
	const outside = OrbitScience.preview(fam, [20]);
	assert.ok(!outside.inside && Math.abs(outside.dist - 10) < 1e-6 && outside.cost > inside.cost);
	OrbitScience.accept(fam, [20], 'twenty');
	assert.ok(OrbitScience.preview(fam, [20]).inside);
});

check('2D hull: triangle interior cheap, exterior priced by distance', () => {
	const fam = 'test2d';
	OrbitScience.accept(fam, [0, 0], 'a');
	OrbitScience.accept(fam, [10, 0], 'b');
	OrbitScience.accept(fam, [0, 10], 'c');
	assert.ok(OrbitScience.preview(fam, [3, 3]).inside);
	const out = OrbitScience.preview(fam, [8, 8]);
	assert.ok(!out.inside && Math.abs(out.dist - 6 / Math.sqrt(2)) < 1e-6);
	assert.ok(out.cost > OrbitScience.preview(fam, [3, 3]).cost);
});

check('empty family: everything outside, infinite dist', () => {
	const p = OrbitScience.preview('nope', [1]);
	assert.ok(!p.inside && p.dist === Infinity);
});

check('per-career hulls are isolated and an accepted vertex is exactly inside', () => {
	const a = OrbitScience.createHull();
	const b = OrbitScience.createHull();
	OrbitScience.acceptHull(a, 'engine', [12, 1], 'IMP-1');
	OrbitScience.acceptHull(a, 'engine', [40, 2.5], 'IMP-3');
	assert.strictEqual(OrbitScience.statsHull(a, 'engine').n, 2);
	assert.strictEqual(OrbitScience.statsHull(b, 'engine').n, 0, 'hulls must not share state');
	assert.strictEqual(OrbitScience.previewHull(b, 'engine', [12, 1]).dist, Infinity);
	/* midpoint of the segment is a cheap interior recombining */
	const mid = OrbitScience.previewHull(a, 'engine', [26, 1.75]);
	assert.ok(mid.inside && Math.abs(mid.cost - OrbitScience.BASE_PRICE.engine * OrbitScience.meritFactor('engine', [26, 1.75])) < 1e-9);
	/* re-previewing an accepted vertex is exact even on a thin near-collinear hull */
	OrbitScience.acceptHull(a, 'engine', [26, 1.8], 'R1');
	const again = OrbitScience.previewHull(a, 'engine', [26, 1.8]);
	assert.ok(again.inside && again.dist === 0 && again.cost === OrbitScience.BASE_PRICE.engine * OrbitScience.meritFactor('engine', [26, 1.8]));
	const labels = OrbitScience.pointsHull(a, 'engine').map(p => p.label);
	assert.deepStrictEqual(labels, ['IMP-1', 'IMP-3', 'R1']);
	assert.deepStrictEqual(OrbitScience.pointsHull(a, 'ghost'), []);
});

/* --- §3 solar / battery ------------------------------------------------- */

check('solar charge: kW·s -> kWh, dim world charges slowly, leak decays', () => {
	assert.ok(Math.abs(OrbitTech.solarCharge(SP[0], 1, 3600) - 1.0) < 1e-9);
	assert.ok(OrbitTech.solarCharge(SP[3], 1, 3600) > 5 * OrbitTech.solarCharge(SP[0], 0.2, 3600));
	const c1 = OrbitTech.batteryLeak(BAT[0], 1.5, 100);
	assert.ok(c1 < 1.5 && c1 > 1.3);
	assert.ok(OrbitTech.batteryLeak(BAT[4], 1.5, 100) > c1);
});

/* --- §4 bulk planet-gear upgrade ---------------------------------------- */

check('bulkUpgradeCost sums the tier cost over built facilities only', () => {
	const pads = [
		{ catapult: EMC[0], panel: SP[0], battery: BAT[0], chargeKwh: 1.5 },
		{ catapult: EMC[0], panel: SP[0], battery: BAT[0], chargeKwh: 1.5 },
		{ catapult: EMC[2], panel: SP[0], battery: BAT[0], chargeKwh: 1.5 },
		{ catapult: null, panel: null, battery: null, chargeKwh: 0 }
	];
	assert.strictEqual(OrbitTech.bulkUpgradeCost(pads, 'catapult', EMC[2]), 2 * EMC[2].buildCost);
	assert.strictEqual(OrbitTech.bulkUpgradeCost(pads, 'catapult', EMC[1]), 2 * EMC[1].buildCost);
	assert.strictEqual(OrbitTech.bulkUpgradeCost(pads, 'catapult', EMC[0]), 0, 'never a downgrade');
	assert.strictEqual(OrbitTech.bulkUpgradeCost(pads, 'panel', SP[0]), 0);
	assert.strictEqual(OrbitTech.bulkUpgradeCost(pads, 'panel', SP[3]), 3 * SP[3].buildCost);
});

/* --- §5 copy spec / starter grant --------------------------------------- */

check('copySpec emits the balance line; starter grant is the weak kit', () => {
	const line = OrbitTech.copySpec('catapult', EMC[1]);
	assert.ok(/^tech: CATAPULT EMC-2 \{ /.test(line) && line.indexOf('maxForce: 90') >= 0, line);
	assert.ok(/^tech: ENGINE IMP-2 \{/.test(OrbitTech.copySpec('engine', OrbitTech.ENGINES[1])));
	assert.strictEqual(OrbitTech.copySpec('nope', EMC[0]), '');
	assert.strictEqual(OrbitTech.findKind('catapult', 'EMC-3'), EMC[2]);
	assert.strictEqual(OrbitTech.findKind('catapult', 'EMC-9'), null);
	const g = OrbitTech.starterGrant();
	assert.ok(g.pad.catapult === EMC[0] && g.pad.panel === SP[0] && g.pad.battery === BAT[0]);
	assert.ok(g.ship.hold === HOLD[0] && g.ship.engine === null && g.purse >= CAREER.evacFee);
});

/* §11 balance dump: every tech record as a paste-ready spec line */
for (const kind of Object.keys(OrbitTech.TABLES)) {
	for (const item of OrbitTech.TABLES[kind]) {
		const spec = OrbitTech.copySpec(kind, item);
		assert.ok(spec.indexOf('tech: ' + kind.toUpperCase() + ' ' + item.id) === 0, spec);
		console.log('  ' + spec);
	}
}
/* §10 frontier knobs are balance data too: print them in the same dump */
for (const family of Object.keys(OrbitScience.FRONTIER)) {
	const dirs = OrbitScience.FRONTIER[family];
	for (let d = 0; d < dirs.length; d++) {
		console.log('  frontier: ' + family.toUpperCase() + ' axis' + d +
			' { below: ' + dirs[d].below.toFixed(2) + ', above: ' + dirs[d].above.toFixed(2) + ' }');
	}
}

/* --- §6 headless career run on the real gravity sim --------------------- */

const DT = GravitySim.DT;
const RATE = 1;

function makeWorld(seed) {
	const trade = new Sim(seed);
	trade.advanceTo(420);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	sim.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	sim.setField(PLANETS, trade.planetR, strength, (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) {
			ox[i] = trade.planetX[i];
			oy[i] = trade.planetY[i];
		}
	}, true);
	sim.fieldT = trade.t;
	sim.fieldRate = RATE;
	sim.stepLimit = GravityGame.CAP_STEPS;
	const ledger = GravityGame.createLedger();
	const career = GravityGame.createCareer(ledger);
	const market = GravityGame.createMarket();
	return { trade, sim, career, ledger, market, step: 0 };
}

function startCareer(w, seed, cheat) {
	GravityGame.startCareer(w.career, w.sim, seed, w.trade, cheat || null);
	GravityGame.resetMarket(w.market);
	w.step = 0;
}

check('experimental scales: force shrinks the rail cap and the live pad gate', () => {
	const w = makeWorld(42);
	startCareer(w, 42, null);
	const base = w.sim.speedLimit(w.career.at);
	const mass = w.career.ship.mass;
	const half = OrbitTech.speedLimit(BAT[0].capacity, mass, EMC[0], 0.5);
	assert.ok(Math.abs(half - base * Math.SQRT1_2) < 1e-9, 'force scale ' + half);
	assert.ok(OrbitTech.canLaunch(BAT[0].capacity, mass, EMC[0], half, 0.5));
	assert.ok(!OrbitTech.canLaunch(BAT[0].capacity, mass, EMC[0], base, 0.5));
	/* launch energy is a function of mass, speed and efficiency only */
	assert.strictEqual(OrbitTech.launchEnergy(mass, EMC[0], base),
		OrbitTech.launchEnergy(mass, EMC[0], base));
	w.sim.setScales(1, 0.5);
	assert.ok(Math.abs(w.sim.speedLimit(w.career.at) - half) < 1e-9);
	assert.ok(!w.sim.canFire(w.career.at, base));
	assert.ok(w.sim.canFire(w.career.at, half));
	w.sim.setScales(1, 1);
	assert.ok(Math.abs(w.sim.speedLimit(w.career.at) - base) < 1e-9);
});

check('experimental gravity scales every pull and keeps prediction parity', () => {
	const probe = new GravitySim(1000, 1000);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(1);
	const radius = new Float64Array(1).fill(10);
	probe.setField(1, radius, strength, (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) {
			ox[i] = 500;
			oy[i] = 500;
		}
	}, true);
	probe.fillStep(0);
	const pull = scale => {
		probe.setScales(scale, 1);
		const state = { x: 100, y: 500, vx: 0, vy: 0 };
		probe.advance(state, DT);
		return state.vx;
	};
	const one = pull(1);
	assert.ok(one > 0);
	assert.strictEqual(pull(0), 0);
	assert.ok(Math.abs(pull(0.5) - one * 0.5) < 1e-12);
	assert.ok(Math.abs(pull(2) - one * 2) < 1e-12);
	/* the live flight and the preview share advance(): a scaled field must match */
	const w = makeWorld(7);
	startCareer(w, 7, null);
	w.sim.setScales(0.5, 1);
	w.sim.predict(0, 1.1, 150, Infinity);
	const points = w.sim.predCount;
	assert.ok(points > 2, 'scaled preview has no path');
	w.sim.launch(0, 1.1, 150);
	let deviation = 0;
	for (let i = 1; i < points; i++) {
		w.sim.stepOne();
		const dx = w.sim.cargo.x - w.sim.predX[i];
		const dy = w.sim.cargo.y - w.sim.predY[i];
		const d = Math.sqrt(dx * dx + dy * dy);
		if (d > deviation) deviation = d;
	}
	assert.ok(deviation < 1e-3, 'scaled prediction parity ' + deviation);
	w.sim.setScales(1, 1);
});

/* the fastest affordable shot from `from` that lands on `want` (or any other planet) */
function findShot(w, from, want) {
	const sim = w.sim;
	const limit = sim.speedLimit(from);
	let best = null;
	for (let s = Math.floor(limit); s >= GravitySim.SPEED_MIN; s -= 10) {
		for (let a = 0; a < 72; a++) {
			const angle = (a + 0.31) / 72 * Math.PI * 2;
			sim.predictFast(from, angle, s, GravityGame.CAP_SECONDS);
			if (sim.predReason !== GravitySim.END_IMPACT || sim.predBody === from) continue;
			if (want >= 0 ? sim.predBody !== want : false) continue;
			const score = sim.predLength;
			if (!best || score > best.score) best = { angle, speed: s, score, body: sim.predBody };
		}
		if (best) return best;
	}
	return null;
}

function fly(w, from, angle, speed) {
	const { sim, career, ledger, market, trade } = w;
	assert.ok(sim.canFire(from, speed), 'pad refused the shot at ' + speed);
	sim.launch(from, angle, speed);
	GravityGame.careerBeginFlight(career, sim);
	while (sim.status === GravitySim.STATUS_FLYING) {
		w.step += 1;
		sim.stepOne();
		GravityGame.stepHarvest(ledger, market, sim, w.step);
		GravityGame.careerAdvance(career, RATE, 1);
	}
	trade.advanceTo(sim.flightFieldT);
	return GravityGame.careerEndFlight(career, sim, trade, w.step);
}

check('career start: HQ pad only, sim gates on the network, link codec carries cheat', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, trade } = w;
	assert.ok(career.hq >= 0 && career.padCount === 1 && career.at === career.hq);
	assert.ok(trade.planetLight[career.hq] >= CAREER.hqMinLight, 'HQ must be sunlit');
	assert.strictEqual(sim.landedBody, career.hq);
	assert.ok(sim.canLaunchFrom(career.hq));
	for (let p = 0; p < PLANETS; p++) {
		if (p !== career.hq) assert.ok(!sim.canLaunchFrom(p), 'P' + p + ' has no catapult');
	}
	assert.ok(sim.canFire(career.hq, 90) && !sim.canFire(career.hq, 100));
	assert.ok(sim.launchEnergy(career.hq, 90) > 0 && sim.speedLimit(career.hq) < 95);
	const link = GravityGame.encodeLink({ seed: 42, rate: 1, rule: 'career', bot: 'off', player: 'user',
		cheat: 'endgame', shots: [{ src: 0, origin: 0, angle: 0, speed: 40000, abort: -1 }] });
	assert.strictEqual(link, 'game=1&seed=42&rate=1&rule=career&cheat=endgame', link);
	const back = GravityGame.decodeLink('#' + link);
	assert.ok(back && back.rule === 'career' && back.cheat === 'endgame' && back.shots.length === 0);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=tour&cheat=endgame'), null);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career&cheat=free'), null);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career&shots=p0.0.3aio'), null);
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=42&rate=1&rule=career').cheat, null);
	assert.ok(!GravityGame.RULES.tour.solo && !GravityGame.RULES.career.solo &&
		GravityGame.RULES.career.humanOnly);
});

check('career board: deliveries pair an exporting colony with a short one, pay below the evacuation fee', () => {
	let offers = 0;
	for (const seed of [1, 7, 42, 913, 2024]) {
		const w = makeWorld(seed);
		startCareer(w, seed);
		for (let i = 0; i < CAREER.deliverySlots; i++) {
			const t = w.career.tasks[i];
			if (t.kind !== GravityGame.TASK_DELIVERY) continue;
			offers += 1;
			assert.ok(t.from !== t.to && t.from >= 0 && t.to >= 0);
			assert.ok(w.trade.colonyAt(t.from) && w.trade.colonyAt(t.to), 'both ends are colonies');
			assert.ok(t.reward > 0 && t.reward < CAREER.evacFee, 'reward ' + t.reward);
			assert.ok(GravityGame.CARGO_TONS.indexOf(t.tons) >= 0);
			assert.ok(t.deadline === Math.round(CAREER.deliverySec / DT));
			assert.ok(!GravityGame.canAccept(w.career, i), 'HOLD-0 cannot accept cargo');
		}
	}
	assert.ok(offers >= 15, 'only ' + offers + ' offers over 5 seeds');
});

check('career board is a pure function of (seed, world, clock)', () => {
	const a = makeWorld(913);
	const b = makeWorld(913);
	startCareer(a, 913);
	startCareer(b, 913);
	assert.strictEqual(JSON.stringify(a.career.tasks), JSON.stringify(b.career.tasks));
	assert.strictEqual(a.career.hq, b.career.hq);
	const c = makeWorld(914);
	startCareer(c, 914);
	assert.notStrictEqual(JSON.stringify(a.career.tasks), JSON.stringify(c.career.tasks));
});

check('career flight: launch draws pad energy (no purse fee), landing elsewhere strands the ship', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	const hq = career.hq;
	const pad = career.pads[hq];
	const shot = findShot(w, hq, -1);
	assert.ok(shot, 'no landing shot from HQ');
	const purse0 = ledger.purse;
	const charge0 = pad.chargeKwh;
	const energy = sim.launchEnergy(hq, shot.speed);
	fly(w, hq, shot.angle, shot.speed);
	assert.strictEqual(career.flights, 1);
	assert.ok(Math.abs(career.lastEnergy - energy) < 1e-12);
	assert.ok(pad.chargeKwh < charge0, 'battery must drop');
	assert.ok(pad.chargeKwh > charge0 - energy, 'pad recharges during the flight');
	assert.ok(ledger.purse >= purse0, 'no launch fee; visits only add: ' + ledger.purse);
	assert.ok(ledger.fee === 0 && ledger.last === ledger.shotGain);
	assert.strictEqual(career.at, sim.endBody);
	assert.ok(career.stranded && career.ended === GravityGame.CAREER_OPEN);
	assert.ok(career.pads[career.at].catapult === null && sim.canLaunchFrom(career.at));
	assert.ok(sim.canFire(career.at, GravitySim.SPEED_MIN));
	assert.ok(!sim.canLaunchFrom(hq), 'the landed rule still binds');
});

check('career stranded: building a catapult brings a charged starter pad; the pad then fires', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	const shot = findShot(w, career.hq, -1);
	fly(w, career.hq, shot.angle, shot.speed);
	const here = career.at;
	assert.ok(!GravityGame.buildGear(career, here, 'panel', SP[1]), 'no panel without a pad');
	const purse = ledger.purse;
	assert.ok(GravityGame.buildGear(career, here, 'catapult', EMC[0]));
	assert.ok(Math.abs(ledger.purse - (purse - EMC[0].buildCost)) < 1e-9);
	assert.ok(!career.stranded && career.padCount === 2);
	const pad = career.pads[here];
	assert.ok(pad.panel === SP[0] && pad.battery === BAT[0] && pad.chargeKwh === BAT[0].capacity);
	assert.ok(sim.canLaunchFrom(here) && sim.canFire(here, 90));
	assert.ok(!GravityGame.buildGear(career, here, 'catapult', EMC[0]), 'same tier again is a no-op');
	assert.ok(!GravityGame.buildGear(career, here, 'catapult', EMC[4]), 'cannot afford EMC-5');
	assert.ok(GravityGame.buildGear(career, here, 'battery', BAT[1]) && pad.battery === BAT[1]);
	assert.ok(!GravityGame.buildGear(career, here, 'battery', BAT[0]), 'no downgrade');
});

check('career evacuation: fee, ship back on HQ, broke when the purse cannot cover an exit', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	assert.ok(!GravityGame.evacuate(career, sim), 'nothing to evacuate from HQ');
	const shot = findShot(w, career.hq, -1);
	fly(w, career.hq, shot.angle, shot.speed);
	const purse = ledger.purse;
	assert.ok(GravityGame.evacuate(career, sim));
	assert.ok(Math.abs(ledger.purse - (purse - CAREER.evacFee)) < 1e-9);
	assert.ok(career.at === career.hq && !career.stranded && career.evacuations === 1);
	assert.strictEqual(sim.landedBody, career.hq);
	assert.ok(sim.status === GravitySim.STATUS_IDLE && sim.canLaunchFrom(career.hq));
	assert.strictEqual(career.ended, GravityGame.CAREER_OPEN);
	/* second stranding with a thin purse: no affordable exit = broke */
	const again = findShot(w, career.hq, -1);
	assert.ok(again, 'HQ pad still has charge for a slow shot: limit ' + sim.speedLimit(career.hq));
	assert.strictEqual(fly(w, career.hq, again.angle, again.speed), GravityGame.CAREER_OPEN);
	assert.ok(career.stranded);
	ledger.purse = CAREER.commercialFee - 0.5;
	assert.strictEqual(GravityGame.checkEnded(career), GravityGame.CAREER_BROKE);
	assert.strictEqual(career.ended, GravityGame.CAREER_BROKE);
	/* a negative purse is broke anywhere */
	const v = makeWorld(7);
	startCareer(v, 7);
	v.ledger.purse = -0.01;
	assert.strictEqual(GravityGame.checkEnded(v.career), GravityGame.CAREER_BROKE);
});

check('commercial EMC-1: chosen on any planet, never claims or blocks building', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	const hq = career.hq;
	assert.strictEqual(GravityGame.padAt(career, hq), career.pads[hq]);
	assert.strictEqual(GravityGame.launchFee(career, hq, 60), 0);
	/* the commercial rail can be picked even under your own standing EMC */
	GravityGame.setCommercial(career, hq);
	assert.strictEqual(GravityGame.padAt(career, hq), GravityGame.COMMERCIAL_PAD);
	assert.strictEqual(GravityGame.padOwner(career, hq), GravityGame.OWNER_COMMERCIAL);
	assert.strictEqual(GravityGame.launchFee(career, hq, 60), CAREER.commercialFee);
	assert.strictEqual(sim.pads[hq], GravityGame.COMMERCIAL_PAD);
	const shot = findShot(w, hq, -1);
	assert.ok(shot, 'no shot off the commercial rail');
	fly(w, hq, shot.angle, shot.speed);
	assert.strictEqual(career.lastFee, CAREER.commercialFee);
	assert.strictEqual(career.lastEnergy, 0, 'commercial launch spent the own battery');
	assert.strictEqual(career.taxPaid, 0, 'commercial fee goes to nobody in particular');
	assert.strictEqual(career.commercialPlanet, -1, 'the choice buys exactly one launch');
	assert.ok(career.stranded, 'landed away from the own network');
	/* choosing it on the landing planet never blocks claiming that planet */
	const here = career.at;
	ledger.purse = 20;
	GravityGame.setCommercial(career, here);
	assert.ok(GravityGame.buildGear(career, here, 'catapult', EMC[0]), 'build blocked by the commercial choice');
	assert.strictEqual(career.commercialPlanet, -1);
	assert.strictEqual(GravityGame.padAt(career, here), career.pads[here]);
});

check('EMC barrels turn once per 2…5 s and sweep a full circle', () => {
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 7);
	for (let p = 0; p < PLANETS; p++) {
		const period = GravityGame.turretPeriod(galaxy, p);
		assert.ok(period >= 2 && period <= 5, 'period of P' + p + ': ' + period);
		const a0 = GravityGame.turretAngle(galaxy, p, 12.5);
		const a1 = GravityGame.turretAngle(galaxy, p, 12.5 + period);
		const sweep = Math.abs(a1 - a0 - Math.PI * 2);
		assert.ok(sweep < 1e-9, 'one period must sweep 2π on P' + p + ': ' + sweep);
		const a2 = GravityGame.turretAngle(galaxy, p, 12.5 + period / 2);
		const half = Math.abs(a2 - a0 - Math.PI);
		assert.ok(half < 1e-9, 'half a period must sweep π on P' + p + ': ' + half);
	}
});

check('career pads: solar refills on the world clock up to capacity, dim pads slower', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	const hq = career.hq;
	career.pads[hq].chargeKwh = 0;
	GravityGame.careerAdvance(career, RATE, Math.round(10 / DT));
	const after10 = career.pads[hq].chargeKwh;
	assert.ok(after10 > 0.1 && after10 < 0.4, '10 s of sun gave ' + after10);
	GravityGame.careerAdvance(career, RATE, Math.round(600 / DT));
	assert.ok(Math.abs(career.pads[hq].chargeKwh - BAT[0].capacity) < 1e-9, 'capped at capacity');
	/* darkest pad vs HQ */
	w.ledger.purse = 20;
	let dim = 0;
	for (let p = 1; p < PLANETS; p++) if (career.light[p] < career.light[dim]) dim = p;
	assert.ok(GravityGame.buildGear(career, dim, 'catapult', EMC[0]));
	career.pads[dim].chargeKwh = 0;
	career.pads[hq].chargeKwh = 0;
	GravityGame.careerAdvance(career, RATE, Math.round(10 / DT));
	assert.ok(career.pads[dim].chargeKwh < career.pads[hq].chargeKwh);
	assert.ok(career.pads[dim].chargeKwh > 0, 'the light floor keeps every pad alive');
	assert.ok(career.light[dim] >= CAREER.lightFloor * 0.5);
	/* with the battery empty no shot fires; after charging a slow one does */
	career.pads[hq].chargeKwh = 0;
	assert.ok(!w.sim.canFire(hq, GravitySim.SPEED_MIN) && w.sim.speedLimit(hq) === 0);
	GravityGame.careerAdvance(career, RATE, Math.round(60 / DT));
	assert.ok(w.sim.canFire(hq, GravitySim.SPEED_MIN));
});

check('career contracts: hold required, cargo adds mass, delivery pays on landing at the target', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	const task = career.tasks[0];
	assert.strictEqual(task.kind, GravityGame.TASK_DELIVERY);
	assert.ok(!GravityGame.acceptTask(career, 0), 'no hold');
	assert.ok(GravityGame.installPart(career, 'hold', HOLD[2]));
	assert.ok(career.owned['HOLD-24'] && career.ship.hold === HOLD[2]);
	const dryMass = career.ship.mass;
	assert.ok(GravityGame.acceptTask(career, 0));
	assert.ok(!GravityGame.acceptTask(career, 1), 'one contract at a time');
	assert.strictEqual(career.contract, 0);
	/* teleport the idle ship to the origin pad, as a landing there would */
	GravityGame.buildGear(career, task.from, 'catapult', EMC[0]);
	career.ledger.purse = 50;
	sim.relocate(task.from);
	sim.endReason = GravitySim.END_IMPACT;
	sim.endBody = task.from;
	sim.origin = -1;
	GravityGame.careerEndFlight(career, sim, w.trade, w.step);
	assert.strictEqual(task.state, GravityGame.TASK_LOADED);
	assert.ok(Math.abs(career.ship.mass - (dryMass + task.tons)) < 1e-9, 'cargo mass');
	assert.ok(sim.speedLimit(task.from) < OrbitTech.speedLimit(BAT[0].capacity, dryMass, EMC[0]));
	/* deliver */
	const reward = task.reward;
	const purse = ledger.purse;
	sim.relocate(task.to);
	sim.endReason = GravitySim.END_IMPACT;
	sim.endBody = task.to;
	GravityGame.careerEndFlight(career, sim, w.trade, w.step);
	assert.ok(Math.abs(ledger.purse - (purse + reward)) < 1e-9, 'reward paid');
	assert.ok(career.contract < 0 && career.ship.cargoTons === 0 && career.delivered === 1);
	assert.ok(Math.abs(career.ship.mass - dryMass) < 1e-9);
	assert.strictEqual(career.lastReward, reward);
	assert.ok(career.tasks[0].kind === GravityGame.TASK_DELIVERY, 'board refilled');
	assert.ok(!GravityGame.installPart(career, 'hold', HOLD[0]), 'refits only at HQ');
});

check('post-pickup EMC-1 cap: cargo mass lowers the starter-rail cap', () => {
	const dryMass = dry();
	const tons = 8;
	const postMass = OrbitTech.shipMass({ hold: HOLD[0], engine: null, tank: OrbitTech.TANKS[0] }, tons);
	assert.strictEqual(postMass, dryMass + tons, 'post-pickup mass = dry + cargo');
	/* the note's ship.mass + task.tons mirrors the post-pickup mass */
	assert.strictEqual(dryMass + tons, postMass);
	const capEmpty = OrbitTech.speedLimit(BAT[0].capacity, dryMass, EMC[0]);
	const capLoaded = OrbitTech.speedLimit(BAT[0].capacity, postMass, EMC[0]);
	assert.ok(capLoaded < capEmpty, 'loaded EMC-1 cap below dry (' + capLoaded + ' < ' + capEmpty + ')');
	assert.ok(capLoaded >= 0);
	/* dry ship launches in the 85-95 px/s band; loaded ship may stall under SPEED_MIN on EMC-1/BAT-1 */
	assert.ok(OrbitTech.canLaunch(BAT[0].capacity, dryMass, EMC[0], 90));
	const canLiftLoaded = OrbitTech.canLaunch(BAT[0].capacity, postMass, EMC[0], GravitySim.SPEED_MIN);
	assert.ok(typeof canLiftLoaded === 'boolean');
});

check('career lost in space: a map exit strands nowhere; only the evacuation brings the ship back', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	sim.landedBody = -1;
	sim.endReason = GravitySim.END_EXIT;
	sim.endBody = -1;
	GravityGame.careerEndFlight(career, sim, w.trade, 10);
	assert.ok(career.at === -1 && career.stranded && career.ended === GravityGame.CAREER_OPEN);
	assert.ok(!sim.canLaunchFrom(career.hq), 'no vessel on the HQ pad');
	ledger.purse = 20;
	assert.ok(GravityGame.buildGear(career, career.hq, 'catapult', EMC[1]) && career.stranded, 'building does not rescue');
	ledger.purse = CAREER.evacFee - 0.5;
	assert.strictEqual(GravityGame.checkEnded(career), GravityGame.CAREER_BROKE, 'a cheap catapult is no way out');
	const v = makeWorld(42);
	startCareer(v, 42);
	v.sim.landedBody = -1;
	v.sim.endReason = GravitySim.END_TIME;
	v.sim.endBody = -1;
	GravityGame.careerEndFlight(v.career, v.sim, v.trade, 10);
	assert.ok(GravityGame.evacuate(v.career, v.sim));
	assert.ok(v.career.at === v.career.hq && v.sim.canLaunchFrom(v.career.hq) && v.career.evacuations === 1);
});

check('career contracts expire with the clock and drop the cargo', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim } = w;
	GravityGame.installPart(career, 'hold', HOLD[2]);
	GravityGame.acceptTask(career, 0);
	const deadline = career.tasks[0].deadline;
	sim.endReason = GravitySim.END_EXIT;
	sim.endBody = -1;
	GravityGame.careerEndFlight(career, sim, w.trade, deadline + 1);
	assert.ok(career.contract < 0 && career.ship.cargoTons === 0);
	assert.ok(career.tasks[0].kind === GravityGame.TASK_DELIVERY && career.tasks[0].deadline > deadline);
});

check('career competition: pays once for a long enough landing flight from its planet', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, ledger } = w;
	const task = career.tasks[GravityGame.COMPETE_SLOT];
	task.kind = GravityGame.TASK_COMPETE;
	task.planet = career.hq;
	task.minLength = 300;
	task.reward = 2.5;
	task.deadline = 10000;
	const purse = ledger.purse;
	sim.origin = career.hq;
	sim.flightLength = 299;
	sim.endReason = GravitySim.END_IMPACT;
	sim.endBody = career.hq;
	GravityGame.careerEndFlight(career, sim, w.trade, 5);
	assert.ok(Math.abs(ledger.purse - purse) < 1e-9 && task.kind === GravityGame.TASK_COMPETE, 'too short');
	sim.flightLength = 300;
	GravityGame.careerEndFlight(career, sim, w.trade, 6);
	assert.ok(Math.abs(ledger.purse - (purse + 2.5)) < 1e-9, 'prize paid');
	assert.ok(career.tasks[GravityGame.COMPETE_SLOT].reward !== 2.5 ||
		career.tasks[GravityGame.COMPETE_SLOT].kind !== GravityGame.TASK_COMPETE ||
		career.tasks[GravityGame.COMPETE_SLOT].deadline !== 10000, 'offer cleared');
	let seen = 0;
	for (let seed = 1; seed <= 12; seed++) {
		const v = makeWorld(seed);
		startCareer(v, seed);
		for (let k = 0; k < 6; k++) {
			GravityGame.refreshBoard(v.career, v.trade, k * 1000);
			const c = v.career.tasks[GravityGame.COMPETE_SLOT];
			if (c.kind !== GravityGame.TASK_COMPETE) continue;
			seen += 1;
			assert.ok(c.minLength >= CAREER.competeMinPx && c.reward >= CAREER.competeBase);
			assert.ok(c.minLength % 50 === 0);
		}
	}
	assert.ok(seen >= 6, 'competitions appear sometimes: ' + seen);
});

check('career ship refit: reversible to any owned tier, mass feeds the HQ cap, Δv from tank × engine', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	const ship = career.ship;
	assert.ok(career.owned['HOLD-0'] && career.owned['FT-0'], 'starter fit owned from the start');
	assert.strictEqual(OrbitTech.shipMass(ship, 0), dry());
	/* refitMass substitutes one slot and leaves cargo alone */
	assert.strictEqual(OrbitTech.refitMass(ship, 'hold', HOLD[2], 0), dry() + HOLD[2].emptyMass);
	assert.strictEqual(OrbitTech.refitMass(ship, 'hold', HOLD[2], 6), dry() + HOLD[2].emptyMass + 6);
	assert.strictEqual(OrbitTech.refitMass(ship, null, null, 2), dry() + 2);
	/* buying up costs once; fitting back to the owned tier is free and restores the mass */
	const purse = career.ledger.purse;
	assert.ok(GravityGame.installPart(career, 'hold', HOLD[2]));
	assert.strictEqual(career.ledger.purse, purse - HOLD[2].buildCost);
	assert.strictEqual(career.ship.mass, OrbitTech.refitMass(ship, 'hold', HOLD[2], 0));
	const heavyCap = OrbitTech.speedLimit(BAT[0].capacity, career.ship.mass, EMC[0]);
	const dryMass = OrbitTech.shipMass({ hold: HOLD[0], engine: null, tank: OrbitTech.TANKS[0] }, 0);
	assert.ok(OrbitTech.speedLimit(BAT[0].capacity, dryMass, EMC[0]) > heavyCap, 'a hold costs rail speed');
	assert.ok(GravityGame.installPart(career, 'hold', HOLD[0]));
	assert.strictEqual(career.ledger.purse, purse - HOLD[2].buildCost, 'going back is free');
	assert.strictEqual(career.ship.mass, dryMass);
	assert.ok(GravityGame.installPart(career, 'hold', HOLD[2]), 'owned part fits again without paying');
	assert.strictEqual(career.ledger.purse, purse - HOLD[2].buildCost);
	career.ship.cargoTons = 12;
	career.ship.mass = OrbitTech.shipMass(career.ship, 12);
	assert.ok(!GravityGame.installPart(career, 'hold', HOLD[1]), 'cargo keeps the hold at least as big');
	career.ship.cargoTons = 0;
	career.ship.mass = OrbitTech.shipMass(career.ship, 0);
	/* a stripped engine is a valid fit; a null hold/tank is not */
	career.ledger.purse = 20;
	assert.ok(GravityGame.installPart(career, 'engine', OrbitTech.ENGINES[0]));
	assert.ok(GravityGame.installPart(career, 'engine', null));
	assert.strictEqual(career.ship.engine, null);
	assert.ok(!GravityGame.installPart(career, 'hold', null));
	assert.ok(!GravityGame.installPart(career, 'tank', null));
	/* Δv: tank fuel × engine Isp at the fitted mass, zero without either half */
	assert.strictEqual(OrbitTech.shipDeltaV(ship, 0), 0);
	ship.engine = OrbitTech.ENGINES[1];
	assert.strictEqual(OrbitTech.shipDeltaV(ship, 0), 0, 'no fuel, no Δv');
	const tankDv = OrbitTech.refitDeltaV(ship, 'tank', OrbitTech.TANKS[2], 0);
	assert.ok(tankDv > 0);
	assert.ok(Math.abs(tankDv - OrbitTech.impulseDeltaV(OrbitTech.TANKS[2].fuelCap,
		OrbitTech.ENGINES[1], OrbitTech.refitMass(ship, 'tank', OrbitTech.TANKS[2], 0))) < 1e-12);
	ship.tank = OrbitTech.TANKS[2];
	assert.ok(Math.abs(OrbitTech.shipDeltaV(ship, 0) - tankDv) < 1e-12, 'whole-fit Δv equals the refit Δv');
	assert.ok(OrbitTech.refitDeltaV(ship, 'engine', OrbitTech.ENGINES[2], 0) > tankDv, 'a hotter engine adds Δv');
	assert.ok(OrbitTech.shipDeltaV(ship, 20) < OrbitTech.shipDeltaV(ship, 0), 'cargo eats Δv');
	/* the endgame cheat owns every part, so its heavy fit can also go back down */
	const e = makeWorld(42);
	startCareer(e, 42, GravityGame.CHEAT_ENDGAME);
	for (let k = 0; k < OrbitTech.PART_KINDS.length; k++) {
		const table = OrbitTech.TABLES[OrbitTech.PART_KINDS[k]];
		for (let i = 0; i < table.length; i++) assert.ok(e.career.owned[table[i].id], table[i].id + ' not owned');
	}
	assert.ok(GravityGame.installPart(e.career, 'hold', HOLD[1]));
	assert.strictEqual(e.career.ship.hold, HOLD[1]);
});

check('career bulk upgrade: total before, every built pad after, unbuilt untouched', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, ledger } = w;
	const other = (career.hq + 5) % PLANETS;
	ledger.purse = 20;
	GravityGame.buildGear(career, other, 'catapult', EMC[0]);
	const cost = GravityGame.bulkUpgradeCost(career, 'battery', BAT[2]);
	assert.strictEqual(cost, 2 * BAT[2].buildCost);
	ledger.purse = cost - 0.5;
	assert.ok(!GravityGame.bulkUpgrade(career, 'battery', BAT[2]), 'cannot afford yet');
	ledger.purse = cost;
	assert.ok(GravityGame.bulkUpgrade(career, 'battery', BAT[2]));
	assert.ok(Math.abs(ledger.purse) < 1e-9);
	assert.ok(career.pads[career.hq].battery === BAT[2] && career.pads[other].battery === BAT[2]);
	assert.ok(career.pads[career.hq].chargeKwh === BAT[2].capacity);
	assert.strictEqual(career.pads[(other + 1) % PLANETS].battery, null);
	assert.strictEqual(GravityGame.bulkUpgradeCost(career, 'battery', BAT[2]), 0);
});

check('career cheats: communism prices everything 0; endgame fits all and never completes', () => {
	const w = makeWorld(42);
	startCareer(w, 42, GravityGame.CHEAT_COMMUNISM);
	const { career, sim, ledger } = w;
	const purse = ledger.purse;
	assert.ok(GravityGame.buildGear(career, (career.hq + 1) % PLANETS, 'catapult', EMC[4]));
	assert.ok(GravityGame.installPart(career, 'hold', HOLD[2]));
	assert.strictEqual(GravityGame.bulkUpgradeCost(career, 'catapult', EMC[4]), 0);
	assert.strictEqual(ledger.purse, purse);
	for (let p = 0; p < PLANETS; p++) GravityGame.buildGear(career, p, 'catapult', EMC[0]);
	assert.ok(career.padCount === PLANETS && career.ended === GravityGame.CAREER_OPEN, 'cheat runs never complete');
	const e = makeWorld(42);
	startCareer(e, 42, GravityGame.CHEAT_ENDGAME);
	assert.strictEqual(e.ledger.purse, CAREER.endgamePurse);
	assert.ok(e.career.padCount === PLANETS && e.career.ship.hold === HOLD[2]);
	assert.ok(e.career.pads[0].catapult === EMC[4] && e.career.pads[0].chargeKwh === BAT[4].capacity);
	assert.ok(e.sim.canFire(e.career.hq, 200), 'endgame HQ lifts the fitted ship fast');
	e.career.ship.cargoTons = HOLD[2].capacity;
	e.career.ship.mass = OrbitTech.shipMass(e.career.ship, HOLD[2].capacity);
	assert.ok(e.sim.speedLimit(e.career.hq) > 100, 'the heaviest delivery still launches in the landing band');
	/* even when forceScale pushes the rail past 320 px/s, sim.speedLimit caps at SPEED_MAX */
	e.career.ship.cargoTons = 0;
	e.career.ship.mass = OrbitTech.shipMass(e.career.ship, 0);
	e.sim.setScales(1, 3);
	assert.ok(OrbitTech.speedLimit(BAT[4].capacity, e.career.ship.mass, EMC[4], 3) > GravitySim.SPEED_MAX);
	assert.strictEqual(e.sim.speedLimit(e.career.hq), GravitySim.SPEED_MAX);
	assert.ok(e.sim.canFire(e.career.hq, GravitySim.SPEED_MAX));
	assert.ok(!e.sim.canFire(e.career.hq, GravitySim.SPEED_MAX + 1));
	assert.ok(sim.canLaunchFrom(career.hq));
});

check('career completes when every planet has a catapult (honest run)', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, ledger } = w;
	ledger.purse = 1000;
	for (let p = 0; p < PLANETS; p++) GravityGame.buildGear(career, p, 'catapult', EMC[0]);
	assert.strictEqual(career.ended, GravityGame.CAREER_COMPLETE);
	assert.ok(ledger.purse > 0);
});

check('impulse fuel & Δv: inverse, multi-burn telescoping, and thrust vs tank burn cap', () => {
	const imp1 = OrbitTech.ENGINES[0];
	const imp3 = OrbitTech.ENGINES[2];
	const ft1 = OrbitTech.TANKS[1];
	const ft3 = OrbitTech.TANKS[3];
	const ship13 = { hold: HOLD[0], engine: imp1, tank: ft3 };
	const mass13 = OrbitTech.shipMass(ship13, 0);
	const total13 = OrbitTech.shipDeltaV(ship13, 0);
	const cap13 = OrbitTech.burnLimit(ft3.fuelCap, imp1, mass13);
	assert.ok(cap13 < total13 - 10, 'IMP-1 on FT-3 is thrust-capped per single burn');
	assert.ok(Math.abs(cap13 - OrbitTech.burnMaxDeltaV(imp1, mass13, ft3.fuelCap)) < 1e-12);

	const ship31 = { hold: HOLD[0], engine: imp3, tank: ft1 };
	const mass31 = OrbitTech.shipMass(ship31, 0);
	assert.ok(Math.abs(OrbitTech.burnLimit(ft1.fuelCap, imp3, mass31) -
		OrbitTech.shipDeltaV(ship31, 0)) < 1e-12, 'IMP-3 on FT-1 is fuel-capped');

	/* three sequential burns draining FT-3 telescope to the exact full-tank Δv */
	let fuel = ft3.fuelCap;
	const dv1 = 7.5;
	const used1 = OrbitTech.impulseFuel(dv1, imp1, mass13, fuel);
	assert.ok(Math.abs(OrbitTech.impulseDeltaV(used1, imp1, mass13, fuel) - dv1) < 1e-12);
	fuel -= used1;
	const dv2 = 9.2;
	const used2 = OrbitTech.impulseFuel(dv2, imp1, mass13, fuel);
	assert.ok(Math.abs(OrbitTech.impulseDeltaV(used2, imp1, mass13, fuel) - dv2) < 1e-12);
	fuel -= used2;
	const dv3 = OrbitTech.impulseDeltaV(fuel, imp1, mass13, fuel);
	assert.ok(Math.abs((dv1 + dv2 + dv3) - total13) < 1e-11, 'sequential burns telescope to full-tank Δv');
});

check('career in-flight burn: predictBurn & predictBurnFast match stepOne, pad refuels', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career, sim, trade } = w;
	career.ledger.purse = 50;
	assert.ok(GravityGame.installPart(career, 'engine', OrbitTech.ENGINES[1]));
	assert.ok(GravityGame.installPart(career, 'tank', OrbitTech.TANKS[2]));
	assert.strictEqual(career.ship.fuelKg, OrbitTech.TANKS[2].fuelCap);

	sim.stepLimit = GravityGame.CAP_STEPS;
	sim.limitReason = GravitySim.END_TIME;
	const origin = career.hq;
	const launchSpeed = Math.min(72, sim.speedLimit(origin));
	sim.launch(origin, 0.7, launchSpeed);
	GravityGame.careerBeginFlight(career, sim);
	for (let i = 0; i < 45 && sim.status === GravitySim.STATUS_FLYING; i++) sim.stepOne();
	assert.strictEqual(sim.status, GravitySim.STATUS_FLYING);

	const burnStep = sim.liveSteps;
	const burnAngle = GravityGame.angleOf(GravityGame.angleUnits(-1.1));
	const burnDv = GravityGame.speedOf(GravityGame.speedUnits(Math.min(8.5, sim.burnLimit() * 0.7)));
	sim.predictBurn(burnAngle, burnDv);
	const predReason = sim.predReason;
	const predBody = sim.predBody;
	const predSteps = sim.predSteps;
	const endPredX = sim.predX[sim.predCount - 1];
	const endPredY = sim.predY[sim.predCount - 1];

	const extProbe = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	extProbe.setPlanets(PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	extProbe.setField(PLANETS, trade.planetR, sim.strength, sim.fillField, true);
	extProbe.predictBurnFast(sim, burnAngle, burnDv);
	assert.strictEqual(extProbe.predReason, predReason);
	assert.strictEqual(extProbe.predBody, predBody);
	assert.strictEqual(extProbe.predSteps, predSteps);

	assert.ok(!GravityGame.careerBurn(career, sim, burnAngle, sim.burnLimit() + 0.5), 'over-cap burn refused');
	assert.ok(GravityGame.careerBurn(career, sim, burnAngle, burnDv));
	assert.ok(career.ship.fuelKg < OrbitTech.TANKS[2].fuelCap && career.burns === 1 && career.lastFuel > 0);
	const fuelMid = career.ship.fuelKg;

	while (sim.status === GravitySim.STATUS_FLYING) sim.stepOne();
	assert.strictEqual(sim.endReason, predReason, 'burn endReason parity');
	assert.strictEqual(sim.endBody, predBody, 'burn endBody parity');
	assert.strictEqual(sim.liveSteps - burnStep, predSteps, 'burn step count parity');
	assert.ok(Math.hypot(sim.cargo.x - endPredX, sim.cargo.y - endPredY) < 1e-3, 'burn endpoint parity (Float32 predX/Y)');

	GravityGame.careerEndFlight(career, sim, trade, sim.liveSteps);
	if (career.stranded) {
		assert.strictEqual(career.ship.fuelKg, fuelMid, 'stranded ship keeps partial tank until pad/evac');
		GravityGame.evacuate(career, sim);
	}
	assert.strictEqual(career.ship.fuelKg, OrbitTech.TANKS[2].fuelCap, 'built pad refuels tank');
});

check('shot burn codec: round-trip multi-burn shots and reject invalid burn tags', () => {
	const plain = GravityGame.createShot(GravityGame.SRC_PLANETS, 3, 12345, 92160, GravityGame.NO_ABORT);
	assert.strictEqual(GravityGame.encodeShot(plain), 'p3.' + (12345).toString(36) + '.' + (92160).toString(36));

	const burned = GravityGame.createShot(GravityGame.SRC_PLANETS, 5, 40000, 81920, 600, [
		GravityGame.createBurn(40, 100000, 8192),
		GravityGame.createBurn(190, 250000, 4096)
	]);
	const enc = GravityGame.encodeShot(burned);
	assert.ok(enc.includes('-b'), 'encoded shot carries burn suffix: ' + enc);
	const dec = GravityGame.decodeShot(enc, GravityGame.CAP_STEPS);
	assert.ok(dec && dec.burns.length === 2);
	assert.deepStrictEqual(dec.burns, burned.burns);

	const link = GravityGame.encodeLink({
		seed: 7, rate: 2, rule: GravityGame.RULE_TOUR, bot: GravityGame.BOT_OFF,
		player: GravityGame.PLAYER_USER, shots: [burned], visited: 4, steps: 600
	});
	const parsed = GravityGame.decodeLink(link);
	assert.ok(parsed && parsed.shots.length === 1 && parsed.shots[0].burns.length === 2);

	/* out-of-order steps, step >= abort, zero dv, and burns on route planner are rejected */
	assert.strictEqual(GravityGame.decodeShot('p5.100.2bc0-b20.10.100-b10.10.100', GravityGame.CAP_STEPS), null);
	assert.strictEqual(GravityGame.decodeShot('p5.100.2bc0.10-b10.10.100', GravityGame.CAP_STEPS), null);
	assert.strictEqual(GravityGame.decodeShot('p5.100.2bc0-b5.10.0', GravityGame.CAP_STEPS), null);
	assert.strictEqual(GravityGame.decodeLink('game=1&seed=7&rate=1&rule=route&shots=p5.100.2bc0-b5.10.100'), null);
});

check('career science: tech tables seed the hull; research grows it for the preview fee', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	assert.deepStrictEqual(OrbitScience.statsHull(career.science, 'engine'), { n: 3, dim: 2 });
	/* only EMC-1 and EMC-2 ship with starter tech; EMC-3/4/5 require research */
	assert.deepStrictEqual(OrbitScience.statsHull(career.science, 'catapult'), { n: 2, dim: 2 });
	/* known tech vectors are discovered points */
	const imp2 = OrbitTech.ENGINES[1];
	const known = OrbitScience.previewHull(career.science, 'engine', [imp2.thrust, imp2.mass]);
	assert.ok(known.inside && known.dist === 0);
	/* an outside vector is priced through the career purse model */
	const target = [60, 0.5];
	const prev = OrbitScience.previewHull(career.science, 'engine', target);
	assert.ok(!prev.inside && prev.dist > 0);
	assert.strictEqual(GravityGame.researchCost(career, 'engine', target), prev.cost);
	career.ledger.purse = 2000;
	const purse = career.ledger.purse;
	const label = GravityGame.researchLabel(career, 'engine');
	assert.ok(GravityGame.researchPoint(career, 'engine', target, label));
	assert.ok(Math.abs(career.ledger.purse - (purse - prev.cost)) < 1e-9);
	assert.strictEqual(career.research, 1);
	assert.strictEqual(career.lastResearch, prev.cost);
	assert.strictEqual(OrbitScience.statsHull(career.science, 'engine').n, 4);
	/* the same vector is now a hull vertex: only the mass-adjusted base remains */
	const again = OrbitScience.previewHull(career.science, 'engine', target);
	assert.ok(again.inside && again.cost === OrbitScience.BASE_PRICE.engine * OrbitScience.meritFactor('engine', target));
	const purse2 = career.ledger.purse;
	assert.ok(GravityGame.researchPoint(career, 'engine', target, 'R5'));
	assert.ok(Math.abs(career.ledger.purse - (purse2 - again.cost)) < 1e-9);
	/* restarting the career rebuilds the hull from the tech tables */
	startCareer(w, 42);
	assert.strictEqual(OrbitScience.statsHull(career.science, 'engine').n, 3);
	assert.strictEqual(career.research, 0);
});

check('career science: the purse pays the frontier surcharge and research expands the range', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	const target = [26, 0.5];
	const p = OrbitScience.previewHull(career.science, 'engine', target);
	const hullOnly = OrbitScience.BASE_PRICE.engine + OrbitScience.K_DIST * p.dist;
	assert.ok(p.frontier > 0 && p.cost > hullOnly + 1, 'frontier fee ' + p.cost + ' vs hull-only ' + hullOnly);
	assert.strictEqual(GravityGame.researchCost(career, 'engine', target), p.cost);
	career.ledger.purse = p.cost;
	assert.ok(GravityGame.researchPoint(career, 'engine', target, 'R-light'));
	assert.ok(Math.abs(career.ledger.purse) < 1e-9, 'exact fee spent: ' + career.ledger.purse);
	assert.strictEqual(OrbitScience.rangeHull(career.science, 'engine').min[1], 0.5);
	assert.strictEqual(OrbitScience.previewHull(career.science, 'engine', target).frontier, 0);
});

check('career science: 1.5x cheaper fees and research works away from HQ and in flight', () => {
	assert.strictEqual(OrbitScience.K_DIST, 4);
	assert.strictEqual(OrbitScience.BASE_PRICE.catapult, 2);
	assert.strictEqual(OrbitScience.BASE_PRICE.panel, 1);
	assert.ok(Math.abs(OrbitScience.BASE_PRICE.engine - 2 / 1.5) < 1e-12);
	assert.ok(Math.abs(OrbitScience.BASE_PRICE.battery - 1 / 1.5) < 1e-12);
	assert.ok(Math.abs(OrbitScience.BASE_PRICE.hold - 1 / 1.5) < 1e-12);
	assert.ok(Math.abs(OrbitScience.BASE_PRICE.tank - 1 / 1.5) < 1e-12);
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	const target = [55, 0.6];
	const fee = GravityGame.researchCost(career, 'engine', target);
	career.at = (career.hq + 1) % PLANETS;
	career.ledger.purse = fee - 1;
	assert.strictEqual(GravityGame.researchPoint(career, 'engine', target, 'R4'), false);
	assert.strictEqual(OrbitScience.statsHull(career.science, 'engine').n, 3, 'unaffordable leaves the hull untouched');
	career.ledger.purse = fee;
	career.ended = GravityGame.CAREER_BROKE;
	assert.strictEqual(GravityGame.researchPoint(career, 'engine', target, 'R4'), false);
	career.ended = GravityGame.CAREER_OPEN;
	assert.strictEqual(GravityGame.researchPoint(career, 'panel', [2, 0.5], 'X'), false, 'no panel research space');
	assert.ok(GravityGame.researchPoint(career, 'engine', target, 'R4'), 'research succeeds away from HQ');
	assert.strictEqual(OrbitScience.statsHull(career.science, 'engine').n, 4);
	/* in-flight research (at = -1) also succeeds whenever purse covers the fee */
	const inFlightTarget = [40, 1.1];
	const flightFee = GravityGame.researchCost(career, 'engine', inFlightTarget);
	career.at = -1;
	career.ledger.purse = flightFee;
	assert.ok(GravityGame.researchPoint(career, 'engine', inFlightTarget, 'R5'), 'research succeeds in flight');
	assert.strictEqual(OrbitScience.statsHull(career.science, 'engine').n, 5);
	/* communism: the same invention is free but still expands the hull */
	const c = makeWorld(7);
	startCareer(c, 7, GravityGame.CHEAT_COMMUNISM);
	const purse = c.career.ledger.purse;
	assert.strictEqual(GravityGame.researchCost(c.career, 'catapult', [220, 0.95]), 0);
	assert.ok(GravityGame.researchPoint(c.career, 'catapult', [220, 0.95], 'R6'));
	assert.strictEqual(c.career.ledger.purse, purse);
	/* 2 starter tiers + the communist-invented point */
	assert.strictEqual(OrbitScience.statsHull(c.career.science, 'catapult').n, 3);
});

/* --- 0.4.11: exact hull distance and research prototypes --------------- */

/* brute-force 2-D nearest distance: a triangle of three points contains the
 * target, else the nearest hull edge is the nearest pair segment */
function bruteHullDist(pts, t) {
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const n = pts.length;
	for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
		if (Math.abs(cross(pts[i], pts[j], pts[k])) <= 1e-12) continue;
		const d = [cross(pts[i], pts[j], t), cross(pts[j], pts[k], t), cross(pts[k], pts[i], t)];
		if ((d[0] >= 0 && d[1] >= 0 && d[2] >= 0) || (d[0] <= 0 && d[1] <= 0 && d[2] <= 0)) return 0;
	}
	let best = Infinity;
	for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
		const a = pts[i], b = pts[j];
		const L = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
		const u = L === 0 ? 0 : Math.max(0, Math.min(1, ((t[0] - a[0]) * (b[0] - a[0]) + (t[1] - a[1]) * (b[1] - a[1])) / L));
		best = Math.min(best, Math.hypot(t[0] - a[0] - u * (b[0] - a[0]), t[1] - a[1] - u * (b[1] - a[1])));
	}
	return n === 1 ? Math.hypot(t[0] - pts[0][0], t[1] - pts[0][1]) : best;
}

/* independent 2-D directional hull-distance oracle: checks triangle interior,
 * then minimizes the asymmetric step norm along every pair segment */
function bruteDirHullDist(pts, t, dirs) {
	if (bruteHullDist(pts, t) === 0) return 0;
	const cNeg = [Math.min(1, dirs[0].below), Math.min(1, dirs[1].below)];
	const cPos = [Math.min(1, dirs[0].above), Math.min(1, dirs[1].above)];
	const stepNorm = (x, y) => {
		const dx = t[0] - x;
		const dy = t[1] - y;
		return Math.hypot(dx >= 0 ? cPos[0] * dx : -cNeg[0] * dx,
			dy >= 0 ? cPos[1] * dy : -cNeg[1] * dy);
	};
	if (pts.length === 1) return stepNorm(pts[0][0], pts[0][1]);
	let best = Infinity;
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		const a = pts[i], b = pts[j];
		let lo = 0, hi = 1;
		for (let it = 0; it < 80; it++) {
			const m1 = lo + (hi - lo) / 3;
			const m2 = hi - (hi - lo) / 3;
			const v1 = stepNorm(a[0] + m1 * (b[0] - a[0]), a[1] + m1 * (b[1] - a[1]));
			const v2 = stepNorm(a[0] + m2 * (b[0] - a[0]), a[1] + m2 * (b[1] - a[1]));
			if (v1 < v2) hi = m2;
			else lo = m1;
		}
		const u = 0.5 * (lo + hi);
		best = Math.min(best, stepNorm(a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])));
	}
	return best;
}

function techHull() {
	const h = OrbitScience.createHull();
	OrbitTech.ENGINES.forEach(e => OrbitScience.acceptHull(h, 'engine', [e.thrust, e.mass], e.id));
	OrbitTech.CATAPULTS.forEach(c => OrbitScience.acceptHull(h, 'catapult', [c.maxForce, c.efficiency], c.id));
	OrbitTech.TANKS.filter(t => t.tier > 0).forEach(t => OrbitScience.acceptHull(h, 'tank', [t.fuelCap, t.emptyMass], t.id));
	OrbitTech.BATTERIES.forEach(b => OrbitScience.acceptHull(h, 'battery', [b.capacity, b.leak], b.id));
	return h;
}

check('hull distance: every recombination of the near-collinear tech points is inside', () => {
	const h = techHull();
	for (const family of ['engine', 'catapult']) {
		const pts = OrbitScience.pointsHull(h, family).map(p => p.params);
		const probes = [];
		for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
			probes.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]);
			for (let k = j + 1; k < pts.length; k++) {
				probes.push([0, 1].map(d => (pts[i][d] + pts[j][d] + pts[k][d]) / 3));
			}
		}
		for (const q of probes) {
			const r = OrbitScience.previewHull(h, family, q);
			assert.ok(r.inside && r.dist === 0 && r.cost === OrbitScience.BASE_PRICE[family] * OrbitScience.meritFactor(family, q),
				family + ' ' + JSON.stringify(q) + ' priced outside: ' + JSON.stringify(r));
		}
	}
});

check('hull distance: default slider fees match the exact normalized distances', () => {
	const h = techHull();
	/* independent oracle: brute-force directional distance in the panel's RU metric */
	const exactDist = (family, target) => {
		const scale = OrbitScience.METRIC_SCALE[family];
		const dirs = OrbitScience.FRONTIER[family];
		const norm = p => p.map((v, d) => v * scale[d]);
		return bruteDirHullDist(OrbitScience.pointsHull(h, family).map(p => norm(p.params)), norm(target), dirs);
	};
	const rate = family => OrbitScience.K_DIST * (OrbitScience.TIER_SCALE[family] || 1);
	const engine = OrbitScience.previewHull(h, 'engine', [26, 1.8]);
	const ed = exactDist('engine', [26, 1.8]);
	assert.ok(!engine.inside && Math.abs(engine.dist - ed) < 1e-9, 'engine dist ' + engine.dist + ' vs ' + ed);
	assert.strictEqual(engine.frontier, 0, 'the engine default is inside the researched range');
	assert.ok(Math.abs(engine.cost - (OrbitScience.BASE_PRICE.engine + rate('engine') * ed) * OrbitScience.meritFactor('engine', [26, 1.8])) < 1e-9,
		'engine fee ' + engine.cost);
	assert.ok(OrbitScience.previewHull(h, 'engine', [26, 1.75]).inside, '(26, 1.75) lies on the IMP-1/IMP-3 chord');
	assert.ok(OrbitScience.previewHull(h, 'catapult', [100, 0.74]).inside, '(100, 0.74) is inside the EMC hull');
	const cat = OrbitScience.previewHull(h, 'catapult', [100, 0.76]);
	const cd = exactDist('catapult', [100, 0.76]);
	assert.ok(!cat.inside && Math.abs(cat.dist - cd) < 1e-9, 'catapult dist ' + cat.dist + ' vs ' + cd);
	assert.strictEqual(cat.frontier, 0, 'the catapult default is inside the researched range');
	assert.ok(Math.abs(cat.cost - (OrbitScience.BASE_PRICE.catapult + rate('catapult') * cd) *
		OrbitScience.meritFactor('catapult', [100, 0.76])) < 1e-9,
		'catapult fee ' + cat.cost);
});

/* --- §10 directional frontier: difficulty below/above the researched range --- */

check('frontier: researched range is the hull min/max per axis', () => {
	const h = techHull();
	assert.deepStrictEqual(OrbitScience.rangeHull(h, 'engine').min, [12, 1]);
	assert.deepStrictEqual(OrbitScience.rangeHull(h, 'engine').max, [40, 2.5]);
	assert.deepStrictEqual(OrbitScience.rangeHull(h, 'catapult').min, [15, 0.62]);
	assert.deepStrictEqual(OrbitScience.rangeHull(h, 'catapult').max, [180, 0.88]);
	assert.strictEqual(OrbitScience.rangeHull(h, 'ghost'), null);
	assert.strictEqual(OrbitScience.frontierWork(h, 'ghost', [1, 1]), 0);
});

check('frontier: a lighter engine is dearer than a heavier one at equal overshoot', () => {
	const h = techHull();
	const light = OrbitScience.previewHull(h, 'engine', [26, 0.5]);
	const heavy = OrbitScience.previewHull(h, 'engine', [26, 3.0]);
	/* min mass 1.0 / max 2.5: both step 0.5 t = 2.5 RU (1 RU = 0.2 t) out of the range */
	assert.ok(Math.abs(light.frontier - 7.5) < 1e-9, 'light frontier ' + light.frontier);
	assert.ok(Math.abs(heavy.frontier) < 1e-9, 'heavy frontier ' + heavy.frontier);
	assert.ok(light.cost > heavy.cost * 5, 'light ' + light.cost + ' vs heavy ' + heavy.cost);
	const rate = OrbitScience.K_DIST * OrbitScience.TIER_SCALE.engine;
	for (const p of [light, heavy]) {
		assert.ok(Math.abs(p.cost - (OrbitScience.BASE_PRICE.engine + rate * (p.dist + p.frontier)) * p.merit) < 1e-9);
	}
});

check('frontier: higher efficiency is dearer than lower at equal overshoot', () => {
	const h = techHull();
	const low = OrbitScience.previewHull(h, 'catapult', [100, 0.57]);
	const high = OrbitScience.previewHull(h, 'catapult', [100, 0.93]);
	/* 0.05 efficiency = 0.5 RU; below ×0, above ×2.50 */
	assert.ok(Math.abs(low.frontier) < 1e-9, 'low frontier ' + low.frontier);
	assert.ok(Math.abs(high.frontier - 1.25) < 1e-9, 'high frontier ' + high.frontier);
	assert.ok(high.cost > low.cost * 3, 'high ' + high.cost + ' vs low ' + low.cost);
});

check('directional plot invariant: easy side stays cheaper than hard side across every family', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	/* inside the engine researched range: weak & heavy is cheap, strong & light is hard */
	const weakHeavy = GravityGame.researchCost(career, 'engine', [12, 2.5]);
	const strongLight = GravityGame.researchCost(career, 'engine', [40, 1.0]);
	assert.ok(weakHeavy < 3.0 && strongLight > weakHeavy * 3,
		'inside-range asymmetry: ' + weakHeavy + ' vs ' + strongLight);
	/* across every thrust column (including weak 4 kN), 3.6 t heavy is cheaper than 0.3 t light */
	for (const thrust of [4, 12, 26, 40, 60]) {
		const heavy = GravityGame.researchCost(career, 'engine', [thrust, 3.6]);
		const light = GravityGame.researchCost(career, 'engine', [thrust, 0.3]);
		assert.ok(light > heavy * 1.5, 'engine thrust ' + thrust + ': light ' + light + ' vs heavy ' + heavy);
	}
	/* across every catapult force column (including 220 kN), 96% eff is dearer than 52% eff */
	for (const force of [10, 90, 180, 220]) {
		const sloppy = GravityGame.researchCost(career, 'catapult', [force, 0.52]);
		const superEff = GravityGame.researchCost(career, 'catapult', [force, 0.96]);
		assert.ok(superEff > sloppy * 1.4, 'catapult force ' + force + ': high ' + superEff + ' vs low ' + sloppy);
	}
	/* across every tank fuel column, 0.2 t composite is dearer than 1.85 t steel */
	for (const fuel of [20, 90, 160, 220]) {
		const heavy = GravityGame.researchCost(career, 'tank', [fuel, 1.85]);
		const light = GravityGame.researchCost(career, 'tank', [fuel, 0.20]);
		assert.ok(light > heavy * 2, 'tank fuel ' + fuel + ': light ' + light + ' vs heavy ' + heavy);
	}
	/* across every battery capacity column, 0.0001 tight seal is dearer than 0.0012 leaky */
	for (const cap of [1, 6, 16, 22]) {
		const leaky = GravityGame.researchCost(career, 'battery', [cap, 0.0012]);
		const tight = GravityGame.researchCost(career, 'battery', [cap, 0.0001]);
		assert.ok(tight > leaky * 1.3, 'battery cap ' + cap + ': tight ' + tight + ' vs leaky ' + leaky);
	}
});

check('science: worsening any single attribute never increases the fee', () => {
	const h = techHull();
	const cases = [
		['engine', [4, 12, 26, 40, 60], [0.3, 1, 1.8, 2.5, 3.6]],
		['catapult', [10, 90, 150, 180, 220], [0.5, 0.62, 0.75, 0.88, 0.98]],
		['tank', [15, 40, 90, 160, 220], [0.2, 0.5, 0.9, 1.4, 2]],
		['battery', [1, 3, 10, 16, 22], [0.0001, 0.0003, 0.0006, 0.001, 0.0012]]
	];
	for (const [family, xs, ys] of cases) {
		for (const y of ys) {
			for (let i = 1; i < xs.length; i++) {
				const low = OrbitScience.previewHull(h, family, [xs[i - 1], y]).cost;
				const high = OrbitScience.previewHull(h, family, [xs[i], y]).cost;
				assert.ok(low <= high + 1e-7, family + ' primary monotonic ' + low + ' > ' + high);
			}
		}
		for (const x of xs) {
			for (let i = 1; i < ys.length; i++) {
				const low = OrbitScience.previewHull(h, family, [x, ys[i - 1]]).cost;
				const high = OrbitScience.previewHull(h, family, [x, ys[i]]).cost;
				assert.ok(family === 'catapult' ? low <= high + 1e-7 : high <= low + 1e-7,
					family + ' secondary monotonic ' + low + ' vs ' + high);
			}
		}
	}
});

check('science: dominated designs cost the spec-adjusted base even outside the hull', () => {
	const h = OrbitScience.createHull();
	for (const [family, known, worse] of [
		['catapult', [100, 0.8], [100, 0.5]],
		['engine', [30, 1], [20, 3]],
		['tank', [100, 1], [50, 2]],
		['battery', [10, 0.0005], [5, 0.0012]]
	]) {
		OrbitScience.acceptHull(h, family, known);
		const result = OrbitScience.previewHull(h, family, worse);
		assert.ok(!result.inside && Math.abs(result.cost - OrbitScience.BASE_PRICE[family] * OrbitScience.meritFactor(family, worse)) < 1e-8, family);
	}
});

check('science: doubling mass reduces the fee by 1.5 when difficulty is unchanged', () => {
	for (const [family, primary, mass] of [['engine', 12, 1], ['tank', 40, 0.5]]) {
		const h = techHull();
		const first = OrbitScience.previewHull(h, family, [primary, mass]);
		const double = OrbitScience.previewHull(h, family, [primary, mass * 2]);
		const quadruple = OrbitScience.previewHull(h, family, [primary, mass * 4]);
		assert.ok(Math.abs(first.cost / double.cost - 1.5) < 1e-9, family);
		assert.ok(Math.abs(double.cost / quadruple.cost - 1.5) < 1e-9, family);
		OrbitScience.acceptHull(h, family, [primary, mass * 2], 'heavy');
		assert.ok(Math.abs(OrbitScience.previewHull(h, family, [primary, mass * 4]).cost - quadruple.cost) < 1e-9);
		assert.strictEqual(OrbitScience.previewHull(h, family, [primary, 0]).cost, Infinity);
	}
});

/* --- §10b spec merit: the absolute half of the fee, one curve per axis --- */

/* par of a merit axis read back in the axis' own units (a mirrored row stores
 * its loss, so the catapult's par 0.20 reads back as 80 % efficiency) */
function meritPar(family) {
	const spec = GravityGame.SCIENCE_FAMILIES.filter(s => s.kind === family)[0];
	const rungs = spec.table.filter(t => t.tier > 0);
	return spec.params(rungs[(rungs.length - 1) >> 1]);
}

function storedPar(family, axis) {
	const a = OrbitScience.MERIT[family][axis];
	return a.mirror === undefined ? a.par : a.mirror - a.par;
}

check('merit: par is the middle rung of the tech table and costs exactly the base fee', () => {
	const h = techHull();
	for (const family of GravityGame.SCIENCE_KINDS) {
		const par = meritPar(family);
		assert.strictEqual(OrbitScience.MERIT[family].length, par.length, family + ' merit row');
		for (let d = 0; d < par.length; d++) {
			assert.ok(Math.abs(storedPar(family, d) - par[d]) < 1e-12,
				family + ' axis ' + d + ' par ' + storedPar(family, d) + ' vs ' + par[d]);
		}
		assert.ok(Math.abs(OrbitScience.meritFactor(family, par) - 1) < 1e-12, family + ' par merit');
		const p = OrbitScience.previewHull(h, family, par);
		assert.ok(p.inside && p.dist === 0 && p.frontier === 0, family + ' par is a known vertex');
		assert.ok(Math.abs(p.cost - OrbitScience.BASE_PRICE[family]) < 1e-12, family + ' par fee ' + p.cost);
	}
});

/* every pair steps one axis with the hull distance and frontier work flat, so
 * the fee ratio is the merit step alone: x1.25 per doubling of a capability,
 * ÷1.5 per doubling of a waste (mass, leak, efficiency losses) */
check('merit: 2x capability x1.25, 2x waste ÷1.5, and nothing else moves the fee', () => {
	const h = techHull();
	const pairs = [
		['engine', [12, 2.5], [24, 2.5], 1.25],
		['engine', [26, 1.8], [26, 3.6], 1 / 1.5],
		['catapult', [67.5, 0.5], [135, 0.5], 1.25],
		['catapult', [100, 0.52], [100, 0.76], 1.5],
		['tank', [40, 1.4], [80, 1.4], 1.25],
		['tank', [90, 0.9], [90, 1.8], 1 / 1.5],
		['battery', [3, 0.001], [6, 0.001], 1.25],
		['battery', [6, 0.0006], [6, 0.0012], 1 / 1.5]
	];
	for (const [family, from, to, step] of pairs) {
		const a = OrbitScience.previewHull(h, family, from);
		const b = OrbitScience.previewHull(h, family, to);
		assert.strictEqual(a.frontier, 0, family + ' frontier ' + JSON.stringify(from));
		assert.strictEqual(b.frontier, 0, family + ' frontier ' + JSON.stringify(to));
		assert.ok(a.dist < 1e-9 && b.dist < 1e-9, family + ' distance ' + a.dist + ' / ' + b.dist);
		assert.ok(Math.abs(b.cost / a.cost - step) < 1e-9,
			family + ' ' + JSON.stringify(from) + ' → ' + JSON.stringify(to) +
			' step ' + (b.cost / a.cost).toFixed(4) + ' vs ' + step.toFixed(4));
	}
});

/* the report: a battery that leaks twice as fast must be cheaper to invent,
 * not merely no dearer — same for a rail that wastes twice the energy */
check('merit: a leakier battery and a lossier rail beat the base fee', () => {
	const h = techHull();
	for (const [family, par, worse, ratio] of [
		['battery', [6, 0.0006], [6, 0.0012], 0.75],
		['catapult', [135, 0.80], [135, 0.60], 0.75]
	]) {
		const good = OrbitScience.previewHull(h, family, par);
		const sloppy = OrbitScience.previewHull(h, family, worse);
		assert.ok(Math.abs(good.cost - OrbitScience.BASE_PRICE[family]) < 1e-12, family + ' par fee');
		assert.ok(sloppy.cost < good.cost * ratio, family + ' worsened fee ' + sloppy.cost);
		assert.ok(sloppy.cost > good.cost * ratio * 0.5, family + ' fee ' + sloppy.cost);
	}
});

check('merit: the product of the axes is clamped to the lab band', () => {
	assert.strictEqual(OrbitScience.meritFactor('catapult', [10, 0.5]), OrbitScience.MERIT_MIN);
	assert.strictEqual(OrbitScience.meritFactor('engine', [60, 0.2]), OrbitScience.MERIT_MAX);
	const draft = OrbitScience.meritFactor('engine', [26, 1.8]);
	assert.ok(draft > OrbitScience.MERIT_MIN && draft < OrbitScience.MERIT_MAX, 'draft merit ' + draft);
	for (const family of GravityGame.SCIENCE_KINDS) {
		const par = meritPar(family);
		for (const scale of [0.25, 4]) {
			/* mirrored axes are scaled in merit space (their loss), not in value */
			const scaled = par.map((v, d) => {
				const a = OrbitScience.MERIT[family][d];
				return a.mirror === undefined ? v * scale : a.mirror - (a.mirror - v) * scale;
			});
			const f = OrbitScience.meritFactor(family, scaled);
			assert.ok(f >= OrbitScience.MERIT_MIN && f <= OrbitScience.MERIT_MAX, family + ' merit ' + f);
		}
	}
});

check('merit: an impossible spec cannot be researched', () => {
	assert.strictEqual(OrbitScience.meritFactor('engine', [26, 0]), Infinity);
	assert.strictEqual(OrbitScience.meritFactor('catapult', [100, 1]), Infinity, 'lossless rail');
	assert.strictEqual(OrbitScience.meritFactor('catapult', [100, 1.2]), Infinity, 'past the mirror');
	assert.strictEqual(OrbitScience.previewHull(techHull(), 'engine', [26, 0]).cost, Infinity);
	assert.strictEqual(OrbitScience.meritFactor('helper', [1, 1]), 1, 'a family with no merit rows');
});

check('directional hull distance: seeded random 2-D sets agree with asymmetric brute force', () => {
	let seed = 54321;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	let worst = 0;
	for (let trial = 0; trial < 200; trial++) {
		const n = 1 + Math.floor(rnd() * 6);
		const pts = [];
		for (let i = 0; i < n; i++) pts.push([rnd() * 10, rnd() * 10]);
		const dirs = [
			{ below: 0.05 + rnd() * 1.5, above: 0.05 + rnd() * 1.5 },
			{ below: 0.05 + rnd() * 2.0, above: 0.05 + rnd() * 2.0 }
		];
		const h = OrbitScience.createHull();
		pts.forEach((p, i) => OrbitScience.acceptHull(h, 'f', p, 'v' + i));
		for (let q = 0; q < 3; q++) {
			const t = [rnd() * 12, rnd() * 12];
			const r = OrbitScience.distToHull(h.families.f, t, [1, 1], dirs);
			const want = bruteDirHullDist(pts, t, dirs);
			const got = r.inside ? 0 : r.dist;
			worst = Math.max(worst, Math.abs(got - want));
		}
	}
	assert.ok(worst < 1e-8, 'worst directional distance error ' + worst);
});

check('frontier: inside the hull or an unconfigured family keeps the plain fee', () => {
	const h = techHull();
	const recomb = OrbitScience.previewHull(h, 'engine', [26, 1.75]);
	assert.ok(recomb.inside && recomb.frontier === 0 && recomb.cost === OrbitScience.BASE_PRICE.engine * OrbitScience.meritFactor('engine', [26, 1.75]));
	const raw = OrbitScience.createHull();
	OrbitScience.acceptHull(raw, 'f', [0, 0], 'a');
	OrbitScience.acceptHull(raw, 'f', [10, 0], 'b');
	const out = OrbitScience.previewHull(raw, 'f', [5, 4]);
	assert.strictEqual(out.frontier, 0);
	assert.ok(Math.abs(out.cost - ((OrbitScience.BASE_PRICE.f || OrbitScience.DEFAULT_BASE) + OrbitScience.K_DIST * out.dist)) < 1e-9,
		'unconfigured family fee ' + out.cost);
});

check('frontier: research expands the range so the next point pays less', () => {
	const h = techHull();
	const target = [26, 0.5];
	const before = OrbitScience.previewHull(h, 'engine', target);
	const afterPoint = [26, 0.7];
	const beforeNeighbour = OrbitScience.previewHull(h, 'engine', afterPoint);
	OrbitScience.acceptHull(h, 'engine', target, 'R-light');
	assert.deepStrictEqual(OrbitScience.rangeHull(h, 'engine').min, [12, 0.5]);
	const accepted = OrbitScience.previewHull(h, 'engine', target);
	assert.ok(accepted.inside && accepted.frontier === 0 && accepted.cost === OrbitScience.BASE_PRICE.engine * OrbitScience.meritFactor('engine', target));
	const after = OrbitScience.previewHull(h, 'engine', afterPoint);
	assert.strictEqual(after.frontier, 0, '0.7 t is inside the new range');
	assert.ok(after.cost < beforeNeighbour.cost,
		'neighbour fee ' + after.cost + ' should fall below ' + beforeNeighbour.cost);
	assert.ok(before.cost > accepted.cost);
});

check('hull distance: a thin sliver is classified exactly (regression: normal-equation solver)', () => {
	const h = OrbitScience.createHull();
	[[2.8967285169738943, 0.28974903635166077], [8.430366520038977, 0.8430513380161726],
		[2.606888116619963, 0.26076241103632486]].forEach((p, i) => OrbitScience.acceptHull(h, 'f', p, 'v' + i));
	assert.ok(OrbitScience.previewHull(h, 'f', [3.3542313052324757, 0.3354903004017051]).inside);
});

check('hull distance: seeded random 2-D sets agree with the brute force', () => {
	let seed = 12345;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	let worst = 0;
	for (let trial = 0; trial < 400; trial++) {
		const n = 1 + Math.floor(rnd() * 8);
		const mode = trial % 3;
		const pts = [];
		for (let i = 0; i < n; i++) {
			if (mode === 0) pts.push([rnd() * 10, rnd() * 10]);
			else if (mode === 1) pts.push([rnd() * 10, 0.1 * rnd() * 10 + 1e-4 * rnd()]);
			else pts.push([Math.floor(rnd() * 5), Math.floor(rnd() * 5)]);
		}
		const h = OrbitScience.createHull();
		pts.forEach((p, i) => OrbitScience.acceptHull(h, 'f', p, 'v' + i));
		for (let q = 0; q < 4; q++) {
			const t = [rnd() * 12, rnd() * 12];
			const r = OrbitScience.previewHull(h, 'f', t);
			const want = bruteHullDist(pts, t);
			const got = r.inside ? 0 : r.dist;
			worst = Math.max(worst, Math.abs(got - want));
		}
	}
	assert.ok(worst < 1e-9, 'worst distance error ' + worst);
});

check('prototypes: research unlocks a rung-placed engine record with career-wide labels', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	career.ledger.purse = 50;
	assert.strictEqual(GravityGame.researchLabel(career), 'R1');
	assert.ok(GravityGame.researchPoint(career, 'engine', [26, 1.8], 'R1'));
	const proto = GravityGame.prototypeById(career, 'engine', 'R1');
	assert.ok(proto, 'engine prototype unlocked');
	assert.strictEqual(proto.thrust, 26);
	assert.strictEqual(proto.mass, 1.8);
	/* 26 kN sits 2/16 of the way from IMP-2 to IMP-3: rung 2.13 orders the shop and reads isp;
	 * the build cost is the spec's own share of its research from the origin */
	assert.strictEqual(proto.tier, 2.13);
	assert.strictEqual(proto.isp, 295.2);
	assert.strictEqual(proto.buildCost, OrbitScience.buildCostOf('engine', [26, 1.8]));
	assert.ok(proto.buildCost > OrbitTech.ENGINES[1].buildCost, 'between IMP-2 and IMP-3 in spend too');
	assert.ok(career.owned.R1, 'the unlocked prototype is owned');
	assert.strictEqual(GravityGame.prototypesOf(career, 'engine').length, 1);
	assert.strictEqual(GravityGame.prototypeById(career, 'catapult', 'R1'), null);
	/* a second family invention takes the next career-wide label, so ids never collide */
	assert.strictEqual(GravityGame.researchLabel(career), 'R2');
	assert.ok(GravityGame.researchPoint(career, 'catapult', [100, 0.76], 'R2'));
	const cat = GravityGame.prototypeById(career, 'catapult', 'R2');
	assert.strictEqual(cat.tier, 2.22);
	assert.strictEqual(cat.buildCost, OrbitScience.buildCostOf('catapult', [100, 0.76]));
	/* a restart clears the unlocked records along with the hull */
	startCareer(w, 42);
	assert.deepStrictEqual(GravityGame.prototypesOf(career, 'engine'), []);
	assert.strictEqual(GravityGame.prototypeById(career, 'catapult', 'R2'), null);
});

check('prototypes: an engine record refits free at HQ, is ship-mass correct, and swaps back to the ladder', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	career.ledger.purse = 2000;
	assert.ok(GravityGame.researchPoint(career, 'engine', [60, 0.5], 'R1'));
	const proto = GravityGame.prototypeById(career, 'engine', 'R1');
	const purse = career.ledger.purse;
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, proto), 'owned prototype fits at HQ');
	assert.strictEqual(career.ship.engine, proto);
	assert.strictEqual(career.ledger.purse, purse, 'owned records refit for free');
	assert.strictEqual(career.ship.mass, OrbitTech.shipMass(career.ship, career.ship.cargoTons));
	assert.ok(OrbitTech.impulseDeltaV(OrbitTech.TANKS[1].fuelCap, proto, career.ship.mass, OrbitTech.TANKS[1].fuelCap) > 0);
	/* the unowned ladder rung still costs its build price, then the ladder works again */
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, OrbitTech.ENGINES[0]));
	assert.ok(Math.abs(career.ledger.purse - (purse - OrbitTech.ENGINES[0].buildCost)) < 1e-9);
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, proto), 'and back to the prototype');
	career.at = (career.hq + 1) % PLANETS;
	assert.strictEqual(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, OrbitTech.ENGINES[0]), false,
		'refit only at HQ');
});

check('prototypes: a catapult record builds on an empty pad or one rung up, never below', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	career.ledger.purse = 50;
	assert.ok(GravityGame.researchPoint(career, 'catapult', [100, 0.76], 'R1'));
	const proto = GravityGame.prototypeById(career, 'catapult', 'R1');
	const hq = career.hq;
	const purse = career.ledger.purse;
	/* HQ already holds EMC-1 (rung 1): the prototype (rung 2.22) is an upgrade */
	assert.ok(GravityGame.buildGear(career, hq, OrbitTech.KIND_CATAPULT, proto));
	assert.strictEqual(career.pads[hq].catapult, proto);
	assert.ok(Math.abs(career.ledger.purse - (purse - proto.buildCost)) < 1e-9);
	/* a weaker invention cannot replace it on that pad */
	assert.ok(GravityGame.researchPoint(career, 'catapult', [20, 0.6], 'R2'));
	const weak = GravityGame.prototypeById(career, 'catapult', 'R2');
	assert.strictEqual(GravityGame.buildGear(career, hq, OrbitTech.KIND_CATAPULT, weak), false);
	assert.strictEqual(career.pads[hq].catapult, proto);
	/* an empty pad takes any record as its first catapult, with the starter panel and battery */
	const other = (hq + 1) % PLANETS;
	assert.ok(GravityGame.buildGear(career, other, OrbitTech.KIND_CATAPULT, weak));
	assert.strictEqual(career.pads[other].catapult, weak);
	assert.strictEqual(career.pads[other].battery, BAT[0]);
	/* the generic physics takes the record: a stronger rail limits speed higher */
	const mass = career.ship.mass;
	assert.ok(OrbitTech.maxSpeed(mass, proto) > OrbitTech.maxSpeed(mass, EMC[0]));
	assert.ok(OrbitTech.launchEnergy(mass, proto, 100) > 0);
});

check('prototypes: communism builds and fits them free', () => {
	const c = makeWorld(7);
	startCareer(c, 7, GravityGame.CHEAT_COMMUNISM);
	const { career } = c;
	const purse = career.ledger.purse;
	assert.ok(GravityGame.researchPoint(career, 'engine', [60, 0.5], 'R1'));
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, GravityGame.prototypeById(career, 'engine', 'R1')));
	assert.ok(GravityGame.researchPoint(career, 'catapult', [100, 0.76], 'R2'));
	assert.ok(GravityGame.buildGear(career, career.hq, OrbitTech.KIND_CATAPULT,
		GravityGame.prototypeById(career, 'catapult', 'R2')));
	assert.strictEqual(career.ledger.purse, purse);
});

check('tank science & prototypes: seeded FT-1..FT-3 range, directional surcharge, and HQ refit', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	assert.ok(GravityGame.SCIENCE_KINDS.includes(OrbitTech.KIND_TANK));
	const st = OrbitScience.statsHull(career.science, 'tank');
	assert.strictEqual(st.n, 3, 'FT-1..FT-3 seed the tank hull (FT-0 empty slot excluded)');
	const range = OrbitScience.rangeHull(career.science, 'tank');
	assert.deepStrictEqual(range.min, [40, 0.5]);
	assert.deepStrictEqual(range.max, [160, 1.4]);
	/* 0.5 RU below min emptyMass (0.25 t) is much dearer than 0.5 RU above max (1.65 t) */
	const light = GravityGame.researchPreview(career, 'tank', [90, 0.25]);
	const heavy = GravityGame.researchPreview(career, 'tank', [90, 1.65]);
	assert.ok(Math.abs(light.frontier - 1.5) < 1e-12 && Math.abs(heavy.frontier) < 1e-12);
	assert.ok(light.cost > heavy.cost * 5, 'composite ultralight tank costs more than heavy tank');
	/* 1.0 RU above max fuelCap (210 kg) is dearer than 0.5 RU below min (15 kg) */
	const big = GravityGame.researchPreview(career, 'tank', [210, 0.9]);
	const small = GravityGame.researchPreview(career, 'tank', [15, 0.9]);
	assert.ok(big.frontier > small.frontier && big.cost > small.cost);
	/* unlock and fit a custom tank prototype at HQ */
	career.ledger.purse = 100;
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_ENGINE, OrbitTech.ENGINES[0]));
	const purseBefore = career.ledger.purse;
	const fee = GravityGame.researchCost(career, 'tank', [115, 0.65]);
	assert.ok(GravityGame.researchPoint(career, 'tank', [115, 0.65], 'R1'));
	assert.ok(Math.abs(career.ledger.purse - (purseBefore - fee)) < 1e-9);
	const proto = GravityGame.prototypeById(career, 'tank', 'R1');
	assert.ok(proto && proto.id === 'R1' && proto.fuelCap === 115 && proto.emptyMass === 0.65);
	assert.strictEqual(proto.buildCost, OrbitScience.buildCostOf('tank', [115, 0.65]));
	/* waste is dear to ship: the same fuel with a heavier tank is cheaper to build */
	assert.ok(OrbitScience.buildCostOf('tank', [115, 1.4]) < proto.buildCost, 'heavier tank cheaper');
	const purseAfterResearch = career.ledger.purse;
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_TANK, proto));
	assert.strictEqual(career.ship.tank, proto);
	assert.strictEqual(career.ship.fuelKg, 115);
	assert.strictEqual(career.ledger.purse, purseAfterResearch, 'owned tank prototype fits free at HQ');
	assert.strictEqual(career.ship.mass, OrbitTech.shipMass(career.ship, 0));
	assert.ok(OrbitTech.shipDeltaV(career.ship, 0) > 15);
	assert.ok(GravityGame.installPart(career, OrbitTech.KIND_TANK, OrbitTech.TANKS[0]), 'free swap back to FT-0');
});

check('science families: one table drives seeding, prototypes and the frontier data', () => {
	for (const spec of GravityGame.SCIENCE_FAMILIES) {
		assert.ok(OrbitScience.METRIC_SCALE[spec.kind], spec.kind + ' needs a metric scale');
		const dim = spec.params(spec.table[0]).length;
		assert.strictEqual(dim, 2, spec.kind + ' is a 2-D slider plot');
		assert.strictEqual(OrbitScience.FRONTIER[spec.kind].length, dim, spec.kind + ' frontier row');
		assert.ok(typeof spec.record === 'function', spec.kind + ' record builder');
	}
	assert.deepStrictEqual(GravityGame.SCIENCE_KINDS,
		[OrbitTech.KIND_ENGINE, OrbitTech.KIND_CATAPULT, OrbitTech.KIND_TANK, OrbitTech.KIND_BATTERY]);
});

check('battery science: seeded BAT-1..BAT-5 range, leak direction, and a pad-wide prototype', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { career } = w;
	assert.strictEqual(OrbitScience.statsHull(career.science, 'battery').n, BAT.length);
	const range = OrbitScience.rangeHull(career.science, 'battery');
	assert.deepStrictEqual(range.min, [BAT[0].capacity, BAT[BAT.length - 1].leak]);
	assert.deepStrictEqual(range.max, [BAT[BAT.length - 1].capacity, BAT[0].leak]);
	/* 1 RU = 2.5 kWh capacity = 0.0002 leak: a tighter tank pays ↓×2.50, a bigger one ↑×1.20 */
	const tight = GravityGame.researchPreview(career, 'battery', [10, 0.0002]);
	const leaky = GravityGame.researchPreview(career, 'battery', [10, 0.0011]);
	assert.ok(Math.abs(tight.frontier - 1.25) < 1e-12, 'tight leak frontier ' + tight.frontier);
	assert.ok(Math.abs(leaky.frontier) < 1e-12, 'leaky frontier ' + leaky.frontier);
	assert.ok(tight.frontier > 20 * leaky.frontier, 'a tighter seal is the dear direction');
	/* equal 0.5 kWh of capacity overshoot (0.2 RU): above the range is dear, below is cheap */
	const above = GravityGame.researchPreview(career, 'battery', [16.5, 0.0006]);
	const below = GravityGame.researchPreview(career, 'battery', [1.0, 0.0006]);
	assert.ok(Math.abs(above.frontier - 0.24) < 1e-12 && Math.abs(below.frontier) < 1e-12);
	assert.ok(above.cost > below.cost, 'more capacity costs more than less at equal overshoot');
	const big = GravityGame.researchPreview(career, 'battery', [20, 0.0006]);
	assert.ok(Math.abs(big.frontier - 1.92) < 1e-12, 'capacity overshoot ' + big.frontier);
	const small = GravityGame.researchPreview(career, 'battery', [1, 0.0006]);
	assert.ok(big.cost > small.cost, 'a bigger battery costs more than a smaller one');
	/* sub-rung prototypes clamp the ordinal to RUNG_MIN (0.5); the price stays the spec's own, in cents */
	const tinyEngine = OrbitTech.engineRecord('R-tiny', 4, 3.5);
	assert.strictEqual(tinyEngine.tier, 0.5);
	assert.strictEqual(tinyEngine.buildCost, OrbitScience.buildCostOf('engine', [4, 3.5]));
	assert.ok(tinyEngine.isp >= 100);
	const tinyBat = OrbitTech.batteryRecord('R-tiny', 0.1, 0.0012);
	assert.strictEqual(tinyBat.tier, 0.5);
	assert.strictEqual(tinyBat.buildCost, OrbitScience.buildCostOf('battery', [0.1, 0.0012]));
	/* the invented record lands on the BAT ladder rung of its capacity */
	career.ledger.purse = 100;
	assert.ok(GravityGame.researchPoint(career, 'battery', [12, 0.0005], 'R1'));
	const proto = GravityGame.prototypeById(career, 'battery', 'R1');
	assert.ok(proto && proto.capacity === 12 && proto.leak === 0.0005);
	assert.ok(proto.tier > BAT[3].tier && proto.tier < BAT[4].tier, 'rung ' + proto.tier);
	assert.strictEqual(proto.buildCost, OrbitScience.buildCostOf('battery', [12, 0.0005]));
	assert.ok(OrbitScience.buildCostOf('battery', [12, 0.0005]) > OrbitScience.buildCostOf('battery', [6, 0.0005]), 'bigger costs more');
	/* the prototype is pad gear: built on every built pad at once, never on the ship */
	const mass = career.ship.mass;
	const hq = career.hq;
	const far = (hq + 5) % career.pads.length;
	assert.ok(GravityGame.buildGear(career, far, OrbitTech.KIND_CATAPULT, EMC[0]));
	assert.strictEqual(GravityGame.bulkUpgradeCost(career, 'battery', proto), 2 * proto.buildCost);
	assert.ok(GravityGame.bulkUpgrade(career, 'battery', proto));
	assert.strictEqual(career.pads[hq].battery, proto);
	assert.strictEqual(career.pads[far].battery, proto);
	assert.strictEqual(career.pads[far].chargeKwh, proto.capacity, 'a fresh battery arrives charged');
	assert.strictEqual(career.ship.mass, mass, 'pad batteries never add ship mass');
	assert.strictEqual(GravityGame.bulkUpgradeCost(career, 'battery', proto), 0, 'nothing left to upgrade');
	assert.ok(!GravityGame.buildGear(career, far, OrbitTech.KIND_BATTERY, proto), 'never a downgrade');
});

check('guest launch: a rival rail lifts the shot, drains its own battery and pays its owner', () => {
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 42);
	const host = makeWorld(42);
	const guest = makeWorld(42);
	GravityGame.startCareer(host.career, host.sim, 42, host.trade, null, galaxy);
	GravityGame.startCareer(guest.career, guest.sim, 42, guest.trade, null, galaxy);
	/* a planet the guest never claimed, where the rival built a stronger rail */
	const planet = (guest.career.hq + 3) % PLANETS;
	assert.notStrictEqual(planet, guest.career.hq);
	assert.strictEqual(guest.career.pads[planet].catapult, null, 'unclaimed planet needed');
	host.ledger.purse = 100;
	assert.ok(GravityGame.buildGear(host.career, planet, OrbitTech.KIND_CATAPULT, EMC[1]));
	guest.career.at = planet;
	guest.career.stranded = true;
	guest.sim.relocate(planet);
	const pad = GravityGame.padAt(guest.career, planet);
	assert.strictEqual(pad, host.career.pads[planet], 'the guest must fire from the rival rail');
	const shot = findShot(guest, planet, -1);
	assert.ok(shot, 'no landing shot from the shared planet');
	const energy = guest.sim.launchEnergy(planet, shot.speed);
	const fee = GravityGame.launchFee(guest.career, planet, shot.speed);
	assert.ok(fee > 0, 'a rival rail charges its usage tax: ' + fee);
	const hostCharge0 = pad.chargeKwh;
	const hostPurse0 = host.ledger.purse;
	const guestPurse0 = guest.ledger.purse;
	assert.ok(pad.chargeKwh >= energy, 'the rival pad holds the charge for this shot');
	guest.sim.launch(planet, shot.angle, shot.speed);
	GravityGame.careerBeginFlight(guest.career, guest.sim);
	assert.ok(pad.chargeKwh <= hostCharge0 - energy + 1e-9,
		'guest launch must drain the host battery: ' + hostCharge0 + ' -> ' + pad.chargeKwh);
	assert.ok(Math.abs(host.ledger.purse - (hostPurse0 + fee)) < 1e-9, 'usage tax reaches the owner');
	assert.strictEqual(guest.ledger.purse, guestPurse0 - fee, 'the guest pays the tax');
	assert.strictEqual(pad.reservedKwh, 0, 'a fired shot releases its reservation');
});

check('queued launch reserves pad energy: the ceiling drops until it fires or cancels', () => {
	const w = makeWorld(42);
	startCareer(w, 42);
	const { sim, career } = w;
	const planet = career.at;
	const pad = career.pads[planet];
	const full = sim.speedLimit(planet);
	assert.ok(full > GravitySim.SPEED_MIN, 'starter pad must lift the ship');
	const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, full);
	GravityGame.reserveEnergy(pad, energy);
	assert.ok(sim.speedLimit(planet) < full, 'a reservation must lower the launch ceiling');
	assert.ok(!sim.canFire(planet, full), 'the reserved energy is no longer aimable');
	GravityGame.releaseEnergy(pad, energy);
	assert.ok(Math.abs(sim.speedLimit(planet) - full) < 1e-9, 'release restores the ceiling');
	assert.strictEqual(pad.reservedKwh, 0);
	/* the commercial rail is kept charged by its operator: no reservation, no drain */
	GravityGame.setCommercial(career, planet);
	const commercial = GravityGame.padAt(career, planet);
	GravityGame.reserveEnergy(commercial, 1);
	assert.strictEqual(commercial.reservedKwh, 0);
	GravityGame.releaseEnergy(commercial, 1);
	assert.strictEqual(commercial.reservedKwh, 0);
});

/* --- launch book -------------------------------------------------------- */

/* a trace shaped like the ones recordLaunch stores (units, not radians) */
function bookTrace(origin, body, speedU, planets, logSteps, score) {
	const logPlanet = Int32Array.from(planets);
	const logStep = Int32Array.from(logSteps);
	const steps = logSteps[logSteps.length - 1];
	return {
		origin: origin, body: body, angleU: 11, speedU: speedU,
		steps: steps, time: steps * GravitySim.DT, length: steps, score: score,
		logPlanet: logPlanet, logStep: logStep, logCount: logStep.length
	};
}

check('launch book: same start, landing and visited set keep only the faster arrival', () => {
	const book = GravityGame.createLaunchBook();
	const tag = 7;
	GravityGame.recordLaunch(book, tag, bookTrace(3, 5, 30, [5, 9], [400, 900], 2));
	const kept = GravityGame.recordLaunch(book, tag, bookTrace(3, 5, 31, [5, 9], [300, 800], 2));
	assert.strictEqual(book.entries.length, 1);
	assert.strictEqual(kept.steps, 800, 'the faster arrival wins');
	assert.strictEqual(kept.speedU, 31);
	const slower = GravityGame.recordLaunch(book, tag, bookTrace(3, 5, 32, [5, 9], [500, 1000], 2));
	assert.strictEqual(slower.steps, 800, 'a slower arrival must not replace the faster one');
	assert.strictEqual(slower.speedU, 31);
	assert.strictEqual(book.entries.length, 1);
	/* another visited set is another harvest, so it earns its own row */
	GravityGame.recordLaunch(book, tag, bookTrace(3, 5, 33, [5, 9, 11], [500, 1000, 1200], 1));
	assert.strictEqual(book.entries.length, 2);
	/* and another landing from the same planets is a different row too */
	GravityGame.recordLaunch(book, tag, bookTrace(3, 6, 34, [5, 9], [400, 900], 1));
	assert.strictEqual(book.entries.length, 3);
});

check('launch book: capped, weakest score leaves first, and a new world clears the list', () => {
	const book = GravityGame.createLaunchBook();
	const tag = 3;
	for (let i = 0; i < GravityGame.BOOK_MAX + 2; i++) {
		GravityGame.recordLaunch(book, tag, bookTrace(1, i, 40, [i], [100], i));
	}
	assert.strictEqual(book.entries.length, GravityGame.BOOK_MAX);
	let weakest = Infinity;
	for (let i = 0; i < book.entries.length; i++) weakest = Math.min(weakest, book.entries[i].score);
	assert.ok(weakest >= 2, 'the two weakest scores must have left: ' + weakest);
	assert.ok(GravityGame.bookReady(book, tag));
	assert.ok(!GravityGame.bookReady(book, tag + 1), 'another field makes the list stale');
	const version = book.version;
	GravityGame.recordLaunch(book, tag + 1, bookTrace(2, 4, 41, [4], [120], 5));
	assert.strictEqual(book.entries.length, 1, 'a new field starts a clean list');
	assert.ok(book.version > version, 'the page must see the list changed');
	assert.ok(GravityGame.bookReady(book, tag + 1));
	GravityGame.resetLaunchBook(book);
	assert.strictEqual(book.entries.length, 0);
});

check('launch book: a stored visit log re-prices exactly at the live market', () => {
	const market = GravityGame.createMarket();
	const planets = Int32Array.from([4, 9]);
	const steps = Int32Array.from([100, 700]);
	const want = GravityGame.planetProfit(market, 4, 100) + GravityGame.planetProfit(market, 9, 700);
	const got = GravityGame.estimateProfitLog(market, 0, planets, steps, 2);
	assert.ok(Math.abs(got - want) < 1e-12, got + ' vs ' + want);
	/* a planet entered twice inside one trace pays the second time from the first */
	const twice = Int32Array.from([4, 4]);
	const twoSteps = Int32Array.from([100, 900]);
	market.lastVisitStep[4] = 100;
	const second = GravityGame.planetProfit(market, 4, 900);
	market.lastVisitStep[4] = -GravityGame.initSteps();
	const repeat = GravityGame.planetProfit(market, 4, 100) + second;
	const repeatGot = GravityGame.estimateProfitLog(market, 0, twice, twoSteps, 2);
	assert.ok(Math.abs(repeatGot - repeat) < 1e-12, repeatGot + ' vs ' + repeat);
	assert.strictEqual(GravityGame.estimateProfitLog(market, 0, planets, steps, 0), 0);
});

check('launch book: rows from other planets leave before the current pad', () => {
	const book = GravityGame.createLaunchBook();
	const tag = 9;
	/* fill the book from a planet the ship has left, with strong scores */
	for (let i = 0; i < GravityGame.BOOK_MAX; i++) {
		GravityGame.recordLaunch(book, tag, bookTrace(4, 10 + i, 40, [10 + i], [200], 9));
	}
	/* a weak find from the planet under the ship still earns its row */
	GravityGame.recordLaunch(book, tag, bookTrace(7, 3, 41, [3], [150], 0.5));
	assert.strictEqual(book.entries.length, GravityGame.BOOK_MAX);
	let here = 0;
	let there = 0;
	for (let i = 0; i < book.entries.length; i++) {
		if (book.entries[i].origin === 7) here += 1;
		else there += 1;
	}
	assert.strictEqual(here, 1, 'the current pad must keep its row');
	assert.strictEqual(there, GravityGame.BOOK_MAX - 1, 'a row from another planet had to leave');
});

/* --- rail facts: one source for the list, the button and the bot log ---- */

check('rail facts: the line, the block reasons and careerCanFire agree', () => {
	const w = makeWorld(42);
	startCareer(w, 42, null);
	const at = w.career.at;
	const line = GravityGame.railText(w.career, w.sim, at);
	assert.ok(/^P\d+ · (own EMC-\d|commercial EMC-1|(YOU|R\d) rail) · [\d.]+\/[\d.]+ kWh → \d+ px\/s \(min \d+\) · fee [\d.]+ · purse [\d.]+ · exit ([\d.]+|impossible)$/.test(line), line);
	assert.strictEqual(GravityGame.railBlock(w.career, w.sim, at, GravitySim.SPEED_MIN), '',
		'a fresh career fires from its own rail');
	assert.ok(GravityGame.careerCanFire(w.career, w.sim, at, GravitySim.SPEED_MIN));
	/* cap: the saved speed is above what the live charge buys */
	const cap = w.sim.speedLimit(at);
	assert.strictEqual(GravityGame.railBlock(w.career, w.sim, at, cap + 1),
		'cap ' + cap.toFixed(0) + ' < ' + (cap + 1).toFixed(0) + ' px/s');
	assert.ok(!GravityGame.careerCanFire(w.career, w.sim, at, cap + 1),
		'careerCanFire must agree with the block reason');
	/* another planet: the ship is not on that rail */
	const far = (at + 1) % PLANETS;
	assert.strictEqual(GravityGame.railBlock(w.career, w.sim, far, GravitySim.SPEED_MIN),
		'shot leaves from P' + far);
	/* in space: only the evacuation is left */
	assert.strictEqual(GravityGame.railText(w.career, w.sim, -1),
		'ship in space · evac ' + GravityGame.CAREER.evacFee.toFixed(2) +
			' · purse ' + w.career.ledger.purse.toFixed(2));
	w.career.at = -1;
	assert.strictEqual(GravityGame.railBlock(w.career, w.sim, at, GravitySim.SPEED_MIN),
		'ship in space');
	w.career.at = at;
	/* fee: a commercial rail the purse cannot pay */
	GravityGame.setCommercial(w.career, at);
	w.career.ledger.purse = 0;
	assert.strictEqual(GravityGame.railBlock(w.career, w.sim, at, GravitySim.SPEED_MIN),
		'fee ' + GravityGame.CAREER.commercialFee.toFixed(2) + ' > purse 0.00');
	assert.ok(!GravityGame.careerCanFire(w.career, w.sim, at, GravitySim.SPEED_MIN));
	const paid = GravityGame.railText(w.career, w.sim, at);
	assert.ok(paid.includes('commercial EMC-1') && paid.includes('purse 0.00'), paid);
});

check('launch book: every career owns one and a restart clears it', () => {
	const trade = new Sim(42);
	trade.advanceTo(420);
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.startCareer(career, new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H),
		42, trade, null);
	GravityGame.recordLaunch(career.launchBook, 5,
		bookTrace(career.hq, career.hq, 40, [career.hq], [100], 1));
	assert.strictEqual(career.launchBook.entries.length, 1);
	GravityGame.resetCareer(career, 42, trade, null);
	assert.strictEqual(career.launchBook.entries.length, 0, 'a restarted career starts empty');
});

console.log(failures === 0 ? 'CAREER BENCH OK' : 'CAREER BENCH FAILED ' + failures);
process.exit(failures === 0 ? 0 : 1);
