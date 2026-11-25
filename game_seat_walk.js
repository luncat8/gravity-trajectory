/*
 * Seat solver 4/5: createHomeWalk, the resumable walk over one search law.
 * not here: tiers, caching and the public search → game_seat_search.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_seat_walk.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		OrbitWorld, SALT_HQ, OPENING_ANGLES, OPENING_SPEEDS, openingTraces, restoreOpeningTraces,
		openingPrepare, openingSyncField, OPENING_PAUSED, fanBounded, openingTraceHome,
		careerOpenings, pickFairHq, hqForbidden, openingTracks, openingGroupBegin, openingGroupStep,
		openingGroupStatsFromRows, compareOpeningGroups, diverseOpeningOrderSteps,
		rankOccupiedScratch, cachedPairTracks, rememberPairTracks, pairTracksKey, scoreSetByPairs,
		openingPairRanked, openingGroupAccepted, OPENING_WIDE_PROPOSALS, openingSiteLight, choose,
		openingWidePool, openingCutoff, openingRiskOrder
	} = inner;

	/* Resumable single-law seat walk (0.7.47 WS4). Every slice advances one
	 * atomic unit — a light-pool planet chunk, one cold/pair trace, a score
	 * chunk, one exact HQ proposal, or one repair step — so chunk boundaries
	 * never skip or reorder work. `step(Infinity)` matches `planHomeSet`
	 * bit-for-bit. */
	function createHomeWalk(world, trade, mask, count, candidates, seatsWanted, sourceSim,
		sunlit, law) {
		const planets = OrbitWorld.PLANETS;
		const light = new Uint8Array(planets);
		const forcedHomes = new Uint8Array(planets);
		const proposalMask = new Uint8Array(planets);
		const pairMask = new Uint8Array(planets);
		const traceBudget = count >= law.roomyCount ? law.roomyTraces : law.traces;
		const maxProposals = law.proposals || OPENING_WIDE_PROPOSALS;
		let phase = candidates.length < seatsWanted ? 'done' : 'light';
		let lightPrepared = false;
		let lightPlanet = 0;
		let lightSites = 0;
		let coldPlanet = 0;
		let coldNextPhase = 'buildSets';
		let sets = null;
		let consider = null;
		let exactLimit = 0;
		let exactIdx = 0;
		let exactTraced = 0;
		let pairKey = '';
		let pairTracks = null;
		let pairA = 0;
		let pairB = 1;
		let pairTrackIdx = 0;
		let exactGroup = null;
		let exactGroupBefore = 0;
		let repairGroup = null;
		let repairReplacement = -1;
		let diverseSteps = null;
		let dfsStack = null;
		let dfsBuilt = null;
		let dfsChosen = null;
		let dfsPool = null;
		let dfsLightBudget = 0;
		let rankIdx = 0;
		let coldRows = null;
		let bestHomes = null;
		let bestStats = null;
		let bestTie = 0xffffffff;
		let repairIdx = 0;
		let result = null;

		/* Set construction (0.7.47 review): the candidate-pool DFS is an
		 * explicit stack advanced by a fixed op budget per unit, so big pools
		 * never build all combinations inside one frame; set order and hashes
		 * are unchanged. */
		function buildSetsBegin() {
			let heavyHomes = 0;
			for (let c = 0; c < candidates.length; c++) if (!light[candidates[c]]) heavyHomes += 1;
			dfsLightBudget = !law.prune ? Infinity
				: Math.max(lightSites - seatsWanted, seatsWanted - heavyHomes, 0);
			dfsPool = law.prune ? openingWidePool(world, trade, mask, count, candidates,
				seatsWanted, sourceSim, light, maxProposals) : candidates;
			dfsChosen = [];
			dfsBuilt = [];
			dfsStack = [{ from: 0, lightUsed: 0, c: 0 }];
		}

		function buildSetsStep() {
			let ops = 0;
			while (dfsStack.length) {
				if (ops >= 8192) return false;
				ops += 1;
				const frame = dfsStack[dfsStack.length - 1];
				const need = seatsWanted - dfsChosen.length;
				if (frame.c > dfsPool.length - need) {
					dfsStack.pop();
					dfsChosen.pop();
					continue;
				}
				const c = frame.c;
				frame.c += 1;
				dfsChosen.push(dfsPool[c]);
				if (dfsChosen.length === seatsWanted) {
					let tie = OrbitWorld.hashBits(world.seed, seatsWanted, SALT_HQ);
					let dim = 0;
					for (let i = 0; i < dfsChosen.length; i++) {
						tie = OrbitWorld.hashBits(tie, dfsChosen[i], SALT_HQ);
						if (sunlit && !sunlit[dfsChosen[i]]) dim += 1;
					}
					dfsBuilt.push({ homes: dfsChosen.slice(), tie: tie, dim: dim });
					dfsChosen.pop();
					continue;
				}
				const childLight = frame.lightUsed + light[dfsPool[c]];
				if (childLight <= dfsLightBudget) {
					dfsStack.push({ from: c + 1, lightUsed: childLight, c: c + 1 });
				} else {
					dfsChosen.pop();
				}
			}
			sets = dfsBuilt;
			dfsStack = null;
			dfsChosen = null;
			dfsPool = null;
			if (!sets.length) {
				phase = 'done';
				return true;
			}
			if (sets.length <= law.batch) {
				consider = sets;
				exactLimit = Math.min(consider.length, law.sets);
				phase = 'exact';
				return true;
			}
			if (openingPairRanked(candidates, seatsWanted, count, law.windowed)) {
				pairKey = pairTracksKey(world, trade, mask, count, candidates, sourceSim);
				pairTracks = cachedPairTracks(pairKey);
				if (pairTracks) {
					rankIdx = 0;
					phase = 'scorePairs';
				} else {
					pairTracks = new Array(planets * planets);
					pairA = 0;
					pairB = 1;
					phase = 'tracePairs';
				}
				return true;
			}
			coldPlanet = 0;
			coldNextPhase = 'scoreColdInit';
			phase = 'warmCold';
			return true;
		}

		function stepUnit() {
			if (phase === 'done') return true;
			if (phase === 'light') {
				if (!lightPrepared) {
					/* the field install is its own unit: a cold prepare plus
					 * sync used to sit inside the first probe chunk */
					openingPrepare(world, trade, mask, count, null, sourceSim);
					openingSyncField(world);
					lightPrepared = true;
					return false;
				}
				openingPrepare(world, trade, mask, count, null, sourceSim);
				openingSyncField(world);
				const end = Math.min(planets, lightPlanet + 1);
				while (lightPlanet < end) {
					if (openingSiteLight(world, mask, lightPlanet)) {
						light[lightPlanet] = 1;
						lightSites += 1;
					}
					lightPlanet += 1;
				}
				if (lightPlanet < planets) return false;
				if (law.prune && choose(candidates.length, seatsWanted) > maxProposals) {
					coldPlanet = 0;
					coldNextPhase = 'buildSets';
					phase = 'warmCold';
					return false;
				}
				buildSetsBegin();
				phase = 'buildSets';
				return false;
			}
			if (phase === 'buildSets') {
				if (!buildSetsStep()) return false;
				return phase === 'done';
			}
			if (phase === 'warmCold') {
				while (coldPlanet < planets &&
					((mask && mask[coldPlanet] === 0) || hqForbidden(world, coldPlanet))) {
					coldPlanet += 1;
				}
				if (coldPlanet < planets) {
					const savedCount = openingTraces();
					openingPrepare(world, trade, mask, count, null, sourceSim);
					const coldProfile = fanBounded(() => openingTraceHome(world, mask, null,
						coldPlanet, true, null, null, null));
					restoreOpeningTraces(savedCount);
					if (coldProfile === OPENING_PAUSED) return false;
					coldPlanet += 1;
					return false;
				}
				if (coldNextPhase === 'buildSets') {
					buildSetsBegin();
					phase = 'buildSets';
					return false;
				}
				coldRows = careerOpenings(world, trade, mask, count, null, sourceSim);
				rankIdx = 0;
				phase = 'scoreCold';
				return false;
			}
			if (phase === 'tracePairs') {
				while (pairA < candidates.length && pairB >= candidates.length) {
					pairA += 1;
					pairB = pairA + 1;
				}
				if (pairA < candidates.length) {
					const homeA = candidates[pairA];
					const homeB = candidates[pairB];
					if (pairTrackIdx === 0) {
						pairMask.fill(0);
						pairMask[homeA] = 1;
						pairMask[homeB] = 1;
						openingPrepare(world, trade, mask, count, pairMask, sourceSim);
						const trackA = fanBounded(() => openingTracks(
							world, mask, pairMask, homeA, OPENING_ANGLES, OPENING_SPEEDS, false));
						if (trackA === OPENING_PAUSED) return false;
						pairTracks[homeA * planets + homeB] = trackA;
						pairTrackIdx = 1;
					}
					if (pairTrackIdx === 1) {
						pairMask.fill(0);
						pairMask[homeA] = 1;
						pairMask[homeB] = 1;
						openingPrepare(world, trade, mask, count, pairMask, sourceSim);
						const trackB = fanBounded(() => openingTracks(
							world, mask, pairMask, homeB, OPENING_ANGLES, OPENING_SPEEDS, false));
						if (trackB === OPENING_PAUSED) return false;
						pairTracks[homeB * planets + homeA] = trackB;
						pairTrackIdx = 0;
					}
					pairB += 1;
					return false;
				}
				rememberPairTracks(pairKey, pairTracks);
				rankIdx = 0;
				phase = 'scorePairs';
				return false;
			}
			if (phase === 'scorePairs') {
				const end = Math.min(sets.length, rankIdx + 16);
				while (rankIdx < end) {
					scoreSetByPairs(mask, pairTracks, sets[rankIdx], law.windowed);
					rankIdx += 1;
				}
				if (rankIdx < sets.length) return false;
				diverseSteps = diverseOpeningOrderSteps(sets);
				phase = 'diversify';
				return false;
			}
			if (phase === 'scoreCold') {
				const occupied = rankOccupiedScratch;
				const end = Math.min(sets.length, rankIdx + 16);
				while (rankIdx < end) {
					const proposal = sets[rankIdx];
					occupied.fill(0);
					for (let h = 0; h < proposal.homes.length; h++) occupied[proposal.homes[h]] = 1;
					proposal.rank = openingGroupStatsFromRows(mask, coldRows, proposal.homes,
						occupied, law.windowed);
					proposal.rank.dim = proposal.dim || 0;
					rankIdx += 1;
				}
				if (rankIdx < sets.length) return false;
				diverseSteps = diverseOpeningOrderSteps(sets);
				phase = 'diversify';
				return false;
			}
			if (phase === 'diversify') {
				const stepOut = diverseSteps.next();
				if (!stepOut.done) return false;
				consider = stepOut.value;
				diverseSteps = null;
				exactLimit = Math.min(consider.length, law.sets);
				phase = 'exact';
				return false;
			}
			if (phase === 'exact') {
				if (exactIdx >= exactLimit) {
					finishExact();
					return phase === 'done';
				}
				const proposal = consider[exactIdx];
				const cutoff = law.windowed ? openingCutoff(bestStats) : undefined;
				if (!exactGroup) {
					proposalMask.fill(0);
					for (let j = 0; j < proposal.homes.length; j++) proposalMask[proposal.homes[j]] = 1;
					exactGroup = openingGroupBegin(world, trade, mask, count,
						proposalMask, proposal.homes, sourceSim, law.windowed, cutoff,
						cutoff === undefined ? null : openingRiskOrder(proposal));
					exactGroupBefore = openingTraces();
				}
				const exact = fanBounded(() => openingGroupStep(exactGroup));
				if (exact === OPENING_PAUSED) return false;
				exactGroup = null;
				exactTraced += (openingTraces() - exactGroupBefore) * count;
				if (exact) exact.dim = proposal.dim || 0;
				const better = exact ? compareOpeningGroups(exact, bestStats) : -1;
				if (better > 0 || (better === 0 && proposal.tie < bestTie)) {
					bestHomes = proposal.homes.slice();
					bestStats = exact;
					bestTie = proposal.tie;
				}
				exactIdx += 1;
				const batchDone = exactIdx % law.batch === 0 || exactIdx === exactLimit;
				if (batchDone && (openingGroupAccepted(bestStats) || exactIdx >= law.miss ||
					exactTraced >= traceBudget)) {
					finishExact();
					return phase === 'done';
				}
				return false;
			}
			if (phase === 'repair') {
				if (bestStats.missing <= 0 || repairIdx >= seatsWanted) {
					finalizeWalk();
					return true;
				}
				const badHome = bestStats.missingHomes[0];
				const seat = bestHomes.indexOf(badHome);
				if (seat < 0) {
					finalizeWalk();
					return true;
				}
				if (!repairGroup) {
					forcedHomes[badHome] = 0;
					repairReplacement = pickFairHq(world.seed + seat + repairIdx, world,
						forcedHomes, mask, count, trade, sourceSim);
					if (repairReplacement < 0 || repairReplacement === badHome) {
						forcedHomes[badHome] = 1;
						finalizeWalk();
						return true;
					}
					bestHomes[seat] = repairReplacement;
					forcedHomes[repairReplacement] = 1;
					repairGroup = openingGroupBegin(world, trade, mask, count, forcedHomes,
						bestHomes, sourceSim, law.windowed, undefined, null);
				}
				const repaired = fanBounded(() => openingGroupStep(repairGroup));
				if (repaired === OPENING_PAUSED) return false;
				repairGroup = null;
				if (law.relaxed && compareOpeningGroups(repaired, bestStats) < 0) {
					forcedHomes[repairReplacement] = 0;
					forcedHomes[badHome] = 1;
					bestHomes[seat] = badHome;
					finalizeWalk();
					return true;
				}
				bestStats = repaired;
				repairIdx += 1;
				if (bestStats.missing <= 0 || repairIdx >= seatsWanted) {
					finalizeWalk();
					return true;
				}
				return false;
			}
			return true;
		}

		function finishExact() {
			if (!bestHomes) {
				phase = 'done';
				return;
			}
			forcedHomes.fill(0);
			for (let i = 0; i < bestHomes.length; i++) forcedHomes[bestHomes[i]] = 1;
			if (bestStats.missing > 0 && seatsWanted > 0) {
				repairIdx = 0;
				phase = 'repair';
				return;
			}
			finalizeWalk();
		}

		function finalizeWalk() {
			phase = 'done';
			if (!bestHomes || (bestStats.missing > 0 && !law.relaxed)) {
				result = null;
				return;
			}
			result = { homes: bestHomes, stats: bestStats };
		}

		function progress() {
			if (phase === 'done') return 1;
			if (phase === 'light') return 0.05 * (lightPlanet / planets);
			if (phase === 'warmCold') {
				return (coldNextPhase === 'buildSets' ? 0.05 : 0.15) + 0.10 * (coldPlanet / planets);
			}
			if (phase === 'tracePairs') {
				const totalPairs = Math.max(1, candidates.length * (candidates.length - 1) / 2);
				const donePairs = pairA * (2 * candidates.length - pairA - 1) / 2 +
					Math.max(0, pairB - pairA - 1);
				return 0.05 + 0.25 * Math.min(1, donePairs / totalPairs);
			}
			if (phase === 'scorePairs' || phase === 'scoreCold') {
				return 0.30 + 0.05 * (sets && sets.length ? rankIdx / sets.length : 1);
			}
			if (phase === 'diversify') return 0.35;
			if (phase === 'buildSets') return 0.25;
			if (phase === 'exact') {
				const bySet = exactLimit > 0 ? exactIdx / Math.min(exactLimit, law.miss) : 1;
				const byTrace = Number.isFinite(traceBudget) && traceBudget > 0
					? exactTraced / traceBudget : 0;
				return 0.35 + 0.60 * Math.min(1, Math.max(bySet, byTrace));
			}
			return 0.95;
		}

		return {
			stepUnit: stepUnit,
			done: () => phase === 'done',
			result: () => result,
			liveStats: () => bestStats,
			progress: progress
		};
	}

	Object.assign(inner, {
		createHomeWalk
	});
});
