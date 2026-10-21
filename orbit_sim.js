/*
 * Orbital trade and colony expansion.
 *
 * Vendored from luncat8/exec_queue (orbit_sim.js) as the background simulation.
 * A port is a station on a fixed ellipse: pos(t) is closed-form, so a route is
 * solved once at departure and the ship flies straight to the predicted point.
 * Every port has one ship. It carries the port's own good to a partner, brings
 * the partner's good back, and trade fills the port's growth ring. A full ring
 * sends a colony ship to the nearest empty planet within range.
 *
 * All state changes are events in the shared min-heap, scheduled from event
 * time rather than frame time, so a clock jump produces the same world.
 *
 * Geometry and natural traits live in orbit_world.js; the colony economy's laws
 * live in orbit_econ.js. This file owns the event graph and the ports.
 */
(function (root) {
	'use strict';

	const ExecQueue = typeof module !== 'undefined' && module.exports
		? require('./exec_queue.js')
		: root.ExecQueue;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js')
		: root.OrbitEcon;

	const KIND_LOAD = 0;
	const KIND_ARRIVE = 1;
	const KIND_TICK = 2;
	const KIND_BUILD = 3;

	const PORTS = 32;
	const MAX_LINKS = 6;
	const PLANETS = OrbitWorld.PLANETS;
	const INITIAL_PORTS = OrbitWorld.INITIAL_PORTS;
	const GOODS = 3;
	const WORLD_W = OrbitWorld.WORLD_W;
	const WORLD_H = OrbitWorld.WORLD_H;
	const STOCK_MAX = 140;
	const SHIP_CAPACITY = 24;
	const SHIP_RESERVE = 6;
	const RETURN_RESERVE = 4;
	const MIN_LOAD = 8;
	const SHIP_SPEED_MIN = 16;
	const SHIP_SPEED_MAX = 25;
	const BUILDER_SPEED = 44;
	const EXPAND_RADIUS = 420;
	const EXPAND_COST = 650;
	const TICK_MINUTES = 3;
	const LOAD_RETRY = 3;
	const NO_PORT = 255;
	const NO_GOOD = 255;
	const TAU = Math.PI * 2;
	const GOOD_NAMES = ['ice', 'ore', 'gas'];
	const seedRandom = OrbitWorld.seedRandom;

	function Sim(seed) {
		this.seed = seed || 1;
		this.rand = seedRandom(this.seed);
		this.t = 0;
		this.events = new ExecQueue(256);
		this.handleEvent = this.handleEvent.bind(this);
		this.partnerN = 4;
		this.portCount = 0;
		this.shipCount = 0;
		this.planetEmpty = PLANETS;
		this.reserved = 0;
		this.delivered = 0;
		this.coloniesBuilt = 0;
		this.maxAimError = 0;
		this.goodCounts = new Uint8Array(GOODS);

		this.planetState = new Uint8Array(PLANETS); // 0 empty, 1 port, 2 colony reserved
		this.planetPort = new Uint8Array(PLANETS);
		this.planetPort.fill(NO_PORT);

		this.portPlanet = new Uint8Array(PORTS);
		this.portSpec = new Uint8Array(PORTS);
		this.portProd = new Float64Array(PORTS);
		this.portCons = new Float64Array(PORTS);
		this.portStock = new Float64Array(PORTS * GOODS);
		this.portProgress = new Float64Array(PORTS);
		this.portNext = new Float64Array(PORTS);
		this.portTrade = new Float64Array(PORTS);
		this.partners = new Uint8Array(PORTS * MAX_LINKS);
		this.partnerCount = new Uint8Array(PORTS);
		this.bestIndex = new Uint8Array(MAX_LINKS);
		this.bestDist = new Float64Array(MAX_LINKS);

		this.builderActive = new Uint8Array(PORTS);
		this.builderTarget = new Uint8Array(PORTS);
		this.builderStartX = new Float64Array(PORTS);
		this.builderStartY = new Float64Array(PORTS);
		this.builderEndX = new Float64Array(PORTS);
		this.builderEndY = new Float64Array(PORTS);
		this.builderDepart = new Float64Array(PORTS);
		this.builderArrive = new Float64Array(PORTS);

		this.shipHome = new Uint8Array(PORTS);
		this.shipDock = new Uint8Array(PORTS);
		this.shipTarget = new Uint8Array(PORTS);
		this.shipLeg = new Uint8Array(PORTS);
		this.shipState = new Uint8Array(PORTS);
		this.shipGood = new Uint8Array(PORTS);
		this.shipAmount = new Float64Array(PORTS);
		this.shipDepart = new Float64Array(PORTS);
		this.shipArrive = new Float64Array(PORTS);
		this.shipStartX = new Float64Array(PORTS);
		this.shipStartY = new Float64Array(PORTS);
		this.shipAimX = new Float64Array(PORTS);
		this.shipAimY = new Float64Array(PORTS);
		this.shipSpeed = new Float64Array(PORTS);
		this.shipDockAngle = new Float64Array(PORTS);

		/* geometry and traits: the caller's stream, in the historical order */
		OrbitWorld.attach(this, OrbitWorld.create(this.seed, this.rand));
		/* colony records, one planet at most (§2 of the economy plan) */
		this.colonies = [];
		this.colonyOn = new Uint8Array(PLANETS);
		this.colonyOn.fill(NO_PORT);
		this.mapOut = OrbitEcon.createMap();
		this.refreshPartners();
		for (let i = 0; i < INITIAL_PORTS; i++) {
			const progress = 160 + this.rand() * 260;
			this.activatePort(this.initialPlanets[i], 0, progress);
		}
		this.refreshPartners();
		this.events.push(TICK_MINUTES, KIND_TICK, 0);
		for (let p = 0; p < INITIAL_PORTS; p++) {
			this.portNext[p] = 10 + this.rand() * 30;
		}
	}

	/* The station on planet `planet` at trade time `time` — closed form. */
	Sim.prototype.planetXAt = function (planet, time) {
		return OrbitWorld.planetXAt(this.world, planet, time);
	};

	Sim.prototype.planetYAt = function (planet, time) {
		return OrbitWorld.planetYAt(this.world, planet, time);
	};

	Sim.prototype.portX = function (port, time) {
		return this.planetXAt(this.portPlanet[port], time);
	};

	Sim.prototype.portY = function (port, time) {
		return this.planetYAt(this.portPlanet[port], time);
	};

	Sim.prototype.activatePort = function (planet, time, progress) {
		const p = this.portCount++;
		const rand = this.rand;
		if (this.planetState[planet] === 2) this.reserved -= 1;
		else this.planetEmpty -= 1;
		this.planetState[planet] = 1;
		this.planetPort[planet] = p;
		this.portPlanet[p] = planet;

		let start = Math.floor(rand() * GOODS);
		let spec = start;
		let specCount = 255;
		for (let k = 0; k < GOODS; k++) {
			const good = (start + k) % GOODS;
			if (this.goodCounts[good] < specCount) {
				specCount = this.goodCounts[good];
				spec = good;
			}
		}
		this.portSpec[p] = spec;
		this.goodCounts[spec] += 1;
		this.portProd[p] = 1.35 + rand() * 0.3;
		this.portCons[p] = 0.66 + rand() * 0.08;
		const fresh = time < 1 ? 1 : 0;
		for (let g = 0; g < GOODS; g++) {
			let stock;
			if (g === spec) stock = fresh ? 58 + rand() * 22 : 30 + rand() * 12;
			else stock = fresh ? 26 + rand() * 18 : 12 + rand() * 8;
			this.portStock[p * GOODS + g] = stock;
		}
		this.portProgress[p] = progress;
		this.portNext[p] = time + 90 + rand() * 60;
		this.portTrade[p] = 0;

		this.shipHome[p] = p;
		this.shipDock[p] = p;
		this.shipState[p] = 0;
		this.shipGood[p] = NO_GOOD;
		this.shipAmount[p] = 0;
		this.shipSpeed[p] = SHIP_SPEED_MIN + rand() * (SHIP_SPEED_MAX - SHIP_SPEED_MIN);
		this.shipDockAngle[p] = rand() * TAU;
		this.shipCount = this.portCount;
		this.events.push(time + 1 + rand() * 2.5, KIND_LOAD, p);
	};

	Sim.prototype.refreshPartners = function () {
		const active = this.portCount;
		const n = this.partnerN;
		for (let p = 0; p < active; p++) {
			const px = this.portX(p, this.t);
			const py = this.portY(p, this.t);
			let count = 0;
			for (let q = 0; q < active; q++) {
				if (q === p) continue;
				const dx = px - this.portX(q, this.t);
				const dy = py - this.portY(q, this.t);
				const dist = dx * dx + dy * dy;
				if (count === n && dist >= this.bestDist[n - 1]) continue;
				let i = count < n ? count++ : n - 1;
				while (i > 0 && this.bestDist[i - 1] > dist) {
					this.bestDist[i] = this.bestDist[i - 1];
					this.bestIndex[i] = this.bestIndex[i - 1];
					i -= 1;
				}
				this.bestDist[i] = dist;
				this.bestIndex[i] = q;
			}
			this.partnerCount[p] = count;
			const base = p * MAX_LINKS;
			for (let k = 0; k < MAX_LINKS; k++) {
				this.partners[base + k] = k < count ? this.bestIndex[k] : NO_PORT;
			}
		}
	};

	Sim.prototype.solveRendezvous = function (fromX, fromY, dest, depart, speed) {
		let dx = this.portX(dest, depart) - fromX;
		let dy = this.portY(dest, depart) - fromY;
		let arrive = depart + Math.sqrt(dx * dx + dy * dy) / speed;
		/* the target keeps moving: refine until the aim point stops shifting */
		for (let i = 0; i < 12; i++) {
			dx = this.portX(dest, arrive) - fromX;
			dy = this.portY(dest, arrive) - fromY;
			arrive = depart + Math.sqrt(dx * dx + dy * dy) / speed;
		}
		return arrive;
	};

	Sim.prototype.depart = function (ship, dest, leg, time) {
		const from = this.shipDock[ship];
		const x = this.portX(from, time);
		const y = this.portY(from, time);
		const arrive = this.solveRendezvous(x, y, dest, time, this.shipSpeed[ship]);
		this.shipState[ship] = 1;
		this.shipLeg[ship] = leg;
		this.shipTarget[ship] = dest;
		this.shipDepart[ship] = time;
		this.shipArrive[ship] = arrive;
		this.shipStartX[ship] = x;
		this.shipStartY[ship] = y;
		this.shipAimX[ship] = this.portX(dest, arrive);
		this.shipAimY[ship] = this.portY(dest, arrive);
		this.events.push(arrive, KIND_ARRIVE, ship);
	};

	/* docked at home: pick the nearest neighbour with the emptiest bin */
	Sim.prototype.load = function (ship, time) {
		const home = this.shipHome[ship];
		const spec = this.portSpec[home];
		const base = home * GOODS;
		const stock = this.portStock[base + spec];
		const links = this.partnerCount[home];
		const partnerBase = home * MAX_LINKS;
		let dest = NO_PORT;
		let destStock = STOCK_MAX;
		for (let k = 0; k < links; k++) {
			const q = this.partners[partnerBase + k];
			if (q === NO_PORT) continue;
			const qStock = this.portStock[q * GOODS + spec];
			if (qStock < destStock) {
				destStock = qStock;
				dest = q;
			}
		}
		const room = dest === NO_PORT ? 0 : STOCK_MAX - destStock;
		const amount = Math.min(SHIP_CAPACITY, stock - SHIP_RESERVE, room);
		if (dest === NO_PORT || amount < MIN_LOAD || stock - destStock < 4) {
			this.events.push(time + LOAD_RETRY + this.rand() * 2, KIND_LOAD, ship);
			return;
		}
		this.portStock[base + spec] = stock - amount;
		this.portProgress[home] += amount;
		this.portTrade[home] += amount;
		this.shipGood[ship] = spec;
		this.shipAmount[ship] = amount;
		this.depart(ship, dest, 0, time);
	};

	Sim.prototype.arrive = function (ship, time) {
		const target = this.shipTarget[ship];
		const dx = this.shipAimX[ship] - this.portX(target, time);
		const dy = this.shipAimY[ship] - this.portY(target, time);
		const error = Math.sqrt(dx * dx + dy * dy);
		if (error > this.maxAimError) this.maxAimError = error;

		const good = this.shipGood[ship];
		const amount = this.shipAmount[ship];
		const base = target * GOODS;
		let landed = 0;
		if (good !== NO_GOOD && amount > 0) {
			const room = STOCK_MAX - this.portStock[base + good];
			landed = amount < room ? amount : room;
			this.portStock[base + good] += landed;
			this.portProgress[target] += landed;
			this.portTrade[target] += landed;
			this.delivered += landed;
		}
		this.shipGood[ship] = NO_GOOD;
		this.shipAmount[ship] = 0;
		this.shipDock[ship] = target;
		this.shipState[ship] = 0;
		this.shipDockAngle[ship] = this.rand() * TAU;

		if (this.shipLeg[ship] === 0) {
			/* partner: load its own good for the way home */
			const spec = this.portSpec[target];
			const stock = this.portStock[base + spec];
			const take = Math.min(SHIP_CAPACITY, stock - RETURN_RESERVE);
			if (take > 0) {
				this.portStock[base + spec] = stock - take;
				this.portProgress[target] += take;
				this.portTrade[target] += take;
				this.shipGood[ship] = spec;
				this.shipAmount[ship] = take;
			}
			this.depart(ship, this.shipHome[ship], 1, time);
			return;
		}
		this.events.push(time + 1 + this.rand() * 1.5, KIND_LOAD, ship);
	};

	Sim.prototype.sendColony = function (port, target, time) {
		const x = this.portX(port, time);
		const y = this.portY(port, time);
		const dx = this.planetX[target] - x;
		const dy = this.planetY[target] - y;
		const travel = Math.sqrt(dx * dx + dy * dy) / BUILDER_SPEED;
		this.planetState[target] = 2;
		this.planetEmpty -= 1;
		this.reserved += 1;
		this.builderActive[port] = 1;
		this.builderTarget[port] = target;
		this.builderStartX[port] = x;
		this.builderStartY[port] = y;
		this.builderDepart[port] = time;
		this.builderArrive[port] = time + travel;
		this.builderEndX[port] = this.planetX[target];
		this.builderEndY[port] = this.planetY[target];
		this.portNext[port] = time + 45 + this.rand() * 30;
		this.events.push(time + travel, KIND_BUILD, port);
	};

	Sim.prototype.finishColony = function (port, time) {
		const target = this.builderTarget[port];
		this.builderActive[port] = 0;
		this.activatePort(target, time, 0);
		this.coloniesBuilt += 1;
		this.refreshPartners();
	};

	Sim.prototype.scoreTarget = function (port) {
		const px = this.portX(port, this.t);
		const py = this.portY(port, this.t);
		let best = NO_PORT;
		let bestDist = EXPAND_RADIUS * EXPAND_RADIUS;
		for (let planet = 0; planet < PLANETS; planet++) {
			if (this.planetState[planet] !== 0) continue;
			const dx = this.planetX[planet] - px;
			const dy = this.planetY[planet] - py;
			const dist = dx * dx + dy * dy;
			if (dist < bestDist) {
				bestDist = dist;
				best = planet;
			}
		}
		return best;
	};

	Sim.prototype.tick = function (time) {
		this.refreshPartners();
		for (let p = 0; p < this.portCount; p++) {
			if (this.builderActive[p] === 1) continue;
			if (this.portProgress[p] > EXPAND_COST) this.portProgress[p] = EXPAND_COST;
			if (this.portProgress[p] < EXPAND_COST || time < this.portNext[p]) continue;
			const target = this.scoreTarget(p);
			if (target === NO_PORT) continue;
			this.portProgress[p] = 0;
			this.sendColony(p, target, time);
		}
		this.events.push(time + TICK_MINUTES, KIND_TICK, 0);
	};

	Sim.prototype.handleEvent = function (time, kind, ref) {
		const dt = time - this.t;
		if (dt > 0) this.accrue(dt);
		this.t = time;
		if (kind === KIND_LOAD) this.load(ref, time);
		else if (kind === KIND_ARRIVE) this.arrive(ref, time);
		else if (kind === KIND_TICK) this.tick(time);
		else this.finishColony(ref, time);
	};

	/* own good grows, the other two are eaten by the port population */
	Sim.prototype.accrue = function (minutes) {
		if (!(minutes > 0)) return;
		for (let p = 0; p < this.portCount; p++) {
			const spec = this.portSpec[p];
			const base = p * GOODS;
			const grown = this.portStock[base + spec] + this.portProd[p] * minutes;
			this.portStock[base + spec] = grown > STOCK_MAX ? STOCK_MAX : grown;
			for (let g = 0; g < GOODS; g++) {
				if (g === spec) continue;
				const left = this.portStock[base + g] - this.portCons[p] * minutes;
				this.portStock[base + g] = left > 0 ? left : 0;
			}
		}
	};

	Sim.prototype.step = function (minutes) {
		if (!(minutes > 0)) return;
		const target = this.t + minutes;
		this.events.drainUntil(target, this.handleEvent);
		const rest = target - this.t;
		if (rest > 0) this.accrue(rest);
		this.t = target;
	};

	Sim.TYPE_NAMES = OrbitWorld.TYPE_NAMES;
	Sim.PORTS = PORTS;
	Sim.PLANETS = PLANETS;
	Sim.INITIAL_PORTS = INITIAL_PORTS;
	Sim.GOOD_NAMES = GOOD_NAMES;
	Sim.WORLD_W = WORLD_W;
	Sim.WORLD_H = WORLD_H;
	Sim.SHIP_CAPACITY = SHIP_CAPACITY;
	Sim.EXPAND_RADIUS = EXPAND_RADIUS;
	Sim.EXPAND_COST = EXPAND_COST;
	Sim.MAX_LINKS = MAX_LINKS;
	Sim.NO_PORT = NO_PORT;
	Sim.NO_GOOD = NO_GOOD;

	if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
	else root.OrbitSim = Sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
