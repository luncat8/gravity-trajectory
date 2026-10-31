'use strict';

/* ── gui_hud_text: HUD text ── the game clock format, the pause/resume button label and the
   speed note, moved out of gui_aim.js so the aim cluster keeps one reason to change.
   Classic script: flat top-level scope, shared with the other gui_*.js files. */

function updateGameHud() {
	const ruleText = moneyRule()
		? 'money · ' + GravityGame.MONEY_SHOTS + ' shots'
		: routeRule()
		? 'route · longest one plan'
		: careerRule() ? careerRuleText()
		: 'tour · ' + GravityGame.CAP_SECONDS + ' s cap';
	if (ruleText !== hudRuleText) {
		hudRuleText = ruleText;
		ruleTagEl.textContent = ruleText;
		if (scoreRuleTagEl) {
			scoreRuleTagEl.textContent = careerRule() ? careerScoreTag() : ruleText;
		}
	}
	const rTag = rivalTagText();
	if (rTag !== hudRivalTagText) {
		hudRivalTagText = rTag;
		if (rivalTagEl) rivalTagEl.textContent = rTag;
	}
	if (botCopyBtn && game.bot !== BOT_OFF) {
		const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
		botCopyBtn.disabled = replay.on || bot.count === 0 ||
			bot.rivals[rIdx].shots.length === 0;
	}

	const player = playerSummary();
	const score = scoreValue(player);
	if (score !== hudScoreText) {
		hudScoreText = score;
		gameScoreEl.textContent = score;
	}
	const playerMeta = scoreMeta(player);
	if (playerMeta !== hudPlayerMetaText) {
		hudPlayerMetaText = playerMeta;
		playerScoreMetaEl.textContent = playerMeta;
		playerScoreMetaEl.title = playerMeta;
	}
	for (let i = 0; i < bot.count; i++) {
		const summary = bot.actorSummary(i);
		const rivalScore = scoreValue(summary);
		if (rivalScore !== hudRivalScoreTexts[i]) {
			hudRivalScoreTexts[i] = rivalScore;
			rivalScoreEls[i].textContent = rivalScore;
		}
		const rivalMeta = scoreMeta(summary) + ' · ' +
			bot.actorStateShort(i, game.clockSteps);
		if (rivalMeta !== hudRivalMetaTexts[i]) {
			hudRivalMetaTexts[i] = rivalMeta;
			rivalMetaEls[i].textContent = rivalMeta;
		}
		const rivalState = bot.actorStatus(i, game.clockSteps);
		if (rivalState !== hudRivalStateTexts[i]) {
			hudRivalStateTexts[i] = rivalState;
			rivalMetaEls[i].title = rivalState;
		}
	}
	if (game.bot !== BOT_OFF && rivalEl) {
		const info = rivalSummaryInfo(player);
		if (info.text !== hudRivalText) {
			hudRivalText = info.text;
			rivalEl.textContent = info.text;
			rivalEl.classList.toggle('gain', info.outcome > 0);
			rivalEl.classList.toggle('loss', info.outcome < 0);
		}
	}
	const activeSlotNow = activeSlotIndex();
	const ledger = slotLedger(activeSlotNow);
	const shots = slotShots(activeSlotNow);
	const purseText = ledger.purse.toFixed(2) +
		(shots.length ? ' · last ' + signedMoney(ledger.last) : '');
	if (purseText !== hudPurseText) {
		hudPurseText = purseText;
		if (gamePurseEl) {
			gamePurseEl.textContent = purseText;
			const loss = slotBroke(activeSlotNow) ||
				(shots.length > 0 && ledger.last < 0);
			gamePurseEl.classList.toggle('loss', loss);
			gamePurseEl.classList.toggle('gain', !loss && shots.length > 0 &&
				ledger.last > 0);
		}
		if (careerRule()) syncSciencePurse(game.career);
	}
	const replayText = replay.on
		? replay.route
			? 'tracing one plan · ' + Math.round(cargoSim.routeProgress() * 100) + ' %'
			: 'shot ' + (replay.index + (replay.phase === PHASE_AIM ? 1 : 0)) + ' / ' +
				replay.shots.length + ' · ×' + REPLAY_SPEEDS[replay.speed]
		: replay.verdict;
	if (replayText !== hudReplayText) {
		hudReplayText = replayText;
		replayEl.textContent = replayText;
	}
	if (careerRule()) updateGameClockHud();
}

