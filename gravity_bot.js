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
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js')
		: root.OrbitEcon;

	const PLANETS = OrbitWorld.PLANETS;
	const MAX_RIVALS = 16;
	const PLAYER_INDEX = MAX_RIVALS;
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
	const TAU = Math.PI * 2;
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
	const CAREER_EXIT_ANGLES = 8;
	const CAREER_EXIT_SPEED_FRACTIONS = [0, 1 / 3, 2 / 3, 1];
	const CAREER_EXIT_CACHE_WAYS = 32;
	const CAREER_FALLBACK_SCALE = 2.25;
	const CAREER_HORIZON = 45;
	const CAREER_REFINE_HORIZON = 90;
	const CAREER_REFINE_OFFSETS = [-1 / 4, -1 / 12, 1 / 12, 1 / 4];
	const CAREER_REFINE_SEEDS = 3;
	const CAREER_SPEED_FRACTIONS = [0.38, 0.55, 0.72, 0.86, 1];
	const CAREER_TARGET_OFFSETS = 4;
	const CAREER_TARGET_STEP = 0.035;
	/* game seconds one press of `wait` moves the clock; the pads see
	 * SUN_SEC_PER_GAME_SEC times as much sunlight */
	const CAREER_WAIT_SECONDS = GravitySim.WAIT_SEC;
	const CAREER_ENERGY_WAIT_COST = 0.04;
	const CAREER_BUILT_PAD_VALUE = 2.5;
	const CAREER_NETWORK_PAD_VALUE = 4;
	/* A well that needs a stronger first rail is a more expensive claim. */
	const CAREER_STEEP_PAD_VALUE = 2;
	/* a rival or rebel rail: a landing, a usage tax, and no claim on the planet */
	const CAREER_FOREIGN_PAD_VALUE = 1;
	/* an own pad lands full: its panel charges while the ship flies. A few
	 * seconds of flight cannot refill a shot that is bigger than the battery
	 * holds, so the exit an own pad promises must be the one it will have when
	 * the ship arrives. Over a long flight the panel is given its sunlight;
	 * a long flight is also long pad time, so the charge can reach the cap. */
	const CAREER_PAD_SUN_SECONDS = 30;
	const CAREER_GRAVITY_COST = 1.5;
	/* breadth of one launch counts toward a pad's worth: sunlight alone would
	 * put EMCs in wells the starter rail cannot leave, and those never earn */
	const CAREER_REACH_VALUE = 0.4;
	const CAREER_SITE_BONUS = 0.5;
	/* pad gear is bought for what it earns, not only for the next departure: a
	 * rung has to pay its price back inside this much pad time on the pad it
	 * upgrades, measured against the money that pad's last launch made */
	const CAREER_PAD_HORIZON = 2400;
	/* a medical mission is worth chasing (0.5.13: it outranks a plain
	 * delivery): the reward is per patient, the medic leg lands on a planet
	 * paying the 4x fly-by ramp, and the quelled planet turns that ramp back
	 * into normal trade — the rebellion is a contest the rivals should play,
	 * not a tax they pay */
	const CAREER_MEDIC_VALUE = 2.5;
	/* Game steps, not shopping passes, before revisiting an unreachable board. */
	const CAREER_ACCEPT_HOLD = Math.round(30 / GravitySim.DT);
	/* no shot and no affordable departure for this many tries = a dead end */
	const CAREER_STUCK_TRIES = 4;
	/* The horizon a panel is priced over: a starter panel cannot open an
	 * interplanetary shot inside the ordinary sit budget, and that is exactly
	 * the pad worth refitting. */
	const CAREER_RECHARGE_TRIES = 8;
	/* a target another company is already queued for is worth this much less:
	 * the first to queue harvests the landing, the second lands on a paid visit */
	const CAREER_CONTESTED_COST = 2;
	/* a rival takes the rulers' money on a planet that is already rotten, or
	 * when another company is about to fly out of it: corruption is not a gift
	 * the bot hands to clean worlds for pocket change */
	const CAREER_BRIBE_ROT = 25;
	/* how likely this rival is to take the rulers' money when it lands; the
	 * human decides for themselves, so the roll belongs to the bot's persona */
	const CAREER_BRIBE_PRONE = 0.5;
	/* a bribe worth this much is taken on any planet: the rulers of a rich
	 * world pay to be left alone, and only the arrest roll prices the risk */
	const CAREER_BRIBE_PAY = 2;
	/* a career rival launches again after this much world time, and keeps this
	 * much purse back for the commercial EMC's fee when shopping; the phase
	 * staggers the companies so they never all plan on the same world step */
	const CAREER_RIVAL_GAP = Math.round(8 / GravitySim.DT);
	const CAREER_RIVAL_PHASE = Math.round(3 / GravitySim.DT);
	/* one way off any planet, priced honestly: the cheapest commercial shot
	 * (a dry starter ship at the minimum speed on the starter rail) */
	const CAREER_PURSE_RESERVE = GravityGame.commercialMinFee();

	function careerRefundEscrow(career) {
		let escrow = 0;
		if (career.contract >= 0) escrow += career.tasks[career.contract].capitalRefund || 0;
		escrow += career.tasks[GravityGame.COMPETE_SLOT].capitalRefund || 0;
		return escrow;
	}
	/* pads after which the contract board is worth the 1.5 t hold */
	const CAREER_HOLD_PADS = 2;
	const CAREER_LOADED_SPEED = 75;
	/* a rival services its ship early, so it rarely flies down to 0 */
	const CAREER_REPAIR_AT = 0.7;
	/* Mid-flight impulse policy. The drive's single burn is small (thrust ×
	 * BURN_SEC / wet mass ≈ 10-30 px/s), so it is worth one early nudge that
	 * re-targets the whole flight, then only rescues of a coast that would be
	 * lost. The search is a coarse ring at two Δv rungs plus a fine fan around
	 * the winner: sharper than a dense full-circle fan and cheaper. */
	const CAREER_BURN_ANGLES = 12;
	const CAREER_BURN_FRACTIONS = [0.5, 1];
	const CAREER_BURN_REFINE = 4;
	/* A nudge has to buy a pad's worth of value: the landing score is partly an
	 * estimate of what a pad will earn later, so a small modeled gain is noise
	 * (measured: a 0.75 bar nudged every flight and lost money on the hostile
	 * scaled world, a 2.0 bar was never worse than coasting). Rescues need no
	 * margin — any landing beats a lost ship. */
	const CAREER_BURN_MIN_GAIN = 2;
	const CAREER_BURN_AT = 24;
	const CAREER_BURN_EVERY = 120;
	const CAREER_BURN_TAIL = 12;
	const CAREER_BURNS_MAX = 2;
	/* Launch pricing re-flies the fan's best few shots with the same one-burn
	 * policy the flight uses, so a fitted drive changes which shot is queued,
	 * not just how the queued shot lands. */
	const CAREER_BURN_PRICE_TOP = 3;
	const CAREER_BURN_PRICE_MARGIN = 0.5;
	/* A dead-end rescue is rarer than shortlist pricing, so it may spend a
	 * small ring of launch aims on the same one-burn search. Two speed rungs,
	 * 16 ring bearings and two contract bearings bound it to 36 launches. */
	const CAREER_RESCUE_ANGLES = 16;
	const CAREER_RESCUE_SPEED_FRACTION = 0.6;
	const CAREER_RESCUE_SHOTS = (CAREER_RESCUE_ANGLES + 2) * 2;
	/* coast + coarse ring + refinement, with the contract bearings present */
	const CAREER_BURN_PLAN_TRACES = 1 + CAREER_BURN_FRACTIONS.length *
		(CAREER_BURN_ANGLES + 2 + 2 * CAREER_BURN_REFINE + 1);
	/* Only a high-scoring AND profitable book shot can skip the fan. */
	const CAREER_BOOK_ENOUGH = 6;
	const CAREER_BOOK_EXPLORE_EVERY = 4;
	const CAREER_BOOK_MIN_NET = CAREER_PURSE_RESERVE;
	/* below this a plan is a donation unless it lands where an EMC can be built */
	const CAREER_MIN_SCORE = 0;
	/* patient companies: sit out this much world time, but never more than
	 * CAREER_SIT_TRIES times in a row */
	const CAREER_SIT_GAP = Math.round(30 / GravitySim.DT);
	const CAREER_SIT_TRIES = 4;
	const PRED_LOG_MAX = GravitySim.PRED_LOG_MAX;
	/* decisions are rare, so the trace keeps whole lines and stays bounded */
	const TRACE_MAX = 240;
	const BOARD_TICK_STEPS = Math.round(1 / GravitySim.DT);

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
			gapPhase: 0,
			idleTries: 0,
			waitTries: 0,
			turret: null,
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
			routeBody: -1,
			burn: 0,
			burnTries: 0,
			burnNext: CAREER_BURN_AT,
			burnStep: 0
		};
	}

	function GravityBot(worldW, worldH) {
		this.worldW = worldW;
		this.worldH = worldH;
		this.tradeSim = null;
		this.probe = new GravitySim(worldW, worldH);
		this.exitProbe = new GravitySim(worldW, worldH);
		/* a shot is re-flown to the nudge step before its price is decided */
		this.burnShotSim = new GravitySim(worldW, worldH);
		this.departureSourceSim = null;
		this.departureFieldVersion = 0;
		this.careerExit = {
			ok: false, physical: false, builds: false, canBuildStarter: false,
			starterCanExit: false, cost: Infinity, speed: 0, source: '',
			catapult: null, battery: null, reason: ''
		};
		const exitCacheSize = PLANETS * CAREER_EXIT_CACHE_WAYS;
		this.careerExitCacheStamp = new Uint32Array(exitCacheSize);
		this.careerExitCacheCap = new Int32Array(exitCacheSize);
		this.careerExitCacheCap.fill(-1);
		this.careerExitCacheSpeed = new Float64Array(exitCacheSize);
		/* how many systems one launch reaches from a planet: the breadth a pad
		 * adds to the network, cached exactly like the exit check */
		this.careerReachCacheStamp = new Uint32Array(exitCacheSize);
		this.careerReachCacheCap = new Int32Array(exitCacheSize);
		this.careerReachCacheCap.fill(-1);
		this.careerReachCacheCount = new Int16Array(exitCacheSize);
		this.careerReachMark = new Uint8Array(PLANETS);
		this.worldW = worldW;
		this.worldH = worldH;
		this.strength = new Float64Array(PLANETS).fill(1);
		this.rivals = [createRival(worldW, worldH), createRival(worldW, worldH)];
		/* the GUI's own actor when YOU is set to bot; its sim mirrors the GUI sim */
		this.player = createRival(worldW, worldH);
		/* YOU as a career bot: the page owns the career record, the ship sim and
		 * the flight, so this actor only plans and shops between flights */
		this.careerPlayer = { career: null, sim: null, plan: {
			origin: -1, angle: 0, speed: 0, body: -1, score: -Infinity,
			taskPay: 0, padValue: 0, fee: 0, builds: false, fromBook: false,
			burnGain: 0, burnBody: -1
		}, idleTries: 0, waitTries: 0, readyStep: 0, gapPhase: 0, index: PLAYER_INDEX,
			burn: 0, burnTries: 0, burnNext: CAREER_BURN_AT, burnStep: 0 };
		for (let i = 0; i < this.rivals.length; i++) this.rivals[i].index = i;
		this.player.index = PLAYER_INDEX;

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
			origin: -1, body: -1, angleU: 0, speedU: 0, angle: 0, speed: 0,
			score: -Infinity, taskPay: 0, cashNet: 0, leg: GravityGame.LEG_NONE,
			padValue: 0, energy: 0, wait: 0, fee: 0,
			exitCost: Infinity, exitSource: '', fromBook: false,
			builds: false, length: 0, steps: 0, burnGain: 0, burnBody: -1,
			fuelKg: 0, fuelProducedKg: 0, fuelBoughtKg: 0
		};
		this.careerSparePlan = {
			origin: -1, body: -1, angleU: 0, speedU: 0, angle: 0, speed: 0,
			score: -Infinity, taskPay: 0, cashNet: 0, leg: GravityGame.LEG_NONE,
			padValue: 0, energy: 0, wait: 0, fee: 0,
			exitCost: Infinity, exitSource: '', fromBook: false,
			builds: false, length: 0, steps: 0, burnGain: 0, burnBody: -1,
			fuelKg: 0, fuelProducedKg: 0, fuelBoughtKg: 0
		};
		this.careerFuelQuote = { kg: 0, produceKg: 0, buyKg: 0 };
		this.careerBurnBest = {
			body: -1, angle: 0, dv: 0, angleU: 0, dvU: 0,
			score: -Infinity, coastScore: -Infinity, fuelKg: 0, steps: 0,
			taskPay: 0, cashNet: 0, leg: GravityGame.LEG_NONE, padValue: 0, builds: false, bribe: 0,
			exitCost: Infinity, exitSource: ''
		};
		/* the fan's best few shots, kept for the one-burn re-price */
		this.careerBurnTop = careerAimList(CAREER_BURN_PRICE_TOP);
		this.careerRefineTop = careerAimList(CAREER_REFINE_SEEDS);
		/* the winning burn-priced shot, copied out of careerBurnBest */
		this.careerBurnShot = {
			body: -1, angleU: 0, speedU: 0, score: -Infinity, burnGain: 0,
			taskPay: 0, cashNet: 0, leg: GravityGame.LEG_NONE,
			padValue: 0, fee: 0, energy: 0, wait: 0, bribe: 0,
			exitCost: Infinity, exitSource: '', builds: false, fromBook: false,
			fuelKg: 0, steps: 0
		};
		this.careerRescueAngles = {
			count: 0, angleU: new Int32Array(CAREER_RESCUE_ANGLES + 2)
		};
		this.careerRescueRungs = new Int32Array(2);
		this.careerBurnRungs = new Int32Array(CAREER_BURN_FRACTIONS.length);
		this.careerEval = {
			taskPay: 0, cashNet: 0, padValue: 0, builds: false, energy: 0, wait: 0,
			fee: 0, exitCost: Infinity, exitSource: '', reject: '',
			cash: 0, credit: 0, leg: GravityGame.LEG_NONE, bribe: 0
		};
		/* the landing a visit-log walk prices the rulers' offer from */
		this.careerLanding = { body: -1, value: 0 };
		/* the winning trace's visit log, copied before the fan moves on */
		this.careerLogPlanet = new Int32Array(PRED_LOG_MAX);
		this.careerLogStep = new Int32Array(PRED_LOG_MAX);
		this.careerLogDwell = new Int32Array(PRED_LOG_MAX);
		this.careerLogCount = 0;
		/* Pre-launch burn pricing includes visits made before the impulse. */
		this.careerBurnPrefix = {
			sim: null, count: 0,
			planet: new Int32Array(PRED_LOG_MAX), step: new Int32Array(PRED_LOG_MAX),
			dwell: new Int32Array(PRED_LOG_MAX),
			open: new Int32Array(GravitySim.MAX_BODIES),
			joinedPlanet: new Int32Array(PRED_LOG_MAX * 2), joinedStep: new Int32Array(PRED_LOG_MAX * 2),
			joinedDwell: new Int32Array(PRED_LOG_MAX * 2)
		};
		this.careerBuilds = 0;
		this.careerUpgrades = 0;
		this.careerResearches = 0;
		this.careerPadGearBought = 0;
		this.careerGear = {
			value: 0, rate: 0, cost: 0,
			kind: '', item: null, mate: null, label: ''
		};
		this.careerUseResearch = false;
		/* a nudge must beat coasting by this much; rescues need no margin */
		this.careerBurnGain = CAREER_BURN_MIN_GAIN;
		this.careerBurnPriceMargin = CAREER_BURN_PRICE_MARGIN;
		this.careerPlans = 0;
		this.careerBurnsPlanned = 0;
		this.careerBurnPrices = 0;
		this.careerBurnRescues = 0;
		this.careerFuelTopUps = 0;
		/* per-attempt diagnostics: counters only, no fan-loop allocations */
		this.careerScan = {
			step: -1, tried: 0, impacts: 0, finite: 0, bounce: 0, exit: 0,
			noImpact: 0, book: 0, busy: 0, burn: 0, rescue: 0
		};
		/* bounded decision trace and the last line per actor */
		this.trace = [];
		this.traceRevision = 0;
		this.traceByActor = Array.from({ length: MAX_RIVALS + 2 }, () => []);
		this.lastDecision = new Array(MAX_RIVALS + 1).fill('');
		this.worldStep = 0;

		const self = this;
		this.fillPlanets = function (t, outX, outY, count) {
			const sim = self.tradeSim;
			for (let i = 0; i < count; i++) {
				outX[i] = sim.planetX[i];
				outY[i] = sim.planetY[i];
			}
		};
	}

	/* --- decision trace ------------------------------------------------- */

	function worldClock(step) {
		return 't+ ' + (step * GravitySim.DT).toFixed(1);
	}

	function signed(value) {
		if (!Number.isFinite(value)) return String(value);
		return (value >= 0 ? '+' : '') + value.toFixed(2);
	}

	function burnNote(plan) {
		return plan.burnGain > 0 ? ' · burn ' + signed(plan.burnGain) +
			' → P' + plan.burnBody : '';
	}

	function actorLabel(index) {
		if (index < 0) return 'page';
		return index === PLAYER_INDEX ? 'YOU' : 'R' + (index + 1);
	}

	/* Galaxy career indices include YOU at 0; bot trace indices put YOU last. */
	function careerTraceIndex(career) {
		return career.index === 0 ? PLAYER_INDEX : career.index - 1;
	}

	/* flat fees are numbers; `careerPrice` reads item.buildCost and must not be
	 * handed one (an undefined price made every evacuation unaffordable) */
	function careerFee(career, value) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : value;
	}

	GravityBot.prototype.traceAdd = function (index, decision, detail, step, move) {
		const line = '[' + worldClock(step) + '] ' + actorLabel(index) + ' ' + decision +
			(detail ? ' · ' + detail : '');
		this.trace.push(line);
		this.traceRevision += 1;
		if (this.trace.length > TRACE_MAX) this.trace.shift();
		const bucket = this.traceByActor[index < 0 ? MAX_RIVALS + 1 : index];
		if (bucket) {
			bucket.push({ order: this.traceRevision, line: line });
			if (bucket.length > TRACE_MAX) bucket.shift();
		}
		if (index >= 0 && index < this.lastDecision.length) this.lastDecision[index] = line;
		if (this.onCareerTrace && this.rule === GravityGame.RULE_CAREER && index >= 0) {
			this.onCareerTrace(index, decision, detail, step, move);
		}
	};

	GravityBot.prototype.traceReset = function () {
		this.trace.length = 0;
		for (const bucket of this.traceByActor) bucket.length = 0;
		for (let i = 0; i < this.lastDecision.length; i++) this.lastDecision[i] = '';
	};

	GravityBot.prototype.traceHeaders = function (step, selected) {
		const actors = [];
		for (let i = 0; i < this.count; i++) {
			if (selected ? selected.includes(i) : this.isRivalBot(i)) {
				actors.push(this.actorStatus(i, step));
			}
		}
		if (selected ? selected.includes(PLAYER_INDEX) : this.playerType === GravityGame.PLAYER_BOT) {
			if (this.rule === GravityGame.RULE_CAREER) {
				if (this.careerPlayer.career) actors.push(this.careerPlayerStatus(step));
			} else {
				actors.push(this.actorStatus(PLAYER_INDEX, step));
			}
		}
		return actors;
	};

	/* the log line for YOUR company when the page has handed it to the bot */
	GravityBot.prototype.careerPlayerStatus = function (step) {
		const p = this.careerPlayer;
		const career = p.career;
		const flying = p.sim && p.sim.status === STATUS_FLYING;
		let state = 'ready';
		if (career.ended !== GravityGame.CAREER_OPEN) {
			state = career.ended === GravityGame.CAREER_BROKE ? 'broke' : 'complete';
		} else if (flying) state = 'flying';
		else if (step < p.readyStep) {
			state = p.waitTries > 0 ? 'sitting ' + p.waitTries + '/' + CAREER_SIT_TRIES : 'gap';
		}
		return 'YOU · ' + state + ' · ' + (career.at < 0 ? 'in space' : 'P' + career.at) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount +
			' pads · ' + career.flights + ' flights\n    ' +
			GravityGame.railText(career, p.sim, career.at);
	};

	/* the copyable log: live state first, then the newest decisions */
	GravityBot.prototype.decisionLog = function (step, header, selected) {
		const lines = ['gravity cargo · bot decisions', header || '', ''];
		const states = this.traceHeaders(step, selected);
		for (let i = 0; i < states.length; i++) lines.push(states[i]);
		let decisions = this.trace;
		if (selected) {
			const entries = this.traceByActor[MAX_RIVALS + 1].slice();
			for (const actor of selected) {
				if (this.traceByActor[actor]) entries.push(...this.traceByActor[actor]);
			}
			entries.sort((a, b) => a.order - b.order);
			decisions = entries.map(entry => entry.line);
		}
		lines.push('', 'decisions (' + decisions.length + (selected ? ' · last ' + TRACE_MAX +
			' per checked bot' : ' of the last ' + TRACE_MAX) + ', newest last):');
		if (decisions.length === 0) lines.push('(none yet · the world clock may be paused)');
		else lines.push(...decisions);
		return lines.join('\n');
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
			(rival.sim.visitedCount + newVisits >= (this.planetUniverseCount || PLANETS));
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
			/* a spawn-inside row is not an encounter under the entry rule, so
			 * it must not stamp the follow-up's market either */
			if (this.probe.predLogStep[i] === 0) continue;
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
		const who = this.jobRival;
		const rival = this.actorAt(who);
		this.traceAdd(who, 'plan', 'P' + this.jobOrigin + ' → angle ' +
			GravityGame.angleOf(this.bestAngleU).toFixed(2) + ' v' +
			GravityGame.speedOf(this.bestSpeedU).toFixed(0) + ' · score ' +
			signed(this.bestScore) + ' · ' + this.jobIndex + ' candidates', this.jobRunStep);
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
		this.worldStep = runStep;
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

	GravityBot.prototype.launchRival = function (rival, capSteps, runStep) {
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
		this.traceAdd(rival.index, 'launch', 'P' + rival.planOrigin + ' angle ' +
			angle.toFixed(2) + ' v' + speed.toFixed(0) + ' · purse ' +
			rival.ledger.purse.toFixed(2), runStep === undefined ? this.jobRunStep : runStep);
	};

	/*
	 * Called before advancing `runStep` -> `runStep + 1`. Ensures any rival due
	 * to launch at `runStep` has finished its decision and launched. When `sync`
	 * is false, runs one slice and returns false while still thinking so live
	 * playback never stalls a frame; when `sync` is true, drains immediately.
	 */
	GravityBot.prototype.prepareStep = function (runStep, market, capSteps, budgetMs, sync) {
		this.worldStep = runStep;
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
			this.launchRival(rival, capSteps, runStep);
		}
		return true;
	};

	/* advances all flying rivals by one exact DT step at `runStep` */
	GravityBot.prototype.stepOne = function (runStep, market) {
		this.worldStep = runStep;
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
			if (stopOnTour && rival.sim.visitedCount === (this.planetUniverseCount || PLANETS) && rival.doneSteps < 0) {
				rival.doneSteps = rival.steps;
			}
			if (rival.sim.status !== STATUS_FLYING) {
				GravityGame.endFlight(rival.ledger);
				rival.length += rival.sim.flightLength;
				if (rival.sim.landedBody >= 0) rival.basePlanet = rival.sim.landedBody;
				if (this.isRivalBot(i)) rival.readyStep = runStep + stage;
				if (this.isRivalBot(i)) this.traceAdd(i, 'land',
					(rival.sim.endReason === END_IMPACT
						? 'P' + rival.sim.endBody : rival.sim.endReason === END_EXIT
							? 'left the map' : 'flight cap') +
					' · purse ' + rival.ledger.purse.toFixed(2) + ' · ' +
					rival.sim.visitedCount + ' systems · ' + this.rivalDoneWhy(rival), runStep);
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

	GravityBot.prototype.rivalLink = function (seed, rate, index, gravityScale, forceScale, spaceWearScale, harvestTick) {
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
			spaceWearScale: spaceWearScale,
			harvestTick: harvestTick,
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

	GravityBot.prototype.prepareCareerExitProbe = function (sourceSim) {
		const sim = this.exitProbe;
		if (!sourceSim) sourceSim = this.probe;
		sim.fieldT = sourceSim.fieldT;
		sim.fieldRate = sourceSim.fieldRate;
		sim.setScales(sourceSim.gravityScale, sourceSim.forceScale);
		if (this.departureSourceSim !== sourceSim || sim.bodyCount !== sourceSim.bodyCount ||
			sim.bodyR !== sourceSim.bodyR || sim.strength !== sourceSim.strength ||
			sim.fillField !== sourceSim.fillField || sim.fieldStatic !== sourceSim.fieldStatic) {
			sim.setField(sourceSim.bodyCount, sourceSim.bodyR, sourceSim.strength,
				sourceSim.fillField, sourceSim.fieldStatic);
			sim.setPlanetMask(sourceSim.planetMask);
			this.departureSourceSim = sourceSim;
			this.departureFieldVersion += 1;
		}
	};

	GravityBot.prototype.careerExitFieldStamp = function () {
		const sim = this.exitProbe;
		const trade = this.tradeSim;
		let stamp = 0x811c9dc5;
		stamp = Math.imul(stamp ^ sim.bodyCount, 0x01000193);
		stamp = Math.imul(stamp ^ this.departureFieldVersion, 0x01000193);
		stamp = Math.imul(stamp ^ (sim.fieldStatic ? 1 : 0), 0x01000193);
		for (let i = 0; i < sim.bodyCount; i++) {
			stamp = Math.imul(stamp ^ (Math.round(sim.strength[i] * 100) + i * 31), 0x01000193);
		}
		for (let i = 0; i < sim.planetCount; i++) {
			stamp = Math.imul(stamp ^ (sim.planetMask ? sim.planetMask[i] : 1), 0x01000193);
		}
		stamp = Math.imul(stamp ^ Math.round(sim.gravityScale * 100), 0x01000193);
		stamp = Math.imul(stamp ^ Math.round(sim.fieldRate * 1000), 0x01000193);
		stamp = Math.imul(stamp ^ ((trade ? trade.seed : this.seed) >>> 0), 0x01000193);
		if (!sim.fieldStatic) stamp = Math.imul(stamp ^ Math.round(sim.fieldT * 120), 0x01000193);
		return stamp >>> 0;
	};

	/* Eight bearings × four snapped speeds keep one cached exit check inexpensive. */
	GravityBot.prototype.careerExitSpeed = function (planet, cap) {
		if (!Number.isFinite(cap) || !this.exitProbe.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * GravityGame.SPEED_STEPS;
		let capU = Math.floor(cap * GravityGame.SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * GravityGame.SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		const stamp = this.careerExitFieldStamp();
		const slot = planet * CAREER_EXIT_CACHE_WAYS + capU % CAREER_EXIT_CACHE_WAYS;
		if (this.careerExitCacheCap[slot] === capU &&
			this.careerExitCacheStamp[slot] === stamp) return this.careerExitCacheSpeed[slot];

		let found = 0;
		let previous = -1;
		const span = capU - minU;
		for (let f = 0; f < CAREER_EXIT_SPEED_FRACTIONS.length; f++) {
			const speedU = f === CAREER_EXIT_SPEED_FRACTIONS.length - 1
				? capU : minU + Math.round(span * CAREER_EXIT_SPEED_FRACTIONS[f]);
			if (speedU === previous) continue;
			previous = speedU;
			const speed = speedU / GravityGame.SPEED_STEPS;
			for (let a = 0; a < CAREER_EXIT_ANGLES; a++) {
				const angle = (a + 0.5) / CAREER_EXIT_ANGLES * TAU;
				this.exitProbe.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
				if (this.exitProbe.predReason !== END_IMPACT ||
					this.exitProbe.predBody < 0 || this.exitProbe.predBody === planet) continue;
				found = speed;
				break;
			}
			if (found > 0) break;
		}
		this.careerExitCacheCap[slot] = capU;
		this.careerExitCacheStamp[slot] = stamp;
		this.careerExitCacheSpeed[slot] = found;
		return found;
	};

	/* Distinct other systems one launch from `planet` reaches at `cap`: the
	 * breadth the pad adds to the network. A starter rail in a deep well leaves
	 * for one or two neighbours at best, which is why sunlight alone must not
	 * decide where an EMC is built. Same cache shape as the exit check. */
	GravityBot.prototype.careerReach = function (planet, cap) {
		if (!Number.isFinite(cap) || !this.exitProbe.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * GravityGame.SPEED_STEPS;
		let capU = Math.floor(cap * GravityGame.SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * GravityGame.SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		const stamp = this.careerExitFieldStamp();
		const slot = planet * CAREER_EXIT_CACHE_WAYS + capU % CAREER_EXIT_CACHE_WAYS;
		if (this.careerReachCacheCap[slot] === capU &&
			this.careerReachCacheStamp[slot] === stamp) return this.careerReachCacheCount[slot];
		const speed = capU / GravityGame.SPEED_STEPS;
		const mark = this.careerReachMark;
		mark.fill(0);
		let count = 0;
		for (let a = 0; a < CAREER_EXIT_ANGLES; a++) {
			const angle = (a + 0.5) / CAREER_EXIT_ANGLES * TAU;
			this.exitProbe.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
			if (this.exitProbe.predReason !== END_IMPACT) continue;
			const body = this.exitProbe.predBody;
			if (body < 0 || body === planet || mark[body]) continue;
			mark[body] = 1;
			count += 1;
		}
		this.careerReachCacheCap[slot] = capU;
		this.careerReachCacheStamp[slot] = stamp;
		this.careerReachCacheCount[slot] = count;
		return count;
	};

	GravityBot.prototype.careerArrivalMass = function (career, planet) {
		let mass = career.ship.mass;
		if (career.contract < 0) {
			const medic = career.tasks[GravityGame.MEDIC_SLOT];
			if (planet === career.capitalPlanet && medic.kind === GravityGame.TASK_MEDIC &&
				medic.medics > 0) {
				return OrbitTech.shipMass(career.ship, medic.medics);
			}
			return mass;
		}
		const task = career.tasks[career.contract];
		if (task.kind === GravityGame.TASK_MEDIC) {
			const market = career.market;
			if (task.aboard === 0 && planet === task.to) {
				const picked = market ? Math.min(task.medics, market.patients[task.to]) : task.medics;
				return OrbitTech.shipMass(career.ship, picked);
			}
			if (task.aboard > 0 && planet === career.capitalPlanet) {
				const left = market && market.patients[task.to] > task.aboard
					? market.patients[task.to] - task.aboard : 0;
				return OrbitTech.shipMass(career.ship, GravityGame.medicLoad(career, left));
			}
			return mass;
		}
		if (task.state === GravityGame.TASK_ACCEPTED && task.from === planet) mass += task.tons;
		else if (task.state === GravityGame.TASK_LOADED && task.to === planet) mass -= task.tons;
		return mass;
	};

		/* Arrival charge of an own rail: the pad under the ship holds what it
		 * holds, a remote pad charges while the ship flies — but only for the
		 * flight's own length, measured on the pad clock. A three second hop
		 * cannot refill a whole shot, so a forecast that lands on an empty bar
		 * priced a launch the ship would not have. */
		GravityBot.prototype.careerArrivalCharge = function (career, planet, flightSeconds) {
			const pad = career.pads[planet];
			if (planet === career.at || !(flightSeconds > 0)) return pad.battery.capacity;
			const charge = Math.max(0, pad.chargeKwh - pad.reservedKwh);
			const gained = OrbitTech.solarCharge(pad.panel, career.light[planet],
				GravitySim.padSeconds(flightSeconds));
			return Math.min(pad.battery.capacity, charge + gained) - pad.reservedKwh;
		};

		/* Normally quote the cheapest way off. A shopper/scorer seeking a claim
		 * wants the cheapest *owned kit* instead. Keep the ticket as fallback if
		 * there is no affordable kit, including on somebody else's ground. */
		GravityBot.prototype.careerDeparture = function (career, planet, cash, mass, sourceSim, condition, seekClaim, afterLanding = false, flightSeconds = 0) {
		const out = this.careerExit;
		out.ok = false;
		out.physical = false;
		out.builds = false;
		out.canBuildStarter = false;
		out.starterCanExit = false;
		out.cost = Infinity;
		out.speed = 0;
		out.source = '';
		out.catapult = null;
		out.battery = null;
		out.reason = 'no affordable exit trajectory';
		this.prepareCareerExitProbe(sourceSim || this.probe);
		const sim = this.exitProbe;
		if (!sim.planetActive(planet)) {
			out.reason = 'planet is not active';
			return out;
		}
		/* a worn-out ship has no exit from where it stands: repair, not a rail */
		const usable = condition === undefined ? GravityGame.careerShipUsable(career) : condition > 0;
		if (planet === career.at && !usable) {
			out.reason = 'ship worn out';
			return out;
		}
		const arrivalMass = Number.isFinite(mass) && mass > 0 ? mass : career.ship.mass;
		const available = cash === Infinity ? Infinity : Number.isFinite(cash) ? cash : -Infinity;
		const forceScale = sim.forceScale;
		const own = career.pads[planet];
		const pad = GravityGame.padAt(career, planet, !afterLanding);
		const owner = GravityGame.padOwner(career, planet, !afterLanding);

		const buildable = GravityGame.planetBuildable(career, planet);
		if (own.catapult === null && buildable) {
			const starterCap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
				arrivalMass, OrbitTech.CATAPULTS[0], forceScale);
			out.starterCanExit = this.careerExitSpeed(planet, starterCap) > 0;
			/* only claim an unclaimed (commercial) or own planet: you cannot
			 * replace another player's EMC with your own */
			out.canBuildStarter = out.starterCanExit &&
				available + 1e-9 >= careerPrice(career, OrbitTech.CATAPULTS[0]);
			if (out.starterCanExit) out.physical = true;
		}

		/* Our panel can recharge. A guest cannot count on charge its host has
		 * already spent or promised to another barrel. */
		const charge = owner === career.index
			? this.careerArrivalCharge(career, planet, flightSeconds)
			: Math.max(0, pad.chargeKwh - pad.reservedKwh);
		const currentCap = OrbitTech.speedLimit(charge,
			arrivalMass, pad.catapult, forceScale);
		const currentSpeed = this.careerExitSpeed(planet, currentCap);
		let bestCost = Infinity;
		if (currentSpeed > 0) {
			out.physical = true;
			/* the imperial Capital rail (OWNER_CAPITAL) launches free, like your
			 * own pad; commercial, rebel and rival rails charge a fee */
			const fee = owner === career.index || owner === GravityGame.OWNER_CAPITAL ? 0
				: owner === GravityGame.OWNER_COMMERCIAL || owner === GravityGame.OWNER_REBEL
				? careerFee(career, GravityGame.commercialFee(career, planet, currentSpeed, arrivalMass))
				: careerFee(career, GravityGame.CAREER.taxPerKwh *
					OrbitTech.launchEnergy(arrivalMass, pad.catapult, currentSpeed) * pad.catapult.tier);
			if (available + 1e-9 >= fee) {
				bestCost = fee;
				out.ok = true;
				out.cost = fee;
				out.speed = currentSpeed;
				out.source = owner === career.index ? 'own'
					: owner === GravityGame.OWNER_CAPITAL ? 'capital'
					: owner === GravityGame.OWNER_REBEL ? 'rebel'
					: owner === GravityGame.OWNER_COMMERCIAL ? 'commercial' : 'rival';
				out.catapult = pad.catapult;
				out.battery = pad.battery;
				out.reason = '';
			}
		}

		if (seekClaim && !own.catapult) bestCost = Infinity;
		if (bestCost === 0 || !buildable) return out;

		const catPrototypes = career.prototypes
			? career.prototypes[OrbitTech.KIND_CATAPULT] : null;
		const batteryPrototypes = career.prototypes
			? career.prototypes[OrbitTech.KIND_BATTERY] : null;
		const catCount = OrbitTech.CATAPULTS.length + (catPrototypes ? catPrototypes.length : 0);
		const batteryCount = OrbitTech.BATTERIES.length +
			(batteryPrototypes ? batteryPrototypes.length : 0);
		const currentBattery = own.catapult === null ? OrbitTech.BATTERIES[0] : own.battery;
		for (let ci = -1; ci < catCount; ci++) {
			let catapult;
			if (ci < 0) {
				if (own.catapult === null) continue;
				catapult = own.catapult;
			} else if (ci < OrbitTech.CATAPULTS.length) catapult = OrbitTech.CATAPULTS[ci];
			else catapult = catPrototypes[ci - OrbitTech.CATAPULTS.length];
			const buildCatapult = catapult !== own.catapult;
			if (own.catapult !== null && buildCatapult &&
				catapult.tier <= own.catapult.tier) continue;
			if (buildCatapult && !GravityGame.gearKnown(career, catapult)) continue;
			const catCost = buildCatapult ? careerPrice(career, catapult) : 0;
			if (available + 1e-9 < catCost) continue;
			for (let bi = -1; bi < batteryCount; bi++) {
				let battery;
				if (bi < 0) battery = currentBattery;
				else if (bi < OrbitTech.BATTERIES.length) battery = OrbitTech.BATTERIES[bi];
				else battery = batteryPrototypes[bi - OrbitTech.BATTERIES.length];
				const buildBattery = battery !== currentBattery;
				if (buildBattery && battery.tier <= currentBattery.tier) continue;
				if (buildBattery && !GravityGame.gearKnown(career, battery)) continue;
				if (!buildCatapult && !buildBattery) continue;
				const totalCost = catCost + (buildBattery ? careerPrice(career, battery) : 0);
				if (available + 1e-9 < totalCost || totalCost + 1e-9 >= bestCost) continue;
				/* the kit is ours: its panel fills the battery it buys, and a
				 * fresh pad starts with the starter charge */
				const cap = OrbitTech.speedLimit(battery.capacity, arrivalMass, catapult, forceScale);
				const speed = this.careerExitSpeed(planet, cap);
				if (speed <= 0) continue;
				out.physical = true;
				bestCost = totalCost;
				out.ok = true;
				out.builds = true;
				out.cost = totalCost;
				out.speed = speed;
				out.source = 'build';
				out.catapult = catapult;
				out.battery = battery;
				out.reason = '';
			}
		}
		if (!out.ok) out.reason = out.physical
			? 'departure cost is unaffordable' : 'no launch trajectory within affordable gear';
		return out;
	};

	GravityBot.prototype.careerBuyGear = function (career, planet, kind, item, reserve, step, why) {
		const keep = (reserve || 0) + careerRefundEscrow(career);
		if (!item || career.ledger.purse + 1e-9 < careerPrice(career, item) + keep) return false;
		const fresh = kind === OrbitTech.KIND_CATAPULT && career.pads[planet].catapult === null;
		if (!GravityGame.buildGear(career, planet, kind, item)) return false;
		if (fresh) this.careerBuilds += 1;
		else this.careerUpgrades += 1;
		if (why) this.traceAdd(careerTraceIndex(career), 'gear', 'P' + planet + ' ' + item.id +
			' · ' + why + ' · −' + careerPrice(career, item).toFixed(2), step);
		return true;
	};

	/* R&D: unlock a mid-rung bridge rail when pads will need upgrades anywhere,
	 * and at HQ unlock + fit a lightweight composite tank + thruster kit. */
	GravityBot.prototype.careerResearch = function (career, sim, reserve) {
		if (career.ended !== GravityGame.CAREER_OPEN) return null;
		const keep = (reserve === undefined ? CAREER_PURSE_RESERVE : reserve) +
			careerRefundEscrow(career);
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
		if (career.at !== career.hq) return null;
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

	GravityBot.prototype.careerGravityCost = function (planet, sim = this.probe) {
		return Math.max(0, sim.strength[planet] * sim.gravityScale - 1) * CAREER_GRAVITY_COST;
	};

	/* Only called for a proven kit. The full-speed reach fan may miss the
	 * slower exit that careerDeparture found; that is still one neighbour. */
	GravityBot.prototype.careerSiteValue = function (career, planet, target, cap) {
		const reach = Math.max(1, this.careerReach(planet, cap));
		return career.light[planet] + reach * CAREER_REACH_VALUE -
			this.careerGravityCost(planet, this.exitProbe) + (planet === target ? CAREER_SITE_BONUS : 0);
	};

	/* Price the rail we would own, not the commercial ticket that may be the
	 * cheapest one-off exit. Use the same site valuation for a landing and a
	 * remote purchase, at the mass the kit actually has to launch. */
	GravityBot.prototype.careerClaimValue = function (career, planet, target, departure, mass) {
		const cap = OrbitTech.speedLimit(departure.battery.capacity, mass, departure.catapult, this.exitProbe.forceScale);
		return (departure.canBuildStarter ? CAREER_NETWORK_PAD_VALUE : CAREER_STEEP_PAD_VALUE) +
			this.careerSiteValue(career, planet, target, cap) - departure.cost;
	};

	GravityBot.prototype.careerPadOffer = function (career, planet, cash, sim) {
		return this.careerDeparture(career, planet, cash, career.ship.mass, sim, undefined, true);
	};

	GravityBot.prototype.careerNextPad = function (career, cash = career.ledger.purse, sim = this.probe) {
		const target = career.contract >= 0 ? this.careerTarget(career) : -1;
		let best = -1;
		let bestValue = -Infinity;
		for (let p = 0; p < sim.planetCount; p++) {
			if (!sim.planetActive(p) || career.pads[p].catapult || this.careerContested(career, p) ||
				!GravityGame.planetBuildable(career, p)) continue;
			const exit = this.careerPadOffer(career, p, cash, sim);
			if (!exit.builds) continue;
			const value = this.careerClaimValue(career, p, target, exit, career.ship.mass);
			if (value <= bestValue) continue;
			best = p;
			bestValue = value;
		}
		return best;
	};

	/* A delivery starting here doesn't pay another fine for getting here;
	 * any quest accepted at the Capital also collects the immediate refund. */
	function careerNetReward(career, task) {
		const entries = Number(task.from === career.capitalPlanet && task.from !== career.at) +
			Number(task.to === career.capitalPlanet);
		const refund = career.capitalPlanet >= 0 && career.at === career.capitalPlanet
			? GravityGame.CAPITAL_REFUND : 0;
		return task.reward + refund + entries * GravityGame.CAPITAL_VISIT_PAY;
	}

	/* The pickup has to launch the loaded ship. Don't take a job whose
	 * reward cannot even pay that ticket, or whose delivery is a dead end. */
	GravityBot.prototype.careerDeliveryNet = function (career, task, hold, budget, sim) {
		const refund = career.capitalPlanet >= 0 && career.at === career.capitalPlanet
			? GravityGame.CAPITAL_REFUND : 0;
		const purse = budget + refund;
		const dry = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, hold, 0);
		const loaded = this.careerDeparture(career, task.from, purse, dry + task.tons, sim);
		const net = careerNetReward(career, task) - loaded.cost;
		if (!loaded.ok || net <= 0) return -Infinity;
		if (task.fragile && loaded.speed > GravityGame.FRAGILE_SPEED &&
			!this.careerExitSpeed(task.from, GravityGame.FRAGILE_SPEED)) return -Infinity;
		return this.careerDeparture(career, task.to, budget + net, dry, sim).ok ? net : -Infinity;
	};

	GravityBot.prototype.careerMedicNet = function (career, planet, patients, hold, budget, sim) {
		const medics = Math.min(Math.floor(hold.capacity / 2), patients);
		if (medics < 1 || career.capitalPlanet < 0) return -Infinity;
		const purse = budget + GravityGame.CAPITAL_REFUND;
		const loadedMass = OrbitTech.refitMass(career.ship, OrbitTech.KIND_HOLD, hold, medics);
		const out = this.careerDeparture(career, career.capitalPlanet, purse, loadedMass, sim);
		if (!out.ok) return -Infinity;
		const outCost = out.cost;
		const back = this.careerDeparture(career, planet, purse - outCost, loadedMass, sim);
		if (!back.ok) return -Infinity;
		const backCost = back.cost;
		const tripPay = medics * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
		const net = tripPay + GravityGame.CAPITAL_REFUND + GravityGame.CAPITAL_VISIT_PAY -
			outCost - backCost;
		return net > 0 ? net : -Infinity;
	};

	GravityBot.prototype.careerAccept = function (career, step = this.worldStep, sim = this.probe) {
		if (career.contract >= 0 || step < career.acceptAfterStep) return false;
		let best = -1;
		let bestScore = -Infinity;
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			if (i === GravityGame.COMPETE_SLOT || !GravityGame.canAccept(career, i)) continue;
			const task = career.tasks[i];
			const net = task.kind === GravityGame.TASK_DELIVERY
				? this.careerDeliveryNet(career, task, career.ship.hold, career.ledger.purse, sim)
				: task.kind === GravityGame.TASK_MEDIC
				? this.careerMedicNet(career, task.to, task.patients, career.ship.hold, career.ledger.purse, sim)
				: task.reward;
			if (!Number.isFinite(net)) continue;
			const loadTons = task.kind === GravityGame.TASK_MEDIC ? task.medics : task.tons;
			let score = net - loadTons * 0.02;
			if (task.kind === GravityGame.TASK_MEDIC) score += CAREER_MEDIC_VALUE;
			if (task.from === career.at) score += 0.75;
			if (career.pads[task.from].catapult !== null) score += 0.25;
			if (career.pads[task.to].catapult !== null) score += 0.5;
			if (score > bestScore) {
				bestScore = score;
				best = i;
			}
		}
		/* A medical offer can only be signed at the Capital: keep the contract
		 * slot free when flying to the Capital for it beats the local board. */
		const medic = career.tasks[GravityGame.MEDIC_SLOT];
		if (career.at >= 0 && career.at !== career.capitalPlanet &&
			medic.kind === GravityGame.TASK_MEDIC && medic.medics > 0) {
			const depart = this.careerDeparture(career, career.at, career.ledger.purse,
				career.ship.mass, sim);
			const departOk = depart.ok;
			const departCost = depart.cost;
			const afterDepart = career.ledger.purse - departCost;
			if (departOk && afterDepart + 1e-9 >= GravityGame.CAPITAL_REFUND) {
				const medicNet = this.careerMedicNet(career, medic.to, medic.patients,
					career.ship.hold, afterDepart, sim) - departCost;
				if (Number.isFinite(medicNet)) {
					const medicScore = medicNet - medic.medics * 0.02 + CAREER_MEDIC_VALUE - 1.5;
					if (medicScore > bestScore) return false;
				}
			}
		}
		if (best < 0 || !GravityGame.acceptTask(career, best)) return false;
		const task = career.tasks[best];
		this.traceAdd(careerTraceIndex(career), 'contract', 'P' + task.from + '→P' + task.to +
			' · reward ' + task.reward.toFixed(2) + ' · best board score ' + signed(bestScore), step);
		return true;
	};

	GravityBot.prototype.careerDeferContract = function (career, step, why) {
		GravityGame.dropContract(career);
		career.acceptAfterStep = step + CAREER_ACCEPT_HOLD;
		this.traceAdd(careerTraceIndex(career), 'drop contract', why, step);
	};

	/* Raise the pad's full-battery cap, not its accidentally low current charge. */
	GravityBot.prototype.careerUpgrade = function (career, sim, wantedSpeed, reserve, step = this.worldStep) {
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
			if (!this.careerBuyGear(career, planet, kind, item, needed ? 0 : reserve, step,
				needed ? 'restore minimum lift' : 'lift loaded contract')) break;
			upgraded = true;
		}
		return upgraded;
	};

	/* pad seconds a pad's panel needs to replace the energy a shot spent */
	GravityBot.prototype.careerRefillWait = function (career, planet, panel, energy) {
		const power = panel.power * career.light[planet] / 3600;
		return energy > 0 && power > 0 ? energy / power : 0;
	};

	/* the pad's last launch, re-priced by the launch book: money, flight time
	 * and the speed that bought it */
	GravityBot.prototype.careerPadRecord = function (career) {
		const book = career.launchBook;
		const tag = this.careerBookTag();
		if (!GravityGame.bookReady(book, tag)) return null;
		let best = null;
		for (let i = 0; i < book.entries.length; i++) {
			const entry = book.entries[i];
			if (entry.origin !== career.at) continue;
			if (!best || entry.score > best.score) best = entry;
		}
		return best && best.money > 0 ? best : null;
	};

	/*
	 * Pad gear sized by money per pad second. A panel shortens the recharge
	 * half of the launch cycle, a battery lifts the pad's speed ceiling (it
	 * keeps the charge the pad holds, so only its capacity is bought), an EMC
	 * adds reach — and an EMC is only worth its price together with the battery
	 * that can fill it. Each rung is priced against the last launch from this
	 * pad, so gear that cannot pay itself back inside CAREER_PAD_HORIZON stays
	 * in the shop.
	 */
	GravityBot.prototype.careerPadGear = function (career, runStep) {
		const planet = career.at;
		if (career.ended !== GravityGame.CAREER_OPEN || planet < 0) return false;
		const pad = career.pads[planet];
		if (pad.catapult === null) return false;
		if (GravityGame.padOwner(career, planet) !== career.index) return false;
		const record = this.careerPadRecord(career);
		if (!record) return false;
		const mass = career.ship.mass;
		const scale = career.forceScale;
		const free = pad.chargeKwh - pad.reservedKwh;
		/* the launch cycle is priced on the pad clock: the flight's pad
		 * seconds plus the pad seconds the panel needs to replace the shot */
		const flownSec = GravitySim.padSeconds(GravitySim.gameSeconds(record.steps));
		const speed = GravityGame.speedOf(record.speedU);
		const energy = OrbitTech.launchEnergy(mass, pad.catapult, speed);
		const missed = energy > free ? energy - free : 0;
		const cycle = flownSec + this.careerRefillWait(career, planet, pad.panel, missed);
		if (!(cycle > 0)) return false;
		const money = record.money;
		const yieldNow = money / cycle;
		const capNow = OrbitTech.speedLimit(pad.battery.capacity, mass, pad.catapult, scale);
		const reachNow = this.careerReach(planet, capNow);
		const best = this.careerGear;
		best.value = 0;
		best.rate = 0;
		best.cost = 0;
		best.kind = '';
		best.item = null;
		best.mate = null;
		best.label = '';

		const panel = careerNextItem(career, OrbitTech.KIND_PANEL, OrbitTech.PANELS, pad.panel);
		if (panel && GravityGame.gearKnown(career, panel)) {
			const refill = this.careerRefillWait(career, planet, panel, missed);
			this.careerGearOffer(career, money / (flownSec + refill) - yieldNow,
				careerPrice(career, panel), OrbitTech.KIND_PANEL, panel, null, panel.id);
		}

		/* a battery keeps the charge the pad holds: the cycle buys reach and the
		 * energy headroom of a bigger tank, never a free fill */
		const battery = careerNextItem(career, OrbitTech.KIND_BATTERY, OrbitTech.BATTERIES,
			pad.battery);
		if (battery && GravityGame.gearKnown(career, battery)) {
			const cap = OrbitTech.speedLimit(battery.capacity, mass, pad.catapult, scale);
			const reach = this.careerReach(planet, cap);
			this.careerGearOffer(career, Math.max(0, reach - reachNow) * CAREER_REACH_VALUE / cycle,
				careerPrice(career, battery), OrbitTech.KIND_BATTERY, battery, null, battery.id);
		}

		const catapult = careerNextItem(career, OrbitTech.KIND_CATAPULT, OrbitTech.CATAPULTS,
			pad.catapult);
		if (catapult && GravityGame.gearKnown(career, catapult)) {
			/* the rail is only as fast as the battery behind it: price the pair */
			const forceCap = OrbitTech.maxSpeed(mass, catapult, scale);
			let mate = pad.battery;
			let mateCost = 0;
			for (let i = 0; i < OrbitTech.BATTERIES.length; i++) {
				const item = OrbitTech.BATTERIES[i];
				if (item.tier <= pad.battery.tier || !GravityGame.gearKnown(career, item)) continue;
				mate = item;
				mateCost = careerPrice(career, item);
				if (OrbitTech.speedLimit(item.capacity, mass, catapult, scale) + 1e-9 >= forceCap) break;
			}
			const cap = OrbitTech.speedLimit(mate.capacity, mass, catapult, scale);
			const reach = this.careerReach(planet, cap);
			const shot = OrbitTech.launchEnergy(mass, catapult, speed < cap ? speed : cap);
			/* the mate keeps the charge this pad holds, so the panel replaces the
			 * whole shot, exactly as the standing rail's cycle does */
			const refill = this.careerRefillWait(career, planet, pad.panel, Math.max(0, shot - free));
			this.careerGearOffer(career,
				(money + Math.max(0, reach - reachNow) * CAREER_REACH_VALUE) /
				(flownSec + refill) - yieldNow, careerPrice(career, catapult) + mateCost,
				OrbitTech.KIND_CATAPULT, catapult, mate === pad.battery ? null : mate,
				catapult.id + (mate === pad.battery ? '' : '+' + mate.id));
		}

		/* the rung must pay for itself inside the horizon and leave a launch
		 * fee in the purse: gear never spends the company's way off the pad */
		if (!best.label || best.value < best.cost) return false;
		if (!this.careerBuyGear(career, planet, best.kind, best.item, CAREER_PURSE_RESERVE)) {
			return false;
		}
		/* a rail is only as good as the battery that fills it: fit the mate too */
		if (best.mate) {
			this.careerBuyGear(career, planet, OrbitTech.KIND_BATTERY, best.mate,
				CAREER_PURSE_RESERVE);
		}
		this.careerPadGearBought += 1;
		this.traceAdd(careerTraceIndex(career), 'gear', 'P' + planet + ' ' + best.label +
			' · ' + best.cost.toFixed(2) + ' · yield +' + (best.rate * 60).toFixed(2) + '/min' +
			(best.rate > 0 ? ' · payback ' + (best.cost / best.rate).toFixed(0) + ' s' : ''),
			runStep || 0);
		return true;
	};

	/* keep the rung worth the most money inside CAREER_PAD_HORIZON that the
	 * purse can still pay for with the launch reserve intact */
	GravityBot.prototype.careerGearOffer = function (career, rate, cost, kind, item, mate, label) {
		const best = this.careerGear;
		if (cost + CAREER_PURSE_RESERVE + careerRefundEscrow(career) > career.ledger.purse + 1e-9) return;
		const value = (rate > 0 ? rate : 0) * CAREER_PAD_HORIZON;
		if (value <= best.value) return;
		best.value = value;
		best.rate = rate;
		best.cost = cost;
		best.kind = kind;
		best.item = item;
		best.mate = mate;
		best.label = label;
	};

	/* Keep a launch in reserve for optional service. A worn-out ship has to
	 * spend its last coin on repairs before it can use any rail. */
	GravityBot.prototype.careerRepair = function (career, runStep) {
		const condition = career.ship.condition;
		if (condition > CAREER_REPAIR_AT) return false;
		const cost = GravityGame.repairCost(career);
		const reserve = condition > 0 ? CAREER_PURSE_RESERVE + careerRefundEscrow(career) : 0;
		if (career.ledger.purse + 1e-9 < cost + reserve) return false;
		if (!GravityGame.repairCareer(career)) return false;
		this.traceAdd(careerTraceIndex(career), 'repair', 'P' + career.at + ' · cond ' +
			Math.round(condition * 100) + ' % → 100 % · −' + cost.toFixed(2), runStep);
		return true;
	};

	/*
	 * A hold buys the contract board, so it waits until the company has a board
	 * to use: CAREER_HOLD_PADS pads, or an actual local delivery that already
	 * carries the hold and pays more than it costs. The weight is the reason —
	 * 1.5 t is 15 % of a dry ship, and every launch, fee and tax carries it.
	 */
	GravityBot.prototype.careerWantHold = function (career, sim) {
		const hold = OrbitTech.HOLDS[1];
		const price = careerPrice(career, hold);
		const budget = career.ledger.purse - price;
		if (career.padCount >= CAREER_HOLD_PADS &&
			budget >= CAREER_PURSE_RESERVE + careerPrice(career, OrbitTech.CATAPULTS[0])) return true;
		for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind !== GravityGame.TASK_DELIVERY || task.state !== GravityGame.TASK_OFFERED) continue;
			if (task.from !== career.at || task.tons > hold.capacity) continue;
			if (this.careerDeliveryNet(career, task, hold, budget, sim) > price) return true;
		}
		if (career.at === career.capitalPlanet && career.market) {
			const market = career.market;
			for (let p = 0; p < OrbitWorld.PLANETS; p++) {
				if (!market.rebel[p] || !market.patients[p] || !GravityGame.planetInPlay(career, p)) continue;
				if (this.careerMedicNet(career, p, market.patients[p], hold, budget, sim) > price) return true;
			}
		}
		return false;
	};

	/* Install exactly the kit the exit probe priced, even when just its
	 * battery is missing. A fresh rail comes with BAT-1 (and its charge). */
	GravityBot.prototype.careerBuyPad = function (career, planet, exit, reserve, step, why) {
		if (!exit.builds) return false;
		const cat = exit.catapult;
		const bat = exit.battery;
		const pad = career.pads[planet];
		if (pad.catapult !== cat && !this.careerBuyGear(career, planet, OrbitTech.KIND_CATAPULT,
			cat, reserve, step, why)) return false;
		return pad.battery === bat || this.careerBuyGear(career, planet, OrbitTech.KIND_BATTERY,
			bat, reserve, step, why);
	};

	GravityBot.prototype.careerBetweenFlights = function (career, sim, runStep = this.worldStep) {
		if (career.ended !== GravityGame.CAREER_OPEN) return 0;
		/* transport trips own the ship and the clock until arrival */
		if (career.arrested || career.evacuating) return 0;
		let actions = 0;
		if (career.at < 0) {
			if (this.careerRecover(career, sim, runStep, 'lost in space')) return 1;
			return 0;
		}
		/* Mandatory service first. An affordable exit kit comes before an
		 * optional repair, contract or evacuation, just as the fan priced it. */
		if (!GravityGame.careerShipUsable(career)) {
			if (!this.careerRepair(career, runStep)) return 0;
			actions++;
		}
		const at = career.at;
		const departure = this.careerPadOffer(career, at,
			career.ledger.purse - careerRefundEscrow(career), sim);
		if (this.careerBuyPad(career, at, departure, 0, runStep,
			career.pads[at].catapult ? 'affordable exit' : 'claim an exitable landing')) actions++;
		if (GravityGame.padLift(career, at, sim.forceScale) + 1e-9 < GravitySim.SPEED_MIN) {
			if (career.contract >= 0) {
				this.careerDeferContract(career, runStep, 'load cannot lift');
				actions++;
			} else if (this.careerRecover(career, sim, runStep, 'no affordable rail can lift')) return actions + 1;
		}
		if (this.careerRepair(career, runStep)) actions += 1;

		if (this.careerUseResearch && career.at === career.hq) {
			let part;
			while ((part = this.careerResearch(career, sim, CAREER_PURSE_RESERVE))) {
				this.traceAdd(careerTraceIndex(career), 'research', part + ' · HQ gear', runStep);
				actions += 1;
			}
		}
		if (this.careerAccept(career, runStep, sim)) actions += 1;
		if (this.careerBribe(career, sim, runStep)) actions += 1;

		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED) {
				if (this.careerUpgrade(career, sim, CAREER_LOADED_SPEED, CAREER_PURSE_RESERVE, runStep)) {
					actions += 1;
				}
				if (GravityGame.padLift(career, career.at) + 1e-9 < GravitySim.SPEED_MIN) {
					this.careerDeferContract(career, runStep, 'upgraded rail still cannot lift');
					actions += 1;
				}
			}
		}

		/* At most one remote claim per shop. Before the first flight, keep the
		 * first landing's EMC money at hand rather than claiming a remote site
		 * and then having to pay the commercial rail under the ship. */
		const reserve = CAREER_PURSE_RESERVE + GravityGame.repairCost(career) +
			careerRefundEscrow(career) +
			(career.flights === 0 ? careerPrice(career, OrbitTech.CATAPULTS[0]) : 0);
		if (career.ended === GravityGame.CAREER_OPEN && career.ledger.purse >= reserve) {
			const here = this.careerDeparture(career, career.at, career.ledger.purse, career.ship.mass, sim);
			const keep = reserve + here.cost;
			const cash = career.ledger.purse - keep;
			if (here.ok && cash >= 0) {
				const planet = this.careerNextPad(career, cash, sim);
				if (planet >= 0) {
					const kit = this.careerPadOffer(career, planet, cash, sim);
					if (this.careerBuyPad(career, planet, kit, keep, runStep, 'expand network')) actions += 1;
				}
			}
		}
		/* the hold is fitted wherever the ship stands, but only once the network
		 * can use a board: 1.5 t is 15 % of a dry ship and taxes every launch.
		 * It follows the claim, so one pass can buy a pad and then kit out. */
		if (career.at >= 0 && career.ship.hold === OrbitTech.HOLDS[0] &&
			career.ledger.purse + 1e-9 >= careerPrice(career, OrbitTech.HOLDS[1]) +
				CAREER_PURSE_RESERVE + careerRefundEscrow(career) && this.careerWantHold(career, sim) &&
			GravityGame.installPart(career, OrbitTech.KIND_HOLD, OrbitTech.HOLDS[1])) {
			this.traceAdd(careerTraceIndex(career), 'gear', 'P' + career.at + ' ' +
				OrbitTech.HOLDS[1].id + ' · ' + OrbitTech.HOLDS[1].capacity + ' t', runStep);
			actions += 1;
		}
		/* the standing pad earns by the launch: size its rail, battery and panel
		 * for the money per pad second, never for the next rescue alone */
		if (career.ended === GravityGame.CAREER_OPEN && this.careerPadGear(career, runStep)) {
			actions += 1;
		}
		return actions;
	};

	GravityBot.prototype.careerRecover = function (career, sim, step, why) {
		const from = career.at;
		const paid = GravityGame.evacuationCost(career);
		if (!career.stranded || !GravityGame.evacuate(career, sim, paid, step)) return false;
		this.traceAdd(careerTraceIndex(career), 'evac',
			(from < 0 ? 'space' : 'P' + from) + ' → HQ P' + career.hq +
			' · ' + why + ' · ' + paid.toFixed(2) + ' paid', step);
		return true;
	};

	/*
	 * Bribes (0.5.12, repriced 0.5.13). Rulers pay the visit value — what the
	 * landing collected plus what regrew while the ship sat — multiplied by 2.
	 * The rot the bribe adds is what can end in the Capital transport; a seed-derived
	 * persona decides whether a company takes it. Never on its own rail (rot on
	 * the company's own pad hurts its colony), never below the small-bribe
	 * floor, never on the Capital, A.R.F. or a rebellious planet — the rule
	 * refuses those anyway.
	 */
	GravityBot.prototype.careerBribeProne = function (index) {
		return OrbitWorld.hash01(GravityGame.rivalSeed(this.seed >>> 0, index), 7, 0x39) <
			CAREER_BRIBE_PRONE;
	};

	/* another company's queued launch is leaving from this planet: the rulers
	 * have a reason to pay before that visitor collects instead */
	GravityBot.prototype.careerRivalQueued = function (planet, self) {
		for (let i = 0; i < this.count; i++) {
			const r = this.rivals[i];
			if (r === self || !r.turret || r.turret.origin !== planet) continue;
			return true;
		}
		return false;
	};

	GravityBot.prototype.careerTryRecovery = function (r, runStep) {
		const career = r.career;
		if (career.recoverySteps < 0) {
			if (career.at >= 0 && !GravityGame.careerShipUsable(career)) this.careerRepair(career, runStep);
			return false;
		}
		this.careerBribe(career, r.sim, runStep);
		r.readyStep = runStep + CAREER_RIVAL_GAP;
		return true;
	};

	GravityBot.prototype.careerBribe = function (career, sim, runStep) {
		const market = career.market;
		const planet = career.at;
		if (!market || !career.bribeProne || planet < 0) return false;
		if (GravityGame.padOwner(career, planet) === career.index) return false;
		const amount = GravityGame.bribeAmount(market, planet, runStep);
		if (amount < OrbitEcon.BRIBE_MIN) return false;
		if (amount < CAREER_BRIBE_PAY && market.corruption[planet] < CAREER_BRIBE_ROT &&
			!this.careerRivalQueued(planet, career)) return false;
		const result = GravityGame.acceptBribe(career, market, sim, planet, runStep);
		if (!result.ok) return false;
		this.traceAdd(careerTraceIndex(career), 'bribe', 'P' + planet + ' paid +' +
			result.amount.toFixed(2) + ' · rot ' + result.corruption.toFixed(1) +
			(result.arrested ? ' · ARRESTED' : ''), runStep);
		return true;
	};

	/*
	 * Patience: a losing flight that cannot claim a pad only burns the pad
	 * charge and the purse. Sitting the gap out lets the pads recharge, the
	 * board rotate and the visit profits grow, and the next plan is priced in
	 * that richer world. A padless landing that can pay for its own starter EMC
	 * is progress, so it is flown; after CAREER_SIT_TRIES skips the least bad
	 * shot is taken anyway, so a company can never sit forever.
	 */
	GravityBot.prototype.careerShouldWait = function (plan, tries) {
		if (plan.builds) return false;
		if (plan.score >= CAREER_MIN_SCORE) return false;
		return tries < CAREER_SIT_TRIES;
	};

	/* --- live state and refusal reasons --------------------------------- */

	/* candidate counts from the failed search, so "cannot fly" has a cause */
	GravityBot.prototype.careerNoPlanWhy = function (career, sim) {
		const at = career.at;
		if (at < 0) return GravityGame.railText(career, sim, at);
		if (!sim.canLaunchFrom(at)) return 'P' + at + ' cannot launch (ship not landed)';

		const block = GravityGame.railBlock(career, sim, at, GravitySim.SPEED_MIN);
		if (block !== '') {
			return 'P' + at + ' ' + block + ' · charge ' +
				GravityGame.padAt(career, at).chargeKwh.toFixed(2) + ' kWh';
		}
		const scan = this.careerScan;
		if (career.contract >= 0) {
			return 'contract wants P' + this.careerTarget(career) + ' · no fan shot lands there (' +
				scan.tried + ' traces)';
		}
		if (scan.tried > 0 && scan.impacts === 0) {
			return 'fan ' + scan.tried + ' traces · no impact · book ' + scan.book;
		}
		return 'fan ' + scan.tried + ' traces · ' + scan.impacts + ' impacts · ' +
			scan.finite + ' payable · ' + scan.bounce + ' bounces · ' +
			(scan.busy ? scan.busy + ' shared aims · ' : '') +
			scan.exit + ' nonviable exits · ' + scan.noImpact + ' no landing · book ' + scan.book;
	};

	GravityBot.prototype.rivalDoneWhy = function (r) {
		const spec = this.ruleSpec();
		if (this.rule === GravityGame.RULE_ROUTE) {
			return r.routeDone ? 'plan ready' : 'tracing one plan';
		}
		if (spec.stopOnTour && r.doneSteps >= 0) return 'tour complete';
		if (spec.maxShots > 0 && r.shots.length >= spec.maxShots) {
			return r.shots.length + '-shot cap reached';
		}
		if (r.shots.length >= MAX_BOT_SHOTS) return 'safety shot cap';
		if (r.sim.status !== STATUS_FLYING && r.ledger.purse < MONEY.cost) {
			return 'purse ' + r.ledger.purse.toFixed(2) + ' < launch fee ' + MONEY.cost.toFixed(2);
		}
		return 'active';
	};

	GravityBot.prototype.actorStateShort = function (index, runStep) {
		const r = this.actorAt(index);
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			if (!career) return 'no company';
			if (career.ended === GravityGame.CAREER_BROKE) {
				return 'broke · career over';
			}
			if (career.ended !== GravityGame.CAREER_OPEN) return 'complete';
			if (career.evacuating) return 'evacuating · ' +
				Math.max(0, (career.evacUntilStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
			if (career.at < 0) {
				const fee = careerFee(career, GravityGame.CAREER.evacFee);
				return career.ledger.purse + 1e-9 >= fee
					? 'in space · evacuating'
					: 'in space · purse ' + career.ledger.purse.toFixed(2) +
						' < evac ' + fee.toFixed(2);
			}
			if (r.sim.status === STATUS_FLYING) return 'flying';
			if (r.turret) {
				return 'queued · barrel in ' + Math.max(0, (r.turret.fireAt - runStep) * GravitySim.DT).toFixed(1) + ' s';
			}
			if (runStep < r.readyStep) {
				const why = r.waitTries > 0
					? 'sitting ' + r.waitTries + '/' + CAREER_SIT_TRIES
					: r.idleTries > 0 ? 'no shot' : 'gap';
				return why + ' · retry in ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
			}
			return 'ready';
		}
		if (r.sim.status === STATUS_FLYING) return 'flying';
		if (this.rivalDone(r)) return this.rivalDoneWhy(r);
		if (this.jobActive && this.jobRival === index) {
			return 'thinking ' + Math.round(this.progress() * 100) + '%';
		}
		if (runStep < r.readyStep) {
			return 'gap · ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
		}
		return 'ready';
	};

	/* multi-line live state: state, money, rail, saved shots, last decision */
	GravityBot.prototype.actorStatus = function (index, runStep) {
		const label = actorLabel(index);
		const r = this.actorAt(index);
		const short = this.actorStateShort(index, runStep);
		const lines = [];
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			if (!career) return label + ' · no company';
			const place = career.at < 0 ? 'in space'
				: 'P' + career.at + (r.sim.status === STATUS_FLYING ? ' · in flight' : '');
			lines.push(label + ' · ' + short + ' · ' + place +
				' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount +
				' pads · ' + career.flights + ' flights');
			lines.push('    ' + GravityGame.railText(career, r.sim, career.at));
			let book = 0;
			for (let i = 0; i < career.launchBook.entries.length; i++) {
				if (career.launchBook.entries[i].origin === career.at) book += 1;
			}
			let extra = 'book ' + book + ' from here · sit ' + r.waitTries + '/' +
				CAREER_SIT_TRIES + ' · idle ' + r.idleTries;
			if (career.contract >= 0) {
				const task = career.tasks[career.contract];
				extra += ' · contract → P' + (task.state === GravityGame.TASK_LOADED ? task.to : task.from);
			}
			if (r.turret) extra += ' · queued v' + r.turret.speed.toFixed(0);
			lines.push('    ' + extra);
		} else {
			lines.push(label + ' · ' + short + ' · ' + r.shots.length + ' shots · purse ' +
				r.ledger.purse.toFixed(2) + ' · ' + r.sim.visitedCount + ' systems · ' +
				(r.steps * GravitySim.DT).toFixed(1) + ' s');
			lines.push('    ' + this.rivalDoneWhy(r) + ' · next in ' +
				Math.max(0, (r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s');
		}
		if (this.lastDecision[index]) lines.push('    last: ' + this.lastDecision[index]);
		return lines.join('\n');
	};

	GravityBot.prototype.careerEnergyWait = function (career, planet, energy, sourcePad) {
		if (!(energy > 0)) return 0;
		const pad = sourcePad || GravityGame.padAt(career, planet);
		const gain = OrbitTech.solarCharge(pad.panel, career.light[planet],
			GravitySim.padSeconds(CAREER_WAIT_SECONDS));
		return gain > 0 ? energy / gain : Infinity;
	};

	/*
	 * What the rulers would pay for this landing's silence, or 0. The offer is
	 * twice the visit value — the value the landing reports, or, with a dead
	 * device or a quiet planet, what accrued unreported — so a worn-out
	 * observation device costs the visit but not the bribe. Only a company with
	 * the bribe-taking persona prices it, and never on the Capital, A.R.F., a
	 * rebel planet or its own rail: the same gates `careerBribe` applies when
	 * the ship actually stands there, so the score cannot promise money the
	 * landing will refuse.
	 */
	GravityBot.prototype.careerBribeOffer = function (career, market, body, value) {
		if (!career.bribeProne || body < 0 || !(value > 0)) return 0;
		if (body === market.capitalPlanet || body === market.arfPlanet) return 0;
		if (market.rebel[body]) return 0;
		if (GravityGame.padOwner(career, body, false) === career.index) return 0;
		const amount = OrbitEcon.bribeValue(value);
		if (amount < OrbitEcon.BRIBE_MIN) return 0;
		return amount >= CAREER_BRIBE_PAY || market.corruption[body] >= CAREER_BRIBE_ROT
			? amount : 0;
	};

	/*
	 * Landing + harvest + contract + solvency value of one trace. Only the
	 * facts differ between a fresh probe and a stored trajectory, so both feed
	 * this: `visitPay` is the harvest, `length`/`steps` the path and arrival,
	 * `landingValue` is what the landing's own visit is worth before the bribe.
	 */
	GravityBot.prototype.careerScoreFacts = function (career, origin, market, runStep,
		flownLen, fee, body, visitPay, length, steps, speed, wearCost, arrivalCondition,
		landingValue) {
		this.careerEval.reject = '';
		this.careerEval.builds = false;
		this.careerEval.exitCost = Infinity;
		this.careerEval.exitSource = '';
		/* the rule's one landing table: cash for the purse, credit for the leg */
		GravityGame.careerLandingFacts(this.careerEval, career, origin, body,
			flownLen, length, steps, runStep, visitPay, speed);
		/* a bribe is cash in the purse before the next launch, so it also
		 * widens what the exit can afford */
		const bribe = this.careerBribeOffer(career, market, body, landingValue || 0);
		this.careerEval.cash += bribe;
		this.careerEval.bribe = bribe;
		let taskPay = this.careerEval.cash + this.careerEval.credit;
		if (this.careerEval.leg === GravityGame.LEG_MEDICS && body === career.capitalPlanet) {
			taskPay += CAREER_MEDIC_VALUE;
		}
		const cashPay = this.careerEval.cash;

		const launchFee = fee || 0;
		const wear = wearCost || 0;
		const cashNet = cashPay - launchFee - wear;
		this.careerEval.cashNet = cashNet;
		/* A return can collect flybys and competitions, but it buys no new
		 * ground. Don't burn the charge on an excursion that won't pay for itself. */
		if (body === origin && cashNet <= 1e-9) {
			this.careerEval.reject = 'bounce';
			return -Infinity;
		}
		if (career.ledger.purse + 1e-9 < launchFee) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		/* A dead ship must be repaired before it can take any departure. */
		const mandatoryRepair = GravityGame.forecastRepairReserve(career, arrivalCondition);
		const completesEscrow = this.careerEval.leg === GravityGame.LEG_DELIVER ||
			this.careerEval.leg === GravityGame.LEG_PATIENTS ||
			this.careerEval.leg === GravityGame.LEG_COMPETE;
		const escrow = completesEscrow ? 0 : careerRefundEscrow(career);
		const exitCash = career.ledger.purse + cashPay - launchFee - mandatoryRepair - escrow;
		if (escrow > 0 && career.ledger.purse - launchFee - mandatoryRepair - escrow < -1e-9) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		/* Other companies can harvest the projected visits before we do. A
		 * fixed entry fine must be covered by cash or this landing's payout. */
		if (landingValue < 0 && exitCash - visitPay + landingValue < -1e-9) {
			this.careerEval.reject = 'fee';
			return -Infinity;
		}
		const arrivalMass = this.careerArrivalMass(career, body);
		const contested = this.careerContested(career, body);
		const departure = this.careerDeparture(career, body, exitCash, arrivalMass, this.probe,
			arrivalCondition === 0 ? 1 : arrivalCondition, !contested, true,
			GravitySim.gameSeconds(steps));
		if (!departure.ok || exitCash + 1e-9 < departure.cost) {
			this.careerEval.reject = departure.physical ? 'exit' : 'unlaunchable';
			return -Infinity;
		}
		const own = career.pads[body];
		const claim = !contested && !own.catapult && departure.builds;
		let padValue;
		if (body === origin) padValue = -departure.cost;
		else if (own.catapult) padValue = CAREER_BUILT_PAD_VALUE + (own.catapult.tier - 1) * 0.1 - departure.cost;
		else if (claim) padValue = this.careerClaimValue(career, body, -1, departure, arrivalMass);
		else {
			/* A commercial ticket, rival rail or imperial rail buys no property. */
			const owner = GravityGame.padOwner(career, body, false);
			padValue = (owner >= 0 || owner === GravityGame.OWNER_REBEL ? CAREER_FOREIGN_PAD_VALUE : 0) - departure.cost;
		}
		/* A shared visit is missed harvest, not lost property: only ground the
		 * landing could have taken loses its worth to the other ship. Charging
		 * the contest on an own rail made a company refuse to go home, which is
		 * exactly the pad it can always launch from. */
		if (contested && !own.catapult && body !== career.capitalPlanet) {
			padValue -= CAREER_CONTESTED_COST;
		}
		padValue -= wear;
		this.careerEval.builds = claim || (own.catapult !== null && departure.builds);
		this.careerEval.exitCost = departure.cost;
		this.careerEval.exitSource = departure.source;
		this.careerEval.taskPay = taskPay;
		this.careerEval.padValue = padValue;
		return taskPay + padValue;
	};

	/* A claimed trajectory, not a speculative fan winner. Remains contested
	 * while the barrel turns AND while the ship is in transit. */
	GravityBot.prototype.careerContested = function (career, body) {
		if (!career.galaxy || body === career.at) return false;
		const actors = career.galaxy.actors;
		for (let i = 0; i < actors.length; i++) {
			const other = actors[i];
			if (other !== career && other.plannedLanding === body) return true;
		}
		return false;
	};

	function sameCareerAim(shot, origin, angleU, speedU) {
		return shot && shot.origin === origin && GravityGame.angleUnits(shot.angle) === angleU &&
			GravityGame.speedUnits(shot.speed) === speedU;
	}

	/* A finite destination penalty does not stop two ships sharing one barrel
	 * from firing the exact same aim. The follower would find the whole path paid. */
	GravityBot.prototype.careerShotBusy = function (career, origin, angleU, speedU) {
		if (!career.galaxy) return false;
		const player = this.careerPlayer;
		for (let i = -1; i < this.count; i++) {
			const actor = i < 0 ? player : this.rivals[i];
			const other = actor.career;
			if (!other || other === career || other.galaxy !== career.galaxy) continue;
			if (other.flying) {
				if (!other.lastFuel && sameCareerAim(actor.sim, origin, angleU, speedU)) return true;
				continue;
			}
			if (other.plannedLanding < 0) continue;
			const queued = i < 0 && this.playerType === GravityGame.PLAYER_BOT ? player.plan : actor.turret;
			if (sameCareerAim(queued, origin, angleU, speedU)) return true;
		}
		return false;
	};

	/* Price a scratch launch and its continuation against one market history.
	 * The burn follows the prefix's last harvest, even if it exhausts the ship. */
	GravityBot.prototype.careerBurnVisitPay = function (career, market, runStep, sim, reportUntil) {
		const prefix = this.careerBurnPrefix;
		const probe = this.probe;
		const offset = sim.liveSteps;
		const hasPrefix = prefix.sim === sim;
		let count = 0;
		if (hasPrefix) {
			for (let i = 0; i < prefix.count; i++) {
				prefix.joinedPlanet[count] = prefix.planet[i];
				prefix.joinedStep[count] = prefix.step[i];
				prefix.joinedDwell[count] = prefix.dwell[i];
				count += 1;
			}
		}
		for (let i = 0; i < probe.predLogCount; i++) {
			if (probe.predLogStep[i] === 0) {
				/* still inside from the prefix: its open row continues, so the
				 * dwell joins that row instead of planting a phantom entry */
				if (!hasPrefix) continue;
				const row = prefix.open[probe.predLogPlanet[i]];
				if (row >= 0 && row < count) prefix.joinedDwell[row] += probe.predLogDwell[i];
				continue;
			}
			prefix.joinedPlanet[count] = probe.predLogPlanet[i];
			prefix.joinedStep[count] = offset + probe.predLogStep[i];
			prefix.joinedDwell[count] = probe.predLogDwell[i];
			count += 1;
		}
		const until = career.ship.obs.fitted
			? offset + Math.max(1, Math.ceil(reportUntil)) : 0;
		return GravityGame.estimateProfitLog(market, runStep,
			prefix.joinedPlanet, prefix.joinedStep, count, career.ledger, until,
			this.careerLanding, prefix.joinedDwell);
	};

	/* Score reports before failure and the eventual service. A scratch launch
	 * has a prefix; a live ship has already paid and harvested that prefix. */
	GravityBot.prototype.careerScoreFlight = function (career, origin, market, runStep,
		flownLen, fee, speed, priorWear, burnDv, prefixSim) {
		const probe = this.probe;
		if (probe.predReason !== END_IMPACT || probe.predBody < 0) {
			this.careerEval.reject = 'noImpact';
			return -Infinity;
		}
		const condition = Math.max(0, career.ship.condition - (priorWear || 0));
		const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, burnDv);
		const arrival = GravityGame.forecastCondition(career, condition, probe.predSteps, speed, burnDv, true);
		const wear = careerFee(career, (career.ship.condition - arrival) * GravityGame.WEAR_REPAIR_COST);
		/* the landing's own visit value, reported or not: the bribe cashes it */
		const landing = this.careerLanding;
		landing.body = probe.predBody;
		landing.value = 0;
		const visitPay = prefixSim
			? this.careerBurnVisitPay(career, market, runStep, prefixSim, reportUntil)
			: GravityGame.estimateProfit(market, runStep, probe, career.ledger, reportUntil, landing);
		const continuationStep = runStep + (prefixSim ? prefixSim.liveSteps : 0);
		const launchSpeed = prefixSim ? prefixSim.speed : speed;
		return this.careerScoreFacts(career, origin, market, continuationStep, flownLen, fee,
			probe.predBody, visitPay, probe.predLength, probe.predSteps, launchSpeed, wear,
			arrival, landing.value);
	};

	/* pad energy, the recharge wait it costs and the EMC fee of one shot */
	GravityBot.prototype.careerScoreTail = function (career, sim, origin, speed, base, fee) {
		const energy = sim.launchEnergy(origin, speed);
		/* only your own battery needs recharge time; a foreign or commercial
		 * rail is paid in money (the fee), not in waiting */
		const wait = GravityGame.padOwner(career, origin) === career.index
			? this.careerEnergyWait(career, origin, energy) : 0;
		this.careerEval.energy = energy;
		this.careerEval.wait = wait;
		this.careerEval.fee = fee;
		return base - energy * wait * CAREER_ENERGY_WAIT_COST - fee;
	};

	/* Scores the trace already in `probe`; `careerEval` exposes its money terms. */
	GravityBot.prototype.careerScoreProbe = function (career, sim, origin, speed, market, runStep) {
		const fee = GravityGame.launchFee(career, origin, speed);
		const base = this.careerScoreFlight(career, origin, market, runStep, 0, fee, speed);
		if (!Number.isFinite(base)) return -Infinity;
		return this.careerScoreTail(career, sim, origin, speed, base, fee);
	};

	/* The same score for a stored trajectory: its visit log re-prices exactly at
	 * the live market, so the book needs no trace (its CPU saving). */
	GravityBot.prototype.careerScoreStored = function (career, sim, market, runStep, entry) {
		const speed = GravityGame.speedOf(entry.speedU);
		const fee = GravityGame.launchFee(career, entry.origin, speed);
		const condition = career.ship.condition;
		const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, 0);
		const landing = this.careerLanding;
		landing.body = entry.body;
		landing.value = 0;
		const visitPay = GravityGame.estimateProfitLog(market, runStep,
			entry.logPlanet, entry.logStep, entry.logCount, career.ledger, reportUntil, landing,
			entry.logDwell);
		const arrival = GravityGame.forecastCondition(career, condition, entry.steps, speed, 0, true);
		const wear = GravityGame.forecastWearCost(career, condition, entry.steps, speed, 0, true);
		const base = this.careerScoreFacts(career, entry.origin, market, runStep, 0, fee,
			entry.body, visitPay, entry.length, entry.steps, speed, wear, arrival, landing.value);
		if (!Number.isFinite(base)) return -Infinity;
		return this.careerScoreTail(career, sim, entry.origin, speed, base, fee);
	};

	GravityBot.prototype.careerTarget = function (career) {
		/* the rule names the next leg of whatever contract is open, so the
		 * bot never has to know which kind it is flying */
		const goals = GravityGame.careerGoalBodies(career);
		if (career.contract >= 0) return goals[0];
		for (let i = 0; i < goals.length; i++) {
			const planet = goals[i];
			if (planet !== career.at &&
				(planet === career.capitalPlanet || career.pads[planet].catapult !== null)) return planet;
		}
		return -1;
	};

	/* the world a stored trajectory was traced in (`career.launchBook`) */
	GravityBot.prototype.careerBookTag = function () {
		const probe = this.probe;
		return GravityGame.launchBookTag(probe.fieldStatic, probe.gravityScale,
			probe.forceScale, probe.strength, probe.bodyCount);
	};

	/* copy the finished trace out of the probe, so the next candidate cannot
	 * overwrite the winner before it is saved */
	GravityBot.prototype.careerLogStore = function (probe) {
		const count = probe.predLogCount;
		const logPlanet = this.careerLogPlanet;
		const logStep = this.careerLogStep;
		const logDwell = this.careerLogDwell;
		for (let i = 0; i < count; i++) {
			logPlanet[i] = probe.predLogPlanet[i];
			logStep[i] = probe.predLogStep[i];
			logDwell[i] = probe.predLogDwell[i];
		}
		this.careerLogCount = count;
	};

	GravityBot.prototype.careerTakeBest = function (origin, angleU, speedU, score, body, length, steps) {
		const best = this.careerBest;
		best.origin = origin;
		best.body = body;
		best.angleU = angleU;
		best.speedU = speedU;
		best.angle = GravityGame.angleOf(angleU);
		best.speed = GravityGame.speedOf(speedU);
		best.score = score;
		best.taskPay = this.careerEval.taskPay;
		best.cashNet = this.careerEval.cashNet;
		best.leg = this.careerEval.leg;
		best.bribe = this.careerEval.bribe;
		best.padValue = this.careerEval.padValue;
		best.energy = this.careerEval.energy;
		best.wait = this.careerEval.wait;
		best.fee = this.careerEval.fee;
		best.exitCost = this.careerEval.exitCost;
		best.exitSource = this.careerEval.exitSource;
		best.builds = this.careerEval.builds;
		best.length = length;
		best.steps = steps;
	};

	/* the fan winner joins the book, so the next plan can score it for free */
	GravityBot.prototype.careerSaveBest = function (career, tag) {
		if (this.careerLogCount === 0 || this.careerBest.origin < 0) return;
		const best = this.careerBest;
		GravityGame.recordLaunch(career.launchBook, tag, {
			origin: best.origin, angleU: best.angleU, speedU: best.speedU,
			body: best.body, steps: best.steps, time: best.steps * GravitySim.DT,
			length: best.length, score: best.score, money: best.taskPay,
			logPlanet: this.careerLogPlanet, logStep: this.careerLogStep,
			logDwell: this.careerLogDwell,
			logCount: this.careerLogCount
		});
	};

	/* Plan only from the rail the ship stands on (own, rival or commercial);
	 * every snapped speed is <= its live cap. */
	GravityBot.prototype.careerScanReset = function (runStep) {
		const scan = this.careerScan;
		if (scan.step === runStep) return;
		scan.step = runStep;
		scan.tried = 0;
		scan.impacts = 0;
		scan.finite = 0;
		scan.bounce = 0;
		scan.exit = 0;
		scan.noImpact = 0;
		scan.book = 0;
		scan.busy = 0;
		scan.burn = 0;
		scan.rescue = 0;
		this.careerBurnTopReset();
	};

	/* the shortlist spans every fan pass of one careerNextShot, so it is reset
	 * by the caller as well as on a new world step */
	GravityBot.prototype.careerBurnTopReset = function () {
		this.careerBurnTop.count = 0;
	};

	function careerAimList(size) {
		return {
			count: 0, score: new Float64Array(size), angleU: new Int32Array(size),
			speedU: new Int32Array(size), book: new Uint8Array(size)
		};
	}

	function careerAimOffer(top, limit, score, angleU, speedU, book) {
		if (!Number.isFinite(score)) return;
		for (let i = 0; i < top.count; i++) {
			if (top.angleU[i] === angleU && top.speedU[i] === speedU) return;
		}
		let slot = top.count < limit ? top.count : -1;
		if (slot < 0) {
			if (score <= top.score[limit - 1] + 1e-12) return;
			slot = limit - 1;
		}
		while (slot > 0 && score > top.score[slot - 1] + 1e-12) {
			top.score[slot] = top.score[slot - 1];
			top.angleU[slot] = top.angleU[slot - 1];
			top.speedU[slot] = top.speedU[slot - 1];
			top.book[slot] = top.book[slot - 1];
			slot -= 1;
		}
		top.score[slot] = score;
		top.angleU[slot] = angleU;
		top.speedU[slot] = speedU;
		top.book[slot] = book ? 1 : 0;
		if (top.count < limit) top.count += 1;
	}

	GravityBot.prototype.careerBurnOffer = function (score, angleU, speedU, book) {
		careerAimOffer(this.careerBurnTop, CAREER_BURN_PRICE_TOP, score, angleU, speedU, book);
	};

	function advancesCareerLeg(leg) {
		return leg === GravityGame.LEG_LOAD || leg === GravityGame.LEG_DELIVER ||
			leg === GravityGame.LEG_MEDICS || leg === GravityGame.LEG_PATIENTS;
	}

	function careerCargoSpeed(career, limit) {
		const task = career.contract >= 0 ? career.tasks[career.contract] : null;
		return task && GravityGame.fragileBreaks(task, limit) ? GravityGame.FRAGILE_SPEED : limit;
	}

	GravityBot.prototype.careerFanShot = function (career, sim, market, runStep, angleU, speedU, horizon, requiredBody) {
		const origin = career.at;
		const scan = this.careerScan;
		if (this.careerShotBusy(career, origin, angleU, speedU)) {
			scan.busy += 1;
			return null;
		}
		const speed = GravityGame.speedOf(speedU);
		const probe = this.probe;
		probe.visited.set(sim.visited);
		probe.visitedCount = sim.visitedCount;
		probe.predictFast(origin, GravityGame.angleOf(angleU), speed, horizon);
		scan.tried += 1;
		if (probe.predReason === END_IMPACT && probe.predBody >= 0) scan.impacts += 1;
		if (requiredBody >= 0 && probe.predBody !== requiredBody) return -Infinity;
		const score = this.careerScoreProbe(career, sim, origin, speed, market, runStep);
		if (!Number.isFinite(score)) {
			const reject = this.careerEval.reject;
			if (reject === 'bounce') scan.bounce += 1;
			else if (reject === 'exit' || reject === 'fee' || reject === 'unlaunchable') scan.exit += 1;
			else scan.noImpact += 1;
			return -Infinity;
		}
		if (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg)) return -Infinity;
		scan.finite += 1;
		this.careerBurnOffer(score, angleU, speedU, false);
		const best = this.careerBest;
		const better = score > best.score + 1e-12 ||
			(Math.abs(score - best.score) <= 1e-12 &&
				(angleU < best.angleU || (angleU === best.angleU && speedU < best.speedU)));
		if (better) {
			this.careerTakeBest(origin, angleU, speedU, score, probe.predBody, probe.predLength, probe.predSteps);
			this.careerLogStore(probe);
			best.fromBook = false;
		}
		return score;
	};

	GravityBot.prototype.careerRefineFan = function (career, sim, market, runStep, horizon,
		angleCount, capU, minU, requiredBody, extend) {
		const top = this.careerRefineTop;
		const spacing = TAU / angleCount;
		for (let i = 0; i < top.count; i++) {
			const angleU = top.angleU[i];
			const angle = GravityGame.angleOf(angleU);
			const speedU = top.speedU[i];
			for (let j = 0; j < CAREER_REFINE_OFFSETS.length; j++) {
				const nearby = GravityGame.angleUnits(angle + spacing * CAREER_REFINE_OFFSETS[j]);
				if (nearby !== angleU) this.careerFanShot(career, sim, market, runStep, nearby, speedU, horizon, requiredBody);
			}
			/* Re-fly the centre at two nearby speeds. The live cap is still the law. */
			const slower = Math.max(minU, Math.round(speedU * 0.94));
			const faster = Math.min(capU, Math.round(speedU * 1.06));
			if (slower < speedU) this.careerFanShot(career, sim, market, runStep, angleU, slower, horizon, requiredBody);
			if (faster > speedU) this.careerFanShot(career, sim, market, runStep, angleU, faster, horizon, requiredBody);
			if (extend) this.careerFanShot(career, sim, market, runStep, angleU, speedU, horizon, requiredBody);
		}
	};

	GravityBot.prototype.careerPlan = function (career, sim, market, runStep, fallback, angles, relaxed) {
		const best = this.careerBest;
		const scan = this.careerScan;
		this.careerScanReset(runStep);
		best.origin = -1;
		best.score = -Infinity;
		best.exitCost = Infinity;
		best.exitSource = '';
		best.builds = false;
		best.fromBook = false;
		best.burnGain = 0;
		best.burnBody = -1;
		best.fuelKg = 0;
		best.fuelProducedKg = 0;
		best.fuelBoughtKg = 0;
		best.bribe = 0;
		if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
			!sim.canLaunchFrom(career.at)) return null;
		const origin = career.at;
		const limit = careerCargoSpeed(career, sim.speedLimit(origin));
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		if (capU < minU) return null;

		this.probe.fieldT = sim.fieldT;
		this.probe.fieldRate = sim.fieldRate;
		this.careerPlans += 1;
		const target = this.careerTarget(career);
		const requiredBody = career.contract >= 0 && !relaxed ? target : -1;
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.planetY[origin],
				sim.planetX[target] - sim.planetX[origin]) : 0;
		const fan = angles > 0 ? angles : CAREER_ANGLES;
		const horizon = fallback ? GravityGame.CAP_SECONDS : CAREER_HORIZON;
		const extra = target >= 0 && target !== origin ? CAREER_TARGET_OFFSETS * 2 + 1 : 0;
		let previousSpeedU = -1;
		let bookNet = -Infinity;
		this.careerLogCount = 0;

		/* the book first: entries traced from this pad re-price from their visit
		 * log alone, so not one trace is spent on them */
		const book = career.launchBook;
		const tag = this.careerBookTag();
		if (GravityGame.bookReady(book, tag)) {
			for (let i = 0; i < book.entries.length; i++) {
				const entry = book.entries[i];
				if (entry.origin !== origin || entry.speedU > capU || entry.speedU < minU) continue;
				if (requiredBody >= 0 && entry.body !== requiredBody) continue;
				if (this.careerShotBusy(career, origin, entry.angleU, entry.speedU)) {
					scan.busy += 1;
					continue;
				}
				scan.book += 1;
				const score = this.careerScoreStored(career, sim, market, runStep, entry);
				if (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg)) continue;
				this.careerBurnOffer(score, entry.angleU, entry.speedU, true);
				if (!(score > best.score + 1e-12)) continue;
				this.careerTakeBest(entry.origin, entry.angleU, entry.speedU, score,
					entry.body, entry.length, entry.steps);
				best.fromBook = true;
				bookNet = this.careerEval.cashNet - best.exitCost;
			}
		}
		/* Even a paying shuttle must compete with fresh harvest periodically.
		 * Use completed flights, not planner calls: fallback scans and actors
		 * sharing this controller must not spend each other's exploration turn. */
		const explore = career.flights % CAREER_BOOK_EXPLORE_EVERY === CAREER_BOOK_EXPLORE_EVERY - 1;
		if (!explore && best.score >= CAREER_BOOK_ENOUGH && bookNet >= CAREER_BOOK_MIN_NET) return best;

		const level = career === this.careerPlayer.career ? this.specFor(PLAYER_INDEX) : this.spec();
		const refines = level.careerRefines;
		const top = this.careerRefineTop;
		top.count = 0;
		const angleCount = fallback ? Math.round(fan * CAREER_FALLBACK_SCALE) : fan;
		/* every rung, the top of the rail included: a cap only reachable through
		 * the fallback fan or the book was never planned for */
		const speedCount = CAREER_SPEED_FRACTIONS.length;
		for (let s = 0; s < speedCount; s++) {
			let speedU = Math.round(limit * CAREER_SPEED_FRACTIONS[s] * GravityGame.SPEED_STEPS);
			if (speedU > capU) speedU = capU;
			if (speedU < minU) speedU = minU;
			if (speedU > capU || speedU === previousSpeedU) continue;
			previousSpeedU = speedU;
			for (let a = 0; a < angleCount + extra; a++) {
				const angle = a < angleCount ? (a + 0.5) / angleCount * TAU
					: targetAngle + (a - angleCount - CAREER_TARGET_OFFSETS) * CAREER_TARGET_STEP;
				const angleU = GravityGame.angleUnits(angle);
				const score = this.careerFanShot(career, sim, market, runStep, angleU, speedU, horizon, requiredBody);
				if (!refines || score === null) continue;
				let rank = score;
				const probe = this.probe;
				/* An unfinished multi-visit trace is a search seed, not a payable shot.
				 * Rows are time-ordered: the leading step-0 (spawn-inside) rows
				 * are not visits made in flight, so they do not count here. */
				const unfinished = !fallback && probe.predReason === END_TIME;
				let seedVisits = probe.predLogCount;
				if (unfinished) {
					let spawn = 0;
					while (spawn < seedVisits && probe.predLogStep[spawn] === 0) spawn++;
					seedVisits -= spawn;
				}
				if (unfinished && seedVisits >= 2) {
					const speed = GravityGame.speedOf(speedU);
					const condition = career.ship.condition;
					const until = GravityGame.forecastReportUntil(career, condition, speed, 0);
					rank = GravityGame.estimateProfit(market, runStep, probe, career.ledger, until) -
						GravityGame.launchFee(career, origin, speed) -
						GravityGame.forecastWearCost(career, condition, probe.predSteps, speed, 0, false);
				}
				careerAimOffer(top, refines, rank, angleU, speedU, false);
			}
		}
		/* Don't trade a funded first claim for a speculative harvest. */
		if (top.count && (career.flights > 0 || !best.builds)) {
			const reach = fallback || refines === CAREER_REFINE_SEEDS ? GravityGame.CAP_SECONDS : CAREER_REFINE_HORIZON;
			this.careerRefineFan(career, sim, market, runStep, reach, angleCount, capU, minU, requiredBody, !fallback);
		}
		if (best.origin >= 0) this.careerSaveBest(career, tag);
		return best.origin >= 0 ? best : null;
	};

	/* the winning burn's landing facts, kept so a launch can be priced from it */
	GravityBot.prototype.careerBurnFacts = function () {
		const best = this.careerBurnBest;
		const ev = this.careerEval;
		best.taskPay = ev.taskPay;
		best.cashNet = ev.cashNet;
		best.leg = ev.leg;
		best.bribe = ev.bribe;
		best.padValue = ev.padValue;
		best.builds = ev.builds;
		best.exitCost = ev.exitCost;
		best.exitSource = ev.exitSource;
	};

	/*
	 * Score of one burn candidate, or -Infinity when it is not worth flying:
	 * it must still land an active contract, land at all, and beat coasting by
	 * `careerBurnGain` after the fuel it burns. Leaves the winner's landing in
	 * `probe`.
	 */
	GravityBot.prototype.careerBurnScore = function (career, sim, market, runStep,
		angleU, dvU, requiredBody, coastScore, fee, priorWear, prefixSim) {
		const dv = GravityGame.speedOf(dvU);
		const ship = career.ship;
		this.probe.predictBurnFast(sim, GravityGame.angleOf(angleU), dv);
		if (requiredBody >= 0 && this.probe.predBody !== requiredBody) return -Infinity;
		const raw = this.careerScoreFlight(career, sim.origin, market, runStep,
			sim.flightLength, fee, 0, priorWear, dv, prefixSim);
		if (!Number.isFinite(raw) || (requiredBody >= 0 && !advancesCareerLeg(this.careerEval.leg))) return -Infinity;
		const fuelKg = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
		const fuelCost = fuelKg * GravityGame.fuelPrice(career);
		if (this.probe.predBody === sim.origin && this.careerEval.cashNet <= fuelCost + 1e-9) return -Infinity;
		const score = raw - fuelCost;
		if (Number.isFinite(coastScore) && score <= coastScore + this.careerBurnGain) return -Infinity;
		return score;
	};

	/*
	 * Mid-flight course correction: a coarse ring at the two Δv rungs, then a
	 * fine fan around the coarse winner and the contract bearing. `rescueOnly`
	 * first traces the coast and gives up unless it would be lost, so a healthy
	 * flight pays one trace instead of a whole search.
	 */
	GravityBot.prototype.careerBurnPlan = function (career, sim, market, runStep,
		rescueOnly, fee) {
		const best = this.careerBurnBest;
		best.body = -1;
		best.score = -Infinity;
		best.taskPay = 0;
		best.bribe = 0;
		best.padValue = 0;
		best.builds = false;
		best.exitCost = Infinity;
		best.exitSource = '';
		if (career.ended !== GravityGame.CAREER_OPEN || sim.status !== GravitySim.STATUS_FLYING) {
			return null;
		}
		/* A live ship has already paid its prefix; a scratch launch has not. */
		const prefixSim = career.flying ? null : sim;
		const condition = prefixSim
			? GravityGame.forecastCondition(career, career.ship.condition, sim.liveSteps, sim.speed, 0, false)
			: career.ship.condition;
		if (condition <= 0) return null;
		const priorWear = career.ship.condition - condition;
		const limit = sim.burnLimit();
		const capU = Math.floor(limit * GravityGame.SPEED_STEPS + 1e-9);
		if (capU < 1) return null;

		const requiredBody = career.contract >= 0 ? this.careerTarget(career) : -1;
		this.probe.predictBurnFast(sim, 0, 0);
		const coastLands = this.probe.predReason === END_IMPACT && this.probe.predBody >= 0;
		const onTarget = requiredBody < 0 || (coastLands && this.probe.predBody === requiredBody);
		if (rescueOnly && onTarget) return null;
		let coastScore = -Infinity;
		if (onTarget) {
			coastScore = this.careerScoreFlight(career, sim.origin, market, runStep,
				sim.flightLength, fee, 0, priorWear, 0, prefixSim);
		}
		best.coastScore = coastScore;

		const target = requiredBody >= 0 ? requiredBody : this.careerTarget(career);
		const targetAngle = target >= 0
			? Math.atan2(sim.planetY[target] - sim.cargo.y, sim.planetX[target] - sim.cargo.x) : 0;
		const dvU = this.careerBurnRungs;
		let rungs = 0;
		for (let f = 0; f < CAREER_BURN_FRACTIONS.length; f++) {
			const rung = Math.max(1, Math.min(capU,
				Math.round(capU * CAREER_BURN_FRACTIONS[f])));
			if (rungs === 1 && rung === dvU[0]) continue;
			dvU[rungs] = rung;
			rungs += 1;
		}
		const ringStep = TAU / CAREER_BURN_ANGLES;
		let bestAngleU = -1;
		let bestScore = -Infinity;
		/* the contract bearing and its opposite are worth trying beside the ring */
		const aimed = target >= 0 ? 2 : 0;
		for (let r = 0; r < rungs; r++) {
			for (let a = 0; a < CAREER_BURN_ANGLES + aimed; a++) {
				const rawAngle = a < CAREER_BURN_ANGLES
					? (a + 0.5) * ringStep
					: targetAngle + (a - CAREER_BURN_ANGLES) * Math.PI;
				const angleU = GravityGame.angleUnits(rawAngle);
				const score = this.careerBurnScore(career, sim, market, runStep,
					angleU, dvU[r], requiredBody, coastScore, fee, priorWear, prefixSim);
				if (!(score > bestScore + 1e-12)) continue;
				bestScore = score;
				bestAngleU = angleU;
				best.body = this.probe.predBody;
				best.score = score;
				best.angleU = angleU;
				best.dvU = dvU[r];
				best.steps = this.probe.predSteps;
				this.careerBurnFacts();
			}
		}
		if (bestAngleU < 0) return null;

		/* refine around the winner: a narrower fan, at both Δv rungs */
		const refineStep = ringStep / (CAREER_BURN_REFINE + 1);
		for (let r = 0; r < rungs; r++) {
			for (let k = -CAREER_BURN_REFINE; k <= CAREER_BURN_REFINE; k++) {
				const angleU = GravityGame.angleUnits(
					GravityGame.angleOf(bestAngleU) + k * refineStep);
				const score = this.careerBurnScore(career, sim, market, runStep,
					angleU, dvU[r], requiredBody, coastScore, fee, priorWear, prefixSim);
				if (!(score > best.score + 1e-12)) continue;
				best.body = this.probe.predBody;
				best.score = score;
				best.angleU = angleU;
				best.dvU = dvU[r];
				best.steps = this.probe.predSteps;
				this.careerBurnFacts();
			}
		}
		best.angle = GravityGame.angleOf(best.angleU);
		best.dv = GravityGame.speedOf(best.dvU);
		best.fuelKg = OrbitTech.impulseFuel(best.dv, career.ship.engine,
			career.ship.mass, career.ship.fuelKg);
		return best;
	};

	/*
	 * One flight's impulse use. The first window is the nudge that re-targets
	 * the whole flight; later windows only rescue a coast that would be lost.
	 * `state` is the flying actor (a rival or the page's own bot actor) and
	 * self-resets when the sim's step counter starts over on a new launch.
	 */
	GravityBot.prototype.careerFlightBurn = function (career, sim, market, runStep, state) {
		if (sim.status !== GravitySim.STATUS_FLYING) return null;
		if (state.burnStep > sim.liveSteps) {
			state.burn = 0;
			state.burnTries = 0;
			state.burnNext = CAREER_BURN_AT;
		}
		state.burnStep = sim.liveSteps;
		const ship = career.ship;
		if (career.ended !== GravityGame.CAREER_OPEN || !ship.engine || !(ship.fuelKg > 0)) {
			return null;
		}
		if (state.burn >= CAREER_BURNS_MAX || sim.liveSteps < state.burnNext) return null;
		if (sim.liveSteps > sim.stepLimit - CAREER_BURN_TAIL) return null;
		const nudge = state.burn === 0;
		state.burnTries += 1;
		state.burnNext = sim.liveSteps + CAREER_BURN_EVERY;
		const who = careerTraceIndex(career);
		const plan = this.careerBurnPlan(career, sim, market, runStep, !nudge);
		if (!plan) {
			if (state.burnTries === 1) this.traceAdd(who, 'coast', 'no improving burn found', runStep);
			return null;
		}
		if (!GravityGame.careerBurn(career, sim, plan.angle, plan.dv)) return null;
		state.burn += 1;
		career.plannedLanding = plan.body;
		this.careerBurnsPlanned += 1;
		this.traceCareerBurn(career, sim, plan.angle, plan.dv, runStep,
			'→ P' + plan.body + ' · score ' + signed(plan.score) +
			' vs coast ' + signed(plan.coastScore));
		return plan;
	};

	GravityBot.prototype.traceCareerBurn = function (career, sim, angle, dv, step, why = 'manual') {
		this.traceAdd(careerTraceIndex(career), 'burn', 'Δv ' + dv.toFixed(1) + ' · ' + why +
			' · ' + career.ship.fuelKg.toFixed(1) + ' kg left', step, [sim.liveSteps, angle, dv]);
	};

	/*
	 * Career rivals: each one is a full `GravityGame` career on the shared map —
	 * its own HQ, purse, ship, task board, EMC network and science hull — flown
	 * by the same synchronous controller the benches use. They launch from
	 * whatever EMC stands on their planet (own, a rival's, or the commercial
	 * one), so usage tax flows both ways. The career clock runs whenever it is
	 * not landing-paused, so the companies launch, fly and shop on world time
	 * whether or not your ship is in the air; after landing a rival sits out
	 * CAREER_RIVAL_GAP world seconds (plus its phase) before the next attempt.
	 */
	GravityBot.prototype.startCareers = function (galaxy, seed, trade) {
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
			if (!r.career) r.career = GravityGame.createCareer(r.ledger);
			/* rivals are created after the universe is set, so give them the
			 * mask before startCareer picks an HQ from the in-play planets */
			if (this.probe.planetMask) {
				GravityGame.setCareerUniverse(r.career, this.probe.planetMask,
					this.planetUniverseCount || OrbitWorld.PLANETS);
			}
			GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(seed, i), trade, null, galaxy);
			/* whoever flies this company by hand needs the live rail gate */
			r.sim.attachCareer(r.career);
			r.career.bribeProne = this.careerBribeProne(i);
			r.sim.fieldT = trade.t;
			r.sim.fieldRate = this.probe.fieldRate;
			r.basePlanet = r.career.hq;
			this.traceAdd(i, 'start', 'HQ P' + r.career.hq + ' · purse ' +
				r.career.ledger.purse.toFixed(2) + ' · first try in ' +
				(r.readyStep * GravitySim.DT).toFixed(1) + ' s', 0);
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

	GravityBot.prototype.addCareerRival = function (galaxy, trade, planet, step) {
		const i = this.count;
		this.traceByActor[i].length = 0;
		this.lastDecision[i] = '';
		this.ensureRivals(i + 1);
		const r = this.rivals[i];
		this.rivalTypes[i] = GravityGame.PLAYER_BOT;
		this.resetActor(r, planet);
		r.gapPhase = i * CAREER_RIVAL_PHASE;
		r.readyStep = step + r.gapPhase;
		r.idleTries = 0;
		r.waitTries = 0;
		r.burn = 0;
		r.burnTries = 0;
		r.burnNext = CAREER_BURN_AT;
		r.burnStep = 0;
		this.careerDropQueue(r);
		r.career = GravityGame.createCareer(r.ledger);
		GravityGame.setCareerUniverse(r.career, this.probe.planetMask, this.planetUniverseCount);
		GravityGame.startCareer(r.career, r.sim, GravityGame.rivalSeed(this.seed, i),
			trade, null, galaxy, planet);
		r.sim.attachCareer(r.career);
		r.career.bribeProne = this.careerBribeProne(i);
		r.sim.fieldT = trade.t;
		r.sim.fieldRate = this.probe.fieldRate;
		r.basePlanet = planet;
		this.count += 1;
		this.traceAdd(i, 'start', 'HQ P' + planet, step);
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
					this.traceAdd(i, 'evacuated', 'to HQ P' + career.hq, runStep);
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

	/* Mirror the live field into the one scratch flight shared by pre-launch
	 * burn searches. It has no rail, because every candidate is already snapped
	 * to the live pad's cap and the live sim prices its battery energy. */
	GravityBot.prototype.careerBindBurnSim = function (r) {
		const src = this.burnShotSim;
		const live = r.sim;
		src.fieldT = live.fieldT;
		src.fieldRate = live.fieldRate;
		src.setScales(live.gravityScale, live.forceScale);
		if (src.bodyCount !== live.bodyCount || src.bodyR !== live.bodyR ||
			src.strength !== live.strength || src.fillField !== live.fillField ||
			src.fieldStatic !== live.fieldStatic) {
			src.setField(live.bodyCount, live.bodyR, live.strength,
				live.fillField, live.fieldStatic);
		}
		src.setPlanetMask(live.planetMask);
		src.setLaunchNetwork(null, r.career.ship);
		return src;
	};

	/* Launch one candidate in the scratch sim and fly it to the nudge window. */
	GravityBot.prototype.careerBurnLaunch = function (r, src, origin, angleU, speedU) {
		const live = r.sim;
		src.clear();
		src.visited.set(live.visited);
		src.visitedCount = live.visitedCount;
		src.landedBody = live.landedBody;
		src.stepStale = true;
		src.stepLimit = GravityGame.CAP_STEPS;
		src.limitReason = GravitySim.END_TIME;
		src.launch(origin, GravityGame.angleOf(angleU), GravityGame.speedOf(speedU));
		const prefix = this.careerBurnPrefix;
		prefix.sim = src;
		prefix.count = 0;
		prefix.open.fill(-1);
		src.predInside.fill(0);
		src.markSystemsAt(src.cargo.x, src.cargo.y, src.predInside);
		/* spawn-inside rows open at step 0, so the stay-pay trail survives the burn join */
		for (let p = 0; p < src.planetCount && prefix.count < PRED_LOG_MAX; p++) {
			if (!src.predInside[p]) continue;
			prefix.planet[prefix.count] = p;
			prefix.step[prefix.count] = 0;
			prefix.dwell[prefix.count] = 0;
			prefix.open[p] = prefix.count;
			prefix.count += 1;
		}
		for (let s = 0; s < CAREER_BURN_AT && src.status === GravitySim.STATUS_FLYING; s++) {
			src.stepOne();
			const entered = src.stepInsideAt(src.cargo.x, src.cargo.y, src.predInside, src.predEntered);
			for (let p = 0; p < src.planetCount; p++) {
				const row = prefix.open[p];
				if (row < 0) continue;
				if (src.predInside[p]) prefix.dwell[row] += 1;
				else prefix.open[p] = -1;
			}
			for (let i = 0; i < entered && prefix.count < PRED_LOG_MAX; i++) {
				const p = src.predEntered[i];
				prefix.planet[prefix.count] = p;
				prefix.step[prefix.count] = src.liveSteps;
				prefix.dwell[prefix.count] = 0;
				prefix.open[p] = prefix.count;
				prefix.count += 1;
			}
		}
	};

	/* traceFromCargo borrows the shared probe's field and visit state. */
	GravityBot.prototype.careerRestoreBurnProbe = function (r) {
		const live = r.sim;
		this.probe.fieldRate = live.fieldRate;
		this.probe.setScales(live.gravityScale, live.forceScale);
		this.probe.visited.set(live.visited);
		this.probe.visitedCount = live.visitedCount;
	};

	/*
	 * Re-price the fan's best few shots as flights with one burn. The flying
	 * controller nudges at step CAREER_BURN_AT with the same careerBurnPlan, so
	 * the queued shot should be chosen and scored by the landing that burn
	 * reaches. `fee` gates the burn's solvency check (already paid mid-flight,
	 * still unpaid here). The search uses the fuel actually on board; a separate
	 * committed-launch forecast may temporarily model an affordable top-up.
	 */
	GravityBot.prototype.careerPriceBurn = function (r, plan, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const top = this.careerBurnTop;
		if (!plan || !ship.engine || !ship.tank || !(ship.tank.fuelCap > 0) ||
			top.count === 0) return;
		const src = this.careerBindBurnSim(r);
		const live = r.sim;
		const origin = plan.origin;
		const ballistic = plan.score;
		const shot = this.careerBurnShot;
		let bestScore = ballistic;
		let found = false;
		for (let i = 0; i < top.count; i++) {
			const angleU = top.angleU[i];
			const speedU = top.speedU[i];
			const speed = GravityGame.speedOf(speedU);
			if (speed > live.speedLimit(origin) + 1e-9) continue;
			this.careerBurnLaunch(r, src, origin, angleU, speedU);
			this.careerScan.burn += 1;
			if (src.status !== GravitySim.STATUS_FLYING) continue;
			const fee = GravityGame.launchFee(career, origin, speed);
			const burn = this.careerBurnPlan(career, src, market, runStep, false, fee);
			if (!burn) continue;
			const energy = live.launchEnergy(origin, speed);
			const wait = GravityGame.padOwner(career, origin) === career.index
				? this.careerEnergyWait(career, origin, energy) : 0;
			const score = burn.score - fee - energy * wait * CAREER_ENERGY_WAIT_COST;
			if (!(score > bestScore + this.careerBurnPriceMargin)) continue;
			bestScore = score;
			found = true;
			shot.body = burn.body;
			shot.angleU = angleU;
			shot.speedU = speedU;
			shot.score = score;
			shot.burnGain = score - ballistic;
			shot.taskPay = burn.taskPay;
			shot.cashNet = burn.cashNet;
			shot.leg = burn.leg;
			shot.bribe = burn.bribe;
			shot.padValue = burn.padValue;
			shot.fee = fee;
			shot.energy = energy;
			shot.wait = wait;
			shot.exitCost = burn.exitCost;
			shot.exitSource = burn.exitSource;
			shot.builds = burn.builds;
			shot.fromBook = top.book[i] === 1;
			shot.fuelKg = burn.fuelKg;
			shot.steps = CAREER_BURN_AT + burn.steps;
		}
		this.careerRestoreBurnProbe(r);
		if (!found) return;
		this.careerBurnPrices += 1;
		plan.angleU = shot.angleU;
		plan.speedU = shot.speedU;
		plan.angle = GravityGame.angleOf(shot.angleU);
		plan.speed = GravityGame.speedOf(shot.speedU);
		plan.body = shot.body;
		plan.score = shot.score;
		/* the tank fuel is a money term, so the plan's score identity holds */
		const fuelCost = shot.fuelKg * GravityGame.fuelPrice(career);
		plan.taskPay = shot.taskPay - fuelCost;
		plan.cashNet = shot.cashNet - fuelCost;
		plan.leg = shot.leg;
		plan.bribe = shot.bribe;
		plan.fuelKg = shot.fuelKg;
		plan.padValue = shot.padValue;
		plan.fee = shot.fee;
		plan.energy = shot.energy;
		plan.wait = shot.wait;
		plan.exitCost = shot.exitCost;
		plan.exitSource = shot.exitSource;
		plan.builds = shot.builds;
		plan.fromBook = shot.fromBook;
		plan.steps = shot.steps;
		plan.burnGain = shot.burnGain;
		plan.burnBody = shot.body;
		this.traceAdd(r.index, 'burn price', 'P' + origin + '→P' + shot.body +
			' · ' + signed(shot.burnGain) + ' over ballistic · fuel ' +
			shot.fuelKg.toFixed(1) + ' kg · ' + top.count + ' shots priced', runStep);
	};

	/* Copy a complete plan without allocating in the launch path. */
	function copyCareerPlan(from, to) {
		to.origin = from.origin;
		to.body = from.body;
		to.angleU = from.angleU;
		to.speedU = from.speedU;
		to.angle = from.angle;
		to.speed = from.speed;
		to.score = from.score;
		to.taskPay = from.taskPay;
		to.cashNet = from.cashNet;
		to.leg = from.leg;
		to.bribe = from.bribe;
		to.padValue = from.padValue;
		to.energy = from.energy;
		to.wait = from.wait;
		to.fee = from.fee;
		to.exitCost = from.exitCost;
		to.exitSource = from.exitSource;
		to.fromBook = from.fromBook;
		to.builds = from.builds;
		to.length = from.length;
		to.steps = from.steps;
		to.burnGain = from.burnGain;
		to.burnBody = from.burnBody;
		to.fuelKg = from.fuelKg;
		to.fuelProducedKg = from.fuelProducedKg;
		to.fuelBoughtKg = from.fuelBoughtKg;
	}

	/* Whole kilograms keep the bot's forecast and transaction identical. The
	 * current launch fee is always reserved; easy/normal also keep the next fee. */
	GravityBot.prototype.careerFuelOffer = function (career, planet, sim) {
		const quote = this.careerFuelQuote;
		quote.kg = 0;
		quote.produceKg = 0;
		quote.buyKg = 0;
		const ship = career.ship;
		if (career.ended !== GravityGame.CAREER_OPEN || planet < 0 || !ship.engine || !ship.tank) return quote;
		const room = Math.max(0, Math.floor(ship.tank.fuelCap - ship.fuelKg + 1e-9));
		if (room <= 0) return quote;
		const pad = career.pads[planet];
		if (pad.catapult !== null) {
			/* Keep a full-cap departure firable after conversion; the shortlist may
			 * still pick a faster shot than the baseline plan. The world's force
			 * scale widens the cap but never the energy it stores, so it must
			 * come from the live sim — career.forceScale is unset for the player
			 * career and would size the reserve for a weaker rail than fires */
			const forceScale = sim ? sim.forceScale : career.forceScale;
			const cap = OrbitTech.speedLimit(pad.battery.capacity, ship.mass, pad.catapult, forceScale);
			const launchKwh = OrbitTech.launchEnergy(ship.mass, pad.catapult, cap);
			const free = Math.max(0, pad.chargeKwh - pad.reservedKwh - launchKwh);
			quote.produceKg = Math.min(room, Math.floor(free * GravityGame.FUEL_KG_PER_KWH + 1e-9));
		}
		const reserve = GravityGame.launchFee(career, planet, GravityGame.padLift(career, planet)) +
			careerRefundEscrow(career) + (this.level === 'hard' ? 0 : CAREER_PURSE_RESERVE);
		const cash = Math.max(0, career.ledger.purse - reserve);
		const price = GravityGame.fuelPrice(career);
		quote.buyKg = Math.min(room - quote.produceKg,
			price > 0 ? Math.floor(cash / price + 1e-9) : room - quote.produceKg);
		quote.kg = quote.produceKg + quote.buyKg;
		return quote;
	};

	/* Price only the fuel the winning burn needs. Conversion has the replacement
	 * opportunity cost plus recharge wait; purchase is already in the burn score. */
	GravityBot.prototype.careerFuelPricePlan = function (career, plan, quote, planet) {
		const need = Math.max(0, Math.ceil(plan.fuelKg - career.ship.fuelKg - 1e-9));
		if (need > quote.kg) return false;
		const produced = Math.min(quote.produceKg, need);
		const bought = need - produced;
		const kwh = produced / GravityGame.FUEL_KG_PER_KWH;
		const wait = this.careerEnergyWait(career, planet, kwh, career.pads[planet]);
		const cost = produced * GravityGame.fuelPrice(career);
		plan.fuelProducedKg = produced;
		plan.fuelBoughtKg = bought;
		plan.taskPay -= cost;
		plan.cashNet -= cost;
		plan.wait += wait;
		plan.score -= cost + plan.energy * wait * CAREER_ENERGY_WAIT_COST;
		return true;
	};

	GravityBot.prototype.careerCommitFuel = function (r, plan, runStep) {
		const career = r.career;
		const produced = plan.fuelProducedKg;
		const bought = plan.fuelBoughtKg;
		if (produced + bought <= 0) return true;
		const got = GravityGame.produceFuel(career, plan.origin, produced) +
			GravityGame.buyFuel(career, bought);
		plan.fuelProducedKg = 0;
		plan.fuelBoughtKg = 0;
		if (got !== produced + bought) {
			this.traceAdd(r.index, 'no shot', 'fuel quote changed · got ' + got + ' of ' +
				(produced + bought) + ' kg · retry in ' + (CAREER_RIVAL_GAP * GravitySim.DT).toFixed(1) + ' s', runStep);
			return false;
		}
		this.careerFuelTopUps += 1;
		this.traceAdd(r.index, 'fuel', '+' + got + ' kg · ' + produced + ' from battery · ' +
			bought + ' bought · ' + (bought * GravityGame.fuelPrice(career)).toFixed(2) +
			' · tank ' + career.ship.fuelKg.toFixed(1) + ' kg', runStep);
		return true;
	};

	/* One scratch forecast, after the sit decision: never stock fuel just to idle. */
	GravityBot.prototype.careerPrepareFuel = function (r, plan, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const quote = this.careerFuelOffer(career, plan.origin, r.sim);
		if (quote.kg <= 0 || plan.fuelProducedKg + plan.fuelBoughtKg > 0) return false;
		const saved = this.careerSparePlan;
		copyCareerPlan(plan, saved);
		const fuel0 = ship.fuelKg;
		this.careerBurnOffer(plan.score - plan.burnGain, plan.angleU, plan.speedU, plan.fromBook);
		ship.fuelKg = fuel0 + quote.kg;
		this.careerPriceBurn(r, plan, market, runStep);
		ship.fuelKg = fuel0;
		if (!this.careerFuelPricePlan(career, plan, quote, plan.origin) ||
			plan.score <= saved.score + this.careerBurnPriceMargin || plan.score <= CAREER_MIN_SCORE) {
			copyCareerPlan(saved, plan);
			return false;
		}
		if (!this.careerCommitFuel(r, plan, runStep)) {
			copyCareerPlan(saved, plan);
			return false;
		}
		return true;
	};

	GravityBot.prototype.careerRescueOfferAngle = function (rawAngle) {
		const angles = this.careerRescueAngles;
		const angleU = GravityGame.angleUnits(rawAngle);
		for (let i = 0; i < angles.count; i++) {
			if (angles.angleU[i] === angleU) return;
		}
		angles.angleU[angles.count] = angleU;
		angles.count += 1;
	};

	/*
	 * Dead-end launch pricing: the ballistic fan had no finite plan, so try a
	 * bounded ring of launch aims and choose the best one-burn landing that
	 * beats sitting still. The current rail — including a commercial fallback —
	 * stays selected; only the caller may clear it when this returns null.
	 */
	GravityBot.prototype.careerRescueBurn = function (r, market, runStep) {
		const career = r.career;
		const ship = career.ship;
		const live = r.sim;
		const origin = career.at;
		if (origin < 0 || career.ended !== GravityGame.CAREER_OPEN || !ship.engine ||
			!ship.tank || !(ship.tank.fuelCap > 0) || !live.canLaunchFrom(origin)) return null;
		const capU = Math.floor(careerCargoSpeed(career, live.speedLimit(origin)) * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(GravitySim.SPEED_MIN);
		if (capU < minU) return null;

		const rungs = this.careerRescueRungs;
		rungs[0] = capU;
		rungs[1] = Math.max(minU, Math.round(capU * CAREER_RESCUE_SPEED_FRACTION));
		const rungCount = rungs[1] === rungs[0] ? 1 : 2;
		const angles = this.careerRescueAngles;
		angles.count = 0;
		const ringStep = TAU / CAREER_RESCUE_ANGLES;
		for (let a = 0; a < CAREER_RESCUE_ANGLES; a++) {
			this.careerRescueOfferAngle((a + 0.5) * ringStep);
		}
		const target = career.contract >= 0 ? this.careerTarget(career) : -1;
		if (target >= 0 && target !== origin) {
			const bearing = Math.atan2(live.planetY[target] - live.planetY[origin],
				live.planetX[target] - live.planetX[origin]);
			this.careerRescueOfferAngle(bearing);
			this.careerRescueOfferAngle(bearing + Math.PI);
		}

		this.careerBurnTopReset();
		const src = this.careerBindBurnSim(r);
		const shot = this.careerBurnShot;
		const fuel0 = ship.fuelKg;
		const quote = this.careerFuelOffer(career, origin, r.sim);
		ship.fuelKg = fuel0 + quote.kg;
		let bestScore = 0;
		let found = false;
		for (let s = 0; s < rungCount; s++) {
			const speedU = rungs[s];
			const speed = GravityGame.speedOf(speedU);
			if (!GravityGame.careerCanFire(career, live, origin, speed)) continue;
			const fee = GravityGame.launchFee(career, origin, speed);
			const energy = live.launchEnergy(origin, speed);
			const wait = GravityGame.padOwner(career, origin) === career.index
				? this.careerEnergyWait(career, origin, energy) : 0;
			for (let a = 0; a < angles.count; a++) {
				if (this.careerShotBusy(career, origin, angles.angleU[a], speedU)) continue;
				this.careerScan.rescue += 1;
				this.careerBurnLaunch(r, src, origin, angles.angleU[a], speedU);
				if (src.status !== GravitySim.STATUS_FLYING) continue;
				const burn = this.careerBurnPlan(career, src, market, runStep, false, fee);
				if (!burn) continue;
				const score = burn.score - fee - energy * wait * CAREER_ENERGY_WAIT_COST;
				if (!(score > CAREER_BURN_PRICE_MARGIN)) continue;
				if (!(score > bestScore + 1e-12)) continue;
				bestScore = score;
				found = true;
				shot.body = burn.body;
				shot.angleU = angles.angleU[a];
				shot.speedU = speedU;
				shot.score = score;
				shot.burnGain = score;
				shot.taskPay = burn.taskPay;
				shot.cashNet = burn.cashNet;
				shot.leg = burn.leg;
				shot.padValue = burn.padValue;
				shot.fee = fee;
				shot.energy = energy;
				shot.wait = wait;
				shot.exitCost = burn.exitCost;
				shot.exitSource = burn.exitSource;
				shot.builds = burn.builds;
				shot.fromBook = false;
				shot.fuelKg = burn.fuelKg;
				shot.steps = CAREER_BURN_AT + burn.steps;
			}
		}
		this.careerRestoreBurnProbe(r);
		ship.fuelKg = fuel0;
		if (!found) return null;

		const best = this.careerBest;
		best.origin = origin;
		best.body = shot.body;
		best.angleU = shot.angleU;
		best.speedU = shot.speedU;
		best.angle = GravityGame.angleOf(shot.angleU);
		best.speed = GravityGame.speedOf(shot.speedU);
		best.score = shot.score;
		/* the tank fuel is a money term, so the plan's score identity holds */
		const fuelCost = shot.fuelKg * GravityGame.fuelPrice(career);
		best.taskPay = shot.taskPay - fuelCost;
		best.cashNet = shot.cashNet - fuelCost;
		best.leg = shot.leg;
		best.fuelKg = shot.fuelKg;
		best.fuelProducedKg = 0;
		best.fuelBoughtKg = 0;
		best.padValue = shot.padValue;
		best.fee = shot.fee;
		best.energy = shot.energy;
		best.wait = shot.wait;
		best.exitCost = shot.exitCost;
		best.exitSource = shot.exitSource;
		best.builds = shot.builds;
		best.length = 0;
		best.steps = shot.steps;
		best.fromBook = false;
		best.burnGain = shot.burnGain;
		best.burnBody = shot.body;
		if (!this.careerFuelPricePlan(career, best, quote, origin) ||
			best.score <= CAREER_BURN_PRICE_MARGIN) return null;
		this.careerBurnRescues += 1;
		this.traceAdd(r.index, 'burn rescue', 'P' + origin + '→P' + shot.body +
			' · ' + signed(shot.burnGain) + ' over sit · fuel ' +
			shot.fuelKg.toFixed(1) + ' kg · ' + this.careerScan.rescue +
			' shots priced', runStep);
		return best;
	};

	/*
	 * One search for the next shot, shared by a rival company and by the bot
	 * flying the page's own company: the fan from the standing pad, the
	 * commercial rail when that pad is drained, and the recovery a company
	 * needs when no trajectory exists at all.
	 */
	GravityBot.prototype.careerReadyShot = function (r, plan, market, runStep, priced) {
		r.idleTries = 0;
		if (priced) this.careerPriceBurn(r, plan, market, runStep);
		const career = r.career;
		if (plan && career.at === career.capitalPlanet) {
			const compete = career.tasks[GravityGame.COMPETE_SLOT];
			if (compete.kind === GravityGame.TASK_COMPETE &&
				compete.state === GravityGame.TASK_OFFERED &&
				compete.planet === career.capitalPlanet &&
				plan.length >= compete.minLength &&
				runStep + plan.steps <= compete.deadline) {
				GravityGame.acceptTask(career, GravityGame.COMPETE_SLOT);
			}
		}
		return plan;
	};

	GravityBot.prototype.careerOpenFan = function (r, market, runStep, angles) {
		const career = r.career;
		const sim = r.sim;
		const target = this.careerTarget(career);
		const plan = this.careerPlan(career, sim, market, runStep, true, angles, true);
		if (!plan) return null;
		/* A relaxed fan that lands on neither the pickup nor the delivery is a
		 * reposition, not a leg. A true bounce leaves the ship and the contract
		 * where they were, so it cannot justify another search from this pad. */
		if (plan.body !== plan.origin && plan.body !== target) {
			this.traceAdd(r.index, 'open fan', 'contract wants P' + target +
				' · next best is P' + plan.body, runStep);
			return plan;
		}
		this.careerDeferContract(career, runStep, 'no reachable leg from this pad');
		this.careerBurnTopReset();
		return this.careerPlan(career, sim, market, runStep, true, angles);
	};

	GravityBot.prototype.careerNextShot = function (r, market, trade, runStep) {
		const career = r.career;
		const sim = r.sim;
		const who = r.index;
		const baseAngles = this.spec().careerAngles;
		const angles = this.count > 2
			? Math.max(8, Math.floor(baseAngles * Math.sqrt(2 / this.count))) : baseAngles;
		if (career.at < 0 || career.arrested) return null;
		this.careerScanReset(runStep);
		this.careerBurnTopReset();
		let plan = this.careerPlan(career, sim, market, runStep, false, angles);
		if (!plan) plan = this.careerPlan(career, sim, market, runStep, true, angles);
		else if (this.careerShouldWait(plan, 0) ||
			(career.padCount === 1 && career.contract < 0 && !plan.builds)) {
			/* Before settling for a shuttle on opening day, or a losing sit,
			 * give the longer fan one chance to find a paying land-and-claim. */
			const first = this.careerSparePlan;
			copyCareerPlan(plan, first);
			const wider = this.careerPlan(career, sim, market, runStep, true, angles);
			if (wider && wider.score > first.score) plan = wider;
			else copyCareerPlan(first, plan);
		}
		if (plan) return this.careerReadyShot(r, plan, market, runStep, true);
		if (career.contract >= 0) {
			const open = this.careerOpenFan(r, market, runStep, angles);
			if (open) return this.careerReadyShot(r, open, market, runStep, true);
			/* the board this job came from has no leg from here: dropping it is
			 * the only thing that stops the next search from re-winning the same
			 * unpayable route back. leave the fresh board for the cooldown. */
			if (career.contract >= 0) {
				this.careerDeferContract(career, runStep, 'no reachable leg from this pad');
				GravityGame.refreshBoard(career, trade, runStep);
			}
		}
		/* the own pad is only charging: a wait is cheaper than the commercial fee */
		if (this.careerRechargeSit(r, runStep)) return null;
		/* no shot from the standing rail (drained battery, weak pad): the
		 * commercial EMC-1 is always charged, so try once more on it */
		let fallbackFee = 0;
		let rescued = false;
		/* a seized planet keeps the rebel rail: swapping in a commercial EMC-1
		 * would invent a pad the planet does not have */
		if (career.commercialPlanet !== career.at &&
			!GravityGame.planetSeized(career, career.at) &&
			GravityGame.padOwner(career, career.at) !== GravityGame.OWNER_COMMERCIAL) {
			GravityGame.setCommercial(career, career.at);
			fallbackFee = GravityGame.launchFee(career, career.at, GravitySim.SPEED_MIN);
			if (GravityGame.padLift(career, career.at) + 1e-9 >= GravitySim.SPEED_MIN &&
				career.ledger.purse + 1e-9 >= fallbackFee) {
				plan = this.careerPlan(career, sim, market, runStep, false, angles);
				if (!plan) plan = this.careerPlan(career, sim, market, runStep, true, angles);
			}
			if (!plan && career.contract >= 0 && career.ledger.purse + 1e-9 >= fallbackFee) {
				plan = this.careerOpenFan(r, market, runStep, angles);
			}
			if (!plan) {
				plan = this.careerRescueBurn(r, market, runStep);
				rescued = plan !== null;
			}
			/* A routine ticket that loses cash is not a reason to leave a pad
			 * that can recharge, even after the ordinary sit budget ran out. */
			if (plan && !rescued && plan.cashNet < 0 && !plan.builds && !advancesCareerLeg(plan.leg)) {
				GravityGame.setCommercial(career, -1);
				if (this.careerRechargeSit(r, runStep, plan.fee)) return null;
				GravityGame.setCommercial(career, career.at);
			}
			/* a rescued launch must keep the rail whose fee it was priced on */
			if (!plan) GravityGame.setCommercial(career, -1);
			this.traceAdd(who, 'commercial', (plan ? 'found a shot' : 'still no shot') +
				' · fee ' + fallbackFee.toFixed(2) +
				' · purse ' + career.ledger.purse.toFixed(2), runStep);
			if (plan) return this.careerReadyShot(r, plan, market, runStep, !rescued);
		}
		if (!plan) {
			plan = this.careerRescueBurn(r, market, runStep);
			if (plan) return this.careerReadyShot(r, plan, market, runStep, false);
		}
		this.careerNoShot(r, trade, runStep);
		return null;
	};

	/* Accumulate the live leak-then-sun update over N game steps. Solar input
	 * leaks too; treating the whole wait as one charging step overquotes it. */
	function careerChargeAfter(pad, panel, light, steps, ignoreReserve) {
		const minutes = GravitySim.padMinutes(GravitySim.DT);
		const decay = pad.battery.leak * minutes;
		const sunSteps = decay ? Math.expm1(-decay * steps) / Math.expm1(-decay) : steps;
		const next = OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, minutes * steps) +
			OrbitTech.solarCharge(panel, light, GravitySim.padSeconds(GravitySim.DT) * sunSteps);
		return Math.max(0, Math.min(next, pad.battery.capacity) -
			(ignoreReserve ? 0 : pad.reservedKwh));
	}

	/* Sample at the times we would actually retry. A higher speed ceiling
	 * doesn't guarantee that the exit fan's new set of rungs hits a planet.
	 * `ignoreReserve` asks what the pad holds, not what is left after promises:
	 * only the panel-shop's sunk-cost question needs that reading. */
	GravityBot.prototype.careerRechargeExit = function (r, pad, panel, gap, tries, ignoreReserve) {
		const career = r.career;
		const at = career.at;
		const source = this.departureSourceSim || this.probe;
		/* For a *sit*, only a charge that beats the live rail is a gain: an
		 * already-full pad has nothing to wait for. The panel shop asks a
		 * different question (what would this pad fly if it were refitted),
		 * so it must not apply the live-rail floor. */
		const now = ignoreReserve ? 0 : careerCargoSpeed(career, r.sim.speedLimit(at));
		for (let i = 1; i <= tries; i++) {
			const free = careerChargeAfter(pad, panel, career.light[at], gap * i, ignoreReserve);
			const cap = careerCargoSpeed(career, OrbitTech.speedLimit(free,
				career.ship.mass, pad.catapult, source.forceScale));
			if (Math.min(GravitySim.SPEED_MAX, cap) <= now + 1e-9) continue;
			const speed = this.careerExitSpeed(at, cap);
			if (speed && GravityGame.launchFee(career, at, speed) <= career.ledger.purse + 1e-9) return true;
		}
		return false;
	};

	/* A rail whose *live* charge cannot leave the pad is the pad the panel
	 * shop exists for: sunlight and its next panel can still open it, and that
	 * is cheaper than the tow. Only a label and a plan-reason need this
	 * distinction; the sit budget itself is the ordinary one. */
	GravityBot.prototype.careerRailBlocked = function (r) {
		const career = r.career;
		const at = career.at;
		const pad = at < 0 ? null : GravityGame.padAt(career, at);
		if (!pad || pad.catapult === null) return false;
		if (GravityGame.padOwner(career, at) !== career.index) return false;
		this.prepareCareerExitProbe(r.sim);
		return this.careerExitSpeed(at, careerCargoSpeed(career, r.sim.speedLimit(at))) === 0;
	};

	/* Only invest when ordinary sunlight can't get us off this pad in time.
	 * Keep the launch reserve and don't buy a panel to solve a weak rail.
	 * Owned rails only: a guest cannot refit the host's pad. */
	GravityBot.prototype.careerRechargePanel = function (r, pad, gap, tries, runStep) {
		const career = r.career;
		const at = career.at;
		if (pad !== career.pads[at] || GravityGame.padOwner(career, at) !== career.index) return false;
		/* One decision per patience cycle: a sit that already chose a panel
		 * does not re-shop on every retry. */
		if (r.panelTried) return false;
		const panel = careerNextItem(career, OrbitTech.KIND_PANEL, OrbitTech.PANELS, pad.panel);
		if (!panel || !GravityGame.gearKnown(career, panel)) return false;
		const cost = careerPrice(career, panel);
		const fallback = GravityGame.canEvacuate(career) ? GravityGame.evacuationCost(career) : CAREER_PURSE_RESERVE;
		/* Too poor to try: the pad's own wait is what makes the panel
		 * affordable, so this refusal must not spend the cycle. */
		if (cost >= fallback || career.ledger.purse + 1e-9 < cost + CAREER_PURSE_RESERVE) return false;
		if (this.careerExitSpeed(at, careerCargoSpeed(career, r.sim.speedLimit(at)))) return false;
		/* Engaged from here: the cycle's one shop decision is spent whether a
		 * panel is bought or the forecast refuses it. The forecast must still
		 * see an exit — a panel is never bought on a promise sunlight cannot
		 * keep. A backlog of promised charge is no reason to refuse: the panel
		 * is exactly what makes that promise safe. */
		r.panelTried = true;
		if (!this.careerRechargeExit(r, pad, panel, gap, CAREER_RECHARGE_TRIES, true)) return false;
		return this.careerBuyGear(career, at, OrbitTech.KIND_PANEL, panel, CAREER_PURSE_RESERVE,
			runStep, 'recharge a blocked exit');
	};

	/* No payable plan. Prefer a short recharge on a real panel (ours or a
	 * host's) to a commercial ticket, but only if it can buy a better exit. */
	GravityBot.prototype.careerRechargeSit = function (r, runStep, losingFee = 0) {
		const career = r.career;
		const at = career.at;
		if (at < 0 || !GravityGame.careerShipUsable(career) || GravityGame.padOwner(career, at) < 0) return false;
		const pad = GravityGame.padAt(career, at);
		if (!losingFee && r.waitTries >= CAREER_SIT_TRIES) return false;
		const tries = losingFee ? CAREER_SIT_TRIES : CAREER_SIT_TRIES - r.waitTries;
		const gap = CAREER_SIT_GAP + (r.gapPhase || 0);
		/* Fully promised: the pad's whole charge belongs to a launch that has
		 * not flown, so waiting cannot free any of it and no shop decision
		 * should spend the promise. Zero charge with no promise is still worth
		 * a wait. */
		if (pad.reservedKwh > 0 && pad.chargeKwh <= pad.reservedKwh + 1e-9) return false;
		this.prepareCareerExitProbe(r.sim);
		/* A panel answers the same exit question with a better answer (and it
		 * is the cure for a rail whose own panel is too weak), so it is asked
		 * before the resident forecast fills the exit cache with a 0. */
		/* A commercial wait is a decision not to buy a ticket, not a decision
		 * about the pad: the fare path never shops for a panel, because the
		 * money it is protecting is exactly the money a panel would spend. */
		const panel = losingFee ? false : this.careerRechargePanel(r, pad, gap, tries, runStep);
		if (!panel && !this.careerRechargeExit(r, pad, pad.panel, gap, tries)) return false;
		r.waitTries = Math.min(CAREER_SIT_TRIES, r.waitTries + 1);
		this.careerBetweenFlights(career, r.sim, runStep);
		r.readyStep = runStep + gap;
		const why = losingFee ? 'wait instead of losing a ' + losingFee.toFixed(2) + ' commercial ticket'
			: this.careerRailBlocked(r) ? 'blocked rail' : 'drained pad';
		const count = r.waitTries + '/' + CAREER_SIT_TRIES;
		this.traceAdd(r.index, 'sit', why + ' · charge ' + pad.chargeKwh.toFixed(2) +
			' kWh · sit ' + count + ' · retry in ' +
			((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s', runStep);
		return true;
	};

	/* A blocked owned rail with patience left: the ordinary recharge wait
	 * (sunlight, or the next panel) is the way out, not the tow. Past the budget
	 * it is a dead end and the evacuation may run. */

	/* nothing flies from here: fly home out of a dead end after a couple of
	 * tries, drop a contract whose target no trajectory reaches, then shop again */
	GravityBot.prototype.careerNoShot = function (r, trade, runStep) {
		const career = r.career;
		const sim = r.sim;
		const why = this.careerNoPlanWhy(career, sim);
		let recovery = '';
		r.idleTries += 1;
		/* All fans failed, including the commercial fallback and any recharge
		 * wait. A physical exit into another unaffordable landing isn't a way
		 * out, even on the Capital where the origin rail itself is free. */
		if (r.idleTries >= CAREER_STUCK_TRIES && GravityGame.canEvacuate(career) &&
			GravityGame.evacuate(career, sim, GravityGame.evacuationCost(career), runStep)) {
			recovery = 'evacuation started';
		} else if (career.contract >= 0 && r.idleTries >= 3) {
			this.careerDeferContract(career, runStep, 'no payable flight');
			GravityGame.refreshBoard(career, trade, runStep);
			recovery = 'dropped the unreachable contract';
		}
		this.careerBetweenFlights(career, sim, runStep);
		if (career.evacuating) recovery = 'evacuation started';
		/* Dropping a job changes the search, not the ship's ability to leave.
		 * Resetting here lets repeated board churn postpone the tow forever. */
		if (career.evacuating) r.idleTries = 0;
		const gap = recovery ? 1 : CAREER_RIVAL_GAP + (r.gapPhase || 0);
		r.readyStep = runStep + gap;
		this.traceAdd(r.index, 'no shot', why + ' · idle ' + r.idleTries +
			(recovery ? ' · ' + recovery : '') + ' · ' +
			(gap === 1 ? 'retry next step' :
				'retry in ' + (gap * GravitySim.DT).toFixed(1) + ' s'), runStep);
	};

	/* a company that cannot afford an EMC build where it stands sits out a few
	 * turns: a pad that charges while it waits is worth more than a cheap hop */
	GravityBot.prototype.careerSit = function (r, plan, runStep) {
		if (!this.careerShouldWait(plan, r.waitTries)) {
			r.waitTries = 0;
			return false;
		}
		r.waitTries += 1;
		/* the commercial choice bought one attempt only: a sit must not leave the
		 * company paying its fee again after its own pad charged */
		GravityGame.setCommercial(r.career, -1);
		this.careerBetweenFlights(r.career, r.sim, runStep);
		r.readyStep = runStep + CAREER_SIT_GAP + (r.gapPhase || 0);
		this.traceAdd(r.index, 'sit', 'score ' + signed(plan.score) +
			' · no EMC build · sit ' + r.waitTries + '/' + CAREER_SIT_TRIES +
			' · retry in ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s', runStep);
		return true;
	};

	GravityBot.prototype.traceCareerPlan = function (who, plan, runStep) {
		this.traceAdd(who, 'plan', 'P' + plan.origin + '→P' + plan.body +
			' v' + plan.speed.toFixed(0) + ' score ' + signed(plan.score) +
			' pay ' + signed(plan.taskPay) +
			(plan.bribe > 0 ? ' (bribe ' + plan.bribe.toFixed(2) + ')' : '') +
			' pad after wear ' + signed(plan.padValue) +
			' fee ' + plan.fee.toFixed(2) + ' exit ' + (plan.exitCost || 0).toFixed(2) +
			' (' + (plan.exitSource || 'own') + ') · ' +
			(plan.fromBook ? 'book reuse' : 'fan ' + this.careerScan.tried + ' traces') +
			' · EMC build ' + (plan.builds ? 'affordable' : 'no') + burnNote(plan), runStep);
	};

	GravityBot.prototype.traceCareerQueue = function (career, origin, angle, speed, energy, fireAt, step) {
		this.traceAdd(careerTraceIndex(career), 'queue', 'P' + origin + ' angle ' + angle.toFixed(2) +
			' v' + speed.toFixed(0) + ' · ' + GravityGame.railOwnerText(career, origin) +
			' · ' + energy.toFixed(2) + ' kWh · barrel in ' + ((fireAt - step) * GravitySim.DT).toFixed(1) + ' s', step);
	};

	GravityBot.prototype.traceCareerFire = function (career, sim, step) {
		this.traceAdd(careerTraceIndex(career), 'fire', 'P' + sim.origin + ' · v' + sim.speed.toFixed(1) +
			' · purse ' + career.ledger.purse.toFixed(2), step, [sim.origin, sim.angle, sim.speed]);
	};

	GravityBot.prototype.traceCareerLanding = function (career, sim, step) {
		this.traceAdd(careerTraceIndex(career), 'land', (career.at < 0 ? 'lost in space' : 'P' + career.at) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount + ' pads',
			step, [career.at, sim.endReason, sim.liveSteps]);
	};

	GravityBot.prototype.careerLaunch = function (r, market, trade, fieldRate, runStep) {
		const career = r.career;
		const sim = r.sim;
		const who = r.index;
		let shot = null;
		if (r.turret) {
			/* a queued shot waits for the EMC barrel to turn to the aim on the same
		 * in-game clock the player's turret uses; guest or owner of the pad does
		 * not matter, the rail that fires spends its own charge */
			if (runStep < r.turret.fireAt) return false;
			if (GravityGame.padAt(career, r.turret.origin) !== r.turret.pad) {
				this.careerDropQueue(r);
				return false;
			}
			shot = r.turret;
			r.turret = null;
		} else {
			const plan = this.careerNextShot(r, market, trade, runStep);
			if (!plan) return false;
			this.traceCareerPlan(who, plan, runStep);
			r.idleTries = 0;
			if (this.careerSit(r, plan, runStep)) return false;
			const requested = plan.fuelProducedKg + plan.fuelBoughtKg > 0;
			if (requested && !this.careerCommitFuel(r, plan, runStep)) {
				r.readyStep = runStep + CAREER_RIVAL_GAP;
				return false;
			}
			if (!requested) this.careerPrepareFuel(r, plan, market, runStep);
			/* queue the shot: the first to queue claims the pad charge, then the
			 * barrel turns on the same in-game clock the player's turret uses */
			const period = GravityGame.turretPeriod(career.galaxy, plan.origin);
			const gun = GravityGame.turretAngle(career.galaxy, plan.origin, runStep * GravitySim.DT);
			let delta = plan.angle - gun;
			delta -= Math.floor(delta / TAU) * TAU;
			const wait = delta < 0.02 ? 0 : delta / TAU * period;
			const pad = GravityGame.padAt(career, plan.origin);
			const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, plan.speed);
			GravityGame.reserveEnergy(pad, energy);
			career.plannedLanding = plan.body;
			r.turret = {
				origin: plan.origin,
				angle: plan.angle,
				speed: plan.speed,
				body: plan.body,
				score: plan.score,
				fireAt: runStep + Math.ceil(wait / GravitySim.DT),
				pad: pad,
				energy: energy
			};
			this.traceCareerQueue(career, plan.origin, plan.angle, plan.speed, energy, r.turret.fireAt, runStep);
			return false;
		}
		/* fire the queued shot */
		const origin = shot.origin;
		const angle = shot.angle;
		const speed = shot.speed;
		sim.fieldT = trade.t;
		if (fieldRate !== undefined) sim.fieldRate = fieldRate;
		sim.stepLimit = GravityGame.CAP_STEPS;
		sim.limitReason = END_TIME;
		r.shots.push(GravityGame.createShot(GravityGame.SRC_PLANETS, origin,
			GravityGame.angleUnits(angle), GravityGame.speedUnits(speed), GravityGame.NO_ABORT));
		sim.launch(origin, angle, speed);
		GravityGame.careerBeginFlight(career, sim);
		r.basePlanet = origin;
		this.traceCareerFire(career, sim, runStep);
		return true;
	};

	GravityBot.prototype.careerLand = function (r, trade, runStep) {
		const career = r.career;
		GravityGame.careerEndFlight(career, r.sim, trade, runStep);
		r.basePlanet = career.at;
		r.readyStep = runStep + CAREER_RIVAL_GAP + r.gapPhase;
		r.idleTries = 0;
		r.waitTries = 0;
		r.panelTried = false;
		this.traceCareerLanding(career, r.sim, runStep);
		this.careerBetweenFlights(career, r.sim, runStep);
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
	GravityBot.CAREER_PURSE_RESERVE = CAREER_PURSE_RESERVE;
	GravityBot.CAREER_REPAIR_AT = CAREER_REPAIR_AT;
	GravityBot.CAREER_ENERGY_WAIT_COST = CAREER_ENERGY_WAIT_COST;
	GravityBot.CAREER_BOOK_ENOUGH = CAREER_BOOK_ENOUGH;
	GravityBot.CAREER_MIN_SCORE = CAREER_MIN_SCORE;
	GravityBot.CAREER_BURN_AT = CAREER_BURN_AT;
	GravityBot.CAREER_RESCUE_SHOTS = CAREER_RESCUE_SHOTS;
	GravityBot.CAREER_BURN_PLAN_TRACES = CAREER_BURN_PLAN_TRACES;
	GravityBot.CAREER_PAD_HORIZON = CAREER_PAD_HORIZON;
	GravityBot.CAREER_SIT_GAP = CAREER_SIT_GAP;
	GravityBot.CAREER_SIT_TRIES = CAREER_SIT_TRIES;
	GravityBot.TRACE_MAX = TRACE_MAX;

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityBot;
	else root.GravityBot = GravityBot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
