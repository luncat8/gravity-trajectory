/*
 * Aim input: the grip press, drag and snap, fine trim, the aim label and guidance, sound telemetry and taking over a saved aim.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* launch base is always a static planet core */
function updateAim() {
	const cx = tradeSim.planetX[aimBody];
	const cy = tradeSim.planetY[aimBody];
	const dx = gripX - cx;
	const dy = gripY - cy;
	let len = Math.sqrt(dx * dx + dy * dy);
	if (len > GRIP_MAX) {
		const k = GRIP_MAX / len;
		gripX = cx + dx * k;
		gripY = cy + dy * k;
		len = GRIP_MAX;
	}
	if (len > 0.5) {
		aimAngle = Math.atan2(dy, dx);
		gripLen = len;
	} else {
		gripLen = 0;
	}
	aimCeiling = speedCeiling(aimBody);
	aimSpeed = cargoSim.speedAt(gripLen, aimCeiling);
	snapAim();
	refreshAimLabel();
}

/* game shots live on an integer grid so the link carries the exact launch
 * inputs; the grid point is floored at the pad ceiling so a maximum drag
 * still rounds to a shot the pad can fire */
function snapAim() {
	if (!game.on) return;
	aimAngle = GravityGame.angleOf(GravityGame.angleUnits(aimAngle));
	const maxU = Math.floor(speedCeiling(aimBody) * GravityGame.SPEED_STEPS + 1e-9);
	const units = GravityGame.speedUnits(aimSpeed);
	aimSpeed = GravityGame.speedOf(units < maxU ? units : maxU);
}

function placeGripFromSpeed() {
	const ceiling = speedCeiling(aimBody);
	aimCeiling = ceiling;
	if (aimSpeed > ceiling) aimSpeed = ceiling;
	else if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
	snapAim();
	gripLen = cargoSim.gripLength(aimSpeed, ceiling);
	const cx = tradeSim.planetX[aimBody];
	const cy = tradeSim.planetY[aimBody];
	gripX = cx + Math.cos(aimAngle) * gripLen;
	gripY = cy + Math.sin(aimAngle) * gripLen;
	refreshAimLabel();
}

function beginPress(planet, event, wx, wy) {
	pressing = true;
	pressPlanet = planet;
	pressClientX = event.clientX;
	pressClientY = event.clientY;
	pendGripX = wx;
	pendGripY = wy;
}

function syncSoundLoop() {
	const live = sound.engine() === 'trajectory' || sound.engine() === 'voronoi';
	if (replay.on) sound.setLoop('idle');
	else if (aiming || (live && burnAiming)) sound.setLoop('aim');
	else if ((armed && (!routeRule() || live)) || (live && burnArmed)) sound.setLoop('armed');
	else sound.setLoop('idle');
}

function updateSoundTelemetry() {
	const sim = activeSim();
	const preview = !replay.on && (aiming || armed || burnAiming || burnArmed);
	if (preview && sim.predCount >= 2) {
		const destination = !sim.routeActive && sim.predReason === END_IMPACT ? sim.predBody : -1;
		aimSoundState.sim = sim;
		aimSoundState.ready = true;
		aimSoundState.tracing = sim.routeActive;
		aimSoundState.hasProfit = game.on && !routeRule();
		aimSoundState.profit = careerRule() ? aimEconomics.net + predGain - aimEconomics.gain : predGain;
		aimSoundState.length = sim.predLength;
		aimSoundState.destination = destination;
		/* The aim drone follows the selected launch direction; the flight
		 * sonification derives each planet's bearing from the live trajectory. */
		aimSoundState.aimBody = aimBody;
		aimSoundState.aimAngle = aimAngle;
		aimSoundState.aimSpeed = aimSpeed;
		aimSoundState.aimCeiling = aimCeiling;
		aimSoundState.emcKnown = careerRule() && destination >= 0;
		aimSoundState.emcReady = !aimSoundState.emcKnown || aimEconomics.launchable;
		aimSoundState.emcTier = aimSoundState.emcKnown ? aimEconomics.tier : 0;
		aimSoundState.emcSpeed = aimSoundState.emcKnown ? aimEconomics.speed : 0;
		sound.updateAim(aimSoundState);
	} else sound.updateAim(null);
	sound.updateFlight(soundFlightSim && soundFlightSim.status === STATUS_FLYING && !replay.on ? soundFlightSim : null);
}

