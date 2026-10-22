/*
 * Game-mode rules shared by the page and the node benches: the aim grid, the
 * flight cap and the replay link codec. A shot snapped to the grid has an exact
 * integer form, so the link replays bit-identical launch inputs.
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
	const RULE_TOUR = 'tour';
	const RULE_ROUTE = 'route';
	/*
	 * One table for everything a rule changes: the flight cap, the preview
	 * horizon (null = the lab slider) and the score order, which the GUI reads
	 * in one place. Rule names are what a link carries.
	 */
	const RULES = {
		tour: { name: RULE_TOUR, capSteps: CAP_STEPS, horizon: null },
		route: { name: RULE_ROUTE, capSteps: ROUTE_STEPS, horizon: ROUTE_SECONDS }
	};
	const RATE_MIN = 0.5;
	const RATE_MAX = 12;
	/*
	 * Money mode (0.3.2): a launch costs 1, a first entry pays for the flight
	 * time it took, a landing stages the next launch. The knob names match the
	 * plan's balance table so it can be retuned against the measured tours
	 * without re-playing them.
	 */
	const MONEY = {
		cost: 1,       // launch fee; the purse reads as "launches left"
		k: 0.10,       // first-entry pay per flight-second since the previous one
		floor: 0.05,   // minimum first-entry pay
		landing: 0.25, // stevedoring fee, on every landing
		tour: 3,       // once, when the last system is entered
		purse0: 12     // starting purse; presets: 6 tight, 20 relaxed
	};
	const PURSE_PRESETS = { tight: 6, standard: 12, relaxed: 20 };
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;

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

	/* `game` = { seed, rate, shots, visited, steps }; the result rides along for verification */
	function encodeLink(game) {
		const head = 'game=' + FORMAT + '&seed=' + game.seed + '&rate=' + game.rate +
			(game.rule === RULE_ROUTE ? '&rule=' + RULE_ROUTE : '');
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
		/* an abort is recorded in steps and can never exceed the rule's flight cap */
		if (speed < SPEED_UNITS_MIN || speed > SPEED_UNITS_MAX) return null;
		if (abort >= (capSteps || ROUTE_STEPS)) return null;
		return createShot(SRC_CODES.indexOf(match[1]), origin, angle, speed, abort);
	}

	/* Returns { seed, rate, shots, end } or null when the text is not a valid game link. */
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
		return { seed: seed, rate: rate, rule: rule.name, shots: shots, end: end };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	/* the purse ledger; entryStep is the run-cumulative step of the previous first entry */
	function createLedger(purse0) {
		return { purse: purse0 === undefined ? MONEY.purse0 : purse0,
			entryStep: -1, tourPaid: false, last: 0 };
	}

	/*
	 * What one finished flight won. The launch cost is deducted when the shot
	 * is fired (the GUI gates launches on the purse), everything else lands
	 * here, so a replay re-derives the purse flight by flight. flight =
	 * { baseStep, visitStep, visitCount, landed, tourStep }: entry steps are
	 * flight-local, baseStep makes them run-cumulative. A first entry pays for
	 * the flight time since the previous first entry, the run's first one
	 * since its launch.
	 */
	function earn(ledger, flight) {
		let entryPay = 0;
		for (let i = 0; i < flight.visitCount; i++) {
			const at = flight.baseStep + flight.visitStep[i];
			const dt = (at - (ledger.entryStep < 0 ? 0 : ledger.entryStep)) * GravitySim.DT;
			const pay = MONEY.k * dt;
			entryPay += pay < MONEY.floor ? MONEY.floor : pay;
			ledger.entryStep = at;
		}
		const landing = flight.landed ? MONEY.landing : 0;
		const tour = !ledger.tourPaid && flight.tourStep >= 0 ? MONEY.tour : 0;
		if (tour) ledger.tourPaid = true;
		ledger.purse += entryPay + landing + tour;
		ledger.last = entryPay + landing + tour - MONEY.cost;
		return { entryPay: entryPay, landing: landing, tour: tour };
	}

	const GravityGame = {
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX,
		ROUTE_SECONDS, ROUTE_STEPS, RULE_TOUR, RULE_ROUTE, RULES,
		SRC_PLANETS, SRC_PORTS, NO_ABORT, MONEY, PURSE_PRESETS,
		angleUnits, angleOf, speedUnits, speedOf,
		createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink,
		createLedger, earn
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
