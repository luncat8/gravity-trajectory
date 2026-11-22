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
	if (botCopyBtn && !careerRule() && bot.count > 0) {
		const rIdx = rivalCopyIndex();
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
		/* the state is the controller's schedule: a hand-flown rival reads like YOU */
		const rivalMeta = bot.isRivalBot(i)
			? scoreMeta(summary) + ' · ' + bot.actorStateShort(i, game.clockSteps)
			: scoreMeta(summary);
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
		if (careerRule()) syncSciencePurse(activeCareer());
	}
	const replayText = replay.on
		? replay.career
			? replay.verdict || (careerRecording.finished ? 'career recording complete · restart to play'
				: 'career recording · ' + careerRecording.index + ' / ' + careerRecording.movie.frames.length)
		: replay.route
			? 'tracing one plan · ' + Math.round(slotSim(0).routeProgress() * 100) + ' %'
			: 'shot ' + (replay.index + (replay.phase === PHASE_AIM ? 1 : 0)) + ' / ' +
				replay.shots.length + ' · ×' + REPLAY_SPEEDS[replay.speed]
		: replay.verdict;
	if (replayText !== hudReplayText) {
		hudReplayText = replayText;
		replayEl.textContent = replayText;
	}
	if (careerRule()) updateGameClockHud();
	refreshStatsStrip();
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
	const career = activeCareer();
	if (gameClockEl) {
		let clockText = formatGameClock(game.clockSteps * DT);
		if (career && career.arrested) {
			clockText += ' · ARREST ' +
				Math.max(0, Math.round((career.arrestUntilStep - game.clockSteps) * DT)) + ' s';
		} else if (career && career.evacuating) {
			clockText += ' · EVAC ' +
				Math.max(0, Math.ceil((career.evacUntilStep - game.clockSteps) * DT)) + ' s';
		}
		gameClockEl.textContent = clockText;
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
	if (viewMode !== VIEW_SPACE && fieldRenderer) {
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
	if (questHoverBody >= 0) drawQuestGuide(tickNow);
	drawAim();
	drawCargo(tickNow);
	drawMarkers();
	/* the zone map already colours each planet's sign and weight */
	if (viewMode !== VIEW_POTENTIAL) drawSigns();
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
	if (careerRule()) refreshFuelHud();
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
		const padsText = activeCareer().padCount + ' / ' + planetCount;
		if (padsText !== hudPadsText) {
			hudPadsText = padsText;
			if (padCountEl) padCountEl.textContent = activeCareer().padCount;
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
			' · ' + sim.predTime.toFixed(1) + ' s'
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
	updateFlightHud();
}


/* ── launch state & status ── launch state and note, ride text and title, status text */
function setLaunchMenu(open) {
	launchMenuEl.hidden = !open;
	launchMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
	if (open && launchMenuEl.scrollIntoView) {
		launchMenuEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}
}

function hideLaunchMenu() {
	launchEvacBtn.hidden = true;
	if (launchMenuBtn.hidden) return;
	launchMenuBtn.hidden = true;
	setLaunchMenu(false);
}

/* the pad block belongs to a landed ship: with a burn or a queued shot armed
 * it is out of reach, and its auto-repair setting goes with it */
function hidePlanetActions() {
	planetActionsEl.hidden = true;
	careerAutoRepairLabelEl.hidden = true;
}

/* the pad block holds the build button and the auto-repair setting: the two
 * controls that belong to the planet under the ship */
function setPlanetActions(career, show, busy) {
	const at = career.at;
	const build = show && career.pads[at].catapult === null && GravityGame.planetBuildable(career, at);
	const autoRepair = show && autoRepairShown();
	planetActionsEl.hidden = !build && !autoRepair;
	launchBuildBtn.hidden = !build;
	careerAutoRepairLabelEl.hidden = !autoRepair;
	let buildReady = false;
	if (build) {
		const first = OrbitTech.CATAPULTS[0];
		const cost = careerCost(career, first.buildCost);
		const poor = purseTooSmall(career, cost);
		const lift = padCap(career, first, OrbitTech.BATTERIES[0]);
		buildReady = !busy && !poor;
		launchBuildBtn.disabled = !buildReady;
		launchBuildBtn.classList.toggle('costly', poor);
		launchBuildBtn.textContent = 'buy ' + first.id + ' · ' + costText(cost);
		launchBuildBtn.title = 'build the first catapult on ' + planetName(at) +
			' · full battery lifts ' + career.ship.mass.toFixed(1) + ' t to ' +
			Math.round(lift) + ' px/s · claims the planet';
	}
	return buildReady;
}

/* the commercial EMC-1 is the planet's fallback rail, so it is priced as one
 * entry of the launch menu; a priced-out rail can still be inspected, but is
 * not a way home */
function setCommercialOption(career, show, busy, commercialOn, usable) {
	const at = career.at;
	const commercial = show && at !== career.capitalPlanet;
	launchCommercialBtn.hidden = !commercial;
	if (!commercial) return { ready: false, shown: false };
	const rail = GravityGame.commercialPadAt(career, at);
	const label = 'commercial EMC-' + rail.catapult.tier;
	const lift = padCap(career, rail.catapult, rail.battery);
	const canLift = lift + 1e-9 >= SPEED_MIN;
	const fire = commercialOn && armed && aimBody === at;
	const fee = fire ? GravityGame.launchFee(career, at, aimSpeed)
		: GravityGame.commercialFee(career, at, SPEED_MIN);
	const poor = purseTooSmall(career, fee);
	launchCommercialBtn.disabled = busy || !canLift;
	launchCommercialBtn.classList.toggle('costly', poor);
	launchCommercialBtn.classList.toggle('on', commercialOn);
	launchCommercialBtn.textContent = (fire ? 'commercial launch · ' : label + ' · ') + costText(fee);
	launchCommercialBtn.title = !canLift
		? 'the ' + label + ' cannot lift ' + career.ship.mass.toFixed(1) +
			' t (max ' + Math.round(lift) + ' px/s)'
		: fire ? 'fire the armed shot from the ' + label + ' for ' + costText(fee)
		: commercialOn ? label + ' selected · drag from ' + planetName(at) +
			' to aim · click again for the standing rail'
		: 'launch from the ' + label + ' on ' + planetName(at) +
			' · always charged · lifts the ship to ' + Math.round(lift) +
			' px/s · never claims the planet or blocks building yours';
	return { ready: !launchCommercialBtn.disabled && !poor && usable, shown: true };
}

function setEvacuationOption(career, offer, busy, evacuating) {
	launchEvacBtn.hidden = !offer;
	if (!offer) return;
	const cost = GravityGame.evacuationCost(career);
	const seconds = GravityGame.evacuationSeconds(career);
	const watchSec = seconds / playPace();
	const elapsed = evacuating ? Math.max(0, game.clockSteps - career.evacStartStep) : 0;
	const pct = evacuating && career.evacDurationSteps > 0
		? Math.min(100, Math.round(elapsed * 100 / career.evacDurationSteps)) : 0;
	const remainingGameSec = evacuating
		? Math.max(0, Math.ceil((career.evacUntilStep - game.clockSteps) * DT)) : 0;
	const text = evacuating ? 'evacuating · ' + pct + ' % · ' + remainingGameSec + ' s'
		: 'evacuate · ' + costText(cost) + ' · ' + Math.round(seconds) + ' s';
	launchEvacBtn.disabled = busy || evacuating;
	if (launchEvacBtn.textContent !== text) launchEvacBtn.textContent = text;
	launchEvacBtn.title = evacuating ? 'evacuation to HQ ' + planetName(career.hq) +
			' · ' + remainingGameSec + ' game s remaining' +
			' (' + realSecText(remainingGameSec / playPace()) + ' s to watch at ' + paceTag() + ')'
		: 'tow to HQ ' + planetName(career.hq) + ' · pay ' + costText(cost) +
			' · ' + Math.round(seconds) + ' game s' +
			' (' + realSecText(watchSec) + ' s to watch at ' + paceTag() + '); less money takes longer';
}

function setLaunchState(blocked, exitWarning) {
	if (canImpulse()) {
		/* the impulse loop is pause-first: the context button only offers the
		 * burn while it is armed; pause / resume uses the game clock button and Space */
		const ship = playerCareer().ship;
		const cargo = activeSim().cargo;
		const usedKg = burnArmed
			? OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg) : 0;
		const warnExit = burnArmed && exitWarning;
		const text = burnAiming
			? 'aiming · Δv ' + burnDv.toFixed(1) + ' px/s'
			: burnArmed
			? (warnExit ? 'burn · leaves map · ' : 'burn · Δv ') +
				burnDv.toFixed(1) + ' px/s (−' + usedKg.toFixed(1) + ' kg · ' +
				costText(usedKg * GravityGame.fuelPrice(playerCareer())) + ')'
			: isBurnPaused() ? 'burn … drag from the ship' : 'coasting · ' +
				Math.sqrt(cargo.vx * cargo.vx + cargo.vy * cargo.vy).toFixed(1) + ' px/s';
		const state = 1024 + (isBurnPaused() ? 2048 : 0) + (burnArmed ? 4096 : 0) +
			(burnAiming ? 8192 : 0) + (warnExit ? 2 : 0);
		if (state === launchState && text === launchNote) return;
		launchState = state;
		launchNote = text;
		hideLaunchMenu();
		launchButton.value = '';
		hidePlanetActions();
		launchButton.disabled = !burnArmed;
		launchButton.classList.toggle('exitWarning', warnExit);
		launchButton.textContent = text;
		launchButton.title = burnArmed
			? 'Execute impulse burn and resume flight (Enter) · Space / resume drops the arm'
			: burnAiming
			? 'Release the drag to arm this burn'
			: isBurnPaused()
			? 'Drag from the paused ship to aim a burn, or press Space / resume to coast on'
			: 'Click the game-bar time button or press Space / P to pause and aim an impulse burn';
		return;
	}
	if (turret.pending) {
		const left = Math.max(0, turret.fireAt - game.clockSteps) * DT;
		hideLaunchMenu();
		launchButton.value = '';
		hidePlanetActions();
		launchButton.disabled = false;
		launchButton.classList.remove('costly', 'exitWarning');
		const sport = playerCareer().tasks[GravityGame.COMPETE_SLOT];
		const held = sport.kind === GravityGame.TASK_COMPETE &&
			sport.state === GravityGame.TASK_ACCEPTED && turret.body === sport.planet &&
			game.clockSteps < sport.startsAt;
		launchButton.textContent = held
			? 'armed · race gun in ' + left.toFixed(1) + ' s'
			: 'gun · ' + left.toFixed(1) + ' s';
		launchButton.title = held
			? 'The barrel waits for the starting gun, then turns to the aim · click or Esc to cancel'
			: 'The EMC turns its barrel to the aim · click or Esc to cancel';
		launchState = -1;
		return;
	}
	const route = routeRule();
	const slot = activeSlotIndex();
	const botPlayer = slotIsBot(slot);
	const ledger = slotLedger(slot);
	const plan = slotPlans[slot];
	const sim = slotSim(slot);
	const career = careerRule();
	const c = playerCareer();
	const idleCareer = career && c.ended === GravityGame.CAREER_OPEN &&
		sim.status !== STATUS_FLYING && !replay.on && !careerActionReplay.active;
	const onPlanet = idleCareer && c.at >= 0;
	const waitBusy = careerWaitBusy();
	const commercialOn = onPlanet && c.commercialPlanet === c.at;
	const usable = !career || GravityGame.careerShipUsable(c);
	const planetAction = setPlanetActions(c, onPlanet, waitBusy);
	const commercial = setCommercialOption(c, onPlanet, waitBusy, commercialOn, usable);
	const evacuating = idleCareer && c.evacuating;
	const offerEvac = idleCareer && (evacuating || GravityGame.canEvacuate(c));
	setEvacuationOption(c, offerEvac, waitBusy, evacuating);
	const note = career ? careerOverText() || careerPadNote() : '';
	const broke = game.on && !route && (career ? note !== '' : ledger.purse < MONEY.cost);
	/* a landed, hand-flown ship below new: the main action services it first */
	const worn = onPlanet && !botPlayer && !waitBusy && c.ship.condition < 1;
	const repair = worn ? GravityGame.repairCost(c) : 0;
	const repairPoor = worn && purseTooSmall(c, repair);
	const chained = worn && !blocked && sim.canFire(aimBody, aimSpeed) &&
		GravityGame.repairLaunchBlock(c, activeCareerSim(), aimBody, aimSpeed) === '';
	const launchOff = route || botPlayer || blocked || broke || !usable;
	const mainOff = worn ? !chained && repairPoor : launchOff;
	/* Keep the tow in the menu even when another action is available. */
	const evacPrimary = evacuating || (offerEvac && !botPlayer && !waitBusy && mainOff &&
		!planetAction && !commercial.ready && (!worn || launchOff));
	const noImpulse = career && !usable && !botPlayer && sim.burnLimit() > 0;
	launchRepairBtn.hidden = launchOnlyBtn.hidden = !worn;
	if (worn) {
		launchRepairBtn.textContent = 'repair · ' + costText(repair);
		launchRepairBtn.disabled = repairPoor;
		launchRepairBtn.classList.toggle('costly', repairPoor);
		launchOnlyBtn.textContent = 'launch' + (launchOff ? '' : launchRideText(c));
		launchOnlyBtn.disabled = launchOff;
		launchOnlyBtn.title = !usable ? GravityGame.WORN_OUT_BLOCK
			: launchOff ? 'Arm a shot this pad can fire' : 'Launch without repair · the ship keeps wearing';
	}
	if (worn || offerEvac || commercial.shown) launchMenuBtn.hidden = false;
	else hideLaunchMenu();
	if (evacPrimary) {
		launchButton.value = 'evac';
		launchButton.disabled = waitBusy || evacuating;
		launchButton.classList.remove('exitWarning', 'costly');
		launchButton.title = launchEvacBtn.title;
		if (launchButton.textContent !== launchEvacBtn.textContent) {
			launchButton.textContent = launchEvacBtn.textContent;
		}
		launchState = -1;
		return;
	}
	const state = (blocked || broke ? 1 : 0) + (exitWarning ? 2 : 0) +
		(broke ? 4 : 0) + (route ? 8 : 0) + (botPlayer ? 16 : 0) +
		(route && plan.ready ? 32 : 0) + (slot * 64) + (careerPaused ? 32768 : 0) + (worn ? 65536 : 0) +
		(chained ? 131072 : 0) + (usable ? 0 : 262144) + (repairPoor ? 524288 : 0) +
		(noImpulse ? 1048576 : 0);
	const who = slotName(slot);
	const prefix = game.on && slot > 0 ? who + ' · ' : '';
	const text = route
		? plan.ready ? 'plan counts · no launch' : 'plan only · no launch'
		: botPlayer ? 'bot controls ' + who
		: noImpulse ? 'repair needed · no impulse'
		: chained ? prefix + 'repair & launch · ' + repairLaunchText(c, repair)
		: worn ? prefix + 'repair · ' + costText(repair)
		: broke
		? career ? note : 'purse ' + ledger.purse.toFixed(2) + ' · need ' + MONEY.cost.toFixed(2)
		: exitWarning ? prefix + 'launch · leaves system'
		: prefix + 'launch' + launchRideText(career ? c : null);
	const repairCents = Math.round(repair * 100);
	/* the label carries live numbers (pad energy, rail fee, repair), so the
	 * text itself is the change key, not only the state bits */
	if (state === launchState && text === launchNote && repairCents === launchRepairCents) return;
	launchState = state;
	launchNote = text;
	launchRepairCents = repairCents;
	launchButton.value = '';
	launchButton.disabled = mainOff;
	launchButton.classList.toggle('exitWarning', exitWarning && (!worn || chained));
	/* only a missing price is a price; a career pad note is a state gate */
	launchButton.classList.toggle('costly', worn ? !chained && repairPoor : broke && !career);
	launchButton.textContent = text;
	const wear = worn ? 'condition ' + conditionText(c) + ' · repair ' + costText(repair) : '';
	launchButton.title = route
		? 'Route is a planner: the finished traced trajectory is the entry'
		: botPlayer ? 'Clear bot in the ' + who + ' score row to aim and launch manually'
		: noImpulse ? 'The ship is worn out: no impulse and no visit pay until it lands and is repaired'
		: chained ? wear + ' · then ' + (exitWarning
			? 'launch · warning: predicted trajectory ends outside the system'
			: launchRideTitle(c))
		: worn ? wear + (usable ? '' : ' · ' + GravityGame.WORN_OUT_BLOCK)
		: broke
		? career ? 'The pad cannot fire this shot' : 'The purse cannot cover a launch; this run is over'
		: exitWarning ? 'Warning: predicted trajectory ends outside the system'
		: launchRideTitle(career ? c : null);
}

/* repair plus the launch: one credit total, and the pad energy an own EMC draws */
function repairLaunchText(career, repair) {
	if (GravityGame.padOwner(career, aimBody) === career.index) {
		return costText(repair) + launchRideText(career);
	}
	return costText(repair + GravityGame.launchFee(career, aimBody, aimSpeed));
}

/* What the armed shot spends: an own EMC draws its pad battery (kWh), a
 * fallback rail - the commercial EMC-1 or a rival's pad - charges a price,
 * and a non-career run pays the flat launch fee. */
function launchRideText(career) {
	if (!career) return game.on ? ' · ' + MONEY.cost.toFixed(2) : '';
	if (aimBody < 0) return '';
	if (GravityGame.padOwner(career, aimBody) === career.index) {
		return ', ' + activeCareerSim().launchEnergy(aimBody, aimSpeed).toFixed(2) + ' kWh';
	}
	return ', ' + costText(GravityGame.launchFee(career, aimBody, aimSpeed));
}

function launchRideTitle(career) {
	if (!career || aimBody < 0) return '';
	if (GravityGame.padOwner(career, aimBody) === career.index) {
		const pad = career.pads[aimBody];
		return 'the shot drains ' + activeCareerSim().launchEnergy(aimBody, aimSpeed).toFixed(2) +
			' kWh of the ' + pad.catapult.id + ' battery (' + pad.chargeKwh.toFixed(2) + ' kWh charged)';
	}
	const owner = GravityGame.padOwner(career, aimBody);
	if (owner === GravityGame.OWNER_CAPITAL) {
		return 'the imperial EMC-3 launches free and never runs dry';
	}
	if (owner === GravityGame.OWNER_COMMERCIAL) {
		return 'the ' + GravityGame.railOwnerText(career, aimBody) + ' charges ' +
			costText(GravityGame.launchFee(career, aimBody, aimSpeed)) + ' and never runs dry';
	}
	return 'a rival EMC lifts this shot for a ' +
		costText(GravityGame.launchFee(career, aimBody, aimSpeed)) +
		' usage tax and spends its own battery charge';
}

function statusText() {
	if (replay.on) {
		if (replay.route) return 'replay · tracing plan';
		return slotSim(activeSlotIndex()).status === STATUS_FLYING
			? 'replay · in flight' : 'replay · aiming';
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
	if (isBurnPaused()) return 'flight paused · drag the ship for impulse';
	if (careerRule() && careerPaused && sim.status === STATUS_FLYING) return 'flight paused · clock paused';
	if (careerRule() && game.on && !replay.on) {
		const c = slotCareer(slot);
		if (c.evacuating) {
			const rem = Math.max(0, Math.ceil((c.evacUntilStep - game.clockSteps) * DT));
			return whoPrefix + 'evacuating to HQ · ' + rem + ' s';
		}
	}
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