function takeOverAim(now) {
	if (!canAimFrom(pressPlanet)) {
		pressing = false;
		showBlocked(pressPlanet, now);
		hudAt = -Infinity;
		return;
	}
	/* re-aiming rewrites the queued shot, so the pending one is cancelled */
	cancelTurret();
	blockedPlanet = -1;
	blockedKind = 0;
	blockedBy = -1;
	const best = activeRouteBest();
	if (routeRule() && best.ready && pressPlanet !== best.origin) resetRouteBest();
	savedArmed = armed;
	savedBody = aimBody;
	savedAngle = aimAngle;
	savedSpeed = aimSpeed;
	aimBody = pressPlanet;
	aiming = true;
	armed = false;
	syncSoundLoop();
	gripX = pendGripX;
	gripY = pendGripY;
	updateAim();
	activeSim().predCount = 0;
	dirty = true;
	hudAt = -Infinity;
}

function restoreSaved() {
	aimBody = savedBody;
	aimAngle = savedAngle;
	aimSpeed = savedSpeed;
	armed = true;
	placeGripFromSpeed();
	dirty = true;
}


/* ── turret, burns & launch ── turret queue, burn aim and grip, executeBurn, launch, fire, record shot, clear cargo */
/* the barrel must line up with the aimed direction before the rail fires */
function cancelTurret() {
	if (!turret.pending) return;
	turret.pending = false;
	GravityGame.releaseEnergy(turret.pad, turret.energy);
	careerNotice('');
	launchState = -1;
	hudAt = -Infinity;
	refreshGameUi();
	refreshCareerWaitUi(game.career, game.career.ended !== GravityGame.CAREER_OPEN);
}

/* the barrel turns with the in-game career clock, so a queued launch fires
 * when the barrel lines up with the aim on world time, not on wall clock,
 * and the aimed shot's energy is reserved from the pad battery at the click */
function queueTurretShot() {
	const period = GravityGame.turretPeriod(game.galaxy, aimBody);
	const seconds = game.clockSteps * DT;
	const gun = GravityGame.turretAngle(game.galaxy, aimBody, seconds);
	let delta = aimAngle - gun;
	delta -= Math.floor(delta / TAU) * TAU;
	const wait = delta < 0.02 ? 0 : delta / TAU * period;
	turret.pending = true;
	turret.body = aimBody;
	turret.angle = aimAngle;
	turret.speed = aimSpeed;
	/* the queued shot claims its energy now: the first to queue gets the
	 * charge, whether it is the pad owner or a guest */
	turret.pad = GravityGame.padAt(game.career, aimBody);
	turret.energy = cargoSim.launchEnergy(aimBody, aimSpeed);
	GravityGame.reserveEnergy(turret.pad, turret.energy);
	turret.fireAt = game.clockSteps + Math.ceil(wait / DT);
	/* the barrel only turns while the world clock runs */
	setCareerPaused(false);
	careerNotice(wait > 0
		? 'EMC turning · ' + wait.toFixed(1) + ' s to ' + planetName(aimBody)
		: 'EMC aligned · ' + planetName(aimBody));
	launchState = -1;
	hudAt = -Infinity;
	refreshGameUi();
	careerWaitBtn.disabled = true;
}

/* the world clock turns the barrel; once it reaches the aligned step the
 * queued shot fires by itself (a paused clock holds the barrel still) */
function tickTurret() {
	if (!turret.pending || game.clockSteps < turret.fireAt) return;
	if (careerRule() && careerPaused) return;
	turret.pending = false;
	aimBody = turret.body;
	aimAngle = turret.angle;
	aimSpeed = turret.speed;
	armed = true;
	careerNotice('');
	fire(NO_ABORT);
}

function cancelAim() {
	const sim = activeSim();
	cancelTurret();
	aiming = false;
	armed = false;
	pressing = false;
	savedArmed = false;
	dirty = false;
	syncSoundLoop();
	if (game.on && routeRule() && !replay.on) resetSlotRoutePlan(activeSlotIndex());
	if (sim.status !== STATUS_FLYING) sim.predCount = 0;
	else dirty = true;
	refreshRouteBestUi();
	hudAt = -Infinity;
}

