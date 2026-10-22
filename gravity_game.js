/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, and the shared per-planet growing
 * visit-profit market.
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;

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
	const RULE_TOUR = 'tour';
	const RULE_ROUTE = 'route';
	const RULE_MONEY = 'money';
	/*
	 * One table for everything a rule changes: flight cap, preview horizon
	 * (null = the lab slider), shot ceiling (0 = unlimited) and whether the run
	 * stops when all 26 systems are visited.
	 */
	const RULES = {
		tour: { name: RULE_TOUR, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: true },
		route: { name: RULE_ROUTE, capSteps: ROUTE_STEPS, horizon: ROUTE_SECONDS, maxShots: 0, stopOnTour: true },
		money: { name: RULE_MONEY, capSteps: CAP_STEPS, horizon: null, maxShots: MONEY_SHOTS, stopOnTour: false }
	};
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
	const RATE_MIN = 0.5;
	const RATE_MAX = 12;
	/*
	 * Per-planet growing visit profit: each launch costs 1.00 from a tight
	 * starting purse of 3.00; every planet starts with 40 s of accrued age
	 * (+0.25) and grows +0.00625 per flight-second (+0.25 per 40 s) up to 0.75.
	 * Entering a planet's port orbit collects its value and resets it to 0.00.
	 */
	const MONEY = {
		cost: 1,
		k: 0.00625,
		initSec: 40,
		cap: 0.75,
		purse0: 3
	};
	const PURSE_PRESETS = { tight: 2, standard: 3, relaxed: 6 };
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;
	const estScratch = new Int32Array(OrbitWorld.PLANETS);

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

	function createShot(src, origin, angle, speed, abort) {
		return { src: src, origin: origin, angle: angle, speed: speed, abort: abort };
	}

	function encodeShot(shot) {
		const head = SRC_CODES[shot.src] + shot.origin + '.' +
			shot.angle.toString(36) + '.' + shot.speed.toString(36);
		return shot.abort === NO_ABORT ? head : head + '.' + shot.abort.toString(36);
	}

	/* `game` = { seed, rate, rule, bot, shots, visited, steps }; default rule/bot stay omitted */
	function encodeLink(game) {
		const rulePart = game.rule && game.rule !== RULE_TOUR ? '&rule=' + game.rule : '';
		const botPart = game.bot && game.bot !== BOT_OFF ? '&bot=' + game.bot : '';
		const head = 'game=' + FORMAT + '&seed=' + game.seed + '&rate=' + game.rate +
			rulePart + botPart;
		if (game.shots.length === 0) return head;
		return head + '&shots=' + game.shots.map(encodeShot).join('_') +
			'&end=' + game.visited + '.' + game.steps;
	}

	function decodeShot(text, capSteps) {
		const match = SHOT_FORM.exec(text);
		if (!match) return null;
		const origin = Number(match[2]);
		const angle = parseInt(match[3], 36);
		const speed = parseInt(match[4], 36);
		const abort = match[5] === undefined ? NO_ABORT : parseInt(match[5], 36);
		if (origin >= OrbitWorld.PLANETS || angle >= ANGLE_STEPS) return null;
		if (speed < SPEED_UNITS_MIN || speed > SPEED_UNITS_MAX) return null;
		if (abort >= (capSteps || ROUTE_STEPS)) return null;
		return createShot(SRC_CODES.indexOf(match[1]), origin, angle, speed, abort);
	}

	/* Returns { seed, rate, rule, bot, shots, end } or null when not a valid game link. */
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
		const list = params.get('shots');
		const parts = list ? list.split('_') : [];
		const shots = [];
		for (const part of parts) {
			const shot = decodeShot(part, rule.capSteps);
			if (!shot) return null;
			shots.push(shot);
		}
		const endMatch = END_FORM.exec(params.get('end') || '');
		const end = endMatch ? { visited: Number(endMatch[1]), steps: Number(endMatch[2]) } : null;
		return { seed: seed, rate: rate, rule: rule.name, bot: bot, shots: shots, end: end };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	/* shared planet-value state for a game run; player and rivals harvest from the same table */
	function createMarket() {
		const market = {
			lastVisitStep: new Int32Array(OrbitWorld.PLANETS),
			stamp: 0
		};
		resetMarket(market);
		return market;
	}

	function resetMarket(market) {
		market.lastVisitStep.fill(-initSteps());
		market.stamp += 1;
	}

	function planetProfitAtStep(lastStep, runStep) {
		const age = (runStep - lastStep) * GravitySim.DT;
		if (age <= 0) return 0;
		const pay = age * MONEY.k;
		return pay > MONEY.cap ? MONEY.cap : pay;
	}

	function planetProfit(market, planet, runStep) {
		return planetProfitAtStep(market.lastVisitStep[planet], runStep);
	}

	function createLedger(purse0) {
		return {
			purse: purse0 === undefined ? MONEY.purse0 : purse0,
			last: 0,
			shotGain: 0,
			shotVisits: 0,
			lastPlanet: -1,
			inside: new Uint8Array(GravitySim.MAX_BODIES),
			entered: new Int32Array(GravitySim.MAX_BODIES)
		};
	}

	function resetLedger(ledger, purse0) {
		ledger.purse = purse0 === undefined ? MONEY.purse0 : purse0;
		ledger.last = 0;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
	}

	/* deducts the launch fee and marks the launch base as already inside so departure pays 0 */
	function beginFlight(ledger, sim) {
		ledger.purse -= MONEY.cost;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
		sim.markSystemsAt(sim.cargo.x, sim.cargo.y, ledger.inside);
	}

	function harvestPlanet(ledger, market, planet, runStep) {
		const pay = planetProfit(market, planet, runStep);
		market.lastVisitStep[planet] = runStep;
		market.stamp += 1;
		ledger.purse += pay;
		ledger.shotGain += pay;
		ledger.shotVisits += 1;
		ledger.lastPlanet = planet;
		return pay;
	}

	/* advances one step of system-entry harvesting for either the player or a rival */
	function stepHarvest(ledger, market, sim, runStep) {
		const count = sim.stepInsideAt(sim.cargo.x, sim.cargo.y, ledger.inside, ledger.entered);
		let gained = 0;
		for (let i = 0; i < count; i++) {
			gained += harvestPlanet(ledger, market, ledger.entered[i], runStep);
		}
		if (sim.status === GravitySim.STATUS_ENDED &&
			sim.endReason === GravitySim.END_IMPACT &&
			sim.endBody >= 0 && !ledger.inside[sim.endBody]) {
			ledger.inside[sim.endBody] = 1;
			gained += harvestPlanet(ledger, market, sim.endBody, runStep);
		}
		return gained;
	}

	function endFlight(ledger) {
		ledger.last = ledger.shotGain - MONEY.cost;
		return ledger.shotGain;
	}

	/* exact predicted harvest along a traced probe without mutating the live market */
	function estimateProfit(market, baseStep, sim) {
		const count = sim.predLogCount;
		if (count === 0) return 0;
		estScratch.set(market.lastVisitStep);
		let total = 0;
		for (let i = 0; i < count; i++) {
			const planet = sim.predLogPlanet[i];
			const at = baseStep + sim.predLogStep[i];
			total += planetProfitAtStep(estScratch[planet], at);
			estScratch[planet] = at;
		}
		return total;
	}

	/* > 0 when actor `a` beats `b` under `ruleName` */
	function compareScores(ruleName, a, b) {
		if (ruleName === RULE_MONEY) {
			if (Math.abs(a.purse - b.purse) > 1e-9) return a.purse - b.purse;
			if (a.visited !== b.visited) return a.visited - b.visited;
			if (a.shots !== b.shots) return b.shots - a.shots;
			return b.steps - a.steps;
		}
		if (a.visited !== b.visited) return a.visited - b.visited;
		if (ruleName === RULE_ROUTE && Math.abs(a.length - b.length) > 0.5) {
			return a.length - b.length;
		}
		if (a.shots !== b.shots) return b.shots - a.shots;
		if (a.steps !== b.steps) return b.steps - a.steps;
		return a.purse - b.purse;
	}

	const GravityGame = {
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX,
		ROUTE_SECONDS, ROUTE_STEPS, MONEY_SHOTS,
		RULE_TOUR, RULE_ROUTE, RULE_MONEY, RULES,
		BOT_OFF, BOT_EASY, BOT_NORMAL, BOT_HARD, BOTS,
		SRC_PLANETS, SRC_PORTS, NO_ABORT, MONEY, PURSE_PRESETS,
		angleUnits, angleOf, speedUnits, speedOf,
		createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink,
		initSteps, createMarket, resetMarket, planetProfit,
		createLedger, resetLedger, beginFlight, stepHarvest, endFlight,
		estimateProfit, compareScores
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
