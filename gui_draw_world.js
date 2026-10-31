/*
 * The world layer of the canvas: visit outline, gravity wells, mass signs, port velocities, the prediction path, the trail, cargo, the aim overlay, markers and labels.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* highlights the planet's own outline plus a tight outer ring, leaving thin orbits untouched */
function drawPlanetVisitOutline(x, y, r, px, pulse, inside) {
	ctx.setLineDash(NO_DASH);
	ctx.beginPath();
	ctx.arc(x, y, r + 0.5 * px, 0, TAU);
	ctx.strokeStyle = inside ? 'rgba(205, 255, 224, 0.98)' : 'rgba(92, 255, 139, 0.96)';
	ctx.lineWidth = (inside ? 2.2 : 1.9) * px;
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(x, y, r + (inside ? 3.8 : 3.4 + pulse * 1.6) * px, 0, TAU);
	ctx.strokeStyle = inside ? 'rgba(158, 255, 190, 0.92)' : 'rgba(92, 255, 139, 0.78)';
	ctx.lineWidth = (inside ? 1.5 : 1.3) * px;
	ctx.stroke();
}

/* Past visits stay dim outside clean career view; active/upcoming planet visits
 * highlight the planet outline + outer ring (and omit thick orbit rings when clean). */
function drawSystemVisits(now) {
	if (routeRule()) return;
	const sim = activeSim();
	const px = 1 / view.scale;
	const activePred = aiming || armed || sim.status === STATUS_FLYING;
	const clean = careerRule() && cleanCareerView;
	const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
	SYS_DASH[0] = 5 * px;
	SYS_DASH[1] = 5 * px;
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		const inside = liveHarvestMask[i] === 1;
		const willVisit = inside || (activePred &&
			(game.on ? predHarvestMask[i] === 1 : sim.predVisit[i] === 1));
		if (clean) {
			if (willVisit) {
				drawPlanetVisitOutline(tradeSim.planetX[i], tradeSim.planetY[i],
					tradeSim.planetR[i], px, pulse, inside);
			}
			continue;
		}
		const wasVisited = sim.visited[i] === 1;
		if (!wasVisited && !willVisit) continue;
		const x = tradeSim.planetX[i];
		const y = tradeSim.planetY[i];
		const r = tradeSim.planetR[i];
		ctx.beginPath();
		ctx.ellipse(x, y, tradeSim.orbitRX[i], tradeSim.orbitRY[i],
			tradeSim.orbitTilt[i], 0, TAU);
		if (!willVisit) {
			ctx.setLineDash(NO_DASH);
			ctx.strokeStyle = 'rgba(142, 240, 192, 0.14)';
			ctx.lineWidth = 1.1 * px;
			ctx.stroke();

			ctx.beginPath();
			ctx.arc(x, y, r + 3.2 * px, 0, TAU);
			ctx.strokeStyle = 'rgba(142, 240, 192, 0.38)';
			ctx.lineWidth = 1.25 * px;
			ctx.stroke();
			continue;
		}
		ctx.setLineDash(SYS_DASH);
		ctx.strokeStyle = 'rgba(92, 255, 139, 0.85)';
		ctx.lineWidth = 1.35 * px;
		ctx.stroke();
		drawPlanetVisitOutline(x, y, r, px, pulse, inside);
	}
	ctx.setLineDash(NO_DASH);
}

