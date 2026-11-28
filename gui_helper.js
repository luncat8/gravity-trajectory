/*
 * Career helper scans: origin, the one landing-goal table, score and speed snap, the broad, focus, profit, quest and tweak candidates, the launch-book seed and the budgeted tick.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* ── helper UI & world ── origin, panel update, world attach */

function helperHelperOrigin() {
	if (selected >= 0 && selected < PLANETS) return selected;
	if (aiming || armed) return aimBody;
	return -1;
}

function helperUpdateUi() {
	if (!helperGroupEl) return;
	helperGroupEl.hidden = false;
	const route = routeRule();
	const canScan = !helperState.active && !replay.on && !playerIsBot() && !gameLocked() || !game.on;
	const focusOrigin = helperHelperOrigin();
	const focusOk = focusOrigin >= 0 && (route ? routeOccupiedBy(focusOrigin) < 0 : canAimFrom(focusOrigin));
	const tweakBase = helperTweakBase();
	const tweakOk = !helperState.active && tweakBase !== null && !replay.on && !playerIsBot() &&
		(route ? routeOccupiedBy(tweakBase.origin) < 0 : !gameLocked());
	if (helperScanBtn) {
		helperScanBtn.disabled = !canScan;
		helperScanBtn.textContent = route ? 'quick scan' : 'auto scan';
		helperScanBtn.title = selected >= 0
			? 'broad scan biased to ' + planetName(selected) + ' plus random planets'
			: 'broad random scan over all planets · each press adds fresh jitter';
	}
	if (helperFocusBtn) {
		helperFocusBtn.disabled = !canScan || !focusOk;
		helperFocusBtn.textContent = focusOk ? 'scan ' + planetName(focusOrigin) : 'scan here';
		helperFocusBtn.title = focusOk
			? 'scan many angles and speeds from ' + planetName(focusOrigin)
			: 'select a free planet first';
	}
	if (helperTweakBtn) {
		const tweakLength = tweakBase ? Math.round(tweakBase.length) : 0;
		helperTweakBtn.disabled = !tweakOk;
		helperTweakBtn.textContent = tweakBase
			? (tweakLength ? 'tweak ' + tweakLength + ' px' : 'tweak shot')
			: 'tweak best';
		helperTweakBtn.title = tweakBase
			? 'nudge ' + (tweakLength ? 'the ' + tweakLength + ' px shot' : 'the armed shot') +
				' by ± small angle and ±8 % speed · each press tries new jitter'
			: route ? 'make a best plan first (drag and wait for the trace to finish)'
			: 'arm a shot first (drag and wait for the trace)';
	}
	/* the scans price the selected player's company: its landing, purse and rail */
	const career = careerRule();
	const mine = career ? playerCareer() : null;
	const fieldStatic = activeCareerSim().fieldStatic;
	const landed = career && !gameLocked() && activeSim().status !== STATUS_FLYING ? mine.at : -1;
	const profitOk = canScan && landed >= 0 && fieldStatic &&
		mine.ended === GravityGame.CAREER_OPEN;
	if (helperProfitBtn) {
		helperProfitBtn.hidden = !career;
		helperProfitBtn.disabled = !profitOk;
		helperProfitBtn.textContent = 'best profit';
		helperProfitBtn.title = landed < 0
			? 'career · land somewhere to scan for money shots'
			: 'scan 34 aims from ' + planetName(landed) +
				' · rank by money (visits + contract legs − EMC fee − exit − the wear the shot adds)' +
				' · a saved shot that pays more wins';
	}
	if (helperEmcBtn) {
		helperEmcBtn.hidden = !career;
		helperEmcBtn.disabled = !profitOk;
		helperEmcBtn.textContent = 'profit + EMC';
		helperEmcBtn.title = landed < 0
			? 'career · land somewhere to scan'
			: 'scan from ' + planetName(landed) + ' for the best money shot that lands where an ' +
				'EMC-1 can be built · a saved shot that pays more wins';
	}
	if (helperQuestBtn) {
		helperQuestBtn.hidden = !career;
		helperQuestBtn.disabled = !profitOk;
		helperQuestBtn.textContent = 'quest scan';
		helperQuestBtn.title = landed < 0
			? 'career · land somewhere to scan'
			: 'scan from ' + planetName(landed) + ' for the shot that advances the open work ' +
				'· prices two-leg pickups through their real second leg and refuses doomed pickups';
	}
	if (helperPlanQuestBtn) {
		helperPlanQuestBtn.hidden = !career;
		helperPlanQuestBtn.disabled = !profitOk;
		helperPlanQuestBtn.textContent = 'plan quest';
		helperPlanQuestBtn.title = landed < 0
			? 'career · land somewhere to plan a quest route'
			: 'plan a full two-leg quest route from ' + planetName(landed) +
				', save both legs into the launch list and arm leg 1';
	}
	if (helperStopBtn) helperStopBtn.hidden = !helperState.active;
	if (helperProgressEl) helperProgressEl.hidden = !helperState.active;
	const tag = helperState.active
		? helperState.mode + ' ' + (helperState.index + 1) + '/' + helperState.candidates.length +
			(helperProbe.routeActive ? ' · ' + Math.round(helperProbe.routeProgress() * 100) + '%' : '')
		: tweakBase && tweakBase.length ? 'best ' + Math.round(tweakBase.length) + ' px' : 'ready';
	if (tag !== helperHudTag) {
		helperHudTag = tag;
		if (helperTagEl) helperTagEl.textContent = tag;
	}
	if (helperState.active && helperProgressFillEl && helperState.candidates) {
		const pct = Math.max(0, Math.min(100, helperState.index / helperState.candidates.length * 100));
		helperProgressFillEl.style.width = pct.toFixed(1) + '%';
	}
	if (helperProgressTextEl) {
		if (helperState.active) {
			const done = helperState.index;
			const total = helperState.candidates ? helperState.candidates.length : 0;
			const bestLen = helperState.best ? Math.round(helperState.best.length) : 0;
			helperProgressTextEl.textContent = done + '/' + total + (bestLen ? ' · best ' + bestLen + ' px' : '');
		} else helperProgressTextEl.textContent = '';
	}
}

