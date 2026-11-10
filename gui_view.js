/*
 * Canvas view state and projection: space/field/potential view mode, overlay resize, HUD rects and hit tests, world<->screen coords, slot accessors, playback and the photo deck tick.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function refreshViewUi() {
	const frame = scene.view.frame;
	if (viewZoomMainEl) viewZoomMainEl.checked = frame === FRAME_MAIN;
	if (viewZoomFullEl) viewZoomFullEl.checked = frame === FRAME_FULL;
	if (viewSpaceEl) viewSpaceEl.checked = viewMode === VIEW_SPACE;
	if (viewFieldEl) viewFieldEl.checked = viewMode === VIEW_FIELD;
	if (viewPotentialEl) viewPotentialEl.checked = viewMode === VIEW_POTENTIAL;
	if (potentialLegendEl) potentialLegendEl.hidden = viewMode !== VIEW_POTENTIAL;
	if (careerCleanLabelEl) careerCleanLabelEl.hidden = !careerRule();
	if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
	if (!viewTagEl) return;
	if (viewMode === VIEW_SPACE || !fieldRenderer) {
		const lost = fieldRenderer !== null && fieldRenderer.backend() === 'lost';
		viewTagEl.textContent = lost ? 'space · field lost' : 'space';
		viewTagEl.title = lost
			? 'gravity field paused: the WebGL context was lost · f retries once it restores'
			: 'starfield backdrop and gravity well rings';
		return;
	}
	const gl = fieldRenderer.backend() === 'webgl';
	const div = fieldRenderer.scaleDiv();
	const backend = gl ? 'WebGL' + (div > 1 ? ' 1/' + div : '') : '1/' + div;
	const how = gl ? 'WebGL shader' : '1/' + div + ' 2D raster';
	if (viewMode === VIEW_POTENTIAL) {
		viewTagEl.textContent = 'potential · ' + backend;
		viewTagEl.title = 'gravity zones, no direction: blue repels (g < 0), clear near 0, green pulls, red heavy (g ≥ +2) · ' + how;
		return;
	}
	viewTagEl.textContent = 'hue · grad · ' + backend;
	viewTagEl.title = 'hue = pull direction · lightness = potential gradient · ' + how;
}

/* the legend bar is the zone palette itself over the seeded planet gravity range and
 * its ticks position from the same range, so the key cannot drift from the map */
function paintZoneLegend() {
	if (!zoneBarEl || !potentialLegendEl || !root.GravityField) return;
	const lo = GravityGame.PLANET_GRAVITY_MIN;
	const hi = GravityGame.PLANET_GRAVITY_MAX;
	zoneBarEl.style.backgroundImage = GravityField.legendGradient(lo, hi);
	potentialLegendEl.style.setProperty('--lo', lo);
	potentialLegendEl.style.setProperty('--hi', hi);
}

/* a lost WebGL context falls back to the starfield until `webglcontextrestored`
 * rebuilds the shader and automatically restores the requested view */
function activeFieldView() {
	return viewDesired !== VIEW_SPACE &&
		(!fieldRenderer || fieldRenderer.backend() !== 'lost');
}

function syncViewState() {
	viewMode = activeFieldView() ? viewDesired : VIEW_SPACE;
	if (fieldRenderer) fieldRenderer.setMode(viewMode);
	if (fieldCanvas) fieldCanvas.hidden = viewMode === VIEW_SPACE;
	if (scene.setBackdrop) scene.setBackdrop(viewMode === VIEW_SPACE);
	if (viewMode !== VIEW_SPACE && fieldRenderer) fieldRenderer.invalidate();
	refreshViewUi();
	hudAt = -Infinity;
}

function fieldLost() {
	syncViewState();
}

function setViewMode(next) {
	viewDesired = VIEW_MODES.includes(next) ? next : VIEW_SPACE;
	syncViewState();
}

function nextViewMode() {
	return VIEW_MODES[(VIEW_MODES.indexOf(viewMode) + 1) % VIEW_MODES.length];
}

/* the zoom switch: `main` frames the planet field, `full` zooms out to the
 * whole flight area, where a ship that left the canvas is still visible */
function setViewFrame(next) {
	if (!scene.setFrame(next)) return false;
	if (fieldRenderer) fieldRenderer.invalidate();
	refreshViewUi();
	hudAt = -Infinity;
	return true;
}

function toggleViewFrame() {
	return setViewFrame(scene.view.frame === FRAME_FULL ? FRAME_MAIN : FRAME_FULL);
}

