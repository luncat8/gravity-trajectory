/*
 * Orbital trade and colony expansion.
 *
 * Vendored from luncat8/exec_queue (orbit_sim.js) as the background simulation,
 * now wired to the two-tier colony economy (archive/0.2.0-plan-colony-economy.md).
 * A port is a station on a fixed ellipse: pos(t) is closed-form, so a route is
 * solved once at departure and the ship flies straight to the predicted point.
 * Every colonised planet has one port, one ship, and one colony record. On each
 * TICK (3 sim minutes = 3 colony years) all colonies advance through the pure
 * growth law in orbit_econ.js; ships carry the port's best intra-system export
 * (bulk or finished goods above a two-year guard) or a migrants flow to the
 * nearest-four partners. Only town and city colonies sponsor expansion ships.
 *
 * All state changes are events in the shared min-heap, scheduled from event
 * time rather than frame time, so a clock jump produces the same world and zero
 * economy work runs per frame.
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
	const WORLD_W = OrbitWorld.WORLD_W;
	const WORLD_H = OrbitWorld.WORLD_H;
	const AREA_W = OrbitWorld.AREA_W;
	const AREA_H = OrbitWorld.AREA_H;
	const AREA_PAD_X = OrbitWorld.AREA_PAD_X;
	const AREA_PAD_Y = OrbitWorld.AREA_PAD_Y;
	const SHIP_CAPACITY = 24;
	const SHIP_SPEED_MIN = 16;
	const SHIP_SPEED_MAX = 25;
	const BUILDER_SPEED = 44;
	const EXPAND_RADIUS = 420;
	const EXPAND_COST = 650;
	const TICK_MINUTES = 3;
	const ECON_YEARS_PER_MIN = 1;
	const LOAD_RETRY = 3;
	const DIST_SCALE = 220;
	const MIGRANT_COMFORT = 0.6;
	const MIGRANT_FILL = 0.8;
	const MIGRANT_RATE = 0.02;
	const MIN_EXPAND_HABITAT = 0.13;
	const LOG_MAX = 40;
	const NO_PORT = 255;
	const NO_GOOD = 255;
	const TAU = Math.PI * 2;
	const GOOD_NAMES = ['bulk', 'goods', 'migrants'];
	const seedRandom = OrbitWorld.seedRandom;

	function Sim(seed) {
		this.handleEvent = this.handleEvent.bind(this);
		this.onColonyEvent = this.onColonyEvent.bind(this);
		this.reset(seed);
	}

	/*
	 * (Re)build the world for `seed` at t = 0. Every array is fresh, so a reset
	 * is identical to a new Sim; holders of array references must re-read them.
	 */
	Sim.prototype.reset = function (seed) {
		/* the run's universe filter belongs to the player, not to the world:
		 * rebuilding the world for a new seed keeps it (applyPlanetUniverse
		 * re-applies it anyway, and a stale mask would hide new colonies) */
		const savedMask = this.planetMask;
		this.seed = seed || 1;
		this.rand = seedRandom(this.seed);
		this.t = 0;
		this.events = new ExecQueue(256);
		this.partnerN = 4;
		this.portCount = 0;
		this.shipCount = 0;
		this.tradePlanetLimit = OrbitWorld.DEFAULT_PLANETS;
		this.planetEmpty = this.tradePlanetLimit;
		/* the run's in-play subset; null = every enabled planet trades */
		this.planetMask = null;
		this.reserved = 0;
		this.delivered = 0;
		this.coloniesBuilt = 0;
		this.maxAimError = 0;

		this.planetState = new Uint8Array(PLANETS); // 0 empty, 1 port, 2 colony reserved
		this.planetPort = new Uint8Array(PLANETS);
		this.planetPort.fill(NO_PORT);

		this.portPlanet = new Uint8Array(PORTS);
		this.portSpec = new Uint8Array(PORTS);
		this.portProgress = new Float64Array(PORTS);
		this.portNext = new Float64Array(PORTS);
		this.portTrade = new Float64Array(PORTS);
		this.portMigrants = new Float64Array(PORTS);
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

		/* one colony record per colonised planet (§1, §4) */
		this.colonies = [];
		this.colonyOn = new Uint8Array(PLANETS);
		this.colonyOn.fill(NO_PORT);
		/* shared per-planet corruption the career market owns; null = a clean world */
		this.corruption = null;
		this.mapOut = OrbitEcon.createMap();
		this.log = [];
		this.stageEvents = 0;
		this.famineEvents = 0;
		this.recoveryEvents = 0;
		this.abandonEvents = 0;

		for (let i = 0; i < INITIAL_PORTS; i++) {
			this.activatePort(this.initialPlanets[i], 0);
		}
		this.refreshPartners();
		this.events.push(TICK_MINUTES, KIND_TICK, 0);
		for (let p = 0; p < INITIAL_PORTS; p++) {
			this.portNext[p] = 10 + this.rand() * 30;
		}
		this.planetMask = savedMask;
	};

	Sim.prototype.econY = function (time) {
		return (time === undefined ? this.t : time) * ECON_YEARS_PER_MIN;
	};

	/* the political clock writes straight into the market's array; the tick
	 * copies it onto every colony before the growth law runs */
	Sim.prototype.setCorruption = function (values) {
		this.corruption = values || null;
	};

	Sim.prototype.colonyAt = function (planet) {
		if (planet < 0 || planet >= PLANETS) return null;
		const port = this.colonyOn[planet];
		return port === NO_PORT ? null : this.colonies[port];
	};

	Sim.prototype.pushLog = function (year, kind, planet, text) {
		if (this.log.length >= LOG_MAX) this.log.shift();
		this.log.push({ year: year, kind: kind, planet: planet, text: text });
	};

	Sim.prototype.onColonyEvent = function (kind, colony, year, detail) {
		if (kind === OrbitEcon.EVENT_STAGE) {
			this.stageEvents += 1;
			this.pushLog(year, 'stage', colony.planet,
				colony.name + ' → ' + OrbitEcon.STAGE_NAMES[detail] +
				' · pop ' + OrbitEcon.formatPop(colony.pop));
		} else if (kind === OrbitEcon.EVENT_FAMINE) {
			this.famineEvents += 1;
			this.pushLog(year, 'famine', colony.planet,
				colony.name + ' famine · comfort ' + Math.round(detail * 100) + '%');
		} else if (kind === OrbitEcon.EVENT_RECOVERY) {
			this.recoveryEvents += 1;
			this.pushLog(year, 'recovery', colony.planet,
				colony.name + ' recovered · comfort ' + Math.round(detail * 100) + '%');
		}
	};

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

	function naturalSpec(colony) {
		let best = OrbitEcon.BULK;
		let bestEase = colony.ease[OrbitEcon.BULK];
		for (let r = 1; r < OrbitEcon.INTRA; r++) {
			if (colony.ease[r] > bestEase) {
				bestEase = colony.ease[r];
				best = r;
			}
		}
		return best;
	}

	Sim.prototype.activatePort = function (planet, time) {
		if (planet < 0 || planet >= PLANETS) return null;
		/* never found a colony on a world the run does not play */
		if (!this.planetInPlay(planet)) return null;
		this.setPlanetLimit(planet + 1);
		if (this.colonyOn[planet] !== NO_PORT) {
			return this.colonies[this.colonyOn[planet]];
		}
		const p = this.portCount++;
		const rand = this.rand;
		if (this.planetState[planet] === 2) this.reserved -= 1;
		else this.planetEmpty -= 1;
		this.planetState[planet] = 1;
		this.planetPort[planet] = p;
		this.colonyOn[planet] = p;
		this.portPlanet[p] = planet;

		const map = OrbitEcon.resourceMapFor(
			this.world, planet, this.seed, OrbitEcon.createMap()
		);
		const foundedY = time * ECON_YEARS_PER_MIN;
		const colony = OrbitEcon.createColony(
			planet, 'planet ' + planet, foundedY, map
		);
		colony.idx = p;
		this.colonies[p] = colony;

		/* Seed colonies start with one year of local production in stock so the
		 * first ship dispatch has cargo without waiting several ticks. */
		if (time < 1) {
			for (let r = 0; r < OrbitEcon.INTRA; r++) {
				if (!(OrbitEcon.NEED[r] > 0)) continue;
				const guard = OrbitEcon.GUARD_YEARS * colony.pop * OrbitEcon.NEED[r];
				colony.stock[r] = guard * (0.6 + 1.2 * colony.ease[r]);
			}
		}

		this.portSpec[p] = naturalSpec(colony);
		this.portProgress[p] = 0;
		this.portNext[p] = time + 45 + rand() * 30;
		this.portTrade[p] = 0;
		this.portMigrants[p] = 0;

		this.shipHome[p] = p;
		this.shipDock[p] = p;
		this.shipState[p] = 0;
		this.shipLeg[p] = 0;
		this.shipTarget[p] = p;
		this.shipGood[p] = NO_GOOD;
		this.shipAmount[p] = 0;
		this.shipSpeed[p] = SHIP_SPEED_MIN + rand() * (SHIP_SPEED_MAX - SHIP_SPEED_MIN);
		this.shipDockAngle[p] = rand() * TAU;
		this.shipCount = this.portCount;
		this.pushLog(foundedY, 'founded', planet,
			'outpost founded at planet ' + planet + ' · pop ' +
			OrbitEcon.formatPop(colony.pop) + ' · score ' + map.score.toFixed(2));
		this.events.push(time + 1 + rand() * 2.5, KIND_LOAD, p);
		return colony;
	};

	/* Found an outpost on a free planet (or return the existing colony). */
	Sim.prototype.seedColony = function (planet, time) {
		if (planet < 0 || planet >= PLANETS) return null;
		if (!this.planetInPlay(planet)) return null;
		if (this.colonyOn[planet] !== NO_PORT) {
			return this.colonies[this.colonyOn[planet]];
		}
		const at = time === undefined ? this.t : time;
		const colony = this.activatePort(planet, at);
		this.refreshPartners();
		return colony;
	};

	/* §4 step 8: remove a colony that starved at the floor for 20 years. */
	Sim.prototype.removePort = function (port, year) {
		if (port < 0 || port >= this.portCount) return;
		const planet = this.portPlanet[port];
		const colony = this.colonies[port];
		this.abandonEvents += 1;
		this.pushLog(year, 'abandoned', planet,
			(colony ? colony.name : 'planet ' + planet) + ' abandoned');
		this.dropPort(port);
	};

	Sim.prototype.refreshPartners = function () {
		const active = this.portCount;
		const n = this.partnerN;
		for (let p = 0; p < active; p++) {
			if (!this.portInPlay(p)) {
				this.partnerCount[p] = 0;
				const empty = p * MAX_LINKS;
				for (let k = 0; k < MAX_LINKS; k++) this.partners[empty + k] = NO_PORT;
				continue;
			}
			const px = this.portX(p, this.t);
			const py = this.portY(p, this.t);
			let count = 0;
			for (let q = 0; q < active; q++) {
				if (q === p) continue;
				if (!this.planetInPlay(this.portPlanet[q])) continue;
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

	/*
	 * §7: pick a partner from `port`'s nearest-four set by
	 * `shortfall / (1 + distance / 220)`. `partners` is sorted nearest-first, so
	 * strict `>` breaks ties in favour of the nearer port.
	 */
	Sim.prototype.pickExportDest = function (port, good, time) {
		const t = time === undefined ? this.t : time;
		const px = this.portX(port, t);
		const py = this.portY(port, t);
		const links = this.partnerCount[port];
		const partnerBase = port * MAX_LINKS;
		let best = NO_PORT;
		let bestScore = 0;
		let bestDist = Infinity;
		for (let k = 0; k < links; k++) {
			const q = this.partners[partnerBase + k];
			if (q === NO_PORT || q >= this.portCount) continue;
			if (!this.portInPlay(q)) continue;
			const dst = this.colonies[q];
			if (!dst) continue;
			const shortfall = OrbitEcon.goodShortfall(dst, good);
			if (!(shortfall > 0)) continue;
			const dx = px - this.portX(q, t);
			const dy = py - this.portY(q, t);
			const dist = Math.sqrt(dx * dx + dy * dy);
			const score = shortfall / (1 + dist / DIST_SCALE);
			if (score > bestScore + 1e-12 ||
				(Math.abs(score - bestScore) <= 1e-12 && dist < bestDist)) {
				bestScore = score;
				bestDist = dist;
				best = q;
			}
		}
		return best;
	};

	/*
	 * §5: pick a migrant destination inside the nearest-four set with the
	 * greatest `habitat * (1 - fill)`. Colonies below 0.6 comfort receive none.
	 */
	Sim.prototype.pickMigrantDest = function (port) {
		const links = this.partnerCount[port];
		const partnerBase = port * MAX_LINKS;
		let best = NO_PORT;
		let bestScore = 0;
		for (let k = 0; k < links; k++) {
			const q = this.partners[partnerBase + k];
			if (q === NO_PORT || q >= this.portCount) continue;
			if (!this.portInPlay(q)) continue;
			const dst = this.colonies[q];
			if (!dst || dst.comfort < MIGRANT_COMFORT) continue;
			const K = OrbitEcon.carryingCapacity(dst);
			const fill = K > 0 ? dst.pop / K : 1;
			if (fill >= 1) continue;
			const score = this.planetHabitat[dst.planet] * (1 - fill);
			if (score > bestScore) {
				bestScore = score;
				best = q;
			}
		}
		return best;
	};

	Sim.prototype.dispatchMigrants = function (ship, time) {
		if (ship >= this.portCount) return false;
		const home = this.shipHome[ship];
		const src = this.colonies[home];
		if (!src || src.comfort < MIGRANT_COMFORT) return false;
		const K = OrbitEcon.carryingCapacity(src);
		if (src.pop >= MIGRANT_FILL * K) return false;
		const dest = this.pickMigrantDest(home);
		if (dest === NO_PORT) return false;
		const allowance = this.portMigrants[home] > 0
			? this.portMigrants[home]
			: Math.min(SHIP_CAPACITY, src.pop * MIGRANT_RATE * TICK_MINUTES * ECON_YEARS_PER_MIN);
		const maxRelease = Math.max(0, src.pop - OrbitEcon.POP_FLOOR);
		const amount = Math.min(SHIP_CAPACITY, allowance, maxRelease);
		if (!(amount > 0)) return false;
		this.portMigrants[home] = 0;
		src.pop -= amount;
		this.portTrade[home] += amount;
		this.shipGood[ship] = OrbitEcon.MIGRANTS;
		this.shipAmount[ship] = amount;
		this.depart(ship, dest, 0, time);
		return true;
	};

	/*
	 * §7: on load, take the port's `bestExport` capped at `SHIP_CAPACITY` and
	 * never below the two-year guard, or release the tick's migrants flow (§5).
	 */
	Sim.prototype.load = function (ship, time) {
		if (ship >= this.portCount) return;
		if (!this.portInPlay(ship)) return;
		const home = this.shipHome[ship];
		const src = this.colonies[home];
		if (!src) return;

		const good = OrbitEcon.bestExport(src);
		if (good >= 0) {
			const guard = OrbitEcon.GUARD_YEARS * src.pop * OrbitEcon.NEED[good];
			const avail = src.stock[good] - guard;
			const dest = avail > 0 ? this.pickExportDest(home, good, time) : NO_PORT;
			if (dest !== NO_PORT) {
				const amount = Math.min(SHIP_CAPACITY, avail);
				if (amount > 0) {
					src.stock[good] -= amount;
					this.portTrade[home] += amount;
					this.shipGood[ship] = good;
					this.shipAmount[ship] = amount;
					this.depart(ship, dest, 0, time);
					return;
				}
			}
		}

		if (this.portMigrants[home] > 0 && this.dispatchMigrants(ship, time)) {
			return;
		}

		this.events.push(time + LOAD_RETRY + this.rand() * 2, KIND_LOAD, ship);
	};

	Sim.prototype.arrive = function (ship, time) {
		if (ship >= this.portCount) return;
		if (!this.portInPlay(ship)) return;
		const target = this.shipTarget[ship];
		if (target >= this.portCount) return;
		const dx = this.shipAimX[ship] - this.portX(target, time);
		const dy = this.shipAimY[ship] - this.portY(target, time);
		const error = Math.sqrt(dx * dx + dy * dy);
		if (error > this.maxAimError) this.maxAimError = error;

		const good = this.shipGood[ship];
		const amount = this.shipAmount[ship];
		const dst = this.colonies[target];
		if (dst && good !== NO_GOOD && amount > 0) {
			if (good === OrbitEcon.MIGRANTS) {
				/* §5: 1 t = 1 k-person; colonies below 0.6 comfort receive none. */
				if (dst.comfort >= MIGRANT_COMFORT) {
					const K = OrbitEcon.carryingCapacity(dst);
					const room = Math.max(0, K - dst.pop);
					const landed = amount < room ? amount : room;
					dst.pop += landed;
					if (!dst.starving) {
						const nextStage = OrbitEcon.stageFor(dst.pop);
						while (dst.stage < nextStage) {
							dst.stage += 1;
							this.onColonyEvent(
								OrbitEcon.EVENT_STAGE, dst, this.econY(time), dst.stage
							);
						}
					}
					this.portTrade[target] += landed;
					this.delivered += landed;
				}
			} else {
				const cap = OrbitEcon.warehouseCap(good, dst.pop);
				const room = Math.max(0, cap - dst.stock[good]);
				const landed = amount < room ? amount : room;
				dst.stock[good] += landed;
				this.portTrade[target] += landed;
				this.delivered += landed;
			}
		}
		this.shipGood[ship] = NO_GOOD;
		this.shipAmount[ship] = 0;
		this.shipDock[ship] = target;
		this.shipState[ship] = 0;
		this.shipDockAngle[ship] = this.rand() * TAU;

		if (this.shipLeg[ship] === 0 && target !== this.shipHome[ship]) {
			/* Return leg: carry the partner's best export home if home needs it. */
			const home = this.shipHome[ship];
			const homeColony = this.colonies[home];
			if (dst && homeColony) {
				const retGood = OrbitEcon.bestExport(dst);
				if (retGood >= 0 && OrbitEcon.goodShortfall(homeColony, retGood) > 0) {
					const guard = OrbitEcon.GUARD_YEARS * dst.pop * OrbitEcon.NEED[retGood];
					const take = Math.min(SHIP_CAPACITY, dst.stock[retGood] - guard);
					if (take > 0) {
						dst.stock[retGood] -= take;
						this.portTrade[target] += take;
						this.shipGood[ship] = retGood;
						this.shipAmount[ship] = take;
					}
				}
			}
			this.depart(ship, home, 1, time);
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
		this.pushLog(this.econY(time), 'expansion', target,
			'colony ship from planet ' + this.portPlanet[port] + ' → planet ' + target);
		this.events.push(time + travel, KIND_BUILD, port);
	};

	Sim.prototype.finishColony = function (port, time) {
		if (port >= this.portCount || this.builderActive[port] !== 1) return;
		if (!this.portInPlay(port)) {
			this.cancelBuilder(port);
			return;
		}
		const target = this.builderTarget[port];
		this.builderActive[port] = 0;
		this.activatePort(target, time);
		this.coloniesBuilt += 1;
		this.refreshPartners();
	};

	/*
	 * Trade only considers planets in the run's enabled set once they are
	 * enabled. Raising the count is a one-way door (a world once opened keeps
	 * trading); `planetMask` is the player's universe filter, the same array the
	 * gravity field and the drawing read, so a 13-planet career run does not
	 * keep trading with the worlds it cannot see.
	 */
	Sim.prototype.setPlanetLimit = function (count) {
		const limit = Math.min(PLANETS, Math.max(this.tradePlanetLimit, count));
		for (let i = this.tradePlanetLimit; i < limit; i++) {
			if (this.planetState[i] === 0) this.planetEmpty++;
		}
		this.tradePlanetLimit = limit;
	};

	/* the run's in-play planet subset; null trades every planet in the limit */
	Sim.prototype.setPlanetMask = function (mask) {
		this.planetMask = mask || null;
		if (this.planetMask) this.retireHidden();
	};

	/* a planet the trade world may still touch: enabled and inside the subset */
	Sim.prototype.planetInPlay = function (planet) {
		if (planet < 0 || planet >= this.tradePlanetLimit) return false;
		return !this.planetMask || this.planetMask[planet] !== 0;
	};

	/* a port whose own planet is still in play */
	Sim.prototype.portInPlay = function (port) {
		if (port < 0 || port >= this.portCount) return false;
		return this.planetInPlay(this.portPlanet[port]);
	};

	/*
	 * Close every colony and ship that sits on a planet outside the run. This is
	 * what keeps the background animation honest: without it a narrower universe
	 * left ports trading on invisible planets, and their traces were drawn from
	 * stations that are not on screen. Nothing is refunded and no citizen moves
	 * — the world simply stops trading there, as if the run never enabled it.
	 */
	Sim.prototype.retireHidden = function () {
		let retired = 0;
		for (let p = this.portCount - 1; p >= 0; p--) {
			if (this.portInPlay(p)) continue;
			this.retirePort(p);
			retired += 1;
		}
		/* A visible sponsor may already have a builder headed to a planet the
		 * new mask removed. Cancel it now; otherwise its delayed BUILD event
		 * recreates a hidden port after this cleanup has finished. */
		for (let p = 0; p < this.portCount; p++) {
			if (this.builderActive[p] && !this.planetInPlay(this.builderTarget[p])) {
				this.cancelBuilder(p);
			}
		}
		if (retired > 0) this.refreshPartners();
		return retired;
	};

	Sim.prototype.retirePort = function (port) {
		if (port < 0 || port >= this.portCount) return;
		const planet = this.portPlanet[port];
		this.pushLog(this.econY(), 'retired', planet,
			'planet ' + planet + ' left the run · trade retired');
		this.dropPort(port);
	};

	/* a builder that is still flying loses its target reservation */
	Sim.prototype.cancelBuilder = function (port) {
		if (this.builderActive[port] !== 1) return;
		const target = this.builderTarget[port];
		if (this.planetState[target] === 2) {
			this.planetState[target] = 0;
			this.reserved -= 1;
			this.planetEmpty += 1;
		}
		this.builderActive[port] = 0;
		/* Do not let this builder's delayed event finish a later expedition that
		 * happens to reuse the same sponsor slot. */
		for (let i = 0; i < this.events.size; i++) {
			if (this.events.kind[i] === KIND_BUILD && this.events.ref[i] === port) {
				this.events.ref[i] = NO_PORT;
			}
		}
	};

	/* park one ship at its own port with an empty hold */
	Sim.prototype.cancelShip = function (port) {
		this.shipState[port] = 0;
		this.shipGood[port] = NO_GOOD;
		this.shipAmount[port] = 0;
		this.shipDock[port] = port;
		this.shipTarget[port] = port;
		this.shipLeg[port] = 0;
	};

	/*
	 * Remove one port and compact the roster: the builder and ship go with it,
	 * any other ship that was docked at or flying to it heads home, the event
	 * heap is rewritten for the vacated index, and the last port's records move
	 * into the hole. Starvation (`removePort`) and a shrinking universe
	 * (`retirePort`) both end here, so there is one removal path to reason about.
	 */
	Sim.prototype.dropPort = function (port) {
		if (port < 0 || port >= this.portCount) return;
		const planet = this.portPlanet[port];
		const last = this.portCount - 1;
		this.cancelBuilder(port);
		this.cancelShip(port);
		/*
		 * A route stores absolute start/aim coordinates. Merely changing its
		 * `shipTarget` after that target disappears leaves the old line and ship
		 * flying toward an invisible planet. Park every affected foreign ship at
		 * home instead, cancel its stale arrival, and give it a fresh load event
		 * after the roster has been compacted.
		 */
		const parked = [];
		for (let s = 0; s <= last; s++) {
			if (s === port) continue;
			if (this.shipDock[s] !== port && this.shipTarget[s] !== port) continue;
			this.cancelShip(s);
			parked.push(s);
		}

		/* Rewrite heap references for `port` (cancel) and `last` (compact).
		 * An affected ship's old ARRIVE must be cancelled before a last→port
		 * rewrite can make it look like the moved ship's current route. */
		const kinds = this.events.kind;
		const refs = this.events.ref;
		for (let i = 0; i < this.events.size; i++) {
			if (kinds[i] === KIND_TICK) continue;
			const ref = refs[i];
			if (ref === port || (kinds[i] === KIND_ARRIVE && parked.indexOf(ref) >= 0)) {
				refs[i] = NO_PORT;
			} else if (ref === last) {
				refs[i] = port;
			}
		}

		if (port !== last) {
			const movedPlanet = this.portPlanet[last];
			this.portPlanet[port] = movedPlanet;
			this.planetPort[movedPlanet] = port;
			this.colonyOn[movedPlanet] = port;
			this.portSpec[port] = this.portSpec[last];
			this.portProgress[port] = this.portProgress[last];
			this.portNext[port] = this.portNext[last];
			this.portTrade[port] = this.portTrade[last];
			this.portMigrants[port] = this.portMigrants[last];

			this.builderActive[port] = this.builderActive[last];
			this.builderTarget[port] = this.builderTarget[last];
			this.builderStartX[port] = this.builderStartX[last];
			this.builderStartY[port] = this.builderStartY[last];
			this.builderEndX[port] = this.builderEndX[last];
			this.builderEndY[port] = this.builderEndY[last];
			this.builderDepart[port] = this.builderDepart[last];
			this.builderArrive[port] = this.builderArrive[last];

			this.shipHome[port] = port;
			this.shipDock[port] = this.shipDock[last] === last ? port : this.shipDock[last];
			this.shipTarget[port] = this.shipTarget[last] === last ? port : this.shipTarget[last];
			this.shipLeg[port] = this.shipLeg[last];
			this.shipState[port] = this.shipState[last];
			this.shipGood[port] = this.shipGood[last];
			this.shipAmount[port] = this.shipAmount[last];
			this.shipDepart[port] = this.shipDepart[last];
			this.shipArrive[port] = this.shipArrive[last];
			this.shipStartX[port] = this.shipStartX[last];
			this.shipStartY[port] = this.shipStartY[last];
			this.shipAimX[port] = this.shipAimX[last];
			this.shipAimY[port] = this.shipAimY[last];
			this.shipSpeed[port] = this.shipSpeed[last];
			this.shipDockAngle[port] = this.shipDockAngle[last];

			this.colonies[port] = this.colonies[last];
			this.colonies[port].idx = port;

			for (let s = 0; s < last; s++) {
				if (this.shipDock[s] === last) this.shipDock[s] = port;
				if (this.shipTarget[s] === last) this.shipTarget[s] = port;
			}
		}

		this.colonies.pop();
		this.portCount = last;
		this.shipCount = last;
		this.planetState[planet] = 0;
		this.planetPort[planet] = NO_PORT;
		this.colonyOn[planet] = NO_PORT;
		this.planetEmpty += 1;
		for (let i = 0; i < parked.length; i++) {
			const ship = parked[i] === last ? port : parked[i];
			if (ship < this.shipCount) {
				this.events.push(this.t + 1 + this.rand() * 1.5, KIND_LOAD, ship);
			}
		}
	};

	/* Habitat-weighted target selection within EXPAND_RADIUS. */
	Sim.prototype.scoreTarget = function (port) {
		const px = this.portX(port, this.t);
		const py = this.portY(port, this.t);
		let best = NO_PORT;
		let bestScore = 0;
		const maxD2 = EXPAND_RADIUS * EXPAND_RADIUS;
		for (let planet = 0; planet < this.tradePlanetLimit; planet++) {
			if (this.planetState[planet] !== 0) continue;
			if (!this.planetInPlay(planet)) continue;
			if (this.planetHabitat[planet] < MIN_EXPAND_HABITAT) continue;
			const dx = this.planetX[planet] - px;
			const dy = this.planetY[planet] - py;
			const d2 = dx * dx + dy * dy;
			if (d2 >= maxD2) continue;
			const dist = Math.sqrt(d2);
			const score = this.planetHabitat[planet] / (1 + dist / 180);
			if (score > bestScore) {
				bestScore = score;
				best = planet;
			}
		}
		return best;
	};

	Sim.prototype.tick = function (time) {
		const toY = time * ECON_YEARS_PER_MIN;
		const years = TICK_MINUTES * ECON_YEARS_PER_MIN;

		/* §4: every colony advances on every tick, so readouts are never stale. */
		const corruption = this.corruption;
		for (let p = 0; p < this.portCount; p++) {
			const colony = this.colonies[p];
			colony.corruption = corruption ? corruption[colony.planet] : 0;
			if (!this.planetInPlay(colony.planet)) continue;
			OrbitEcon.advanceColony(colony, toY, this.onColonyEvent);
		}

		/* §4 step 8: remove any colony that starved at the floor for 20 years. */
		for (let p = this.portCount - 1; p >= 0; p--) {
			if (OrbitEcon.isAbandoned(this.colonies[p])) {
				this.removePort(p, toY);
			}
		}

		this.refreshPartners();

		for (let p = 0; p < this.portCount; p++) {
			const colony = this.colonies[p];
			const K = OrbitEcon.carryingCapacity(colony);
			if (colony.comfort >= MIGRANT_COMFORT && colony.pop < MIGRANT_FILL * K) {
				this.portMigrants[p] = Math.min(
					SHIP_CAPACITY,
					colony.pop * MIGRANT_RATE * years
				);
			} else {
				this.portMigrants[p] = 0;
			}

			const exp = OrbitEcon.bestExport(colony);
			if (exp >= 0) this.portSpec[p] = exp;
			else if (this.portMigrants[p] > 0) this.portSpec[p] = OrbitEcon.MIGRANTS;
			else this.portSpec[p] = naturalSpec(colony);

			/* §4 step 7: only town and city colonies may sponsor an expansion. */
			const growthRing = colony.comfort * Math.max(0, 1 - colony.pop / K);
			if (OrbitEcon.STAGE_SPONSORS[colony.stage] === 1 && !colony.starving) {
				const stepGain = Math.max(0.15, growthRing) * colony.pop * 4;
				this.portProgress[p] = Math.min(EXPAND_COST, this.portProgress[p] + stepGain);
				if (this.builderActive[p] === 0 &&
					this.portProgress[p] >= EXPAND_COST &&
					time >= this.portNext[p]) {
					const target = this.scoreTarget(p);
					if (target !== NO_PORT) {
						this.portProgress[p] = 0;
						this.sendColony(p, target, time);
					}
				}
			} else {
				this.portProgress[p] = Math.min(EXPAND_COST * 0.85, EXPAND_COST * growthRing);
			}
		}

		this.events.push(time + TICK_MINUTES, KIND_TICK, 0);
	};

	Sim.prototype.handleEvent = function (time, kind, ref) {
		this.t = time;
		if (kind === KIND_LOAD) this.load(ref, time);
		else if (kind === KIND_ARRIVE) this.arrive(ref, time);
		else if (kind === KIND_TICK) this.tick(time);
		else if (kind === KIND_BUILD) this.finishColony(ref, time);
	};

	Sim.prototype.step = function (minutes) {
		this.advanceTo(this.t + minutes);
	};

	/* Lands on `target` exactly, so an external clock can drive the world in any chunking. */
	Sim.prototype.advanceTo = function (target) {
		if (!(target > this.t)) return;
		this.events.drainUntil(target, this.handleEvent);
		this.t = target;
	};

	Sim.TYPE_NAMES = OrbitWorld.TYPE_NAMES;
	Sim.PORTS = PORTS;
	Sim.PLANETS = PLANETS;
	Sim.INITIAL_PORTS = INITIAL_PORTS;
	Sim.GOOD_NAMES = GOOD_NAMES;
	Sim.WORLD_W = WORLD_W;
	Sim.WORLD_H = WORLD_H;
	Sim.AREA_W = AREA_W;
	Sim.AREA_H = AREA_H;
	Sim.AREA_PAD_X = AREA_PAD_X;
	Sim.AREA_PAD_Y = AREA_PAD_Y;
	Sim.SHIP_CAPACITY = SHIP_CAPACITY;
	Sim.EXPAND_RADIUS = EXPAND_RADIUS;
	Sim.EXPAND_COST = EXPAND_COST;
	Sim.TICK_MINUTES = TICK_MINUTES;
	Sim.ECON_YEARS_PER_MIN = ECON_YEARS_PER_MIN;
	Sim.DIST_SCALE = DIST_SCALE;
	Sim.MAX_LINKS = MAX_LINKS;
	Sim.NO_PORT = NO_PORT;
	Sim.NO_GOOD = NO_GOOD;

	if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
	else root.OrbitSim = Sim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
