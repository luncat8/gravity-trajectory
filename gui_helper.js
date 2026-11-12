/*
 * Career helper scans: origin, the one landing-goal table, score and speed snap, the broad, focus, profit, quest and tweak candidates, the launch-book seed and the budgeted tick.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

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
				' · rank by money (visits + every taken contract leg − EMC fee − exit cost)' +
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
				'(any contract leg or the competition) · money plus ' + HELPER_QUEST_CREDIT +
				'× the leg credit, aimed straight at the planets it wants next';
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
	helperProbe.setPlanets(PLANETS, tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
		tradeSim.orbitRX, tradeSim.orbitRY, tradeSim.orbitTiltCos, tradeSim.orbitTiltSin);
	helperProbe.setPlanetMask(planetMask);
	helperProbe.setScales(sim.gravityScale, sim.forceScale);
	helperProbe.setField(sim.bodyCount, sim.bodyR, sim.strength, sim.fillField, sim.fieldStatic);
	helperProbe.fieldT = sim.fieldT;
	helperProbe.fieldRate = sim.fieldRate;
}

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
	quest: { credit: HELPER_QUEST_CREDIT, builds: false, label: 'quest shot', empty: 'no quest shot found' }
};
/* what the winning shot completes, printed after its cash */
const HELPER_LEG_TEXT = ['', ' · load', ' · deliver', ' · medics', ' · patients', ' · sport'];

function helperLegText(leg) {
	return HELPER_LEG_TEXT[leg] || '';
}

/* the money of the last scored candidate, so the notice prints cash and the
 * leg it completes instead of the ranking score */
const helperLastMoney = { net: -Infinity, leg: 0 };
/* the landing facts of the candidate being scored, reused every probe */
const helperLanding = { cash: 0, credit: 0, leg: GravityGame.LEG_NONE };

function helperScore(probe, cand) {
	const origin = cand.origin;
	if (routeRule()) {
		if (probe.predReason === END_IMPACT || probe.predReason === END_EXIT) return probe.predLength;
		return -1e12;
	}
	let careerMoney = null;
	if (careerRule()) {
		if (probe.predReason !== END_IMPACT || probe.predBody < 0) return -Infinity;
		careerMoney = traceMoney(probe, origin, GravityGame.speedOf(cand.speedU));
		if (!moneyFlyable(careerMoney)) return -Infinity;
		helperLastMoney.net = careerMoney.net;
		helperLastMoney.leg = careerMoney.leg;
		if (helperState.goal !== 'score') {
			const goal = HELPER_GOALS[helperState.goal];
			if (goal.builds && !careerMoney.builds) return -Infinity;
			return careerMoney.net + careerMoney.credit * goal.credit;
		}
	}
	const profit = game.on ? GravityGame.estimateProfit(game.market, game.clockSteps, probe) : 0;
	const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
	const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
	const newVisits = probe.predNewVisits;
	let score = lands * 12 - samePad * 35 - (probe.predReason === END_EXIT ? 220 : 0);
	if (careerRule()) {
		/* the untargeted scan weighs the same factors as the targeted ones,
		 * so a taken leg is never invisible just because no goal is set */
	GravityGame.careerLandingFacts(helperLanding, playerCareer(), origin, probe.predBody, 0,
		probe.predLength, probe.predSteps, game.clockSteps, profit,
		GravityGame.speedOf(cand.speedU));
		score += helperLanding.cash * 30 + helperLanding.credit * 60 + newVisits * 4 -
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
		const dx = tradeSim.planetX[p] - tradeSim.planetX[origin];
		const dy = tradeSim.planetY[p] - tradeSim.planetY[origin];
		near.push({ planet: p, dist: dx * dx + dy * dy });
	}
	near.sort((a, b) => a.dist - b.dist);
	const picks = Math.min(4, near.length);
	for (let i = 0; i < picks; i++) {
		const planet = near[i].planet;
		const angle = Math.atan2(tradeSim.planetY[planet] - tradeSim.planetY[origin],
			tradeSim.planetX[planet] - tradeSim.planetX[origin]);
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
const helperSeed = { origin: -1, angleU: 0, speedU: 0, length: 0, steps: 0,
	reason: END_IMPACT, body: -1, score: -Infinity, money: 0, credit: 0, leg: 0 };

/*
 * The best saved shot from this rail for a career button, priced at the live
 * market and the live cap without spending a trace. It seeds the scan on the
 * button's own goal, so a search only replaces it with a better shot.
 */
function helperBookSeed(career, origin, requireEmc, creditWeight) {
	if (!GravityGame.bookReady(career.launchBook, pageBookTag())) return null;
	const entries = career.launchBook.entries;
	const cap = speedCeiling(origin);
	let best = null;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.origin !== origin) continue;
		if (GravityGame.speedOf(entry.speedU) > cap + 1e-9) continue;
		const money = storedMoney(entry);
		const score = money.net + money.credit * (creditWeight || 0);
		if (!moneyFlyable(money)) continue;
		if (requireEmc && !money.builds) continue;
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
	const rule = HELPER_GOALS[goal];
	const cands = build(origin);
	if (cands.length === 0) return;
	let seed = helperBookSeed(career, origin, rule.builds, rule.credit);
	const sim = activeSim();
	if (armed && aimBody === origin && !dirty && sim.predReason === END_IMPACT &&
		sim.predBody >= 0 && aimSpeed <= speedCeiling(origin) + 1e-9) {
		const money = traceMoney(sim, origin, aimSpeed);
		const score = money.net + money.credit * rule.credit;
		if (moneyFlyable(money) && (!rule.builds || money.builds) &&
			(!seed || score > seed.score)) {
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
		const angle = Math.atan2(tradeSim.planetY[planet] - tradeSim.planetY[origin],
			tradeSim.planetX[planet] - tradeSim.planetX[origin]);
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

function stopHelper() {
	if (!helperState.active) return;
	helperState.active = false;
	helperState.candidates = null;
	if (helperProgressFillEl) helperProgressFillEl.style.width = '0%';
	helperUpdateUi();
	hudAt = -Infinity;
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
				if (careerRule()) saveTrace(helperProbe, cand.origin, cand.angleU, cand.speedU);
				if (score > helperState.bestScore) {
					helperState.bestScore = score;
					helperState.fromBook = false;
					helperState.best = {
						origin: cand.origin, angleU: cand.angleU, speedU: cand.speedU,
						length: helperProbe.predLength, steps: helperProbe.predSteps,
						reason: helperProbe.predReason, body: helperProbe.predBody,
						score: score, money: helperLastMoney.net, leg: helperLastMoney.leg
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
						const goal = HELPER_GOALS[helperState.goal];
						const label = goal.label ? (helperState.fromBook ? 'launch list' : goal.label) : '';
						/* the notice prints the purse money, not the ranking score */
						const money = helperState.goal === 'score' ? best.score : best.money;
						careerNotice((label ? label + ' · ' : '') + planetName(best.body) +
							' · ' + signedMoney(money) + helperLegText(best.leg));
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
