/*
 * The frame itself: HUD paint throttle, syncField, the requestAnimationFrame loop, fps pacing and the per-frame budget.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function updateHud(now) {
	if (now - hudAt < HUD_INTERVAL) return;
	hudAt = now;
	const sim = activeSim();
	expClockEl.textContent = game.on
		? formatClock('game', game.clockSteps * DT)
		: formatClock('exp', (now - expStart) / 1000);
	statusEl.textContent = statusText();
	if (game.on) updateGameHud();

	if (sim.status === STATUS_IDLE) {
		flightEl.textContent = '—';
	} else {
		flightEl.textContent = sim.flightTime.toFixed(2) + ' s · ' +
			Math.round(sim.flightLength) + ' px';
	}

	calcEl.textContent = sim.predCount >= 2
		? sim.predSteps + ' steps · ' + sim.predMs.toFixed(2) + ' ms'
		: '—';

	if (burnArmed) trimTargetEl.textContent = 'burn Δv';
	else if (armed) trimTargetEl.textContent = 'aim speed';
	else if (selected >= 0) trimTargetEl.textContent = bodyName(selected) + ' g';
	else trimTargetEl.textContent = '—';
}

/* field clock and geometry follow the trade world; a game flight keeps its launch roster */
function syncField() {
	cargoSim.fieldT = tradeSim.t;
	const rate = game.on ? scene.trade.speed : tradeRate();
	if (rate !== cargoSim.fieldRate) {
		cargoSim.fieldRate = rate;
		cargoSim.stepStale = true;
		if (!cargoSim.fieldStatic) fieldChanged();
		if (careerRule()) refreshCareerPanel();
	}
	const rosterLocked = game.on && clockDriverFlying();
	if (mode === MODE_PORTS && !rosterLocked && syncPortRoster()) fieldChanged();
	if (!cargoSim.fieldStatic) cargoSim.refreshField();
	if (game.on) {
		for (let i = 0; i < bot.count; i++) {
			if (bot.isRivalBot(i)) continue;
			const rSim = bot.rivals[i].sim;
			rSim.fieldT = tradeSim.t;
			if (rate !== rSim.fieldRate) {
				rSim.fieldRate = rate;
				rSim.stepStale = true;
			}
			if (!rSim.fieldStatic) rSim.refreshField();
		}
	}
}

function frame(now) {
	const frameStart = performance.now();
	const rawMs = now - lastFrame;
	if (rawMs > 0 && rawMs < 120) {
		emaFrameMs = emaFrameMs * 0.8 + rawMs * 0.2;
	}
	const dt = Math.min(0.1, rawMs / 1000);
	lastFrame = now;

	if (careerWaitBusy()) careerWaitTick(now);
	if (game.on) stepGame(now, dt);
	if (helperState.active) helperTick(HELPER_BUDGET_MS);
	syncField();
	if (!game.on) cargoSim.step(dt * playScale());
	if (soundFlightSim && soundFlightSim.status !== STATUS_FLYING) {
		sound.stopFlight();
		soundFlightSim = null;
	}
	syncSoundLoop();
	photoTick();

	/* adaptive 60 fps budget: update every frame at 60 fps, throttle if slower */
	const interval = emaFrameMs <= FPS_DROP_MS ? 1 : emaFrameMs < 25 ? 2 : 4;
	lastAutoInterval = interval;
	const budgetMs = emaFrameMs <= FPS_DROP_MS
		? GravitySim.BUDGET_MS
		: Math.max(2, FPS_FRAME_MS - otherWorkMs - 1.5);
	autoSkip = autoSkip > 0 ? autoSkip - 1 : 0;

	const sim = activeSim();
	const bodiesMoved = !sim.fieldStatic && sim.fieldT !== sim.predFieldT;
	if (armed || aiming) {
		if (!dirty && autoSkip === 0 && aimTraceStale(bodiesMoved)) {
			dirty = true;
			autoSkip = interval - 1;
		}
		if (dirty) {
			startAimTrace(budgetMs);
			refreshAimLabel();
			dirty = false;
		} else if (sim.routeActive) {
			sim.routeStep(ROUTE_STEP_MS);
			refreshPredGain();
			syncRoutePlan();
			rememberRouteBest();
			refreshAimLabel();
		} else if (armed && careerRule()) {
			recordArmedTrace();
		}
	} else if (sim.status === STATUS_FLYING) {
		if (burnAiming || burnArmed) {
			if (dirty) {
				sim.predictBurn(burnAngle, burnDv, budgetMs);
				refreshPredGain();
				refreshAimLabel();
				dirty = false;
			}
		} else if (dirty || (autoSkip === 0 && !burnPaused)) {
			sim.predictFlight(budgetMs);
			refreshPredGain();
			dirty = false;
			autoSkip = interval - 1;
		}
	} else if (sim.predCount > 0) {
		sim.predCount = 0;
		predGain = 0;
	}
	updateSoundTelemetry();
	refreshLaunchList(false);

	const renderStart = performance.now();
	draw(now);
	updateLiveHud();
	updateHud(now);
	otherWorkMs = otherWorkMs * 0.8 + (performance.now() - renderStart) * 0.2;
	const frameWork = performance.now() - frameStart;
	if (frameWork > FPS_FRAME_MS) {
		emaFrameMs = Math.max(emaFrameMs, frameWork);
	}
	requestAnimationFrame(frame);
}