function resizeOverlay() {
	const width = window.innerWidth;
	const height = window.innerHeight;
	const dpr = view.dpr;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	canvas.style.width = width + 'px';
	canvas.style.height = height + 'px';
	if (fieldCanvas) {
		fieldCanvas.style.width = width + 'px';
		fieldCanvas.style.height = height + 'px';
	}
	if (fieldRenderer) fieldRenderer.invalidate();
	reserveGameFooter();
	measureHudRects();
}

/* panel rects for the world plates (3 panels × 4 numbers): refreshed on resize and
 * whenever the HUD content changes, never per frame */
const hudRects = new Float64Array(12);
const hudRectEls = [$('cargoHud'), $('leftHud'), $('flightHud')];

function measureHudRects() {
	for (let i = 0; i < hudRectEls.length; i++) {
		const el = hudRectEls[i];
		const r = el && !el.hidden ? el.getBoundingClientRect() : null;
		const o = i * 4;
		hudRects[o] = r ? r.left : 0;
		hudRects[o + 1] = r ? r.top : 0;
		hudRects[o + 2] = r ? r.right : 0;
		hudRects[o + 3] = r ? r.bottom : 0;
	}
}

/* does a screen rect cross one of the panels? */
function rectUnderHud(x, y, width, height) {
	for (let i = 0; i < hudRectEls.length; i++) {
		const o = i * 4;
		const right = hudRects[o + 2];
		const bottom = hudRects[o + 3];
		if (right <= hudRects[o] || bottom <= hudRects[o + 1]) continue;
		if (x >= right || x + width <= hudRects[o]) continue;
		if (y >= bottom || y + height <= hudRects[o + 1]) continue;
		return true;
	}
	return false;
}

/* the wrapped game footer grows; both HUD columns stop above it, and the
 * right cargo HUD also stops above the separate bottom launch/helpers panel */
function reserveGameFooter() {
	if (!cargoHudEl) return;
	const vv = root.visualViewport;
	const vh = vv && vv.height > 0 ? vv.height : window.innerHeight;
	if (!(vh > 0)) return;
	const hudRect = cargoHudEl.getBoundingClientRect();
	const hudTop = hudRect.top > 0 && hudRect.top < vh * 0.5 ? hudRect.top : 14;
	const footerEl = $('gameControls');
	const rect = footerEl ? footerEl.getBoundingClientRect() : null;
	let bottomY = vh - 10;
	if (rect && rect.height > 0 && rect.height < vh * 0.5) {
		bottomY = Math.min(bottomY, rect.top - 10);
	}
	const leftMaxH = Math.max(180, Math.floor(bottomY - hudTop)) + 'px';
	const reserve = Math.ceil(vh - bottomY) + 'px';
	cargoHudEl.style.setProperty('--footReserve', reserve);
	if (flightHudEl && flightHudEl.style) {
		flightHudEl.style.setProperty('--footReserve', reserve);
	}
	if (leftHudEl && leftHudEl.style) {
		leftHudEl.style.setProperty('--footReserve', reserve);
		leftHudEl.style.setProperty('--hudMaxH', leftMaxH);
	}
	/* the postcard and #flightHud sit just above the bar, taller in career (wait line) */
	const rootEl = root.document && root.document.documentElement;
	if (rootEl && rootEl.style) rootEl.style.setProperty('--footReserve', reserve);
	let cargoBottomY = bottomY;
	const footRect = flightHudEl ? flightHudEl.getBoundingClientRect() : null;
	if (footRect && footRect.height > 0 && footRect.height < vh * 0.6) {
		cargoBottomY = Math.min(cargoBottomY, footRect.top - 8);
	}
	const cargoMaxH = Math.max(140, Math.floor(cargoBottomY - hudTop)) + 'px';
	cargoHudEl.style.setProperty('--hudMaxH', cargoMaxH);
}

function worldX(clientX) {
	return (clientX - view.offX) / view.scale;
}

function worldY(clientY) {
	return (clientY - view.offY) / view.scale;
}

function planetAt(wx, wy) {
	const reach = HIT_PX / view.scale;
	const reach2 = reach * reach;
	let best = -1;
	let bestD2 = Infinity;
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		const dx = tradeSim.planetX[i] - wx;
		const dy = tradeSim.planetY[i] - wy;
		const d2 = dx * dx + dy * dy;
		if (d2 <= reach2 && d2 < bestD2) {
			bestD2 = d2;
			best = i;
		}
	}
	return best;
}