function helperAttachWorld() {
	const sim = activeCareerSim();
	helperProbe.setWorldSize(sim.worldW, sim.worldH);
	helperProbe.setPeriodic(sim.periodic, sim);
	helperProbe.setPlanets(tradeSim.planetCount || PLANETS, tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
		tradeSim.orbitRX, tradeSim.orbitRY, tradeSim.orbitTiltCos, tradeSim.orbitTiltSin);
	helperProbe.setPlanetMask(planetMask);
	helperProbe.setScales(sim.gravityScale, sim.forceScale);
	helperProbe.setField(sim.bodyCount, sim.bodyR, sim.strength, sim.fillField, sim.fieldStatic);
	helperProbe.fieldT = sim.fieldT;
	helperProbe.fieldRate = sim.fieldRate;
}

/* ── goals & scoring ── goal table, leg text, offer tags, goal score, copied logs, plan-quest hits, helperScore */

/*
 * How a scan ranks a landing. Every career scan prices a shot through the
 * rule's one landing table (`GravityGame.careerLandingFacts`): `cash` is money
 * that reaches the purse, `credit` is the leg of the taken contract it
 * advances. A goal only decides what that credit is worth against money, and
 * whether the landing must be able to build a pad. No goal knows or cares
 * which kind of contract is open.
 */
const HELPER_QUEST_CREDIT = 10;
const HELPER_GOALS = {
	score: { credit: 0, builds: false, label: '', empty: '' },
	profit: { credit: 0, builds: false, label: 'best money shot', empty: 'no paying shot found' },
	profitEmc: { credit: 0, builds: true, label: 'best money shot', empty: 'no EMC-buildable landing' },
	quest: { credit: HELPER_QUEST_CREDIT, builds: false, label: 'quest shot', empty: 'no quest shot found' },
	planQuest: { credit: 1, builds: false, label: 'quest plan', empty: 'no quest route found' }
};
/* what the winning shot completes, printed after its planet */
const HELPER_LEG_TEXT = ['', ' · load', ' · deliver', ' · medics', ' · patients', ' · sport'];
const HELPER_LEG_VERB = ['', 'load', 'deliver', 'medics', 'patients', 'sport'];

function helperLegText(leg) {
	return HELPER_LEG_TEXT[leg] || '';
}

function helperLegVerb(leg) {
	return HELPER_LEG_VERB[leg] || 'to';
}

function helperOfferTag(slot) {
	return slot === GravityGame.MEDIC_SLOT ? 'medic offer' : 'offer #' + (slot + 1);
}

/* Preallocated two-leg scratch for quest scan & plan quest (zero per-step allocs). */
const helperPlanScratch = GravityGame.createLegPlan();
const helperPlanWin = GravityGame.createLegPlan();
const helperPlanInput = {
	origin: -1, body: -1, speed: 0, flownLen: 0, length: 0, steps: 0,
	visitPay: 0, bribe: 0, condition: 1, burnDv: 0, fee: undefined,
	logPlanet: null, logStep: null, logDwell: null, logCount: 0
};
const helperPlanOpts = { slot: -1, seekClaim: false, exitSpeedFn: null };
const helperBestLeg1Log = {
	time: 0, cash: 0, net: -Infinity,
	logPlanet: new Int16Array(GravityGame.BOOK_LOG_MAX),
	logStep: new Int32Array(GravityGame.BOOK_LOG_MAX),
	logDwell: new Int32Array(GravityGame.BOOK_LOG_MAX),
	logCount: 0
};

/* the money of the last scored candidate, so the notice prints cash and the
 * leg it completes instead of the ranking score */
const helperLastMoney = {
	net: -Infinity, cash: 0, leg: 0, hasSecond: false, twoLegTotal: -Infinity,
	leg1StepNet: -Infinity, leg2Body: -1, leg2Net: -Infinity, leg2Leg: 0,
	slot: -1, prospective: false
};

function helperCareerGoalScore(careerMoney, goalKey) {
	if (!moneyFlyable(careerMoney)) return -Infinity;
	const goal = HELPER_GOALS[goalKey];
	if (goal.builds && !careerMoney.builds) return -Infinity;
	if (goalKey === 'quest' && careerMoney.twoLegStop) {
		return careerMoney.leg2Feasible ? careerMoney.twoLegTotal : -Infinity;
	}
	return careerMoney.net + careerMoney.credit * goal.credit;
}

function copyHelperLog(dst, logPlanet, logStep, logDwell, count) {
	const n = count < GravityGame.BOOK_LOG_MAX ? count : GravityGame.BOOK_LOG_MAX;
	dst.logCount = n;
	for (let i = 0; i < n; i++) {
		dst.logPlanet[i] = logPlanet[i];
		dst.logStep[i] = logStep[i];
		dst.logDwell[i] = logDwell ? logDwell[i] : 0;
	}
}

