/*
 * Game session: start and stop, the career run, the fixed-step loop, bot settling, flight end and the rival settle.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function startGame(seed, fixedRate, rule, botLevel, playerType, cheat) {
	const wasCareer = careerRule();
	cancelCareerWait();
	stopReplay();
	linkNote = '';
	game.on = true;
	game.seed = seed;
	game.fixedRate = fixedRate;
	if (rule) game.rule = rule;
	game.cheat = game.rule === RULE_CAREER && GravityGame.CHEATS[cheat] ? cheat : null;
	if (careerRule() !== wasCareer) resetPlayback();
	else if (playIndex > playMaxIndex()) {
		playIndex = playMaxIndex();
		refreshPlaybackUi();
	}
	if (botLevel) game.bot = botLevel;
	/* 0 means "follow the difficulty level's rival count" */
	if (game.playerCount > 0) game.playerCount = Math.max(1, Math.min(MAX_PLAYERS, game.playerCount));
	/* every rule hands any slot to either the keyboard or the bot; a career's
	 * rival setting still picks how many companies share the map */
	if (playerType) {
		game.player = playerType;
		slotTypes[0] = playerType;
	} else {
		game.player = slotTypes[0];
	}
	for (let i = 0; i < rivalTypesArg.length; i++) rivalTypesArg[i] = slotTypes[i + 1];
	syncModeRadios();
	syncBotRadios();
	updateHelp(game.rule);
	game.shots.length = 0;
	game.steps = 0;
	game.clockSteps = 0;
	game.length = 0;
	game.doneSteps = -1;
	resetRoutePlan();
	resetAllRouteBest();
	if (helperState.active) stopHelper();
	playerBotSyncNeeded = true;
	predGain = 0;
	GravityGame.resetMarket(game.market);
	GravityGame.resetLedger(game.money);
	/* Select the new rule's universe before the trade world is rebuilt and
	 * fast-forwarded. Otherwise a career first simulates the previous 26-world
	 * map, then retires half its ports at t+07:00; ships already in flight keep
	 * route coordinates from that discarded map. */
	initPlanetUniverse(game.planetUniverse > 0 ? game.planetUniverse : planetUniverseDefault(game.rule));
	scene.reset(seed);
	scene.setGameClock(true);
	clearCargo();
	cargoSim.fieldT = tradeSim.t;
	cargoSim.fieldRate = scene.trade.speed;
	bot.reset(seed, game.rule, game.bot, game.player, rivalTypesArg,
		game.playerCount > 0 ? game.playerCount - 1 : undefined);
	applyPlanetUniverse();
	ensureValidActiveSlot(-1);
	attachWorld();
	if (careerRule()) startCareerRun(seed);
	else {
		careerPaused = false;
		if (scene.setFrozen) scene.setFrozen(false);
		cargoSim.setLaunchNetwork(null, null);
	}
	careerFollow = true;
	careerNotice('');
	if (routeRule()) bot.useField(cargoSim, mode);
	launchState = -1;
	gameLinkEl.hidden = true;
	hideBotLog();
	refreshGameUi();
	syncSeedUrl();
}

/* one galaxy per career run: YOU join first, then every rival career, so pads
 * and usage tax are shared ground from the first launch */