function bodyAt(wx, wy) {
	const reach = HIT_PX / view.scale;
	const reach2 = reach * reach;
	let best = -1;
	let bestD2 = Infinity;
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		const dx = cargoSim.bodyX[i] - wx;
		const dy = cargoSim.bodyY[i] - wy;
		const d2 = dx * dx + dy * dy;
		if (d2 <= reach2 && d2 < bestD2) {
			bestD2 = d2;
			best = i;
		}
	}
	return best;
}

/* the selected player's flying ship: the only one a burn drag can start from */
function shipAt(wx, wy) {
	const sim = activeSim();
	if (sim.status !== STATUS_FLYING) return false;
	const reach = HIT_PX / view.scale;
	const dx = sim.cargo.x - wx;
	const dy = sim.cargo.y - wy;
	return dx * dx + dy * dy <= reach * reach;
}

function planetName(index) {
	return 'P' + index;
}

function bodyName(index) {
	return mode === MODE_PORTS ? 'port ' + index : 'P' + index;
}

function tradeRate() {
	return scene.trade.paused ? 0 : scene.trade.speed;
}

function playDefaultIndex() {
	return careerRule() ? PLAY_CAREER_DEFAULT : PLAY_DEFAULT;
}

function playMaxIndex() {
	return careerRule() ? PLAY_CAREER_MAX_INDEX : PLAY_MAX_INDEX;
}

function playScale() {
	const base = PLAY_SPEEDS[playIndex];
	/* in career the game-time slider multiplies the physics pace,
	 * so pads charge and rivals fly at the chosen rate */
	return careerRule() ? base * gameRate : base;
}

function refreshPlaybackUi() {
	if (!playTagEl) return;
	playTagEl.textContent = '×' + playScale();
	if (playSlowerBtn) playSlowerBtn.disabled = playIndex === 0;
	if (playFasterBtn) playFasterBtn.disabled = playIndex >= playMaxIndex();
	if (playResetBtn) {
		const def = PLAY_SPEEDS[playDefaultIndex()];
		playResetBtn.textContent = def + '×';
		playResetBtn.title = careerRule()
			? 'default career pace (×' + def + ')'
			: 'real time (×' + def + ')';
	}
}

function stepPlayback(step) {
	const next = playIndex + step;
	if (next < 0 || next > playMaxIndex()) return;
	playIndex = next;
	refreshPlaybackUi();
}

function resetPlayback() {
	playIndex = playDefaultIndex();
	refreshPlaybackUi();
}

function careerPhoto(kind) {
	if (!root.PhotoDeck || !root.PhotoDeck.showCareer) return;
	const index = PHOTO_CAREER.indexOf(kind);
	if (index < 0 || photoCareer[index] === 1) return;
	photoCareer[index] = 1;
	root.PhotoDeck.showCareer(kind);
}

/* one postcard per new system, then the surface card when the cargo lands */
function photoTick() {
	if (!root.PhotoDeck || !tradeSim.planetType) return;
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		if (cargoSim.visited[i] !== 1 || photoSpace[i] === 1) continue;
		photoSpace[i] = 1;
		root.PhotoDeck.show('space', tradeSim.planetType[i], i);
	}
	if (cargoSim.status !== STATUS_ENDED || cargoSim.endReason !== END_IMPACT ||
		cargoSim.endBody < 0 || photoLanded[cargoSim.endBody] === 1) return;
	photoLanded[cargoSim.endBody] = 1;
	root.PhotoDeck.show('landed', tradeSim.planetType[cargoSim.endBody], cargoSim.endBody);
}

function syncUserRivalFields() {
	if (!game.on) return;
	for (let i = 0; i < bot.count; i++) {
		if (bot.isRivalBot(i)) continue;
		const rSim = bot.rivals[i].sim;
		rSim.setField(cargoSim.bodyCount, cargoSim.bodyR, cargoSim.strength,
			cargoSim.fillField, cargoSim.fieldStatic);
		rSim.fieldT = cargoSim.fieldT;
		rSim.fieldRate = cargoSim.fieldRate;
		if (!rSim.fieldStatic) rSim.refreshField();
	}
}

function applyMode() {
	if (mode === MODE_PORTS) {
		fieldPortPlanet.fill(-1);
		for (let p = 0; p < tradeSim.portCount; p++) {
			const planet = tradeSim.portPlanet[p];
			fieldPortPlanet[p] = planet;
			portStrength[p] = planetMask[planet] ? portPlanetStrength[planet] : 0;
		}
		cargoSim.setField(tradeSim.portCount, portRadius, portStrength, fillPorts, false);
		sourceTagEl.textContent = 'ports · moving';
		sourceTagEl.title = tradeSim.portCount + ' ports · launch from planets';
	} else {
		cargoSim.setField(activePlanetExtent(), tradeSim.planetR, planetStrength, fillPlanets, true);
		sourceTagEl.textContent = 'planets';
		sourceTagEl.title = planetCount + ' planets';
	}
	syncUserRivalFields();
	syncPlanetGravity();
}

