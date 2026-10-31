/*
 * Canvas view state and projection: field/space view mode, overlay resize, HUD rects and hit tests, world<->screen coords, slot accessors, playback and the photo deck tick.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function refreshViewUi() {
	if (viewSpaceEl) viewSpaceEl.checked = viewMode === VIEW_SPACE;
	if (viewFieldEl) viewFieldEl.checked = viewMode === VIEW_FIELD;
	if (careerCleanLabelEl) careerCleanLabelEl.hidden = !careerRule();
	if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
	if (!viewTagEl) return;
	if (viewMode !== VIEW_FIELD || !fieldRenderer) {
		const lost = fieldRenderer !== null && fieldRenderer.backend() === 'lost';
		viewTagEl.textContent = lost ? 'space · field lost' : 'space';
		viewTagEl.title = lost
			? 'gravity field paused: the WebGL context was lost · f retries once it restores'
			: 'starfield backdrop and gravity well rings';
		return;
	}
	const gl = fieldRenderer.backend() === 'webgl';
	const div = fieldRenderer.scaleDiv();
	viewTagEl.textContent = gl
		? 'hue · grad · WebGL' + (div > 1 ? ' 1/' + div : '')
		: 'hue · grad · 1/' + div;
	viewTagEl.title = 'hue = pull direction · lightness = potential gradient · ' +
		(gl ? 'WebGL shader' : '1/' + div + ' 2D raster');
}

/* a lost WebGL context falls back to the starfield until `webglcontextrestored`
 * rebuilds the shader and automatically restores the requested view */
function activeFieldView() {
	return viewDesired === VIEW_FIELD &&
		(!fieldRenderer || fieldRenderer.backend() !== 'lost');
}

function syncViewState() {
	viewMode = activeFieldView() ? VIEW_FIELD : VIEW_SPACE;
	if (fieldCanvas) fieldCanvas.hidden = viewMode !== VIEW_FIELD;
	if (scene.setBackdrop) scene.setBackdrop(viewMode !== VIEW_FIELD);
	if (viewMode === VIEW_FIELD && fieldRenderer) fieldRenderer.invalidate();
	refreshViewUi();
	hudAt = -Infinity;
}

function fieldLost() {
	syncViewState();
}

function setViewMode(next) {
	viewDesired = next === VIEW_FIELD ? VIEW_FIELD : VIEW_SPACE;
	syncViewState();
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
	reserveTradeFooter();
	measureHudRects();
}

/* panel rects for the world plates (3 panels × 4 numbers): refreshed on resize and
 * whenever the HUD content changes, never per frame */
const hudRects = new Float64Array(12);
const hudRectEls = [$('cargoHud'), $('leftHud'), $('cargoFoot')];

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

/* the wrapped trade footer grows; both HUD columns stop above it, and the
 * right cargo HUD also stops above the separate bottom launch/helpers panel */
function reserveTradeFooter() {
	if (!cargoHudEl) return;
	const vv = root.visualViewport;
	const vh = vv && vv.height > 0 ? vv.height : window.innerHeight;
	if (!(vh > 0)) return;
	const hudRect = cargoHudEl.getBoundingClientRect();
	const hudTop = hudRect.top > 0 && hudRect.top < vh * 0.5 ? hudRect.top : 14;
	const tradeEl = $('tradeControls');
	const rect = tradeEl ? tradeEl.getBoundingClientRect() : null;
	let bottomY = vh - 10;
	if (rect && rect.height > 0 && rect.height < vh * 0.5) {
		bottomY = Math.min(bottomY, rect.top - 10);
	}
	const leftMaxH = Math.max(180, Math.floor(bottomY - hudTop)) + 'px';
	const reserve = Math.ceil(vh - bottomY) + 'px';
	cargoHudEl.style.setProperty('--footReserve', reserve);
	if (cargoFootEl && cargoFootEl.style) {
		cargoFootEl.style.setProperty('--footReserve', reserve);
	}
	if (leftHudEl && leftHudEl.style) {
		leftHudEl.style.setProperty('--footReserve', reserve);
		leftHudEl.style.setProperty('--hudMaxH', leftMaxH);
	}
	/* the postcard and #cargoFoot sit just above the bar, taller in career (wait line) */
	const rootEl = root.document && root.document.documentElement;
	if (rootEl && rootEl.style) rootEl.style.setProperty('--footReserve', reserve);
	let cargoBottomY = bottomY;
	const footRect = cargoFootEl ? cargoFootEl.getBoundingClientRect() : null;
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

function shipAt(wx, wy) {
	if (cargoSim.status !== STATUS_FLYING) return false;
	const reach = HIT_PX / view.scale;
	const dx = cargoSim.cargo.x - wx;
	const dy = cargoSim.cargo.y - wy;
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
		cargoSim.setField(PLANETS, tradeSim.planetR, planetStrength, fillPlanets, true);
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

function ensureValidActiveSlot(preferred) {
	if (!game.on) {
		activeSlot = 0;
		return;
	}
	const count = slotCount();
	if (activeSlot >= count) activeSlot = 0;
	if (slotTypes[activeSlot] === PLAYER_USER) return;
	if (preferred >= 0 && preferred < count && slotTypes[preferred] === PLAYER_USER) {
		activeSlot = preferred;
		return;
	}
	for (let s = 0; s < count; s++) {
		if (slotTypes[s] === PLAYER_USER) {
			activeSlot = s;
			return;
		}
	}
}