/* highlights the landed body where the next launch must originate */
function drawLandedBase(now) {
	const base = activeSim().landedBody;
	if (base < 0) return;
	const px = 1 / view.scale;
	const x = tradeSim.planetX[base];
	const y = tradeSim.planetY[base];
	const r = tradeSim.planetR[base];
	const pulse = 0.5 + 0.5 * Math.sin(now * 0.0055);
	const inner = r + 5.5 * px;
	const outer = inner + (4 + pulse * 3) * px;

	ctx.setLineDash(NO_DASH);
	ctx.beginPath();
	ctx.arc(x, y, inner, 0, TAU);
	ctx.strokeStyle = MINT;
	ctx.lineWidth = 1.6 * px;
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(x, y, outer, 0, TAU);
	ctx.strokeStyle = 'rgba(255, 207, 110, 0.45)';
	ctx.lineWidth = 1.0 * px;
	ctx.stroke();

	/* four launch-pad ticks around the landed planet */
	const tick0 = inner + 1.5 * px;
	const tick1 = tick0 + 4.5 * px;
	ctx.beginPath();
	ctx.moveTo(x - tick1, y);
	ctx.lineTo(x - tick0, y);
	ctx.moveTo(x + tick0, y);
	ctx.lineTo(x + tick1, y);
	ctx.moveTo(x, y - tick1);
	ctx.lineTo(x, y - tick0);
	ctx.moveTo(x, y + tick0);
	ctx.lineTo(x, y + tick1);
	ctx.strokeStyle = GOLD;
	ctx.lineWidth = 1.4 * px;
	ctx.stroke();
}

function activeBlockedPlanet(now) {
	if (aiming) return -1;
	if (routeRule()) {
		const hoverBy = routeOccupiedBy(hoverPlanet);
		if (hoverBy >= 0) {
			blockedKind = 1;
			blockedBy = hoverBy;
			return hoverPlanet;
		}
		if (blockedKind === 1 && blockedPlanet >= 0 && now < blockedUntil) {
			return blockedPlanet;
		}
		return -1;
	}
	const landed = activeSim().landedBody;
	if (landed < 0) return -1;
	blockedKind = 0;
	blockedBy = -1;
	if (hoverPlanet >= 0 && hoverPlanet !== landed) return hoverPlanet;
	if (blockedPlanet >= 0 && blockedPlanet !== landed && now < blockedUntil) {
		return blockedPlanet;
	}
	return -1;
}

/* guide vector + arrowheads from a non-landed planet to the landed base */
function drawBlockedArrowWorld(src, now) {
	const dst = activeSim().landedBody;
	if (dst < 0) return;
	const px = 1 / view.scale;
	const x0 = tradeSim.planetX[src];
	const y0 = tradeSim.planetY[src];
	const x1 = tradeSim.planetX[dst];
	const y1 = tradeSim.planetY[dst];
	const dx = x1 - x0;
	const dy = y1 - y0;
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (dist < 1e-3) return;
	const angle = Math.atan2(dy, dx);
	const ux = dx / dist;
	const uy = dy / dist;
	const startGap = tradeSim.planetR[src] + 7 * px;
	const endGap = tradeSim.planetR[dst] + 10 * px;
	if (dist <= startGap + endGap) return;

	ctx.beginPath();
	ctx.arc(x0, y0, tradeSim.planetR[src] + 5 * px, 0, TAU);
	ctx.strokeStyle = WARN;
	ctx.lineWidth = 1.4 * px;
	ctx.setLineDash(NO_DASH);
	ctx.stroke();

	LOCK_DASH[0] = 6 * px;
	LOCK_DASH[1] = 6 * px;
	const sx = x0 + ux * startGap;
	const sy = y0 + uy * startGap;
	const ex = x1 - ux * endGap;
	const ey = y1 - uy * endGap;
	ctx.beginPath();
	ctx.moveTo(sx, sy);
	ctx.lineTo(ex, ey);
	ctx.strokeStyle = 'rgba(255, 148, 120, 0.72)';
	ctx.lineWidth = 1.35 * px;
	ctx.setLineDash(LOCK_DASH);
	ctx.stroke();
	ctx.setLineDash(NO_DASH);

	/* animated chevrons streaming toward the landed planet */
	const span = dist - startGap - endGap;
	const phase = (now * 0.09 * px) % (90 * px);
	ctx.fillStyle = GOLD;
	for (let d = phase; d < span - 14 * px; d += 90 * px) {
		const cx = sx + ux * d;
		const cy = sy + uy * d;
		ctx.beginPath();
		ctx.moveTo(cx + ux * 5 * px, cy + uy * 5 * px);
		ctx.lineTo(cx + Math.cos(angle + 2.5) * 4.2 * px,
			cy + Math.sin(angle + 2.5) * 4.2 * px);
		ctx.lineTo(cx + Math.cos(angle - 2.5) * 4.2 * px,
			cy + Math.sin(angle - 2.5) * 4.2 * px);
		ctx.closePath();
		ctx.fill();
	}

	ctx.beginPath();
	ctx.moveTo(ex + ux * 4 * px, ey + uy * 4 * px);
	ctx.lineTo(ex + Math.cos(angle + 2.55) * 7 * px,
		ey + Math.sin(angle + 2.55) * 7 * px);
	ctx.lineTo(ex + Math.cos(angle - 2.55) * 7 * px,
		ey + Math.sin(angle - 2.55) * 7 * px);
	ctx.closePath();
	ctx.fillStyle = WARN;
	ctx.fill();
}

