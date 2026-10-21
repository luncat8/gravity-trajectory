/*
 * Cargo overlay: aiming, gravity editing and the experiment HUD.
 *
 * The background owns the camera and the trade clock. This layer draws on a
 * second canvas with the same projection and keeps its own real-time clock;
 * orbit_sim.t is read only as the field clock for moving (port) bodies.
 * Prediction is recomputed when the aim or the field changes, or when moving
 * centres drifted from the snapshot it was computed with, at most once per
 * frame. The moving field is extrapolated at the trade rate with adaptive
 * resampling so that prediction and live flight share the same field cadence.
 * A press without drag only selects; it never deletes an armed shot.
 */
(function (root) {
	'use strict';

	const $ = id => document.getElementById(id);
	const SPEED_MIN = GravitySim.SPEED_MIN;
	const SPEED_MAX = GravitySim.SPEED_MAX;
	const GRIP_MAX = GravitySim.GRIP_MAX;
	const STATUS_FLYING = GravitySim.STATUS_FLYING;
	const STATUS_ENDED = GravitySim.STATUS_ENDED;
	const END_IMPACT = GravitySim.END_IMPACT;
	const END_EXIT = GravitySim.END_EXIT;
	const END_TIME = GravitySim.END_TIME;
	const END_TRUNCATED = GravitySim.END_TRUNCATED;
	const PLANETS = OrbitSim.PLANETS;
	const MODE_PLANETS = 0;
	const MODE_PORTS = 1;
	const PORT_R = 6;
	const HIT_PX = 18;
	const HUD_INTERVAL = 100;
	const SENS_FINE = 1 / 20;
	const DRAG_TAKEOVER_PX = 7;
	const FIELD_DRIFT_PX = 1.5;
	const WELL_BASE = 24;
	const WELL_SCALE = 64;
	const NO_DASH = [];
	const TAU = Math.PI * 2;
	const ATTRACT = 'rgba(103, 224, 255, 0.07)';
	const ATTRACT_HOVER = 'rgba(103, 224, 255, 0.26)';
	const ATTRACT_SELECT = 'rgba(255, 207, 110, 0.42)';
	const REPEL = 'rgba(255, 126, 160, 0.10)';
	const REPEL_HOVER = 'rgba(255, 126, 160, 0.32)';
	const REPEL_SELECT = 'rgba(255, 207, 110, 0.48)';
	const WELL_COLOURS = [
		[ATTRACT, ATTRACT_HOVER, ATTRACT_SELECT],
		[REPEL, REPEL_HOVER, REPEL_SELECT]
	];
	const GOLD = '#ffcf6e';
	const ICE = '#67e0ff';
	const SIGN_POS = '#ff5f57';
	const SIGN_NEG = '#57a8ff';
	const PLATE = 'rgba(5, 13, 24, 0.92)';
	const PRED_DASH = [0, 0];
	const GRIP_DASH = [0, 0];
	const REPEL_DASH = [0, 0];

	const scene = root.OrbitScene;
	const tradeSim = scene.sim;
	const view = scene.view;
	const gravity = new GravitySim(OrbitSim.WORLD_W, OrbitSim.WORLD_H);

	/* one strength set per mode, kept across switches; ports get one radius */
	const planetStrength = new Float64Array(PLANETS);
	planetStrength.fill(1);
	const portStrength = new Float64Array(OrbitSim.PORTS);
	portStrength.fill(1);
	const portRadius = new Float64Array(OrbitSim.PORTS);
	portRadius.fill(PORT_R);

	function fillPlanets(t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = tradeSim.planetX[i];
			outY[i] = tradeSim.planetY[i];
		}
	}

	/* same closed form as orbit_sim.planetXAt/YAt, one trig pair per port */
	function fillPorts(t, outX, outY, count) {
		for (let p = 0; p < count; p++) {
			const planet = tradeSim.portPlanet[p];
			const angle = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const rx = tradeSim.orbitRX[planet] * Math.cos(angle);
			const ry = tradeSim.orbitRY[planet] * Math.sin(angle);
			outX[p] = tradeSim.planetX[planet] +
				rx * tradeSim.orbitTiltCos[planet] - ry * tradeSim.orbitTiltSin[planet];
			outY[p] = tradeSim.planetY[planet] +
				rx * tradeSim.orbitTiltSin[planet] + ry * tradeSim.orbitTiltCos[planet];
		}
	}

	const canvas = $('g');
	const ctx = canvas.getContext('2d');
	const glow = makeGlow('rgba(255, 207, 110, 0.55)');
	const impactGlow = makeGlow('rgba(255, 126, 160, 0.5)');

	const expClockEl = $('expClock');
	const statusEl = $('cargoStatus');
	const flightEl = $('cargoFlight');
	const aimEl = $('aimReadout');
	const pathEl = $('pathReadout');
	const lengthEl = $('lengthReadout');
	const calcEl = $('calcReadout');
	const bodyTagEl = $('bodyTag');
	const sourceTagEl = $('sourceTag');
	const srcPlanetsEl = $('srcPlanets');
	const srcPortsEl = $('srcPorts');
	const gravitySlider = $('gravity');
	const gravityLabel = $('gravityLabel');
	const trimSlider = $('trim');
	const trimLabel = $('trimLabel');
	const horizonSlider = $('horizon');
	const horizonLabel = $('horizonLabel');
	const horizonTagEl = $('horizonTag');
	const trimTargetEl = $('trimTarget');
	const launchButton = $('launch');
	const clearButton = $('clear');
	const tradeCanvas = $('c');

	let lastWX = 0;
	let lastWY = 0;
	let hoverBody = -1;
	let selected = -1;
	let aimBody = -1;
	let aiming = false;
	let armed = false;
	let aimAngle = 0;
	let aimSpeed = SPEED_MIN;
	let gripX = 0;
	let gripY = 0;
	let gripLen = 0;
	let mode = MODE_PLANETS;
	let pressing = false;
	let pressBody = -1;
	let pressClientX = 0;
	let pressClientY = 0;
	let pendGripX = 0;
	let pendGripY = 0;
	let savedArmed = false;
	let savedBody = -1;
	let savedAngle = 0;
	let savedSpeed = SPEED_MIN;
	let fine = false;
	let dirty = false;
	let trimLast = 0;
	let hudAt = -Infinity;
	let lastFrame = performance.now();
	let expStart = performance.now();
	let selectedLabel = '';
	let hoverLabel = '';
	let aimLabel = '';
	let hudAimText = '';
	let hudTagText = '';

	function makeGlow(fill) {
		const sprite = document.createElement('canvas');
		sprite.width = 64;
		sprite.height = 64;
		const paint = sprite.getContext('2d');
		const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, fill);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		paint.fillStyle = gradient;
		paint.fillRect(0, 0, 64, 64);
		return sprite;
	}

	function plate(x, y, width, height) {
		const r = 6;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
		ctx.fillStyle = PLATE;
		ctx.fill();
	}

	function resizeOverlay() {
		const width = window.innerWidth;
		const height = window.innerHeight;
		const dpr = view.dpr;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
	}

	function worldX(clientX) {
		return (clientX - view.offX) / view.scale;
	}

	function worldY(clientY) {
		return (clientY - view.offY) / view.scale;
	}

	function bodyAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const dx = gravity.bodyX[i] - wx;
			const dy = gravity.bodyY[i] - wy;
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach2 && d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		return best;
	}

	function bodyName(index) {
		return mode === MODE_PORTS ? 'port ' + index : 'P' + index;
	}

	function tradeRate() {
		return scene.trade.paused ? 0 : scene.trade.speed;
	}

	function applyMode() {
		if (mode === MODE_PORTS) {
			gravity.setField(tradeSim.portCount, portRadius, portStrength, fillPorts, false);
			sourceTagEl.textContent = 'ports · moving';
			sourceTagEl.title = tradeSim.portCount + ' ports';
		} else {
			gravity.setField(PLANETS, tradeSim.planetR, planetStrength, fillPlanets, true);
			sourceTagEl.textContent = 'planets';
			sourceTagEl.title = PLANETS + ' planets';
		}
	}

	function strengthText(index) {
		const value = gravity.strength[index];
		return (value > 0 ? '+' : '') + value.toFixed(2);
	}

	function refreshSelected() {
		if (selected < 0) {
			selectedLabel = '';
			bodyTagEl.textContent = 'none selected';
			gravitySlider.disabled = true;
			gravityLabel.textContent = '—';
			return;
		}
		selectedLabel = bodyName(selected) + ' · g ' + strengthText(selected) +
			(gravity.strength[selected] < 0 ? ' repel' : '');
		bodyTagEl.textContent = selectedLabel;
		gravitySlider.disabled = false;
		gravitySlider.value = gravity.strength[selected].toFixed(2);
		gravityLabel.textContent = gravity.strength[selected].toFixed(2);
	}

	function setSelected(index) {
		selected = index;
		refreshSelected();
		hudAt = -Infinity;
	}

	function refreshAimLabel() {
		if (!aiming && !armed) {
			aimLabel = '';
			return;
		}
		const deg = ((-aimAngle * 180 / Math.PI) % 360 + 360) % 360;
		aimLabel = Math.round(aimSpeed) + ' px/s · ' + deg.toFixed(1) + '°' +
			(fine ? ' · fine' : '');
	}

	function refreshHoverLabel() {
		if (hoverBody < 0) {
			hoverLabel = '';
			return;
		}
		hoverLabel = bodyName(hoverBody) + ' · g ' + strengthText(hoverBody) +
			(gravity.strength[hoverBody] < 0 ? ' repel' : '');
	}

	/* grip position -> angle and speed; clamps the grip to the power circle */
	function updateAim() {
		const cx = gravity.bodyX[aimBody];
		const cy = gravity.bodyY[aimBody];
		let dx = gripX - cx;
		let dy = gripY - cy;
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
		aimSpeed = gravity.speedAt(gripLen);
		refreshAimLabel();
	}

	function placeGripFromSpeed() {
		const cx = gravity.bodyX[aimBody];
		const cy = gravity.bodyY[aimBody];
		gripLen = gravity.gripLength(aimSpeed);
		gripX = cx + Math.cos(aimAngle) * gripLen;
		gripY = cy + Math.sin(aimAngle) * gripLen;
		refreshAimLabel();
	}

	/* a press only becomes an aim once it turns into a drag (takeOverAim);
	 * until then the armed shot and its trajectory stay untouched */
	function beginPress(body, event, wx, wy) {
		pressing = true;
		pressBody = body;
		pressClientX = event.clientX;
		pressClientY = event.clientY;
		pendGripX = wx;
		pendGripY = wy;
	}

	function takeOverAim() {
		savedArmed = armed;
		savedBody = aimBody;
		savedAngle = aimAngle;
		savedSpeed = aimSpeed;
		aimBody = pressBody;
		aiming = true;
		armed = false;
		gripX = pendGripX;
		gripY = pendGripY;
		updateAim();
		gravity.predCount = 0;
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

	function cancelAim() {
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		dirty = false;
		gravity.predCount = 0;
		hudAt = -Infinity;
	}

	function launch() {
		if (!armed) return;
		/* always re-predict: with a moving field the forecast and the flight
		 * must share the same field time, or they start from different worlds */
		gravity.predict(aimBody, aimAngle, aimSpeed);
		dirty = false;
		gravity.launch(aimBody, aimAngle, aimSpeed);
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		hudAt = -Infinity;
	}

	function clearCargo() {
		gravity.clear();
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		dirty = false;
		hudAt = -Infinity;
	}

	function setMode(next) {
		if (next === mode && gravity.fillField) return;
		mode = next;
		cancelAim();
		hoverBody = -1;
		refreshHoverLabel();
		setSelected(-1);
		applyMode();
		hudAt = -Infinity;
	}

	function fieldChanged() {
		if (armed || aiming) dirty = true;
		else gravity.predCount = 0;
		hudAt = -Infinity;
	}

	function onPointerDown(event) {
		if (event.button !== 0 || event.target !== tradeCanvas) return;
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		const body = bodyAt(wx, wy);
		if (body < 0) return;
		lastWX = wx;
		lastWY = wy;
		setSelected(body);
		beginPress(body, event, wx, wy);
	}

	function onPointerMove(event) {
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		fine = event.shiftKey;
		if (aiming) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			gripX += dx * sens;
			gripY += dy * sens;
			updateAim();
			dirty = true;
		} else if (pressing) {
			/* track the would-be grip (fine sensitivity included) so the aim
			 * is exact when the press crosses into a drag */
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			pendGripX += dx * sens;
			pendGripY += dy * sens;
			const movedX = event.clientX - pressClientX;
			const movedY = event.clientY - pressClientY;
			if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
				takeOverAim();
			}
		} else {
			const body = event.target === tradeCanvas ? bodyAt(wx, wy) : -1;
			if (body !== hoverBody) {
				hoverBody = body;
				refreshHoverLabel();
			}
		}
		lastWX = wx;
		lastWY = wy;
	}

	function onPointerUp(event) {
		fine = event.shiftKey;
		if (pressing && !aiming) {
			/* click without drag: selection only, old trajectory kept */
			pressing = false;
			return;
		}
		if (!aiming) return;
		aiming = false;
		pressing = false;
		const reach = gravity.bodyR[aimBody] + 6 / view.scale;
		if (gripLen > reach && aimSpeed > SPEED_MIN + 4) {
			armed = true;
			dirty = true;
		} else if (savedArmed) {
			restoreSaved();
		} else {
			armed = false;
			dirty = false;
			gravity.predCount = 0;
		}
		savedArmed = false;
		refreshAimLabel();
		hudAt = -Infinity;
	}

	function onTrimInput() {
		const value = Number(trimSlider.value);
		const delta = value - trimLast;
		trimLast = value;
		if (delta === 0) return;
		const factor = 1 + delta / 100;
		if (armed) {
			aimSpeed = aimSpeed * factor;
			if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
			else if (aimSpeed > SPEED_MAX) aimSpeed = SPEED_MAX;
			placeGripFromSpeed();
			dirty = true;
		} else if (selected >= 0) {
			gravity.setStrength(selected, gravity.strength[selected] * factor);
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

	function drawWells() {
		const px = 1 / view.scale;
		REPEL_DASH[0] = 4 * px;
		REPEL_DASH[1] = 7 * px;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i];
			const mag = g < 0 ? -g : g;
			if (mag < 0.02) continue;
			const level = i === selected ? 2 : i === hoverBody ? 1 : 0;
			const colours = WELL_COLOURS[g < 0 ? 1 : 0];
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				WELL_BASE + mag * WELL_SCALE, 0, TAU);
			ctx.strokeStyle = colours[level];
			ctx.lineWidth = (level === 2 ? 1.3 : 0.9) * px;
			if (g < 0) {
				ctx.setLineDash(REPEL_DASH);
			} else {
				ctx.setLineDash(NO_DASH);
			}
			ctx.stroke();
		}
		ctx.setLineDash(NO_DASH);
	}

	/* red + for attracting (g > 0), blue - for repelling (g < 0), at the
	 * centre; read from the live strength array, so edits show at once */
	function drawSigns() {
		const px = 1 / view.scale;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i];
			if (g > -0.02 && g < 0.02) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			let arm = gravity.bodyR[i] * 0.6;
			if (arm < 3.2 * px) arm = 3.2 * px;
			if (arm > 9 * px) arm = 9 * px;
			const colour = g > 0 ? SIGN_POS : SIGN_NEG;
			const glow = g > 0 ? 'rgba(255, 95, 87, 0.22)' : 'rgba(87, 168, 255, 0.22)';
			ctx.strokeStyle = glow;
			ctx.lineWidth = 6 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 1.7 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			if (i === selected) {
				ctx.beginPath();
				ctx.arc(x, y, gravity.bodyR[i] + 1.5 * px, 0, TAU);
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
				ctx.lineWidth = px;
				ctx.stroke();
			}
		}
		ctx.lineCap = 'butt';
	}

	function drawPortVelocities() {
		if (mode !== MODE_PORTS || gravity.fieldRate === 0) return;
		const px = 1 / view.scale;
		if (Math.abs(gravity.fieldRate) < 0.05) return;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		const t = tradeSim.t;
		const eps = 0.12;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const planet = tradeSim.portPlanet[i];
			const a0 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const a1 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * (t + eps);
			const rx0 = tradeSim.orbitRX[planet] * Math.cos(a0);
			const ry0 = tradeSim.orbitRY[planet] * Math.sin(a0);
			const rx1 = tradeSim.orbitRX[planet] * Math.cos(a1);
			const ry1 = tradeSim.orbitRY[planet] * Math.sin(a1);
			const x0 = tradeSim.planetX[planet] + rx0 * tradeSim.orbitTiltCos[planet] - ry0 * tradeSim.orbitTiltSin[planet];
			const y0 = tradeSim.planetY[planet] + rx0 * tradeSim.orbitTiltSin[planet] + ry0 * tradeSim.orbitTiltCos[planet];
			const x1 = tradeSim.planetX[planet] + rx1 * tradeSim.orbitTiltCos[planet] - ry1 * tradeSim.orbitTiltSin[planet];
			const y1 = tradeSim.planetY[planet] + rx1 * tradeSim.orbitTiltSin[planet] + ry1 * tradeSim.orbitTiltCos[planet];
			const vx = (x1 - x0) / eps * gravity.fieldRate;
			const vy = (y1 - y0) / eps * gravity.fieldRate;
			const speed = Math.sqrt(vx * vx + vy * vy);
			if (speed < 0.15 / px) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			const len = Math.min(18 * px, Math.max(6 * px, speed * 0.18 * px));
			const angle = Math.atan2(vy, vx);
			ctx.strokeStyle = 'rgba(180, 200, 220, 0.24)';
			ctx.lineWidth = 1.0 * px;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.lineTo(x + Math.cos(angle + 2.6) * 3.2 * px, y + Math.sin(angle + 2.6) * 3.2 * px);
			ctx.lineTo(x + Math.cos(angle - 2.6) * 3.2 * px, y + Math.sin(angle - 2.6) * 3.2 * px);
			ctx.closePath();
			ctx.fillStyle = 'rgba(180, 200, 220, 0.32)';
			ctx.fill();
		}
		ctx.lineCap = 'butt';
	}

	function drawPrediction() {
		const count = gravity.predCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		PRED_DASH[0] = 6 * px;
		PRED_DASH[1] = 6 * px;
		const pathX = gravity.predX;
		const pathY = gravity.predY;
		const stride = count > 1400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(pathX[0], pathY[0]);
		for (let i = stride; i < count; i += stride) ctx.lineTo(pathX[i], pathY[i]);
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(pathX[last], pathY[last]);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.78)';
		ctx.lineWidth = 1.3 * px;
		ctx.setLineDash(PRED_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		/* one dot per simulated second */
		ctx.fillStyle = 'rgba(255, 207, 110, 0.6)';
		for (let i = 119; i < count; i += 120) {
			ctx.beginPath();
			ctx.arc(pathX[i], pathY[i], 1.7 * px, 0, TAU);
			ctx.fill();
		}

		const ex = pathX[last];
		const ey = pathY[last];
		ctx.beginPath();
		ctx.arc(ex, ey, 5 * px, 0, TAU);
		ctx.strokeStyle = gravity.predReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.65)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
		if (gravity.predReason === END_IMPACT) {
			ctx.beginPath();
			ctx.arc(ex, ey, 2 * px, 0, TAU);
			ctx.fillStyle = GOLD;
			ctx.fill();
		}
	}

	function drawTrail() {
		const count = gravity.trailCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		const stride = count > 2400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(gravity.trailX[0], gravity.trailY[0]);
		for (let i = stride; i < count; i += stride) {
			ctx.lineTo(gravity.trailX[i], gravity.trailY[i]);
		}
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(gravity.trailX[last], gravity.trailY[last]);
		ctx.strokeStyle = 'rgba(103, 224, 255, 0.9)';
		ctx.lineWidth = 1.8 * px;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();
	}

	function drawCargo(now) {
		if (gravity.status === GravitySim.STATUS_IDLE) return;
		const px = 1 / view.scale;
		const x = gravity.cargo.x;
		const y = gravity.cargo.y;
		if (gravity.status === STATUS_FLYING) {
			const angle = Math.atan2(gravity.cargo.vy, gravity.cargo.vx);
			ctx.globalAlpha = 0.7;
			ctx.drawImage(glow, x - 18 * px, y - 18 * px, 36 * px, 36 * px);
			ctx.globalAlpha = 1;
			const size = 4.6 * px;
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
			ctx.lineTo(x + Math.cos(angle + 2.4) * size, y + Math.sin(angle + 2.4) * size);
			ctx.lineTo(x + Math.cos(angle - 2.4) * size, y + Math.sin(angle - 2.4) * size);
			ctx.closePath();
			ctx.fillStyle = GOLD;
			ctx.fill();
			ctx.strokeStyle = 'rgba(3, 8, 16, 0.8)';
			ctx.lineWidth = 0.8 * px;
			ctx.stroke();
			return;
		}
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
		ctx.globalAlpha = 0.55;
		ctx.drawImage(impactGlow, x - 16 * px, y - 16 * px, 32 * px, 32 * px);
		ctx.globalAlpha = 1;
		ctx.beginPath();
		ctx.arc(x, y, (5 + pulse * 4) * px, 0, TAU);
		ctx.strokeStyle = gravity.endReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.6)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
	}

	function drawAim() {
		if (!armed && !aiming) return;
		const px = 1 / view.scale;
		const cx = gravity.bodyX[aimBody];
		const cy = gravity.bodyY[aimBody];
		GRIP_DASH[0] = 3 * px;
		GRIP_DASH[1] = 7 * px;
		ctx.beginPath();
		ctx.arc(cx, cy, GRIP_MAX, 0, TAU);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.10)';
		ctx.lineWidth = px;
		ctx.setLineDash(GRIP_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		const sx = gravity.predCount > 0 ? gravity.predX[0] : cx;
		const sy = gravity.predCount > 0 ? gravity.predY[0] : cy;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(gripX, gripY);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.82)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();


		const size = (4 + (aimSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 4) * px;
		ctx.beginPath();
		ctx.arc(gripX, gripY, size, 0, TAU);
		ctx.fillStyle = 'rgba(255, 207, 110, 0.16)';
		ctx.fill();
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.4 * px;
		ctx.stroke();
		const tip = 11 * px;
		const side = 4.5 * px;
		ctx.beginPath();
		ctx.moveTo(gripX + Math.cos(aimAngle) * tip, gripY + Math.sin(aimAngle) * tip);
		ctx.lineTo(gripX + Math.cos(aimAngle + 2.5) * side,
			gripY + Math.sin(aimAngle + 2.5) * side);
		ctx.lineTo(gripX + Math.cos(aimAngle - 2.5) * side,
			gripY + Math.sin(aimAngle - 2.5) * side);
		ctx.closePath();
		ctx.fillStyle = GOLD;
		ctx.fill();
	}

	function drawMarkers() {
		const px = 1 / view.scale;
		for (let i = 0; i < gravity.bodyCount; i++) {
			if (i !== selected && i !== hoverBody) continue;
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				gravity.bodyR[i] + 5 * px, 0, TAU);
			ctx.strokeStyle = i === selected ? GOLD : ICE;
			ctx.globalAlpha = 0.7;
			ctx.lineWidth = 1.2 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	function drawLabel(text, wx, wy, colour, below) {
		if (!text) return;
		const sx = wx * view.scale + view.offX + 14;
		const sy = wy * view.scale + view.offY - 14 +
			(below ? gravity.bodyR[selected] * view.scale + 34 : 0);
		const width = 18 + text.length * 6.4;
		let x = sx;
		let y = sy - 16;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y < 8) y = 8;
		plate(x, y, width, 18);
		ctx.fillStyle = colour;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 9, y + 9.5);
	}

	function drawGripLabel() {
		if (!aimLabel || (!armed && !aiming)) return;
		const sx = gripX * view.scale + view.offX + 16;
		const sy = gripY * view.scale + view.offY - 12;
		const width = 20 + aimLabel.length * 6.4;
		let x = sx;
		let y = sy - 18;
		if (x + width > window.innerWidth - 8) x = sx - width - 32;
		if (y < 8) y = sy + 22;
		plate(x, y, width, 20);
		ctx.fillStyle = fine ? ICE : GOLD;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(aimLabel, x + 10, y + 10.5);
	}

	function draw(now) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		ctx.save();
		ctx.translate(view.offX, view.offY);
		ctx.scale(view.scale, view.scale);
		drawWells();
		drawPortVelocities();
		drawPrediction();
		drawTrail();
		drawAim();
		drawCargo(now);
		drawMarkers();
		drawSigns();
		ctx.restore();
		if (hoverBody >= 0 && hoverBody !== selected && !aiming) {
			drawLabel(hoverLabel, gravity.bodyX[hoverBody],
				gravity.bodyY[hoverBody], ICE);
		}
		if (selected >= 0) {
			drawLabel(selectedLabel, gravity.bodyX[selected],
				gravity.bodyY[selected], GOLD,
				(aiming || armed) && selected === aimBody);
		}
		drawGripLabel();
	}

	function formatClock(seconds) {
		const total = Math.floor(seconds * 10) / 10;
		const mins = Math.floor(total / 60);
		const secs = total - mins * 60;
		return 'exp + ' + (mins < 10 ? '0' : '') + mins + ':' +
			(secs < 10 ? '0' : '') + secs.toFixed(1);
	}

	function endText(reason, body) {
		if (reason === END_IMPACT) return 'impact ' + bodyName(body);
		if (reason === END_EXIT) return 'left field';
		if (reason === END_TIME) return 'time cap';
		if (reason === END_TRUNCATED) return 'budget cap';
		return 'open';
	}

	/* the aim readout follows the pointer, so it updates every frame */
	function updateAimHud() {
		const text = aiming || armed ? aimLabel : '—';
		if (text !== hudAimText) {
			hudAimText = text;
			aimEl.textContent = text;
		}
		let tag = 'none selected';
		if (hoverBody >= 0 && !aiming) {
			tag = 'hover ' + bodyName(hoverBody) + ' · ' + strengthText(hoverBody);
		} else if (selected >= 0) tag = selectedLabel;
		if (tag !== hudTagText) {
			hudTagText = tag;
			bodyTagEl.textContent = tag;
		}
		trimSlider.disabled = !armed && selected < 0;
		launchButton.disabled = !armed;
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		expClockEl.textContent = formatClock((now - expStart) / 1000);

		let status = 'ready';
		if (aiming) status = 'aiming ' + bodyName(aimBody);
		else if (armed) status = 'armed · ' + bodyName(aimBody);
		else if (gravity.status === STATUS_FLYING) status = 'in flight';
		else if (gravity.status === STATUS_ENDED) {
			status = endText(gravity.endReason, gravity.endBody);
		}
		statusEl.textContent = status;

		if (gravity.status === GravitySim.STATUS_IDLE) {
			flightEl.textContent = '—';
		} else {
			flightEl.textContent = gravity.flightTime.toFixed(2) + ' s · ' +
				Math.round(gravity.flightLength) + ' px';
		}

		if (gravity.predCount >= 2) {
			lengthEl.textContent = Math.round(gravity.predLength) + ' px';
			pathEl.textContent = gravity.predTime.toFixed(1) + ' s · ' +
				endText(gravity.predReason, gravity.predBody);
			calcEl.textContent = gravity.predSteps + ' steps · ' +
				gravity.predMs.toFixed(2) + ' ms';
		} else {
			lengthEl.textContent = '—';
			pathEl.textContent = '—';
			calcEl.textContent = '—';
		}

		if (armed) trimTargetEl.textContent = 'aim speed';
		else if (selected >= 0) trimTargetEl.textContent = bodyName(selected) + ' g';
		else trimTargetEl.textContent = '—';
	}

	function frame(now) {
		const dt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		/* sync the field clock and geometry with the trade world */
		gravity.fieldT = tradeSim.t;
		const rate = tradeRate();
		if (rate !== gravity.fieldRate) {
			gravity.fieldRate = rate;
			gravity.stepStale = true;
			if ((armed || aiming) && !gravity.fieldStatic) dirty = true;
		}
		if (mode === MODE_PORTS && gravity.setCount(tradeSim.portCount)) fieldChanged();
		if (!gravity.fieldStatic) gravity.refreshField();
		gravity.step(dt);
		/* moving centres: keep the shown trajectory computed from where the
		 * bodies are now; the grip follows the origin, angle/speed are kept */
		if ((armed || aiming) && !dirty && gravity.fieldDrift() > FIELD_DRIFT_PX) {
			if (armed && !aiming) placeGripFromSpeed();
			else if (aiming) updateAim();
			dirty = true;
		}
		if ((armed || aiming) && dirty) {
			gravity.predict(aimBody, aimAngle, aimSpeed);
			dirty = false;
		}
		draw(now);
		updateAimHud();
		updateHud(now);
		requestAnimationFrame(frame);
	}

	gravitySlider.addEventListener('input', () => {
		if (selected < 0) return;
		gravity.setStrength(selected, Number(gravitySlider.value));
		refreshSelected();
		refreshHoverLabel();
		fieldChanged();
	});
	srcPlanetsEl.addEventListener('change', () => setMode(MODE_PLANETS));
	srcPortsEl.addEventListener('change', () => setMode(MODE_PORTS));
	trimSlider.addEventListener('input', onTrimInput);
	trimSlider.addEventListener('change', resetTrim);
	horizonSlider.addEventListener('input', () => {
		gravity.horizon = Number(horizonSlider.value);
		const text = gravity.horizon + ' s';
		horizonLabel.textContent = text;
		if (horizonTagEl) horizonTagEl.textContent = text;
		fieldChanged();
		hudAt = -Infinity;
	});
	launchButton.addEventListener('click', launch);
	clearButton.addEventListener('click', clearCargo);
	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerUp);
	window.addEventListener('resize', resizeOverlay);
	window.addEventListener('keydown', event => {
		if (event.key === 'Shift') {
			fine = true;
			refreshAimLabel();
			return;
		}
		if (event.code === 'Enter') {
			if (!armed) return;
			event.preventDefault();
			launch();
			return;
		}
		if (event.code === 'Escape') cancelAim();
	});
	window.addEventListener('keyup', event => {
		if (event.key !== 'Shift') return;
		fine = false;
		refreshAimLabel();
	});

	gravity.horizon = Number(horizonSlider.value);
	horizonLabel.textContent = gravity.horizon + ' s';
	if (horizonTagEl) horizonTagEl.textContent = gravity.horizon + ' s';

	gravity.fieldT = tradeSim.t;
	gravity.fieldRate = tradeRate();
	setMode(srcPortsEl.checked ? MODE_PORTS : MODE_PLANETS);

	resizeOverlay();
	refreshSelected();
	refreshAimLabel();
	updateAimHud();
	updateHud(performance.now());
	requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);