function canImpulse() {
	return careerRule() && !replay.on && cargoSim.status === STATUS_FLYING &&
		cargoSim.burnLimit() > 0;
}

function clearBurnAim() {
	burnPaused = false;
	burnAiming = false;
	burnArmed = false;
	burnPressing = false;
	savedBurnArmed = false;
}

function setBurnPaused(next) {
	if (next) {
		if (!canImpulse()) return false;
		burnPaused = true;
		playAcc = 0;
		dirty = true;
		launchState = -1;
		hudAt = -Infinity;
		return true;
	}
	clearBurnAim();
	playAcc = 0;
	dirty = true;
	refreshAimLabel();
	launchState = -1;
	hudAt = -Infinity;
	return true;
}

function snapBurnAim() {
	burnAngle = GravityGame.angleOf(GravityGame.angleUnits(burnAngle));
	const maxU = Math.floor(burnCeiling * GravityGame.SPEED_STEPS + 1e-9);
	const units = GravityGame.speedUnits(burnDv);
	burnDv = GravityGame.speedOf(units < maxU ? units : maxU);
}

function updateBurnAim() {
	const cx = cargoSim.cargo.x;
	const cy = cargoSim.cargo.y;
	const dx = gripX - cx;
	const dy = gripY - cy;
	let len = Math.sqrt(dx * dx + dy * dy);
	if (len > GRIP_MAX) {
		const k = GRIP_MAX / len;
		gripX = cx + dx * k;
		gripY = cy + dy * k;
		len = GRIP_MAX;
	}
	if (len > 0.25) {
		burnAngle = Math.atan2(dy, dx);
		gripLen = len;
	} else {
		gripLen = 0;
	}
	burnCeiling = cargoSim.burnLimit();
	burnDv = cargoSim.speedAt(gripLen, burnCeiling, 0);
	snapBurnAim();
	refreshAimLabel();
}

function placeBurnGrip() {
	burnCeiling = cargoSim.burnLimit();
	if (burnDv > burnCeiling) burnDv = burnCeiling;
	else if (burnDv < 0) burnDv = 0;
	snapBurnAim();
	gripLen = cargoSim.gripLength(burnDv, burnCeiling, 0);
	gripX = cargoSim.cargo.x + Math.cos(burnAngle) * gripLen;
	gripY = cargoSim.cargo.y + Math.sin(burnAngle) * gripLen;
	refreshAimLabel();
}

function takeOverBurnAim() {
	if (!canImpulse()) {
		burnPressing = false;
		return;
	}
	if (!burnPaused) setBurnPaused(true);
	savedBurnArmed = burnArmed;
	savedBurnAngle = burnAngle;
	savedBurnDv = burnDv;
	burnAiming = true;
	burnArmed = false;
	gripX = pendGripX;
	gripY = pendGripY;
	updateBurnAim();
	dirty = true;
	launchState = -1;
	hudAt = -Infinity;
}

function executeBurn() {
	if (!canImpulse() || !burnArmed || !(burnDv > 0)) return false;
	const angleU = GravityGame.angleUnits(burnAngle);
	const dvU = GravityGame.speedUnits(burnDv);
	if (dvU < 1) return false;
	const angle = GravityGame.angleOf(angleU);
	const dv = GravityGame.speedOf(dvU);
	const step = cargoSim.liveSteps;
	const ship = game.career.ship;
	const beforeFuel = ship.fuelKg;
	if (!GravityGame.careerBurn(game.career, cargoSim, angle, dv)) return false;
	const used = beforeFuel - ship.fuelKg;
	if (game.shots.length > 0) {
		game.shots[game.shots.length - 1].burns.push(GravityGame.createBurn(step, angleU, dvU));
	}
	clearBurnAim();
	playAcc = 0;
	dirty = true;
	launchState = -1;
	const remDv = OrbitTech.impulseDeltaV(ship.fuelKg, ship.engine, ship.mass, ship.fuelKg);
	careerNotice('burned Δv ' + dv.toFixed(1) + ' px/s (−' + used.toFixed(1) + ' kg) · fuel ' +
		ship.fuelKg.toFixed(1) + ' kg' +
		(remDv > 0.05 ? ' · Δv ' + remDv.toFixed(1) + ' px/s left' : ' · tank empty'));
	refreshGameUi();
	return true;
}