function copyLegPlanSummary(dst, src) {
	dst.feasible = src.feasible;
	dst.hasSecond = src.hasSecond;
	dst.slot = src.slot;
	dst.prospective = src.prospective;
	dst.leg1Leg = src.leg1Leg;
	dst.leg1Cash = src.leg1Cash;
	dst.leg1Fee = src.leg1Fee;
	dst.leg1Wear = src.leg1Wear;
	dst.leg1Exit = src.leg1Exit;
	dst.leg1Net = src.leg1Net;
	dst.credit = src.credit;
	dst.total = src.total;
	if (src.hasSecond) {
		const d2 = dst.leg2;
		const s2 = src.leg2;
		d2.origin = s2.origin;
		d2.angleU = s2.angleU;
		d2.speedU = s2.speedU;
		d2.body = s2.body;
		d2.steps = s2.steps;
		d2.time = s2.time;
		d2.length = s2.length;
		d2.cash = s2.cash;
		d2.fee = s2.fee;
		d2.wear = s2.wear;
		d2.exit = s2.exit;
		d2.net = s2.net;
		d2.leg = s2.leg;
		copyHelperLog(d2, s2.logPlanet, s2.logStep, s2.logDwell, s2.logCount);
	}
}

function evaluatePlanQuestHit(career, sim, origin, speed, body, steps, length,
	logPlanet, logStep, logDwell, logCount, outWin) {
	bot.prepareCareerExitProbe(sim);
	const condition = previewStartCondition(career, sim, origin, speed);
	const reportUntil = GravityGame.forecastReportUntil(career, condition, speed, 0);
	const visitPay = GravityGame.estimateProfitLog(game.market, game.clockSteps,
		logPlanet, logStep, logCount, career.ledger, reportUntil, undefined, logDwell);
	helperPlanInput.origin = origin;
	helperPlanInput.body = body;
	helperPlanInput.speed = speed;
	helperPlanInput.flownLen = 0;
	helperPlanInput.length = length;
	helperPlanInput.steps = steps;
	helperPlanInput.visitPay = visitPay;
	helperPlanInput.bribe = 0;
	helperPlanInput.condition = condition;
	helperPlanInput.burnDv = 0;
	helperPlanInput.fee = undefined;
	helperPlanInput.logPlanet = logPlanet;
	helperPlanInput.logStep = logStep;
	helperPlanInput.logDwell = logDwell;
	helperPlanInput.logCount = logCount;
	helperPlanOpts.seekClaim = false;
	helperPlanOpts.exitSpeedFn = bot.careerExitFn;

	let best = -Infinity;
	const singleSlot = career.contract >= 0;
	const startSlot = singleSlot ? career.contract : 0;
	const endSlot = singleSlot ? career.contract + 1 : GravityGame.BOARD_SIZE;
	for (let s = startSlot; s < endSlot; s++) {
		if (!singleSlot && (s === GravityGame.COMPETE_SLOT || !GravityGame.canAccept(career, s))) {
			continue;
		}
		helperPlanOpts.slot = singleSlot ? -1 : s;
		GravityGame.careerLegPlan(helperPlanScratch, career, game.market, sim,
			helperPlanInput, game.clockSteps, helperPlanOpts);
		if (!helperPlanScratch.feasible) continue;
		const completesOne = helperPlanScratch.leg1Leg === GravityGame.LEG_DELIVER ||
			helperPlanScratch.leg1Leg === GravityGame.LEG_PATIENTS;
		if (!helperPlanScratch.hasSecond && !completesOne) continue;
		if (helperPlanScratch.total <= best) continue;
		best = helperPlanScratch.total;
		if (outWin) copyLegPlanSummary(outWin, helperPlanScratch);
	}
	helperPlanInput.logPlanet = null;
	helperPlanInput.logStep = null;
	helperPlanInput.logDwell = null;
	helperPlanInput.logCount = 0;
	return best;
}

function helperScore(probe, cand) {
	const origin = cand.origin;
	if (routeRule()) {
		if (probe.predReason === END_IMPACT || probe.predReason === END_EXIT) return probe.predLength;
		return -1e12;
	}
	let careerMoney = null;
	if (careerRule()) {
		if (probe.predReason !== END_IMPACT || probe.predBody < 0) return -Infinity;
		if (!activeCareer().ship.colonyKit && GravityGame.emptyWorld(activeCareer(), probe.predBody)) return -Infinity;
		if (helperState.goal === 'planQuest') {
			const career = activeCareer();
			const sim = activeCareerSim();
			const speed = GravityGame.speedOf(cand.speedU);
			const total = evaluatePlanQuestHit(career, sim, origin, speed, probe.predBody,
				probe.predSteps, probe.predLength, probe.predLogPlanet, probe.predLogStep,
				probe.predLogDwell, probe.predLogCount, helperPlanScratch);
			if (!Number.isFinite(total)) return -Infinity;
			helperLastMoney.net = helperPlanScratch.leg1Net;
			helperLastMoney.cash = helperPlanScratch.leg1Cash;
			helperLastMoney.leg = helperPlanScratch.leg1Leg;
			helperLastMoney.hasSecond = helperPlanScratch.hasSecond;
			helperLastMoney.twoLegTotal = helperPlanScratch.total;
			helperLastMoney.leg1StepNet = helperPlanScratch.leg1Cash -
				helperPlanScratch.leg1Fee - helperPlanScratch.leg1Wear;
			helperLastMoney.leg2Body = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.body : -1;
			helperLastMoney.leg2Net = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.net : -Infinity;
			helperLastMoney.leg2Leg = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.leg : 0;
			helperLastMoney.slot = helperPlanScratch.slot;
			helperLastMoney.prospective = helperPlanScratch.prospective;
			return total;
		}
		careerMoney = traceMoney(probe, origin, GravityGame.speedOf(cand.speedU));
		if (!moneyFlyable(careerMoney)) return -Infinity;
		helperLastMoney.net = careerMoney.net;
		helperLastMoney.cash = careerMoney.cash;
		helperLastMoney.leg = careerMoney.leg;
		helperLastMoney.hasSecond = careerMoney.hasSecond;
		helperLastMoney.twoLegTotal = careerMoney.twoLegTotal;
		helperLastMoney.leg1StepNet = careerMoney.leg1StepNet;
		helperLastMoney.leg2Body = careerMoney.hasSecond && careerMoney.legPlan
			? careerMoney.legPlan.leg2.body : -1;
		helperLastMoney.leg2Net = careerMoney.hasSecond && careerMoney.legPlan
			? careerMoney.legPlan.leg2.net : -Infinity;
		helperLastMoney.leg2Leg = careerMoney.hasSecond && careerMoney.legPlan
			? careerMoney.legPlan.leg2.leg : 0;
		helperLastMoney.slot = careerMoney.legPlan ? careerMoney.legPlan.slot : -1;
		helperLastMoney.prospective = false;
		if (helperState.goal !== 'score') {
			return helperCareerGoalScore(careerMoney, helperState.goal);
		}
	}
	const profit = !careerMoney && game.on
		? GravityGame.estimateProfit(game.market, game.clockSteps, probe, slotLedger(activeSlotIndex())) : 0;
	const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
	const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
	const newVisits = probe.predNewVisits;
	let score = lands * 12 - samePad * 35 - (probe.predReason === END_EXIT ? 220 : 0);
	if (careerMoney) {
		/* Untargeted scans price the same costs and contract legs as the others. */
		score += careerMoney.net * 30 + careerMoney.credit * 60 + newVisits * 4 -
			probe.predTime * 0.12;
	} else if (game.on && ruleSpec().stopOnTour) {
		const wouldComplete = activeSim().visitedCount + newVisits >= planetCount;
		score += (wouldComplete ? 80 : 0) + newVisits * 12 + profit * 18 - probe.predTime * 0.16;
	} else if (game.on && moneyRule()) {
		score += profit * 30 + newVisits * 3 - probe.predTime * 0.14;
	} else {
		score += newVisits * 10 + profit * 12 - probe.predTime * 0.12;
	}
	score += probe.predLength * 0.0002;
	return score;
}

