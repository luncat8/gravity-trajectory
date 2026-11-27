/*
 * Bot setup: the skill levels, world and sim binding, scales, planet masks,
 * specs, reset, level and roster changes, plan validity.
 * not here: the career roster → bot_career_loop.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_setup.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravityGame, OrbitWorld, PLANETS, MAX_RIVALS, PLAYER_INDEX, MAX_BOT_SHOTS, STATUS_FLYING,
		MONEY, END_OPEN, CAREER_REFINE_SEEDS, CAREER_BURN_AT, createRival
	} = inner;

	const LEVELS = {
		off: {
			name: GravityGame.BOT_OFF,
			count: 0,
			careerCount: 0,
			careerAngles: 0,
			careerRefines: 0,
			angles: 0,
			speeds: [],
			horizon: 0,
			routeStopStage: -1,
			routeCandidates: 0,
			lookahead: 0,
			stageSteps: 0
		},
		easy: {
			name: GravityGame.BOT_EASY,
			count: 1,
			careerCount: 1,
			careerAngles: 16,
			careerRefines: 0,
			angles: 14,
			speeds: [140, 220],
			horizon: 12,
			routeStopStage: 1,
			routeCandidates: 32,
			lookahead: 0,
			stageSteps: 180
		},
		normal: {
			name: GravityGame.BOT_NORMAL,
			count: 1,
			careerCount: 2,
			careerAngles: 24,
			careerRefines: 2,
			angles: 24,
			speeds: [115, 175, 245],
			horizon: 18,
			routeStopStage: 3,
			routeCandidates: 80,
			lookahead: 0,
			stageSteps: 120
		},
		hard: {
			name: GravityGame.BOT_HARD,
			count: 2,
			careerCount: 2,
			careerAngles: 32,
			careerRefines: CAREER_REFINE_SEEDS,
			angles: 32,
			speeds: [105, 160, 215, 275],
			horizon: 22,
			routeStopStage: 5,
			routeCandidates: 144,
			lookahead: 8,
			stageSteps: 60
		}
	};

	GravityBot.prototype.ensureRivals = function (count) {
		while (this.rivals.length < count) {
			const rival = createRival(this.worldW, this.worldH);
			rival.index = this.rivals.length;
			this.rivals.push(rival);
			this.rivalTypes.push(GravityGame.PLAYER_BOT);
			if (this.tradeSim) {
				this.bindSim(rival.sim);
				rival.sim.setScales(this.probe.gravityScale, this.probe.forceScale);
				rival.sim.setPlanetMask(this.probe.planetMask);
			}
		}
	};

	GravityBot.prototype.attachWorld = function (tradeSim) {
		this.tradeSim = tradeSim;
		this.strength.fill(1);
		this.departureSourceSim = null;
		this.careerExitCacheCap.fill(-1);
		this.bindSim(this.probe);
		this.bindSim(this.exitProbe);
		this.bindSim(this.burnShotSim);
		for (let i = 0; i < this.rivals.length; i++) this.bindSim(this.rivals[i].sim);
		for (let i = 0; i < this.fleet.length; i++) this.bindSim(this.fleet[i].sim);
		this.bindSim(this.player.sim);
	};

	/* experimental scales belong to the world, so every bot-owned sim mirrors
	 * the GUI sim (probe = headless candidate search, rivals = shared market) */
	GravityBot.prototype.setScales = function (gravityScale, forceScale) {
		const changed = this.probe.gravityScale !== gravityScale ||
			this.probe.forceScale !== forceScale;
		this.probe.setScales(gravityScale, forceScale);
		this.exitProbe.setScales(gravityScale, forceScale);
		this.burnShotSim.setScales(gravityScale, forceScale);
		for (let i = 0; i < this.rivals.length; i++) {
			this.rivals[i].sim.setScales(gravityScale, forceScale);
			if (this.rivals[i].career) this.rivals[i].career.forceScale = forceScale;
		}
		for (let i = 0; i < this.fleet.length; i++) this.fleet[i].sim.setScales(gravityScale, forceScale);
		this.player.sim.setScales(gravityScale, forceScale);
		if (!changed) return;
		/* a cached plan was searched in the old world */
		this.jobActive = false;
		for (let i = 0; i < this.rivals.length; i++) this.rivals[i].planReady = false;
		this.player.planReady = false;
	};

	GravityBot.prototype.bindSim = function (sim) {
		const trade = this.tradeSim;
		sim.setPlanets(
			PLANETS,
			trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY,
			trade.orbitTiltCos, trade.orbitTiltSin
		);
		const mask = this.probe.planetMask;
		let count = PLANETS;
		if (mask) while (count > 0 && !mask[count - 1]) count--;
		sim.setField(count, trade.planetR, this.strength, this.fillPlanets, true);
	};

	/* the run's active planet subset: every bot-owned sim and career mirrors it */
	GravityBot.prototype.setPlanetMask = function (mask, count) {
		this.probe.setPlanetMask(mask);
		this.exitProbe.setPlanetMask(mask);
		this.burnShotSim.setPlanetMask(mask);
		this.planetUniverseCount = count;
		let extent = PLANETS;
		if (mask) while (extent > 0 && !mask[extent - 1]) extent--;
		const sims = [this.probe, this.exitProbe, this.burnShotSim, this.player.sim];
		for (let i = 0; i < this.rivals.length; i++) sims.push(this.rivals[i].sim);
		for (let i = 0; i < sims.length; i++) {
			if (sims[i].strength === this.strength) sims[i].setCount(extent);
		}
		this.player.sim.setPlanetMask(mask);
		for (let i = 0; i < this.rivals.length; i++) {
			this.rivals[i].sim.setPlanetMask(mask);
			if (this.rivals[i].career) {
				GravityGame.setCareerUniverse(this.rivals[i].career, mask, count);
			}
		}
	};

	GravityBot.prototype.spec = function () {
		return this.level === GravityGame.BOT_OFF && this.count > 0
			? LEVELS.normal : (LEVELS[this.level] || LEVELS.off);
	};

	GravityBot.prototype.actorAt = function (index) {
		return index === PLAYER_INDEX ? this.player : this.rivals[index];
	};

	GravityBot.prototype.specFor = function (index) {
		if (index === PLAYER_INDEX) return LEVELS[this.playerLevel] || LEVELS.off;
		return this.spec();
	};

	/* Route plans must be traced in the player's exact field (planets or ports). */
	GravityBot.prototype.useField = function (sourceSim, sourceCode) {
		this.routeSource = sourceCode === GravityGame.SRC_PORTS
			? GravityGame.SRC_PORTS : GravityGame.SRC_PLANETS;
		const bind = function (sim) {
			sim.fieldT = sourceSim.fieldT;
			sim.fieldRate = sourceSim.fieldRate;
			sim.setScales(sourceSim.gravityScale, sourceSim.forceScale);
			sim.setField(sourceSim.bodyCount, sourceSim.bodyR, sourceSim.strength,
				sourceSim.fillField, sourceSim.fieldStatic);
			sim.setPeriodic(sourceSim.periodic, sourceSim);
		};
		bind(this.probe);
		bind(this.burnShotSim);
		for (let i = 0; i < this.rivals.length; i++) bind(this.rivals[i].sim);
		bind(this.player.sim);
	};

	GravityBot.prototype.ruleSpec = function () {
		return GravityGame.RULES[this.rule] || GravityGame.RULES.tour;
	};

	GravityBot.prototype.resetActor = function (actor, basePlanet) {
		actor.sim.clear();
		GravityGame.resetLedger(actor.ledger);
		actor.shots.length = 0;
		actor.steps = 0;
		actor.doneSteps = -1;
		actor.length = 0;
		actor.basePlanet = basePlanet;
		actor.readyStep = 0;
		actor.idleTries = 0;
		actor.waitTries = 0;
		actor.burn = 0;
		actor.burnTries = 0;
		actor.burnNext = CAREER_BURN_AT;
		actor.burnStep = 0;
		actor.planReady = false;
		actor.planStep = -1;
		actor.planStamp = -1;
		actor.planOrigin = basePlanet;
		actor.routeOrigin = basePlanet;
		actor.routeStage = 0;
		actor.routeIndex = 0;
		actor.routeDoneCount = 0;
		actor.routeReady = false;
		actor.routeDone = true;
		actor.routeVersion = 0;
		actor.routeAngleU = 0;
		actor.routeSpeedU = 0;
		actor.routeRefineAngleU = 0;
		actor.routeRefineSpeedU = 0;
		actor.routeLength = 0;
		actor.routeSteps = 0;
		actor.routeVisits = 0;
		actor.routeReason = END_OPEN;
		actor.routeBody = -1;
	};

	GravityBot.prototype.isRivalBot = function (index) {
		return index >= 0 && index < this.count &&
			this.rivalTypes[index] === GravityGame.PLAYER_BOT;
	};

	/* a human-only rule (career) never hands YOU to a bot, but its level does
	 * decide how many rival career players share the map */
	GravityBot.prototype.reset = function (seed, rule, level, playerType, rivalTypes, rivalCount) {
		this.seed = seed >>> 0;
		this.rule = GravityGame.RULES[rule] ? rule : GravityGame.RULE_TOUR;
		const humanOnly = Boolean(this.ruleSpec().humanOnly);
		this.level = LEVELS[level] && !(this.ruleSpec().solo && humanOnly) ? level : GravityGame.BOT_OFF;
		this.playerType = playerType === GravityGame.PLAYER_BOT
			? GravityGame.PLAYER_BOT : GravityGame.PLAYER_USER;
		this.playerLevel = this.playerType === GravityGame.PLAYER_BOT
			? (this.level === GravityGame.BOT_OFF ? GravityGame.BOT_NORMAL : this.level)
			: GravityGame.BOT_OFF;
		const levelSpec = LEVELS[this.level] || LEVELS.off;
		this.count = this.ruleSpec().humanOnly ? levelSpec.careerCount : levelSpec.count;
		/* the scoreboard +/- sets the number of players directly, so it wins
		 * over the difficulty level's rival count */
		if (rivalCount !== undefined && rivalCount !== null) {
			this.count = rivalCount < 0 ? 0 : (rivalCount > MAX_RIVALS ? MAX_RIVALS : rivalCount);
		}
		this.ensureRivals(this.count);
		for (let i = 0; i < this.rivals.length; i++) {
			this.rivalTypes[i] = rivalTypes && rivalTypes[i] === GravityGame.PLAYER_USER
				? GravityGame.PLAYER_USER : GravityGame.PLAYER_BOT;
		}
		this.jobActive = false;
		this.jobRival = -1;
		this.routeCandActor = -1;
		this.routeTurn = 0;
		/* the alias dies with the run; attachFleet re-aliases on a career start */
		this.fleet = [];
		this.fleetOwner = null;
		this.probe.clear();
		this.worldStep = 0;
		this.traceReset();
		this.traceAdd(-1, 'start', this.rule + ' · ' + this.level + ' · ' + this.count +
			' rivals · seed ' + this.seed, 0);
		this.careerBest.origin = -1;
		this.careerBurnBest.body = -1;
		this.careerBuilds = 0;
		this.careerUpgrades = 0;
		this.careerResearches = 0;
		this.careerPadGearBought = 0;
		this.careerPlans = 0;
		this.careerBurnsPlanned = 0;
		this.careerBurnPrices = 0;
		this.careerBurnRescues = 0;
		this.careerFuelTopUps = 0;

		const base0 = (Math.imul(this.seed, 7) + 5) >>> 0;
		for (let i = 0; i < this.rivals.length; i++) {
			const r = this.rivals[i];
			const home = this.rivalTypes[i] === GravityGame.PLAYER_BOT
				? (base0 + (i % 2) * 13 + Math.floor(i / 2)) % OrbitWorld.DEFAULT_PLANETS : -1;
			this.careerDropQueue(r);
			this.resetActor(r, home);
			/* a career run leaves pads on the rival sims; a shared-market run must not inherit them */
			r.sim.setLaunchNetwork(null, null);
			r.routeOffset = 0.013 + i * 0.191;
		}
		let playerBase = this.playerType === GravityGame.PLAYER_BOT
			? (Math.imul(this.seed, 11) + 3) % OrbitWorld.DEFAULT_PLANETS : -1;
		if (playerBase >= 0 && this.rule === GravityGame.RULE_ROUTE) {
			while (this.routeOccupiedBy(playerBase, false) >= 0) {
				playerBase = (playerBase + 1) % OrbitWorld.DEFAULT_PLANETS;
			}
		}
		this.resetActor(this.player, playerBase);
		this.player.routeOffset = 0.717;
		if (this.rule === GravityGame.RULE_ROUTE) {
			for (let i = 0; i < this.count; i++) {
				if (this.isRivalBot(i)) this.rivals[i].routeDone = false;
			}
			if (this.playerType === GravityGame.PLAYER_BOT) this.player.routeDone = false;
		}
	};

	/*
	 * A live skill switch: the field, purses, pads and clock stay, only the
	 * controllers change. Every cached or sliced decision was priced at the old
	 * level, so it is dropped and the next tick plans at the new one — the cost
	 * of a switch is one replan, not a world rebuild.
	 */
	GravityBot.prototype.setPlayerType = function (type) {
		this.playerType = type === GravityGame.PLAYER_BOT ? GravityGame.PLAYER_BOT : GravityGame.PLAYER_USER;
		this.playerLevel = this.playerType === GravityGame.PLAYER_BOT
			? (this.level === GravityGame.BOT_OFF ? GravityGame.BOT_NORMAL : this.level)
			: GravityGame.BOT_OFF;
	};

	GravityBot.prototype.setLevel = function (level) {
		const allowed = LEVELS[level] && !(this.ruleSpec().solo && this.ruleSpec().humanOnly);
		this.level = allowed ? level : GravityGame.BOT_OFF;
		this.playerLevel = this.playerType === GravityGame.PLAYER_BOT
			? (this.level === GravityGame.BOT_OFF ? GravityGame.BOT_NORMAL : this.level)
			: GravityGame.BOT_OFF;
		this.jobActive = false;
		this.jobRival = -1;
		this.routeCandActor = -1;
		for (let i = 0; i < this.rivals.length; i++) this.forgetPlan(i);
		this.forgetPlan(PLAYER_INDEX);
		this.traceAdd(-1, 'level', this.level + ' · plans dropped', this.worldStep);
	};

	/*
	 * A live roster size: the level fields this many rivals at start, so a
	 * difficulty switch outside a career adds or drops one on the spot instead
	 * of rebuilding the world. Careers keep their companies — a company has a
	 * history, a purse and pads; only the scoreboard's +/- changes them.
	 */
	GravityBot.prototype.setRivals = function (count, step) {
		const target = Math.max(0, Math.min(MAX_RIVALS, count));
		while (this.count > target) this.removeRival();
		while (this.count < target) this.addRival(this.rivalHome(this.count), step);
	};

	/* a start planet for a new rival: the seeded home rotation, kept inside the
	 * live universe and off a taken route start */
	GravityBot.prototype.rivalHome = function (index) {
		const mask = this.probe.planetMask;
		const total = Math.min(PLANETS, this.planetUniverseCount || PLANETS);
		const base = (Math.imul(this.seed, 7) + 5) >>> 0;
		const home = (base + (index % 2) * 13 + Math.floor(index / 2)) % total;
		for (let n = 0; n < total; n++) {
			const planet = (home + n) % total;
			if (mask && !mask[planet]) continue;
			if (this.rule === GravityGame.RULE_ROUTE && this.routeOccupiedBy(planet) >= 0) continue;
			return planet;
		}
		return home;
	};

	/* drop one actor's cached decision so the next tick plans at this skill */
	GravityBot.prototype.forgetPlan = function (index) {
		const actor = this.actorAt(index);
		actor.planReady = false;
		actor.planStep = -1;
		actor.planStamp = -1;
		if (this.rule !== GravityGame.RULE_ROUTE || !this.routeActorActive(index)) return;
		/* a route entry is a candidate ladder: the new level changes its depth,
		 * so the actor traces it again from the coarse stage */
		actor.routeReady = false;
		actor.routeStage = 0;
		actor.routeIndex = 0;
		actor.routeDoneCount = 0;
		actor.routeDone = false;
		actor.shots.length = 0;
	};

	GravityBot.prototype.rivalDone = function (rival) {
		if (this.rule === GravityGame.RULE_CAREER) return true;
		if (this.rule === GravityGame.RULE_ROUTE) return rival.routeDone;
		const rSpec = this.ruleSpec();
		if (rSpec.stopOnTour && rival.doneSteps >= 0) return true;
		if (rSpec.maxShots > 0 && rival.shots.length >= rSpec.maxShots) return true;
		if (rival.shots.length >= MAX_BOT_SHOTS) return true;
		if (rival.sim.status !== STATUS_FLYING && rival.ledger.purse < MONEY.cost) return true;
		return false;
	};

	GravityBot.prototype.needsLaunch = function (rival, runStep) {
		if (this.rule === GravityGame.RULE_ROUTE) return false;
		return rival.sim.status !== STATUS_FLYING &&
			!this.rivalDone(rival) &&
			runStep >= rival.readyStep;
	};

	GravityBot.prototype.planValid = function (rival, runStep, market) {
		return rival.planReady &&
			rival.planStep === runStep &&
			rival.planStamp === market.stamp;
	};
	GravityBot.LEVELS = LEVELS;
});
