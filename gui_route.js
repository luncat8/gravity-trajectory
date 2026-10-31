/*
 * Route plan: the per-slot plan rows and their reset, the best-route ui line, and the plan cleared when an aim is stale.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function resetSlotRoutePlan(slot) {
	const plan = slotPlans[slot];
	plan.ready = false;
	plan.length = 0;
	plan.steps = 0;
	plan.visits = 0;
	plan.reason = GravitySim.END_OPEN;
	plan.body = -1;
	plan.origin = -1;
	if (slot === 0) {
		game.length = 0;
		game.steps = 0;
		if (routeRule()) game.shots.length = 0;
	} else if (slot - 1 < bot.count) {
		const r = bot.rivals[slot - 1];
		r.routeReady = false;
		r.routeLength = 0;
		r.routeSteps = 0;
		r.routeVisits = 0;
		r.routeReason = GravitySim.END_OPEN;
		r.routeBody = -1;
		r.routeOrigin = -1;
		r.length = 0;
		r.steps = 0;
		if (routeRule()) r.shots.length = 0;
	}
	refreshRouteLeader();
}

function resetRoutePlan() {
	for (let s = 0; s < slotPlans.length; s++) {
		const plan = slotPlans[s];
		plan.ready = false;
		plan.length = 0;
		plan.steps = 0;
		plan.visits = 0;
		plan.reason = GravitySim.END_OPEN;
		plan.body = -1;
		plan.origin = -1;
	}
	routeLeader = -2;
	routeBotVersion = -1;
	game.length = 0;
	game.steps = 0;
	if (routeRule()) game.shots.length = 0;
}

function refreshRouteBestUi() {
	const shown = routeRule();
	if (cargoFootEl) cargoFootEl.classList.toggle('routeMode', shown);
	routeBestBtn.hidden = !shown;
	const best = activeRouteBest();
	const plan = activeRoutePlan();
	const enabled = shown && best.ready && !playerIsBot() && !replay.on;
	routeBestBtn.disabled = !enabled;
	routeBestBtn.classList.toggle('bestReady', enabled);
	routeBestBtn.classList.toggle('on', enabled &&
		(!plan.ready || best.length > plan.length + 0.5));
	const text = best.ready
		? 'use best · ' + Math.round(best.length) + ' px'
		: 'use best';
	if (text !== hudRouteBestText) {
		hudRouteBestText = text;
		routeBestBtn.textContent = text;
	}
	routeBestBtn.title = best.ready
		? 'restore ' + Math.round(best.length) + ' px from ' + planetName(best.origin)
		: 'the longest finished plan for this planet is saved while you adjust aim';
	helperUpdateUi();
}


/* ── route best sync ── recorded best per slot, restore, the leader line and the plan synced from the sim */
function resetBestSlot(best) {
	best.ready = false;
	best.length = 0;
	best.origin = -1;
	best.angleU = 0;
	best.speedU = 0;
}

function resetRouteBest() {
	resetBestSlot(activeRouteBest());
	refreshRouteBestUi();
}

function resetAllRouteBest() {
	for (let s = 0; s < slotBest.length; s++) {
		resetBestSlot(slotBest[s]);
		slotAim[s].armed = false;
		slotAim[s].body = -1;
		slotAim[s].angle = 0;
		slotAim[s].speed = SPEED_MIN;
	}
	refreshRouteBestUi();
}

function rememberSlotRouteBest(slot, origin, angleU, speedU) {
	if (!routeRule() || slotIsBot(slot) || replay.on) return;
	const plan = slotPlans[slot];
	if (!plan.ready || plan.origin !== origin || origin < 0) return;
	const best = slotBest[slot];
	if (best.ready && best.origin === origin && best.length >= plan.length) return;
	best.ready = true;
	best.length = plan.length;
	best.origin = origin;
	best.angleU = angleU;
	best.speedU = speedU;
}

function rememberRouteBest() {
	if (!aiming && !armed) {
		refreshRouteBestUi();
		return;
	}
	rememberSlotRouteBest(activeSlotIndex(), aimBody,
		GravityGame.angleUnits(aimAngle), GravityGame.speedUnits(aimSpeed));
	refreshRouteBestUi();
}

function restoreRouteBest() {
	const best = activeRouteBest();
	if (!routeRule() || !best.ready || playerIsBot() || replay.on) return;
	if (routeOccupiedBy(best.origin) >= 0) return;
	aimBody = best.origin;
	aimAngle = GravityGame.angleOf(best.angleU);
	aimSpeed = GravityGame.speedOf(best.speedU);
	aiming = false;
	armed = true;
	pressing = false;
	savedArmed = false;
	placeGripFromSpeed();
	dirty = true;
	hudAt = -Infinity;
}