/* ── candidate scans ── broad, focus, tweak, profit, quest and plan-quest makers and starters, book seeds */

function helperSnapSpeedUnits(origin, speed) {
	const maxU = Math.floor(speedCeiling(origin) * GravityGame.SPEED_STEPS + 1e-9);
	const minU = GravityGame.speedUnits(SPEED_MIN);
	let u = GravityGame.speedUnits(speed);
	if (u < minU) u = minU;
	if (u > maxU) u = maxU;
	return u;
}

function helperMakeBroad(count) {
	const route = routeRule();
	const out = [];
	const fixedOrigin = game.on && !route ? activeSim().landedBody : -1;
	if (fixedOrigin >= 0 && !canAimFrom(fixedOrigin)) return out;
	let attempts = 0;
	while (out.length < count && attempts < count * 6) {
		attempts += 1;
		let planet;
		if (fixedOrigin >= 0) planet = fixedOrigin;
		else if (selected >= 0 && planetMask[selected] && Math.random() < 0.42) planet = selected;
		else planet = randomActivePlanet();
		if (route && routeOccupiedBy(planet) >= 0) continue;
		if (!route && !game.on && planet >= PLANETS) continue;
		if (game.on && !route && !canAimFrom(planet)) continue;
		const cap = speedCeiling(planet);
		const angle = Math.random() * TAU;
		const speed = SPEED_MIN + Math.random() * Math.max(0, cap - SPEED_MIN);
		out.push({
			origin: planet,
			angleU: GravityGame.angleUnits(angle),
			speedU: helperSnapSpeedUnits(planet, speed)
		});
	}
	return out;
}

function helperMakeFocus(origin, count) {
	const out = [];
	const cap = speedCeiling(origin);
	const span = Math.max(0, cap - SPEED_MIN);
	for (let i = 0; i < count; i++) {
		const angle = Math.random() * TAU;
		const jitter = (Math.random() - 0.5) * 0.06;
		const a = (angle + jitter + TAU) % TAU;
		const speed = SPEED_MIN + Math.random() * span;
		const s = speed * (0.97 + Math.random() * 0.06);
		out.push({
			origin: origin,
			angleU: GravityGame.angleUnits(a),
			speedU: helperSnapSpeedUnits(origin, s)
		});
	}
	return out;
}

function helperMakeTweak(base, count) {
	const baseAngle = GravityGame.angleOf(base.angleU);
	const baseSpeed = GravityGame.speedOf(base.speedU);
	const out = [];
	out.push({
		origin: base.origin,
		angleU: base.angleU,
		speedU: helperSnapSpeedUnits(base.origin, baseSpeed)
	});
	for (let i = 1; i < count; i++) {
		let angle = baseAngle + (Math.random() - 0.5) * 0.26;
		angle = (angle % TAU + TAU) % TAU;
		const speed = baseSpeed * (0.92 + Math.random() * 0.16);
		out.push({
			origin: base.origin,
			angleU: GravityGame.angleUnits(angle),
			speedU: helperSnapSpeedUnits(base.origin, speed)
		});
	}
	return out;
}

function helperBeginCandidate() {
	if (!helperState.active || helperState.index >= helperState.candidates.length) return;
	const cand = helperState.candidates[helperState.index];
	const live = activeCareerSim();
	helperProbe.visited.set(live.visited);
	helperProbe.visitedCount = live.visitedCount;
	helperProbe.fieldT = live.fieldT;
	helperProbe.fieldRate = live.fieldRate;
	helperProbe.horizon = helperState.horizon;
	if (!helperProbe.fieldStatic) helperProbe.refreshField();
	const angle = GravityGame.angleOf(cand.angleU);
	const speed = GravityGame.speedOf(cand.speedU);
	helperProbe.routeBegin(cand.origin, angle, speed, helperState.horizon);
}