function drawOccupiedPlanetWorld(src) {
	const px = 1 / view.scale;
	const x = tradeSim.planetX[src];
	const y = tradeSim.planetY[src];
	const r = tradeSim.planetR[src] + 5 * px;
	ctx.setLineDash(NO_DASH);
	ctx.beginPath();
	ctx.arc(x, y, r, 0, TAU);
	ctx.strokeStyle = WARN;
	ctx.lineWidth = 1.5 * px;
	ctx.stroke();
	const arm = r * 0.62;
	ctx.beginPath();
	ctx.moveTo(x - arm, y - arm);
	ctx.lineTo(x + arm, y + arm);
	ctx.moveTo(x + arm, y - arm);
	ctx.lineTo(x - arm, y + arm);
	ctx.strokeStyle = WARN;
	ctx.lineWidth = 1.3 * px;
	ctx.stroke();
}

function drawBlockedTooltipScreen(src) {
	if (blockedKind === 1) {
		const sx = tradeSim.planetX[src] * view.scale + view.offX;
		const sy = tradeSim.planetY[src] * view.scale + view.offY;
		const who = blockedBy >= 0 && blockedBy < RIVAL_TAGS.length
			? RIVAL_TAGS[blockedBy]
			: slotIsBot(0) ? 'BOT' : 'YOU';
		const text = planetName(src) + ' occupied by ' + who +
			' · choose another start planet';
		const width = 18 + text.length * 6.45;
		const height = 22;
		let x = sx + 14;
		let y = sy + 14;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y + height > window.innerHeight - 10) y = sy - height - 16;
		plate(x, y, width, height, 'rgba(255, 148, 120, 0.55)');
		ctx.fillStyle = WARN;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 9, y + height * 0.5 + 0.5);
		return;
	}
	const dst = activeSim().landedBody;
	if (dst < 0) return;
	const sx = tradeSim.planetX[src] * view.scale + view.offX;
	const sy = tradeSim.planetY[src] * view.scale + view.offY;
	const dx = tradeSim.planetX[dst] - tradeSim.planetX[src];
	const dy = tradeSim.planetY[dst] - tradeSim.planetY[src];
	const angle = Math.atan2(dy, dx);
	const text = 'launch not allowed · ship landed at ' + planetName(dst);
	const width = 36 + text.length * 6.45;
	const height = 22;
	let x = sx + 14;
	let y = sy + 14;
	if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
	if (y + height > window.innerHeight - 10) y = sy - height - 16;
	plate(x, y, width, height, 'rgba(255, 148, 120, 0.55)');

	/* inline directional arrow pointing directly toward the landed planet */
	const ax = x + 14;
	const ay = y + height * 0.5;
	const ux = Math.cos(angle);
	const uy = Math.sin(angle);
	ctx.strokeStyle = WARN;
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(ax - ux * 5.5, ay - uy * 5.5);
	ctx.lineTo(ax + ux * 5.5, ay + uy * 5.5);
	ctx.stroke();
	ctx.fillStyle = GOLD;
	ctx.beginPath();
	ctx.moveTo(ax + ux * 7, ay + uy * 7);
	ctx.lineTo(ax + Math.cos(angle + 2.45) * 3.5, ay + Math.sin(angle + 2.45) * 3.5);
	ctx.lineTo(ax + Math.cos(angle - 2.45) * 3.5, ay + Math.sin(angle - 2.45) * 3.5);
	ctx.closePath();
	ctx.fill();

	ctx.fillStyle = WARN;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
	ctx.fillText(text, x + 26, y + height * 0.5 + 0.5);
}

