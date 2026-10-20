/*
 * Cargo overlay: aiming, gravity editing and the experiment HUD.
 *
 * The background owns the camera and the trade clock. This layer draws on a
 * second canvas with the same projection, keeps its own real-time clock and
 * never reads orbit_sim.t. Prediction is recomputed only when the aim or the
 * field changes, at most once per frame.
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
	const HIT_PX = 18;
	const HUD_INTERVAL = 100;
	const SENS_FINE = 1 / 20;
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
	const PLATE = 'rgba(5, 13, 24, 0.92)';
	const PRED_DASH = [0, 0];
	const GRIP_DASH = [0, 0];
	const REPEL_DASH = [0, 0];

	const scene = root.OrbitScene;
	const tradeSim = scene.sim;
	const view = scene.view;
	const gravity = new GravitySim(
		tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
		PLANETS, OrbitSim.WORLD_W, OrbitSim.WORLD_H
	);

	const canvas = $('g');
	const ctx = canvas.getContext('2d');
	const glow = makeGlow('rgba(255, 207, 110, 0.55)');
	const impactGlow = makeGlow('rgba(255, 126, 160, 0.5)');

	const expClockEl = $('expClock');
	const statusEl = $('cargoStatus');
	const flightEl = $('cargoFlight');
	const aimEl = $('aimReadout');
	const pathEl = $('pathReadout');
	const calcEl = $('calcReadout');
	const planetTagEl = $('planetTag');
	const gravitySlider = $('gravity');
	const gravityLabel = $('gravityLabel');
	const trimSlider = $('trim');
	const trimLabel = $('trimLabel');
	const trimTargetEl = $('trimTarget');
	const launchButton = $('launch');
	const clearButton = $('clear');
	const tradeCanvas = $('c');

	let lastWX = 0;
	let lastWY = 0;
	let hoverPlanet = -1;
	let selected = -1;
	let aimPlanet = -1;
	let aiming = false;
	let armed = false;
	let aimAngle = 0;
	let aimSpeed = SPEED_MIN;
	let gripX = 0;
	let gripY = 0;
	let gripLen = 0;
	let dragTravel = 0;
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

	function planetAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < PLANETS; i++) {
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

	function strengthText(index) {
		const value = gravity.strength[index];
		return (value > 0 ? '+' : '') + value.toFixed(2);
	}

	function refreshSelected() {
		if (selected < 0) {
			selectedLabel = '';
			planetTagEl.textContent = 'none selected';
			gravitySlider.disabled = true;
			gravityLabel.textContent = '—';
			return;
		}
		selectedLabel = 'P' + selected + ' · g ' + strengthText(selected) +
			(gravity.strength[selected] < 0 ? ' repel' : '');
		planetTagEl.textContent = selectedLabel;
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
		if (hoverPlanet < 0) {
			hoverLabel = '';
			return;
		}
		hoverLabel = 'P' + hoverPlanet + ' · g ' + strengthText(hoverPlanet) +
			(gravity.strength[hoverPlanet] < 0 ? ' repel' : '');
	}

	/* grip position -> angle and speed; clamps the grip to the power circle */
	function updateAim() {
		const cx = tradeSim.planetX[aimPlanet];
		const cy = tradeSim.planetY[aimPlanet];
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
		const cx = tradeSim.planetX[aimPlanet];
		const cy = tradeSim.planetY[aimPlanet];
		gripLen = gravity.gripLength(aimSpeed);
		gripX = cx + Math.cos(aimAngle) * gripLen;
		gripY = cy + Math.sin(aimAngle) * gripLen;
		refreshAimLabel();
	}

	function startAim(planet, wx, wy) {
		aimPlanet = planet;
		aiming = true;
		armed = false;
		dragTravel = 0;
		gripX = wx;
		gripY = wy;
		updateAim();
		gravity.predCount = 0;
		dirty = true;
		hudAt = -Infinity;
	}

	function cancelAim() {
		aiming = false;
		armed = false;
		dirty = false;
		gravity.predCount = 0;
		hudAt = -Infinity;
	}

	function launch() {
		if (!armed) return;
		if (dirty) {
			gravity.predict(aimPlanet, aimAngle, aimSpeed);
			dirty = false;
		}
		gravity.launch(aimPlanet, aimAngle, aimSpeed);
		aiming = false;
		armed = false;
		hudAt = -Infinity;
	}

	function clearCargo() {
		gravity.clear();
		aiming = false;
		armed = false;
		dirty = false;
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
		const planet = planetAt(wx, wy);
		if (planet < 0) return;
		lastWX = wx;
		lastWY = wy;
		setSelected(planet);
		startAim(planet, wx, wy);
	}

	function onPointerMove(event) {
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		fine = event.shiftKey;
		if (aiming) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			dragTravel += Math.sqrt(dx * dx + dy * dy);
			const sens = fine ? SENS_FINE : 1;
			gripX += dx * sens;
			gripY += dy * sens;
			updateAim();
			dirty = true;
		} else {
			const planet = event.target === tradeCanvas ? planetAt(wx, wy) : -1;
			if (planet !== hoverPlanet) {
				hoverPlanet = planet;
				refreshHoverLabel();
			}
		}
		lastWX = wx;
		lastWY = wy;
	}

	function onPointerUp(event) {
		if (!aiming) return;
		aiming = false;
		fine = event.shiftKey;
		/* a click only selects; a deliberate drag arms the shot */
		const travelMin = 14 / view.scale;
		const reach = tradeSim.planetR[aimPlanet] + 6 / view.scale;
		if (dragTravel > travelMin && gripLen > reach && aimSpeed > SPEED_MIN + 4) {
			armed = true;
			dirty = true;
		} else {
			armed = false;
			dirty = false;
			gravity.predCount = 0;
		}
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
			gravity.predCount = 0;
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
		for (let i = 0; i < PLANETS; i++) {
			const g = gravity.strength[i];
			const mag = g < 0 ? -g : g;
			if (mag < 0.02) continue;
			const level = i === selected ? 2 : i === hoverPlanet ? 1 : 0;
			const colours = WELL_COLOURS[g < 0 ? 1 : 0];
			ctx.beginPath();
			ctx.arc(tradeSim.planetX[i], tradeSim.planetY[i],
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
		const cx = tradeSim.planetX[aimPlanet];
		const cy = tradeSim.planetY[aimPlanet];
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
		for (let i = 0; i < PLANETS; i++) {
			if (i !== selected && i !== hoverPlanet) continue;
			ctx.beginPath();
			ctx.arc(tradeSim.planetX[i], tradeSim.planetY[i],
				tradeSim.planetR[i] + 5 * px, 0, TAU);
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
			(below ? tradeSim.planetR[selected] * view.scale + 34 : 0);
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
		drawPrediction();
		drawTrail();
		drawAim();
		drawCargo(now);
		drawMarkers();
		ctx.restore();
		if (hoverPlanet >= 0 && hoverPlanet !== selected && !aiming) {
			drawLabel(hoverLabel, tradeSim.planetX[hoverPlanet],
				tradeSim.planetY[hoverPlanet], ICE);
		}
		if (selected >= 0) {
			drawLabel(selectedLabel, tradeSim.planetX[selected],
				tradeSim.planetY[selected], GOLD,
				(aiming || armed) && selected === aimPlanet);
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

	function endText(reason, planet) {
		if (reason === END_IMPACT) return 'impact P' + planet;
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
		if (hoverPlanet >= 0 && !aiming) {
			tag = 'hover P' + hoverPlanet + ' · ' + strengthText(hoverPlanet);
		} else if (selected >= 0) tag = selectedLabel;
		if (tag !== hudTagText) {
			hudTagText = tag;
			planetTagEl.textContent = tag;
		}
		trimSlider.disabled = !armed && selected < 0;
		launchButton.disabled = !armed;
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		expClockEl.textContent = formatClock((now - expStart) / 1000);

		let status = 'ready';
		if (aiming) status = 'aiming P' + aimPlanet;
		else if (armed) status = 'armed · P' + aimPlanet;
		else if (gravity.status === STATUS_FLYING) status = 'in flight';
		else if (gravity.status === STATUS_ENDED) {
			status = endText(gravity.endReason, gravity.endPlanet);
		}
		statusEl.textContent = status;

		if (gravity.status === GravitySim.STATUS_IDLE) {
			flightEl.textContent = '—';
		} else {
			flightEl.textContent = gravity.flightTime.toFixed(2) + ' s';
		}

		if (gravity.predCount >= 2) {
			pathEl.textContent = gravity.predTime.toFixed(1) + ' s · ' +
				endText(gravity.predReason, gravity.predPlanet);
			calcEl.textContent = gravity.predSteps + ' steps · ' +
				gravity.predMs.toFixed(2) + ' ms';
		} else {
			pathEl.textContent = '—';
			calcEl.textContent = '—';
		}

		if (armed) trimTargetEl.textContent = 'aim speed';
		else if (selected >= 0) trimTargetEl.textContent = 'P' + selected + ' g';
		else trimTargetEl.textContent = '—';
	}

	function frame(now) {
		const dt = Math.min(0.1, (now - lastFrame) / 1000);
		lastFrame = now;
		gravity.step(dt);
		if ((armed || aiming) && dirty) {
			gravity.predict(aimPlanet, aimAngle, aimSpeed);
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
		fieldChanged();
	});
	trimSlider.addEventListener('input', onTrimInput);
	trimSlider.addEventListener('change', resetTrim);
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

	resizeOverlay();
	refreshSelected();
	refreshAimLabel();
	updateAimHud();
	updateHud(performance.now());
	requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);