/* `seed` is a saved shot already known to be worth `score`: the scan has to
 * beat it, so a press never returns worse than the launch list */
function helperRun(candidates, mode, goal, seed) {
	if (!candidates || candidates.length === 0) return;
	helperAttachWorld();
	helperState.active = true;
	helperState.mode = mode;
	helperState.goal = goal || 'score';
	helperState.candidates = candidates;
	helperState.index = 0;
	helperState.best = seed || null;
	helperState.bestScore = seed ? seed.score : -Infinity;
	helperState.fromBook = Boolean(seed);
	helperState.startedAt = performance.now();
	if (routeRule()) helperState.horizon = ruleSpec().horizon;
	/* a career flight is capped by the rule, not by the preview slider */
	else if (careerRule()) helperState.horizon = GravityGame.CAP_SECONDS;
	else helperState.horizon = activeCareerSim().horizon;
	helperBeginCandidate();
	helperUpdateUi();
	hudAt = -Infinity;
}

function helperStartBroad() {
	if (helperState.active || replay.on || playerIsBot()) return;
	if (game.on && gameLocked()) return;
	const count = routeRule() ? 28 : 20;
	const cands = helperMakeBroad(count);
	if (cands.length === 0) return;
	helperRun(cands, 'quick scan');
}

function helperStartFocus() {
	if (helperState.active || replay.on || playerIsBot()) return;
	if (game.on && gameLocked()) return;
	let origin = helperHelperOrigin();
	if (origin < 0) return;
	if (routeRule() && routeOccupiedBy(origin) >= 0) return;
	if (!routeRule() && !canAimFrom(origin)) {
		const landed = activeSim().landedBody;
		if (landed >= 0 && origin !== landed) return;
	}
	const count = routeRule() ? 22 : 18;
	const cands = helperMakeFocus(origin, count);
	helperRun(cands, 'scan ' + planetName(origin));
}

/* career profit scans: random aims from the landed pad, plus, when a pad to
 * build on is the point, a few aims at the nearest padless planets */
function helperMakeProfit(origin, count, requireEmc) {
	const out = helperMakeFocus(origin, count);
	if (!requireEmc) return out;
	const career = playerCareer();
	const cap = speedCeiling(origin);
	const span = Math.max(0, cap - SPEED_MIN);
	const near = [];
	for (let p = 0; p < PLANETS; p++) {
		if (!planetMask[p]) continue;
		if (p === origin || career.pads[p].catapult !== null) continue;
		const dx = worldDeltaX(tradeSim.planetX[p] - tradeSim.planetX[origin]);
		const dy = worldDeltaY(tradeSim.planetY[p] - tradeSim.planetY[origin]);
		near.push({ planet: p, dist: dx * dx + dy * dy });
	}
	near.sort((a, b) => a.dist - b.dist);
	const picks = Math.min(4, near.length);
	for (let i = 0; i < picks; i++) {
		const planet = near[i].planet;
		const angle = Math.atan2(
			worldDeltaY(tradeSim.planetY[planet] - tradeSim.planetY[origin]),
			worldDeltaX(tradeSim.planetX[planet] - tradeSim.planetX[origin])
		);
		for (let k = 0; k < 3; k++) {
			const a = (angle + (k - 1) * 0.08) % TAU;
			const speed = SPEED_MIN + span * (0.35 + 0.2 * k);
			out.push({
				origin: origin,
				angleU: GravityGame.angleUnits(a < 0 ? a + TAU : a),
				speedU: helperSnapSpeedUnits(origin, speed)
			});
		}
	}
	return out;
}

/* the seed slot: a saved shot priced for the scan, reused between presses */
const helperSeed = {
	origin: -1, angleU: 0, speedU: 0, length: 0, steps: 0,
	reason: END_IMPACT, body: -1, score: -Infinity, money: 0, credit: 0, leg: 0,
	hasSecond: false, twoLegTotal: -Infinity, leg1StepNet: -Infinity,
	leg2Body: -1, leg2Net: -Infinity, leg2Leg: 0, slot: -1, prospective: false
};

/*
 * The best saved shot from this rail for a career button, priced at the live
 * market and the live cap without spending a trace. It seeds the scan on the
 * button's own goal, so a search only replaces it with a better shot.
 */