/* the flat mode row replaces the old mode + rule groups */


/* ── bot target, fold & sound settings ── bot control target, panel fold, sound engine and preference toggles */
function isBotControlTarget(slot, target) {
	if (!target) return false;
	const box = scoreBotEls[slot];
	const lbl = scoreBotLabelEls[slot];
	if (target === box || target === lbl) return true;
	return Boolean(box && box.parentElement && target === box.parentElement);
}

/* the number input sets the run's planet count; +/- in the scoreboard set
 * how many players share it. Both restart the run so the world rebuilds */
function bindFold(btn, panel) {
	if (!btn || !panel) return;
	btn.addEventListener('click', () => {
		const folded = !panel.classList.contains('folded');
		panel.classList.toggle('folded', folded);
		if (panel === cargoHudEl) hudFolded = folded;
		btn.textContent = folded ? '+' : '−';
		btn.title = folded ? 'expand panel' : 'minimize panel';
		if (btn.setAttribute) btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
		measureHudRects();
	});
}
function refreshSoundToggle() {
	if (!soundToggle) return;
	soundToggle.textContent = soundEnabled ? 'sound on' : 'sound off';
	soundToggle.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
}
const SOUND_ENGINE_LABELS = { voronoi: 'voronoi', trajectory: 'trajectory synth', samples: 'selected samples', fallback: 'classic synths' };
const SOUND_AIM_HINTS = {
	outcome: 'Profit chord · length ticks · destination EMC beacon. While aiming: a quiet left/right direction cue; pitch and volume follow pull strength.',
	flythrough: 'Hear predicted visits in order, with each planet panned by its bearing from the local path heading; the phrase opens on launch and closes on arrival.'
};
const SOUND_FLIGHT_HINTS = {
	pentatonic: 'Flight: nearest planet pentatonic · nearer is louder · left/right is relative to the ship’s current heading.',
	instrument: 'Flight: nearest-planet timbre · farther is higher and quieter · left/right is relative to the ship’s current heading.'
};
function saveSoundPreference(key, value) {
	try { root.localStorage.setItem(key, value); }
	catch (err) { /* Sound still works without persistent preferences. */ }
}
function refreshSoundSettings() {
	const engine = sound.engine();
	if (soundEngineEl) soundEngineEl.value = engine;
	if (soundAimEl) soundAimEl.value = sound.aimMode();
	if (soundFlightEl) soundFlightEl.value = sound.flightMode();
	if (soundVoronoiPresetEl) soundVoronoiPresetEl.value = sound.voronoiPreset();
	if (soundVoronoiPresetControlEl) soundVoronoiPresetControlEl.hidden = engine !== 'voronoi';
	if (soundDistanceEl) soundDistanceEl.value = String(sound.distanceScale());
	if (soundDistanceLabelEl) soundDistanceLabelEl.textContent = '×' + sound.distanceScale().toFixed(2);
	if (soundDistanceControlEl) soundDistanceControlEl.hidden = engine !== 'voronoi';
	if (soundVolumeEl) soundVolumeEl.value = String(Math.round(sound.volume() * 100));
	if (soundVolumeLabelEl) soundVolumeLabelEl.textContent = Math.round(sound.volume() * 100) + '%';
	if (soundSettingsTagEl) soundSettingsTagEl.textContent = SOUND_ENGINE_LABELS[engine];
	if (trajectorySoundOptionsEl) trajectorySoundOptionsEl.hidden = engine !== 'trajectory' && engine !== 'voronoi';
	const flightControl = $('soundFlightControl');
	if (flightControl) flightControl.hidden = engine !== 'trajectory';
	if (!soundHintEl) return;
	soundHintEl.textContent = engine === 'voronoi'
		? SOUND_AIM_HINTS[sound.aimMode()] + (sound.voronoiPreset() === 'point'
			? ' Flight: each planet has its own note; nearer is louder · stereo follows ship-relative bearing.'
			: ' Flight: nearer planets are higher and louder · stereo follows ship-relative bearing.')
		: engine === 'trajectory'
		? SOUND_AIM_HINTS[sound.aimMode()] + ' ' + SOUND_FLIGHT_HINTS[sound.flightMode()]
		: engine === 'samples' ? 'Selected local WAVs; missing or unplayable cues use the classic synths.'
			: 'Fixed procedural launch cues, without samples or trajectory telemetry.';
}
