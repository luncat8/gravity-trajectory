/*
 * Fair-start seat search, layer 5: the seat-plan cache, prepareCareerStarts,
 * the tiered background search (createSeatSearch), expansion seats and the HQ
 * pick for standalone careers.
 *
 * Part of GravityGame: gravity_game.js holds the load order and the sharing rule.
 */
(function (root) {
	'use strict';

	const node = typeof module !== 'undefined' && module.exports;
	const GravityGame = node ? require('./gravity_game.js') : root.GravityGame;
	const OrbitWorld = node ? require('./orbit_world.js') : root.OrbitWorld;
	const PlanetGravity = node ? require('./planet_gravity.js') : root.PlanetGravity;
	const {
		planetGravity, CAREER, SALT_HQ, OWNER_COMMERCIAL, specialPlanetsOn, claimOwner, padScaleOf,
		payScaleOf, HQ_GRAVITY_MAX, OPENING_COMPARE_EPS, OPENING_FAIR_RATIO, OPENING_RATIO_EPS,
		openingMaskTag, openingPrepare, openingTraceHome, pickFairHq, hqForbidden, openingRatio,
		compareOpeningGroups, startCandidatePools, openingGroupAccepted, OPENING_LAW_FLOOR,
		OPENING_LAW_WIDE, OPENING_LAW_TIER1, OPENING_LAW_TIER2, createHomeWalk
	} = GravityGame;

	function planHomeSet(world, trade, mask, count, candidates, seatsWanted, sourceSim,
		sunlit, law) {
		const walk = createHomeWalk(world, trade, mask, count, candidates, seatsWanted,
			sourceSim, sunlit, law);
		while (!walk.stepUnit()) {}
		return walk.result();
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

	function seatPlanKey(world, trade, mask, count, seatsWanted, sourceSim) {
		const field = PlanetGravity.armed();
		const fieldTag = field && field.seed === (world.seed >>> 0) ? field.tag : 0;
		return (world.seed >>> 0) + ':' + (trade.seed >>> 0) + ':' +
			openingMaskTag(mask, count) + ':' + seatsWanted + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			padScaleOf() + ':' + payScaleOf() + ':' +
			(specialPlanetsOn() ? 1 : 0) + (fieldTag ? ':' + fieldTag : '');
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
		const plan = planCareerSeats(world, trade, mask, count, seatsWanted, sourceSim);
		if (!plan) return null;
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

	function shuffleSeatHomes(seed, rawHomes) {
		const homes = rawHomes.slice();
		for (let i = homes.length - 1; i > 0; i--) {
			const j = OrbitWorld.hashBits(seed, i, SALT_HQ + homes.length) % (i + 1);
			const home = homes[i];
			homes[i] = homes[j];
			homes[j] = home;
		}
		return homes;
	}

	function seatTargetPay(stats) {
		if (!stats || !Number.isFinite(stats.minPay) ||
			!Number.isFinite(stats.maxPay) || stats.minPay <= 0) return 0;
		return Math.sqrt(stats.minPay * stats.maxPay);
	}

	function describeSeatStats(stats) {
		if (!stats) return null;
		const ratio = openingRatio(stats);
		let unmet = null;
		if (stats.missing > 0 || !stats.distinct) unmet = 'distinct';
		else if (!stats.exitOk) unmet = 'exit-safe';
		else if (!(ratio >= OPENING_FAIR_RATIO)) unmet = '≥ 55 %';
		return {
			stats: stats,
			ratio: Number.isFinite(ratio) ? ratio : 0,
			minPay: stats.minPay,
			maxPay: stats.maxPay,
			distinct: Boolean(stats.distinct && stats.missing === 0),
			exitOk: Boolean(stats.exitOk),
			missing: stats.missing,
			unmet: unmet
		};
	}

	/* Resumable tiered seat search (0.7.47 WS4). T0 runs today's exact laws
	 * bit-for-bit; T1 and T2 spend wider deterministic budgets when the player
	 * asks to wait more. Only a completed tier ever commits into `bestHomes()`
	 * / `bestStats()`, so wall-clock timing decides when H asks, never which
	 * HQ set wins. */
	function createSeatSearch(world, trade, mask, count, seats, sourceSim) {
		const seatsWanted = Math.max(0, Math.min(Math.floor(seats), count || OrbitWorld.PLANETS));
		const pools = world && seatsWanted > 0 ? startCandidatePools(world, mask, seatsWanted)
			: [[]];
		const candidates = pools[0];
		const sunlit = pools.length > 1 ? pools[1] : null;
		const canSeat = Boolean(world && trade && seatsWanted > 0 &&
			candidates.length >= seatsWanted);
		let currentTier = 0;
		let walks = [];
		let walkIdx = 0;
		let tierRaw = null;
		let completedRaw = null;
		let completedPlan = null;
		let tierDone = !canSeat;

		function startTier(tier) {
			currentTier = tier;
			tierRaw = completedRaw;
			walkIdx = 0;
			if (!canSeat) {
				walks = [];
				tierDone = true;
				return;
			}
			tierDone = false;
			if (tier === 0) {
				walks = [];
				if (seatsWanted <= 4 && count <= 26) {
					walks.push(createHomeWalk(world, trade, mask, count, candidates,
						seatsWanted, sourceSim, sunlit, OPENING_LAW_FLOOR));
				}
				walks.push(createHomeWalk(world, trade, mask, count, candidates,
					seatsWanted, sourceSim, sunlit, OPENING_LAW_WIDE));
				return;
			}
			const law = tier === 1 ? OPENING_LAW_TIER1 : OPENING_LAW_TIER2;
			walks = [createHomeWalk(world, trade, mask, count, candidates,
				seatsWanted, sourceSim, sunlit, law)];
		}

		function commitTier() {
			tierDone = true;
			if (!tierRaw) return;
			if (!completedRaw || compareOpeningGroups(tierRaw.stats, completedRaw.stats) > 0) {
				completedRaw = tierRaw;
				completedPlan = {
					homes: shuffleSeatHomes(world.seed, completedRaw.homes),
					stats: completedRaw.stats,
					targetPay: seatTargetPay(completedRaw.stats)
				};
			}
		}

		function currentBestDisplay() {
			let best = tierRaw ? tierRaw.stats : (completedRaw ? completedRaw.stats : null);
			if (!tierDone && walkIdx < walks.length) {
				const live = walks[walkIdx].liveStats();
				if (live && compareOpeningGroups(live, best) > 0) best = live;
			}
			return describeSeatStats(best);
		}

		function currentProgress() {
			if (tierDone || !walks.length) return 1;
			return (walkIdx + walks[walkIdx].progress()) / walks.length;
		}

		function step(budgetMs) {
			const limit = budgetMs === undefined ? Infinity : budgetMs;
			const checkClock = Number.isFinite(limit);
			const started = checkClock ? performance.now() : 0;
			while (limit > 0 && !tierDone) {
				const active = walks[walkIdx];
				if (active.stepUnit()) {
					const out = active.result();
					if (out && compareOpeningGroups(out.stats, tierRaw ? tierRaw.stats : null) > 0) {
						tierRaw = out;
					}
					if (tierRaw && openingGroupAccepted(tierRaw.stats)) {
						commitTier();
						break;
					}
					walkIdx += 1;
					if (walkIdx >= walks.length) {
						commitTier();
						break;
					}
				}
				if (checkClock && performance.now() - started >= limit) break;
			}
			const accepted = Boolean(tierDone && completedRaw &&
				openingGroupAccepted(completedRaw.stats));
			return {
				done: tierDone,
				accepted: accepted,
				tier: currentTier,
				best: currentBestDisplay(),
				progress: currentProgress()
			};
		}

		function advanceTier() {
			if (!canSeat || !tierDone || currentTier >= 2) return false;
			if (completedRaw && openingGroupAccepted(completedRaw.stats)) return false;
			startTier(currentTier + 1);
			return true;
		}

		/* read-only probe for H's decision card (WS4): could a wait-more
		 * click advance right now, without performing the advance */
		function canAdvanceTier() {
			return Boolean(canSeat && tierDone && currentTier < 2 &&
				!(completedRaw && openingGroupAccepted(completedRaw.stats)));
		}

		startTier(0);

		return {
			step: step,
			advanceTier: advanceTier,
			canAdvanceTier: canAdvanceTier,
			get tier() { return currentTier; },
			bestHomes: () => completedPlan ? completedPlan.homes.slice() : null,
			bestStats: () => completedPlan ? completedPlan.stats : null,
			bestPlan: () => completedPlan ? {
				homes: completedPlan.homes.slice(),
				targetPay: completedPlan.targetPay,
				stats: completedPlan.stats
			} : null
		};
	}

	/*
	 * The ordinary career (up to four companies on up to 26 worlds) keeps its
	 * measured walk, so every map it already seats fairly stays as it is. Any
	 * roster beyond it, and any world that walk cannot seat fairly, gets the
	 * wide walk; the better of the two plans wins.
	 */
	function planCareerSeats(world, trade, mask, count, seatsWanted, sourceSim) {
		const search = createSeatSearch(world, trade, mask, count, seatsWanted, sourceSim);
		search.step(Infinity);
		const plan = search.bestPlan();
		return plan ? { homes: plan.homes, targetPay: plan.targetPay } : null;
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

	Object.assign(GravityGame, {
		prepareCareerStarts, rememberSeatPlan, createSeatSearch, planCareerExpansion, pickHq
	});
})(typeof globalThis !== 'undefined' ? globalThis : this);
