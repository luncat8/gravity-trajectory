/*
 * Ballistic cargo under the gravity of a set of bodies (planets or ports).
 *
 * Prediction and live flight share spawn()/advance() and one fixed step, so
 * the drawn path is the path the container follows. Body positions come from
 * a fill callback sampled at a field time (trade minutes): the planets fill
 * is static, the ports fill follows the closed-form ellipse. A moving field
 * is resampled every FIELD_STRIDE steps, extrapolated at the current trade
 * rate, on the same cadence in prediction and flight. A shot from a moving
 * body inherits that body's velocity. Per-body strength is signed; negative
 * values repel.
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

	function GravitySim(worldW, worldH) {
		this.worldW = worldW;
		this.worldH = worldH;

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
		this.acc = 0;
		this.endReason = END_OPEN;
		this.endBody = NO_BODY;

		this.trailX = new Float32Array(TRAIL_MAX);
		this.trailY = new Float32Array(TRAIL_MAX);
		this.trailCount = 0;

		this.predX = new Float32Array(PATH_MAX);
		this.predY = new Float32Array(PATH_MAX);
		this.predCount = 0;
		this.predTime = 0;
		this.predLength = 0;
		this.predReason = END_OPEN;
		this.predBody = NO_BODY;
		this.predSteps = 0;
		this.predMs = 0;
	}

	/* fillField(t, outX, outY, count) writes body positions at field time t */
	GravitySim.prototype.setField = function (count, bodyR, strength, fillField, fieldStatic) {
		this.bodyCount = count;
		this.bodyR = bodyR;
		this.strength = strength;
		this.fillField = fillField;
		this.fieldStatic = fieldStatic;
		this.stepStale = true;
		this.refreshField();
	};

	/* ports appear as colonies are built; the field only ever grows */
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

	/* how far the centres travelled since the prediction snapshot, in px */
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

	/* px/s for a grip of `length` px from the body centre */
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
		const px = this.stepX;
		const py = this.stepY;
		const pr = this.bodyR;
		for (let i = 0; i < this.bodyCount; i++) {
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
	 * Spawn state at field time t0: clear of the origin body along the aim,
	 * push along the aim plus the origin's own velocity when the field moves
	 * (central difference of the closed-form positions, px/min x min/s).
	 */
	GravitySim.prototype.spawn = function (state, origin, angle, speed, t0) {
		this.fillStep(t0);
		this.stepStale = false;
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
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

	/*
	 * Same integrator from the same spawn state, with the field extrapolated
	 * from fieldT at fieldRate. Stops on impact, on leaving the field, at
	 * the horizon, or when the wall-clock budget is spent.
	 */
	GravitySim.prototype.predict = function (origin, angle, speed) {
		const state = this.probe;
		const t0 = this.fieldT;
		const rate = this.fieldRate;
		const moving = !this.fieldStatic && rate !== 0;
		this.spawn(state, origin, angle, speed, t0);
		for (let i = 0; i < this.bodyCount; i++) {
			this.predBodyX[i] = this.stepX[i];
			this.predBodyY[i] = this.stepY[i];
		}
		this.predBodyCount = this.bodyCount;
		this.predFieldT = t0;
		this.predRate = rate;

		const pathX = this.predX;
		const pathY = this.predY;
		let count = 0;
		pathX[count] = state.x;
		pathY[count] = state.y;
		count += 1;

		const started = performance.now();
		let time = 0;
		let length = 0;
		let steps = 0;
		let reason = END_OPEN;
		let hit = NO_BODY;
		const maxSteps = Math.min(MAX_STEPS, Math.ceil(this.horizon / DT) + 2);
		const stride = moving ? this.fieldStride() : FIELD_STRIDE;
		for (let step = 0; step < maxSteps; step++) {
			if ((step & (BUDGET_EVERY - 1)) === 0 && performance.now() - started > BUDGET_MS) {
				reason = END_TRUNCATED;
				break;
			}
			if (moving && step > 0 && step % stride === 0) {
				this.fillStep(t0 + step * DT * rate);
			}
			const prevX = state.x;
			const prevY = state.y;
			this.advance(state, DT);
			const dx = state.x - prevX;
			const dy = state.y - prevY;
			length += Math.sqrt(dx * dx + dy * dy);
			time += DT;
			steps += 1;
			const body = this.impact(state.x, state.y);
			if (body >= 0) {
				reason = END_IMPACT;
				hit = body;
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
		this.predLength = length;
		this.predReason = reason;
		this.predBody = hit;
		this.predSteps = steps;
		this.predMs = performance.now() - started;
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

	GravitySim.prototype.finish = function (reason, body) {
		this.endReason = reason;
		this.endBody = body;
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
			this.flightTime += DT;
			this.flightFieldT += DT * this.fieldRate;
			this.liveSteps += 1;
			this.acc -= DT;
			guard += 1;
			const body = this.impact(cargo.x, cargo.y);
			if (body >= 0) {
				this.finish(END_IMPACT, body);
				break;
			}
			if (this.outside(cargo.x, cargo.y)) {
				this.finish(END_EXIT, NO_BODY);
				break;
			}
			if (this.flightTime >= LIVE_LIMIT) {
				this.finish(END_TIME, NO_BODY);
				break;
			}
			if ((this.liveSteps & (TRAIL_STRIDE - 1)) === 0) this.recordTrail();
		}
		if (this.acc >= DT) this.acc = 0;
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
		this.trailCount = 0;
		this.predCount = 0;
		this.predTime = 0;
		this.predLength = 0;
		this.predSteps = 0;
		this.predMs = 0;
		this.predReason = END_OPEN;
		this.predBody = NO_BODY;
		this.predBodyCount = 0;
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

	if (typeof module !== 'undefined' && module.exports) module.exports = GravitySim;
	else root.GravitySim = GravitySim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
