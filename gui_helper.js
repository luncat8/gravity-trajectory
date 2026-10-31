/*
 * Profit helper scans: origin, score and speed snap, the broad, focus, profit and tweak candidates, the launch-book seed and the budgeted tick.
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
	const best = activeRouteBest();
	const tweakOk = !helperState.active && best.ready && !replay.on && !playerIsBot() && (route ? routeOccupiedBy(best.origin) < 0 : true);
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
		helperTweakBtn.disabled = !tweakOk;
		helperTweakBtn.textContent = best.ready ? 'tweak ' + Math.round(best.length) + ' px' : 'tweak best';
		helperTweakBtn.title = best.ready
			? 'nudge the ' + Math.round(best.length) + ' px best by ± small angle and ±8 % speed · each press tries new jitter'
			: 'make a best plan first (drag and wait for trace to finish)';
	}
	const career = careerRule();
	const landed = career && !gameLocked() && cargoSim.status !== STATUS_FLYING ? game.career.at : -1;
	const profitOk = canScan && landed >= 0 && cargoSim.fieldStatic &&
		game.career.ended === GravityGame.CAREER_OPEN;
	if (helperProfitBtn) {
		helperProfitBtn.hidden = !career;
		helperProfitBtn.disabled = !profitOk;
		helperProfitBtn.textContent = 'best profit';
		helperProfitBtn.title = landed < 0
			? 'career · land somewhere to scan for money shots'
			: 'scan 34 aims from ' + planetName(landed) +
				' · rank by money (visits + tasks − EMC fee − exit cost)' +
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
	if (helperStopBtn) helperStopBtn.hidden = !helperState.active;
	if (helperProgressEl) helperProgressEl.hidden = !helperState.active;
	const tag = helperState.active
		? helperState.mode + ' ' + (helperState.index + 1) + '/' + helperState.candidates.length +
			(helperProbe.routeActive ? ' · ' + Math.round(helperProbe.routeProgress() * 100) + '%' : '')
		: best.ready ? 'best ' + Math.round(best.length) + ' px' : 'ready';
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
	helperProbe.setPlanets(PLANETS, tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
		tradeSim.orbitRX, tradeSim.orbitRY, tradeSim.orbitTiltCos, tradeSim.orbitTiltSin);
	helperProbe.setPlanetMask(planetMask);
	helperProbe.setField(cargoSim.bodyCount, cargoSim.bodyR, cargoSim.strength, cargoSim.fillField, cargoSim.fieldStatic);
	helperProbe.fieldT = cargoSim.fieldT;
	helperProbe.fieldRate = cargoSim.fieldRate;
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
		careerMoney = traceMoney(probe, origin, GravityGame.speedOf(cand.speedU));
		if (!moneyFlyable(careerMoney)) return -Infinity;
		if (helperState.goal !== 'score') {
			if (helperState.goal === 'profitEmc' && !careerMoney.builds) return -Infinity;
			return careerMoney.net;
		}
	}
	const profit = game.on ? GravityGame.estimateProfit(game.market, game.clockSteps, probe) : 0;
	const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
	const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
	const newVisits = probe.predNewVisits;
	let score = lands * 12 - samePad * 35 - (probe.predReason === END_EXIT ? 220 : 0);
	if (careerRule()) {
		const career = game.career;
		const body = probe.predBody;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED && body === task.to) score += task.reward * 40;
			else if (task.state === GravityGame.TASK_ACCEPTED && body === task.from) score += task.reward * 20;
		}
		const compete = career.tasks[GravityGame.COMPETE_SLOT];
		if (compete.kind === GravityGame.TASK_COMPETE && origin === compete.planet &&
			probe.predLength >= compete.minLength &&
			game.clockSteps + probe.predSteps <= compete.deadline) {
			score += compete.reward * 35;
		}
		score += profit * 28 + newVisits * 4 - probe.predTime * 0.12;
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
	helperProbe.visited.set(activeSim().visited);
	helperProbe.visitedCount = activeSim().visitedCount;
	helperProbe.fieldT = cargoSim.fieldT;
	helperProbe.fieldRate = cargoSim.fieldRate;
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
	else helperState.horizon = cargoSim.horizon;
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
	const career = game.career;
	const cap = speedCeiling(origin);
	const span = Math.max(0, cap - SPEED_MIN);
	const near = [];
	for (let p = 0; p < PLANETS; p++) {
		if (!planetMask[p]) continue;
		if (p === origin || career.pads[p].catapult !== null) continue;
		const dx = cargoSim.planetX[p] - cargoSim.planetX[origin];
		const dy = cargoSim.planetY[p] - cargoSim.planetY[origin];
		near.push({ planet: p, dist: dx * dx + dy * dy });
	}
	near.sort((a, b) => a.dist - b.dist);
	const picks = Math.min(4, near.length);
	for (let i = 0; i < picks; i++) {
		const planet = near[i].planet;
		const angle = Math.atan2(cargoSim.planetY[planet] - cargoSim.planetY[origin],
			cargoSim.planetX[planet] - cargoSim.planetX[origin]);
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
	reason: END_IMPACT, body: -1, score: -Infinity };

/*
 * The best saved shot from this rail for the money buttons, priced at the
 * live market and the live cap without spending a trace. It seeds the scan,
 * so a search only replaces it with something that actually pays more.
 */
function helperBookSeed(career, origin, requireEmc) {
	if (!GravityGame.bookReady(career.launchBook, pageBookTag())) return null;
	const entries = career.launchBook.entries;
	const cap = speedCeiling(origin);
	let best = null;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.origin !== origin) continue;
		if (GravityGame.speedOf(entry.speedU) > cap + 1e-9) continue;
		const money = storedMoney(entry);
		const score = money.net;
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
		best = helperSeed;
	}
	return best;
}

function helperStartProfit(requireEmc) {
	if (helperState.active || replay.on || playerIsBot()) return;
	if (!careerRule() || gameLocked() || !cargoSim.fieldStatic) return;
	const origin = game.career.at;
	if (origin < 0 || cargoSim.status === STATUS_FLYING) return;
	if (game.career.ended !== GravityGame.CAREER_OPEN) return;
	const cands = helperMakeProfit(origin, requireEmc ? 26 : 34, requireEmc);
	if (cands.length === 0) return;
	helperRun(cands, requireEmc ? 'profit + EMC' : 'best profit',
		requireEmc ? 'profitEmc' : 'profit',
		helperBookSeed(game.career, origin, requireEmc));
}

function helperStartTweak() {
	if (helperState.active || replay.on || playerIsBot()) return;
	if (game.on && gameLocked()) return;
	const best = activeRouteBest();
	let base = null;
	if (routeRule() && best.ready) base = { origin: best.origin, angleU: best.angleU, speedU: best.speedU };
	else if (armed) base = { origin: aimBody, angleU: GravityGame.angleUnits(aimAngle), speedU: GravityGame.speedUnits(aimSpeed) };
	else return;
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
						score: score
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
						careerNotice(helperState.goal === 'score' ? ''
							: (helperState.fromBook ? 'launch list' : 'best money shot') +
								' · ' + planetName(best.body) + ' · ' +
								signedMoney(best.score));
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
					careerNotice(helperState.goal === 'profitEmc'
						? 'no EMC-buildable landing'
						: 'no paying shot found');
				}
				helperUpdateUi();
				break;
			}
		}
	}
	if (helperState.active) helperUpdateUi();
}
