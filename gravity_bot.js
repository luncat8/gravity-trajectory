/*
 * Deterministic rival competitors (0.3.3).
 *
 * Rivals fly in the same seeded system on the exact integer step clock and
 * harvest from the shared planet-profit market (`GravityGame.stepHarvest`), so
 * planets drained by a rival drop to +0.00 on the canvas and push the player
 * toward long-unvisited systems. Candidate search runs as a sliced background
 * job with zero per-candidate allocations, and drains synchronously when a
 * step boundary requires an immediate launch or replay skip.
 *
 * Career uses the separate synchronous controller below: it plans from the
 * occupied catapult, values tasks and landing pads net of energy recharge
 * waits, and performs reserve-aware shopping between real headless flights.
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js')
		: root.GravityGame;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;

	const PLANETS = OrbitWorld.PLANETS;
	const MAX_RIVALS = 2;
	const PLAYER_INDEX = 2;
	const TOP_K = 4;
	const MAX_BOT_SHOTS = 16;
	const SLICE_CANDIDATES = 64;
	const LOOKAHEAD_SPEED = 175;
	const LOOKAHEAD_HORIZON = 12;
	const LOOKAHEAD_WEIGHT = 0.45;
	const STATUS_FLYING = GravitySim.STATUS_FLYING;
	const END_IMPACT = GravitySim.END_IMPACT;
	const END_EXIT = GravitySim.END_EXIT;
	const END_TIME = GravitySim.END_TIME;
	const MONEY = GravityGame.MONEY;
	const END_OPEN = GravitySim.END_OPEN;
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

	/* Career is a solo economic controller, not another shared-market rival. */
	const CAREER_ANGLES = 32;
	const CAREER_FALLBACK_SCALE = 2.25;
	const CAREER_HORIZON = 45;
	const CAREER_SPEED_FRACTIONS = [0.38, 0.55, 0.72, 0.86, 1];
	const CAREER_TARGET_OFFSETS = 4;
	const CAREER_TARGET_STEP = 0.035;
	const CAREER_WAIT_SECONDS = 1800;
	const CAREER_ENERGY_WAIT_COST = 0.04;
	const CAREER_BUILT_PAD_VALUE = 2.5;
	const CAREER_NETWORK_PAD_VALUE = 4;
	const CAREER_SAME_PAD_VALUE = -1;
	const CAREER_PICKUP_VALUE = 0.35;
	const CAREER_REFIT_VALUE = 3;
	/* a career rival launches again after this much world time, and keeps this
	 * much purse back for the commercial EMC's fee when shopping */
	const CAREER_RIVAL_GAP = Math.round(8 / GravitySim.DT);
	const CAREER_REBOOT_GAP = Math.round(30 / GravitySim.DT);
	const CAREER_PURSE_RESERVE = GravityGame.CAREER.commercialFee;
	const CAREER_LOADED_SPEED = 75;
	const CAREER_BURN_ANGLES = 24;
	const CAREER_BURN_FRACTIONS = [0.35, 0.68, 1];
	const CAREER_BURN_FUEL_COST = 0.008;
	const CAREER_BURN_MIN_GAIN = 0.25;

	const LEVELS = {
		off: {
			name: GravityGame.BOT_OFF,
			count: 0,
			careerCount: 0,
			careerAngles: 0,
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
			angles: 32,
			speeds: [105, 160, 215, 275],
			horizon: 22,
			routeStopStage: 5,
			routeCandidates: 144,
			lookahead: 8,
			stageSteps: 60
		}
	};

	function createRival(worldW, worldH) {
		return {
			sim: new GravitySim(worldW, worldH),
			ledger: GravityGame.createLedger(),
			career: null,
			shots: [],
			steps: 0,
			doneSteps: -1,
			length: 0,
			basePlanet: 0,
			readyStep: 0,
			idleTries: 0,
			planReady: false,
			planStep: -1,
			planStamp: -1,
			planOrigin: 0,
			planAngleU: 0,
			planSpeedU: 0,
			routeOrigin: 0,
			routeStage: 0,
			routeIndex: 0,
			routeDoneCount: 0,
			routeOffset: 0,
			routeReady: false,
			routeDone: true,
			routeVersion: 0,
			routeAngleU: 0,
			routeSpeedU: 0,
			routeRefineAngleU: 0,
			routeRefineSpeedU: 0,
			routeLength: 0,
			routeSteps: 0,
			routeVisits: 0,
			routeReason: END_OPEN,
			routeBody: -1
		};
	}

	function GravityBot(worldW, worldH) {
		this.worldW = worldW;
		this.worldH = worldH;
		this.tradeSim = null;
		this.probe = new GravitySim(worldW, worldH);
		this.strength = new Float64Array(PLANETS).fill(1);
		this.rivals = [createRival(worldW, worldH), createRival(worldW, worldH)];
		/* the GUI's own actor when YOU is set to bot; its sim mirrors the GUI sim */
		this.player = createRival(worldW, worldH);

		this.level = GravityGame.BOT_OFF;
		this.playerType = GravityGame.PLAYER_USER;
		this.playerLevel = GravityGame.BOT_OFF;
		this.rivalTypes = [GravityGame.PLAYER_BOT, GravityGame.PLAYER_BOT];
		this.rule = GravityGame.RULE_TOUR;
		this.seed = 1;
		this.count = 0;
		this.routeSource = GravityGame.SRC_PLANETS;
		this.routeCandActor = -1;
		this.routeCandAngleU = 0;
		this.routeCandSpeedU = 0;
		this.routeTurn = 0;

		/* preallocated scratch buffers for 1-ply lookahead: zero per-candidate allocs */
		this.lookMarket = GravityGame.createMarket();
		this.savedVisited = new Uint8Array(GravitySim.MAX_BODIES);
		this.topScore = new Float64Array(TOP_K);
		this.topAngleU = new Int32Array(TOP_K);
		this.topSpeedU = new Int32Array(TOP_K);
		this.topBody = new Int32Array(TOP_K);
		this.topSteps = new Int32Array(TOP_K);
		this.topCount = 0;

		/* sliced search job state */
		this.jobActive = false;
		this.jobRival = -1;
		this.jobRunStep = 0;
		this.jobStamp = -1;
		this.jobMarket = null;
		this.jobOrigin = 0;
		this.jobPhase = 0;
		this.jobIndex = 0;
		this.jobPrimaryTotal = 0;
		this.jobLookTotal = 0;
		this.jobHorizon = 18;
		this.lookBest = 0;
		this.bestScore = -Infinity;
		this.bestAngleU = 0;
		this.bestSpeedU = 0;

		this.careerBest = {
			origin: -1, body: -1, angle: 0, speed: 0, score: -Infinity,
			taskPay: 0, padValue: 0, energy: 0, wait: 0, fee: 0, steps: 0
		};
		this.careerBurnBest = {
			body: -1, angle: 0, dv: 0, angleU: 0, dvU: 0,
			score: -Infinity, coastScore: -Infinity, fuelKg: 0, steps: 0
		};
		this.careerEval = { taskPay: 0, padValue: 0, energy: 0, wait: 0, fee: 0 };
		this.careerBuilds = 0;
		this.careerUpgrades = 0;
		this.careerResearches = 0;
		this.careerUseResearch = false;
		this.careerPlans = 0;
		this.careerBurnsPlanned = 0;

		const self = this;
		this.fillPlanets = function (t, outX, outY, count) {
			const sim = self.tradeSim;
			for (let i = 0; i < count; i++) {
				outX[i] = sim.planetX[i];
				outY[i] = sim.planetY[i];
			}
		};
	}

	GravityBot.prototype.attachWorld = function (tradeSim) {
		this.tradeSim = tradeSim;
		this.strength.fill(1);
		this.bindSim(this.probe);
		for (let i = 0; i < MAX_RIVALS; i++) this.bindSim(this.rivals[i].sim);
		this.bindSim(this.player.sim);
	};

	/* experimental scales belong to the world, so every bot-owned sim mirrors
	 * the GUI sim (probe = headless candidate search, rivals = shared market) */
	GravityBot.prototype.setScales = function (gravityScale, forceScale) {
		const changed = this.probe.gravityScale !== gravityScale ||
			this.probe.forceScale !== forceScale;
		this.probe.setScales(gravityScale, forceScale);
		for (let i = 0; i < MAX_RIVALS; i++) {
			this.rivals[i].sim.setScales(gravityScale, forceScale);
			if (this.rivals[i].career) this.rivals[i].career.forceScale = forceScale;
		}
		this.player.sim.setScales(gravityScale, forceScale);
		if (!changed) return;
		/* a cached plan was searched in the old world */
		this.jobActive = false;
		for (let i = 0; i < MAX_RIVALS; i++) this.rivals[i].planReady = false;
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
		sim.setField(PLANETS, trade.planetR, this.strength, this.fillPlanets, true);
	};

	GravityBot.prototype.spec = function () {
		return LEVELS[this.level] || LEVELS.off;
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
		};
		bind(this.probe);
		for (let i = 0; i < MAX_RIVALS; i++) bind(this.rivals[i].sim);
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
	GravityBot.prototype.reset = function (seed, rule, level, playerType, rivalTypes) {
		this.seed = seed >>> 0;
		this.rule = GravityGame.RULES[rule] ? rule : GravityGame.RULE_TOUR;
		const humanOnly = Boolean(this.ruleSpec().humanOnly);
		this.level = LEVELS[level] && !(this.ruleSpec().solo && humanOnly) ? level : GravityGame.BOT_OFF;
		this.playerType = playerType === GravityGame.PLAYER_BOT && !humanOnly
			? GravityGame.PLAYER_BOT : GravityGame.PLAYER_USER;
		this.playerLevel = this.playerType === GravityGame.PLAYER_BOT
			? (this.level === GravityGame.BOT_OFF ? GravityGame.BOT_NORMAL : this.level)
			: GravityGame.BOT_OFF;
		for (let i = 0; i < MAX_RIVALS; i++) {
			this.rivalTypes[i] = rivalTypes && rivalTypes[i] === GravityGame.PLAYER_USER
				? GravityGame.PLAYER_USER : GravityGame.PLAYER_BOT;
		}
		this.count = this.ruleSpec().humanOnly ? this.spec().careerCount : this.spec().count;
		this.jobActive = false;
		this.jobRival = -1;
		this.routeCandActor = -1;
		this.routeTurn = 0;
		this.probe.clear();
		this.careerBest.origin = -1;
		this.careerBurnBest.body = -1;
		this.careerBuilds = 0;
		this.careerUpgrades = 0;
		this.careerResearches = 0;
		this.careerPlans = 0;
		this.careerBurnsPlanned = 0;

		const base0 = (Math.imul(this.seed, 7) + 5) >>> 0;
		for (let i = 0; i < MAX_RIVALS; i++) {
			const r = this.rivals[i];
			const home = this.rivalTypes[i] === GravityGame.PLAYER_BOT
				? (base0 + i * 13) % PLANETS : -1;
			this.resetActor(r, home);
			/* a career run leaves pads on the rival sims; a shared-market run must not inherit them */
			r.sim.setLaunchNetwork(null, null);
			r.routeOffset = 0.013 + i * 0.191;
		}
		let playerBase = this.playerType === GravityGame.PLAYER_BOT
			? (Math.imul(this.seed, 11) + 3) % PLANETS : -1;
		if (playerBase >= 0 && this.rule === GravityGame.RULE_ROUTE) {
			while (this.routeOccupiedBy(playerBase, false) >= 0) {
				playerBase = (playerBase + 1) % PLANETS;
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
			return;
		}
		if ((actor.routeStage & 1) === 1) {
			actor.routeRefineAngleU = actor.routeAngleU;
			actor.routeRefineSpeedU = actor.routeSpeedU;
		}
	};

	GravityBot.prototype.nextRouteActor = function () {
		for (let n = 0; n < 3; n++) {
			const index = (this.routeTurn + n) % 3;
			if (!this.routeActorActive(index)) continue;
			if (this.actorAt(index).routeDone) continue;
			this.routeTurn = (index + 1) % 3;
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
		for (let i = 0; i < 3; i++) {
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
		for (let i = 0; i < 3; i++) {
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

	/* scores the probe result already sitting in `this.probe` */
	GravityBot.prototype.scoreProbe = function (rival, origin, market, baseStep) {
		const probe = this.probe;
		if (probe.predReason === END_EXIT) return -1e9;
		const profit = GravityGame.estimateProfit(market, baseStep, probe);
		const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
		const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
		const timeCap = probe.predReason === END_TIME ? 1 : 0;
		const newVisits = probe.predNewVisits;
		const rSpec = this.ruleSpec();
		const completes = rSpec.stopOnTour &&
			(rival.sim.visitedCount + newVisits >= PLANETS);
		const solvent = rival.ledger.purse - MONEY.cost + profit >= MONEY.cost || completes;

		let score = (solvent ? 0 : -400) + lands * 12 - samePad * 35 -
			(timeCap && !completes ? 250 : 0);
		if (this.rule === GravityGame.RULE_MONEY) {
			score += profit * 30 + newVisits * 2 - probe.predTime * 0.14;
		} else {
			score += (completes ? 80 : 0) + newVisits * 11 +
				profit * 18 - probe.predTime * 0.16;
		}
		return score;
	};

	GravityBot.prototype.recordTopCandidate = function (score, angleU, speedU, body, steps) {
		let slot = -1;
		if (this.topCount < TOP_K) {
			slot = this.topCount;
			this.topCount += 1;
		} else {
			let worst = 0;
			for (let i = 1; i < TOP_K; i++) {
				if (this.topScore[i] < this.topScore[worst]) worst = i;
			}
			if (score <= this.topScore[worst]) return;
			slot = worst;
		}
		this.topScore[slot] = score;
		this.topAngleU[slot] = angleU;
		this.topSpeedU[slot] = speedU;
		this.topBody[slot] = body;
		this.topSteps[slot] = steps;
	};

	GravityBot.prototype.betterChoice = function (score, angleU, speedU) {
		if (score > this.bestScore) return true;
		if (score < this.bestScore) return false;
		if (angleU !== this.bestAngleU) return angleU < this.bestAngleU;
		return speedU < this.bestSpeedU;
	};

	GravityBot.prototype.beginJob = function (rivalIdx, runStep, market) {
		const rival = this.actorAt(rivalIdx);
		const spec = this.specFor(rivalIdx);
		const origin = rival.sim.landedBody >= 0 ? rival.sim.landedBody : rival.basePlanet;
		this.jobActive = true;
		this.jobRival = rivalIdx;
		this.jobRunStep = runStep;
		this.jobStamp = market.stamp;
		this.jobMarket = market;
		this.jobOrigin = origin;
		this.jobPhase = 0;
		this.jobIndex = 0;
		this.jobPrimaryTotal = spec.angles * spec.speeds.length;
		this.jobLookTotal = 0;
		this.jobHorizon = spec.horizon;
		this.topCount = 0;
		this.bestScore = -Infinity;
		this.bestAngleU = 0;
		this.bestSpeedU = GravityGame.speedUnits(spec.speeds[0] || 150);
		this.savedVisited.set(rival.sim.visited);
		this.probe.visited.set(this.savedVisited);
		this.probe.visitedCount = rival.sim.visitedCount;
	};

	/* prepares `probe.visited` and `lookMarket` for top candidate `slot`'s 1-ply follow-up */
	GravityBot.prototype.prepareLookahead = function (slot) {
		const angle = GravityGame.angleOf(this.topAngleU[slot]);
		const speed = GravityGame.speedOf(this.topSpeedU[slot]);
		this.probe.visited.set(this.savedVisited);
		this.probe.predictFast(this.jobOrigin, angle, speed, this.jobHorizon);
		this.lookMarket.lastVisitStep.set(this.jobMarket.lastVisitStep);
		for (let i = 0; i < this.probe.predLogCount; i++) {
			const p = this.probe.predLogPlanet[i];
			this.lookMarket.lastVisitStep[p] = this.jobRunStep + this.probe.predLogStep[i];
		}
		for (let i = 0; i < PLANETS; i++) {
			if (this.probe.predVisit[i]) this.probe.visited[i] = 1;
		}
	};

	GravityBot.prototype.stepJob = function (budgetMs, maxCands) {
		if (!this.jobActive) return true;
		const spec = this.specFor(this.jobRival);
		const rival = this.actorAt(this.jobRival);
		const started = performance.now();
		const capMs = budgetMs > 0 ? budgetMs : 3.5;
		const sliceCap = maxCands > 0 ? maxCands : SLICE_CANDIDATES;
		let evaluated = 0;

		while (this.jobPhase === 0 && this.jobIndex < this.jobPrimaryTotal) {
			if (evaluated > 0 && (evaluated >= sliceCap || performance.now() - started > capMs)) {
				return false;
			}
			const sCount = spec.speeds.length;
			const aIdx = (this.jobIndex / sCount) | 0;
			const sIdx = this.jobIndex - aIdx * sCount;
			this.jobIndex += 1;
			evaluated += 1;

			const rawAngle = (aIdx + 0.5) / spec.angles * Math.PI * 2;
			const angleU = GravityGame.angleUnits(rawAngle);
			const speedU = GravityGame.speedUnits(spec.speeds[sIdx]);
			const angle = GravityGame.angleOf(angleU);
			const speed = GravityGame.speedOf(speedU);

			this.probe.visited.set(this.savedVisited);
			this.probe.predictFast(this.jobOrigin, angle, speed, this.jobHorizon);
			const score = this.scoreProbe(rival, this.jobOrigin, this.jobMarket, this.jobRunStep);
			if (this.betterChoice(score, angleU, speedU)) {
				this.bestScore = score;
				this.bestAngleU = angleU;
				this.bestSpeedU = speedU;
			}
			if (spec.lookahead > 0 &&
				this.probe.predReason === END_IMPACT &&
				this.probe.predBody !== this.jobOrigin) {
				this.recordTopCandidate(score, angleU, speedU,
					this.probe.predBody, this.probe.predSteps);
			}
		}

		if (this.jobPhase === 0) {
			if (spec.lookahead > 0 && this.topCount > 0) {
				this.jobPhase = 1;
				this.jobIndex = 0;
				this.jobLookTotal = this.topCount * spec.lookahead;
			} else {
				return this.finishJob();
			}
		}

		const lookAngles = spec.lookahead;
		const speedU2 = GravityGame.speedUnits(LOOKAHEAD_SPEED);
		const speed2 = GravityGame.speedOf(speedU2);
		while (this.jobPhase === 1 && this.jobIndex < this.jobLookTotal) {
			if (evaluated > 0 && (evaluated >= sliceCap || performance.now() - started > capMs)) {
				return false;
			}
			const slot = (this.jobIndex / lookAngles) | 0;
			const lIdx = this.jobIndex - slot * lookAngles;
			if (lIdx === 0) {
				this.prepareLookahead(slot);
				this.lookBest = 0;
			}
			this.jobIndex += 1;
			evaluated += 1;

			const origin2 = this.topBody[slot];
			const step2 = this.jobRunStep + this.topSteps[slot];
			const angle2 = GravityGame.angleOf(GravityGame.angleUnits((lIdx + 0.5) / lookAngles * Math.PI * 2));
			this.probe.predictFast(origin2, angle2, speed2, LOOKAHEAD_HORIZON);
			if (this.probe.predReason !== END_EXIT) {
				const profit2 = GravityGame.estimateProfit(this.lookMarket, step2, this.probe);
				const gain2 = this.rule === GravityGame.RULE_MONEY
					? profit2 * 24
					: this.probe.predNewVisits * 8 + profit2 * 12;
				if (gain2 > this.lookBest) this.lookBest = gain2;
			}
			if (lIdx === lookAngles - 1) {
				const total = this.topScore[slot] + LOOKAHEAD_WEIGHT * this.lookBest;
				const aU = this.topAngleU[slot];
				const sU = this.topSpeedU[slot];
				if (this.betterChoice(total, aU, sU)) {
					this.bestScore = total;
					this.bestAngleU = aU;
					this.bestSpeedU = sU;
				}
			}
		}
		return this.finishJob();
	};

	GravityBot.prototype.finishJob = function () {
		const rival = this.actorAt(this.jobRival);
		rival.planReady = true;
		rival.planStep = this.jobRunStep;
		rival.planStamp = this.jobStamp;
		rival.planOrigin = this.jobOrigin;
		rival.planAngleU = this.bestAngleU;
		rival.planSpeedU = this.bestSpeedU;
		this.jobActive = false;
		this.jobRival = -1;
		return true;
	};

	GravityBot.prototype.drainJob = function () {
		while (this.jobActive) this.stepJob(1e9, 1e9);
	};

	GravityBot.prototype.progress = function () {
		if (!this.jobActive) return 1;
		const spec = this.specFor(this.jobRival);
		const total = this.jobPrimaryTotal + (spec.lookahead > 0 ? TOP_K * spec.lookahead : 0);
		if (total <= 0) return 1;
		const done = this.jobPhase === 0 ? this.jobIndex : this.jobPrimaryTotal + this.jobIndex;
		return done / total;
	};

	GravityBot.prototype.thinking = function () {
		return this.jobActive;
	};

	/*
	 * Mirrors the GUI player's flight state into the bot-controlled YOU actor.
	 * Call once at game start and after each GUI flight; the next tickPlayer()
	 * then searches from exactly the planet and purse the GUI will launch with.
	 */
	GravityBot.prototype.syncPlayer = function (sim, ledger, shots, steps, length, doneSteps, runStep) {
		const actor = this.player;
		actor.sim.visited.set(sim.visited);
		actor.sim.visitedCount = sim.visitedCount;
		actor.sim.landedBody = sim.landedBody;
		if (sim.landedBody >= 0) actor.basePlanet = sim.landedBody;
		actor.ledger.purse = ledger.purse;
		actor.shots.length = shots;
		actor.steps = steps;
		actor.length = length;
		actor.doneSteps = doneSteps;
		actor.readyStep = runStep;
		actor.planReady = false;
		actor.planStep = -1;
		actor.planStamp = -1;
		if (this.jobActive && this.jobRival === PLAYER_INDEX) {
			this.jobActive = false;
			this.jobRival = -1;
		}
	};

	GravityBot.prototype.tickPlayer = function (runStep, market, budgetMs) {
		if (this.playerType !== GravityGame.PLAYER_BOT ||
			this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER) return true;
		const actor = this.player;
		if (!this.needsLaunch(actor, runStep)) return true;
		if (this.planValid(actor, runStep, market)) return true;
		if (!this.jobActive || this.jobRival !== PLAYER_INDEX ||
			this.jobRunStep !== runStep || this.jobStamp !== market.stamp) {
			this.beginJob(PLAYER_INDEX, runStep, market);
		}
		return this.stepJob(budgetMs, SLICE_CANDIDATES);
	};

	GravityBot.prototype.playerPlanValid = function (runStep, market) {
		return this.playerType === GravityGame.PLAYER_BOT &&
			this.planValid(this.player, runStep, market);
	};

	/* background pre-thinking while the game clock is paused between flights */
	GravityBot.prototype.tickIdle = function (runStep, market, budgetMs) {
		if (this.rule === GravityGame.RULE_ROUTE) return this.tickRoute(budgetMs);
		if (this.rule === GravityGame.RULE_CAREER) return true;
		if (this.count === 0) return true;
		if (this.jobActive) {
			const r = this.actorAt(this.jobRival);
			if (this.jobRunStep === runStep && this.jobStamp === market.stamp &&
				this.needsLaunch(r, runStep)) {
				return this.stepJob(budgetMs, SLICE_CANDIDATES);
			}
			this.jobActive = false;
			this.jobRival = -1;
		}
		for (let i = 0; i < this.count; i++) {
			if (!this.isRivalBot(i)) continue;
			const rival = this.rivals[i];
			if (!this.needsLaunch(rival, runStep)) continue;
			if (this.planValid(rival, runStep, market)) continue;
			this.beginJob(i, runStep, market);
			return this.stepJob(budgetMs, SLICE_CANDIDATES);
		}
		return true;
	};

	GravityBot.prototype.launchRival = function (rival, capSteps) {
		const angle = GravityGame.angleOf(rival.planAngleU);
		const speed = GravityGame.speedOf(rival.planSpeedU);
		rival.sim.stepLimit = capSteps;
		rival.sim.limitReason = END_TIME;
		rival.shots.push(GravityGame.createShot(
			GravityGame.SRC_PLANETS, rival.planOrigin,
			rival.planAngleU, rival.planSpeedU, GravityGame.NO_ABORT
		));
		rival.sim.launch(rival.planOrigin, angle, speed);
		GravityGame.beginFlight(rival.ledger, rival.sim);
		rival.planReady = false;
	};

	/*
	 * Called before advancing `runStep` -> `runStep + 1`. Ensures any rival due
	 * to launch at `runStep` has finished its decision and launched. When `sync`
	 * is false, runs one slice and returns false while still thinking so live
	 * playback never stalls a frame; when `sync` is true, drains immediately.
	 */
	GravityBot.prototype.prepareStep = function (runStep, market, capSteps, budgetMs, sync) {
		if (this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER ||
			this.count === 0) return true;
		for (let i = 0; i < this.count; i++) {
			if (!this.isRivalBot(i)) continue;
			const rival = this.rivals[i];
			if (!this.needsLaunch(rival, runStep)) continue;
			if (!this.planValid(rival, runStep, market)) {
				if (!this.jobActive || this.jobRival !== i ||
					this.jobRunStep !== runStep || this.jobStamp !== market.stamp) {
					this.beginJob(i, runStep, market);
				}
				if (sync) this.drainJob();
				else if (!this.stepJob(budgetMs, SLICE_CANDIDATES)) return false;
			}
			this.launchRival(rival, capSteps);
		}
		return true;
	};

	/* advances all flying rivals by one exact DT step at `runStep` */
	GravityBot.prototype.stepOne = function (runStep, market) {
		if (this.rule === GravityGame.RULE_ROUTE || this.rule === GravityGame.RULE_CAREER ||
			this.count === 0) return;
		const stage = this.spec().stageSteps;
		const stopOnTour = this.ruleSpec().stopOnTour;
		for (let i = 0; i < this.count; i++) {
			const rival = this.rivals[i];
			if (rival.sim.status !== STATUS_FLYING) continue;
			rival.sim.stepOne();
			rival.steps += 1;
			GravityGame.stepHarvest(rival.ledger, market, rival.sim, runStep);
			if (stopOnTour && rival.sim.visitedCount === PLANETS && rival.doneSteps < 0) {
				rival.doneSteps = rival.steps;
			}
			if (rival.sim.status !== STATUS_FLYING) {
				GravityGame.endFlight(rival.ledger);
				rival.length += rival.sim.flightLength;
				if (rival.sim.landedBody >= 0) rival.basePlanet = rival.sim.landedBody;
				if (this.isRivalBot(i)) rival.readyStep = runStep + stage;
			}
		}
	};

	/* synchronous decision helper for standalone benchmarks */
	GravityBot.prototype.chooseSync = function (rivalIdx, runStep, market) {
		this.beginJob(rivalIdx, runStep, market);
		this.drainJob();
		const r = this.actorAt(rivalIdx);
		return { origin: r.planOrigin, angle: r.planAngleU, speed: r.planSpeedU };
	};

	/*
	 * When the player stalls out broke before completing the rule's goal, rivals
	 * finish their remaining launches synchronously so the final scoreboard
	 * reflects where their run actually ends.
	 */
	GravityBot.prototype.settle = function (startRunStep, market, capSteps) {
		if (this.rule === GravityGame.RULE_CAREER) return startRunStep;
		if (this.rule === GravityGame.RULE_ROUTE) {
			while (!this.routeDone()) this.tickRoute(1e9);
			return startRunStep;
		}
		if (this.count === 0) return startRunStep;
		let step = startRunStep;
		let guard = 0;
		while (guard < 250000) {
			guard += 1;
			this.prepareStep(step, market, capSteps, 1e9, true);
			let active = false;
			for (let i = 0; i < this.count; i++) {
				const r = this.rivals[i];
				if (r.sim.status === STATUS_FLYING ||
					(this.isRivalBot(i) && !this.rivalDone(r))) {
					active = true;
					break;
				}
			}
			if (!active) break;
			step += 1;
			this.stepOne(step, market);
		}
		return step;
	};

	GravityBot.prototype.scoreSteps = function (index) {
		const r = this.actorAt(index);
		if (this.rule === GravityGame.RULE_ROUTE) return r.routeSteps;
		return r.doneSteps >= 0 ? r.doneSteps : r.steps;
	};

	GravityBot.prototype.actorSummary = function (index) {
		const r = this.actorAt(index);
		const isBot = index === PLAYER_INDEX
			? this.playerType === GravityGame.PLAYER_BOT
			: this.isRivalBot(index);
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			return {
				purse: r.ledger.purse,
				visited: career ? career.padCount : 0,
				done: career ? career.ended !== GravityGame.CAREER_OPEN : false,
				length: 0,
				shots: career ? career.flights : 0,
				steps: r.steps,
				origin: career ? career.at : -1,
				reason: END_OPEN,
				body: -1,
				ready: false,
				planning: false
			};
		}
		if (this.rule === GravityGame.RULE_ROUTE) {
			return {
				purse: r.ledger.purse,
				visited: r.routeReady ? r.routeVisits : 0,
				done: isBot ? r.routeDone : r.routeReady,
				length: r.routeReady ? r.routeLength : 0,
				shots: r.routeReady ? 1 : 0,
				steps: r.routeSteps,
				origin: r.routeOrigin,
				reason: r.routeReason,
				body: r.routeBody,
				ready: r.routeReady,
				planning: isBot ? !r.routeDone : r.sim.routeActive
			};
		}
		const flyingLength = r.sim.status === STATUS_FLYING ? r.sim.flightLength : 0;
		return {
			purse: r.ledger.purse,
			visited: r.sim.visitedCount,
			done: r.doneSteps >= 0,
			length: r.length + flyingLength,
			shots: r.shots.length,
			steps: this.scoreSteps(index),
			origin: r.sim.landedBody >= 0 ? r.sim.landedBody : r.basePlanet,
			reason: r.sim.endReason,
			body: r.sim.endBody,
			ready: r.shots.length > 0,
			planning: false
		};
	};

	GravityBot.prototype.rivalLink = function (seed, rate, index, gravityScale, forceScale) {
		const idx = index || 0;
		const r = this.actorAt(idx);
		const route = this.rule === GravityGame.RULE_ROUTE;
		return GravityGame.encodeLink({
			seed: seed,
			rate: rate,
			rule: this.rule,
			bot: GravityGame.BOT_OFF,
			player: GravityGame.PLAYER_USER,
			gravityScale: gravityScale,
			forceScale: forceScale,
			shots: r.shots,
			visited: route ? r.routeVisits : r.sim.visitedCount,
			steps: this.scoreSteps(idx),
			length: route ? r.routeLength : undefined
		});
	};

	/* --- solo career controller ---------------------------------------- */

	const RESEARCH_BRIDGE_RAIL = [52, 0.67];
	const RESEARCH_LIGHT_TANK = [50, 0.45];
	const RESEARCH_LIGHT_ENGINE = [16, 0.85];

	/* Lowest rung above `current` across both the stock table and unlocked
	 * prototypes, breaking ties on cheaper build cost. */
	function careerNextItem(career, kind, table, current) {
		const minTier = current === null ? -Infinity : current.tier;
		let best = null;
		for (let i = 0; i < table.length; i++) {
			const item = table[i];
			if (item.tier <= minTier) continue;
			if (!best || item.tier < best.tier ||
				(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
		}
		const protos = career.prototypes ? career.prototypes[kind] : null;
		for (let i = 0; protos && i < protos.length; i++) {
			const item = protos[i];
			if (item.tier <= minTier) continue;
			if (!best || item.tier < best.tier ||
				(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
		}
		return best;
	}

	function careerPrice(career, item) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : item.buildCost;
	}

	GravityBot.prototype.careerBuyGear = function (career, planet, kind, item, reserve) {
		if (!item || career.ledger.purse + 1e-9 < careerPrice(career, item) + reserve) return false;
		const fresh = kind === OrbitTech.KIND_CATAPULT && career.pads[planet].catapult === null;
		if (!GravityGame.buildGear(career, planet, kind, item)) return false;
		if (fresh) this.careerBuilds += 1;
		else this.careerUpgrades += 1;
		return true;
	};

	/* HQ R&D: unlock a mid-rung bridge rail when pads will need upgrades, then a
	 * lightweight composite tank + thruster kit and fit it for mid-flight burns. */
	GravityBot.prototype.careerResearch = function (career, sim, reserve) {
		if (career.ended !== GravityGame.CAREER_OPEN || career.at !== career.hq) return null;
		const keep = reserve === undefined ? CAREER_PURSE_RESERVE : reserve;
		if (GravityGame.prototypesOf(career, OrbitTech.KIND_CATAPULT).length === 0 &&
			(sim.forceScale < 0.85 || career.ship.hold.capacity >= 8)) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_CATAPULT, RESEARCH_BRIDGE_RAIL);
			const proto = OrbitTech.catapultRecord('R', RESEARCH_BRIDGE_RAIL[0], RESEARCH_BRIDGE_RAIL[1]);
			if (career.ledger.purse + 1e-9 >= fee + careerPrice(career, proto) + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_CATAPULT, RESEARCH_BRIDGE_RAIL, label)) {
					this.careerResearches += 1;
					return OrbitTech.KIND_CATAPULT + ':' + label;
				}
			}
		}
		if (career.ship.tank.tier === 0 &&
			GravityGame.prototypesOf(career, OrbitTech.KIND_TANK).length === 0) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_TANK, RESEARCH_LIGHT_TANK);
			if (career.ledger.purse + 1e-9 >= fee + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_TANK, RESEARCH_LIGHT_TANK, label)) {
					GravityGame.installPart(career, OrbitTech.KIND_TANK,
						GravityGame.prototypeById(career, OrbitTech.KIND_TANK, label));
					this.careerResearches += 1;
					return OrbitTech.KIND_TANK + ':' + label;
				}
			}
		}
		if (career.ship.engine === null && career.ship.tank.fuelCap > 0 &&
			GravityGame.prototypesOf(career, OrbitTech.KIND_ENGINE).length === 0) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_ENGINE, RESEARCH_LIGHT_ENGINE);
			if (career.ledger.purse + 1e-9 >= fee + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_ENGINE, RESEARCH_LIGHT_ENGINE, label)) {
					GravityGame.installPart(career, OrbitTech.KIND_ENGINE,
						GravityGame.prototypeById(career, OrbitTech.KIND_ENGINE, label));
					this.careerResearches += 1;
					return OrbitTech.KIND_ENGINE + ':' + label;
				}
			}
		}
		return null;
	};

	GravityBot.prototype.careerNextPad = function (career) {
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			const target = task.state === GravityGame.TASK_LOADED ? task.to : task.from;
			if (target >= 0 && career.pads[target].catapult === null) return target;
		}
		let best = -1;
		for (let p = 0; p < PLANETS; p++) {
			if (career.pads[p].catapult !== null) continue;
			if (best < 0 || career.light[p] > career.light[best]) best = p;
		}
		return best;
	};

	GravityBot.prototype.careerAccept = function (career) {
		if (career.contract >= 0) return false;
		let best = -1;
		let bestScore = -Infinity;
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			if (!GravityGame.canAccept(career, i)) continue;
			const task = career.tasks[i];
			let score = task.reward - task.tons * 0.02;
			if (task.from === career.at) score += 0.75;
			if (career.pads[task.from].catapult !== null) score += 0.25;
			if (career.pads[task.to].catapult !== null) score += 0.5;
			if (score > bestScore) {
				bestScore = score;
				best = i;
			}
		}
		return best >= 0 && GravityGame.acceptTask(career, best);
	};

	/* Raise the pad's full-battery cap, not its accidentally low current charge. */
	GravityBot.prototype.careerUpgrade = function (career, sim, wantedSpeed, reserve) {
		const planet = career.at;
		if (planet < 0) return false;
		const pad = career.pads[planet];
		if (pad.catapult === null) return false;
		let upgraded = false;
		for (let n = 0; n < 8; n++) {
			const fullLimit = OrbitTech.speedLimit(pad.battery.capacity,
				career.ship.mass, pad.catapult, sim.forceScale);
			if (fullLimit >= wantedSpeed) break;
			const forceLimit = OrbitTech.maxSpeed(career.ship.mass, pad.catapult, sim.forceScale);
			let kind = forceLimit < wantedSpeed ? OrbitTech.KIND_CATAPULT : OrbitTech.KIND_BATTERY;
			let table = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.CATAPULTS : OrbitTech.BATTERIES;
			let item = careerNextItem(career, kind, table, pad[kind]);
			if (!item) {
				kind = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.KIND_BATTERY : OrbitTech.KIND_CATAPULT;
				table = kind === OrbitTech.KIND_CATAPULT ? OrbitTech.CATAPULTS : OrbitTech.BATTERIES;
				item = careerNextItem(career, kind, table, pad[kind]);
			}
			const needed = fullLimit < GravitySim.SPEED_MIN;
			if (!this.careerBuyGear(career, planet, kind, item, needed ? 0 : reserve)) break;
			upgraded = true;
		}
		return upgraded;
	};

	/* All shopping happens while idle: rescue, refit/accept, upgrade, expand. */
	GravityBot.prototype.careerBetweenFlights = function (career, sim) {
		if (career.ended !== GravityGame.CAREER_OPEN) return 0;
		let actions = 0;
		const evacPrice = careerPrice(career, GravityGame.CAREER.evacFee);
		if (career.at < 0) {
			if (career.ledger.purse + 1e-9 >= evacPrice && GravityGame.evacuate(career, sim)) actions += 1;
			return actions;
		}
		/* the commercial EMC lifts a parked ship for its fee, so a padless planet
		 * is no dead end; only a load nothing here can lift needs a rescue */
		if (GravityGame.padLift(career, career.at) + 1e-9 < GravitySim.SPEED_MIN) {
			if (career.contract >= 0) {
				GravityGame.dropContract(career);
				actions += 1;
			} else if (this.careerBuyGear(career, career.at, OrbitTech.KIND_CATAPULT,
				OrbitTech.CATAPULTS[0], 0)) actions += 1;
			else if (career.ledger.purse + 1e-9 >= evacPrice &&
				GravityGame.evacuate(career, sim)) actions += 1;
		}
		if (career.ended !== GravityGame.CAREER_OPEN) return actions;

		/* a pad whose full battery still cannot lift the current ship is a dead
		 * end (heavy cargo, lowered force scale): repair it before shopping */
		if (career.pads[career.at].catapult !== null &&
			GravityGame.padLift(career, career.at) + 1e-9 < GravitySim.SPEED_MIN &&
			this.careerUpgrade(career, sim, GravitySim.SPEED_MIN, 0)) actions += 1;

		if (career.pads[career.at].catapult === null) {
			if (this.careerBuyGear(career, career.at, OrbitTech.KIND_CATAPULT,
				OrbitTech.CATAPULTS[0], 0)) actions += 1;
		}

		if (career.at === career.hq && career.ship.hold === OrbitTech.HOLDS[0]) {
			const hold = OrbitTech.HOLDS[1];
			if (career.ledger.purse + 1e-9 >= careerPrice(career, hold) + CAREER_PURSE_RESERVE &&
				GravityGame.installPart(career, OrbitTech.KIND_HOLD, hold)) actions += 1;
		}
		if (this.careerUseResearch && career.at === career.hq) {
			while (this.careerResearch(career, sim, CAREER_PURSE_RESERVE)) actions += 1;
		}
		if (this.careerAccept(career)) actions += 1;

		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED) {
				if (this.careerUpgrade(career, sim, CAREER_LOADED_SPEED, CAREER_PURSE_RESERVE)) {
					actions += 1;
				}
				if (GravityGame.padLift(career, career.at) + 1e-9 < GravitySim.SPEED_MIN) {
					GravityGame.dropContract(career);
					actions += 1;
				}
			}
		}

		const expansionReserve = CAREER_PURSE_RESERVE +
			(career.ship.hold === OrbitTech.HOLDS[0] ? OrbitTech.HOLDS[1].buildCost : 0);
		while (career.ended === GravityGame.CAREER_OPEN && career.padCount < PLANETS) {
			const planet = this.careerNextPad(career);
			if (planet < 0 || !this.careerBuyGear(career, planet, OrbitTech.KIND_CATAPULT,
				OrbitTech.CATAPULTS[0], expansionReserve)) break;
			actions += 1;
		}
		return actions;
	};

	GravityBot.prototype.careerEnergyWait = function (career, planet, energy) {
		const pad = GravityGame.padAt(career, planet);
		const gain = OrbitTech.solarCharge(pad.panel, career.light[planet], CAREER_WAIT_SECONDS);
		return gain > 0 ? energy / gain : Infinity;
	};

	/* Landing + harvest + contract + solvency value of the trace in `probe`. */
	GravityBot.prototype.careerScoreFlight = function (career, origin, market, runStep, flownLen) {
		const probe = this.probe;
		const body = probe.predBody;
		if (probe.predReason !== END_IMPACT || body < 0) return -Infinity;
		const visitPay = GravityGame.estimateProfit(market, runStep, probe);
		let taskPay = visitPay;
		let cashPay = visitPay;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED && body === task.to) {
				taskPay += task.reward;
				cashPay += task.reward;
			} else if (task.state === GravityGame.TASK_ACCEPTED && body === task.from) {
				taskPay += task.reward * CAREER_PICKUP_VALUE;
			}
		}
		const compete = career.tasks[GravityGame.COMPETE_SLOT];
		const totalLen = (flownLen || 0) + probe.predLength;
		if (compete.kind === GravityGame.TASK_COMPETE && origin === compete.planet &&
			totalLen >= compete.minLength && runStep + probe.predSteps <= compete.deadline) {
			taskPay += compete.reward;
			cashPay += compete.reward;
		}

		/* landing back on the pad it left pays nothing and only drains the
		 * battery: better to wait or shop than to fly a pointless bounce */
		if (body === origin && taskPay <= 0) return -Infinity;
		const own = career.pads[body];
		let padValue;
		if (body === origin) padValue = CAREER_SAME_PAD_VALUE;
		else if (own.catapult !== null) padValue = CAREER_BUILT_PAD_VALUE + (own.catapult.tier - 1) * 0.1;
		else padValue = CAREER_NETWORK_PAD_VALUE - GravityGame.exitCostAt(career, body, career.ship.mass);
		if (body === career.hq && career.at !== career.hq &&
			career.ship.hold === OrbitTech.HOLDS[0] &&
			career.ledger.purse + cashPay + 1e-9 >=
				careerPrice(career, OrbitTech.HOLDS[1]) + CAREER_PURSE_RESERVE) {
			padValue += CAREER_REFIT_VALUE;
		}

		/* a planet without your own EMC is flyable as long as the purse covers
		 * the way off it (commercial fee, a build or the evacuation) */
		if (own.catapult === null && body !== origin) {
			const exit = GravityGame.exitCostAt(career, body, career.ship.mass);
			const build = careerPrice(career, OrbitTech.CATAPULTS[0]);
			const reserve = career.padCount === PLANETS - 1 && exit >= build ? CAREER_PURSE_RESERVE : 0;
			const margin = exit > 0 && Number.isFinite(exit) ? exit * 0.5 : 0;
			if (career.ledger.purse + cashPay + 1e-9 < exit + reserve + margin) return -Infinity;
		}
		this.careerEval.taskPay = taskPay;
		this.careerEval.padValue = padValue;
		return taskPay + padValue;
	};

	/* Scores the trace already in `probe`; `careerEval` exposes its money terms. */
	GravityBot.prototype.careerScoreProbe = function (career, sim, origin, speed, market, runStep) {
		const base = this.careerScoreFlight(career, origin, market, runStep, 0);
		if (!Number.isFinite(base)) return -Infinity;
		const energy = sim.launchEnergy(origin, speed);
		const wait = this.careerEnergyWait(career, origin, energy);
		const fee = GravityGame.launchFee(career, origin, speed);
		this.careerEval.energy = energy;
		this.careerEval.wait = wait;
		this.careerEval.fee = fee;
		return base - energy * wait * CAREER_ENERGY_WAIT_COST - fee;
	};

	GravityBot.prototype.careerTarget = function (career) {
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			return task.state === GravityGame.TASK_LOADED ? task.to : task.from;
		}
		if (career.at !== career.hq && career.ship.hold === OrbitTech.HOLDS[0] &&
			career.ledger.purse + 1e-9 >=
				careerPrice(career, OrbitTech.HOLDS[1]) + CAREER_PURSE_RESERVE) return career.hq;
		const compete = career.tasks[GravityGame.COMPETE_SLOT];
		if (compete.kind === GravityGame.TASK_COMPETE && compete.planet !== career.at &&
			career.pads[compete.planet].catapult !== null) return compete.planet;
		return -1;
	};

	/* Plan only from the ship's built pad; every snapped speed is <= its live cap. */
	GravityBot.prototype.careerPlan = function (career, sim, market, runStep, fallback, angles) {
		const best = this.careerBest;
		best.origin = -1;
		best.score = -Infinity;
		if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
			!sim.canLaunchFrom(career.at)) return null;
		const origin = career.at;
		const limit = sim.speedLimit(origin);
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		if (capU < minU) return null;

		this.probe.fieldT = sim.fieldT;
		this.probe.fieldRate = sim.fieldRate;
		this.careerPlans += 1;
		const target = this.careerTarget(career);
		const requiredBody = career.contract >= 0 ? target : -1;
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.planetY[origin],
				sim.planetX[target] - sim.planetX[origin]) : 0;
		const fan = angles > 0 ? angles : CAREER_ANGLES;
		const horizon = fallback ? GravityGame.CAP_SECONDS : CAREER_HORIZON;
		const extra = target >= 0 && target !== origin ? CAREER_TARGET_OFFSETS * 2 + 1 : 0;
		let previousSpeedU = -1;
		let bestAngleU = 0;
		let bestSpeedU = 0;

		const angleCount = fallback ? Math.round(fan * CAREER_FALLBACK_SCALE) : fan;
		const speedCount = fallback ? CAREER_SPEED_FRACTIONS.length : 4;
		for (let s = 0; s < speedCount; s++) {
			let speedU = Math.round(limit * CAREER_SPEED_FRACTIONS[s] * GravityGame.SPEED_STEPS);
			if (speedU > capU) speedU = capU;
			if (speedU < minU) speedU = minU;
			if (speedU > capU || speedU === previousSpeedU) continue;
			previousSpeedU = speedU;
			const speed = GravityGame.speedOf(speedU);
			for (let a = 0; a < angleCount + extra; a++) {
				let rawAngle;
				if (a < angleCount) rawAngle = (a + 0.5) / angleCount * Math.PI * 2;
				else rawAngle = targetAngle + (a - angleCount - CAREER_TARGET_OFFSETS) * CAREER_TARGET_STEP;
				const angleU = GravityGame.angleUnits(rawAngle);
				const angle = GravityGame.angleOf(angleU);
				this.probe.visited.set(sim.visited);
				this.probe.visitedCount = sim.visitedCount;
				this.probe.predictFast(origin, angle, speed, horizon);
				if (requiredBody >= 0 && this.probe.predBody !== requiredBody) continue;
				const score = this.careerScoreProbe(career, sim, origin, speed, market, runStep);
				const better = score > best.score + 1e-12 ||
					(Math.abs(score - best.score) <= 1e-12 && best.origin >= 0 &&
						(angleU < bestAngleU || (angleU === bestAngleU && speedU < bestSpeedU)));
				if (!better) continue;
				best.origin = origin;
				best.body = this.probe.predBody;
				best.angle = angle;
				best.speed = speed;
				best.score = score;
				best.taskPay = this.careerEval.taskPay;
				best.padValue = this.careerEval.padValue;
				best.energy = this.careerEval.energy;
				best.wait = this.careerEval.wait;
				best.fee = this.careerEval.fee;
				best.steps = this.probe.predSteps;
				bestAngleU = angleU;
				bestSpeedU = speedU;
			}
		}
		return best.origin >= 0 ? best : null;
	};

	/* Mid-flight course-correction search: burns tank fuel only when it beats
	 * coasting and, whenever a contract is active, still lands the contract. */
	GravityBot.prototype.careerBurnPlan = function (career, sim, market, runStep) {
		const best = this.careerBurnBest;
		best.body = -1;
		best.score = -Infinity;
		if (career.ended !== GravityGame.CAREER_OPEN || sim.status !== GravitySim.STATUS_FLYING) {
			return null;
		}
		const limit = sim.burnLimit();
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		if (capU < 1) return null;

		let requiredBody = -1;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			requiredBody = task.state === GravityGame.TASK_LOADED ? task.to : task.from;
		}
		this.probe.predictBurnFast(sim, 0, 0);
		let coastScore = -Infinity;
		if (requiredBody < 0 || this.probe.predBody === requiredBody) {
			coastScore = this.careerScoreFlight(career, sim.origin, market, runStep, sim.flightLength);
		}
		best.coastScore = coastScore;

		const target = requiredBody >= 0 ? requiredBody : this.careerTarget(career);
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.cargo.y, sim.planetX[target] - sim.cargo.x) : 0;
		const extra = target >= 0 ? CAREER_TARGET_OFFSETS * 2 + 1 : 0;
		const ship = career.ship;
		let prevDvU = -1;

		for (let f = 0; f < CAREER_BURN_FRACTIONS.length; f++) {
			let dvU = Math.round(limit * CAREER_BURN_FRACTIONS[f] * GravityGame.SPEED_STEPS);
			if (dvU > capU) dvU = capU;
			if (dvU < 1) dvU = 1;
			if (dvU === prevDvU) continue;
			prevDvU = dvU;
			const dv = GravityGame.speedOf(dvU);
			const fuelKg = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
			const fuelPenalty = fuelKg * CAREER_BURN_FUEL_COST;
			for (let a = 0; a < CAREER_BURN_ANGLES + extra; a++) {
				let rawAngle;
				if (a < CAREER_BURN_ANGLES) rawAngle = (a + 0.5) / CAREER_BURN_ANGLES * Math.PI * 2;
				else rawAngle = targetAngle + (a - CAREER_BURN_ANGLES - CAREER_TARGET_OFFSETS) * CAREER_TARGET_STEP;
				const angleU = GravityGame.angleUnits(rawAngle);
				const angle = GravityGame.angleOf(angleU);
				this.probe.predictBurnFast(sim, angle, dv);
				if (requiredBody >= 0 && this.probe.predBody !== requiredBody) continue;
				const rawScore = this.careerScoreFlight(career, sim.origin, market, runStep, sim.flightLength);
				if (!Number.isFinite(rawScore)) continue;
				const score = rawScore - fuelPenalty;
				if (Number.isFinite(coastScore) && score <= coastScore + CAREER_BURN_MIN_GAIN) continue;
				const better = score > best.score + 1e-12 ||
					(Math.abs(score - best.score) <= 1e-12 && best.body >= 0 &&
						(angleU < best.angleU || (angleU === best.angleU && dvU < best.dvU)));
				if (!better) continue;
				best.body = this.probe.predBody;
				best.angle = angle;
				best.dv = dv;
				best.angleU = angleU;
				best.dvU = dvU;
				best.score = score;
				best.fuelKg = fuelKg;
				best.steps = this.probe.predSteps;
			}
		}
		if (best.body < 0) return null;
		this.careerBurnsPlanned += 1;
		return best;
	};

	/*
	 * Career rivals: each one is a full `GravityGame` career on the shared map —
	 * its own HQ, purse, ship, task board, EMC network and science hull — flown
	 * by the same synchronous controller the benches use. They launch from
	 * whatever EMC stands on their planet (own, a rival's, or the commercial
	 * one), so usage tax flows both ways. The world clock only runs while a ship
	 * flies, so a rival gets its turns during YOUR flight; after landing it sits
	 * out CAREER_RIVAL_GAP world seconds before the next attempt.
	 */
	GravityBot.prototype.startCareers = function (galaxy, seed, trade) {
		for (let i = 0; i < MAX_RIVALS; i++) {
			const r = this.rivals[i];
			r.steps = 0;
			r.shots.length = 0;
			r.readyStep = 0;
			r.idleTries = 0;
			if (i >= this.count) {
				r.career = null;
				continue;
			}
			r.sim.setScales(this.probe.gravityScale, this.probe.forceScale);
			if (!r.career) r.career = GravityGame.createCareer(r.ledger);
			GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(seed, i), trade, null, galaxy);
			r.sim.fieldT = trade.t;
			r.sim.fieldRate = this.probe.fieldRate;
			r.basePlanet = r.career.hq;
		}
	};

	/* one world step for every rival career: charge pads, fly, plan, launch */
	GravityBot.prototype.stepCareer = function (runStep, market, trade, rate) {
		for (let i = 0; i < this.count; i++) {
			const r = this.rivals[i];
			const career = r.career;
			if (!career) continue;
			GravityGame.careerAdvance(career, rate, 1);
			if (r.sim.status === STATUS_FLYING) {
				r.sim.stepOne();
				GravityGame.stepHarvest(r.ledger, market, r.sim, runStep);
				r.steps += 1;
				if (r.sim.status === STATUS_FLYING) continue;
				this.careerLand(r, trade, runStep);
				continue;
			}
			if (career.ended === GravityGame.CAREER_BROKE) {
				if (runStep >= r.readyStep) this.careerRestart(r, i, trade, runStep);
				continue;
			}
			if (career.ended !== GravityGame.CAREER_OPEN || runStep < r.readyStep) continue;
			this.careerLaunch(r, market, trade, rate, runStep);
		}
	};

	GravityBot.prototype.careerLaunch = function (r, market, trade, rate, runStep) {
		const career = r.career;
		const sim = r.sim;
		const angles = this.spec().careerAngles;
		let plan = career.at < 0 ? null : this.careerPlan(career, sim, market, runStep, false, angles);
		if (!plan && career.at >= 0) {
			plan = this.careerPlan(career, sim, market, runStep, true, angles);
		}
		if (!plan) {
			/* a park no trajectory leaves is a dead end: fly home after a couple of tries */
			const evac = careerPrice(career, GravityGame.CAREER.evacFee);
			if (career.stranded && r.idleTries >= 2 && career.ledger.purse + 1e-9 >= evac) {
				r.idleTries = 0;
				GravityGame.evacuate(career, sim);
			} else {
				r.idleTries += 1;
			}
			this.careerBetweenFlights(career, sim);
			r.readyStep = runStep + CAREER_RIVAL_GAP;
			return false;
		}
		r.idleTries = 0;
		sim.fieldT = trade.t;
		sim.fieldRate = rate;
		sim.stepLimit = GravityGame.CAP_STEPS;
		sim.limitReason = END_TIME;
		r.shots.push(GravityGame.createShot(GravityGame.SRC_PLANETS, plan.origin,
			GravityGame.angleUnits(plan.angle), GravityGame.speedUnits(plan.speed), GravityGame.NO_ABORT));
		sim.launch(plan.origin, plan.angle, plan.speed);
		GravityGame.careerBeginFlight(career, sim);
		r.basePlanet = plan.origin;
		return true;
	};

	GravityBot.prototype.careerLand = function (r, trade, runStep) {
		GravityGame.careerEndFlight(r.career, r.sim, trade, runStep);
		r.basePlanet = r.career.at;
		r.readyStep = runStep + CAREER_RIVAL_GAP;
		r.idleTries = 0;
		this.careerBetweenFlights(r.career, r.sim);
	};

	/* a company that runs out of money is wound up and refinanced at its old HQ,
	 * so the shared map never empties out of rival players */
	GravityBot.prototype.careerRestart = function (r, index, trade, runStep) {
		GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(this.seed, index), trade,
			null, r.career.galaxy);
		r.basePlanet = r.career.hq;
		r.shots.length = 0;
		r.readyStep = runStep + CAREER_REBOOT_GAP;
		r.idleTries = 0;
	};

	GravityBot.prototype.careerReady = function (index) {
		const career = this.rivals[index] ? this.rivals[index].career : null;
		return Boolean(career) && career.ended === GravityGame.CAREER_OPEN;
	};

	GravityBot.LEVELS = LEVELS;
	GravityBot.MAX_RIVALS = MAX_RIVALS;
	GravityBot.PLAYER_INDEX = PLAYER_INDEX;
	GravityBot.SLICE_CANDIDATES = SLICE_CANDIDATES;
	GravityBot.CAREER_WAIT_SECONDS = CAREER_WAIT_SECONDS;
	GravityBot.CAREER_RIVAL_GAP = CAREER_RIVAL_GAP;
	GravityBot.CAREER_REBOOT_GAP = CAREER_REBOOT_GAP;
	GravityBot.CAREER_PURSE_RESERVE = CAREER_PURSE_RESERVE;
	GravityBot.CAREER_ENERGY_WAIT_COST = CAREER_ENERGY_WAIT_COST;

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityBot;
	else root.GravityBot = GravityBot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
