/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, the shared per-planet growing
 * visit-profit market, and the career rule (catapult network, pad energy,
 * contract board, evacuation, cheats).
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js')
		: root.OrbitEcon;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;
	const OrbitScience = typeof module !== 'undefined' && module.exports
		? require('./orbit_science.js')
		: root.OrbitScience;
	const PlanetGravity = typeof module !== 'undefined' && module.exports
		? require('./planet_gravity.js')
		: root.PlanetGravity;

	const FORMAT = 1;
	const ANGLE_STEPS = 1048576;
	const ANGLE_UNIT = Math.PI * 2 / ANGLE_STEPS;
	const SPEED_STEPS = 1024;
	const SPEED_UNITS_MIN = GravitySim.SPEED_MIN * SPEED_STEPS;
	const SPEED_UNITS_MAX = GravitySim.SPEED_MAX * SPEED_STEPS;
	const CAP_SECONDS = 120;
	const CAP_STEPS = Math.round(CAP_SECONDS / GravitySim.DT);
	const ROUTE_SECONDS = 1800;
	const ROUTE_STEPS = Math.round(ROUTE_SECONDS / GravitySim.DT);
	const MONEY_SHOTS = 10;
/* stats sampling (0.6.10 plan §3): one sample every STATS_SEC game seconds,
 * kept in fixed 256-sample blocks that thin themselves (keep every second
 * sample, double the interval) when they fill, so a whole career stays on
 * the plot without growing without bound */