function setBodyStrength(body, value) {
	if (!cargoSim.setStrength(body, value)) return false;
	if (mode === MODE_PORTS && body >= 0 && body < cargoSim.bodyCount) {
		portPlanetStrength[fieldPortPlanet[body]] = cargoSim.strength[body];
	} else if (mode === MODE_PLANETS) {
		planetBaseStrength[body] = cargoSim.strength[body];
		bot.strength[body] = cargoSim.strength[body];
	}
	syncPlanetGravity();
	return true;
}

function strengthText(index) {
	const value = cargoSim.strength[index];
	return (value > 0 ? '+' : '') + value.toFixed(2);
}

function refreshSelected() {
	if (selected < 0 || selected >= cargoSim.bodyCount) {
		selected = -1;
		selectedLabel = '';
		bodyTagEl.textContent = 'none selected';
		gravitySlider.disabled = true;
		gravityLabel.textContent = '—';
		return;
	}
	selectedLabel = bodyName(selected) + ' · g ' + strengthText(selected) +
		(cargoSim.strength[selected] < 0 ? ' repel' : '');
	bodyTagEl.textContent = selectedLabel;
	gravitySlider.disabled = game.on;
	gravitySlider.value = cargoSim.strength[selected].toFixed(2);
	gravityLabel.textContent = cargoSim.strength[selected].toFixed(2);
}

function setSelected(index) {
	selected = index;
	refreshSelected();
	helperUpdateUi();
	hudAt = -Infinity;
}

function slotCount() {
	return game.on ? 1 + bot.count : 1;
}

function slotIsBot(slot) {
	return game.on && slotTypes[slot] === PLAYER_BOT;
}

function activeSlotIndex() {
	return game.on && !replay.on ? activeSlot : 0;
}

function slotSim(slot) {
	return slot === 0 ? cargoSim : bot.rivals[slot - 1].sim;
}

function activeSim() {
	return slotSim(activeSlotIndex());
}

function slotLedger(slot) {
	return slot === 0 ? game.money : bot.rivals[slot - 1].ledger;
}

/* the career record of a slot: YOU own game.career, a rival company lives in
 * the bot's actor, so one page can show and fly any player */
function slotCareer(slot) {
	return slot === 0 ? game.career : bot.rivals[slot - 1].career;
}

/* the career every panel, pad and shop reads: the selected player's */
function activeCareer() {
	return slotCareer(activeSlotIndex());
}

/*
 * The selected player's company and ship. Every skill, pad and launch gate on
 * the page reads this pair, never YOU's record: a hand-flown rival company
 * aims and fires with its own purse, battery and landing, so selecting R1
 * cannot borrow YOU's pads or strand R1 on YOU's planet.
 */
function playerCareer() {
	const career = careerRule() ? activeCareer() : null;
	return career || game.career;
}

/*
 * The sim takes the network of the company the page is pointed at, so the drag
 * ceiling, the launch gate and the launch book all answer for that ship. A
 * rival's own controller re-binds its company when it plans a shot.
 */
function activeCareerSim() {
	const sim = activeSim();
	if (careerRule()) sim.attachCareer(playerCareer());
	return sim;
}

/* any company still in business keeps the shared world clock turning */
function careerWorldOpen() {
	for (let s = 0; s < slotCount(); s++) {
		const career = slotCareer(s);
		if (career && career.ended === GravityGame.CAREER_OPEN) return true;
	}
	return false;
}

function slotShots(slot) {
	return slot === 0 ? game.shots : bot.rivals[slot - 1].shots;
}

function activeRoutePlan() {
	return slotPlans[activeSlotIndex()];
}

function activeRouteBest() {
	return slotBest[activeSlotIndex()];
}

function slotName(slot) {
	return SLOT_NAMES[slot] || 'YOU';
}

/* the selection may sit on a bot row: the page then only watches that player,
 * and unchecking its bot box hands it back to the keyboard */
function ensureValidActiveSlot(preferred) {
	if (!game.on) {
		activeSlot = 0;
		return;
	}
	const count = slotCount();
	if (preferred >= 0 && preferred < count && slotTypes[preferred] === PLAYER_USER) {
		activeSlot = preferred;
		return;
	}
	if (activeSlot >= count) activeSlot = 0;
}
