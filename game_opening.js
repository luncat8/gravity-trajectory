/*
 * Seat solver 1/5: single-home opening fans, the exit-speed margin, opening
 * rows and tracks, and the fan budget counter.
 * not here: set statistics → game_seat_stats.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_opening.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitTech, PlanetGravity, SPEED_STEPS, CAP_SECONDS, MONEY,
		planetGravity, angleUnits, angleOf, speedOf, CAREER, SALT_HQ, specialPlanetsOn, createMarket,
		resetMarket, applyMarketSpecials, estimateProfitLog, applyMarketUniverse, deriveEmptyWorlds
	} = inner;

	/* Conservative gravity band used for seeded HQ fallbacks. Opening landing
	 * eligibility uses the measured EMC-1 + BAT-1 exit probe below instead. */
	const HQ_GRAVITY_MAX = 1;

	/* --- career map generator: fair first flights and useful first landings --- */

	/*
	 * A first flight needs to do two things: pay roughly as well as the other
	 * companies' openings, and end on a free planet the starter EMC-1 + BAT-1
	 * can leave again — with margin. Eligibility is the exit probe, not a
	 * gravity number: a new rail must not become a dead-end claim, and an
	 * exit that only appears at full power (or on one lucky bearing) is not
	 * an exit a first landing may rely on.
	 */
	const OPENING_ANGLES = 8;
	const OPENING_SPEEDS = 4;
	const OPENING_EXIT_ANGLES = 16;
	const OPENING_EXIT_FRACTIONS = [0.75, 1];
	const OPENING_HORIZON = CAP_SECONDS;
	const OPENING_BANDS = [0.85, 0.7, 0.5, 0.25, 0];
	const OPENING_CACHE_MAX = 8;
	const OPENING_COMPARE_EPS = 0.01;
	/* the band a map aims for: weakest company earns this share of the best */
	const OPENING_FAIR_RATIO = 0.55;
	const OPENING_RATIO_EPS = 0.02;
	const OPENING_RATIO_ROUNDS = 3;
	const openingCache = new Map();
	const openingSeen = new Uint8Array(OrbitWorld.PLANETS);
	const openingTargetPay = new Float64Array(OrbitWorld.PLANETS);
	const openingAnyTargetPay = new Float64Array(OrbitWorld.PLANETS);
	const openingResult = { reach: 0, light: 0, pay: 0, openPay: 0, buildable: 0, buildPay: 0 };
	/* Starter exits of the prepared field (-1 unknown). A pinned home's trace
	 * flies that very field, so every seat of one set shares the answer. */
	const openingExitMemo = new Int8Array(OrbitWorld.PLANETS);
	/* fans flown so far: the wide walk's budget is counted in them */
	let openingTraceCount = 0;
	let openingSim = null;
	const openingMarket = createMarket();
	let openingStrengths = null;
	let openingTrade = null;
	let openingGravityScale = 1;
	let openingForceScale = 1;
	let openingFieldMask = null;

	function openingTraces() {
		return openingTraceCount;
	}

	function restoreOpeningTraces(count) {
		openingTraceCount = count;
	}

	function openingMaskTag(mask, count) {
		let tag = Math.imul(count + 1, 0x01000193) >>> 0;
		if (!mask) return tag;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			tag = Math.imul(tag ^ (mask[i] ? i + 1 : 0), 0x01000193) >>> 0;
		}
		return tag;
	}

	function openingExtent(mask) {
		let extent = OrbitWorld.PLANETS;
		while (extent > 0 && mask && !mask[extent - 1]) extent--;
		return extent;
	}

	/* The shared scratch sim follows the current trade world, not the first
	 * world that happened to initialize it. A new seed replaces all geometry. */
	function openingFill(t, outX, outY, count) {
		const trade = openingTrade;
		for (let i = 0; i < count; i++) {
			outX[i] = trade.planetX[i];
			outY[i] = trade.planetY[i];
		}
	}

	function openingEnsureSim(trade) {
		if (openingSim === null) {
			openingSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
			openingStrengths = new Float64Array(GravitySim.MAX_BODIES);
		}
		openingTrade = trade;
		openingSim.setPlanets(OrbitWorld.PLANETS, trade.planetX, trade.planetY, trade.planetR,
			trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	}

	function openingFillEmpty(market, world, trade, mask, count) {
		if (trade && trade.emptyMask) {
			market.empty.set(trade.emptyMask);
			market.heavy.set(trade.colonyGravityMask || trade.emptyMask);
			return;
		}
		deriveEmptyWorlds(market, mask, count, world);
	}

	function openingPrepare(world, trade, mask, count, forcedHomes, sourceSim) {
		openingEnsureSim(trade);
		openingGravityScale = sourceSim && Number.isFinite(sourceSim.gravityScale)
			? sourceSim.gravityScale : 1;
		openingForceScale = sourceSim && Number.isFinite(sourceSim.forceScale)
			? sourceSim.forceScale : 1;
		openingSim.setScales(openingGravityScale, openingForceScale);
		openingSim.setPlanetMask(mask);
		openingFieldMask = mask;
		openingExitMemo.fill(-1);
		resetMarket(openingMarket);
		applyMarketUniverse(openingMarket, mask, count);
		applyMarketSpecials(openingMarket, world);
		/* the planning probes price empty worlds at zero payout and trace
		 * them under the heavy band's wells */
		openingFillEmpty(openingMarket, world, trade, mask, count);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) openingStrengths[i] = 0;
			else if (specialPlanetsOn() && (i === world.capitalPlanet || i === world.arfPlanet)) {
				openingStrengths[i] = 1;
			} else if (forcedHomes && forcedHomes[i]) openingStrengths[i] = 1;
			else if (openingMarket.heavy[i] === 1) openingStrengths[i] = PlanetGravity.emptyGravity(world.seed, i);
			else openingStrengths[i] = planetGravity(world.seed, i);
		}
	}

	/* Install the prepared strengths on the sim for probes outside a trace
	 * (the light/home pools); every trace re-sets the field itself. */
	let openingActiveExitMemo = openingExitMemo;
	const openingFieldExitCache = new Map();
	const OPENING_FIELD_EXIT_MAX = 256;

	function openingFieldEntry(world, mask, extent) {
		let lo = Math.imul((world.seed >>> 0) ^ extent, 0x01000193) >>> 0;
		let hi = Math.imul(openingTrade ? (openingTrade.seed >>> 0) : 1, 0x9e3779b1) >>> 0;
		lo = Math.imul(lo ^ Math.round(openingGravityScale * 10000), 0x01000193) >>> 0;
		hi = Math.imul(hi ^ Math.round(openingForceScale * 10000), 0x85ebca6b) >>> 0;
		lo = Math.imul(lo ^ openingMaskTag(mask, extent), 0x01000193) >>> 0;
		const marketCount = openingMarket && Number.isFinite(openingMarket.planetCount)
			? openingMarket.planetCount : extent;
		hi = Math.imul(hi ^ (marketCount * 257 + (specialPlanetsOn() ? 1 : 0)), 0x85ebca6b) >>> 0;
		lo = Math.imul(lo ^ Math.round(MONEY.initSec * 100), 0x01000193) >>> 0;
		for (let i = 0; i < extent; i++) {
			const v = Math.round(openingStrengths[i] * 1000000) | 0;
			lo = Math.imul(lo ^ (v + i * 31), 0x01000193) >>> 0;
			hi = Math.imul(hi ^ (v ^ (i * 131)), 0x85ebca6b) >>> 0;
		}
		const key = (hi & 0x1fffff) * 4294967296 + lo;
		let entry = openingFieldExitCache.get(key);
		if (!entry) {
			const memo = new Int8Array(OrbitWorld.PLANETS);
			memo.fill(-1);
			entry = { memo: memo, fans: new Map() };
			openingFieldExitCache.set(key, entry);
			if (openingFieldExitCache.size > OPENING_FIELD_EXIT_MAX) {
				openingFieldExitCache.delete(openingFieldExitCache.keys().next().value);
			}
		}
		return entry;
	}

	function openingSyncField(world) {
		const extent = openingExtent(openingFieldMask);
		const entry = world ? openingFieldEntry(world, openingFieldMask, extent) : null;
		if (!entry || openingInstalledEntry !== entry) {
			openingSim.setField(extent, openingTrade.planetR, openingStrengths, openingFill, true);
			openingInstalledEntry = entry;
		}
		openingActiveExitMemo = entry ? entry.memo : openingExitMemo;
	}

	/* An exit counts for a *new* rail only with a quarter of the kit's power
	 * in hand; the half-step slack absorbs the speed-snap. Capability callers
	 * (an existing rail, a heavy classification) only ask speed > 0. */
	function exitSpeedHasMargin(speed, cap) {
		return speed > 0 && speed <= 0.75 * cap + 0.5 / SPEED_STEPS + 1e-9;
	}

	/* Margin law for anything that would *create* a rail or accept a first
	 * landing: the starter must clear 75 % of its cap there over the 16-bearing
	 * fan, so an exit that only appears at full power never seats a company —
	 * and full-cap bearings need never be flown for this boolean gate. */
	function openingStarterCanExit(planet) {
		const sim = openingSim;
		if (!sim.planetActive(planet)) return false;
		const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
			OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], openingForceScale);
		const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
		let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return false;
		const speedU = Math.max(minU, Math.round(capU * OPENING_EXIT_FRACTIONS[0]));
		const speed = speedU / SPEED_STEPS;
		if (!exitSpeedHasMargin(speed, cap)) return false;
		for (let a = 0; a < OPENING_EXIT_ANGLES; a++) {
			const angle = angleOf(angleUnits((a + 0.5) / OPENING_EXIT_ANGLES * Math.PI * 2));
			openingFanQuota -= 1;
			sim.predictFast(planet, angle, speed, OPENING_HORIZON);
			if (sim.predReason === GravitySim.END_IMPACT && sim.predBody >= 0 &&
				sim.predBody !== planet) return true;
		}
		return false;
	}

	function openingTraceExitable(body) {
		const memo = openingActiveExitMemo;
		if (memo[body] < 0) memo[body] = openingStarterCanExit(body) ? 1 : 0;
		return memo[body] === 1;
	}

	/* Frame quota for resumable search units (0.7.47 review): the seat
	 * search bounds a unit's physics with fanBounded() so one frame never
	 * flies a whole proposal at once; a paused fan resumes exactly where it
	 * stopped, so slice sizes change timing only — never results. Sync
	 * callers run at the default Infinity quota and cannot pause. */
	const OPENING_PAUSED = Object.freeze({ paused: true });
	const OPENING_FAN_QUOTA = 4;
	let openingFanQuota = Infinity;
	/* the field entry whose strengths are currently installed on openingSim;
	 * an entry's key hashes every setField argument, so a repeat install is
	 * a no-op and units skip the raster refill when the field already matches */
	let openingInstalledEntry = null;

	function fanBounded(fn) {
		openingFanQuota = OPENING_FAN_QUOTA;
		try {
			return fn();
		} finally {
			openingFanQuota = Infinity;
		}
	}

	/* Trace one company's starter-speed fan. A safe landing is a free planet
	 * the other starting HQs do not occupy and from which an EMC-1 can leave
	 * again with margin. */
	function openingTraceHome(world, mask, forcedHomes, home, strictExit, sitePay, targetPay,
		exitOk, angles, speeds) {
		const nAngles = angles || OPENING_ANGLES;
		const nSpeeds = speeds || OPENING_SPEEDS;
		const sim = openingSim;
		const savedStrength = openingStrengths[home];
		const extent = openingExtent(mask);
		openingStrengths[home] = 1;
		const entry = openingFieldEntry(world, mask, extent);
		openingActiveExitMemo = entry.memo;
		const fanKey = home * 1048576 + nAngles * 1024 + nSpeeds;
		let fan = entry.fans.get(fanKey);
		/* A fan paused by the frame quota resumes where it stopped; the
		 * logical trace is counted only on its first entry, so sliced and
		 * whole searches consume the same trace budgets. */
		const resumed = Boolean(fan && fan.partial);
		openingTraceCount += resumed ? 0 : 1;
		if (!fan || fan.partial) {
			let si = 0;
			let ai = 0;
			let pay = -Infinity;
			let reach = 0;
			let anyPay;
			let buildPay;
			if (fan && fan.partial) {
				si = fan.si;
				ai = fan.ai;
				pay = fan.pay;
				reach = fan.reach;
				anyPay = fan.anyPay;
				buildPay = fan.buildPay;
				openingSeen.set(fan.seen);
			} else {
				if (openingInstalledEntry !== entry) {
					sim.setField(extent, openingTrade.planetR, openingStrengths, openingFill, true);
					openingInstalledEntry = entry;
				}
				openingSeen.fill(0);
				anyPay = new Float64Array(OrbitWorld.PLANETS);
				buildPay = new Float64Array(OrbitWorld.PLANETS);
				anyPay.fill(-Infinity);
				buildPay.fill(-Infinity);
			}
			const cap = OrbitTech.speedLimit(OrbitTech.BATTERIES[0].capacity,
				OrbitTech.SHIP_DRY_MASS, OrbitTech.CATAPULTS[0], openingForceScale);
			const minU = GravitySim.SPEED_MIN * SPEED_STEPS;
			let capU = Math.floor(cap * SPEED_STEPS + 1e-9);
			const maxU = GravitySim.SPEED_MAX * SPEED_STEPS;
			if (capU > maxU) capU = maxU;
			if (capU >= minU) {
				const span = capU - minU;
				for (let s = si; s < nSpeeds; s++) {
					const speedU = s === nSpeeds - 1 ? capU
						: minU + Math.round(span * s / (nSpeeds - 1));
					const speed = speedOf(speedU);
					const aStart = s === si ? ai : 0;
					for (let a = aStart; a < nAngles; a++) {
						if (openingFanQuota <= 0) {
							/* keep the partial fan and the pinned field for
							 * the next unit; the strength restores when the
							 * fan completes (or a fresh prepare rebuilds it) */
							entry.fans.set(fanKey, {
								partial: true, si: s, ai: a, pay: pay, reach: reach,
								anyPay: anyPay, buildPay: buildPay, seen: openingSeen.slice()
							});
							return OPENING_PAUSED;
						}
						openingFanQuota -= 1;
						const angle = angleOf(angleUnits((a + 0.5) / nAngles * Math.PI * 2));
						sim.predictFast(home, angle, speed, OPENING_HORIZON);
						if (sim.predReason !== GravitySim.END_IMPACT || sim.predBody < 0) continue;
						const body = sim.predBody;
						const earned = estimateProfitLog(openingMarket, 0,
							sim.predLogPlanet, sim.predLogStep, sim.predLogCount);
						if (earned > pay) pay = earned;
						if (body === home || openingMarket.empty[body] === 1) continue;
						if (!openingSeen[body]) {
							openingSeen[body] = 1;
							reach += 1;
						}
						if (earned > anyPay[body]) anyPay[body] = earned;
						if (body === world.capitalPlanet && specialPlanetsOn()) continue;
						if (!openingTraceExitable(body)) continue;
						if (earned > buildPay[body]) buildPay[body] = earned;
					}
				}
			}
			fan = {
				pay: Number.isFinite(pay) ? pay : 0,
				reach: reach,
				anyPay: anyPay,
				buildPay: buildPay
			};
			entry.fans.set(fanKey, fan);
		}
		openingResult.reach = fan.reach;
		openingResult.light = 0;
		openingResult.pay = fan.pay;
		openingResult.openPay = -Infinity;
		openingResult.buildable = 0;
		openingResult.buildPay = -Infinity;
		for (let body = 0; body < OrbitWorld.PLANETS; body++) {
			if (forcedHomes && forcedHomes[body]) continue;
			const openPay = fan.anyPay[body];
			if (Number.isFinite(openPay)) {
				if (openPay > openingResult.openPay) openingResult.openPay = openPay;
				if (targetPay) targetPay[home * OrbitWorld.PLANETS + body] = openPay;
			}
			const earned = fan.buildPay[body];
			if (!Number.isFinite(earned)) continue;
			if (exitOk) exitOk[home * OrbitWorld.PLANETS + body] = 1;
			openingResult.light += 1;
			openingResult.buildable += 1;
			if (sitePay) sitePay[home * OrbitWorld.PLANETS + body] = earned;
			if (openingResult.buildable === 1 || earned > openingResult.buildPay) {
				openingResult.buildPay = earned;
			}
		}
		if (!Number.isFinite(openingResult.openPay)) openingResult.openPay = 0;
		openingStrengths[home] = savedStrength;
		return openingResult;
	}

	/* One world and one set of already-pinned HQs have the same opening table
	 * for every actor; the company-specific seed only breaks equal choices. */
	function careerOpenings(world, trade, mask, count, forcedHomes, sourceSim) {
		const emptyTag = trade && trade.emptyMask ? openingMaskBits(trade.emptyMask) : 'd';
		const gravityTag = trade && trade.colonyGravityMask ? openingMaskBits(trade.colonyGravityMask) : emptyTag;
		const key = (world.seed >>> 0) + ':' + (trade.seed >>> 0) + ':' + trade.t.toFixed(3) + ':' +
			(sourceSim && Number.isFinite(sourceSim.gravityScale) ? sourceSim.gravityScale : 1) + ':' +
			(sourceSim && Number.isFinite(sourceSim.forceScale) ? sourceSim.forceScale : 1) + ':' +
			openingMaskTag(mask, count) + ':' + openingMaskTag(forcedHomes, 0) + ':' +
			emptyTag + ':' + gravityTag + ':' + (specialPlanetsOn() ? 1 : 0);
		const cached = openingCache.get(key);
		if (cached) return cached;
		openingPrepare(world, trade, mask, count, forcedHomes, sourceSim);
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const targetPay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		targetPay.fill(-Infinity);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const rows = {
			light: new Int8Array(OrbitWorld.PLANETS),
			reach: new Int8Array(OrbitWorld.PLANETS),
			pay: new Float64Array(OrbitWorld.PLANETS),
			buildable: new Int8Array(OrbitWorld.PLANETS),
			buildPay: new Float64Array(OrbitWorld.PLANETS),
			openPay: new Float64Array(OrbitWorld.PLANETS),
			sitePay: sitePay,
			targetPay: targetPay,
			exitOk: exitOk,
			best: -Infinity
		};
		for (let planet = 0; planet < OrbitWorld.PLANETS; planet++) {
			if ((mask && mask[planet] === 0) || hqForbidden(world, planet)) continue;
			const profile = openingTraceHome(world, mask, forcedHomes, planet, true, sitePay,
				targetPay, exitOk);
			rows.reach[planet] = profile.reach;
			rows.light[planet] = profile.light;
			rows.pay[planet] = profile.pay;
			rows.openPay[planet] = profile.openPay;
			rows.buildable[planet] = profile.buildable;
			rows.buildPay[planet] = profile.buildPay;
			if ((!forcedHomes || !forcedHomes[planet]) && profile.buildable > 0 &&
				profile.buildPay > rows.best) rows.best = profile.buildPay;
		}
		openingCache.set(key, rows);
		if (openingCache.size > OPENING_CACHE_MAX) {
			openingCache.delete(openingCache.keys().next().value);
		}
		return rows;
	}

	function hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight) {
		if (mask && mask[i] === 0) return false;
		if (used && used[i]) return false;
		if (hqForbidden(world, i) || rows.buildable[i] <= 0) return false;
		if (shallowOnly && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) return false;
		if (rows.buildPay[i] < floor) return false;
		if (needLight && world.planetLight[i] < CAREER.hqMinLight) return false;
		return true;
	}

	/* Seeded choice from the tightest opening-profit band with a free HQ seat. */
	function pickFairHq(seed, world, used, mask, count, trade, sourceSim) {
		const rows = careerOpenings(world, trade, mask, count, used, sourceSim);
		if (!Number.isFinite(rows.best)) return -1;
		for (let b = 0; b < OPENING_BANDS.length; b++) {
			const floor = rows.best > 0 ? rows.best * OPENING_BANDS[b] : rows.best;
			for (let shallowOnly = 1; shallowOnly >= 0; shallowOnly--) {
				for (let needLight = 1; needLight >= 0; needLight--) {
					const home = hashPickHq(seed, world, used, mask, rows, floor,
						shallowOnly === 1, needLight === 1);
					if (home >= 0) return home;
				}
			}
		}
		return -1;
	}

	/* The Capital is the Empire's and uninhabited worlds have no port or rail:
	 * no company may call either home. */
	function hqForbidden(world, i) {
		return (specialPlanetsOn() && i === world.capitalPlanet) ||
			openingMarket.empty[i] === 1;
	}

	function hashPickHq(seed, world, used, mask, rows, floor, shallowOnly, needLight) {
		let total = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight)) total += 1;
		}
		if (total === 0) return -1;
		let pick = OrbitWorld.hashBits(seed, 0, SALT_HQ) % total;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!hqCandidate(world, used, mask, i, rows, floor, shallowOnly, needLight)) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	/* Exact score for a pinned HQ set: re-trace every seat in the final field,
	 * then ask for the best distinct-site assignment among the seats. */
	/*
	 * Trace one seat against one pinned field. Paths depend only on which planets
	 * are pinned as HQs, not on the whole home set, so a search can reuse a
	 * single-home trace for every set that contains that home — that is what
	 * makes an exhaustive pass over the candidate sets affordable at load time.
	 */
	const openingTraceCache = new Map();
	const OPENING_TRACE_CACHE_MAX = 4096;

	function openingMaskBits(mask) {
		if (!mask) return -1;
		let lo = 0, hi = 0;
		for (let i = 0; i < 32; i++) if (mask[i]) lo |= (1 << i);
		for (let i = 32; i < OrbitWorld.PLANETS; i++) if (mask[i]) hi |= (1 << (i - 32));
		return hi * 4294967296 + (lo >>> 0);
	}

	function openingTracks(world, mask, forcedHomes, home, angles, speeds, strictExit) {
		const nAngles = angles || OPENING_ANGLES;
		const nSpeeds = speeds || OPENING_SPEEDS;
		const checkExit = strictExit !== false;
		const field = PlanetGravity.armed();
		const fieldTag = field && field.seed === (world.seed >>> 0) ? field.tag : 0;
		const key = (world.seed >>> 0) + ':' +
			(openingTrade ? (openingTrade.seed >>> 0) + ':' + openingTrade.t.toFixed(3) : '-') + ':' +
			openingGravityScale + ':' + openingForceScale + ':' +
			openingMaskBits(mask) + ':' +
			(openingMarket && Number.isFinite(openingMarket.planetCount)
				? openingMarket.planetCount : openingExtent(mask)) + ':' +
			openingMaskBits(openingMarket.empty) + ':' + openingMaskBits(openingMarket.heavy) + ':' +
			home + ':' + nAngles + 'x' + nSpeeds + ':' + (specialPlanetsOn() ? 1 : 0) + ':' +
			(checkExit ? 'exit:' : 'land:') + openingMaskBits(forcedHomes) +
			(fieldTag ? ':' + fieldTag : '');
		const cached = openingTraceCache.get(key);
		if (cached) {
			openingTraceCount += 1;
			return cached;
		}
		const sitePay = new Float64Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		const exitOk = new Uint8Array(OrbitWorld.PLANETS * OrbitWorld.PLANETS);
		sitePay.fill(-Infinity);
		const profile = openingTraceHome(world, mask, forcedHomes, home, checkExit,
			sitePay, null, exitOk, nAngles, nSpeeds);
		if (profile === OPENING_PAUSED) return OPENING_PAUSED;
		const track = {
			home: home,
			sitePay: sitePay,
			exitOk: exitOk,
			buildable: profile.buildable,
			openPay: profile.openPay
		};
		openingTraceCache.set(key, track);
		if (openingTraceCache.size > OPENING_TRACE_CACHE_MAX) {
			openingTraceCache.delete(openingTraceCache.keys().next().value);
		}
		return track;
	}

	function planetInMask(mask, planet) {
		return !mask || mask[planet] !== 0;
	}

	/* HQs already taken by the players of `galaxy` */
	function hqMask(career) {
		const used = new Uint8Array(OrbitWorld.PLANETS);
		const actors = career.galaxy ? career.galaxy.actors : null;
		for (let i = 0; actors && i < actors.length; i++) {
			if (actors[i] !== career && actors[i].hq >= 0) used[actors[i].hq] = 1;
		}
		return used;
	}

	Object.assign(GravityGame, {
		HQ_GRAVITY_MAX, openingTracks, openingPrepare, careerOpenings, OPENING_BANDS,
		exitSpeedHasMargin
	});
	Object.assign(inner, {
		HQ_GRAVITY_MAX, OPENING_ANGLES, OPENING_SPEEDS, OPENING_EXIT_ANGLES, OPENING_EXIT_FRACTIONS,
		OPENING_HORIZON, OPENING_COMPARE_EPS, OPENING_FAIR_RATIO, OPENING_RATIO_EPS, openingTraces,
		restoreOpeningTraces, openingMaskTag, openingExtent, openingMarket, openingFillEmpty,
		openingPrepare, openingSyncField,
		exitSpeedHasMargin, openingStarterCanExit, OPENING_PAUSED, fanBounded, openingTraceHome,
		careerOpenings, pickFairHq, hqForbidden, openingMaskBits, openingTracks, planetInMask,
		hqMask
	});
});
