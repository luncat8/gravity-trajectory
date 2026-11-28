/*
 * Game session: start and stop, the career run, the fixed-step loop, bot settling, flight end and the rival settle.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* ── start ── startGame, the career run start, strengths, seat plans */

function startGame(seed, fixedRate, rule, botLevel, playerType, cheat) {
	commsResetSession();
	cancelCareerPlanning();
	const armedField = PlanetGravity.armed();
	if (armedField && armedField.seed !== (seed >>> 0)) clearMapField();
	careerRecordingClear();
	const wasCareer = careerRule();
	cancelCareerWait();
	for (let s = 0; s < slotTurrets.length; s++) cancelTurret(slotTurrets[s]);
	slotPaused.fill(false);
	stopReplay();
	linkNote = '';
	game.on = true;
	game.seed = seed;
	game.fixedRate = fixedRate;
	if (rule) game.rule = rule;
	game.cheat = game.rule === RULE_CAREER && GravityGame.CHEATS[cheat] ? cheat : null;
	/* both ladders share their rungs, but a rung means a different pace in each:
	 * a mode switch returns to the pace that mode is balanced at */
	if (careerRule() !== wasCareer) resetPlayback();
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
	game.market.permanentCorruption = $('permanentCorruption').checked;
	GravityGame.resetLedger(game.money);
	/* Select the new rule's universe before the trade world is rebuilt and
	 * fast-forwarded. Otherwise a career first simulates the previous 26-world
	 * map, then retires half its ports at t+07:00; ships already in flight keep
	 * route coordinates from that discarded map. */
	if (!pendingUniverse()) {
		initPlanetUniverse(game.planetUniverse > 0 ? game.planetUniverse : planetUniverseDefault(game.rule));
	}
	tradeSim.setEmptyMask(null);
	scene.reset(seed, true);
	scene.setGameClock(true);
	if (careerRule()) {
		/* the empty heavy worlds are an opening fact, and the trade world must
		 * know before settle() advances t = 0 → 420: the tail of the in-play
		 * indices starts uninhabited, retired from trade and drawn from their
		 * own gravity salt. Live universe edits never re-derive — planets that
		 * join a run mid-way are settled ground (an HQ lands there at once). */
		GravityGame.deriveEmptyWorlds(game.market, planetMask, planetCount, tradeSim.world);
		tradeSim.setEmptyMask(game.market.empty, game.market.heavy);
	}
	scene.settle();
	clearCargo();
	cargoSim.fieldT = tradeSim.t;
	cargoSim.fieldRate = scene.trade.speed;
	bot.reset(seed, game.rule, game.bot, game.player, rivalTypesArg,
		game.playerCount > 0 ? game.playerCount - 1 : undefined);
	applyPlanetUniverse();
	ensureValidActiveSlot(-1);
	turret = slotTurrets[activeSlotIndex()];
	attachWorld();
	if (careerRule()) {
		applyStartGifts();
		startCareerRun(seed);
	} else {
		careerPaused = false;
		if (scene.setFrozen) scene.setFrozen(false);
		cargoSim.setLaunchNetwork(null, null);
	}
	careerFollow = true;
	careerNotice('');
	if (routeRule()) bot.useField(cargoSim, mode);
	launchState = -1;
	hideCopyText();
	refreshGameUi();
	careerRecordingReset();
	syncSeedUrl();
}

/* Special worlds and every starting (or restored) HQ have a standard well: the
 * seat plan traces homes at g 1, so the field has to match what it planned. */
function pinCareerStrengths() {
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
}

/* one galaxy per career run: YOU join first, then every rival career, so pads
 * and usage tax are shared ground from the first launch */
function startCareerRun(seed) {
	cancelTurret();
	GravityGame.resetGalaxy(game.galaxy, seed);
	/* 0.7.47 WS4: the opening seat search is a resumable walk. Run it
	 * synchronously for the synchronous budget; a roster that cannot be
	 * seated fairly inside it becomes the planning state instead. */
	const startMode = game.startMode;
	/* a saved map seats this run from its record and skips the opening search */
	liteArmOpening(seed);
	if (startMode === GravityGame.START_PLANET) {
		if (GravityMaps.applySeats(game.galaxy, tradeSim.world, tradeSim,
			planetMask, planetCount, 1 + bot.count, cargoSim)) {
			/* applySeats already remembered the record's plan */
			startCareerWithPlan(null, seed, GravityGame.START_PLANET);
			return;
		}
		const search = GravityGame.createSeatSearch(tradeSim.world, tradeSim,
			planetMask, planetCount, 1 + bot.count, cargoSim);
		const out = search.step(CAREER_SEARCH_SYNC_MS);
		if (out.accepted) {
			applySeatPlan(search, seed);
			return;
		}
		if (out.done && !search.bestPlan()) {
			/* no set at any tier can be seated: start planet anyway below the
			 * minimal line and let the weak roster warning carry the news */
			startCareerWithPlan(null, seed, startMode, true);
			return;
		}
		beginCareerPlanning(search, seed, startMode);
		return;
	}
	/* no-HQ starts seat nothing: the spawn or the Capital is the opening */
	startCareerWithPlan(null, seed, startMode);
}