function helperBookSeed(career, origin, goalKey) {
	if (!GravityGame.bookReady(career.launchBook, pageBookTag())) return null;
	const entries = career.launchBook.entries;
	const cap = speedCeiling(origin);
	let best = null;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.origin !== origin) continue;
		const speed = GravityGame.speedOf(entry.speedU);
		if (speed > cap + 1e-9) continue;
		if (goalKey === 'planQuest') {
			const score = evaluatePlanQuestHit(career, activeCareerSim(), entry.origin, speed,
				entry.body, entry.steps, entry.length, entry.logPlanet, entry.logStep,
				entry.logDwell, entry.logCount, helperPlanScratch);
			if (!Number.isFinite(score) || (best !== null && score <= best.score)) continue;
			copyLegPlanSummary(helperPlanWin, helperPlanScratch);
			helperBestLeg1Log.time = entry.time;
			helperBestLeg1Log.cash = helperPlanScratch.leg1Cash;
			helperBestLeg1Log.net = helperPlanScratch.leg1Net;
			copyHelperLog(helperBestLeg1Log, entry.logPlanet, entry.logStep, entry.logDwell, entry.logCount);
			helperSeed.origin = entry.origin;
			helperSeed.angleU = entry.angleU;
			helperSeed.speedU = entry.speedU;
			helperSeed.length = entry.length;
			helperSeed.steps = entry.steps;
			helperSeed.body = entry.body;
			helperSeed.score = score;
			helperSeed.money = helperPlanScratch.leg1Net;
			helperSeed.credit = helperPlanScratch.credit;
			helperSeed.leg = helperPlanScratch.leg1Leg;
			helperSeed.hasSecond = helperPlanScratch.hasSecond;
			helperSeed.twoLegTotal = helperPlanScratch.total;
			helperSeed.leg1StepNet = helperPlanScratch.leg1Cash -
				helperPlanScratch.leg1Fee - helperPlanScratch.leg1Wear;
			helperSeed.leg2Body = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.body : -1;
			helperSeed.leg2Net = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.net : -Infinity;
			helperSeed.leg2Leg = helperPlanScratch.hasSecond ? helperPlanScratch.leg2.leg : 0;
			helperSeed.slot = helperPlanScratch.slot;
			helperSeed.prospective = helperPlanScratch.prospective;
			best = helperSeed;
			continue;
		}
		const money = storedMoney(entry);
		const score = helperCareerGoalScore(money, goalKey);
		if (!Number.isFinite(score)) continue;
		if (best !== null && score <= best.score) continue;
		helperSeed.origin = entry.origin;
		helperSeed.angleU = entry.angleU;
		helperSeed.speedU = entry.speedU;
		helperSeed.length = entry.length;
		helperSeed.steps = entry.steps;
		helperSeed.body = entry.body;
		helperSeed.score = score;
		helperSeed.money = money.net;
		helperSeed.credit = money.credit;
		helperSeed.leg = money.leg;
		helperSeed.hasSecond = money.hasSecond;
		helperSeed.twoLegTotal = money.twoLegTotal;
		helperSeed.leg1StepNet = money.leg1StepNet;
		helperSeed.leg2Body = money.hasSecond && money.legPlan ? money.legPlan.leg2.body : -1;
		helperSeed.leg2Net = money.hasSecond && money.legPlan ? money.legPlan.leg2.net : -Infinity;
		helperSeed.leg2Leg = money.hasSecond && money.legPlan ? money.legPlan.leg2.leg : 0;
		helperSeed.slot = money.legPlan ? money.legPlan.slot : -1;
		helperSeed.prospective = false;
		best = helperSeed;
	}
	return best;
}

/* one career scan: guard the landed ship, build its candidates and seed the
 * ranking with the best saved shot priced on the same goal */
function helperStartCareer(goal, mode, build) {
	if (helperState.active || replay.on || playerIsBot()) return;
	const career = playerCareer();
	if (!careerRule() || gameLocked() || !activeCareerSim().fieldStatic) return;
	const origin = career.at;
	if (origin < 0 || activeSim().status === STATUS_FLYING) return;
	if (career.ended !== GravityGame.CAREER_OPEN) return;
	const cands = build(origin);
	if (cands.length === 0) {
		careerNotice(HELPER_GOALS[goal].empty);
		return;
	}
	let seed = helperBookSeed(career, origin, goal);
	const sim = activeSim();
	if (goal !== 'planQuest' && armed && aimBody === origin && !dirty &&
		sim.predReason === END_IMPACT && sim.predBody >= 0 &&
		aimSpeed <= speedCeiling(origin) + 1e-9) {
		const money = traceMoney(sim, origin, aimSpeed);
		const score = helperCareerGoalScore(money, goal);
		if (Number.isFinite(score) && (!seed || score > seed.score)) {
			helperSeed.origin = origin;
			helperSeed.angleU = GravityGame.angleUnits(aimAngle);
			helperSeed.speedU = GravityGame.speedUnits(aimSpeed);
			helperSeed.length = sim.predLength;
			helperSeed.steps = sim.predSteps;
			helperSeed.body = sim.predBody;
			helperSeed.score = score;
			helperSeed.money = money.net;
			helperSeed.credit = money.credit;
			helperSeed.leg = money.leg;
			helperSeed.hasSecond = money.hasSecond;
			helperSeed.twoLegTotal = money.twoLegTotal;
			helperSeed.leg1StepNet = money.leg1StepNet;
			helperSeed.leg2Body = money.hasSecond && money.legPlan ? money.legPlan.leg2.body : -1;
			helperSeed.leg2Net = money.hasSecond && money.legPlan ? money.legPlan.leg2.net : -Infinity;
			helperSeed.leg2Leg = money.hasSecond && money.legPlan ? money.legPlan.leg2.leg : 0;
			helperSeed.slot = money.legPlan ? money.legPlan.slot : -1;
			helperSeed.prospective = false;
			seed = helperSeed;
		}
	}
	helperRun(cands, mode, goal, seed);
}

function helperStartProfit(requireEmc) {
	helperStartCareer(requireEmc ? 'profitEmc' : 'profit',
		requireEmc ? 'profit + EMC' : 'best profit',
		(origin) => helperMakeProfit(origin, requireEmc ? 26 : 34, requireEmc));
}

/* quest scan candidates: half random aims from the landed pad, plus direct
 * shots at the planets the open work wants next, whatever kind it is */
function helperMakeQuest(origin, count) {
	const out = helperMakeFocus(origin, Math.max(8, Math.floor(count / 2)));
	const targets = GravityGame.careerGoalBodies(playerCareer());
	const cap = speedCeiling(origin);
	const span = Math.max(0, cap - SPEED_MIN);
	for (let t = 0; t < targets.length && out.length < count; t++) {
		const planet = targets[t];
		if (planet < 0 || planet >= PLANETS || planet === origin || !planetMask[planet]) continue;
		const angle = Math.atan2(
			worldDeltaY(tradeSim.planetY[planet] - tradeSim.planetY[origin]),
			worldDeltaX(tradeSim.planetX[planet] - tradeSim.planetX[origin])
		);
		for (let k = 0; k < 3 && out.length < count; k++) {
			const a = (angle + (k - 1) * 0.08 + TAU) % TAU;
			const speed = SPEED_MIN + span * (0.35 + 0.25 * k);
			out.push({
				origin: origin,
				angleU: GravityGame.angleUnits(a),
				speedU: helperSnapSpeedUnits(origin, speed)
			});
		}
	}
	return out;
}