function startCareerRun(seed) {
	cancelTurret();
	GravityGame.resetGalaxy(game.galaxy, seed);
	GravityGame.prepareCareerStarts(game.galaxy, tradeSim.world, tradeSim,
		planetMask, planetCount, 1 + bot.count, cargoSim);
	GravityGame.startCareer(game.career, cargoSim, seed, tradeSim, game.cheat, game.galaxy);
	bot.startCareers(game.galaxy, seed, tradeSim);
	/* Special worlds and every starting HQ have a standard gravity well. */
	const fixed = [game.career.capitalPlanet, game.career.arfPlanet];
	for (let i = 0; i < game.galaxy.actors.length; i++) fixed.push(game.galaxy.actors[i].hq);
	for (let i = 0; i < fixed.length; i++) {
		const planet = fixed[i];
		if (planet < 0) continue;
		planetBaseStrength[planet] = 1;
		portPlanetStrength[planet] = 1;
	}
	syncPlanetStrengths();
	if (mode === MODE_PORTS) cargoSim.refreshField();
	syncPlanetGravity();
	bot.setPlanetMask(planetMask, planetCount);
	/* YOU as a bot: the page keeps the ship, the bot plans and shops for it */
	bot.attachCareerPlayer(game.career, cargoSim);
	game.career.forceScale = cargoSim.forceScale;
	/* the ship starts landed on HQ: the landing pause applies from turn one,
	 * but a bot-run YOU never needs the clock stopped to aim */
	careerPaused = pauseOnLanding && !slotIsBot(0);
	if (careerPaused) careerPauseNow = performance.now();
	if (scene.setFrozen) scene.setFrozen(careerPaused);
	refreshCareerClockUi();
}

/* one flat row: lab stops the run, every other mode starts its rule at once */
function setPlayMode(next) {
	if (next === PLAY_LAB) {
		if (game.on) stopGame();
		saveLastMode(PLAY_LAB);
		updateRuleHelp(PLAY_LAB);
		syncModeRadios();
		return;
	}
	if (!RULES[next]) {
		syncModeRadios();
		return;
	}
	if (game.on && game.rule === next) {
		updateRuleHelp(next);
		return;
	}
	saveLastMode(next);
	updateRuleHelp(next);
	startGame(game.on ? game.seed : tradeSim.seed, game.on ? game.fixedRate : false, next);
}

function setBot(next) {
	if (next === game.bot) return;
	startGame(game.seed, game.fixedRate, game.rule, next, game.player, game.cheat);
}

/* the scoreboard +/- sets how many players share the run; a human-only rule
 * keeps YOU human and the rest are rival careers. 0 means the difficulty
 * level picks the rival count */
function playerCountShown() {
	return game.playerCount > 0 ? game.playerCount : 1 + bot.count;
}

function setPlayerCount(delta) {
	if (replay.on) return;
	const current = playerCountShown();
	const count = Math.max(1, Math.min(MAX_PLAYERS, current + Math.sign(delta)));
	if (count === current) return;
	if (delta > 0) {
		if (planetCount >= PLANET_UNIVERSE_MAX) return;
		/* A live career must choose the new bot's generated world before enabling
		 * it. The planner keeps existing companies in place and verifies that the
		 * new G=1 HQ has a free, non-heavy, starter-exitable first landing at pay
		 * comparable to the run's original opening band. */
		const expansion = game.on && careerRule()
			? GravityGame.planCareerExpansion(game.galaxy, tradeSim.world, tradeSim,
				planetMask, planetCount, cargoSim)
			: null;
		if (game.on && careerRule() && !expansion) {
			careerNotice('no safe generated HQ is available for another player');
			return;
		}
		const before = planetMask.slice();
		if (!setPlanetUniverseSize(planetCount + 1, expansion ? expansion.planet : -1)) return;
		let added = -1;
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (planetMask[i] && !before[i]) { added = i; break; }
		}
		if (game.on) {
			slotTypes[count - 1] = PLAYER_BOT;
			if (careerRule()) {
				planetBaseStrength[added] = 1;
				portPlanetStrength[added] = 1;
				syncPlanetStrengths();
				bot.addCareerRival(game.galaxy, tradeSim, added, game.clockSteps);
				if (mode === MODE_PORTS) cargoSim.refreshField();
				syncPlanetGravity();
			} else {
				bot.addRival(added, game.clockSteps);
				if (routeRule()) bot.useField(cargoSim, mode);
				game.doneSteps = -1;
				for (let i = 0; i < bot.count; i++) bot.rivals[i].doneSteps = -1;
			}
			game.playerCount = count;
			refreshGameUi();
			refreshPlanetUniverseUi();
			return;
		}
	} else if (game.on) {
		if (activeSlotIndex() === current - 1) selectSlot(0);
		if (careerRule()) {
			const removed = bot.rivals[bot.count - 1].career;
			if (turret.pending && removed.pads.includes(turret.pad)) cancelTurret();
			bot.removeCareerRival();
		}
		else bot.removeRival();
		game.playerCount = count;
		refreshGameUi();
		refreshPlanetUniverseUi();
		return;
	}
	game.playerCount = count;
	if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
	else {
		syncScoreControls(false);
		refreshPlanetUniverseUi();
	}
}