/* take a completed, accepted search's plan and finish the start exactly as
 * the synchronous path does today */
function applySeatPlan(search, seed) {
	applySeatPlanPlan(search.bestPlan(), seed);
}

/* apply a plan snapshot directly — the WS4 decisions carry the tier that
 * was complete when they appeared, not the live search */
function applySeatPlanPlan(plan, seed) {
	GravityGame.rememberSeatPlan(game.galaxy, tradeSim.world, tradeSim,
		planetMask, planetCount, 1 + bot.count, cargoSim, plan.homes, plan.targetPay);
	startCareerWithPlan(plan, seed, GravityGame.START_PLANET);
}

/* hand the run its galaxy and seats, then start every career. The plan's
 * homes live on `galaxy.mapSeats` (rememberSeatPlan / prepareCareerStarts
 * set it); `startCareer` reads one home per company from there, so no single
 * homePlanet is passed here. A no-HQ start seats nothing, so its galaxy is
 * opened without any seat search (WS5). */
function startCareerWithPlan(plan, seed, startMode, skipSeatSearch) {
	if (startMode === GravityGame.START_PLANET && !skipSeatSearch) {
		GravityGame.prepareCareerStarts(game.galaxy, tradeSim.world, tradeSim,
			planetMask, planetCount, 1 + bot.count, cargoSim);
	}
	GravityGame.startCareer(game.career, cargoSim, seed, tradeSim, game.cheat,
		game.galaxy, undefined, startMode, game.player === PLAYER_BOT);
	finishCareerStart(seed);
}

/* the common tail after seats and the first career exist */
function finishCareerStart(seed) {
	bot.onCareerTrace = recordCareerTrace;
	bot.startCareers(game.galaxy, seed, tradeSim, game.startMode);
	pinCareerStrengths();
	bot.setPlanetMask(planetMask, planetCount);
	/* YOU as a bot: the page keeps the ship, the bot plans and shops for it */
	bot.attachCareerPlayer(game.career, cargoSim);
	/* the bought fleet (0.7.45): an empty alias on a fresh company, and the
	 * standing box intent re-arms its mirror after a restart */
	bot.attachFleet(game.career, tradeSim);
	syncFleetCheckbox();
	game.career.forceScale = cargoSim.forceScale;
	/* a gifted radar turns the view on from step 0, like building it */
	if (game.career.radar) predRivalsOn = true;
	/* the ship starts landed on HQ: the landing pause applies from turn one,
	 * but a bot-run YOU never needs the clock stopped to aim */
	for (let s = 0; s < slotCount(); s++) slotPaused[s] = pauseOnLanding && !slotIsBot(s);
	careerPaused = otherPlayerPaused(-1);
	if (careerPaused) careerPauseNow = performance.now();
	if (scene.setFrozen) scene.setFrozen(careerPaused);
	refreshCareerClockUi();
	/* the panel carries the session's cheat intent: adopt the reset's own cheat
	 * into the boxes, then re-apply the intent a single-slot reset could not
	 * carry (the test fit on a communism reset) */
	cheatPanelAdopt();
	cheatPanelApply();
	/* 0.7.47 WS4: the planning path starts the career asynchronously (after
	 * startGame's tail), so the recording is created here — after the rivals
	 * exist — not only in startGame. The synchronous path re-creates it right
	 * after, which is harmless and keeps the full roster in the snapshot. */
	careerRecordingReset();
}

/* 0.7.47 WS4: the seat search is a resumable walk, so a roster the
 * synchronous budget cannot seat fairly does not block the page. The run
 * enters a planning state, the frame loop advances the search a few
 * milliseconds at a time, and H reports the live best until a tier accepts
 * or the player decides. Only a completed tier can become a plan. */

/* ── seat search ── roster planets, fair-search decisions and reports, sliced planning */

/* Adding a planet to an active career does not reseat its existing HQs. */
function addPlanetForRoster() {
	if (!careerRule()) return;
	if (planetCount >= planetUniverseCap()) return;
	if (!setPlanetUniverseSize(planetCount + 1)) return;
	if (careerPlanning) {
		cancelCareerPlanning();
		startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
	}
}

/* The live WS4 decision, or null while the walk is still running. `plan`
 * is the snapshot taken when the decision appeared (the completed tier at
 * offer time — mid-tier progress never leaks into it); `canAdvance` says a
 * deeper pass is still running. */
