/*
 * Ballistic cargo under the gravity of every background planet.
 *
 * Prediction and live flight share advance() and one fixed step, so the drawn
 * path is the path the container follows. The field is a softened inverse-square
 * sum; per-planet strength is signed, negative values repel.
 */
(function (root) {
	'use strict';

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
	const LIVE_LIMIT = 240;
	const MAX_STEPS = 7350;
	const PATH_MAX = 7500;
	const TRAIL_MAX = 4096;
	const TRAIL_STRIDE = 2;
	const BUDGET_MS = 10;
	const BUDGET_EVERY = 64;
	const BOUND_MARGIN = 12;
	const NO_PLANET = -1;

	const STATUS_IDLE = 0;
	const STATUS_FLYING = 1;
	const STATUS_ENDED = 2;

	const END_OPEN = 0;
	const END_IMPACT = 1;
	const END_EXIT = 2;
	const END_TIME = 3;
	const END_TRUNCATED = 4;

	function GravitySim(planetX, planetY, planetR, count, worldW, worldH) {
		this.planetX = planetX;
		this.planetY = planetY;
		this.planetR = planetR;
		this.planetCount = count;
		this.worldW = worldW;
		this.worldH = worldH;
		this.strength = new Float64Array(count);
		this.strength.fill(1);

		this.horizon = HORIZON;

		this.cargo = { x: 0, y: 0, vx: 0, vy: 0 };
		this.probe = { x: 0, y: 0, vx: 0, vy: 0 };
		this.status = STATUS_IDLE;
		this.origin = NO_PLANET;
		this.angle = 0;
		this.speed = 0;
		this.flightTime = 0;
		this.liveSteps = 0;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endPlanet = NO_PLANET;

		this.trailX = new Float32Array(TRAIL_MAX);
		this.trailY = new Float32Array(TRAIL_MAX);
		this.trailCount = 0;

		this.predX = new Float32Array(PATH_MAX);
		this.predY = new Float32Array(PATH_MAX);
		this.predCount = 0;
		this.predTime = 0;
		this.predReason = END_OPEN;
		this.predPlanet = NO_PLANET;
		this.predSteps = 0;
		this.predMs = 0;
	}

	GravitySim.prototype.setStrength = function (planet, value) {
		const clamped = value < STRENGTH_MIN ? STRENGTH_MIN
			: value > STRENGTH_MAX ? STRENGTH_MAX : value;
		if (clamped === this.strength[planet]) return false;
		this.strength[planet] = clamped;
		return true;
	};

	GravitySim.prototype.resetField = function () {
		this.strength.fill(1);
	};

	/* px/s for a grip of `length` px from the planet centre */
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
		const px = this.planetX;
		const py = this.planetY;
		const strength = this.strength;
		const count = this.planetCount;
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
		const px = this.planetX;
		const py = this.planetY;
		const pr = this.planetR;
		for (let i = 0; i < this.planetCount; i++) {
			const dx = px[i] - x;
			const dy = py[i] - y;
			const reach = pr[i] + CARGO_R;
			if (dx * dx + dy * dy <= reach * reach) return i;
		}
		return NO_PLANET;
	};

	GravitySim.prototype.outside = function (x, y) {
		return x < -BOUND_MARGIN || x > this.worldW + BOUND_MARGIN ||
			y < -BOUND_MARGIN || y > this.worldH + BOUND_MARGIN;
	};

	/*
	 * Same integrator from the same spawn state. Stops on impact, on leaving
	 * the field, at the horizon, or when the wall-clock budget is spent.
	 */
	GravitySim.prototype.predict = function (origin, angle, speed) {
		const state = this.probe;
		const spawn = this.planetR[origin] + SPAWN_GAP;
		state.x = this.planetX[origin] + Math.cos(angle) * spawn;
		state.y = this.planetY[origin] + Math.sin(angle) * spawn;
		state.vx = Math.cos(angle) * speed;
		state.vy = Math.sin(angle) * speed;

		const pathX = this.predX;
		const pathY = this.predY;
		let count = 0;
		pathX[count] = state.x;
		pathY[count] = state.y;
		count += 1;

		const started = performance.now();
		let time = 0;
		let steps = 0;
		let reason = END_OPEN;
		let hit = NO_PLANET;
		const maxSteps = Math.min(MAX_STEPS, Math.ceil(this.horizon / DT) + 2);
		for (let step = 0; step < maxSteps; step++) {
			if ((step & (BUDGET_EVERY - 1)) === 0 && performance.now() - started > BUDGET_MS) {
				reason = END_TRUNCATED;
				break;
			}
			this.advance(state, DT);
			time += DT;
			steps += 1;
			const planet = this.impact(state.x, state.y);
			if (planet >= 0) {
				reason = END_IMPACT;
				hit = planet;
			} else if (this.outside(state.x, state.y)) reason = END_EXIT;
			else if (time >= this.horizon - 1e-9) reason = END_TIME;
			if (count < PATH_MAX) {
				pathX[count] = state.x;
				pathY[count] = state.y;
				count += 1;
			}
			if (reason !== END_OPEN) break;
		}
		this.predCount = count;
		this.predTime = time;
		this.predReason = reason;
		this.predPlanet = hit;
		this.predSteps = steps;
		this.predMs = performance.now() - started;
	};

	GravitySim.prototype.launch = function (origin, angle, speed) {
		const cargo = this.cargo;
		const spawn = this.planetR[origin] + SPAWN_GAP;
		cargo.x = this.planetX[origin] + Math.cos(angle) * spawn;
		cargo.y = this.planetY[origin] + Math.sin(angle) * spawn;
		cargo.vx = Math.cos(angle) * speed;
		cargo.vy = Math.sin(angle) * speed;
		this.status = STATUS_FLYING;
		this.origin = origin;
		this.angle = angle;
		this.speed = speed;
		this.flightTime = 0;
		this.liveSteps = 0;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endPlanet = NO_PLANET;
		this.trailCount = 0;
		this.recordTrail();
	};

	GravitySim.prototype.recordTrail = function () {
		const cargo = this.cargo;
		if (this.trailCount >= TRAIL_MAX) return;
		const slot = this.trailCount;
		this.trailX[slot] = cargo.x;
		this.trailY[slot] = cargo.y;
		this.trailCount = slot + 1;
	};

	GravitySim.prototype.finish = function (reason, planet) {
		this.endReason = reason;
		this.endPlanet = planet;
		this.status = STATUS_ENDED;
		this.acc = 0;
		this.recordTrail();
	};

	GravitySim.prototype.step = function (dt) {
		if (this.status !== STATUS_FLYING || !(dt > 0)) return;
		this.acc += dt;
		if (this.acc > 0.25) this.acc = 0.25;
		const cargo = this.cargo;
		let guard = 0;
		while (this.acc >= DT && this.status === STATUS_FLYING && guard < 24) {
			this.advance(cargo, DT);
			this.flightTime += DT;
			this.liveSteps += 1;
			this.acc -= DT;
			guard += 1;
			const planet = this.impact(cargo.x, cargo.y);
			if (planet >= 0) {
				this.finish(END_IMPACT, planet);
				break;
			}
			if (this.outside(cargo.x, cargo.y)) {
				this.finish(END_EXIT, NO_PLANET);
				break;
			}
			if (this.flightTime >= LIVE_LIMIT) {
				this.finish(END_TIME, NO_PLANET);
				break;
			}
			if ((this.liveSteps & (TRAIL_STRIDE - 1)) === 0) this.recordTrail();
		}
		if (this.acc >= DT) this.acc = 0;
	};

	GravitySim.prototype.clear = function () {
		this.status = STATUS_IDLE;
		this.origin = NO_PLANET;
		this.flightTime = 0;
		this.liveSteps = 0;
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endPlanet = NO_PLANET;
		this.trailCount = 0;
		this.predCount = 0;
		this.predTime = 0;
		this.predSteps = 0;
		this.predMs = 0;
		this.predReason = END_OPEN;
		this.predPlanet = NO_PLANET;
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
	GravitySim.LIVE_LIMIT = LIVE_LIMIT;
	GravitySim.BUDGET_MS = BUDGET_MS;
	GravitySim.NO_PLANET = NO_PLANET;
	GravitySim.STATUS_IDLE = STATUS_IDLE;
	GravitySim.STATUS_FLYING = STATUS_FLYING;
	GravitySim.STATUS_ENDED = STATUS_ENDED;
	GravitySim.END_OPEN = END_OPEN;
	GravitySim.END_IMPACT = END_IMPACT;
	GravitySim.END_EXIT = END_EXIT;
	GravitySim.END_TIME = END_TIME;
	GravitySim.END_TRUNCATED = END_TRUNCATED;

	if (typeof module !== 'undefined' && module.exports) module.exports = GravitySim;
	else root.GravitySim = GravitySim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