/* the planet-count input and the player +/- reflect the live state */
function refreshPlanetUniverseUi() {
	if (planetCountInputEl) {
		if (document.activeElement !== planetCountInputEl) {
			planetCountInputEl.value = planetCount;
		}
		planetCountInputEl.min = PLANET_UNIVERSE_MIN;
		planetCountInputEl.max = PLANET_UNIVERSE_MAX;
	}
	const shown = playerCountShown();
	if (playerCountValueEl) playerCountValueEl.textContent = shown;
	if (playerCountDownEl) playerCountDownEl.disabled = shown <= 1;
	if (playerCountUpEl) playerCountUpEl.disabled = shown >= MAX_PLAYERS || planetCount >= PLANET_UNIVERSE_MAX;
}

function setSlotType(slot, next) {
	if (slot < 0 || slot >= slotTypes.length) return;
	const normalized = next === PLAYER_BOT ? PLAYER_BOT : PLAYER_USER;
	if (slotTypes[slot] === normalized && (slot !== 0 || game.player === normalized)) return;
	slotTypes[slot] = normalized;
	if (slot === 0) game.player = normalized;
	/* a career keeps its map, purses and pads: a ticked box hands the player
	 * over on the spot instead of wiping the run */
	if (game.on && careerRule()) {
		applySlotTypeNow(slot);
		syncScoreControls(false);
		return;
	}
	if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, slotTypes[0], game.cheat);
	else syncScoreControls(false);
}

/* hand one career player over between the keyboard and the bot without a restart */
function applySlotTypeNow(slot) {
	if (slot === 0) {
		playerBotSyncNeeded = true;
		/* a bot-run YOU needs the clock running to plan and fire */
		if (slotIsBot(0) && careerPaused) setCareerPaused(false);
		bot.attachCareerPlayer(game.career, cargoSim);
		refreshGameUi();
		return;
	}
	bot.rivalTypes[slot - 1] = slotTypes[slot];
}

/* one selection for the whole page: the HUD, career panels and pads follow it,
 * and a user slot is flown by hand from wherever the selection sits */
function selectSlot(slot) {
	if (!game.on || replay.on) return;
	if (slot < 0 || slot >= slotCount()) return;
	if (slot === activeSlot) return;
	const prev = activeSlot;
	slotAim[prev].armed = armed;
	slotAim[prev].body = aimBody;
	slotAim[prev].angle = aimAngle;
	slotAim[prev].speed = aimSpeed;
	aiming = false;
	pressing = false;
	savedArmed = false;
	blockedPlanet = -1;
	blockedKind = 0;
	blockedBy = -1;
	activeSlot = slot;
	const nextAim = slotAim[slot];
	armed = nextAim.armed;
	aimBody = nextAim.body;
	aimAngle = nextAim.angle;
	aimSpeed = nextAim.speed;
	if (armed && aimBody >= 0) {
		placeGripFromSpeed();
		if (activeSim().predCount < 2) dirty = true;
	} else {
		refreshAimLabel();
	}
	refreshPredGain();
	/* the shop follows the newly selected ship, and the trace is traced again */
	careerFollow = true;
	dirty = true;
	launchState = -1;
	refreshGameUi();
}

