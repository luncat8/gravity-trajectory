/*
 * Ballistic cargo under the gravity of planets or moving trade ports.
 *
 * Launches and landings always use static planet cores so the launch base stays
 * steady in every gravity mode. Prediction and live flight share advance(),
 * impact() and markSystemsAt() on one fixed step, so predicted paths, landings
 * and planet-system visits match live flight. While flying, predictFlight()
 * continues the path ahead of the cargo until it lands (bounded by frame budget).
 *
 * Launch gate: with `pads` attached (career), a planet can only be launched from
 * when its pad has a catapult, and a shot only fires while the pad battery and
 * rail force cover the ship mass at that speed (OrbitTech launch model).
 */
(function (root) {
	'use strict';

	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;

	const DT = 1 / 120;
	const MU = 400000;
	const SOFT = 60;
	const SOFT2 = SOFT * SOFT;
	const CARGO_R = 3.5;
	const SPAWN_GAP = 8;
	const SPEED_MIN = 30;
	const SPEED_MAX = 320;
	const GRIP_MAX = 240;
	const STRENGTH_MIN = -2;
	const STRENGTH_MAX = 2;
	const HORIZON = 60;
	const FLY_HORIZON = 240;
	const MAX_STEPS = 7350;
	const PATH_MAX = 28900;
	const TRAIL_MAX = 8192;
	const TRAIL_STRIDE = 2;
	const BUDGET_MS = 10;
	const BUDGET_EVERY = 64;
	const BOUND_MARGIN = 12;
	const MAX_BODIES = 32;
	const FIELD_STRIDE = 4;
	const VEL_EPS = 0.05;
	const NO_BODY = -1;
	const STRIDE_FAST = 1;
	const STRIDE_MID = 2;

	const STATUS_IDLE = 0;
	const STATUS_FLYING = 1;
	const STATUS_ENDED = 2;

	const END_OPEN = 0;
	const END_IMPACT = 1;
	const END_EXIT = 2;
	const END_TIME = 3;
	const END_TRUNCATED = 4;
	const END_ABORT = 5;
	const FULL_BUDGET_MS = 1e9;
	const PRED_LOG_MAX = 64;

	function GravitySim(worldW, worldH) {
		this.worldW = worldW;
		this.worldH = worldH;

		this.planetCount = 0;
		this.planetX = null;
		this.planetY = null;
		this.planetR = null;
		this.sysCos = new Float64Array(MAX_BODIES);
		this.sysSin = new Float64Array(MAX_BODIES);
		this.sysInvRX = new Float64Array(MAX_BODIES);
		this.sysInvRY = new Float64Array(MAX_BODIES);
		this.sysBoundR2 = new Float64Array(MAX_BODIES);

		this.bodyCount = 0;
		this.bodyR = null;
		this.strength = null;
		this.fillField = null;
		this.fieldStatic = true;
		this.fieldT = 0;
		this.fieldRate = 0;
		this.stepStale = true;
		this.bodyX = new Float64Array(MAX_BODIES);
		this.bodyY = new Float64Array(MAX_BODIES);
		this.stepX = new Float64Array(MAX_BODIES);
		this.stepY = new Float64Array(MAX_BODIES);
		this.savedStepX = new Float64Array(MAX_BODIES);
		this.savedStepY = new Float64Array(MAX_BODIES);
		this.velX = new Float64Array(MAX_BODIES);
		this.velY = new Float64Array(MAX_BODIES);
		this.predBodyX = new Float64Array(MAX_BODIES);
		this.predBodyY = new Float64Array(MAX_BODIES);
		this.predBodyCount = 0;
		this.predFieldT = 0;
		this.predRate = 0;

		this.horizon = HORIZON;

		this.cargo = { x: 0, y: 0, vx: 0, vy: 0 };
		this.probe = { x: 0, y: 0, vx: 0, vy: 0 };
		this.status = STATUS_IDLE;
		this.origin = NO_BODY;
		this.angle = 0;
		this.speed = 0;
		this.flightTime = 0;
		this.flightLength = 0;
		this.flightFieldT = 0;
		this.liveSteps = 0;
		/* a flight reaching stepLimit steps ends with limitReason (game cap, replayed abort) */
		this.stepLimit = Infinity;
		this.limitReason = END_TIME;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endBody = NO_BODY;
		this.landedBody = NO_BODY;
		/* career network view: pads[planet] = { catapult, panel, battery, chargeKwh },
		 * ship = { mass } — null means every planet is a free launch base */
		this.pads = null;
		this.ship = null;

		this.visited = new Uint8Array(MAX_BODIES);
		this.visitedCount = 0;
		this.visitStep = 0;
		this.predVisit = new Uint8Array(MAX_BODIES);
		this.predInside = new Uint8Array(MAX_BODIES);
		this.predEntered = new Int32Array(MAX_BODIES);
		this.predLogPlanet = new Int32Array(PRED_LOG_MAX);
		this.predLogStep = new Int32Array(PRED_LOG_MAX);
		this.predLogCount = 0;
		this.predVisits = 0;
		this.predNewVisits = 0;

		this.trailX = new Float32Array(TRAIL_MAX);
		this.trailY = new Float32Array(TRAIL_MAX);
		this.trailCount = 0;
		this.trailStride = TRAIL_STRIDE;

		this.predX = new Float32Array(PATH_MAX);
		this.predY = new Float32Array(PATH_MAX);
		this.predCount = 0;
		this.predTime = 0;
		this.predLength = 0;
		this.predReason = END_OPEN;
		this.predBody = NO_BODY;
		this.predSteps = 0;
		this.predMs = 0;

		/* resumable trace job: a long horizon is computed in per-frame slices */
		this.routeActive = false;
		this.routeStorePath = true;
		this.routeStartStep = 0;
		this.routeHorizon = HORIZON;
		this.routeMaxSteps = 0;
		this.routeStride = 1;
		this.routeTime = 0;
		this.routeLength = 0;
		this.routeSteps = 0;
		this.routeT0 = 0;
		this.routeFieldT = 0;
		this.routeReason = END_OPEN;
		this.routeHit = NO_BODY;
		this.routeCount = 0;
		this.routeMs = 0;
		this.routeSliceMs = 0;
	}

	/* static planet bases + port-orbit ellipses defining each planet system */
	GravitySim.prototype.setPlanets = function (
		count, px, py, pr, orbitRX, orbitRY, tiltCos, tiltSin
	) {
		this.planetCount = count;
		this.planetX = px;
		this.planetY = py;
		this.planetR = pr;
		for (let i = 0; i < count; i++) {
			const rx = orbitRX[i];
			const ry = orbitRY[i];
			const major = rx >= ry ? rx : ry;
			this.sysCos[i] = tiltCos[i];
			this.sysSin[i] = tiltSin[i];
			this.sysInvRX[i] = 1 / rx;
			this.sysInvRY[i] = 1 / ry;
			this.sysBoundR2[i] = major * major;
		}
	};

	/* fillField(t, outX, outY, count) writes gravity body positions at field time t */
	GravitySim.prototype.setField = function (count, bodyR, strength, fillField, fieldStatic) {
		this.bodyCount = count;
		this.bodyR = bodyR;
		this.strength = strength;
		this.fillField = fillField;
		this.fieldStatic = fieldStatic;
		this.stepStale = true;
		this.refreshField();
	};

	GravitySim.prototype.setCount = function (count) {
		if (count === this.bodyCount) return false;
		this.bodyCount = count;
		this.stepStale = true;
		this.refreshField();
		return true;
	};

	GravitySim.prototype.refreshField = function () {
		if (this.fillField) this.fillField(this.fieldT, this.bodyX, this.bodyY, this.bodyCount);
	};

	GravitySim.prototype.fillStep = function (t) {
		this.fillField(t, this.stepX, this.stepY, this.bodyCount);
	};

	GravitySim.prototype.fieldStride = function () {
		const r = this.fieldRate < 0 ? -this.fieldRate : this.fieldRate;
		if (r > 6) return STRIDE_FAST;
		if (r > 2) return STRIDE_MID;
		return FIELD_STRIDE;
	};

	/* how far the gravity centres moved since the last prediction snapshot, in px */
	GravitySim.prototype.fieldDrift = function () {
		if (this.predCount < 2) return 0;
		if (this.predBodyCount !== this.bodyCount) return Infinity;
		let worst = 0;
		for (let i = 0; i < this.bodyCount; i++) {
			const dx = this.bodyX[i] - this.predBodyX[i];
			const dy = this.bodyY[i] - this.predBodyY[i];
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d > worst) worst = d;
		}
		return worst;
	};

	/* with a launch network the vessel fires only from the pad it sits on */
	GravitySim.prototype.canLaunchFrom = function (planet) {
		const limit = this.planetCount > 0 ? this.planetCount : this.bodyCount;
		if (planet < 0 || planet >= limit) return false;
		if (this.landedBody >= 0 && planet !== this.landedBody) return false;
		if (this.pads === null) return true;
		return this.landedBody === planet && this.pads[planet].catapult !== null;
	};

	GravitySim.prototype.setLaunchNetwork = function (pads, ship) {
		this.pads = pads;
		this.ship = ship;
	};

	/* kWh the pad battery spends on a launch at `speed`; 0 without a network */
	GravitySim.prototype.launchEnergy = function (planet, speed) {
		if (this.pads === null) return 0;
		return OrbitTech.launchEnergy(this.ship.mass, this.pads[planet].catapult, speed);
	};

	/* fastest shot the pad affords now (energy and rail force); SPEED_MAX without a network */
	GravitySim.prototype.speedLimit = function (planet) {
		if (this.pads === null) return SPEED_MAX;
		const pad = this.pads[planet];
		return OrbitTech.speedLimit(pad.chargeKwh, this.ship.mass, pad.catapult);
	};

	GravitySim.prototype.canFire = function (planet, speed) {
		if (!this.canLaunchFrom(planet)) return false;
		if (this.pads === null) return true;
		const pad = this.pads[planet];
		return OrbitTech.canLaunch(pad.chargeKwh, this.ship.mass, pad.catapult, speed);
	};

	/* puts the idle vessel on `planet` (career start, evacuation); visits are kept */
	GravitySim.prototype.relocate = function (planet) {
		this.status = STATUS_IDLE;
		this.origin = NO_BODY;
		this.endReason = END_OPEN;
		this.endBody = NO_BODY;
		this.landedBody = planet;
		this.trailCount = 0;
		this.trailStride = TRAIL_STRIDE;
		this.predCount = 0;
		this.routeActive = false;
	};

	GravitySim.prototype.markSystemsAt = function (x, y, mask) {
		const count = this.planetCount;
		if (count === 0) return 0;
		const px = this.planetX;
		const py = this.planetY;
		const bound = this.sysBoundR2;
		const cos = this.sysCos;
		const sin = this.sysSin;
		const invRX = this.sysInvRX;
		const invRY = this.sysInvRY;
		let added = 0;
		for (let i = 0; i < count; i++) {
			if (mask[i]) continue;
			const dx = x - px[i];
			const dy = y - py[i];
			if (dx * dx + dy * dy > bound[i]) continue;
			const u = (dx * cos[i] + dy * sin[i]) * invRX[i];
			const v = (-dx * sin[i] + dy * cos[i]) * invRY[i];
			if (u * u + v * v <= 1) {
				mask[i] = 1;
				added += 1;
			}
		}
		return added;
	};

	/*
	 * Updates `prevInside` in place for (x, y) and writes newly entered planet
	 * indices into `enteredOut`, returning the number of entries on this step.
	 */
	GravitySim.prototype.stepInsideAt = function (x, y, prevInside, enteredOut) {
		const count = this.planetCount;
		if (count === 0) return 0;
		const px = this.planetX;
		const py = this.planetY;
		const bound = this.sysBoundR2;
		const cos = this.sysCos;
		const sin = this.sysSin;
		const invRX = this.sysInvRX;
		const invRY = this.sysInvRY;
		let entered = 0;
		for (let i = 0; i < count; i++) {
			const dx = x - px[i];
			const dy = y - py[i];
			if (dx * dx + dy * dy > bound[i]) {
				prevInside[i] = 0;
				continue;
			}
			const u = (dx * cos[i] + dy * sin[i]) * invRX[i];
			const v = (-dx * sin[i] + dy * cos[i]) * invRY[i];
			const inside = u * u + v * v <= 1 ? 1 : 0;
			if (inside && !prevInside[i]) {
				enteredOut[entered] = i;
				entered += 1;
			}
			prevInside[i] = inside;
		}
		return entered;
	};

	GravitySim.prototype.setStrength = function (body, value) {
		const clamped = value < STRENGTH_MIN ? STRENGTH_MIN
			: value > STRENGTH_MAX ? STRENGTH_MAX : value;
		if (clamped === this.strength[body]) return false;
		this.strength[body] = clamped;
		return true;
	};

	GravitySim.prototype.resetField = function () {
		this.strength.fill(1);
	};

	GravitySim.prototype.speedAt = function (length) {
		let t = length / GRIP_MAX;
		if (t < 0) t = 0;
		else if (t > 1) t = 1;
		return SPEED_MIN + t * (SPEED_MAX - SPEED_MIN);
	};

	GravitySim.prototype.gripLength = function (speed) {
		let t = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
		if (t < 0) t = 0;
		else if (t > 1) t = 1;
		return t * GRIP_MAX;
	};

	GravitySim.prototype.advance = function (state, dt) {
		const px = this.stepX;
		const py = this.stepY;
		const strength = this.strength;
		const count = this.bodyCount;
		let ax = 0;
		let ay = 0;
		for (let i = 0; i < count; i++) {
			const s = strength[i];
			if (s === 0) continue;
			const dx = px[i] - state.x;
			const dy = py[i] - state.y;
			const inv = 1 / (dx * dx + dy * dy + SOFT2);
			const a = MU * s * inv * Math.sqrt(inv);
			ax += dx * a;
			ay += dy * a;
		}
		state.vx += ax * dt;
		state.vy += ay * dt;
		state.x += state.vx * dt;
		state.y += state.vy * dt;
	};

	GravitySim.prototype.impact = function (x, y) {
		const usePlanets = this.planetCount > 0;
		const px = usePlanets ? this.planetX : this.stepX;
		const py = usePlanets ? this.planetY : this.stepY;
		const pr = usePlanets ? this.planetR : this.bodyR;
		const count = usePlanets ? this.planetCount : this.bodyCount;
		for (let i = 0; i < count; i++) {
			const dx = px[i] - x;
			const dy = py[i] - y;
			const reach = pr[i] + CARGO_R;
			if (dx * dx + dy * dy <= reach * reach) return i;
		}
		return NO_BODY;
	};

	GravitySim.prototype.outside = function (x, y) {
		return x < -BOUND_MARGIN || x > this.worldW + BOUND_MARGIN ||
			y < -BOUND_MARGIN || y > this.worldH + BOUND_MARGIN;
	};

	/*
	 * Spawn state at field time t0: always launches from the static planet core
	 * when planets are configured (stable base in both planet and moving-port modes).
	 */
	GravitySim.prototype.spawn = function (state, origin, angle, speed, t0) {
		this.fillStep(t0);
		this.stepStale = false;
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
		if (this.planetCount > 0) {
			const gap = this.planetR[origin] + SPAWN_GAP;
			state.x = this.planetX[origin] + ca * gap;
			state.y = this.planetY[origin] + sa * gap;
			state.vx = ca * speed;
			state.vy = sa * speed;
			return;
		}
		const gap = this.bodyR[origin] + SPAWN_GAP;
		state.x = this.stepX[origin] + ca * gap;
		state.y = this.stepY[origin] + sa * gap;
		state.vx = ca * speed;
		state.vy = sa * speed;
		if (this.fieldStatic || this.fieldRate === 0) return;
		this.fillField(t0 + VEL_EPS, this.velX, this.velY, this.bodyCount);
		const plusX = this.velX[origin];
		const plusY = this.velY[origin];
		this.fillField(t0 - VEL_EPS, this.velX, this.velY, this.bodyCount);
		const k = this.fieldRate / (2 * VEL_EPS);
		state.vx += (plusX - this.velX[origin]) * k;
		state.vy += (plusY - this.velY[origin]) * k;
	};

	GravitySim.prototype.snapshotField = function (t0) {
		this.fillField(t0, this.predBodyX, this.predBodyY, this.bodyCount);
		this.predBodyCount = this.bodyCount;
		this.predFieldT = t0;
		this.predRate = this.fieldRate;
	};

	/*
	 * Store one traced point. Full resolution until the buffer is full, then the
	 * path is compacted 2:1 in place and the stride doubles, exactly like the
	 * trail: real shots (measured: under 160 s here) keep every step, while an
	 * edited-gravity marathon still cannot overflow the buffer.
	 */
	GravitySim.prototype.routePoint = function (x, y) {
		if (this.routeCount >= PATH_MAX) {
			const half = PATH_MAX >> 1;
			for (let i = 0; i < half; i++) {
				this.predX[i] = this.predX[i * 2];
				this.predY[i] = this.predY[i * 2];
			}
			this.routeCount = half;
			this.routeStride *= 2;
		}
		this.predX[this.routeCount] = x;
		this.predY[this.routeCount] = y;
		this.routeCount += 1;
	};

	/*
	 * Start a trace job at `state`. The job is resumable: routeStep() advances a
	 * slice and returns true once the flight has ended (impact, exit, horizon or
	 * wall), so a 1 800 s preview costs a few ms per frame instead of one stall.
	 * Every slice commits into the pred* readouts, so a paused job already shows
	 * its visits, length and time.
	 */
	GravitySim.prototype.routeBeginAt = function (state, t0, startStep, horizonSec, maxSteps) {
		const visit = this.predVisit;
		visit.fill(0);
		this.markSystemsAt(state.x, state.y, visit);
		this.predInside.set(visit);
		this.predLogCount = 0;
		this.routeStorePath = true;
		this.predX[0] = state.x;
		this.predY[0] = state.y;
		this.routeStartStep = startStep;
		this.routeT0 = t0;
		this.routeHorizon = horizonSec;
		this.routeMaxSteps = maxSteps;
		this.routeStride = 1;
		this.routeCount = 1;
		this.routeTime = 0;
		this.routeLength = 0;
		this.routeSteps = 0;
		this.routeFieldT = t0;
		this.routeReason = END_OPEN;
		this.routeHit = NO_BODY;
		this.routeMs = 0;
		this.routeSliceMs = 0;
		this.routeActive = true;

		this.predCount = 1;
		this.predTime = 0;
		this.predLength = 0;
		this.predSteps = 0;
		this.predReason = END_OPEN;
		this.predBody = NO_BODY;
		this.predVisits = 0;
		this.predNewVisits = 0;
	};

	/* aim at a static base: the job a preview keeps between frames */
	GravitySim.prototype.routeBegin = function (origin, angle, speed, horizonSec) {
		const t0 = this.fieldT;
		this.spawn(this.probe, origin, angle, speed, t0);
		this.snapshotField(t0);
		this.routeBeginAt(this.probe, t0, 0, horizonSec, Math.ceil(horizonSec / DT) + 2);
	};

	GravitySim.prototype.routeStep = function (budgetMs) {
		if (!this.routeActive) return true;
		const state = this.probe;
		const visit = this.predVisit;
		const inside = this.predInside;
		const enteredBuf = this.predEntered;
		const storePath = this.routeStorePath;
		const maxSteps = this.routeMaxSteps;
		const moving = !this.fieldStatic && this.fieldRate !== 0;
		const fieldStride = moving ? this.fieldStride() : FIELD_STRIDE;
		const capMs = budgetMs > 0 ? budgetMs : BUDGET_MS;
		const started = performance.now();
		let reason = END_OPEN;
		let hit = NO_BODY;

		while (this.routeSteps < maxSteps) {
			const step = this.routeSteps;
			if ((step & (BUDGET_EVERY - 1)) === 0 && performance.now() - started > capMs) break;
			if (moving && step > 0 && (this.routeStartStep + step) % fieldStride === 0) {
				this.fillStep(this.routeFieldT);
			}
			const prevX = state.x;
			const prevY = state.y;
			this.advance(state, DT);
			const dx = state.x - prevX;
			const dy = state.y - prevY;
			this.routeLength += Math.sqrt(dx * dx + dy * dy);
			this.routeTime += DT;
			this.routeFieldT += DT * this.fieldRate;
			this.routeSteps = step + 1;
			const entered = this.stepInsideAt(state.x, state.y, inside, enteredBuf);
			for (let e = 0; e < entered; e++) {
				const p = enteredBuf[e];
				visit[p] = 1;
				if (this.predLogCount < PRED_LOG_MAX) {
					this.predLogPlanet[this.predLogCount] = p;
					this.predLogStep[this.predLogCount] = this.routeSteps;
					this.predLogCount += 1;
				}
			}
			hit = this.impact(state.x, state.y);
			if (hit >= 0) {
				reason = END_IMPACT;
				if (this.planetCount > 0 && !inside[hit]) {
					inside[hit] = 1;
					visit[hit] = 1;
					if (this.predLogCount < PRED_LOG_MAX) {
						this.predLogPlanet[this.predLogCount] = hit;
						this.predLogStep[this.predLogCount] = this.routeSteps;
						this.predLogCount += 1;
					}
				}
			} else if (this.outside(state.x, state.y)) reason = END_EXIT;
			else if (this.routeTime >= this.routeHorizon - 1e-9) reason = END_TIME;
			/* the end point is always stored, so a sampled path still lands on the truth */
			if (storePath && (reason !== END_OPEN || this.routeSteps % this.routeStride === 0)) {
				this.routePoint(state.x, state.y);
			}
			if (reason !== END_OPEN) break;
		}

		let totalVisits = 0;
		let newVisits = 0;
		for (let i = 0; i < this.planetCount; i++) {
			if (!visit[i]) continue;
			totalVisits += 1;
			if (!this.visited[i]) newVisits += 1;
		}
		this.routeReason = reason;
		this.routeHit = hit;
		this.predVisits = totalVisits;
		this.predNewVisits = newVisits;
		this.predCount = this.routeCount;
		this.predTime = this.routeTime;
		this.predLength = this.routeLength;
		this.predReason = reason;
		this.predBody = hit;
		this.predSteps = this.routeSteps;
		this.routeSliceMs = performance.now() - started;
		this.routeMs += this.routeSliceMs;
		this.predMs = this.routeMs;
		this.routeActive = reason === END_OPEN;
		return !this.routeActive;
	};

	/* runs the job to its end under one budget across all slices */
	GravitySim.prototype.routeDrain = function (budgetMs) {
		let left = budgetMs > 0 ? budgetMs : BUDGET_MS;
		while (!this.routeStep(left)) {
			left -= this.routeSliceMs;
			if (left <= 0) {
				this.routeActive = false;
				this.routeReason = END_TRUNCATED;
				this.predReason = END_TRUNCATED;
				return false;
			}
		}
		return true;
	};

	GravitySim.prototype.routeProgress = function () {
		return this.routeMaxSteps > 0 ? this.routeSteps / this.routeMaxSteps : 1;
	};

	GravitySim.prototype.predict = function (origin, angle, speed, budgetMs) {
		const t0 = this.fieldT;
		this.spawn(this.probe, origin, angle, speed, t0);
		this.snapshotField(t0);
		const maxSteps = Math.min(MAX_STEPS, Math.ceil(this.horizon / DT) + 2);
		this.routeBeginAt(this.probe, t0, 0, this.horizon, maxSteps);
		this.routeDrain(budgetMs);
	};

	/* the whole horizon whatever it costs: launching, the benches, a replay */
	GravitySim.prototype.predictFull = function (origin, angle, speed, horizonSec) {
		const t0 = this.fieldT;
		this.spawn(this.probe, origin, angle, speed, t0);
		this.snapshotField(t0);
		this.routeBeginAt(this.probe, t0, 0, horizonSec, Math.ceil(horizonSec / DT) + 2);
		this.routeDrain(FULL_BUDGET_MS);
	};

	/* headless candidate evaluation (no path buffer writes) for bot search */
	GravitySim.prototype.predictFast = function (origin, angle, speed, horizonSec) {
		const t0 = this.fieldT;
		this.spawn(this.probe, origin, angle, speed, t0);
		this.routeBeginAt(this.probe, t0, 0, horizonSec, Math.ceil(horizonSec / DT) + 2);
		this.routeStorePath = false;
		this.routeDrain(FULL_BUDGET_MS);
		this.routeStorePath = true;
	};

	/* continues trajectory forward from the live flying cargo until it lands */
	GravitySim.prototype.predictFlight = function (budgetMs) {
		if (this.status !== STATUS_FLYING) return;
		this.savedStepX.set(this.stepX);
		this.savedStepY.set(this.stepY);
		this.probe.x = this.cargo.x;
		this.probe.y = this.cargo.y;
		this.probe.vx = this.cargo.vx;
		this.probe.vy = this.cargo.vy;
		const t0 = this.flightFieldT;
		this.snapshotField(t0);
		const moving = !this.fieldStatic && this.fieldRate !== 0;
		const stride = moving ? this.fieldStride() : FIELD_STRIDE;
		if (this.stepStale || (moving && this.liveSteps % stride === 0)) {
			this.fillStep(t0);
		}
		const maxSteps = Math.min(PATH_MAX - 1, Math.ceil(FLY_HORIZON / DT) + 2);
		this.routeBeginAt(this.probe, t0, this.liveSteps, FLY_HORIZON, maxSteps);
		this.routeDrain(budgetMs);
		this.stepX.set(this.savedStepX);
		this.stepY.set(this.savedStepY);
	};

	GravitySim.prototype.launch = function (origin, angle, speed) {
		const t0 = this.fieldT;
		this.spawn(this.cargo, origin, angle, speed, t0);
		this.status = STATUS_FLYING;
		this.origin = origin;
		this.angle = angle;
		this.speed = speed;
		this.flightTime = 0;
		this.flightLength = 0;
		this.flightFieldT = t0;
		this.liveSteps = 0;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endBody = NO_BODY;
		this.trailCount = 0;
		this.trailStride = TRAIL_STRIDE;
		this.addVisits(this.markSystemsAt(this.cargo.x, this.cargo.y, this.visited));
		this.recordTrail();
	};

	GravitySim.prototype.addVisits = function (added) {
		if (added === 0) return;
		this.visitedCount += added;
		this.visitStep = this.liveSteps;
	};

	GravitySim.prototype.recordTrail = function () {
		const cargo = this.cargo;
		if (this.trailCount >= TRAIL_MAX) {
			/* compact 2:1 in place so long flights never lose their tail or allocate */
			const half = TRAIL_MAX >> 1;
			for (let i = 0; i < half; i++) {
				this.trailX[i] = this.trailX[i * 2];
				this.trailY[i] = this.trailY[i * 2];
			}
			this.trailCount = half;
			this.trailStride *= 2;
		}
		const slot = this.trailCount;
		this.trailX[slot] = cargo.x;
		this.trailY[slot] = cargo.y;
		this.trailCount = slot + 1;
	};

	GravitySim.prototype.finish = function (reason, body) {
		this.endReason = reason;
		this.endBody = body;
		if (reason === END_IMPACT && body >= 0) {
			if (this.planetCount > 0 && !this.visited[body]) {
				this.visited[body] = 1;
				this.addVisits(1);
			}
			this.landedBody = body;
		}
		this.status = STATUS_ENDED;
		this.acc = 0;
		this.recordTrail();
	};

	/* one fixed DT physics step; shared by real-time step(dt) and exact-step game races */
	GravitySim.prototype.stepOne = function () {
		if (this.status !== STATUS_FLYING) return;
		/* checked before stepping: an abort recorded at step N replays as N steps */
		if (this.liveSteps >= this.stepLimit) {
			this.finish(this.limitReason, NO_BODY);
			return;
		}
		const cargo = this.cargo;
		const moving = !this.fieldStatic && this.fieldRate !== 0;
		const stride = moving ? this.fieldStride() : FIELD_STRIDE;
		if (this.stepStale || (moving && this.liveSteps % stride === 0)) {
			this.fillStep(this.flightFieldT);
			this.stepStale = false;
		}
		const prevX = cargo.x;
		const prevY = cargo.y;
		this.advance(cargo, DT);
		const dx = cargo.x - prevX;
		const dy = cargo.y - prevY;
		this.flightLength += Math.sqrt(dx * dx + dy * dy);
		this.flightFieldT += DT * this.fieldRate;
		this.liveSteps += 1;
		this.flightTime = this.liveSteps * DT;
		this.addVisits(this.markSystemsAt(cargo.x, cargo.y, this.visited));
		const body = this.impact(cargo.x, cargo.y);
		if (body >= 0) {
			this.finish(END_IMPACT, body);
			return;
		}
		if (this.outside(cargo.x, cargo.y)) {
			this.finish(END_EXIT, NO_BODY);
			return;
		}
		if (this.liveSteps >= this.stepLimit) {
			this.finish(this.limitReason, NO_BODY);
			return;
		}
		if (this.liveSteps % this.trailStride === 0) this.recordTrail();
	};

	GravitySim.prototype.step = function (dt) {
		if (this.status !== STATUS_FLYING || !(dt > 0)) return;
		this.acc += dt;
		if (this.acc > 0.25) this.acc = 0.25;
		let guard = 0;
		while (this.acc >= DT && this.status === STATUS_FLYING && guard < 24) {
			this.stepOne();
			this.acc -= DT;
			guard += 1;
		}
		if (this.acc >= DT) this.acc = 0;
	};

	GravitySim.prototype.abort = function () {
		if (this.status === STATUS_FLYING) this.finish(END_ABORT, NO_BODY);
	};

	GravitySim.prototype.clear = function () {
		this.status = STATUS_IDLE;
		this.origin = NO_BODY;
		this.flightTime = 0;
		this.flightLength = 0;
		this.liveSteps = 0;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endBody = NO_BODY;
		this.landedBody = NO_BODY;
		this.visited.fill(0);
		this.visitedCount = 0;
		this.visitStep = 0;
		this.predVisit.fill(0);
		this.predInside.fill(0);
		this.predLogCount = 0;
		this.predVisits = 0;
		this.predNewVisits = 0;
		this.trailCount = 0;
		this.trailStride = TRAIL_STRIDE;
		this.predCount = 0;
		this.predTime = 0;
		this.predLength = 0;
		this.predSteps = 0;
		this.predMs = 0;
		this.predReason = END_OPEN;
		this.predBody = NO_BODY;
		this.predBodyCount = 0;
		this.routeActive = false;
	};

	GravitySim.DT = DT;
	GravitySim.MU = MU;
	GravitySim.CARGO_R = CARGO_R;
	GravitySim.SPEED_MIN = SPEED_MIN;
	GravitySim.SPEED_MAX = SPEED_MAX;
	GravitySim.GRIP_MAX = GRIP_MAX;
	GravitySim.STRENGTH_MIN = STRENGTH_MIN;
	GravitySim.STRENGTH_MAX = STRENGTH_MAX;
	GravitySim.HORIZON = HORIZON;
	GravitySim.FLY_HORIZON = FLY_HORIZON;
	GravitySim.BUDGET_MS = BUDGET_MS;
	GravitySim.PATH_MAX = PATH_MAX;
	GravitySim.MAX_BODIES = MAX_BODIES;
	GravitySim.FIELD_STRIDE = FIELD_STRIDE;
	GravitySim.NO_BODY = NO_BODY;
	GravitySim.STATUS_IDLE = STATUS_IDLE;
	GravitySim.STATUS_FLYING = STATUS_FLYING;
	GravitySim.STATUS_ENDED = STATUS_ENDED;
	GravitySim.END_OPEN = END_OPEN;
	GravitySim.END_IMPACT = END_IMPACT;
	GravitySim.END_EXIT = END_EXIT;
	GravitySim.END_TIME = END_TIME;
	GravitySim.END_TRUNCATED = END_TRUNCATED;
	GravitySim.END_ABORT = END_ABORT;

	if (typeof module !== 'undefined' && module.exports) module.exports = GravitySim;
	else root.GravitySim = GravitySim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
