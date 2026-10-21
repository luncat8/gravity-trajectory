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
	const RATE_MIN = 0.5;
	const RATE_MAX = 12;
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
		const head = 'game=' + FORMAT + '&seed=' + game.seed + '&rate=' + game.rate;
		if (game.shots.length === 0) return head;
		return head + '&shots=' + game.shots.map(encodeShot).join('_') +
			'&end=' + game.visited + '.' + game.steps;
	}

	function decodeShot(text) {
		const match = SHOT_FORM.exec(text);
		if (!match) return null;
		const origin = Number(match[2]);
		const angle = parseInt(match[3], 36);
		const speed = parseInt(match[4], 36);
		const abort = match[5] === undefined ? NO_ABORT : parseInt(match[5], 36);
		if (origin >= OrbitWorld.PLANETS || angle >= ANGLE_STEPS) return null;
		if (speed < SPEED_UNITS_MIN || speed > SPEED_UNITS_MAX || abort >= CAP_STEPS) return null;
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
		const list = params.get('shots');
		const parts = list ? list.split('_') : [];
		const shots = [];
		for (const part of parts) {
			const shot = decodeShot(part);
			if (!shot) return null;
			shots.push(shot);
		}
		const endMatch = END_FORM.exec(params.get('end') || '');
		const end = endMatch ? { visited: Number(endMatch[1]), steps: Number(endMatch[2]) } : null;
		return { seed: seed, rate: rate, shots: shots, end: end };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	const GravityGame = {
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX,
		SRC_PLANETS, SRC_PORTS, NO_ABORT,
		angleUnits, angleOf, speedUnits, speedOf,
		createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
