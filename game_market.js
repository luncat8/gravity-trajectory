/*
 * Visit-profit market: per-planet growing profit, the flight ledger, harvest
 * and stay-pay, predicted harvest, the universe mask.
 * not here: landing settlement → game_flight.js; contract payouts → game_contracts.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_market.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitEcon, MONEY, estScratch, BRIBE_OPEN, COMMERCIAL_PAD,
		CAPITAL_VISIT_PAY, specialPlanetsOn, payScaleOf
	} = inner;

	/*
	 * Visit-profit collection modes. `HARVEST_ENTRY` is the rule: the first
	 * encounter with a system pays everything it has accrued since the last one
	 * and stamps its clock, so a long flight that crosses the same system again
	 * later collects what regrew in between. The experimental `HARVEST_TICK`
	 * also pays, on every step the ship stays inside, what re-accrued during
	 * that step — a slow or looping pass earns more than a fly-by. Career only;
	 * `estimateProfit` prices whichever mode is active, from the trace's
	 * dwell trail (0.7.39-plan-harvest-ticks.md).
	 */
	const HARVEST_ENTRY = 0;
	const HARVEST_TICK = 1;
	let harvestMode = HARVEST_ENTRY;

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	/*
	 * Shared per-planet state for a game run; player and rivals harvest from
	 * the same table. The political half (0.5.12) is the same kind of shared
	 * ground: rot, the visit that carried a bribe, the rebellion clock and the
	 * seized rail of each planet. `galaxy` is bound by bindRun and is what
	 * makes the political clock run at all; `politicsSeed`/`politicsSerial`
	 * are the deterministic stream every roll reads.
	 */
	function createMarket() {
		const market = {
			lastVisitStep: new Float64Array(OrbitWorld.PLANETS),
			/* the rot clock, separate from the value clock: it is stamped by a
			 * *report*, never by a bribe, and a bribe restores it (0.7.16) */
			reportStep: new Float64Array(OrbitWorld.PLANETS),
			/* the report step standing before the current landing, kept so a
			 * bribe can take the landing's report back */
			reportPrev: new Float64Array(OrbitWorld.PLANETS),
			corruptionFloor: new Float64Array(OrbitWorld.PLANETS),
			permanentCorruption: false,
			visitPay: new Float64Array(OrbitWorld.PLANETS),
			quiet: new Uint8Array(OrbitWorld.PLANETS),
			corruption: new Float64Array(OrbitWorld.PLANETS),
			bribeVisitStep: new Int32Array(OrbitWorld.PLANETS),
			rebel: new Uint8Array(OrbitWorld.PLANETS),
			seized: new Uint8Array(OrbitWorld.PLANETS),
			rebelSinceStep: new Int32Array(OrbitWorld.PLANETS),
			patients: new Uint8Array(OrbitWorld.PLANETS),
			rebelCooldownStep: new Int32Array(OrbitWorld.PLANETS),
			lastCheckEpoch: new Int32Array(OrbitWorld.PLANETS),
			rebelPads: new Array(OrbitWorld.PLANETS),
			stamp: 0,
			k: MONEY.k,
			arfPlanet: -1,
			capitalPlanet: -1,
			politicsSeed: 1,
			politicsSerial: 0,
			politicsStep: -1,
			politicsSec: 0,
			galaxy: null
		};
		resetMarket(market);
		return market;
	}

	function resetMarket(market) {
		market.lastVisitStep.fill(-initSteps());
		market.reportStep.fill(-initSteps());
		market.reportPrev.fill(-initSteps());
		market.corruptionFloor.fill(OrbitEcon.CORRUPTION_TRADITION);
		market.permanentCorruption = false;
		market.visitPay.fill(0);
		market.quiet.fill(0);
		market.stamp += 1;
		market.k = MONEY.k;
		market.arfPlanet = -1;
		market.capitalPlanet = -1;
		market.corruption.fill(OrbitEcon.CORRUPTION_TRADITION);
		market.bribeVisitStep.fill(BRIBE_OPEN);
		market.rebel.fill(0);
		market.seized.fill(0);
		market.rebelSinceStep.fill(0);
		market.patients.fill(0);
		market.rebelCooldownStep.fill(0);
		market.lastCheckEpoch.fill(-1);
		market.rebelPads.fill(null);
		market.politicsSeed = 1;
		market.politicsSerial = 0;
		market.politicsStep = -1;
		market.politicsSec = 0;
		market.galaxy = null;
	}

	/*
	 * One run, one political world: the market owns the shared arrays and the
	 * galaxy names the careers they act on. Called by the page and by benches;
	 * without it every political rule is inert, which keeps the historical
	 * career numbers of `career_bench` untouched.
	 */
	function bindRun(market, galaxy, world) {
		market.galaxy = galaxy || null;
		market.politicsSeed = world ? world.seed >>> 0 : 1;
		if (!galaxy) return market;
		galaxy.market = market;
		for (let i = 0; i < galaxy.actors.length; i++) galaxy.actors[i].market = market;
		return market;
	}

	/* wire the seeded world's specials into the shared market (career runs only);
	 * with the A/B switch off the indices stay -1 and every planet pays normally */
	function applyMarketSpecials(market, world) {
		if (specialPlanetsOn() && world) {
			market.arfPlanet = world.arfPlanet;
			market.capitalPlanet = world.capitalPlanet;
			market.corruption[market.arfPlanet] = 0;
			market.corruption[market.capitalPlanet] = 0;
		} else {
			market.arfPlanet = -1;
			market.capitalPlanet = -1;
		}
		if (world) market.politicsSeed = world.seed >>> 0;
	}

	/* cap·(1 − e^(−k·age/cap)): initial slope k, asymptote cap at infinite age */
	function planetProfitAtStep(lastStep, runStep, k) {
		const age = (runStep - lastStep) * GravitySim.DT;
		if (age <= 0) return 0;
		return -MONEY.cap * Math.expm1(-age * (k === undefined ? MONEY.k : k) / MONEY.cap);
	}

	/* the political clock of a step, in game seconds. Every
	 * `OrbitEcon.*_SECONDS` rate is priced in these, `ARREST_SECONDS` included,
	 * so one clock and no rate: the background animation cannot move rot. */
	function politicsSeconds(market, step) {
		return GravitySim.gameSeconds(step);
	}

	/* the rail the rebels run on `planet`, or null; a seized rail outlives the
	 * rebellion as a commercial one */
	function rebelRail(career, planet) {
		const market = career.market;
		return market && market.seized[planet] ? (market.rebelPads[planet] || COMMERCIAL_PAD) : null;
	}

	/*
	 * The one special-aware visit value every harvest and estimate reads:
	 * A.R.F. pays 0, the Capital charges a flat −3 on each entry, every other
	 * planet grows toward the cap. A rebellious planet multiplies its growing
	 * value by the fly-by ramp. Every planet still stamps lastVisitStep, so
	 * the market clock advances exactly as a normal visit would.
	 */
	/* Unscaled visit curve: neglect rot reads this so `pay ×` stays orthogonal
	 * to `rot ×` even when low `pay ×` caps collected payouts below 1.00. */
	function planetProfitUnscaledAt(market, planet, at, lastStep) {
		if (planet === market.capitalPlanet) return CAPITAL_VISIT_PAY;
		if (planet === market.arfPlanet) return 0;
		const pay = planetProfitAtStep(lastStep, at, market.k);
		if (!market.rebel[planet]) return pay;
		const age = politicsSeconds(market, at) -
			politicsSeconds(market, market.rebelSinceStep[planet]);
		return pay * OrbitEcon.flybyMultiplier(age);
	}

	function planetProfitAt(market, planet, at, lastStep) {
		if (planet === market.capitalPlanet) return CAPITAL_VISIT_PAY;
		if (planet === market.arfPlanet) return 0;
		return planetProfitUnscaledAt(market, planet, at, lastStep) * payScaleOf();
	}

	/* the planet's value: what the next visitor collects. The rot reads
	 * `reportStep` instead — a bribe moves this clock and not that one. */
	function planetProfit(market, planet, runStep) {
		return planetProfitAt(market, planet, runStep, market.lastVisitStep[planet]);
	}

	/* a reported visit stamps the rot clock; the previous report is kept one
	 * landing deep, so the bribe that buys this report back can restore it */
	function stampReport(market, planet, runStep) {
		market.reportPrev[planet] = market.reportStep[planet];
		market.reportStep[planet] = runStep;
	}

	/* `fee` is what the current flight's launch cost, so `last` nets it out */
	function createLedger(purse0) {
		return {
			purse: purse0 === undefined ? MONEY.purse0 : purse0,
			fee: MONEY.cost,
			last: 0,
			shotGain: 0,
			shotVisits: 0,
			lastPlanet: -1,
			/* the ship carries a fitted observation device (refitShip keeps it) */
			reports: true,
			inside: new Uint8Array(GravitySim.MAX_BODIES),
			entered: new Int32Array(GravitySim.MAX_BODIES)
		};
	}

	function resetLedger(ledger, purse0) {
		ledger.purse = purse0 === undefined ? MONEY.purse0 : purse0;
		ledger.fee = MONEY.cost;
		ledger.last = 0;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.reports = true;
		ledger.inside.fill(0);
	}

	/* deducts the launch fee and marks the launch base as already inside so departure pays 0 */
	function openFlight(ledger, sim, fee) {
		ledger.purse -= fee;
		ledger.fee = fee;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
		sim.markSystemsAt(sim.cargo.x, sim.cargo.y, ledger.inside);
	}

	function beginFlight(ledger, sim) {
		openFlight(ledger, sim, MONEY.cost);
	}

	/*
	 * One fly-visit: collect the value, stamp the clock, and let the rulers
	 * breathe — a visit is the only thing that clears rot, and it also opens a
	 * fresh window for one bribe (the rulers only complain once per visit).
	 */
	/* the visit law's one test (0.6.1): a visit is a report — it pays, clears
	 * the value and decays rot — only when the company's ship carries the
	 * device and the planet has not gone quiet. The Capital and A.R.F. are
	 * outside it: their flat entry price is not a report. A caller with no
	 * ledger at hand (a neutral estimate) prices a ship that reports. */
	function visitReports(ledger, market, planet) {
		if (planet === market.capitalPlanet || planet === market.arfPlanet) return true;
		return !market.quiet[planet] && (!ledger || ledger.reports);
	}

	function harvestPlanet(ledger, market, planet, runStep) {
		market.bribeVisitStep[planet] = BRIBE_OPEN;
		ledger.shotVisits += 1;
		ledger.lastPlanet = planet;
		if (!visitReports(ledger, market, planet)) {
			/* nothing reported: the value is neither paid nor cleared, so it
			 * keeps growing until a report or the lord's bribe cashes it. This
			 * landing leaves no report to take back, so a bribe taken on it
			 * keeps the rot clock on the last report that did reach the Capital */
			market.reportPrev[planet] = market.reportStep[planet];
			market.visitPay[planet] = 0;
			return 0;
		}
		const pay = planetProfit(market, planet, runStep);
		market.lastVisitStep[planet] = runStep;
		stampReport(market, planet, runStep);
		market.visitPay[planet] = pay;
		market.stamp += 1;
		if (planet !== market.capitalPlanet && planet !== market.arfPlanet &&
			market.corruption[planet] > 0) {
			market.corruption[planet] = Math.max(market.corruptionFloor[planet],
				market.corruption[planet] - OrbitEcon.CORRUPTION_VISIT_DECAY);
		}
		ledger.purse += pay;
		ledger.shotGain += pay;
		return pay;
	}

	/*
	 * One step of the experimental stay-pay: every system the ship is inside
	 * pays what re-accrued since its last stamp, so a system the ship never
	 * leaves keeps paying instead of sitting at the value it had on entry. The
	 * systems it launched from are inside already, so their stored value — pad
	 * time included — is collected by the first flight step; stamping them at
	 * launch instead would delete that value from the shared market, which is
	 * the one thing this mode must not do.
	 *
	 * Deliberately no `market.stamp` bump: that one invalidates a rival's
	 * sliced plan, and a drip on every step would leave no plan ever
	 * finishing. No `shotVisits` either: lingering in a system is not another
	 * encounter.
	 */
	function harvestStay(ledger, market, sim, runStep) {
		const count = sim.planetCount;
		const inside = ledger.inside;
		let gained = 0;
		for (let p = 0; p < count; p++) {
			if (!inside[p] || !visitReports(ledger, market, p)) continue;
			const pay = planetProfit(market, p, runStep);
			if (pay <= 0) continue;
			market.lastVisitStep[p] = runStep;
			stampReport(market, p, runStep);
			ledger.purse += pay;
			ledger.shotGain += pay;
			gained += pay;
		}
		return gained;
	}

	/* advances one step of system-entry harvesting for either the player or a rival */
	function stepHarvest(ledger, market, sim, runStep) {
		const count = sim.stepInsideAt(sim.cargo.x, sim.cargo.y, ledger.inside, ledger.entered);
		let gained = 0;
		for (let i = 0; i < count; i++) {
			gained += harvestPlanet(ledger, market, ledger.entered[i], runStep);
		}
		if (harvestMode === HARVEST_TICK) gained += harvestStay(ledger, market, sim, runStep);
		if (sim.status === GravitySim.STATUS_ENDED &&
			sim.endReason === GravitySim.END_IMPACT &&
			sim.endBody >= 0 && !ledger.inside[sim.endBody]) {
			ledger.inside[sim.endBody] = 1;
			gained += harvestPlanet(ledger, market, sim.endBody, runStep);
		}
		return gained;
	}

	function endFlight(ledger) {
		ledger.last = ledger.shotGain - ledger.fee;
		return ledger.shotGain;
	}

	/* the page's experimental panel drives the collection mode for every ledger */
	function setHarvestMode(mode) {
		harvestMode = mode === HARVEST_TICK ? HARVEST_TICK : HARVEST_ENTRY;
		return harvestMode;
	}

	function harvestModeOf() {
		return harvestMode;
	}

	/*
	 * reportUntil is the exclusive flight step when the device wears out.
	 * Specials remain payable without reports; omitted means the live ledger.
	 * An optional `{ body, value }` landing scratch receives the last value the
	 * walk accrues on that body whether or not the visit reported it: the
	 * rulers' bribe cashes exactly that value, so a dead device makes the visit
	 * pay nothing while the bribe still prices it.
	 *
	 * `dwells` (optional, one per row) is the stay-pay trail: under
	 * HARVEST_TICK each row also pays the steps its system stayed inside after
	 * the row's step — a step-0 (spawn-inside) row pays steps 1 .. dwell, an
	 * entry row pays its entry then steps + 1 .. steps + dwell — each gated by
	 * reportUntil, until the trail runs out. The drip sum mirrors `harvestStay`
	 * step by step: the exponential curve (and a rebel's fly-by ramp) is not
	 * linear, so a closed form over `paidDwell` would not match within 1e-12.
	 * Omitted `dwells`, or HARVEST_ENTRY, prices entries only — step-0 rows
	 * then pay nothing, exactly as the live entry rule does.
	 * `total` runs through the drip loop so every value joins the accumulator
	 * in the live `stepHarvest` order and the sums match bit for bit.
	 */
	function stayPayLog(market, planet, baseStep, from, to, reportUntil, total) {
		for (let s = from; s <= to; s++) {
			if (reportUntil !== undefined && s >= reportUntil) break;
			const at = baseStep + s;
			const value = planetProfitAt(market, planet, at, estScratch[planet]);
			total += value;
			estScratch[planet] = at;
		}
		return total;
	}

	function walkProfitLog(market, baseStep, planets, steps, count, ledger, reportUntil, landing, dwells) {
		const ticks = harvestMode === HARVEST_TICK;
		let total = 0;
		for (let i = 0; i < count; i++) {
			const planet = planets[i];
			const s0 = steps[i];
			const dwell = ticks && dwells !== undefined ? dwells[i] : 0;
			const special = planet === market.capitalPlanet || planet === market.arfPlanet;
			/* a spawn-inside row has no entry: the launch marked the system
			 * inside before step 1. Only the stay-pay runs, and never on the
			 * Capital (−3) or A.R.F. (0), whose pay would fail the drip gate. */
			if (s0 === 0) {
				if (dwell < 1 || special) continue;
				if (reportUntil === undefined ? !visitReports(ledger, market, planet)
					: market.quiet[planet]) continue;
				total = stayPayLog(market, planet, baseStep, 1, dwell, reportUntil, total);
				continue;
			}
			const at = baseStep + s0;
			const value = planetProfitAt(market, planet, at, estScratch[planet]);
			if (landing !== undefined && planet === landing.body) landing.value = value;
			const reports = special ? true : reportUntil === undefined
				? visitReports(ledger, market, planet)
				: !(market.quiet[planet] || s0 >= reportUntil);
			if (!reports) continue;
			total += value;
			estScratch[planet] = at;
			if (dwell >= 1 && !special) {
				total = stayPayLog(market, planet, baseStep, s0 + 1, s0 + dwell, reportUntil, total);
			}
		}
		return total;
	}

	function estimateProfitLog(market, baseStep, planets, steps, count, ledger, reportUntil, landing, dwells) {
		if (count === 0) return 0;
		estScratch.set(market.lastVisitStep);
		return walkProfitLog(market, baseStep, planets, steps, count, ledger, reportUntil, landing, dwells);
	}

	/* exact predicted harvest along a traced probe, dwell trail included */
	function estimateProfit(market, baseStep, sim, ledger, reportUntil, landing) {
		return estimateProfitLog(market, baseStep, sim.predLogPlanet, sim.predLogStep,
			sim.predLogCount, ledger, reportUntil, landing, sim.predLogDwell);
	}

	/* the generated universe is always PLANET_MAX planets; a run plays a subset.
	 * `mask[i] === 1` marks a planet in play and `count` is how many there are.
	 * The visit profit grows faster on a smaller world (k scales by
	 * PLANET_MAX / count) so a 13-planet career regenerates profit 2× as fast
	 * as the 26-planet default and the economy keeps pace. */
	function setCareerUniverse(career, mask, count) {
		career.planetMask = mask;
		career.planetCount = count;
	}

	function applyMarketUniverse(market, mask, count) {
		market.planetMask = mask;
		market.planetCount = count;
		market.k = MONEY.k * (OrbitWorld.DEFAULT_PLANETS / count);
	}

	/* a planet of the run's universe is in play when it is not masked out */
	function planetInPlay(career, planet) {
		return planet >= 0 && planet < OrbitWorld.PLANETS &&
			(!career.planetMask || career.planetMask[planet] === 1);
	}

	/* a colony sits on a planet of the run only when that planet is in play */
	function colonyInPlay(career, colony) {
		return planetInPlay(career, colony.planet);
	}

	Object.assign(GravityGame, {
		HARVEST_ENTRY, HARVEST_TICK, setHarvestMode, harvestMode: harvestModeOf, initSteps,
		createMarket, resetMarket, planetProfit, planetProfitAt, planetProfitUnscaledAt,
		applyMarketSpecials, bindRun, politicsSeconds, rebelRail, stampReport, visitReports,
		createLedger, resetLedger, beginFlight, stepHarvest, harvestPlanet, endFlight,
		estimateProfit, estimateProfitLog, setCareerUniverse, applyMarketUniverse, planetInPlay,
		colonyInPlay
	});
	Object.assign(inner, {
		createMarket, resetMarket, applyMarketSpecials, politicsSeconds, rebelRail,
		planetProfitUnscaledAt, planetProfit, resetLedger, openFlight, visitReports, endFlight,
		walkProfitLog, estimateProfitLog, applyMarketUniverse, planetInPlay, colonyInPlay
	});
});