function launchShot() {
	if (canImpulse()) {
		if (!burnPaused) setBurnPaused(true);
		else if (burnArmed) executeBurn();
		else setBurnPaused(false);
		return;
	}
	if (routeRule() && game.on) return;
	if (turret.pending) {
		cancelTurret();
		careerNotice('launch cancelled');
		return;
	}
	if (!armed || !canAimFrom(aimBody) || gameLocked()) return;
	if (!activeSim().canFire(aimBody, aimSpeed)) return;
	if (careerRule() && !GravityGame.careerCanFire(game.career, cargoSim, aimBody, aimSpeed)) return;
	/* in career the click queues the shot: the barrel winds to the aim */
	if (careerRule() && !replay.on) {
		queueTurretShot();
		return;
	}
	if (careerRule()) setCareerPaused(false);
	fire(NO_ABORT);
}

function fire(abortStep) {
	if (game.on && routeRule()) return;
	clearBurnAim();
	const slot = activeSlotIndex();
	const sim = slotSim(slot);
	if (game.on) recordSlotShot(slot, abortStep);
	predictShot();
	dirty = false;
	sim.launch(aimBody, aimAngle, aimSpeed);
	if (!replay.on && (!game.on || !slotIsBot(slot))) {
		sound.launch();
		soundFlightSim = sim;
	}
	if (game.on) {
		if (careerRule()) {
			GravityGame.careerBeginFlight(game.career, sim);
			careerPhoto('catapult');
		} else GravityGame.beginFlight(slotLedger(slot), sim);
		if (slot > 0) bot.rivals[slot - 1].basePlanet = aimBody;
	}
	aiming = false;
	armed = false;
	pressing = false;
	savedArmed = false;
	blockedPlanet = -1;
	hudAt = -Infinity;
	if (game.on) refreshGameUi();
}

/* the launch state must not depend on frame timing, so roster and clock are re-read here */
function recordSlotShot(slot, abortStep) {
	const sim = slotSim(slot);
	if (mode === MODE_PORTS) {
		syncPortRoster();
		syncUserRivalFields();
	} else if (slot > 0) {
		syncUserRivalFields();
	}
	sim.fieldT = tradeSim.t;
	sim.fieldRate = scene.trade.speed;
	sim.stepLimit = abortStep === NO_ABORT ? ruleSpec().capSteps : abortStep;
	sim.limitReason = abortStep === NO_ABORT ? END_TIME : END_ABORT;
	slotShots(slot).push(GravityGame.createShot(mode, aimBody,
		GravityGame.angleUnits(aimAngle), GravityGame.speedUnits(aimSpeed), abortStep));
}

function clearCargo() {
	sound.reset();
	soundFlightSim = null;
	photoSpace.fill(0);
	photoLanded.fill(0);
	photoCareer.fill(0);
	if (root.PhotoDeck) root.PhotoDeck.hide();
	playAcc = 0;
	cargoSim.clear();
	clearBurnAim();
	aiming = false;
	armed = false;
	pressing = false;
	savedArmed = false;
	blockedPlanet = -1;
	blockedUntil = -Infinity;
	dirty = false;
	if (helperState.active) stopHelper();
	hudAt = -Infinity;
}

/* gravity source: static planets or their moving ports */
function setSource(next) {
	if (next === mode && cargoSim.fillField) return;
	mode = next;
	srcPlanetsEl.checked = mode === MODE_PLANETS;
	srcPortsEl.checked = mode === MODE_PORTS;
	if (game.on && routeRule() && !replay.on) {
		/* every route plan is traced in one field; changing it restarts the contest */
		startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
		return;
	}
	cancelAim();
	hoverBody = -1;
	refreshHoverLabel();
	setSelected(-1);
	applyMode();
	if (activeSim().status === STATUS_FLYING) dirty = true;
	hudAt = -Infinity;
	syncSeedUrl(replay.on);
}


/* ── field input ── HUD pad press, pointer down/move/up, trim input, reset, harvest masks */

