/*
 * The route rule's planner: one staged prefix search shared by every level,
 * sliced per frame, plus the player's seeded route plan.
 * not here: tour and money rivals → bot_rivals.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_route.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const { GravitySim, GravityGame, PLAYER_INDEX, END_IMPACT, END_EXIT } = inner;

	/* Route is a planner contest. One prefix search serves every skill level:
	 * easy stops after stage 1, normal after stage 3, hard after stage 5, so a
	 * stronger bot has evaluated every candidate a weaker bot saw, then more. */
	const ROUTE_SPEEDS = [70, 120, 170, 50, 95, 145, 210, 60, 110, 155, 85, 240];
	const ROUTE_STAGE_COUNT = [24, 8, 36, 12, 48, 16];
	const ROUTE_COARSE_START = [0, -1, 24, -1, 60, -1];
	const ROUTE_REFINE_1 = [
		[-0.12, 0.92], [-0.12, 1.08], [-0.06, 0.92], [-0.06, 1.08],
		[0.06, 0.92], [0.06, 1.08], [0.12, 0.92], [0.12, 1.08]
	];
	const ROUTE_REFINE_2 = [
		[-0.045, 1], [0.045, 1], [0, 0.94], [0, 1.06],
		[-0.03, 0.97], [-0.03, 1.03], [-0.015, 0.97], [-0.015, 1.03],
		[0.015, 0.97], [0.015, 1.03], [0.03, 0.97], [0.03, 1.03]
	];
	const ROUTE_REFINE_3 = [
		[-0.015, 1], [0.015, 1], [0, 0.98], [0, 1.02],
		[-0.008, 0.99], [-0.008, 1.01], [-0.004, 0.99], [-0.004, 1.01],
		[0.004, 0.99], [0.004, 1.01], [0.008, 0.99], [0.008, 1.01],
		[-0.002, 0.995], [0.002, 1.005], [-0.002, 1.005], [0.002, 0.995]
	];
	const ROUTE_REFINES = [null, ROUTE_REFINE_1, null, ROUTE_REFINE_2, null, ROUTE_REFINE_3];
	const ROUTE_PHI = 0.618033988749895;
	const ROUTE_SLICE_CANDIDATES = 2;

	GravityBot.prototype.routeActorActive = function (index) {
		if (index === PLAYER_INDEX) return this.playerType === GravityGame.PLAYER_BOT;
		return this.isRivalBot(index);
	};

	/* opponent index, PLAYER_INDEX for YOU, or -1 when free */
	GravityBot.prototype.routeOccupiedBy = function (planet, includePlayer) {
		if (planet < 0) return -1;
		for (let i = 0; i < this.count; i++) {
			if (this.rivals[i].routeOrigin === planet) return i;
		}
		if (includePlayer !== false &&
			this.playerType === GravityGame.PLAYER_BOT &&
			this.player.routeOrigin === planet) return PLAYER_INDEX;
		return -1;
	};

	GravityBot.prototype.routeCandidate = function (actor) {
		const stage = actor.routeStage;
		if ((stage & 1) === 0) {
			const seq = ROUTE_COARSE_START[stage] + actor.routeIndex;
			const turn = (seq * ROUTE_PHI + actor.routeOffset) % 1;
			this.routeCandAngleU = GravityGame.angleUnits(turn * Math.PI * 2);
			this.routeCandSpeedU = GravityGame.speedUnits(
				ROUTE_SPEEDS[seq % ROUTE_SPEEDS.length]);
			return;
		}
		const pair = ROUTE_REFINES[stage][actor.routeIndex];
		const angle = GravityGame.angleOf(actor.routeRefineAngleU) + pair[0];
		let speed = GravityGame.speedOf(actor.routeRefineSpeedU) * pair[1];
		if (speed < GravitySim.SPEED_MIN) speed = GravitySim.SPEED_MIN;
		else if (speed > GravitySim.SPEED_MAX) speed = GravitySim.SPEED_MAX;
		this.routeCandAngleU = GravityGame.angleUnits(angle);
		this.routeCandSpeedU = GravityGame.speedUnits(speed);
	};

	GravityBot.prototype.beginRouteCandidate = function (index) {
		const actor = this.actorAt(index);
		this.routeCandidate(actor);
		this.routeCandActor = index;
		this.probe.visited.fill(0);
		this.probe.visitedCount = 0;
		this.probe.routeBegin(actor.routeOrigin,
			GravityGame.angleOf(this.routeCandAngleU),
			GravityGame.speedOf(this.routeCandSpeedU),
			GravityGame.ROUTE_SECONDS);
		this.probe.routeStorePath = false;
	};

	GravityBot.prototype.routeBetter = function (actor, length, angleU, speedU) {
		if (!actor.routeReady) return true;
		if (length > actor.routeLength + 0.5) return true;
		if (length < actor.routeLength - 0.5) return false;
		if (angleU !== actor.routeAngleU) return angleU < actor.routeAngleU;
		return speedU < actor.routeSpeedU;
	};

	GravityBot.prototype.finishRouteCandidate = function (index) {
		const actor = this.actorAt(index);
		const probe = this.probe;
		probe.routeStorePath = true;
		actor.routeIndex += 1;
		actor.routeDoneCount += 1;
		if ((probe.predReason === END_IMPACT || probe.predReason === END_EXIT) &&
			this.routeBetter(actor, probe.predLength,
				this.routeCandAngleU, this.routeCandSpeedU)) {
			actor.routeReady = true;
			actor.routeAngleU = this.routeCandAngleU;
			actor.routeSpeedU = this.routeCandSpeedU;
			actor.routeLength = probe.predLength;
			actor.routeSteps = probe.predSteps;
			actor.routeVisits = probe.predVisits;
			actor.routeReason = probe.predReason;
			actor.routeBody = probe.predBody;
			actor.length = probe.predLength;
			actor.steps = probe.predSteps;
			actor.routeVersion += 1;
			if (actor.shots.length === 0) {
				actor.shots.push(GravityGame.createShot(this.routeSource,
					actor.routeOrigin, actor.routeAngleU, actor.routeSpeedU,
					GravityGame.NO_ABORT));
			} else {
				const shot = actor.shots[0];
				shot.src = this.routeSource;
				shot.origin = actor.routeOrigin;
				shot.angle = actor.routeAngleU;
				shot.speed = actor.routeSpeedU;
				shot.abort = GravityGame.NO_ABORT;
			}
			if (index !== PLAYER_INDEX) {
				actor.sim.routeBegin(actor.routeOrigin,
					GravityGame.angleOf(actor.routeAngleU),
					GravityGame.speedOf(actor.routeSpeedU),
					GravityGame.ROUTE_SECONDS);
			}
		}
		this.routeCandActor = -1;
		if (actor.routeIndex < ROUTE_STAGE_COUNT[actor.routeStage]) return;
		const stopStage = this.specFor(index).routeStopStage;
		actor.routeStage += 1;
		actor.routeIndex = 0;
		while (actor.routeStage <= stopStage &&
			(actor.routeStage & 1) === 1 && !actor.routeReady) {
			actor.routeDoneCount += ROUTE_STAGE_COUNT[actor.routeStage];
			actor.routeStage += 1;
		}
		if (actor.routeStage > stopStage) {
			actor.routeDone = true;
			this.traceAdd(index, 'route ready', 'P' + actor.routeOrigin + ' · ' +
				Math.round(actor.routeLength) + ' px · ' + actor.routeVisits +
				' systems · ' + actor.routeDoneCount + ' candidates', this.worldStep);
			return;
		}
		if ((actor.routeStage & 1) === 1) {
			actor.routeRefineAngleU = actor.routeAngleU;
			actor.routeRefineSpeedU = actor.routeSpeedU;
		}
	};

	GravityBot.prototype.nextRouteActor = function () {
		const slots = this.count + 1;
		for (let n = 0; n < slots; n++) {
			const slot = (this.routeTurn + n) % slots;
			const index = slot === this.count ? PLAYER_INDEX : slot;
			if (!this.routeActorActive(index)) continue;
			if (this.actorAt(index).routeDone) continue;
			this.routeTurn = (slot + 1) % slots;
			return index;
		}
		return -1;
	};

	/*
	 * One sliced planner tick. Opponent display traces and the shared candidate
	 * trace each resume from their own GravitySim route job, so full-length
	 * candidates never stall a frame. Returns true when every plan is final.
	 */
	GravityBot.prototype.tickRoute = function (budgetMs) {
		if (this.rule !== GravityGame.RULE_ROUTE) return true;
		const budget = budgetMs > 0 ? budgetMs : 3;
		const started = performance.now();
		for (let i = 0; i < this.count; i++) {
			if (!this.isRivalBot(i)) continue;
			const sim = this.rivals[i].sim;
			if (!sim.routeActive) continue;
			const left = budget - (performance.now() - started);
			if (left <= 0) return false;
			sim.routeStep(left > 1.5 ? 1.5 : left);
		}
		let completed = 0;
		while (completed < ROUTE_SLICE_CANDIDATES) {
			if (this.routeCandActor < 0) {
				const next = this.nextRouteActor();
				if (next < 0) return true;
				this.beginRouteCandidate(next);
			}
			const left = budget - (performance.now() - started);
			if (left <= 0) return false;
			if (!this.probe.routeStep(left)) return false;
			this.finishRouteCandidate(this.routeCandActor);
			completed += 1;
		}
		return this.routeDone();
	};

	GravityBot.prototype.routeDone = function () {
		for (let slot = 0; slot <= this.count; slot++) {
			const i = slot === this.count ? PLAYER_INDEX : slot;
			if (this.routeActorActive(i) && !this.actorAt(i).routeDone) return false;
		}
		return true;
	};

	GravityBot.prototype.routeThinking = function () {
		return this.rule === GravityGame.RULE_ROUTE && !this.routeDone();
	};

	GravityBot.prototype.routeProgress = function () {
		let done = 0;
		let total = 0;
		for (let slot = 0; slot <= this.count; slot++) {
			const i = slot === this.count ? PLAYER_INDEX : slot;
			if (!this.routeActorActive(i)) continue;
			done += this.actorAt(i).routeDoneCount;
			total += this.specFor(i).routeCandidates;
		}
		return total > 0 ? done / total : 1;
	};

	/* a replayed bot plan becomes the search's current best, not a lost result */
	GravityBot.prototype.seedPlayerRoutePlan = function (shot, length, steps, visits, reason, body) {
		const actor = this.player;
		if (this.playerType !== GravityGame.PLAYER_BOT || !shot ||
			shot.origin !== actor.routeOrigin ||
			!this.routeBetter(actor, length, shot.angle, shot.speed)) return;
		actor.routeReady = true;
		actor.routeAngleU = shot.angle;
		actor.routeSpeedU = shot.speed;
		actor.routeLength = length;
		actor.routeSteps = steps;
		actor.routeVisits = visits;
		actor.routeReason = reason;
		actor.routeBody = body;
		actor.length = length;
		actor.steps = steps;
		actor.routeVersion += 1;
		if (actor.shots.length === 0) {
			actor.shots.push(GravityGame.createShot(shot.src, shot.origin,
				shot.angle, shot.speed, GravityGame.NO_ABORT));
		} else {
			const saved = actor.shots[0];
			saved.src = shot.src;
			saved.origin = shot.origin;
			saved.angle = shot.angle;
			saved.speed = shot.speed;
			saved.abort = GravityGame.NO_ABORT;
		}
	};
});
