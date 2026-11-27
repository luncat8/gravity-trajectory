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
 * Career uses the separate synchronous controller in the bot_career_*.js parts:
 * it plans from the occupied catapult, values tasks and landing pads net of
 * energy recharge waits, and performs reserve-aware shopping between real
 * headless flights.
 *
 * This core holds the tuning constants more than one part reads, the rival
 * record, the constructor (the field inventory) and PARTS, the load order and
 * table of contents. Parts add GravityBot.prototype methods (shared through
 * `this`); constants and free helpers cross files on each part's
 * `const { … } = inner;` line. experiments/parts_test.js checks the wiring.
 */
(function (root) {
	'use strict';

	/* load order; index.html lists the same files right after this one */
	const PARTS = [
		'bot_setup.js',         // world/sim binding, scales, masks, reset, levels, roster
		'bot_trace.js',         // decision log, status lines, refusal reasons, career trace
		'bot_route.js',         // the route prefix planner
		'bot_rivals.js',        // tour/money candidate job, lookahead, stepping, summaries
		'bot_career_assets.js', // career: exit probe, reach, research, site values
		'bot_career_shop.js',   // career: contracts, upgrades, repair, recovery, bribes
		'bot_career_score.js',  // career: shot score facts, radar, flight scoring
		'bot_career_plan.js',   // career: target, book lookup, fan and refine, careerPlan
		'bot_career_burn.js',   // career: every impulse burn, fuel, rescue
		'bot_career_loop.js',   // career: start, roster, stepCareer, player seat
		'bot_career_shot.js',   // career: race entry, next shot, recharge, sit, launch, land
	];

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
	const STATUS_FLYING = GravitySim.STATUS_FLYING;
	const END_IMPACT = GravitySim.END_IMPACT;
	const END_EXIT = GravitySim.END_EXIT;
	const END_TIME = GravitySim.END_TIME;
	const MONEY = GravityGame.MONEY;
	const END_OPEN = GravitySim.END_OPEN;
	const TAU = Math.PI * 2;
	const CAREER_EXIT_CACHE_WAYS = 32;
	const CAREER_REFINE_SEEDS = 3;
	const CAREER_ENERGY_WAIT_COST = 0.04;
	/* an own pad lands full: its panel charges while the ship flies. A few
	 * seconds of flight cannot refill a shot that is bigger than the battery
	 * holds, so the exit an own pad promises must be the one it will have when
	 * the ship arrives. Over a long flight the panel is given its sunlight;
	 * a long flight is also long pad time, so the charge can reach the cap. */
	const CAREER_PAD_SUN_SECONDS = 30;
	/* breadth of one launch counts toward a pad's worth: sunlight alone would
	 * put EMCs in wells the starter rail cannot leave, and those never earn */
	const CAREER_REACH_VALUE = 0.4;
	/* a medical mission is worth chasing (0.5.13: it outranks a plain
	 * delivery): the reward is per patient, the medic leg lands on a planet
	 * paying the 4x fly-by ramp, and the quelled planet turns that ramp back
	 * into normal trade — the rebellion is a contest the rivals should play,
	 * not a tax they pay */
	const CAREER_MEDIC_VALUE = 2.5;
	/* a rival takes the rulers' money on a planet that is already rotten, or
	 * when another company is about to fly out of it: corruption is not a gift
	 * the bot hands to clean worlds for pocket change */
	const CAREER_BRIBE_ROT = 25;
	/* a bribe worth this much is taken on any planet: the rulers of a rich
	 * world pay to be left alone, and only the arrest roll prices the risk */
	const CAREER_BRIBE_PAY = 2;
	/* a career rival launches again after this much world time, and keeps this
	 * much purse back for the commercial EMC's fee when shopping; the phase
	 * staggers the companies so they never all plan on the same world step */
	const CAREER_RIVAL_GAP = Math.round(8 / GravitySim.DT);
	/* one way off any planet, priced honestly: the cheapest commercial shot
	 * (a dry starter ship at the minimum speed on the starter rail) */
	const CAREER_PURSE_RESERVE = GravityGame.commercialMinFee();

	function careerRefundEscrow(career) {
		return GravityGame.careerRefundEscrow(career);
	}
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
	/* Launch pricing re-flies the fan's best few shots with the same one-burn
	 * policy the flight uses, so a fitted drive changes which shot is queued,
	 * not just how the queued shot lands. */
	const CAREER_BURN_PRICE_TOP = 3;
	const CAREER_BURN_PRICE_MARGIN = 0.5;
	/* A dead-end rescue is rarer than shortlist pricing, so it may spend a
	 * small ring of launch aims on the same one-burn search. Two speed rungs,
	 * 16 ring bearings and two contract bearings bound it to 36 launches. */
	const CAREER_RESCUE_ANGLES = 16;
	const CAREER_RESCUE_SHOTS = (CAREER_RESCUE_ANGLES + 2) * 2;
	/* coast + coarse ring + refinement, with the contract bearings present */
	const CAREER_BURN_PLAN_TRACES = 1 + CAREER_BURN_FRACTIONS.length *
		(CAREER_BURN_ANGLES + 2 + 2 * CAREER_BURN_REFINE + 1);
	/* below this a plan is a donation unless it lands where an EMC can be built */
	const CAREER_MIN_SCORE = 0;
	const CAREER_SIT_TRIES = 4;
	const PRED_LOG_MAX = GravitySim.PRED_LOG_MAX;

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
		/* the human company's bought ships (0.7.45): an alias of the live
		 * career's fleet records, refreshed by attachFleet */
		this.fleet = [];
		this.fleetOwner = null;
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
			cash: 0, credit: 0, leg: GravityGame.LEG_NONE, bribe: 0,
			legPlan: -Infinity, leg2Feasible: true
		};
		this.careerLeg = GravityGame.createLegPlan();
		this.careerLegInput = {
			origin: -1, body: -1, speed: 0, flownLen: 0, length: 0, steps: 0,
			visitPay: 0, bribe: 0, condition: undefined, burnDv: 0, fee: 0,
			logPlanet: null, logStep: null, logDwell: null, logCount: 0
		};
		this.careerExitFn = (planet, cap) => this.careerExitSpeed(planet, cap);
		this.careerLegOpts = { slot: -1, seekClaim: false, exitSpeedFn: this.careerExitFn };
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
		/* radar (0.7.49): the planets another ship's predicted trajectory lands
		 * on, with the earliest rival landing time on each, refreshed once per
		 * scanned company and step */
		this.radarHot = new Uint8Array(PLANETS);
		this.radarHotTime = new Float64Array(PLANETS);
		this.radarHotStep = -1;
		this.radarHotCareer = null;
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

	function careerAimList(size) {
		return {
			count: 0, score: new Float64Array(size), angleU: new Int32Array(size),
			speedU: new Int32Array(size), book: new Uint8Array(size)
		};
	}
	GravityBot.MAX_RIVALS = MAX_RIVALS;
	GravityBot.PLAYER_INDEX = PLAYER_INDEX;
	GravityBot.CAREER_RIVAL_GAP = CAREER_RIVAL_GAP;
	GravityBot.CAREER_PURSE_RESERVE = CAREER_PURSE_RESERVE;
	GravityBot.CAREER_ENERGY_WAIT_COST = CAREER_ENERGY_WAIT_COST;
	GravityBot.CAREER_MIN_SCORE = CAREER_MIN_SCORE;
	GravityBot.CAREER_BURN_AT = CAREER_BURN_AT;
	GravityBot.CAREER_RESCUE_SHOTS = CAREER_RESCUE_SHOTS;
	GravityBot.CAREER_BURN_PLAN_TRACES = CAREER_BURN_PLAN_TRACES;
	GravityBot.CAREER_SIT_TRIES = CAREER_SIT_TRIES;

	const inner = {
		GravitySim, GravityGame, OrbitWorld, OrbitTech, OrbitEcon, PLANETS, MAX_RIVALS, PLAYER_INDEX,
		TOP_K, MAX_BOT_SHOTS, STATUS_FLYING, END_IMPACT, END_EXIT, END_TIME, MONEY, END_OPEN, TAU,
		CAREER_EXIT_CACHE_WAYS, CAREER_REFINE_SEEDS, CAREER_ENERGY_WAIT_COST, CAREER_REACH_VALUE,
		CAREER_MEDIC_VALUE, CAREER_BRIBE_ROT, CAREER_BRIBE_PAY, CAREER_RIVAL_GAP,
		CAREER_PURSE_RESERVE, careerRefundEscrow, CAREER_BURN_ANGLES, CAREER_BURN_FRACTIONS,
		CAREER_BURN_REFINE, CAREER_BURN_AT, CAREER_BURN_PRICE_TOP, CAREER_BURN_PRICE_MARGIN,
		CAREER_RESCUE_ANGLES, CAREER_MIN_SCORE, CAREER_SIT_TRIES, PRED_LOG_MAX, createRival
	};

	let attached = 0;
	function part(file, attach) {
		if (file !== PARTS[attached]) throw new Error('gravity_bot.js: expected ' + PARTS[attached] + ', got ' + file);
		attach(GravityBot, inner);
		attached += 1;
		if (attached < PARTS.length) return;
		delete GravityBot.part;
	}

	if (typeof module !== 'undefined' && module.exports) {
		for (const file of PARTS) part(file, require('./' + file));
		module.exports = GravityBot;
	} else {
		Object.defineProperty(GravityBot, 'part', { value: part, configurable: true });
		root.GravityBot = GravityBot;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