function setSlotRouteShot(slot, origin, angle, speed) {
	const shots = slotShots(slot);
	const angleU = GravityGame.angleUnits(angle);
	const speedU = GravityGame.speedUnits(speed);
	if (shots.length === 0) {
		shots.push(GravityGame.createShot(mode, origin, angleU, speedU, NO_ABORT));
		return;
	}
	const shot = shots[0];
	shot.src = mode;
	shot.origin = origin;
	shot.angle = angleU;
	shot.speed = speedU;
	shot.abort = NO_ABORT;
	shots.length = 1;
}

function syncSlotRouteFromSim(slot, origin) {
	const sim = slotSim(slot);
	const plan = slotPlans[slot];
	plan.origin = origin;
	const finished = !sim.routeActive && sim.predCount >= 2 &&
		(sim.predReason === END_IMPACT || sim.predReason === END_EXIT);
	plan.ready = finished;
	plan.length = finished ? sim.predLength : 0;
	plan.steps = finished ? sim.predSteps : 0;
	plan.visits = finished ? sim.predVisits : 0;
	plan.reason = sim.predReason;
	plan.body = sim.predBody;
	if (slot === 0) {
		game.length = plan.length;
		game.steps = plan.steps;
		return;
	}
	const r = bot.rivals[slot - 1];
	r.routeOrigin = origin;
	r.routeReady = plan.ready;
	r.routeLength = plan.length;
	r.routeSteps = plan.steps;
	r.routeVisits = plan.visits;
	r.routeReason = plan.reason;
	r.routeBody = plan.body;
	r.length = plan.length;
	r.steps = plan.steps;
}

/* A route entry exists while it is being planned; it scores only when the
 * sliced trace has reached a landing or the edge of the map. */
function syncRoutePlan() {
	if (!routeRule()) return;
	if (slotIsBot(0) && !replay.on) {
		const actor = bot.player;
		routePlan.ready = actor.routeReady;
		routePlan.length = actor.routeReady ? actor.routeLength : 0;
		routePlan.steps = actor.routeSteps;
		routePlan.visits = actor.routeVisits;
		routePlan.reason = actor.routeReason;
		routePlan.body = actor.routeBody;
		routePlan.origin = actor.routeOrigin;
		game.length = routePlan.length;
		game.steps = routePlan.steps;
		if (actor.routeReady) {
			setSlotRouteShot(0, actor.routeOrigin,
				GravityGame.angleOf(actor.routeAngleU),
				GravityGame.speedOf(actor.routeSpeedU));
		} else game.shots.length = 0;
	}
	const slot = activeSlotIndex();
	if ((!slotIsBot(slot) || replay.on) && (aiming || armed || replay.on)) {
		if (aimBody >= 0) setSlotRouteShot(slot, aimBody, aimAngle, aimSpeed);
		syncSlotRouteFromSim(slot, aimBody);
	}
	refreshRouteLeader();
	refreshRouteBestUi();
}

function refreshRouteLeader() {
	routeLeader = -2;
	if (!routeRule()) return;
	let best = -1;
	let tie = false;
	if (routePlan.ready) {
		best = routePlan.length;
		routeLeader = -1;
	}
	for (let i = 0; i < bot.count; i++) {
		const actor = bot.rivals[i];
		if (!actor.routeReady) continue;
		if (actor.routeLength > best + 0.5) {
			best = actor.routeLength;
			routeLeader = i;
			tie = false;
		} else if (best >= 0 && Math.abs(actor.routeLength - best) <= 0.5) {
			tie = true;
		}
	}
	if (tie) routeLeader = -2;
}

function syncPlayerBotAim() {
	if (!routeRule() || !slotIsBot(0) || activeSlotIndex() !== 0) return;
	const actor = bot.player;
	if (!actor.routeReady || actor.routeVersion === routeBotVersion) return;
	routeBotVersion = actor.routeVersion;
	aimBody = actor.routeOrigin;
	aimAngle = GravityGame.angleOf(actor.routeAngleU);
	aimSpeed = GravityGame.speedOf(actor.routeSpeedU);
	armed = true;
	aiming = false;
	placeGripFromSpeed();
	dirty = true;
	hudAt = -Infinity;
}

function clearRoutePlan() {
	if (!routeRule() || playerIsBot() || replay.on) return;
	cancelAim();
	activeSim().predCount = 0;
	refreshRouteLeader();
	hudAt = -Infinity;
}