function careerPlanningDecision() {
	if (!careerPlanning || !careerPlanSearch || !careerPlanDecision) return null;
	return {
		kind: careerPlanDecision.kind,
		plan: Boolean(careerPlanDecision.plan),
		canAdvance: Boolean(careerPlanDecision.canAdvance),
		tier: careerPlanSearch.tier
	};
}

/* H's search decision (WS4): start with the tier that was complete when the
 * card offered it — the snapshot the decision carries, not a later best. */
function playFairSearchAsIs() {
	const decision = careerPlanDecision;
	if (!careerPlanning || !careerPlanSearch || !decision) return;
	const seed = careerPlanSeed;
	const plan = decision.plan;
	cancelCareerPlanning();
	if (plan) applySeatPlanPlan(plan, seed);
	else startCareerWithPlan(null, seed, GravityGame.START_PLANET, true);
	commsInvalidate();
	refreshGameUi();
}

/* the live roster's fairness for H (WS3). Only a planet start that is not
 * already planning is judged: a saved-map boot or a no-HQ start owns its
 * opening, so the roster is not the deciding factor. */
function rosterFairnessReport() {
	if (!careerRule() || careerPlanning || game.startMode !== GravityGame.START_PLANET ||
		!tradeSim.world || !planetMask) {
		return { ok: true, planets: planetCount, players: playerCountShown() };
	}
	const comp = GravityGame.startComposition(tradeSim.world, planetMask, planetCount,
		playerCountShown(), cargoSim, game.startMode, game.market.empty, game.market.heavy);
	return { ok: comp.ok, planets: planetCount, players: playerCountShown(), composition: comp };
}

/* the live seat-search report for H (WS4). A completed tier that accepted
 * clears the report; while planning it names the tier, the best weakest
 * share so far, and which criterion is still unmet. `step(0)` is a no-op
 * that only reads the current best, so it never advances the walk. */
/* flat search fields for H's snapshot (WS4): the live report plus the
 * frozen decision, in the one shape comms_copy's gates read */
function fairSearchSnapshotFields() {
	if (!careerPlanning || !careerPlanSearch) {
		return {
			searchActive: false, searchTier: 0, searchWeakest: 0,
			searchUnmet: '', searchProgress: 0, searchDecision: '',
			searchPlan: false, searchCanAdvance: false, searchPay: '', searchHasBest: false
		};
	}
	const rep = seatSearchReport();
	const decision = careerPlanningDecision();
	return {
		searchActive: true,
		searchTier: rep.tier,
		searchWeakest: rep.weakest,
		searchUnmet: rep.unmet,
		searchProgress: rep.progress,
		searchDecision: decision ? decision.kind : '',
		searchPlan: Boolean(decision && decision.plan),
		searchCanAdvance: Boolean(decision && decision.canAdvance),
		searchPay: rep.pay,
		searchHasBest: rep.hasBest
	};
}

function seatSearchReport() {
	if (!careerPlanning || !careerPlanSearch) {
		return { active: false, tier: 0, weakest: 0, unmet: '', progress: 0 };
	}
	const out = careerPlanSearch.step(0);
	const best = out.best;
	const weakest = best && best.stats ? Math.round(best.ratio * 100) : 0;
	const unmet = !best ? 'no complete candidate evaluated yet' :
		best.unmet === 'distinct' ? 'each company needs a distinct first landing' :
		best.unmet === 'exit-safe' ? 'a starter rail cannot safely launch from every first landing' :
		best.unmet ? 'weakest opening pays less than 55% of the strongest' : '';
	const pay = best && Number.isFinite(best.minPay) && Number.isFinite(best.maxPay)
		? best.minPay.toFixed(1) + '–' + best.maxPay.toFixed(1) + ' cr' : '';
	return {
		active: true,
		tier: out.tier,
		weakest: weakest,
		unmet: unmet,
		pay: pay,
		hasBest: Boolean(best && pay),
		progress: Math.round(out.progress * 100)
	};
}
const CAREER_SEARCH_SYNC_MS = 2000;
const CAREER_SEARCH_FRAME_MS = 8;

/* enter the planning state with a live search and a frozen run */
function beginCareerPlanning(search, seed, startMode) {
	careerPlanning = true;
	careerPlanSearch = search;
	careerPlanSeed = seed;
	careerPlanMode = startMode;
	careerPlanDecision = null;
	/* the run is open but the careers are not started yet: hold the clock */
	careerPaused = true;
	careerPauseNow = performance.now();
	if (scene.setFrozen) scene.setFrozen(true);
	refreshCareerClockUi();
	refreshGameUi();
	commsResetVisit(playerCareer(), playerCareer().at);
	commsInvalidate();
}