function drawWells() {
	const px = 1 / view.scale;
	REPEL_DASH[0] = 4 * px;
	REPEL_DASH[1] = 7 * px;
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		const g = cargoSim.strength[i] * cargoSim.gravityScale;
		const mag = g < 0 ? -g : g;
		if (mag < 0.02) continue;
		const level = i === selected ? 2 : i === hoverBody ? 1 : 0;
		if (viewMode !== VIEW_SPACE && level === 0) continue;
		const colours = WELL_COLOURS[g < 0 ? 1 : 0];
		ctx.beginPath();
		ctx.arc(cargoSim.bodyX[i], cargoSim.bodyY[i],
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

function drawSigns() {
	const px = 1 / view.scale;
	ctx.lineCap = 'round';
	ctx.setLineDash(NO_DASH);
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		const g = cargoSim.strength[i];
		if (g > -0.02 && g < 0.02) continue;
		const x = cargoSim.bodyX[i];
		const y = cargoSim.bodyY[i];
		let arm = cargoSim.bodyR[i] * 0.6;
		if (arm < 3.2 * px) arm = 3.2 * px;
		if (arm > 9 * px) arm = 9 * px;
		const colour = g > 0 ? SIGN_POS : SIGN_NEG;
		const signGlow = g > 0 ? 'rgba(255, 95, 87, 0.22)' : 'rgba(87, 168, 255, 0.22)';
		ctx.strokeStyle = signGlow;
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
			ctx.arc(x, y, cargoSim.bodyR[i] + 1.5 * px, 0, TAU);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
			ctx.lineWidth = px;
			ctx.stroke();
		}
	}
	ctx.lineCap = 'butt';
}

/* Potential view marks intrinsically heavy bodies in red without changing the
 * signed-potential palette underneath. The threshold is the body's own g, not
 * the experimental world multiplier. */
function drawPotentialHeavy() {
	const px = 1 / view.scale;
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		if (cargoSim.strength[i] < HEAVY_G) continue;
		const x = cargoSim.bodyX[i];
		const y = cargoSim.bodyY[i];
		const r = cargoSim.bodyR[i];
		ctx.beginPath();
		ctx.arc(x, y, r + 2 * px, 0, TAU);
		ctx.fillStyle = 'rgba(255, 95, 87, 0.28)';
		ctx.fill();
		ctx.beginPath();
		ctx.arc(x, y, r + 5 * px, 0, TAU);
		ctx.strokeStyle = SIGN_POS;
		ctx.lineWidth = 1.6 * px;
		ctx.stroke();
	}
}