function formatGameClock(seconds) {
	const totalMin = seconds / 60;
	const hours = Math.floor(totalMin / 60);
	const mins = Math.floor(totalMin - hours * 60);
	const secs = Math.floor(seconds - (hours * 60 + mins) * 60);
	return 't+ ' + (hours < 10 ? '0' : '') + hours + ':' +
		(mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function updateGameClockHud() {
	if (!gameHudEl || gameHudEl.hidden) return;
	const career = game.career;
	if (gameClockEl) {
		gameClockEl.textContent = formatGameClock(game.clockSteps * DT);
	}
	if (gameShotsEl) gameShotsEl.textContent = String(career ? career.flights : 0);
	if (gameFlightsEl) gameFlightsEl.textContent = String(game.shots ? game.shots.length : 0);
	if (gamePadsEl && career) {
		gamePadsEl.textContent = career.padCount + ' / ' + career.planetCount;
	}
}

/* a planet disc or paused ship hidden under a HUD panel still aims: the
 * press is taken over only on a launchable pad or impulse ship, never a control */


/* ── paint frame ── the paint entry, clock and end text, live HUD */
function draw(now) {
	if (viewMode === VIEW_FIELD && fieldRenderer) {
		if (fieldRenderer.backend() === 'lost') fieldLost();
		else {
			const prevDiv = fieldRenderer.scaleDiv();
			fieldRenderer.render(cargoSim, view, window.innerWidth, window.innerHeight,
				emaFrameMs > FPS_DROP_MS);
			if (fieldRenderer.scaleDiv() !== prevDiv) refreshViewUi();
		}
	}
	const blocked = activeBlockedPlanet(now);
	/* a paused career clock freezes every animation: ticks are drawn at the
 * pause instant instead of wall clock (other modes keep animating) */
	const tickNow = careerRule() && careerPaused ? careerPauseNow : now;
	updateHarvestMasks();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
	ctx.save();
	ctx.translate(view.offX, view.offY);
	ctx.scale(view.scale, view.scale);
	drawSystemVisits(tickNow);
	if (careerRule()) drawCareerEmc();
	drawWells();
	drawPortVelocities();
	if (game.on && bot.count > 0) drawRivalsWorld(tickNow);
	drawPrediction();
	drawTrail();
	drawLandedBase(tickNow);
	if (blocked >= 0) {
		if (blockedKind === 1) drawOccupiedPlanetWorld(blocked);
		else drawBlockedArrowWorld(blocked, tickNow);
	}
	drawAim();
	drawCargo(tickNow);
	drawMarkers();
	drawSigns();
	ctx.restore();
	if (game.on && !routeRule()) drawPlanetProfits();
	if (careerRule()) drawCareerPad();
	if (game.on && bot.count > 0) drawRivalTags();
	if (hoverBody >= 0 && hoverBody !== selected && !aiming) {
		drawLabel(hoverLabel, cargoSim.bodyX[hoverBody],
			cargoSim.bodyY[hoverBody], ICE);
	}
	if (selected >= 0) {
		drawLabel(selectedLabel, cargoSim.bodyX[selected],
			cargoSim.bodyY[selected], GOLD,
			mode === MODE_PLANETS && (aiming || armed) && selected === aimBody);
	}
	const landed = activeSim().landedBody;
	if (landed >= 0 && !aiming &&
		!(mode === MODE_PLANETS && selected === landed)) {
		drawLabel('landed · launch here (' + planetName(landed) + ')',
			tradeSim.planetX[landed],
			tradeSim.planetY[landed], MINT);
	}
	if (blocked >= 0) drawBlockedTooltipScreen(blocked);
	drawGripLabel();
}

function formatClock(label, seconds) {
	const total = Math.floor(seconds * 10) / 10;
	const mins = Math.floor(total / 60);
	const secs = total - mins * 60;
	return label + ' + ' + (mins < 10 ? '0' : '') + mins + ':' +
		(secs < 10 ? '0' : '') + secs.toFixed(1);
}

function endText(reason, body) {
	if (reason === END_IMPACT) return 'impact ' + planetName(body);
	if (reason === END_EXIT) return 'left field';
	if (reason === END_TIME) return 'time cap';
	if (reason === END_TRUNCATED) return 'budget cap';
	if (reason === END_ABORT) return 'aborted';
	return 'open';
}

/* trajectory & visit readouts update immediately whenever changed */
function updateLiveHud() {
	const sim = activeSim();
	const plan = activeRoutePlan();
	const guidedCareer = careerRule() && sim.predCount >= 2 &&
		(aiming || armed || burnAiming || burnArmed || sim.status === STATUS_FLYING);
	const economics = guidedCareer ? predictedCareerEconomics(sim) : null;
	aimGuidance = economics ? economics.state : 0;
	if (aimEl) {
		aimEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
		aimEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
		aimEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
	}
	if (predVisitEl) {
		predVisitEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
		predVisitEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
		predVisitEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
	}
	if (predProfitEl) {
		predProfitEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
		predProfitEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
		predProfitEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
	}
	const text = aiming || armed || burnAiming || burnArmed ? aimLabel : '—';
	if (text !== hudAimText) {
		hudAimText = text;
		aimEl.textContent = text;
		aimEl.title = text === '—' ? '' : text;
	}
	let tag = 'none selected';
	if (hoverBody >= 0 && !aiming) {
		tag = 'hover ' + bodyName(hoverBody) + ' · ' + strengthText(hoverBody);
	} else if (selected >= 0) tag = selectedLabel;
	if (tag !== hudTagText) {
		hudTagText = tag;
		bodyTagEl.textContent = tag;
	}
	const visitText = routeRule()
		? plan.ready ? Math.round(plan.length) + ' px'
			: sim.predCount >= 2 ? 'tracing…' : '—'
		: sim.visitedCount + ' / ' + planetCount;
	if (visitText !== hudVisitText) {
		hudVisitText = visitText;
		if (visitEl) visitEl.textContent = visitText;
	}
	/* the scoreboard pads/planets line: pads only exist in career */
	if (planetPadsLabelEl) planetPadsLabelEl.hidden = !careerRule();
	if (planetRowSepEl) planetRowSepEl.hidden = !careerRule();
	if (careerRule()) {
		const padsText = game.career.padCount + ' / ' + planetCount;
		if (padsText !== hudPadsText) {
			hudPadsText = padsText;
			if (padCountEl) padCountEl.textContent = game.career.padCount;
			if (padTotalEl) padTotalEl.textContent = planetCount;
		}
	}
	const predText = sim.predCount >= 2
		? routeRule()
			? sim.routeActive ? 'tracing…' : endText(sim.predReason, sim.predBody)
			: sim.predVisits + ' sys · +' + sim.predNewVisits +
				' (' + (sim.visitedCount + sim.predNewVisits) + '/' + planetCount + ')' +
				(game.on ? ' · ' + predProfitText(sim, economics) : '')
		: '—';
	if (predText !== hudPredVisitText) {
		hudPredVisitText = predText;
		if (predVisitEl) predVisitEl.textContent = predText;
	}
	const profitText = game.on && !routeRule() && sim.predCount >= 2
		? predProfitText(sim, economics) + ' · ' + predRateText(sim) +
			' · ' + sim.predTime.toFixed(1) + ' s' + predTickNote()
		: '—';
	if (profitText !== hudPredProfitText) {
		hudPredProfitText = profitText;
		if (predProfitEl) predProfitEl.textContent = profitText;
	}
	const lenText = sim.predCount >= 2 ? Math.round(sim.predLength) + ' px' : '—';
	if (lenText !== hudLengthText) {
		hudLengthText = lenText;
		lengthEl.textContent = lenText;
	}
	const pText = sim.predCount >= 2
		? sim.predTime.toFixed(1) + ' s · ' + (sim.routeActive
			? 'computing ' + Math.round(sim.routeProgress() * 100) + ' %'
			: endText(sim.predReason, sim.predBody))
		: '—';
	if (pText !== hudPathText) {
		hudPathText = pText;
		pathEl.textContent = pText;
	}
	const impulseOk = canImpulse();
	const locked = gameLocked();
	const trimOff = (locked && !(impulseOk && burnArmed)) ||
		(!armed && !(impulseOk && burnArmed) && (game.on || selected < 0));
	if (trimSlider.disabled !== trimOff) trimSlider.disabled = trimOff;
	const exitWarning = !routeRule() && (aiming || armed || burnAiming || burnArmed) &&
		sim.predCount >= 2 && sim.predReason === END_EXIT;
	setLaunchState(locked || !armed || !canAimFrom(aimBody), exitWarning);
}


/* ── launch state & status ── launch state and note, ride text and title, status text */
function setLaunchState(blocked, exitWarning) {
	if (canImpulse()) {
		const ship = game.career.ship;
		const usedKg = burnArmed
			? OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg) : 0;
		const warnExit = burnArmed && exitWarning;
		const text = !burnPaused
			? 'impulse · max ' + cargoSim.burnLimit().toFixed(1) + ' px/s'
			: burnArmed
			? (warnExit ? 'burn · leaves map · ' : 'burn · Δv ') +
				burnDv.toFixed(1) + ' px/s (−' + usedKg.toFixed(1) + ' kg)'
			: 'resume · drag ship to burn';
		const state = 1024 + (burnPaused ? 2048 : 0) + (burnArmed ? 4096 : 0) +
			(warnExit ? 2 : 0);
		if (state === launchState && text === launchNote) return;
		launchState = state;
		launchNote = text;
		launchButton.hidden = false;
		if (planetActionsEl) planetActionsEl.hidden = true;
		launchButton.disabled = false;
		launchButton.classList.toggle('exitWarning', warnExit);
		launchButton.textContent = text;
		launchButton.title = !burnPaused
			? 'Pause flight to aim an impulse burn (Space / P, or drag from the ship)'
			: burnArmed
			? 'Execute impulse burn and resume flight (Enter) · Escape cancels burn'
			: 'Drag from the ship to aim a burn, or click / press Space to resume coasting';
		return;
	}
	if (turret.pending) {
		const left = Math.max(0, turret.fireAt - game.clockSteps) * DT;
		launchButton.hidden = false;
		if (planetActionsEl) planetActionsEl.hidden = true;
		launchButton.disabled = false;
		launchButton.classList.remove('costly', 'exitWarning');
		launchButton.textContent = 'gun · ' + left.toFixed(1) + ' s';
		launchButton.title = 'The EMC turns its barrel to the aim · click or Esc to cancel';
		launchState = -1;
		return;
	}
	const route = routeRule();
	const slot = activeSlotIndex();
	const botPlayer = slotIsBot(slot);
	const ledger = slotLedger(slot);
	const plan = slotPlans[slot];
	const career = careerRule();
	/* planet actions beside launch: build yours, fire the commercial rail
	 * that stands on every planet, or evacuate — shown whenever the career
	 * ship sits landed (lost in space keeps only the evacuation) */
	const c = game.career;
	const landed = career && c.ended === GravityGame.CAREER_OPEN &&
		cargoSim.status !== STATUS_FLYING;
	const showActions = landed && (c.at >= 0 || c.stranded);
	const commercialOn = showActions && c.at >= 0 && c.commercialPlanet === c.at;
	launchButton.hidden = showActions && c.at < 0;
	if (planetActionsEl) planetActionsEl.hidden = !showActions;
	if (showActions) {
		const waitBusy = careerWaitBusy();
		if (launchBuildBtn) {
			const occupied = c.at >= 0 && !GravityGame.planetBuildable(c, c.at);
			if (c.at < 0 || c.pads[c.at].catapult !== null || occupied) {
				launchBuildBtn.hidden = true;
			} else {
				const first = OrbitTech.CATAPULTS[0];
				const buildCost = careerCost(c, first.buildCost);
				const buildPoor = purseTooSmall(c, buildCost);
				const fresh = padCap(c, first, OrbitTech.BATTERIES[0]);
				launchBuildBtn.hidden = false;
				launchBuildBtn.disabled = buildPoor || waitBusy;
				launchBuildBtn.classList.toggle('costly', buildPoor);
				launchBuildBtn.textContent = 'buy ' + first.id + ' · ' + costText(buildCost);
				launchBuildBtn.title = 'build the first catapult on ' + planetName(c.at) +
					' · full battery lifts ' + c.ship.mass.toFixed(1) + ' t to ' +
					Math.round(fresh) + ' px/s · claims the planet';
			}
		}
		if (launchCommercialBtn) {
			if (c.at < 0) {
				launchCommercialBtn.hidden = true;
			} else {
				const fee = careerCost(c, GravityGame.CAREER.commercialFee);
				const lift = padCap(c, OrbitTech.CATAPULTS[0], OrbitTech.BATTERIES[0]);
				const canLift = lift + 1e-9 >= SPEED_MIN;
				const feePoor = purseTooSmall(c, fee);
				const armedHere = armed && aimBody === c.at;
				launchCommercialBtn.hidden = false;
				launchCommercialBtn.disabled = waitBusy || !canLift;
				launchCommercialBtn.classList.toggle('costly', feePoor);
				launchCommercialBtn.classList.toggle('on', commercialOn);
				launchCommercialBtn.textContent = commercialOn && armedHere
					? 'commercial launch · ' + costText(fee)
					: 'commercial EMC-1 · ' + costText(fee);
				launchCommercialBtn.title = !canLift
					? 'the commercial EMC-1 cannot lift ' + c.ship.mass.toFixed(1) +
						' t (max ' + Math.round(lift) + ' px/s)'
					: commercialOn
					? armedHere
						? 'fire the armed shot from the commercial EMC-1 for ' + costText(fee)
						: 'commercial EMC-1 selected · drag from ' + planetName(c.at) +
							' to aim · click again for the standing rail'
					: 'launch from the commercial EMC-1 on ' + planetName(c.at) +
						' · always charged · lifts the ship to ' + Math.round(lift) +
						' px/s · never claims the planet or blocks building yours';
			}
		}
		if (launchEvacBtn) {
			if (!c.stranded) {
				launchEvacBtn.hidden = true;
			} else {
				const evacCost = careerCost(c, GravityGame.CAREER.evacFee);
				const evacPoor = purseTooSmall(c, evacCost);
				launchEvacBtn.hidden = false;
				launchEvacBtn.disabled = waitBusy;
				launchEvacBtn.classList.toggle('costly', evacPoor);
				launchEvacBtn.textContent = 'evacuate · ' + costText(evacCost);
				launchEvacBtn.title = 'fly the ship home to HQ ' + planetName(c.hq) +
					' for ' + costText(evacCost);
			}
		}
	}
	const note = career ? careerOverText() || careerPadNote() : '';
	const broke = game.on && !route && (career ? note !== '' : ledger.purse < MONEY.cost);
	const state = (blocked || broke ? 1 : 0) + (exitWarning ? 2 : 0) +
		(broke ? 4 : 0) + (route ? 8 : 0) + (botPlayer ? 16 : 0) +
		(route && plan.ready ? 32 : 0) + (slot * 64) + (showActions ? 8192 : 0) +
		(commercialOn ? 16384 : 0) + (careerPaused ? 32768 : 0);
	const who = slotName(slot);
	const prefix = game.on && slot > 0 ? who + ' · ' : '';
	const text = route
		? plan.ready ? 'plan counts · no launch' : 'plan only · no launch'
		: botPlayer ? 'bot controls ' + who
		: broke
		? career ? note : 'purse ' + ledger.purse.toFixed(2) + ' · need ' + MONEY.cost.toFixed(2)
		: exitWarning ? prefix + 'launch · leaves system'
		: prefix + 'launch' + launchRideText(career ? c : null);
	/* the label carries live numbers (pad energy, rail fee), so the text
	 * itself is the change key, not only the state bits */
	if (state === launchState && text === launchNote) return;
	launchState = state;
	launchNote = text;
	launchButton.disabled = route || botPlayer || blocked || broke;
	launchButton.classList.toggle('exitWarning', exitWarning);
	/* only a missing launch fee is a price; a career pad note is a state gate */
	launchButton.classList.toggle('costly', broke && !career);
	launchButton.textContent = text;
	launchButton.title = route
		? 'Route is a planner: the finished traced trajectory is the entry'
		: botPlayer ? 'Clear bot in the ' + who + ' score row to aim and launch manually'
		: broke
		? career ? 'The pad cannot fire this shot' : 'The purse cannot cover a launch; this run is over'
		: exitWarning ? 'Warning: predicted trajectory ends outside the system'
		: launchRideTitle(career ? c : null);
}

/* What the armed shot spends: an own EMC draws its pad battery (kWh), a
 * fallback rail - the commercial EMC-1 or a rival's pad - charges a price,
 * and a non-career run pays the flat launch fee. */
function launchRideText(career) {
	if (!career) return game.on ? ' · ' + MONEY.cost.toFixed(2) : '';
	if (aimBody < 0) return '';
	if (GravityGame.padOwner(career, aimBody) === career.index) {
		return ', ' + cargoSim.launchEnergy(aimBody, aimSpeed).toFixed(2) + ' kWh';
	}
	return ', ' + costText(GravityGame.launchFee(career, aimBody, aimSpeed));
}

function launchRideTitle(career) {
	if (!career || aimBody < 0) return '';
	if (GravityGame.padOwner(career, aimBody) === career.index) {
		const pad = career.pads[aimBody];
		return 'the shot drains ' + cargoSim.launchEnergy(aimBody, aimSpeed).toFixed(2) +
			' kWh of the ' + pad.catapult.id + ' battery (' + pad.chargeKwh.toFixed(2) + ' kWh charged)';
	}
	const owner = GravityGame.padOwner(career, aimBody);
	if (owner === GravityGame.OWNER_COMMERCIAL) {
		return 'the commercial EMC-1 charges ' +
			costText(GravityGame.launchFee(career, aimBody, aimSpeed)) + ' and never runs dry';
	}
	return 'a rival EMC lifts this shot for a ' +
		costText(GravityGame.launchFee(career, aimBody, aimSpeed)) +
		' usage tax and spends its own battery charge';
}

function statusText() {
	if (replay.on) {
		if (replay.route) return 'replay · tracing plan';
		return cargoSim.status === STATUS_FLYING ? 'replay · in flight' : 'replay · aiming';
	}
	const slot = activeSlotIndex();
	const sim = slotSim(slot);
	const plan = slotPlans[slot];
	const ledger = slotLedger(slot);
	const who = slotName(slot);
	const whoPrefix = game.on && slot > 0 ? who + ' · ' : '';
	if (routeRule()) {
		if (aiming) return whoPrefix + 'planning · ' + planetName(aimBody);
		if (sim.routeActive) {
			return whoPrefix + 'tracing plan · ' + Math.round(sim.routeProgress() * 100) + ' %';
		}
		if (routeLeader === -1 && routePlan.ready) {
			return 'leader · ' + (slotIsBot(0) ? 'BOT' : 'YOU') + ' · ' +
				Math.round(routePlan.length) + ' px';
		}
		if (routeLeader >= 0) {
			return 'leader · ' + RIVAL_TAGS[routeLeader] + ' · ' +
				Math.round(bot.rivals[routeLeader].routeLength) + ' px';
		}
		if (plan.ready) return 'tied lead · ' + Math.round(plan.length) + ' px';
		if (bot.routeThinking()) {
			return 'planning · ' + Math.round(bot.routeProgress() * 100) + ' %';
		}
		if (armed) return whoPrefix + 'plan has no landing or map exit';
		return slotIsBot(slot) ? 'bot plan ready' : whoPrefix + 'choose a free start planet';
	}
	if (slotIsBot(slot) && sim.status !== STATUS_FLYING) {
		if (flownRunLocked()) return playerGoalDone() ? 'bot run complete' : 'purse empty · run over';
		const actorIdx = slot === 0 ? GravityBot.PLAYER_INDEX : slot - 1;
		return bot.thinking() && bot.jobRival === actorIdx
			? who + ' · bot thinking ' + Math.round(bot.progress() * 100) + ' %'
			: who + ' · bot ready';
	}
	if (burnAiming) return 'aiming impulse · Δv ' + burnDv.toFixed(1) + ' px/s';
	if (burnArmed) return 'burn armed · Δv ' + burnDv.toFixed(1) + ' px/s';
	if (burnPaused) return 'flight paused · drag ship for impulse';
	if (aiming) return whoPrefix + 'aiming ' + planetName(aimBody);
	if (armed) return whoPrefix + 'armed · ' + planetName(aimBody);
	if (sim.status === STATUS_FLYING) {
		if (game.on && bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
			return 'rival thinking ' + Math.round(bot.progress() * 100) + ' %';
		}
		return game.on ? whoPrefix + 'in flight · clock runs' : 'in flight';
	}
	if (game.on && playerGoalDone()) {
		return whoPrefix + (moneyRule() ? GravityGame.MONEY_SHOTS + ' shots complete' : 'tour complete');
	}
	const careerNote = careerRule() ? careerOverText() : '';
	if (careerNote) return careerNote;
	if (game.on && slotBroke(slot)) return whoPrefix + 'purse empty · run over';
	const rest = sim.status === STATUS_ENDED
		? endText(sim.endReason, sim.endBody)
		: sim.landedBody >= 0 ? 'landed ' + planetName(sim.landedBody) : 'ready';
	if (!game.on) return rest;
	const clockNote = careerRule() && !careerPaused ? ' · clock runs' : ' · clock paused';
	return whoPrefix + rest + clockNote;
}