/* back to lab: the world stays, the clock returns to real time, a running flight continues */
function stopGame() {
	const wasCareer = careerRule();
	cancelCareerWait();
	stopReplay();
	cancelTurret();
	careerPaused = false;
	if (scene.setFrozen) scene.setFrozen(false);
	clearBurnAim();
	linkNote = '';
	game.on = false;
	activeSlot = 0;
	predGain = 0;
	if (wasCareer) resetPlayback();
	else refreshPlaybackUi();
	cargoSim.setLaunchNetwork(null, null);
	resetAllRouteBest();
	updateRuleHelp(selectedHelpRule());
	scene.setGameClock(false);
	cargoSim.stepLimit = Infinity;
	cargoSim.limitReason = END_TIME;
	launchState = -1;
	gameLinkEl.hidden = true;
	hideBotLog();
	refreshSelected();
	refreshGameUi();
	syncSeedUrl();
}

function launchPlayerBotIfReady(budgetMs, force) {
	if (!slotIsBot(0) || cargoSim.status === STATUS_FLYING || slotFlownDone(0)) return true;
	if (careerRule()) return careerPlayerBotLaunch();
	if (playerBotSyncNeeded) {
		bot.syncPlayer(cargoSim, game.money, game.shots.length,
			game.steps, game.length, game.doneSteps, game.clockSteps);
		playerBotSyncNeeded = false;
	}
	while (true) {
		const ready = bot.tickPlayer(game.clockSteps, game.market, force ? 1e9 : budgetMs);
		if (!ready) {
			if (!force) return false;
			continue;
		}
		break;
	}
	if (!bot.playerPlanValid(game.clockSteps, game.market)) return true;
	const origin = bot.player.planOrigin;
	const angle = GravityGame.angleOf(bot.player.planAngleU);
	const speed = GravityGame.speedOf(bot.player.planSpeedU);
	if (activeSlotIndex() === 0) {
		aimBody = origin;
		aimAngle = angle;
		aimSpeed = speed;
		placeGripFromSpeed();
		armed = true;
		fire(NO_ABORT);
		return true;
	}
	cargoSim.fieldT = tradeSim.t;
	cargoSim.fieldRate = scene.trade.speed;
	cargoSim.stepLimit = ruleSpec().capSteps;
	cargoSim.limitReason = END_TIME;
	game.shots.push(GravityGame.createShot(MODE_PLANETS, origin,
		bot.player.planAngleU, bot.player.planSpeedU, NO_ABORT));
	cargoSim.predict(origin, angle, speed);
	cargoSim.launch(origin, angle, speed);
	GravityGame.beginFlight(game.money, cargoSim);
	refreshGameUi();
	return true;
}

/*
 * YOU as a bot in career: the bot shops between flights and picks the shot, but
 * the page fires it through the same turret queue a hand-aimed launch uses, so
 * the world clock, the HUD and the flight end stay exactly as if YOU aimed.
 */
function careerPlayerBotLaunch() {
	const career = game.career;
	if (career.ended !== GravityGame.CAREER_OPEN || turret.pending) return true;
	/* the page books a landing at the end of the frame: until then the career
	 * record still names the pad the ship has already left */
	if (cargoSim.status === STATUS_FLYING || cargoSim.landedBody !== career.at) return true;
	const ready = bot.tickCareerPlayer(game.clockSteps, game.market, tradeSim,
		scene.trade.speed, playerBotSyncNeeded);
	playerBotSyncNeeded = false;
	if (!ready) return true;
	const plan = bot.careerPlayerPlan();
	aimBody = plan.origin;
	aimAngle = plan.angle;
	aimSpeed = plan.speed;
	placeGripFromSpeed();
	dirty = true;
	armed = true;
	queueTurretShot();
	return true;
}

/*
 * Playback scales the wall-clock slice fed to the fixed-step physics. Player
 * and rivals step in exact integer DT lockstep against the shared planet
 * market; if a rival is searching its next shot, clockSteps pauses for a few
 * 3 ms slices and resumes from the exact same step.
 */
