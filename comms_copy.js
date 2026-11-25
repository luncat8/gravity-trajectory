/*
 * H's pure facts, slots, topics, one-step arithmetic and copy validator.
 *
 * Reads live state and rule parameters from GravityGame, OrbitTech, OrbitEcon
 * and GravitySim into one frozen snapshot per check. No DOM, no random draws,
 * no state mutation, and no literal numbers or item ids in authored copy.
 *
 * This core holds the units, caps, launch-gate order and formatters every part
 * reads, plus PARTS, the load order; CommsCopy is frozen once the last part has
 * attached. experiments/parts_test.js checks the wiring.
 */
(function (root) {
	'use strict';

	/* load order; index.html lists the same files right after this one */
	const PARTS = [
		'comms_facts.js',  // live snapshot, reasons, predicates, HH_FACTS, H_SLOTS
		'comms_topics.js', // authored copy: actions, steps, look-ahead, topics
		'comms_render.js', // evalWhen, slot fill, topic render, copy linter
	];

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js') : root.GravitySim;
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js') : root.OrbitEcon;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js') : root.OrbitTech;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js') : root.GravityGame;

	const EPS = 1e-9;
	const CENT = 100;
	const MONEY_DP = 2;
	const MASS_DP = 1;
	const H_META_ID = 'what-now';
	const H_META_ASK = 'what should I do?';
	const CHIP_CAP = 6;
	const EXCHANGE_CAP = 3;
	const RETURN_LANDINGS_FOR_TOW = 2;

	const LAUNCH_GATE_ORDER = Object.freeze([
		'arrest', 'space', 'wrong-planet', 'worn', 'no-rail', 'cap', 'fee'
	]);

	function money(value) {
		return Number(value).toFixed(MONEY_DP);
	}

	function cost(value) {
		return Math.abs(value) <= EPS ? 'free' : money(value);
	}

	function tenths(value) {
		return Number(value).toFixed(MASS_DP);
	}

	function trimmed(value) {
		return String(Number(Number(value).toFixed(MONEY_DP)));
	}

	function whole(value) {
		return String(Math.round(value));
	}

	function planetLabel(index) {
		return index >= 0 ? 'P' + index : 'in space';
	}

	function ownerLabel(owner, selfIndex) {
		if (owner === selfIndex) return 'you';
		if (owner === GravityGame.OWNER_CAPITAL) return 'the Empire';
		if (owner === GravityGame.OWNER_REBEL) return 'rebels';
		if (owner < 0) return 'commercial';
		return owner === 0 ? 'YOU' : 'R' + owner;
	}

	const CommsCopy = {
		H_META_ID, H_META_ASK, CHIP_CAP, EXCHANGE_CAP, LAUNCH_GATE_ORDER
	};
	const inner = {
		GravitySim, OrbitEcon, OrbitTech, GravityGame, EPS, CENT, H_META_ID, H_META_ASK, CHIP_CAP,
		RETURN_LANDINGS_FOR_TOW, LAUNCH_GATE_ORDER, money, cost, tenths, trimmed, whole, planetLabel,
		ownerLabel
	};

	let attached = 0;
	function part(file, attach) {
		if (file !== PARTS[attached]) throw new Error('comms_copy.js: expected ' + PARTS[attached] + ', got ' + file);
		attach(CommsCopy, inner);
		attached += 1;
		if (attached < PARTS.length) return;
		delete CommsCopy.part;
		Object.freeze(CommsCopy);
	}

	if (typeof module !== 'undefined' && module.exports) {
		for (const file of PARTS) part(file, require('./' + file));
		module.exports = CommsCopy;
	} else {
		Object.defineProperty(CommsCopy, 'part', { value: part, configurable: true });
		root.CommsCopy = CommsCopy;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