function drawPortVelocities() {
	if (mode !== MODE_PORTS || cargoSim.fieldRate === 0) return;
	const px = 1 / view.scale;
	if (Math.abs(cargoSim.fieldRate) < 0.05) return;
	ctx.lineCap = 'round';
	ctx.setLineDash(NO_DASH);
	const t = tradeSim.t;
	const eps = 0.12;
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		const planet = fieldPortPlanet[i];
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
		const vx = (x1 - x0) / eps * cargoSim.fieldRate;
		const vy = (y1 - y0) / eps * cargoSim.fieldRate;
		const speed = Math.sqrt(vx * vx + vy * vy);
		if (speed < 0.15 / px) continue;
		const x = cargoSim.bodyX[i];
		const y = cargoSim.bodyY[i];
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
	const slot = activeSlotIndex();
	const sim = slotSim(slot);
	const count = sim.predCount;
	if (count < 2) return;
	const px = 1 / view.scale;
	PRED_DASH[0] = 6 * px;
	PRED_DASH[1] = 6 * px;
	const pathX = sim.predX;
	const pathY = sim.predY;
	const stride = count > 6000 ? 4 : count > 1400 ? 2 : 1;
	const isLeader = routeRule() &&
		((slot === 0 && routeLeader === -1) || (slot > 0 && routeLeader === slot - 1));
	ctx.beginPath();
	ctx.moveTo(pathX[0], pathY[0]);
	for (let i = stride; i < count; i += stride) ctx.lineTo(pathX[i], pathY[i]);
	const last = count - 1;
	if (last % stride !== 0) ctx.lineTo(pathX[last], pathY[last]);
	ctx.strokeStyle = isLeader ? GOLD : 'rgba(255, 207, 110, 0.78)';
	ctx.lineWidth = (isLeader ? 2.1 : 1.3) * px;
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
	ctx.strokeStyle = sim.predReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.65)';
	ctx.lineWidth = 1.2 * px;
	ctx.stroke();
	if (sim.predReason === END_IMPACT) {
		ctx.beginPath();
		ctx.arc(ex, ey, 2 * px, 0, TAU);
		ctx.fillStyle = GOLD;
		ctx.fill();
	}
	if (isLeader) {
		ctx.beginPath();
		ctx.arc(ex, ey, 9 * px, 0, TAU);
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.1 * px;
		ctx.stroke();
	}
}

function drawTrail() {
	if (careerRule() && cleanCareerView) return;
	const count = cargoSim.trailCount;
	if (count < 2) return;
	const px = 1 / view.scale;
	const stride = count > 2400 ? 2 : 1;
	ctx.beginPath();
	ctx.moveTo(cargoSim.trailX[0], cargoSim.trailY[0]);
	for (let i = stride; i < count; i += stride) {
		ctx.lineTo(cargoSim.trailX[i], cargoSim.trailY[i]);
	}
	const last = count - 1;
	if (last % stride !== 0) ctx.lineTo(cargoSim.trailX[last], cargoSim.trailY[last]);
	ctx.strokeStyle = 'rgba(103, 224, 255, 0.9)';
	ctx.lineWidth = 1.8 * px;
	ctx.setLineDash(NO_DASH);
	ctx.stroke();
}

function drawCargo(now) {
	if (cargoSim.status === GravitySim.STATUS_IDLE) return;
	const px = 1 / view.scale;
	const x = cargoSim.cargo.x;
	const y = cargoSim.cargo.y;
	if (cargoSim.status === STATUS_FLYING) {
		if (burnPaused) {
			const holdPulse = 0.5 + 0.5 * Math.sin(now * 0.006);
			ctx.beginPath();
			ctx.arc(x, y, (8 + holdPulse * 3) * px, 0, TAU);
			ctx.strokeStyle = ICE;
			ctx.lineWidth = 1.25 * px;
			ctx.stroke();
		}
		const angle = Math.atan2(cargoSim.cargo.vy, cargoSim.cargo.vx);
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
	ctx.strokeStyle = cargoSim.endReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.6)';
	ctx.lineWidth = 1.2 * px;
	ctx.stroke();
}

