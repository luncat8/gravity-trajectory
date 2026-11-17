/*
 * Saved maps: a start map is a proven career opening (seed, universe, seat plan)
 * and a run is that start plus an exact snapshot of the live state.
 *
 * Loading a start map skips `prepareCareerStarts`, which traces candidate HQs
 * for seconds of every career page boot; the plan it would compute is data.
 * Loading a run continues the same companies, clock and market.
 *
 * The file format is plain JS so `saved_maps.js` can be a classic script on the
 * page and a `require` in node. Saving appends the record to the in-memory list
 * and downloads the regenerated file; loading is just that file being present.
 *
 * Part of the page's flat classic-script family: no build, no modules, `file://`
 * friendly, guarded `module.exports`.
 */
(function (root) {
	'use strict';

	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;
	const GravityGame = typeof module !== 'undefined' && module.exports
		? require('./gravity_game.js')
		: root.GravityGame;
	const OrbitSim = typeof module !== 'undefined' && module.exports
		? require('./orbit_sim.js')
		: root.OrbitSim;

	const FORMAT = 1;
	const GEAR_ID = /^(OBS|EMC|SP|BAT|HOLD|IMP|FT|HELP)-\d+$/;
	const TYPED = {
		Float64Array, Float32Array, Uint8Array, Int8Array, Uint16Array, Int16Array,
		Uint32Array, Int32Array, Uint8ClampedArray
	};

	/* keys that are live references or re-derived from the seed/universe */
	const CAREER_SKIP = ['galaxy', 'market', 'launchPads', 'planetMask', 'planetCount'];
	const MARKET_SKIP = ['galaxy', 'planetMask', 'planetCount'];
	const GALAXY_SKIP = ['actors', 'market', 'period', 'phase'];
	const TRADE_SKIP = ['handleEvent', 'onColonyEvent', 'world', 'rand', 'events',
		'colonies', 'corruption', 'mapOut', 'log', 'planetMask'];
	const RIVAL_SKIP = ['sim', 'career', 'ledger', 'turret'];
	/* a sim's geometry, field and refs are rebuilt; only the past is saved */
	const SHIP_KEYS = ['status', 'landedBody', 'origin', 'angle', 'speed', 'cargo',
		'endReason', 'endBody',
		'liveSteps', 'stepLimit', 'limitReason', 'flightTime', 'flightLength',
		'flightFieldT', 'acc', 'fieldT', 'fieldRate', 'visited', 'visitedCount',
		'visitStep', 'trailCount', 'trailStride', 'trailX', 'trailY'];
	/* the bot's YOU-as-bot turn state: the plan it already made and the gap
	 * timers around it decide when the next barrel turns */
	const PLANNER_SKIP = ['career', 'sim'];

	/* --- data trees -------------------------------------------------------- */

	function isPlain(value) {
		return value !== null && typeof value === 'object' &&
			!Array.isArray(value) && !ArrayBuffer.isView(value);
	}

	function packData(live, skip) {
		if (live === null || live === undefined) return null;
		const type = typeof live;
		if (type === 'number') return Number.isFinite(live) ? live : 0;
		if (type === 'string' || type === 'boolean') return live;
		if (type === 'function') return undefined;
		if (ArrayBuffer.isView(live)) {
			return { a: live.constructor.name, d: Array.prototype.slice.call(live) };
		}
		if (Array.isArray(live)) {
			const out = new Array(live.length);
			for (let i = 0; i < live.length; i++) out[i] = packData(live[i], skip);
			return out;
		}
		if (typeof live.id === 'string' && GEAR_ID.test(live.id)) return { g: live.id };
		const out = {};
		for (const key in live) {
			if (skip && skip.indexOf(key) >= 0) continue;
			const value = packData(live[key], skip);
			if (value !== undefined) out[key] = value;
		}
		return out;
	}

	let gearIndex = null;
	function gearById(id) {
		if (!gearIndex) {
			gearIndex = {};
			for (const kind in OrbitTech.TABLES) {
				const table = OrbitTech.TABLES[kind];
				for (let i = 0; i < table.length; i++) gearIndex[table[i].id] = table[i];
			}
		}
		return gearIndex[id] || null;
	}

	/* writes `data` back into the live object shape and returns the live value:
	 * objects and arrays are reused so references other code holds stay valid.
	 * Live keys the record does not carry are dropped, except the skipped ones,
	 * which are live references or seed-derived data. */
	function unpackData(live, data, skip) {
		if (data === null || data === undefined) return null;
		if (typeof data !== 'object') return data;
		if (Array.isArray(data)) {
			/* a short list written into a preallocated buffer (a ship's trail):
			 * the tail beyond the saved length is stale and never drawn */
			if (ArrayBuffer.isView(live)) {
				const count = Math.min(data.length, live.length);
				for (let i = 0; i < count; i++) live[i] = data[i];
				return live;
			}
			if (Array.isArray(live) && live.length === data.length) {
				for (let i = 0; i < data.length; i++) live[i] = unpackData(live[i], data[i], skip);
				return live;
			}
			const out = new Array(data.length);
			for (let i = 0; i < data.length; i++) out[i] = unpackData(undefined, data[i], skip);
			return out;
		}
		if (data.g !== undefined) return gearById(data.g);
		if (data.a !== undefined) {
			const source = data.d;
			if (ArrayBuffer.isView(live) && live.constructor.name === data.a &&
				live.length === source.length) {
				for (let i = 0; i < source.length; i++) live[i] = source[i];
				return live;
			}
			const array = new TYPED[data.a](source.length);
			for (let i = 0; i < source.length; i++) array[i] = source[i];
			return array;
		}
		const target = isPlain(live) ? live : {};
		for (const key in target) {
			if (skip && skip.indexOf(key) >= 0) continue;
			if (!(key in data)) delete target[key];
		}
		for (const key in data) target[key] = unpackData(target[key], data[key], skip);
		return target;
	}

	/* a live object that keeps unrelated keys: only the saved ones are written */
	function unpackKeys(live, data) {
		if (!data) return live;
		for (const key in data) live[key] = unpackData(live[key], data[key]);
		return live;
	}

	/* --- start records ----------------------------------------------------- */

	function finite(value, fallback) {
		return Number.isFinite(value) ? value : fallback;
	}

	function round(value) {
		return Math.round(value * 1e6) / 1e6;
	}

	/* the page's own experiment scales, two decimals, as the link format stores
	 * them: a seat plan is only valid for the field it was proven on */
	function scale(value) {
		return round(finite(value, 1));
	}

	function startFields(info) {
		const galaxy = info.galaxy;
		const seats = galaxy && galaxy.mapSeats ? galaxy.mapSeats.slice() : [];
		return {
			seed: info.seed >>> 0,
			universe: info.universe,
			seats: seats,
			/* unrounded: an injected plan must be the plan the search returns */
			targetPay: finite(galaxy && galaxy.openingTargetPay, 0),
			rule: info.rule,
			bot: info.bot,
			player: info.player,
			cheat: info.cheat || null,
			rate: round(finite(info.rate, 1)),
			gs: scale(info.gs),
			fs: scale(info.fs),
			ws: scale(info.ws),
			ht: info.ht === true
		};
	}

	function mapLabel(fields) {
		return 'seed ' + fields.seed + ' · ' + fields.universe + ' planets · ' +
			fields.seats.length + ' seats';
	}

	function startRecord(info) {
		const fields = startFields(info);
		const record = { v: FORMAT, kind: 'start', name: mapLabel(fields) };
		for (const key in fields) record[key] = fields[key];
		return record;
	}

	/* --- exact run state --------------------------------------------------- */

	function captureShips(info) {
		const ships = [];
		const sims = info.sims;
		for (let i = 0; i < sims.length; i++) {
			const sim = sims[i];
			const out = {};
			for (let k = 0; k < SHIP_KEYS.length; k++) {
				const key = SHIP_KEYS[k];
				out[key] = packData(sim[key]);
			}
			/* the trail buffers are preallocated for 4096 points; only the drawn
			 * prefix is history, and the rest would be most of the file */
			const count = Math.min(sim.trailCount, sim.trailX.length);
			out.trailX = Array.prototype.slice.call(sim.trailX, 0, count);
			out.trailY = Array.prototype.slice.call(sim.trailY, 0, count);
			ships.push(out);
		}
		return ships;
	}

	function captureState(info) {
		const galaxy = info.galaxy;
		const careers = [];
		for (let i = 0; i < galaxy.actors.length; i++) {
			careers.push(packData(galaxy.actors[i], CAREER_SKIP));
		}
		const rivals = [];
		for (let i = 0; i < info.rivals.length; i++) {
			rivals.push(packData(info.rivals[i], RIVAL_SKIP));
		}
		const trade = info.trade;
		return {
			mask: maskBits(info.mask),
			clock: {
				tradeT: round(trade.t),
				clockSteps: info.clockSteps,
				paused: info.paused === true
			},
			trade: packData(trade, TRADE_SKIP),
			tradeEvents: {
				time: packData(trade.events.time),
				kind: packData(trade.events.kind),
				ref: packData(trade.events.ref),
				revision: packData(trade.events.revision),
				size: trade.events.size
			},
			tradeRand: typeof trade.rand.getState === 'function' ? trade.rand.getState() : null,
			colonies: packData(trade.colonies),
			market: packData(info.market, MARKET_SKIP),
			galaxy: packData(galaxy, GALAXY_SKIP),
			careers: careers,
			rivals: rivals,
			planner: packData(info.planner, PLANNER_SKIP),
			page: packData(info.page),
			ships: captureShips(info),
			run: packData({
				steps: info.game.steps,
				length: info.game.length,
				doneSteps: info.game.doneSteps,
				visited: info.game.visited,
				shots: info.game.shots,
				slots: info.slots
			})
		};
	}

	function runRecord(info) {
		const record = startRecord(info);
		record.kind = 'run';
		record.name = 'run · ' + record.name + ' · step ' + info.clockSteps;
		record.state = captureState(info);
		return record;
	}

	/* The saved state is written into the live objects a fresh `startGame` just
	 * built: `game.career`, the galaxy, the market and the trade sim are held by
	 * closures, so they must be mutated, never replaced. */
	function applyState(info, record) {
		const state = record.state;
		if (!state) return false;
		const trade = info.trade;
		if (state.tradeRand !== null && typeof trade.rand.setState === 'function') {
			trade.rand.setState(state.tradeRand);
		}
		unpackData(trade, state.trade, TRADE_SKIP);
		trade.events.time = unpackData(trade.events.time, state.tradeEvents.time);
		trade.events.kind = unpackData(trade.events.kind, state.tradeEvents.kind);
		trade.events.ref = unpackData(trade.events.ref, state.tradeEvents.ref);
		trade.events.revision = unpackData(trade.events.revision, state.tradeEvents.revision);
		trade.events.size = state.tradeEvents.size;
		trade.colonies = unpackData(trade.colonies, state.colonies);
		for (let i = 0; i < trade.colonies.length; i++) {
			const colony = trade.colonies[i];
			if (colony.map && colony.map.ease) colony.ease = colony.map.ease;
		}
		unpackData(info.market, state.market, MARKET_SKIP);
		const galaxy = info.galaxy;
		unpackData(galaxy, state.galaxy, GALAXY_SKIP);
		for (let i = 0; i < state.careers.length && i < galaxy.actors.length; i++) {
			unpackData(galaxy.actors[i], state.careers[i], CAREER_SKIP);
		}
		for (let i = 0; i < state.rivals.length && i < info.rivals.length; i++) {
			unpackData(info.rivals[i], state.rivals[i], RIVAL_SKIP);
		}
		if (state.planner && info.planner) {
			unpackData(info.planner, state.planner, PLANNER_SKIP);
		}
		GravityGame.refreshNetwork(galaxy);
		/* Relocate the sim, not the career: placeShip resets the selected rail
		 * and cannot handle a ship stranded in space (at = -1). */
		for (let i = 0; i < galaxy.actors.length && i < info.sims.length; i++) {
			const career = galaxy.actors[i];
			info.sims[i].relocate(career.at);
			unpackKeys(info.sims[i], state.ships[i]);
		}
		info.game.steps = state.run.steps;
		info.game.length = state.run.length;
		info.game.doneSteps = state.run.doneSteps;
		info.game.visited = state.run.visited;
		info.game.shots = unpackData(info.game.shots, state.run.shots);
		if (Array.isArray(state.run.slots) && Array.isArray(info.slots)) {
			for (let i = 0; i < state.run.slots.length && i < info.slots.length; i++) {
				info.slots[i] = state.run.slots[i];
			}
		}
		info.game.clockSteps = state.clock.clockSteps;
		info.cargo.fieldT = trade.t;
		info.cargo.fieldRate = info.rate;
		return true;
	}

	/* Canonical packed shapes let the replay importer reject incomplete state
	 * before it replaces a live run. Construct them only when importing. */
	let stateShapes = null;
	function runStateShapes() {
		if (stateShapes) return stateShapes;
		const trade = new OrbitSim(1);
		const galaxy = GravityGame.createGalaxy();
		GravityGame.resetGalaxy(galaxy, 1);
		stateShapes = {
			trade: packData(trade, TRADE_SKIP),
			tradeEvents: {
				time: packData(trade.events.time), kind: packData(trade.events.kind),
				ref: packData(trade.events.ref), revision: packData(trade.events.revision), size: 0
			},
			market: packData(GravityGame.createMarket(), MARKET_SKIP),
			galaxy: packData(galaxy, GALAXY_SKIP),
			career: packData(GravityGame.createCareer(GravityGame.createLedger()), CAREER_SKIP),
			colony: trade.colonies.length ? packData(trade.colonies[0]) : null
		};
		return stateShapes;
	}

	/* --- loading ----------------------------------------------------------- */

	let armed = null;

	function maskBits(mask) {
		let bits = '';
		for (let i = 0; i < OrbitWorld.PLANETS; i++) bits += mask && mask[i] ? '1' : '0';
		return bits;
	}

	/* the record's plan is injected only into the world it was proven on */
	function applySeats(galaxy, world, trade, mask, count, wanted, sourceSim) {
		const record = armed;
		if (!record || !record.seats || record.seats.length !== wanted) return null;
		if ((world.seed >>> 0) !== (record.seed >>> 0) || count !== record.universe) return null;
		if (record.state && record.state.mask && record.state.mask !== maskBits(mask)) return null;
		const gs = scale(sourceSim && sourceSim.gravityScale);
		const fs = scale(sourceSim && sourceSim.forceScale);
		if (gs !== scale(record.gs) || fs !== scale(record.fs)) return null;
		armed = null;
		return GravityGame.rememberSeatPlan(galaxy, world, trade, mask, count, wanted,
			sourceSim, record.seats, record.targetPay);
	}

	function arm(record) {
		armed = record && record.seats ? record : null;
		return armed;
	}

	function armedRecord() {
		return armed;
	}

	function disarm() {
		armed = null;
	}

	/* a random record of `kind` ('start', 'run', or any) */
	function pick(records, kind, random) {
		const pool = [];
		for (let i = 0; i < records.length; i++) {
			if (!kind || records[i].kind === kind) pool.push(records[i]);
		}
		if (pool.length === 0) return null;
		const rng = random || Math.random;
		return pool[Math.floor(rng() * pool.length) % pool.length];
	}

	function hasKind(records, kind) {
		for (let i = 0; i < records.length; i++) {
			if (records[i].kind === kind) return true;
		}
		return false;
	}

	/* --- the file ---------------------------------------------------------- */

	const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

	function jsValue(value, depth) {
		const pad = '\t'.repeat(depth);
		if (value === null || value === undefined) return 'null';
		if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
		if (typeof value === 'boolean') return String(value);
		if (typeof value === 'string') return JSON.stringify(value);
		if (Array.isArray(value)) {
			if (value.length === 0) return '[]';
			let numbers = true;
			for (let i = 0; i < value.length; i++) {
				if (typeof value[i] !== 'number') { numbers = false; break; }
			}
			if (numbers) return '[' + value.join(', ') + ']';
			const rows = [];
			for (let i = 0; i < value.length; i++) {
				rows.push(pad + '\t' + jsValue(value[i], depth + 1));
			}
			return '[\n' + rows.join(',\n') + '\n' + pad + ']';
		}
		const keys = Object.keys(value);
		if (keys.length === 0) return '{}';
		const rows = [];
		for (let i = 0; i < keys.length; i++) {
			const key = IDENT.test(keys[i]) ? keys[i] : JSON.stringify(keys[i]);
			rows.push(pad + '\t' + key + ': ' + jsValue(value[keys[i]], depth + 1));
		}
		return '{\n' + rows.join(',\n') + '\n' + pad + '}';
	}

	const HEADER = '/* Saved maps: a start map is a proven career opening (seed, universe, seat\n' +
		' * plan); a run adds an exact snapshot of the live state. Written by the game\'s\n' +
		' * save action and by `node experiments/make_saved_maps.js` — edit by saving,\n' +
		' * not by hand. Loading is just this file being present. */\n';

	function fileText(records) {
		const body = jsValue(records || [], 1);
		return HEADER +
			'(function (root) {\n' +
			'\t\'use strict\';\n' +
			'\tconst MAPS = ' + body + ';\n' +
			'\tif (typeof module !== \'undefined\' && module.exports) module.exports = MAPS;\n' +
			'\telse root.SAVED_MAPS = MAPS;\n' +
			'})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
	}

	/* the browser half of "append and download": no storage, the file is the save */
	function download(records, name, doc) {
		const document = doc || (typeof window !== 'undefined' ? window.document : null);
		if (!document || typeof Blob !== 'function' || !root.URL) return false;
		const blob = new Blob([fileText(records)], { type: 'text/javascript' });
		const url = root.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = name || 'saved_maps.js';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		root.URL.revokeObjectURL(url);
		return true;
	}

	const GravityMaps = {
		FORMAT,
		startRecord,
		runRecord,
		captureState,
		runStateShapes,
		applyState,
		applySeats,
		arm,
		armed: armedRecord,
		disarm,
		pick,
		hasKind,
		fileText,
		download,
		packData,
		unpackData
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityMaps;
	else root.GravityMaps = GravityMaps;
})(typeof globalThis !== 'undefined' ? globalThis : this);
