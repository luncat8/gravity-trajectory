/*
 * Career assets: the exit probe and reach, gear and research choice, site and
 * pad values, the next pad to claim.
 * not here: buying and upgrading → bot_career_shop.js
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_career_assets.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, OrbitWorld, OrbitTech, END_IMPACT, TAU, CAREER_EXIT_CACHE_WAYS,
		CAREER_REACH_VALUE, CAREER_PURSE_RESERVE, careerRefundEscrow, careerTraceIndex
	} = inner;

	const CAREER_EXIT_ANGLES = 16;
	const CAREER_EXIT_SPEED_FRACTIONS = [0.75, 1];
	const CAREER_NETWORK_PAD_VALUE = 4;
	/* A well that needs a stronger first rail is a more expensive claim. */
	const CAREER_STEEP_PAD_VALUE = 2;
	const CAREER_GRAVITY_COST = 1.5;
	const CAREER_SITE_BONUS = 0.5;

	/* --- solo career controller ---------------------------------------- */

	const RESEARCH_BRIDGE_RAIL = [52, 0.67];
	const RESEARCH_LIGHT_TANK = [50, 0.45];
	const RESEARCH_LIGHT_ENGINE = [16, 0.85];

	/* Lowest rung above `current` across both the stock table and unlocked
	 * prototypes, breaking ties on cheaper build cost. */
	function careerNextItem(career, kind, table, current) {
		const minTier = current === null ? -Infinity : current.tier;
		let best = null;
		for (let i = 0; i < table.length; i++) {
			const item = table[i];
			if (item.tier <= minTier) continue;
			if (!best || item.tier < best.tier ||
				(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
		}
		const protos = career.prototypes ? career.prototypes[kind] : null;
		for (let i = 0; protos && i < protos.length; i++) {
			const item = protos[i];
			if (item.tier <= minTier) continue;
			if (!best || item.tier < best.tier ||
				(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
		}
		return best;
	}

	function careerPrice(career, item) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : (item.buildCost ?? item.cost);
	}

	GravityBot.prototype.prepareCareerExitProbe = function (sourceSim) {
		if (!sourceSim) sourceSim = this.probe;
		const srcW = sourceSim.worldW || OrbitWorld.WORLD_W;
		const srcH = sourceSim.worldH || OrbitWorld.WORLD_H;
		if (this.exitProbe.worldW !== srcW || this.exitProbe.worldH !== srcH) {
			this.exitProbe = new GravitySim(srcW, srcH);
			this.departureSourceSim = null;
		}
		const sim = this.exitProbe;
		const periodicChanged = sim.periodic !== Boolean(sourceSim.periodic);
		sim.setPeriodic(sourceSim.periodic, sourceSim);
		sim.fieldT = sourceSim.fieldT;
		sim.fieldRate = sourceSim.fieldRate;
		sim.setScales(sourceSim.gravityScale, sourceSim.forceScale);
		if (periodicChanged || this.departureSourceSim !== sourceSim ||
			sim.planetX !== sourceSim.planetX || sim.planetY !== sourceSim.planetY ||
			sim.planetR !== sourceSim.planetR || sim.planetCapacity !== sourceSim.planetCapacity) {
			if (sourceSim.planetCapacity !== undefined) sim.planetCapacity = sourceSim.planetCapacity;
			if (sourceSim.planetX) sim.planetX = sourceSim.planetX;
			if (sourceSim.planetY) sim.planetY = sourceSim.planetY;
			if (sourceSim.planetR) sim.planetR = sourceSim.planetR;
			if (sourceSim.sysCos) sim.sysCos.set(sourceSim.sysCos);
			if (sourceSim.sysSin) sim.sysSin.set(sourceSim.sysSin);
			if (sourceSim.sysInvRX) sim.sysInvRX.set(sourceSim.sysInvRX);
			if (sourceSim.sysInvRY) sim.sysInvRY.set(sourceSim.sysInvRY);
			if (sourceSim.sysBoundR2) sim.sysBoundR2.set(sourceSim.sysBoundR2);
			if (sourceSim.planetMinX !== undefined) sim.planetMinX = sourceSim.planetMinX;
			if (sourceSim.planetMaxX !== undefined) sim.planetMaxX = sourceSim.planetMaxX;
			if (sourceSim.planetMinY !== undefined) sim.planetMinY = sourceSim.planetMinY;
			if (sourceSim.planetMaxY !== undefined) sim.planetMaxY = sourceSim.planetMaxY;
		}
		if (periodicChanged || this.departureSourceSim !== sourceSim ||
			sim.bodyCount !== sourceSim.bodyCount ||
			sim.bodyR !== sourceSim.bodyR || sim.strength !== sourceSim.strength ||
			sim.fillField !== sourceSim.fillField || sim.fieldStatic !== sourceSim.fieldStatic ||
			sim.planetMask !== sourceSim.planetMask) {
			sim.setPlanetMask(sourceSim.planetMask);
			sim.setField(sourceSim.bodyCount, sourceSim.bodyR, sourceSim.strength,
				sourceSim.fillField, sourceSim.fieldStatic);
			this.departureSourceSim = sourceSim;
			this.departureFieldVersion += 1;
		}
		sim.stepStale = true;
		sim.refreshField();
	};

	GravityBot.prototype.careerExitFieldStamp = function () {
		const sim = this.exitProbe;
		const trade = this.tradeSim;
		let stamp = 0x811c9dc5;
		stamp = Math.imul(stamp ^ sim.bodyCount, 0x01000193);
		stamp = Math.imul(stamp ^ this.departureFieldVersion, 0x01000193);
		stamp = Math.imul(stamp ^ (sim.fieldStatic ? 1 : 0), 0x01000193);
		for (let i = 0; i < sim.bodyCount; i++) {
			stamp = Math.imul(stamp ^ (Math.round(sim.strength[i] * 100) + i * 31), 0x01000193);
		}
		for (let i = 0; i < sim.planetCount; i++) {
			stamp = Math.imul(stamp ^ (sim.planetMask ? sim.planetMask[i] : 1), 0x01000193);
		}
		stamp = Math.imul(stamp ^ Math.round(sim.gravityScale * 100), 0x01000193);
		stamp = Math.imul(stamp ^ Math.round(sim.fieldRate * 1000), 0x01000193);
		stamp = Math.imul(stamp ^ ((trade ? trade.seed : this.seed) >>> 0), 0x01000193);
		if (sim.periodic) {
			stamp = Math.imul(stamp ^ 0x50455249, 0x01000193);
			stamp = Math.imul(stamp ^ Math.round(sim.worldW), 0x01000193);
			stamp = Math.imul(stamp ^ Math.round(sim.worldH), 0x01000193);
			if (sim.fieldStatic) {
				const snap = sim.ensurePeriodicGrid();
				stamp = Math.imul(stamp ^ (snap ? snap.revision : 0), 0x01000193);
			}
		} else if (sim.worldW !== OrbitWorld.WORLD_W || sim.worldH !== OrbitWorld.WORLD_H) {
			stamp = Math.imul(stamp ^ Math.round(sim.worldW), 0x01000193);
			stamp = Math.imul(stamp ^ Math.round(sim.worldH), 0x01000193);
		}
		if (!sim.fieldStatic) stamp = Math.imul(stamp ^ Math.round(sim.fieldT * 120), 0x01000193);
		return stamp >>> 0;
	};

	/* Sixteen bearings × two tiers (75 % of the cap, then the cap) keep one
	 * cached exit check cheap; the game's opening probe mirrors this law. */
	GravityBot.prototype.careerExitSpeed = function (planet, cap) {
		if (!Number.isFinite(cap) || !this.exitProbe.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * GravityGame.SPEED_STEPS;
		let capU = Math.floor(cap * GravityGame.SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * GravityGame.SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		const stamp = this.careerExitFieldStamp();
		const slot = planet * CAREER_EXIT_CACHE_WAYS + capU % CAREER_EXIT_CACHE_WAYS;
		if (this.careerExitCacheCap[slot] === capU &&
			this.careerExitCacheStamp[slot] === stamp) return this.careerExitCacheSpeed[slot];

		let found = 0;
		let previous = -1;
		for (let f = 0; f < CAREER_EXIT_SPEED_FRACTIONS.length; f++) {
			/* 75 % of the cap first, the cap only where 75 % fails: a high-G
			 * world ends up probed at max (0.7.47 margin law) */
			const speedU = f === CAREER_EXIT_SPEED_FRACTIONS.length - 1
				? capU : Math.max(minU, Math.round(capU * CAREER_EXIT_SPEED_FRACTIONS[f]));
			if (speedU === previous) continue;
			previous = speedU;
			const speed = speedU / GravityGame.SPEED_STEPS;
			for (let a = 0; a < CAREER_EXIT_ANGLES; a++) {
				const angle = (a + 0.5) / CAREER_EXIT_ANGLES * TAU;
				this.exitProbe.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
				if (this.exitProbe.predReason !== END_IMPACT ||
					this.exitProbe.predBody < 0 || this.exitProbe.predBody === planet) continue;
				found = speed;
				break;
			}
			if (found > 0) break;
		}
		this.careerExitCacheCap[slot] = capU;
		this.careerExitCacheStamp[slot] = stamp;
		this.careerExitCacheSpeed[slot] = found;
		return found;
	};

	/* Distinct other systems one launch from `planet` reaches at `cap`: the
	 * breadth the pad adds to the network. A starter rail in a deep well leaves
	 * for one or two neighbours at best, which is why sunlight alone must not
	 * decide where an EMC is built. Same cache shape as the exit check. */
	GravityBot.prototype.careerReach = function (planet, cap) {
		if (!Number.isFinite(cap) || !this.exitProbe.planetActive(planet)) return 0;
		const minU = GravitySim.SPEED_MIN * GravityGame.SPEED_STEPS;
		let capU = Math.floor(cap * GravityGame.SPEED_STEPS + 1e-9);
		const maxU = GravitySim.SPEED_MAX * GravityGame.SPEED_STEPS;
		if (capU > maxU) capU = maxU;
		if (capU < minU) return 0;
		const stamp = this.careerExitFieldStamp();
		const slot = planet * CAREER_EXIT_CACHE_WAYS + capU % CAREER_EXIT_CACHE_WAYS;
		if (this.careerReachCacheCap[slot] === capU &&
			this.careerReachCacheStamp[slot] === stamp) return this.careerReachCacheCount[slot];
		const speed = capU / GravityGame.SPEED_STEPS;
		const mark = this.careerReachMark;
		mark.fill(0);
		let count = 0;
		for (let a = 0; a < CAREER_EXIT_ANGLES; a++) {
			const angle = (a + 0.5) / CAREER_EXIT_ANGLES * TAU;
			this.exitProbe.predictFast(planet, angle, speed, GravityGame.CAP_SECONDS);
			if (this.exitProbe.predReason !== END_IMPACT) continue;
			const body = this.exitProbe.predBody;
			if (body < 0 || body === planet || mark[body]) continue;
			mark[body] = 1;
			count += 1;
		}
		this.careerReachCacheCap[slot] = capU;
		this.careerReachCacheStamp[slot] = stamp;
		this.careerReachCacheCount[slot] = count;
		return count;
	};

	GravityBot.prototype.careerArrivalMass = function (career, planet) {
		return GravityGame.careerArrivalMass(career, planet);
	};

	GravityBot.prototype.careerArrivalCharge = function (career, planet, flightSeconds) {
		return GravityGame.careerArrivalCharge(career, planet, flightSeconds);
	};

	GravityBot.prototype.careerDeparture = function (career, planet, cash, mass, sourceSim, condition, seekClaim, afterLanding = false, flightSeconds = 0, asFounded = false) {
		this.prepareCareerExitProbe(sourceSim || this.probe);
		return GravityGame.careerDeparture(this.careerExit, career, planet, cash, mass,
			this.exitProbe, condition, seekClaim, afterLanding, flightSeconds,
			this.careerExitFn, asFounded);
	};

	GravityBot.prototype.careerBuyGear = function (career, planet, kind, item, reserve, step, why) {
		const keep = (reserve || 0) + careerRefundEscrow(career);
		if (!item || career.ledger.purse + 1e-9 < careerPrice(career, item) + keep) return false;
		const fresh = kind === OrbitTech.KIND_CATAPULT && career.pads[planet].catapult === null;
		if (!GravityGame.buildGear(career, planet, kind, item)) return false;
		if (fresh) this.careerBuilds += 1;
		else this.careerUpgrades += 1;
		if (why) this.traceAdd(careerTraceIndex(career), 'gear', 'P' + planet + ' ' + item.id +
			' · ' + why + ' · −' + careerPrice(career, item).toFixed(2), step);
		return true;
	};

	/* R&D: unlock a mid-rung bridge rail when pads will need upgrades anywhere,
	 * and at HQ unlock + fit a lightweight composite tank + thruster kit. */
	GravityBot.prototype.careerResearch = function (career, sim, reserve) {
		if (career.ended !== GravityGame.CAREER_OPEN) return null;
		const keep = (reserve === undefined ? CAREER_PURSE_RESERVE : reserve) +
			careerRefundEscrow(career);
		if (GravityGame.prototypesOf(career, OrbitTech.KIND_CATAPULT).length === 0 &&
			(sim.forceScale < 0.85 || career.ship.hold.capacity >= 8)) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_CATAPULT, RESEARCH_BRIDGE_RAIL);
			const proto = OrbitTech.catapultRecord('R', RESEARCH_BRIDGE_RAIL[0], RESEARCH_BRIDGE_RAIL[1]);
			if (career.ledger.purse + 1e-9 >= fee + careerPrice(career, proto) + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_CATAPULT, RESEARCH_BRIDGE_RAIL, label)) {
					this.careerResearches += 1;
					return OrbitTech.KIND_CATAPULT + ':' + label;
				}
			}
		}
		const researchBase = GravityGame.evacTarget(career);
		if (career.at < 0 || career.at !== researchBase) return null;
		if (career.ship.tank.tier === 0 &&
			GravityGame.prototypesOf(career, OrbitTech.KIND_TANK).length === 0) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_TANK, RESEARCH_LIGHT_TANK);
			if (career.ledger.purse + 1e-9 >= fee + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_TANK, RESEARCH_LIGHT_TANK, label)) {
					GravityGame.installPart(career, OrbitTech.KIND_TANK,
						GravityGame.prototypeById(career, OrbitTech.KIND_TANK, label));
					this.careerResearches += 1;
					return OrbitTech.KIND_TANK + ':' + label;
				}
			}
		}
		if (career.ship.engine === null && career.ship.tank.fuelCap > 0 &&
			GravityGame.prototypesOf(career, OrbitTech.KIND_ENGINE).length === 0) {
			const fee = GravityGame.researchCost(career, OrbitTech.KIND_ENGINE, RESEARCH_LIGHT_ENGINE);
			if (career.ledger.purse + 1e-9 >= fee + keep) {
				const label = GravityGame.researchLabel(career);
				if (GravityGame.researchPoint(career, OrbitTech.KIND_ENGINE, RESEARCH_LIGHT_ENGINE, label)) {
					GravityGame.installPart(career, OrbitTech.KIND_ENGINE,
						GravityGame.prototypeById(career, OrbitTech.KIND_ENGINE, label));
					this.careerResearches += 1;
					return OrbitTech.KIND_ENGINE + ':' + label;
				}
			}
		}
		return null;
	};

	GravityBot.prototype.careerGravityCost = function (planet, sim = this.probe) {
		return Math.max(0, sim.strength[planet] * sim.gravityScale - 1) * CAREER_GRAVITY_COST;
	};

	/* Only called for a proven kit. The full-speed reach fan may miss the
	 * slower exit that careerDeparture found; that is still one neighbour. */
	GravityBot.prototype.careerSiteValue = function (career, planet, target, cap) {
		const reach = Math.max(1, this.careerReach(planet, cap));
		return career.light[planet] + reach * CAREER_REACH_VALUE -
			this.careerGravityCost(planet, this.exitProbe) + (planet === target ? CAREER_SITE_BONUS : 0);
	};

	/* Price the rail we would own, not the commercial ticket that may be the
	 * cheapest one-off exit. Use the same site valuation for a landing and a
	 * remote purchase, at the mass the kit actually has to launch. */
	GravityBot.prototype.careerClaimValue = function (career, planet, target, departure, mass) {
		const cap = OrbitTech.speedLimit(departure.battery.capacity, mass, departure.catapult, this.exitProbe.forceScale);
		return (departure.canBuildStarter ? CAREER_NETWORK_PAD_VALUE : CAREER_STEEP_PAD_VALUE) +
			this.careerSiteValue(career, planet, target, cap) - departure.cost;
	};

	GravityBot.prototype.careerPadOffer = function (career, planet, cash, sim) {
		return this.careerDeparture(career, planet, cash, career.ship.mass, sim, undefined, true);
	};

	GravityBot.prototype.careerNextPad = function (career, cash = career.ledger.purse, sim = this.probe) {
		const target = career.contract >= 0 ? this.careerTarget(career) : -1;
		let best = -1;
		let bestValue = -Infinity;
		for (let p = 0; p < sim.planetCount; p++) {
			if (!sim.planetActive(p) || career.pads[p].catapult || this.careerContested(career, p) ||
				!GravityGame.planetBuildable(career, p)) continue;
			const exit = this.careerPadOffer(career, p, cash, sim);
			if (!exit.builds) continue;
			const value = this.careerClaimValue(career, p, target, exit, career.ship.mass);
			if (value <= bestValue) continue;
			best = p;
			bestValue = value;
		}
		return best;
	};

	Object.assign(inner, {
		careerNextItem, careerPrice
	});
});
