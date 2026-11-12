/*
 * The economy layer of the canvas: route pills, rival ships and their tags, planet profit pills, EMC claim rings and the career trade pads.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function drawRoutePlanEntry(sim, leader, colour, dimColour, px) {
	const planCount = sim.predCount;
	const planStride = planCount > 6000 ? 4 : planCount > 1400 ? 2 : 1;
	ctx.beginPath();
	ctx.moveTo(sim.predX[0], sim.predY[0]);
	for (let i = planStride; i < planCount; i += planStride) {
		ctx.lineTo(sim.predX[i], sim.predY[i]);
	}
	const planLast = planCount - 1;
	if (planLast % planStride !== 0) {
		ctx.lineTo(sim.predX[planLast], sim.predY[planLast]);
	}
	ctx.strokeStyle = leader ? colour : dimColour;
	ctx.lineWidth = (leader ? 2.1 : 1.25) * px;
	PRED_DASH[0] = 6 * px;
	PRED_DASH[1] = 6 * px;
	ctx.setLineDash(PRED_DASH);
	ctx.stroke();
	ctx.setLineDash(NO_DASH);
	ctx.beginPath();
	ctx.arc(sim.predX[planLast], sim.predY[planLast],
		(leader ? 6 : 4.5) * px, 0, TAU);
	ctx.strokeStyle = colour;
	ctx.lineWidth = 1.2 * px;
	ctx.stroke();
	if (leader) {
		ctx.beginPath();
		ctx.arc(sim.predX[planLast], sim.predY[planLast], 9 * px, 0, TAU);
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.1 * px;
		ctx.stroke();
	}
}

function drawRivalsWorld(now) {
	const px = 1 / view.scale;
	const active = activeSlotIndex();
	if (active > 0) {
		drawTrail(slotSim(0), true);
		drawCargo(now, slotSim(0), true);
	}
	if (active > 0 && routeRule() && slotSim(0).predCount >= 2) {
		drawRoutePlanEntry(slotSim(0), routeLeader === -1, MINT,
			'rgba(142, 240, 192, 0.48)', px);
	}
	for (let rIdx = 0; rIdx < bot.count; rIdx++) {
		const r = bot.rivals[rIdx];
		const sim = r.sim;
		const colour = RIVAL_COLOURS[rIdx];
		/* in route, the rival's current best plan is its entry—no ship flies */
		if (routeRule() && sim.predCount >= 2 && active !== rIdx + 1) {
			drawRoutePlanEntry(sim, routeLeader === rIdx, colour, RIVAL_TRAILS[rIdx], px);
		}
		if (active === rIdx + 1) continue;
		/* rival trail */
		const count = sim.trailCount;
		if (count >= 2 && !(careerRule() && cleanCareerView)) {
			const stride = count > 2400 ? 2 : 1;
			ctx.beginPath();
			ctx.moveTo(sim.trailX[0], sim.trailY[0]);
			for (let i = stride; i < count; i += stride) {
				ctx.lineTo(sim.trailX[i], sim.trailY[i]);
			}
			const last = count - 1;
			if (last % stride !== 0) ctx.lineTo(sim.trailX[last], sim.trailY[last]);
			ctx.strokeStyle = RIVAL_TRAILS[rIdx];
			ctx.lineWidth = 1.4 * px;
			ctx.setLineDash(NO_DASH);
			ctx.stroke();
		}
		/* rival base diamond when parked at a planet */
		if (sim.status !== STATUS_FLYING && r.basePlanet >= 0) {
			const bx = tradeSim.planetX[r.basePlanet];
			const by = tradeSim.planetY[r.basePlanet];
			const br = tradeSim.planetR[r.basePlanet] + (6 + rIdx * 3.5) * px;
			ctx.beginPath();
			ctx.moveTo(bx, by - br);
			ctx.lineTo(bx + br, by);
			ctx.lineTo(bx, by + br);
			ctx.lineTo(bx - br, by);
			ctx.closePath();
			ctx.strokeStyle = colour;
			ctx.globalAlpha = 0.68;
			ctx.lineWidth = 1.15 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
		/* rival ship chevron in flight or ring when ended */
		if (sim.status === STATUS_FLYING) {
			const x = sim.cargo.x;
			const y = sim.cargo.y;
			const angle = Math.atan2(sim.cargo.vy, sim.cargo.vx);
			const size = 4.3 * px;
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
			ctx.lineTo(x + Math.cos(angle + 2.4) * size, y + Math.sin(angle + 2.4) * size);
			ctx.lineTo(x + Math.cos(angle - 2.4) * size, y + Math.sin(angle - 2.4) * size);
			ctx.closePath();
			ctx.fillStyle = colour;
			ctx.fill();
			ctx.strokeStyle = 'rgba(3, 8, 16, 0.85)';
			ctx.lineWidth = 0.8 * px;
			ctx.stroke();
		} else if (sim.status === STATUS_ENDED) {
			const pulse = 0.5 + 0.5 * Math.sin(now * 0.005 + rIdx);
			ctx.beginPath();
			ctx.arc(sim.cargo.x, sim.cargo.y, (4.2 + pulse * 2.5) * px, 0, TAU);
			ctx.strokeStyle = colour;
			ctx.globalAlpha = 0.7;
			ctx.lineWidth = 1.1 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}
}

