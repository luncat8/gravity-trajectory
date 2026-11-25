/*
 * The career launch book: saved trajectories keyed by the world they were traced
 * in, the visit mask that tells two shots apart, recording and pruning.
 *
 * Part of GravityGame: gravity_game.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const {
		BOOK_MAX, BOOK_LOG_MAX
	} = GravityGame;

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

	Object.assign(GravityGame, {
		launchBookTag, createLaunchBook, resetLaunchBook, bookReady, launchMask, pruneLaunchBook,
		recordLaunch
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