function hudPadPress(event) {
	const node = event.target;
	if (!node || node === tradeCanvas) return false;
	const inCargo = Boolean(cargoHudEl && typeof cargoHudEl.contains === 'function' && cargoHudEl.contains(node));
	const inLeft = Boolean(leftHudEl && typeof leftHudEl.contains === 'function' && leftHudEl.contains(node));
	const inFoot = Boolean(cargoFootEl && typeof cargoFootEl.contains === 'function' && cargoFootEl.contains(node));
	if (!inCargo && !inLeft && !inFoot) return false;
	if (node.closest && node.closest('button, input, select, label, textarea, summary, .scoreEntry')) return false;
	const wx = worldX(event.clientX);
	const wy = worldY(event.clientY);
	if (canImpulse() && shipAt(wx, wy)) return true;
	const planet = planetAt(wx, wy);
	return planet >= 0 && canAimFrom(planet);
}

function onPointerDown(event) {
	sound.unlock();
	if (event.button !== 0 || (event.target !== tradeCanvas && !hudPadPress(event))) return;
	const wx = worldX(event.clientX);
	const wy = worldY(event.clientY);
	if (canImpulse() && shipAt(wx, wy)) {
		lastWX = wx;
		lastWY = wy;
		burnPressing = true;
		pressClientX = event.clientX;
		pressClientY = event.clientY;
		pendGripX = wx;
		pendGripY = wy;
		if (!burnPaused) setBurnPaused(true);
		return;
	}
	const planet = planetAt(wx, wy);
	const body = bodyAt(wx, wy);
	if (planet < 0 && body < 0) {
		if (!aiming && !pressing && !burnAiming && !burnPressing && selected >= 0) {
			setSelected(-1);
			helperUpdateUi();
		}
		return;
	}
	lastWX = wx;
	lastWY = wy;
	if (body >= 0) {
		setSelected(body);
	} else if (mode === MODE_PORTS && tradeSim.planetPort[planet] !== NO_PORT) {
		setSelected(tradeSim.planetPort[planet]);
	}
	const basePlanet = planet >= 0 ? planet : fieldPortPlanet[body];
	if (basePlanet >= 0 && routeRule() && routeOccupiedBy(basePlanet) >= 0) {
		showBlocked(basePlanet, performance.now());
		hudAt = -Infinity;
		return;
	}
	if (basePlanet >= 0 && !gameLocked()) {
		if (!canAimFrom(basePlanet)) showBlocked(basePlanet, performance.now());
		beginPress(basePlanet, event, wx, wy);
	}
}

function onPointerMove(event) {
	const wx = worldX(event.clientX);
	const wy = worldY(event.clientY);
	fine = event.shiftKey;
	if (burnAiming) {
		const prevAngle = burnAngle;
		const prevDv = burnDv;
		const dx = wx - lastWX;
		const dy = wy - lastWY;
		const sens = fine ? SENS_FINE : 1;
		gripX += dx * sens;
		gripY += dy * sens;
		updateBurnAim();
		if (burnAngle !== prevAngle || burnDv !== prevDv || activeSim().predCount < 2) {
			dirty = true;
		}
	} else if (burnPressing) {
		const dx = wx - lastWX;
		const dy = wy - lastWY;
		const sens = fine ? SENS_FINE : 1;
		pendGripX += dx * sens;
		pendGripY += dy * sens;
		const movedX = event.clientX - pressClientX;
		const movedY = event.clientY - pressClientY;
		if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
			takeOverBurnAim();
		}
	} else if (aiming) {
		const prevAngle = aimAngle;
		const prevSpeed = aimSpeed;
		const dx = wx - lastWX;
		const dy = wy - lastWY;
		const sens = fine ? SENS_FINE : 1;
		gripX += dx * sens;
		gripY += dy * sens;
		updateAim();
		const sim = activeSim();
		if (aimAngle !== prevAngle || aimSpeed !== prevSpeed ||
			(sim.predCount < 2 && !sim.routeActive)) {
			dirty = true;
		}
	} else if (pressing) {
		const dx = wx - lastWX;
		const dy = wy - lastWY;
		const sens = fine ? SENS_FINE : 1;
		pendGripX += dx * sens;
		pendGripY += dy * sens;
		const movedX = event.clientX - pressClientX;
		const movedY = event.clientY - pressClientY;
		if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
			takeOverAim(performance.now());
		}
	} else {
		const onCanvas = event.target === tradeCanvas;
		const body = onCanvas ? bodyAt(wx, wy) : -1;
		const planet = onCanvas ? planetAt(wx, wy) : -1;
		if (body !== hoverBody) {
			hoverBody = body;
			refreshHoverLabel();
		}
		hoverPlanet = planet;
	}
	lastWX = wx;
	lastWY = wy;
}