/* Completed tiers are safe to start; keep looking while that offer is open. */
function stepCareerPlanning(budgetMs) {
	if (!careerPlanning || !careerPlanSearch) return;
	if (careerPlanDecision && !careerPlanDecision.canAdvance &&
		careerPlanSearch.step(0).done) return;
	const out = careerPlanSearch.step(budgetMs);
	if (out.accepted) {
		const seed = careerPlanSeed;
		const plan = careerPlanSearch.bestPlan();
		cancelCareerPlanning();
		applySeatPlanPlan(plan, seed);
		commsInvalidate();
		refreshGameUi();
		return;
	}
	if (out.done) {
		const plan = careerPlanSearch.bestPlan();
		const comp = GravityGame.startComposition(tradeSim.world, planetMask, planetCount,
			1 + bot.count, cargoSim, game.startMode, game.market.empty, game.market.heavy);
		if (!comp.ok) {
			const seed = careerPlanSeed;
			cancelCareerPlanning();
			if (plan) applySeatPlanPlan(plan, seed);
			else startCareerWithPlan(null, seed, GravityGame.START_PLANET, true);
			commsInvalidate();
			refreshGameUi();
			return;
		}
		const canAdvance = careerPlanSearch.canAdvanceTier();
		careerPlanDecision = { kind: 'tier-end', plan: plan, canAdvance: canAdvance };
		if (canAdvance) careerPlanSearch.advanceTier();
		commsInvalidate();
		refreshGameUi();
		return;
	}
	commsInvalidate();
}

/* cancel the planning state: called on restart, a roster change, or a decision */
function cancelCareerPlanning() {
	careerPlanning = false;
	careerPlanSearch = null;
	careerPlanSeed = 0;
	careerPlanMode = GravityGame.START_PLANET;
	careerPlanDecision = null;
}

/* the planning driver: ~6-10 ms per frame from the frame loop */
function tickCareerPlanning() {
	if (careerPlanning) stepCareerPlanning(CAREER_SEARCH_FRAME_MS);
}

/* Test harness: finish planning without advancing the game clock. */
function drainCareerPlanning() {
	let guard = 0;
	while (careerPlanning && guard++ < 600) {
		const decision = careerPlanningDecision();
		if (decision) {
			if (decision.canAdvance) {
				stepCareerPlanning(CAREER_SEARCH_FRAME_MS);
				continue;
			}
			playFairSearchAsIs();
			continue;
		}
		stepCareerPlanning(CAREER_SEARCH_FRAME_MS);
	}
}

/* ── mode, bot & roster controls ── play mode, bot level, player count, universe, slot types */

/* one flat row: lab stops the run, every other mode starts its rule at once */
function setPlayMode(next) {
	if (next === PLAY_LAB) {
		if (game.on) stopGame();
		cancelCareerPlanning();
		saveLastMode(PLAY_LAB);
		updateRuleHelp(PLAY_LAB);
		syncModeRadios();
		return;
	}
	if (!RULES[next]) {
		syncModeRadios();
		return;
	}
	if (next === RULE_ROUTE && periodicMode) {
		linkNote = 'route length unavailable with periodic FFT';
		syncModeRadios();
		refreshGameUi();
		return;
	}
	if (game.on && game.rule === next) {
		updateRuleHelp(next);
		return;
	}
	cancelCareerPlanning();
	saveLastMode(next);
	updateRuleHelp(next);
	startGame(game.on ? game.seed : tradeSim.seed, game.on ? game.fixedRate : false, next);
}

/*
 * Difficulty is the skill of the controllers, not a world parameter. A live run
 * keeps its field, purses, pads and clock: only the next bot decision is planned
 * at the new level, so a switch costs no world rebuild. `off` still restarts,
 * because its level fields no rivals at all (a roster change, not a skill), and
 * in the lab the radio only sets the level of the next run instead of starting
 * one.
 */
function setBot(next) {
	if (replay.on || careerInputLocked() || next === game.bot) return;
	/* a live search is bound to the current roster: a difficulty change
	 * cancels it and restarts the run with the new level */
	if (careerPlanning) {
		cancelCareerPlanning();
		startGame(game.seed, game.fixedRate, game.rule, next, game.player, game.cheat);
		return;
	}
	game.bot = next;
	if (!game.on) {
		syncBotRadios();
		refreshGameUi();
		syncSeedUrl();
		return;
	}
	/* `off` fields no rivals at all, so it is a roster reset, not a skill */
	if (next === BOT_OFF) {
		startGame(game.seed, game.fixedRate, game.rule, next, game.player, game.cheat);
		return;
	}
	if (careerRule()) recordCareerAction('difficulty', { bot: next });
	bot.setLevel(next);
	/* outside a career the level also fields its rival count; the scoreboard's
	 * +/- pins the roster, so a level never overrides a count the player set */
	if (!careerRule() && game.playerCount === 0) {
		const target = bot.spec().count;
		if (activeSlot >= 1 + target) selectSlot(0);
		bot.setRivals(target, game.clockSteps);
		for (let s = 1; s < slotTypes.length; s++) {
			slotTypes[s] = s - 1 < bot.count ? bot.rivalTypes[s - 1] : PLAYER_BOT;
		}
	}
	syncBotRadios();
	refreshGameUi();
	careerRecordingCapture(true);
	syncSeedUrl(replay.on);
}