/*
 * Per-planet visit-profit + gravity cards beneath each planet in game mode.
 * Cached strings and predHarvestMask keep draw() allocation-free. A claimed
 * planet keeps its owner's border; neutral planets keep the profit palette.
 *
 * Two greens: the systems the traced path will still enter, and — while a
 * ship flies — the ones it is inside right now. The second set comes from
 * the ledger's live inside-flags, not from the trace: the trace starts at
 * the ship, so a system being harvested has already left its log, and the
 * pill would go dark exactly when the money arrives. The flags are cleared
 * by the same step that flies the ship out, so the pill drops on exit.
 */
function drawPlanetProfits() {
	const step = game.clockSteps;
	ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const maxX = window.innerWidth - 42;
	const maxY = window.innerHeight - 18;
	const capital = careerRule() ? game.career.capitalPlanet : -1;
	const arf = careerRule() ? game.career.arfPlanet : -1;
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		const isCapital = i === capital;
		const isArf = i === arf;
		/* what this ship's visit would pay: nothing on a quiet planet, nothing
		 * anywhere without the observation device */
		const val = GravityGame.visitReports(game.money, game.market, i)
			? GravityGame.planetProfit(game.market, i, step) : 0;
		let cents = Math.round(val * 100);
		if (cents < 0) cents = 0;
		else if (cents > PROFIT_MAX_CENTS) cents = PROFIT_MAX_CENTS;
		const g = mode === MODE_PORTS ? portPlanetStrength[i] : planetStrength[i];
		let gi = Math.round(g * 100) + 200;
		if (gi < 0) gi = 0;
		else if (gi >= GRAVITY_STRINGS.length) gi = GRAVITY_STRINGS.length - 1;
		const sx = tradeSim.planetX[i] * view.scale + view.offX;
		const sy = (tradeSim.planetY[i] + tradeSim.planetR[i]) * view.scale + view.offY + 11;
		const width = 52;
		const height = 28;
		let x = sx - width * 0.5;
		let y = sy - 7;
		if (x < 4) x = 4;
		else if (x > maxX - width + 38) x = maxX - width + 38;
		if (y < 4) y = 4;
		else if (y > maxY - height + 14) y = maxY - height + 14;
		const inside = liveHarvestMask[i] === 1;
		const onRoute = inside || predHarvestMask[i] === 1;
		const owner = careerRule() ? GravityGame.claimOwner(game.galaxy, i) : -1;
		const rebel = careerRule() && game.market.rebel[i] === 1;
		const seized = careerRule() && game.market.seized[i] === 1;
		const quiet = careerRule() && game.market.quiet[i] === 1;
		const border = rebel ? REBEL
			: isCapital ? 'rgba(255, 207, 110, 0.85)'
			: seized ? 'rgba(255, 148, 120, 0.45)'
			: quiet ? QUIET_COLOUR
			: isArf ? 'rgba(142, 240, 192, 0.7)'
			: owner === 0 ? MINT
			: owner > 0 ? RIVAL_COLOURS[owner - 1]
			: inside ? 'rgba(158, 255, 190, 0.95)'
			: onRoute ? 'rgba(92, 255, 139, 0.6)'
			: cents >= 100 ? 'rgba(255, 207, 110, 0.42)'
			: cents >= 50 ? 'rgba(142, 240, 192, 0.28)'
			: null;
		plate(x, y, width, height, border);
		ctx.fillStyle = isCapital ? GOLD
			: inside ? '#ffffff' : onRoute ? '#9effbe'
			: cents >= 100 ? GOLD
			: cents >= 50 ? MINT
			: cents >= 14 ? 'rgba(210, 230, 246, 0.86)'
			: 'rgba(128, 156, 184, 0.52)';
		ctx.fillText(isCapital ? CAPITAL_PROFIT_TEXT : PROFIT_STRINGS[cents], x + width * 0.5, y + 7.5);
		ctx.fillStyle = g < 0 ? SIGN_NEG : g >= HEAVY_G ? SIGN_POS : 'rgba(210, 230, 246, 0.82)';
		ctx.fillText(GRAVITY_STRINGS[gi], x + width * 0.5, y + 20.5);
		if (isCapital || isArf || rebel || seized ||
			(careerRule() && game.market.corruption[i] >= CORRUPTION_TAG_MIN)) {
			const topY = tradeSim.planetY[i] * view.scale + view.offY -
				tradeSim.planetR[i] * view.scale;
			ctx.fillStyle = rebel ? REBEL : seized ? 'rgba(255, 148, 120, 0.8)'
				: isCapital ? GOLD : quiet ? QUIET_COLOUR : MINT;
			ctx.fillText(rebel ? REBEL_TAG : isCapital ? CAPITAL_TAG : isArf ? ARF_TAG
				: (quiet ? QUIET_STRINGS : CORRUPTION_STRINGS)[Math.round(game.market.corruption[i])],
				sx, topY - 5);
		}
	}
}