const STATS_SAMPLES = 256;
const STATS_SEC = 2;
const STATS_EVERY = Math.round(STATS_SEC / GravitySim.DT);
	const RULE_TOUR = 'tour';
	const RULE_ROUTE = 'route';
	const RULE_MONEY = 'money';
	const RULE_CAREER = 'career';
	/*
	 * One table for everything a rule changes: flight cap, preview horizon
	 * (null = the lab slider; a number is traced to its end as a job sliced
	 * over frames), shot ceiling (0 = unlimited), whether the run stops when
	 * all 26 systems are visited, whether rivals may join, and whether the
	 * players can hold the game clock (the pause button and the landing pause).
	 */
	const RULES = {
		tour: { name: RULE_TOUR, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: true, planner: false, solo: false, pause: false },
		route: { name: RULE_ROUTE, capSteps: ROUTE_STEPS, horizon: ROUTE_SECONDS, maxShots: 1, stopOnTour: false, planner: true, solo: false, pause: false },
		money: { name: RULE_MONEY, capSteps: CAP_STEPS, horizon: null, maxShots: MONEY_SHOTS, stopOnTour: false, planner: false, solo: false, pause: false },
		career: { name: RULE_CAREER, capSteps: CAP_STEPS, horizon: CAP_SECONDS, maxShots: 0, stopOnTour: false, planner: false, solo: false, humanOnly: true, pause: true }
	};
	const CHEAT_COMMUNISM = 'communism';
	const CHEAT_ENDGAME = 'endgame';
	const CHEATS = { communism: CHEAT_COMMUNISM, endgame: CHEAT_ENDGAME };
	const BOT_OFF = 'off';
	const BOT_EASY = 'easy';
	const BOT_NORMAL = 'normal';
	const BOT_HARD = 'hard';
	const BOTS = {
		off: BOT_OFF,
		easy: BOT_EASY,
		normal: BOT_NORMAL,
		hard: BOT_HARD
	};
	const PLAYER_USER = 'user';
	const PLAYER_BOT = 'bot';
	const PLAYER_TYPES = {
		user: PLAYER_USER,
		bot: PLAYER_BOT
	};
	const RATE_MIN = 0.5;
	const RATE_MAX = 12;
	/*
	 * Per-planet growing visit profit: each launch costs 1.00 from a tight
	 * starting purse of 3.00; every planet starts with 40 s of accrued age
	 * (≈ +0.24) and grows toward the 4.00 cap along a saturation curve whose
	 * slope starts at +0.00625 per flight-second (+0.25 per 40 s) and eases
	 * off as the value nears the cap, reaching it only at infinite age.
	 * Entering a planet's port orbit collects its value and resets it to 0.00.
	 */
	const MONEY = {
		cost: 1,
		k: 0.00625,
		initSec: 40,
		cap: 4,
		purse0: 3
	};
	const PURSE_PRESETS = { tight: 2, standard: 3, relaxed: 6 };
	/*
	 * Visit-profit collection modes. `HARVEST_ENTRY` is the rule: the first
	 * encounter with a system pays everything it has accrued since the last one
	 * and stamps its clock, so a long flight that crosses the same system again
	 * later collects what regrew in between. The experimental `HARVEST_TICK`
	 * also pays, on every step the ship stays inside, what re-accrued during
	 * that step — a slow or looping pass earns more than a fly-by. Career only;
	 * `estimateProfit` prices whichever mode is active, from the trace's
	 * dwell trail (0.7.39-plan-harvest-ticks.md).
	 */
	const HARVEST_ENTRY = 0;
	const HARVEST_TICK = 1;
	let harvestMode = HARVEST_ENTRY;
	/* experimental settings panel bounds; links carry non-default multipliers */
	const EXPERIMENT = {
		gravityMin: 0, gravityMax: 9,
		forceMin: 0.25, forceMax: 3,
		spaceWearMin: 0, spaceWearMax: 3
	};
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	/* the seeded field lives in its own file (the map-generator helper reads the
	 * same draw); these names stay the game's public ones */
	const PLANET_GRAVITY_MIN = PlanetGravity.MIN;
	const PLANET_GRAVITY_MAX = PlanetGravity.MAX;
	const PLANET_GRAVITY_STEPS = PlanetGravity.STEPS;
	const planetGravity = PlanetGravity.gravity;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const BURN_FORM = /^b([0-9a-z]{1,4})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;
		const estScratch = new Float64Array(OrbitWorld.PLANETS);
	/* launch book: saved career trajectories and the visit log each one keeps */
	const BOOK_MAX = 10;
	const BOOK_LOG_MAX = GravitySim.PRED_LOG_MAX;

	function angleUnits(angle) {
		return (Math.round(angle / ANGLE_UNIT) % ANGLE_STEPS + ANGLE_STEPS) % ANGLE_STEPS;
	}

	function angleOf(units) {
		return units * ANGLE_UNIT;
	}

	function speedUnits(speed) {
		return Math.round(speed * SPEED_STEPS);
	}

	function speedOf(units) {
		return units / SPEED_STEPS;
	}

	function createBurn(step, angle, dv) {
		return { step: step, angle: angle, dv: dv };
	}

	function encodeBurn(burn) {
		return 'b' + burn.step.toString(36) + '.' + burn.angle.toString(36) + '.' + burn.dv.toString(36);
	}

	function createShot(src, origin, angle, speed, abort, burns) {
		return {
			src: src, origin: origin, angle: angle, speed: speed, abort: abort,
			burns: burns ? burns.slice() : []
		};
	}

	function encodeShot(shot) {
		const head = SRC_CODES[shot.src] + shot.origin + '.' +
			shot.angle.toString(36) + '.' + shot.speed.toString(36);
		const base = shot.abort === NO_ABORT ? head : head + '.' + shot.abort.toString(36);
		if (!shot.burns || shot.burns.length === 0) return base;
		let out = base;
		for (let i = 0; i < shot.burns.length; i++) out += '-' + encodeBurn(shot.burns[i]);
		return out;
	}

	/* two-decimal multiplier, omitted at the default 1 */
	function scalePart(name, value) {
		if (value === undefined || value === 1) return '';
		return '&' + name + '=' + (Math.round(value * 100) / 100);
	}

	/* `game` = { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, shots, visited, steps, length }; default rule/bot/player/scales stay
	 * omitted; `length` verifies a route plan. A career link starts the same
	 * career (seed, rate, cheat, scales) — its builds and contracts are not
	 * replayed, so it never carries shots. */
	function encodeLink(game) {
		const rulePart = game.rule && game.rule !== RULE_TOUR ? '&rule=' + game.rule : '';
		const botPart = game.bot && game.bot !== BOT_OFF ? '&bot=' + game.bot : '';
		const playerPart = game.player === PLAYER_BOT ? '&you=' + PLAYER_BOT : '';
		const cheatPart = game.rule === RULE_CAREER && game.cheat ? '&cheat=' + game.cheat : '';
		const head = 'game=' + FORMAT + '&seed=' + game.seed + '&rate=' + game.rate +
			rulePart + botPart + playerPart + cheatPart +
			scalePart('gs', game.gravityScale) + scalePart('fs', game.forceScale) +
			(game.rule === RULE_CAREER ? scalePart('ws', game.spaceWearScale) : '') +
			(game.harvestTick ? '&ht=1' : '');
		if (game.shots.length === 0 || game.rule === RULE_CAREER) return head;
		const lengthPart = game.rule === RULE_ROUTE && Number.isFinite(game.length)
			? '&len=' + Math.round(game.length) : '';
		return head + '&shots=' + game.shots.map(encodeShot).join('_') +
			'&end=' + game.visited + '.' + game.steps + lengthPart;
	}

	function decodeShot(text, capSteps) {
		const parts = String(text).split('-');
		const match = SHOT_FORM.exec(parts[0]);
		if (!match) return null;
		const origin = Number(match[2]);
		const angle = parseInt(match[3], 36);
		const speed = parseInt(match[4], 36);
		const abort = match[5] === undefined ? NO_ABORT : parseInt(match[5], 36);
		const limit = capSteps || ROUTE_STEPS;
		if (origin >= OrbitWorld.PLANETS || angle >= ANGLE_STEPS) return null;
		if (speed < SPEED_UNITS_MIN || speed > SPEED_UNITS_MAX) return null;
		if (abort >= limit) return null;
		const maxBurnStep = abort === NO_ABORT ? limit : abort;
		const burns = [];
		let prevStep = 0;
		for (let i = 1; i < parts.length; i++) {
			const bm = BURN_FORM.exec(parts[i]);
			if (!bm) return null;
			const bStep = parseInt(bm[1], 36);
			const bAngle = parseInt(bm[2], 36);
			const bDv = parseInt(bm[3], 36);
			if (bStep < prevStep || bStep >= maxBurnStep) return null;
			if (bAngle >= ANGLE_STEPS || bDv < 1 || bDv > SPEED_UNITS_MAX) return null;
			prevStep = bStep;
			burns.push(createBurn(bStep, bAngle, bDv));
		}
		return createShot(SRC_CODES.indexOf(match[1]), origin, angle, speed, abort, burns);
	}

	/* absent = 1, otherwise a plain up-to-two-decimal number inside [min, max] */
	function decodeScale(text, min, max) {
		if (text === null) return 1;
		if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
		const value = Number(text);
		if (!Number.isFinite(value) || value < min || value > max) return null;
		return value;
	}

	/* Returns { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, shots, end, length } or null. */
	function decodeLink(text) {
		const params = new URLSearchParams(String(text).replace(/^#/, ''));
		if (params.get('game') !== String(FORMAT)) return null;
		const seed = Number(params.get('seed'));
		const rate = Number(params.get('rate'));
		if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) return null;
		if (!Number.isInteger(rate * 2) || rate < RATE_MIN || rate > RATE_MAX) return null;
		const ruleText = params.get('rule');
		const rule = ruleText === null ? RULES.tour : RULES[ruleText];
		if (!rule) return null;
		const botText = params.get('bot');
		const bot = botText === null ? BOT_OFF : BOTS[botText];
		if (!bot) return null;
		const playerText = params.get('you');
		const player = playerText === null ? PLAYER_USER : PLAYER_TYPES[playerText];
		if (!player) return null;
		const cheatText = params.get('cheat');
		const cheat = cheatText === null ? null : CHEATS[cheatText];
		if (cheat === undefined || (cheat !== null && rule.name !== RULE_CAREER)) return null;
		const gravityScale = decodeScale(params.get('gs'), EXPERIMENT.gravityMin, EXPERIMENT.gravityMax);
		const forceScale = decodeScale(params.get('fs'), EXPERIMENT.forceMin, EXPERIMENT.forceMax);
		const spaceWearScale = decodeScale(params.get('ws'), EXPERIMENT.spaceWearMin, EXPERIMENT.spaceWearMax);
		if (gravityScale === null || forceScale === null || spaceWearScale === null) return null;
		const harvestText = params.get('ht');
		if (harvestText !== null && harvestText !== '1' && harvestText !== '0') return null;
		const harvestTick = harvestText === '1';
		const list = params.get('shots');
		const parts = list ? list.split('_') : [];
		if (rule.planner && parts.length > 1) return null;
		if (rule.name === RULE_CAREER && parts.length > 0) return null;
		const shots = [];
		for (const part of parts) {
			const shot = decodeShot(part, rule.capSteps);
			if (!shot || (rule.planner && (shot.abort !== NO_ABORT || shot.burns.length > 0))) {
				return null;
			}
			shots.push(shot);
		}
		const lengthText = params.get('len');
		const length = lengthText === null ? null : Number(lengthText);
		if (lengthText !== null &&
			(!Number.isInteger(length) || length < 0 || length > 10000000)) return null;
		const endMatch = END_FORM.exec(params.get('end') || '');
		const end = endMatch ? { visited: Number(endMatch[1]), steps: Number(endMatch[2]) } : null;
		return { seed: seed, rate: rate, rule: rule.name, bot: bot, player: player, cheat: cheat,
			gravityScale: gravityScale, forceScale: forceScale, spaceWearScale: spaceWearScale, harvestTick: harvestTick,
			shots: shots, end: end, length: length };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	/* the `bribeVisitStep` marker of a visit that has not carried a bribe: far
	 * below any step a run holds, so it can never equal a visit stamp by
	 * accident and open the window shut, or shut one still open */
	const BRIBE_OPEN = -0x7fffffff;
	/* the observation device (0.6.1): above this rot the rulers let the ship's
	 * device be taken off on their planet, which silences it for every company */
	const QUIET_MIN = 75;
	/* fragile load (0.6.3): the launch acceleration m/s² the load survives.
	 * accel = speed² / (2 · RAIL_M), so the limit prices force, not the rail
	 * tier: EMC-1 at full force stays under it on a loaded ship, a stronger
	 * rail must be fired gently. FRAGILE_SPEED is the same limit in px/s. */
	const FRAGILE_ACCEL = 2.0;
	const FRAGILE_SPEED = Math.sqrt(2 * FRAGILE_ACCEL * OrbitTech.RAIL_M);
	/* ship wear (0.7.2): condition 1 = new, 0 = worn out. Space wear is priced
	 * per game second of flight, never per orbit minute or playback pace. */
	const WEAR_SPACE = 0.01;
	const WEAR_LANDING = 0.1;
	/* EMC wear at WEAR_EMC_REF m/s² of rail acceleration, capped per launch */
	const WEAR_EMC = 0.1;
	const WEAR_EMC_REF = 2.0;
	const WEAR_EMC_MAX = 0.5;
	/* impulse wear per WEAR_IMP_DV px/s of delivered Δv */
	const WEAR_IMP = 0.1;
	const WEAR_IMP_DV = 200;
	/* a bought (non-flagship) ship wears this much faster */
	const WEAR_FLEET = 2;
	const WEAR_SCIENCE_MIN = 0.5;
	const WEAR_SCIENCE_STEP = 0.02;
	/* cr for a full 1.0 of condition */
	const WEAR_REPAIR_COST = 2;
	/* Repeated fixed-step subtraction must exhaust at the mathematical boundary. */
	const WEAR_EPS = 1e-10;
	let spaceWearScale = 1;
	const WORN_OUT_BLOCK = 'ship worn out — repair before launch';
	/* offered only from planets this light and for loads this heavy at most
	 * (a gentle shot must be able to leave); pays FRAGILE_PAY × an ordinary
	 * delivery of the same tons and distance, still under CAREER.deliveryMax */
	const FRAGILE_G = 0.75;
	const FRAGILE_TONS = 8;
	const FRAGILE_PAY = 1.4;
	const FRAGILE_CHANCE = 0.25;
	/* deep-origin delivery (0.6.2): a heavy load out of a deep well is the
	 * job an EMC-3 is built for — an EMC-2 + BAT-2 lifts a HOLD-24
	 * (10 t + 24 t + 4 t hold = 38 t) off 43 % of g 2.0 planets and 13 % at
	 * g 2.5, an EMC-3 + BAT-3 off 100 % and 87 %. Offered with the note and
	 * paid DEEP_BONUS more than an ordinary delivery of the same tons. */
	const DEEP_G = 2.2;
	const DEEP_TONS = 16;
	const DEEP_BONUS = 0.6;

	/*
	 * Shared per-planet state for a game run; player and rivals harvest from
	 * the same table. The political half (0.5.12) is the same kind of shared
	 * ground: rot, the visit that carried a bribe, the rebellion clock and the
	 * seized rail of each planet. `galaxy` is bound by bindRun and is what
	 * makes the political clock run at all; `politicsSeed`/`politicsSerial`
	 * are the deterministic stream every roll reads.
	 */
	function createMarket() {
		const market = {
			lastVisitStep: new Float64Array(OrbitWorld.PLANETS),
			/* the rot clock, separate from the value clock: it is stamped by a
			 * *report*, never by a bribe, and a bribe restores it (0.7.16) */
			reportStep: new Float64Array(OrbitWorld.PLANETS),
			/* the report step standing before the current landing, kept so a
			 * bribe can take the landing's report back */
			reportPrev: new Float64Array(OrbitWorld.PLANETS),
			corruptionFloor: new Float64Array(OrbitWorld.PLANETS),
			permanentCorruption: false,
			visitPay: new Float64Array(OrbitWorld.PLANETS),
			quiet: new Uint8Array(OrbitWorld.PLANETS),
			corruption: new Float64Array(OrbitWorld.PLANETS),
			bribeVisitStep: new Int32Array(OrbitWorld.PLANETS),
			rebel: new Uint8Array(OrbitWorld.PLANETS),
			seized: new Uint8Array(OrbitWorld.PLANETS),
			rebelSinceStep: new Int32Array(OrbitWorld.PLANETS),
			patients: new Uint8Array(OrbitWorld.PLANETS),
			rebelCooldownStep: new Int32Array(OrbitWorld.PLANETS),
			lastCheckEpoch: new Int32Array(OrbitWorld.PLANETS),
			rebelPads: new Array(OrbitWorld.PLANETS),
			stamp: 0,
			k: MONEY.k,
			arfPlanet: -1,
			capitalPlanet: -1,
			politicsSeed: 1,
			politicsSerial: 0,
			politicsStep: -1,
			politicsSec: 0,
			galaxy: null
		};
		resetMarket(market);
		return market;
	}

	function resetMarket(market) {
		market.lastVisitStep.fill(-initSteps());
		market.reportStep.fill(-initSteps());
		market.reportPrev.fill(-initSteps());
		market.corruptionFloor.fill(OrbitEcon.CORRUPTION_TRADITION);
		market.permanentCorruption = false;
		market.visitPay.fill(0);
		market.quiet.fill(0);
		market.stamp += 1;
		market.k = MONEY.k;
		market.arfPlanet = -1;
		market.capitalPlanet = -1;
		market.corruption.fill(OrbitEcon.CORRUPTION_TRADITION);
		market.bribeVisitStep.fill(BRIBE_OPEN);
		market.rebel.fill(0);
		market.seized.fill(0);
		market.rebelSinceStep.fill(0);
		market.patients.fill(0);
		market.rebelCooldownStep.fill(0);
		market.lastCheckEpoch.fill(-1);
		market.rebelPads.fill(null);
		market.politicsSeed = 1;
		market.politicsSerial = 0;
		market.politicsStep = -1;
		market.politicsSec = 0;
		market.galaxy = null;
	}

	/*
	 * One run, one political world: the market owns the shared arrays and the
	 * galaxy names the careers they act on. Called by the page and by benches;
	 * without it every political rule is inert, which keeps the historical
	 * career numbers of `career_bench` untouched.
	 */
	function bindRun(market, galaxy, world) {
		market.galaxy = galaxy || null;
		market.politicsSeed = world ? world.seed >>> 0 : 1;
		if (!galaxy) return market;
		galaxy.market = market;
		for (let i = 0; i < galaxy.actors.length; i++) galaxy.actors[i].market = market;
		return market;
	}

	/* wire the seeded world's specials into the shared market (career runs only);
	 * with the A/B switch off the indices stay -1 and every planet pays normally */
	function applyMarketSpecials(market, world) {
		if (specialPlanets && world) {
			market.arfPlanet = world.arfPlanet;
			market.capitalPlanet = world.capitalPlanet;
			market.corruption[market.arfPlanet] = 0;
			market.corruption[market.capitalPlanet] = 0;
		} else {
			market.arfPlanet = -1;
			market.capitalPlanet = -1;
		}
		if (world) market.politicsSeed = world.seed >>> 0;
	}

	/* cap·(1 − e^(−k·age/cap)): initial slope k, asymptote cap at infinite age */
	function planetProfitAtStep(lastStep, runStep, k) {
		const age = (runStep - lastStep) * GravitySim.DT;
		if (age <= 0) return 0;
		return -MONEY.cap * Math.expm1(-age * (k === undefined ? MONEY.k : k) / MONEY.cap);
	}

	/* the political clock of a step, in game seconds. Every
	 * `OrbitEcon.*_SECONDS` rate is priced in these, `ARREST_SECONDS` included,
	 * so one clock and no rate: the background animation cannot move rot. */
	function politicsSeconds(market, step) {
		return GravitySim.gameSeconds(step);
	}

	/* the rail the rebels run on `planet`, or null; a seized rail outlives the
	 * rebellion as a commercial one */
	function rebelRail(career, planet) {
		const market = career.market;
		return market && market.seized[planet] ? (market.rebelPads[planet] || COMMERCIAL_PAD) : null;
	}

	/*
	 * The one special-aware visit value every harvest and estimate reads:
	 * A.R.F. pays 0, the Capital charges a flat −3 on each entry, every other
	 * planet grows toward the cap. A rebellious planet multiplies its growing
	 * value by the fly-by ramp. Every planet still stamps lastVisitStep, so
	 * the market clock advances exactly as a normal visit would.
	 */
	function planetProfitAt(market, planet, at, lastStep) {
		if (planet === market.capitalPlanet) return CAPITAL_VISIT_PAY;
		if (planet === market.arfPlanet) return 0;
		const pay = planetProfitAtStep(lastStep, at, market.k);
		if (!market.rebel[planet]) return pay;
		const age = politicsSeconds(market, at) -
			politicsSeconds(market, market.rebelSinceStep[planet]);
		return pay * OrbitEcon.flybyMultiplier(age);
	}

	/* the planet's value: what the next visitor collects. The rot reads
	 * `reportStep` instead — a bribe moves this clock and not that one. */
	function planetProfit(market, planet, runStep) {
		return planetProfitAt(market, planet, runStep, market.lastVisitStep[planet]);
	}

	/* a reported visit stamps the rot clock; the previous report is kept one
	 * landing deep, so the bribe that buys this report back can restore it */
	function stampReport(market, planet, runStep) {
		market.reportPrev[planet] = market.reportStep[planet];
		market.reportStep[planet] = runStep;
	}

	/* `fee` is what the current flight's launch cost, so `last` nets it out */
	function createLedger(purse0) {
		return {
			purse: purse0 === undefined ? MONEY.purse0 : purse0,
			fee: MONEY.cost,
			last: 0,
			shotGain: 0,
			shotVisits: 0,
			lastPlanet: -1,
			/* the ship carries a fitted observation device (refitShip keeps it) */
			reports: true,
			inside: new Uint8Array(GravitySim.MAX_BODIES),
			entered: new Int32Array(GravitySim.MAX_BODIES)
		};
	}

	function resetLedger(ledger, purse0) {
		ledger.purse = purse0 === undefined ? MONEY.purse0 : purse0;
		ledger.fee = MONEY.cost;
		ledger.last = 0;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.reports = true;
		ledger.inside.fill(0);
	}

	/* deducts the launch fee and marks the launch base as already inside so departure pays 0 */
	function openFlight(ledger, sim, fee) {
		ledger.purse -= fee;
		ledger.fee = fee;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
		sim.markSystemsAt(sim.cargo.x, sim.cargo.y, ledger.inside);
	}

	function beginFlight(ledger, sim) {
		openFlight(ledger, sim, MONEY.cost);
	}

	/*
	 * One fly-visit: collect the value, stamp the clock, and let the rulers
	 * breathe — a visit is the only thing that clears rot, and it also opens a
	 * fresh window for one bribe (the rulers only complain once per visit).
	 */
	/* the visit law's one test (0.6.1): a visit is a report — it pays, clears
	 * the value and decays rot — only when the company's ship carries the
	 * device and the planet has not gone quiet. The Capital and A.R.F. are
	 * outside it: their flat entry price is not a report. A caller with no
	 * ledger at hand (a neutral estimate) prices a ship that reports. */
	function visitReports(ledger, market, planet) {
		if (planet === market.capitalPlanet || planet === market.arfPlanet) return true;
		return !market.quiet[planet] && (!ledger || ledger.reports);
	}

	function harvestPlanet(ledger, market, planet, runStep) {
		market.bribeVisitStep[planet] = BRIBE_OPEN;
		ledger.shotVisits += 1;
		ledger.lastPlanet = planet;
		if (!visitReports(ledger, market, planet)) {
			/* nothing reported: the value is neither paid nor cleared, so it
			 * keeps growing until a report or the lord's bribe cashes it. This
			 * landing leaves no report to take back, so a bribe taken on it
			 * keeps the rot clock on the last report that did reach the Capital */
			market.reportPrev[planet] = market.reportStep[planet];
			market.visitPay[planet] = 0;
			return 0;
		}
		const pay = planetProfit(market, planet, runStep);
		market.lastVisitStep[planet] = runStep;
		stampReport(market, planet, runStep);
		market.visitPay[planet] = pay;
		market.stamp += 1;
		if (planet !== market.capitalPlanet && planet !== market.arfPlanet &&
			market.corruption[planet] > 0) {
			market.corruption[planet] = Math.max(market.corruptionFloor[planet],
				market.corruption[planet] - OrbitEcon.CORRUPTION_VISIT_DECAY);
		}
		ledger.purse += pay;
		ledger.shotGain += pay;
		return pay;
	}

	/*
	 * One step of the experimental stay-pay: every system the ship is inside
	 * pays what re-accrued since its last stamp, so a system the ship never
	 * leaves keeps paying instead of sitting at the value it had on entry. The
	 * systems it launched from are inside already, so their stored value — pad
	 * time included — is collected by the first flight step; stamping them at
	 * launch instead would delete that value from the shared market, which is
	 * the one thing this mode must not do.
	 *
	 * Deliberately no `market.stamp` bump: that one invalidates a rival's
	 * sliced plan, and a drip on every step would leave no plan ever
	 * finishing. No `shotVisits` either: lingering in a system is not another
	 * encounter.
	 */
	function harvestStay(ledger, market, sim, runStep) {
		const count = sim.planetCount;
		const inside = ledger.inside;
		let gained = 0;
		for (let p = 0; p < count; p++) {
			if (!inside[p] || !visitReports(ledger, market, p)) continue;
			const pay = planetProfit(market, p, runStep);
			if (pay <= 0) continue;
			market.lastVisitStep[p] = runStep;
			stampReport(market, p, runStep);
			ledger.purse += pay;
			ledger.shotGain += pay;
			gained += pay;
		}
		return gained;
	}

	/* advances one step of system-entry harvesting for either the player or a rival */
	function stepHarvest(ledger, market, sim, runStep) {
		const count = sim.stepInsideAt(sim.cargo.x, sim.cargo.y, ledger.inside, ledger.entered);
		let gained = 0;
		for (let i = 0; i < count; i++) {
			gained += harvestPlanet(ledger, market, ledger.entered[i], runStep);
		}
		if (harvestMode === HARVEST_TICK) gained += harvestStay(ledger, market, sim, runStep);
		if (sim.status === GravitySim.STATUS_ENDED &&
			sim.endReason === GravitySim.END_IMPACT &&
			sim.endBody >= 0 && !ledger.inside[sim.endBody]) {
			ledger.inside[sim.endBody] = 1;
			gained += harvestPlanet(ledger, market, sim.endBody, runStep);
		}
		return gained;
	}

	function endFlight(ledger) {
		ledger.last = ledger.shotGain - ledger.fee;
		return ledger.shotGain;
	}

	/* the page's experimental panel drives the collection mode for every ledger */
	function setHarvestMode(mode) {
		harvestMode = mode === HARVEST_TICK ? HARVEST_TICK : HARVEST_ENTRY;
		return harvestMode;
	}

	function harvestModeOf() {
		return harvestMode;
	}

	/*
	 * reportUntil is the exclusive flight step when the device wears out.
	 * Specials remain payable without reports; omitted means the live ledger.
	 * An optional `{ body, value }` landing scratch receives the last value the
	 * walk accrues on that body whether or not the visit reported it: the
	 * rulers' bribe cashes exactly that value, so a dead device makes the visit
	 * pay nothing while the bribe still prices it.
	 *
	 * `dwells` (optional, one per row) is the stay-pay trail: under
	 * HARVEST_TICK each row also pays the steps its system stayed inside after
	 * the row's step — a step-0 (spawn-inside) row pays steps 1 .. dwell, an
	 * entry row pays its entry then steps + 1 .. steps + dwell — each gated by
	 * reportUntil, until the trail runs out. The drip sum mirrors `harvestStay`
	 * step by step: the exponential curve (and a rebel's fly-by ramp) is not
	 * linear, so a closed form over `paidDwell` would not match within 1e-12.
	 * Omitted `dwells`, or HARVEST_ENTRY, prices entries only — step-0 rows
	 * then pay nothing, exactly as the live entry rule does.
	 * `total` runs through the drip loop so every value joins the accumulator
	 * in the live `stepHarvest` order and the sums match bit for bit.
	 */
	function stayPayLog(market, planet, baseStep, from, to, reportUntil, total) {
		for (let s = from; s <= to; s++) {
			if (reportUntil !== undefined && s >= reportUntil) break;
			const at = baseStep + s;
			const value = planetProfitAt(market, planet, at, estScratch[planet]);
			total += value;
			estScratch[planet] = at;
		}
		return total;
	}

	function estimateProfitLog(market, baseStep, planets, steps, count, ledger, reportUntil, landing, dwells) {
		if (count === 0) return 0;
		estScratch.set(market.lastVisitStep);
		const ticks = harvestMode === HARVEST_TICK;
		let total = 0;
		for (let i = 0; i < count; i++) {
			const planet = planets[i];
			const s0 = steps[i];
			const dwell = ticks && dwells !== undefined ? dwells[i] : 0;
			const special = planet === market.capitalPlanet || planet === market.arfPlanet;
			/* a spawn-inside row has no entry: the launch marked the system
			 * inside before step 1. Only the stay-pay runs, and never on the
			 * Capital (−3) or A.R.F. (0), whose pay would fail the drip gate. */
			if (s0 === 0) {
				if (dwell < 1 || special) continue;
				if (reportUntil === undefined ? !visitReports(ledger, market, planet)
					: market.quiet[planet]) continue;
				total = stayPayLog(market, planet, baseStep, 1, dwell, reportUntil, total);
				continue;
			}
			const at = baseStep + s0;
			const value = planetProfitAt(market, planet, at, estScratch[planet]);
			if (landing !== undefined && planet === landing.body) landing.value = value;
			const reports = special ? true : reportUntil === undefined
				? visitReports(ledger, market, planet)
				: !(market.quiet[planet] || s0 >= reportUntil);
			if (!reports) continue;
			total += value;
			estScratch[planet] = at;
			if (dwell >= 1 && !special) {
				total = stayPayLog(market, planet, baseStep, s0 + 1, s0 + dwell, reportUntil, total);
			}
		}
		return total;
	}

	/* exact predicted harvest along a traced probe, dwell trail included */
	function estimateProfit(market, baseStep, sim, ledger, reportUntil, landing) {
		return estimateProfitLog(market, baseStep, sim.predLogPlanet, sim.predLogStep,
			sim.predLogCount, ledger, reportUntil, landing, sim.predLogDwell);
	}

	/* the generated universe is always PLANET_MAX planets; a run plays a subset.
	 * `mask[i] === 1` marks a planet in play and `count` is how many there are.
	 * The visit profit grows faster on a smaller world (k scales by
	 * PLANET_MAX / count) so a 13-planet career regenerates profit 2× as fast
	 * as the 26-planet default and the economy keeps pace. */
	function setCareerUniverse(career, mask, count) {
		career.planetMask = mask;
		career.planetCount = count;
	}

	function applyMarketUniverse(market, mask, count) {
		market.planetMask = mask;
		market.planetCount = count;
		market.k = MONEY.k * (OrbitWorld.DEFAULT_PLANETS / count);
	}

	/* a planet of the run's universe is in play when it is not masked out */
	function planetInPlay(career, planet) {
		return planet >= 0 && planet < OrbitWorld.PLANETS &&
			(!career.planetMask || career.planetMask[planet] === 1);
	}

	/* --- career ------------------------------------------------------------ */

	/*
	 * Career: launching spends the pad's solar-charged battery. The purse grows
	 * from the shared visit market (the always-available "visit a long-unvisited
	 * planet" task), delivery contracts (land cargo on a planet, needs a hold)
	 * and route competitions (one flight from a planet at least `minLength`
	 * long). Every planet carries an EMC (electromagnetic catapult) and the
	 * planet is claimed by whoever owns the best rail on it: your own EMC
	 * launches for its battery energy alone, a rival player's EMC charges a
	 * usage tax that scales with the energy of the shot and pays that player,
	 * and the neutral commercial EMC-1 standing on every planet charges a fee
	 * that scales with the shot. So a padless planet is no longer a dead end,
	 * only an expensive one.
	 * A company has ten game minutes to recover from insolvency, or completes
	 * (a catapult on every planet; cheat runs never complete). Evacuation can
	 * use the remaining purse and trades time for any unpaid fare.
	 * Every `*Sec` below is flight seconds (`steps · DT`) — the clock the board,
	 * the barrels and the HUD read — never world minutes or real seconds.
	 */
	const CAREER = {
		evacFee: 6,
		evacFullSeconds: 12,
		evacFreeSeconds: 240,
		taxPerKwh: 1,
		endgamePurse: 99,
		hqMinLight: 0.5,
		lightFloor: 0.25,
		deliverySlots: 4,
		deliverySec: 240,
		competeSec: 180,
		competeEvery: 3,
		deliveryBase: 0.5,
		deliveryPerTon: 0.06,
		deliveryDistPx: 900,
		deliveryMax: 4.5,
		competeMinPx: 1500,
		competeSpanPx: 1500,
		competeBase: 2,
		competeSpan: 2,
		turretMinSec: 2,
		turretSpanSec: 3
	};
	const FUEL_KG_PER_KWH = 20;
	const FUEL_PRICE = 0.08;
	const FUEL_BUY_STEP = 10;
	const CARGO_TONS = [4, 8, 16, 24];
	const COMPETE_SLOT = CAREER.deliverySlots;
	const MEDIC_SLOT = CAREER.deliverySlots + 1;
	const BOARD_SIZE = CAREER.deliverySlots + 2;
	const TASK_NONE = 0;
	const TASK_DELIVERY = 1;
	const TASK_COMPETE = 2;
	const TASK_MEDIC = 3;
	const TASK_OFFERED = 0;
	const TASK_ACCEPTED = 1;
	const TASK_LOADED = 2;
	/* what a landing can complete: a contract leg or the competition. Both the
	 * money the purse takes (`cash`) and the progress that unlocks the rest of
	 * the payout (`credit`) are read off one table. */
	const LEG_NONE = 0;
	const LEG_LOAD = 1;
	const LEG_DELIVER = 2;
	const LEG_MEDICS = 3;
	const LEG_PATIENTS = 4;
	const LEG_COMPETE = 5;
	/* a leg that only advances a contract is worth its reward times this while
	 * the payout is still unrealized: loaded cargo is not yet money in the purse */
	const LEG_CREDIT = 0.35;
	const CAREER_OPEN = 0;
	const CAREER_BROKE = 1;
	const CAREER_COMPLETE = 2;
	const SALT_HQ = 0xca;
	const SALT_TASK = 0xcb;
	const SALT_TURRET = 0xcc;
	const SALT_RIVAL = 0xcd;
	const SALT_POLITICS = 0xce;
	const SALT_ARREST = 0xcf;
	const SALT_BRIBE = 0xd0;
	const TAU = Math.PI * 2;

	/*
	 * The commercial EMC-1 is the fallback pad of every planet: a neutral
	 * operator keeps it fully charged and charges for the shot by its energy —
	 * a base fee plus a rate per kWh, so a light hop is cheaper than a loaded
	 * one. It is one immutable record — nothing drains or upgrades it.
	 */
	const COMMERCIAL_BASE = 2.00;
	const COMMERCIAL_KWH = 2.50;
	const COMMERCIAL_PAD = {
		catapult: OrbitTech.CATAPULTS[0],
		panel: OrbitTech.PANELS[0],
		battery: OrbitTech.BATTERIES[0],
		chargeKwh: OrbitTech.BATTERIES[0].capacity,
		reservedKwh: 0
	};
	const OWNER_COMMERCIAL = -1;

	/*
	 * The Empire Capital's fixed imperial rail (0.5.11): one immutable EMC-3
	 * pad, always full, never reserved, free to launch from. Nobody owns or
	 * builds it; every actor's launchPads[capitalPlanet] points here. Like the
	 * commercial rail it never drains, but it claims the planet for the Empire
	 * and forbids building.
	 */
	const OWNER_CAPITAL = -2;
	const CAPITAL_PAD = {
		catapult: OrbitTech.CATAPULTS[2],
		panel: OrbitTech.PANELS[2],
		battery: OrbitTech.BATTERIES[2],
		chargeKwh: OrbitTech.BATTERIES[2].capacity,
		reservedKwh: 0
	};
	/* a fly-visit to the Capital pays this flat fee on each entry; A.R.F. pays 0 */
	const CAPITAL_VISIT_PAY = -3;
	/* accepting any quest or sport at the Capital refunds the entry fee at once;
	 * failing or removing that quest or sport deducts the refund back */
	const CAPITAL_REFUND = -CAPITAL_VISIT_PAY;
	/* tourist-delivery bias: A.R.F. destinations and Capital resort origins and
	 * destinations each weigh 2x an ordinary endpoint (0.5.11) */
	const TOURIST_CHANCE = 0.35;
	const TOURIST_WEIGHT = 2;

	/*
	 * Rebellious worlds (0.5.12). A rebellion seizes every player rail on its
	 * planet into one commercial rail the rebels run: the tiers survive, the
	 * fee is the ordinary commercial one, and the planet can never be claimed
	 * or built again. Until it is quelled, visits there pay a fly-by multiple
	 * that ramps from 1x toward 4x as the rebellion ages.
	 */
	const OWNER_REBEL = -3;

	/* politics is a property of the shared market; the A/B switch freezes the
	 * whole clock (POLITICS=0 reproduces the 0.5.11 economy) */
	let politics = true;
	function setPolitics(on) {
		politics = Boolean(on);
		return politics;
	}
	function politicsOn() {
		return politics;
	}

	/* specials are a property of the seeded world; the A/B switch turns their
	 * rules off without touching geometry (SPECIAL=0 reproduces the old economy) */
	let specialPlanets = true;
	function setSpecialPlanets(on) {
		specialPlanets = Boolean(on);
		return specialPlanets;
	}
	function specialPlanetsOn() {
		return specialPlanets;
	}

	/* `reservedKwh` is the charge queued launches have already claimed */
	function createPad() {
		return { catapult: null, panel: null, battery: null, chargeKwh: 0, reservedKwh: 0 };
	}

	/*
	 * A queued launch claims the energy of its shot from the pad battery before
	 * the barrel lines up, so whoever queued first gets the charge — the owner
	 * of the rail and a guest on it alike. The reservation lowers everyone's
	 * launch ceiling (GravitySim.speedLimit) until the shot fires or is
	 * cancelled, and the neutral commercial rail (kept charged by its operator)
	 * never reserves nor drains.
	 */
	function reserveEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh += energy;
	}

	function releaseEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh = pad.reservedKwh > energy ? pad.reservedKwh - energy : 0;
	}

	function createTask() {
		return { kind: TASK_NONE, state: TASK_OFFERED, good: 0, tons: 0, from: -1, to: -1,
			planet: -1, minLength: 0, reward: 0, deadline: 0, tourist: false, fragile: false,
			deep: false, medics: 0, patients: 0, aboard: 0, capitalRefund: 0 };
	}

	function clearTask(task) {
		task.kind = TASK_NONE;
		task.state = TASK_OFFERED;
		task.tourist = false;
		task.fragile = false;
		task.deep = false;
		task.medics = 0;
		task.patients = 0;
		task.aboard = 0;
		task.capitalRefund = 0;
	}

	/* --- EMC network ------------------------------------------------------- */

	/*
	 * A galaxy is the shared map of one career run: every actor (you and each
	 * rival player) owns pads, and `launchPads[planet]` is the EMC each actor
	 * actually fires from — its own, else the best rival EMC standing there,
	 * else the commercial one. Sim, bots and benches read that array, so the
	 * launch gate never has to know who owns what.
	 */
	function createGalaxy() {
		return {
			seed: 0,
			actors: [],
			commercialPads: Array(OrbitWorld.PLANETS).fill(null),
			mapSeats: null,
			/* safe first-flight pay the initial seating was balanced around; live
			 * expansion uses the same target when choosing a new rival's world */
			openingTargetPay: NaN,
			period: new Float64Array(OrbitWorld.PLANETS),
			phase: new Float64Array(OrbitWorld.PLANETS)
		};
	}

	/* seeded turret: each planet's EMC turns once per 2…5 s of in-game career time, so
	 * a queued launch fires when the barrel lines up with the player's aim */
	function resetGalaxy(galaxy, seed) {
		galaxy.seed = seed >>> 0;
		galaxy.actors.length = 0;
		galaxy.commercialPads.fill(null);
		galaxy.mapSeats = null;
	galaxy.openingTargetPay = NaN;
	galaxy.stats = {
		every: STATS_EVERY,
		count: 0,
		nextStep: STATS_EVERY,
		series: [
			new Float32Array(STATS_SAMPLES), /* map rot */
			new Float32Array(STATS_SAMPLES)  /* map standing */
		]
	};
	for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			galaxy.period[p] = CAREER.turretMinSec + CAREER.turretSpanSec *
				(OrbitWorld.hashBits(galaxy.seed, p, SALT_TURRET) / 4294967296);
			galaxy.phase[p] = TAU * (OrbitWorld.hashBits(galaxy.seed,
				p + OrbitWorld.DEFAULT_PLANETS, SALT_TURRET) / 4294967296);
		}
	}

	function turretPeriod(galaxy, planet) {
		return galaxy.period[planet];
	}

	/* barrel direction (radians) of the planet's EMC after `seconds` of flight time */
	function turretAngle(galaxy, planet, seconds) {
		return galaxy.phase[planet] + seconds / galaxy.period[planet] * TAU;
	}

	/* actor index of the best foreign EMC on `planet`, -1 when only the commercial one stands there */
	function foreignOwner(galaxy, self, planet) {
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			if (actor === self) continue;
			const pad = actor.pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* the pad `career` fires from on `planet`: the commercial EMC-1 stands on
	 * every planet and wins whenever it is the chosen rail, else your own EMC,
	 * else the best rival EMC, else the commercial one again. Ignore the
	 * one-shot override when forecasting the rail after a landing. */
	function commercialPadAt(career, planet) {
		const pads = career.galaxy ? career.galaxy.commercialPads : career.commercialPads;
		return rebelRail(career, planet) || (pads && pads[planet]) || COMMERCIAL_PAD;
	}

	function padAt(career, planet, useCommercial = true) {
		if (planet === career.capitalPlanet) return CAPITAL_PAD;
		const rebel = rebelRail(career, planet);
		if (rebel) return rebel;
		if (useCommercial && career.commercialPlanet === planet) return commercialPadAt(career, planet);
		if (career.pads[planet].catapult !== null) return career.pads[planet];
		if (!career.galaxy) return commercialPadAt(career, planet);
		const owner = foreignOwner(career.galaxy, career, planet);
		return owner === OWNER_COMMERCIAL ? commercialPadAt(career, planet) : career.galaxy.actors[owner].pads[planet];
	}

	/* owner index of that pad, -1 for the neutral commercial EMC, -2 for the
	 * fixed imperial rail on the Capital */
	function padOwner(career, planet, useCommercial = true) {
		if (planet === career.capitalPlanet) return OWNER_CAPITAL;
		const market = career.market;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		/* a quelled rebellion leaves its rail commercial for good */
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		if (useCommercial && career.commercialPlanet === planet) return OWNER_COMMERCIAL;
		if (career.pads[planet].catapult !== null) return career.index;
		if (!career.galaxy) return OWNER_COMMERCIAL;
		return foreignOwner(career.galaxy, career, planet);
	}

	/* choose (planet >= 0) or drop (-1) the commercial rail for the next launch;
	 * it never claims the planet and never blocks building your own EMC there */
	function setCommercial(career, planet) {
		/* the Capital rail is imperial and a rebellious planet runs its own */
		if (planet >= 0 && planet === career.capitalPlanet) return;
		if (planet >= 0 && rebelRail(career, planet)) return;
		career.commercialPlanet = planet;
		syncCareerNetwork(career);
	}

	/* planet claim: the highest rail there wins, ties keep the older actor; the
	 * Capital is always the Empire's, never a player claim */
	function claimOwner(galaxy, planet) {
		if (galaxy.actors.length > 0 && galaxy.actors[0].capitalPlanet === planet) return OWNER_CAPITAL;
		const market = galaxy.market;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* a build anywhere changes what every actor may fire from, so refresh all */
	function refreshNetwork(galaxy) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			for (let p = 0; p < OrbitWorld.PLANETS; p++) actor.launchPads[p] = padAt(actor, p);
		}
	}

	/* a solo career has no galaxy: its own launchPads must still mirror padAt */
	function syncCareerNetwork(career) {
		if (career.galaxy) {
			refreshNetwork(career.galaxy);
			return;
		}
		for (let p = 0; p < OrbitWorld.PLANETS; p++) career.launchPads[p] = padAt(career, p);
	}

	function joinGalaxy(career, galaxy) {
		career.galaxy = galaxy;
		career.market = galaxy.market || career.market || null;
		career.index = galaxy.actors.indexOf(career);
		if (career.index < 0) {
			career.index = galaxy.actors.length;
			galaxy.actors.push(career);
			if (galaxy.stats) {
				/* four stat series per company — profit, property, science, flown.
				 * a company joining mid-run backfills its past at its starting
				 * values, so its line starts flat instead of inheriting the
				 * history a removed company left in a reused series */
				while (galaxy.stats.series.length < 2 + galaxy.actors.length * 4) {
					galaxy.stats.series.push(new Float32Array(STATS_SAMPLES));
				}
				careerStats(sampleCareerOut, career);
				const base = 2 + career.index * 4;
				for (let s = 0; s < galaxy.stats.count; s++) {
					galaxy.stats.series[base][s] = sampleCareerOut.profit;
					galaxy.stats.series[base + 1][s] = sampleCareerOut.property;
					galaxy.stats.series[base + 2][s] = sampleCareerOut.science;
					galaxy.stats.series[base + 3][s] = sampleCareerOut.flown;
				}
			}
		}
		refreshNetwork(galaxy);
	}

	/*
	 * What the commercial rail charges for a shot of `speed`: a base fee plus
	 * the energy the shot burns, priced on the rail that stands on the planet
	 * (a seized rebel rail keeps the ordinary commercial price). 0 under the
	 * `communism` cheat. `mass` prices an exit for a ship other than the one
	 * aboard (a delivery's arrival); the live fee prices the ship as loaded.
	 */
	function commercialFee(career, planet, speed, mass) {
		const pad = commercialPadAt(career, planet);
		const shipMass = mass === undefined ? career.ship.mass : mass;
		const energy = OrbitTech.launchEnergy(shipMass, pad.catapult, speed);
		return price(career, COMMERCIAL_BASE + COMMERCIAL_KWH * energy);
	}

	/* the cheapest commercial shot there is — a dry starter ship at the minimum
	 * speed on the starter rail: the honest "one way off any planet" price.
	 * Undiscounted; callers apply the cheat wrapper. */
	function commercialMinFee() {
		return COMMERCIAL_BASE + COMMERCIAL_KWH *
			OrbitTech.launchEnergy(OrbitTech.SHIP_DRY_MASS, COMMERCIAL_PAD.catapult, GravitySim.SPEED_MIN);
	}

	/* money the EMC owner charges for a launch at `speed`; 0 on your own pad
	 * and on the Capital's free imperial rail */
	function launchFee(career, planet, speed) {
		const owner = padOwner(career, planet);
		if (owner === career.index || owner === OWNER_CAPITAL) return 0;
		if (owner === OWNER_COMMERCIAL || owner === OWNER_REBEL) {
			return commercialFee(career, planet, speed);
		}
		const pad = padAt(career, planet);
		return price(career, CAREER.taxPerKwh *
			OrbitTech.launchEnergy(career.ship.mass, pad.catapult, speed) * pad.catapult.tier);
	}

	/*
	 * Cheapest way off `planet` with a ship of `mass`: your own EMC is free, the
	 * commercial rail charges its fee at the slowest firable shot while it can
	 * lift the ship, a rival rail its usage tax at the slowest firable shot,
	 * and a build or an evacuation is the fallback. Infinity when nothing can
	 * leave.
	 */
	function exitCostAt(career, planet, mass) {
		if (planet < 0) return price(career, CAREER.evacFee);
		if (planet === career.capitalPlanet) return 0;
		if (career.pads[planet].catapult !== null) return 0;
		const rail = commercialPadAt(career, planet);
		const lift = OrbitTech.speedLimit(rail.battery.capacity,
			mass, rail.catapult, career.forceScale);
		const commercial = lift + 1e-9 >= GravitySim.SPEED_MIN
			? commercialFee(career, planet, GravitySim.SPEED_MIN, mass) : Infinity;
		let foreign = Infinity;
		const owner = padOwner(career, planet);
		if (owner !== OWNER_COMMERCIAL && owner !== OWNER_REBEL && owner !== career.index) {
			const pad = padAt(career, planet);
			const railLift = OrbitTech.speedLimit(pad.battery.capacity,
				mass, pad.catapult, career.forceScale);
			if (railLift + 1e-9 >= GravitySim.SPEED_MIN) {
				foreign = price(career, CAREER.taxPerKwh *
					OrbitTech.launchEnergy(mass, pad.catapult, GravitySim.SPEED_MIN) *
					pad.catapult.tier);
			}
		}
		const build = price(career, OrbitTech.CATAPULTS[0].buildCost);
		const evac = price(career, CAREER.evacFee);
		return Math.min(commercial, foreign, build, evac);
	}

	function exitCost(career) {
		return exitCostAt(career, career.at, career.ship.mass);
	}

	/* who owns the rail on `planet`, named as the page and the bot log read it */
	function railOwnerText(career, planet) {
		const owner = padOwner(career, planet);
		const tier = padAt(career, planet).catapult ? padAt(career, planet).catapult.tier : 1;
		if (owner === career.index) return 'own EMC-' + tier;
		if (owner === OWNER_CAPITAL) return 'imperial EMC-3';
		if (owner === OWNER_REBEL) return 'rebel EMC-' + tier;
		if (owner === OWNER_COMMERCIAL && rebelRail(career, planet)) {
			return 'seized EMC-' + tier;
		}
		if (owner === OWNER_COMMERCIAL) return 'commercial EMC-' + tier;
		return (owner === 0 ? 'YOU' : 'R' + owner) + ' rail';
	}

	/*
	 * The live numbers behind every launch gate: the rail under the ship, its
	 * charge and the speed that buys, the fee and the purse. The launch list
	 * and the bot decision log both print this line, so a player and a rival
	 * never read two different stories about the same pad.
	 */
	function railText(career, sim, planet) {
		if (planet < 0) {
			return 'ship in space · evac ' + evacuationCost(career).toFixed(2) +
			' · ' + Math.round(evacuationSeconds(career)) + ' s · purse ' +
			career.ledger.purse.toFixed(2);
		}
		const pad = padAt(career, planet);
		const exit = exitCostAt(career, planet, career.ship.mass);
		return 'P' + planet + ' · ' + railOwnerText(career, planet) + ' · ' +
			pad.chargeKwh.toFixed(2) + '/' + pad.battery.capacity.toFixed(2) + ' kWh → ' +
			sim.speedLimit(planet).toFixed(0) + ' px/s (min ' + GravitySim.SPEED_MIN + ') · fee ' +
			launchFee(career, planet, GravitySim.SPEED_MIN).toFixed(2) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · exit ' +
			(Number.isFinite(exit) ? exit.toFixed(2) : 'impossible');
	}

	/* fragile load (0.6.3): a loaded fragile contract dies on a launch harder
	 * than FRAGILE_SPEED, whatever the rail; a gentle shot on any rail is safe */
	function fragileBreaks(task, speed) {
		return task.fragile && task.state === TASK_LOADED && speed > FRAGILE_SPEED + 1e-9;
	}

	/*
	 * The launch gates as structured reasons, in the ladder order the launch
	 * list prints: arrest, ship in space, wrong planet, worn out, no rail,
	 * speed cap, purse. launchReasons is every closed gate (the headline and
	 * the blockers under it); launchReason is the first, null when the shot
	 * fires. Ship-state gates (arrest, worn) report even behind a position
	 * gate; planet gates (no rail, cap, fee) need the ship on the planet, and
	 * no rail closes cap and fee. formatLaunchReason spells one reason in the
	 * words the list prints, and launchBlock is that spelling of the first
	 * reason — one writer, one order.
	 */
	function recordLaunchReason(out, reason, firstOnly) {
		if (firstOnly) return reason;
		out.push(reason);
		return null;
	}

	/* The same ordered checker serves the list (all reasons) and old callers
	 * (first only). The latter avoids allocating an array on the launch path. */
	function scanLaunchReasons(career, sim, planet, speed, repaired, firstOnly) {
		const out = firstOnly ? null : [];
		let first;
		if (career.arrested) {
			first = recordLaunchReason(out, { id: 'arrest', need: null, have: null }, firstOnly);
			if (first) return first;
		}
		if (career.at < 0) {
			first = recordLaunchReason(out, { id: 'space', need: null, have: null }, firstOnly);
			if (first) return first;
			if (!repaired && !careerShipUsable(career)) {
				first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
				if (first) return first;
			}
			return out;
		}
		if (career.at !== planet) {
			first = recordLaunchReason(out,
				{ id: 'wrong-planet', need: planet, have: career.at }, firstOnly);
			if (first) return first;
			if (!repaired && !careerShipUsable(career)) {
				first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
				if (first) return first;
			}
			return out;
		}
		if (!repaired && !careerShipUsable(career)) {
			first = recordLaunchReason(out, { id: 'worn', need: null, have: career.ship.condition }, firstOnly);
			if (first) return first;
		}
		if (!sim.canLaunchFrom(planet)) {
			first = recordLaunchReason(out, { id: 'no-rail', need: null, have: null }, firstOnly);
			if (first) return first;
			return out;
		}
		const cap = sim.speedLimit(planet);
		if (speed > cap + 1e-9) {
			first = recordLaunchReason(out, { id: 'cap', need: cap, have: speed }, firstOnly);
			if (first) return first;
		}
		const fee = launchFee(career, planet, speed);
		const cost = repaired ? fee + repairCost(career) : fee;
		if (career.ledger.purse + 1e-9 < cost) {
			first = recordLaunchReason(out,
				{ id: 'fee', need: cost, have: career.ledger.purse, repair: repaired }, firstOnly);
			if (first) return first;
		}
		return out;
	}

	function launchReasons(career, sim, planet, speed, repaired) {
		return scanLaunchReasons(career, sim, planet, speed, repaired, false);
	}

	function launchReason(career, sim, planet, speed, repaired) {
		return scanLaunchReasons(career, sim, planet, speed, repaired, true);
	}

	function formatLaunchReason(reason) {
		if (!reason) return '';
		if (reason.id === 'arrest') return 'under arrest · Capital transport';
		if (reason.id === 'space') return 'ship in space';
		if (reason.id === 'wrong-planet') return 'shot leaves from P' + reason.need;
		if (reason.id === 'worn') return WORN_OUT_BLOCK;
		if (reason.id === 'no-rail') return 'no rail under the ship';
		if (reason.id === 'cap') {
			return 'cap ' + reason.need.toFixed(0) + ' < ' + reason.have.toFixed(0) + ' px/s';
		}
		return (reason.repair ? 'repair + fee ' : 'fee ') + reason.need.toFixed(2) +
			' > purse ' + reason.have.toFixed(2);
	}

	/* the one reason a shot at `speed` cannot leave `planet` now, in the words
	 * the launch list prints under a row and the bot log puts on a "no shot"
	 * line. '' means firable. */
	function launchBlock(career, sim, planet, speed, repaired) {
		return formatLaunchReason(launchReason(career, sim, planet, speed, repaired));
	}

	function railBlock(career, sim, planet, speed) {
		return launchBlock(career, sim, planet, speed, false);
	}

	/* the same gate for a shot fired right after a full repair: the wear gate
	 * is lifted and the purse must cover the repair as well as the fee */
	function repairLaunchBlock(career, sim, planet, speed) {
		return launchBlock(career, sim, planet, speed, true);
	}

	/* the rail gate plus the purse, spelled by the same facts the list prints */
	function careerCanFire(career, sim, planet, speed) {
		return railBlock(career, sim, planet, speed) === '';
	}

	/* full-battery speed cap of the pad `career` fires from on `planet` */
	function padLift(career, planet, forceScale) {
		const pad = padAt(career, planet);
		const cap = OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
			pad.catapult, forceScale === undefined ? career.forceScale : forceScale);
		return cap;
	}

	/* deterministic rival seed: own task board, HQ and science hull per player */
	function rivalSeed(seed, index) {
		return OrbitWorld.hashBits(seed >>> 0, index + 1, SALT_RIVAL);
	}

	/* Live advice only: compact replays rebuild the streak from their landings. */
	const returnLandingVisits = new WeakMap();

	function returnLandingVisit(career) {
		const visit = returnLandingVisits.get(career);
		return visit && visit.planet === career.at ? visit : null;
	}

	/* `ledger` is the purse shared with the page's score rows; pads and ship
	 * are the objects a GravitySim gates on (setLaunchNetwork) */
	function createCareer(ledger) {
		const pads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) pads.push(createPad());
		const launchPads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) launchPads.push(COMMERCIAL_PAD);
		const tasks = [];
		for (let i = 0; i < BOARD_SIZE; i++) tasks.push(createTask());
		return {
			ledger: ledger,
			seed: 0,
			cheat: null,
			galaxy: null,
			index: 0,
			/* the run's active planet subset; null = every planet in play */
			planetMask: null,
			planetCount: OrbitWorld.PLANETS,
			hq: -1,
			at: -1,
			flying: false,
			stranded: false,
			/* the last launch broke a fragile load (the notice the HUD prints) */
			fragileLost: false,
			commercialPlanet: -1,
			commercialPads: null,
			capitalPlanet: -1,
			arfPlanet: -1,
			launchBook: createLaunchBook(),
			pads: pads,
			launchPads: launchPads,
			padCount: 0,
			light: new Float64Array(OrbitWorld.PLANETS),
			ship: {
				hold: OrbitTech.HOLDS[0], engine: null, tank: OrbitTech.TANKS[0],
				obs: OrbitTech.OBS[1],
				cargoTons: 0, fuelKg: 0, mass: 0,
				condition: 1
			},
			/* 1 flagship; a bought ship wears WEAR_FLEET times faster */
			wearScale: 1,
			repairs: 0,
			maintenanceSpent: 0,
			owned: {},
			science: OrbitScience.createHull(),
			prototypes: newPrototypes(),
			research: 0,
			tasks: tasks,
			contract: -1,
			serial: 0,
			flights: 0,
			burns: 0,
			evacuations: 0,
			evacuationSpent: 0,
			delivered: 0,
			competitions: 0,
			earned: 0,
			taxPaid: 0,
			taxEarned: 0,
			lastEnergy: 0,
			lastFee: 0,
			lastReward: 0,
			lastFuel: 0,
			fuelBoughtKg: 0,
			fuelProducedKg: 0,
			fuelSpent: 0,
			lastResearch: 0,
			forceScale: 1,
			ended: CAREER_OPEN,
			recoverySteps: -1,
			recoveryEpisode: 0,
			market: null,
			arrested: false,
			arrestUntilStep: 0,
			evacuating: false,
			evacUntilStep: 0,
			evacStartStep: 0,
			evacFromX: 0,
			evacFromY: 0,
			evacToX: 0,
			evacToY: 0,
			evacDurationSteps: 0,
			evacLastPaid: 0,
			evacLastSteps: 0,
			evacFrom: -1,
			arrests: 0,
			bribes: 0,
			bribeIncome: 0,
			patientsDelivered: 0,
		medicTrips: 0,
		/* where the run's money came from and where it went:
		 * visitIncome + earned + bribeIncome + taxEarned is what flying brought in;
		 * feesPaid + fuelSpent + evacuations is what flying cost;
		 * buildSpent and sciSpent are where profit was put.
		 * purse = starter purse + profit − property − science */
		visitIncome: 0,
		flownPx: 0,
		feesPaid: 0,
		buildSpent: 0,
		sciSpent: 0
		};
	}

	function price(career, cost) {
		return career.cheat === CHEAT_COMMUNISM ? 0 : cost;
	}

	function canPay(career, cost) {
		return career.ledger.purse + 1e-9 >= price(career, cost);
	}

	function careerShipUsable(career) {
		return career.ship.condition > 0;
	}

	/* the one writer of condition, so the report flag is never stale: a ship
	 * that wears out between two harvests stops paying at the next visit */
	function setShipCondition(career, value) {
		career.ship.condition = value <= WEAR_EPS ? 0 : value > 1 ? 1 : value;
		career.ledger.reports = career.ship.obs.fitted && career.ship.condition > 0;
	}

	function refitShip(career) {
		career.ship.mass = OrbitTech.shipMass(career.ship, career.ship.cargoTons);
		setShipCondition(career, career.ship.condition);
	}

	/* accepted research hardens the ship down to WEAR_SCIENCE_MIN of the starter rate */
	function wearFactor(career) {
		const science = 1 - WEAR_SCIENCE_STEP * career.research;
		return career.wearScale * (science > WEAR_SCIENCE_MIN ? science : WEAR_SCIENCE_MIN);
	}

	/* The experimental knob changes space ageing, not launch, landing or burns. */
	function setSpaceWearScale(value) {
		if (!Number.isFinite(value)) return spaceWearScale;
		spaceWearScale = Math.max(EXPERIMENT.spaceWearMin, Math.min(EXPERIMENT.spaceWearMax, value));
		return spaceWearScale;
	}

	function spaceWearScaleOf() {
		return spaceWearScale;
	}

	function launchWear(career, speed) {
		return Math.min(WEAR_EMC_MAX, WEAR_EMC * OrbitTech.launchAccel(speed) /
			WEAR_EMC_REF * wearFactor(career));
	}

	function spaceWear(career, steps) {
		return WEAR_SPACE * spaceWearScale * GravitySim.gameSeconds(steps) * wearFactor(career);
	}

	function impulseWear(career, dv) {
		return WEAR_IMP * (dv / WEAR_IMP_DV) * wearFactor(career);
	}

	function landingWear(career) {
		return WEAR_LANDING * wearFactor(career);
	}

	/* The forecast starts at the current condition (or a planned full repair).
	 * Landing wear follows the final visit, so it does not shorten reporting. */
	function forecastCondition(career, condition, steps, speed, dv, landed) {
		const wear = launchWear(career, speed || 0) + impulseWear(career, dv || 0) +
			spaceWear(career, steps) + (landed ? landingWear(career) : 0);
		const remaining = condition - wear;
		return remaining <= WEAR_EPS ? 0 : remaining;
	}

	function forecastReportUntil(career, condition, speed, dv) {
		if (!career.ship.obs.fitted) return 0;
		const remaining = condition - launchWear(career, speed || 0) - impulseWear(career, dv || 0);
		if (remaining <= WEAR_EPS) return 0;
		const perStep = spaceWear(career, 1);
		return perStep > 0 ? (remaining - WEAR_EPS) / perStep : Infinity;
	}

	/* A fully worn ship must be repaired before it can take any exit. */
	function forecastRepairReserve(career, arrivalCondition) {
		return arrivalCondition === 0 ? price(career, WEAR_REPAIR_COST) : 0;
	}

	/* Incremental eventual service cost, not the cost of pre-existing wear. */
	function forecastWearCost(career, condition, steps, speed, dv, landed) {
		const end = forecastCondition(career, condition, steps, speed, dv, landed);
		return price(career, (condition - end) * WEAR_REPAIR_COST);
	}

	/* space-weather hook: the wear multiplier at a world point. No zones yet. */
	function careerWearAt(career, x, y) {
		return 1;
	}

	/* careerAdvance has no position, so it charges the base space wear; the
	 * flight loop calls this after stepOne for the weather's share of that step */
	function careerWeatherWear(career, sim) {
		const extra = careerWearAt(career, sim.cargo.x, sim.cargo.y) - 1;
		if (extra === 0 || !career.flying) return;
		setShipCondition(career, career.ship.condition -
			spaceWear(career, 1) * extra);
	}

	/* what the purse pays for a full repair, to the cent */
	function repairCost(career) {
		return price(career,
			Math.round(WEAR_REPAIR_COST * (1 - career.ship.condition) * 100) / 100);
	}

	/* full repair only, wherever the ship is landed: a service, not a claim */
	function repairCareer(career) {
		if (career.ended !== CAREER_OPEN || career.flying || career.at < 0) return false;
		if (career.ship.condition >= 1) return false;
		const cost = repairCost(career);
		if (career.ledger.purse + 1e-9 < cost) return false;
		career.ledger.purse -= cost;
		career.maintenanceSpent += cost;
		career.repairs += 1;
		setShipCondition(career, 1);
		checkEnded(career);
		refreshCareerMedic(career);
		return true;
	}

	function fuelPrice(career) {
		return price(career, FUEL_PRICE);
	}

	/* Both transactions need a landed, usable drive; a tank alone is not enough. */
	function fuelRequest(career, kg) {
		const ship = career.ship;
		if (career.ended !== CAREER_OPEN || career.at < 0 || !ship.engine || !ship.tank ||
			!Number.isFinite(kg) || kg <= 0) return 0;
		return Math.max(0, Math.min(kg, ship.tank.fuelCap - ship.fuelKg));
	}

	/* Only the career's own pad feeds the converter, never a guest/commercial rail. */
	function produceFuel(career, planet, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0 || planet !== career.at) return 0;
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return 0;
		const freeKwh = Math.max(0, pad.chargeKwh - pad.reservedKwh);
		amount = Math.min(Math.floor(amount), Math.floor(freeKwh * FUEL_KG_PER_KWH + 1e-9));
		if (amount <= 0) return 0;
		pad.chargeKwh -= amount / FUEL_KG_PER_KWH;
		career.ship.fuelKg += amount;
		career.fuelProducedKg += amount;
		return amount;
	}

	function buyFuel(career, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0) return 0;
		const unitPrice = fuelPrice(career);
		if (unitPrice > 0) amount = Math.min(amount, Math.max(0, career.ledger.purse) / unitPrice);
		if (amount <= 0) return 0;
		const cost = amount * unitPrice;
		career.ledger.purse = Math.max(0, career.ledger.purse - cost);
		career.ship.fuelKg += amount;
		career.fuelBoughtKg += amount;
		career.fuelSpent += cost;
		checkEnded(career);
		refreshCareerMedic(career);
		return amount;
	}

	function draw01(career, salt) {
		career.serial += 1;
		return OrbitWorld.hashBits(career.seed, career.serial, salt) / 4294967296;
	}

	/* a uniform draw over the run's in-play planets */
	function activePlanetDraw(career) {
		const count = career.planetCount || OrbitWorld.PLANETS;
		let pick = Math.floor(draw01(career, SALT_TASK) * count);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (career.planetMask && career.planetMask[i] === 0) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return 0;
	}

	/* a colony sits on a planet of the run only when that planet is in play */
	function colonyInPlay(career, colony) {
		return planetInPlay(career, colony.planet);
	}

	/* Conservative gravity band used for seeded HQ fallbacks. Opening landing
	 * eligibility uses the measured EMC-1 + BAT-1 exit probe below instead. */
	const HQ_GRAVITY_MAX = 1;

	/* --- career map generator: fair first flights and useful first landings --- */

	/*
	 * A first flight needs to do two things: pay roughly as well as the other
	 * companies' openings, and end on a free planet at G ≤ 1.5 where the starter
	 * EMC-1 + BAT-1 can physically launch again. The exit probe matters more
	 * than gravity alone: a new rail must not become a dead-end claim.
	 */
	const OPENING_ANGLES = 8;
	const OPENING_SPEEDS = 4;
	const OPENING_EXIT_ANGLES = 8;
	const OPENING_EXIT_FRACTIONS = [0, 1 / 3, 2 / 3, 1];
	const OPENING_BUILD_GRAVITY_MAX = 1.5;
	const OPENING_HORIZON = CAP_SECONDS;
	const OPENING_BANDS = [0.85, 0.7, 0.5, 0.25, 0];
	const OPENING_CACHE_MAX = 8;
	const OPENING_COMPARE_EPS = 0.01;
	/* the band a map aims for: weakest company earns this share of the best */
	const OPENING_FAIR_RATIO = 0.55;
	const OPENING_RATIO_EPS = 0.02;
	/* ratios below this are not worth ranking; negative openings are not starts */
	const OPENING_RATIO_FLOOR = 0.01;
	const OPENING_RATIO_ROUNDS = 3;
	const openingCache = new Map();
	const openingSeen = new Uint8Array(OrbitWorld.PLANETS);
	const openingTargetPay = new Float64Array(OrbitWorld.PLANETS);
	const openingAnyTargetPay = new Float64Array(OrbitWorld.PLANETS);
	const openingResult = { reach: 0, light: 0, pay: 0, openPay: 0, buildable: 0, buildPay: 0 };
	let openingSim = null;
	let openingMarket = null;
	let openingStrengths = null;
	let openingTrade = null;
	let openingGravityScale = 1;
	let openingForceScale = 1;

	function openingMaskTag(mask, count) {
		let tag = Math.imul(count + 1, 0x01000193) >>> 0;
		if (!mask) return tag;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			tag = Math.imul(tag ^ (mask[i] ? i + 1 : 0), 0x01000193) >>> 0;
		}
		return tag;
	}

	function openingExtent(mask) {
		let extent = OrbitWorld.PLANETS;
		while (extent > 0 && mask && !mask[extent - 1]) extent--;
		return extent;
	}

	/* The shared scratch sim follows the current trade world, not the first
	 * world that happened to initialize it. A new seed replaces all geometry. */
	function openingFill(t, outX, outY, count) {
		const trade = openingTrade;
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	}

	function openingEnsureSim(trade) {
		if (openingSim === null) {
			openingSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
			openingMarket = createMarket();
			openingStrengths = new Float64Array(GravitySim.MAX_BODIES);
		}
		openingTrade = trade;
		openingSim.setPlanets(OrbitWorld.PLANETS, trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	}

	function openingPrepare(world, trade, mask, count, forcedHomes, sourceSim) {
		openingEnsureSim(trade);
		openingGravityScale = sourceSim && Number.isFinite(sourceSim.gravityScale)
			? sourceSim.gravityScale : 1;
		openingForceScale = sourceSim && Number.isFinite(sourceSim.forceScale)
			? sourceSim.forceScale : 1;
		openingSim.setScales(openingGravityScale, openingForceScale);
		openingSim.setPlanetMask(mask);
		resetMarket(openingMarket);
		applyMarketUniverse(openingMarket, mask, count);
		applyMarketSpecials(openingMarket, world);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) openingStrengths[i] = 0;
			else if (specialPlanets && (i === world.capitalPlanet || i === world.arfPlanet)) {
				openingStrengths[i] = 1;
			} else if (forcedHomes && forcedHomes[i]) openingStrengths[i] = 1;
			else openingStrengths[i] = planetGravity(world.seed, i);
		}
	}

	/* Mirror the bot's starter-departure probe: eight bearings and four snapped
	 * speeds across the EMC-1 + BAT-1 cap, with a full flight horizon. */
	function openingStarterCanExit(planet) {
		const sim = openingSim;
		if (!sim.planetActive(planet)) return false;
		const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], openingForceScale);
		const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
		let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return false;
		const span = capU - minU;
		let previous = -1;
		for (let f = 0; f < OPENING_EXIT_FRACTIONS.length; f++) {
			const speedU = f === OPENING_EXIT_FRACTIONS.length - 1
				? capU : minU + Math.round(span * OPENING_EXIT_FRACTIONS[f]);
			if (speedU === previous) continue;
			previous = speedU;
			const speed = speedU / SPEED_STEPS;
			for (let a = 0; a < OPENING_EXIT_ANGLES; a++) {
				const angle = angleOf(angleUnits((a + 0.5) / OPENING_EXIT_ANGLES * Math.PI * 2));
				sim.predictFast(planet, angle, speed, OPENING_HORIZON);
				if (sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0 &&
					sim.predBody !== planet) return true;
			}
		}
		return false;
	}

	/* Trace one company's starter-speed fan. A safe landing is a free planet
	 * the other starting HQs do not occupy, below the heavy-world cutoff, and
	 * from which an EMC-1 can actually leave again. */
	function openingTraceHome(world, mask, forcedHomes, home, strictExit, sitePay, targetPay,
		exitOk, angles, speeds) {
		const nAngles = angles || OPENING_ANGLES;
		const nSpeeds = speeds || OPENING_SPEEDS;
		const sim = openingSim;
		const savedStrength = openingStrengths[home];
		openingStrengths[home] = 1;
		sim.setField(openingExtent(mask), openingTrade.planetR,
			openingStrengths, openingFill, true);
		openingSeen.fill(0);
		openingTargetPay.fill(-Infinity);
		openingAnyTargetPay.fill(-Infinity);
		openingResult.reach = 0;
		openingResult.light = 0;
		openingResult.pay = -Infinity;
		openingResult.openPay = -Infinity;
		openingResult.buildable = 0;
		openingResult.buildPay = -Infinity;
		const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], openingForceScale);
		const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
		let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) {
			openingResult.pay = 0;
			openingResult.openPay = 0;
			openingStrengths[home] = savedStrength;
			return openingResult;
		}
		const span = capU - minU;
		for (let s = 0; s < nSpeeds; s++) {
			const speedU = s === nSpeeds - 1 ? capU
				: minU + Math.round(span * s / (nSpeeds - 1));
			const speed = speedOf(speedU);
			for (let a = 0; a < nAngles; a++) {
				const angle = angleOf(angleUnits((a + 0.5) / nAngles * Math.PI * 2));
				sim.predictFast(home, angle, speed, OPENING_HORIZON);
				if (sim.predReason !== GravitySim.END_IMPACT || sim.predBody < 0) continue;
				const body = sim.predBody;
				const earned = estimateProfit(openingMarket, 0, sim);
				if (earned > openingResult.pay) openingResult.pay = earned;
				if (body === home) continue;
				if (!openingSeen[body]) {
					openingSeen[body] = 1;
					openingResult.reach += 1;
				}
				if (!forcedHomes || !forcedHomes[body]) {
					if (earned > openingAnyTargetPay[body]) openingAnyTargetPay[body] = earned;
				}
				if (body === world.capitalPlanet && specialPlanets) continue;
				if (forcedHomes && forcedHomes[body]) continue;
				if (openingStrengths[body] > OPENING_BUILD_GRAVITY_MAX) continue;
				if (earned > openingTargetPay[body]) openingTargetPay[body] = earned;
			}
		}
		for (let body = 0; body < OrbitWorld.PLANETS; body++) {
			const openPay = openingAnyTargetPay[body];
			if (Number.isFinite(openPay)) {
				if (openPay > openingResult.openPay) openingResult.openPay = openPay;
				if (targetPay) targetPay[home * OrbitWorld.PLANETS + body] = openPay;
			}
			const earned = openingTargetPay[body];
			if (!Number.isFinite(earned)) continue;
			const exitable = !strictExit || openingStarterCanExit(body);
			/* the assignment needs to know *which* targets a seat could use
			 * without painting itself into a dead-end claim */
			if (exitOk) exitOk[home * OrbitWorld.PLANETS + body] = exitable ? 1 : 0;
			if (!exitable) continue;
			openingResult.light += 1;
			openingResult.buildable += 1;
			if (sitePay) sitePay[home * OrbitWorld.PLANETS + body] = earned;
			if (openingResult.buildable === 1 || earned > openingResult.buildPay) {
				openingResult.buildPay = earned;
			}
		}
		if (!Number.isFinite(openingResult.pay)) openingResult.pay = 0;
		if (!Number.isFinite(openingResult.openPay)) openingResult.openPay = 0;
		openingStrengths[home] = savedStrength;
		return openingResult;
	}

	/* One world and one set of already-pinned HQs have the same opening table
	 * for every actor; the company-specific seed only breaks equal choices. */
	function careerOpenings(world, trade, mask, count, forcedHomes, sourceSim) {
		const key = (world.seed >>> 0) + ':' + (trade.seed >>> 0) + ':' + trade.t.toFixed(3) + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			openingMaskTag(mask, count) + ':' + openingMaskTag(forcedHomes, 0) + ':' +
			(specialPlanets ? 1 : 0);
		const cached = openingCache.get(key);
		if (cached) return cached;
		openingPrepare(world, trade, mask, count, forcedHomes, sourceSim);
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const targetPay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		targetPay.fill(-Infinity);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const rows = {
			light: new Int8Array(OrbitWorld.PLANETS),
			reach: new Int8Array(OrbitWorld.PLANETS),
			pay: new Float64Array(OrbitWorld.PLANETS),
			buildable: new Int8Array(OrbitWorld.PLANETS),
			buildPay: new Float64Array(OrbitWorld.PLANETS),
			openPay: new Float64Array(OrbitWorld.PLANETS),
			sitePay: sitePay,
			targetPay: targetPay,
			exitOk: exitOk,
			best: -Infinity
		};
		for (let planet = 0; planet < OrbitWorld.PLANETS; planet++) {
			if ((mask && mask[planet] === 0) || hqForbidden(world, planet)) continue;
			const profile = openingTraceHome(world, mask, forcedHomes, planet, true, sitePay,
				targetPay, exitOk);
			rows.reach[planet] = profile.reach;
			rows.light[planet] = profile.light;
			rows.pay[planet] = profile.pay;
			rows.openPay[planet] = profile.openPay;
			rows.buildable[planet] = profile.buildable;
			rows.buildPay[planet] = profile.buildPay;
			if ((!forcedHomes || !forcedHomes[planet]) && profile.buildable > 0 &&
				profile.buildPay > rows.best) rows.best = profile.buildPay;
		}
		openingCache.set(key, rows);
		if (openingCache.size > OPENING_CACHE_MAX) {
			openingCache.delete(openingCache.keys().next().value);
		}
		return rows;
	}

	function hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight) {
		if (mask && mask[i] === 0) return false;
		if (used && used[i]) return false;
		if (hqForbidden(world, i) || rows.buildable[i] <= 0) return false;
		if (shallowOnly && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) return false;
		if (rows.buildPay[i] < floor) return false;
		if (needLight && world.planetLight[i] < CAREER.hqMinLight) return false;
		return true;
	}

	/* Seeded choice from the tightest opening-profit band with a free HQ seat. */
	function pickFairHq(seed, world, used, mask, count, trade, sourceSim) {
		const rows = careerOpenings(world, trade, mask, count, used, sourceSim);
		if (!Number.isFinite(rows.best)) return -1;
		for (let b = 0; b < OPENING_BANDS.length; b++) {
			const floor = rows.best > 0 ? rows.best * OPENING_BANDS[b] : rows.best;
			for (let shallowOnly = 1; shallowOnly >= 0; shallowOnly--) {
				for (let needLight = 1; needLight >= 0; needLight--) {
					const home = hashPickHq(seed, world, used, mask, rows, floor,
						shallowOnly === 1, needLight === 1);
					if (home >= 0) return home;
				}
			}
		}
		return -1;
	}

	/* The Capital is the Empire's: no company may call it home. */
	function hqForbidden(world, i) {
		return specialPlanets && i === world.capitalPlanet;
	}

	function hashPickHq(seed, world, used, mask, rows, floor, shallowOnly, needLight) {
		let total = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight)) total += 1;
		}
		if (total === 0) return -1;
		let pick = OrbitWorld.hashBits(seed, 0, SALT_HQ) % total;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight)) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	/* Exact score for a pinned HQ set: re-trace every seat in the final field,
	 * then ask for the best distinct-site assignment among the seats. */
	/*
	 * Trace one seat against one pinned field. Paths depend only on which planets
	 * are pinned as HQs, not on the whole home set, so a search can reuse a
	 * single-home trace for every set that contains that home — that is what
	 * makes an exhaustive pass over the candidate sets affordable at load time.
	 */
	const openingTraceCache = new Map();
	const OPENING_TRACE_CACHE_MAX = 512;

	function openingTracks(world, mask, forcedHomes, home, angles, speeds, strictExit) {
		const nAngles = angles || OPENING_ANGLES;
		const nSpeeds = speeds || OPENING_SPEEDS;
		const checkExit = strictExit !== false;
		let key = (world.seed >>> 0) + ':' +
			(openingTrade ? (openingTrade.seed >>> 0) + ':' + openingTrade.t.toFixed(3) : '-') + ':' +
			openingGravityScale + ':' + openingForceScale + ':' +
			openingMaskTag(mask, openingMarket && Number.isFinite(openingMarket.planetCount)
				? openingMarket.planetCount : openingExtent(mask)) + ':' +
			home + ':' + nAngles + 'x' + nSpeeds + ':' + (specialPlanets ? 1 : 0) + ':' +
			(checkExit ? 'exit:' : 'land:') + openingMaskTag(forcedHomes, OrbitWorld.PLANETS);
		const cached = openingTraceCache.get(key);
		if (cached) return cached;
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		const profile = openingTraceHome(world, mask, forcedHomes, home, checkExit,
			sitePay, null, exitOk, nAngles, nSpeeds);
		const track = {
			home: home,
			sitePay: sitePay,
			exitOk: exitOk,
			buildable: profile.buildable,
			openPay: profile.openPay
		};
		openingTraceCache.set(key, track);
		if (openingTraceCache.size > OPENING_TRACE_CACHE_MAX) {
			openingTraceCache.delete(openingTraceCache.keys().next().value);
		}
		return track;
	}

	/* Score a set from already-traced seats. Same numbers as openingGroupStats,
	 * without re-flying anything. */
	function openingStatsFromTracks(mask, count, forcedHomes, homes, tracks, rankOnly) {
		const siteList = [];
		for (let body = 0; body < OrbitWorld.PLANETS; body++) {
			if (!planetInMask(mask, body)) continue;
			if (forcedHomes && forcedHomes[body]) continue;
			siteList.push(body);
		}
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		const stats = {
			missing: 0,
			missingHomes: [],
			minPay: Infinity,
			maxPay: -Infinity,
			spread: Infinity,
			minSites: Infinity,
			minAnyPay: Infinity,
			maxAnyPay: -Infinity,
			anySpread: Infinity,
			sumPay: 0,
			distinct: false,
			assign: null,
			exitOk: false,
			peak: -Infinity,
			dim: 0
		};
		for (let i = 0; i < homes.length; i++) {
			const track = tracks[i];
			sitePay.set(track.sitePay.subarray(track.home * OrbitWorld.PLANETS,
				(track.home + 1) * OrbitWorld.PLANETS), track.home * OrbitWorld.PLANETS);
			exitOk.set(track.exitOk.subarray(track.home * OrbitWorld.PLANETS,
				(track.home + 1) * OrbitWorld.PLANETS), track.home * OrbitWorld.PLANETS);
			if (track.openPay < stats.minAnyPay) stats.minAnyPay = track.openPay;
			if (track.openPay > stats.maxAnyPay) stats.maxAnyPay = track.openPay;
			if (track.buildable <= 0) {
				stats.missing += 1;
				stats.missingHomes.push(homes[i]);
				continue;
			}
			const offset = track.home * OrbitWorld.PLANETS;
			let sites = 0;
			for (let k = 0; k < siteList.length; k++) {
				if (Number.isFinite(sitePay[offset + siteList[k]])) sites += 1;
			}
			if (sites < stats.minSites) stats.minSites = sites;
		}
		stats.anySpread = stats.maxAnyPay - stats.minAnyPay;
		if (stats.missing > 0) {
			stats.minPay = -Infinity;
			stats.spread = Infinity;
			stats.minSites = 0;
			return stats;
		}
		const rows = { sitePay: sitePay, exitOk: exitOk };
		if (rankOnly) {
			/* the coarse fan undersamples trajectories, so its absolute money is
			 * only a ranking signal; the band it sees is still the real one */
			const best = seatBestRatio(rows, homes, siteList, mask, exitOk) >= 0
				? seatBestRatio(rows, homes, siteList, mask, exitOk)
				: seatBestRatio(rows, homes, siteList, mask, null);
			const anySites = [];
			for (let i = 0; i < homes.length; i++) {
				let count = 0;
				for (let k = 0; k < siteList.length; k++) {
					if (Number.isFinite(sitePay[homes[i] * OrbitWorld.PLANETS + siteList[k]])) count += 1;
				}
				anySites.push(count);
			}
			stats.distinct = best >= 0;
			stats.exitOk = seatBestRatio(rows, homes, siteList, mask, exitOk) >= 0;
			stats.peak = best;
			stats.minSites = Math.min.apply(null, anySites);
			stats.assign = seatAssignment(rows, homes, siteList, mask, exitOk) ||
				seatAssignment(rows, homes, siteList, mask, null);
			if (stats.assign) {
				stats.minPay = stats.assign.min;
				stats.maxPay = stats.assign.max;
				stats.sumPay = stats.assign.sum;
				stats.spread = stats.assign.spread;
			}
			return stats;
		}
		let assignment = seatAssignment(rows, homes, siteList, mask, exitOk);
		if (assignment) stats.exitOk = true;
		else {
			assignment = seatAssignment(rows, homes, siteList, mask, null);
			stats.exitOk = assignment !== null && seatsCanExit(rows, homes, assignment);
		}
		stats.distinct = assignment !== null;
		stats.peak = seatPeakRatio(rows, homes, siteList, mask);
		if (assignment) {
			stats.assign = assignment;
			stats.minPay = assignment.min;
			stats.maxPay = assignment.max;
			stats.sumPay = assignment.sum;
			stats.spread = assignment.spread;
		} else {
			/* cramped world: same best-per-seat reading as openingGroupStats */
			for (let i = 0; i < homes.length; i++) {
				const offset = homes[i] * OrbitWorld.PLANETS;
				let bestPay = -Infinity;
				for (let k = 0; k < siteList.length; k++) {
					const pay = sitePay[offset + siteList[k]];
					if (pay > bestPay) bestPay = pay;
				}
				if (!Number.isFinite(bestPay)) {
					stats.missing += 1;
					stats.missingHomes.push(homes[i]);
					continue;
				}
				if (bestPay < stats.minPay) stats.minPay = bestPay;
				if (bestPay > stats.maxPay) stats.maxPay = bestPay;
				stats.sumPay += bestPay;
			}
			if (stats.missing > 0) {
				stats.minPay = -Infinity;
				stats.spread = Infinity;
			} else {
				stats.spread = stats.maxPay - stats.minPay;
			}
		}
		return stats;
	}

	function openingGroupStats(world, trade, mask, count, forcedHomes, homes, sourceSim) {
		openingPrepare(world, trade, mask, count, forcedHomes, sourceSim);
		const siteList = [];
		for (let body = 0; body < OrbitWorld.PLANETS; body++) {
			if (planetInMask(mask, body) && forcedHomes && forcedHomes[body]) continue;
			if (planetInMask(mask, body)) siteList.push(body);
		}
		const stats = {
			missing: 0,
			missingHomes: [],
			minPay: Infinity,
			maxPay: -Infinity,
			spread: Infinity,
			minSites: Infinity,
			minAnyPay: Infinity,
			maxAnyPay: -Infinity,
			anySpread: Infinity,
			sumPay: 0,
			distinct: false,
			assign: null,
			exitOk: false,
			peak: -Infinity,
			dim: 0
		};
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		for (let i = 0; i < homes.length; i++) {
			const profile = openingTraceHome(world, mask, forcedHomes, homes[i], true,
				sitePay, null, exitOk);
			if (profile.openPay < stats.minAnyPay) stats.minAnyPay = profile.openPay;
			if (profile.openPay > stats.maxAnyPay) stats.maxAnyPay = profile.openPay;
			if (profile.buildable <= 0) {
				stats.missing += 1;
				stats.missingHomes.push(homes[i]);
				continue;
			}
			const offset = homes[i] * OrbitWorld.PLANETS;
			let sites = 0;
			for (let k = 0; k < siteList.length; k++) {
				if (Number.isFinite(sitePay[offset + siteList[k]])) sites += 1;
			}
			if (sites < stats.minSites) stats.minSites = sites;
		}
		const rows = { sitePay: sitePay, exitOk: exitOk };
		if (stats.missing === 0) {
			/* first ask for a map whose every first landing can launch again */
			let assignment = seatAssignment(rows, homes, siteList, mask, exitOk);
			if (assignment) {
				stats.exitOk = true;
			} else {
				assignment = seatAssignment(rows, homes, siteList, mask, null);
				stats.exitOk = assignment !== null && seatsCanExit(rows, homes, assignment);
			}
			stats.distinct = assignment !== null;
			if (!assignment) {
				/* a world with fewer free sites than companies: keep the best
				 * per-seat opening so the map is still usable */
				for (let i = 0; i < homes.length; i++) {
					const offset = homes[i] * OrbitWorld.PLANETS;
					let bestPay = -Infinity;
					for (let k = 0; k < siteList.length; k++) {
						const pay = sitePay[offset + siteList[k]];
						if (pay > bestPay) bestPay = pay;
					}
					if (!Number.isFinite(bestPay)) {
						stats.missing += 1;
						stats.missingHomes.push(homes[i]);
						continue;
					}
					if (bestPay < stats.minPay) stats.minPay = bestPay;
					if (bestPay > stats.maxPay) stats.maxPay = bestPay;
					stats.sumPay += bestPay;
				}
				if (stats.missing === 0) stats.spread = stats.maxPay - stats.minPay;
			} else {
				stats.assign = assignment;
				stats.minPay = assignment.min;
				stats.maxPay = assignment.max;
				stats.sumPay = assignment.sum;
				stats.spread = assignment.spread;
			}
		}
		if (stats.missing > 0) {
			stats.minPay = -Infinity;
			stats.spread = Infinity;
			stats.minSites = 0;
		}
		stats.peak = seatPeakRatio(rows, homes, siteList, mask);
		stats.anySpread = stats.maxAnyPay - stats.minAnyPay;
		return stats;
	}

	/*
	 * Cheap group score over the once-traced opening table: each seat must reach
	 * a *different* buildable site, so this asks for the best such assignment
	 * rather than for each seat's private favourite. `assign` carries the sites
	 * so the exact re-trace can check that every chosen site can also be left.
	 */
	function openingGroupStatsFromRows(mask, rows, homes, occupied) {
		const stats = {
			missing: 0,
			missingHomes: [],
			minPay: Infinity,
			maxPay: -Infinity,
			spread: Infinity,
			minSites: 0,
			minAnyPay: Infinity,
			maxAnyPay: -Infinity,
			anySpread: Infinity,
			sumPay: 0,
			distinct: false,
			exitOk: false,
			peak: -Infinity,
			assign: null
		};
		const siteList = [];
		for (let body = 0; body < OrbitWorld.PLANETS; body++) {
			if (planetInMask(mask, body) && !occupied[body]) siteList.push(body);
		}
		for (let i = 0; i < homes.length; i++) {
			const offset = homes[i] * OrbitWorld.PLANETS;
			let anyPay = -Infinity;
			for (let k = 0; k < siteList.length; k++) {
				const openPay = rows.targetPay[offset + siteList[k]];
				if (openPay > anyPay) anyPay = openPay;
			}
			if (anyPay < stats.minAnyPay) stats.minAnyPay = anyPay;
			if (anyPay > stats.maxAnyPay) stats.maxAnyPay = anyPay;
		}
		const assignment = seatAssignment(rows, homes, siteList, mask);
		stats.distinct = assignment !== null;
		stats.peak = seatPeakRatio(rows, homes, siteList, mask);
		if (!assignment) {
			/* No set of distinct sites exists (a cramped world can have fewer
			 * free landing worlds than companies). Fall back to each seat's own
			 * best opening so the run still starts; `distinct` keeps any map
			 * that *can* seat everybody ahead of this one. */
			for (let i = 0; i < homes.length; i++) {
				const offset = homes[i] * OrbitWorld.PLANETS;
				let bestPay = -Infinity;
				for (let k = 0; k < siteList.length; k++) {
					const pay = rows.sitePay[offset + siteList[k]];
					if (pay > bestPay) bestPay = pay;
				}
				if (!Number.isFinite(bestPay)) {
					stats.missing += 1;
					stats.missingHomes.push(homes[i]);
					continue;
				}
				if (bestPay < stats.minPay) stats.minPay = bestPay;
				if (bestPay > stats.maxPay) stats.maxPay = bestPay;
				stats.sumPay += bestPay;
			}
			if (stats.missing === 0) stats.spread = stats.maxPay - stats.minPay;
			else {
				stats.minPay = -Infinity;
				stats.spread = Infinity;
			}
			stats.anySpread = stats.maxAnyPay - stats.minAnyPay;
			return stats;
		}
		stats.assign = assignment;
		stats.minPay = assignment.min;
		stats.maxPay = assignment.max;
		stats.sumPay = assignment.sum;
		stats.spread = assignment.spread;
		for (let i = 0; i < homes.length; i++) {
			const offset = homes[i] * OrbitWorld.PLANETS;
			let sites = 0;
			for (let k = 0; k < siteList.length; k++) {
				if (Number.isFinite(rows.sitePay[offset + siteList[k]])) sites += 1;
			}
			if (sites === 0) {
				stats.missing += 1;
				stats.missingHomes.push(homes[i]);
			} else if (stats.minSites === 0 || sites < stats.minSites) {
				stats.minSites = sites;
			}
		}
		if (stats.missing > 0) {
			stats.minPay = -Infinity;
			stats.spread = Infinity;
			stats.minSites = 0;
		}
		stats.anySpread = stats.maxAnyPay - stats.minAnyPay;
		return stats;
	}

	/* the weakest seat's share of the best seat's opening, 0 when unmapped */
	function openingRatio(stats) {
		if (!stats || stats.missing > 0 || !Number.isFinite(stats.minPay) ||
			!Number.isFinite(stats.maxPay) || stats.maxPay <= OPENING_COMPARE_EPS) return -Infinity;
		return stats.minPay / stats.maxPay;
	}

	/*
	 * Positive means a better set. The complaint the map has to answer is "one
	 * company starts much richer than another", so the ratio of the weakest
	 * opening to the best one leads: a map whose worst company earns half the
	 * best one is fairer than a map whose worst earns a fifth, even if that
	 * fifth is a larger number. Below a genuinely fair band the absolute worst
	 * return takes over — a map where everybody earns nothing, equally, is not
	 * a good start either.
	 *
	 * Distinct seating comes next rather than first. A cramped world can have
	 * fewer landing worlds than companies, and gating on "every seat distinct"
	 * made those maps lose to a merely equal-looking one; what actually hurts a
	 * player is the profit gap, and a shared best site shows up there.
	 */
	function compareOpeningGroups(a, b) {
		if (!b) return 1;
		if (a.missing !== b.missing) return b.missing - a.missing;
		/* one site per company first: a map where everybody can claim their own
		 * world is always a better start than one where they cannot, and the
		 * relaxed score of a map like that reads deceptively even (every seat
		 * finds the same great site, so its "gap" is zero) */
		if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
		/* a seat whose matched site cannot be left is a dead end, not a start */
		if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
		const aFair = openingRatio(a) >= OPENING_FAIR_RATIO;
		const bFair = openingRatio(b) >= OPENING_FAIR_RATIO;
		if (aFair !== bFair) return aFair ? 1 : -1;
		const aRatio = openingRatio(a);
		const bRatio = openingRatio(b);
		if (Math.abs(aRatio - bRatio) > OPENING_RATIO_EPS) return aRatio > bRatio ? 1 : -1;
		if (Number.isFinite(a.minPay) && Number.isFinite(b.minPay) &&
			Math.abs(a.minPay - b.minPay) > OPENING_COMPARE_EPS) {
			return a.minPay > b.minPay ? 1 : -1;
		}
		if (a.minSites !== b.minSites) return a.minSites > b.minSites ? 1 : -1;
		if (Math.abs(a.minAnyPay - b.minAnyPay) > OPENING_COMPARE_EPS) {
			return a.minAnyPay > b.minAnyPay ? 1 : -1;
		}
		if (Math.abs(a.anySpread - b.anySpread) > OPENING_COMPARE_EPS) {
			return a.anySpread < b.anySpread ? 1 : -1;
		}
		if (Math.abs(a.sumPay - b.sumPay) > OPENING_COMPARE_EPS) {
			return a.sumPay > b.sumPay ? 1 : -1;
		}
		/* a sunlit pad charges, so a map that needs fewer dim homes wins a tie */
		if (a.dim !== b.dim && Number.isFinite(a.dim) && Number.isFinite(b.dim)) {
			return a.dim < b.dim ? 1 : -1;
		}
		return 0;
	}

	/*
	 * Fairness is an assignment, not a per-seat maximum.
	 *
	 * Every company needs a *different* free planet to land on and build its
	 * first EMC — two companies cannot both claim the best site. Scoring each
	 * seat by its own best site therefore overstated a map that funnelled all
	 * three companies at one planet, which is exactly the start that looked
	 * fair on paper and was not in play. This solves the seat→site assignment
	 * properly: for a profit threshold it matches every seat to a distinct site
	 * paying at least that much (Kuhn), then binary-searches the highest
	 * threshold that still matches. `min` is the weakest seat's real return.
	 *
	 * Above a fair floor the *gap* is what a player feels, so the matched
	 * assignment then descends the strongest seat while the weakest holds: the
	 * result is the tightest band the map can actually offer, not merely the
	 * best worst case.
	 *
	 * `exitOk` (optional) refuses sites an EMC-1 could not leave, because a
	 * fair profit on a dead-end claim is still a lost start.
	 */
	const OPENING_BALANCE_ROUNDS = 8;

	function seatAssignment(rows, homes, siteList, mask, exitOk, fixedFloor) {
		const seats = homes.length;
		if (seats === 0) return null;
		const occupied = new Uint8Array(OrbitWorld.PLANETS);
		for (let i = 0; i < seats; i++) occupied[homes[i]] = 1;
		const sites = [];
		for (let i = 0; i < siteList.length; i++) {
			const site = siteList[i];
			if (!planetInMask(mask, site) || occupied[site]) continue;
			sites.push(site);
		}
		if (sites.length < seats) return null;
		const siteOfSeat = new Int16Array(seats).fill(-1);
		const seatOfSite = new Int32Array(OrbitWorld.PLANETS).fill(-1);
		const seen = new Uint8Array(OrbitWorld.PLANETS);
		let ceiling = Infinity;
		/* one augmenting path from `seat`; a site must pay within [floor, ceiling] */
		function augment(seat, floor) {
			const row = homes[seat] * OrbitWorld.PLANETS;
			for (let s = 0; s < sites.length; s++) {
				const site = sites[s];
				if (seen[site]) continue;
				const pay = rows.sitePay[row + site];
				/* unreachable pairs are -Infinity, which is not >= -Infinity */
				if (!Number.isFinite(pay) || pay < floor || pay > ceiling) continue;
				if (exitOk && exitOk[row + site] !== 1) continue;
				seen[site] = 1;
				const holder = seatOfSite[site];
				if (holder < 0 || augment(holder, floor)) {
					seatOfSite[site] = seat;
					siteOfSeat[seat] = site;
					return true;
				}
			}
			return false;
		}
		/* every seat matched, and the weakest return it can guarantee */
		function match(floor) {
			siteOfSeat.fill(-1);
			seatOfSite.fill(-1);
			for (let seat = 0; seat < seats; seat++) {
				seen.fill(0);
				if (!augment(seat, floor)) return null;
			}
			return siteOfSeat.slice();
		}
		function weakest(sitesOfSeat) {
			let low = Infinity;
			for (let seat = 0; seat < seats; seat++) {
				const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + sitesOfSeat[seat]];
				if (pay < low) low = pay;
			}
			return low;
		}
		const anyMatch = match(-Infinity);
		if (!anyMatch) return null;
		/* the highest floor every seat can still reach */
		const values = [];
		for (let seat = 0; seat < seats; seat++) {
			const row = homes[seat] * OrbitWorld.PLANETS;
			for (let s = 0; s < sites.length; s++) {
				if (exitOk && exitOk[row + sites[s]] !== 1) continue;
				const pay = rows.sitePay[row + sites[s]];
				if (Number.isFinite(pay)) values.push(pay);
			}
		}
		values.sort((left, right) => left - right);
		let low = 0;
		let high = values.length - 1;
		let best = anyMatch;
		let floor = weakest(anyMatch);
		while (low <= high) {
			const mid = (low + high) >> 1;
			const found = match(values[mid]);
			if (found) {
				best = found;
				floor = values[mid];
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		/* tighten the band: pull the best-paid seat down while the floor holds */
		for (let round = 0; !fixedFloor && round < OPENING_BALANCE_ROUNDS; round++) {
			let highSeat = -1;
			let highPay = -Infinity;
			for (let seat = 0; seat < seats; seat++) {
				const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + best[seat]];
				if (pay > highPay) {
					highPay = pay;
					highSeat = seat;
				}
			}
			if (highSeat < 0) break;
			ceiling = highPay - OPENING_COMPARE_EPS;
			if (ceiling < floor) break;
			const tighter = match(floor);
			if (!tighter) break;
			best = tighter;
		}
		ceiling = Infinity;
		let minPay = Infinity;
		let maxPay = -Infinity;
		let sumPay = 0;
		for (let seat = 0; seat < seats; seat++) {
			const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + best[seat]];
			if (pay < minPay) minPay = pay;
			if (pay > maxPay) maxPay = pay;
			sumPay += pay;
		}
		return {
			min: minPay,
			max: maxPay,
			sum: sumPay,
			spread: maxPay - minPay,
			sites: best
		};
	}

	/*
	 * The best weakest/best ratio this set can reach: walk a window down from
	 * the top and report the widest one that still seats every company on its
	 * own site. A correct search needs this exact number, not a proxy — the
	 * difference between a map at 42% and one at 98% is invisible to matching
	 * done at a fixed floor, but it is the whole complaint.
	 */
	function seatBestRatio(rows, homes, siteList, mask, exitOk) {
		/* the balance rounds exist to report tight numbers to the player; the
		 * search only needs the ratio, and skipping them keeps the per-set cost
		 * down enough to score every candidate set at map load */
		const assignment = seatAssignment(rows, homes, siteList, mask, exitOk, true);
		if (!assignment || !(assignment.max > OPENING_RATIO_FLOOR)) return -Infinity;
		return assignment.min / assignment.max;
	}

	/*
	 * The best weakest/best ratio any distinct assignment of this set could
	 * reach, ignoring the "fair floor first" heuristic. It is what tells an
	 * optimal map (every seat lands at nearly the same profit) apart from a
	 * merely acceptable one, and it is what the shortlist needs to keep.
	 */
	function seatPeakRatio(rows, homes, siteList, mask) {
		const assignment = seatAssignment(rows, homes, siteList, mask);
		return openingRatio({ minPay: assignment ? assignment.min : -Infinity,
			maxPay: assignment ? assignment.max : -Infinity, missing: assignment ? 0 : 1 });
	}

	/* Does every seat of `homes` have its own buildable site that an EMC-1 can
	 * leave? Fairness without a way off the new rail is a trap, not a start. */
	function seatsCanExit(rows, homes, assignment) {
		if (!assignment) return false;
		for (let seat = 0; seat < homes.length; seat++) {
			const site = assignment.sites[seat];
			if (site < 0) return false;
			const row = homes[seat] * OrbitWorld.PLANETS + site;
			if (!rows.exitOk[row]) return false;
		}
		return true;
	}

	/*
	 * Sunlit worlds make better homes (a pad that charges), so they are tried
	 * first — but as a *preference*, never a hard filter. Filtering to sunlit
	 * worlds alone used to leave too few seats to build a fair map: on a dim
	 * world the only planet able to give the third company its own opening can
	 * sit a hundredth under `hqMinLight`, and the strict pool silently lost it,
	 * which is how a map ended up with no valid seating at all. Callers walk
	 * the pools in order and keep the first that yields a usable map.
	 */
	function startCandidatePools(world, mask, wanted) {
		const all = [];
		const bright = new Uint8Array(OrbitWorld.PLANETS);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if ((mask && mask[i] === 0) || hqForbidden(world, i)) continue;
			all.push(i);
			if (world.planetLight[i] >= CAREER.hqMinLight) bright[i] = 1;
		}
		return [all, all.some((home) => bright[home]) ? bright : null];
	}

	/*
	 * Seat search for one candidate pool. A final three-HQ field has 220 sets
	 * in the ordinary 13-world career, and flying every fan in every set blocks
	 * map load for several seconds. Rank those sets first from pair-pinned
	 * fields: for each seat, the union of its two one-neighbour traces predicts
	 * the routes that either of the other HQs can bend into reach. This catches
	 * the important pin interaction that an unpinned table misses (including a
	 * rare fair set that otherwise ranks near the bottom), at one fifth of the
	 * full trace count. Exact final-field checks are still the authority.
	 *
	 * More than one ranking family is interleaved so equal or noisy proxy scores
	 * cannot hide a useful set. Exact checks run in deterministic batches until
	 * one set satisfies the actual fairness and starter-exit contract; if none
	 * does, the ordinary career exhausts all 220 sets and keeps the best one.
	 */
	const OPENING_FAMILY_DEPTH = 4;
	const OPENING_EXACT_BATCH = 16;
	const OPENING_PAIR_CANDIDATES_MAX = 14;
	/* A larger custom universe remains bounded; the default 12-home pool has
	 * only 220 triples and therefore still falls back to a complete search. */
	const OPENING_EXACT_SETS = 400;
	/*
	 * How far the walk goes when no set is accepted, in sets. A world whose
	 * fair opening exists finds it in the first batch: over seeds 1-120 the
	 * accept came at index 0-14 for 24 worlds and at 17, 18, 19, 27, 28 or 34
	 * for the rest, never past the third batch. What the walk still buys
	 * after that is not fairness — the fairness law can no longer be met —
	 * but a slightly better *unfair* plan for a world that has none, and it
	 * costs 204 exact sets (10 s of blocked main thread on the 13-world
	 * career: seeds 10, 61, 73, 98 boot in 12-13 s against 3 s). Three
	 * batches is the tail of the measured accept distribution with room to
	 * spare: past it the plan is the best set the ranking put in front of
	 * the walk, not the best of all 220. */
	const OPENING_EXACT_MISS = 48;
	const OPENING_ORDERS = [
		/* the map's own objective */
		(a, b) => compareOpeningGroups(a, b),
		/* "nobody is starving": the biggest weakest seat first */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Number.isFinite(a.minPay) && Number.isFinite(b.minPay) &&
				Math.abs(a.minPay - b.minPay) > OPENING_COMPARE_EPS) {
				return a.minPay > b.minPay ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		},
		/* "closest band": the best ratio a distinct seating could ever reach */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Number.isFinite(a.peak) && Number.isFinite(b.peak) &&
				Math.abs(a.peak - b.peak) > OPENING_RATIO_EPS) {
				return a.peak > b.peak ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		},
		/* "the map is rich": the highest combined opening */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Math.abs(a.sumPay - b.sumPay) > OPENING_COMPARE_EPS) {
				return a.sumPay > b.sumPay ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		}
	];

	function openingProposalSort(order) {
		return function (left, right) {
			const better = order(left.rank, right.rank);
			if (better !== 0) return -better;
			return left.tie - right.tie;
		};
	}

	/* Put four leaders from each reading first, then the map objective's full
	 * order. Object identity is enough here: every proposal is created once. */
	function diverseOpeningOrder(sets) {
		const families = [];
		for (let i = 0; i < OPENING_ORDERS.length; i++) {
			families.push(sets.slice().sort(openingProposalSort(OPENING_ORDERS[i])));
		}
		const ordered = [];
		const seen = new Set();
		for (let depth = 0; depth < OPENING_FAMILY_DEPTH; depth++) {
			for (let family = 0; family < families.length; family++) {
				const proposal = families[family][depth];
				if (proposal && !seen.has(proposal)) {
					seen.add(proposal);
					ordered.push(proposal);
				}
			}
		}
		for (let i = 0; i < families[0].length; i++) {
			const proposal = families[0][i];
			if (seen.has(proposal)) continue;
			seen.add(proposal);
			ordered.push(proposal);
		}
		return ordered;
	}

	/* Baseline rank for a large custom pool: one unpinned trace table. */
	function rankOpeningSetsCold(world, trade, mask, count, sets, sourceSim) {
		const rows = careerOpenings(world, trade, mask, count, null, sourceSim);
		for (let i = 0; i < sets.length; i++) {
			const proposal = sets[i];
			const occupied = new Uint8Array(OrbitWorld.PLANETS);
			for (let h = 0; h < proposal.homes.length; h++) occupied[proposal.homes[h]] = 1;
			proposal.rank = openingGroupStatsFromRows(mask, rows, proposal.homes, occupied);
			proposal.rank.dim = proposal.dim || 0;
		}
		return diverseOpeningOrder(sets);
	}

	/*
	 * Pair-pinned proxy for the ordinary career pool. A seat's final row is the
	 * union (best pay per site) of the rows made by pinning it with each other
	 * proposed HQ. It is deliberately optimistic: its job is to put plausible
	 * sets in front of the exact scorer, never to approve a map itself.
	 */
	function rankOpeningSetsByPairs(world, trade, mask, count, sets, candidates,
		sourceSim) {
		const planets = OrbitWorld.PLANETS;
		const pairTracks = new Array(planets * planets);
		const pairMask = new Uint8Array(planets);
		for (let a = 0; a < candidates.length; a++) {
			const homeA = candidates[a];
			for (let b = a + 1; b < candidates.length; b++) {
				const homeB = candidates[b];
				pairMask.fill(0);
				pairMask[homeA] = 1;
				pairMask[homeB] = 1;
				openingPrepare(world, trade, mask, count, pairMask, sourceSim);
				pairTracks[homeA * planets + homeB] = openingTracks(
					world, mask, pairMask, homeA, OPENING_ANGLES, OPENING_SPEEDS, false);
				pairTracks[homeB * planets + homeA] = openingTracks(
					world, mask, pairMask, homeB, OPENING_ANGLES, OPENING_SPEEDS, false);
			}
		}
		for (let i = 0; i < sets.length; i++) {
			const proposal = sets[i];
			const homes = proposal.homes;
			const occupied = new Uint8Array(planets);
			for (let h = 0; h < homes.length; h++) occupied[homes[h]] = 1;
			const sitePay = new Float64Array(planets * planets);
			sitePay.fill(-Infinity);
			for (let seat = 0; seat < homes.length; seat++) {
				const home = homes[seat];
				const row = home * planets;
				for (let body = 0; body < planets; body++) {
					let best = -Infinity;
					for (let other = 0; other < homes.length; other++) {
						if (other === seat) continue;
						const track = pairTracks[row + homes[other]];
						if (track && track.sitePay[row + body] > best) {
							best = track.sitePay[row + body];
						}
					}
					sitePay[row + body] = best;
				}
			}
			proposal.rank = openingGroupStatsFromRows(mask,
				{ sitePay: sitePay, targetPay: sitePay }, homes, occupied);
			proposal.rank.dim = proposal.dim || 0;
		}
		return diverseOpeningOrder(sets);
	}

	function rankOpeningSets(world, trade, mask, count, sets, candidates, seatsWanted,
		sourceSim) {
		if (seatsWanted > 1 && candidates.length <= OPENING_PAIR_CANDIDATES_MAX) {
			return rankOpeningSetsByPairs(world, trade, mask, count, sets, candidates, sourceSim);
		}
		return rankOpeningSetsCold(world, trade, mask, count, sets, sourceSim);
	}

	function openingGroupAccepted(stats) {
		return stats && stats.missing === 0 && stats.distinct && stats.exitOk &&
			openingRatio(stats) >= OPENING_FAIR_RATIO;
	}

	function planHomeSet(world, trade, mask, count, candidates, seatsWanted, sourceSim,
		sunlit, resume) {
		if (candidates.length < seatsWanted) return null;
		const forcedHomes = new Uint8Array(OrbitWorld.PLANETS);
		const chosen = [];
		const sets = [];
		function searchSets(from) {
			if (chosen.length === seatsWanted) {
				let tie = OrbitWorld.hashBits(world.seed, seatsWanted, SALT_HQ);
				let dim = 0;
				for (let i = 0; i < chosen.length; i++) {
					tie = OrbitWorld.hashBits(tie, chosen[i], SALT_HQ);
					if (sunlit && !sunlit[chosen[i]]) dim += 1;
				}
				sets.push({ homes: chosen.slice(), tie: tie, dim: dim });
				return;
			}
			const need = seatsWanted - chosen.length;
			for (let c = from; c <= candidates.length - need; c++) {
				chosen.push(candidates[c]);
				searchSets(c + 1);
				chosen.pop();
			}
		}
		searchSets(0);
		if (!sets.length) return null;

		/* Proxy order first, exact final-field authority second. Complete each
		 * batch before accepting it so all ranking families get an equal chance;
		 * a world with no fair set walks the head of the ranking, not all of it
		 * (see `OPENING_EXACT_MISS`).
		 *
		 * `resume` is the caller's own place in that walk. The page asks for the
		 * same map twice on one click (the scoreboard plans it, then the run
		 * rebuilds it); a second request resumes at the batch it stopped on instead
		 * of flying every pair trace again. The ranking is a pure function of the
		 * same inputs, so resuming lands on the same sets and the same answer. */
		const consider = sets.length <= OPENING_EXACT_BATCH
			? sets : rankOpeningSets(world, trade, mask, count, sets, candidates,
				seatsWanted, sourceSim);
		const exactLimit = Math.min(consider.length, OPENING_EXACT_SETS);
		const resumable = resume && resume.consider === consider;
		const from = resumable ? resume.exactAt : 0;
		let bestHomes = resumable ? resume.homes : null;
		let bestStats = resumable ? resume.stats : null;
		let bestTie = resumable ? resume.tie : 0xffffffff;
		for (let i = from; i < exactLimit; i++) {
			const proposal = consider[i];
			const proposalMask = new Uint8Array(OrbitWorld.PLANETS);
			for (let j = 0; j < proposal.homes.length; j++) proposalMask[proposal.homes[j]] = 1;
			const exact = openingGroupStats(world, trade, mask, count,
				proposalMask, proposal.homes, sourceSim);
			exact.dim = proposal.dim || 0;
			const better = compareOpeningGroups(exact, bestStats);
			if (better > 0 || (better === 0 && proposal.tie < bestTie)) {
				bestHomes = proposal.homes.slice();
				bestStats = exact;
				bestTie = proposal.tie;
			}
			const batchDone = (i + 1) % OPENING_EXACT_BATCH === 0 || i + 1 === exactLimit;
			/* an accepted batch ends the walk; a world that has not produced one
			 * by the miss bound keeps the best set found so far */
			if (batchDone && (openingGroupAccepted(bestStats) || i + 1 >= OPENING_EXACT_MISS)) break;
		}
		if (!bestHomes) return null;
		if (resume) {
			resume.consider = consider;
			/* an accepted batch ends the walk; the plan is complete as it stands */
			resume.exactAt = exactLimit;
			resume.homes = bestHomes;
			resume.stats = bestStats;
			resume.tie = bestTie;
		}
		const homes = bestHomes;
		for (let i = 0; i < homes.length; i++) forcedHomes[homes[i]] = 1;
		let exact = bestStats;
		/* Pinning the other HQs can move a route. Repair only a failed seat with
		 * a home that passes the exact final-field probe. */
		for (let repair = 0; exact.missing > 0 && repair < seatsWanted; repair++) {
			const badHome = exact.missingHomes[0];
			const seat = homes.indexOf(badHome);
			if (seat < 0) break;
			forcedHomes[badHome] = 0;
			const replacement = pickFairHq(world.seed + seat + repair, world,
				forcedHomes, mask, count, trade, sourceSim);
			if (replacement < 0 || replacement === badHome) {
				forcedHomes[badHome] = 1;
				break;
			}
			homes[seat] = replacement;
			forcedHomes[replacement] = 1;
			exact = openingGroupStats(world, trade, mask, count, forcedHomes, homes, sourceSim);
		}
		if (exact.missing > 0) return null;
		return { homes: homes, stats: exact };
	}

	/*
	 * Seat plans are a pure function of the world, the universe and the seat
	 * count, and the page asks for the same plan twice on one click: the
	 * scoreboard's player +/- plans the map once and then `startGame` rebuilds it
	 * from the same seed. Re-planning spent seconds of blocked main thread to
	 * arrive at the identical HQs, so the last few answers are kept. A new seed,
	 * universe, seat count or field scale misses and plans again.
	 */
	const SEAT_PLAN_CACHE_MAX = 4;
	const seatPlanCache = [];
	/* the search a repeat request resumes, dropped when a later one replaces it */
	let resumeMemory = null;

	function seatPlanKey(world, trade, mask, count, seatsWanted, sourceSim) {
		const field = PlanetGravity.armed();
		const fieldTag = field && field.seed === (world.seed >>> 0) ? field.tag : 0;
		return (world.seed >>> 0) + ':' + (trade.seed >>> 0) + ':' +
			openingMaskTag(mask, count) + ':' + seatsWanted + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			(specialPlanets ? 1 : 0) + (fieldTag ? ':' + fieldTag : '');
	}

	function seatPlanCached(key) {
		for (let i = 0; i < seatPlanCache.length; i++) {
			if (seatPlanCache[i].key === key) return seatPlanCache[i];
		}
		return null;
	}

	function seatPlanRemember(key, plan) {
		if (!plan) return null;
		seatPlanCache.push({ key: key, plan: plan });
		if (seatPlanCache.length > SEAT_PLAN_CACHE_MAX) seatPlanCache.shift();
		return plan;
	}

	/*
	 * A map every company can actually start: one seat each, one site each,
	 * comparable profit, and a way off every new rail. Sunlit homes are tried
	 * first and a dimmer map is only accepted when the sunlit pool cannot seat
	 * everybody fairly.
	 */
	function prepareCareerStarts(galaxy, world, trade, mask, count, wanted, sourceSim) {
		const seatsWanted = Math.max(0, Math.min(Math.floor(wanted), count || OrbitWorld.PLANETS));
		if (!galaxy || !world || !trade || seatsWanted <= 0) return null;
		const key = seatPlanKey(world, trade, mask, count, seatsWanted, sourceSim);
		const memo = seatPlanCached(key);
		if (memo) {
			seatPlanApply(galaxy, memo.plan);
			return memo.plan.homes.slice();
		}
		const resume = resumeMemory && resumeMemory.key === key ? resumeMemory : null;
		/* the boxes may accept the first plan a restarted search then rejects */
		if (resume && resume.plan && resume.plan.homes && resume.plan.stats) {
			seatPlanApply(galaxy, resume.plan);
			seatPlanRemember(key, resume.plan);
			resumeMemory = null;
			return resume.plan.homes.slice();
		}
		const slot = { key: key, seats: seatsWanted, plan: resume ? resume.plan : null };
		resumeMemory = slot;
		const plan = planCareerSeats(world, trade, mask, count, seatsWanted, sourceSim, slot);
		/* a failed search is kept too: asking again resumes at its tail */
		if (!plan) return null;
		resumeMemory = null;
		seatPlanRemember(key, plan);
		seatPlanApply(galaxy, plan);
		return plan.homes.slice();
	}

	/* the galaxy keeps the HQs, their shuffle and the pay target the plan chose */
	function seatPlanApply(galaxy, plan) {
		galaxy.mapSeats = plan.homes.slice();
		if (plan.targetPay > OPENING_COMPARE_EPS) galaxy.openingTargetPay = plan.targetPay;
	}

	/*
	 * A saved map carries a seat plan the search already accepted, so loading it
	 * must not fly the same fan again: this fills the cache under the key
	 * `prepareCareerStarts` would look up and seats the galaxy at once. The
	 * caller must hand in a plan proven on the same world, universe and field
	 * (a record keyed by seed, universe and scales), which is what
	 * `GravityMaps.applySeats` does.
	 */
	function rememberSeatPlan(galaxy, world, trade, mask, count, seatsWanted, sourceSim,
		homes, targetPay) {
		if (!galaxy || !world || !trade || !homes || homes.length < seatsWanted) return null;
		const plan = {
			homes: homes.slice(0, seatsWanted),
			targetPay: Number.isFinite(targetPay) ? targetPay : 0
		};
		seatPlanRemember(seatPlanKey(world, trade, mask, count, seatsWanted, sourceSim), plan);
		seatPlanApply(galaxy, plan);
		return plan.homes.slice();
	}

	function planCareerSeats(world, trade, mask, count, seatsWanted, sourceSim, resume) {
		const pools = startCandidatePools(world, mask, seatsWanted);
		/* a universe that cannot seat this many companies is a refusal, not a
		 * crash: seats are capped by the planet count, not by the pool */
		if (pools[0].length < seatsWanted) return null;
		const forcedHomes = new Uint8Array(OrbitWorld.PLANETS);
		let homes = null;
		let openingStats = null;
		if (seatsWanted <= 4 && count <= 26) {
			/* Every candidate home is searched together and the sunlit planets are
			 * only a tie-break. Filtering the search to sunlit homes used to throw
			 * away the fair map outright: on one world the sunlit pool's best
			 * exit-safe seating paid its weakest company 11% of its best, while the
			 * same world seated everybody at 84% once the dimmer planets were in. */
			const plan = planHomeSet(world, trade, mask, count, pools[0], seatsWanted,
				sourceSim, pools.length > 1 ? pools[1] : null, resume && resume.seats === seatsWanted
					? resume.plan : null);
			if (!plan) return null;
			homes = plan.homes;
			openingStats = plan.stats;
		} else {
			for (let pool = 0; pool < pools.length && !homes; pool++) {
				const attempt = [];
				for (let seat = 0; seat < seatsWanted; seat++) {
					const home = pickFairHq(world.seed + seat, world, forcedHomes, mask,
						count, trade, sourceSim);
					/* pickFairHq walks every in-play planet, so a home outside the
					 * pool is only accepted when it is the pool's own last resort */
					/* the dim pool is null when every in-play planet is sunlit */
					if (home < 0 || (pools[pool] && pools[pool].indexOf(home) < 0)) break;
					forcedHomes[home] = 1;
					attempt.push(home);
				}
				if (attempt.length === seatsWanted) homes = attempt;
				else for (let i = 0; i < attempt.length; i++) forcedHomes[attempt[i]] = 0;
			}
		}
		if (!homes) return null;
		for (let i = homes.length - 1; i > 0; i--) {
			const j = OrbitWorld.hashBits(world.seed, i, SALT_HQ + homes.length) % (i + 1);
			const home = homes[i];
			homes[i] = homes[j];
			homes[j] = home;
		}
		let targetPay = 0;
		if (openingStats && Number.isFinite(openingStats.minPay) &&
			Number.isFinite(openingStats.maxPay) && openingStats.minPay > 0) {
			/* geometric mean gives equal weight to being richer or poorer than the
			 * initial band when a later rival needs a newly enabled home */
			targetPay = Math.sqrt(openingStats.minPay * openingStats.maxPay);
		}
		return { homes: homes, targetPay: targetPay };
	}

	/*
	 * Pick the one inactive generated planet that should be enabled when a live
	 * career adds a rival. Extra planets already have deterministic, spaced
	 * geometry; do not move one (that would invalidate background trade routes).
	 * Instead, test each candidate as a G=1 HQ in the resulting field and require
	 * a free, non-heavy first landing whose starter EMC can leave again.
	 *
	 * The chosen return stays close to the initial seating's opening-pay target,
	 * then favours more safe sites, brighter charging and spatial clearance.
	 * This is intentionally a one-seat search: existing companies keep their
	 * live HQs and possessions while the new company gets a properly planned
	 * world rather than whichever inactive index Math.random happened to pick.
	 */
	function planCareerExpansion(galaxy, world, trade, mask, count, sourceSim) {
		if (!galaxy || !world || !trade || !mask || !sourceSim) return null;
		const planets = OrbitWorld.PLANETS;
		const homes = new Uint8Array(planets);
		for (let i = 0; i < galaxy.actors.length; i++) {
			const home = galaxy.actors[i].hq;
			if (home >= 0) homes[home] = 1;
		}
		const trialMask = new Uint8Array(mask);
		const sitePay = new Float64Array(planets * planets);
		const options = [];
		for (let candidate = 0; candidate < planets; candidate++) {
			if (trialMask[candidate] || hqForbidden(world, candidate)) continue;
			trialMask[candidate] = 1;
			homes[candidate] = 1;
			openingPrepare(world, trade, trialMask, count + 1, homes, sourceSim);
			sitePay.fill(-Infinity);
			openingTraceHome(world, trialMask, homes, candidate, true, sitePay, null, null);
			const row = candidate * planets;
			let safeSites = 0;
			let pay = -Infinity;
			let landing = -1;
			for (let body = 0; body < planets; body++) {
				if (!trialMask[body] || homes[body]) continue;
				const market = galaxy.market;
				if ((market && market.seized[body]) || claimOwner(galaxy, body) !== OWNER_COMMERCIAL) {
					continue;
				}
				const earned = sitePay[row + body];
				if (!Number.isFinite(earned)) continue;
				safeSites += 1;
				if (earned > pay) {
					pay = earned;
					landing = body;
				}
			}
			let clearance2 = Infinity;
			for (let body = 0; body < planets; body++) {
				if (!mask[body]) continue;
				const dx = world.planetX[candidate] - world.planetX[body];
				const dy = world.planetY[candidate] - world.planetY[body];
				const d2 = dx * dx + dy * dy;
				if (d2 < clearance2) clearance2 = d2;
			}
			if (safeSites > 0 && pay > OPENING_COMPARE_EPS) {
				options.push({
					planet: candidate,
					landing: landing,
					pay: pay,
					sites: safeSites,
					light: world.planetLight[candidate],
					clearance2: clearance2,
					tie: OrbitWorld.hashBits(galaxy.seed, candidate,
						SALT_HQ + galaxy.actors.length + 1)
				});
			}
			homes[candidate] = 0;
			trialMask[candidate] = 0;
		}
		if (!options.length) return null;
		let target = galaxy.openingTargetPay;
		if (!(target > OPENING_COMPARE_EPS)) {
			const pays = options.map(option => option.pay).sort((a, b) => a - b);
			target = pays[(pays.length - 1) >> 1];
		}
		for (let i = 0; i < options.length; i++) {
			const option = options[i];
			option.ratio = target > OPENING_COMPARE_EPS && option.pay > OPENING_COMPARE_EPS
				? Math.min(target, option.pay) / Math.max(target, option.pay) : 0;
		}
		options.sort((left, right) => {
			if (Math.abs(left.ratio - right.ratio) > OPENING_RATIO_EPS) {
				return right.ratio - left.ratio;
			}
			if (left.sites !== right.sites) return right.sites - left.sites;
			if (Math.abs(left.light - right.light) > 1e-9) return right.light - left.light;
			if (Math.abs(left.clearance2 - right.clearance2) > 1e-6) {
				return right.clearance2 - left.clearance2;
			}
			return left.tie - right.tie;
		});
		const selected = options[0];
		selected.targetPay = target;
		if (!(galaxy.openingTargetPay > OPENING_COMPARE_EPS)) {
			galaxy.openingTargetPay = selected.pay;
		}
		return selected;
	}

	/* HQ: take the map's planned seat; standalone careers choose from the same
	 * safe-profit table and only fall back when the world has no viable opening. */
	function pickHq(seed, world, used, mask, count, trade, sourceSim) {
		const fair = pickFairHq(seed, world, used, mask, count, trade, sourceSim);
		if (fair >= 0) return fair;
		for (let tier = 0; tier < 4; tier++) {
			const needLight = tier === 0 || tier === 2;
			const needShallow = tier < 2;
			let total = 0;
			for (let i = 0; i < OrbitWorld.PLANETS; i++) {
				if ((mask && mask[i] === 0) || (used && used[i]) || hqForbidden(world, i)) continue;
				if (needLight && world.planetLight[i] < CAREER.hqMinLight) continue;
				if (needShallow && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) continue;
				total += 1;
			}
			if (total === 0) continue;
			let pick = OrbitWorld.hashBits(seed, 0, SALT_HQ) % total;
			for (let i = 0; i < OrbitWorld.PLANETS; i++) {
				if ((mask && mask[i] === 0) || (used && used[i]) || hqForbidden(world, i)) continue;
				if (needLight && world.planetLight[i] < CAREER.hqMinLight) continue;
				if (needShallow && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) continue;
				if (pick === 0) return i;
				pick -= 1;
			}
		}
		return 0;
	}

	function planetInMask(mask, planet) {
		return !mask || mask[planet] !== 0;
	}

	/* HQs already taken by the players of `galaxy` */
	function hqMask(career) {
		const used = new Uint8Array(OrbitWorld.PLANETS);
		const actors = career.galaxy ? career.galaxy.actors : null;
		for (let i = 0; actors && i < actors.length; i++) {
			if (actors[i] !== career && actors[i].hq >= 0) used[actors[i].hq] = 1;
		}
		return used;
	}

	/* pad sunlight: orbit light above a floor so no world is dead, star brightness a mild modifier */
	function fillLight(career, world) {
		const lumNorm = OrbitWorld.clamp01(Math.sqrt(world.lum) / 1.5);
		const star = 0.5 + 0.5 * lumNorm;
		const mask = career.planetMask;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) {
				career.light[i] = 0;
				continue;
			}
			career.light[i] = (CAREER.lightFloor + (1 - CAREER.lightFloor) * world.planetLight[i]) * star;
		}
	}

	function fitPad(career, planet, catapult, panel, battery) {
		const pad = career.pads[planet];
		if (pad.catapult === null) career.padCount += 1;
		pad.catapult = catapult;
		pad.panel = panel;
		pad.battery = battery;
		pad.chargeKwh = battery.capacity;
	}

	/* Researchable parameter spaces in one table: `params` gives the axes in the
	 * order the science panel sliders use, `record` turns an invented point back
	 * into a ladder record. A new family is one entry here plus its slider axes
	 * in gravity_gui.js; the hull seeding, prototype lists and the accept gate
	 * all follow. The tier-0 empty slot of a part table is not a known tradeoff,
	 * so `seedScience` skips it (FT-0 would put the tank range at zero). */
	const SCIENCE_FAMILIES = [
		{
			kind: OrbitTech.KIND_ENGINE, table: OrbitTech.ENGINES,
			params: e => [e.thrust, e.mass], record: OrbitTech.engineRecord
		},
		{
			kind: OrbitTech.KIND_CATAPULT, table: OrbitTech.CATAPULTS,
			params: c => [c.maxForce, c.efficiency], record: OrbitTech.catapultRecord
		},
		{
			kind: OrbitTech.KIND_TANK, table: OrbitTech.TANKS,
			params: t => [t.fuelCap, t.emptyMass], record: OrbitTech.tankRecord
		},
		{
			kind: OrbitTech.KIND_BATTERY, table: OrbitTech.BATTERIES,
			params: b => [b.capacity, b.leak], record: OrbitTech.batteryRecord
		}
	];
	const SCIENCE_KINDS = SCIENCE_FAMILIES.map(f => f.kind);

	function scienceFamilyOf(kind) {
		for (let i = 0; i < SCIENCE_FAMILIES.length; i++) {
			if (SCIENCE_FAMILIES[i].kind === kind) return SCIENCE_FAMILIES[i];
		}
		return null;
	}

	/* one prototype list per family, so a new family needs no edit here */
	function newPrototypes() {
		const out = {};
		for (let i = 0; i < SCIENCE_KINDS.length; i++) out[SCIENCE_KINDS[i]] = [];
		return out;
	}

	/* tiers known out of the box per gear kind; anything above must be
	 * researched. Only the first two EMC rails ship with starter tech — the
	 * high-power tiers (EMC-3, 4, 5) sit beyond the initial hull. Panels and
	 * holds are not researchable families, so their whole ladder ships known. */
	const STARTING_RESEARCH_TIER = {
		catapult: 2,
		panel: 99,
		battery: 99,
		engine: 99,
		tank: 99
	};

	/* the tech tree itself is discovered science: its items seed the hull so the
	 * first custom inventions pay only the distance beyond known tradeoffs */
	function seedScience(career) {
		career.science = OrbitScience.createHull();
		career.knownGear = {};
		for (const kind in OrbitTech.TABLES) {
			const table = OrbitTech.TABLES[kind];
			const maxTier = STARTING_RESEARCH_TIER[kind] || 99;
			for (let j = 0; j < table.length; j++) {
				const item = table[j];
				if (item.tier > 0 && item.tier <= maxTier) career.knownGear[item.id] = true;
			}
		}
		for (let i = 0; i < SCIENCE_FAMILIES.length; i++) {
			const spec = SCIENCE_FAMILIES[i];
			for (let j = 0; j < spec.table.length; j++) {
				const item = spec.table[j];
				if (item.tier > 0 && career.knownGear[item.id])
					OrbitScience.acceptHull(career.science, spec.kind, spec.params(item), item.id);
			}
		}
	}

	function researchPreview(career, family, params) {
		return OrbitScience.previewHull(career.science, family, params);
	}

	/* purse price of a preview after the active cheat (communism researches free) */
	function researchCost(career, family, params) {
		const p = OrbitScience.previewHull(career.science, family, params);
		if (!Number.isFinite(p.cost)) return Infinity;
		return price(career, p.cost);
	}

	/* one counter for the whole career, so a label names one record in every family */
	function researchLabel(career) {
		return 'R' + (career.research + 1);
	}

	/* research unlocks its point as a record on the family's ladder (owned, like
	 * a part); a prototype at or above a stock rung proves that rung, so the
	 * stock tier joins the shop beside the invention */
	function unlockPrototype(career, family, params, id) {
		const spec = scienceFamilyOf(family);
		if (!spec) return;
		const record = spec.record(id, params[0], params[1]);
		career.prototypes[family].push(record);
		career.owned[id] = true;
		for (let i = 0; i < spec.table.length; i++) {
			const item = spec.table[i];
			if (item.tier > 0 && item.tier <= record.tier) career.knownGear[item.id] = true;
		}
	}

	function prototypesOf(career, family) {
		return career.prototypes[family];
	}

	function prototypeById(career, family, id) {
		const list = career.prototypes[family];
		for (let i = 0; list && i < list.length; i++) {
			if (list[i].id === id) return list[i];
		}
		return null;
	}

	/* invent a parameter point: the purse pays the hull-distance fee and the
	 * point expands the career's knowledge hull regardless of ship position */
	function researchPoint(career, family, params, label) {
		if (career.ended !== CAREER_OPEN) return false;
		if (SCIENCE_KINDS.indexOf(family) < 0) return false;
		const p = OrbitScience.previewHull(career.science, family, params);
		if (!Number.isFinite(p.cost)) return false;
		const cost = price(career, p.cost);
		if (!canPay(career, cost)) return false;
		career.ledger.purse -= cost;
		career.sciSpent += cost;
		OrbitScience.acceptHull(career.science, family, params, label);
		career.research += 1;
		career.lastResearch = cost;
		unlockPrototype(career, family, params, label);
		return true;
	}

	/* the career's money, where it came from and where it went:
	 * income − running = profit; property and science are where profit went.
	 * purse = starter purse + profit − property − science.
	 * fills the caller-owned row without allocating */
	function careerStats(out, career) {
		out.income = career.visitIncome + career.earned + career.bribeIncome + career.taxEarned;
		out.running = career.feesPaid + career.fuelSpent + career.maintenanceSpent +
			career.evacuationSpent;
		out.profit = out.income - out.running;
		out.property = career.buildSpent;
		out.science = career.sciSpent;
		out.flown = career.flownPx;
	}

	/* map-wide numbers: rot is the corruption visits clear, standing the
	 * visit value lying unharvested on the in-play planets this step */
	function mapStats(out, market, step) {
		var rot = 0;
		var standing = 0;
		for (var p = 0; p < OrbitWorld.PLANETS; p++) {
			if (market.planetMask && market.planetMask[p] !== 1) continue;
			rot += market.corruption[p];
			var pay = planetProfit(market, p, step);
			if (pay > 0) standing += pay;
		}
		out.rot = rot;
		out.standing = standing;
	}

	/* thin a stats block in place when it fills: keep every second sample,
	 * halve the count and double the interval, so the whole run stays on
	 * the plot at one sample per STATS_SEC … 16 s */
	function thinStats(stats) {
		var n = stats.series.length;
		for (var s = 0; s < n; s++) {
			var arr = stats.series[s];
			var w = 0;
			for (var r = 0; r < stats.count; r += 2) arr[w++] = arr[r];
		}
		stats.count = stats.count / 2;
		stats.every *= 2;
	}

	/* sampler scratch: the getters fill a caller-owned row, so one sample
	 * step costs no allocation even with the full 17-company roster */
	const sampleMapOut = { rot: 0, standing: 0 };
	const sampleCareerOut = { income: 0, running: 0, profit: 0, property: 0, science: 0, flown: 0 };

	/* write one stats sample at `step`: rot/standing for the map and
	 * profit/property/science/flown for every company in the galaxy.
	 * returns at once on any step that is not a sample step */
	function sampleStats(galaxy, market, step) {
		if (!galaxy) return;
		var stats = galaxy.stats;
		if (!stats) return;
		if (step < stats.nextStep) return;
		if (stats.count >= STATS_SAMPLES) thinStats(stats);
		var count = stats.count;
		mapStats(sampleMapOut, market, step);
		stats.series[0][count] = sampleMapOut.rot;
		stats.series[1][count] = sampleMapOut.standing;
		for (var i = 0; i < galaxy.actors.length; i++) {
			careerStats(sampleCareerOut, galaxy.actors[i]);
			var base = 2 + i * 4;
			stats.series[base][count] = sampleCareerOut.profit;
			stats.series[base + 1][count] = sampleCareerOut.property;
			stats.series[base + 2][count] = sampleCareerOut.science;
			stats.series[base + 3][count] = sampleCareerOut.flown;
		}
		stats.count = count + 1;
		stats.nextStep = step + stats.every;
	}

	function resetCareer(career, seed, trade, cheat, homePlanet, sim) {
		const grant = OrbitTech.starterGrant();
		career.seed = seed >>> 0;
		career.cheat = cheat || null;
		resetLedger(career.ledger, cheat === CHEAT_ENDGAME ? CAREER.endgamePurse : grant.purse);
		career.ledger.fee = 0;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			pad.catapult = null;
			pad.panel = null;
			pad.battery = null;
			pad.chargeKwh = 0;
			pad.reservedKwh = 0;
		}
		career.padCount = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) career.launchPads[i] = COMMERCIAL_PAD;
		fillLight(career, trade.world);
		career.hq = homePlanet === undefined ? pickHq(career.seed, trade.world, hqMask(career),
			career.planetMask, career.planetCount, trade, sim) : homePlanet;
		career.at = career.hq;
		returnLandingVisits.delete(career);
		career.flying = false;
		career.stranded = false;
		career.fragileLost = false;
		career.commercialPlanet = -1;
		career.commercialPads = null;
		career.capitalPlanet = specialPlanets ? trade.world.capitalPlanet : -1;
		career.arfPlanet = specialPlanets ? trade.world.arfPlanet : -1;
		resetLaunchBook(career.launchBook);
		career.ship.hold = grant.ship.hold;
		career.ship.engine = grant.ship.engine;
		career.ship.tank = grant.ship.tank;
		career.ship.obs = grant.ship.obs;
		career.ship.cargoTons = 0;
		career.ship.fuelKg = career.cheat === CHEAT_ENDGAME ? career.ship.tank.fuelCap : 0;
		career.ship.condition = 1;
		career.wearScale = 1;
		career.repairs = 0;
		career.maintenanceSpent = 0;
		career.owned = {};
		career.prototypes = newPrototypes();
		seedScience(career);
		career.research = 0;
		career.lastResearch = 0;
		/* the starter fit is owned from the start, so every refit is reversible */
		ownPart(career, career.ship.hold);
		ownPart(career, career.ship.tank);
		ownPart(career, OrbitTech.OBS[0]);
		ownPart(career, career.ship.obs);
		fitPad(career, career.hq, grant.pad.catapult, grant.pad.panel, grant.pad.battery);
		if (career.cheat === CHEAT_ENDGAME) fitEndgame(career);
		refitShip(career);
		for (let i = 0; i < BOARD_SIZE; i++) clearTask(career.tasks[i]);
		career.contract = -1;
		/* Optional planner state in full saves (absent means no cooldown/intent). */
		career.acceptAfterStep = 0;
		career.plannedLanding = -1;
		career.serial = 0;
		career.flights = 0;
		career.burns = 0;
		career.evacuations = 0;
		career.evacuationSpent = 0;
		career.delivered = 0;
		career.competitions = 0;
		career.earned = 0;
		career.taxPaid = 0;
		career.taxEarned = 0;
		career.lastEnergy = 0;
		career.lastFee = 0;
		career.lastReward = 0;
		career.lastFuel = 0;
		career.fuelBoughtKg = 0;
		career.fuelProducedKg = 0;
		career.fuelSpent = 0;
		career.forceScale = 1;
		career.ended = CAREER_OPEN;
		career.recoverySteps = -1;
		career.arrested = false;
		career.arrestUntilStep = 0;
		career.evacuating = false;
		career.evacUntilStep = 0;
		career.evacStartStep = 0;
		career.evacFromX = career.evacFromY = 0;
		career.evacToX = career.evacToY = 0;
		career.evacDurationSteps = 0;
		career.evacLastPaid = 0;
		career.evacLastSteps = 0;
		career.evacFrom = -1;
		career.arrests = 0;
		career.bribes = 0;
		career.bribeIncome = 0;
		career.patientsDelivered = 0;
		career.medicTrips = 0;
		career.visitIncome = 0;
		career.flownPx = 0;
		career.feesPaid = 0;
		career.buildSpent = 0;
		career.sciSpent = 0;
		refreshBoard(career, trade, 0);
	}

	function topTier(table) {
		return table[table.length - 1];
	}

	function ownPart(career, item) {
		if (item !== null) career.owned[item.id] = true;
	}

	/* endgame cheat: every pad at top tier, every ship part owned and the ship fully fitted */
	function fitEndgame(career) {
		for (let i = 0; i < career.pads.length; i++) {
			if (career.planetMask && career.planetMask[i] === 0) continue;
			if (i === career.capitalPlanet) continue;
			if (rebelRail(career, i)) continue;
			fitPad(career, i, topTier(OrbitTech.CATAPULTS), topTier(OrbitTech.PANELS),
				topTier(OrbitTech.BATTERIES));
		}
		for (let k = 0; k < OrbitTech.PART_KINDS.length; k++) {
			const table = OrbitTech.TABLES[OrbitTech.PART_KINDS[k]];
			for (let i = 0; i < table.length; i++) ownPart(career, table[i]);
		}
		career.ship.hold = topTier(OrbitTech.HOLDS);
		career.ship.engine = topTier(OrbitTech.ENGINES);
		career.ship.tank = topTier(OrbitTech.TANKS);
	}

	function clearEvacuation(career, sim) {
		career.evacuating = false;
		career.evacUntilStep = 0;
		career.evacDurationSteps = 0;
		career.evacStartStep = 0;
		career.evacFromX = career.evacFromY = career.evacToX = career.evacToY = 0;
		career.evacFrom = -1;
		if (sim && sim.evacuationTrip === career) sim.evacuationTrip = null;
	}

	/* places the idle vessel on a planet and syncs the sim's landed base */
	function placeShip(career, sim, planet) {
		clearEvacuation(career, sim);
		returnLandingVisits.delete(career);
		career.at = planet;
		career.plannedLanding = -1;
		career.flying = false;
		setCommercial(career, -1);
		career.stranded = career.pads[planet].catapult === null;
		sim.relocate(planet);
	}

	/* a career begins with the vessel on HQ and the sim gating on the network;
	 * every career in one run joins the same galaxy, so pads are shared ground */
	function startCareer(career, sim, seed, trade, cheat, galaxy, homePlanet) {
		career.galaxy = galaxy || null;
		career.market = galaxy && galaxy.market ? galaxy.market : null;
		let plannedHome = homePlanet;
		if (plannedHome === undefined && galaxy && galaxy.mapSeats &&
			galaxy.actors.length < galaxy.mapSeats.length) {
			plannedHome = galaxy.mapSeats[galaxy.actors.length];
		}
		resetCareer(career, seed, trade, cheat, plannedHome, sim);
		career.forceScale = sim.forceScale;
		if (galaxy) joinGalaxy(career, galaxy);
		else syncCareerNetwork(career);
		sim.attachCareer(career);
		placeShip(career, sim, career.hq);
	}

	/* the Capital's fixed imperial rail counts as covered, so "a catapult on
	 * every active planet" stays winnable even though nobody can build there */
	function capitalCovered(career) {
		return career.capitalPlanet >= 0 && planetInPlay(career, career.capitalPlanet) ? 1 : 0;
	}

	/* a seized planet is covered by the rebel rail for good: nobody may build
	 * there, so the completion count must not ask for a catapult on it */
	function coveredPlanets(career) {
		let covered = capitalCovered(career);
		const market = career.market;
		if (!market) return covered;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (market.seized[p] && planetInPlay(career, p)) covered += 1;
		}
		return covered;
	}

	const ENDGAME_WARNING_STEPS = Math.round(120 / GravitySim.DT);
	const ENDGAME_LIMIT_STEPS = Math.round(600 / GravitySim.DT);

	function checkEnded(career) {
		if (career.ended !== CAREER_OPEN) return career.ended;
		if (career.evacuating || career.flying) {
			career.recoverySteps = -1;
			return CAREER_OPEN;
		}
		const purse = career.ledger.purse;
		if (purse < -1e-9 || (!careerShipUsable(career) && purse + 1e-9 < repairCost(career))) {
			if (career.recoverySteps < 0) {
				career.recoverySteps = 0;
				career.recoveryEpisode++;
			}
			return CAREER_OPEN;
		}
		career.recoverySteps = -1;
		if (career.cheat === null && career.padCount >= career.planetCount - coveredPlanets(career)) {
			career.ended = CAREER_COMPLETE;
		}
		return career.ended;
	}

	function liquidateCareer(career) {
		career.ended = CAREER_BROKE;
		const pads = career.galaxy ? career.galaxy.commercialPads :
			(career.commercialPads = Array(OrbitWorld.PLANETS).fill(null));
		for (let p = 0; p < career.pads.length; p++) {
			const pad = career.pads[p];
			if (!pad.catapult) continue;
			const rail = pads[p];
			if (!rail || pad.catapult.tier > rail.catapult.tier ||
				(pad.catapult.tier === rail.catapult.tier && pad.battery.capacity > rail.battery.capacity)) {
				pads[p] = { catapult: pad.catapult, panel: pad.panel, battery: pad.battery,
					chargeKwh: pad.battery.capacity, reservedKwh: 0, commercial: true };
			}
			clearPad(career, p);
		}
		syncCareerNetwork(career);
	}

	/* --- politics: rot, bribes, arrest, rebellion (0.5.12) ---------------- */

	/*
	 * The career clock every political rate is priced in: game seconds. `advancePolitics`
	 * runs once per step from GravityBot.stepCareer, so the GUI and the
	 * benches share one clock. It raises rot on every world nobody visited
	 * lately, copies the rot into the trade colonies, retires finished
	 * arrests, and rolls one rebellion per planet per epoch — never per step.
	 */
	function raiseCorruption(market, planet, amount) {
		const before = market.corruption[planet];
		const after = OrbitEcon.clampCorruption(before + amount);
		market.corruption[planet] = after;
		if (market.permanentCorruption) {
			market.corruptionFloor[planet] = Math.min(after,
				market.corruptionFloor[planet] + (after - before) * 0.1);
		}
	}

	function advancePolitics(market, trade, runStep) {
		const galaxy = market.galaxy;
		if (!politics || !galaxy || runStep === market.politicsStep) return 0;
		const previousStep = Math.max(0, market.politicsStep);
		market.politicsStep = runStep;
		const seconds = politicsSeconds(market, runStep);
		const dtSec = seconds - market.politicsSec;
		market.politicsSec = seconds;
		if (trade && trade.setCorruption && trade.corruption !== market.corruption) {
			trade.setCorruption(market.corruption);
		}
		const epoch = Math.floor(seconds / OrbitEcon.REBEL_CHECK_SECONDS);
		let seized = 0;
		const count = market.planetCount || OrbitWorld.PLANETS;
		for (let p = 0; p < count; p++) {
			if (market.planetMask && market.planetMask[p] !== 1) continue;
			if (p === market.capitalPlanet || p === market.arfPlanet) continue;
			let occupied = false;
			let reporting = false;
			for (let i = 0; i < galaxy.actors.length; i++) {
				const actor = galaxy.actors[i];
				if (actor.at !== p || actor.flying || actor.arrested) continue;
				occupied = true;
				if (visitReports(actor.ledger, market, p)) reporting = true;
			}
			/* a ship sitting on the world ages both clocks: its report grows
			 * stale at half speed and the neglect clock catches up with it */
			if (dtSec > 0 && occupied) {
				const aged = (runStep - previousStep) * 0.5;
				market.lastVisitStep[p] += aged;
				market.reportStep[p] += aged;
				market.reportPrev[p] += aged;
			}
			if (!market.rebel[p] && dtSec > 0 && reporting) {
				market.corruption[p] = Math.max(market.corruptionFloor[p],
					market.corruption[p] - OrbitEcon.CORRUPTION_REPORT_RATE * dtSec);
			} else if (!market.rebel[p] && dtSec > 0) {
				const rate = OrbitEcon.passiveCorruptionRate(
					planetProfitAt(market, p, runStep, market.reportStep[p]));
				if (rate > 0) raiseCorruption(market, p, rate * dtSec);
			}
			if (market.rebel[p] || runStep < market.rebelCooldownStep[p]) continue;
			if (epoch <= market.lastCheckEpoch[p]) continue;
			/* a clean planet saves its epoch roll for when rot crosses the line */
			if (market.corruption[p] <= OrbitEcon.REBEL_START) continue;
			market.lastCheckEpoch[p] = epoch;
			if (!rebellionRoll(market, p, epoch, market.corruption[p])) continue;
			seizePlanet(market, galaxy, p, runStep);
			seized += 1;
		}
		retireArrests(galaxy, runStep);
		return seized;
	}

	/* one deterministic roll per planet per epoch: no wall time, no Math.random */
	function rebellionRoll(market, planet, epoch, corruption) {
		const chance = OrbitEcon.rebellionChance(corruption);
		if (chance <= 0) return false;
		const key = OrbitWorld.hashBits(market.politicsSeed, planet, SALT_POLITICS);
		const roll = OrbitWorld.hashBits(key, epoch, SALT_ARREST) / 4294967296;
		return roll < chance;
	}

	/* the arrested career waits for its slow transport, then is free again */
	function retireArrests(galaxy, runStep) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			if (!career.arrested || runStep < career.arrestUntilStep) continue;
			career.arrested = false;
			career.arrestUntilStep = 0;
		}
	}

	/*
	 * Seizure: every player rail on the planet becomes one commercial rail the
	 * rebels run, with the best tiers that stood there. The former owners lose
	 * the pad (and the claim), the planet can never be built on again, and a
	 * rebellion plants the patients the medical quest has to ferry out.
	 */
	function seizePlanet(market, galaxy, planet, runStep) {
		market.rebel[planet] = 1;
		market.seized[planet] = 1;
		market.rebelSinceStep[planet] = runStep;
		market.patients[planet] = OrbitEcon.MEDIC_PATIENTS;
		market.rebelCooldownStep[planet] = 0;
		market.rebelPads[planet] = seizedPad(galaxy, planet);
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			clearPad(career, planet);
		}
		refreshNetwork(galaxy);
		for (let i = 0; i < galaxy.actors.length; i++) {
			refreshMedicSlot(galaxy.actors[i], market, runStep);
		}
		return market.rebelPads[planet];
	}

	/* the seized rail: the strongest former player pad, else the commercial one */
	function seizedPad(galaxy, planet) {
		let catapult = COMMERCIAL_PAD.catapult;
		let panel = COMMERCIAL_PAD.panel;
		let battery = COMMERCIAL_PAD.battery;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= catapult.tier) continue;
			catapult = pad.catapult;
			panel = pad.panel;
			battery = pad.battery;
		}
		/* rebels keep their rail charged, so a seized planet is never a trap */
		return { catapult: catapult, panel: panel, battery: battery,
			chargeKwh: battery.capacity, reservedKwh: 0 };
	}

	function clearPad(career, planet) {
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return;
		career.padCount = career.padCount > 0 ? career.padCount - 1 : 0;
		pad.catapult = null;
		pad.panel = null;
		pad.battery = null;
		pad.chargeKwh = 0;
		pad.reservedKwh = 0;
		if (career.at === planet) {
			career.stranded = padLift(career, planet) + 1e-9 < GravitySim.SPEED_MIN;
		}
	}

	/* a medical mission ends for some other reason: unload and drop it */
	function clearMedicalCargo(career) {
		if (career.contract < 0) return false;
		const task = career.tasks[career.contract];
		if (task.kind !== TASK_MEDIC) return false;
		dropContract(career);
		return true;
	}

	/*
	 * The bribe (0.5.12, repriced 0.5.13): the local rulers pay for the visit's
	 * silence — twice the visit value (what the landing collected plus what
	 * regrew while the ship sits). Corruption governs the arrest risk rather
	 * than reducing the offer on lightly corrupted worlds. The purse
	 * and the bribe stats grow, and the rot grows with the money. One bribe per
	 * visit, and a rot-rich planet may arrest the briber and ship them to the
	 * Capital instead of paying.
	 *
	 * A bribe buys the silence of a report, so it takes that report back: the
	 * rot clock returns to the step standing before the landing (0.7.16). A
	 * bribed world therefore rots exactly like the same world left alone —
	 * plus the bribe's own increment — never like the world the ship reported
	 * to and calmed.
	 */
	const BRIBE = { ok: false, amount: 0, corruption: 0, arrested: false, reason: '' };

	/* A separate marker keeps the window closed while the value clock moves. */
	function bribeWindowOpen(market, planet) {
		return market.bribeVisitStep[planet] === BRIBE_OPEN;
	}

	function bribeRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet || career.flying) return 'not landed there';
		if (planet === market.capitalPlanet) return 'the Empire does not deal';
		if (planet === market.arfPlanet) return 'A.R.F. takes no bribes';
		if (market.rebel[planet]) return 'rebels hold the planet';
		if (!bribeWindowOpen(market, planet)) return 'already bribed this visit';
		return '';
	}

	/*
	 * The visit value is what the landing collected plus what regrew while the
	 * ship sits. The bribe is twice that value; corruption still rises and can
	 * trigger an arrest, regardless of how the offer is priced.
	 */
	function bribeAmount(market, planet, runStep) {
		const grown = planetProfit(market, planet, runStep);
		const collected = market.visitPay[planet] > 0 ? market.visitPay[planet] : 0;
		return OrbitEcon.bribeValue(collected + grown);
	}

	function acceptBribe(career, market, sim, planet, runStep) {
		BRIBE.ok = false;
		BRIBE.arrested = false;
		BRIBE.amount = 0;
		BRIBE.corruption = market ? market.corruption[planet] : 0;
		BRIBE.reason = bribeRefusal(career, market, planet);
		if (BRIBE.reason !== '') return BRIBE;
		const amount = bribeAmount(market, planet, runStep);
		if (!(amount > 0)) {
			BRIBE.reason = 'the rulers owe nothing yet';
			return BRIBE;
		}
		BRIBE.ok = true;
		BRIBE.amount = amount;
		career.ledger.purse += amount;
		career.bribes += 1;
		career.bribeIncome += amount;
		checkEnded(career);
		refreshCareerMedic(career);
		if (!visitReports(career.ledger, market, planet)) {
			/* an unreported value is cashed by the bribe, once: it regrows from here */
			market.lastVisitStep[planet] = runStep;
			market.stamp += 1;
		}
		/* the rulers bought this visit's silence: the Capital never hears the
		 * report, so the world keeps rotting from where it stood before the
		 * landing. An unreported visit stamped no report, so this is a no-op
		 * there — the bribe then stands on the rot clock as the last report. */
		market.reportStep[planet] = market.reportPrev[planet];
		market.bribeVisitStep[planet] = runStep;
		raiseCorruption(market, planet, OrbitEcon.bribeCorruption(amount));
		BRIBE.corruption = market.corruption[planet];
		market.politicsSerial += 1;
		const roll = OrbitWorld.hashBits(market.politicsSeed, market.politicsSerial, SALT_ARREST) /
			4294967296;
		if (roll >= OrbitEcon.arrestChance(BRIBE.corruption)) return BRIBE;
		arrestCareer(career, market, sim, runStep);
		BRIBE.arrested = true;
		return BRIBE;
	}

	/*
	 * Go quiet (0.6.1): the ship's observation device is taken off while it
	 * stands on a rotten planet. The planet stops reporting for every company
	 * until its rot is quelled; the device goes to the owned shelf and refits
	 * anywhere, but refitting it does not un-silence the planet.
	 */
	function quietRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet || career.flying) return 'not landed there';
		if (planet === market.capitalPlanet || planet === market.arfPlanet) return 'nothing to silence here';
		if (market.rebel[planet]) return 'rebels hold the planet';
		if (market.quiet[planet]) return 'already quiet';
		if (!career.ship.obs.fitted) return 'no observation device fitted';
		if (market.corruption[planet] <= QUIET_MIN) {
			return 'the rulers only dare above ' + QUIET_MIN + '% corruption';
		}
		return '';
	}

	function goQuiet(career, market, planet) {
		if (quietRefusal(career, market, planet) !== '') return false;
		market.quiet[planet] = 1;
		market.stamp += 1;
		career.ship.obs = OrbitTech.OBS[0];
		refitShip(career);
		return true;
	}

	/* the Capital's slow transport: no fee, no reward, no medics, no planning.
	 * ARREST_SECONDS is game seconds like every political span */
	function arrestCareer(career, market, sim, runStep) {
		const capital = career.capitalPlanet;
		if (capital < 0) return false;
		career.arrestUntilStep = runStep +
			Math.round(OrbitEcon.ARREST_SECONDS / GravitySim.DT);
		career.arrested = true;
		career.arrests += 1;
		clearMedicalCargo(career);
		setCommercial(career, -1);
		placeShip(career, sim, capital);
		career.stranded = false;
		return true;
	}

	/* quelled: no more 4x visits and no more patients, but the rail stays
	 * commercial and the planet stays unbuildable for good */
	function pacifyPlanet(market, planet, runStep) {
		market.rebel[planet] = 0;
		market.patients[planet] = 0;
		market.rebelSinceStep[planet] = 0;
		/* a quelled world may not fall again for two epochs, as it always did */
		market.rebelCooldownStep[planet] = runStep +
			Math.round(OrbitEcon.REBEL_CHECK_SECONDS * 2 / GravitySim.DT);
		market.corruptionFloor[planet] = OrbitEcon.CORRUPTION_TRADITION;
		market.corruption[planet] = market.corruption[planet] > OrbitEcon.PACIFY_CORRUPTION_MAX
			? OrbitEcon.PACIFY_CORRUPTION_MAX : market.corruption[planet];
		/* a quelled world reports again: the quiet state is burnt down with the rot */
		market.quiet[planet] = 0;
		if (market.galaxy && market.galaxy.actors) {
			for (let i = 0; i < market.galaxy.actors.length; i++) {
				refreshMedicSlot(market.galaxy.actors[i], market, runStep);
			}
		}
	}

	/* --- building ------------------------------------------------------ */

	/* stock (table) gear is only buildable when it is known: EMC tiers 1-2
	 * start known, panels/batteries/engines/tanks all do, but higher EMCs
	 * (3/4/5) must be unlocked via science — a researched prototype at or
	 * above their rung proves the rung and the stock tier joins the shop;
	 * the invention itself carries its own build cost either way. The
	 * communism cheat unlocks every tier. */
	function gearKnown(career, item) {
		if (!item) return false;
		if (career.cheat === CHEAT_COMMUNISM) return true;
		if (career.owned[item.id]) return true;
		if (career.knownGear && career.knownGear[item.id]) return true;
		return false;
	}

	/* planet ownership: a planet can hold at most one player-owned EMC (plus
	 * the neutral commercial EMC-1 and the evacuate option). Building your
	 * own EMC on a planet that already carries another player's rail is
	 * forbidden — claim the planet by landing on an unclaimed one first. */
	/* a rebel planet: seized ground that never becomes buildable again */
	function planetSeized(career, planet) {
		const market = career.market;
		return market !== null && market.seized[planet] === 1;
	}

	function planetBuildable(career, planet) {
		if (planet === career.capitalPlanet) return false;
		/* a seized planet is the rebels' ground, quelled or not */
		if (rebelRail(career, planet)) return false;
		if (!career.galaxy) return true;
		const owner = claimOwner(career.galaxy, planet);
		return owner === OWNER_COMMERCIAL || owner === career.index;
	}

	/* a battery is storage, not energy: a bought one keeps the charge already in
	 * the pad, clamped to its new capacity. Only a fresh pad (fitPad) starts
	 * charged, because there is no earlier charge to keep. */
	function chargeAfterBattery(pad, battery) {
		pad.chargeKwh = Math.min(pad.chargeKwh, battery.capacity);
	}

	/* a first catapult brings a starter panel and battery (charged) with it;
	 * a panel or battery needs a pad to sit on */
	function buildGear(career, planet, kind, item) {
		if (career.ended !== CAREER_OPEN) return false;
		if (planet === career.capitalPlanet) return false;
		if (rebelRail(career, planet)) return false;
		const pad = career.pads[planet];
		const fresh = kind === OrbitTech.KIND_CATAPULT && pad.catapult === null;
		if (fresh && !planetBuildable(career, planet)) return false;
		if (!fresh && !OrbitTech.upgrades(pad, kind, item)) return false;
		if (!gearKnown(career, item)) return false;
		if (!canPay(career, item.buildCost)) return false;
		career.ledger.purse -= price(career, item.buildCost);
		career.buildSpent += price(career, item.buildCost);
		if (fresh) {
			fitPad(career, planet, item, OrbitTech.PANELS[0], OrbitTech.BATTERIES[0]);
		} else {
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) chargeAfterBattery(pad, item);
		}
		if (planet === career.at) {
			/* a fresh rail rescues stranding only when it can actually lift
			 * the ship; a pad too weak for the current load leaves the
			 * vessel stranded until an upgrade or evacuation */
			career.stranded = !(OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
				pad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN);
		}
		/* a fresh own rail replaces a commercial choice made for the same planet */
		if (fresh && career.commercialPlanet === planet) career.commercialPlanet = -1;
		syncCareerNetwork(career);
		checkEnded(career);
		refreshCareerMedic(career);
		return true;
	}

	function bulkUpgradeCost(career, kind, item) {
		return price(career, OrbitTech.bulkUpgradeCost(career.pads, kind, item));
	}

	/* applies `item` to every already-built facility of `kind` at once */
	function bulkUpgrade(career, kind, item) {
		if (!gearKnown(career, item)) return false;
		const cost = bulkUpgradeCost(career, kind, item);
		if (career.ledger.purse + 1e-9 < cost) return false;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (!OrbitTech.upgrades(pad, kind, item)) continue;
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) chargeAfterBattery(pad, item);
		}
		career.ledger.purse -= cost;
		career.buildSpent += cost;
		syncCareerNetwork(career);
		refreshCareerMedic(career);
		return true;
	}

	/*
	 * A ship part is refitted wherever the vessel stands: any planet is a yard,
	 * so the player never has to find HQ to fit an engine. A bought part stays
	 * owned, so swapping back to a lighter owned tier is free; only the engine
	 * has a `null` = none step. The reason the shop prints comes from
	 * partRefusal, never from a second copy of these gates.
	 */
	function partRefusal(career, kind, item) {
		if (!career || career.at < 0) return 'land on a planet to refit';
		if (career.ship[kind] === item) return 'already fitted';
		if (item === null) {
			return kind === OrbitTech.KIND_ENGINE ? '' : 'a ' + kind + ' slot cannot be empty';
		}
		if (kind === OrbitTech.KIND_HOLD && item.capacity < career.ship.cargoTons) {
			return 'drop the ' + career.ship.cargoTons + ' t cargo first';
		}
		if (!career.owned[item.id] && !canPay(career, item.buildCost)) return 'purse too small';
		return '';
	}

	function installPart(career, kind, item) {
		if (partRefusal(career, kind, item) !== '') return false;
		if (item !== null && !career.owned[item.id]) {
			career.ledger.purse -= price(career, item.buildCost);
			career.buildSpent += price(career, item.buildCost);
			ownPart(career, item);
		}
		career.ship[kind] = item;
		career.ship.fuelKg = Math.min(career.ship.fuelKg, career.ship.tank.fuelCap);
		refitShip(career);
		refreshCareerMedic(career);
		return true;
	}

	/* --- contracts ----------------------------------------------------- */

	function planetDistance(trade, a, b) {
		const dx = trade.planetX[a] - trade.planetX[b];
		const dy = trade.planetY[a] - trade.planetY[b];
		return Math.sqrt(dx * dx + dy * dy);
	}

	function round2(value) {
		return Math.round(value * 100) / 100;
	}

	/* a uniform in-play planet other than `exclude` (the tourist's free endpoint) */
	function otherActivePlanet(career, exclude) {
		const count = career.planetCount || OrbitWorld.PLANETS;
		const span = count - (planetInPlay(career, exclude) ? 1 : 0);
		if (span < 1) return -1;
		let pick = Math.floor(draw01(career, SALT_TASK) * span);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!planetInPlay(career, i) || i === exclude) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	/*
	 * Tourist delivery (0.5.11): a TASK_DELIVERY of MIGRANTS flagged tourist.
	 * One deterministic draw picks the special endpoint role, each offered at
	 * TOURIST_WEIGHT (2x an ordinary endpoint): to the A.R.F. world, to the
	 * Capital resort, or from the Capital resort. The other endpoint is a
	 * uniform in-play planet. Reward stays positive and capped like freight.
	 */
	function makeTouristDelivery(career, trade, step, task) {
		const capital = career.capitalPlanet;
		const arf = career.arfPlanet;
		const role = Math.floor(draw01(career, SALT_TASK) * 3);
		let from;
		let to;
		if (role === 0) {
			to = arf;
			from = otherActivePlanet(career, arf);
		} else if (role === 1) {
			to = capital;
			from = otherActivePlanet(career, capital);
		} else {
			from = capital;
			to = otherActivePlanet(career, capital);
		}
		if (from < 0 || to < 0 || from === to) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		const dist = Math.min(planetDistance(trade, from, to), CAREER.deliveryDistPx);
		/* tourists are not market goods: a mid scarcity keeps the pay between
		 * the freight floor and ceiling */
		const pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * 1.5 *
			(1 + dist / CAREER.deliveryDistPx);
		/* the deep-origin bonus rides every delivery kind: the rule is the
		 * load and the well, not the good */
		task.deep = deepOrigin(career, from, tons);
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = true;
		task.tons = tons;
		task.from = from;
		task.to = to;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax) * (task.deep ? 1 + DEEP_BONUS : 1));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/* deep-origin delivery (0.6.2): a load of DEEP_TONS or more out of a well
	 * at DEEP_G or deeper — the job an EMC-3 is built for */
	function deepOrigin(career, planet, tons) {
		return tons >= DEEP_TONS && planetGravity(career.seed, planet) >= DEEP_G;
	}

	/* the note on a deep-origin row, naming the rail that lifts it; one helper
	 * so the board, the aim line and the bot price and print the same offer */
	function deepText(task) {
		return task.deep ? 'needs EMC-3+ at P' + task.from : '';
	}

	/* delivery: a colony with a real export to the colony short of that good
	 * (else the lowest supply); pays by tons, scarcity and distance, capped
	 * below the evacuation fee */
	function makeDelivery(career, trade, step, task) {
		/* the tourist branch is gated off entirely for the SPECIAL=0 A/B, so the
		 * ordinary delivery stream is then bit-identical to the historical one */
		if (specialPlanets && career.capitalPlanet >= 0 &&
			draw01(career, SALT_TASK) < TOURIST_CHANCE &&
			makeTouristDelivery(career, trade, step, task)) return true;
		const colonies = trade.colonies;
		const count = colonies.length;
		if (count < 2) return false;
		const first = Math.floor(draw01(career, SALT_TASK) * count);
		let src = null;
		let good = -1;
		for (let k = 0; k < count && good < 0; k++) {
			const colony = colonies[(first + k) % count];
			if (!colonyInPlay(career, colony)) continue;
			src = colony;
			good = OrbitEcon.bestExport(colony);
		}
		if (good < 0 || !src) return false;
		let dst = null;
		let bestShort = 0;
		let lowSupply = 2;
		for (let k = 0; k < count; k++) {
			const colony = colonies[k];
			if (!colonyInPlay(career, colony)) continue;
			if (colony === src) continue;
			const short = OrbitEcon.goodShortfall(colony, good);
			const supply = OrbitEcon.marketSupply(colony, good);
			const better = bestShort > 0 ? short > bestShort : short > 0 || supply < lowSupply;
			if (!better) continue;
			dst = colony;
			bestShort = short;
			lowSupply = supply;
		}
		if (!dst) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		/* fragile load (0.6.3): only from a light planet, only a small load; the
		 * draw is spent only where the offer is possible, so every other board
		 * keeps its stream */
		const light = planetGravity(career.seed, src.planet) <= FRAGILE_G;
		task.fragile = light && tons <= FRAGILE_TONS &&
			draw01(career, SALT_TASK) < FRAGILE_CHANCE;
		/* deep-origin (0.6.2): a heavy load out of a deep well is the one job
		 * an EMC-3 is built for; no draw — it is a property of the load roll
		 * and the origin's gravity */
		task.deep = deepOrigin(career, src.planet, tons);
		const scarcity = 1 - OrbitEcon.marketSupply(dst, good);
		const dist = Math.min(planetDistance(trade, src.planet, dst.planet), CAREER.deliveryDistPx);
		let pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * (1 + scarcity) *
			(1 + dist / CAREER.deliveryDistPx);
		if (task.fragile) pay *= FRAGILE_PAY;
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = good;
		task.tourist = false;
		task.tons = tons;
		task.from = src.planet;
		task.to = dst.planet;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax) * (task.deep ? 1 + DEEP_BONUS : 1));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/* competition: one flight launched from `planet` that lands after at least `minLength` px */
	function makeCompete(career, step, task) {
		task.kind = TASK_COMPETE;
		task.state = TASK_OFFERED;
		task.planet = activePlanetDraw(career);
		task.deep = false;
		task.minLength = Math.round((CAREER.competeMinPx + draw01(career, SALT_TASK) * CAREER.competeSpanPx) / 50) * 50;
		task.reward = round2(CAREER.competeBase + draw01(career, SALT_TASK) * CAREER.competeSpan);
		task.from = -1;
		task.to = -1;
		task.good = 0;
		task.tons = 0;
		task.tourist = false;
		task.deadline = step + Math.round(CAREER.competeSec / GravitySim.DT);
	}

	/*
	 * The medical quest (0.5.12, repriced 0.5.23): a rebellious planet's
	 * patients have to reach the Capital. Half the hold rides out as medics,
	 * the same number rides back as patients, and the planet is quelled once
	 * its last patient lands. An offer stands on the board only while the
	 * landed company has a hold and can afford the mission's rail fees.
	 */
	function medicAffordable(career, planet, medics) {
		if (!career || career.ended !== CAREER_OPEN || career.capitalPlanet < 0 ||
			career.at < 0 || planet < 0 || medics < 1) return false;
		const loadedMass = OrbitTech.shipMass(career.ship, medics);
		const rebelPad = commercialPadAt(career, planet);
		if (!rebelPad || !rebelPad.catapult || !rebelPad.battery) return false;
		if (OrbitTech.speedLimit(rebelPad.battery.capacity, loadedMass,
			rebelPad.catapult, career.forceScale) + 1e-9 < GravitySim.SPEED_MIN) return false;
		const repairNeed = careerShipUsable(career) ? 0 : repairCost(career);
		const rebelFee = commercialFee(career, planet, GravitySim.SPEED_MIN, loadedMass);
		if (career.at === career.capitalPlanet) {
			return career.ledger.purse + CAPITAL_REFUND - repairNeed + 1e-9 >= rebelFee;
		}
		const emptyMass = OrbitTech.shipMass(career.ship, 0);
		const ownPad = career.pads[career.at];
		const ownLifts = ownPad && ownPad.catapult &&
			OrbitTech.speedLimit(ownPad.battery.capacity, emptyMass,
				ownPad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN;
		let depart = 0;
		if (!ownLifts) {
			const commRail = commercialPadAt(career, career.at);
			const commOk = commRail && OrbitTech.speedLimit(commRail.battery.capacity,
				emptyMass, commRail.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN;
			depart = commOk ? commercialFee(career, career.at, GravitySim.SPEED_MIN, emptyMass) : Infinity;
			const owner = padOwner(career, career.at, false);
			if (owner >= 0 && owner !== career.index) {
				const hostPad = padAt(career, career.at, false);
				if (hostPad && OrbitTech.speedLimit(hostPad.battery.capacity, emptyMass,
					hostPad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN) {
					const tax = price(career, CAREER.taxPerKwh *
						OrbitTech.launchEnergy(emptyMass, hostPad.catapult, GravitySim.SPEED_MIN) *
						hostPad.catapult.tier);
					if (tax < depart) depart = tax;
				}
			}
			if (!Number.isFinite(depart)) return false;
		}
		return career.ledger.purse - depart - repairNeed + 1e-9 >= Math.max(CAPITAL_REFUND, rebelFee);
	}

	function medicPlanet(career, market) {
		let best = -1;
		let most = 0;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (!market.rebel[p] || !market.patients[p]) continue;
			if (!planetInPlay(career, p)) continue;
			const medics = medicLoad(career, market.patients[p]);
			if (!medicAffordable(career, p, medics)) continue;
			if (market.patients[p] <= most) continue;
			best = p;
			most = market.patients[p];
		}
		return best;
	}

	function makeMedic(career, market, step, task) {
		if (career.arrested) return false;
		const planet = medicPlanet(career, market);
		if (planet < 0 || career.capitalPlanet < 0) return false;
		const medics = medicLoad(career, market.patients[planet]);
		if (medics < 1) return false;
		task.kind = TASK_MEDIC;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = false;
		task.tons = 0;
		task.from = career.capitalPlanet;
		task.to = planet;
		task.planet = planet;
		task.patients = market.patients[planet];
		task.medics = medics;
		task.aboard = 0;
		task.minLength = 0;
		task.reward = round2(task.patients * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		task.deep = false;
		task.capitalRefund = 0;
		/* two trips with the standard hold, one with a big one */
		task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
		return true;
	}

	/* PRNG-free refresh of MEDIC_SLOT while landed; never runs in flight */
	function refreshMedicSlot(career, market, step) {
		if (!career || career.flying || !market || !market.galaxy) return;
		const medic = career.tasks[MEDIC_SLOT];
		if (medic.kind === TASK_MEDIC) {
			if (career.contract === MEDIC_SLOT) {
				if (medic.aboard === 0 && !market.patients[medic.to]) dropContract(career);
				return;
			}
			const patients = market.rebel[medic.to] ? market.patients[medic.to] : 0;
			const medics = medicLoad(career, patients);
			if (!patients || !medicAffordable(career, medic.to, medics)) {
				clearTask(medic);
			} else {
				medic.patients = patients;
				medic.medics = medics;
				medic.reward = round2(patients * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
			}
		}
		if (medic.kind === TASK_NONE) makeMedic(career, market, step, medic);
	}

	function refreshCareerMedic(career) {
		if (career && !career.flying && career.market) {
			refreshMedicSlot(career, career.market, Math.max(0, career.market.politicsStep));
		}
	}

	/* half the hold rides as medics: no new ship stat, no full-hold dead end */
	function medicLoad(career, patients) {
		const half = Math.floor(career.ship.hold.capacity / 2);
		return Math.min(half, patients);
	}

	function loadMedics(career, task, patients) {
		task.medics = medicLoad(career, patients);
		task.aboard = 0;
		career.ship.cargoTons = task.medics;
		refitShip(career);
		return task.medics;
	}

	function grantCapitalRefund(career, task) {
		if (career.capitalPlanet < 0 || career.at !== career.capitalPlanet) return 0;
		task.capitalRefund = CAPITAL_REFUND;
		career.ledger.purse += CAPITAL_REFUND;
		career.earned += CAPITAL_REFUND;
		checkEnded(career);
		return CAPITAL_REFUND;
	}

	function clawbackTaskRefund(career, task) {
		const refund = task.capitalRefund;
		if (!(refund > 0)) return 0;
		task.capitalRefund = 0;
		career.ledger.purse -= refund;
		career.earned -= refund;
		checkEnded(career);
		return refund;
	}

	function finishContract(career) {
		if (career.contract < 0) return;
		const task = career.tasks[career.contract];
		task.capitalRefund = 0;
		clearTask(task);
		career.contract = -1;
		career.ship.cargoTons = 0;
		refitShip(career);
		refreshCareerMedic(career);
	}

	function dropTask(career, index) {
		if (index < 0 || index >= BOARD_SIZE) return false;
		const task = career.tasks[index];
		if (task.kind === TASK_NONE) return false;
		if (index === COMPETE_SLOT) {
			if (task.state !== TASK_ACCEPTED) return false;
			clawbackTaskRefund(career, task);
			clearTask(task);
			return true;
		}
		if (career.contract !== index) return false;
		clawbackTaskRefund(career, task);
		clearTask(task);
		career.contract = -1;
		career.ship.cargoTons = 0;
		refitShip(career);
		return true;
	}

	function dropContract(career) {
		if (career.contract < 0) return false;
		return dropTask(career, career.contract);
	}

	/* drops expired offers (and an expired contract with its cargo), refills the board */
	function refreshBoard(career, trade, step) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE || step <= task.deadline) continue;
			if (i === career.contract) dropContract(career);
			else {
				clawbackTaskRefund(career, task);
				clearTask(task);
			}
		}
		for (let i = 0; i < CAREER.deliverySlots; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE) makeDelivery(career, trade, step, task);
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_NONE && draw01(career, SALT_TASK) * CAREER.competeEvery < 1) {
			makeCompete(career, step, compete);
		}
		refreshMedicSlot(career, career.market, step);
	}

	function canAccept(career, index) {
		if (!career || career.ended !== CAREER_OPEN || career.flying ||
			career.evacuating || career.arrested) return false;
		if (index < 0 || index >= BOARD_SIZE) return false;
		const task = career.tasks[index];
		if (task.state !== TASK_OFFERED) return false;
		if (task.kind === TASK_COMPETE) return career.at >= 0;
		if (career.contract >= 0) return false;
		if (task.kind === TASK_MEDIC) {
			return career.capitalPlanet >= 0 && career.at === career.capitalPlanet &&
				task.medics > 0 && task.patients > 0 &&
				medicAffordable(career, task.to, task.medics);
		}
		return task.kind === TASK_DELIVERY && career.ship.hold.capacity >= task.tons;
	}

	/*
	 * Where the open work wants the ship next, nearest leg first: the taken
	 * contract's next stop (or the Capital to take a standing medical mission),
	 * then the competition planet. Bots route to the first entry, scans aim at
	 * all of them, and neither knows or cares which contract kind it is. One
	 * scratch list — read it before calling again.
	 */
	const goalBodies = [];
	function careerGoalBodies(career) {
		goalBodies.length = 0;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.kind === TASK_MEDIC) goalBodies.push(task.aboard > 0 ? career.capitalPlanet : task.to);
			else goalBodies.push(task.state === TASK_LOADED ? task.to : task.from);
		} else if (career.tasks[MEDIC_SLOT].kind === TASK_MEDIC && career.capitalPlanet >= 0) {
			goalBodies.push(career.capitalPlanet);
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_COMPETE) goalBodies.push(compete.planet);
		return goalBodies;
	}

	function loadCargo(career, task) {
		task.state = TASK_LOADED;
		career.ship.cargoTons = task.tons;
		refitShip(career);
	}

	/* one contract at a time; cargo loads at once when the ship already sits at
	 * the origin, and any work accepted at the Capital refunds its entry fee */
	function acceptTask(career, index) {
		if (!canAccept(career, index)) return false;
		const task = career.tasks[index];
		if (task.kind === TASK_COMPETE) {
			task.state = TASK_ACCEPTED;
			grantCapitalRefund(career, task);
			refreshCareerMedic(career);
			return true;
		}
		career.contract = index;
		if (task.kind === TASK_MEDIC) {
			/* taken at the Capital, so the medics board at once with a full window */
			const nowStep = career.market ? Math.max(0, career.market.politicsStep) : 0;
			const span = Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
			if (nowStep + span > task.deadline) task.deadline = nowStep + span;
			task.state = TASK_LOADED;
			loadMedics(career, task, task.patients);
			grantCapitalRefund(career, task);
			return true;
		}
		task.state = TASK_ACCEPTED;
		if (career.at === task.from) loadCargo(career, task);
		grantCapitalRefund(career, task);
		refreshCareerMedic(career);
		return true;
	}

	function pay(career, amount) {
		career.ledger.purse += amount;
		career.earned += amount;
		career.lastReward += amount;
	}

	/*
	 * One factor table for a landing: `cash` is what the purse takes at once,
	 * `credit` what a leg that only advances a contract is worth, `leg` which
	 * leg it is. The aim readout, the launch list, the helper scans and the
	 * rival bots all price a shot through this, so the same landing can never
	 * be worth one thing to the aim line and another to the bot.
	 * `out` is caller scratch, so nothing is allocated per candidate.
	 * `speed` is the launch speed of a shot still on the pad (a fragile load
	 * is priced by it); a flight already under way passes none.
	 */
	function careerLandingFacts(out, career, origin, body, flownLen, length, steps, runStep, visitPay, speed) {
		out.cash = visitPay;
		out.credit = 0;
		out.leg = LEG_NONE;
		/* a contract that runs out before the landing pays nothing: the board
		 * drops it before the ship arrives */
		if (career.contract >= 0 && runStep + steps <= career.tasks[career.contract].deadline) {
			const task = career.tasks[career.contract];
			if (task.kind === TASK_MEDIC) {
				/* patients pay at the Capital, medics only have to reach the rebellion */
				if (task.aboard > 0 && body === career.capitalPlanet) {
					out.cash += task.aboard * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
					out.leg = LEG_PATIENTS;
				} else if (task.aboard === 0 && body === task.to) {
					out.credit += task.reward * LEG_CREDIT;
					out.leg = LEG_MEDICS;
				}
			} else if (task.state === TASK_LOADED && body === task.to) {
				/* a shot that breaks the fragile load delivers nothing: the aim
				 * line prices the void before the click */
				if (!fragileBreaks(task, speed)) {
					out.cash += task.reward;
					out.leg = LEG_DELIVER;
				}
			} else if (task.state === TASK_ACCEPTED && body === task.from) {
				out.credit += task.reward * LEG_CREDIT;
				out.leg = LEG_LOAD;
			}
		} else if (career.contract < 0 && origin !== career.capitalPlanet &&
			body === career.capitalPlanet) {
			const medic = career.tasks[MEDIC_SLOT];
			if (medic.kind === TASK_MEDIC && medic.medics > 0 &&
				runStep + steps <= medic.deadline &&
				medicAffordable(career, medic.to, medic.medics)) {
				const tripPay = medic.medics * OrbitEcon.MEDIC_REWARD_PER_PATIENT;
				out.credit += (CAPITAL_REFUND + tripPay) * LEG_CREDIT;
				out.leg = LEG_MEDICS;
			}
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_COMPETE && origin === compete.planet &&
			(flownLen || 0) + length >= compete.minLength && runStep + steps <= compete.deadline) {
			out.cash += compete.reward;
			if (compete.state === TASK_OFFERED && origin === career.capitalPlanet) {
				out.credit += CAPITAL_REFUND * LEG_CREDIT;
			}
			if (out.leg === LEG_NONE) out.leg = LEG_COMPETE;
		}
		return out;
	}

	/* landing on `planet`: cargo pickup, delivery payout, competition payout */
	function settleLanding(career, sim, planet, step) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind !== TASK_COMPETE || sim.origin !== task.planet) continue;
			if (sim.flightLength < task.minLength || step > task.deadline) continue;
			pay(career, task.reward);
			career.competitions += 1;
			task.capitalRefund = 0;
			clearTask(task);
		}
		if (career.contract < 0) return;
		const task = career.tasks[career.contract];
		if (task.kind === TASK_MEDIC) return settleMedic(career, task, planet, step);
		if (task.state === TASK_ACCEPTED && planet === task.from) loadCargo(career, task);
		else if (task.state === TASK_LOADED && planet === task.to) {
			pay(career, task.reward);
			career.delivered += 1;
			finishContract(career);
		}
	}

	/* the medics go in at the Capital, the patients come out at the rebellion,
	 * the patients go out at the Capital — and the last one quells the planet */
	function settleMedic(career, task, planet, step) {
		const market = career.market;
		if (!market) return false;
		if (task.aboard === 0 && planet === task.to) {
			const picked = Math.min(task.medics, market.patients[task.to]);
			if (picked <= 0) {
				dropContract(career);
				return false;
			}
			task.aboard = picked;
			career.ship.cargoTons = picked;
			career.medicTrips += 1;
			refitShip(career);
			return true;
		}
		if (task.aboard === 0 || planet !== career.capitalPlanet) return false;
		const delivered = task.aboard;
		const left = market.patients[task.to] > delivered
			? market.patients[task.to] - delivered : 0;
		market.patients[task.to] = left;
		career.patientsDelivered += delivered;
		task.aboard = 0;
		career.ship.cargoTons = 0;
		refitShip(career);
		pay(career, delivered * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		if (left > 0) {
			task.patients = left;
			task.reward = round2(left * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
			loadMedics(career, task, left);
			task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
			if (market.galaxy && market.galaxy.actors) {
				for (let i = 0; i < market.galaxy.actors.length; i++) {
					refreshMedicSlot(market.galaxy.actors[i], market, step);
				}
			}
			return true;
		}
		pacifyPlanet(market, task.to, step);
		finishContract(career);
		return true;
	}

	/* --- flights ------------------------------------------------------- */

	/*
	 * Every EMC pad spends its own battery charge on the shot it fires, whether
	 * the launcher owns the rail or is only a guest on it. The neutral
	 * commercial EMC-1, kept charged by its operator, never runs dry and
	 * charges a flat fee instead. A rival-owned rail also charges its usage tax
	 * (the energy of the shot, paid to that player's purse).
	 */
	function careerBeginFlight(career, sim) {
		const planet = sim.origin;
		const pad = padAt(career, planet);
		const owner = padOwner(career, planet);
		const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, sim.speed);
		/* the commercial, imperial and rebel rails are kept charged: they never drain */
		const freeRail = owner === OWNER_COMMERCIAL || owner === OWNER_CAPITAL ||
			owner === OWNER_REBEL;
		if (!freeRail) {
			pad.chargeKwh = pad.chargeKwh > energy ? pad.chargeKwh - energy : 0;
			releaseEnergy(pad, energy);
		}
		const fee = launchFee(career, planet, sim.speed);
		career.ledger.purse -= fee;
		career.feesPaid += fee;
		if (!freeRail && owner !== career.index) {
			const host = career.galaxy.actors[owner];
			host.ledger.purse += fee;
			host.taxEarned += fee;
			career.taxPaid += fee;
		}
		career.lastEnergy = freeRail ? 0 : energy;
		career.lastFee = fee;
		career.lastReward = 0;
		career.lastFuel = 0;
		/* fragile load (0.6.3): fired harder than the load survives voids the
		 * contract and drops the cargo; the rail still fires and the fee stands */
		career.fragileLost = career.contract >= 0 &&
			fragileBreaks(career.tasks[career.contract], sim.speed);
		if (career.fragileLost) dropContract(career);
		setShipCondition(career, career.ship.condition - launchWear(career, sim.speed));
		career.flights += 1;
		career.flying = true;
		openFlight(career.ledger, sim, 0);
	}

	/* spends tank fuel for an in-flight impulse burn at the current step boundary */
	function careerBurn(career, sim, angle, dv) {
		if (career.ended !== CAREER_OPEN || !careerShipUsable(career) ||
			!sim.canBurn(dv)) return false;
		const ship = career.ship;
		const used = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
		if (!(used > 0)) return false;
		if (!sim.burn(angle, dv)) return false;
		career.plannedLanding = -1;
		ship.fuelKg = ship.fuelKg > used ? ship.fuelKg - used : 0;
		career.burns += 1;
		career.lastFuel += used;
		/* by delivered Δv, not fuel mass: a heavy tank is not punished twice */
		setShipCondition(career, career.ship.condition -
			impulseWear(career, dv));
		return true;
	}

	/* pads charge on the sun clock, never on the flight clock: the career sees
	 * SUN_SEC_PER_GAME_SEC pad seconds of sunlight per game second, so a step
	 * buys DT of sunlight against the battery's leak in pad minutes */
	function careerAdvance(career, steps, flightStep) {
		if (career.ended !== CAREER_OPEN) return;
		checkEnded(career);
		if (career.recoverySteps >= 0) {
			career.recoverySteps += steps;
			if (career.recoverySteps >= ENDGAME_LIMIT_STEPS) {
				liquidateCareer(career);
				return;
			}
		}
		const padSec = GravitySim.padSeconds(GravitySim.gameSeconds(steps));
		const padMin = GravitySim.padMinutes(GravitySim.gameSeconds(steps));
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (pad.catapult === null) continue;
			const charge = OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, padMin) +
				OrbitTech.solarCharge(pad.panel, career.light[i], padSec);
			pad.chargeKwh = charge < pad.battery.capacity ? charge : pad.battery.capacity;
		}
		/* only space wears the ship: a landing, a pad wait or a held clock does not */
		if (!career.flying || flightStep === false) return;
		setShipCondition(career, career.ship.condition -
			spaceWear(career, steps));
	}

	/* a landing settles contracts; a vessel that left the map or timed out is
	 * lost in space (at = -1) and only an evacuation brings it back */
	function careerEndFlight(career, sim, trade, step) {
		career.plannedLanding = -1;
		career.visitIncome += endFlight(career.ledger);
		career.flownPx += sim.flightLength;
		const landed = sim.endReason === GravitySim.END_IMPACT && sim.endBody >= 0;
		if (landed) settleLanding(career, sim, sim.endBody, step);
		/* after the settlement, so the landing that used the last of the ship
		 * still reports; an exit, timeout or abort is not a landing */
		if (landed) {
			setShipCondition(career, career.ship.condition - landingWear(career) *
				careerWearAt(career, sim.cargo.x, sim.cargo.y));
		}
		career.at = landed ? sim.endBody : -1;
		if (landed && sim.endBody === sim.origin && sim.endBody !== career.hq) {
			const visit = returnLandingVisit(career);
			if (visit) visit.count += 1;
			else returnLandingVisits.set(career, { planet: sim.endBody, count: 1 });
		} else returnLandingVisits.delete(career);
		career.flying = false;
		/* the commercial choice bought one launch; the next planet starts fresh */
		setCommercial(career, -1);
		/* the Capital's free imperial rail is a way off, so it never strands */
		career.stranded = !landed ||
			(career.pads[sim.endBody].catapult === null && sim.endBody !== career.capitalPlanet);
		refreshBoard(career, trade, step);
		return checkEnded(career);
	}

	function canEvacuate(career) {
		return career.ended === CAREER_OPEN && !career.flying && !career.arrested &&
			!career.evacuating && career.at !== career.hq;
	}

	function evacuationCost(career) {
		const fee = price(career, CAREER.evacFee);
		if (fee <= 0) return 0;
		return Math.min(fee, Math.max(0, career.ledger.purse));
	}

	function evacuationSecondsForPaid(career, paid) {
		const fee = price(career, CAREER.evacFee);
		if (fee <= 0) return CAREER.evacFreeSeconds;
		const fractionPaid = Math.min(1, Math.max(0, paid / fee));
		return CAREER.evacFreeSeconds -
			(CAREER.evacFreeSeconds - CAREER.evacFullSeconds) * fractionPaid;
	}

	function evacuationSeconds(career) {
		return evacuationSecondsForPaid(career, evacuationCost(career));
	}

	/* Evacuation is a paid, clock-driven ride, not a flight or an instant placeShip.
	 * Headless callers (bench/tests) omit runStep to complete synchronously. */
	function evacuate(career, sim, agreedCost, runStep, agreedSteps) {
		if (!canEvacuate(career) || !sim) return false;
		clearMedicalCargo(career);
		returnLandingVisits.delete(career);
		const quoted = agreedCost === undefined ? evacuationCost(career) : agreedCost;
		const paid = Math.min(Math.max(0, quoted), Math.max(0, career.ledger.purse));
		const duration = agreedSteps === undefined
			? Math.max(1, Math.round(evacuationSecondsForPaid(career, paid) / GravitySim.DT))
			: Math.max(1, Math.round(agreedSteps));
		const hasPlanets = Boolean(sim.planetX && sim.planetY);
		career.evacLastPaid = paid;
		career.evacLastSteps = duration;
		career.ledger.purse -= paid;
		career.evacuations += 1;
		career.evacuationSpent += paid;
		if (!Number.isFinite(runStep)) {
			/* headless / unit-test path: arrive immediately so assertions see HQ */
			career.evacuating = false;
			career.evacStartStep = career.evacUntilStep = 0;
			career.evacDurationSteps = 0;
			career.evacFromX = career.evacFromY = career.evacToX = career.evacToY = 0;
			career.evacFrom = -1;
			placeShip(career, sim, career.hq);
			checkEnded(career);
			return true;
		}
		const from = career.at >= 0 ? career.at : sim.landedBody;
		career.evacStartStep = Math.max(0, Math.round(runStep));
		career.evacDurationSteps = duration;
		career.evacUntilStep = career.evacStartStep + duration;
		career.evacFromX = career.at >= 0 && hasPlanets ? sim.planetX[career.at] : sim.cargo.x;
		career.evacFromY = career.at >= 0 && hasPlanets ? sim.planetY[career.at] : sim.cargo.y;
		career.evacToX = hasPlanets ? sim.planetX[career.hq] : 0;
		career.evacToY = hasPlanets ? sim.planetY[career.hq] : 0;
		career.evacFrom = from;
		career.evacuating = true;
		career.at = -1;
		career.flying = false;
		career.stranded = true;
		setCommercial(career, -1);
		sim.relocate(GravitySim.NO_BODY);
		sim.cargo.x = career.evacFromX;
		sim.cargo.y = career.evacFromY;
		sim.evacuationTrip = career;
		return true;
	}

	function advanceEvacuation(career, sim, runStep, trade) {
		if (!career.evacuating) return false;
		const elapsed = Math.max(0, Math.min(career.evacDurationSteps,
			Math.round(runStep) - career.evacStartStep));
		const progress = career.evacDurationSteps > 0 ? elapsed / career.evacDurationSteps : 1;
		if (sim) {
			sim.cargo.x = career.evacFromX +
				(career.evacToX - career.evacFromX) * progress;
			sim.cargo.y = career.evacFromY +
				(career.evacToY - career.evacFromY) * progress;
			sim.evacuationTrip = career;
		}
		if (runStep < career.evacUntilStep) return true;
		const toX = career.evacToX;
		const toY = career.evacToY;
		placeShip(career, sim, career.hq);
		if (sim) {
			sim.cargo.x = toX;
			sim.cargo.y = toY;
		}
		if (trade) refreshBoard(career, trade, runStep);
		checkEnded(career);
		return false;
	}

	/* --- launch book --------------------------------------------------- */

	/*
	 * A launch book keeps career trajectories that were already traced, so a
	 * planner can re-fly one instead of searching for it again. Each entry
	 * stores the aim in engine units plus the visit log of its trace: pricing
	 * that log at the live market gives the harvest exactly, so a stored shot
	 * scores like a fresh trace without running one. The list is per career, so
	 * the player and every rival company remember their own finds.
	 */

	/* the world a trace was made in: a different tag makes stored paths stale */
	function launchBookTag(fieldStatic, gravityScale, forceScale, strength, count) {
		let tag = fieldStatic ? 0x9e3779b9 : 0x85ebca6b;
		for (let i = 0; i < count; i++) {
			tag = Math.imul(tag ^ (Math.round(strength[i] * 100) + i * 31), 0x01000193) >>> 0;
		}
		tag = Math.imul(tag ^ Math.round(gravityScale * 100), 0x01000193) >>> 0;
		return Math.imul(tag ^ Math.round(forceScale * 100), 0x01000193) >>> 0;
	}

	function createLaunchBook() {
		return { entries: [], tag: 0, version: 0 };
	}

	function resetLaunchBook(book) {
		book.entries.length = 0;
		book.tag = 0;
		book.version += 1;
	}

	function bookReady(book, tag) {
		return book.tag === tag;
	}

	/* planets a trace entered as a bit mask: two shots with one mask harvest
	 * the same systems, but their timing can change the money earned */
	function launchMask(planets, count) {
		let mask = 0;
		for (let i = 0; i < count; i++) {
			const bit = 2 ** planets[i];
			if (Math.floor(mask / bit) % 2 === 0) mask += bit;
		}
		return mask;
	}

	function findLaunchEntry(book, origin, body, mask) {
		for (let i = 0; i < book.entries.length; i++) {
			const entry = book.entries[i];
			if (entry.origin === origin && entry.body === body && entry.mask === mask) return i;
		}
		return -1;
	}

	/*
	 * The weakest score leaves first; rows from other planets go before the
	 * current one, so a company that moved on does not starve the pad it stands
	 * on. `origin` is the trace being saved.
	 */
	function pruneLaunchBook(book, origin) {
		while (book.entries.length > BOOK_MAX) {
			let worst = -1;
			let fallback = 0;
			for (let i = 0; i < book.entries.length; i++) {
				const entry = book.entries[i];
				if (entry.score < book.entries[fallback].score) fallback = i;
				if (entry.origin === origin) continue;
				if (worst < 0 || entry.score < book.entries[worst].score) worst = i;
			}
			book.entries.splice(worst < 0 ? fallback : worst, 1);
		}
	}

	/*
	 * Save one finished trace; `trace` carries origin, angleU, speedU, body,
	 * steps, time, length, score and the visit log arrays. Same start planet,
	 * landing and visited set: retain the higher-scoring trace, breaking ties by time.
	 */
	function recordLaunch(book, tag, trace) {
		if (book.tag !== tag) {
			resetLaunchBook(book);
			book.tag = tag;
		}
		const count = trace.logCount < BOOK_LOG_MAX ? trace.logCount : BOOK_LOG_MAX;
		const mask = launchMask(trace.logPlanet, count);
		const at = findLaunchEntry(book, trace.origin, trace.body, mask);
		if (at >= 0 && (book.entries[at].score > trace.score ||
			(book.entries[at].score === trace.score && book.entries[at].steps <= trace.steps))) return book.entries[at];
		const entry = at >= 0 ? book.entries[at] : null;
		const out = entry || { logPlanet: new Int32Array(BOOK_LOG_MAX), logStep: new Int32Array(BOOK_LOG_MAX),
			logDwell: new Int32Array(BOOK_LOG_MAX) };
		if (!out.logDwell) out.logDwell = new Int32Array(BOOK_LOG_MAX);
		out.origin = trace.origin;
		out.angleU = trace.angleU;
		out.speedU = trace.speedU;
		out.body = trace.body;
		out.steps = trace.steps;
		out.time = trace.time;
		out.length = trace.length;
		out.mask = mask;
		out.score = trace.score;
		/* the cash the flight itself collected: launch time is priced against it */
		out.money = trace.money === undefined ? trace.score : trace.money;
		out.logCount = count;
		const dwells = trace.logDwell;
		for (let i = 0; i < count; i++) {
			out.logPlanet[i] = trace.logPlanet[i];
			out.logStep[i] = trace.logStep[i];
			out.logDwell[i] = dwells === undefined ? 0 : dwells[i];
		}
		if (entry === null) {
			book.entries.push(out);
			pruneLaunchBook(book, trace.origin);
		}
		book.version += 1;
		return out;
	}

	/* > 0 when actor `a` beats `b` under `ruleName` */
	function compareScores(ruleName, a, b) {
		if (ruleName === RULE_ROUTE) {
			return Math.abs(a.length - b.length) > 0.5 ? a.length - b.length : 0;
		}
		if (ruleName === RULE_MONEY || ruleName === RULE_CAREER) {
			if (Math.abs(a.purse - b.purse) > 1e-9) return a.purse - b.purse;
			if (a.visited !== b.visited) return a.visited - b.visited;
			if (a.shots !== b.shots) return b.shots - a.shots;
			return b.steps - a.steps;
		}
		if (a.visited !== b.visited) return a.visited - b.visited;
		if (a.shots !== b.shots) return b.shots - a.shots;
		if (a.steps !== b.steps) return b.steps - a.steps;
		return a.purse - b.purse;
	}

	const GravityGame = {
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX,
		ROUTE_SECONDS, ROUTE_STEPS, MONEY_SHOTS,
		RULE_TOUR, RULE_ROUTE, RULE_MONEY, RULE_CAREER, RULES,
		BOT_OFF, BOT_EASY, BOT_NORMAL, BOT_HARD, BOTS,
		PLAYER_USER, PLAYER_BOT, PLAYER_TYPES,
		CHEAT_COMMUNISM, CHEAT_ENDGAME, CHEATS,
		SRC_PLANETS, SRC_PORTS, NO_ABORT, MONEY, PURSE_PRESETS, EXPERIMENT,
		HARVEST_ENTRY, HARVEST_TICK, setHarvestMode, harvestMode: harvestModeOf,
		PLANET_GRAVITY_MIN, PLANET_GRAVITY_MAX, PLANET_GRAVITY_STEPS, HQ_GRAVITY_MAX,
		planetGravity, angleUnits, angleOf, speedUnits, speedOf,
		createBurn, encodeBurn, createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink,
		initSteps, createMarket, resetMarket, planetProfit, planetProfitAt, applyMarketSpecials,
		bindRun, politicsSeconds, rebelRail, setPolitics, politicsOn,
		advancePolitics, acceptBribe, bribeAmount, bribeWindowOpen, bribeRefusal,
		stampReport,
		visitReports, quietRefusal, goQuiet,
		arrestCareer, pacifyPlanet, seizePlanet, clearMedicalCargo, coveredPlanets, BRIBE,
		createLedger, resetLedger, beginFlight, stepHarvest, harvestPlanet, endFlight,
		estimateProfit, estimateProfitLog, compareScores,
		careerStats, mapStats, sampleStats,
		setSpecialPlanets, specialPlanets: specialPlanetsOn,
		setCareerUniverse, applyMarketUniverse, planetInPlay, colonyInPlay, activePlanetDraw,
		openingGroupStats, openingStatsFromTracks, openingTracks, openingPrepare,
		openingGroupStatsFromRows, compareOpeningGroups, seatAssignment,
		careerOpenings, prepareCareerStarts, rememberSeatPlan, planCareerExpansion, OPENING_BANDS,
		BOOK_MAX, BOOK_LOG_MAX, createLaunchBook, resetLaunchBook, launchBookTag, bookReady,
		launchMask, recordLaunch, pruneLaunchBook,
		CAREER, FUEL_KG_PER_KWH, FUEL_PRICE, FUEL_BUY_STEP, fuelPrice, produceFuel, buyFuel,
		COMMERCIAL_BASE, COMMERCIAL_KWH, commercialFee, commercialMinFee,
		DEEP_G, DEEP_TONS, DEEP_BONUS, deepOrigin, deepText,
		CAPITAL_VISIT_PAY, CAPITAL_REFUND, TOURIST_CHANCE, TOURIST_WEIGHT,
		QUIET_MIN, FRAGILE_ACCEL, FRAGILE_SPEED, FRAGILE_G, FRAGILE_TONS, FRAGILE_PAY,
		BOARD_SIZE, COMPETE_SLOT, MEDIC_SLOT, CARGO_TONS,
		TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_MEDIC,
		TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED,
		LEG_NONE, LEG_LOAD, LEG_DELIVER, LEG_MEDICS, LEG_PATIENTS, LEG_COMPETE, LEG_CREDIT,
		careerLandingFacts, careerGoalBodies,
		CAREER_OPEN, CAREER_BROKE, CAREER_COMPLETE,
		createCareer, resetCareer, startCareer, checkEnded, placeShip,
		ENDGAME_WARNING_STEPS, ENDGAME_LIMIT_STEPS, commercialPadAt,
		COMMERCIAL_PAD, OWNER_COMMERCIAL, CAPITAL_PAD, OWNER_CAPITAL, OWNER_REBEL, capitalCovered,
		createGalaxy, resetGalaxy, joinGalaxy, rivalSeed,
		turretPeriod, turretAngle, padAt, padOwner, claimOwner, refreshNetwork, setCommercial,
		launchFee, exitCost, exitCostAt, careerCanFire, padLift, reserveEnergy, releaseEnergy,
		railOwnerText, railText, launchBlock, railBlock, repairLaunchBlock, fragileBreaks,
		launchReason, launchReasons, formatLaunchReason,
		WEAR_SPACE, WEAR_LANDING, WEAR_EMC, WEAR_EMC_REF, WEAR_EMC_MAX, WEAR_IMP, WEAR_IMP_DV,
		WEAR_FLEET, WEAR_SCIENCE_MIN, WEAR_SCIENCE_STEP, WEAR_REPAIR_COST, WORN_OUT_BLOCK,
		wearFactor, setSpaceWearScale, spaceWearScaleOf, launchWear, spaceWear, impulseWear, landingWear,
		forecastCondition, forecastReportUntil, forecastRepairReserve, forecastWearCost,
		careerShipUsable, setShipCondition, careerWearAt, careerWeatherWear,
		repairCost, repairCareer, canEvacuate, evacuationCost, evacuationSeconds,
		advanceEvacuation,
		SCIENCE_FAMILIES, SCIENCE_KINDS, seedScience, researchPreview, researchCost, researchLabel, researchPoint,
		prototypesOf, prototypeById, gearKnown, planetBuildable, planetSeized,
		buildGear, bulkUpgradeCost, bulkUpgrade, installPart, partRefusal,
		refreshBoard, refreshMedicSlot, medicAffordable, medicPlanet,
		canAccept, acceptTask, dropTask, dropContract, medicLoad, settleMedic,
		careerBeginFlight, careerBurn, careerAdvance, careerEndFlight, returnLandingVisit, evacuate
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