/* the scoreboard +/- sets how many players share the run; a human-only rule
 * keeps YOU human and the rest are rival careers. 0 means the difficulty
 * level picks the rival count */
function playerCountShown() {
	return game.playerCount > 0 ? game.playerCount : 1 + bot.count;
}

function setPlayerCount(delta, replayPlanet) {
	if (replay.on || careerInputLocked()) return false;
	/* a roster edit is the fix for an unfair roster: apply the delta and
	 * cancel the live search, restarting it with the new count (WS4 guards) */
	if (careerPlanning) {
		const current = playerCountShown();
		const next = Math.max(1, Math.min(MAX_PLAYERS, current + Math.sign(delta)));
		if (next !== current) game.playerCount = next;
		cancelCareerPlanning();
		startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
		return true;
	}
	careerRecordingMark();
	const current = playerCountShown();
	const count = Math.max(1, Math.min(MAX_PLAYERS, current + Math.sign(delta)));
	if (count === current) return false;
	if (delta > 0) {
		const cap = planetUniverseCap();
		if (planetCount >= cap) return false;
		/* A live career must choose the new bot's generated world before enabling
		 * it. The planner keeps existing companies in place and verifies that the
		 * new G=1 HQ has a free, non-heavy, starter-exitable first landing at pay
		 * comparable to the run's original opening band. */
		let home = replayPlanet ?? -1;
		if (careerRule() && replayPlanet === undefined) {
			const expansion = GravityGame.planCareerExpansion(game.galaxy, tradeSim.world, tradeSim,
				planetMask, planetCount, cargoSim);
			if (!expansion) {
				careerNotice('no safe generated HQ is available for another player');
				return false;
			}
			home = expansion.planet;
		}
		if (replayPlanet !== undefined && planetMask[home] !== 0) return false;
		const before = planetMask.slice();
		if (!setPlanetUniverseSize(planetCount + 1, home)) return false;
		let added = -1;
		for (let i = 0; i < cap; i++) {
			if (planetMask[i] && !before[i]) { added = i; break; }
		}
		if (game.on) {
			slotTypes[count - 1] = PLAYER_BOT;
			if (careerRule()) {
				recordCareerAction('playerCount', { delta: 1, planet: added });
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
			commsInvalidate();
			refreshGameUi();
			refreshPlanetUniverseUi();
			careerRecordingCapture(true);
			return true;
		}
	} else if (game.on) {
		if (activeSlotIndex() === current - 1) selectSlot(0);
		if (careerRule()) {
			cancelTurret(slotTurrets[current - 1]);
			recordCareerAction('playerCount', { delta: -1 });
			slotPaused[current - 1] = false;
			bot.removeCareerRival();
		}
		else bot.removeRival();
		game.playerCount = count;
		commsInvalidate();
		syncCareerPause();
		refreshGameUi();
		refreshPlanetUniverseUi();
		careerRecordingCapture(true);
		return true;
	}
	game.playerCount = count;
	if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
	else {
		syncScoreControls();
		refreshPlanetUniverseUi();
	}
}

/* the planet-count input and the player +/- reflect the live state */
function refreshPlanetUniverseUi() {
	const cap = planetUniverseCap();
	if (planetCountInputEl) {
		if (document.activeElement !== planetCountInputEl) {
			planetCountInputEl.value = planetCount;
		}
		planetCountInputEl.min = PLANET_UNIVERSE_MIN;
		planetCountInputEl.max = cap;
		planetCountInputEl.disabled = replay.on || careerActionReplay.active;
	}
	const shown = playerCountShown();
	if (playerCountValueEl) playerCountValueEl.textContent = shown;
	if (playerCountDownEl) playerCountDownEl.disabled = replay.on || careerActionReplay.active || shown <= 1;
	if (playerCountUpEl) playerCountUpEl.disabled = replay.on || careerActionReplay.active || shown >= MAX_PLAYERS ||
		planetCount >= cap;
	syncRosterFairness(shown);
}

/* 0.7.47 WS3: highlight the roster counters when no fair opening can seat the
 * live companies. The composition rule (WS2) is evaluated on the live world
 * and mask; a saved-map boot (fixed seats) or a no-HQ start never highlights,
 * because the roster is not the thing that decides the opening. */
function syncRosterFairness(shown) {
	const unfair = careerRule() && !careerPlanning &&
		game.startMode === GravityGame.START_PLANET &&
		tradeSim.world && planetMask;
	let ok = true;
	if (unfair) {
		const comp = GravityGame.startComposition(tradeSim.world, planetMask, planetCount,
			shown, cargoSim, game.startMode, game.market.empty, game.market.heavy);
		ok = comp.ok;
	}
	const cls = 'rosterUnfair';
	if (playerCountRowEl) playerCountRowEl.classList.toggle(cls, !ok);
	if (planetRowEl) planetRowEl.classList.toggle(cls, !ok);
}

function setSlotType(slot, next) {
	if (replay.on || careerInputLocked() || careerPlanning) return;
	if (slot < 0 || slot >= slotTypes.length) return;
	const normalized = next === PLAYER_BOT ? PLAYER_BOT : PLAYER_USER;
	if (slotTypes[slot] === normalized && (slot !== 0 || game.player === normalized)) return;
	recordCareerAction('controller', { player: normalized }, slot);
	slotTypes[slot] = normalized;
	if (slot === 0) game.player = normalized;
	/* a career keeps its map, purses and pads: a ticked box hands the player
	 * over on the spot instead of wiping the run. The whole page follows the
	 * flip, because the helper buttons and the launch gate read who flies the
	 * active slot, not only which row is selected. */
	if (game.on && careerRule()) {
		applySlotTypeNow(slot);
		refreshGameUi();
		careerRecordingCapture(true);
		return;
	}
	if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, slotTypes[0], game.cheat);
	else syncScoreControls();
}

