/*
 * The career loop: start careers, roster changes, stepCareer, and the
 * player-seat autopilot.
 * not here: choosing and firing a shot → bot_career_shot.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_loop.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitWorld, PLAYER_INDEX, STATUS_FLYING, CAREER_RIVAL_GAP,
		CAREER_BURN_AT, careerStartTraceText, evacTargetLabel
	} = inner;

	const CAREER_RIVAL_PHASE = Math.round(3 / GravitySim.DT);
	const BOARD_TICK_STEPS = Math.round(1 / GravitySim.DT);

	GravityBot.prototype.startCareers = function (galaxy, seed, trade, startMode) {
		for (let i = 0; i < this.rivals.length; i++) {
			const r = this.rivals[i];
			r.steps = 0;
			r.shots.length = 0;
			r.gapPhase = i * CAREER_RIVAL_PHASE;
			r.readyStep = r.gapPhase;
			r.idleTries = 0;
			r.waitTries = 0;
			r.panelTried = false;
			r.burn = 0;
			r.burnTries = 0;
			r.burnNext = CAREER_BURN_AT;
			r.burnStep = 0;
			this.careerDropQueue(r);
			if (i >= this.count) {
				r.career = null;
				continue;
			}
			r.sim.setScales(this.probe.gravityScale, this.probe.forceScale);
			r.sim.fieldT = trade.t;
			r.sim.fieldRate = this.probe.fieldRate;
			if (!r.career) r.career = GravityGame.createCareer(r.ledger);
			/* rivals are created after the universe is set, so give them the
			 * mask before startCareer picks an HQ from the in-play planets */
			if (this.probe.planetMask) {
				GravityGame.setCareerUniverse(r.career, this.probe.planetMask,
					this.planetUniverseCount || OrbitWorld.PLANETS);
			}
			GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(seed, i),
				trade, null, galaxy, undefined, startMode,
				this.rivalTypes[i] !== GravityGame.PLAYER_USER);
			/* whoever flies this company by hand needs the live rail gate */
			r.sim.attachCareer(r.career);
			r.career.bribeProne = this.careerBribeProne(i);
			r.basePlanet = r.career.at >= 0 ? r.career.at : GravityGame.evacTarget(r.career);
			this.traceAdd(i, 'start', careerStartTraceText(r.career,
				(r.readyStep * GravitySim.DT).toFixed(1) + ' s'), 0);
		}
	};

	GravityBot.prototype.addRival = function (planet, step) {
		const i = this.count;
		this.traceByActor[i].length = 0;
		this.lastDecision[i] = '';
		this.ensureRivals(i + 1);
		const r = this.rivals[i];
		this.rivalTypes[i] = GravityGame.PLAYER_BOT;
		this.resetActor(r, planet);
		r.sim.setLaunchNetwork(null, null);
		r.readyStep = step;
		r.routeOffset = 0.013 + i * 0.191;
		if (this.rule === GravityGame.RULE_ROUTE) r.routeDone = false;
		this.count += 1;
	};

	GravityBot.prototype.removeRival = function () {
		if (!this.count) return;
		this.count -= 1;
		this.jobActive = false;
		this.routeCandActor = -1;
	};

	GravityBot.prototype.addCareerRival = function (galaxy, trade, planet, step, startMode) {
		const mode = startMode || GravityGame.START_PLANET;
		const base = planet >= 0 ? planet
			: (trade.world && trade.world.capitalPlanet >= 0 ? trade.world.capitalPlanet : 0);
		const i = this.count;
		this.traceByActor[i].length = 0;
		this.lastDecision[i] = '';
		this.ensureRivals(i + 1);
		const r = this.rivals[i];
		this.rivalTypes[i] = GravityGame.PLAYER_BOT;
		this.resetActor(r, base);
		r.gapPhase = i * CAREER_RIVAL_PHASE;
		r.readyStep = step + r.gapPhase;
		r.idleTries = 0;
		r.waitTries = 0;
		r.burn = 0;
		r.burnTries = 0;
		r.burnNext = CAREER_BURN_AT;
		r.burnStep = 0;
		this.careerDropQueue(r);
		r.sim.fieldT = trade.t;
		r.sim.fieldRate = this.probe.fieldRate;
		r.career = GravityGame.createCareer(r.ledger);
		GravityGame.setCareerUniverse(r.career, this.probe.planetMask, this.planetUniverseCount);
		GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(this.seed, i),
			trade, null, galaxy, mode === GravityGame.START_PLANET ? planet : -1, mode, true);
		r.sim.attachCareer(r.career);
		r.career.bribeProne = this.careerBribeProne(i);
		r.basePlanet = r.career.at >= 0 ? r.career.at : GravityGame.evacTarget(r.career);
		this.count += 1;
		this.traceAdd(i, 'start', mode === GravityGame.START_PLANET
			? 'HQ P' + planet
			: (r.career.flying ? 'space' : 'Capital P' + r.career.at), step);
	};

	GravityBot.prototype.removeCareerRival = function () {
		if (!this.count) return;
		const r = this.rivals[this.count - 1];
		this.careerDropQueue(r);
		const galaxy = r.career.galaxy;
		for (let i = 0; i < this.count - 1; i++) {
			const other = this.rivals[i];
			if (other.turret && r.career.pads.includes(other.turret.pad)) this.careerDropQueue(other);
		}
		const index = galaxy.actors.indexOf(r.career);
		if (index >= 0) {
			galaxy.actors.splice(index, 1);
			/* the company takes its four stat series with it, so a later
			 * join re-appends at the right slot instead of misaligning */
			if (galaxy.stats) galaxy.stats.series.splice(2 + index * 4, 4);
		}
		for (let i = 0; i < galaxy.actors.length; i++) galaxy.actors[i].index = i;
		this.count -= 1;
		r.career = null;
		r.sim.setLaunchNetwork(null, null);
		this.jobActive = false;
		GravityGame.refreshNetwork(galaxy);
	};

	/* an idle board ages on the world clock: without this a contract with an
	 * unreachable target never expires, because landing was the only refresh */
	function boardStale(career, runStep) {
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind !== GravityGame.TASK_NONE && runStep > task.deadline) return true;
		}
		return false;
	}

	/* one game step for every rival career: charge pads, fly, plan, launch.
	 * `fieldRate` is the moving-gravity rate (trade minutes per **game** second,
	 * numerically the sky's `trade.speed`, which counts trade minutes per real
	 * second — a pace of 1 makes the two the same clock),
	 * and only a map that flies a shot uses it; no career number reads it. */
	GravityBot.prototype.stepCareer = function (runStep, market, trade, fieldRate) {
		this.worldStep = runStep;
		/* one political clock for the whole run, the GUI and the benches */
		GravityGame.advancePolitics(market, trade, runStep);
		/* one stats sample every stats.every steps; returns at once on any
		 * step that is not a sample step, so it never touches the frame loop */
		GravityGame.sampleStats(market.galaxy, market, runStep);
		const boardTick = runStep % BOARD_TICK_STEPS === 0;
		for (let i = 0; i < this.count; i++) {
			const r = this.rivals[i];
			const career = r.career;
			if (!career) continue;
			career.market = market;
			const flightStep = r.sim.status === STATUS_FLYING && r.sim.liveSteps < r.sim.stepLimit;
			/* Bot burns precede this step's wear; hand-flown rivals choose their own. */
			if (flightStep && this.isRivalBot(i)) {
				const burn = this.careerFlightBurn(career, r.sim, market, runStep - 1, r);
				const shot = r.shots[r.shots.length - 1];
				if (burn && shot) shot.burns.push(GravityGame.createBurn(r.sim.liveSteps, burn.angleU, burn.dvU));
			}
			GravityGame.careerAdvance(career, 1, flightStep);
			if (career.evacuating) {
				const arrived = !GravityGame.advanceEvacuation(career, r.sim, runStep);
				if (arrived) {
					r.basePlanet = career.at;
					r.idleTries = 0;
					r.waitTries = 0;
					r.panelTried = false;
					this.traceAdd(i, 'evacuated', 'to ' + evacTargetLabel(career), runStep);
					if (this.isRivalBot(i)) {
						r.readyStep = runStep + CAREER_RIVAL_GAP + r.gapPhase;
						this.careerBetweenFlights(career, r.sim, runStep);
					} else {
						r.readyStep = runStep + CAREER_RIVAL_GAP;
					}
				} else {
					r.readyStep = Math.max(r.readyStep, runStep + 1);
				}
				continue;
			}
			if (r.sim.status === STATUS_FLYING) {
				r.sim.stepOne();
				if (flightStep) {
					GravityGame.careerWeatherWear(career, r.sim);
					GravityGame.stepHarvest(r.ledger, market, r.sim, runStep);
					r.steps += 1;
				}
				if (r.sim.status === STATUS_FLYING) continue;
				this.careerLand(r, trade, runStep);
				continue;
			}
			if (boardTick && career.ended === GravityGame.CAREER_OPEN &&
				boardStale(career, runStep)) {
				GravityGame.refreshBoard(career, trade, runStep);
				this.traceAdd(i, 'board', 'expired contracts cleared', runStep);
			}
			/* a finished company must give its queued pad charge back */
			if (career.ended !== GravityGame.CAREER_OPEN && r.turret) {
				this.traceAdd(i, 'queue dropped', 'career ended', runStep);
				this.careerDropQueue(r);
				GravityGame.setCommercial(career, -1);
			}
			if (career.ended !== GravityGame.CAREER_OPEN) continue;
			/* a company the page flies by hand keeps charging pads and flying
			 * its own shots, but the bot never picks them */
			if (!this.isRivalBot(i)) continue;
			if (career.arrested || runStep < r.readyStep) continue;
			if (this.careerTryRecovery(r, runStep)) continue;
			this.careerLaunch(r, market, trade, fieldRate, runStep);
		}
	};

	/*
	 * YOU as a bot in career: the page owns the ship, the world clock, the
	 * turret queue and the flight end, so the bot only shops between flights
	 * and hands back the next shot. `refresh` re-shops after a landing (or at
	 * a fresh start); the returned plan is read from `careerPlayer.plan`.
	 */
	GravityBot.prototype.attachCareerPlayer = function (career, sim) {
		career.bribeProne = this.careerBribeProne(PLAYER_INDEX);
		this.careerPlayer.career = career;
		this.careerPlayer.sim = sim;
		this.careerPlayer.idleTries = 0;
		this.careerPlayer.waitTries = 0;
		this.careerPlayer.readyStep = 0;
		this.careerPlayer.burn = 0;
		this.careerPlayer.burnTries = 0;
		this.careerPlayer.burnNext = CAREER_BURN_AT;
		this.careerPlayer.burnStep = 0;
	};

	GravityBot.prototype.careerPlayerPlan = function () {
		return this.careerPlayer.plan;
	};

	/* the page owns a YOU-as-bot flight, so it applies the burn itself (that
	 * keeps the shot record and the replay); this hands back what to record */
	GravityBot.prototype.tickCareerPlayerFlight = function (runStep, market) {
		const p = this.careerPlayer;
		if (!p.career || !p.sim) return null;
		return this.careerFlightBurn(p.career, p.sim, market, runStep, p);
	};

	GravityBot.prototype.tickCareerPlayer = function (runStep, market, trade, refresh) {
		const p = this.careerPlayer;
		const career = p.career;
		if (!career || !p.sim || career.ended !== GravityGame.CAREER_OPEN) return false;
		if (career.arrested || career.evacuating || p.sim.status === STATUS_FLYING) return false;
		if (refresh) {
			/* just landed (or just started): shop, then turn the barrel */
			p.idleTries = 0;
			p.waitTries = 0;
			this.careerBetweenFlights(career, p.sim, runStep);
			if (career.at < 0) return false;
			p.readyStep = runStep + CAREER_RIVAL_GAP;
			this.traceAdd(p.index, 'ready', 'shop done · next try in ' +
				(CAREER_RIVAL_GAP * GravitySim.DT).toFixed(1) + ' s', runStep);
			return false;
		}
		if (runStep < p.readyStep) return false;
		if (this.careerTryRecovery(p, runStep)) return false;
		const plan = this.careerNextShot(p, market, trade, runStep);
		if (!plan) return false;
		this.traceCareerPlan(p.index, plan, runStep);
		if (this.careerSit(p, plan, runStep)) return false;
		const requested = plan.fuelProducedKg + plan.fuelBoughtKg > 0;
		if (requested && !this.careerCommitFuel(p, plan, runStep)) {
			p.readyStep = runStep + CAREER_RIVAL_GAP;
			return false;
		}
		if (!requested) this.careerPrepareFuel(p, plan, market, runStep);
		this.careerRaceEntry(career, p.sim, plan, runStep);
		p.readyStep = runStep + CAREER_RIVAL_GAP;
		const out = p.plan;
		out.origin = plan.origin;
		out.body = plan.body;
		out.angle = plan.angle;
		out.speed = plan.speed;
		out.score = plan.score;
		out.taskPay = plan.taskPay;
		out.padValue = plan.padValue;
		out.fee = plan.fee;
		out.builds = plan.builds;
		out.fromBook = plan.fromBook;
		out.burnGain = plan.burnGain;
		out.burnBody = plan.burnBody;
		return true;
	};

	/* a rival that is wound up or restarted gives its queued claim back */
	GravityBot.prototype.careerDropQueue = function (r) {
		if (!r.turret) return;
		GravityGame.releaseEnergy(r.turret.pad, r.turret.energy);
		r.turret = null;
		r.career.plannedLanding = -1;
	};
});