function drawAim() {
	const isBurn = (burnArmed || burnAiming) && cargoSim.status === STATUS_FLYING;
	if (!isBurn && !armed && !aiming) return;
	const px = 1 / view.scale;
	const cx = isBurn ? cargoSim.cargo.x : tradeSim.planetX[aimBody];
	const cy = isBurn ? cargoSim.cargo.y : tradeSim.planetY[aimBody];
	const angle = isBurn ? burnAngle : aimAngle;
	const mainStroke = isBurn ? ICE : GOLD;
	GRIP_DASH[0] = 3 * px;
	GRIP_DASH[1] = 7 * px;
	ctx.beginPath();
	ctx.arc(cx, cy, GRIP_MAX, 0, TAU);
	ctx.strokeStyle = isBurn ? 'rgba(103, 224, 255, 0.14)' : 'rgba(255, 207, 110, 0.10)';
	ctx.lineWidth = px;
	ctx.setLineDash(GRIP_DASH);
	ctx.stroke();
	ctx.setLineDash(NO_DASH);

	const sim = activeSim();
	const sx = !isBurn && sim.predCount > 0 ? sim.predX[0] : cx;
	const sy = !isBurn && sim.predCount > 0 ? sim.predY[0] : cy;
	ctx.beginPath();
	ctx.moveTo(sx, sy);
	ctx.lineTo(gripX, gripY);
	ctx.strokeStyle = isBurn ? 'rgba(103, 224, 255, 0.85)' : 'rgba(255, 207, 110, 0.82)';
	ctx.lineWidth = 1.2 * px;
	ctx.stroke();

	const size = (4 + (gripLen > 0 ? gripLen / GRIP_MAX : 0) * 4) * px;
	ctx.beginPath();
	ctx.arc(gripX, gripY, size, 0, TAU);
	ctx.fillStyle = isBurn ? 'rgba(103, 224, 255, 0.18)' : 'rgba(255, 207, 110, 0.16)';
	ctx.fill();
	ctx.strokeStyle = mainStroke;
	ctx.lineWidth = 1.4 * px;
	ctx.stroke();
	const tip = 11 * px;
	const side = 4.5 * px;
	ctx.beginPath();
	ctx.moveTo(gripX + Math.cos(angle) * tip, gripY + Math.sin(angle) * tip);
	ctx.lineTo(gripX + Math.cos(angle + 2.5) * side,
		gripY + Math.sin(angle + 2.5) * side);
	ctx.lineTo(gripX + Math.cos(angle - 2.5) * side,
		gripY + Math.sin(angle - 2.5) * side);
	ctx.closePath();
	ctx.fillStyle = mainStroke;
	ctx.fill();
}

function drawMarkers() {
	const px = 1 / view.scale;
	for (let i = 0; i < cargoSim.bodyCount; i++) {
		if (i !== selected && i !== hoverBody) continue;
		ctx.beginPath();
		ctx.arc(cargoSim.bodyX[i], cargoSim.bodyY[i],
			cargoSim.bodyR[i] + 5 * px, 0, TAU);
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
		(below ? cargoSim.bodyR[selected] * view.scale + 34 : 0);
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
	if (!aimLabel || (!armed && !aiming && !burnArmed && !burnAiming)) return;
	ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
	const sx = gripX * view.scale + view.offX + 16;
	const sy = gripY * view.scale + view.offY - 12;
	const width = 20 + aimLabel.length * 6.7;
	let x = sx;
	let y = sy - 18;
	if (y < 8) y = sy + 22;
	if (x + width > window.innerWidth - 8 || rectUnderHud(x, y, width, 20)) {
		x = sx - width - 32;
		for (let i = 0; i < hudRectEls.length; i++) {
			const o = i * 4;
			const left = hudRects[o];
			const right = hudRects[o + 2];
			const bottom = hudRects[o + 3];
			if (right <= left || bottom <= hudRects[o + 1]) continue;
			if (y >= bottom || y + 20 <= hudRects[o + 1]) continue;
			if (x < right && x + width > left && left > width + 12) {
				x = left - width - 6;
			}
		}
		if (x < 8) x = 8;
	}
	plate(x, y, width, 20);
	ctx.fillStyle = !careerRule() || aimGuidance === 0
		? fine ? ICE : GOLD : aimGuidance === 1 ? MINT : WARN;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(aimLabel, x + 10, y + 10.5);
}
