/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, the shared per-planet growing
 * visit-profit market, and the career rule (catapult network, pad energy,
 * contract board, evacuation, cheats).
 *
 * The core owns the rule table, the mode/bot/player/cheat enums, the purse
 * presets, the experimental-panel bounds and the replay link codec; the rest of
 * the rule set lives in the part files of PARTS below, one area per file, all
 * publishing onto this one GravityGame object. A part reads earlier parts
 * through its `const { … } = GravityGame;` line and publishes with
 * `Object.assign(GravityGame, { … })`; a call into a later part is written
 * `GravityGame.name(…)`. experiments/parts_test.js checks the order.
 */
(function (root) {
	'use strict';

	/* load order; index.html lists the same files after this one */
	const PARTS = [
		'game_career.js',        // career numbers: tables, enums, salts, pads, tasks, price
		'game_ship.js',          // ship wear, repair, fuel, evacuation fare, balance knobs
		'game_market.js',        // visit-profit market, ledger, harvest, universe mask
		'game_book.js',          // launch book: saved trajectories and their visit logs
		'game_network.js',       // galaxy, EMC pads and turrets, fees, launch gates
		'game_opening.js',       // seat search 1/5: opening fans and exit margin
		'game_seat_stats.js',    // seat search 2/5: set stats and seat matching
		'game_seat_rank.js',     // seat search 3/5: set ranking, composition
		'game_seat_walk.js',     // seat search 4/5: the resumable single-law walk
		'game_seat_search.js',   // seat search 5/5: seat plans, tiered search, HQ pick
		'game_sport.js',         // the shared sport event
		'game_contracts.js',     // deliveries, medics, task board, accept
		'game_politics.js',      // rot, bribes, arrest, rebellion
		'game_build.js',         // pad light, building, parts, radar
		'game_science.js',       // research hull, start gifts
		'game_departure.js',     // leg probe, arrival mass/charge, departure solvency
		'game_legs.js',          // two-leg plans: impact ways, pair slots, careerLegPlan
		'game_lifecycle.js',     // create/reset/start a career, placement, stats, end
		'game_flight.js',        // flights, landing settlement, evacuation
	];

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
	/* experimental settings panel bounds; links carry non-default multipliers */
	const EXPERIMENT = {
		gravityMin: 0, gravityMax: 9,
		forceMin: 0.25, forceMax: 3,
		spaceWearMin: 0, spaceWearMax: 3,
		padMin: 0.25, padMax: 4,
		rotMin: 0, rotMax: 3,
		payMin: 0.25, payMax: 3
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

	/* whole-cr start-gift budget, omitted at 0 */
	function giftPart(name, value) {
		return value > 0 ? '&' + name + '=' + value : '';
	}

	/* `game` = { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, giftAll, giftBot, giftHuman, shots, visited,
	 * steps, length }; default rule/bot/player/scales/gifts stay
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
			(game.rule === RULE_CAREER
				? scalePart('ws', game.spaceWearScale) + scalePart('ps', game.padScale) +
					scalePart('rs', game.rotScale) + scalePart('ys', game.payScale)
				: '') +
			(game.rule === RULE_CAREER && game.harvestTick ? '&ht=1' : '') +
			(game.rule === RULE_CAREER
				? giftPart('ga', game.giftAll) + giftPart('gb', game.giftBot) + giftPart('gh', game.giftHuman)
				: '');
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

	/* absent = 0, otherwise a whole number of cr inside [0, GIFT.budgetMax] */
	function decodeGift(text) {
		if (text === null) return 0;
		if (!/^\d{1,2}$/.test(text)) return null;
		const value = Number(text);
		return value <= GravityGame.GIFT.budgetMax ? value : null;
	}

	/* Returns { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, giftAll, giftBot, giftHuman, shots, end, length } or null. */
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
		const padScale = decodeScale(params.get('ps'), EXPERIMENT.padMin, EXPERIMENT.padMax);
		const rotScale = decodeScale(params.get('rs'), EXPERIMENT.rotMin, EXPERIMENT.rotMax);
		const payScale = decodeScale(params.get('ys'), EXPERIMENT.payMin, EXPERIMENT.payMax);
		if (gravityScale === null || forceScale === null || spaceWearScale === null ||
			padScale === null || rotScale === null || payScale === null) return null;
		const harvestText = params.get('ht');
		if (harvestText !== null && harvestText !== '1' && harvestText !== '0') return null;
		const harvestTick = harvestText === '1';
		const giftAll = decodeGift(params.get('ga'));
		const giftBot = decodeGift(params.get('gb'));
		const giftHuman = decodeGift(params.get('gh'));
		if (giftAll === null || giftBot === null || giftHuman === null) return null;
		if (rule.name !== RULE_CAREER && giftAll + giftBot + giftHuman > 0) return null;
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
			gravityScale: gravityScale, forceScale: forceScale, spaceWearScale: spaceWearScale,
			padScale: padScale, rotScale: rotScale, payScale: payScale, harvestTick: harvestTick,
			giftAll: giftAll, giftBot: giftBot, giftHuman: giftHuman,
			shots: shots, end: end, length: length };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	function round2(value) {
		return Math.round(value * 100) / 100;
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
		PARTS, FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, ROUTE_SECONDS, ROUTE_STEPS,
		MONEY_SHOTS, STATS_SAMPLES, STATS_EVERY, RULE_TOUR, RULE_ROUTE, RULE_MONEY, RULE_CAREER,
		RULES, CHEAT_COMMUNISM, CHEAT_ENDGAME, CHEATS, BOT_OFF, BOT_EASY, BOT_NORMAL, BOT_HARD,
		BOTS, PLAYER_USER, PLAYER_BOT, PLAYER_TYPES, RATE_MIN, RATE_MAX, MONEY, PURSE_PRESETS,
		HARVEST_ENTRY, HARVEST_TICK, EXPERIMENT, SRC_PLANETS, SRC_PORTS, NO_ABORT,
		PLANET_GRAVITY_MIN, PLANET_GRAVITY_MAX, PLANET_GRAVITY_STEPS, planetGravity, estScratch,
		BOOK_MAX, BOOK_LOG_MAX, angleUnits, angleOf, speedUnits, speedOf, createBurn, encodeBurn,
		createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink, initSteps, round2,
		compareScores
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = GravityGame;
		for (const part of PARTS) require('./' + part);
	} else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