function stepGame(now, dt) {
	if (routeRule()) {
		playAcc = 0;
		if (replay.on) {
			if (!cargoSim.routeActive && cargoSim.predCount >= 2) finishRouteReplay();
			return;
		}
		bot.tickRoute(BOT_STEP_MS);
		const count = slotCount();
		const active = activeSlotIndex();
		for (let s = 0; s < count; s++) {
			if (s === active || slotIsBot(s)) continue;
			const bgSim = slotSim(s);
			if (!bgSim.routeActive) continue;
			bgSim.routeStep(2);
			syncSlotRouteFromSim(s, slotAim[s].body);
			if (!bgSim.routeActive) {
				rememberSlotRouteBest(s, slotAim[s].body,
					GravityGame.angleUnits(slotAim[s].angle),
					GravityGame.speedUnits(slotAim[s].speed));
			}
		}
		syncPlayerBotAim();
		syncRoutePlan();
		return;
	}
	if (replay.on && replay.phase !== PHASE_FLY && now >= replay.until) advanceReplay(now);
	/* a queued career launch fires once the in-game clock reaches the step
	 * where the EMC barrel lines up with the aim; the world clock keeps
	 * running through the wind-up (pausing it would stop the barrel) */
	if (turret.pending) tickTurret();
	/* the eased career wait owns the world clock for its 2 s */
	if (careerWaitBusy()) {
		playAcc = 0;
		return;
	}
	/* a paused career clock freezes everyone — rival companies included —
	 * so the player can aim while nothing on the shared map changes */
	if (careerRule() && careerPaused && !replay.on) {
		playAcc = 0;
		return;
	}
	const capSteps = ruleSpec().capSteps;
	/* in career the clock also runs between flights while unpaused: pads
	 * charge, visit profits grow and the rival companies fly their turns */
	const careerIdle = careerRule() && !replay.on && !careerPaused &&
		careerWorldOpen() && !clockDriverFlying();
	if (!clockDriverFlying() && !careerIdle) {
		playAcc = 0;
		if (replay.on) return;
		if (!hasLiveUser()) {
			if (slotIsBot(0) && !slotFlownDone(0)) {
				launchPlayerBotIfReady(BOT_STEP_MS, false);
			} else if (bot.count > 0) {
				bot.prepareStep(game.clockSteps, game.market, capSteps, BOT_STEP_MS, false);
			}
			return;
		}
		bot.tickIdle(game.clockSteps, game.market, BOT_STEP_MS);
		if (slotIsBot(0) && !slotFlownDone(0)) {
			if (playerBotSyncNeeded) {
				bot.syncPlayer(cargoSim, game.money, game.shots.length,
					game.steps, game.length, game.doneSteps, game.clockSteps);
				playerBotSyncNeeded = false;
			}
			bot.tickPlayer(game.clockSteps, game.market, BOT_STEP_MS);
		}
		return;
	}
	let scale = playScale() * (replay.on ? REPLAY_SPEEDS[replay.speed] : 1);
	if (scale > PLAY_MAX) scale = PLAY_MAX;
	playAcc += dt * scale;
	if (playAcc > PLAY_MAX * 0.1) playAcc = PLAY_MAX * 0.1;
	let wasSlot0Flying = cargoSim.status === STATUS_FLYING;
	let wasUserRivalMask = 0;
	for (let i = 0; i < bot.count; i++) {
		if (!bot.isRivalBot(i) && bot.rivals[i].sim.status === STATUS_FLYING) {
			wasUserRivalMask |= 1 << i;
		}
	}
	let stepsDone = 0;
	while ((clockDriverFlying() || careerIdle) && playAcc >= DT && stepsDone < MAX_GAME_STEPS) {
		/* never step past the aligned barrel: the queued shot fires first */
		if (turret.pending && game.clockSteps >= turret.fireAt) break;
		if (!bot.prepareStep(game.clockSteps, game.market, capSteps, BOT_STEP_MS, false)) {
			playAcc = 0;
			break;
		}
		if (!replay.on && !launchPlayerBotIfReady(BOT_STEP_MS, false)) {
			playAcc = 0;
			break;
		}
		if (cargoSim.status === STATUS_FLYING) wasSlot0Flying = true;
		advanceGameOneStep();
		playAcc -= DT;
		stepsDone += 1;
	}
	/* the clock reached the aligned step: the queued shot leaves now */
	if (turret.pending) tickTurret();
	let fieldMoved = false;
	if (wasSlot0Flying || cargoSim.status === STATUS_FLYING) {
		tradeSim.advanceTo(cargoSim.flightFieldT);
		fieldMoved = true;
	} else {
		for (let i = 0; i < bot.count; i++) {
			const rSim = bot.rivals[i].sim;
			if ((wasUserRivalMask & (1 << i)) || rSim.status === STATUS_FLYING) {
				tradeSim.advanceTo(rSim.flightFieldT);
				fieldMoved = true;
				break;
			}
		}
	}
	/* career steps without a driving human flight (idle clock, or only
	 * rival companies airborne) still move the trade world the same span */
	if (!fieldMoved && careerRule() && stepsDone > 0) {
		tradeSim.advanceTo(tradeSim.t + stepsDone * DT * scene.trade.speed);
	}
	if (wasSlot0Flying && cargoSim.status !== STATUS_FLYING) {
		if (!clockDriverFlying()) playAcc = 0;
		endGameFlight();
	}
	for (let i = 0; i < bot.count; i++) {
		if ((wasUserRivalMask & (1 << i)) && bot.rivals[i].sim.status !== STATUS_FLYING) {
			if (!clockDriverFlying()) playAcc = 0;
			endUserRivalFlight(i);
		}
	}
}