function onPointerUp(event) {
	fine = event.shiftKey;
	if (burnPressing && !burnAiming) {
		burnPressing = false;
		return;
	}
	if (burnAiming) {
		burnAiming = false;
		burnPressing = false;
		if (gripLen > 6 / view.scale && burnDv >= GravityGame.speedOf(1)) {
			burnArmed = true;
		} else if (savedBurnArmed) {
			burnAngle = savedBurnAngle;
			burnDv = savedBurnDv;
			burnArmed = true;
			placeBurnGrip();
		} else {
			burnArmed = false;
		}
		savedBurnArmed = false;
		dirty = true;
		refreshAimLabel();
		launchState = -1;
		hudAt = -Infinity;
		return;
	}
	if (pressing && !aiming) {
		pressing = false;
		return;
	}
	if (!aiming) return;
	aiming = false;
	pressing = false;
	const sim = activeSim();
	const reach = tradeSim.planetR[aimBody] + 6 / view.scale;
	if (gripLen > reach && aimSpeed > SPEED_MIN + 4) {
		armed = true;
		if (sim.predCount < 2 && !sim.routeActive) dirty = true;
		else {
			syncRoutePlan();
			rememberRouteBest();
		}
	} else if (savedArmed) {
		restoreSaved();
	} else {
		armed = false;
		dirty = false;
		if (sim.status !== STATUS_FLYING) sim.predCount = 0;
		else dirty = true;
		if (routeRule() && !replay.on) resetSlotRoutePlan(activeSlotIndex());
	}
	savedArmed = false;
	syncSoundLoop();
	refreshAimLabel();
	hudAt = -Infinity;
}

function onTrimInput() {
	const value = Number(trimSlider.value);
	const delta = value - trimLast;
	trimLast = value;
	if (delta === 0) return;
	/* a trim rewrites the queued shot's speed, so the pending one is cancelled */
	cancelTurret();
	const factor = 1 + delta / 100;
	if (burnArmed && canImpulse()) {
		const ceiling = cargoSim.burnLimit();
		const minDv = GravityGame.speedOf(1);
		burnDv = burnDv * factor;
		if (burnDv < minDv) burnDv = minDv;
		else if (burnDv > ceiling) burnDv = ceiling;
		placeBurnGrip();
		dirty = true;
		launchState = -1;
	} else if (armed) {
		const ceiling = speedCeiling(aimBody);
		aimSpeed = aimSpeed * factor;
		if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
		else if (aimSpeed > ceiling) aimSpeed = ceiling;
		placeGripFromSpeed();
		dirty = true;
	} else if (selected >= 0 && !game.on) {
		setBodyStrength(selected, cargoSim.strength[selected] * factor);
		refreshSelected();
		refreshHoverLabel();
		fieldChanged();
	}
	trimLabel.textContent = (value > 0 ? '+' : '') + value.toFixed(1) + '%';
	hudAt = -Infinity;
}

function resetTrim() {
	trimSlider.value = '0';
	trimLast = 0;
	trimLabel.textContent = '0%';
}

function updateHarvestMasks() {
	const sim = activeSim();
	const activePred = aiming || armed || sim.status === STATUS_FLYING;
	predHarvestMask.fill(0);
	if (activePred) {
		for (let k = 0; k < sim.predLogCount; k++) {
			predHarvestMask[sim.predLogPlanet[k]] = 1;
		}
	}
	liveHarvestMask.fill(0);
	if (game.on && sim.status === STATUS_FLYING) {
		const inside = slotLedger(activeSlotIndex()).inside;
		for (let i = 0; i < PLANETS; i++) {
			if (planetMask[i] && inside[i]) liveHarvestMask[i] = 1;
		}
	}
}