/* hand one career player over between the keyboard and the bot without a restart */
function applySlotTypeNow(slot) {
	cancelTurret(slotTurrets[slot]);
	setCareerPaused(!slotIsBot(slot) && pauseOnLanding && slotSim(slot).status !== STATUS_FLYING, slot);
	if (slot === 0) {
		bot.setPlayerType(slotTypes[0]);
		playerBotSyncNeeded = true;
		bot.attachCareerPlayer(game.career, cargoSim);
		return;
	}
	const rival = bot.rivals[slot - 1];
	bot.careerDropQueue(rival);
	bot.rivalTypes[slot - 1] = slotTypes[slot];
	if (!slotIsBot(slot) && rival.sim.status !== STATUS_FLYING) syncUserRivalFields();
}

/* one selection for the whole page: the HUD, career panels and pads follow it,
 * and a user slot is flown by hand from wherever the selection sits */
function selectSlot(slot) {
	if (!game.on || (replay.on && !replay.career)) return;
	if (slot < 0 || slot >= slotCount()) return;
	if (replay.on && replay.career) careerRecording.follow = -1;
	if (slot === activeSlot) return;
	if (helperState.active) stopHelper();
	lastAimTrace.origin = -1;
	const prev = activeSlot;
	/* A human player's live trace belongs to that player's turn: the canvas
	 * traces the selected player, never two players at once. The plan and the
	 * armed aim survive in slotPlans/slotAim, so coming back restores the shot
	 * (and re-traces it) instead of leaving a second line behind. */
	if (!slotIsBot(prev)) slotSim(prev).predCount = 0;
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
	clearBurnAim();
	activeSlot = slot;
	turret = slotTurrets[slot];
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

/* ── stop & bot launches ── stopGame, the player-seat bot launch */

/* back to lab: the world stays, the clock returns to real time, a running flight continues */
function stopGame() {
	careerRecordingClear();
	const wasCareer = careerRule();
	cancelCareerWait();
	for (let s = 0; s < slotTurrets.length; s++) cancelTurret(slotTurrets[s]);
	slotPaused.fill(false);
	stopReplay();
	cancelTurret();
	careerPaused = false;
	if (scene.setFrozen) scene.setFrozen(false);
	clearBurnAim();
	linkNote = '';
	game.on = false;
	applyExperiment();
	activeSlot = 0;
	turret = slotTurrets[0];
	predGain = 0;
	if (wasCareer) resetPlayback();
	else refreshPlaybackUi();
	cargoSim.setLaunchNetwork(null, null);
	tradeSim.setEmptyMask(null);
	resetAllRouteBest();
	updateRuleHelp(selectedHelpRule());
	scene.setGameClock(false);
	cargoSim.stepLimit = Infinity;
	cargoSim.limitReason = END_TIME;
	launchState = -1;
	hideCopyText();
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
	if (career.ended !== GravityGame.CAREER_OPEN || slotTurrets[0].pending) return true;
	if (cargoSim.status === STATUS_FLYING) return true;
	const ready = bot.tickCareerPlayer(game.clockSteps, game.market, tradeSim,
		playerBotSyncNeeded);
	playerBotSyncNeeded = false;
	if (!ready) return true;
	const plan = bot.careerPlayerPlan();
	const selected = activeSlotIndex();
	if (selected !== 0) selectSlot(0);
	aimBody = plan.origin;
	aimAngle = plan.angle;
	aimSpeed = plan.speed;
	placeGripFromSpeed();
	dirty = true;
	armed = true;
	queueTurretShot(plan.body);
	if (selected !== 0) selectSlot(selected);
	return true;
}

/* ── step loop ── career world advance, stepCareerGame, stepGame, bot and replay burns */

function advanceCareerWorld() {
	tradeSim.advanceTo(tradeSim.t + DT * scene.trade.speed);
	cargoSim.fieldT = tradeSim.t;
	bot.stepCareer(game.clockSteps, game.market, tradeSim, scene.trade.speed);
	/* the bought fleet flies after the rivals: the company pads are already
	 * advanced by the owner's careerAdvance above (0.7.45) */
	bot.stepFleet(game.clockSteps, game.market, tradeSim, scene.trade.speed);
}

function advanceCareerOneStep() {
	const flying = cargoSim.status === STATUS_FLYING;
	let manualRivals = 0;
	for (let i = 0; i < bot.count; i++) {
		if (!bot.isRivalBot(i) && bot.rivals[i].sim.status === STATUS_FLYING) manualRivals |= 1 << i;
	}
	careerBotBurn();
	game.clockSteps++;
	const moves = flying && cargoSim.liveSteps < cargoSim.stepLimit;
	GravityGame.careerAdvance(game.career, 1, moves);
	if (flying) cargoSim.stepOne();
	if (game.career && game.career.evacuating) {
		const arrived = !GravityGame.advanceEvacuation(game.career, cargoSim, game.clockSteps, tradeSim);
		if (arrived) endGameEvacuation(0);
	}
	if (moves) {
		GravityGame.careerWeatherWear(game.career, cargoSim);
		GravityGame.stepHarvest(game.money, game.market, cargoSim, game.clockSteps);
	}
	const medicSlot = !flying && game.career ? game.career.tasks[GravityGame.MEDIC_SLOT] : null;
	const medicKindBefore = medicSlot ? medicSlot.kind : -1;
	const medicPatientsBefore = medicSlot ? medicSlot.patients : -1;
	advanceCareerWorld();
	if (!flying && game.career && game.career.ended === GravityGame.CAREER_OPEN) {
		let dirtyTasks = medicSlot !== null &&
			(medicSlot.kind !== medicKindBefore || medicSlot.patients !== medicPatientsBefore);
		if (game.clockSteps % 60 === 0) {
			let expired = false;
			for (let i = 0; i < GravityGame.BOARD_SIZE; i++) {
				const task = game.career.tasks[i];
				if (task.kind !== GravityGame.TASK_NONE && game.clockSteps > task.deadline) {
					expired = true;
					break;
				}
			}
			/* a rival's entry (or an event announcing or closing) moves the
			 * shared sport offer behind the rendered board row */
			if (expired || GravityGame.sportMirrorStale(game.career)) {
				GravityGame.refreshBoard(game.career, tradeSim, game.clockSteps);
				dirtyTasks = true;
			}
		}
		if (dirtyTasks) {
			if (careerTaskEl && activeCareer() === game.career) {
				careerTaskEl.innerHTML = taskBlockHtml(game.career);
			}
			updateLiveHud();
		}
	}
	if (flying && cargoSim.status !== STATUS_FLYING) endGameFlight();
	if (manualRivals) {
		for (let i = 0; i < bot.count; i++) {
			if ((manualRivals & (1 << i)) && bot.rivals[i].sim.status !== STATUS_FLYING) endUserRivalFlight(i);
		}
	}
	/* New colonies may join the moving field between flights, not between frames. */
	if (mode === MODE_PORTS && cargoSim.bodyCount !== tradeSim.portCount && !clockDriverFlying() && syncPortRoster()) {
		syncUserRivalFields();
		fieldChanged();
	}
}

/* Frame time only decides how many settled steps to show, never when a ship
 * lands or which trade state the bot sees on a given step. */
function stepCareerGame(dt) {
	applyCareerActionsDue();
	if (careerWaitBusy() || careerPaused) { playAcc = 0; return; }
	tickTurrets();
	playAcc = Math.min(PLAY_MAX * 0.1, playAcc + dt * playScale());
	for (let n = 0; playAcc >= DT && n < MAX_GAME_STEPS; n++) {
		if (!careerWorldOpen() && !clockDriverFlying()) {
			playAcc = 0;
			if (careerActionReplay.active) finishCareerActionsReplay();
			return;
		}
		playAcc -= DT;
		if (slotIsBot(0)) careerPlayerBotLaunch();
		advanceCareerOneStep();
		tickTurrets();
		applyCareerActionsDue();
		if (careerPaused || careerWaitBusy()) { playAcc = 0; return; }
	}
}

/*
 * Playback scales the wall-clock slice fed to the fixed-step physics. Player
 * and rivals step in exact integer DT lockstep against the shared planet
 * market; if a rival is searching its next shot, clockSteps pauses for a few
 * 3 ms slices and resumes from the exact same step.
 */
function stepGame(now, dt) {
	if (replay.on && replay.career) {
		advanceCareerReplay(dt, false);
		return;
	}
	/* WS4: while the opening search is still planning, the run is open but
	 * no career exists yet, so the career clock holds */
	if (careerRule() && !replay.on) {
		if (careerPlanning) return;
		stepCareerGame(dt);
		return;
	}
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
	const capSteps = ruleSpec().capSteps;
	if (!clockDriverFlying()) {
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
	while (clockDriverFlying() && playAcc >= DT && stepsDone < MAX_GAME_STEPS) {
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
	if (wasSlot0Flying || cargoSim.status === STATUS_FLYING) {
		tradeSim.advanceTo(cargoSim.flightFieldT);
	} else {
		for (let i = 0; i < bot.count; i++) {
			const rSim = bot.rivals[i].sim;
			if ((wasUserRivalMask & (1 << i)) || rSim.status === STATUS_FLYING) {
				tradeSim.advanceTo(rSim.flightFieldT);
				break;
			}
		}
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
	if (careerRule() && !replay.on) {
		advanceCareerOneStep();
		return;
	}
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
	if (replay.on && cargoSim.status === STATUS_FLYING) applyReplayBurns();
	game.clockSteps += 1;
	if (careerRule()) GravityGame.careerAdvance(game.career, 1,
		cargoSim.status === STATUS_FLYING && cargoSim.liveSteps < cargoSim.stepLimit);
	if (cargoSim.status === STATUS_FLYING) {
		cargoSim.stepOne();
		if (careerRule()) GravityGame.careerWeatherWear(game.career, cargoSim);
		GravityGame.stepHarvest(game.money, game.market, cargoSim, game.clockSteps);
		if (ruleSpec().stopOnTour && cargoSim.visitedCount === planetCount && game.doneSteps < 0) {
			game.doneSteps = game.steps + cargoSim.visitStep;
		}
	}
	if (careerRule()) bot.stepCareer(game.clockSteps, game.market, tradeSim, scene.trade.speed);
	else bot.stepOne(game.clockSteps, game.market);
}

/* ── flight end ── bot settle, endGameFlight, rival flight end, evacuation */

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
		bot.traceCareerLanding(career, cargoSim, game.clockSteps);
		autoRepairOnLanding();
		if (career.delivered > delivered) careerPhoto('delivery');
		else if (career.competitions > competitions) careerPhoto('sport');
		/* the shop follows the ship again after every landing / stranding */
		careerFollow = true;
		/* default: freeze the world clock at flight end (rivals too) so
		 * the next shot can be aimed in peace; the setting can turn it off */
		if (pauseOnLanding && !replay.on && !careerActionReplay.active && !slotIsBot(0)) setCareerPaused(true, 0);
	} else GravityGame.endFlight(game.money);
	game.steps += cargoSim.liveSteps;
	game.length += cargoSim.flightLength;
	playerBotSyncNeeded = true;
	const settleRivals = !careerRule() && !hasLiveUser() &&
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
	if (pauseAllowed() && pauseOnLanding && !careerActionReplay.active) setCareerPaused(true, rIdx + 1);
	const r = bot.rivals[rIdx];
	if (!careerRule()) settleBotsWhenUsersDone();
	moneyToastFor(rIdx + 1, r.sim, r.ledger, r.shots.length);
	refreshGameUi();
}

function endGameEvacuation(slot) {
	clearBurnAim();
	const career = slot === 0 ? game.career : bot.rivals[slot - 1].career;
	if (!career) return;
	GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
	careerFollow = true;
	if (slot === 0) playerBotSyncNeeded = true;
	if (pauseOnLanding && !replay.on && !careerActionReplay.active && !slotIsBot(slot)) {
		setCareerPaused(true, slot);
	}
	cargoSim.predCount = 0;
	careerNotice('evacuated to HQ ' + planetName(career.hq) + ' · paid ' +
		(career.evacLastPaid || 0).toFixed(2));
	commsInvalidate();
	careerChanged();
}

function signedMoney(value) {
	return (value < 0 ? '−' : '+') + Math.abs(value).toFixed(2);
}