/*
 * The bot flying YOU in career burns the impulse drive on its own schedule; the
 * page only records the burn into the live shot, so a replay re-flies it at the
 * same step, and refreshes the continuation preview.
 */
function careerBotBurn() {
	if (!careerRule() || replay.on || !slotIsBot(0)) return false;
	if (!game.career || cargoSim.status !== STATUS_FLYING) return false;
	const step = cargoSim.liveSteps;
	const burn = bot.tickCareerPlayerFlight(game.clockSteps, game.market);
	if (!burn) return false;
	if (game.shots.length > 0) {
		game.shots[game.shots.length - 1].burns.push(GravityGame.createBurn(step,
			GravityGame.angleUnits(burn.angle), GravityGame.speedUnits(burn.dv)));
	}
	dirty = true;
	careerNotice('bot burn Δv ' + burn.dv.toFixed(1) + ' px/s → P' + burn.body +
		' · fuel ' + game.career.ship.fuelKg.toFixed(1) + ' kg');
	refreshGameUi();
	return true;
}

function applyReplayBurns() {
	const rShot = replay.activeShot;
	if (!rShot || !rShot.burns) return;
	while (replay.burnIndex < rShot.burns.length &&
		rShot.burns[replay.burnIndex].step === cargoSim.liveSteps) {
		const b = rShot.burns[replay.burnIndex++];
		const angle = GravityGame.angleOf(b.angle);
		const dv = GravityGame.speedOf(b.dv);
		const ok = careerRule()
			? GravityGame.careerBurn(game.career, cargoSim, angle, dv)
			: cargoSim.burn(angle, dv);
		if (!ok) continue;
		if (game.shots.length > 0) {
			game.shots[game.shots.length - 1].burns.push(
				GravityGame.createBurn(b.step, b.angle, b.dv));
		}
		dirty = true;
	}
}