function helperStartQuest() {
	helperStartCareer('quest', 'quest scan', (origin) => helperMakeQuest(origin, 34));
}

function helperPlanStopBodies(career, origin) {
	const stops = [];
	const singleSlot = career.contract >= 0;
	const startSlot = singleSlot ? career.contract : 0;
	const endSlot = singleSlot ? career.contract + 1 : GravityGame.BOARD_SIZE;
	for (let s = startSlot; s < endSlot; s++) {
		if (!singleSlot && (s === GravityGame.COMPETE_SLOT || !GravityGame.canAccept(career, s))) {
			continue;
		}
		const task = career.tasks[s];
		let target = -1;
		if (task.kind === GravityGame.TASK_DELIVERY) {
			const loadedHere = task.state === GravityGame.TASK_LOADED ||
				(task.state === GravityGame.TASK_OFFERED && origin === task.from);
			target = loadedHere ? task.to : task.from;
		} else if (task.kind === GravityGame.TASK_MEDIC) {
			target = task.aboard > 0 ? career.capitalPlanet : task.to;
		}
		if (target >= 0 && target < PLANETS && target !== origin && planetMask[target] &&
			!stops.includes(target)) {
			stops.push(target);
		}
	}
	return stops;
}

function helperMakePlanQuest(origin) {
	const career = playerCareer();
	const stops = helperPlanStopBodies(career, origin);
	if (stops.length === 0) return [];
	const out = [];
	const cap = speedCeiling(origin);
	const span = Math.max(0, cap - SPEED_MIN);
	const fracs = [0.08, 0.24, 0.44, 0.68, 0.94];
	for (let i = 0; i < stops.length; i++) {
		const planet = stops[i];
		const base = Math.atan2(
			worldDeltaY(tradeSim.planetY[planet] - tradeSim.planetY[origin]),
			worldDeltaX(tradeSim.planetX[planet] - tradeSim.planetX[origin])
		);
		for (let f = 0; f < fracs.length; f++) {
			const speedU = helperSnapSpeedUnits(origin, SPEED_MIN + span * fracs[f]);
			for (let k = -4; k <= 4; k++) {
				const a = (base + k * 0.055 + TAU) % TAU;
				out.push({ origin: origin, angleU: GravityGame.angleUnits(a), speedU: speedU });
			}
		}
	}
	const circleAngles = 24;
	const circleFracs = [0.18, 0.45, 0.78];
	for (let f = 0; f < circleFracs.length; f++) {
		const speedU = helperSnapSpeedUnits(origin, SPEED_MIN + span * circleFracs[f]);
		for (let a = 0; a < circleAngles; a++) {
			const angle = (a + 0.5) / circleAngles * TAU;
			out.push({ origin: origin, angleU: GravityGame.angleUnits(angle), speedU: speedU });
		}
	}
	return out;
}

function helperStartPlanQuest() {
	helperPlanWin.feasible = false;
	helperPlanWin.hasSecond = false;
	helperBestLeg1Log.logCount = 0;
	helperStartCareer('planQuest', 'plan quest', helperMakePlanQuest);
}

/*
 * The shot a tweak starts from: route keeps a best record for the selected
 * player's start planet, every other rule nudges the shot that player has
 * armed (a career or a lab aim is not stored anywhere else). Both the button
 * gate and the press read this one answer, so a lit button always has a base.
 */
function helperTweakBase() {
	if (routeRule()) {
		const best = activeRouteBest();
		return best.ready ? best : null;
	}
	if (!armed || aimBody < 0) return null;
	return {
		origin: aimBody,
		angleU: GravityGame.angleUnits(aimAngle),
		speedU: GravityGame.speedUnits(aimSpeed),
		length: activeSim().predLength
	};
}

function helperStartTweak() {
	if (helperState.active || replay.on || playerIsBot()) return;
	if (game.on && gameLocked()) return;
	const base = helperTweakBase();
	if (!base) return;
	if (routeRule() && routeOccupiedBy(base.origin) >= 0) return;
	const cands = helperMakeTweak(base, 16);
	helperRun(cands, 'tweak');
}

/* ── stop & tick ── stop, cancel on change, the budgeted helperTick */

function stopHelper() {
	if (!helperState.active) return;
	helperState.active = false;
	helperState.candidates = null;
	if (helperProgressFillEl) helperProgressFillEl.style.width = '0%';
	helperUpdateUi();
	hudAt = -Infinity;
}

function cancelHelperForChange(reason) {
	commsInvalidate();
	if (!helperState.active) return;
	stopHelper();
	if (careerRule()) careerNotice(reason + ' changed · scan again');
}