/*
 * Every player EMC is a claim ring around its planet plus its barrel, in
 * the owner's colour (mint = YOU, the rival colours after it). The barrel
 * turns once per 2…5 s of in-game career time and the queued launch fires
 * when it lines up with the aim. While the career clock is paused the
 * barrel holds its position. The neutral commercial rail shows only a dim
 * barrel, so an unclaimed planet still reads as "you can leave from here".
 */
function drawCareerEmc() {
	const galaxy = game.galaxy;
	if (galaxy.actors.length === 0) return;
	const px = 1 / view.scale;
	/* career runs on in-game time: the clock is frozen while paused, so the
	 * barrel does not rotate then */
	const seconds = game.clockSteps * DT;
	for (let p = 0; p < PLANETS; p++) {
		if (!planetMask[p]) continue;
		const owner = GravityGame.claimOwner(galaxy, p);
		const x = tradeSim.planetX[p];
		const y = tradeSim.planetY[p];
		const r = tradeSim.planetR[p];
		const angle = GravityGame.turretAngle(galaxy, p, seconds);
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const inner = r + 3.5 * px;
		const outer = r + 13 * px;
		ctx.lineWidth = owner < 0 ? 1.2 * px : 2 * px;
		ctx.strokeStyle = owner < 0 ? 'rgba(150, 178, 204, 0.34)'
			: owner === 0 ? MINT : RIVAL_COLOURS[owner - 1];
		ctx.beginPath();
		ctx.moveTo(x + cos * inner, y + sin * inner);
		ctx.lineTo(x + cos * outer, y + sin * outer);
		ctx.stroke();
		if (owner < 0) continue;
		ctx.beginPath();
		ctx.arc(x, y, r + 6.5 * px, 0, TAU);
		ctx.globalAlpha = 0.5;
		ctx.lineWidth = 1.3 * px;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
}

/* pad plate: catapult tier, battery charge, speed cap of the rail the career
 * fires from on a planet. The landed planet keeps its plate always on; every
 * other planet with a real battery (own or rival rail) shows the same plate
 * while the pointer rests on it. The commercial EMC-1 is always charged, so
 * it gets no charge readout. Strings are cached so draw() stays 0-alloc; the
 * key covers every input of the text: planet, owner, tier, charge, ship mass
 * and the force scale. */
const padPlate = { key: -1, text: '', frac: 0, warn: false };
const hoverPadPlate = { key: -1, text: '', frac: 0, warn: false };

/* null = nothing to read here (a commercial rail off the landed planet) */
function padPlateInfo(career, planet, plate) {
	const pad = planet >= 0 ? GravityGame.padAt(career, planet) : null;
	const owner = planet >= 0 ? GravityGame.padOwner(career, planet) : GravityGame.OWNER_COMMERCIAL;
	const charged = pad !== null && pad.catapult !== null && owner !== GravityGame.OWNER_COMMERCIAL;
	const landed = planet === career.at;
	if (!charged && !landed) return null;
	const tier = pad && pad.catapult ? pad.catapult.tier : 0;
	const mass = career.ship.mass;
	const key = (((((planet + 1) * 8 + (owner + 2)) * 16 + tier) * 20000 +
		(charged ? Math.round(pad.chargeKwh * 100) : 0)) * 40000 +
		Math.round(mass * 100)) * 400 + Math.round(forceScale * 100);
	if (key === plate.key) return plate;
	plate.key = key;
	if (!pad) {
		plate.text = 'lost in space';
		plate.frac = 0;
		plate.warn = true;
		return plate;
	}
	if (!charged) {
		plate.text = planetName(planet) + ' · no catapult';
		plate.frac = 0;
		plate.warn = true;
		return plate;
	}
	/* the plate prices the rail of the company it is drawn for, not the ship
	 * the page happens to have selected */
	const free = pad.chargeKwh - pad.reservedKwh;
	const limit = OrbitTech.speedLimit(free > 0 ? free : 0, career.ship.mass,
		pad.catapult, forceScale);
	const tag = owner === career.index ? '' : (owner === 0 ? 'YOU ' : 'R' + owner + ' ');
	plate.text = tag + pad.catapult.id + ' · ' + pad.chargeKwh.toFixed(2) + ' kWh · ' +
		Math.round(limit) + ' px/s';
	plate.frac = pad.chargeKwh / pad.battery.capacity;
	/* same rule the bot uses to repair a pad: can the ship even leave? */
	plate.warn = limit < GravitySim.SPEED_MIN + 1e-9;
	return plate;
}

function careerPadPlate(career) {
	return padPlateInfo(career, career.at, padPlate);
}

function drawPadPlate(planet, info) {
	const width = 200;
	const height = 18;
	const sx = tradeSim.planetX[planet] * view.scale + view.offX;
	const sy = tradeSim.planetY[planet] * view.scale + view.offY;
	const radius = tradeSim.planetR[planet] * view.scale + 8;
	const maxX = window.innerWidth - width - 6;
	const maxY = window.innerHeight - height - 6;
	/* below, above, right, left of the planet: the first slot clear of both HUD panels */
	let x = 0;
	let y = 0;
	for (let slot = 0; slot < 4; slot++) {
		x = sx - width * 0.5 + (slot === 2 ? radius : slot === 3 ? -radius - width : 0);
		y = sy - height * 0.5 + (slot === 0 ? radius : slot === 1 ? -radius - height : 0);
		if (x < 4) x = 4;
		else if (x > maxX) x = maxX;
		if (y < 4) y = 4;
		else if (y > maxY) y = maxY;
		if (!rectUnderHud(x, y, width, height)) break;
	}
	plate(x, y, width, height, info.warn ? 'rgba(255, 148, 120, 0.7)' : 'rgba(255, 207, 110, 0.34)');
	ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = info.warn ? WARN : GOLD;
	ctx.fillText(info.text, x + width * 0.5, y + 6.5);
	const frac = info.frac < 0 ? 0 : info.frac > 1 ? 1 : info.frac;
	ctx.fillStyle = 'rgba(140, 170, 200, 0.28)';
	ctx.fillRect(x + 5, y + 13, width - 10, 3);
	ctx.fillStyle = info.warn ? WARN : MINT;
	ctx.fillRect(x + 5, y + 13, (width - 10) * frac, 3);
}

function drawCareerPad() {
	const career = activeCareer();
	const at = career.at;
	if (at >= 0) drawPadPlate(at, padPlateInfo(career, at, padPlate));
	/* the charge of every other rail the player landed on, read on hover */
	if (!aiming && hoverPlanet >= 0 && hoverPlanet !== at) {
		const info = padPlateInfo(career, hoverPlanet, hoverPadPlate);
		if (info) drawPadPlate(hoverPlanet, info);
	}
}

function drawRivalTags() {
	ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const maxX = window.innerWidth - 26;
	const maxY = window.innerHeight - 18;
	for (let rIdx = 0; rIdx < bot.count; rIdx++) {
		const r = bot.rivals[rIdx];
		const flying = r.sim.status === STATUS_FLYING;
		const wx = flying ? r.sim.cargo.x : tradeSim.planetX[r.basePlanet];
		const wy = flying ? r.sim.cargo.y : tradeSim.planetY[r.basePlanet];
		let x = wx * view.scale + view.offX + (flying ? 8 : -11 + rIdx * 22);
		let y = wy * view.scale + view.offY - (flying ? 18 : tradeSim.planetR[r.basePlanet] * view.scale + 19);
		if (x < 4) x = 4;
		else if (x > maxX) x = maxX;
		if (y < 4) y = 4;
		else if (y > maxY) y = maxY;
		plate(x, y, 22, 13, RIVAL_COLOURS[rIdx]);
		ctx.fillStyle = RIVAL_COLOURS[rIdx];
		ctx.fillText(RIVAL_TAGS[rIdx], x + 11, y + 7);
	}
}