function advanceGameOneStep() {
	let endedLimit = false;
	if (cargoSim.status === STATUS_FLYING && cargoSim.liveSteps >= cargoSim.stepLimit) {
		cargoSim.stepOne();
		endedLimit = true;
	}
	/* career rivals own their flights: the bot steps and lands every company
	 * on the same world clock, whoever flies it */
	if (!careerRule()) {
		for (let i = 0; i < bot.count; i++) {
			const r = bot.rivals[i];
			if (bot.isRivalBot(i) || r.sim.status !== STATUS_FLYING) continue;
			if (r.sim.liveSteps < r.sim.stepLimit) continue;
			r.sim.stepOne();
			GravityGame.endFlight(r.ledger);
			if (r.sim.endReason === END_IMPACT && r.sim.endBody >= 0) {
				r.basePlanet = r.sim.endBody;
			}
			r.steps += r.sim.liveSteps;
			r.length += r.sim.flightLength;
			endedLimit = true;
		}
	}
	if (endedLimit && (!clockDriverFlying() ||
		(cargoSim.status !== STATUS_FLYING && !rivalFlying(false)))) {
		return;
	}
	if (replay.on) {
		if (cargoSim.status === STATUS_FLYING) applyReplayBurns();
	} else {
		careerBotBurn();
	}
	game.clockSteps += 1;
	if (careerRule()) GravityGame.careerAdvance(game.career, scene.trade.speed, 1);
	if (cargoSim.status === STATUS_FLYING) {
		cargoSim.stepOne();
		GravityGame.stepHarvest(game.money, game.market, cargoSim, game.clockSteps);
		if (ruleSpec().stopOnTour && cargoSim.visitedCount === planetCount && game.doneSteps < 0) {
			game.doneSteps = game.steps + cargoSim.visitStep;
		}
	}
	if (careerRule()) bot.stepCareer(game.clockSteps, game.market, tradeSim, scene.trade.speed);
	else bot.stepOne(game.clockSteps, game.market);
}

function settleBotsWhenUsersDone() {
	if (hasLiveUser() || replay.on) return;
	const spec = ruleSpec();
	if (slotIsBot(0) && !slotFlownDone(0)) return;
	if (bot.count > 0) {
		game.clockSteps = bot.settle(game.clockSteps, game.market, spec.capSteps);
	}
}

function endGameFlight() {
	clearBurnAim();
	const spec = ruleSpec();
	if (spec.stopOnTour && cargoSim.visitedCount === planetCount && game.doneSteps < 0) {
		game.doneSteps = game.steps + cargoSim.visitStep;
	}
	if (careerRule()) {
		const career = game.career;
		const delivered = career.delivered;
		const competitions = career.competitions;
		GravityGame.careerEndFlight(career, cargoSim, tradeSim, game.clockSteps);
		if (career.delivered > delivered) careerPhoto('delivery');
		else if (career.competitions > competitions) careerPhoto('sport');
		/* the shop follows the ship again after every landing / stranding */
		careerFollow = true;
		/* default: freeze the world clock at flight end (rivals too) so
		 * the next shot can be aimed in peace; the setting can turn it off */
		if (pauseOnLanding && !replay.on && !slotIsBot(0)) setCareerPaused(true);
	} else GravityGame.endFlight(game.money);
	game.steps += cargoSim.liveSteps;
	game.length += cargoSim.flightLength;
	playerBotSyncNeeded = true;
	const settleRivals = !hasLiveUser() &&
		((slotBroke(0) && !(spec.stopOnTour && game.doneSteps >= 0)) ||
			(spec.maxShots > 0 && game.shots.length >= spec.maxShots));
	if (settleRivals && bot.count > 0) {
		game.clockSteps = bot.settle(game.clockSteps, game.market, spec.capSteps);
	}
	if (replay.on) {
		replay.activeShot = null;
		replay.burnIndex = 0;
		replay.phase = PHASE_GAP;
		replay.until = performance.now() + REPLAY_GAP_MS / REPLAY_SPEEDS[replay.speed];
	}
	moneyToastFor(0, cargoSim, game.money, game.shots.length);
	refreshGameUi();
}

function endUserRivalFlight(rIdx) {
	const r = bot.rivals[rIdx];
	settleBotsWhenUsersDone();
	moneyToastFor(rIdx + 1, r.sim, r.ledger, r.shots.length);
	refreshGameUi();
}

function signedMoney(value) {
	return (value < 0 ? '−' : '+') + Math.abs(value).toFixed(2);
}