function helperTick(budgetMs) {
	if (!helperState.active) return;
	const budget = budgetMs > 0 ? budgetMs : HELPER_BUDGET_MS;
	const start = performance.now();
	while (helperState.active && performance.now() - start < budget) {
		if (helperProbe.routeActive) {
			const left = budget - (performance.now() - start);
			if (left <= 0.3) break;
			helperProbe.routeStep(Math.min(left, 2));
			if (helperProbe.routeActive) break;
		}
		if (!helperProbe.routeActive) {
			const idx = helperState.index;
			if (idx < helperState.candidates.length) {
				const cand = helperState.candidates[idx];
				const score = helperScore(helperProbe, cand);
				if (careerRule() && helperState.goal !== 'planQuest') {
					saveTrace(helperProbe, cand.origin, cand.angleU, cand.speedU);
				}
				if (score > helperState.bestScore) {
					helperState.bestScore = score;
					helperState.fromBook = false;
					if (helperState.goal === 'planQuest') {
						copyLegPlanSummary(helperPlanWin, helperPlanScratch);
						helperBestLeg1Log.time = helperProbe.predTime;
						helperBestLeg1Log.cash = helperLastMoney.cash;
						helperBestLeg1Log.net = helperLastMoney.net;
						copyHelperLog(helperBestLeg1Log, helperProbe.predLogPlanet,
							helperProbe.predLogStep, helperProbe.predLogDwell,
							helperProbe.predLogCount);
					}
					helperState.best = {
						origin: cand.origin, angleU: cand.angleU, speedU: cand.speedU,
						length: helperProbe.predLength, steps: helperProbe.predSteps,
						reason: helperProbe.predReason, body: helperProbe.predBody,
						score: score, money: helperLastMoney.net, leg: helperLastMoney.leg,
						hasSecond: helperLastMoney.hasSecond,
						twoLegTotal: helperLastMoney.twoLegTotal,
						leg1StepNet: helperLastMoney.leg1StepNet,
						leg2Body: helperLastMoney.leg2Body,
						leg2Net: helperLastMoney.leg2Net,
						leg2Leg: helperLastMoney.leg2Leg,
						slot: helperLastMoney.slot,
						prospective: helperLastMoney.prospective
					};
				}
				helperState.index += 1;
				if (helperState.index < helperState.candidates.length) {
					helperBeginCandidate();
					continue;
				}
			}
			if (helperState.index >= helperState.candidates.length) {
				const best = helperState.best;
				helperState.active = false;
				helperState.candidates = null;
				if (best && best.score > -1e11) {
					if (careerRule()) {
						if (helperState.goal === 'planQuest') {
							saveBookTraceData({
								origin: best.origin, angleU: best.angleU, speedU: best.speedU,
								body: best.body, steps: best.steps, time: helperBestLeg1Log.time,
								length: best.length, score: helperBestLeg1Log.net,
								money: helperBestLeg1Log.cash,
								logPlanet: helperBestLeg1Log.logPlanet,
								logStep: helperBestLeg1Log.logStep,
								logDwell: helperBestLeg1Log.logDwell,
								logCount: helperBestLeg1Log.logCount
							});
							if (helperPlanWin.hasSecond) {
								const l2 = helperPlanWin.leg2;
								saveBookTraceData({
									origin: l2.origin, angleU: l2.angleU, speedU: l2.speedU,
									body: l2.body, steps: l2.steps, time: l2.time,
									length: l2.length, score: l2.net, money: l2.cash,
									logPlanet: l2.logPlanet, logStep: l2.logStep,
									logDwell: l2.logDwell, logCount: l2.logCount
								});
							}
							refreshLaunchList(true);
							const offerNote = best.prospective
								? helperOfferTag(best.slot) + ' (accept to fly) · ' : '';
							if (best.hasSecond && best.leg2Body >= 0) {
								careerNotice('quest plan · ' + offerNote +
									planetName(best.body) + ' (' + signedMoney(best.leg1StepNet) +
									') \u2192 ' + helperLegVerb(best.leg2Leg) + ' ' +
									planetName(best.leg2Body) + ' (' + signedMoney(best.leg2Net) +
									') · net ' + signedMoney(best.twoLegTotal));
							} else {
								careerNotice('quest plan · ' + offerNote +
									helperLegVerb(best.leg) + ' ' + planetName(best.body) +
									' · net ' + signedMoney(best.twoLegTotal));
							}
						} else {
							const goal = HELPER_GOALS[helperState.goal];
							const label = goal.label ? (helperState.fromBook ? 'launch list' : goal.label) : '';
							if (helperState.goal === 'quest' && best.hasSecond && best.leg2Body >= 0) {
								careerNotice((label ? label + ' · ' : '') +
									planetName(best.body) + ' (' + signedMoney(best.leg1StepNet) +
									') \u2192 ' + helperLegVerb(best.leg2Leg) + ' ' +
									planetName(best.leg2Body) + ' (' + signedMoney(best.leg2Net) +
									') · net ' + signedMoney(best.twoLegTotal));
							} else {
								/* the notice prints the purse money, not the ranking score */
								const money = helperState.goal === 'score' ? best.score : best.money;
								careerNotice((label ? label + ' · ' : '') + planetName(best.body) +
									helperLegText(best.leg) + ' · ' + signedMoney(money));
							}
						}
					}
					aimBody = best.origin;
					aimAngle = GravityGame.angleOf(best.angleU);
					aimSpeed = GravityGame.speedOf(best.speedU);
					aiming = false;
					armed = true;
					pressing = false;
					savedArmed = false;
					placeGripFromSpeed();
					if (careerRule()) {
						/* the scan traced the rule cap, not the shorter
						 * preview slider: show that landing too, so the
						 * armed shot's preview and launch book agree */
						activeSim().predictFull(aimBody, aimAngle, aimSpeed,
							Math.min(GravityGame.CAP_SECONDS,
								best.steps * GravitySim.DT + 0.2));
						refreshPredGain();
						dirty = false;
					} else dirty = true;
					hudAt = -Infinity;
					if (helperProgressFillEl) helperProgressFillEl.style.width = '100%';
					setTimeout(() => { if (helperProgressFillEl && !helperState.active) helperProgressFillEl.style.width = '0%'; }, 900);
				} else if (careerRule() && helperState.goal !== 'score') {
					/* nothing flyable was found: say so instead of leaving the
					 * previously armed shot standing in as a false find */
					careerNotice(HELPER_GOALS[helperState.goal].empty);
				}
				helperUpdateUi();
				break;
			}
		}
	}
	if (helperState.active) helperUpdateUi();
}
