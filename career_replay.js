/* Portable career recordings: compact state deltas and a file://-safe codec. */
(function (root) {
	'use strict';

	const LZ = typeof module !== 'undefined' && module.exports
		? require('./vendor/lz-string.min.js') : root.LZString;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js') : root.OrbitWorld;
	const GravityBot = typeof module !== 'undefined' && module.exports
		? require('./gravity_bot.js') : root.GravityBot;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js') : root.GravityGame;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js') : root.OrbitTech;
	const GravityMaps = typeof module !== 'undefined' && module.exports
		? require('./saved_map.js') : root.GravityMaps;
	const PlanetGravity = typeof module !== 'undefined' && module.exports
		? require('./planet_gravity.js') : root.PlanetGravity;
	const FORMAT = 1;
	const PREFIX = 'gravity-career:';
	const REPLACE = 0;
	const CHANGE = 1;
	const REMOVE = 2;
	const APPEND = 3;
	const TRUNCATE = 4;
	const ARRAY_TYPES = new Set(['Float64Array', 'Float32Array', 'Uint8Array', 'Int8Array',
		'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Uint8ClampedArray']);
	const GEAR = new Set(Object.values(OrbitTech.TABLES).flat().map(item => item.id));

	function copy(value) {
		if (value === null || typeof value !== 'object') return value;
		return JSON.parse(JSON.stringify(value));
	}

	/* A patch is a replacement, a list of child patches, or a removed key. */
	function difference(before, after) {
		if (before === after) return null;
		if (!before || !after || typeof before !== 'object' || typeof after !== 'object' ||
			Array.isArray(before) !== Array.isArray(after)) return [REPLACE, after];
		if (Array.isArray(before) && before.length !== after.length) {
			const common = Math.min(before.length, after.length);
			let same = true;
			for (let i = 0; i < common; i++) {
				if (before[i] !== after[i]) { same = false; break; }
			}
			if (!same) return [REPLACE, after];
			return before.length < after.length
				? [APPEND, after.slice(before.length)] : [TRUNCATE, after.length];
		}
		const changes = [];
		for (const key of Object.keys(after)) {
			const delta = difference(before[key], after[key]);
			if (delta) changes.push([key, delta]);
		}
		for (const key of Object.keys(before)) {
			if (!Object.prototype.hasOwnProperty.call(after, key)) changes.push([key, [REMOVE]]);
		}
		return changes.length ? [CHANGE, changes] : null;
	}

	function apply(target, patch) {
		if (!Array.isArray(patch)) throw new Error('invalid replay patch');
		if (patch[0] === REPLACE && patch.length === 2) return copy(patch[1]);
		if (patch[0] === APPEND && Array.isArray(target) && Array.isArray(patch[1])) {
			for (const item of patch[1]) target.push(copy(item));
			return target;
		}
		if (patch[0] === TRUNCATE && Array.isArray(target) && Number.isInteger(patch[1]) &&
			patch[1] >= 0 && patch[1] <= target.length) {
			target.length = patch[1];
			return target;
		}
		if (patch[0] !== CHANGE || !target || typeof target !== 'object' || !Array.isArray(patch[1])) {
			throw new Error('invalid replay patch');
		}
		for (const entry of patch[1]) {
			if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' ||
				entry[0] === '__proto__' || entry[0] === 'constructor' || entry[0] === 'prototype') {
				throw new Error('invalid replay key');
			}
			const key = entry[0];
			const child = entry[1];
			if (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(key) ||
				Number(key) >= target.length || (Array.isArray(child) && child[0] === REMOVE))) {
				throw new Error('invalid replay index');
			}
			if (Array.isArray(child) && child[0] === REMOVE) delete target[key];
			else target[key] = apply(target[key], child);
		}
		return target;
	}

	function create(start) {
		return { v: FORMAT, start: start, frames: [] };
	}

	function safeTree(value) {
		if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
		if (typeof value === 'number') return Number.isFinite(value);
		if (!value || typeof value !== 'object') return false;
		if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'a') &&
			(!ARRAY_TYPES.has(value.a) || !Array.isArray(value.d) ||
				!value.d.every(Number.isFinite))) return false;
		if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'g') &&
			(typeof value.g !== 'string' || !GEAR.has(value.g))) return false;
		for (const key of Object.keys(value)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !safeTree(value[key])) {
				return false;
			}
		}
		return true;
	}

	function matchesShape(value, shape) {
		if (shape === null) return value !== undefined;
		if (typeof shape !== 'object') return typeof value === typeof shape;
		if (Array.isArray(shape)) return Array.isArray(value);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		if (shape.g !== undefined) return true; // gear can also be a researched prototype
		if (shape.a !== undefined) {
			return value.a === shape.a && Array.isArray(value.d) && value.d.length === shape.d.length;
		}
		for (const key of Object.keys(shape)) {
			if (!Object.prototype.hasOwnProperty.call(value, key) || !matchesShape(value[key], shape[key])) return false;
		}
		return true;
	}

	/* The event heap grows; all four arrays must keep the same capacity. */
	function validEvents(events, shape) {
		if (!events || !events.time || !Array.isArray(events.time.d)) return false;
		const capacity = events.time.d.length;
		if (!capacity || !Number.isInteger(events.size) || events.size < 0 || events.size > capacity) return false;
		for (const key of ['time', 'kind', 'ref', 'revision']) {
			const field = events[key];
			if (!field || field.a !== shape[key].a || !Array.isArray(field.d) || field.d.length !== capacity) {
				return false;
			}
		}
		return true;
	}

	function validSnapshot(snapshot) {
		if (!snapshot || snapshot.kind !== 'run' || snapshot.rule !== 'career' ||
			!Number.isInteger(snapshot.seed) || snapshot.seed < 1 || snapshot.seed > 0xffffffff ||
			!Number.isInteger(snapshot.universe) || snapshot.universe < 4 || snapshot.universe > OrbitWorld.PLANETS ||
			!Array.isArray(snapshot.seats) || !snapshot.seats.length ||
			snapshot.seats.length > GravityBot.MAX_RIVALS + 1 ||
			!Number.isFinite(snapshot.rate) || snapshot.rate < 0.5 || snapshot.rate > 12 ||
			!Number.isFinite(snapshot.gs) || snapshot.gs < 0 || snapshot.gs > 9 ||
			!Number.isFinite(snapshot.fs) || snapshot.fs < 0.25 || snapshot.fs > 3 ||
			!Number.isFinite(snapshot.ws) || snapshot.ws < 0 || snapshot.ws > 3 ||
			!Object.prototype.hasOwnProperty.call(GravityGame.BOTS, snapshot.bot) ||
			!Object.prototype.hasOwnProperty.call(GravityGame.PLAYER_TYPES, snapshot.player) ||
			(snapshot.cheat !== null && !Object.prototype.hasOwnProperty.call(GravityGame.CHEATS, snapshot.cheat)) ||
			(snapshot.source !== 0 && snapshot.source !== 1)) return false;
		if (snapshot.gravity !== undefined) {
			if (!Array.isArray(snapshot.gravity) || snapshot.gravity.length !== snapshot.universe) return false;
			for (let i = 0; i < snapshot.gravity.length; i++) {
				const g = snapshot.gravity[i];
				if (!Number.isFinite(g) || g < PlanetGravity.MIN || g > PlanetGravity.MAX) return false;
			}
		}
		const state = snapshot.state;
		if (!state || typeof state.mask !== 'string' || !/^[01]+$/.test(state.mask) ||
			state.mask.length !== OrbitWorld.PLANETS || !state.clock ||
			!Number.isInteger(state.clock.clockSteps) || state.clock.clockSteps < 0 ||
			!Number.isFinite(state.clock.tradeT) || !state.trade || !state.tradeEvents ||
			!state.market || !state.galaxy || !state.run || !Array.isArray(state.run.slots) ||
			state.run.slots.length < snapshot.seats.length || !Array.isArray(state.slotPaused) ||
			state.slotPaused.length !== snapshot.seats.length || !state.field ||
			!Array.isArray(state.field.planets) || state.field.planets.length !== OrbitWorld.PLANETS ||
			!Array.isArray(state.field.ports) || state.field.ports.length !== OrbitWorld.PLANETS ||
			!state.field.planets.every(Number.isFinite) || !state.field.ports.every(Number.isFinite) ||
			!Array.isArray(state.run.shots) || !Array.isArray(state.careers) ||
			!Array.isArray(state.rivals) || !Array.isArray(state.ships) ||
			state.careers.length !== snapshot.seats.length ||
			state.ships.length !== snapshot.seats.length ||
			state.rivals.length !== snapshot.seats.length - 1) return false;
		const shapes = GravityMaps.runStateShapes();
		if (!matchesShape(state.trade, shapes.trade) || !validEvents(state.tradeEvents, shapes.tradeEvents) ||
			!matchesShape(state.market, shapes.market) || !matchesShape(state.galaxy, shapes.galaxy) ||
			!Array.isArray(state.colonies) ||
			!state.colonies.every(colony => matchesShape(colony, shapes.colony))) return false;
		let count = 0;
		for (const bit of state.mask) if (bit === '1') count++;
		if (count !== snapshot.universe) return false;
		const homes = new Set();
		for (let i = 0; i < snapshot.seats.length; i++) {
			const seat = snapshot.seats[i];
			const ship = state.ships[i];
			const career = state.careers[i];
			if (!Number.isInteger(seat) || seat < 0 || seat >= OrbitWorld.PLANETS ||
				state.mask[seat] !== '1' || homes.has(seat) || !matchesShape(career, shapes.career) || career.hq !== seat ||
				!Number.isInteger(career.at) || career.at < -1 || career.at >= OrbitWorld.PLANETS ||
				!Array.isArray(career.pads) || career.pads.length !== OrbitWorld.PLANETS ||
				!career.pads.every(pad => pad && typeof pad === 'object' && 'catapult' in pad) ||
				!career.ship || !career.ship.hold || !career.ship.tank || !career.ship.obs ||
				!career.ledger || !Number.isFinite(career.ledger.purse) ||
				!Object.prototype.hasOwnProperty.call(GravityGame.PLAYER_TYPES, state.run.slots[i]) ||
				typeof state.slotPaused[i] !== 'boolean' ||
				!ship || !Number.isInteger(ship.status) || !ship.cargo ||
				!Number.isFinite(ship.cargo.x) || !Number.isFinite(ship.cargo.y) ||
				!Number.isFinite(ship.cargo.vx) || !Number.isFinite(ship.cargo.vy) ||
				!Array.isArray(ship.trailX) || !Array.isArray(ship.trailY) ||
				!Number.isInteger(ship.trailCount) || ship.trailCount < 0 ||
				ship.trailCount > ship.trailX.length || ship.trailCount > ship.trailY.length ||
				(i > 0 && (!state.rivals[i - 1] || !Array.isArray(state.rivals[i - 1].shots)))) return false;
			homes.add(seat);
		}
		return true;
	}

	function valid(record) {
		try {
			if (!record || record.v !== FORMAT || !Array.isArray(record.frames) ||
				(record.watch !== undefined && (!Number.isInteger(record.watch) || record.watch < 0 ||
					record.watch > GravityBot.MAX_RIVALS)) ||
				!safeTree(record) || !validSnapshot(record.start)) return false;
			let current = copy(record.start);
			let last = 0;
			for (const frame of record.frames) {
				if (!frame || !Number.isFinite(frame.t) || frame.t < last || !Array.isArray(frame.d)) return false;
				current = apply(current, frame.d);
				if (!validSnapshot(current)) return false;
				last = frame.t;
			}
			return true;
		} catch (error) {
			return false;
		}
	}

	function encode(record) {
		return LZ.compressToEncodedURIComponent(JSON.stringify(record));
	}

	function decode(text) {
		try {
			const data = LZ.decompressFromEncodedURIComponent(text);
			if (!data) return null;
			const record = JSON.parse(data);
			return valid(record) ? record : null;
		} catch (error) {
			return null;
		}
	}

	const api = { PREFIX, copy, difference, apply, create, valid, encode, decode };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.CareerReplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
