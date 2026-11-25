/*
 * Seat solver 3/5: proposal orders, cold and pair-track ranking, the search
 * laws, the pair-track cache, and the map composition rule.
 * not here: the walk over one law → game_seat_walk.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_seat_rank.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitTech, PlanetGravity, SPEED_STEPS, CAP_STEPS, planetGravity,
		angleUnits, angleOf, specialPlanetsOn, OPENING_ANGLES, OPENING_SPEEDS, OPENING_EXIT_ANGLES,
		OPENING_EXIT_FRACTIONS, OPENING_HORIZON, OPENING_COMPARE_EPS, OPENING_FAIR_RATIO,
		OPENING_RATIO_EPS, openingExtent, openingPrepare, exitSpeedHasMargin, openingStarterCanExit,
		careerOpenings, openingMaskBits, openingTracks, planetInMask, openingGroupStatsFromRows,
		openingRatio, compareOpeningGroups
	} = inner;

	/*
	 * Seat search for one candidate pool. A final three-HQ field has 220 sets
	 * in the ordinary 13-world career, and flying every fan in every set blocks
	 * map load for several seconds. Rank those sets first from pair-pinned
	 * fields: for each seat, the union of its two one-neighbour traces predicts
	 * the routes that either of the other HQs can bend into reach. This catches
	 * the important pin interaction that an unpinned table misses (including a
	 * rare fair set that otherwise ranks near the bottom), at one fifth of the
	 * full trace count. Exact final-field checks are still the authority.
	 *
	 * More than one ranking family is interleaved so equal or noisy proxy scores
	 * cannot hide a useful set. Exact checks run in deterministic batches until
	 * one set satisfies the actual fairness and starter-exit contract; if none
	 * does, the ordinary career exhausts all 220 sets and keeps the best one.
	 */
	const OPENING_FAMILY_DEPTH = 4;
	const OPENING_PAIR_CANDIDATES_MAX = 14;
	const OPENING_ORDERS = [
		/* the map's own objective */
		(a, b) => compareOpeningGroups(a, b),
		/* "nobody is starving": the biggest weakest seat first */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Number.isFinite(a.minPay) && Number.isFinite(b.minPay) &&
				Math.abs(a.minPay - b.minPay) > OPENING_COMPARE_EPS) {
				return a.minPay > b.minPay ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		},
		/* "closest band": the best ratio a distinct seating could ever reach */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Number.isFinite(a.peak) && Number.isFinite(b.peak) &&
				Math.abs(a.peak - b.peak) > OPENING_RATIO_EPS) {
				return a.peak > b.peak ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		},
		/* "the map is rich": the highest combined opening */
		(a, b) => {
			if (a.missing !== b.missing) return b.missing - a.missing;
			if (a.distinct !== b.distinct) return a.distinct ? 1 : -1;
			if (a.exitOk !== b.exitOk) return a.exitOk ? 1 : -1;
			if (Math.abs(a.sumPay - b.sumPay) > OPENING_COMPARE_EPS) {
				return a.sumPay > b.sumPay ? 1 : -1;
			}
			return compareOpeningGroups(a, b);
		}
	];

	function openingProposalSort(order) {
		return function (left, right) {
			const better = order(left.rank, right.rank);
			if (better !== 0) return -better;
			return left.tie - right.tie;
		};
	}

	/* Put four leaders from each reading first, then the map objective's full
	 * order. Object identity is enough here: every proposal is created once.
	 * One yield per family so a background search can spend a frame on a
	 * single sort; the sync wrapper below drains the same generator. */
	function* stableSortSteps(values, cmp) {
		/* One family sort per yield so the walk spends a frame on it. The sort
		 * stays whole-array on purpose: the family comparators band fields with
		 * epsilon fall-throughs, so they are not transitive and chunk-merge
		 * sorting produced a different (also valid) order — which moved a
		 * saved-map plan (make_saved_maps --check caught seed 4). The pinned
		 * baseline order is V8's Array.sort on the full array; keep it. */
		const sorted = values.slice().sort(cmp);
		yield false;
		return sorted;
	}

	function* diverseOpeningOrderSteps(sets) {
		const families = [];
		for (let i = 0; i < OPENING_ORDERS.length; i++) {
			families.push(yield* stableSortSteps(sets, openingProposalSort(OPENING_ORDERS[i])));
		}
		const ordered = [];
		const seen = new Set();
		for (let depth = 0; depth < OPENING_FAMILY_DEPTH; depth++) {
			for (let family = 0; family < families.length; family++) {
				const proposal = families[family][depth];
				if (proposal && !seen.has(proposal)) {
					seen.add(proposal);
					ordered.push(proposal);
				}
			}
		}
		for (let i = 0; i < families[0].length; i++) {
			const proposal = families[0][i];
			if (seen.has(proposal)) continue;
			seen.add(proposal);
			ordered.push(proposal);
		}
		return ordered;
	}

	function diverseOpeningOrder(sets) {
		const steps = diverseOpeningOrderSteps(sets);
		let out = steps.next();
		while (!out.done) out = steps.next();
		return out.value;
	}

	const rankOccupiedScratch = new Uint8Array(OrbitWorld.PLANETS);
	const rankSitePayScratch = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
	const rankRowsScratch = { sitePay: rankSitePayScratch, targetPay: rankSitePayScratch };
	let lastPairTracksKey = '';
	let lastPairTracks = null;

	function cachedPairTracks(key) {
		return key === lastPairTracksKey ? lastPairTracks : null;
	}

	function rememberPairTracks(key, tracks) {
		lastPairTracksKey = key;
		lastPairTracks = tracks;
	}

	/* Baseline rank for a large custom pool: one unpinned trace table. */
	function rankOpeningSetsCold(world, trade, mask, count, sets, sourceSim, windowed) {
		const rows = careerOpenings(world, trade, mask, count, null, sourceSim);
		const occupied = rankOccupiedScratch;
		for (let i = 0; i < sets.length; i++) {
			const proposal = sets[i];
			occupied.fill(0);
			for (let h = 0; h < proposal.homes.length; h++) occupied[proposal.homes[h]] = 1;
			proposal.rank = openingGroupStatsFromRows(mask, rows, proposal.homes, occupied, windowed);
			proposal.rank.dim = proposal.dim || 0;
		}
		return diverseOpeningOrder(sets);
	}

	function pairTracksKey(world, trade, mask, count, candidates, sourceSim) {
		const field = PlanetGravity.armed();
		const fieldTag = field && field.seed === (world.seed >>> 0) ? field.tag : 0;
		return (world.seed >>> 0) + ':' + (trade.seed >>> 0) + ':' + trade.t.toFixed(3) + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			openingMaskBits(mask) + ':' + count + ':' + (specialPlanetsOn() ? 1 : 0) + ':' +
			candidates.join(',') + (fieldTag ? ':' + fieldTag : '');
	}

	function buildPairTracks(world, trade, mask, count, candidates, sourceSim) {
		const key = pairTracksKey(world, trade, mask, count, candidates, sourceSim);
		if (key === lastPairTracksKey && lastPairTracks) return lastPairTracks;
		const planets = OrbitWorld.PLANETS;
		const pairTracks = new Array(planets * planets);
		const pairMask = new Uint8Array(planets);
		for (let a = 0; a < candidates.length; a++) {
			const homeA = candidates[a];
			for (let b = a + 1; b < candidates.length; b++) {
				const homeB = candidates[b];
				pairMask.fill(0);
				pairMask[homeA] = 1;
				pairMask[homeB] = 1;
				openingPrepare(world, trade, mask, count, pairMask, sourceSim);
				pairTracks[homeA * planets + homeB] = openingTracks(
					world, mask, pairMask, homeA, OPENING_ANGLES, OPENING_SPEEDS, false);
				pairTracks[homeB * planets + homeA] = openingTracks(
					world, mask, pairMask, homeB, OPENING_ANGLES, OPENING_SPEEDS, false);
			}
		}
		lastPairTracksKey = key;
		lastPairTracks = pairTracks;
		return pairTracks;
	}

	function scoreSetByPairs(mask, pairTracks, proposal, windowed) {
		const planets = OrbitWorld.PLANETS;
		const homes = proposal.homes;
		const occupied = rankOccupiedScratch;
		const sitePay = rankSitePayScratch;
		occupied.fill(0);
		for (let h = 0; h < homes.length; h++) occupied[homes[h]] = 1;
		sitePay.fill(-Infinity);
		for (let seat = 0; seat < homes.length; seat++) {
			const home = homes[seat];
			const row = home * planets;
			for (let body = 0; body < planets; body++) {
				let best = -Infinity;
				for (let other = 0; other < homes.length; other++) {
					if (other === seat) continue;
					const track = pairTracks[row + homes[other]];
					if (track && track.sitePay[row + body] > best) {
						best = track.sitePay[row + body];
					}
				}
				sitePay[row + body] = best;
			}
		}
		proposal.rank = openingGroupStatsFromRows(mask, rankRowsScratch, homes, occupied,
			windowed);
		proposal.rank.dim = proposal.dim || 0;
	}

	/*
	 * Pair-pinned proxy for the ordinary career pool. A seat's final row is the
	 * union (best pay per site) of the rows made by pinning it with each other
	 * proposed HQ. It is deliberately optimistic: its job is to put plausible
	 * sets in front of the exact scorer, never to approve a map itself.
	 */
	function rankOpeningSetsByPairs(world, trade, mask, count, sets, candidates,
		sourceSim, windowed) {
		const pairTracks = buildPairTracks(world, trade, mask, count, candidates, sourceSim);
		for (let i = 0; i < sets.length; i++) {
			scoreSetByPairs(mask, pairTracks, sets[i], windowed);
		}
		return diverseOpeningOrder(sets);
	}

	/* Pair tracks cost a fifth of a full trace per set but fly every pair of a
	 * small pool. The ordinary walk always pays for them; a wide walk reuses
	 * them where that walk ran first, and ranks cold otherwise. */
	function openingPairRanked(candidates, seatsWanted, count, windowed) {
		if (seatsWanted <= 1 || candidates.length > OPENING_PAIR_CANDIDATES_MAX) return false;
		return !windowed || (seatsWanted <= 4 && count <= 26);
	}

	function rankOpeningSets(world, trade, mask, count, sets, candidates, seatsWanted,
		sourceSim, windowed) {
		if (openingPairRanked(candidates, seatsWanted, count, windowed)) {
			return rankOpeningSetsByPairs(world, trade, mask, count, sets, candidates, sourceSim,
				windowed);
		}
		return rankOpeningSetsCold(world, trade, mask, count, sets, sourceSim, windowed);
	}

	function openingGroupAccepted(stats) {
		return stats && stats.missing === 0 && stats.distinct && stats.exitOk &&
			openingRatio(stats) >= OPENING_FAIR_RATIO;
	}
	/* proposals a wide walk ranks; the pool shrinks until its sets fit */
	const OPENING_WIDE_PROPOSALS = 20000;

	/* A free planet a first EMC can leave with margin: not the Capital, and
	 * the starter rail clears 75 % of its cap from there on the prepared
	 * drawn field — callers openingPrepare (+ openingSyncField) first. */
	function openingSiteLight(world, mask, planet) {
		if (!planetInMask(mask, planet)) return false;
		if (specialPlanetsOn() && planet === world.capitalPlanet) return false;
		return openingStarterCanExit(planet);
	}

	/* Composition rule (0.7.47 WS2): can this roster be fair at all? A pure
	 * function of the drawn field — mask applied, specials at g 1.00 — so the
	 * page can warn before the seat search and the fairness script can skip
	 * seeds that never had a chance. Light uses the margin law (a new rail
	 * must leave with a quarter in hand); heavies count worlds the starter
	 * rail cannot leave at all, split by the plan's shared vocabulary:
	 * heavy >= EMC2 — EMC-1 cannot leave it, EMC-2 kit can at <= 75 %;
	 * heavy > EMC2 — EMC-2 cannot leave it, EMC-3 kit can at <= 75 %.
	 * Negatives are capability (a full-power exit is still a physical exit,
	 * so an EMC-2 escape never enters the > EMC2 branch); positives are the
	 * margin law (a launch class must not rest on one lucky full-power
	 * trajectory). The kits keep the paired batteries, not the vocabulary's
	 * BAT-1: 0.75 of EMC-2 + BAT-1's cap (89 px/s) sits below the starter's
	 * own cap (92 px/s), so no heavy could ever clear that tier and both
	 * BAT-1 classes measure empty — the margin clause of the vocabulary wins
	 * over the battery noun, recalibrated per the 0.7.47 review. Memoised
	 * per field stamp. */
	const compositionCache = new Map();
	const COMPOSITION_CACHE_MAX = 8;
	let compositionSim = null;
	let compositionStrengths = null;
	let compositionWorld = null;

	function compositionFill(t, outX, outY, n) {
		const w = compositionWorld;
		for (let i = 0; i < n; i++) {
			outX[i] = w.planetX[i];
			outY[i] = w.planetY[i];
		}
	}

	function compositionKey(world, mask, count, sourceSim) {
		const field = PlanetGravity.armed();
		const fieldTag = field && field.seed === (world.seed >>> 0) ? field.tag : 0;
		return (world.seed >>> 0) + ':' + openingMaskBits(mask) + ':' + count + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			(specialPlanetsOn() ? 1 : 0) + (fieldTag ? ':' + fieldTag : '');
	}

	function compositionExitSpeed(planet, cap) {
		const sim = compositionSim;
		if (!sim.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
		let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		let previous = -1;
		for (let f = 0; f < OPENING_EXIT_FRACTIONS.length; f++) {
			const speedU = f === OPENING_EXIT_FRACTIONS.length - 1
				? capU : Math.max(minU, Math.round(capU * OPENING_EXIT_FRACTIONS[f]));
			if (speedU === previous) continue;
			previous = speedU;
			const speed = speedU / SPEED_STEPS;
			for (let a = 0; a < OPENING_EXIT_ANGLES; a++) {
				const angle = angleOf(angleUnits((a + 0.5) / OPENING_EXIT_ANGLES * Math.PI * 2));
				sim.predictFast(planet, angle, speed, OPENING_HORIZON);
				if (sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0 &&
					sim.predBody !== planet) return speed;
			}
		}
		return 0;
	}

	function compositionCounts(world, mask, count, sourceSim) {
		const key = compositionKey(world, mask, count, sourceSim);
		const cached = compositionCache.get(key);
		if (cached) return cached;
		if (compositionSim === null) {
			compositionSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
			compositionStrengths = new Float64Array(GravitySim.MAX_BODIES);
		}
		compositionWorld = world;
		compositionSim.setPlanets(OrbitWorld.PLANETS, world.planetX, world.planetY, world.planetR,
			world.orbitRX, world.orbitRY, world.orbitTiltCos, world.orbitTiltSin);
		const gravityScale = sourceSim && Number.isFinite(sourceSim.gravityScale)
			? sourceSim.gravityScale : 1;
		const forceScale = sourceSim && Number.isFinite(sourceSim.forceScale)
			? sourceSim.forceScale : 1;
		compositionSim.setScales(gravityScale, forceScale);
		compositionSim.setPlanetMask(mask);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) compositionStrengths[i] = 0;
			else if (specialPlanetsOn() && (i === world.capitalPlanet || i === world.arfPlanet)) {
				compositionStrengths[i] = 1;
			} else compositionStrengths[i] = planetGravity(world.seed, i);
		}
		compositionSim.setField(openingExtent(mask), world.planetR, compositionStrengths,
			compositionFill, true);
		compositionSim.fieldT = 0;
		compositionSim.fieldRate = 1;
		compositionSim.stepLimit = CAP_STEPS;
		const cap1 = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], forceScale);
		const cap2 = OrbitTech.speedLimit(OrbitTech.BATTERIES[1].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[1], forceScale);
		const cap3 = OrbitTech.speedLimit(OrbitTech.BATTERIES[2].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[2], forceScale);
		let light = 0, heavyEmc2 = 0, heavyEmc3 = 0, heavies = 0;
		for (let planet = 0; planet < OrbitWorld.PLANETS; planet++) {
			if (mask && mask[planet] === 0) continue;
			if (specialPlanetsOn() && (planet === world.capitalPlanet || planet === world.arfPlanet)) continue;
			const s1 = compositionExitSpeed(planet, cap1);
			if (exitSpeedHasMargin(s1, cap1)) { light += 1; continue; }
			if (s1 > 0) continue;
			heavies += 1;
			const s2 = compositionExitSpeed(planet, cap2);
			if (exitSpeedHasMargin(s2, cap2)) { heavyEmc2 += 1; continue; }
			/* a full-power EMC-2 escape is still an escape: EMC-2 can leave
			 * the world, so it is not the "EMC-2 cannot" class either */
			if (s2 > 0) continue;
			const s3 = compositionExitSpeed(planet, cap3);
			if (exitSpeedHasMargin(s3, cap3)) heavyEmc3 += 1;
		}
		const counts = { light: light, heavyEmc2: heavyEmc2, heavyEmc3: heavyEmc3, heavies: heavies };
		compositionCache.set(key, counts);
		if (compositionCache.size > COMPOSITION_CACHE_MAX) {
			compositionCache.delete(compositionCache.keys().next().value);
		}
		return counts;
	}

	/* `startMode` is 'planet' (default), 'space' or 'capital'. The weakened
	 * starts drop the HQ term and the count gate; the rest is the same. */
	function startComposition(world, mask, count, players, sourceSim, startMode) {
		const mode = startMode === 'space' || startMode === 'capital' ? startMode : 'planet';
		const seats = Math.max(0, Math.floor(players));
		const specials = specialPlanetsOn() ? 2 : 0;
		const minimal = mode === 'planet' ? 2 * seats + specials + 2 : seats + specials + 2;
		const counts = compositionCounts(world, mask, count, sourceSim);
		const missing = [];
		if (mode === 'planet' && count < minimal) missing.push('planets');
		if (counts.light < seats) missing.push('light');
		if (specialPlanetsOn()) {
			const capitalIn = world.capitalPlanet >= 0 && world.capitalPlanet < OrbitWorld.PLANETS &&
				planetInMask(mask, world.capitalPlanet);
			const arfIn = world.arfPlanet >= 0 && world.arfPlanet < OrbitWorld.PLANETS &&
				planetInMask(mask, world.arfPlanet);
			if (!capitalIn || !arfIn) missing.push('specials');
		}
		if (counts.heavyEmc2 < 1) missing.push('emc2');
		if (counts.heavyEmc3 < 1) missing.push('emc3');
		return {
			ok: missing.length === 0,
			minimal: minimal,
			light: counts.light,
			heavyEmc2: counts.heavyEmc2,
			heavyEmc3: counts.heavyEmc3,
			heavies: counts.heavies,
			additional: count > minimal ? count - minimal : 0,
			missing: missing
		};
	}

	function choose(n, k) {
		let total = 1;
		for (let i = 0; i < k; i++) total = total * (n - i) / (i + 1);
		return total;
	}

	/*
	 * The homes a wide walk combines. A heavy home is pinned to g 1.00 and
	 * costs no light site, a light home takes one away from the first
	 * landings, so heavy and light homes are ranked apart by their unpinned
	 * opening and the pool keeps the best of each until its sets fit.
	 */
	function openingWidePool(world, trade, mask, count, candidates, seatsWanted, sourceSim,
		light, maxProposals) {
		const cap = maxProposals || OPENING_WIDE_PROPOSALS;
		if (choose(candidates.length, seatsWanted) <= cap) return candidates;
		const rows = careerOpenings(world, trade, mask, count, null, sourceSim);
		const byOpening = (a, b) => (rows.buildable[b] > 0) - (rows.buildable[a] > 0) ||
			rows.buildPay[b] - rows.buildPay[a] || a - b;
		const heavy = candidates.filter(home => !light[home]).sort(byOpening);
		const lit = candidates.filter(home => light[home]).sort(byOpening);
		let size = seatsWanted;
		while (size < candidates.length && choose(size + 1, seatsWanted) <= cap) {
			size += 1;
		}
		const keepHeavy = Math.min(heavy.length, Math.max(seatsWanted + 2, Math.ceil(size / 2)));
		const pool = heavy.slice(0, keepHeavy).concat(lit.slice(0, size - keepHeavy));
		return pool.length >= seatsWanted ? pool : candidates.slice(0, size);
	}

	/*
	 * Once a wide walk holds a distinct exit-safe seating only a better ratio
	 * matters: a set below the best by more than the tie band loses the
	 * comparison, so its trace can stop early. Before that every set is read
	 * whole, since a cramped world's fallback ranks the shared seatings too.
	 */
	function openingCutoff(bestStats) {
		if (!bestStats || !bestStats.distinct || !bestStats.exitOk) return undefined;
		return openingRatio(bestStats) - OPENING_RATIO_EPS;
	}

	/* seats in the order most likely to sink the set: the proxy's poorest first */
	function openingRiskOrder(proposal) {
		const order = [];
		for (let seat = 0; seat < proposal.homes.length; seat++) order.push(seat);
		const assign = proposal.rank && proposal.rank.assign;
		if (!assign) return order;
		return order.sort((a, b) => assign.pays[a] - assign.pays[b] || a - b);
	}

	Object.assign(GravityGame, {
		startComposition
	});
	Object.assign(inner, {
		diverseOpeningOrderSteps, rankOccupiedScratch, cachedPairTracks, rememberPairTracks,
		pairTracksKey, scoreSetByPairs, openingPairRanked, openingGroupAccepted,
		OPENING_WIDE_PROPOSALS, openingSiteLight, choose, openingWidePool, openingCutoff,
		openingRiskOrder
	});
});
