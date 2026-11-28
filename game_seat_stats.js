/*
 * Seat solver 2/5: exact, resumable opening-set statistics, set comparison,
 * and the bipartite seat matching.
 * not here: ranking proposals → game_seat_rank.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_seat_stats.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		OrbitWorld, CAREER, OPENING_ANGLES, OPENING_SPEEDS, OPENING_COMPARE_EPS, OPENING_FAIR_RATIO,
		OPENING_RATIO_EPS, openingExtent, openingMarket, openingFillEmpty, openingPrepare,
		OPENING_PAUSED, hqForbidden, openingTracks, planetInMask
	} = inner;

	/* ratios below this are not worth ranking; negative openings are not starts */
	const OPENING_RATIO_FLOOR = 0.01;

	/* ── set statistics ── exact, resumable opening-set statistics from tracks and rows */

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

	/*
	 * `windowed` reads a set through `seatFairAssignment`: the wide walk and the
	 * acceptance of its plans. The ordinary walk keeps the highest floor.
	 *
	 * `cutoff` lets a walk drop a set that cannot beat its best one: seats are
	 * traced in `order`, and the traced seats already bound the whole set (more
	 * seats only narrow the matchings), so the set is abandoned (null) as soon
	 * as they have no distinct exit-safe seating, or none whose ratio reaches
	 * `cutoff`. Undefined traces every seat and always returns the stats.
	 */
	/* Exact evaluation of one pinned HQ set, resumable across frame units
	 * (0.7.47 review): begin once per proposal, then step until the state
	 * returns stats/null; a fan-quota pause returns OPENING_PAUSED with all
	 * progress kept. The sync wrapper below runs the same state at the
	 * default quota and cannot pause. */
	function openingGroupBegin(world, trade, mask, count, forcedHomes, homes, sourceSim,
		windowed, cutoff, order) {
		const assign = windowed ? seatFairAssignment : seatAssignment;
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
		const rows = { sitePay: sitePay, exitOk: exitOk };
		const openPays = new Float64Array(homes.length);
		const buildables = new Int32Array(homes.length);
		const traced = [];
		return {
			world: world, mask: mask, forcedHomes: forcedHomes, homes: homes,
			windowed: windowed, cutoff: cutoff, order: order, assign: assign,
			siteList: siteList, stats: stats, rows: rows, openPays: openPays,
			buildables: buildables, traced: traced, n: 0
		};
	}

	function openingGroupStep(state) {
		const assign = state.assign;
		const mask = state.mask;
		const homes = state.homes;
		const order = state.order;
		const cutoff = state.cutoff;
		const siteList = state.siteList;
		const stats = state.stats;
		const sitePay = state.rows.sitePay;
		const exitOk = state.rows.exitOk;
		const rows = state.rows;
		const openPays = state.openPays;
		const buildables = state.buildables;
		const traced = state.traced;
		while (state.n < homes.length) {
			const seat = order ? order[state.n] : state.n;
			const home = homes[seat];
			const track = openingTracks(state.world, state.mask, state.forcedHomes, home,
				OPENING_ANGLES, OPENING_SPEEDS, true);
			if (track === OPENING_PAUSED) return OPENING_PAUSED;
			const row = home * OrbitWorld.PLANETS;
			for (let k = 0; k < siteList.length; k++) {
				const body = siteList[k];
				sitePay[row + body] = track.sitePay[row + body];
				exitOk[row + body] = track.exitOk[row + body];
			}
			openPays[seat] = track.openPay;
			buildables[seat] = track.buildable;
			state.n += 1;
			if (cutoff === undefined) continue;
			traced.push(home);
			if (!openingSeatsCanReach(rows, traced, siteList, mask, cutoff)) return null;
		}
		for (let i = 0; i < homes.length; i++) {
			if (openPays[i] < stats.minAnyPay) stats.minAnyPay = openPays[i];
			if (openPays[i] > stats.maxAnyPay) stats.maxAnyPay = openPays[i];
			if (buildables[i] <= 0) {
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
		if (stats.missing === 0) {
			/* first ask for a map whose every first landing can launch again */
			let assignment = assign(rows, homes, siteList, mask, exitOk);
			if (assignment) {
				stats.exitOk = true;
			} else {
				assignment = assign(rows, homes, siteList, mask, null);
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

	function openingGroupStats(world, trade, mask, count, forcedHomes, homes, sourceSim,
		windowed, cutoff, order) {
		return openingGroupStep(openingGroupBegin(world, trade, mask, count, forcedHomes,
			homes, sourceSim, windowed, cutoff, order));
	}

	/* can these traced seats still sit on distinct exit-safe sites, at a
	 * weakest/best ratio of at least `cutoff`? */
	function openingSeatsCanReach(rows, traced, siteList, mask, cutoff) {
		const sites = seatSites(traced, siteList, mask);
		if (sites.length < traced.length) return false;
		if (!seatMatcher(rows, traced, sites, rows.exitOk)(-Infinity, Infinity)) return false;
		if (!(cutoff > -Infinity)) return true;
		return assignmentRatio(seatWindowAssignment(rows, traced, siteList, mask, rows.exitOk)) >= cutoff;
	}

	/*
	 * Cheap group score over the once-traced opening table: each seat must reach
	 * a *different* buildable site, so this asks for the best such assignment
	 * rather than for each seat's private favourite. `assign` carries the sites
	 * so the exact re-trace can check that every chosen site can also be left.
	 */
	function openingGroupStatsFromRows(mask, rows, homes, occupied, windowed) {
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
		const assignment = windowed ? seatFairAssignment(rows, homes, siteList, mask)
			: seatAssignment(rows, homes, siteList, mask);
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

	/* ── set comparison ── openingRatio, compareOpeningGroups */

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

	/* ── seat matching ── sites, the bipartite matcher, seat pays, assignments and their ratios, exits */

	/* the free in-play sites a set of seats can claim (never another seat's HQ) */
	function seatSites(homes, siteList, mask) {
		const occupied = new Uint8Array(OrbitWorld.PLANETS);
		for (let i = 0; i < homes.length; i++) occupied[homes[i]] = 1;
		const sites = [];
		for (let i = 0; i < siteList.length; i++) {
			const site = siteList[i];
			if (!planetInMask(mask, site) || occupied[site]) continue;
			sites.push(site);
		}
		return sites;
	}

	/* Kuhn matching: every seat on its own site paying inside [floor, ceiling]
	 * (unreachable pairs are -Infinity, never inside a window). Returns the
	 * site of each seat, or null when some seat cannot be placed. */
	function seatMatcher(rows, homes, sites, exitOk) {
		const seats = homes.length;
		const siteOfSeat = new Int16Array(seats);
		const seatOfSite = new Int32Array(OrbitWorld.PLANETS);
		const seen = new Uint8Array(OrbitWorld.PLANETS);
		let floor = -Infinity;
		let ceiling = Infinity;
		function augment(seat) {
			const row = homes[seat] * OrbitWorld.PLANETS;
			for (let s = 0; s < sites.length; s++) {
				const site = sites[s];
				if (seen[site]) continue;
				const pay = rows.sitePay[row + site];
				if (!Number.isFinite(pay) || pay < floor || pay > ceiling) continue;
				if (exitOk && exitOk[row + site] !== 1) continue;
				seen[site] = 1;
				const holder = seatOfSite[site];
				if (holder < 0 || augment(holder)) {
					seatOfSite[site] = seat;
					siteOfSeat[seat] = site;
					return true;
				}
			}
			return false;
		}
		return function match(low, high) {
			floor = low;
			ceiling = high;
			siteOfSeat.fill(-1);
			seatOfSite.fill(-1);
			for (let seat = 0; seat < seats; seat++) {
				seen.fill(0);
				if (!augment(seat)) return null;
			}
			return siteOfSeat.slice();
		};
	}

	/* every finite pay a seat could match, ascending; `positive` keeps only
	 * openings that earn something, the only ones a ratio can describe */
	function seatPays(rows, homes, sites, exitOk, positive) {
		const values = [];
		for (let seat = 0; seat < homes.length; seat++) {
			const row = homes[seat] * OrbitWorld.PLANETS;
			for (let s = 0; s < sites.length; s++) {
				if (exitOk && exitOk[row + sites[s]] !== 1) continue;
				const pay = rows.sitePay[row + sites[s]];
				if (Number.isFinite(pay) && (!positive || pay > 0)) values.push(pay);
			}
		}
		return values.sort((left, right) => left - right);
	}

	function seatAssignmentOf(rows, homes, sites) {
		let minPay = Infinity;
		let maxPay = -Infinity;
		let sumPay = 0;
		const pays = new Float64Array(homes.length);
		for (let seat = 0; seat < homes.length; seat++) {
			const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + sites[seat]];
			pays[seat] = pay;
			if (pay < minPay) minPay = pay;
			if (pay > maxPay) maxPay = pay;
			sumPay += pay;
		}
		return { min: minPay, max: maxPay, sum: sumPay, spread: maxPay - minPay, sites: sites,
			pays: pays };
	}

	function assignmentRatio(assignment) {
		if (!assignment || !(assignment.max > OPENING_COMPARE_EPS)) return -Infinity;
		return assignment.min / assignment.max;
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
		const sites = seatSites(homes, siteList, mask);
		if (sites.length < seats) return null;
		const match = seatMatcher(rows, homes, sites, exitOk);
		function weakest(sitesOfSeat) {
			let low = Infinity;
			for (let seat = 0; seat < seats; seat++) {
				const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + sitesOfSeat[seat]];
				if (pay < low) low = pay;
			}
			return low;
		}
		const anyMatch = match(-Infinity, Infinity);
		if (!anyMatch) return null;
		/* the highest floor every seat can still reach */
		const values = seatPays(rows, homes, sites, exitOk, false);
		let low = 0;
		let high = values.length - 1;
		let best = anyMatch;
		let floor = weakest(anyMatch);
		while (low <= high) {
			const mid = (low + high) >> 1;
			const found = match(values[mid], Infinity);
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
			let highPay = -Infinity;
			for (let seat = 0; seat < seats; seat++) {
				const pay = rows.sitePay[homes[seat] * OrbitWorld.PLANETS + best[seat]];
				if (pay > highPay) highPay = pay;
			}
			const ceiling = highPay - OPENING_COMPARE_EPS;
			if (ceiling < floor) break;
			const tighter = match(floor, ceiling);
			if (!tighter) break;
			best = tighter;
		}
		return seatAssignmentOf(rows, homes, best);
	}

	/*
	 * The best ratio any distinct assignment reaches, by pay window: for each
	 * positive floor the lowest ceiling that still seats everybody. The lowest
	 * feasible ceiling never falls as the floor rises, so one two-pointer sweep
	 * visits every window. The highest-floor match above can hold a needlessly
	 * rich seat (its floor is fixed before the ceiling is pulled down), which
	 * made a fair seating of the very same HQs read as unfair.
	 */
	function seatWindowAssignment(rows, homes, siteList, mask, exitOk) {
		const sites = seatSites(homes, siteList, mask);
		if (homes.length === 0 || sites.length < homes.length) return null;
		const values = seatPays(rows, homes, sites, exitOk, true);
		const match = seatMatcher(rows, homes, sites, exitOk);
		let best = null;
		let bestRatio = -Infinity;
		for (let i = 0, j = 0; i < values.length; i++) {
			if (i > 0 && values[i] === values[i - 1]) continue;
			if (j < i) j = i;
			let found = null;
			while (j < values.length && !(found = match(values[i], values[j]))) j++;
			if (!found) break;
			const candidate = seatAssignmentOf(rows, homes, found);
			const ratio = assignmentRatio(candidate);
			if (ratio > bestRatio + 1e-12 ||
				(Math.abs(ratio - bestRatio) <= 1e-12 && candidate.min > best.min)) {
				best = candidate;
				bestRatio = ratio;
			}
		}
		return bestRatio > -Infinity ? best : null;
	}

	/* The highest-floor match while it is fair, so a fair map reads exactly as
	 * before; the pay-window match only where that one misses the band. */
	function seatFairAssignment(rows, homes, siteList, mask, exitOk) {
		const floorFirst = seatAssignment(rows, homes, siteList, mask, exitOk);
		if (!floorFirst || assignmentRatio(floorFirst) >= OPENING_FAIR_RATIO) return floorFirst;
		const window = seatWindowAssignment(rows, homes, siteList, mask, exitOk);
		return window && assignmentRatio(window) > assignmentRatio(floorFirst) ? window : floorFirst;
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

	/* ── candidate pools ── startCandidatePools */

	/*
	 * Sunlit worlds make better homes (a pad that charges), so they are tried
	 * first — but as a *preference*, never a hard filter. Filtering to sunlit
	 * worlds alone used to leave too few seats to build a fair map: on a dim
	 * world the only planet able to give the third company its own opening can
	 * sit a hundredth under `hqMinLight`, and the strict pool silently lost it,
	 * which is how a map ended up with no valid seating at all. Callers walk
	 * the pools in order and keep the first that yields a usable map.
	 */
	function startCandidatePools(world, mask, wanted, trade, count) {
		const activeCount = Number.isFinite(count) ? count : openingExtent(mask, world);
		openingFillEmpty(openingMarket, world, trade, mask, activeCount);
		const all = [];
		const bright = new Uint8Array(OrbitWorld.PLANETS);
		const limit = world && world.planetCount ? world.planetCount : OrbitWorld.PLANETS;
		for (let i = 0; i < limit; i++) {
			if ((mask && mask[i] === 0) || hqForbidden(world, i)) continue;
			all.push(i);
			if (world.planetLight[i] >= CAREER.hqMinLight) bright[i] = 1;
		}
		return [all, all.some((home) => bright[home]) ? bright : null];
	}

	Object.assign(GravityGame, {
		openingGroupStats, openingStatsFromTracks, openingGroupStatsFromRows, compareOpeningGroups,
		seatAssignment
	});
	Object.assign(inner, {
		openingGroupBegin, openingGroupStep, openingGroupStatsFromRows, openingRatio,
		compareOpeningGroups, startCandidatePools
	});
});
